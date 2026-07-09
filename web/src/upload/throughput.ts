// EMA-smoothed throughput estimation for the aggregate progress bar.
// α ≈ 0.1 keeps the estimate calm: one fast progress burst doesn't swing the
// ETA around, but a genuinely changed network settles in within ~20 samples.

export const DEFAULT_EMA_ALPHA = 0.1;

export class ThroughputEstimator {
  private emaBps: number | null = null;
  private lastBytes: number | null = null;
  private lastTimeMs: number | null = null;

  constructor(private readonly alpha: number = DEFAULT_EMA_ALPHA) {}

  // Feed the current cumulative byte count. Samples closer than 250ms are
  // ignored so a flurry of progress events can't produce noisy rates.
  update(totalBytes: number, nowMs: number): void {
    if (this.lastBytes === null || this.lastTimeMs === null) {
      this.lastBytes = totalBytes;
      this.lastTimeMs = nowMs;
      return;
    }
    const dtMs = nowMs - this.lastTimeMs;
    if (dtMs < 250) return;
    const deltaBytes = totalBytes - this.lastBytes;
    if (deltaBytes < 0) {
      // Cumulative count went backwards (a retry reset a file's progress):
      // re-baseline instead of producing a negative rate.
      this.lastBytes = totalBytes;
      this.lastTimeMs = nowMs;
      return;
    }
    const rate = (deltaBytes / dtMs) * 1000;
    this.emaBps = this.emaBps === null ? rate : this.alpha * rate + (1 - this.alpha) * this.emaBps;
    this.lastBytes = totalBytes;
    this.lastTimeMs = nowMs;
  }

  get bytesPerSecond(): number | null {
    return this.emaBps;
  }

  etaSeconds(remainingBytes: number): number | null {
    if (this.emaBps === null || this.emaBps <= 0) return null;
    if (remainingBytes <= 0) return 0;
    return remainingBytes / this.emaBps;
  }

  reset(): void {
    this.emaBps = null;
    this.lastBytes = null;
    this.lastTimeMs = null;
  }
}

export type CoarseEta =
  | { unit: 'seconds'; value: number }
  | { unit: 'minutes'; value: number }
  | { unit: 'hours'; value: number };

// Coarse, honest buckets — "~4 min", never "3:47 remaining". Estimates from
// an EMA are ±30% on real networks; precision would be a lie.
export function coarseEta(seconds: number): CoarseEta {
  if (seconds < 60) {
    // Steps of 10s, minimum 10s: "~10 s", "~20 s", …
    return { unit: 'seconds', value: Math.max(10, Math.ceil(seconds / 10) * 10) };
  }
  const minutes = seconds / 60;
  if (minutes < 90) {
    return { unit: 'minutes', value: Math.max(1, Math.round(minutes)) };
  }
  return { unit: 'hours', value: Math.max(2, Math.round(minutes / 60)) };
}
