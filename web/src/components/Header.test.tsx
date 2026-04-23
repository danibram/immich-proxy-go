import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setIsSelectionMode,
  setSharedLink,
} from '~/store/share';
import Header from './Header';

describe('Header Component', () => {
  beforeEach(() => {
    // Reset store state
    setIsSelectionMode(false);
    setSharedLink({
      id: 'link-1',
      key: 'test-key',
      type: 'ALBUM',
      allowDownload: true,
      allowUpload: true,
      showMetadata: true,
      album: {
        id: 'album-1',
        albumName: 'My Vacation Photos',
        assets: [
          { id: 'a1', type: 'IMAGE', originalFileName: 'photo1.jpg', fileCreatedAt: '2024-01-15T10:00:00Z' },
          { id: 'a2', type: 'IMAGE', originalFileName: 'photo2.jpg', fileCreatedAt: '2024-02-20T14:00:00Z' },
        ],
        assetCount: 2,
      },
      assets: [],
    });
  });

  it('displays album name', () => {
    createRoot((dispose) => {
      render(() => <Header />);
      expect(screen.getByText('My Vacation Photos')).toBeInTheDocument();
      dispose();
    });
  });

  it('displays photo count', () => {
    createRoot((dispose) => {
      render(() => <Header />);
      expect(screen.getByText('2 photos')).toBeInTheDocument();
      dispose();
    });
  });

  it('shows download button when allowDownload is true', () => {
    createRoot((dispose) => {
      render(() => <Header />);
      expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
      dispose();
    });
  });

  it('shows upload button when allowUpload is true', () => {
    createRoot((dispose) => {
      render(() => <Header />);
      expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
      dispose();
    });
  });

  it('shows select button', () => {
    createRoot((dispose) => {
      render(() => <Header />);
      expect(screen.getByRole('button', { name: /select/i })).toBeInTheDocument();
      dispose();
    });
  });

  it('calls onUploadClick when upload button clicked', () => {
    createRoot((dispose) => {
      const onUploadClick = vi.fn();
      render(() => <Header onUploadClick={onUploadClick} />);

      fireEvent.click(screen.getByRole('button', { name: /upload/i }));
      expect(onUploadClick).toHaveBeenCalled();
      dispose();
    });
  });

  it('hides when selection mode is active', () => {
    createRoot((dispose) => {
      setIsSelectionMode(true);
      const { container } = render(() => <Header />);

      // Header should be hidden (Show when={!isSelectionMode()})
      expect(container.querySelector('header')).toBeNull();
      dispose();
    });
  });

  it('hides download button when allowDownload is false', () => {
    createRoot((dispose) => {
      setSharedLink({
        id: 'link-1',
        key: 'test-key',
        type: 'ALBUM',
        allowDownload: false,
        allowUpload: false,
        showMetadata: true,
        album: {
          id: 'album-1',
          albumName: 'View Only Album',
          assets: [{ id: 'a1', type: 'IMAGE', originalFileName: 'photo1.jpg', fileCreatedAt: '2024-01-15T10:00:00Z' }],
          assetCount: 1,
        },
        assets: [],
      });

      render(() => <Header />);
      expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
      dispose();
    });
  });

  it('displays singular "photo" for single asset', () => {
    createRoot((dispose) => {
      setSharedLink({
        id: 'link-1',
        key: 'test-key',
        type: 'ALBUM',
        allowDownload: true,
        allowUpload: false,
        showMetadata: true,
        album: {
          id: 'album-1',
          albumName: 'Single Photo',
          assets: [{ id: 'a1', type: 'IMAGE', originalFileName: 'photo1.jpg', fileCreatedAt: '2024-01-15T10:00:00Z' }],
          assetCount: 1,
        },
        assets: [],
      });

      render(() => <Header />);
      expect(screen.getByText('1 photo')).toBeInTheDocument();
      dispose();
    });
  });
});
