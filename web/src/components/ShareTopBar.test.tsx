import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  selectAll,
  setIsSelectionMode,
  setSelectedAssets,
  setSharedLink,
  toggleAssetSelection,
} from '~/store/share';
import ShareTopBar from './ShareTopBar';

const defaultProps = () => ({
  dateRange: null,
  wide: false,
  collapsed: false,
  onUploadClick: vi.fn(),
  onDownloadAll: vi.fn(),
  onDownloadSelected: vi.fn(),
});

describe('ShareTopBar', () => {
  beforeEach(() => {
    setSelectedAssets(new Set());
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

  it('displays album name in browse mode', () => {
    createRoot((dispose) => {
      render(() => <ShareTopBar {...defaultProps()} />);
      expect(screen.getByTestId('album-title')).toHaveTextContent('My Vacation Photos');
      dispose();
    });
  });

  it('displays item count', () => {
    createRoot((dispose) => {
      render(() => <ShareTopBar {...defaultProps()} />);
      expect(screen.getByTestId('album-meta')).toHaveTextContent('2 items');
      dispose();
    });
  });

  it('moves download all into the secondary actions menu', () => {
    createRoot((dispose) => {
      render(() => <ShareTopBar {...defaultProps()} />);
      const trigger = screen.getByLabelText(/more actions/i);
      const menu = trigger.closest('details')!;
      expect(menu).not.toHaveAttribute('open');
      fireEvent.click(trigger);
      expect(menu).toHaveAttribute('open');
      expect(screen.getByRole('menuitem', { name: /download all/i })).toBeInTheDocument();
      dispose();
    });
  });

  it('shows add photos as the primary album action', () => {
    createRoot((dispose) => {
      render(() => <ShareTopBar {...defaultProps()} />);
      expect(screen.getByRole('button', { name: /add photos/i })).toBeInTheDocument();
      dispose();
    });
  });

  it('shows select button', () => {
    createRoot((dispose) => {
      render(() => <ShareTopBar {...defaultProps()} />);
      expect(screen.getByRole('button', { name: /select/i })).toBeInTheDocument();
      dispose();
    });
  });

  it('calls onUploadClick when upload button clicked', () => {
    createRoot((dispose) => {
      const props = defaultProps();
      render(() => <ShareTopBar {...props} />);
      fireEvent.click(screen.getByRole('button', { name: /add photos/i }));
      expect(props.onUploadClick).toHaveBeenCalled();
      dispose();
    });
  });

  it('calls onDownloadAll from the secondary actions menu', () => {
    createRoot((dispose) => {
      const props = defaultProps();
      render(() => <ShareTopBar {...props} />);
      const trigger = screen.getByLabelText(/more actions/i);
      const menu = trigger.closest('details')!;
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('menuitem', { name: /download all/i }));
      expect(props.onDownloadAll).toHaveBeenCalled();
      expect(menu).not.toHaveAttribute('open');
      dispose();
    });
  });

  it('shows selection UI when in selection mode', () => {
    createRoot((dispose) => {
      setIsSelectionMode(true);
      render(() => <ShareTopBar {...defaultProps()} />);
      expect(screen.getByText('0 selected')).toBeInTheDocument();
      dispose();
    });
  });

  it('hides browse download when allowDownload is false', () => {
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
      render(() => <ShareTopBar {...defaultProps()} />);
      expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
      dispose();
    });
  });

  it('shows select all in selection mode', () => {
    createRoot((dispose) => {
      setIsSelectionMode(true);
      render(() => <ShareTopBar {...defaultProps()} />);
      expect(screen.getByRole('button', { name: /select all/i })).toBeInTheDocument();
      dispose();
    });
  });

  it('changes to deselect all when all selected', () => {
    createRoot((dispose) => {
      setIsSelectionMode(true);
      selectAll();
      render(() => <ShareTopBar {...defaultProps()} />);
      expect(screen.getByRole('button', { name: /deselect all/i })).toBeInTheDocument();
      dispose();
    });
  });

  it('shows download button when items selected', () => {
    createRoot((dispose) => {
      setIsSelectionMode(true);
      toggleAssetSelection('a1');
      render(() => <ShareTopBar {...defaultProps()} />);
      expect(screen.getByRole('button', { name: /download \(1\)/i })).toBeInTheDocument();
      dispose();
    });
  });

  it('hides download button when nothing selected', () => {
    createRoot((dispose) => {
      setIsSelectionMode(true);
      render(() => <ShareTopBar {...defaultProps()} />);
      expect(screen.queryByRole('button', { name: /download \(/i })).toBeNull();
      dispose();
    });
  });
});
