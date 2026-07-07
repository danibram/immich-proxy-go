import type { Album, Asset, SharedLink } from './types';

export interface DownloadJobStatus {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  progress: number;
  total: number;
  filename?: string;
  error?: string;
}

class ApiClient {
  private baseUrl: string = '';
  private shareKey: string = '';
  private shareType: 'share' | 's' = 'share';

  setShareKey(key: string, type: 'share' | 's' = 'share') {
    this.shareKey = key;
    this.shareType = type;
    this.baseUrl = `/${type}/${key}/api`;
  }

  getShareKey(): string {
    return this.shareKey;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 401) {
        try {
          const data = JSON.parse(body) as { passwordRequired?: boolean };
          if (data.passwordRequired) {
            throw new PasswordRequiredError();
          }
        } catch (error) {
          if (error instanceof PasswordRequiredError) {
            throw error;
          }
        }
      }
      throw new ApiError(response.status, body);
    }

    return response.json();
  }

  async getSharedLink(): Promise<SharedLink> {
    return this.request<SharedLink>('/shared-links/me');
  }

  async validatePassword(password: string): Promise<boolean> {
    const response = await this.request<{ valid: boolean }>('/shared-links/me/password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    return response.valid;
  }

  async getAlbum(albumId: string): Promise<Album> {
    return this.request<Album>(`/albums/${albumId}`);
  }

  // Full asset details (EXIF, original filename). Immich v3 album listings
  // no longer include these, so the viewer fetches them lazily per asset.
  async getAsset(assetId: string): Promise<Asset> {
    return this.request<Asset>(`/assets/${assetId}`);
  }

  // The extension makes the URL eligible for Cloudflare's DEFAULT edge cache
  // (extension-based list; extensionless API paths are marked DYNAMIC and the
  // origin Cache-Control is ignored). It mirrors what Immich actually encodes
  // per size (webp thumbnails, jpeg previews) and is advisory only — the
  // response Content-Type wins. Never derive it from the asset's original
  // filename: iPhone HEIC originals would yield .heic URLs, which Cloudflare's
  // default cacheable-extension list excludes.
  getThumbnailUrl(assetId: string, size: 'preview' | 'thumbnail' = 'thumbnail'): string {
    const ext = size === 'preview' ? 'jpg' : 'webp';
    return `${this.baseUrl}/assets/${assetId}/thumbnail.${ext}?size=${size}`;
  }

  getOriginalUrl(assetId: string): string {
    return `${this.baseUrl}/assets/${assetId}/original`;
  }

  getVideoUrl(assetId: string): string {
    return `${this.baseUrl}/assets/${assetId}/video/playback`;
  }

  // Start a download job and return the job ID
  async startDownloadJob(assetIds: string[]): Promise<string> {
    const response = await this.request<{ jobId: string }>('/assets/download', {
      method: 'POST',
      body: JSON.stringify({ assetIds }),
    });
    return response.jobId;
  }

  // Get download job status
  async getDownloadJobStatus(jobId: string): Promise<DownloadJobStatus> {
    return this.request<DownloadJobStatus>(`/download/jobs/${jobId}`);
  }

  // Get download URL for completed job
  getDownloadJobUrl(jobId: string): string {
    return `${this.baseUrl}/download/jobs/${jobId}/file`;
  }

  // Fetch a proxied URL as a Blob via fetch() so the request carries
  // Sec-Fetch-Dest: empty. Navigating to these URLs directly (window.open,
  // location) sends Sec-Fetch-Dest: document, which hotlink protection blocks
  // with "Direct access not allowed". Returns the blob plus the server's
  // suggested filename (from Content-Disposition) when present.
  async fetchDownload(url: string): Promise<{ blob: Blob; filename?: string }> {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }
    const blob = await response.blob();
    return { blob, filename: filenameFromContentDisposition(response.headers.get('Content-Disposition')) };
  }

  // Download with progress tracking - returns the download URL when ready
  async downloadAsZip(
    assetIds: string[],
    onProgress?: (progress: number, total: number, status: string) => void
  ): Promise<string> {
    // Start the job
    onProgress?.(0, assetIds.length, 'starting');
    const jobId = await this.startDownloadJob(assetIds);

    // Poll for progress
    while (true) {
      const status = await this.getDownloadJobStatus(jobId);

      if (status.status === 'processing') {
        onProgress?.(status.progress, status.total, 'processing');
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      if (status.status === 'failed') {
        throw new ApiError(500, status.error || 'Download failed');
      }

      if (status.status === 'ready') {
        onProgress?.(status.total, status.total, 'ready');
        return this.getDownloadJobUrl(jobId);
      }
    }
  }

  async uploadAsset(file: File, onProgress?: (progress: number) => void): Promise<Asset> {
    const formData = new FormData();

    formData.append('assetData', file);
    formData.append('deviceAssetId', `web-${Date.now()}-${file.name}`);
    formData.append('deviceId', 'web');
    formData.append('fileCreatedAt', new Date(file.lastModified).toISOString());
    formData.append('fileModifiedAt', new Date(file.lastModified).toISOString());

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress((e.loaded / e.total) * 100);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new ApiError(xhr.status, xhr.responseText));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new ApiError(0, 'Network error'));
      });

      xhr.open('POST', `${this.baseUrl}/assets`);
      xhr.withCredentials = true;
      xhr.send(formData);
    });
  }
}

// Parse the filename from a Content-Disposition header. Handles both
// `filename="x"` and RFC 5987 `filename*=UTF-8''x`.
function filenameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, ''));
    } catch {
      // fall through to the plain form
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : undefined;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`API Error ${status}: ${body}`);
    this.name = 'ApiError';
  }
}

export class PasswordRequiredError extends Error {
  constructor() {
    super('Password required');
    this.name = 'PasswordRequiredError';
  }
}

export const api = new ApiClient();
