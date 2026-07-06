import { expect, test } from '@playwright/test';
import { shareApiPath, type ShareRoute } from './helpers/api';
import { isIntegrationE2E, requireEnv, seed } from './helpers/env';
import { openShareByKey } from './helpers/share';

/**
 * Asset-details endpoint used by the viewer's info sheet. On Immich v3 the
 * album listing carries no EXIF, so the proxy exposes GET /assets/{id} with
 * the same sanitization rules as the listing (GPS always stripped, EXIF
 * removed entirely for metadata-off shares).
 */
test.describe('Shared asset info', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');

  test('metadata-on share exposes sanitized EXIF details', async ({ request }) => {
    const route: ShareRoute = { prefix: 'share', identifier: requireEnv('DEFAULT_SHARE_KEY') };
    const assetId = requireEnv('FIRST_ASSET_ID');

    const response = await request.get(shareApiPath(route, `/assets/${assetId}`));
    expect(response.status()).toBe(200);
    const asset = await response.json();

    expect(asset.id).toBe(assetId);
    expect(asset.originalFileName, 'viewer needs the original filename').toBeTruthy();
    expect(asset.exifInfo, 'metadata-on share must include EXIF').toBeTruthy();
    expect(asset.exifInfo.exifImageWidth).toBeGreaterThan(0);
    expect(asset.exifInfo.latitude ?? 0, 'GPS must never leak').toBe(0);
    expect(asset.exifInfo.longitude ?? 0, 'GPS must never leak').toBe(0);
    expect(asset.originalPath ?? '', 'internal paths must never leak').toBe('');
    expect(asset.checksum ?? '', 'checksums must never leak').toBe('');
  });

  test('metadata-off share strips EXIF from asset details', async ({ request }) => {
    const key = seed.metadataOffKey();
    test.skip(!key, 'METADATA_OFF_SHARE_KEY required');
    const route: ShareRoute = { prefix: 'share', identifier: key };

    // Discover an asset that belongs to this share.
    const link = await request.get(shareApiPath(route, '/shared-links/me'));
    expect(link.status()).toBe(200);
    const linkBody = await link.json();
    const albumId = linkBody.album?.id as string;
    const album = await request.get(shareApiPath(route, `/albums/${albumId}`));
    expect(album.status()).toBe(200);
    const assetId = (await album.json()).assets?.[0]?.id as string;
    expect(assetId, 'metadata-off album should list assets').toBeTruthy();

    const response = await request.get(shareApiPath(route, `/assets/${assetId}`));
    expect(response.status()).toBe(200);
    const asset = await response.json();
    expect(asset.exifInfo ?? null, 'EXIF must be stripped when metadata is off').toBeNull();
  });

  /**
   * INDIVIDUAL (non-album) shares: Immich v3 returns these assets inline with
   * numeric millisecond durations — a decode path album shares never hit
   * (regression: the whole share 500'd on the duration type).
   */
  test('INDIVIDUAL share lists inline assets with normalized durations', async ({ request }) => {
    const key = seed.individualKey();
    test.skip(!key, 'INDIVIDUAL_SHARE_KEY required');
    const route: ShareRoute = { prefix: 'share', identifier: key };

    const response = await request.get(shareApiPath(route, '/shared-links/me'));
    expect(response.status()).toBe(200);
    const link = await response.json();

    expect(link.type).toBe('INDIVIDUAL');
    expect(link.assets?.length).toBe(2);

    const video = link.assets.find((a: { type: string }) => a.type === 'VIDEO');
    expect(video, 'individual share should include the video asset').toBeTruthy();
    expect(video.duration, 'duration must be normalized to H:MM:SS form').toMatch(/^\d+:\d{2}:\d{2}\./);

    const photo = link.assets.find((a: { type: string }) => a.type === 'IMAGE');
    const original = await request.get(shareApiPath(route, `/assets/${photo.id}/original`));
    expect(original.status(), 'downloads must work on individual shares').toBe(200);
    expect(original.headers()['content-disposition'] ?? '').toContain('attachment');
  });

  test('viewer info sheet lazily loads EXIF details', async ({ page }) => {
    const shareKey = requireEnv('DEFAULT_SHARE_KEY');

    await page.setViewportSize({ width: 1280, height: 900 });
    await openShareByKey(page, shareKey);

    await page.locator('[data-testid="gallery-item"][data-asset-type="IMAGE"]').first().click();
    await expect(page.getByTestId('asset-viewer')).toBeVisible();
    await page.locator('[data-testid="asset-viewer"] button[aria-label="Info"]').click();

    // Dimensions come from EXIF, which only exists after the lazy fetch.
    await expect(page.locator('.exif-label', { hasText: 'Dimensions' })).toBeVisible({ timeout: 10_000 });
  });
});
