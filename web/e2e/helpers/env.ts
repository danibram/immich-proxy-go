export function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const isIntegrationE2E = () => Boolean(env('E2E_EXTERNAL_BASE_URL'));

export const seed = {
  shareKey: () => env('DEFAULT_SHARE_KEY'),
  shareSlug: () => env('DEFAULT_SHARE_SLUG'),
  overrideOnKey: () => env('OVERRIDE_ON_SHARE_KEY'),
  overrideOffKey: () => env('OVERRIDE_OFF_SHARE_KEY'),
  metadataOffKey: () => env('METADATA_OFF_SHARE_KEY'),
  privateAlbumId: () => env('PRIVATE_ALBUM_ID'),
  passwordProtectedSlug: () => env('PASSWORD_PROTECTED_SHARE_SLUG'),
  passwordProtectedAssetId: () => env('PASSWORD_PROTECTED_ASSET_ID'),
  sharePassword: () => env('E2E_SHARE_PASSWORD'),
};
