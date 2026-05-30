import { Calendar, CheckSquare, Download, Images, Upload } from 'lucide-solid';
import { createSignal, Show } from 'solid-js';
import { captureEvent, isFeatureEnabled } from '~/analytics';
import { api } from '~/api/client';
import { albumName, allowDownload, allowUpload, assets, isSelectionMode, setIsSelectionMode } from '~/store/share';
import DownloadProgress from './DownloadProgress';

interface Props {
  onUploadClick?: () => void;
}

export default function Header(props: Props) {
  const [downloadProgress, setDownloadProgress] = createSignal({
    isOpen: false, progress: 0, total: 0, status: 'starting' as const, downloadUrl: ''
  });

  const getDateRange = () => {
    const assetList = assets();
    if (assetList.length === 0) return null;

    const dates = assetList.map((a) => new Date(a.fileCreatedAt || a.localDateTime));
    const oldest = new Date(Math.min(...dates.map((d) => d.getTime())));
    const newest = new Date(Math.max(...dates.map((d) => d.getTime())));

    const formatDate = (d: Date) =>
      d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

    if (oldest.getMonth() === newest.getMonth() && oldest.getFullYear() === newest.getFullYear()) {
      return formatDate(oldest);
    }
    return `${formatDate(oldest)} - ${formatDate(newest)}`;
  };

  async function handleDownloadAll() {
    const assetList = assets();
    if (assetList.length === 0) return;

    captureEvent('download_started', {
      source: 'header',
      asset_count: assetList.length,
      zip: assetList.length > 1,
    });

    // Single file - direct download via window.open
    if (assetList.length === 1) {
      const asset = assetList[0];
      window.open(api.getOriginalUrl(asset.id), '_blank');
      return;
    }

    // For 2+ assets, use ZIP download with progress
    setDownloadProgress({ isOpen: true, progress: 0, total: assetList.length, status: 'starting', downloadUrl: '' });

    try {
      const downloadUrl = await api.downloadAsZip(
        assetList.map(a => a.id),
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
      captureEvent('download_ready', { source: 'header', asset_count: assetList.length, zip: true });
    } catch (error) {
      console.error('Failed to download ZIP:', error);
      captureEvent('download_failed', { source: 'header', asset_count: assetList.length, zip: true });
      setDownloadProgress({ isOpen: false, progress: 0, total: 0, status: 'starting', downloadUrl: '' });
    }
  }

  const closeDownloadProgress = () => {
    setDownloadProgress({ isOpen: false, progress: 0, total: 0, status: 'starting', downloadUrl: '' });
  };

  return (
    <>
      <Show when={!isSelectionMode()}>
        <header class="flex-shrink-0 bg-[#0a0a0a] border-b border-white/5">
          <div class="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
            <div class="flex items-center justify-between">
              {/* Album info */}
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-slate to-light-blue flex items-center justify-center flex-shrink-0">
                  <Images class="w-5 h-5 text-white" />
                </div>
                <div class="min-w-0">
                  <h1 class="text-lg font-semibold text-white truncate">{albumName()}</h1>
                  <div class="flex items-center gap-2 text-xs text-white/40">
                    <span>
                      {assets().length} {assets().length === 1 ? 'photo' : 'photos'}
                    </span>
                    <Show when={getDateRange()}>
                      <span class="text-white/20">•</span>
                      <span class="hidden sm:flex items-center gap-1">
                        <Calendar class="w-3 h-3" />
                        {getDateRange()}
                      </span>
                    </Show>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div class="flex items-center gap-2 flex-shrink-0">
                {/* Select button - only show if downloads are allowed */}
                <Show when={allowDownload() && assets().length > 0}>
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white text-sm font-medium transition-colors"
                    onClick={() => {
                      captureEvent('selection_mode_enabled', { source: 'header' });
                      setIsSelectionMode(true);
                    }}
                  >
                    <CheckSquare class="w-4 h-4" />
                    <span class="hidden sm:inline">Select</span>
                  </button>
                </Show>

                {/* Download all */}
                <Show when={allowDownload() && assets().length > 0}>
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white text-sm font-medium transition-colors"
                    onClick={handleDownloadAll}
                  >
                    <Download class="w-4 h-4" />
                    <span class="hidden sm:inline">Download</span>
                  </button>
                </Show>

                {/* Upload */}
                <Show when={allowUpload() && isFeatureEnabled('upload-ui', true)}>
                  <button
                    class="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-slate hover:bg-blue-slate/80 text-white text-sm font-medium transition-colors"
                    onClick={props.onUploadClick}
                  >
                    <Upload class="w-4 h-4" />
                    <span class="hidden sm:inline">Upload</span>
                  </button>
                </Show>
              </div>
            </div>
          </div>
        </header>
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
