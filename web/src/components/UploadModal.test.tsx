import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '~/api/client';
import { setIsUploading } from '~/store/share';
import UploadModal from './UploadModal';

// Mock the API surface but keep the real error classes: the modal classifies
// failures with `instanceof ApiError` and isRetryableUploadError.
vi.mock('~/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/api/client')>();
  return {
    ...actual,
    api: {
      uploadAsset: vi.fn(),
      // Default: nothing exists upstream — files proceed to upload.
      checkUploads: vi.fn(async () => []),
      getSharedLink: vi.fn(),
      getAlbum: vi.fn(),
    },
  };
});

// Shared-link stub for tests that let an upload finish (the modal refreshes
// the link on settle).
function mockLink() {
  vi.mocked(api.getSharedLink).mockResolvedValue({
    id: 'link-1',
    key: 'test',
    type: 'INDIVIDUAL',
    allowDownload: true,
    allowUpload: true,
    showMetadata: true,
    assets: [],
  } as never);
}

describe('UploadModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations; restore the default "nothing
    // exists upstream" so a test that stubbed duplicates can't leak into the
    // next one.
    vi.mocked(api.checkUploads).mockImplementation(async () => []);
    setIsUploading(false);
    // The queue reads its retry schedule through the localStorage test hook;
    // tests that shrink it must not leak into the next one.
    localStorage.removeItem('ipp:upload-retry-delays-ms');
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

  it('calls onClose when the close button is clicked', () => {
    createRoot((dispose) => {
      const onClose = vi.fn();
      render(() => <UploadModal isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
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
    const mockUpload = vi.mocked(api.uploadAsset);
    mockUpload.mockResolvedValue({ id: 'asset-1' });
    mockLink();

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
    const mockUpload = vi.mocked(api.uploadAsset);

    // Capture the progress callback so the test can drive it.
    let progressCallback: ((progress: number) => void) | undefined;
    mockUpload.mockImplementation((file, onProgress) => {
      progressCallback = onProgress;
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

      // Simulate progress and verify the tile renders it.
      progressCallback!(50);
      await waitFor(() => {
        expect(screen.getByText('50%')).toBeInTheDocument();
      });

      dispose();
    });
  });

  it('continues draining files added while an upload is already running', async () => {
    const mockUpload = vi.mocked(api.uploadAsset);
    const uploads: Array<() => void> = [];

    mockUpload.mockImplementation(
      () =>
        new Promise((resolve) => {
          uploads.push(() => resolve({ id: `asset-${uploads.length}` }));
        })
    );
    mockLink();

    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(fileInput, 'files', {
        value: [new File(['first'], 'first.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      fireEvent.change(fileInput);

      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));

      // Files added mid-flight join the pool (which runs uploads in
      // parallel) without waiting for the first file to finish.
      Object.defineProperty(fileInput, 'files', {
        value: [new File(['second'], 'second.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      fireEvent.change(fileInput);

      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
      uploads[0]();
      uploads[1]();
      await waitFor(() => expect(api.getSharedLink).toHaveBeenCalled());

      dispose();
    });
  });

  it('marks files the server already has as duplicates without uploading them', async () => {
    const mockUpload = vi.mocked(api.uploadAsset);
    const mockCheck = vi.mocked(api.checkUploads);

    // Answer the dedupe check with "exists" for whatever checksum the modal
    // computed — the modal must then upload zero bytes for that file.
    mockCheck.mockImplementation(async (files) =>
      files.map((f) => ({ ...f, exists: true, assetId: 'asset-existing' }))
    );
    mockLink();

    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(fileInput, 'files', {
        value: [new File(['dup'], 'dup.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      fireEvent.change(fileInput);

      await waitFor(() => {
        expect(screen.getByText('Already in album')).toBeInTheDocument();
        expect(screen.getByText('Clear completed (1)')).toBeInTheDocument();
      });
      expect(mockCheck).toHaveBeenCalledTimes(1);
      expect(mockUpload).not.toHaveBeenCalled();
      const tile = container.querySelector('[data-testid="upload-tile"]');
      expect(tile?.getAttribute('data-status')).toBe('duplicate');

      dispose();
    });
  });

  it('sends the computed checksum with the upload', async () => {
    const mockUpload = vi.mocked(api.uploadAsset);
    const mockCheck = vi.mocked(api.checkUploads);

    mockUpload.mockResolvedValue({ id: 'asset-1' });
    mockLink();

    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(fileInput, 'files', {
        value: [new File(['abc'], 'photo.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      fireEvent.change(fileInput);

      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
      // SHA-1("abc") — the modal hashed the file and passed the checksum to
      // both the dedupe check and the upload.
      const expected = 'a9993e364706816aba3e25717850c26c9cd0d89d';
      expect(mockCheck).toHaveBeenCalledWith([{ name: 'photo.jpg', checksum: expected }]);
      expect(mockUpload.mock.calls[0][2]).toBe(expected);

      dispose();
    });
  });

  it('continues the queue past a permanently failed file and renders the i18n caption', async () => {
    const mockUpload = vi.mocked(api.uploadAsset);

    mockUpload.mockImplementation((file) =>
      file.name === 'bad.jpg'
        ? Promise.reject(new ApiError(413, '<html>File too large</html>'))
        : Promise.resolve({ id: 'asset-ok' })
    );
    mockLink();

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
        expect(screen.getByText('Too large')).toBeInTheDocument();
        expect(screen.getByText('Clear completed (1)')).toBeInTheDocument();
      });
      // The raw response body never reaches the UI.
      expect(screen.queryByText(/File too large/)).not.toBeInTheDocument();
      // The completed upload still refreshes the shared link.
      expect(api.getSharedLink).toHaveBeenCalled();

      dispose();
    });
  });

  it('shows the retrying state while the queue waits out a transient failure', async () => {
    const mockUpload = vi.mocked(api.uploadAsset);
    // Two retries via the localStorage tunable the queue composes with.
    localStorage.setItem('ipp:upload-retry-delays-ms', '10,10');

    // Attempt 1 fails transiently; attempt 2 stays in flight so the
    // "Retrying (2/3)…" label is stable to assert.
    mockUpload
      .mockRejectedValueOnce(new ApiError(503, 'Unavailable'))
      .mockImplementation(() => new Promise(() => { }));

    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(fileInput, 'files', {
        value: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      fireEvent.change(fileInput);

      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
      await waitFor(() => {
        expect(screen.getByTestId('upload-retrying')).toHaveTextContent('Retrying (2/3)…');
      });

      dispose();
    });
  });

  it('re-queues failed files when the retry button is clicked', async () => {
    const mockUpload = vi.mocked(api.uploadAsset);

    mockUpload
      .mockRejectedValueOnce(new ApiError(400, 'Bad request')) // permanent: no auto-retry
      .mockResolvedValueOnce({ id: 'asset-1' });
    mockLink();

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

  it('disables the close button during upload and ignores clicks on it', async () => {
    setIsUploading(true);

    createRoot((dispose) => {
      const onClose = vi.fn();
      render(() => <UploadModal isOpen={true} onClose={onClose} />);

      const closeButton = screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement;
      expect(closeButton.disabled).toBe(true);
      fireEvent.click(closeButton);
      expect(onClose).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('changes drag text on drag over', async () => {
    await createRoot(async (dispose) => {
      const { container } = render(() => <UploadModal isOpen={true} onClose={() => { }} />);

      const dropZone = container.querySelector('.dropzone');
      expect(dropZone).not.toBeNull();

      fireEvent.dragEnter(dropZone!);
      await waitFor(() => {
        expect(screen.getByText('Drop files here')).toBeInTheDocument();
      });
      expect(screen.queryByText('Drag and drop')).not.toBeInTheDocument();

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
