import { expect, test, type Download } from '@playwright/test';
import { isIntegrationE2E, requireEnv } from './helpers/env';
import { openShareByKey } from './helpers/share';

/**
 * Regression guard for the download flow under hotlink protection.
 *
 * Hotlink protection blocks requests whose Sec-Fetch-Dest is `document`
 * (direct navigation / window.open) and only allows app-originated fetches
 * (Sec-Fetch-Dest: empty). The download UI used to window.open() the asset /
 * ZIP URLs, so every download 403'd with "Direct access not allowed" on any
 * share with hotlink protection enabled. Downloads now go through fetch()+blob,
 * which this spec exercises against a hotlink-ON stack.
 *
 * Gated on E2E_HOTLINK_PROTECTION=true so it only runs when run.sh brings the
 * proxy up with hotlink enabled — otherwise the assertion that direct
 * navigation is blocked would not hold.
 */
test.describe('Downloads under hotlink protection', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');
  test.skip(process.env.E2E_HOTLINK_PROTECTION !== 'true', 'Requires hotlink protection enabled');

  const shareKey = () => requireEnv('DEFAULT_SHARE_KEY');

  test('direct navigation to an asset is blocked (protection is active)', async ({ request }) => {
    // Mimic a browser document navigation (window.open / address bar).
    const res = await request.get(`/share/${shareKey()}/api/assets/${requireEnv('FIRST_ASSET_ID')}/original`, {
      headers: { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate' },
    });
    expect(res.status(), 'hotlink protection must reject direct navigation').toBe(403);
  });

  test('viewer, single-selection, and multi-select ZIP all download via the app', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openShareByKey(page, shareKey());

    const expectDownload = async (trigger: () => Promise<void>): Promise<Download> => {
      const promise = page.waitForEvent('download', { timeout: 30_000 });
      await trigger();
      return promise;
    };

    // 1) Viewer download button.
    await page.locator('[data-testid="gallery-item"][data-asset-type="IMAGE"]').first().click();
    await expect(page.getByTestId('asset-viewer')).toBeVisible();
    const viewerDl = await expectDownload(() =>
      page.locator('[data-testid="asset-viewer"] [aria-label="Download"]').click()
    );
    expect((await (await import('node:fs/promises')).stat(await viewerDl.path())).size).toBeGreaterThan(26);
    await page.keyboard.press('Escape');

    // 2) Select one, download the single original.
    await page.getByRole('button', { name: 'Select' }).click();
    await page.locator('[data-testid="gallery-item"]').nth(0).click();
    const singleDl = await expectDownload(() => page.getByRole('button', { name: 'Download (1)' }).click());
    expect((await (await import('node:fs/promises')).stat(await singleDl.path())).size).toBeGreaterThan(26);

    // 3) Select a second, download the ZIP.
    await page.locator('[data-testid="gallery-item"]').nth(1).click();
    const zipDl = await expectDownload(() => page.getByRole('button', { name: 'Download (2)' }).click());
    expect(zipDl.suggestedFilename().toLowerCase()).toContain('.zip');
    expect((await (await import('node:fs/promises')).stat(await zipDl.path())).size).toBeGreaterThan(26);
  });
});
