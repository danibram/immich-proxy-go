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
});
