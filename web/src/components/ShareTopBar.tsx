import { Check, Download, Plus, SquareCheckBig, X } from 'lucide-solid';
import { Show, type JSX } from 'solid-js';
import { captureEvent, isFeatureEnabled } from '~/analytics';
import { t } from '~/i18n';
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
  onDownloadSelected: () => void;
}

function itemCountLabel() {
  return t().topbar.itemCount(assets().length);
}

function enterSelectionMode() {
  captureEvent('selection_mode_enabled', { source: 'header' });
  setIsSelectionMode(true);
}

function AlbumIdentity(props: { small?: boolean; dateRange?: string | null; withTestIds?: boolean }) {
  return (
    <div class={`tb-id ${props.small ? 'small' : ''}`}>
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

function SelectButton() {
  return (
    <IconBtn label={t().topbar.select} onClick={enterSelectionMode}>
      <SquareCheckBig size={20} stroke-width={2} />
    </IconBtn>
  );
}

function canAddPhotos() {
  return shareCapabilities().canUpload && isFeatureEnabled('upload-ui', true);
}

function AddPhotosButton(props: { compact?: boolean; onClick?: () => void }) {
  return (
    <Show when={canAddPhotos()}>
      <button
        type="button"
        class={`tb-tbtn primary ${props.compact ? 'is-compact' : ''}`}
        aria-label={t().topbar.addPhotos}
        title={t().topbar.addPhotos}
        onClick={() => props.onClick?.()}
      >
        <Plus size={18} stroke-width={2.2} />
        <Show when={!props.compact}>{t().topbar.addPhotos}</Show>
      </button>
    </Show>
  );
}

function MobileHero(
  props: Pick<Props, 'dateRange' | 'collapsed' | 'onUploadClick'>
) {
  return (
    <header class="hero">
      <div class="hero-text">
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
      </div>
      <Show when={!props.collapsed}>
        <div class="hero-actions">
          <Show when={shareCapabilities().canSelect}>
            <SelectButton />
          </Show>
          <AddPhotosButton compact onClick={props.onUploadClick} />
        </div>
      </Show>
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

function BrowseActions(props: Pick<Props, 'wide' | 'collapsed' | 'onUploadClick'>) {
  return (
    <Show
      when={props.wide}
      fallback={
        <Show when={props.collapsed}>
          <Show when={shareCapabilities().canSelect}>
            <SelectButton />
          </Show>
        </Show>
      }
    >
      <Show when={shareCapabilities().canSelect}>
        <SelectButton />
      </Show>
      <AddPhotosButton onClick={props.onUploadClick} />
    </Show>
  );
}

function SelectActions(props: Pick<Props, 'wide' | 'onDownloadSelected'>) {
  const allSelected = () => selectedCount() === assets().length && assets().length > 0;
  const selectAllLabel = () => (allSelected() ? t().topbar.deselectAll : t().topbar.selectAll);
  const toggleAll = () => (allSelected() ? clearSelection() : selectAll());

  return (
    <Show
      when={props.wide}
      fallback={
        <>
          <Show when={selectedCount() > 0}>
            <IconBtn label={t().topbar.downloadSelected(selectedCount())} onClick={props.onDownloadSelected}>
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
          <Download size={18} stroke-width={2} /> {t().topbar.downloadSelected(selectedCount())}
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
                fallback={
                  <Show when={props.collapsed}>
                    <AlbumIdentity small dateRange={props.dateRange} withTestIds={false} />
                  </Show>
                }
              >
                <AlbumIdentity dateRange={props.dateRange} withTestIds />
              </Show>
            </div>
            <div class="tb-actions">
              <BrowseActions
                wide={props.wide}
                collapsed={props.collapsed}
                onUploadClick={props.onUploadClick}
              />
            </div>
          </header>
          <Show when={!props.wide}>
            <MobileHero
              dateRange={props.dateRange}
              collapsed={props.collapsed}
              onUploadClick={props.onUploadClick}
            />
          </Show>
        </>
      }
    >
      <header class="topbar is-select" data-wide={props.wide ? '1' : '0'} data-collapsed="1">
        <div class="tb-left">
          <IconBtn label={t().topbar.cancel} onClick={exitSelect}>
            <X size={22} stroke-width={2} />
          </IconBtn>
          <span class="tb-count">{t().topbar.selected(selectedCount())}</span>
        </div>
        <div class="tb-actions">
          <SelectActions wide={props.wide} onDownloadSelected={props.onDownloadSelected} />
        </div>
      </header>
    </Show>
  );
}
