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
