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

export async function scrollGalleryToEnd(page: Page) {
  await page.getByTestId('share-gallery').evaluate((el) => {
    const scrollParent = el.closest('.album-scroll') as HTMLElement | null;
    (scrollParent ?? el).scrollTop = (scrollParent ?? el).scrollHeight;
  });
}
