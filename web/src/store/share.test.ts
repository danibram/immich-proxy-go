import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Asset, SharedLink } from '~/api/types';
import {
  albumName,
  assets,
  clearSelection,
  getSelectedAssets,
  isAssetSelected,
  isDateFullySelected,
  isSelectionMode,
  selectAll,
  selectAllFromDate,
  selectAsset,
  selectedCount,
  selectedAsset,
  setIsSelectionMode,
  setLoadedSharedLink,
  setSelectedAssets,
  setSharedLink,
  sharedLink,
  toggleAssetSelection
} from './share';

describe('Share Store', () => {
  // Reset state before each test
  beforeEach(() => {
    setSharedLink(null);
    setSelectedAssets(new Set());
    setIsSelectionMode(false);
  });

  describe('sharedLink state', () => {
    it('should be null initially', () => {
      createRoot((dispose) => {
        expect(sharedLink()).toBeNull();
        dispose();
      });
    });

    it('should update when setSharedLink is called', () => {
      createRoot((dispose) => {
        const mockLink: SharedLink = {
          id: 'link-123',
          key: 'test-key',
          type: 'ALBUM',
          allowDownload: true,
          allowUpload: false,
          showMetadata: true,
          album: {
            id: 'album-123',
            albumName: 'Test Album',
            assets: [],
            assetCount: 0,
          },
          assets: [],
        };

        setSharedLink(mockLink);
        expect(sharedLink()).toEqual(mockLink);
        dispose();
      });
    });

    it('resets transient viewer and selection state when a loaded link is installed', () => {
      createRoot((dispose) => {
        const firstAsset = {
          id: 'asset-1',
          type: 'IMAGE',
          originalFileName: 'photo1.jpg',
          fileCreatedAt: '2024-01-15T10:00:00.000Z',
        } as Asset;
        const nextLink: SharedLink = {
          id: 'link-456',
          key: 'next-key',
          type: 'ALBUM',
          allowDownload: true,
          allowUpload: false,
          showMetadata: true,
          album: {
            id: 'album-456',
            albumName: 'Next Album',
            assets: [],
            assetCount: 0,
          },
          assets: [],
        };

        setSharedLink({
          id: 'link-123',
          key: 'test-key',
          type: 'ALBUM',
          allowDownload: true,
          allowUpload: false,
          showMetadata: true,
          album: {
            id: 'album-123',
            albumName: 'Test Album',
            assets: [firstAsset],
            assetCount: 1,
          },
          assets: [],
        });
        selectAsset(firstAsset, 0);
        toggleAssetSelection(firstAsset.id);

        setLoadedSharedLink(nextLink);

        expect(sharedLink()).toEqual(nextLink);
        expect(selectedAsset()).toBeNull();
        expect(selectedCount()).toBe(0);
        expect(isSelectionMode()).toBe(false);
        dispose();
      });
    });
  });

  describe('derived assets', () => {
    it('should return empty array when no shared link', () => {
      createRoot((dispose) => {
        expect(assets()).toEqual([]);
        dispose();
      });
    });

    it('should return assets from album for ALBUM type', () => {
      createRoot((dispose) => {
        const mockAssets: Asset[] = [
          { id: 'asset-1', type: 'IMAGE', originalFileName: 'photo1.jpg', fileCreatedAt: '2024-01-15' },
          { id: 'asset-2', type: 'VIDEO', originalFileName: 'video1.mp4', fileCreatedAt: '2024-01-15' },
        ];

        setSharedLink({
          id: 'link-123',
          key: 'test-key',
          type: 'ALBUM',
          allowDownload: true,
          allowUpload: false,
          showMetadata: true,
          album: {
            id: 'album-123',
            albumName: 'Test Album',
            assets: mockAssets,
            assetCount: 2,
          },
          assets: [],
        });

        expect(assets()).toEqual(mockAssets);
        expect(assets().length).toBe(2);
        dispose();
      });
    });

    it('should return assets from shared link for INDIVIDUAL type', () => {
      createRoot((dispose) => {
        const mockAssets: Asset[] = [
          { id: 'asset-1', type: 'IMAGE', originalFileName: 'photo1.jpg', fileCreatedAt: '2024-01-15' },
        ];

        setSharedLink({
          id: 'link-123',
          key: 'test-key',
          type: 'INDIVIDUAL',
          allowDownload: true,
          allowUpload: false,
          showMetadata: true,
          assets: mockAssets,
        });

        expect(assets()).toEqual(mockAssets);
        dispose();
      });
    });
  });

  describe('albumName', () => {
    it('should return empty string when no shared link', () => {
      createRoot((dispose) => {
        expect(albumName()).toBe('');
        dispose();
      });
    });

    it('should return album name for ALBUM type', () => {
      createRoot((dispose) => {
        setSharedLink({
          id: 'link-123',
          key: 'test-key',
          type: 'ALBUM',
          allowDownload: true,
          allowUpload: false,
          showMetadata: true,
          album: {
            id: 'album-123',
            albumName: 'My Vacation Photos',
            assets: [],
            assetCount: 0,
          },
          assets: [],
        });

        expect(albumName()).toBe('My Vacation Photos');
        dispose();
      });
    });

    it('should return "Shared Album" for non-album types', () => {
      createRoot((dispose) => {
        setSharedLink({
          id: 'link-123',
          key: 'test-key',
          type: 'INDIVIDUAL',
          allowDownload: true,
          allowUpload: false,
          showMetadata: true,
          assets: [],
        });

        expect(albumName()).toBe('Shared Album');
        dispose();
      });
    });
  });

  describe('selection functionality', () => {
    const mockAssets: Asset[] = [
      { id: 'asset-1', type: 'IMAGE', originalFileName: 'photo1.jpg', fileCreatedAt: '2024-01-15T10:00:00.000Z' },
      { id: 'asset-2', type: 'IMAGE', originalFileName: 'photo2.jpg', fileCreatedAt: '2024-01-15T11:00:00.000Z' },
      { id: 'asset-3', type: 'IMAGE', originalFileName: 'photo3.jpg', fileCreatedAt: '2024-01-16T10:00:00.000Z' },
    ];

    beforeEach(() => {
      setSharedLink({
        id: 'link-123',
        key: 'test-key',
        type: 'ALBUM',
        allowDownload: true,
        allowUpload: false,
        showMetadata: true,
        album: {
          id: 'album-123',
          albumName: 'Test Album',
          assets: mockAssets,
          assetCount: 3,
        },
        assets: [],
      });
    });

    it('should toggle asset selection', () => {
      createRoot((dispose) => {
        expect(isAssetSelected('asset-1')).toBe(false);

        toggleAssetSelection('asset-1');
        expect(isAssetSelected('asset-1')).toBe(true);
        expect(selectedCount()).toBe(1);

        toggleAssetSelection('asset-1');
        expect(isAssetSelected('asset-1')).toBe(false);
        expect(selectedCount()).toBe(0);
        dispose();
      });
    });

    it('should enable selection mode when selecting', () => {
      createRoot((dispose) => {
        expect(isSelectionMode()).toBe(false);

        toggleAssetSelection('asset-1');
        expect(isSelectionMode()).toBe(true);
        dispose();
      });
    });

    it('should select all assets', () => {
      createRoot((dispose) => {
        selectAll();

        expect(selectedCount()).toBe(3);
        expect(isAssetSelected('asset-1')).toBe(true);
        expect(isAssetSelected('asset-2')).toBe(true);
        expect(isAssetSelected('asset-3')).toBe(true);
        dispose();
      });
    });

    it('should clear selection', () => {
      createRoot((dispose) => {
        selectAll();
        expect(selectedCount()).toBe(3);

        clearSelection();
        expect(selectedCount()).toBe(0);
        expect(isAssetSelected('asset-1')).toBe(false);
        dispose();
      });
    });

    it('should select all from specific date', () => {
      createRoot((dispose) => {
        // Select all from Jan 15
        selectAllFromDate('2024-01-15');

        expect(isAssetSelected('asset-1')).toBe(true);
        expect(isAssetSelected('asset-2')).toBe(true);
        expect(isAssetSelected('asset-3')).toBe(false); // Jan 16
        expect(selectedCount()).toBe(2);
        dispose();
      });
    });

    it('should deselect all from date if already selected', () => {
      createRoot((dispose) => {
        // First select all from Jan 15
        selectAllFromDate('2024-01-15');
        expect(selectedCount()).toBe(2);

        // Select again should deselect
        selectAllFromDate('2024-01-15');
        expect(selectedCount()).toBe(0);
        dispose();
      });
    });

    it('should check if date is fully selected', () => {
      createRoot((dispose) => {
        expect(isDateFullySelected('2024-01-15')).toBe(false);

        toggleAssetSelection('asset-1');
        expect(isDateFullySelected('2024-01-15')).toBe(false);

        toggleAssetSelection('asset-2');
        expect(isDateFullySelected('2024-01-15')).toBe(true);
        dispose();
      });
    });

    it('should get selected assets', () => {
      createRoot((dispose) => {
        toggleAssetSelection('asset-1');
        toggleAssetSelection('asset-3');

        const selected = getSelectedAssets();
        expect(selected.length).toBe(2);
        expect(selected.map(a => a.id)).toContain('asset-1');
        expect(selected.map(a => a.id)).toContain('asset-3');
        dispose();
      });
    });
  });
});
