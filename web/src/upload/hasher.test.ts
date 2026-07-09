import { describe, expect, it } from 'vitest';
import { FileHasher } from './hasher';

// jsdom has no Worker, which exercises the inline fallback path — the same
// code the worker itself runs (sha1HexOfBlob), so the hash math is covered
// either way. Worker plumbing is covered by the e2e suite in real browsers.
describe('FileHasher (inline fallback)', () => {
  it('hashes files without Worker support', async () => {
    const hasher = new FileHasher();
    const file = new File(['abc'], 'a.txt');
    expect(await hasher.hash(file)).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    hasher.dispose();
  });

  it('hashes multiple files and stays usable after dispose-less reuse', async () => {
    const hasher = new FileHasher();
    const first = await hasher.hash(new File(['abc'], 'a.txt'));
    const second = await hasher.hash(new File(['abc'], 'b.txt'));
    expect(first).toBe(second);
    hasher.dispose();
  });

  it('dispose is idempotent', () => {
    const hasher = new FileHasher();
    hasher.dispose();
    hasher.dispose();
  });
});
