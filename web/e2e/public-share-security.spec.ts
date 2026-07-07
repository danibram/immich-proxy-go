import { expect, test } from '@playwright/test';
import { isIntegrationE2E, seed } from './helpers/env';

test.describe('Public Share Security', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');
  test.skip(!seed.shareKey(), 'DEFAULT_SHARE_KEY is required');
  test.skip(!seed.privateAlbumId(), 'PRIVATE_ALBUM_ID is required');

  const shareKey = () => seed.shareKey()!;
  const privateAlbumId = () => seed.privateAlbumId()!;

  test('public share loads but private album is not accessible', async ({ page }) => {
    await page.goto(`/share/${shareKey()}`);
    await expect(page.locator('body')).toBeVisible();

    const publicRes = await page.request.get(`/share/${shareKey()}/api/shared-links/me`);
    expect(publicRes.status()).toBe(200);
    const publicJson = await publicRes.json();
    expect(publicJson.type).toBe('ALBUM');

    const privateRes = await page.request.get(`/share/${shareKey()}/api/albums/${privateAlbumId()}`);
    expect(privateRes.status()).toBe(404);
  });

  // A valid share key must not grant access to an asset outside its share.
  // Immich enforces asset membership; the proxy must surface a uniform 404
  // across every per-asset endpoint without leaking upstream error phrasing.
  test('a foreign asset id is not reachable through a valid share key', async ({ page }) => {
    const foreign = '11111111-2222-3333-4444-555555555555';
    const endpoints = [
      `/api/assets/${foreign}`,
      `/api/assets/${foreign}/original`,
      `/api/assets/${foreign}/thumbnail?size=thumbnail`,
      `/api/assets/${foreign}/thumbnail.webp?size=thumbnail`,
      `/api/assets/${foreign}/video/playback`,
    ];

    for (const ep of endpoints) {
      const res = await page.request.get(`/share/${shareKey()}${ep}`);
      expect(res.status(), `${ep} must not expose data (no 200) and must not 500`).toBe(404);
      const body = await res.text();
      expect(body.toLowerCase(), `${ep} must not leak upstream internals`).not.toContain('asset.');
    }
  });
});
