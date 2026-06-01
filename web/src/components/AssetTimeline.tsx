import { Check, Play } from 'lucide-solid';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { captureEvent } from '~/analytics';
import type { Asset } from '~/api/types';
import { formatDuration, groupAssetsByDate } from '~/utils/dateUtils';
import {
  assets,
  isAssetSelected,
  isDateFullySelected,
  isSelectionMode,
  selectAllFromDate,
  selectAsset,
  toggleAssetSelection,
} from '~/store/share';
import LazyThumbnail from './LazyThumbnail';
import TimelineScrubber from './TimelineScrubber';
import type { Accessor } from 'solid-js';

function isRotated90or270(orientation?: string): boolean {
  if (!orientation) return false;
  const rotatedValues = ['5', '6', '7', '8'];
  const rotatedStrings = ['90', '270'];

  if (rotatedValues.includes(orientation)) return true;
  return rotatedStrings.some((deg) => orientation.includes(deg));
}

function getAspectRatio(asset: Asset): number {
  const width = asset.exifInfo?.exifImageWidth;
  const height = asset.exifInfo?.exifImageHeight;
  const orientation = asset.exifInfo?.orientation;

  if (width && height && height > 0) {
    let aspectRatio = width / height;

    if (isRotated90or270(orientation)) {
      aspectRatio = height / width;
    }

    return Math.max(0.4, Math.min(2.5, aspectRatio));
  }

  return 1;
}

interface Props {
  scrollContainer?: Accessor<HTMLDivElement | undefined>;
}

export default function AssetTimeline(props: Props) {
  const groupedAssets = createMemo(() => groupAssetsByDate(assets()));

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

  return (
    <>
      <For each={groupedAssets()}>
        {(group) => (
          <div id={`group-${group.date}`} data-group-date={group.date} class="grp scroll-mt-2">
            <div class="grp-head">
              <Show when={isSelectionMode()}>
                <button
                  type="button"
                  class={`grp-sel ${isDateFullySelected(group.date) ? 'is-on' : ''}`}
                  aria-label={`Select all from ${group.label}`}
                  onClick={() => selectAllFromDate(group.date)}
                >
                  <Show when={isDateFullySelected(group.date)}>
                    <Check size={14} stroke-width={3} />
                  </Show>
                </button>
              </Show>
              <div class="grp-title">
                <span class="grp-date">{group.label}</span>
              </div>
            </div>

            <div class="just-rows">
              <div class={`gallery-wrap ${isSelectionMode() ? 'is-selecting' : ''}`}>
                <For each={group.assets}>
                  {(asset) => {
                    const selected = () => isAssetSelected(asset.id);
                    const aspectRatio = getAspectRatio(asset);

                    return (
                      <div
                        data-testid="gallery-item"
                        data-asset-type={asset.type}
                        class={`gallery-item ${selected() ? 'is-selected' : ''} ${isSelectionMode() ? 'is-selecting' : ''}`}
                        style={{ '--ratio': aspectRatio.toFixed(3) }}
                        onClick={(e) => handleAssetClick(asset, e)}
                        onTouchStart={() => handleTouchStartAsset(asset)}
                        onTouchEnd={handleTouchEndAsset}
                        onTouchCancel={handleTouchEndAsset}
                        role="button"
                        tabIndex={0}
                      >
                        <LazyThumbnail asset={asset} scrollContainer={props.scrollContainer} />
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
                  }}
                </For>
              </div>
            </div>
          </div>
        )}
      </For>

      <TimelineScrubber scrollContainer={props.scrollContainer} groupedAssets={groupedAssets} />
    </>
  );
}
