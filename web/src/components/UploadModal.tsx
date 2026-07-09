import {
  AlertCircle,
  Check,
  FileImage,
  Film,
  Loader2,
  RotateCw,
  Upload,
  WifiOff,
  X,
} from 'lucide-solid';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { captureEvent } from '~/analytics';
import { api, ApiError, isRetryableUploadError } from '~/api/client';
import { t } from '~/i18n';
import { isUploading, setIsUploading, setSharedLink } from '~/store/share';
import { FileHasher } from '~/upload/hasher';
import { UploadQueue, type UploadQueueItem, type UploadQueueSummary } from '~/upload/queue';
import { coarseEta, ThroughputEstimator, type CoarseEta } from '~/upload/throughput';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const TERMINAL = new Set(['done', 'duplicate', 'failed', 'too-large']);

export default function UploadModal(props: Props) {
  // Queue snapshots land in a store reconciled by id so tiles keep their DOM
  // (and their <img>) across progress updates — a 200-photo grid must not be
  // rebuilt on every progress event.
  const [items, setItems] = createStore<UploadQueueItem[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);
  const [offline, setOffline] = createSignal(false);
  const [lastSummary, setLastSummary] = createSignal<UploadQueueSummary | null>(null);
  const [eta, setEta] = createSignal<CoarseEta | null>(null);
  // Object-URL previews keyed by File (stable reference). Chrome can't decode
  // HEIC — those <img>s error out and land in `broken`, rendering the
  // placeholder tile. Safari decodes HEIC natively and never errors. This is
  // per-file feature detection, not UA sniffing.
  const [previews, setPreviews] = createSignal<Map<File, string>>(new Map());
  const [broken, setBroken] = createSignal<Set<File>>(new Set());
  let inputRef: HTMLInputElement | undefined;

  const canPreview = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  const hasher = new FileHasher();
  const estimator = new ThroughputEstimator();

  const queue = new UploadQueue({
    hashFile: (file) => hasher.hash(file),
    checkExisting: async (files) => {
      const results = await api.checkUploads(files);
      return new Map(results.map((r) => [r.checksum, { exists: r.exists, assetId: r.assetId }]));
    },
    uploadFile: (file, opts) =>
      api.uploadAssetWithRetry(file, {
        checksum: opts.checksum,
        onProgress: opts.onProgress,
        onRetry: opts.onRetry,
      }),
    isTooLarge: (error) => error instanceof ApiError && error.status === 413,
    isRetryable: isRetryableUploadError,
    isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
    onChange: (snapshot) => {
      setItems(reconcile(snapshot, { key: 'id' }));
      setIsUploading(queue.isActive());
      updateEta(snapshot);
    },
    onRetryScheduled: (attempt, maxAttempts) => {
      captureEvent('upload_retry', { attempt, max_attempts: maxAttempts });
    },
    onSettled: (summary) => {
      setLastSummary(summary);
      estimator.reset();
      setEta(null);
      captureEvent('upload_finished', {
        completed_count: summary.done,
        duplicate_count: summary.duplicates,
        failed_count: summary.failed,
      });
      if (summary.done > 0 || summary.duplicates > 0) {
        void refreshSharedLink();
      }
    },
  });

  async function refreshSharedLink() {
    try {
      const updatedLink = await api.getSharedLink();
      setSharedLink(updatedLink);
    } catch {
      // The gallery keeps its previous state; a manual reload recovers.
    }
  }

  // ---- aggregate progress (byte-weighted) ----

  function updateEta(snapshot: UploadQueueItem[]) {
    // ETA covers bytes that actually travel: duplicates are excluded (they
    // cost zero bytes), failed files are out of the race.
    let uploaded = 0;
    let remaining = 0;
    for (const item of snapshot) {
      if (item.status === 'done') {
        uploaded += item.file.size;
      } else if (item.status === 'uploading') {
        const loaded = (item.progress / 100) * item.file.size;
        uploaded += loaded;
        remaining += item.file.size - loaded;
      } else if (
        item.status === 'pending' ||
        item.status === 'hashing' ||
        item.status === 'checking' ||
        item.status === 'queued'
      ) {
        remaining += item.file.size;
      }
    }
    estimator.update(uploaded, Date.now());
    const seconds = estimator.etaSeconds(remaining);
    setEta(remaining > 0 && seconds !== null ? coarseEta(seconds) : null);
  }

  const totalBytes = () => items.reduce((sum, item) => sum + item.file.size, 0);
  const settledBytes = () =>
    items.reduce((sum, item) => {
      if (TERMINAL.has(item.status)) return sum + item.file.size;
      if (item.status === 'uploading') return sum + (item.progress / 100) * item.file.size;
      return sum;
    }, 0);
  const aggregatePercent = () => {
    const total = totalBytes();
    return total > 0 ? Math.min(100, (settledBytes() / total) * 100) : 0;
  };

  const settledCount = () => items.filter((item) => TERMINAL.has(item.status)).length;
  const completedCount = () =>
    items.filter((item) => item.status === 'done' || item.status === 'duplicate').length;
  const failedCount = () =>
    items.filter((item) => item.status === 'failed' || item.status === 'too-large').length;

  const etaText = () => {
    const value = eta();
    if (!value) return '';
    if (value.unit === 'seconds') return t().upload.etaSeconds(value.value);
    if (value.unit === 'minutes') return t().upload.etaMinutes(value.value);
    return t().upload.etaHours(value.value);
  };

  // ---- file intake ----

  function addFiles(newFiles: File[]) {
    const validFiles = newFiles.filter(
      (file) => file.type.startsWith('image/') || file.type.startsWith('video/')
    );
    if (validFiles.length === 0) return;

    if (canPreview) {
      const next = new Map(previews());
      for (const file of validFiles) {
        // Videos get the icon placeholder: decoding a frame is not worth the
        // memory on big batches. Images preview via object URL (the browser
        // only decodes what is on screen; tiles render lazily).
        if (file.type.startsWith('image/') && !next.has(file)) {
          next.set(file, URL.createObjectURL(file));
        }
      }
      setPreviews(next);
    }

    setLastSummary(null);
    captureEvent('upload_started', { file_count: validFiles.length });
    queue.addFiles(validFiles);
  }

  function releasePreviews(files: File[]) {
    if (files.length === 0) return;
    const next = new Map(previews());
    const nextBroken = new Set(broken());
    for (const file of files) {
      const url = next.get(file);
      if (url) {
        URL.revokeObjectURL(url);
        next.delete(file);
      }
      nextBroken.delete(file);
    }
    setPreviews(next);
    setBroken(nextBroken);
  }

  function markBroken(file: File) {
    const next = new Set(broken());
    next.add(file);
    setBroken(next);
  }

  // ---- dropzone handlers ----

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer?.files;
    if (droppedFiles) {
      addFiles(Array.from(droppedFiles));
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) {
      addFiles(Array.from(input.files));
      input.value = '';
    }
  }

  // ---- actions ----

  function removeItem(id: number) {
    const removed = queue.remove(id);
    if (removed) releasePreviews([removed.file]);
  }

  function clearCompleted() {
    releasePreviews(queue.clearCompleted().map((item) => item.file));
  }

  function retryFailed() {
    setLastSummary(null);
    queue.retryFailed();
  }

  function handleClose() {
    if (queue.isActive()) return;
    releasePreviews(queue.reset().map((item) => item.file));
    setLastSummary(null);
    props.onClose();
  }

  // ---- environment listeners ----

  const goOffline = () => {
    // Don't start new uploads; whatever is in flight rides on. Failures that
    // arrive while offline are parked, never marked failed.
    setOffline(true);
    queue.pause();
  };
  const goOnline = () => {
    setOffline(false);
    queue.resume();
  };
  const guardUnload = (e: BeforeUnloadEvent) => {
    if (queue.isActive()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    window.addEventListener('beforeunload', guardUnload);
    if (typeof navigator !== 'undefined' && !navigator.onLine) goOffline();
  }

  onCleanup(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('beforeunload', guardUnload);
    }
    releasePreviews(Array.from(previews().keys()));
    queue.dispose();
    hasher.dispose();
  });

  function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  return (
    <Show when={props.isOpen}>
      <div class={`sheet-wrap ${props.isOpen ? 'is-open' : ''}`}>
        <div class="sheet-scrim" onClick={handleClose} />
        <div class="sheet scrollbar-hide">
          <div class="sheet-grip" />
          <div class="sheet-head">
            <h2 class="sheet-title">{t().upload.title}</h2>
            <button
              type="button"
              class="sheet-x"
              aria-label={t().upload.close}
              onClick={handleClose}
              disabled={isUploading()}
            >
              <X size={18} />
            </button>
          </div>

          <Show when={offline()}>
            <div class="up-offline" data-testid="upload-offline">
              <WifiOff size={15} />
              <span>{t().upload.offlinePaused}</span>
            </div>
          </Show>

          <div
            class={`dropzone ${isDragging() ? 'is-drag' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => inputRef?.click()}
            role="button"
            tabIndex={0}
          >
            <FileImage size={28} stroke-width={1.8} />
            <span class="dz-title">{isDragging() ? t().upload.dropHere : t().upload.dragAndDrop}</span>
            <span class="dz-sub">{t().upload.photosAndVideos}</span>
            <button
              type="button"
              class="dz-browse"
              onClick={(e) => {
                e.stopPropagation();
                inputRef?.click();
              }}
            >
              {t().upload.browse}
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              class="hidden"
              onChange={handleFileSelect}
            />
          </div>

          <Show when={items.length > 0}>
            <div class="up-aggregate" data-testid="upload-aggregate">
              <div class="up-agg-bar">
                <div class="up-agg-fill" style={{ width: `${aggregatePercent()}%` }} />
              </div>
              <div class="up-agg-meta">
                <span data-testid="upload-count">
                  {t().upload.progressCount(settledCount(), items.length)}
                </span>
                <Show when={eta() && isUploading()}>
                  <span data-testid="upload-eta">{etaText()}</span>
                </Show>
              </div>
            </div>

            <Show when={lastSummary()}>
              {(summary) => (
                <div class="up-batch-summary" data-testid="upload-summary">
                  {[
                    summary().done > 0 ? t().upload.summaryUploaded(summary().done) : null,
                    summary().duplicates > 0
                      ? t().upload.summaryDuplicates(summary().duplicates)
                      : null,
                    summary().failed > 0 ? t().upload.summaryFailed(summary().failed) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
            </Show>

            <div class="up-grid">
              <For each={items}>
                {(item) => (
                  <div
                    class={`up-tile is-${item.status}`}
                    data-testid="upload-tile"
                    data-status={item.status}
                    data-name={item.file.name}
                  >
                    <div class="up-tile-media">
                      <Show
                        when={
                          canPreview && previews().get(item.file) && !broken().has(item.file)
                        }
                        fallback={
                          <span class="up-tile-fallback" data-testid="upload-tile-fallback">
                            <Show
                              when={item.file.type.startsWith('video/')}
                              fallback={<FileImage size={22} stroke-width={1.6} />}
                            >
                              <Film size={22} stroke-width={1.6} />
                            </Show>
                          </span>
                        }
                      >
                        <img
                          class="up-tile-thumb"
                          src={previews().get(item.file)}
                          alt={item.file.name}
                          loading="lazy"
                          decoding="async"
                          onError={() => markBroken(item.file)}
                        />
                      </Show>

                      <Show when={item.status === 'uploading'}>
                        <div class="up-tile-bar">
                          <div class="up-tile-fill" style={{ width: `${item.progress}%` }} />
                        </div>
                      </Show>

                      <Show when={item.status === 'hashing' || item.status === 'checking'}>
                        <span class="up-tile-badge is-busy">
                          <Loader2 size={13} class="up-spin" />
                        </span>
                      </Show>
                      <Show when={item.status === 'done'}>
                        <span class="up-tile-badge is-done">
                          <Check size={13} stroke-width={3} />
                        </span>
                      </Show>
                      <Show when={item.status === 'duplicate'}>
                        <span class="up-tile-badge is-dup" data-testid="upload-duplicate">
                          <Check size={13} stroke-width={3} />
                        </span>
                      </Show>
                      <Show when={item.status === 'failed' || item.status === 'too-large'}>
                        <span class="up-tile-badge is-fail">
                          <AlertCircle size={13} />
                        </span>
                      </Show>
                      <Show when={item.status === 'uploading'}>
                        <span class="up-tile-badge is-busy">
                          <Upload size={13} />
                        </span>
                      </Show>

                      <Show
                        when={
                          item.status === 'pending' ||
                          item.status === 'queued' ||
                          item.status === 'failed' ||
                          item.status === 'too-large'
                        }
                      >
                        <button
                          type="button"
                          class="up-tile-x"
                          aria-label={t().upload.remove}
                          onClick={() => removeItem(item.id)}
                        >
                          <X size={12} />
                        </button>
                      </Show>
                    </div>

                    <div class="up-tile-caption">
                      <div class="up-name">{item.file.name}</div>
                      <div class="up-size">
                        {formatFileSize(item.file.size)}
                        <Show when={item.status === 'pending' || item.status === 'hashing'}>
                          <span class="up-status">{t().upload.preparing}</span>
                        </Show>
                        <Show when={item.status === 'checking'}>
                          <span class="up-status">{t().upload.checking}</span>
                        </Show>
                        <Show when={item.status === 'queued'}>
                          <span class="up-status">{t().upload.waiting}</span>
                        </Show>
                        <Show when={item.status === 'uploading' && (item.attempt ?? 1) <= 1}>
                          <span class="up-status">{Math.round(item.progress)}%</span>
                        </Show>
                        <Show when={item.status === 'uploading' && (item.attempt ?? 1) > 1}>
                          <span class="up-status is-retry" data-testid="upload-retrying">
                            {t().upload.retrying(
                              item.attempt ?? 1,
                              item.maxAttempts ?? item.attempt ?? 1
                            )}
                          </span>
                        </Show>
                        <Show when={item.status === 'duplicate'}>
                          <span class="up-status is-dup">{t().upload.duplicate}</span>
                        </Show>
                        <Show when={item.status === 'too-large'}>
                          <span class="up-status is-fail">{t().upload.tooLarge}</span>
                        </Show>
                        <Show when={item.error}>
                          <span class="up-status is-fail">{item.error}</span>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>

            <div class="up-actions">
              <Show when={failedCount() > 0 && !isUploading()}>
                <button
                  type="button"
                  class="dz-browse"
                  style={{ width: '100%' }}
                  data-testid="upload-retry-failed"
                  onClick={retryFailed}
                >
                  <RotateCw size={14} style={{ 'vertical-align': '-2px', 'margin-right': '6px' }} />
                  {t().upload.retryFailed(failedCount())}
                </button>
              </Show>
              <Show when={completedCount() > 0}>
                <button
                  type="button"
                  class="dz-browse"
                  style={{ width: '100%' }}
                  onClick={clearCompleted}
                >
                  {t().upload.clearCompleted(completedCount())}
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
