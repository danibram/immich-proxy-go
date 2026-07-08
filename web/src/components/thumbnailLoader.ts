export interface ThumbnailTask {
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

export const SCROLL_SETTLE_MS = 150;

export class ThumbnailLoader {
  private readonly maxConcurrent: number;
  private activeCount = 0;
  private nextId = 1;
  private touchSeq = 1;
  private queue: QueueJob[] = [];
  private held = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private pumpScheduled = false;

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = maxConcurrent;
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
    this.held = true;
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.held = false;
      this.schedulePump();
    }, settleMs);
  }

  /**
   * Starts are deferred to a fresh task and coalesced. When a scroll jump
   * lands, every thumbnail re-evaluates its position in the same frame:
   * pumping synchronously from each cancel would start stale queued jobs
   * (their priorities predate the jump) only for the next component's
   * sweep to abort them — a burst of doomed requests. One deferred pump
   * runs after the whole sweep, so only jobs that survived it start.
   */
  private schedulePump() {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    setTimeout(() => {
      this.pumpScheduled = false;
      this.pump();
    }, 0);
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
      this.schedulePump();
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

  private cancelJob(job: QueueJob) {
    if (job.settled) return;

    if (!job.started) {
      this.queue = this.queue.filter((entry) => entry.id !== job.id);
      job.settled = true;
      job.reject(createAbortError());
      return;
    }

    this.releaseJob(job);
  }

  private releaseJob(job: QueueJob) {
    if (job.settled || !job.started) return;

    job.settled = true;
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.queue = this.queue.filter((entry) => entry.id !== job.id);
    this.schedulePump();
  }

  private pump() {
    while (!this.held && this.activeCount < this.maxConcurrent) {
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
      job.resolve();
    }
  }
}

export const thumbnailLoader = new ThumbnailLoader();
