import { describe, expect, it } from 'vitest';
import { assetIdFromHash } from './viewerDeepLink';

describe('assetIdFromHash', () => {
  it('decodes a stable asset deep link', () => {
    expect(assetIdFromHash('#asset%2Did')).toBe('asset-id');
  });

  it('ignores empty and malformed hashes', () => {
    expect(assetIdFromHash('')).toBeNull();
    expect(assetIdFromHash('#')).toBeNull();
    expect(assetIdFromHash('#%E0%A4%A')).toBeNull();
  });
});
