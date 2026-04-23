import { expect, test } from '@playwright/test';

const shareKey = process.env.SHARE_KEY;
const privateAlbumId = process.env.PRIVATE_ALBUM_ID;

test.describe('Public Share Security', () => {
  test.skip(!shareKey, 'SHARE_KEY is required');
  test.skip(!privateAlbumId, 'PRIVATE_ALBUM_ID is required');

  test('public share loads but private album is not accessible', async ({ page }) => {
    await page.goto(`/share/${shareKey}`);
    await expect(page.locator('body')).toBeVisible();

    const publicRes = await page.request.get(`/share/${shareKey}/api/shared-links/me`);
    expect(publicRes.status()).toBe(200);
    const publicJson = await publicRes.json();
    expect(publicJson.type).toBe('ALBUM');

    const privateRes = await page.request.get(`/share/${shareKey}/api/albums/${privateAlbumId}`);
    expect(privateRes.status()).toBe(404);
  });
});
