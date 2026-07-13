import type { Album, Asset, SharedLink } from './types';

// Upload robustness tuning. A stalled TCP connection (bad hotel wifi) never
// fires load/error on its own, so the client needs two guards:
//   - Stall watchdog: abort when no upload.progress event arrives for this
//     long. This is the real protection — a healthy upload emits progress
//     continuously, however slowly.
//   - Absolute timeout: a generous cap so even a pathological connection
//     that dribbles one byte per watchdog window eventually gives up. Big
//     videos on slow links are legitimate, hence 10 minutes.
// Retries use a short backoff; Immich dedupes uploads by checksum server-side,
// so re-sending after an ambiguous failure is safe.
const DEFAULT_UPLOAD_STALL_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 600_000;
const DEFAULT_UPLOAD_RETRY_DELAYS_MS = [1_000, 4_000];

// Test hooks: e2e fault-injection specs shrink these via localStorage so a
// stalled-upload scenario doesn't cost 30s+ of wall clock per retry. Real
// users never set these keys.
function tunableMs(key: string, fallback: number): number {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function uploadStallMs(): number {
  return tunableMs('ipp:upload-stall-ms', DEFAULT_UPLOAD_STALL_MS);
}

function uploadTimeoutMs(): number {
  return tunableMs('ipp:upload-timeout-ms', DEFAULT_UPLOAD_TIMEOUT_MS);
}

// Backoff schedule for the upload queue's retry loop (attempts = length + 1).
// Exported so the modal can compose it into the queue; reads the e2e
// localStorage hook on every call so fault-injection specs stay cheap.
export function uploadRetryDelaysMs(): number[] {
  try {
    const raw = globalThis.localStorage?.getItem('ipp:upload-retry-delays-ms');
    if (raw) {
      const delays = raw
        .split(',')
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 0);
      if (delays.length > 0) return delays;
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_UPLOAD_RETRY_DELAYS_MS;
}

// What POST /assets actually returns. status is "created" (201) or
// "duplicate"/"replaced" (200) on current Immich servers.
export interface UploadResult {
  id: string;
  status?: string;
}

export interface UploadCheckEntry {
  name: string;
  checksum: string;
  exists: boolean;
  assetId?: string;
}

// Failures worth retrying: the request never reached a verdict (network
// error, stall, timeout) or the server said "try again" (5xx, 429). 4xx like
// 413/415 are permanent — retrying can only waste the user's bandwidth.
export function isRetryableUploadError(error: unknown): boolean {
  if (error instanceof UploadStalledError) return true;
  if (error instanceof ApiError) {
    return error.status === 0 || error.status === 429 || error.status >= 500;
  }
  return false;
}

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
  getThumbnailUrl(assetId: string, size: 'preview' | 'thumbnail' | 'fullsize' = 'thumbnail'): string {
    const ext = size === 'thumbnail' ? 'webp' : 'jpg';
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

  // Ask the proxy which of these checksums already exist in the album
  // owner's library — WITHOUT uploading any bytes. The client calls this
  // once per selection after hashing; files that already exist are marked
  // "already in album" and never re-uploaded.
  async checkUploads(files: Array<{ name: string; checksum: string }>): Promise<UploadCheckEntry[]> {
    const response = await this.request<{ results: UploadCheckEntry[] }>('/upload-check', {
      method: 'POST',
      body: JSON.stringify({ files }),
    });
    return response.results ?? [];
  }

  // Single upload attempt with stall detection. Retries are the upload
  // queue's job (web/src/upload/queue.ts) — it owns attempt state and
  // backoff; this client only guards one attempt with the watchdog.
  async uploadAsset(
    file: File,
    onProgress?: (progress: number) => void,
    checksum?: string
  ): Promise<UploadResult> {
    const formData = new FormData();

    formData.append('assetData', file);
    formData.append('deviceAssetId', `web-${Date.now()}-${file.name}`);
    formData.append('deviceId', 'web');
    formData.append('fileCreatedAt', new Date(file.lastModified).toISOString());
    formData.append('fileModifiedAt', new Date(file.lastModified).toISOString());

    const stallMs = uploadStallMs();
    const timeoutMs = uploadTimeoutMs();

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      let stalled = false;
      let settled = false;

      // Every terminal path funnels through here so the watchdog timer can
      // never leak and double events (abort fires after error, etc.) can
      // never double-settle the promise.
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (stallTimer !== undefined) clearTimeout(stallTimer);
        fn();
      };

      // Watchdog: rearm on every progress event; if the connection stalls
      // (no progress for stallMs) abort the XHR so the queue can retry
      // instead of waiting forever.
      const armWatchdog = () => {
        if (stallTimer !== undefined) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          stalled = true;
          xhr.abort();
        }, stallMs);
      };

      xhr.upload.addEventListener('progress', (e) => {
        armWatchdog();
        if (e.lengthComputable && onProgress) {
          onProgress((e.loaded / e.total) * 100);
        }
      });

      // error/timeout/abort can fire on the request, the upload stream, or
      // both; the settle guard makes double delivery harmless, so register
      // the same handlers on both targets.
      for (const target of [xhr, xhr.upload]) {
        target.addEventListener('error', () => {
          settle(() => reject(new ApiError(0, 'Network error')));
        });
        target.addEventListener('timeout', () => {
          settle(() => reject(new UploadStalledError(`upload timed out after ${timeoutMs}ms`)));
        });
        target.addEventListener('abort', () => {
          settle(() =>
            reject(
              stalled
                ? new UploadStalledError(`no upload progress for ${stallMs}ms`)
                : new ApiError(0, 'Upload aborted')
            )
          );
        });
      }

      xhr.addEventListener('load', () => {
        settle(() => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText) as UploadResult);
            } catch {
              reject(new ApiError(xhr.status, xhr.responseText));
            }
          } else {
            reject(new ApiError(xhr.status, xhr.responseText));
          }
        });
      });

      xhr.open('POST', `${this.baseUrl}/assets`);
      xhr.withCredentials = true;
      if (checksum) {
        // Immich answers 200 {status:"duplicate"} from this header before
        // consuming the body when the asset already exists. Note: because
        // the server may close early, the browser can surface that as a
        // network error instead of a response — harmless, since the retry
        // dedupes instantly through this same header.
        xhr.setRequestHeader('x-immich-checksum', checksum);
      }
      // Generous absolute cap — the watchdog above is the real guard.
      xhr.timeout = timeoutMs;
      armWatchdog();
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

// The connection stopped making progress (watchdog) or exceeded the absolute
// timeout. Always retryable: the server may never have seen the request, and
// if it did, Immich's checksum dedupe makes the re-send idempotent.
export class UploadStalledError extends Error {
  constructor(detail: string) {
    super(`Upload stalled: ${detail}`);
    this.name = 'UploadStalledError';
  }
}

export class PasswordRequiredError extends Error {
  constructor() {
    super('Password required');
    this.name = 'PasswordRequiredError';
  }
}

export const api = new ApiClient();
