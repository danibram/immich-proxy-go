// Adaptive concurrency policy for the upload pool.
//
// Baseline is 3 parallel uploads (what Immich mobile uses; web uses 2 — 3
// wins on high-latency links where per-connection throughput is capped).
// The policy adapts to network health: consecutive stalls/retryable failures
// drop the limit toward 1 (a struggling link does better with one steady
// stream than three competing ones), and consecutive successes recover it.
// Independently, only one very large file (>50 MB, typically video) may be
// in flight at a time so it can't monopolize the uplink for minutes while
// small photos queue behind it.

export interface PoolItemSize {
  bytes: number;
}

export interface AdaptivePolicyOptions {
  maxConcurrency?: number;
  largeFileBytes?: number;
  dropAfterConsecutiveFailures?: number;
  recoverAfterConsecutiveSuccesses?: number;
}

export const DEFAULT_MAX_CONCURRENCY = 3;
export const DEFAULT_LARGE_FILE_BYTES = 50 * 1024 * 1024;

export class AdaptiveConcurrencyPolicy {
  private readonly max: number;
  private readonly largeBytes: number;
  private readonly dropAfter: number;
  private readonly recoverAfter: number;

  private limit: number;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;

  constructor(options: AdaptivePolicyOptions = {}) {
    this.max = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.largeBytes = options.largeFileBytes ?? DEFAULT_LARGE_FILE_BYTES;
    this.dropAfter = options.dropAfterConsecutiveFailures ?? 2;
    this.recoverAfter = options.recoverAfterConsecutiveSuccesses ?? 2;
    this.limit = this.max;
  }

  get concurrency(): number {
    return this.limit;
  }

  isLarge(item: PoolItemSize): boolean {
    return item.bytes > this.largeBytes;
  }

  // Whether `next` may start given the currently running set. Callers iterate
  // their queue in order and may skip a blocked large file so small photos
  // keep flowing.
  canStart(running: readonly PoolItemSize[], next: PoolItemSize): boolean {
    if (running.length >= this.limit) return false;
    if (this.isLarge(next) && running.some((item) => this.isLarge(item))) return false;
    return true;
  }

  noteSuccess(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses += 1;
    if (this.consecutiveSuccesses >= this.recoverAfter && this.limit < this.max) {
      this.limit += 1;
      this.consecutiveSuccesses = 0;
    }
  }

  // A stall or retryable failure: the network is struggling. Permanent
  // failures (413, 415…) say nothing about network health and must NOT be
  // reported here.
  noteRetryableFailure(): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.dropAfter && this.limit > 1) {
      this.limit -= 1;
      this.consecutiveFailures = 0;
    }
  }
}
