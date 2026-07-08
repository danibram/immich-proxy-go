import { createEffect, createSignal, onCleanup, Show, untrack } from 'solid-js';
import type { Accessor } from 'solid-js';
import { api } from '~/api/client';
import type { Asset } from '~/api/types';
import { thumbnailLoader, type ThumbnailTask } from './thumbnailLoader';

interface Props {
  asset: Asset;
  scrollContainer?: Accessor<HTMLDivElement | undefined>;
}

export default function LazyThumbnail(props: Props) {
  const [status, setStatus] = createSignal<'idle' | 'queued' | 'loading' | 'loaded' | 'error'>('idle');
  const [src, setSrc] = createSignal('');
  let itemRef: HTMLDivElement | undefined;
  let imgRef: HTMLImageElement | undefined;
  let frameId: number | null = null;
  let currentTask: ThumbnailTask | null = null;
  let currentRequestId = 0;
  let currentRoot: HTMLDivElement | undefined;
  let requestedSize: 'preview' | 'thumbnail' = 'preview';

  createEffect(() => {
    props.asset.id;
    requestedSize = 'preview';
    abortToIdle();
  });

  onCleanup(() => {
    currentRequestId += 1;
    cancelLoad();
  });

  function cancelLoad() {
    currentTask?.cancel();
    currentTask = null;
  }

  // The single reset path: invalidates the in-flight request (the requestId
  // bump makes its promise rejection a no-op), cancels the queued/started
  // loader job and returns the slot to 'idle'.
  function abortToIdle(abortImg = false) {
    currentRequestId += 1;
    // Clearing the element's src makes the browser abort an in-flight
    // fetch; merely unmounting the <img> would let it keep downloading.
    // Abort before cancelLoad() so the freed slot's next load never
    // overlaps with the stale request.
    if (abortImg && imgRef) imgRef.src = '';
    cancelLoad();
    setSrc('');
    setStatus('idle');
  }

  function isWithinViewportMargin(root: HTMLDivElement | undefined, multiplier: number): boolean {
    if (!itemRef) return false;

    const itemRect = itemRef.getBoundingClientRect();
    const baseRootRect = root?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };
    const height = Math.max(baseRootRect.bottom - baseRootRect.top, window.innerHeight, 1);
    const margin = height * multiplier;
    const rootRect = {
      top: baseRootRect.top - margin,
      bottom: baseRootRect.bottom + margin,
    };

    return itemRect.bottom >= rootRect.top && itemRect.top <= rootRect.bottom;
  }

  function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  function getViewportPriority(root: HTMLDivElement | undefined): number {
    if (!itemRef) return Number.MAX_SAFE_INTEGER;

    const itemRect = itemRef.getBoundingClientRect();
    const rootRect = root?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };

    const itemCenter = itemRect.top + (itemRect.bottom - itemRect.top) / 2;
    const rootCenter = rootRect.top + (rootRect.bottom - rootRect.top) / 2;
    return Math.round(Math.abs(itemCenter - rootCenter));
  }

  function requestLoad(root: HTMLDivElement | undefined, size: 'preview' | 'thumbnail' = requestedSize) {
    if (currentTask || status() === 'loaded') return;

    requestedSize = size;
    const requestId = ++currentRequestId;
    const priority = getViewportPriority(root);

    setStatus('queued');
    currentTask = thumbnailLoader.enqueue(priority, () => {
      if (requestId !== currentRequestId) return;
      setSrc(api.getThumbnailUrl(props.asset.id, size));
      setStatus('loading');
    });

    currentTask.promise
      .catch((error) => {
        if (requestId !== currentRequestId) return;

        currentTask = null;
        if (isAbortError(error)) {
          setSrc('');
          setStatus('idle');
          return;
        }
      });
  }

  function releaseCurrentTask() {
    currentTask?.release();
    currentTask = null;
  }

  function handleImgLoad() {
    // Ignore events from an <img> whose load was cancelled from
    // evaluatePosition; acting on them would strand the slot in 'loaded'
    // with an empty src. currentTask is non-null exactly while a request
    // is queued/loading and nulled on every cancel path.
    if (!currentTask) return;
    releaseCurrentTask();
    setStatus('loaded');
  }

  function handleImgError() {
    if (!currentTask) return;
    releaseCurrentTask();
    setSrc('');

    if (requestedSize === 'preview') {
      setStatus('idle');
      requestLoad(currentRoot, 'thumbnail');
      return;
    }

    setStatus('error');
  }

  function evaluatePosition(root: HTMLDivElement | undefined) {
    const currentStatus = untrack(status);
    const inPreloadZone = isWithinViewportMargin(root, 1);
    const inCancelZone = isWithinViewportMargin(root, 2.5);

    if ((currentStatus === 'queued' || currentStatus === 'loading') && !inCancelZone) {
      abortToIdle(true);
      return;
    }

    if (currentStatus === 'queued') {
      currentTask?.bump(getViewportPriority(root));
      return;
    }

    if ((currentStatus === 'idle' || currentStatus === 'error') && inPreloadZone) {
      requestLoad(root, 'preview');
    }
  }

  function scheduleNearCheck(root: HTMLDivElement | undefined) {
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      evaluatePosition(root);
    });
  }

  createEffect(() => {
    const root = props.scrollContainer?.();
    currentRoot = root;
    if (!itemRef) return;

    if (typeof IntersectionObserver === 'undefined') {
      requestLoad(root, 'preview');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          evaluatePosition(root);
        }
      },
      {
        root: root ?? null,
        rootMargin: '100% 0px',
        threshold: 0.01,
      }
    );

    observer.observe(itemRef);
    scheduleNearCheck(root);

    const onScroll = () => scheduleNearCheck(root);
    const onResize = () => scheduleNearCheck(root);

    root?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    untrack(() => evaluatePosition(root));

    onCleanup(() => {
      observer.disconnect();
      root?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    });
  });

  return (
    <div ref={itemRef} class="thumb-img-slot" data-testid="gallery-thumb-slot">
      <Show when={(status() === 'loading' || status() === 'loaded') && src()}>
        <img
          ref={imgRef}
          data-testid="gallery-thumb"
          src={src()}
          alt=""
          decoding="async"
          onLoad={handleImgLoad}
          onError={handleImgError}
        />
      </Show>
    </div>
  );
}
