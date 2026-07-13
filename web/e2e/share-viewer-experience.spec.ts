import { expect, test } from '@playwright/test';

const assetOne = '11111111-1111-4111-8111-111111111111';
const assetTwo = '22222222-2222-4222-8222-222222222222';

test.use({ colorScheme: 'dark' });

test('deep link opens viewer, zoom requests fullsize, and Back returns to gallery', async ({ page }) => {
  const requestedSizes: string[] = [];
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  await page.route('**/share/demo/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/shared-links/me')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'share-id',
          key: 'demo',
          type: 'INDIVIDUAL',
          allowDownload: true,
          allowUpload: false,
          showMetadata: false,
          downloadQuality: 'original',
          zoomQuality: 'fullsize',
          assets: [
            {
              id: assetOne,
              type: 'IMAGE',
              originalFileName: 'one.jpg',
              ratio: 1.5,
              fileCreatedAt: '2026-07-13T10:00:00Z',
              localDateTime: '2026-07-13T10:00:00Z',
            },
            {
              id: assetTwo,
              type: 'IMAGE',
              originalFileName: 'two.jpg',
              ratio: 1.5,
              fileCreatedAt: '2026-07-12T10:00:00Z',
              localDateTime: '2026-07-12T10:00:00Z',
            },
          ],
        }),
      });
      return;
    }
    if (url.pathname.includes('/thumbnail.')) {
      requestedSizes.push(url.searchParams.get('size') ?? '');
      await route.fulfill({ contentType: 'image/png', body: png });
      return;
    }
    await route.fulfill({ status: 404 });
  });

  await page.goto(`/share/demo#${assetOne}`);
  await expect(page.getByTestId('asset-viewer')).toBeVisible();
  await expect(page.locator('.album')).toHaveAttribute('data-theme', 'dark');
  await expect(page).toHaveURL(new RegExp(`#${assetOne}$`));

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('.vw-stage')).toHaveClass(/is-zoomed/);
  await expect.poll(() => requestedSizes).toContain('fullsize');

  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole('button', { name: 'Exit fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);

  await page.goBack();
  await expect(page.getByTestId('asset-viewer')).toBeHidden();
  await expect(page).toHaveURL(/\/share\/demo$/);
  await expect(page.getByTestId('share-gallery')).toBeVisible();
});

test('browser Back steps through viewed images before closing the viewer', async ({ page }) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  await page.route('**/share/demo/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/shared-links/me')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'share-id',
          key: 'demo',
          type: 'INDIVIDUAL',
          allowDownload: true,
          allowUpload: false,
          showMetadata: false,
          downloadQuality: 'original',
          zoomQuality: 'preview',
          assets: [
            {
              id: assetOne,
              type: 'IMAGE',
              originalFileName: 'one.jpg',
              ratio: 1.5,
              fileCreatedAt: '2026-07-13T10:00:00Z',
              localDateTime: '2026-07-13T10:00:00Z',
            },
            {
              id: assetTwo,
              type: 'IMAGE',
              originalFileName: 'two.jpg',
              ratio: 1.5,
              fileCreatedAt: '2026-07-12T10:00:00Z',
              localDateTime: '2026-07-12T10:00:00Z',
            },
          ],
        }),
      });
      return;
    }
    if (url.pathname.includes('/thumbnail.')) {
      await route.fulfill({ contentType: 'image/png', body: png });
      return;
    }
    await route.fulfill({ status: 404 });
  });

  await page.goto(`/share/demo#${assetOne}`);
  await expect(page.getByTestId('asset-viewer')).toBeVisible();
  await expect(page.getByTestId('viewer-count')).toHaveText('1 / 2');

  // Navigating to the second image creates its own history entry.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('viewer-count')).toHaveText('2 / 2');
  await expect(page).toHaveURL(new RegExp(`#${assetTwo}$`));

  // Back returns to the previously viewed image, not the gallery.
  await page.goBack();
  await expect(page.getByTestId('asset-viewer')).toBeVisible();
  await expect(page.getByTestId('viewer-count')).toHaveText('1 / 2');
  await expect(page).toHaveURL(new RegExp(`#${assetOne}$`));

  // Forward re-enters the later entry.
  await page.goForward();
  await expect(page.getByTestId('viewer-count')).toHaveText('2 / 2');

  // Closing with X after navigating unwinds every image entry in one jump:
  // viewer closed, gallery visible, no hash residue in the URL.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('asset-viewer')).toBeHidden();
  await expect(page).toHaveURL(/\/share\/demo$/);
  await expect(page.getByTestId('share-gallery')).toBeVisible();
});

test('grid loads thumbnails, viewer shows an instant poster then the preview', async ({ page }) => {
  const requested: Array<{ size: string; retry: boolean }> = [];
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  // Hold preview responses until released so the poster is observable.
  let releasePreview: () => void = () => {};
  const previewGate = new Promise<void>((resolve) => (releasePreview = resolve));

  await page.route('**/share/demo/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/shared-links/me')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'share-id',
          key: 'demo',
          type: 'INDIVIDUAL',
          allowDownload: true,
          allowUpload: false,
          showMetadata: false,
          downloadQuality: 'original',
          zoomQuality: 'preview',
          assets: [
            {
              id: assetOne,
              type: 'IMAGE',
              originalFileName: 'one.jpg',
              ratio: 1.5,
              fileCreatedAt: '2026-07-13T10:00:00Z',
              localDateTime: '2026-07-13T10:00:00Z',
            },
          ],
        }),
      });
      return;
    }
    if (url.pathname.includes('/thumbnail.')) {
      const size = url.searchParams.get('size') ?? '';
      requested.push({ size, retry: url.searchParams.has('retry') });
      if (size === 'preview') await previewGate;
      await route.fulfill({ contentType: 'image/png', body: png });
      return;
    }
    await route.fulfill({ status: 404 });
  });

  await page.goto('/share/demo');
  await expect(page.getByTestId('share-gallery')).toBeVisible();

  // Grid tiles request the small webp thumbnail, never preview.
  await expect.poll(() => requested.length).toBeGreaterThan(0);
  expect(requested.every((r) => r.size === 'thumbnail')).toBe(true);

  // Opening the viewer shows the poster instantly while preview is in flight.
  await page.getByTestId('gallery-item').first().click();
  await expect(page.getByTestId('asset-viewer')).toBeVisible();
  await expect(page.getByTestId('viewer-poster')).toBeVisible();
  await expect.poll(() => requested.some((r) => r.size === 'preview')).toBe(true);

  // Once the preview arrives the poster layer is removed.
  releasePreview();
  await expect(page.getByTestId('viewer-poster')).toBeHidden();
  // Clean first-attempt URLs carry no retry marker (CDN cacheability).
  expect(requested.every((r) => !r.retry)).toBe(true);
});

test('a failed tile retries once with a retry marker and then recovers', async ({ page }) => {
  const thumbAttempts: string[] = [];
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  await page.route('**/share/demo/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/shared-links/me')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'share-id',
          key: 'demo',
          type: 'INDIVIDUAL',
          allowDownload: true,
          allowUpload: false,
          showMetadata: false,
          downloadQuality: 'original',
          zoomQuality: 'preview',
          assets: [
            {
              id: assetOne,
              type: 'IMAGE',
              originalFileName: 'one.jpg',
              ratio: 1.5,
              fileCreatedAt: '2026-07-13T10:00:00Z',
              localDateTime: '2026-07-13T10:00:00Z',
            },
          ],
        }),
      });
      return;
    }
    if (url.pathname.includes('/thumbnail.')) {
      thumbAttempts.push(url.search);
      // Transient blip: every clean first-attempt URL fails; only the marked
      // retry succeeds. (Robust against tile remounts during initial layout
      // measurement, which restart the ladder with a clean URL.)
      if (url.searchParams.has('retry')) {
        await route.fulfill({ contentType: 'image/png', body: png });
      } else {
        await route.fulfill({ status: 502, body: 'upstream unavailable' });
      }
      return;
    }
    await route.fulfill({ status: 404 });
  });

  await page.goto('/share/demo');
  await expect(page.getByTestId('share-gallery')).toBeVisible();

  // The tile ends up loaded despite the failed first attempt(s)...
  const thumb = page.getByTestId('gallery-thumb');
  await expect
    .poll(() => thumb.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
      timeout: 10_000,
    })
    .toBe(true);

  // ...and recovery came through a marked retry URL, while first attempts
  // stayed clean (CDN cacheability).
  expect(thumbAttempts[0]).not.toContain('retry=1');
  expect(thumbAttempts.some((search) => search.includes('retry=1'))).toBe(true);
  await expect(page.getByTestId('gallery-thumb-broken')).toHaveCount(0);
});

test('fast consecutive swipes each advance one image', async ({ page }) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const assetThree = '33333333-3333-4333-8333-333333333333';

  await page.route('**/share/demo/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/shared-links/me')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'share-id',
          key: 'demo',
          type: 'INDIVIDUAL',
          allowDownload: true,
          allowUpload: false,
          showMetadata: false,
          downloadQuality: 'original',
          zoomQuality: 'preview',
          assets: [assetOne, assetTwo, assetThree].map((id, i) => ({
            id,
            type: 'IMAGE',
            originalFileName: `${i}.jpg`,
            ratio: 1.5,
            fileCreatedAt: `2026-07-1${3 - i}T10:00:00Z`,
            localDateTime: `2026-07-1${3 - i}T10:00:00Z`,
          })),
        }),
      });
      return;
    }
    if (url.pathname.includes('/thumbnail.')) {
      await route.fulfill({ contentType: 'image/png', body: png });
      return;
    }
    await route.fulfill({ status: 404 });
  });

  await page.goto(`/share/demo#${assetOne}`);
  await expect(page.getByTestId('asset-viewer')).toBeVisible();
  await expect(page.getByTestId('viewer-count')).toHaveText('1 / 3');

  // Two rapid drags with no pause for the 350ms slide animation between
  // them: the second gesture starts while the first step is still animating.
  const stage = page.locator('.vw-stage');
  const box = (await stage.boundingBox())!;
  const cy = box.y + box.height / 2;
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(box.x + box.width * 0.6, cy);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, cy, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(50);
  }

  // Both swipes must land: previously the second overwrote the first's
  // pending step and killed its fallback timer, advancing only one image.
  await expect(page.getByTestId('viewer-count')).toHaveText('3 / 3');
});
