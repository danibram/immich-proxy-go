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
  album?: { id?: string; albumName?: string; assets?: unknown[] };
  assets?: unknown[];
}

export type ShareRoutePrefix = 'share' | 's';

export interface ShareRoute {
  prefix: ShareRoutePrefix;
  identifier: string;
}

export interface SharedAlbumContext {
  albumId: string;
  assetCount: number;
}

export interface SharedUploadFile {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface SharedUploadResult {
  id: string;
  status: 'created' | 'duplicate' | 'replaced';
}

export function shareApiPath(route: ShareRoute, path: string): string {
  return `/${route.prefix}/${encodeURIComponent(route.identifier)}/api${path}`;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export async function fetchSharedAlbumContext(
  request: APIRequestContext,
  route: ShareRoute
): Promise<SharedAlbumContext> {
  const album = await fetchSharedAlbum(request, route);
  return {
    albumId: requireString(album.id, 'shared link album id'),
    assetCount: albumAssetCount(album),
  };
}

// Album details are embedded in /shared-links/me (the dedicated
// /albums/{id} endpoint was removed), so asset counts are read from there.
export async function fetchSharedAlbumAssetCount(
  request: APIRequestContext,
  route: ShareRoute,
  albumId: string
): Promise<number> {
  const album = await fetchSharedAlbum(request, route);
  expect(album.id, 'shared link album id should be stable').toBe(albumId);
  return albumAssetCount(album);
}

async function fetchSharedAlbum(
  request: APIRequestContext,
  route: ShareRoute
): Promise<Record<string, unknown>> {
  const sharedLink = await request.get(shareApiPath(route, '/shared-links/me'));
  expect(sharedLink.status()).toBe(200);
  const sharedLinkBody = requireRecord(await sharedLink.json(), 'shared link response');
  return requireRecord(sharedLinkBody.album, 'shared link album');
}

function albumAssetCount(album: Record<string, unknown>): number {
  if (typeof album.assetCount !== 'number') {
    throw new Error('album assetCount must be a number');
  }
  return album.assetCount;
}

export async function uploadAssetThroughShare(
  request: APIRequestContext,
  route: ShareRoute,
  file: SharedUploadFile
): Promise<SharedUploadResult> {
  const timestamp = new Date().toISOString();
  const response = await request.post(shareApiPath(route, '/assets'), {
    multipart: {
      assetData: {
        name: file.filename,
        mimeType: file.mimeType,
        buffer: file.buffer,
      },
      deviceAssetId: `share-e2e-${route.prefix}-${file.filename}-${Date.now()}`,
      deviceId: 'immich-public-proxy-e2e',
      fileCreatedAt: timestamp,
      fileModifiedAt: timestamp,
    },
  });
  const body = await response.text();
  expect([200, 201], body).toContain(response.status());

  const upload = requireRecord(JSON.parse(body) as unknown, 'upload response');
  const status = requireString(upload.status, 'upload status');
  if (status !== 'created' && status !== 'duplicate' && status !== 'replaced') {
    throw new Error(`unexpected upload status: ${status}`);
  }
  return {
    id: requireString(upload.id, 'uploaded asset id'),
    status,
  };
}

export async function downloadAssetThroughShare(
  request: APIRequestContext,
  route: ShareRoute,
  assetId: string
): Promise<Buffer> {
  const response = await request.get(shareApiPath(route, `/assets/${assetId}/original`));
  expect(response.status()).toBe(200);
  return response.body();
}

export async function downloadAssetsAsZipThroughShare(
  request: APIRequestContext,
  route: ShareRoute,
  assetIds: string[]
): Promise<Buffer> {
  const start = await request.post(shareApiPath(route, '/assets/download'), {
    data: { assetIds },
  });
  expect(start.status()).toBe(200);
  const startBody = requireRecord(await start.json(), 'download start response');
  const jobId = requireString(startBody.jobId, 'download job id');

  await expect
    .poll(
      async () => {
        const response = await request.get(shareApiPath(route, `/download/jobs/${jobId}`));
        expect(response.status()).toBe(200);
        const job = requireRecord(await response.json(), 'download job response');
        const status = requireString(job.status, 'download job status');
        if (status === 'failed') {
          throw new Error(`download job failed: ${String(job.error ?? 'unknown error')}`);
        }
        return status;
      },
      { message: 'bulk download job should become ready', timeout: 30_000 }
    )
    .toBe('ready');

  const download = await request.get(shareApiPath(route, `/download/jobs/${jobId}/file`));
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toContain('application/zip');
  return download.body();
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
