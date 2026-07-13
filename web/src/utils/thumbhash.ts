import { thumbHashToDataURL } from 'thumbhash';

// Decoded placeholders are memoized forever: a thumbhash is ~25 bytes and the
// decoded PNG data URL ~1KB, so even a huge album stays in the tens of KB,
// and tiles that unmount/remount during virtual scrolling never re-decode.
const cache = new Map<string, string>();

/**
 * Decode an Immich thumbhash (base64 string as delivered by the API) into a
 * PNG data URL usable as a placeholder background. Returns undefined for
 * missing or malformed hashes — callers simply render no placeholder then.
 * Synchronous and cheap (a few microseconds for the 32x32 output).
 */
export function thumbhashToDataURL(hash: string | undefined | null): string | undefined {
  if (!hash) return undefined;
  const hit = cache.get(hash);
  if (hit !== undefined) return hit || undefined;

  let url = '';
  try {
    url = thumbHashToDataURL(base64ToBytes(hash));
  } catch {
    // Malformed hash: remember the failure so we never re-throw per render.
  }
  cache.set(hash, url);
  return url || undefined;
}

/**
 * The same placeholder as a CSS background-image value, or undefined when the
 * asset has no (valid) thumbhash.
 */
export function thumbhashBackground(hash: string | undefined | null): string | undefined {
  const url = thumbhashToDataURL(hash);
  return url ? `url("${url}")` : undefined;
}

function base64ToBytes(value: string): Uint8Array {
  // Accept both standard and url-safe base64, with or without padding.
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
