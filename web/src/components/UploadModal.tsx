import { AlertCircle, Check, FileImage, Upload, X } from 'lucide-solid';
import { createSignal, For, Show } from 'solid-js';
import { captureEvent } from '~/analytics';
import { api } from '~/api/client';
import { isUploading, setIsUploading, setSharedLink } from '~/store/share';

interface UploadFile {
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

    setFiles((prev) => [
      ...prev,
      ...validFiles.map((file) => ({
        file,
        progress: 0,
        status: 'pending' as const,
      })),
    ]);

    uploadFiles();
  }

  async function uploadFiles() {
    if (isUploading()) return;
    setIsUploading(true);

    const currentFiles = files();
    const pendingFiles = currentFiles.filter((f) => f.status === 'pending');
    if (pendingFiles.length > 0) {
      captureEvent('upload_started', { file_count: pendingFiles.length });
    }

    let completed = 0;
    let failed = 0;
    for (let i = 0; i < currentFiles.length; i++) {
      const uploadFile = currentFiles[i];
      if (uploadFile.status !== 'pending') continue;

      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading' as const } : f))
      );

      try {
        await api.uploadAsset(uploadFile.file, (progress) => {
          setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, progress } : f)));
        });

        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: 'complete' as const, progress: 100 } : f
          )
        );

        // Refresh album data (backend returns full album in single request)
        const updatedLink = await api.getSharedLink();
        setSharedLink(updatedLink);
        completed += 1;
      } catch (error) {
        failed += 1;
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: 'error' as const, error: error instanceof Error ? error.message : 'Upload failed' }
              : f
          )
        );
      }
    }

    if (completed > 0 || failed > 0) {
      captureEvent('upload_finished', { completed_count: completed, failed_count: failed });
    }

    setIsUploading(false);
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
      <div
        class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
        onClick={(e) => e.target === e.currentTarget && handleClose()}
      >
        <div class="glass-card rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden animate-scaleIn">
          {/* Header */}
          <div class="flex items-center justify-between p-4 border-b border-white/10">
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-xl bg-icy-aqua/20">
                <Upload class="w-5 h-5 text-icy-aqua" />
              </div>
              <h2 class="text-lg font-semibold text-white">Upload</h2>
            </div>
            <button
              class="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-50"
              onClick={handleClose}
              disabled={isUploading()}
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div class="p-4 overflow-y-auto flex-1">
            {/* Drop zone */}
            <div
              class={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${isDragging()
                ? 'border-icy-aqua bg-icy-aqua/10'
                : 'border-white/10 hover:border-white/20'
                }`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div class="w-14 h-14 mx-auto mb-4 rounded-xl bg-white/5 flex items-center justify-center">
                <FileImage class="w-7 h-7 text-white/40" />
              </div>
              <p class="text-white/80 mb-1 font-medium">
                {isDragging() ? 'Drop files here' : 'Drag and drop'}
              </p>
              <p class="text-white/40 text-sm mb-4">or click to browse</p>
              <button
                class="px-5 py-2 rounded-lg bg-blue-slate hover:bg-blue-slate/80 text-white font-medium text-sm"
                onClick={() => inputRef?.click()}
              >
                Browse Files
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

            {/* File list */}
            <Show when={files().length > 0}>
              <div class="mt-4">
                <div class="flex justify-between items-center mb-3">
                  <div class="flex items-center gap-2 text-xs">
                    <Show when={completedCount() > 0}>
                      <span class="px-2 py-1 rounded-md bg-green-500/20 text-green-400">
                        {completedCount()} done
                      </span>
                    </Show>
                    <Show when={pendingCount() > 0}>
                      <span class="px-2 py-1 rounded-md bg-light-blue/20 text-light-blue">
                        {pendingCount()} pending
                      </span>
                    </Show>
                  </div>
                  <Show when={completedCount() > 0}>
                    <button
                      class="text-xs text-white/40 hover:text-white"
                      onClick={clearCompleted}
                    >
                      Clear completed
                    </button>
                  </Show>
                </div>

                <div class="space-y-2 max-h-48 overflow-y-auto">
                  <For each={files()}>
                    {(file, index) => (
                      <div class="flex items-center gap-3 p-2.5 rounded-lg bg-white/5">
                        <div class="w-7 h-7 rounded-md bg-white/5 flex items-center justify-center flex-shrink-0">
                          <Show when={file.status === 'complete'}>
                            <Check class="w-4 h-4 text-green-400" />
                          </Show>
                          <Show when={file.status === 'error'}>
                            <AlertCircle class="w-4 h-4 text-red-400" />
                          </Show>
                          <Show when={file.status === 'uploading'}>
                            <div class="w-4 h-4 border-2 border-icy-aqua border-t-transparent rounded-full animate-spin" />
                          </Show>
                          <Show when={file.status === 'pending'}>
                            <div class="w-4 h-4 border-2 border-white/20 rounded-full" />
                          </Show>
                        </div>

                        <div class="flex-1 min-w-0">
                          <div class="text-sm text-white/90 truncate">{file.file.name}</div>
                          <div class="text-xs text-white/40">
                            {formatFileSize(file.file.size)}
                            <Show when={file.error}>
                              <span class="text-red-400 ml-2">{file.error}</span>
                            </Show>
                          </div>

                          <Show when={file.status === 'uploading'}>
                            <div class="mt-1.5 h-1 bg-white/10 rounded-full overflow-hidden">
                              <div
                                class="h-full bg-icy-aqua"
                                style={{ width: `${file.progress}%` }}
                              />
                            </div>
                          </Show>
                        </div>

                        <Show when={file.status === 'pending' || file.status === 'error'}>
                          <button
                            class="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white"
                            onClick={() => removeFile(index())}
                          >
                            <X class="w-4 h-4" />
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
