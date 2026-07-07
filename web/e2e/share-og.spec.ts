import { expect, test } from '@playwright/test';
import { isIntegrationE2E, requireEnv, seed } from './helpers/env';

/**
 * Link unfurling (OpenGraph) + search-engine exclusion.
 *
 * Public shares get per-share OG meta and a cover image so links preview
 * nicely in chat apps; password-protected shares must leak neither their
 * name nor cover to an unfurl bot (which carries no password). Every share
 * route also carries X-Robots-Tag: noindex so albums stay out of search.
 */
test.describe('OpenGraph & robots', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');

  test('public share shell exposes OpenGraph meta and a noindex header', async ({ request }) => {
    const key = requireEnv('DEFAULT_SHARE_KEY');
    const res = await request.get(`/share/${key}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['x-robots-tag']).toContain('noindex');

    const body = await res.text();
    expect(body).toContain('property="og:title"');
    expect(body).toContain('property="og:image"');
    expect(body).toContain(`/share/${key}/og-cover`);
  });

  test('public share cover image is served', async ({ request }) => {
    const res = await request.get(`/share/${requireEnv('DEFAULT_SHARE_KEY')}/og-cover`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/');
  });

  test('password-protected share leaks no OpenGraph data to bots', async ({ request }) => {
    const key = requireEnv('PASSWORD_PROTECTED_SHARE_KEY');

    const shell = await request.get(`/share/${key}`);
    expect(shell.status()).toBe(200);
    const body = await shell.text();
    // No per-share OG tags are injected without the password.
    expect(body).not.toContain('property="og:title"');
    expect(body).not.toContain('og-cover');

    // And the cover endpoint itself refuses without auth.
    const cover = await request.get(`/share/${key}/og-cover`);
    expect(cover.status()).toBe(404);
  });

  test('slug routes also carry the noindex header', async ({ request }) => {
    const slug = seed.shareSlug();
    test.skip(!slug, 'DEFAULT_SHARE_SLUG required');
    const res = await request.get(`/s/${slug}`);
    expect(res.headers()['x-robots-tag']).toContain('noindex');
  });
});
