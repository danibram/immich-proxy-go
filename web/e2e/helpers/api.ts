import { expect, type APIRequestContext, type Playwright } from '@playwright/test';

export interface SharedLinkCapabilities {
  allowDownload: boolean;
  allowUpload: boolean;
  showMetadata: boolean;
}

interface SharedLinkMeResponse {
  allowDownload?: boolean;
  allowUpload?: boolean;
  showMetadata?: boolean;
  album?: { albumName?: string; assets?: unknown[] };
  assets?: unknown[];
}

export async function fetchSharedLink(
  request: APIRequestContext,
  shareKey: string
): Promise<SharedLinkCapabilities & { assetCount: number; albumName: string }> {
  const res = await request.get(`/share/${shareKey}/api/shared-links/me`);
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as SharedLinkMeResponse;
  const assets = json.album?.assets ?? json.assets ?? [];
  return {
    allowDownload: Boolean(json.allowDownload),
    allowUpload: Boolean(json.allowUpload),
    showMetadata: Boolean(json.showMetadata),
    assetCount: assets.length,
    albumName: json.album?.albumName ?? '',
  };
}

export async function fetchSharedLinkBySlug(
  request: APIRequestContext,
  slug: string,
  expectedStatus = 200
) {
  const res = await request.get(`/s/${slug}/api/shared-links/me`);
  expect(res.status()).toBe(expectedStatus);
  return res;
}

export async function validateSharePassword(
  request: APIRequestContext,
  slug: string,
  password: string,
  expectedStatus = 200
) {
  const res = await request.post(`/s/${slug}/api/shared-links/me/password`, {
    data: { password },
  });
  expect(res.status()).toBe(expectedStatus);
  return res;
}

/** Isolated API context so password cookies from one test do not leak to the next. */
export async function withFreshRequest(
  playwright: Playwright,
  fn: (request: APIRequestContext) => Promise<void>
): Promise<void> {
  const baseURL = process.env.E2E_EXTERNAL_BASE_URL;
  if (!baseURL) {
    throw new Error('E2E_EXTERNAL_BASE_URL is required');
  }
  const ctx = await playwright.request.newContext({ baseURL });
  try {
    await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}
