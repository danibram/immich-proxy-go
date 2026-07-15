import { ChevronLeft, ChevronRight, Download, ImageOff, Info, Maximize2, Minimize2, X, ZoomIn, ZoomOut } from 'lucide-solid';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { captureEvent } from '~/analytics';
import { api } from '~/api/client';
import type { Asset } from '~/api/types';
import { t } from '~/i18n';
import { useViewerCarousel } from '~/hooks/useViewerCarousel';
import { useViewerZoom } from '~/hooks/useViewerZoom';
import { saveUrl } from '~/utils/bulkDownload';
import {
  allowDownload,
  assets,
  closeViewer,
  mergeAssetDetails,
  selectAsset,
  selectedAsset,
  selectedAssetIndex,
  showMetadata,
  zoomQuality,
} from '~/store/share';
import {
  formatViewerFootDate,
  formatViewerFootSubtitle,
} from '~/utils/viewerFormat';
import { assetIdFromHash } from '~/utils/viewerDeepLink';
import { createRetryingImage } from '~/utils/imageLoader';
import { thumbhashToDataURL } from '~/utils/thumbhash';
import { findGalleryTransitionTarget, runViewerTransition } from '~/utils/viewTransitions';
import ExifSheet from './ExifSheet';
import ProtectedImage from './ProtectedImage';
import ViewerVideoLayer from './ViewerVideoLayer';

function ViewerSlide(props: {
  asset: Asset;
  width: number;
  slideKey: string;
  current?: boolean;
  transform?: string;
  interacting?: boolean;
  highQuality?: boolean;
}) {
  // The slide loads `preview` (and `fullsize` on zoom, as before) with a
  // retry-once-then-downgrade ladder; while it loads, the small `thumbnail`
  // the grid already put in the browser cache is shown as an instant poster
  // over the thumbhash base layer — no blank slides (the PhotoSwipe `msrc`
  // idea). The ladder resets when the zoom quality toggles.
  const loader = createRetryingImage({
    sizes: () =>
      props.current && props.highQuality
        ? (['fullsize', 'preview', 'thumbnail'] as const)
        : (['preview', 'thumbnail'] as const),
    urlFor: (size, retry) => api.getThumbnailUrl(props.asset.id, size) + (retry ? '&retry=1' : ''),
    // Carousel slides are reused across navigation (props swap, component
    // persists), so a failed/loaded state must not leak to the next asset.
    key: () => props.asset.id,
  });
  const posterUrl = () => api.getThumbnailUrl(props.asset.id, 'thumbnail');
  const hashUrl = () => thumbhashToDataURL(props.asset.thumbhash);

  return (
    <div
      class={`vw-slide ${props.current ? 'is-current' : ''}`}
      data-slide={props.slideKey}
      style={{ width: `${props.width}px` }}
    >
      <Show
        when={props.asset.type === 'VIDEO'}
        fallback={
          <div
            class={`vw-zoom-layer ${props.interacting ? 'is-interacting' : ''}`}
            style={{ transform: props.current ? props.transform : undefined }}
          >
            <div class="vw-media">
              <Show when={!loader.loaded()}>
                <div class="vw-poster" aria-hidden="true" data-testid="viewer-poster">
                  <Show when={hashUrl()}>
                    <img class="vw-poster-layer" src={hashUrl()} alt="" draggable={false} />
                  </Show>
                  <img class="vw-poster-layer" src={posterUrl()} alt="" draggable={false} />
                </div>
              </Show>
              <Show
                when={!loader.failed()}
                fallback={
                  <div class="vw-broken" data-testid="viewer-image-broken">
                    <ImageOff size={28} />
                  </div>
                }
              >
                <Show
                  when={allowDownload()}
                  fallback={
                    <ProtectedImage
                      src={loader.src()!}
                      alt={props.asset.originalFileName}
                      class="vw-img"
                      onLoad={loader.onLoad}
                      onError={loader.onError}
                    />
                  }
                >
                  <img
                    ref={loader.attach}
                    class="vw-img"
                    src={loader.src()}
                    alt={props.asset.originalFileName}
                    draggable={false}
                    onLoad={loader.onLoad}
                    onError={loader.onError}
                  />
                </Show>
              </Show>
            </div>
          </div>
        }
      >
        <ViewerVideoLayer
          assetId={props.asset.id}
          duration={props.asset.duration}
          posterUrl={api.getThumbnailUrl(props.asset.id, 'preview')}
        />
      </Show>
    </div>
  );
}

export default function AssetViewer() {
  const [showInfo, setShowInfo] = createSignal(false);
  const [stageEl, setStageEl] = createSignal<HTMLDivElement>();
  const [viewerEl, setViewerEl] = createSignal<HTMLDivElement>();
  const [fullscreenAvailable, setFullscreenAvailable] = createSignal(false);
  const [fullscreen, setFullscreen] = createSignal(false);
  const [historyReady, setHistoryReady] = createSignal(false);
  // Every viewed image is its own history entry (the Google Photos model):
  // browser Back steps through previously viewed images before closing the
  // viewer. `viewerDepth` mirrors how deep into our own entries the current
  // position is, so close() can unwind them all with a single history.go().
  // popstate-driven navigation must not push again, hence the suppress flag.
  let viewerDepth = 0;
  let lastHistoryId: string | null = null;
  // Pushes are debounced: browsers rate-limit pushState (Safari throws past
  // ~100 calls/30s) and rapid swipes shouldn't mint an entry per flicked-past
  // image anyway — only the image the user settles on gets one.
  let historyPushTimer: number | null = null;

  const index = () => selectedAssetIndex();
  const list = () => assets();
  const current = () => {
    const i = index();
    const items = list();
    if (i >= 0 && i < items.length) return items[i];
    return selectedAsset()!;
  };

  const carousel = useViewerCarousel({
    index,
    count: () => list().length,
    stageEl,
    onIndexChange: (newIndex) => {
      const assetList = list();
      if (newIndex >= 0 && newIndex < assetList.length) {
        selectAsset(assetList[newIndex], newIndex);
      }
    },
    onSwipeStart: () => setShowInfo(false),
    animated: true,
  });

  const zoom = useViewerZoom({
    assetId: () => current().id,
    enabled: () => current().type === 'IMAGE',
    stageEl,
  });

  function cleanShareUrl(): string {
    return window.location.pathname + window.location.search;
  }

  function closeWithTransition() {
    const asset = current();
    runViewerTransition({
      direction: 'close',
      update: closeViewer,
      getNewElement:
        asset.type === 'IMAGE' ? () => findGalleryTransitionTarget(asset.id) : undefined,
    });
  }

  function requestClose() {
    // A pending debounced push firing after the unwind would resurrect a
    // hash entry on a closed viewer.
    cancelPendingHistoryPush();
    if (viewerDepth > 0) {
      // One jump past all our image entries; the resulting popstate lands on
      // the hash-less gallery entry and closes the viewer.
      window.history.go(-viewerDepth);
      return;
    }
    window.history.replaceState(window.history.state, '', cleanShareUrl());
    closeWithTransition();
  }

  async function toggleFullscreen() {
    const el = viewerEl();
    if (!el || !fullscreenAvailable()) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      // Browser or embedding policy denied fullscreen; the normal viewer
      // remains fully usable, so no disruptive error surface is needed.
    }
  }

  function handlePointerDown(event: PointerEvent) {

    if (zoom.onPointerDown(event)) carousel.cancelGesture();
    else carousel.onPointerDown(event);
  }

  function handlePointerMove(event: PointerEvent) {
    if (zoom.onPointerMove(event)) carousel.cancelGesture();
    else carousel.onPointerMove(event);
  }

  function handlePointerUp(event: PointerEvent) {
    if (zoom.onPointerUp(event)) carousel.cancelGesture();
    else carousel.onPointerUp();
  }

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        if (showInfo()) {
          setShowInfo(false);
        } else if (zoom.zoomed()) {
          zoom.reset();
        } else {
          requestClose();
        }
        break;
      case 'ArrowLeft':
        if (!zoom.zoomed()) carousel.step(-1, true);
        break;
      case 'ArrowRight':
        if (!zoom.zoomed()) carousel.step(1, true);
        break;
      case 'i':
      case 'I':
        if (showMetadata()) setShowInfo((v) => !v);
        break;
      case '+':
      case '=':
        zoom.zoomIn();
        break;
      case '-':
        zoom.zoomOut();
        break;
      case '0':
        zoom.reset();
        break;
      case 'f':
      case 'F':
        void toggleFullscreen();
        break;
    }
  }

  createEffect(() => {
    const asset = selectedAsset();
    if (!asset) return;
    captureEvent('asset_viewed', { asset_type: asset.type });
    setShowInfo(false);
  });

  function cancelPendingHistoryPush() {
    if (historyPushTimer !== null) {
      window.clearTimeout(historyPushTimer);
      historyPushTimer = null;
    }
  }

  createEffect(() => {
    const id = current().id;
    // popstate navigations pre-set lastHistoryId, so they dedupe here — the
    // browser already sits on the right entry and pushing would truncate the
    // forward stack.
    if (!historyReady() || id === lastHistoryId) return;
    lastHistoryId = id;
    cancelPendingHistoryPush();
    historyPushTimer = window.setTimeout(() => {
      historyPushTimer = null;
      try {
        viewerDepth += 1;
        window.history.pushState({ ippViewer: true, ippDepth: viewerDepth }, '', `#${encodeURIComponent(id)}`);
      } catch {
        // Rate-limited by the browser: losing one history entry degrades
        // gracefully (Back skips this image); keep depth consistent.
        viewerDepth -= 1;
      }
    }, 400);
  });

  // Immich v3 album listings carry no EXIF or original filename; fetch the
  // full details once per asset when it is opened in the viewer.
  const detailsRequested = new Set<string>();
  createEffect(() => {
    const asset = current();
    if (!asset?.id || asset.exifInfo || !showMetadata()) return;
    if (detailsRequested.has(asset.id)) return;
    detailsRequested.add(asset.id);
    api
      .getAsset(asset.id)
      .then(mergeAssetDetails)
      .catch(() => undefined);
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    const onPopState = (event: PopStateEvent) => {
      const id = assetIdFromHash(window.location.hash);
      if (id) {
        const assetList = list();
        const assetIndex = assetList.findIndex((asset) => asset.id === id);
        if (assetIndex >= 0) {
          // Back/Forward landed on another image entry: navigate the viewer
          // there and resync our depth from the entry's own state. A pending
          // debounced push belongs to an image the user flicked past — drop it.
          cancelPendingHistoryPush();
          viewerDepth = (event.state as { ippDepth?: number } | null)?.ippDepth ?? 1;
          lastHistoryId = id;
          selectAsset(assetList[assetIndex], assetIndex);
          return;
        }
      }
      cancelPendingHistoryPush();
      viewerDepth = 0;
      closeWithTransition();
    };
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === viewerEl());
    window.addEventListener('popstate', onPopState);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    setFullscreenAvailable(Boolean(document.fullscreenEnabled && viewerEl()?.requestFullscreen));

    viewerDepth = 1;
    lastHistoryId = current().id;
    window.history.pushState(
      { ippViewer: true, ippDepth: viewerDepth },
      '',
      `#${encodeURIComponent(current().id)}`
    );
    setHistoryReady(true);

    onCleanup(() => {
      cancelPendingHistoryPush();
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    });
  });

  const w = () => carousel.stageWidth();
  const footSubtitle = () => formatViewerFootSubtitle(current());

  return (
    <div ref={setViewerEl} class="viewer" data-testid="asset-viewer" onClick={requestClose}>
      <div class="vw-top" onClick={(e) => e.stopPropagation()}>
        <button type="button" class="vw-btn" aria-label={t().viewer.close} onClick={requestClose}>
          <X size={22} />
        </button>
        <div class="vw-count" data-testid="viewer-count">
          {index() + 1} / {list().length}
        </div>
        <div class="vw-top-actions">
          <Show when={current().type === 'IMAGE'}>
            <button
              type="button"
              class={`vw-btn ${zoom.zoomed() ? 'is-on' : ''}`}
              aria-label={zoom.zoomed() ? t().viewer.resetZoom : t().viewer.zoomIn}
              title={zoom.zoomed() ? t().viewer.resetZoom : t().viewer.zoomIn}
              onClick={() => (zoom.zoomed() ? zoom.reset() : zoom.zoomIn())}
            >
              <Show when={zoom.zoomed()} fallback={<ZoomIn size={22} />}>
                <ZoomOut size={22} />
              </Show>
            </button>
          </Show>
          <Show when={showMetadata()}>
            <button
              type="button"
              class={`vw-btn ${showInfo() ? 'is-on' : ''}`}
              aria-label={t().viewer.info}
              onClick={() => setShowInfo((v) => !v)}
            >
              <Info size={22} />
            </button>
          </Show>
          <Show when={allowDownload()}>
            <Show when={current().id} keyed>
              {(assetId) => (
                <button
                  type="button"
                  class="vw-btn"
                  aria-label={t().viewer.download}
                  onClick={(e) => {
                    e.stopPropagation();
                    // fetch+blob instead of navigating to /original directly,
                    // so hotlink protection (which blocks Sec-Fetch-Dest:
                    // document) does not reject the download.
                    void saveUrl(api.getOriginalUrl(assetId), current().originalFileName || assetId);
                  }}
                >
                  <Download size={22} />
                </button>
              )}
            </Show>
          </Show>
          <Show when={fullscreenAvailable()}>
            <button
              type="button"
              class="vw-btn"
              aria-label={fullscreen() ? t().viewer.exitFullscreen : t().viewer.enterFullscreen}
              title={fullscreen() ? t().viewer.exitFullscreen : t().viewer.enterFullscreen}
              onClick={() => void toggleFullscreen()}
            >
              <Show when={fullscreen()} fallback={<Maximize2 size={22} />}>
                <Minimize2 size={22} />
              </Show>
            </button>
          </Show>
        </div>
      </div>

      <div class="vw-stage-wrap">
        <div
          class="vw-stage"
          ref={setStageEl}
          classList={{ 'is-zoomed': zoom.zoomed(), 'is-interacting': zoom.interacting() }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={zoom.onWheel}
          onDblClick={zoom.onDoubleClick}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            class={`vw-track ${carousel.anim() ? 'anim' : ''}`}
            style={{
              width: `${w() * 3}px`,
              transform: carousel.trackTransform(),
            }}
            onTransitionEnd={carousel.onTransitionEnd}
          >
            <Show when={carousel.hasPrev()} fallback={<div class="vw-slide" style={{ width: `${w()}px` }} />}>
              <ViewerSlide
                asset={list()[index() - 1]}
                width={w()}
                slideKey={list()[index() - 1].id}
              />
            </Show>
            <ViewerSlide
              asset={current()}
              width={w()}
              slideKey={current().id}
              current
              transform={zoom.transform()}
              interacting={zoom.interacting()}
              highQuality={zoom.zoomed() && zoomQuality() === 'fullsize'}
            />
            <Show when={carousel.hasNext()} fallback={<div class="vw-slide" style={{ width: `${w()}px` }} />}>
              <ViewerSlide
                asset={list()[index() + 1]}
                width={w()}
                slideKey={list()[index() + 1].id}
              />
            </Show>
          </div>
        </div>

        <button
          type="button"
          class={`vw-nav left ${carousel.hasPrev() && !zoom.zoomed() ? '' : 'off'}`}
          aria-label={t().viewer.previous}
          onClick={(e) => {
            e.stopPropagation();
            if (!zoom.zoomed()) carousel.step(-1, true);
          }}
        >
          <ChevronLeft size={26} />
        </button>
        <button
          type="button"
          class={`vw-nav right ${carousel.hasNext() && !zoom.zoomed() ? '' : 'off'}`}
          aria-label={t().viewer.next}
          onClick={(e) => {
            e.stopPropagation();
            if (!zoom.zoomed()) carousel.step(1, true);
          }}
        >
          <ChevronRight size={26} />
        </button>
      </div>

      <div class="vw-foot" onClick={(e) => e.stopPropagation()}>
        <div class="vw-foot-meta">
          <span class="vw-foot-date">{formatViewerFootDate(current())}</span>
          <Show when={footSubtitle()}>
            <span class="vw-foot-place">{footSubtitle()}</span>
          </Show>
        </div>
      </div>

      <Show when={showMetadata()}>
        <Show when={current().id} keyed>
          {() => (
            <ExifSheet
              asset={current()}
              open={showInfo()}
              onClose={() => setShowInfo(false)}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}
