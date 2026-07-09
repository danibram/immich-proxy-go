import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  ApiError,
  isRetryableUploadError,
  PasswordRequiredError,
  UploadStalledError,
} from './client';

describe('ApiClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    // Reset share key
    api.setShareKey('test-key');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('setShareKey', () => {
    it('should set the share key', () => {
      api.setShareKey('my-key');
      expect(api.getShareKey()).toBe('my-key');
    });
  });

  describe('getSharedLink', () => {
    it('should fetch shared link successfully', async () => {
      const mockLink = {
        id: 'link-123',
        key: 'test-key',
        type: 'ALBUM',
        allowDownload: true,
        album: { id: 'album-123', albumName: 'Test Album' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockLink,
      });

      const result = await api.getSharedLink();

      expect(result).toEqual(mockLink);
      expect(mockFetch).toHaveBeenCalledWith(
        '/share/test-key/api/shared-links/me',
        expect.objectContaining({
          credentials: 'include',
        })
      );
    });

    it('should throw PasswordRequiredError on 401 with passwordRequired', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ passwordRequired: true }),
      });

      await expect(api.getSharedLink()).rejects.toThrow(PasswordRequiredError);
    });

    it('should throw ApiError on other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      await expect(api.getSharedLink()).rejects.toThrow(ApiError);
    });
  });

  describe('validatePassword', () => {
    it('should validate password successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true }),
      });

      const result = await api.validatePassword('secret123');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        '/share/test-key/api/shared-links/me/password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'secret123' }),
        })
      );
    });

    it('should throw ApiError on invalid password', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid password',
      });

      await expect(api.validatePassword('wrong')).rejects.toThrow(ApiError);
    });
  });

  describe('getAlbum', () => {
    it('should fetch album successfully', async () => {
      const mockAlbum = {
        id: 'album-123',
        albumName: 'Test Album',
        assets: [
          { id: 'asset-1', type: 'IMAGE' },
          { id: 'asset-2', type: 'VIDEO' },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAlbum,
      });

      const result = await api.getAlbum('album-123');

      expect(result).toEqual(mockAlbum);
      expect(mockFetch).toHaveBeenCalledWith(
        '/share/test-key/api/albums/album-123',
        expect.objectContaining({
          credentials: 'include',
        })
      );
    });
  });

  describe('URL generators', () => {
    beforeEach(() => {
      api.setShareKey('my-share-key');
    });

    it('should generate correct thumbnail URL', () => {
      const url = api.getThumbnailUrl('asset-123');
      expect(url).toBe('/share/my-share-key/api/assets/asset-123/thumbnail.webp?size=thumbnail');
    });

    it('should generate correct preview URL', () => {
      const url = api.getThumbnailUrl('asset-123', 'preview');
      expect(url).toBe('/share/my-share-key/api/assets/asset-123/thumbnail.jpg?size=preview');
    });

    it('should generate correct original URL', () => {
      const url = api.getOriginalUrl('asset-123');
      expect(url).toBe('/share/my-share-key/api/assets/asset-123/original');
    });

    it('should generate correct video URL', () => {
      const url = api.getVideoUrl('asset-123');
      expect(url).toBe('/share/my-share-key/api/assets/asset-123/video/playback');
    });
  });
});

// Minimal scripted XMLHttpRequest for upload tests: records open/send/abort
// and lets each test drive progress/load/error/timeout events by hand.
class MockXHREmitter {
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type: string, event: unknown = {}) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}

class MockXHR extends MockXHREmitter {
  static instances: MockXHR[] = [];
  upload = new MockXHREmitter();
  status = 0;
  responseText = '';
  timeout = 0;
  withCredentials = false;
  method = '';
  url = '';
  sent = false;
  abortCalls = 0;

  constructor() {
    super();
    MockXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(_body?: unknown) {
    this.sent = true;
  }

  abort() {
    this.abortCalls += 1;
    this.emit('abort');
  }

  respond(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.emit('load');
  }

  progress(loaded: number, total: number) {
    this.upload.emit('progress', { lengthComputable: true, loaded, total });
  }
}

describe('upload retry classification', () => {
  it('treats stalls, network errors, 5xx and 429 as retryable', () => {
    expect(isRetryableUploadError(new UploadStalledError('no progress'))).toBe(true);
    expect(isRetryableUploadError(new ApiError(0, 'Network error'))).toBe(true);
    expect(isRetryableUploadError(new ApiError(429, 'Too many requests'))).toBe(true);
    expect(isRetryableUploadError(new ApiError(500, 'Internal error'))).toBe(true);
    expect(isRetryableUploadError(new ApiError(503, 'Unavailable'))).toBe(true);
  });

  it('treats 4xx (except 429) and unknown errors as permanent', () => {
    expect(isRetryableUploadError(new ApiError(413, 'Too large'))).toBe(false);
    expect(isRetryableUploadError(new ApiError(415, 'Unsupported'))).toBe(false);
    expect(isRetryableUploadError(new ApiError(400, 'Bad request'))).toBe(false);
    expect(isRetryableUploadError(new ApiError(401, 'Unauthorized'))).toBe(false);
    expect(isRetryableUploadError(new Error('anything else'))).toBe(false);
  });
});

describe('uploadAsset (single attempt)', () => {
  beforeEach(() => {
    MockXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', MockXHR);
    vi.useFakeTimers();
    api.setShareKey('test-key');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function makeFile() {
    return new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
  }

  it('resolves on a 2xx response and reports progress', async () => {
    const onProgress = vi.fn();
    const promise = api.uploadAsset(makeFile(), onProgress);
    const xhr = MockXHR.instances[0];

    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/share/test-key/api/assets');
    expect(xhr.timeout).toBe(600_000);

    xhr.progress(50, 100);
    xhr.respond(201, JSON.stringify({ id: 'asset-1' }));

    await expect(promise).resolves.toEqual({ id: 'asset-1' });
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it('rejects with ApiError on a 4xx response', async () => {
    const promise = api.uploadAsset(makeFile());
    MockXHR.instances[0].respond(413, 'File too large');

    await expect(promise).rejects.toMatchObject({ name: 'ApiError', status: 413 });
  });

  it('aborts via the watchdog when no progress arrives for 30s', async () => {
    const promise = api.uploadAsset(makeFile());
    const xhr = MockXHR.instances[0];
    const result = expect(promise).rejects.toBeInstanceOf(UploadStalledError);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(xhr.abortCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(xhr.abortCalls).toBe(1);
    await result;
  });

  it('resets the watchdog on every progress event', async () => {
    const promise = api.uploadAsset(makeFile());
    const xhr = MockXHR.instances[0];
    const result = expect(promise).rejects.toBeInstanceOf(UploadStalledError);

    // Progress at t=29s pushes the deadline to t=59s.
    await vi.advanceTimersByTimeAsync(29_000);
    xhr.progress(10, 100);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(xhr.abortCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(xhr.abortCalls).toBe(1);
    await result;
  });

  it('maps the absolute timeout to a retryable stall error', async () => {
    const promise = api.uploadAsset(makeFile());
    const result = expect(promise).rejects.toBeInstanceOf(UploadStalledError);
    MockXHR.instances[0].emit('timeout');
    await result;
  });

  it('maps network errors to a retryable status-0 ApiError', async () => {
    const promise = api.uploadAsset(makeFile());
    const result = expect(promise).rejects.toMatchObject({ name: 'ApiError', status: 0 });
    MockXHR.instances[0].emit('error');
    await result;
  });
});

describe('uploadAssetWithRetry', () => {
  beforeEach(() => {
    MockXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', MockXHR);
    vi.useFakeTimers();
    api.setShareKey('test-key');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function makeFile() {
    return new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
  }

  it('retries after a stall and succeeds on the second attempt', async () => {
    const onRetry = vi.fn();
    const onProgress = vi.fn();
    const promise = api.uploadAssetWithRetry(makeFile(), { onProgress, onRetry });

    // Attempt 1 stalls: watchdog fires at 30s.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(MockXHR.instances[0].abortCalls).toBe(1);
    expect(onRetry).toHaveBeenCalledWith(2, 3);

    // Backoff (1s) then attempt 2.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(MockXHR.instances).toHaveLength(2);

    MockXHR.instances[1].progress(100, 100);
    MockXHR.instances[1].respond(201, JSON.stringify({ id: 'asset-1' }));

    await expect(promise).resolves.toEqual({ id: 'asset-1' });
    expect(onProgress).toHaveBeenCalledWith(100);
  });

  it('does not retry permanent failures (413)', async () => {
    const onRetry = vi.fn();
    const promise = api.uploadAssetWithRetry(makeFile(), { onRetry });
    const result = expect(promise).rejects.toMatchObject({ name: 'ApiError', status: 413 });

    MockXHR.instances[0].respond(413, 'File too large');

    await result;
    expect(MockXHR.instances).toHaveLength(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('gives up after exhausting all attempts', async () => {
    const onRetry = vi.fn();
    const promise = api.uploadAssetWithRetry(makeFile(), { onRetry });
    const result = expect(promise).rejects.toMatchObject({ name: 'ApiError', status: 0 });

    MockXHR.instances[0].emit('error'); // attempt 1
    await vi.advanceTimersByTimeAsync(1_000); // backoff 1
    MockXHR.instances[1].emit('error'); // attempt 2
    await vi.advanceTimersByTimeAsync(4_000); // backoff 2
    MockXHR.instances[2].emit('error'); // attempt 3 — final

    await result;
    expect(MockXHR.instances).toHaveLength(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 2, 3);
    expect(onRetry).toHaveBeenNthCalledWith(2, 3, 3);
  });

  it('retries 5xx responses', async () => {
    const promise = api.uploadAssetWithRetry(makeFile());

    MockXHR.instances[0].respond(502, 'Bad gateway');
    await vi.advanceTimersByTimeAsync(1_000);
    MockXHR.instances[1].respond(201, JSON.stringify({ id: 'asset-2' }));

    await expect(promise).resolves.toEqual({ id: 'asset-2' });
  });
});

describe('Error classes', () => {
  it('ApiError should have correct properties', () => {
    const error = new ApiError(404, 'Not found');
    expect(error.status).toBe(404);
    expect(error.body).toBe('Not found');
    expect(error.name).toBe('ApiError');
    expect(error.message).toBe('API Error 404: Not found');
  });

  it('PasswordRequiredError should have correct properties', () => {
    const error = new PasswordRequiredError();
    expect(error.name).toBe('PasswordRequiredError');
    expect(error.message).toBe('Password required');
  });
});
