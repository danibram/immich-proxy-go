import { expect, test, type Page } from '@playwright/test';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const assets = Array.from({ length: 16 }, (_, index) => ({
  id: `${index + 1}`.repeat(8) + '-1111-4111-8111-111111111111',
  type: 'IMAGE',
  originalFileName: `disney-${index + 1}.jpg`,
  ratio: [1.5, 0.75, 1, 1.8][index % 4],
  fileCreatedAt: `2026-07-${String(11 - (index % 2)).padStart(2, '0')}T10:00:00Z`,
  localDateTime: `2026-07-${String(11 - (index % 2)).padStart(2, '0')}T10:00:00Z`,
}));

async function mockAlbum(page: Page) {
  await page.route('**/share/demo/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/shared-links/me')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'share-id',
          key: 'demo',
          type: 'ALBUM',
          allowDownload: true,
          allowUpload: true,
          showMetadata: false,
          downloadQuality: 'original',
          zoomQuality: 'preview',
          album: {
            id: 'album-id',
            albumName: 'Disney Paris',
            assetCount: assets.length,
            assets,
          },
          assets: [],
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
}

test('mobile header keeps album context and exposes photo-first actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAlbum(page);
  await page.goto('/share/demo');

  await expect(page.getByRole('heading', { name: 'Disney Paris' })).toBeVisible();
  await expect(page.getByTestId('album-meta')).toContainText('16 items');
  await expect(page.getByTestId('album-meta')).toContainText('Jul 2026');
  await expect(page.getByRole('button', { name: 'Select' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add photos' })).toBeVisible();
  await expect(page.locator('.fab')).toHaveCount(0);

  // No overflow menu and no standalone download-all: downloads live in
  // selection mode (select icon -> select all -> download).
  await expect(page.getByLabel('More actions')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download all' })).toHaveCount(0);

  await page.locator('.album-scroll').evaluate((element) => element.scrollTo({ top: 80 }));
  await expect(page.locator('.topbar')).toHaveAttribute('data-collapsed', '1');
  await expect(page.getByRole('button', { name: 'Select' })).toHaveCount(1);
});

test('mobile hero actions are actually tappable under the sticky topbar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAlbum(page);
  await page.goto('/share/demo');

  const addButton = page.getByRole('button', { name: 'Add photos' });
  await expect(addButton).toBeVisible();
  // The empty expanded topbar overlays the hero row; it must not swallow
  // the tap (regression: the '+' did nothing on phones).
  const receives = await addButton.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(receives).toBe(true);
  await addButton.click();
  await expect(page.getByTestId('upload-modal')).toBeVisible();
});

test('desktop header stays compact; downloads flow through selection', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockAlbum(page);
  await page.goto('/share/demo');

  const header = page.locator('.topbar');
  await expect(header).toHaveCSS('height', '56px');
  await expect(page.getByTestId('album-title')).toHaveText('Disney Paris');
  await expect(page.getByRole('button', { name: 'Select' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add photos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download all' })).toHaveCount(0);
  await expect(page.getByLabel('More actions')).toHaveCount(0);

  // The download path: enter selection, select everything, download appears.
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(page.getByRole('button', { name: /Download \(16\)/ })).toBeVisible();
});

test('desktop Add photos opens the upload sheet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockAlbum(page);
  await page.goto('/share/demo');

  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('upload-modal')).toBeVisible();
  await expect(page.getByRole('heading', { name: /upload/i })).toBeVisible();
});
