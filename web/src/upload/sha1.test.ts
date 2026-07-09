import { describe, expect, it } from 'vitest';
import { sha1HexOfBlob } from './sha1';

// Reference vectors from FIPS 180-1.
const SHA1_EMPTY = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
const SHA1_ABC = 'a9993e364706816aba3e25717850c26c9cd0d89d';

describe('sha1HexOfBlob', () => {
  it('hashes an empty blob', async () => {
    expect(await sha1HexOfBlob(new Blob([]))).toBe(SHA1_EMPTY);
  });

  it('hashes a small blob', async () => {
    expect(await sha1HexOfBlob(new Blob(['abc']))).toBe(SHA1_ABC);
  });

  it('produces the same hash regardless of slice size', async () => {
    // Slicing must be transparent: hashing "abc" in 1-byte and 2-byte slices
    // equals hashing it whole.
    const blob = new Blob(['abc']);
    expect(await sha1HexOfBlob(blob, 1)).toBe(SHA1_ABC);
    expect(await sha1HexOfBlob(blob, 2)).toBe(SHA1_ABC);
  });

  it('hashes content larger than one slice', async () => {
    const payload = 'x'.repeat(1000);
    const whole = await sha1HexOfBlob(new Blob([payload]));
    const sliced = await sha1HexOfBlob(new Blob([payload]), 64);
    expect(sliced).toBe(whole);
  });
});
