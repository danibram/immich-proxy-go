import { AdaptiveConcurrencyPolicy } from './pool';

// UploadQueue is the framework-agnostic state machine behind the upload UI:
// hash → dedupe-check → adaptive parallel upload, with pause/resume and
// retry. It knows nothing about Solid or the DOM — the modal subscribes via
// onChange and renders snapshots; tests drive it with fake deps.
//
// Per-file lifecycle:
//   pending → hashing → checking → queued → uploading → done
//                                        ↘ duplicate (zero bytes uploaded)
//                              uploading ↘ failed  (queue advances; see failureKind)
//                              uploading → queued  (failure while offline: not a verdict)
//
// The retry loop lives HERE, not in the API client: the queue owns attempt
// state (rendered by the UI), notifies the adaptive policy, and fires the
// analytics hook — one attempt = one deps.uploadFile call.

export type UploadItemStatus =
  | 'pending'
  | 'hashing'
  | 'checking'
  | 'queued'
  | 'uploading'
  | 'done'
  | 'duplicate'
  | 'failed';

/** Why a failed item failed, classified at the edge — never a raw message. */
export type UploadFailureKind = 'too-large' | 'error';

export interface UploadFailure {
  kind: UploadFailureKind;
  /** Optional short display detail (e.g. "HTTP 500"). Never a response body. */
  detail?: string;
}

export const isTerminal = (status: UploadItemStatus): boolean =>
  status === 'done' || status === 'duplicate' || status === 'failed';

export const isFailed = (status: UploadItemStatus): boolean => status === 'failed';

export interface UploadQueueItem {
  id: number;
  file: File;
  status: UploadItemStatus;
  /** Upload progress 0–100 (percent of this file's bytes). */
  progress: number;
  checksum?: string;
  failureKind?: UploadFailureKind;
  failureDetail?: string;
  attempt?: number;
  maxAttempts?: number;
  assetId?: string;
}

export interface UploadOutcome {
  id: string;
  status?: string; // "created" | "duplicate" | "replaced" on current Immich
}

export interface UploadQueueSummary {
  done: number;
  duplicates: number;
  failed: number;
}

export interface UploadQueueDeps {
  hashFile(file: File): Promise<string>;
  /** Batch dedupe check; resolves a map keyed by checksum. */
  checkExisting(
    files: Array<{ name: string; checksum: string }>
  ): Promise<Map<string, { exists: boolean; assetId?: string }>>;
  /** Single upload attempt; the queue drives retries around it. */
  uploadFile(
    file: File,
    opts: {
      checksum?: string;
      onProgress: (percent: number) => void;
    }
  ): Promise<UploadOutcome>;
  /** Classify a terminal failure for display. */
  classifyFailure(error: unknown): UploadFailure;
  /** Retryable-class errors get more attempts and feed the adaptive policy. */
  isRetryable(error: unknown): boolean;
  /** Backoff schedule between attempts; attempts = length + 1. Default: no retries. */
  retryDelaysMs?: () => number[];
  isOnline?: () => boolean;
  onChange?: (items: UploadQueueItem[]) => void;
  /** Fires each time the queue drains to idle after doing work. */
  onSettled?: (summary: UploadQueueSummary) => void;
  /** A retryable failure scheduled another attempt (1-based, for analytics/UI). */
  onRetryScheduled?: (attempt: number, maxAttempts: number) => void;
  policy?: AdaptiveConcurrencyPolicy;
}

const ACTIVE_STATUSES: ReadonlySet<UploadItemStatus> = new Set([
  'pending',
  'hashing',
  'checking',
  'queued',
  'uploading',
]);

export class UploadQueue {
  private items: UploadQueueItem[] = [];
  private nextId = 1;
  private paused = false;
  private disposed = false;
  private hadActivity = false;
  private readonly policy: AdaptiveConcurrencyPolicy;

  constructor(private readonly deps: UploadQueueDeps) {
    this.policy = deps.policy ?? new AdaptiveConcurrencyPolicy();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  snapshot(): UploadQueueItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  isActive(): boolean {
    return this.items.some((item) => ACTIVE_STATUSES.has(item.status));
  }

  isUploadingAny(): boolean {
    return this.items.some((item) => item.status === 'uploading');
  }

  addFiles(files: File[]): UploadQueueItem[] {
    if (this.disposed || files.length === 0) return [];
    const batch = files.map((file) => {
      const item: UploadQueueItem = {
        id: this.nextId++,
        file,
        status: 'pending',
        progress: 0,
      };
      this.items.push(item);
      return item;
    });
    this.hadActivity = true;
    this.emit();
    void this.processBatch(batch.map((item) => item.id));
    return batch.map((item) => ({ ...item }));
  }

  pause(): void {
    // Stop starting new uploads; in-flight requests ride on. Failures that
    // arrive while offline re-queue instead of counting as verdicts.
    this.paused = true;
    this.emit();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.emit();
    this.pump();
  }

  retryFailed(): number {
    let requeued = 0;
    for (const item of this.items) {
      if (isFailed(item.status)) {
        this.park(item);
        requeued += 1;
      }
    }
    if (requeued > 0) {
      this.hadActivity = true;
      this.emit();
      this.pump();
    }
    return requeued;
  }

  /** Remove a single not-in-flight item. Returns it when removed. */
  remove(id: number): UploadQueueItem | undefined {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1 || this.items[index].status === 'uploading') return undefined;
    const [removed] = this.items.splice(index, 1);
    this.emit();
    return removed;
  }

  /** Remove finished items (done + duplicate). Returns them. */
  clearCompleted(): UploadQueueItem[] {
    const cleared = this.items.filter(
      (item) => item.status === 'done' || item.status === 'duplicate'
    );
    this.items = this.items.filter(
      (item) => item.status !== 'done' && item.status !== 'duplicate'
    );
    this.emit();
    return cleared;
  }

  /** Drop everything (modal closed while idle). Returns the dropped items. */
  reset(): UploadQueueItem[] {
    const all = this.items;
    this.items = [];
    this.hadActivity = false;
    this.emit();
    return all;
  }

  dispose(): void {
    this.disposed = true;
    this.items = [];
  }

  summary(): UploadQueueSummary {
    return {
      done: this.items.filter((item) => item.status === 'done').length,
      duplicates: this.items.filter((item) => item.status === 'duplicate').length,
      failed: this.items.filter((item) => isFailed(item.status)).length,
    };
  }

  // ---- pipeline ----

  private async processBatch(ids: number[]): Promise<void> {
    // Hash sequentially (one worker, constant memory), then one dedupe check
    // for the whole selection so already-uploaded files cost zero bytes.
    for (const id of ids) {
      const item = this.find(id);
      if (!item || item.status !== 'pending') continue;
      item.status = 'hashing';
      this.emit();
      try {
        item.checksum = await this.deps.hashFile(item.file);
      } catch {
        // No checksum: upload anyway; Immich dedupes server-side regardless.
        item.checksum = undefined;
      }
      if (this.disposed) return;
    }

    const batch = ids
      .map((id) => this.find(id))
      .filter((item): item is UploadQueueItem => item !== undefined && item.status === 'hashing');
    const withChecksum = batch.filter((item) => item.checksum);

    if (withChecksum.length > 0) {
      for (const item of withChecksum) {
        item.status = 'checking';
      }
      this.emit();
      try {
        const existing = await this.deps.checkExisting(
          withChecksum.map((item) => ({ name: item.file.name, checksum: item.checksum! }))
        );
        for (const item of withChecksum) {
          const verdict = existing.get(item.checksum!);
          if (verdict?.exists) {
            item.status = 'duplicate';
            item.progress = 100;
            item.assetId = verdict.assetId;
          }
        }
      } catch {
        // Check unavailable: fall back to per-file dedupe via the checksum
        // header on the upload POST itself.
      }
    }

    if (this.disposed) return;
    for (const item of batch) {
      if (item.status === 'hashing' || item.status === 'checking') {
        item.status = 'queued';
      }
    }
    this.emit();
    this.pump();
    this.maybeSettle();
  }

  private pump(): void {
    if (this.paused || this.disposed) return;

    // Start queued items in order while the policy allows. A blocked large
    // file is skipped (not a barrier) so photos keep flowing around a video.
    const running = this.items.filter((item) => item.status === 'uploading');
    for (const item of this.items) {
      if (running.length >= this.policy.concurrency) break;
      if (item.status !== 'queued') continue;
      if (!this.policy.canStart(running.map((i) => ({ bytes: i.file.size })), { bytes: item.file.size })) {
        continue;
      }
      running.push(item);
      void this.runUpload(item);
    }
  }

  /** Reset an item to queued with a clean slate (offline park, manual retry). */
  private park(item: UploadQueueItem): void {
    item.status = 'queued';
    item.progress = 0;
    item.failureKind = undefined;
    item.failureDetail = undefined;
    item.attempt = undefined;
    item.maxAttempts = undefined;
  }

  private async runUpload(item: UploadQueueItem): Promise<void> {
    const delays = this.deps.retryDelaysMs?.() ?? [];
    const maxAttempts = delays.length + 1;
    item.status = 'uploading';
    item.progress = 0;
    item.failureKind = undefined;
    item.failureDetail = undefined;
    item.attempt = 1;
    item.maxAttempts = maxAttempts;
    this.emit();

    for (;;) {
      try {
        const outcome = await this.deps.uploadFile(item.file, {
          checksum: item.checksum,
          onProgress: (percent) => {
            item.progress = percent;
            this.emit();
          },
        });
        this.policy.noteSuccess();
        item.assetId = outcome.id;
        item.progress = 100;
        // The server may answer 200 {status:"duplicate"} — either instantly
        // via the checksum header, or after a retry whose first attempt
        // actually landed. Either way: it's in the album, zero further cost.
        item.status = outcome.status === 'duplicate' ? 'duplicate' : 'done';
        break;
      } catch (error) {
        if (this.deps.isOnline && !this.deps.isOnline()) {
          // Offline is not a verdict on the file. Park it; the online
          // handler resumes the queue and it gets a fresh set of attempts.
          this.park(item);
          break;
        }
        const retryable = this.deps.isRetryable(error);
        if (retryable) {
          // Stall or transient failure: the network is struggling — the
          // policy's single notification point.
          this.policy.noteRetryableFailure();
        }
        if (retryable && item.attempt! < maxAttempts) {
          item.attempt! += 1;
          item.progress = 0;
          this.deps.onRetryScheduled?.(item.attempt!, maxAttempts);
          this.emit();
          await new Promise((resolve) => setTimeout(resolve, delays[item.attempt! - 2]));
          if (this.disposed) return;
          continue;
        }
        const failure = this.deps.classifyFailure(error);
        item.status = 'failed';
        item.failureKind = failure.kind;
        item.failureDetail = failure.detail;
        break;
      }
    }

    this.emit();
    this.pump();
    this.maybeSettle();
  }

  private maybeSettle(): void {
    if (!this.hadActivity || this.isActive() || this.disposed) return;
    this.hadActivity = false;
    this.deps.onSettled?.(this.summary());
  }

  private find(id: number): UploadQueueItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  private emit(): void {
    if (this.disposed) return;
    this.deps.onChange?.(this.snapshot());
  }
}
