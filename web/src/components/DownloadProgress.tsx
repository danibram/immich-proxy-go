import { Component, Show } from 'solid-js';

interface DownloadProgressProps {
  isOpen: boolean;
  progress: number;
  total: number;
  status: 'starting' | 'processing' | 'downloading' | 'ready' | 'done';
  downloadUrl?: string;
  onClose: () => void;
}

const DownloadProgress: Component<DownloadProgressProps> = (props) => {
  const percentage = () => props.total > 0 ? Math.round((props.progress / props.total) * 100) : 0;

  const statusText = () => {
    switch (props.status) {
      case 'starting': return 'Starting download...';
      case 'processing': return `Preparing ${props.progress} of ${props.total} files...`;
      case 'ready': return 'Download ready!';
      case 'downloading': return 'Downloading...';
      case 'done': return 'Download complete!';
      default: return 'Processing...';
    }
  };

  const handleDownloadClick = () => {
    if (props.downloadUrl) {
      window.open(props.downloadUrl, '_blank');
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div class="glass-card rounded-2xl p-6 max-w-md w-full mx-4">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-white">Downloading</h3>
            <button
              onClick={props.onClose}
              class="text-gray-400 hover:text-white transition-colors"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="mb-4">
            <div class="flex justify-between text-sm text-gray-300 mb-2">
              <span>{statusText()}</span>
              <span>{percentage()}%</span>
            </div>
            <div class="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                class="bg-icy-aqua h-3 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${percentage()}%` }}
              />
            </div>
          </div>

          <Show when={props.status === 'processing'}>
            <p class="text-sm text-gray-400 text-center">
              Please wait while we prepare your download...
            </p>
          </Show>

          <Show when={props.downloadUrl && (props.status === 'ready' || props.status === 'done')}>
            <div class="space-y-2 mt-4">
              <button
                onClick={handleDownloadClick}
                class="w-full px-4 py-2 bg-icy-aqua hover:bg-icy-aqua/80 text-gray-900 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download ZIP
              </button>
              <button
                onClick={props.onClose}
                class="w-full px-4 py-2 bg-blue-slate hover:bg-blue-slate/80 text-white rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default DownloadProgress;
