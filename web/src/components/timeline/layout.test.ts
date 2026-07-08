import { describe, expect, it } from 'vitest';
import type { Asset } from '~/api/types';
import type { DateGroup } from '~/utils/dateUtils';
import {
  captureAnchor,
  computeRowRange,
  computeTimelineLayout,
  EMPTY_RANGE,
  findGroupAt,
  getAspectRatio,
  rangesEqual,
  restoreAnchor,
  type LayoutMetrics,
} from './layout';

let assetSeq = 0;

function makeAsset(ratio: number, id = `asset-${++assetSeq}`): Asset {
  return { id, type: 'IMAGE', ratio } as Asset;
}

function makeGroup(date: string, assets: Asset[]): DateGroup {
  return {
    date,
    label: date,
    scrubberLabel: date,
    year: 2024,
    month: 0,
    day: 1,
    assets,
  };
}

const METRICS: LayoutMetrics = {
  rowHeight: 100,
  gap: 4,
  headerHeight: 50,
  groupSpacing: 10,
};

describe('getAspectRatio', () => {
  it('clamps extreme ratios to [0.4, 2.5]', () => {
    expect(getAspectRatio(makeAsset(0.1))).toBe(0.4);
    expect(getAspectRatio(makeAsset(10))).toBe(2.5);
    expect(getAspectRatio(makeAsset(1.5))).toBe(1.5);
  });

  it('falls back to EXIF dimensions and orientation', () => {
    const landscape = { id: 'x', exifInfo: { exifImageWidth: 400, exifImageHeight: 200 } } as Asset;
    expect(getAspectRatio(landscape)).toBe(2);

    const rotated = {
      id: 'y',
      exifInfo: { exifImageWidth: 400, exifImageHeight: 200, orientation: '6' },
    } as Asset;
    expect(getAspectRatio(rotated)).toBe(0.5);
  });

  it('defaults to 1 without usable data', () => {
    expect(getAspectRatio({ id: 'z' } as Asset)).toBe(1);
    expect(getAspectRatio(makeAsset(0))).toBe(1);
  });
});

describe('computeTimelineLayout', () => {
  it('returns an empty layout for zero width or no groups', () => {
    expect(computeTimelineLayout([], 800, METRICS).totalHeight).toBe(0);
    const groups = [makeGroup('2024-01-01', [makeAsset(1)])];
    expect(computeTimelineLayout(groups, 0, METRICS).rows).toHaveLength(0);
  });

  it('keeps a non-overflowing group in a single target-height row', () => {
    // 3 squares at h=100 → 100 + 4 + 100 + 4 + 100 = 308 < 320
    const groups = [makeGroup('2024-01-01', [makeAsset(1), makeAsset(1), makeAsset(1)])];
    const layout = computeTimelineLayout(groups, 320, METRICS);

    expect(layout.rows).toHaveLength(2); // header + 1 asset row
    const row = layout.rows[1];
    expect(row.kind).toBe('assets');
    expect(row.items).toHaveLength(3);
    expect(row.height).toBe(100); // trailing row keeps the target height
    expect(layout.totalHeight).toBe(10 + 50 + 100);
  });

  it('breaks rows greedily and justifies full rows to the container width', () => {
    const groups = [makeGroup('2024-01-01', Array.from({ length: 8 }, () => makeAsset(1)))];
    const layout = computeTimelineLayout(groups, 320, METRICS);

    const assetRows = layout.rows.filter((r) => r.kind === 'assets');
    expect(assetRows.map((r) => r.items.length)).toEqual([3, 3, 2]);

    // Justified rows span the width exactly.
    for (const row of assetRows.slice(0, 2)) {
      const spanned =
        row.items.reduce((sum, item) => sum + item.width, 0) + METRICS.gap * (row.items.length - 1);
      expect(spanned).toBeCloseTo(320, 6);
      expect(row.height).toBeCloseTo((320 - 2 * METRICS.gap) / 3, 6);
    }

    // Trailing row is never stretched above the target height.
    expect(assetRows[2].height).toBe(100);
  });

  it('items advance left-to-right with gaps and share the row height', () => {
    const groups = [makeGroup('2024-01-01', [makeAsset(1), makeAsset(2), makeAsset(0.5)])];
    const layout = computeTimelineLayout(groups, 500, METRICS);
    const row = layout.rows[1];

    let expectedLeft = 0;
    for (const item of row.items) {
      expect(item.left).toBeCloseTo(expectedLeft, 6);
      expect(item.height).toBe(row.height);
      expectedLeft += item.width + METRICS.gap;
    }
  });

  it('shrinks a single tile wider than the container', () => {
    const groups = [makeGroup('2024-01-01', [makeAsset(2.5)])];
    const layout = computeTimelineLayout(groups, 200, METRICS);
    const row = layout.rows[1];

    expect(row.height).toBeCloseTo(200 / 2.5, 6);
    expect(row.items[0].width).toBeCloseTo(200, 6);
  });

  it('never mixes groups in a row and stacks groups with spacing', () => {
    const groups = [
      makeGroup('2024-01-02', [makeAsset(1), makeAsset(1)]),
      makeGroup('2024-01-01', [makeAsset(1)]),
    ];
    const layout = computeTimelineLayout(groups, 320, METRICS);

    expect(layout.rows.map((r) => r.kind)).toEqual(['header', 'assets', 'header', 'assets']);
    for (const row of layout.rows) {
      expect(new Set([row.group.date, ...row.items.map(() => row.group.date)]).size).toBe(1);
    }

    const [g1, g2] = layout.groups;
    expect(g1.top).toBe(10);
    expect(g1.height).toBe(50 + 100);
    expect(g2.top).toBe(g1.top + g1.height + METRICS.groupSpacing);
    expect(layout.totalHeight).toBe(g2.top + g2.height);

    // Header rows carry their group for anchor/scrubber consumers.
    expect(layout.rows[2].top).toBe(g2.top);
    expect(layout.rows[2].group.date).toBe('2024-01-01');
  });

  it('handles degenerate ratios across the clamp range without overlap', () => {
    const ratios = [0.4, 2.5, 0.4, 2.5, 1, 0.7, 1.9, 0.4, 2.5, 1.2];
    const groups = [makeGroup('2024-01-01', ratios.map((r) => makeAsset(r)))];
    const layout = computeTimelineLayout(groups, 640, METRICS);

    const assetRows = layout.rows.filter((r) => r.kind === 'assets');
    let previousBottom = -Infinity;
    for (const row of assetRows) {
      expect(row.top).toBeGreaterThanOrEqual(previousBottom);
      previousBottom = row.top + row.height;
      expect(row.height).toBeGreaterThan(0);
      for (const item of row.items) {
        expect(item.width).toBeGreaterThan(0);
        expect(item.left + item.width).toBeLessThanOrEqual(640 + 1e-6);
      }
    }
    expect(assetRows.flatMap((r) => r.items)).toHaveLength(ratios.length);
  });
});

describe('computeRowRange', () => {
  const groups = [makeGroup('2024-01-01', Array.from({ length: 30 }, () => makeAsset(1)))];
  const layout = computeTimelineLayout(groups, 320, METRICS);

  it('finds the rows intersecting a span', () => {
    const row = layout.rows[3];
    const range = computeRowRange(layout, row.top, row.top + row.height);
    expect(range.start).toBeLessThanOrEqual(3);
    expect(range.end).toBeGreaterThanOrEqual(3);
  });

  it('covers the full layout for an unbounded span', () => {
    const range = computeRowRange(layout, -Infinity, Infinity);
    expect(range).toEqual({ start: 0, end: layout.rows.length - 1 });
  });

  it('clamps a span starting above the layout', () => {
    const firstRow = layout.rows[0];
    const range = computeRowRange(layout, -5000, firstRow.top + 1);
    expect(range.start).toBe(0);
    expect(range.end).toBe(0);
  });

  it('is empty past the end, for inverted spans, and for empty layouts', () => {
    expect(computeRowRange(layout, layout.totalHeight + 1, layout.totalHeight + 500)).toEqual(
      EMPTY_RANGE
    );
    expect(computeRowRange(layout, 100, 50)).toEqual(EMPTY_RANGE);
    const empty = computeTimelineLayout([], 320, METRICS);
    expect(computeRowRange(empty, 0, 100)).toEqual(EMPTY_RANGE);
  });

  it('treats row boundaries as half-open (a row ending at `top` is excluded)', () => {
    // Span from row 2's bottom edge into row 3: must exclude row 2.
    const rowBottom = layout.rows[2].top + layout.rows[2].height;
    const range = computeRowRange(layout, rowBottom, layout.rows[3].top + 1);
    expect(range.start).toBe(3);
    expect(range.end).toBe(3);
  });

  it('rangesEqual compares by bounds', () => {
    expect(rangesEqual({ start: 1, end: 4 }, { start: 1, end: 4 })).toBe(true);
    expect(rangesEqual({ start: 1, end: 4 }, { start: 1, end: 5 })).toBe(false);
  });
});

describe('findGroupAt', () => {
  const groups = [
    makeGroup('2024-01-03', [makeAsset(1), makeAsset(1)]),
    makeGroup('2024-01-02', [makeAsset(1)]),
    makeGroup('2024-01-01', [makeAsset(1)]),
  ];
  const layout = computeTimelineLayout(groups, 320, METRICS);

  it('returns the group containing the offset', () => {
    const second = layout.groups[1];
    expect(findGroupAt(layout, second.top + 1)?.group.date).toBe('2024-01-02');
    expect(findGroupAt(layout, second.top + second.height - 1)?.group.date).toBe('2024-01-02');
  });

  it('clamps to the first and last groups', () => {
    expect(findGroupAt(layout, -100)?.group.date).toBe('2024-01-03');
    expect(findGroupAt(layout, layout.totalHeight + 100)?.group.date).toBe('2024-01-01');
  });

  it('returns undefined for an empty layout', () => {
    expect(findGroupAt(computeTimelineLayout([], 320, METRICS), 10)).toBeUndefined();
  });
});

describe('scroll anchoring across relayout', () => {
  const assets = Array.from({ length: 40 }, () => makeAsset(1 + (assetSeq % 3) * 0.3));
  const groups = [makeGroup('2024-01-01', assets)];

  it('captures the first visible asset and restores its position at a new width', () => {
    const narrow = computeTimelineLayout(groups, 320, METRICS);
    const scrollTop = narrow.totalHeight / 2;
    const anchor = captureAnchor(narrow, scrollTop);
    expect(anchor).not.toBeNull();

    const wide = computeTimelineLayout(groups, 900, METRICS);
    const restored = restoreAnchor(wide, anchor!);
    expect(restored).not.toBeNull();

    // The anchored asset's row sits exactly `offset` above the new scrollTop.
    const anchoredRow = wide.rows.find(
      (row) => row.kind === 'assets' && row.items.some((i) => i.asset.id === anchor!.assetId)
    )!;
    expect(restored).toBeCloseTo(anchoredRow.top + anchor!.offset, 6);
  });

  it('returns null when nothing is visible or the asset is gone', () => {
    const layout = computeTimelineLayout(groups, 320, METRICS);
    expect(captureAnchor(layout, layout.totalHeight + 500)).toBeNull();
    expect(restoreAnchor(layout, { assetId: 'missing', offset: 0 })).toBeNull();
  });
});
