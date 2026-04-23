import { CheckSquare, Download, Square, X } from 'lucide-solid';
import { createSignal, Show } from 'solid-js';
import { api } from '~/api/client';
import {
  assets,
  clearSelection,
  getSelectedAssets,
  isSelectionMode,
  selectAll,
  selectedCount,
  setIsSelectionMode,
} from '~/store/share';
import DownloadProgress from './DownloadProgress';

export default function SelectionBar() {
  const [downloadProgress, setDownloadProgress] = createSignal({
    isOpen: false, progress: 0, total: 0, status: 'starting' as const, downloadUrl: ''
  });
  const allSelected = () => selectedCount() === assets().length && assets().length > 0;

  async function handleDownloadSelected() {
    const selected = getSelectedAssets();
    if (selected.length === 0) return;

    // Single file - direct download via window.open
    if (selected.length === 1) {
      const asset = selected[0];
      window.open(api.getOriginalUrl(asset.id), '_blank');
      return;
    }

    // For 2+ assets, use ZIP download with progress
    setDownloadProgress({ isOpen: true, progress: 0, total: selected.length, status: 'starting', downloadUrl: '' });

    try {
      const downloadUrl = await api.downloadAsZip(
        selected.map(a => a.id),
        (progress, total, status) => {
          setDownloadProgress(prev => ({
            ...prev,
            progress,
            total,
            status: status as 'starting' | 'processing' | 'ready'
          }));
        }
      );
      // Show download ready with URL
      setDownloadProgress(prev => ({ ...prev, status: 'ready' as const, downloadUrl }));
      // Auto-open download
      window.open(downloadUrl, '_blank');
    } catch (error) {
      console.error('Failed to download ZIP:', error);
      setDownloadProgress({ isOpen: false, progress: 0, total: 0, status: 'starting', downloadUrl: '' });
    }
  }

  function handleClose() {
    clearSelection();
    setIsSelectionMode(false);
  }

  const closeDownloadProgress = () => {
    setDownloadProgress({ isOpen: false, progress: 0, total: 0, status: 'starting', downloadUrl: '' });
  };

  return (
    <>
      <Show when={isSelectionMode()}>
        <div class="fixed top-0 left-0 right-0 z-40 bg-immich-primary shadow-lg animate-slideDown">
          <div class="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
            <div class="flex items-center justify-between">
              {/* Left side - Close and count */}
              <div class="flex items-center gap-4">
                <button
                  class="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                  onClick={handleClose}
                >
                  <X class="w-5 h-5" />
                </button>
                <span class="text-white font-medium">
                  {selectedCount()} selected
                </span>
              </div>

              {/* Right side - Actions */}
              <div class="flex items-center gap-2">
                {/* Select all / Deselect all */}
                <button
                  class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 text-white text-sm font-medium transition-colors"
                  onClick={() => allSelected() ? clearSelection() : selectAll()}
                >
                  {allSelected() ? (
                    <>
                      <Square class="w-4 h-4" />
                      <span class="hidden sm:inline">Deselect all</span>
                    </>
                  ) : (
                    <>
                      <CheckSquare class="w-4 h-4" />
                      <span class="hidden sm:inline">Select all</span>
                    </>
                  )}
                </button>

                {/* Download selected */}
                <Show when={selectedCount() > 0}>
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-white text-sm font-medium transition-colors"
                    onClick={handleDownloadSelected}
                  >
                    <Download class="w-4 h-4" />
                    <span class="hidden sm:inline">Download ({selectedCount()})</span>
                  </button>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <DownloadProgress
        isOpen={downloadProgress().isOpen}
        progress={downloadProgress().progress}
        total={downloadProgress().total}
        status={downloadProgress().status}
        downloadUrl={downloadProgress().downloadUrl}
        onClose={closeDownloadProgress}
      />
    </>
  );
}
