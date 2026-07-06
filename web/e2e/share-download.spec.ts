import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type APIRequestContext,
  type Download,
  type Page,
  type Response,
} from '@playwright/test';
import {
  downloadAssetsAsZipThroughShare,
  shareApiPath,
  type ShareRoute,
  uploadAssetThroughShare,
} from './helpers/api';
import { isIntegrationE2E, seed } from './helpers/env';
import { openShareByKey, openShareBySlug, scrollGalleryToEnd } from './helpers/share';
import { getUploadFixture, type FixtureVariant, type UploadFormat } from './helpers/uploadFixtures';
import { unzipEntries } from './helpers/zip';

interface DownloadScenario {
  label: string;
  route: () => ShareRoute;
  fixtureVariant: FixtureVariant;
  missingEnv: string;
}

const scenarios: DownloadScenario[] = [
  {
    label: 'long /share URL',
    route: () => ({ prefix: 'share', identifier: seed.overrideOnKey() }),
    fixtureVariant: 'long',
    missingEnv: 'OVERRIDE_ON_SHARE_KEY required',
  },
  {
    label: 'short /s URL',
    route: () => ({ prefix: 's', identifier: seed.overrideOnSlug() }),
    fixtureVariant: 'short',
    missingEnv: 'OVERRIDE_ON_SHARE_SLUG required',
  },
];

const allFormats: UploadFormat[] = ['png', 'jpg', 'heic'];

/**
 * Render a download body for assertion messages. Short bodies are shown
 * verbatim so an error payload saved as a file (e.g. the 26-byte
 * `{"passwordRequired":true}`) is instantly diagnosable instead of
 * "binary contents differ".
 */
function describeBody(body: Buffer): string {
  if (body.length > 200) return `${body.length} bytes (binary)`;
  return `${body.length} bytes: ${JSON.stringify(body.toString('utf8'))}`;
}

function expectExactBytes(body: Buffer, expected: Buffer, label: string) {
  expect(body.equals(expected), `${label} must preserve the exact original bytes — got ${describeBody(body)}`).toBe(
    true
  );
}

interface UploadedAsset {
  id: string;
  buffer: Buffer;
}

/** Upload this scenario's fixture for a format and return its asset id + bytes. */
async function uploadFormat(
  request: APIRequestContext,
  scenario: DownloadScenario,
  route: ShareRoute,
  format: UploadFormat
): Promise<UploadedAsset> {
  const fixture = getUploadFixture(scenario.fixtureVariant, format);
  const upload = await uploadAssetThroughShare(request, route, {
    ...fixture,
    filename: `${scenario.fixtureVariant}-download.${fixture.extension}`,
  });
  return { id: upload.id, buffer: fixture.buffer };
}

/** Assert a ZIP buffer holds exactly one entry per format with exact bytes. */
function expectZipContents(zip: Buffer, expected: Map<UploadFormat, Buffer>, label: string) {
  expect(zip.length, `${label} must not be an empty/error payload — got ${describeBody(zip)}`).toBeGreaterThan(26);
  const entries = unzipEntries(zip);
  expect(entries.size).toBe(expected.size);

  for (const [format, contents] of expected) {
    const entry = [...entries].find(([filename]) => filename.toLowerCase().endsWith(`.${format}`));
    expect(entry, `${format} entry should exist in ${label}`).toBeTruthy();
    expectExactBytes(entry![1], contents, `${label} entry .${format}`);
  }
}

async function openShareDesktop(page: Page, route: ShareRoute) {
  await page.setViewportSize({ width: 1280, height: 900 });
  if (route.prefix === 'share') {
    await openShareByKey(page, route.identifier);
  } else {
    await openShareBySlug(page, route.identifier);
  }
}

/** Locate the gallery tile of a given asset via its thumbnail URL. */
async function galleryTileFor(page: Page, assetId: string) {
  const tile = page
    .locator('[data-testid="gallery-item"]')
    .filter({ has: page.locator(`img[data-testid="gallery-thumb"][src*="${assetId}"]`) })
    .first();
  if (!(await tile.isVisible().catch(() => false))) {
    await scrollGalleryToEnd(page);
  }
  await expect(tile, `gallery tile for asset ${assetId} should render`).toBeVisible({ timeout: 30_000 });
  await tile.scrollIntoViewIfNeeded();
  return tile;
}

/** Enter selection mode and select the given tiles. */
async function selectTiles(page: Page, tiles: Awaited<ReturnType<typeof galleryTileFor>>[]) {
  await page.getByRole('button', { name: 'Select' }).click();
  for (const tile of tiles) {
    await tile.click();
  }
}

/**
 * Trigger a window.open()-based download and capture the bytes the user
 * really receives — whether the navigation becomes a browser download
 * (Content-Disposition: attachment, attributed to the opener or the popup
 * depending on timing) or an inline render of the asset. Listeners attach at
 * context level BEFORE the trigger so no event can be missed.
 */
async function captureWindowOpenBytes(
  page: Page,
  urlPattern: RegExp,
  trigger: () => Promise<void>
): Promise<Buffer> {
  const context = page.context();
  const cleanups: Array<() => void> = [];

  const bytesPromise = new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`window.open produced neither a download nor a response for ${urlPattern}`)),
      60_000
    );
    cleanups.push(() => clearTimeout(timer));

    const finish = (bytes: Buffer) => {
      clearTimeout(timer);
      resolve(bytes);
    };
    const onDownload = (download: Download) => {
      download
        .path()
        .then((filePath) => readFile(filePath))
        .then(finish)
        .catch((error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    };
    const onResponse = (response: Response) => {
      if (!urlPattern.test(response.url())) return;
      // body() rejects when the navigation turned into a download; the
      // download listener wins in that case.
      response
        .body()
        .then(finish)
        .catch(() => undefined);
    };
    const onPage = (opened: Page) => {
      opened.on('download', onDownload);
      opened.on('response', onResponse);
    };

    page.on('download', onDownload);
    // Some browsers render the asset in the SAME tab (window.open reuse) or
    // inline in the popup — capture the response bytes in those cases too.
    page.on('response', onResponse);
    context.on('page', onPage);
    cleanups.push(() => {
      page.off('download', onDownload);
      page.off('response', onResponse);
      context.off('page', onPage);
    });
  });

  try {
    await trigger();
    return await bytesPromise;
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
}

test.describe('Shared album downloads', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');

  for (const scenario of scenarios) {
    test.describe(scenario.label, () => {
      test(`single-asset API download returns exact PNG, JPG, and HEIC bytes`, async ({ request }) => {
        const route = scenario.route();
        test.skip(!route.identifier, scenario.missingEnv);

        for (const format of allFormats) {
          const uploaded = await uploadFormat(request, scenario, route, format);

          const response = await request.get(shareApiPath(route, `/assets/${uploaded.id}/original`));
          const body = await response.body();
          expect(
            response.status(),
            `GET original ${format} must succeed — got ${response.status()} ${describeBody(body)}`
          ).toBe(200);

          const contentType = response.headers()['content-type'] ?? '';
          expect(
            contentType.startsWith('image/'),
            `${format} download must be served as an image, not ${JSON.stringify(contentType)} (${describeBody(body)})`
          ).toBe(true);

          expectExactBytes(body, uploaded.buffer, `single ${format} download`);
        }
      });

      test(`bulk ZIP download preserves exact PNG, JPG, and HEIC contents`, async ({ request }) => {
        const route = scenario.route();
        test.skip(!route.identifier, scenario.missingEnv);

        const uploadedIds: string[] = [];
        const expected = new Map<UploadFormat, Buffer>();
        for (const format of allFormats) {
          const uploaded = await uploadFormat(request, scenario, route, format);
          uploadedIds.push(uploaded.id);
          expected.set(format, uploaded.buffer);
        }

        const zip = await downloadAssetsAsZipThroughShare(request, route, uploadedIds);
        expectZipContents(zip, expected, 'bulk API ZIP');
      });

      test(`viewer download button saves the exact original file`, async ({ page, request }) => {
        const route = scenario.route();
        test.skip(!route.identifier, scenario.missingEnv);

        const uploaded = await uploadFormat(request, scenario, route, 'jpg');
        await openShareDesktop(page, route);

        const tile = await galleryTileFor(page, uploaded.id);
        await tile.click();
        await expect(page.getByTestId('asset-viewer')).toBeVisible();

        const downloadPromise = page.waitForEvent('download');
        await page.locator('[data-testid="asset-viewer"] a[aria-label="Download"]').click();
        const download = await downloadPromise;

        expect(download.suggestedFilename().toLowerCase()).toMatch(/\.jpe?g$/);
        const saved = await readFile(await download.path());
        expectExactBytes(saved, uploaded.buffer, 'viewer download');
      });

      test(`selecting one photo and downloading yields the exact original file`, async ({ page, request }) => {
        const route = scenario.route();
        test.skip(!route.identifier, scenario.missingEnv);

        const uploaded = await uploadFormat(request, scenario, route, 'png');
        await openShareDesktop(page, route);

        const tile = await galleryTileFor(page, uploaded.id);
        await selectTiles(page, [tile]);

        const bytes = await captureWindowOpenBytes(page, /\/assets\/[0-9a-f-]+\/original/, () =>
          page.getByRole('button', { name: 'Download (1)' }).click()
        );
        expectExactBytes(bytes, uploaded.buffer, 'single-selection download');
      });

      test(`selecting several photos downloads a valid ZIP with exact contents`, async ({ page, request }) => {
        const route = scenario.route();
        test.skip(!route.identifier, scenario.missingEnv);

        const expected = new Map<UploadFormat, Buffer>();
        const ids: string[] = [];
        for (const format of ['png', 'jpg'] as UploadFormat[]) {
          const uploaded = await uploadFormat(request, scenario, route, format);
          expected.set(format, uploaded.buffer);
          ids.push(uploaded.id);
        }

        await openShareDesktop(page, route);

        const tiles = [];
        for (const id of ids) {
          tiles.push(await galleryTileFor(page, id));
        }
        await selectTiles(page, tiles);

        const zip = await captureWindowOpenBytes(page, /\/download\/jobs\/[^/]+\/file/, () =>
          page.getByRole('button', { name: `Download (${ids.length})` }).click()
        );
        expectZipContents(zip, expected, 'UI ZIP');
      });
    });
  }
});
