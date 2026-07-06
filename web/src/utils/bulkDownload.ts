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

/**
 * Save a proxied URL to disk. We fetch it as a blob (Sec-Fetch-Dest: empty)
 * and click a synthetic <a download>, instead of window.open()-ing the URL.
 * A direct navigation sends Sec-Fetch-Dest: document, which hotlink
 * protection rejects with "Direct access not allowed" — so window.open
 * breaks every download on shares that enable it.
 */
export async function saveUrl(url: string, fallbackName: string): Promise<void> {
  const { blob, filename } = await api.fetchDownload(url);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || fallbackName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke on the next tick so the browser has started the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
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
    const asset = assetList[0];
    try {
      await saveUrl(api.getOriginalUrl(asset.id), asset.originalFileName || asset.id);
      captureEvent('download_ready', { source, asset_count: 1, zip: false });
    } catch (error) {
      console.error('Failed to download asset:', error);
      captureEvent('download_failed', { source, asset_count: 1, zip: false });
    }
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
    await saveUrl(downloadUrl, 'immich-download.zip');
    onProgress({
      isOpen: true,
      progress: assetList.length,
      total: assetList.length,
      status: 'ready',
      downloadUrl,
    });
    captureEvent('download_ready', { source, asset_count: assetList.length, zip: true });
  } catch (error) {
    console.error('Failed to download ZIP:', error);
    captureEvent('download_failed', { source, asset_count: assetList.length, zip: true });
    onProgress(emptyDownloadState());
  }
}
