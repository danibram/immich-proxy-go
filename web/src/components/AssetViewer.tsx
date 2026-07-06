import { ChevronLeft, ChevronRight, Download, Info, X } from 'lucide-solid';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { captureEvent } from '~/analytics';
import { api } from '~/api/client';
import type { Asset } from '~/api/types';
import { useViewerCarousel } from '~/hooks/useViewerCarousel';
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
} from '~/store/share';
import {
  formatViewerFootDate,
  formatViewerFootSubtitle,
} from '~/utils/viewerFormat';
import ExifSheet from './ExifSheet';
import ProtectedImage from './ProtectedImage';
import ViewerVideoLayer from './ViewerVideoLayer';

function ViewerSlide(props: { asset: Asset; width: number; slideKey: string }) {
  const poster = () => api.getThumbnailUrl(props.asset.id, 'preview');

  return (
    <div class="vw-slide" data-slide={props.slideKey} style={{ width: `${props.width}px` }}>
      <Show
        when={props.asset.type === 'VIDEO'}
        fallback={
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

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        if (showInfo()) {
          setShowInfo(false);
        } else {
          closeViewer();
        }
        break;
      case 'ArrowLeft':
        carousel.step(-1, true);
        break;
      case 'ArrowRight':
        carousel.step(1, true);
        break;
      case 'i':
      case 'I':
        if (showMetadata()) setShowInfo((v) => !v);
        break;
    }
  }

  createEffect(() => {
    const asset = selectedAsset();
    if (!asset) return;
    captureEvent('asset_viewed', { asset_type: asset.type });
    setShowInfo(false);
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

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onCleanup(() => window.removeEventListener('keydown', handleKeydown));

  const w = () => carousel.stageWidth();
  const footSubtitle = () => formatViewerFootSubtitle(current());

  return (
    <div class="viewer" data-testid="asset-viewer" onClick={closeViewer}>
      <div class="vw-top" onClick={(e) => e.stopPropagation()}>
        <button type="button" class="vw-btn" aria-label="Close" onClick={closeViewer}>
          <X size={22} />
        </button>
        <div class="vw-count" data-testid="viewer-count">
          {index() + 1} / {list().length}
        </div>
        <div class="vw-top-actions">
          <Show when={showMetadata()}>
            <button
              type="button"
              class={`vw-btn ${showInfo() ? 'is-on' : ''}`}
              aria-label="Info"
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
                  aria-label="Download"
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
        </div>
      </div>

      <div class="vw-stage-wrap">
        <div
          class="vw-stage"
          ref={setStageEl}
          onPointerDown={carousel.onPointerDown}
          onPointerMove={carousel.onPointerMove}
          onPointerUp={carousel.onPointerUp}
          onPointerCancel={carousel.onPointerUp}
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
            <ViewerSlide asset={current()} width={w()} slideKey={current().id} />
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
          class={`vw-nav left ${carousel.hasPrev() ? '' : 'off'}`}
          aria-label="Previous"
          onClick={(e) => {
            e.stopPropagation();
            carousel.step(-1, true);
          }}
        >
          <ChevronLeft size={26} />
        </button>
        <button
          type="button"
          class={`vw-nav right ${carousel.hasNext() ? '' : 'off'}`}
          aria-label="Next"
          onClick={(e) => {
            e.stopPropagation();
            carousel.step(1, true);
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
