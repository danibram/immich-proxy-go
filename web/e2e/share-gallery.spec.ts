import { expect, test } from '@playwright/test';
import { fetchSharedLink } from './helpers/api';
import { isIntegrationE2E, requireEnv, seed } from './helpers/env';
import {
  countLoadedThumbs,
  countVisibleLoadedThumbs,
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

    // The gallery virtualizes rows: only the window around the viewport is
    // in the DOM, never more than the album itself.
    const rendered = await page.getByTestId('gallery-item').count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThanOrEqual(link.assetCount);
    expect(await page.locator('.grp').count()).toBeGreaterThan(1);

    // Every asset stays reachable: scrolling to the end renders and loads
    // tiles at the bottom of the album.
    await scrollGalleryToEnd(page);
    await expect
      .poll(async () => countVisibleLoadedThumbs(page), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  test('loads album via /s/{slug}', async ({ page, request }) => {
    const slug = requireEnv('DEFAULT_SHARE_SLUG');
    const shareKey = seed.shareKey();
    const link = await fetchSharedLink(request, shareKey!);

    await openShareBySlug(page, slug);
    await expect(page.getByTestId('album-title')).toHaveText(link.albumName);
  });

  test('lazy-loads thumbnails as user scrolls', async ({ page, request }) => {
    const shareKey = requireEnv('DEFAULT_SHARE_KEY');
    const link = await fetchSharedLink(request, shareKey);
    const thumbs = trackThumbnailRequests(page);

    try {
      await openShareByKey(page, shareKey);
      test.skip(link.assetCount < 10, 'Need many assets for lazy-load test');

      // Only the virtual window loads on open, not the whole album.
      await expect.poll(async () => countLoadedThumbs(page)).toBeGreaterThan(0);
      const initialRequests = new Set(thumbs.urls).size;
      expect(initialRequests).toBeGreaterThan(0);
      expect(initialRequests).toBeLessThan(link.assetCount);

      // Scrolling to the end pulls in assets that were never requested
      // before, and the viewport ends up fully loaded.
      await scrollGalleryToEnd(page);
      await expect
        .poll(async () => new Set(thumbs.urls).size, { timeout: 10_000 })
        .toBeGreaterThan(initialRequests);
      await expect
        .poll(async () => countVisibleLoadedThumbs(page), { timeout: 10_000 })
        .toBeGreaterThan(0);
    } finally {
      thumbs.stop();
    }
  });

  test('bounds thumbnail work to the virtual window during a fast scroll', async ({ page, request }) => {
    const shareKey = requireEnv('DEFAULT_SHARE_KEY');
    const link = await fetchSharedLink(request, shareKey);

    // Mount = load: there is no client-side request queue anymore, the
    // virtual window itself is the bound. A full-album teleport must not
    // re-request tiles (each URL at most once) and must keep the DOM to
    // the window, not the album.
    const thumbs = trackThumbnailRequests(page);

    try {
      await openShareByKey(page, shareKey);
      test.skip(link.assetCount < 10, 'Need many assets for fast-scroll test');

      await scrollGalleryToEnd(page);
      await page.waitForTimeout(600);

      const counts = new Map<string, number>();
      for (const url of thumbs.urls) counts.set(url, (counts.get(url) ?? 0) + 1);
      const repeated = [...counts.entries()].filter(([, n]) => n > 1);
      expect(repeated).toEqual([]);

      // Total work is bounded by the album (each asset at most once)...
      expect(counts.size).toBeLessThanOrEqual(link.assetCount);
      // ...and the DOM stays a window, it never accumulates every tile.
      const mounted = await page.getByTestId('gallery-item').count();
      expect(mounted).toBeLessThan(link.assetCount);
    } finally {
      thumbs.stop();
    }
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

  test('video playback honours Range requests with 206 Partial Content', async ({ page }) => {
    const shareKey = requireEnv('DEFAULT_SHARE_KEY');
    await openShareByKey(page, shareKey);

    const videoTile = page.locator('[data-testid="gallery-item"][data-asset-type="VIDEO"]').first();
    await expect(videoTile).toBeVisible();
    await videoTile.click();
    const src = await page.getByTestId('viewer-video').getAttribute('src');
    expect(src).toBeTruthy();

    // Seeking depends on the proxy forwarding Range upstream and passing the
    // 206 + Content-Range back. page.request shares the browser context's
    // cookies, and (unlike a document navigation) is not blocked by the
    // hotlink guard.
    const videoUrl = new URL(src!, page.url()).toString();
    const response = await page.request.get(videoUrl, {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(response.status()).toBe(206);
    expect(response.headers()['content-range']).toMatch(/^bytes 0-1023\//);
    expect(Buffer.byteLength(await response.body())).toBe(1024);
  });

  test('grid tiles load the small thumbnail size, not preview', async ({ page }) => {
    const shareKey = requireEnv('DEFAULT_SHARE_KEY');
    const thumbs = trackThumbnailRequests(page);

    try {
      await openShareByKey(page, shareKey);
      await expect.poll(async () => countLoadedThumbs(page)).toBeGreaterThan(0);

      const gridRequests = thumbs.urls.filter((url) => url.includes('/thumbnail.'));
      expect(gridRequests.length).toBeGreaterThan(0);
      for (const url of gridRequests) {
        expect(new URL(url).searchParams.get('size')).toBe('thumbnail');
      }
    } finally {
      thumbs.stop();
    }
  });
});
