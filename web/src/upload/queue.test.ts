import { describe, expect, it, vi } from 'vitest';
import { AdaptiveConcurrencyPolicy } from './pool';
import { UploadQueue, type UploadQueueDeps, type UploadQueueItem } from './queue';

const MB = 1024 * 1024;

function makeFile(name: string, sizeBytes = 4): File {
  const file = new File(['x'.repeat(Math.min(sizeBytes, 1024))], name, { type: 'image/jpeg' });
  // jsdom Files are tiny; fake the size for pool-rule tests.
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(times = 8) {
  for (let i = 0; i < times; i++) await flush();
}

interface Harness {
  queue: UploadQueue;
  items: () => UploadQueueItem[];
  uploads: Array<{
    file: File;
    checksum?: string;
    resolve: (outcome?: { id: string; status?: string }) => void;
    reject: (error: unknown) => void;
    onProgress: (percent: number) => void;
  }>;
  settled: Array<{ done: number; duplicates: number; failed: number }>;
  retries: Array<[attempt: number, maxAttempts: number]>;
  deps: UploadQueueDeps;
}

function makeHarness(overrides: Partial<UploadQueueDeps> = {}): Harness {
  let snapshot: UploadQueueItem[] = [];
  const uploads: Harness['uploads'] = [];
  const settledSummaries: Harness['settled'] = [];
  const retries: Harness['retries'] = [];

  const deps: UploadQueueDeps = {
    hashFile: vi.fn(async (file: File) => `sha1-of-${file.name}`),
    checkExisting: vi.fn(async () => new Map()),
    uploadFile: vi.fn(
      (file: File, opts: Parameters<UploadQueueDeps['uploadFile']>[1]) =>
        new Promise<{ id: string; status?: string }>((resolve, reject) => {
          uploads.push({
            file,
            checksum: opts.checksum,
            resolve: (outcome) => resolve(outcome ?? { id: `asset-${file.name}` }),
            reject,
            onProgress: opts.onProgress,
          });
        })
    ),
    classifyFailure: (error) =>
      error instanceof Error && error.message.includes('413')
        ? { kind: 'too-large' }
        : { kind: 'error' },
    isRetryable: (error) => error instanceof Error && error.message.includes('stalled'),
    isOnline: () => true,
    onChange: (items) => {
      snapshot = items;
    },
    onSettled: (summary) => {
      settledSummaries.push(summary);
    },
    onRetryScheduled: (attempt, maxAttempts) => {
      retries.push([attempt, maxAttempts]);
    },
    ...overrides,
  };

  return {
    queue: new UploadQueue(deps),
    items: () => snapshot,
    uploads,
    settled: settledSummaries,
    retries,
    deps,
  };
}

const byName = (items: UploadQueueItem[], name: string) =>
  items.find((item) => item.file.name === name)!;

describe('UploadQueue', () => {
  it('hashes, checks and uploads a batch to completion', async () => {
    const h = makeHarness();
    h.queue.addFiles([makeFile('a.jpg'), makeFile('b.jpg')]);
    await settle();

    expect(h.deps.hashFile).toHaveBeenCalledTimes(2);
    expect(h.deps.checkExisting).toHaveBeenCalledWith([
      { name: 'a.jpg', checksum: 'sha1-of-a.jpg' },
      { name: 'b.jpg', checksum: 'sha1-of-b.jpg' },
    ]);
    expect(h.uploads).toHaveLength(2);
    expect(h.uploads[0].checksum).toBe('sha1-of-a.jpg');

    h.uploads[0].resolve();
    h.uploads[1].resolve();
    await settle();

    expect(byName(h.items(), 'a.jpg').status).toBe('done');
    expect(byName(h.items(), 'b.jpg').status).toBe('done');
    expect(h.settled).toEqual([{ done: 2, duplicates: 0, failed: 0 }]);
    expect(h.queue.isActive()).toBe(false);
  });

  it('marks pre-existing checksums as duplicates without uploading them', async () => {
    const h = makeHarness({
      checkExisting: vi.fn(async () =>
        new Map([['sha1-of-a.jpg', { exists: true, assetId: 'asset-existing' }]])
      ),
    });
    h.queue.addFiles([makeFile('a.jpg'), makeFile('b.jpg')]);
    await settle();

    // Only b.jpg uploads; a.jpg is already in the album.
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].file.name).toBe('b.jpg');
    const dup = byName(h.items(), 'a.jpg');
    expect(dup.status).toBe('duplicate');
    expect(dup.assetId).toBe('asset-existing');
    expect(dup.progress).toBe(100);

    h.uploads[0].resolve();
    await settle();
    expect(h.settled).toEqual([{ done: 1, duplicates: 1, failed: 0 }]);
  });

  it('uploads without checksum when hashing fails', async () => {
    const h = makeHarness({
      hashFile: vi.fn(async () => {
        throw new Error('hash worker crashed');
      }),
      checkExisting: vi.fn(async () => new Map()),
    });
    h.queue.addFiles([makeFile('a.jpg')]);
    await settle();

    expect(h.deps.checkExisting).not.toHaveBeenCalled();
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].checksum).toBeUndefined();
  });

  it('proceeds with uploads when the dedupe check itself fails', async () => {
    const h = makeHarness({
      checkExisting: vi.fn(async () => {
        throw new Error('upload-check unavailable');
      }),
    });
    h.queue.addFiles([makeFile('a.jpg')]);
    await settle();

    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].checksum).toBe('sha1-of-a.jpg');
  });

  it('marks a server-side duplicate response as duplicate', async () => {
    const h = makeHarness();
    h.queue.addFiles([makeFile('a.jpg')]);
    await settle();

    h.uploads[0].resolve({ id: 'asset-1', status: 'duplicate' });
    await settle();

    expect(byName(h.items(), 'a.jpg').status).toBe('duplicate');
    expect(h.settled).toEqual([{ done: 0, duplicates: 1, failed: 0 }]);
  });

  it('runs at most 3 uploads in parallel and refills as they finish', async () => {
    const h = makeHarness();
    h.queue.addFiles(['a', 'b', 'c', 'd', 'e'].map((n) => makeFile(`${n}.jpg`)));
    await settle();

    expect(h.uploads).toHaveLength(3);
    h.uploads[0].resolve();
    await settle();
    expect(h.uploads).toHaveLength(4);
    h.uploads[1].resolve();
    h.uploads[2].resolve();
    await settle();
    expect(h.uploads).toHaveLength(5);
  });

  it('lets small files flow around a blocked large file', async () => {
    const h = makeHarness();
    h.queue.addFiles([
      makeFile('big1.mp4', 60 * MB),
      makeFile('big2.mp4', 70 * MB),
      makeFile('small.jpg', 2 * MB),
    ]);
    await settle();

    // big1 + small start; big2 waits for the large slot.
    expect(h.uploads.map((u) => u.file.name)).toEqual(['big1.mp4', 'small.jpg']);
    h.uploads[0].resolve();
    await settle();
    expect(h.uploads.map((u) => u.file.name)).toContain('big2.mp4');
  });

  it('drops concurrency after consecutive stall retries', async () => {
    const policy = new AdaptiveConcurrencyPolicy({ dropAfterConsecutiveFailures: 2 });
    const h = makeHarness({ policy, retryDelaysMs: () => [0, 0] });
    h.queue.addFiles(['a', 'b', 'c', 'd', 'e'].map((n) => makeFile(`${n}.jpg`)));
    await settle();
    expect(h.uploads).toHaveLength(3);

    // Two stalls in a row: each schedules a retry (attempt 2 of 3, surfaced
    // on the item and via onRetryScheduled) and the policy drops 3 → 2.
    h.uploads[0].reject(new Error('Upload stalled: no progress'));
    h.uploads[1].reject(new Error('Upload stalled: no progress'));
    await settle();
    expect(policy.concurrency).toBe(2);
    expect(h.retries).toEqual([
      [2, 3],
      [2, 3],
    ]);
    expect(byName(h.items(), 'a.jpg').attempt).toBe(2);
    expect(byName(h.items(), 'a.jpg').maxAttempts).toBe(3);
    // The retry attempts re-invoked uploadFile (same slots, no new starts).
    expect(h.uploads).toHaveLength(5);

    // A finishing upload does not refill beyond the reduced limit
    // (3 in flight - 1 done = 2 = limit).
    h.uploads[2].resolve();
    await settle();
    expect(h.uploads).toHaveLength(5);
  });

  it('retries a retryable failure and succeeds on the next attempt', async () => {
    const h = makeHarness({ retryDelaysMs: () => [0] });
    h.queue.addFiles([makeFile('a.jpg')]);
    await settle();

    h.uploads[0].reject(new Error('Upload stalled: no progress'));
    await settle();

    expect(h.retries).toEqual([[2, 2]]);
    expect(h.uploads).toHaveLength(2);
    // Retries keep the checksum so a first attempt that actually landed
    // server-side dedupes instantly.
    expect(h.uploads[1].checksum).toBe('sha1-of-a.jpg');

    h.uploads[1].resolve();
    await settle();
    expect(byName(h.items(), 'a.jpg').status).toBe('done');
    expect(h.settled).toEqual([{ done: 1, duplicates: 0, failed: 0 }]);
  });

  it('gives up after exhausting attempts and reports a generic failure', async () => {
    const h = makeHarness({ retryDelaysMs: () => [0, 0] });
    h.queue.addFiles([makeFile('a.jpg')]);
    await settle();

    for (const attempt of [0, 1, 2]) {
      h.uploads[attempt].reject(new Error('Upload stalled: no progress'));
      await settle();
    }

    expect(h.uploads).toHaveLength(3);
    expect(h.retries).toEqual([
      [2, 3],
      [3, 3],
    ]);
    const item = byName(h.items(), 'a.jpg');
    expect(item.status).toBe('failed');
    expect(item.failureKind).toBe('error');
    expect(h.settled).toEqual([{ done: 0, duplicates: 0, failed: 1 }]);
  });

  it('does not retry permanent failures even when retries are configured', async () => {
    const h = makeHarness({ retryDelaysMs: () => [0, 0] });
    h.queue.addFiles([makeFile('a.jpg')]);
    await settle();

    h.uploads[0].reject(new Error('API Error 413: File too large'));
    await settle();

    expect(h.uploads).toHaveLength(1);
    expect(h.retries).toEqual([]);
    expect(byName(h.items(), 'a.jpg').status).toBe('failed');
    expect(byName(h.items(), 'a.jpg').failureKind).toBe('too-large');
  });

  it('continues past a permanent failure and reports it in the summary', async () => {
    const h = makeHarness();
    h.queue.addFiles([makeFile('bad.jpg'), makeFile('good.jpg')]);
    await settle();

    h.uploads[0].reject(new Error('API Error 500: boom'));
    h.uploads[1].resolve();
    await settle();

    expect(byName(h.items(), 'bad.jpg').status).toBe('failed');
    expect(byName(h.items(), 'bad.jpg').failureKind).toBe('error');
    expect(byName(h.items(), 'good.jpg').status).toBe('done');
    expect(h.settled).toEqual([{ done: 1, duplicates: 0, failed: 1 }]);
  });

  it('classifies 413 failures as failed with the too-large kind', async () => {
    const h = makeHarness();
    h.queue.addFiles([makeFile('huge.jpg')]);
    await settle();

    h.uploads[0].reject(new Error('API Error 413: File too large'));
    await settle();

    const item = byName(h.items(), 'huge.jpg');
    expect(item.status).toBe('failed');
    expect(item.failureKind).toBe('too-large');
  });

  it('does not start new uploads while paused, and resumes where it left off', async () => {
    const h = makeHarness();
    h.queue.pause();
    h.queue.addFiles([makeFile('a.jpg')]);
    await settle();

    expect(h.uploads).toHaveLength(0);
    expect(byName(h.items(), 'a.jpg').status).toBe('queued');

    h.queue.resume();
    await settle();
    expect(h.uploads).toHaveLength(1);
  });

  it('re-queues (never fails) uploads that break while offline', async () => {
    let online = true;
    const h = makeHarness({ isOnline: () => online });
    h.queue.addFiles([makeFile('a.jpg')]);
    await settle();
    expect(h.uploads).toHaveLength(1);

    // Wifi drops: the modal pauses the queue, then the in-flight XHR errors.
    online = false;
    h.queue.pause();
    h.uploads[0].reject(new Error('API Error 0: Network error'));
    await settle();

    const item = byName(h.items(), 'a.jpg');
    expect(item.status).toBe('queued'); // parked, NOT failed
    expect(item.failureKind).toBeUndefined();

    // Back online: resume picks it up with a fresh set of attempts.
    online = true;
    h.queue.resume();
    await settle();
    expect(h.uploads).toHaveLength(2);
    h.uploads[1].resolve();
    await settle();
    expect(byName(h.items(), 'a.jpg').status).toBe('done');
  });

  it('retryFailed re-queues exhausted files (including too-large)', async () => {
    const h = makeHarness();
    h.queue.addFiles([makeFile('a.jpg'), makeFile('b.jpg')]);
    await settle();

    h.uploads[0].reject(new Error('API Error 413: File too large'));
    h.uploads[1].reject(new Error('Upload stalled: no progress'));
    await settle();
    expect(h.queue.summary().failed).toBe(2);

    expect(h.queue.retryFailed()).toBe(2);
    await settle();
    expect(h.uploads).toHaveLength(4);
    h.uploads[2].resolve();
    h.uploads[3].resolve();
    await settle();
    expect(h.queue.summary()).toEqual({ done: 2, duplicates: 0, failed: 0 });
  });

  it('clearCompleted removes done and duplicate items only', async () => {
    const h = makeHarness({
      checkExisting: vi.fn(async () =>
        new Map([['sha1-of-dup.jpg', { exists: true, assetId: 'x' }]])
      ),
    });
    h.queue.addFiles([makeFile('dup.jpg'), makeFile('ok.jpg'), makeFile('bad.jpg')]);
    await settle();

    h.uploads.find((u) => u.file.name === 'ok.jpg')!.resolve();
    h.uploads.find((u) => u.file.name === 'bad.jpg')!.reject(new Error('API Error 500: x'));
    await settle();

    const cleared = h.queue.clearCompleted();
    expect(cleared.map((c) => c.file.name).sort()).toEqual(['dup.jpg', 'ok.jpg']);
    expect(h.items().map((i) => i.file.name)).toEqual(['bad.jpg']);
  });

  it('keeps checksums across retryFailed so retries still dedupe', async () => {
    const h = makeHarness();
    h.queue.addFiles([makeFile('a.jpg')]);
    await settle();
    h.uploads[0].reject(new Error('Upload stalled: no progress'));
    await settle();

    h.queue.retryFailed();
    await settle();
    expect(h.uploads[1].checksum).toBe('sha1-of-a.jpg');
  });
});
