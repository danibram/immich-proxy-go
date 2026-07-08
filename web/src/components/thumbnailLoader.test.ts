import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThumbnailLoader } from './thumbnailLoader';

// Starts are deferred to a coalesced macrotask (see deferPump), so tests
// flush one task before asserting which jobs began.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('ThumbnailLoader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(maxActive).toBe(4);

    tasks[0].release();
    active -= 1;
    tasks[1].release();
    active -= 1;

    await tick();
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('aborts queued requests before they start', async () => {
    const loader = new ThumbnailLoader(1);
    const first = loader.enqueue(10);
    const second = loader.enqueue(20);

    second.cancel();

    await expect(second.promise).rejects.toMatchObject({ name: 'AbortError' });
    await tick();
    first.release();
    await expect(first.promise).resolves.toBeUndefined();
  });

  it('cancelling an active request rejects it and frees a slot for the next task', async () => {
    let secondStarted = false;
    const loader = new ThumbnailLoader(1);
    const first = loader.enqueue(10);
    await tick();

    const second = loader.enqueue(20, () => {
      secondStarted = true;
    });

    first.cancel();
    const firstRejects = expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    await tick();
    expect(secondStarted).toBe(true);
    await firstRejects;

    second.release();
    await expect(second.promise).resolves.toBeUndefined();
  });

  it('can be re-enqueued after a cancellation', async () => {
    const loader = new ThumbnailLoader(1);
    const first = loader.enqueue(10);
    await tick();
    first.cancel();
    const firstRejects = expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });

    const second = loader.enqueue(10);

    await firstRejects;
    await tick();
    second.release();
    await expect(second.promise).resolves.toBeUndefined();
  });

  it('starts jobs by priority, not enqueue order', async () => {
    const loader = new ThumbnailLoader(1);
    const started: number[] = [];

    const first = loader.enqueue(300, () => started.push(1));
    const second = loader.enqueue(50, () => started.push(2));
    const third = loader.enqueue(200, () => started.push(3));

    await tick();
    expect(started).toEqual([2]);

    second.release();
    await tick();
    expect(started).toEqual([2, 3]);

    third.release();
    await tick();
    expect(started).toEqual([2, 3, 1]);

    first.release();
    await expect(first.promise).resolves.toBeUndefined();
    await expect(second.promise).resolves.toBeUndefined();
    await expect(third.promise).resolves.toBeUndefined();
  });

  it('does not start jobs cancelled in the same sweep that freed a slot', async () => {
    const loader = new ThumbnailLoader(1);
    const started: number[] = [];

    const active = loader.enqueue(10, () => started.push(1));
    const stale = loader.enqueue(20, () => started.push(2));
    const fresh = loader.enqueue(30, () => started.push(3));
    await tick();
    expect(started).toEqual([1]);

    // A scroll-jump sweep: the active job and the stale queued job are both
    // cancelled before the deferred pump runs. Cancel always rejects, so
    // attach the rejection expectations before yielding (vitest fails the
    // run on unhandled rejections even when every assertion passes).
    active.cancel();
    stale.cancel();
    const activeRejects = expect(active.promise).rejects.toMatchObject({ name: 'AbortError' });
    const staleRejects = expect(stale.promise).rejects.toMatchObject({ name: 'AbortError' });
    await tick();

    expect(started).toEqual([1, 3]);
    await activeRejects;
    await staleRejects;
    fresh.release();
    await expect(fresh.promise).resolves.toBeUndefined();
  });

  describe('hold', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('holds back new starts until the settle delay elapses', () => {
      const loader = new ThumbnailLoader(4);
      const started: number[] = [];

      loader.hold(150);
      loader.enqueue(10, () => started.push(1));
      loader.enqueue(20, () => started.push(2));
      vi.advanceTimersByTime(149);
      expect(started).toEqual([]);

      vi.advanceTimersByTime(1);
      vi.runAllTimers();
      expect(started).toEqual([1, 2]);
    });

    it('renewing the hold extends the settle window', () => {
      const loader = new ThumbnailLoader(1);
      const started: number[] = [];

      loader.hold(150);
      loader.enqueue(10, () => started.push(1));

      vi.advanceTimersByTime(100);
      loader.hold(150);
      vi.advanceTimersByTime(100);
      expect(started).toEqual([]);

      vi.advanceTimersByTime(50);
      vi.runAllTimers();
      expect(started).toEqual([1]);
    });

    it('starts the closest queued item first once the hold settles', () => {
      const loader = new ThumbnailLoader(1);
      const started: number[] = [];

      loader.hold(150);
      loader.enqueue(300, () => started.push(1));
      loader.enqueue(50, () => started.push(2));
      loader.enqueue(200, () => started.push(3));

      vi.advanceTimersByTime(150);
      vi.runAllTimers();
      expect(started).toEqual([2]);
    });

    it('cancels queued jobs while held without ever starting them', async () => {
      const loader = new ThumbnailLoader(4);
      let started = false;

      loader.hold(150);
      const task = loader.enqueue(10, () => {
        started = true;
      });
      task.cancel();

      const rejection = expect(task.promise).rejects.toMatchObject({ name: 'AbortError' });
      vi.advanceTimersByTime(150);
      await rejection;
      expect(started).toBe(false);
    });

    it('does not interrupt already-started jobs', () => {
      const loader = new ThumbnailLoader(4);
      const started: number[] = [];

      loader.enqueue(10, () => started.push(1));
      vi.advanceTimersByTime(0);
      expect(started).toEqual([1]);

      loader.hold(150);
      loader.enqueue(20, () => started.push(2));
      vi.advanceTimersByTime(1);
      expect(started).toEqual([1]);

      vi.advanceTimersByTime(149);
      vi.runAllTimers();
      expect(started).toEqual([1, 2]);
    });

    it('keeps a slot freed during the hold idle until the hold settles', () => {
      const loader = new ThumbnailLoader(1);
      const started: number[] = [];

      const first = loader.enqueue(10, () => started.push(1));
      vi.advanceTimersByTime(0);
      expect(started).toEqual([1]);

      loader.hold(150);
      loader.enqueue(20, () => started.push(2));

      first.release();
      vi.advanceTimersByTime(1);
      expect(started).toEqual([1]);

      vi.advanceTimersByTime(149);
      vi.runAllTimers();
      expect(started).toEqual([1, 2]);
    });
  });
});
