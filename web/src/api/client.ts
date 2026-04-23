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
      if (response.status === 401) {
        const data = await response.json();
        if (data.passwordRequired) {
          throw new PasswordRequiredError();
        }
      }
      throw new ApiError(response.status, await response.text());
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

  getThumbnailUrl(assetId: string, size: 'preview' | 'thumbnail' = 'thumbnail'): string {
    return `${this.baseUrl}/assets/${assetId}/thumbnail?size=${size}`;
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
