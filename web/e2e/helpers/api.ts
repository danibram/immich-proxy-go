import { expect, type APIRequestContext } from '@playwright/test';

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
