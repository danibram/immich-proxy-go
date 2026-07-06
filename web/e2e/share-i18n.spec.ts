import { expect, test } from '@playwright/test';
import { isIntegrationE2E, requireEnv } from './helpers/env';
import { openShareByKey } from './helpers/share';

/**
 * i18n: the app auto-detects the browser locale (falling back to English),
 * and the homepage offers a manual language selector that persists.
 */
test.describe('Localization', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');

  test.describe('Spanish browser', () => {
    test.use({ locale: 'es-ES' });

    test('share UI is rendered in Spanish', async ({ page }) => {
      await openShareByKey(page, requireEnv('DEFAULT_SHARE_KEY'));
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      // The item count in the top bar is always visible: "N elementos".
      await expect(page.getByTestId('album-meta')).toContainText('elemento');
    });
  });

  test.describe('English browser', () => {
    test.use({ locale: 'en-US' });

    test('share UI is rendered in English', async ({ page }) => {
      await openShareByKey(page, requireEnv('DEFAULT_SHARE_KEY'));
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByTestId('album-meta')).toContainText('item');
    });
  });

  test.describe('Homepage language selector', () => {
    test.use({ locale: 'en-US' });

    test('switches language on demand and persists the choice', async ({ page }) => {
      await page.goto('/');
      // Locate by class, not label — the label itself is localized.
      const selector = page.locator('.landing-lang select');
      await expect(selector).toBeVisible();

      // Defaults to the detected (English) locale.
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('link', { name: 'Quick start' }).first()).toBeVisible();

      // Switch to Spanish → copy updates and <html lang> follows.
      await selector.selectOption('es');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.getByRole('link', { name: 'Inicio rápido' }).first()).toBeVisible();

      // Choice survives a reload (persisted to localStorage).
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(selector).toHaveValue('es');
    });
  });
});
