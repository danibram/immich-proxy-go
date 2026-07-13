import { expect, test } from '@playwright/test';
import { isIntegrationE2E, requireEnv, seed } from './helpers/env';

/**
 * Link unfurling (OpenGraph) + search-engine exclusion.
 *
 * Public shares get per-share OG meta and a cover image so links preview
 * nicely in chat apps; password-protected shares must leak neither their
 * name nor cover to an unfurl bot (which carries no password). Every share
 * route also carries X-Robots-Tag: noindex so albums stay out of search.
 *
 * The cover is served by the share's /raw endpoint — the former /og-cover
 * endpoint was merged into it.
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
    expect(body).toContain(`/share/${key}/raw`);
    // The former dedicated cover endpoint is gone.
    expect(body).not.toContain('og-cover');
  });

  test('public share cover image is served from /raw', async ({ request }) => {
    const key = requireEnv('DEFAULT_SHARE_KEY');
    const res = await request.get(`/share/${key}/raw`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/');
    // Password-less cover stays publicly cacheable for unfurl services.
    expect(res.headers()['cache-control']).toContain('public');
  });

  test('removed /og-cover endpoint no longer serves an image', async ({ request }) => {
    // The dedicated route is gone; the path now falls through to the SPA
    // shell catch-all like any other unknown share sub-path.
    const res = await request.get(`/share/${requireEnv('DEFAULT_SHARE_KEY')}/og-cover`);
    expect(res.headers()['content-type']).not.toContain('image/');
  });

  test('password-protected share leaks no OpenGraph data to bots', async ({ request }) => {
    const key = requireEnv('PASSWORD_PROTECTED_SHARE_KEY');

    const shell = await request.get(`/share/${key}`);
    expect(shell.status()).toBe(200);
    const body = await shell.text();
    // No per-share OG tags are injected without the password.
    expect(body).not.toContain('property="og:title"');
    expect(body).not.toContain(`/share/${key}/raw`);

    // And the cover endpoint itself refuses without auth (401, same as the
    // rest of the share API — no image bytes leak).
    const cover = await request.get(`/share/${key}/raw`);
    expect(cover.status()).toBe(401);
    expect(cover.headers()['content-type'] ?? '').not.toContain('image/');
  });

  test('slug routes also carry the noindex header', async ({ request }) => {
    const slug = seed.shareSlug();
    test.skip(!slug, 'DEFAULT_SHARE_SLUG required');
    const res = await request.get(`/s/${slug}`);
    expect(res.headers()['x-robots-tag']).toContain('noindex');
  });
});
