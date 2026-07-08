import { expect, type Page } from '@playwright/test';

export async function waitForGallery(page: Page) {
  await expect(page.getByTestId('share-gallery')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('gallery-item').first()).toBeVisible({ timeout: 60_000 });
}

export async function openShareByKey(page: Page, shareKey: string) {
  await page.goto(`/share/${shareKey}`);
  await waitForGallery(page);
}

export async function openShareBySlug(page: Page, slug: string) {
  await page.goto(`/s/${slug}`);
  await waitForGallery(page);
}

export async function expectPasswordGate(page: Page) {
  await expect(page.getByRole('heading', { name: 'Password required' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('share-gallery')).toHaveCount(0);
}

export async function unlockProtectedShare(page: Page, password: string) {
  await expectPasswordGate(page);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Unlock album' }).click();
  await waitForGallery(page);
}

export function trackThumbnailRequests(page: Page) {
  const urls: string[] = [];
  const handler = (req: { url: () => string }) => {
    if (req.url().includes('/thumbnail')) {
      urls.push(req.url());
    }
  };
  page.on('request', handler);
  return {
    urls,
    stop: () => page.off('request', handler),
  };
}

export async function countLoadedThumbs(page: Page) {
  return page.getByTestId('gallery-thumb').count();
}

/** Thumbnails inside the scroll viewport that have finished decoding. */
export async function countVisibleLoadedThumbs(page: Page) {
  return page.evaluate(() => {
    const scroll = document.querySelector('.album-scroll');
    if (!scroll) return 0;
    const bounds = scroll.getBoundingClientRect();
    let loaded = 0;
    for (const img of document.querySelectorAll('img[data-testid="gallery-thumb"]')) {
      const rect = img.getBoundingClientRect();
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue;
      const el = img as HTMLImageElement;
      if (el.complete && el.naturalWidth > 0) loaded++;
    }
    return loaded;
  });
}

export async function scrollGalleryToEnd(page: Page) {
  await page.getByTestId('share-gallery').evaluate((el) => {
    const scrollParent = el.closest('.album-scroll') as HTMLElement | null;
    (scrollParent ?? el).scrollTop = (scrollParent ?? el).scrollHeight;
  });
}
