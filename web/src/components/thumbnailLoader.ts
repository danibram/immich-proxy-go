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

export class ThumbnailLoader {
  private readonly maxConcurrent: number;
  private activeCount = 0;
  private nextId = 1;
  private touchSeq = 1;
  private queue: QueueJob[] = [];

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = maxConcurrent;
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
    this.pump();
  }

  private pump() {
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
      job.resolve();
    }
  }
}

export const thumbnailLoader = new ThumbnailLoader();
