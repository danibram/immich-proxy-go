import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThumbnailLoader } from './thumbnailLoader';

describe('ThumbnailLoader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not exceed the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, () =>
      new ThumbnailLoader(4).enqueue()
    );
    void tasks;
  });

  it('does not exceed the concurrency limit and starts queued tasks after release', async () => {
    const loader = new ThumbnailLoader(4);
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, (_, index) =>
      loader.enqueue(index, () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started.push(index);
      })
    );
    expect(started).toEqual([0, 1, 2, 3]);
    expect(maxActive).toBe(4);

    tasks[0].release();
    active -= 1;
    tasks[1].release();
    active -= 1;

    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('aborts queued requests before they start', async () => {
    const loader = new ThumbnailLoader(1);
    const first = loader.enqueue(10);
    const second = loader.enqueue(20);

    second.cancel();

    await expect(second.promise).rejects.toMatchObject({ name: 'AbortError' });
    await expect(first.promise).resolves.toBeUndefined();
  });

  it('releases active requests and frees a slot for the next task', async () => {
    let secondStarted = false;
    const loader = new ThumbnailLoader(1);
    const first = loader.enqueue(10);
    const second = loader.enqueue(20, () => {
      secondStarted = true;
    });

    first.cancel();
    await Promise.resolve();
    expect(secondStarted).toBe(true);
    await expect(first.promise).resolves.toBeUndefined();
    await expect(second.promise).resolves.toBeUndefined();
  });

  it('can be re-enqueued after a cancellation', async () => {
    const loader = new ThumbnailLoader(1);
    const first = loader.enqueue(10);
    first.cancel();

    const second = loader.enqueue(10);

    await expect(first.promise).resolves.toBeUndefined();
    await expect(second.promise).resolves.toBeUndefined();
  });

  it('prioritizes the closest queued items first', async () => {
    const loader = new ThumbnailLoader(1);
    const started: number[] = [];

    const first = loader.enqueue(300, () => started.push(1));
    const second = loader.enqueue(50, () => started.push(2));
    const third = loader.enqueue(200, () => started.push(3));

    expect(started).toEqual([1]);

    first.release();
    await Promise.resolve();
    expect(started).toEqual([1, 2]);

    second.release();
    await Promise.resolve();
    expect(started).toEqual([1, 2, 3]);

    await expect(first.promise).resolves.toBeUndefined();
    await expect(second.promise).resolves.toBeUndefined();
    await expect(third.promise).resolves.toBeUndefined();
  });
});
