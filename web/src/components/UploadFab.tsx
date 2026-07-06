import { Upload } from 'lucide-solid';
import { Show } from 'solid-js';
import { t } from '~/i18n';

interface Props {
  hidden: boolean;
  onClick: () => void;
}

export default function UploadFab(props: Props) {
  return (
    <button
      type="button"
      class={`fab ${props.hidden ? 'is-hidden' : ''}`}
      aria-label={t().topbar.uploadItems}
      onClick={props.onClick}
    >
      <Show when={!props.hidden}>
        <Upload size={24} stroke-width={2} />
      </Show>
    </button>
  );
}
