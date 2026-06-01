import { Check, CheckSquare, Download, Folder, Upload, X } from 'lucide-solid';
import { Show, type JSX } from 'solid-js';
import { captureEvent, isFeatureEnabled } from '~/analytics';
import {
  albumName,
  assets,
  clearSelection,
  isSelectionMode,
  selectAll,
  selectedCount,
  setIsSelectionMode,
  shareCapabilities,
} from '~/store/share';

interface Props {
  dateRange: string | null;
  wide: boolean;
  collapsed: boolean;
  onUploadClick?: () => void;
  onDownloadAll: () => void;
  onDownloadSelected: () => void;
}

function itemCountLabel() {
  const count = assets().length;
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

function AlbumIdentity(props: { small?: boolean; dateRange?: string | null; withTestIds?: boolean }) {
  return (
    <div class={`tb-id ${props.small ? 'small' : ''}`}>
      <span class="tb-av">
        <Folder size={props.small ? 17 : 20} stroke-width={2} />
      </span>
      <div class="tb-idtext">
        <span class="tb-title" {...(props.withTestIds ? { 'data-testid': 'album-title' } : {})}>
          {albumName()}
        </span>
        <span class="tb-meta" {...(props.withTestIds ? { 'data-testid': 'album-meta' } : {})}>
          {itemCountLabel()}
          <Show when={assets().length > 0 && props.dateRange}>
            <span class="tb-dot" />
            <span>{props.dateRange}</span>
          </Show>
        </span>
      </div>
    </div>
  );
}

function MobileHero(props: Pick<Props, 'dateRange' | 'onUploadClick' | 'onDownloadAll'>) {
  const caps = shareCapabilities;
  const showUpload = () => caps().canUpload && isFeatureEnabled('upload-ui', true);

  return (
    <header class="hero">
      <h1 class="hero-title" data-testid="album-title">
        {albumName()}
      </h1>
      <div class="hero-meta" data-testid="album-meta">
        <span>{itemCountLabel()}</span>
        <Show when={props.dateRange}>
          <span class="dot" />
          <span>{props.dateRange}</span>
        </Show>
      </div>
      <div class="hero-actions">
        <Show when={caps().canDownload}>
          <button type="button" class="st-btn-dl" onClick={props.onDownloadAll}>
            <Download size={18} stroke-width={2} />
            Download all
          </button>
        </Show>
        <Show when={showUpload()}>
          <button type="button" class="st-btn-up" onClick={() => props.onUploadClick?.()}>
            <Upload size={18} stroke-width={2} />
            Upload items
          </button>
        </Show>
      </div>
    </header>
  );
}

function IconBtn(props: { label: string; onClick: () => void; children: JSX.Element }) {
  return (
    <button type="button" class="icon-btn" aria-label={props.label} title={props.label} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function TextBtn(props: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  children: JSX.Element;
}) {
  return (
    <button type="button" class={`tb-tbtn ${props.primary ? 'primary' : ''}`} onClick={props.onClick}>
      {props.children} {props.label}
    </button>
  );
}

function BrowseActions(props: Pick<Props, 'wide' | 'onUploadClick' | 'onDownloadAll'>) {
  const caps = shareCapabilities;
  const showUpload = () => caps().canUpload && isFeatureEnabled('upload-ui', true);
  const showSelect = () => caps().canSelect;

  const enterSelect = () => {
    captureEvent('selection_mode_enabled', { source: 'header' });
    setIsSelectionMode(true);
  };

  return (
    <Show
      when={props.wide}
      fallback={
        <Show when={showSelect()}>
          <IconBtn label="Select" onClick={enterSelect}>
            <CheckSquare size={22} stroke-width={2} />
          </IconBtn>
        </Show>
      }
    >
      <Show when={showSelect()}>
        <TextBtn label="Select" onClick={enterSelect}>
          <CheckSquare size={18} stroke-width={2} />
        </TextBtn>
      </Show>
      <Show when={caps().canDownload}>
        <TextBtn label="Download" onClick={props.onDownloadAll}>
          <Download size={18} stroke-width={2} />
        </TextBtn>
      </Show>
      <Show when={showUpload()}>
        <TextBtn label="Upload" onClick={() => props.onUploadClick?.()} primary>
          <Upload size={18} stroke-width={2} />
        </TextBtn>
      </Show>
    </Show>
  );
}

function SelectActions(props: Pick<Props, 'wide' | 'onDownloadSelected'>) {
  const allSelected = () => selectedCount() === assets().length && assets().length > 0;
  const selectAllLabel = () => (allSelected() ? 'Deselect all' : 'Select all');
  const toggleAll = () => (allSelected() ? clearSelection() : selectAll());

  return (
    <Show
      when={props.wide}
      fallback={
        <>
          <Show when={selectedCount() > 0}>
            <IconBtn label={`Download (${selectedCount()})`} onClick={props.onDownloadSelected}>
              <Download size={22} stroke-width={2} />
            </IconBtn>
          </Show>
          <IconBtn label={selectAllLabel()} onClick={toggleAll}>
            <Check size={22} stroke-width={2} class={allSelected() ? 'is-on' : ''} />
          </IconBtn>
        </>
      }
    >
      <Show when={selectedCount() > 0}>
        <button type="button" class="tb-tbtn" onClick={props.onDownloadSelected}>
          <Download size={18} stroke-width={2} /> Download ({selectedCount()})
        </button>
      </Show>
      <button type="button" class="tb-tbtn" onClick={toggleAll}>
        <Check size={18} stroke-width={2} /> {selectAllLabel()}
      </button>
    </Show>
  );
}

export default function ShareTopBar(props: Props) {
  const exitSelect = () => {
    clearSelection();
    setIsSelectionMode(false);
  };

  const identityTestIds = () => props.wide;

  return (
    <Show
      when={isSelectionMode()}
      fallback={
        <>
          <header
            class="topbar"
            data-wide={props.wide ? '1' : '0'}
            data-collapsed={props.collapsed ? '1' : '0'}
          >
            <div class="tb-left">
              <Show
                when={props.wide}
                fallback={<AlbumIdentity small dateRange={props.dateRange} withTestIds={false} />}
              >
                <AlbumIdentity dateRange={props.dateRange} withTestIds={identityTestIds()} />
              </Show>
            </div>
            <div class="tb-actions">
              <BrowseActions
                wide={props.wide}
                onUploadClick={props.onUploadClick}
                onDownloadAll={props.onDownloadAll}
              />
            </div>
          </header>
          <Show when={!props.wide}>
            <MobileHero
              dateRange={props.dateRange}
              onUploadClick={props.onUploadClick}
              onDownloadAll={props.onDownloadAll}
            />
          </Show>
        </>
      }
    >
      <header class="topbar is-select" data-wide={props.wide ? '1' : '0'} data-collapsed="1">
        <div class="tb-left">
          <IconBtn label="Cancel" onClick={exitSelect}>
            <X size={22} stroke-width={2} />
          </IconBtn>
          <span class="tb-count">{selectedCount()} selected</span>
        </div>
        <div class="tb-actions">
          <SelectActions wide={props.wide} onDownloadSelected={props.onDownloadSelected} />
        </div>
      </header>
    </Show>
  );
}
