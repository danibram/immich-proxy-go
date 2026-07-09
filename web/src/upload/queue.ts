import { AdaptiveConcurrencyPolicy } from './pool';

// UploadQueue is the framework-agnostic state machine behind the upload UI:
// hash → dedupe-check → adaptive parallel upload, with pause/resume and
// retry. It knows nothing about Solid or the DOM — the modal subscribes via
// onChange and renders snapshots; tests drive it with fake deps.
//
// Per-file lifecycle:
//   pending → hashing → checking → queued → uploading → done
//                                        ↘ duplicate (zero bytes uploaded)
//                              uploading ↘ failed | too-large  (queue advances)
//                              uploading → queued  (failure while offline: not a verdict)

export type UploadItemStatus =
  | 'pending'
  | 'hashing'
  | 'checking'
  | 'queued'
  | 'uploading'
  | 'done'
  | 'duplicate'
  | 'failed'
  | 'too-large';

export interface UploadQueueItem {
  id: number;
  file: File;
  status: UploadItemStatus;
  /** Upload progress 0–100 (percent of this file's bytes). */
  progress: number;
  checksum?: string;
  error?: string;
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
  uploadFile(
    file: File,
    opts: {
      checksum?: string;
      onProgress: (percent: number) => void;
      onRetry: (attempt: number, maxAttempts: number) => void;
    }
  ): Promise<UploadOutcome>;
  /** 413-style "file too large" classification. */
  isTooLarge(error: unknown): boolean;
  /** Retryable-class errors feed the adaptive policy when retries exhaust. */
  isRetryable(error: unknown): boolean;
  isOnline?: () => boolean;
  onChange?: (items: UploadQueueItem[]) => void;
  /** Fires each time the queue drains to idle after doing work. */
  onSettled?: (summary: UploadQueueSummary) => void;
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
      if (item.status === 'failed' || item.status === 'too-large') {
        item.status = 'queued';
        item.progress = 0;
        item.error = undefined;
        item.attempt = undefined;
        item.maxAttempts = undefined;
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

  /** Remove a single not-in-flight item. Returns it for cleanup (object URLs). */
  remove(id: number): UploadQueueItem | undefined {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1 || this.items[index].status === 'uploading') return undefined;
    const [removed] = this.items.splice(index, 1);
    this.emit();
    return removed;
  }

  /** Remove finished items (done + duplicate). Returns them for cleanup. */
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

  /** Drop everything (modal closed while idle). Returns items for cleanup. */
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
      failed: this.items.filter((item) => item.status === 'failed' || item.status === 'too-large')
        .length,
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
    for (const item of this.items) {
      const running = this.items.filter((i) => i.status === 'uploading');
      if (running.length >= this.policy.concurrency) break;
      if (item.status !== 'queued') continue;
      if (!this.policy.canStart(running.map((i) => ({ bytes: i.file.size })), { bytes: item.file.size })) {
        continue;
      }
      this.start(item);
    }
  }

  private start(item: UploadQueueItem): void {
    item.status = 'uploading';
    item.progress = 0;
    item.error = undefined;
    item.attempt = 1;
    this.emit();

    this.deps
      .uploadFile(item.file, {
        checksum: item.checksum,
        onProgress: (percent) => {
          item.progress = percent;
          this.emit();
        },
        onRetry: (attempt, maxAttempts) => {
          // A stall/transient failure scheduled another attempt: surface it
          // and tell the policy the network is struggling.
          item.attempt = attempt;
          item.maxAttempts = maxAttempts;
          item.progress = 0;
          this.policy.noteRetryableFailure();
          this.deps.onRetryScheduled?.(attempt, maxAttempts);
          this.emit();
        },
      })
      .then((outcome) => {
        this.policy.noteSuccess();
        item.assetId = outcome.id;
        item.progress = 100;
        // The server may answer 200 {status:"duplicate"} — either instantly
        // via the checksum header, or after a retry whose first attempt
        // actually landed. Either way: it's in the album, zero further cost.
        item.status = outcome.status === 'duplicate' ? 'duplicate' : 'done';
      })
      .catch((error) => {
        if (this.deps.isOnline && !this.deps.isOnline()) {
          // Offline is not a verdict on the file. Park it; the online
          // handler resumes the queue and it gets a fresh set of attempts.
          item.status = 'queued';
          item.progress = 0;
          item.attempt = undefined;
          item.maxAttempts = undefined;
          return;
        }
        item.error = error instanceof Error ? error.message : String(error);
        if (this.deps.isTooLarge(error)) {
          item.status = 'too-large';
        } else {
          item.status = 'failed';
          if (this.deps.isRetryable(error)) {
            // Retries exhausted on a transient class: one more struggling
            // signal for the policy.
            this.policy.noteRetryableFailure();
          }
        }
      })
      .finally(() => {
        this.emit();
        this.pump();
        this.maybeSettle();
      });
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
