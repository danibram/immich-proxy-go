import type { Asset } from '~/api/types';
import type { DateGroup } from '~/utils/dateUtils';

/**
 * Pure timeline geometry: date groups + asset ratios + container width in,
 * absolute row positions and a total height out. Everything the gallery
 * renders is derived from this layout and the current scrollTop — there is
 * no per-tile accumulated state anywhere, so any transient glitch heals on
 * the next derivation pass.
 */

export interface LayoutItem {
  asset: Asset;
  /** px from the left edge of the layout box */
  left: number;
  width: number;
  height: number;
}

export interface LayoutRow {
  kind: 'header' | 'assets';
  /** px from the top of the layout box */
  top: number;
  height: number;
  group: DateGroup;
  /** empty for header rows */
  items: LayoutItem[];
}

export interface GroupLayout {
  group: DateGroup;
  top: number;
  height: number;
  firstRowIndex: number;
  rowCount: number;
}

export interface TimelineLayout {
  rows: LayoutRow[];
  groups: GroupLayout[];
  totalHeight: number;
  width: number;
}

export interface LayoutMetrics {
  /** target justified row height; actual rows shrink to justify */
  rowHeight: number;
  /** horizontal and vertical gap between tiles */
  gap: number;
  headerHeight: number;
  /** vertical space above each group */
  groupSpacing: number;
}

export const RATIO_MIN = 0.4;
export const RATIO_MAX = 2.5;

function isRotated90or270(orientation?: string): boolean {
  if (!orientation) return false;
  const rotatedValues = ['5', '6', '7', '8'];
  const rotatedStrings = ['90', '270'];

  if (rotatedValues.includes(orientation)) return true;
  return rotatedStrings.some((deg) => orientation.includes(deg));
}

export function getAspectRatio(asset: Asset): number {
  if (asset.ratio && asset.ratio > 0) {
    return clampRatio(asset.ratio);
  }

  const width = asset.exifInfo?.exifImageWidth;
  const height = asset.exifInfo?.exifImageHeight;
  const orientation = asset.exifInfo?.orientation;

  if (width && height && height > 0) {
    let aspectRatio = width / height;

    if (isRotated90or270(orientation)) {
      aspectRatio = height / width;
    }

    return clampRatio(aspectRatio);
  }

  return 1;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.max(RATIO_MIN, Math.min(RATIO_MAX, ratio));
}

interface PendingItem {
  asset: Asset;
  ratio: number;
}

/**
 * Greedy justified layout (the classic Flickr/Google-Photos row builder):
 * fill a row at the target height until it overflows the container width,
 * then shrink the whole row so it fits exactly. The final row of each group
 * keeps the target height (never stretched), so short trailing rows don't
 * blow up — unless a single tile is wider than the container, in which case
 * it shrinks to fit.
 */
function buildGroupRows(
  group: DateGroup,
  width: number,
  y: number,
  metrics: LayoutMetrics
): { rows: LayoutRow[]; bottom: number } {
  const { rowHeight, gap } = metrics;
  const rows: LayoutRow[] = [];
  let pending: PendingItem[] = [];
  let pendingRatio = 0;

  const rowWidthAt = (height: number, extraRatio = 0, extraCount = 0) => {
    const count = pending.length + extraCount;
    return (pendingRatio + extraRatio) * height + gap * Math.max(0, count - 1);
  };

  const flush = (justify: boolean) => {
    if (pending.length === 0) return;

    const gaps = gap * (pending.length - 1);
    // Height that makes the row span the container exactly.
    const justifiedHeight = pendingRatio > 0 ? (width - gaps) / pendingRatio : rowHeight;
    const height = justify
      ? justifiedHeight
      : // Trailing row: keep the target height, but never let it overflow
        // the container (a single panorama tile can be wider than the row).
        Math.min(rowHeight, justifiedHeight);
    const safeHeight = Math.max(1, height);

    const items: LayoutItem[] = [];
    let x = 0;
    for (const entry of pending) {
      const itemWidth = entry.ratio * safeHeight;
      items.push({ asset: entry.asset, left: x, width: itemWidth, height: safeHeight });
      x += itemWidth + gap;
    }

    rows.push({ kind: 'assets', top: y, height: safeHeight, group, items });
    y += safeHeight + gap;
    pending = [];
    pendingRatio = 0;
  };

  for (const asset of group.assets) {
    const ratio = getAspectRatio(asset);
    if (pending.length > 0 && rowWidthAt(rowHeight, ratio, 1) > width) {
      // Adding this tile at the target height overflows: decide whether it
      // belongs to this row (shrink to justify) or starts the next one —
      // include it when the row is still mostly empty, otherwise break.
      if (rowWidthAt(rowHeight) < width * 0.66) {
        pending.push({ asset, ratio });
        pendingRatio += ratio;
        flush(true);
        continue;
      }
      flush(true);
    }

    pending.push({ asset, ratio });
    pendingRatio += ratio;
    if (rowWidthAt(rowHeight) >= width) {
      flush(true);
    }
  }
  flush(false);

  // y currently includes a trailing gap after the last row; the group ends
  // at the bottom edge of its last row.
  const bottom = rows.length > 0 ? y - gap : y;
  return { rows, bottom };
}

export function computeTimelineLayout(
  groups: DateGroup[],
  width: number,
  metrics: LayoutMetrics
): TimelineLayout {
  const rows: LayoutRow[] = [];
  const groupLayouts: GroupLayout[] = [];

  if (width <= 0 || groups.length === 0) {
    return { rows, groups: groupLayouts, totalHeight: 0, width: Math.max(0, width) };
  }

  let y = 0;
  for (const group of groups) {
    y += metrics.groupSpacing;
    const groupTop = y;
    const firstRowIndex = rows.length;

    rows.push({ kind: 'header', top: y, height: metrics.headerHeight, group, items: [] });
    y += metrics.headerHeight;

    const built = buildGroupRows(group, width, y, metrics);
    rows.push(...built.rows);
    y = built.bottom;

    groupLayouts.push({
      group,
      top: groupTop,
      height: y - groupTop,
      firstRowIndex,
      rowCount: rows.length - firstRowIndex,
    });
  }

  return { rows, groups: groupLayouts, totalHeight: y, width };
}

export interface RowRange {
  /** inclusive; start > end means "empty" */
  start: number;
  end: number;
}

export const EMPTY_RANGE: RowRange = { start: 0, end: -1 };

/**
 * Rows intersecting [top, bottom] (layout-box coordinates), by binary search
 * over the sorted row offsets. Rows never overlap and are sorted by `top`,
 * so the range is contiguous.
 */
export function computeRowRange(layout: TimelineLayout, top: number, bottom: number): RowRange {
  const rows = layout.rows;
  if (rows.length === 0 || bottom < top) return EMPTY_RANGE;

  // First row whose bottom edge is below `top`.
  let lo = 0;
  let hi = rows.length - 1;
  let start = rows.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top + rows[mid].height > top) {
      start = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  if (start >= rows.length) return EMPTY_RANGE;

  // Last row whose top edge is above `bottom`.
  lo = start;
  hi = rows.length - 1;
  let end = start - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top < bottom) {
      end = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (end < start) return EMPTY_RANGE;

  return { start, end };
}

export function rangesEqual(a: RowRange, b: RowRange): boolean {
  return a.start === b.start && a.end === b.end;
}

/**
 * The group whose vertical span contains `y`; clamps to the first/last
 * group outside the layout. Returns undefined only for an empty layout.
 */
export function findGroupAt(layout: TimelineLayout, y: number): GroupLayout | undefined {
  const groups = layout.groups;
  if (groups.length === 0) return undefined;
  if (y < groups[0].top) return groups[0];

  let lo = 0;
  let hi = groups.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid].top <= y) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return groups[found];
}

export interface ScrollAnchor {
  assetId: string;
  /** px between the anchor row's top and the viewport top when captured */
  offset: number;
}

/**
 * The first asset visible at `top`, captured so a relayout (width change)
 * can restore the user's place: reapply with `restoreAnchor`.
 */
export function captureAnchor(layout: TimelineLayout, top: number): ScrollAnchor | null {
  const range = computeRowRange(layout, top, top + 1);
  if (range.end < range.start) return null;

  for (let i = range.start; i < layout.rows.length; i++) {
    const row = layout.rows[i];
    if (row.kind !== 'assets' || row.items.length === 0) continue;
    return { assetId: row.items[0].asset.id, offset: top - row.top };
  }
  return null;
}

/** New layout-box scrollTop that keeps the anchored asset's row in place. */
export function restoreAnchor(layout: TimelineLayout, anchor: ScrollAnchor): number | null {
  for (const row of layout.rows) {
    if (row.kind !== 'assets') continue;
    if (row.items.some((item) => item.asset.id === anchor.assetId)) {
      return row.top + anchor.offset;
    }
  }
  return null;
}
