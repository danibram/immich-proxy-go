import { createMemo, createSignal } from 'solid-js';
import type { Asset, SharedLink } from '~/api/types';
import { getAssetDateKey } from '~/utils/dateUtils';

// Shared link data
export const [sharedLink, setSharedLink] = createSignal<SharedLink | null>(null);

// Loading state
export const [isLoading, setIsLoading] = createSignal(true);

// Error state
export const [error, setError] = createSignal<string | null>(null);

// Password required state
export const [passwordRequired, setPasswordRequired] = createSignal(false);

// Selected asset for viewer
export const [selectedAsset, setSelectedAsset] = createSignal<Asset | null>(null);
export const [selectedAssetIndex, setSelectedAssetIndex] = createSignal<number>(-1);

// Upload state
export const [isUploading, setIsUploading] = createSignal(false);

// Selection state
export const [isSelectionMode, setIsSelectionMode] = createSignal(false);
export const [selectedAssets, setSelectedAssets] = createSignal<Set<string>>(new Set());

// Derived values
export const assets = createMemo(() => {
  const link = sharedLink();
  if (!link) return [];

  if (link.type === 'ALBUM' && link.album) {
    return link.album.assets || [];
  }

  return link.assets || [];
});

export const albumName = createMemo(() => {
  const link = sharedLink();
  if (!link) return '';

  if (link.type === 'ALBUM' && link.album) {
    return link.album.albumName;
  }

  return 'Shared Album';
});

export const allowUpload = createMemo(() => {
  return sharedLink()?.allowUpload ?? false;
});

export const allowDownload = createMemo(() => {
  return sharedLink()?.allowDownload ?? false;
});

export const showMetadata = createMemo(() => {
  return sharedLink()?.showMetadata ?? false;
});

export const shareCapabilities = createMemo(() => {
  const count = assets().length;
  return {
    canDownload: allowDownload() && count > 0,
    canSelect: count > 0,
    canUpload: allowUpload(),
    canShowMetadata: showMetadata(),
    hasAssets: count > 0,
    assetCount: count,
  };
});

export const selectedCount = createMemo(() => {
  return selectedAssets().size;
});

// Actions
export function selectAsset(asset: Asset, index: number) {
  setSelectedAsset(asset);
  setSelectedAssetIndex(index);
}

export function closeViewer() {
  setSelectedAsset(null);
  setSelectedAssetIndex(-1);
}

export function setLoadedSharedLink(link: SharedLink) {
  setSharedLink(link);
  closeViewer();
  setSelectedAssets(new Set());
  setIsSelectionMode(false);
}

export function toggleAssetSelection(assetId: string) {
  const current = selectedAssets();
  const newSet = new Set(current);

  if (newSet.has(assetId)) {
    newSet.delete(assetId);
  } else {
    newSet.add(assetId);
  }

  setSelectedAssets(newSet);

  // Auto-enable selection mode if selecting
  if (newSet.size > 0 && !isSelectionMode()) {
    setIsSelectionMode(true);
  }
}

export function selectAllFromDate(date: string) {
  const assetList = assets();
  const current = selectedAssets();
  const newSet = new Set(current);

  const dateAssets = assetList.filter((asset) => getAssetDateKey(asset) === date);

  // Check if all are already selected
  const allSelected = dateAssets.every(a => newSet.has(a.id));

  if (allSelected) {
    // Deselect all from this date
    dateAssets.forEach(a => newSet.delete(a.id));
  } else {
    // Select all from this date
    dateAssets.forEach(a => newSet.add(a.id));
  }

  setSelectedAssets(newSet);

  if (newSet.size > 0 && !isSelectionMode()) {
    setIsSelectionMode(true);
  }
}

export function selectAll() {
  const assetList = assets();
  const newSet = new Set(assetList.map(a => a.id));
  setSelectedAssets(newSet);
  setIsSelectionMode(true);
}

export function clearSelection() {
  setSelectedAssets(new Set());
}

export function getSelectedAssets(): Asset[] {
  const selected = selectedAssets();
  return assets().filter(a => selected.has(a.id));
}

export function isAssetSelected(assetId: string): boolean {
  return selectedAssets().has(assetId);
}

export function isDateFullySelected(date: string): boolean {
  const assetList = assets();
  const selected = selectedAssets();

  const dateAssets = assetList.filter((asset) => getAssetDateKey(asset) === date);

  return dateAssets.length > 0 && dateAssets.every(a => selected.has(a.id));
}
