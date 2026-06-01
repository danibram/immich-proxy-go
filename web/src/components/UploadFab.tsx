import { Upload } from 'lucide-solid';
import { Show } from 'solid-js';

interface Props {
  hidden: boolean;
  onClick: () => void;
}

export default function UploadFab(props: Props) {
  return (
    <button
      type="button"
      class={`fab ${props.hidden ? 'is-hidden' : ''}`}
      aria-label="Upload items"
      onClick={props.onClick}
    >
      <Show when={!props.hidden}>
        <Upload size={24} stroke-width={2} />
      </Show>
    </button>
  );
}
