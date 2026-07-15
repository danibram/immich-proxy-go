import { expect, test, type Page, type Request } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import {
  fetchSharedAlbumAssetCount,
  fetchSharedAlbumContext,
  shareApiPath,
  uploadAssetThroughShare,
} from './helpers/api';
import { isIntegrationE2E, seed } from './helpers/env';
import { openShareByKey } from './helpers/share';
import { getUploadFixture } from './helpers/uploadFixtures';

// End-to-end coverage for the guest-upload pipeline: optimistic tiles,
// hash-then-upload dedupe (zero bytes for files the album owner already
// has), offline pause/resume, mixed formats, and — critically — a pin on
// the checksum-probe technique the proxy's /upload-check endpoint relies on
// (Immich's AssetUploadInterceptor short-circuiting duplicates before body
// validation). If an Immich upgrade ever changes that contract, this spec
// is designed to fail loudly.

interface TestUploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

// Decodable PNG with a random tail after IEND: unique checksum per call,
// still thumbnails fine server-side. `padBytes` grows the file so the
// duplicate-flow bytes-saved measurement is meaningful.
function uniquePngFile(name: string, padBytes = 16): TestUploadFile {
  const fixture = getUploadFixture('long', 'png');
  return {
    name,
    mimeType: fixture.mimeType,
    buffer: Buffer.concat([fixture.buffer, randomBytes(padBytes)]),
  };
}

function sha1Hex(buffer: Buffer): string {
  return createHash('sha1').update(buffer).digest('hex');
}

async function openUploadModal(page: Page, shareKey: string) {
  await openShareByKey(page, shareKey);
  await page.getByRole('button', { name: 'Add photos' }).first().click();
  await expect(page.locator('.sheet')).toBeVisible();
}

const tiles = (page: Page) => page.getByTestId('upload-tile');
const tilesWithStatus = (page: Page, status: string) =>
  page.locator(`[data-testid="upload-tile"][data-status="${status}"]`);

test.describe('Upload pipeline', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');

  test('multi-file happy path shows optimistic tiles before completion', async ({ page }) => {
    const shareKey = seed.overrideOnKey();
    test.skip(!shareKey, 'OVERRIDE_ON_SHARE_KEY required');

    // Slow the uploads slightly so the optimistic phase is observable.
    await page.route('**/api/assets', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return route.fallback();
    });

    await openUploadModal(page, shareKey);
    const files = [1, 2, 3, 4].map((i) => uniquePngFile(`happy-${i}.png`));
    await page.locator('input[type="file"]').setInputFiles(files);

    // Optimistic grid: all four tiles appear immediately, before any upload
    // could have completed, together with the aggregate bar.
    await expect(tiles(page)).toHaveCount(4, { timeout: 2_000 });
    await expect(page.getByTestId('upload-aggregate')).toBeVisible();
    expect(await tilesWithStatus(page, 'done').count()).toBe(0);

    // Then everything completes and the batch summary reports it.
    await expect(page.getByText('Clear completed (4)')).toBeVisible({ timeout: 60_000 });
    await expect(tilesWithStatus(page, 'done')).toHaveCount(4);
    await expect(page.getByTestId('upload-summary')).toHaveText('4 uploaded');
  });

  test('re-selecting already-uploaded files transfers zero bytes', async ({ page }) => {
    const shareKey = seed.overrideOnKey();
    test.skip(!shareKey, 'OVERRIDE_ON_SHARE_KEY required');

    const files = [1, 2, 3].map((i) => uniquePngFile(`dup-${i}.png`, 64 * 1024));
    const totalBytes = files.reduce((sum, f) => sum + f.buffer.byteLength, 0);

    // Collect every browser-origin upload POST. Chromium exposes neither
    // postDataBuffer nor sizes().requestBodySize for multipart XHR bodies
    // (both report empty/0 — measured), but the Content-Length header it
    // actually sent is available via allHeaders() and covers payload +
    // multipart framing exactly.
    const uploadRequests: Request[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/api\/assets$/.test(request.url())) {
        uploadRequests.push(request);
      }
    });
    const uploadedBytes = async () => {
      let total = 0;
      for (const request of uploadRequests) {
        const headers = await request.allHeaders();
        total += Number(headers['content-length'] ?? 0);
      }
      return total;
    };

    // Round 1: fresh files upload normally.
    await openUploadModal(page, shareKey);
    await page.locator('input[type="file"]').setInputFiles(files);
    await expect(page.getByText('Clear completed (3)')).toBeVisible({ timeout: 60_000 });
    expect(uploadRequests.length).toBe(3);
    const firstRoundBytes = await uploadedBytes();
    expect(firstRoundBytes).toBeGreaterThan(totalBytes); // payload + multipart framing

    // Round 2: the same files again. The hash → upload-check path must mark
    // them duplicates without a single upload POST leaving the browser.
    await page.getByText('Clear completed (3)').click();
    await page.locator('input[type="file"]').setInputFiles(files);

    await expect(tilesWithStatus(page, 'duplicate')).toHaveCount(3, { timeout: 10_000 });
    await expect(page.getByText('Already in album').first()).toBeVisible();
    await expect(page.getByTestId('upload-summary')).toHaveText('3 already in album');
    expect(uploadRequests.length).toBe(3); // unchanged: zero POSTs in round 2
    expect(await uploadedBytes()).toBe(firstRoundBytes); // zero bytes in round 2

    const savings = `re-selecting 3 files (${totalBytes} payload bytes) caused 0 upload POSTs and 0 bytes on the wire (round 1: 3 POSTs, ${firstRoundBytes} bytes incl. multipart framing)`;
    test.info().annotations.push({ type: 'dedupe-savings', description: savings });
    console.log(`[dedupe-savings] ${savings}`);
  });

  test('offline pauses the queue without failures; online resumes it', async ({
    page,
    context,
  }) => {
    const shareKey = seed.overrideOnKey();
    test.skip(!shareKey, 'OVERRIDE_ON_SHARE_KEY required');

    // Short retry delays so the offline parking happens quickly.
    await page.addInitScript(() => {
      window.localStorage.setItem('ipp:upload-retry-delays-ms', '300,300');
    });

    // Hold the first two upload POSTs so we can cut the network mid-flight.
    const held: Array<() => void> = [];
    let heldCount = 0;
    await page.route('**/api/assets', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      if (heldCount < 2) {
        heldCount += 1;
        await new Promise<void>((resolve) => held.push(resolve));
        return route.abort('failed').catch(() => {});
      }
      return route.fallback();
    });

    await openUploadModal(page, shareKey);
    await page
      .locator('input[type="file"]')
      .setInputFiles([uniquePngFile('offline-1.png'), uniquePngFile('offline-2.png')]);

    await expect
      .poll(() => heldCount, { message: 'both uploads should be in flight' })
      .toBe(2);

    // Wifi drops: banner appears, held requests die, but nothing is marked
    // failed — the files park and wait.
    await context.setOffline(true);
    await expect(page.getByTestId('upload-offline')).toBeVisible({ timeout: 5_000 });
    for (const release of held) release();
    await page.waitForTimeout(1_500); // let the aborts and (offline) retries settle
    await expect(tilesWithStatus(page, 'failed')).toHaveCount(0);
    await expect(page.getByTestId('upload-retry-failed')).toHaveCount(0);

    // Wifi returns: the queue resumes on its own and finishes the batch.
    await context.setOffline(false);
    await expect(page.getByTestId('upload-offline')).toHaveCount(0);
    await expect(page.getByText('Clear completed (2)')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('upload-summary')).toHaveText('2 uploaded');
  });

  test('mixed PNG/JPEG/HEIC batch uploads; undecodable HEIC gets a placeholder tile', async ({
    page,
  }) => {
    const shareKey = seed.overrideOnKey();
    test.skip(!shareKey, 'OVERRIDE_ON_SHARE_KEY required');

    const png = uniquePngFile('mixed.png');
    const jpgFixture = getUploadFixture('long', 'jpg');
    const heicFixture = getUploadFixture('long', 'heic');
    const jpg = {
      name: 'mixed.jpg',
      mimeType: jpgFixture.mimeType,
      buffer: Buffer.concat([jpgFixture.buffer, randomBytes(16)]),
    };
    const heic = {
      name: 'mixed.heic',
      mimeType: heicFixture.mimeType,
      buffer: Buffer.concat([heicFixture.buffer, randomBytes(16)]),
    };

    await openUploadModal(page, shareKey);
    await page.locator('input[type="file"]').setInputFiles([png, jpg, heic]);

    await expect(tiles(page)).toHaveCount(3, { timeout: 2_000 });
    // Chromium cannot decode HEIC: that tile must feature-detect its way to
    // the placeholder. The PNG/JPEG tiles render real previews.
    await expect(
      page.locator('[data-name="mixed.heic"] [data-testid="upload-tile-fallback"]')
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-name="mixed.png"] img.up-tile-thumb')
    ).toBeVisible();

    // All three still upload fine — previewability has nothing to do with
    // uploadability.
    await expect(page.getByText('Clear completed (3)')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('upload-summary')).toHaveText('3 uploaded');
  });

  test('upload-check pins the checksum-probe contract against the running Immich', async ({
    request,
  }) => {
    const shareKey = seed.overrideOnKey();
    test.skip(!shareKey, 'OVERRIDE_ON_SHARE_KEY required');
    const route = { prefix: 'share' as const, identifier: shareKey };

    const file = uniquePngFile('probe-pin.png');
    const checksum = sha1Hex(file.buffer);
    const album = await fetchSharedAlbumContext(request, route);

    // 1. Unknown checksum: exists=false, and — the probe contract — probing
    //    must not create anything server-side.
    let response = await request.post(shareApiPath(route, '/upload-check'), {
      data: { files: [{ name: file.name, checksum }] },
    });
    expect(response.status()).toBe(200);
    let body = (await response.json()) as {
      results: Array<{ exists: boolean; assetId?: string }>;
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].exists).toBe(false);
    expect(await fetchSharedAlbumAssetCount(request, route, album.albumId)).toBe(
      album.assetCount
    );

    // 2. Upload the file for real, then the same checksum must report
    //    exists=true with the uploaded asset's id (the interceptor
    //    short-circuit — this is what the whole dedupe path stands on).
    const uploaded = await uploadAssetThroughShare(request, route, {
      filename: file.name,
      mimeType: file.mimeType,
      buffer: file.buffer,
    });
    response = await request.post(shareApiPath(route, '/upload-check'), {
      data: { files: [{ name: file.name, checksum }] },
    });
    expect(response.status()).toBe(200);
    body = (await response.json()) as typeof body;
    expect(body.results[0].exists).toBe(true);
    expect(body.results[0].assetId).toBe(uploaded.id);

    // 3. Input validation: malformed checksums and oversized lists never
    //    reach Immich.
    response = await request.post(shareApiPath(route, '/upload-check'), {
      data: { files: [{ name: 'x.png', checksum: 'not-a-sha1' }] },
    });
    expect(response.status()).toBe(400);

    const oversized = Array.from({ length: 501 }, (_, i) => ({
      name: `f${i}.png`,
      checksum,
    }));
    response = await request.post(shareApiPath(route, '/upload-check'), {
      data: { files: oversized },
    });
    expect(response.status()).toBe(400);
  });
});
