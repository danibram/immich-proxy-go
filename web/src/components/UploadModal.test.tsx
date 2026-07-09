import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '~/api/client';
import { setIsUploading } from '~/store/share';
import UploadModal from './UploadModal';

// Mock the API
vi.mock('~/api/client', () => ({
  api: {
    uploadAsset: vi.fn(),
    uploadAssetWithRetry: vi.fn(),
    getSharedLink: vi.fn(),
    getAlbum: vi.fn(),
  },
}));

describe('UploadModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setIsUploading(false);
  });

  it('is hidden when isOpen is false', () => {
    createRoot((dispose) => {
      const { container } = render(() => <UploadModal isOpen={false} onClose={() => { }} />);
      expect(container.firstChild).toBeNull();
      dispose();
    });
  });

  it('is visible when isOpen is true', () => {
    createRoot((dispose) => {
      render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      expect(screen.getByText('Upload items')).toBeInTheDocument();
      dispose();
    });
  });

  it('shows drag and drop area', () => {
    createRoot((dispose) => {
      render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      expect(screen.getByText('Drag and drop')).toBeInTheDocument();
      expect(screen.getByText('Photos and videos')).toBeInTheDocument();
      dispose();
    });
  });

  it('shows browse button', () => {
    createRoot((dispose) => {
      render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      expect(screen.getAllByRole('button', { name: /browse files/i }).length).toBeGreaterThan(0);
      dispose();
    });
  });

  it('has close button', () => {
    createRoot((dispose) => {
      render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      // Find the close button (X icon in header)
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      dispose();
    });
  });

  it('calls onClose when close button clicked', () => {
    createRoot((dispose) => {
      const onClose = vi.fn();
      render(() => <UploadModal isOpen={true} onClose={onClose} />);

      // The close button is the one with X icon (not Browse Files)
      const closeButton = screen.getAllByRole('button').find(
        btn => !btn.textContent?.includes('Browse')
      );

      if (closeButton) {
        fireEvent.click(closeButton);
        expect(onClose).toHaveBeenCalled();
      }
      dispose();
    });
  });

  it('has hidden file input for selecting files', () => {
    createRoot((dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();
      expect(fileInput.multiple).toBe(true);
      expect(fileInput.accept).toBe('image/*,video/*');
      dispose();
    });
  });

  it('handles file selection', async () => {
    const mockUpload = vi.mocked(api.uploadAssetWithRetry);
    const mockGetLink = vi.mocked(api.getSharedLink);

    mockUpload.mockResolvedValue({ id: 'asset-1', duplicate: false });
    mockGetLink.mockResolvedValue({
      id: 'link-1',
      key: 'test',
      type: 'INDIVIDUAL',
      allowDownload: true,
      allowUpload: true,
      showMetadata: true,
      assets: [],
    });

    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Create a mock file
      const file = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });

      // Trigger file selection
      Object.defineProperty(fileInput, 'files', {
        value: [file],
      });
      fireEvent.change(fileInput);

      // Should show the file in the list
      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      dispose();
    });
  });

  it('filters non-image/video files', async () => {
    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Create a mock text file (should be filtered out)
      const textFile = new File(['test'], 'document.txt', { type: 'text/plain' });
      const imageFile = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });

      Object.defineProperty(fileInput, 'files', {
        value: [textFile, imageFile],
      });
      fireEvent.change(fileInput);

      // Only the image should be added
      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
        expect(screen.queryByText('document.txt')).not.toBeInTheDocument();
      });

      dispose();
    });
  });

  it('shows upload progress', async () => {
    const mockUpload = vi.mocked(api.uploadAssetWithRetry);

    // Create a promise that we can control
    let progressCallback: ((progress: number) => void) | undefined;
    mockUpload.mockImplementation((file, hooks) => {
      progressCallback = hooks?.onProgress;
      return new Promise(() => { }); // Never resolves during test
    });

    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });

      Object.defineProperty(fileInput, 'files', {
        value: [file],
      });
      fireEvent.change(fileInput);

      // Wait for upload to start
      await waitFor(() => {
        expect(mockUpload).toHaveBeenCalled();
      });

      // Simulate progress
      if (progressCallback) {
        progressCallback(50);
      }

      dispose();
    });
  });

  it('continues draining files added while an upload is already running', async () => {
    const mockUpload = vi.mocked(api.uploadAssetWithRetry);
    const mockGetLink = vi.mocked(api.getSharedLink);
    const uploads: Array<() => void> = [];

    mockUpload.mockImplementation(
      () =>
        new Promise((resolve) => {
          uploads.push(() => resolve({ id: `asset-${uploads.length}`, type: 'IMAGE' } as never));
        })
    );
    mockGetLink.mockResolvedValue({
      id: 'link-1',
      key: 'test',
      type: 'INDIVIDUAL',
      allowDownload: true,
      allowUpload: true,
      showMetadata: true,
      assets: [],
    });

    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(fileInput, 'files', {
        value: [new File(['first'], 'first.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      fireEvent.change(fileInput);

      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));

      Object.defineProperty(fileInput, 'files', {
        value: [new File(['second'], 'second.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      fireEvent.change(fileInput);

      expect(mockUpload).toHaveBeenCalledTimes(1);
      uploads[0]();

      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
      uploads[1]();
      await waitFor(() => expect(mockGetLink).toHaveBeenCalled());

      dispose();
    });
  });

  it('continues the queue past a permanently failed file', async () => {
    const mockUpload = vi.mocked(api.uploadAssetWithRetry);
    const mockGetLink = vi.mocked(api.getSharedLink);

    mockUpload.mockImplementation((file) =>
      file.name === 'bad.jpg'
        ? Promise.reject(new Error('API Error 413: File too large'))
        : Promise.resolve({ id: 'asset-ok' } as never)
    );
    mockGetLink.mockResolvedValue({
      id: 'link-1',
      key: 'test',
      type: 'INDIVIDUAL',
      allowDownload: true,
      allowUpload: true,
      showMetadata: true,
      assets: [],
    });

    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(fileInput, 'files', {
        value: [
          new File(['bad'], 'bad.jpg', { type: 'image/jpeg' }),
          new File(['good'], 'good.jpg', { type: 'image/jpeg' }),
        ],
        configurable: true,
      });
      fireEvent.change(fileInput);

      // Both files must have been attempted: the failure of the first one
      // must not freeze the queue.
      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(screen.getByText(/API Error 413/)).toBeInTheDocument();
        expect(screen.getByText('Clear completed (1)')).toBeInTheDocument();
      });
      // The completed upload still refreshes the shared link.
      expect(mockGetLink).toHaveBeenCalled();

      dispose();
    });
  });

  it('shows the retrying state when a transient failure schedules a retry', async () => {
    const mockUpload = vi.mocked(api.uploadAssetWithRetry);

    let retryCallback: ((attempt: number, maxAttempts: number) => void) | undefined;
    mockUpload.mockImplementation((file, hooks) => {
      retryCallback = hooks?.onRetry;
      return new Promise(() => { }); // stays in-flight during the test
    });

    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(fileInput, 'files', {
        value: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      fireEvent.change(fileInput);

      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));

      retryCallback?.(2, 3);
      await waitFor(() => {
        expect(screen.getByTestId('upload-retrying')).toHaveTextContent('Retrying (2/3)…');
      });

      dispose();
    });
  });

  it('re-queues failed files when the retry button is clicked', async () => {
    const mockUpload = vi.mocked(api.uploadAssetWithRetry);
    const mockGetLink = vi.mocked(api.getSharedLink);

    mockUpload
      .mockRejectedValueOnce(new Error('Upload stalled: no upload progress for 30000ms'))
      .mockResolvedValueOnce({ id: 'asset-1' } as never);
    mockGetLink.mockResolvedValue({
      id: 'link-1',
      key: 'test',
      type: 'INDIVIDUAL',
      allowDownload: true,
      allowUpload: true,
      showMetadata: true,
      assets: [],
    });

    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(fileInput, 'files', {
        value: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      fireEvent.change(fileInput);

      const retryButton = await screen.findByTestId('upload-retry-failed');
      expect(retryButton).toHaveTextContent('Retry failed (1)');

      fireEvent.click(retryButton);

      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(screen.queryByTestId('upload-retry-failed')).not.toBeInTheDocument();
        expect(screen.getByText('Clear completed (1)')).toBeInTheDocument();
      });

      dispose();
    });
  });

  it('disables close button during upload', async () => {
    setIsUploading(true);

    createRoot((dispose) => {
      render(() => <UploadModal isOpen={true} onClose={() => { }} />);

      // The close button should be disabled
      const closeButton = screen.getAllByRole('button').find(
        btn => !btn.textContent?.includes('Browse')
      ) as HTMLButtonElement;

      expect(closeButton?.disabled).toBe(true);
      dispose();
    });
  });

  it('changes drag text on drag over', async () => {
    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);

      // Find the drop zone
      const dropZone = container.querySelector('.border-dashed');

      if (dropZone) {
        // Simulate drag enter
        fireEvent.dragEnter(dropZone);

        await waitFor(() => {
          expect(screen.getByText('Drop files here')).toBeInTheDocument();
        });
      }

      dispose();
    });
  });
});

describe('File Size Formatting', () => {
  // Test the formatFileSize function indirectly through the component
  it('shows file size correctly', async () => {
    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Create a 1MB file
      const fileContent = new Array(1024 * 1024).fill('x').join('');
      const file = new File([fileContent], 'large.jpg', { type: 'image/jpeg' });

      Object.defineProperty(fileInput, 'files', {
        value: [file],
      });
      fireEvent.change(fileInput);

      await waitFor(() => {
        // Should show the file size
        expect(screen.getByText(/MB/)).toBeInTheDocument();
      });

      dispose();
    });
  });
});
