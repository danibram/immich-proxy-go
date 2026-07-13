import { ChevronLeft, ChevronRight, Download, Info, Maximize2, Minimize2, X, ZoomIn, ZoomOut } from 'lucide-solid';
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
  const poster = () =>
    api.getThumbnailUrl(props.asset.id, props.current && props.highQuality ? 'fullsize' : 'preview');

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
            <Show
              when={allowDownload()}
              fallback={
                <ProtectedImage
                  src={poster()}
                  alt={props.asset.originalFileName}
                  class="vw-img"
                />
              }
            >
              <img
                class="vw-img"
                src={poster()}
                alt={props.asset.originalFileName}
                draggable={false}
              />
            </Show>
          </div>
        }
      >
        <ViewerVideoLayer
          assetId={props.asset.id}
          duration={props.asset.duration}
          posterUrl={poster()}
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
  let suppressNextHistoryPush = false;

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

  function requestClose() {
    if (viewerDepth > 0) {
      // One jump past all our image entries; the resulting popstate lands on
      // the hash-less gallery entry and closes the viewer.
      window.history.go(-viewerDepth);
      return;
    }
    window.history.replaceState(window.history.state, '', cleanShareUrl());
    closeViewer();
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

  createEffect(() => {
    const id = current().id;
    if (!historyReady() || id === lastHistoryId) return;
    lastHistoryId = id;
    if (suppressNextHistoryPush) {
      // This navigation came from popstate: the browser already moved to the
      // right entry, pushing would truncate the forward stack.
      suppressNextHistoryPush = false;
      return;
    }
    viewerDepth += 1;
    window.history.pushState({ ippViewer: true, ippDepth: viewerDepth }, '', `#${encodeURIComponent(id)}`);
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
          // there and resync our depth from the entry's own state.
          viewerDepth = (event.state as { ippDepth?: number } | null)?.ippDepth ?? 1;
          suppressNextHistoryPush = true;
          lastHistoryId = id;
          selectAsset(assetList[assetIndex], assetIndex);
          return;
        }
      }
      viewerDepth = 0;
      closeViewer();
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
