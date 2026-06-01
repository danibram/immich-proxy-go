import { captureEvent } from '~/analytics';
import { api } from '~/api/client';
import type { Asset } from '~/api/types';

export type DownloadSource = 'header' | 'selection';

export type DownloadStatus = 'starting' | 'processing' | 'ready';

export interface DownloadState {
  isOpen: boolean;
  progress: number;
  total: number;
  status: DownloadStatus;
  downloadUrl: string;
}

export const emptyDownloadState = (): DownloadState => ({
  isOpen: false,
  progress: 0,
  total: 0,
  status: 'starting',
  downloadUrl: '',
});

function toDownloadStatus(status: string): DownloadStatus {
  if (status === 'processing') return 'processing';
  if (status === 'ready') return 'ready';
  return 'starting';
}

export async function downloadAssets(
  assetList: Asset[],
  source: DownloadSource,
  onProgress: (state: DownloadState) => void
): Promise<void> {
  if (assetList.length === 0) return;

  captureEvent('download_started', {
    source,
    asset_count: assetList.length,
    zip: assetList.length > 1,
  });

  if (assetList.length === 1) {
    window.open(api.getOriginalUrl(assetList[0].id), '_blank');
    return;
  }

  onProgress({ isOpen: true, progress: 0, total: assetList.length, status: 'starting', downloadUrl: '' });

  try {
    const downloadUrl = await api.downloadAsZip(
      assetList.map((a) => a.id),
      (progress, total, status) => {
        onProgress({
          isOpen: true,
          progress,
          total,
          status: toDownloadStatus(status),
          downloadUrl: '',
        });
      }
    );
    onProgress({
      isOpen: true,
      progress: assetList.length,
      total: assetList.length,
      status: 'ready',
      downloadUrl,
    });
    window.open(downloadUrl, '_blank');
    captureEvent('download_ready', { source, asset_count: assetList.length, zip: true });
  } catch (error) {
    console.error('Failed to download ZIP:', error);
    captureEvent('download_failed', { source, asset_count: assetList.length, zip: true });
    onProgress(emptyDownloadState());
  }
}
