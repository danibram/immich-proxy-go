import { Calendar, Camera, ChevronLeft, ChevronRight, Download, Info, MapPin, X } from 'lucide-solid';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { captureEvent } from '~/analytics';
import { api } from '~/api/client';
import {
  allowDownload,
  assets,
  closeViewer,
  navigateAsset,
  selectedAsset,
  selectedAssetIndex,
  showMetadata,
} from '~/store/share';
import ProtectedImage from './ProtectedImage';

export default function AssetViewer() {
  const [showInfo, setShowInfo] = createSignal(false);
  const [imageLoaded, setImageLoaded] = createSignal(false);
  const [isTouchDevice, setIsTouchDevice] = createSignal(false);
  const [touchStartX, setTouchStartX] = createSignal(0);
  const [touchStartY, setTouchStartY] = createSignal(0);
  const [swipeOffset, setSwipeOffset] = createSignal(0);
  const [isSwiping, setIsSwiping] = createSignal(false);
  let videoRef: HTMLVideoElement | undefined;
  let contentRef: HTMLDivElement | undefined;

  const SWIPE_THRESHOLD = 50;

  createEffect(() => {
    const asset = selectedAsset();
    if (!asset) {
      return;
    }
    captureEvent('asset_viewed', { asset_type: asset.type });
  });

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        closeViewer();
        break;
      case 'ArrowLeft':
        navigateAsset('prev');
        break;
      case 'ArrowRight':
        navigateAsset('next');
        break;
      case 'i':
        setShowInfo(!showInfo());
        break;
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      closeViewer();
    }
  }

  // Touch handlers for swipe navigation
  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      setTouchStartX(e.touches[0].clientX);
      setTouchStartY(e.touches[0].clientY);
      setIsSwiping(false);
      setSwipeOffset(0);
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (e.touches.length !== 1) return;

    const deltaX = e.touches[0].clientX - touchStartX();
    const deltaY = e.touches[0].clientY - touchStartY();

    // Only consider horizontal swipes
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      setIsSwiping(true);
      setSwipeOffset(deltaX);
      e.preventDefault();
    }
  }

  function handleTouchEnd() {
    if (isSwiping()) {
      const offset = swipeOffset();
      if (Math.abs(offset) > SWIPE_THRESHOLD) {
        if (offset > 0) {
          navigateAsset('prev');
        } else {
          navigateAsset('next');
        }
      }
    }
    setIsSwiping(false);
    setSwipeOffset(0);
  }

  function formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatDate(dateStr?: string): string {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    setImageLoaded(false);
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeydown);
  });

  const asset = () => selectedAsset()!;

  return (
    <div
      class="fixed inset-0 bg-black/95 flex items-center justify-center z-50 animate-fadeIn"
      onClick={handleBackdropClick}
    >
      {/* Top controls */}
      <div class="absolute top-0 left-0 right-0 p-3 sm:p-4 flex justify-between items-start z-20 bg-gradient-to-b from-black/60 to-transparent">
        {/* Counter */}
        <div class="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl glass text-white/80 text-xs sm:text-sm font-medium">
          {selectedAssetIndex() + 1} / {assets().length}
        </div>

        {/* Action buttons */}
        <div class="flex gap-1.5 sm:gap-2">
          <Show when={showMetadata()}>
            <button
              class={`p-2.5 sm:p-3 rounded-lg sm:rounded-xl transition-all duration-200 ${showInfo()
                ? 'bg-blue-slate text-white'
                : 'glass hover:bg-white/10 text-white/80 hover:text-white'
                }`}
              onClick={() => setShowInfo(!showInfo())}
              title="Toggle info (i)"
            >
              <Info class="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </Show>

          <Show when={allowDownload()}>
            <a
              href={api.getOriginalUrl(asset().id)}
              download={asset().originalFileName}
              class="p-2.5 sm:p-3 rounded-lg sm:rounded-xl glass hover:bg-white/10 text-white/80 hover:text-white transition-all duration-200"
              title="Download"
            >
              <Download class="w-4 h-4 sm:w-5 sm:h-5" />
            </a>
          </Show>

          <button
            class="p-2.5 sm:p-3 rounded-lg sm:rounded-xl glass hover:bg-white/10 text-white/80 hover:text-white transition-all duration-200"
            onClick={closeViewer}
            title="Close (Esc)"
          >
            <X class="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </div>

      {/* Navigation arrows - hidden on touch devices */}
      <Show when={assets().length > 1 && !isTouchDevice()}>
        <button
          class="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-2xl glass hover:bg-white/10 text-white/60 hover:text-white transition-all duration-200 z-10 hidden sm:block"
          onClick={() => navigateAsset('prev')}
          title="Previous (←)"
        >
          <ChevronLeft class="w-8 h-8" />
        </button>

        <button
          class="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-2xl glass hover:bg-white/10 text-white/60 hover:text-white transition-all duration-200 z-10 hidden sm:block"
          onClick={() => navigateAsset('next')}
          title="Next (→)"
        >
          <ChevronRight class="w-8 h-8" />
        </button>
      </Show>

      {/* Content - with swipe support */}
      <div
        ref={contentRef}
        class="flex w-full h-full max-w-[95vw] max-h-[90vh] pt-16 sm:pt-0"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: isSwiping() ? `translateX(${swipeOffset()}px)` : 'translateX(0)',
          transition: isSwiping() ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        <div class="flex-1 flex items-center justify-center p-2 sm:p-4">
          <Show
            when={asset().type === 'VIDEO'}
            fallback={
              <div class="relative">
                {/* Loading placeholder */}
                <Show when={!imageLoaded()}>
                  <div class="absolute inset-0 flex items-center justify-center">
                    <div class="w-10 h-10 border-3 border-white/20 border-t-white rounded-full animate-spin" />
                  </div>
                </Show>
                {/* Use canvas when downloads disabled to prevent easy saving */}
                <Show
                  when={allowDownload()}
                  fallback={
                    <ProtectedImage
                      src={api.getThumbnailUrl(asset().id, 'preview')}
                      alt={asset().originalFileName}
                      class="max-h-[80vh] sm:max-h-[85vh] rounded-lg select-none"
                      onLoad={() => setImageLoaded(true)}
                    />
                  }
                >
                  <img
                    src={api.getThumbnailUrl(asset().id, 'preview')}
                    alt={asset().originalFileName}
                    class={`max-h-[80vh] sm:max-h-[85vh] max-w-full object-contain rounded-lg transition-opacity duration-300 select-none ${imageLoaded() ? 'opacity-100' : 'opacity-0'
                      }`}
                    onLoad={() => setImageLoaded(true)}
                    draggable={false}
                  />
                </Show>
              </div>
            }
          >
            <video
              ref={videoRef}
              src={api.getVideoUrl(asset().id)}
              controls
              autoplay
              playsinline
              class="max-h-[80vh] sm:max-h-[85vh] max-w-full rounded-lg"
              poster={api.getThumbnailUrl(asset().id, 'preview')}
            >
              Your browser does not support the video tag.
            </video>
          </Show>
        </div>

        {/* Info sidebar - slides up from bottom on mobile */}
        <Show when={showInfo() && showMetadata()}>
          <div class="hidden sm:block w-80 glass rounded-2xl p-6 m-4 overflow-y-auto animate-slideUp">
            <InfoContent asset={asset} formatDate={formatDate} formatFileSize={formatFileSize} />
          </div>
        </Show>
      </div>

      {/* Mobile info panel - bottom sheet */}
      <Show when={showInfo() && showMetadata() && isTouchDevice()}>
        <div class="sm:hidden fixed bottom-0 left-0 right-0 max-h-[60vh] glass rounded-t-3xl p-4 overflow-y-auto animate-slideUp z-30">
          <div class="w-12 h-1 bg-white/20 rounded-full mx-auto mb-4" />
          <InfoContent asset={asset} formatDate={formatDate} formatFileSize={formatFileSize} />
        </div>
      </Show>

      {/* Swipe hint on first view for touch devices */}
      <Show when={isTouchDevice() && assets().length > 1}>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/30 text-xs flex items-center gap-2 sm:hidden">
          <ChevronLeft class="w-4 h-4" />
          <span>Swipe to navigate</span>
          <ChevronRight class="w-4 h-4" />
        </div>
      </Show>
    </div>
  );
}

// Extracted info content for reuse
function InfoContent(props: {
  asset: () => any;
  formatDate: (d?: string) => string;
  formatFileSize: (b?: number) => string;
}) {
  return (
    <>
      <h3 class="text-lg font-semibold text-white mb-1 truncate" title={props.asset().originalFileName}>
        {props.asset().originalFileName}
      </h3>
      <p class="text-sm text-white/40 mb-6">
        {props.asset().type === 'VIDEO' ? 'Video' : 'Photo'}
      </p>

      <div class="space-y-5">
        <Show when={props.asset().exifInfo?.dateTimeOriginal || props.asset().fileCreatedAt}>
          <div class="flex items-start gap-3">
            <div class="p-2 rounded-lg bg-white/5">
              <Calendar class="w-4 h-4 text-white/60" />
            </div>
            <div>
              <div class="text-xs text-white/40 uppercase tracking-wider mb-1">Date</div>
              <div class="text-sm text-white/90">
                {props.formatDate(props.asset().exifInfo?.dateTimeOriginal || props.asset().fileCreatedAt)}
              </div>
            </div>
          </div>
        </Show>

        <Show when={props.asset().exifInfo?.make || props.asset().exifInfo?.model}>
          <div class="flex items-start gap-3">
            <div class="p-2 rounded-lg bg-white/5">
              <Camera class="w-4 h-4 text-white/60" />
            </div>
            <div>
              <div class="text-xs text-white/40 uppercase tracking-wider mb-1">Camera</div>
              <div class="text-sm text-white/90">
                {[props.asset().exifInfo?.make, props.asset().exifInfo?.model].filter(Boolean).join(' ')}
              </div>
              <Show when={props.asset().exifInfo?.lensModel}>
                <div class="text-xs text-white/50 mt-1">{props.asset().exifInfo?.lensModel}</div>
              </Show>
            </div>
          </div>
        </Show>

        <Show
          when={
            props.asset().exifInfo?.fNumber ||
            props.asset().exifInfo?.exposureTime ||
            props.asset().exifInfo?.iso
          }
        >
          <div class="p-3 rounded-xl bg-white/5">
            <div class="text-xs text-white/40 uppercase tracking-wider mb-2">Settings</div>
            <div class="flex flex-wrap gap-2">
              <Show when={props.asset().exifInfo?.fNumber}>
                <span class="px-2 py-1 rounded-lg bg-white/5 text-xs text-white/80">
                  f/{props.asset().exifInfo?.fNumber}
                </span>
              </Show>
              <Show when={props.asset().exifInfo?.exposureTime}>
                <span class="px-2 py-1 rounded-lg bg-white/5 text-xs text-white/80">
                  {props.asset().exifInfo?.exposureTime}
                </span>
              </Show>
              <Show when={props.asset().exifInfo?.iso}>
                <span class="px-2 py-1 rounded-lg bg-white/5 text-xs text-white/80">
                  ISO {props.asset().exifInfo?.iso}
                </span>
              </Show>
              <Show when={props.asset().exifInfo?.focalLength}>
                <span class="px-2 py-1 rounded-lg bg-white/5 text-xs text-white/80">
                  {props.asset().exifInfo?.focalLength}mm
                </span>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={props.asset().exifInfo?.city || props.asset().exifInfo?.country}>
          <div class="flex items-start gap-3">
            <div class="p-2 rounded-lg bg-white/5">
              <MapPin class="w-4 h-4 text-white/60" />
            </div>
            <div>
              <div class="text-xs text-white/40 uppercase tracking-wider mb-1">Location</div>
              <div class="text-sm text-white/90">
                {[
                  props.asset().exifInfo?.city,
                  props.asset().exifInfo?.state,
                  props.asset().exifInfo?.country,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </div>
            </div>
          </div>
        </Show>

        <div class="pt-4 border-t border-white/10">
          <div class="grid grid-cols-2 gap-4 text-sm">
            <Show when={props.asset().exifInfo?.exifImageWidth && props.asset().exifInfo?.exifImageHeight}>
              <div>
                <div class="text-xs text-white/40 mb-1">Dimensions</div>
                <div class="text-white/80">
                  {props.asset().exifInfo?.exifImageWidth} × {props.asset().exifInfo?.exifImageHeight}
                </div>
              </div>
            </Show>
            <Show when={props.asset().exifInfo?.fileSizeInByte}>
              <div>
                <div class="text-xs text-white/40 mb-1">Size</div>
                <div class="text-white/80">{props.formatFileSize(props.asset().exifInfo?.fileSizeInByte)}</div>
              </div>
            </Show>
          </div>
        </div>

        <Show when={props.asset().exifInfo?.description}>
          <div class="pt-4 border-t border-white/10">
            <div class="text-xs text-white/40 uppercase tracking-wider mb-2">Description</div>
            <p class="text-sm text-white/80">{props.asset().exifInfo?.description}</p>
          </div>
        </Show>
      </div>
    </>
  );
}
