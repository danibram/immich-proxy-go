import { Archive, Check } from 'lucide-solid';
import { Component, Show } from 'solid-js';
import { t } from '~/i18n';
import type { DownloadStatus } from '~/utils/bulkDownload';

interface DownloadProgressProps {
  isOpen: boolean;
  progress: number;
  total: number;
  status: DownloadStatus;
  onClose: () => void;
}

const DownloadProgress: Component<DownloadProgressProps> = (props) => {
  const percentage = () => (props.total > 0 ? Math.round((props.progress / props.total) * 100) : 0);
  const isReady = () => props.status === 'ready';

  const subtitle = () => {
    if (isReady()) {
      return t().downloadProgress.itemsZip(props.total);
    }
    if (props.status === 'processing') {
      return t().downloadProgress.preparing(props.progress, props.total);
    }
    return t().downloadProgress.starting;
  };

  return (
    <Show when={props.isOpen}>
      <div class="dl-scrim">
        <div class="dl-modal">
          <div class={`dl-ico ${isReady() ? 'is-ready' : ''}`}>
            {isReady() ? (
              <Check size={30} stroke-width={2.2} />
            ) : (
              <Archive size={30} stroke-width={2.2} />
            )}
          </div>
          <div class="dl-title">{isReady() ? t().downloadProgress.ready : t().downloadProgress.compressing}</div>
          <div class="dl-sub">{subtitle()}</div>
          <div class="dl-bar">
            <div class="dl-fill" style={{ width: `${isReady() ? 100 : percentage()}%` }} />
          </div>
          <Show when={isReady()}>
            <button type="button" class="dl-done" onClick={props.onClose}>
              {t().downloadProgress.done}
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default DownloadProgress;
