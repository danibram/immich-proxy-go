import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, PasswordRequiredError } from './client';

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
