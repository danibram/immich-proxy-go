import { expect, test } from '@playwright/test';
import { fetchSharedLinkBySlug, validateSharePassword } from './helpers/api';
import { isIntegrationE2E, seed } from './helpers/env';
import { expectPasswordGate, openShareBySlug, trackThumbnailRequests, unlockProtectedShare } from './helpers/share';

test.describe('Share password security', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');
  test.skip(!seed.passwordProtectedSlug(), 'PASSWORD_PROTECTED_SHARE_SLUG is required');
  test.skip(!seed.sharePassword(), 'E2E_SHARE_PASSWORD is required');
  test.skip(!seed.passwordProtectedAssetId(), 'PASSWORD_PROTECTED_ASSET_ID is required');
  test.skip(!seed.shareSlug(), 'DEFAULT_SHARE_SLUG is required');

  const protectedSlug = () => seed.passwordProtectedSlug()!;
  const sharePassword = () => seed.sharePassword()!;
  const protectedAssetId = () => seed.passwordProtectedAssetId()!;
  const publicSlug = () => seed.shareSlug()!;

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('protected slug shows password gate in the UI', async ({ page }) => {
    await page.goto(`/s/${protectedSlug()}`);
    await expectPasswordGate(page);
  });

  test('wrong password keeps the album locked', async ({ page }) => {
    await page.goto(`/s/${protectedSlug()}`);
    await expectPasswordGate(page);

    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: 'Unlock album' }).click();

    await expect(page.locator('.password-error')).toContainText('Invalid password', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('share-gallery')).toHaveCount(0);
  });

  test('correct password unlocks gallery and thumbnails', async ({ page }) => {
    const thumbs = trackThumbnailRequests(page);
    await page.goto(`/s/${protectedSlug()}`);
    await unlockProtectedShare(page, sharePassword());

    expect(thumbs.urls.length).toBeGreaterThan(0);
    thumbs.stop();
    await expect(page.getByTestId('gallery-item').first()).toBeVisible();
  });

  test('API rejects protected share without credentials', async ({ request }) => {
    const res = await fetchSharedLinkBySlug(request, protectedSlug(), 401);
    const json = await res.json();
    expect(json.passwordRequired).toBe(true);
  });

  test('API rejects protected share with wrong password header', async ({ request }) => {
    const res = await request.get(`/s/${protectedSlug()}/api/shared-links/me`, {
      headers: { 'X-Immich-Share-Password': 'wrong-password' },
    });
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json.passwordRequired).toBe(true);
  });

  test('thumbnail endpoint is blocked before unlock', async ({ request }) => {
    const res = await request.get(
      `/s/${protectedSlug()}/api/assets/${protectedAssetId()}/thumbnail?size=preview`
    );
    expect(res.status()).toBe(401);
  });

  test('stale password header on public slug still loads', async ({ request }) => {
    const res = await request.get(`/s/${publicSlug()}/api/shared-links/me`, {
      headers: { 'X-Immich-Share-Password': 'stale-password-from-another-share' },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.type).toBe('ALBUM');
  });

  test('stale password header on protected slug does not bypass auth', async ({ request }) => {
    const res = await request.get(`/s/${protectedSlug()}/api/shared-links/me`, {
      headers: { 'X-Immich-Share-Password': 'stale-password-from-another-share' },
    });
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json.passwordRequired).toBe(true);
  });

  test('password cookie is scoped to the protected slug path', async ({ request }) => {
    await validateSharePassword(request, protectedSlug(), sharePassword(), 200);

    const protectedRes = await request.get(`/s/${protectedSlug()}/api/shared-links/me`);
    expect(protectedRes.status()).toBe(200);

    const publicRes = await request.get(`/s/${publicSlug()}/api/shared-links/me`);
    expect(publicRes.status()).toBe(200);
  });

  test('unlocking protected slug does not require password on public slug UI', async ({ page }) => {
    await page.goto(`/s/${protectedSlug()}`);
    await unlockProtectedShare(page, sharePassword());

    await page.goto(`/s/${publicSlug()}`);
    await expect(page.getByTestId('share-gallery')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Password required' })).toHaveCount(0);
  });

  test('fresh browser context requires password again', async ({ browser }) => {
    const unlocked = await browser.newContext();
    const unlockedPage = await unlocked.newPage();
    await unlockedPage.goto(`/s/${protectedSlug()}`);
    await unlockProtectedShare(unlockedPage, sharePassword());
    await unlocked.close();

    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await freshPage.goto(`/s/${protectedSlug()}`);
    await expectPasswordGate(freshPage);
    await fresh.close();
  });

  test('navigating from public share to protected share does not leak previous album', async ({ page }) => {
    await openShareBySlug(page, publicSlug());
    await expect(page.getByTestId('share-gallery')).toBeVisible();

    await page.goto(`/s/${protectedSlug()}`);
    await expectPasswordGate(page);
    await expect(page.getByTestId('gallery-item')).toHaveCount(0);
  });
});
