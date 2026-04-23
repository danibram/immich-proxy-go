import { expect, test } from '@playwright/test';

/**
 * E2E Smoke Tests for the Immich Public Proxy UI
 *
 * These tests verify the frontend builds and basic navigation works.
 *
 * For full integration tests with API, run the proxy server first:
 *   ./bin/immich-proxy --web-dir ./web/dist --config ./config.yaml
 */

test.describe('UI Smoke Tests', () => {
  test('home page loads and shows content', async ({ page }) => {
    await page.goto('/');

    // App should render
    await expect(page.locator('body')).toBeVisible();

    // Should show Immich branding
    await expect(page.getByText(/immich/i)).toBeVisible({ timeout: 5000 });
  });

  test('home page has correct structure', async ({ page }) => {
    await page.goto('/');

    // Root element exists
    await expect(page.locator('#root')).toBeAttached();

    // Has some visual content
    const content = await page.locator('body').textContent();
    expect(content?.length).toBeGreaterThan(10);
  });

  test('handles direct URL navigation', async ({ page }) => {
    // Navigate directly to a share URL
    await page.goto('/share/test-key');

    // URL should be preserved (SPA routing)
    expect(page.url()).toContain('/share/test-key');
  });

  test('viewport is configured correctly', async ({ page }) => {
    await page.goto('/');

    const viewport = page.viewportSize();
    expect(viewport?.width).toBeGreaterThan(0);
    expect(viewport?.height).toBeGreaterThan(0);
  });
});
