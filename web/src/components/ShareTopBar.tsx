import { Check, Download, Ellipsis, Plus, X } from 'lucide-solid';
import { onCleanup, onMount, Show, type JSX } from 'solid-js';
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
  onDownloadAll: () => void;
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

function SelectButton(props: { class?: string }) {
  return (
    <button type="button" class={props.class ?? 'tb-select'} onClick={enterSelectionMode}>
      {t().topbar.select}
    </button>
  );
}

function MoreActions(props: { onDownloadAll: () => void }) {
  let root: HTMLDetailsElement | undefined;
  let trigger: HTMLElement | undefined;

  onMount(() => {
    const closeFromOutside = (event: PointerEvent) => {
      if (root?.open && !root.contains(event.target as Node)) root.open = false;
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (!root?.open || event.key !== 'Escape') return;
      root.open = false;
      trigger?.focus();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    onCleanup(() => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    });
  });

  const downloadAll = () => {
    if (root) root.open = false;
    props.onDownloadAll();
  };

  return (
    <Show when={shareCapabilities().canDownload}>
      <details class="action-menu" ref={root}>
        <summary
          ref={trigger}
          class="action-menu-trigger"
          aria-label={t().topbar.moreActions}
          aria-haspopup="menu"
        >
          <Ellipsis size={22} stroke-width={2} />
        </summary>
        <div class="action-menu-popover" role="menu">
          <button type="button" role="menuitem" onClick={downloadAll}>
            <Download size={18} stroke-width={2} />
            {t().topbar.downloadAll}
          </button>
        </div>
      </details>
    </Show>
  );
}

function AddPhotosButton(props: { hero?: boolean; onClick?: () => void }) {
  const visible = () =>
    shareCapabilities().canUpload && isFeatureEnabled('upload-ui', true);

  return (
    <Show when={visible()}>
      <button
        type="button"
        class={props.hero ? 'hero-add' : 'tb-tbtn primary'}
        onClick={() => props.onClick?.()}
      >
        <Plus size={18} stroke-width={2.2} />
        {t().topbar.addPhotos}
      </button>
    </Show>
  );
}

function MobileHero(props: Pick<Props, 'dateRange' | 'onUploadClick' | 'onDownloadAll'>) {
  const hasActions = () =>
    shareCapabilities().canDownload ||
    (shareCapabilities().canUpload && isFeatureEnabled('upload-ui', true));

  return (
    <header class="hero">
      <div class="hero-heading">
        <h1 class="hero-title" data-testid="album-title">
          {albumName()}
        </h1>
        <Show when={shareCapabilities().canSelect}>
          <SelectButton class="hero-select" />
        </Show>
      </div>
      <div class="hero-meta" data-testid="album-meta">
        <span>{itemCountLabel()}</span>
        <Show when={props.dateRange}>
          <span class="dot" />
          <span>{props.dateRange}</span>
        </Show>
      </div>
      <Show when={hasActions()}>
        <div class="hero-actions">
          <AddPhotosButton hero onClick={props.onUploadClick} />
          <MoreActions onDownloadAll={props.onDownloadAll} />
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

function BrowseActions(props: Pick<Props, 'wide' | 'collapsed' | 'onUploadClick' | 'onDownloadAll'>) {
  return (
    <Show
      when={props.wide}
      fallback={
        <Show when={props.collapsed}>
          <Show when={shareCapabilities().canSelect}>
            <SelectButton />
          </Show>
          <MoreActions onDownloadAll={props.onDownloadAll} />
        </Show>
      }
    >
      <Show when={shareCapabilities().canSelect}>
        <SelectButton />
      </Show>
      <AddPhotosButton onClick={props.onUploadClick} />
      <MoreActions onDownloadAll={props.onDownloadAll} />
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
