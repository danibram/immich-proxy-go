import { useParams } from '@solidjs/router';
import { AlertCircle, Images } from 'lucide-solid';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import {
  captureEvent,
  getShareRouteTypeFromPath,
  isFeatureEnabled,
  registerPage,
  registerShareContext,
  unregisterPage,
  unregisterShareContext,
} from '~/analytics';
import { api, PasswordRequiredError } from '~/api/client';
import type { Asset } from '~/api/types';
import AssetTimeline from '~/components/AssetTimeline';
import AssetViewer from '~/components/AssetViewer';
import DownloadProgress from '~/components/DownloadProgress';
import PasswordPrompt from '~/components/PasswordPrompt';
import ShareTopBar from '~/components/ShareTopBar';
import UploadFab from '~/components/UploadFab';
import UploadModal from '~/components/UploadModal';
import { useMatchMedia } from '~/hooks/useMatchMedia';
import {
  assets,
  error,
  getSelectedAssets,
  isLoading,
  isSelectionMode,
  passwordRequired,
  selectedAsset,
  setError,
  setIsLoading,
  setLoadedSharedLink,
  setPasswordRequired,
  shareCapabilities,
  sharedLink,
} from '~/store/share';
import {
  downloadAssets,
  emptyDownloadState,
  type DownloadSource,
} from '~/utils/bulkDownload';
import { formatAlbumDateRange } from '~/utils/dateUtils';

export default function SharePage() {
  const params = useParams();
  const wide = useMatchMedia('(min-width: 820px)');
  const [downloadState, setDownloadState] = createSignal(emptyDownloadState());
  const [showUploadModal, setShowUploadModal] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal(false);
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>();

  let loadSeq = 0;

  onMount(() => {
    registerPage('share');
  });

  onCleanup(() => {
    unregisterShareContext();
    unregisterPage();
  });

  function handleScroll() {
    const el = scrollEl();
    if (!el) return;
    setCollapsed(el.scrollTop > 44);
  }

  async function loadSharedLink(requestKey?: string) {
    const key = requestKey ?? params.key;
    if (!key) return;

    const seq = ++loadSeq;
    const shareType = window.location.pathname.startsWith('/s/') ? 's' : 'share';
    api.setShareKey(key, shareType);
    setIsLoading(true);
    setError(null);
    setPasswordRequired(false);

    try {
      const link = await api.getSharedLink();
      if (seq !== loadSeq || params.key !== key) return;

      setLoadedSharedLink(link);
      const count = assets().length;
      const shareRouteType = getShareRouteTypeFromPath(window.location.pathname);

      registerShareContext({
        share_route_type: shareRouteType,
        link_type: link.type,
        asset_count: count,
        allow_upload: link.allowUpload,
        allow_download: link.allowDownload,
        show_metadata: link.showMetadata,
      });
      captureEvent('share_loaded', {
        share_route_type: shareRouteType,
        link_type: link.type,
        asset_count: count,
        allow_upload: link.allowUpload,
        allow_download: link.allowDownload,
        show_metadata: link.showMetadata,
      });
    } catch (err) {
      if (seq !== loadSeq || params.key !== key) return;

      if (err instanceof PasswordRequiredError) {
        setPasswordRequired(true);
        captureEvent('share_password_required', {
          share_route_type: getShareRouteTypeFromPath(window.location.pathname),
        });
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load shared link');
        captureEvent('share_load_failed', {
          share_route_type: getShareRouteTypeFromPath(window.location.pathname),
        });
      }
    } finally {
      if (seq === loadSeq) {
        setIsLoading(false);
      }
    }
  }

  createEffect(() => {
    const key = params.key;
    if (key) {
      void loadSharedLink(key);
    }
  });

  function runDownload(assetList: Asset[], source: DownloadSource) {
    void downloadAssets(assetList, source, setDownloadState);
  }

  const fabHidden = () =>
    wide() ||
    !isFeatureEnabled('upload-ui', true) ||
    !shareCapabilities().canUpload ||
    isSelectionMode() ||
    selectedAsset() !== null ||
    showUploadModal();

  return (
    <>
      <title>{sharedLink()?.album?.albumName || 'Shared Album'} - Immich Public Proxy</title>

      <Show when={isLoading()}>
        <div class="share-state">
          <div class="share-state-card">
            <div class="share-state-spinner">
              <div class="share-state-spinner-ring" />
            </div>
            <p>Loading album…</p>
          </div>
        </div>
      </Show>

      <Show when={!isLoading() && passwordRequired()}>
        <div class="share-state">
          <PasswordPrompt onSuccess={() => loadSharedLink()} />
        </div>
      </Show>

      <Show when={!isLoading() && !passwordRequired() && error()}>
        <div class="share-state">
          <div class="share-state-card">
            <div class="share-state-spinner share-state-spinner--error">
              <AlertCircle size={28} color="#c0392b" />
            </div>
            <h1>Unable to load</h1>
            <p>{error()}</p>
            <button type="button" class="landing-btn" onClick={() => loadSharedLink()}>
              Try again
            </button>
          </div>
        </div>
      </Show>

      <Show when={!isLoading() && !passwordRequired() && !error() && sharedLink()}>
        <div class="album" data-theme="light" data-wide={wide() ? '1' : '0'}>
          <div class="album-scroll scrollbar-hide" ref={setScrollEl} onScroll={handleScroll}>
            <ShareTopBar
              dateRange={formatAlbumDateRange(assets())}
              wide={wide()}
              collapsed={collapsed()}
              onUploadClick={() => setShowUploadModal(true)}
              onDownloadAll={() => runDownload(assets(), 'header')}
              onDownloadSelected={() => runDownload(getSelectedAssets(), 'selection')}
            />

            <div class="gallery" data-testid="share-gallery">
              <Show
                when={assets().length > 0}
                fallback={
                  <div class="gallery-foot gallery-empty">
                    <div class="gallery-empty-icon">
                      <Images size={40} color="var(--fg-3)" stroke-width={1.5} />
                    </div>
                    <h2 class="gallery-empty-title">No items yet</h2>
                    <p class="gallery-empty-text">This album is empty</p>
                  </div>
                }
              >
                <AssetTimeline scrollContainer={scrollEl} />
              </Show>
            </div>
          </div>

          <UploadFab hidden={fabHidden()} onClick={() => setShowUploadModal(true)} />
          <UploadModal isOpen={showUploadModal()} onClose={() => setShowUploadModal(false)} />

          <DownloadProgress
            isOpen={downloadState().isOpen}
            progress={downloadState().progress}
            total={downloadState().total}
            status={downloadState().status}
            onClose={() => setDownloadState(emptyDownloadState())}
          />

          <Show when={selectedAsset()}>
            <AssetViewer />
          </Show>
        </div>
      </Show>
    </>
  );
}
