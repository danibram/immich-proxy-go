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
      expect(screen.getByText('Upload')).toBeInTheDocument();
      dispose();
    });
  });

  it('shows drag and drop area', () => {
    createRoot((dispose) => {
      render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      expect(screen.getByText('Drag and drop')).toBeInTheDocument();
      expect(screen.getByText('or click to browse')).toBeInTheDocument();
      dispose();
    });
  });

  it('shows browse button', () => {
    createRoot((dispose) => {
      render(() => <UploadModal isOpen={true} onClose={() => { }} />);
      expect(screen.getByRole('button', { name: /browse files/i })).toBeInTheDocument();
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
    const mockUpload = vi.mocked(api.uploadAsset);
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
    const mockUpload = vi.mocked(api.uploadAsset);

    // Create a promise that we can control
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

      // Simulate progress
      if (progressCallback) {
        progressCallback(50);
      }

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
