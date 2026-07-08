export interface ThumbnailTask {
  /**
   * Settles once: resolves on release() (the load ran to completion),
   * rejects with an AbortError on cancel() — whether the job was still
   * queued or already started. Job starts are signalled via onStart,
   * not via this promise.
   */
  promise: Promise<void>;
  cancel: () => void;
  release: () => void;
  bump: (priority: number) => void;
}

interface QueueJob {
  id: number;
  started: boolean;
  settled: boolean;
  priority: number;
  touchedAt: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  onStart?: () => void;
}

function createAbortError() {
  return new DOMException('Thumbnail request aborted', 'AbortError');
}

const SCROLL_SETTLE_MS = 150;

export class ThumbnailLoader {
  private readonly maxConcurrent: number;
  private activeCount = 0;
  private nextId = 1;
  private touchSeq = 1;
  private queue: QueueJob[] = [];
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private pumpDeadline = 0;

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Schedules the next pump for `delayMs` from now, keeping at most one
   * pending timer: an earlier-or-equal deadline is already covered by the
   * pending one, a later deadline replaces it. This means an enqueue or
   * release during a hold's settle window can never shorten the window.
   *
   * Even `delayMs = 0` starts are deferred to a macrotask, never run
   * synchronously. The viewport tracker's sweep cancels and enqueues jobs
   * for many thumbnails in one pass: pumping synchronously from an early
   * cancel would start stale queued jobs (their priorities predate the
   * scroll jump) only for a later evaluate in the same sweep to abort
   * them — a burst of doomed requests. Deferring to a macrotask lets the
   * whole sweep finish first, so only the jobs that survived it start.
   * This one timer is also what makes hold() gate every other pump
   * trigger, so the sweep-end pump must go through it too.
   */
  pump(delayMs = 0) {
    const deadline = Date.now() + delayMs;
    if (this.pumpTimer !== null) {
      if (deadline <= this.pumpDeadline) return; // already covered
      clearTimeout(this.pumpTimer);
    }
    this.pumpDeadline = deadline;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      this.startJobs();
    }, delayMs);
  }

  /**
   * Holds back new job starts until no hold has been renewed for
   * `settleMs`. The timeline scrubber renews the hold on every scrollTop
   * teleport, so nothing loads mid-drag, but the queue drains ~settleMs
   * after the grip stops moving — even while the mouse button is still
   * down (a hard pause-until-mouseup would keep a stationary grip blank).
   * Queued jobs can still be cancelled or re-prioritized while held.
   */
  hold(settleMs = SCROLL_SETTLE_MS) {
    this.pump(settleMs);
  }

  enqueue(priority: number, onStart?: () => void): ThumbnailTask {
    let job: QueueJob;

    const promise = new Promise<void>((resolve, reject) => {
      job = {
        id: this.nextId++,
        started: false,
        settled: false,
        priority,
        touchedAt: this.touchSeq++,
        resolve,
        reject,
        onStart,
      };
      this.queue.push(job);
      this.pump();
    });

    return {
      promise,
      cancel: () => this.cancelJob(job!),
      release: () => this.releaseJob(job!),
      bump: (nextPriority: number) => this.bumpJob(job!, nextPriority),
    };
  }

  private bumpJob(job: QueueJob, priority: number) {
    if (job.settled || job.started) return;
    job.priority = priority;
    job.touchedAt = this.touchSeq++;
  }

  // Cancel always rejects with AbortError, whether the job was still
  // queued or already started; a started job's slot is freed as well.
  // Release (load finished) is the only path that resolves.
  private cancelJob(job: QueueJob) {
    if (job.settled) return;

    job.settled = true;
    this.queue = this.queue.filter((entry) => entry.id !== job.id);
    if (job.started) {
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.pump();
    }
    job.reject(createAbortError());
  }

  private releaseJob(job: QueueJob) {
    if (job.settled || !job.started) return;

    job.settled = true;
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.queue = this.queue.filter((entry) => entry.id !== job.id);
    job.resolve();
    this.pump();
  }

  private startJobs() {
    while (this.activeCount < this.maxConcurrent) {
      const job = this.queue
        .filter((entry) => !entry.started && !entry.settled)
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          return b.touchedAt - a.touchedAt;
        })[0];
      if (!job) return;

      job.started = true;
      this.activeCount += 1;
      job.onStart?.();
    }
  }
}

export const thumbnailLoader = new ThumbnailLoader();
