import { Check, ImageOff, Play } from 'lucide-solid';
import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js';
import type { Accessor } from 'solid-js';
import { captureEvent } from '~/analytics';
import { api } from '~/api/client';
import type { Asset } from '~/api/types';
import { t } from '~/i18n';
import { formatDuration, groupAssetsByDate } from '~/utils/dateUtils';
import { createRetryingImage } from '~/utils/imageLoader';
import { thumbhashBackground } from '~/utils/thumbhash';
import {
  assets,
  isAssetSelected,
  isDateFullySelected,
  isSelectionMode,
  selectAllFromDate,
  selectAsset,
  toggleAssetSelection,
} from '~/store/share';
import TimelineScrubber from './TimelineScrubber';
import {
  captureAnchor,
  computeRowRange,
  computeTimelineLayout,
  EMPTY_RANGE,
  rangesEqual,
  restoreAnchor,
  type LayoutItem,
  type LayoutMetrics,
  type LayoutRow,
  type RowRange,
  type ScrollAnchor,
  type TimelineLayout,
} from './timeline/layout';

interface Props {
  scrollContainer?: Accessor<HTMLDivElement | undefined>;
}

/** Rendered window: visible viewport plus this many viewports of overscan on each side. */
const OVERSCAN = 1.5;
/**
 * A per-frame scrollTop jump larger than this fraction of the viewport is a
 * teleport (scrubber drag / programmatic jump), not reading-speed scrolling.
 * While teleporting, row shells still render but image loads are deferred.
 */
const FAST_SCROLL_VIEWPORT_FRACTION = 0.75;
/** Image loads resume this long after the last teleport (if no scrollend fires first). */
const SETTLE_MS = 150;

const FALLBACK_METRICS: LayoutMetrics = {
  rowHeight: 176,
  gap: 3,
  headerHeight: 48,
  groupSpacing: 10,
};

function readMetrics(el: HTMLElement): LayoutMetrics {
  const style = getComputedStyle(el);
  const read = (name: string, fallback: number) => {
    const value = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    rowHeight: read('--gallery-row-height', FALLBACK_METRICS.rowHeight),
    gap: read('--gallery-gap', FALLBACK_METRICS.gap),
    headerHeight: read('--grp-head-h', FALLBACK_METRICS.headerHeight),
    groupSpacing: read('--grp-space', FALLBACK_METRICS.groupSpacing),
  };
}

/**
 * Mount = load: the <img> gets its src the moment it enters the load
 * window, and unmounting removes the element. Grid tiles request the small
 * webp `thumbnail` size (the tile is at most a few hundred px — the old
 * `preview` fetched ~1440px images per tile); the viewer is what loads
 * `preview`. On error the tile retries the same URL once after a short
 * backoff (with a `&retry=1` marker so normal URLs stay CDN-cacheable),
 * then settles on a persistent placeholder over the thumbhash background.
 * A remount (scroll away and back) resets everything, as before.
 */
function Thumb(props: { assetId: string }) {
  const loader = createRetryingImage({
    sizes: () => ['thumbnail'] as const,
    urlFor: (size, retry) => api.getThumbnailUrl(props.assetId, size) + (retry ? '&retry=1' : ''),
    key: () => props.assetId,
  });

  return (
    <Show
      when={!loader.failed()}
      fallback={
        <div class="thumb-broken" data-testid="gallery-thumb-broken">
          <ImageOff size={18} />
        </div>
      }
    >
      <img
        data-testid="gallery-thumb"
        src={loader.src()}
        alt=""
        decoding="async"
        onLoad={loader.onLoad}
        onError={loader.onError}
      />
    </Show>
  );
}

export default function AssetTimeline(props: Props) {
  const groupedAssets = createMemo(() => groupAssetsByDate(assets()));

  // jsdom/SSR: without ResizeObserver the container can't be measured, so
  // lay out against a fixed width and render every row (no windowing).
  const virtualize = typeof ResizeObserver !== 'undefined';

  const [box, setBox] = createSignal<HTMLDivElement>();
  const [width, setWidth] = createSignal(0);
  const [viewportH, setViewportH] = createSignal(
    typeof window !== 'undefined' ? window.innerHeight : 900
  );
  const [layoutScrollTop, setLayoutScrollTop] = createSignal(0);
  const [metrics, setMetrics] = createSignal<LayoutMetrics>(FALLBACK_METRICS);
  const [fastScroll, setFastScroll] = createSignal(false);

  const getScrollContainer = () => props.scrollContainer?.();

  const layout = createMemo<TimelineLayout>(() =>
    computeTimelineLayout(groupedAssets(), virtualize ? width() : 1024, metrics())
  );

  /** Rows currently in the DOM — pure function of scrollTop. */
  const renderRange = createMemo<RowRange>(
    () => {
      const shape = layout();
      if (!virtualize) return { start: 0, end: shape.rows.length - 1 };
      const overscan = viewportH() * OVERSCAN;
      const top = layoutScrollTop() - overscan;
      const bottom = layoutScrollTop() + viewportH() + overscan;
      return computeRowRange(shape, top, bottom);
    },
    EMPTY_RANGE,
    { equals: rangesEqual }
  );

  /**
   * Rows whose tiles have a mounted <img>. Frozen while teleporting so a
   * scrubber drag doesn't fire a request per intermediate position; catches
   * up with renderRange as soon as scrolling settles. Tiles load only when
   * their row is in BOTH ranges, so during a drag the (stale) load window
   * quickly stops intersecting the render window and nothing loads.
   */
  const [loadRange, setLoadRange] = createSignal<RowRange>(EMPTY_RANGE);
  createEffect(() => {
    const range = renderRange();
    if (!fastScroll()) setLoadRange(range);
  });

  const visibleRows = createMemo<LayoutRow[]>(() => {
    const { rows } = layout();
    const range = renderRange();
    if (range.end < range.start) return [];
    return rows.slice(range.start, range.end + 1);
  });

  const rowLoads = createMemo(() => {
    const render = renderRange();
    const load = loadRange();
    return {
      offset: render.start,
      start: Math.max(render.start, load.start),
      end: Math.min(render.end, load.end),
    };
  });

  // --- measurement + scroll derivation ------------------------------------

  let settleTimer: number | null = null;
  let frameId: number | null = null;
  let lastScrollTop: number | null = null;
  let pendingAnchor: ScrollAnchor | null = null;
  // Offset of the layout box inside the scroll content. Measuring it forces
  // a reflow, so it is cached and refreshed only on measure/settle — the
  // overscan absorbs the few px it can drift while the top bar collapses.
  let cachedBoxTop = 0;

  function measureBoxTop(container: HTMLElement): number {
    const el = box();
    if (!el) return cachedBoxTop;
    cachedBoxTop =
      el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    return cachedBoxTop;
  }

  function armSettleTimer() {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      // Don't settle straight from the timer: after a main-thread stall the
      // timer fires ahead of a queue of pending mousemove teleports, and
      // settling here would load a full window mid-drag. Verify on the next
      // frame — if those moves re-armed the timer, stay frozen.
      requestAnimationFrame(() => {
        if (settleTimer !== null) return;
        const container = getScrollContainer();
        if (container) measureBoxTop(container);
        // syncScroll re-arms the timer if the position teleported again
        // (queued moves that dispatched after the timer fired) — in that
        // case stay frozen.
        syncScroll();
        if (settleTimer === null) setFastScroll(false);
      });
    }, SETTLE_MS);
  }

  function syncScroll() {
    const container = getScrollContainer();
    const el = box();
    if (!container || !el) return;

    const top = container.scrollTop - cachedBoxTop;
    const delta = lastScrollTop === null ? 0 : Math.abs(top - lastScrollTop);
    lastScrollTop = top;

    if (delta > viewportH() * FAST_SCROLL_VIEWPORT_FRACTION) {
      setFastScroll(true);
      armSettleTimer();
    }

    setLayoutScrollTop(top);
  }

  function scheduleSync() {
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      syncScroll();
    });
  }

  function settleNow() {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    const container = getScrollContainer();
    if (container) measureBoxTop(container);
    syncScroll();
    setFastScroll(false);
  }

  function measure() {
    const el = box();
    const container = getScrollContainer();
    if (!el) return;

    const nextWidth = el.clientWidth;
    const current = untrack(width);
    if (nextWidth !== current && current > 0) {
      // Width is about to change the whole geometry: remember what the user
      // is looking at so the relayout effect can restore it.
      pendingAnchor = captureAnchor(untrack(layout), untrack(layoutScrollTop));
    }

    batch(() => {
      setMetrics(readMetrics(el));
      setWidth(nextWidth);
      if (container) {
        measureBoxTop(container);
        setViewportH(container.clientHeight || window.innerHeight);
      }
    });
  }

  // Keep the top-visible row stable across relayouts (width change).
  createEffect(() => {
    const shape = layout();
    const container = getScrollContainer();
    if (!pendingAnchor || !container || shape.rows.length === 0) return;

    const anchor = pendingAnchor;
    pendingAnchor = null;
    requestAnimationFrame(() => {
      const target = restoreAnchor(layout(), anchor);
      if (target === null) return;
      container.scrollTop = target + measureBoxTop(container);
      settleNow();
    });
  });

  onMount(() => {
    if (!virtualize) return;
    const el = box();
    if (!el) return;

    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    onCleanup(() => observer.disconnect());
    measure();
    syncScroll();
  });

  createEffect(() => {
    const container = getScrollContainer();
    if (!container || !virtualize) return;

    const onScroll = () => scheduleSync();
    const onResize = () => {
      measure();
      scheduleSync();
    };

    // No `scrollend` listener on purpose: Chromium fires scrollend after
    // every programmatic scrollTop assignment, so during a scrubber drag
    // (one teleport per mousemove) it would end the fast-scroll freeze
    // between every move and load a window per intermediate position. The
    // settle timer ("no teleport for SETTLE_MS") is the reliable signal.
    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    measure();
    syncScroll();

    onCleanup(() => {
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    });
  });

  onCleanup(() => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    if (frameId !== null) cancelAnimationFrame(frameId);
  });

  // --- selection / click handlers (unchanged behavior) --------------------

  let longPressTimer: number | null = null;
  let longPressAsset: Asset | null = null;

  function handleAssetClick(asset: Asset, e: MouseEvent) {
    if (isSelectionMode()) {
      e.preventDefault();
      toggleAssetSelection(asset.id);
      return;
    }

    const index = assets().findIndex((a) => a.id === asset.id);
    selectAsset(asset, index);
  }

  function handleAssetLongPress(asset: Asset) {
    if (!isSelectionMode()) {
      captureEvent('selection_mode_enabled', { source: 'long_press' });
    }
    toggleAssetSelection(asset.id);
  }

  function handleTouchStartAsset(asset: Asset) {
    longPressAsset = asset;
    longPressTimer = window.setTimeout(() => {
      if (longPressAsset) {
        handleAssetLongPress(longPressAsset);
        longPressAsset = null;
      }
    }, 500);
  }

  function handleTouchEndAsset() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressAsset = null;
  }

  onCleanup(() => {
    if (longPressTimer !== null) clearTimeout(longPressTimer);
  });

  // --- render --------------------------------------------------------------

  const px = (value: number) => `${value}px`;

  function renderItem(item: LayoutItem, load: () => boolean) {
    const asset = item.asset;
    const selected = () => isAssetSelected(asset.id);

    return (
      <div
        data-testid="gallery-item"
        data-asset-type={asset.type}
        class={`gallery-item ${selected() ? 'is-selected' : ''} ${isSelectionMode() ? 'is-selecting' : ''}`}
        style={{
          left: px(item.left),
          width: px(item.width),
          height: px(item.height),
        }}
        onClick={(e) => handleAssetClick(asset, e)}
        onTouchStart={() => handleTouchStartAsset(asset)}
        onTouchEnd={handleTouchEndAsset}
        onTouchCancel={handleTouchEndAsset}
        role="button"
        tabIndex={0}
      >
        <div
          class="thumb-img-slot"
          data-testid="gallery-thumb-slot"
          // Thumbhash placeholder: paints instantly while the real thumbnail
          // loads and stays visible behind the broken-image fallback. The
          // decode is memoized module-wide, so remounts during virtual
          // scrolling never re-decode.
          style={{ 'background-image': thumbhashBackground(asset.thumbhash) }}
        >
          <Show when={load()}>
            <Thumb assetId={asset.id} />
          </Show>
        </div>
        <div class="thumb-veil" />

        <Show when={asset.type === 'VIDEO'}>
          <div class="thumb-vid">
            <Play size={10} fill="white" stroke-width={0} />
            <Show when={asset.duration && formatDuration(asset.duration)}>
              {formatDuration(asset.duration)}
            </Show>
          </div>
        </Show>

        <Show when={isSelectionMode() || selected()}>
          <div
            class={`thumb-mark ${selected() ? 'is-on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleAssetSelection(asset.id);
            }}
          >
            <Show when={selected()}>
              <Check size={12} stroke-width={3} />
            </Show>
          </div>
        </Show>
      </div>
    );
  }

  return (
    <>
      <div
        ref={setBox}
        class="vtl"
        data-testid="virtual-timeline"
        style={{ position: 'relative', height: px(layout().totalHeight) }}
      >
        <For each={visibleRows()}>
          {(row, i) => (
            <Show
              when={row.kind === 'assets'}
              fallback={
                <div
                  id={`group-${row.group.date}`}
                  data-group-date={row.group.date}
                  class="grp"
                  style={{ position: 'absolute', top: px(row.top), left: 0, right: 0, height: px(row.height) }}
                >
                  <div class="grp-head">
                    <Show when={isSelectionMode()}>
                      <button
                        type="button"
                        class={`grp-sel ${isDateFullySelected(row.group.date) ? 'is-on' : ''}`}
                        aria-label={t().selectAllFromDate(row.group.label)}
                        onClick={() => selectAllFromDate(row.group.date)}
                      >
                        <Show when={isDateFullySelected(row.group.date)}>
                          <Check size={14} stroke-width={3} />
                        </Show>
                      </button>
                    </Show>
                    <div class="grp-title">
                      <span class="grp-date">{row.group.label}</span>
                    </div>
                  </div>
                </div>
              }
            >
              <div
                class={`vrow ${isSelectionMode() ? 'is-selecting' : ''}`}
                style={{ position: 'absolute', top: px(row.top), left: 0, right: 0, height: px(row.height) }}
              >
                <For each={row.items}>
                  {(item) => {
                    const load = () => {
                      const loads = rowLoads();
                      const rowIndex = loads.offset + i();
                      return rowIndex >= loads.start && rowIndex <= loads.end;
                    };
                    return renderItem(item, load);
                  }}
                </For>
              </div>
            </Show>
          )}
        </For>
      </div>

      <TimelineScrubber
        scrollContainer={props.scrollContainer}
        groupedAssets={groupedAssets}
        layout={layout}
        layoutTop={() => cachedBoxTop}
      />
    </>
  );
}
