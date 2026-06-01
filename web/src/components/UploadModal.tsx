import { AlertCircle, Check, FileImage, Upload, X } from 'lucide-solid';
import { createSignal, For, Show } from 'solid-js';
import { captureEvent } from '~/analytics';
import { api } from '~/api/client';
import { isUploading, setIsUploading, setSharedLink } from '~/store/share';

interface UploadFile {
  id: number;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  error?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function UploadModal(props: Props) {
  const [files, setFiles] = createSignal<UploadFile[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let nextUploadId = 1;

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
    }
  }

  function addFiles(newFiles: File[]) {
    const validFiles = newFiles.filter(
      (file) => file.type.startsWith('image/') || file.type.startsWith('video/')
    );

    if (validFiles.length === 0) return;

    setFiles((prev) => [
      ...prev,
      ...validFiles.map((file) => ({
        id: nextUploadId++,
        file,
        progress: 0,
        status: 'pending' as const,
      })),
    ]);

    void drainUploadQueue();
  }

  function updateFile(id: number, patch: Partial<UploadFile>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  async function drainUploadQueue() {
    if (isUploading()) return;
    setIsUploading(true);

    let completed = 0;
    let failed = 0;

    try {
      while (true) {
        const uploadFile = files().find((f) => f.status === 'pending');
        if (!uploadFile) break;

        captureEvent('upload_started', { file_count: 1 });
        updateFile(uploadFile.id, { status: 'uploading' });

        try {
          await api.uploadAsset(uploadFile.file, (progress) => {
            updateFile(uploadFile.id, { progress });
          });

          updateFile(uploadFile.id, { status: 'complete', progress: 100 });
          completed += 1;
        } catch (error) {
          failed += 1;
          updateFile(uploadFile.id, {
            status: 'error',
            error: error instanceof Error ? error.message : 'Upload failed',
          });
        }
      }

      if (completed > 0) {
        const updatedLink = await api.getSharedLink();
        setSharedLink(updatedLink);
      }

      if (completed > 0 || failed > 0) {
        captureEvent('upload_finished', { completed_count: completed, failed_count: failed });
      }
    } finally {
      setIsUploading(false);
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function clearCompleted() {
    setFiles((prev) => prev.filter((f) => f.status !== 'complete'));
  }

  function handleClose() {
    if (!isUploading()) {
      setFiles([]);
      props.onClose();
    }
  }

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

  const completedCount = () => files().filter(f => f.status === 'complete').length;
  const pendingCount = () => files().filter(f => f.status === 'pending' || f.status === 'uploading').length;

  return (
    <Show when={props.isOpen}>
      <div class={`sheet-wrap ${props.isOpen ? 'is-open' : ''}`}>
        <div class="sheet-scrim" onClick={handleClose} />
        <div class="sheet scrollbar-hide">
          <div class="sheet-grip" />
          <div class="sheet-head">
            <h2 class="sheet-title">Upload items</h2>
            <button
              type="button"
              class="sheet-x"
              aria-label="Close"
              onClick={handleClose}
              disabled={isUploading()}
            >
              <X size={18} />
            </button>
          </div>

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
            <span class="dz-title">{isDragging() ? 'Drop files here' : 'Drag and drop'}</span>
            <span class="dz-sub">Photos and videos</span>
            <button
              type="button"
              class="dz-browse"
              onClick={(e) => {
                e.stopPropagation();
                inputRef?.click();
              }}
            >
              Browse files
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

          <Show when={files().length > 0}>
            <div class="up-list">
              <For each={files()}>
                {(file, index) => (
                  <div class={`up-item ${file.status === 'complete' ? 'is-done' : ''}`}>
                    <span class="up-ico">
                      <Show when={file.status === 'complete'}>
                        <Check size={16} stroke-width={2.5} />
                      </Show>
                      <Show when={file.status === 'error'}>
                        <AlertCircle size={16} />
                      </Show>
                      <Show when={file.status === 'uploading'}>
                        <Upload size={16} />
                      </Show>
                      <Show when={file.status === 'pending'}>
                        <FileImage size={16} />
                      </Show>
                    </span>
                    <div class="min-w-0">
                      <div class="up-name">{file.file.name}</div>
                      <div class="up-size">
                        {formatFileSize(file.file.size)}
                        <Show when={file.error}>
                          <span style={{ color: '#c0392b', 'margin-left': '6px' }}>{file.error}</span>
                        </Show>
                      </div>
                      <Show when={file.status === 'uploading'}>
                        <div class="up-bar">
                          <div class="up-fill" style={{ width: `${file.progress}%` }} />
                        </div>
                      </Show>
                    </div>
                    <Show when={file.status === 'pending' || file.status === 'error'}>
                      <button
                        type="button"
                        class="sheet-x"
                        aria-label="Remove"
                        onClick={() => removeFile(index())}
                      >
                        <X size={14} />
                      </button>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={completedCount() > 0}>
                <button
                  type="button"
                  class="dz-browse"
                  style={{ width: '100%' }}
                  onClick={clearCompleted}
                >
                  Clear completed ({completedCount()})
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
