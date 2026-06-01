import { expect, test } from '@playwright/test';
import { fetchSharedLink } from './helpers/api';
import { isIntegrationE2E, requireEnv, seed } from './helpers/env';
import {
  countLoadedThumbs,
  openShareByKey,
  openShareBySlug,
  scrollGalleryToEnd,
  trackThumbnailRequests,
  waitForGallery,
} from './helpers/share';

test.describe('Share gallery (integration)', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL (docker compose stack)');

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test('loads album via /share/{key} with expected asset count', async ({ page, request }) => {
    const shareKey = requireEnv('DEFAULT_SHARE_KEY');
    const link = await fetchSharedLink(request, shareKey);

    await openShareByKey(page, shareKey);

    await expect(page.getByTestId('album-title')).toHaveText(link.albumName);
    await expect(page.getByTestId('album-meta')).toContainText(`${link.assetCount} items`);
    await expect(page.getByTestId('gallery-item')).toHaveCount(link.assetCount);
    expect(await page.locator('.grp').count()).toBeGreaterThan(1);
  });

  test('loads album via /s/{slug}', async ({ page, request }) => {
    const slug = requireEnv('DEFAULT_SHARE_SLUG');
    const shareKey = seed.shareKey();
    const link = await fetchSharedLink(request, shareKey!);

    await openShareBySlug(page, slug);
    await expect(page.getByTestId('album-title')).toHaveText(link.albumName);
  });

  test('lazy-loads thumbnails as user scrolls', async ({ page }) => {
    const shareKey = requireEnv('DEFAULT_SHARE_KEY');
    const thumbs = trackThumbnailRequests(page);

    try {
      await openShareByKey(page, shareKey);

      const totalItems = await page.getByTestId('gallery-item').count();
      test.skip(totalItems < 10, 'Need many assets for lazy-load test');

      const initialThumbs = await countLoadedThumbs(page);
      expect(initialThumbs).toBeGreaterThan(0);
      expect(initialThumbs).toBeLessThan(totalItems);

      await scrollGalleryToEnd(page);
      await expect
        .poll(async () => countLoadedThumbs(page), { timeout: 10_000 })
        .toBeGreaterThan(initialThumbs);
      expect(thumbs.urls.length).toBeGreaterThan(initialThumbs);
    } finally {
      thumbs.stop();
    }
  });

  test('caps concurrent thumbnail work during a fast scroll', async ({ page }) => {
    const shareKey = requireEnv('DEFAULT_SHARE_KEY');
    let activeRequests = 0;
    let maxActiveRequests = 0;

    await page.route('**/thumbnail?size=preview', async (route) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);

      await page.waitForTimeout(150);

      try {
        await route.continue();
      } finally {
        activeRequests -= 1;
      }
    });

    await openShareByKey(page, shareKey);

    const totalItems = await page.getByTestId('gallery-item').count();
    test.skip(totalItems < 10, 'Need many assets for fast-scroll test');

    await scrollGalleryToEnd(page);
    await page.waitForTimeout(400);

    expect(maxActiveRequests).toBeLessThanOrEqual(4);
  });

  test('opens viewer, navigates with keyboard, and closes', async ({ page }) => {
    const shareKey = requireEnv('DEFAULT_SHARE_KEY');
    await openShareByKey(page, shareKey);

    await page.getByTestId('gallery-item').first().click();
    await expect(page.getByTestId('asset-viewer')).toBeVisible();
    await expect(page.getByTestId('viewer-count')).toContainText('1 /');

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('viewer-count')).toContainText('2 /');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('asset-viewer')).toBeHidden();
  });

  test('plays video asset in viewer', async ({ page }) => {
    const shareKey = requireEnv('DEFAULT_SHARE_KEY');
    await openShareByKey(page, shareKey);

    const videoTile = page.locator('[data-testid="gallery-item"][data-asset-type="VIDEO"]').first();
    await expect(videoTile).toBeVisible();
    await videoTile.click();

    await expect(page.getByTestId('asset-viewer')).toBeVisible();
    const video = page.getByTestId('viewer-video');
    await expect(video).toBeVisible();

    const src = await video.getAttribute('src');
    expect(src).toMatch(/\/share\/.+\/api\/assets\/.+\/video/);

    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.readyState), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(1);
  });
});
