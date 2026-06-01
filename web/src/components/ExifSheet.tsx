import {
  Aperture,
  Calendar,
  Camera,
  Clock,
  FileText,
  Info,
  MapPin,
  X,
} from 'lucide-solid';
import { For, Show } from 'solid-js';
import type { Asset } from '~/api/types';
import type { ExifRow } from '~/utils/viewerFormat';
import { buildExifRows, formatViewerFootDate } from '~/utils/viewerFormat';

interface Props {
  asset: Asset;
  open: boolean;
  onClose: () => void;
}

function ExifIcon(props: { rowId: string }) {
  const size = 17;
  const stroke = 1.8;
  switch (props.rowId) {
    case 'camera':
      return <Camera size={size} stroke-width={stroke} />;
    case 'lens':
      return <Aperture size={size} stroke-width={stroke} />;
    case 'settings':
      return <Info size={size} stroke-width={stroke} />;
    case 'file':
      return <FileText size={size} stroke-width={stroke} />;
    case 'size':
      return <Calendar size={size} stroke-width={stroke} />;
    case 'time':
      return <Clock size={size} stroke-width={stroke} />;
    case 'place':
      return <MapPin size={size} stroke-width={stroke} />;
    default:
      return <Info size={size} stroke-width={stroke} />;
  }
}

function ExifRowView(props: { row: ExifRow }) {
  return (
    <div class="exif-row">
      <span class="exif-ico">
        <ExifIcon rowId={props.row.id} />
      </span>
      <span class="exif-label">{props.row.label}</span>
      <span class="exif-val">{props.row.value}</span>
    </div>
  );
}

export default function ExifSheet(props: Props) {
  const rows = () => buildExifRows(props.asset);
  const headLabel = () => {
    const kind = props.asset.type === 'VIDEO' ? 'Video' : 'Photo';
    const date = formatViewerFootDate(props.asset);
    return date ? `${kind} · ${date}` : `${kind} · ${props.asset.originalFileName}`;
  };

  return (
    <>
      <Show when={props.open}>
        <div
          class="exif-scrim"
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
        />
      </Show>
      <div
        class={`exif-sheet ${props.open ? 'is-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="exif-grip" />
        <div class="exif-head">
          <span>{headLabel()}</span>
          <button type="button" class="exif-x" aria-label="Close info" onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>
        <div class="exif-list">
          <For each={rows()}>{(row) => <ExifRowView row={row} />}</For>
        </div>
      </div>
    </>
  );
}
