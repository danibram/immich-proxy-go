import { useParams } from '@solidjs/router';
import { AlertCircle, Images } from 'lucide-solid';
import { createEffect, createSignal, onMount, Show } from 'solid-js';
import { api, PasswordRequiredError } from '~/api/client';
import AssetTimeline from '~/components/AssetTimeline';
import AssetViewer from '~/components/AssetViewer';
import Header from '~/components/Header';
import PasswordPrompt from '~/components/PasswordPrompt';
import SelectionBar from '~/components/SelectionBar';
import UploadModal from '~/components/UploadModal';
import {
  assets,
  error,
  isLoading,
  isSelectionMode,
  passwordRequired,
  selectedAsset,
  setError,
  setIsLoading,
  setPasswordRequired,
  setSharedLink,
  sharedLink,
} from '~/store/share';

export default function SharePage() {
  const params = useParams();
  const [showUploadModal, setShowUploadModal] = createSignal(false);

  async function loadSharedLink() {
    const key = params.key;
    if (!key) return;

    // Detect share type from URL path (/s/ = slug, /share/ = key)
    const shareType = window.location.pathname.startsWith('/s/') ? 's' : 'share';
    api.setShareKey(key, shareType);
    setIsLoading(true);
    setError(null);
    setPasswordRequired(false);

    try {
      // Backend now returns full album details in a single request
      const link = await api.getSharedLink();
      setSharedLink(link);
    } catch (err) {
      if (err instanceof PasswordRequiredError) {
        setPasswordRequired(true);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load shared link');
      }
    } finally {
      setIsLoading(false);
    }
  }

  onMount(() => {
    loadSharedLink();
  });

  createEffect(() => {
    const key = params.key;
    if (key) {
      loadSharedLink();
    }
  });

  return (
    <>
      <title>{sharedLink()?.album?.albumName || 'Shared Album'} - Immich</title>

      {/* Loading */}
      <Show when={isLoading()}>
        <div class="h-screen flex items-center justify-center">
          <div class="text-center">
            <div class="w-12 h-12 mx-auto mb-4 rounded-xl bg-icy-aqua/20 flex items-center justify-center">
              <div class="w-6 h-6 border-2 border-icy-aqua/30 border-t-icy-aqua rounded-full animate-spin" />
            </div>
            <p class="text-white/50 text-sm">Loading...</p>
          </div>
        </div>
      </Show>

      {/* Password */}
      <Show when={!isLoading() && passwordRequired()}>
        <PasswordPrompt onSuccess={loadSharedLink} />
      </Show>

      {/* Error */}
      <Show when={!isLoading() && !passwordRequired() && error()}>
        <div class="h-screen flex items-center justify-center p-4">
          <div class="text-center max-w-md">
            <div class="w-16 h-16 mx-auto mb-4 rounded-xl bg-red-500/10 flex items-center justify-center">
              <AlertCircle class="w-8 h-8 text-red-400" />
            </div>
            <h1 class="text-xl font-semibold text-white mb-2">Unable to load</h1>
            <p class="text-white/50 text-sm mb-4">{error()}</p>
            <button
              class="px-4 py-2 rounded-lg bg-blue-slate hover:bg-blue-slate/80 text-white text-sm font-medium"
              onClick={loadSharedLink}
            >
              Try again
            </button>
          </div>
        </div>
      </Show>

      {/* Main */}
      <Show when={!isLoading() && !passwordRequired() && !error() && sharedLink()}>
        <div class="h-[100dvh] flex flex-col overflow-hidden bg-[#0a0a0a]">
          {/* Selection bar (shown when in selection mode) */}
          <SelectionBar />

          {/* Regular header (hidden when in selection mode) */}
          <Header onUploadClick={() => setShowUploadModal(true)} />

          <main class={`flex-1 overflow-hidden ${isSelectionMode() ? 'pt-16' : ''}`}>
            <div class="h-full px-2 py-2 sm:px-4 sm:py-4 lg:px-6">
              <Show
                when={assets().length > 0}
                fallback={
                  <div class="h-full flex items-center justify-center">
                    <div class="text-center">
                      <div class="w-20 h-20 mx-auto mb-4 rounded-2xl bg-white/5 flex items-center justify-center">
                        <Images class="w-10 h-10 text-white/20" />
                      </div>
                      <h2 class="text-lg font-semibold text-white/80 mb-1">No photos yet</h2>
                      <p class="text-white/40 text-sm">This album is empty</p>
                    </div>
                  </div>
                }
              >
                <AssetTimeline />
              </Show>
            </div>
          </main>
        </div>

        {/* Upload Modal */}
        <UploadModal isOpen={showUploadModal()} onClose={() => setShowUploadModal(false)} />

        {/* Asset Viewer */}
        <Show when={selectedAsset()}>
          <AssetViewer />
        </Show>
      </Show>
    </>
  );
}
