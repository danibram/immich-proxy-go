import { expect, test, type Page, type Route } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { isIntegrationE2E, seed } from './helpers/env';
import { openShareByKey } from './helpers/share';
import { getUploadFixture } from './helpers/uploadFixtures';

// Fault-injection specs for the upload pipeline, born from a production
// incident: a family on bad hotel wifi had an upload stall forever, which
// froze the whole sequential queue. The client now aborts stalled uploads
// via a progress watchdog and retries transient failures with backoff,
// while permanent failures (413, ...) surface immediately and never block
// the next file.

// Shrink the client's watchdog/backoff (localStorage test hooks read by
// web/src/api/client.ts) so a "stall" costs ~1.5s instead of 30s, and the
// retrying label stays visible long enough to assert (2s backoff).
const STALL_MS = 1_500;
const RETRY_DELAYS_MS = '2000,2000';

function uniquePngFile(name: string) {
  // Trailing random bytes (after IEND) keep the PNG decodable while giving
  // every test file a unique checksum, so Immich's server-side dedupe of
  // earlier spec runs can't turn our 201s into duplicate responses.
  const fixture = getUploadFixture('long', 'png');
  return {
    name,
    mimeType: fixture.mimeType,
    buffer: Buffer.concat([fixture.buffer, randomBytes(16)]),
  };
}

async function openUploadModal(page: Page, shareKey: string) {
  await openShareByKey(page, shareKey);
  // Desktop topbar renders a "Upload" text button; the mobile hero uses
  // "Upload items". Match either so the spec survives viewport changes.
  await page
    .getByRole('button', { name: /^Upload( items)?$/ })
    .first()
    .click();
  await expect(page.locator('.sheet')).toBeVisible();
}

test.describe('Upload resilience', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ stallMs, retryDelays }) => {
        window.localStorage.setItem('ipp:upload-stall-ms', String(stallMs));
        window.localStorage.setItem('ipp:upload-retry-delays-ms', retryDelays);
      },
      { stallMs: STALL_MS, retryDelays: RETRY_DELAYS_MS }
    );
  });

  test('watchdog aborts a stalled upload, the retry succeeds and the queue proceeds', async ({
    page,
  }) => {
    const shareKey = seed.overrideOnKey();
    test.skip(!shareKey, 'OVERRIDE_ON_SHARE_KEY required');

    let uploadPosts = 0;
    const stalledRoutes: Route[] = [];
    await page.route('**/api/assets', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      uploadPosts += 1;
      if (uploadPosts === 1) {
        // Stall: never answer. The client watchdog must abort this attempt.
        stalledRoutes.push(route);
        return;
      }
      return route.fallback();
    });

    await openUploadModal(page, shareKey);
    await page
      .locator('input[type="file"]')
      .setInputFiles([uniquePngFile('stall-first.png'), uniquePngFile('stall-second.png')]);

    // The watchdog abort schedules a retry: the UI must say so honestly.
    await expect(page.getByTestId('upload-retrying')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('upload-retrying')).toHaveText('Retrying (2/3)…');

    // Retry of file 1 succeeds and the queue moves on to file 2.
    await expect(page.getByText('Clear completed (2)')).toBeVisible({ timeout: 30_000 });
    expect(uploadPosts).toBe(3); // stalled attempt + successful retry + second file
    await expect(page.getByTestId('upload-retry-failed')).toHaveCount(0);

    // Cleanly abort the parked route so teardown doesn't wait on it.
    for (const route of stalledRoutes) {
      await route.abort('failed').catch(() => {});
    }
  });

  test('a permanent 413 fails fast, the next file still uploads, and retry-failed re-attempts', async ({
    page,
  }) => {
    const shareKey = seed.overrideOnKey();
    test.skip(!shareKey, 'OVERRIDE_ON_SHARE_KEY required');

    let uploadPosts = 0;
    await page.route('**/api/assets', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      uploadPosts += 1;
      if (uploadPosts === 1) {
        // Permanent failure: must NOT be retried automatically.
        return route.fulfill({ status: 413, body: 'File too large. Maximum size is 100 MB' });
      }
      return route.fallback();
    });

    await openUploadModal(page, shareKey);
    await page
      .locator('input[type="file"]')
      .setInputFiles([uniquePngFile('too-big.png'), uniquePngFile('fine.png')]);

    // First file fails permanently, second file completes regardless.
    await expect(page.getByText(/API Error 413/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Clear completed (1)')).toBeVisible({ timeout: 30_000 });
    // Exactly one POST per file: no automatic retry of the 413.
    expect(uploadPosts).toBe(2);

    // The retry affordance re-queues the failed file; this time it passes.
    const retryButton = page.getByTestId('upload-retry-failed');
    await expect(retryButton).toHaveText(/Retry failed \(1\)/);
    await retryButton.click();

    await expect(page.getByText('Clear completed (2)')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('upload-retry-failed')).toHaveCount(0);
    expect(uploadPosts).toBe(3);
  });
});
