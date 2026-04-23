import { Check, Play } from 'lucide-solid';
import { batch, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { api } from '~/api/client';
import type { Asset } from '~/api/types';
import {
  assets,
  isAssetSelected,
  isDateFullySelected,
  isSelectionMode,
  selectAllFromDate,
  selectAsset,
  toggleAssetSelection
} from '~/store/share';

interface DateGroup {
  date: string;
  label: string;
  scrubberLabel: string;
  year: number;
  month: number;
  day: number;
  assets: Asset[];
}

// Check if orientation indicates the image/video is rotated 90° or 270°
function isRotated90or270(orientation?: string): boolean {
  if (!orientation) return false;
  // EXIF orientation values that indicate 90° or 270° rotation:
  // 5, 6, 7, 8 or strings like "Rotate 90 CW", "Rotate 270 CW", etc.
  const rotatedValues = ['5', '6', '7', '8'];
  const rotatedStrings = ['90', '270'];

  if (rotatedValues.includes(orientation)) return true;
  return rotatedStrings.some(deg => orientation.includes(deg));
}

// Get aspect ratio from asset, defaulting to 1 (square) if dimensions not available
function getAspectRatio(asset: Asset): number {
  const width = asset.exifInfo?.exifImageWidth;
  const height = asset.exifInfo?.exifImageHeight;
  const orientation = asset.exifInfo?.orientation;

  if (width && height && height > 0) {
    let aspectRatio = width / height;

    // If rotated 90° or 270°, swap width and height
    if (isRotated90or270(orientation)) {
      aspectRatio = height / width;
    }

    // Clamp aspect ratio to reasonable bounds (0.4 to 2.5)
    return Math.max(0.4, Math.min(2.5, aspectRatio));
  }

  // Default: square (works reasonably for both orientations)
  return 1;
}

export default function AssetTimeline() {
  let containerRef: HTMLDivElement | undefined;
  let scrubberRef: HTMLDivElement | undefined;
  let scrollThrottleId: number | null = null;
  let scrollTimeoutId: number | null = null;

  const [isDragging, setIsDragging] = createSignal(false);
  const [isHovering, setIsHovering] = createSignal(false);
  const [isScrolling, setIsScrolling] = createSignal(false);
  const [hoverLabel, setHoverLabel] = createSignal<string | null>(null);
  const [currentLabel, setCurrentLabel] = createSignal<string | null>(null);
  const [scrubberY, setScrubberY] = createSignal(0);
  const [hoverY, setHoverY] = createSignal(0);
  const [isTouchDevice, setIsTouchDevice] = createSignal(false);

  const PADDING_TOP = 24;
  const PADDING_BOTTOM = 24;

  // Group assets by date
  const groupedAssets = createMemo(() => {
    const assetList = assets();
    const groups = new Map<string, Asset[]>();

    for (const asset of assetList) {
      const date = new Date(asset.fileCreatedAt || asset.localDateTime);
      const dateKey = date.toISOString().split('T')[0];

      if (!groups.has(dateKey)) {
        groups.set(dateKey, []);
      }
      groups.get(dateKey)!.push(asset);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, groupAssets]) => {
        const date = new Date(dateKey);
        return {
          date: dateKey,
          label: formatDateLabel(date),
          scrubberLabel: formatScrubberLabel(date),
          year: date.getFullYear(),
          month: date.getMonth(),
          day: date.getDate(),
          assets: groupAssets.sort(
            (a, b) => new Date(b.fileCreatedAt).getTime() - new Date(a.fileCreatedAt).getTime()
          ),
        };
      });
  });

  // Get unique years
  const scrubberYears = createMemo(() => {
    const years = new Set<number>();
    for (const group of groupedAssets()) {
      years.add(group.year);
    }
    return Array.from(years).sort((a, b) => b - a);
  });

  function formatDateLabel(date: Date): string {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  }

  function formatScrubberLabel(date: Date): string {
    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function handleAssetClick(asset: Asset, e: MouseEvent) {
    // If in selection mode, toggle selection instead of opening viewer
    if (isSelectionMode()) {
      e.preventDefault();
      toggleAssetSelection(asset.id);
      return;
    }

    const index = assets().findIndex((a) => a.id === asset.id);
    selectAsset(asset, index);
  }

  function handleAssetLongPress(asset: Asset) {
    // Start selection mode on long press
    toggleAssetSelection(asset.id);
  }

  function formatDuration(duration: string): string {
    if (!duration || duration === '0:00:00.000000' || duration === '00:00:00.00000') return '';

    const parts = duration.split(':');
    if (parts.length >= 2) {
      const hours = parseInt(parts[0]);
      const minutes = parseInt(parts[1]);
      const seconds = Math.floor(parseFloat(parts[2] || '0'));

      if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    return '';
  }

  // Throttled scroll handler
  function handleScroll() {
    if (isDragging()) return;

    setIsScrolling(true);

    if (scrollTimeoutId !== null) {
      clearTimeout(scrollTimeoutId);
    }

    scrollTimeoutId = window.setTimeout(() => {
      setIsScrolling(false);
    }, 1000);

    if (scrollThrottleId !== null) return;

    scrollThrottleId = requestAnimationFrame(() => {
      scrollThrottleId = null;
      updateScrollPosition();
    });
  }

  function updateScrollPosition() {
    if (!containerRef || !scrubberRef) return;

    const groups = containerRef.querySelectorAll('[data-group-date]');
    let visibleGroup: Element | null = null;
    let lastGroup: Element | null = null;
    const containerTop = containerRef.getBoundingClientRect().top;

    for (const group of groups) {
      const rect = group.getBoundingClientRect();
      lastGroup = group;
      if (rect.top <= containerTop + 150) {
        visibleGroup = group;
      }
    }

    const scrolledToBottom =
      containerRef.scrollTop + containerRef.clientHeight >= containerRef.scrollHeight - 100;
    if (scrolledToBottom && lastGroup) {
      visibleGroup = lastGroup;
    }

    if (visibleGroup) {
      const date = visibleGroup.getAttribute('data-group-date');
      const groupIndex = groupedAssets().findIndex((g) => g.date === date);
      const group = groupedAssets()[groupIndex];

      if (group) {
        const totalGroups = groupedAssets().length;
        const ratio = totalGroups > 1 ? groupIndex / (totalGroups - 1) : 0;
        const scrubberHeight = scrubberRef.clientHeight - PADDING_TOP - PADDING_BOTTOM;

        batch(() => {
          setCurrentLabel(group.scrubberLabel);
          setScrubberY(Math.min(ratio * scrubberHeight, scrubberHeight));
        });
      }
    }
  }

  // Scrubber position update
  function updateScrubberPosition(clientY: number, isDrag: boolean) {
    if (!scrubberRef) return;

    const rect = scrubberRef.getBoundingClientRect();
    const availableHeight = rect.height - PADDING_TOP - PADDING_BOTTOM;
    const y = Math.max(0, Math.min(clientY - rect.top - PADDING_TOP, availableHeight));
    const ratio = availableHeight > 0 ? y / availableHeight : 0;

    const totalGroups = groupedAssets().length;
    const groupIndex = Math.min(Math.floor(ratio * totalGroups), totalGroups - 1);
    const group = groupedAssets()[groupIndex];

    if (group) {
      batch(() => {
        setHoverY(y);
        setHoverLabel(group.scrubberLabel);

        if (isDrag) {
          setScrubberY(y);
          setCurrentLabel(group.scrubberLabel);
        }
      });

      if (isDrag && containerRef) {
        const element = document.getElementById(`group-${group.date}`);
        if (element) {
          const containerRect = containerRef.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const offset = elementRect.top - containerRect.top + containerRef.scrollTop;
          containerRef.scrollTop = offset;
        }
      }
    }
  }

  // Mouse events
  function handleScrubberMouseDown(e: MouseEvent) {
    e.preventDefault();
    setIsDragging(true);
    updateScrubberPosition(e.clientY, true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    updateScrubberPosition(e.clientY, true);
  }

  function handleMouseUp() {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }

  function handleScrubberHover(e: MouseEvent) {
    if (!isDragging()) {
      updateScrubberPosition(e.clientY, false);
    }
  }

  // Touch events
  function handleTouchStart(e: TouchEvent) {
    e.preventDefault();
    setIsTouchDevice(true);
    setIsDragging(true);
    setIsHovering(true);
    if (e.touches[0]) {
      updateScrubberPosition(e.touches[0].clientY, true);
    }
  }

  function handleTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (e.touches[0]) {
      updateScrubberPosition(e.touches[0].clientY, true);
    }
  }

  function handleTouchEnd() {
    batch(() => {
      setIsDragging(false);
      setIsHovering(false);
      setHoverLabel(null);
    });
  }

  function handleScrubberEnter() {
    if (!isTouchDevice()) setIsHovering(true);
  }

  function handleScrubberLeave() {
    if (!isTouchDevice()) {
      setIsHovering(false);
      if (!isDragging()) setHoverLabel(null);
    }
  }

  // Long press detection for touch devices
  let longPressTimer: number | null = null;
  let longPressAsset: Asset | null = null;

  function handleTouchStartAsset(asset: Asset, e: TouchEvent) {
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

  onMount(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    setTimeout(updateScrollPosition, 100);
  });

  onCleanup(() => {
    if (scrollThrottleId !== null) cancelAnimationFrame(scrollThrottleId);
    if (scrollTimeoutId !== null) clearTimeout(scrollTimeoutId);
    if (longPressTimer !== null) clearTimeout(longPressTimer);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  });

  const showIndicator = () => isScrolling() || isHovering() || isDragging();

  return (
    <div class="flex h-full relative">
      {/* Main content */}
      <div
        class="flex-1 overflow-y-auto overflow-x-hidden pr-16 pb-16 scrollbar-hide"
        ref={containerRef}
        onScroll={handleScroll}
      >
        <For each={groupedAssets()}>
          {(group) => (
            <div id={`group-${group.date}`} data-group-date={group.date} class="mb-6 scroll-mt-2">
              {/* Date header with select all checkbox */}
              <div class="sticky top-0 bg-[#0a0a0a] py-2 z-10 mb-2">
                <div class="flex items-center gap-3">
                  {/* Select all for this date */}
                  <Show when={isSelectionMode()}>
                    <button
                      class={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isDateFullySelected(group.date)
                        ? 'bg-immich-primary border-immich-primary'
                        : 'border-white/30 hover:border-white/50'
                        }`}
                      onClick={() => selectAllFromDate(group.date)}
                    >
                      <Show when={isDateFullySelected(group.date)}>
                        <Check class="w-4 h-4 text-white" />
                      </Show>
                    </button>
                  </Show>
                  <h3 class="text-sm font-semibold text-white/80">{group.label}</h3>
                </div>
              </div>

              {/* Justified gallery */}
              <div class="gallery-wrap">
                <For each={group.assets}>
                  {(asset) => {
                    const selected = () => isAssetSelected(asset.id);
                    const aspectRatio = getAspectRatio(asset);

                    return (
                      <div
                        class="gallery-item group"
                        style={{ '--ratio': aspectRatio.toFixed(3) }}
                        onClick={(e) => handleAssetClick(asset, e)}
                        onTouchStart={(e) => handleTouchStartAsset(asset, e)}
                        onTouchEnd={handleTouchEndAsset}
                        onTouchCancel={handleTouchEndAsset}
                        role="button"
                        tabIndex={0}
                      >
                        {/* Image */}
                        <img
                          src={api.getThumbnailUrl(asset.id, 'preview')}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          class={`transition-transform duration-200 ${selected() ? 'scale-[0.92]' : 'group-hover:scale-[1.02]'}`}
                        />

                        {/* Selection overlay */}
                        <div
                          class={`absolute inset-0 transition-all duration-200 pointer-events-none ${selected() ? 'bg-white/20 ring-4 ring-inset ring-immich-primary' : ''
                            }`}
                        />

                        {/* Video indicator */}
                        <Show when={asset.type === 'VIDEO'}>
                          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div class="w-10 h-10 sm:w-12 sm:h-12 bg-black/50 rounded-full flex items-center justify-center backdrop-blur-sm">
                              <Play class="w-5 h-5 sm:w-6 sm:h-6 text-white ml-0.5" fill="white" />
                            </div>
                          </div>

                          <Show when={asset.duration && formatDuration(asset.duration)}>
                            <div class="absolute bottom-1 right-1 sm:bottom-2 sm:right-2 bg-black/60 text-white text-[10px] sm:text-xs font-medium px-1.5 py-0.5 rounded backdrop-blur-sm">
                              {formatDuration(asset.duration)}
                            </div>
                          </Show>
                        </Show>

                        {/* Selection checkbox */}
                        <Show when={isSelectionMode() || selected()}>
                          <div
                            class={`absolute top-1.5 left-1.5 sm:top-2 sm:left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all z-10 ${selected()
                                ? 'bg-immich-primary border-immich-primary'
                                : 'border-white bg-black/40 hover:bg-black/60'
                              }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleAssetSelection(asset.id);
                            }}
                          >
                            <Show when={selected()}>
                              <Check class="w-4 h-4 text-white" />
                            </Show>
                          </div>
                        </Show>

                        {/* Hover gradient (bottom) */}
                        <div class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Scrubber */}
      <Show when={groupedAssets().length > 1}>
        <div
          ref={scrubberRef}
          class="absolute right-0 top-0 bottom-0 w-16 cursor-pointer select-none z-30 touch-none"
          onMouseDown={handleScrubberMouseDown}
          onMouseEnter={handleScrubberEnter}
          onMouseLeave={handleScrubberLeave}
          onMouseMove={handleScrubberHover}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Scroll indicator */}
          <Show when={isScrolling() && !isHovering() && !isDragging()}>
            <div
              class="absolute right-0 flex items-center pointer-events-none"
              style={{ top: `${PADDING_TOP + scrubberY()}px`, transform: 'translateY(-50%)' }}
            >
              <div class="px-2 py-0.5 bg-gray-700 text-white text-xs font-medium rounded mr-1">
                {currentLabel()}
              </div>
              <div class="w-8 h-[4px] bg-gray-500 rounded-full" />
            </div>
          </Show>

          {/* Hover/drag indicator */}
          <Show when={isHovering() || isDragging()}>
            <div
              class="absolute right-0 flex items-center pointer-events-none"
              style={{ top: `${PADDING_TOP + hoverY()}px`, transform: 'translateY(-50%)' }}
            >
              <div class="px-2 py-0.5 bg-immich-primary text-white text-xs font-medium rounded mr-1">
                {hoverLabel()}
              </div>
              <div class="w-10 h-[4px] bg-immich-primary rounded-full" />
            </div>
          </Show>

          {/* Year labels */}
          <div
            class="absolute right-1 flex flex-col justify-between pointer-events-none"
            style={{ top: `${PADDING_TOP}px`, bottom: `${PADDING_BOTTOM}px` }}
          >
            <For each={scrubberYears()}>
              {(year, index) => (
                <div class="flex flex-col items-end">
                  <span class="text-xs text-white/40 font-medium">{year}</span>
                  <Show when={index() < scrubberYears().length - 1}>
                    <div class="w-1 h-1 rounded-full bg-white/20 mt-2" />
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
