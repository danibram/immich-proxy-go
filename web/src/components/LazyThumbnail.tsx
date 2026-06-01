import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import { api } from '~/api/client';
import type { Asset } from '~/api/types';

interface Props {
  asset: Asset;
  scrollContainer?: Accessor<HTMLDivElement | undefined>;
}

export default function LazyThumbnail(props: Props) {
  const [shouldLoad, setShouldLoad] = createSignal(false);
  const [src, setSrc] = createSignal('');
  let itemRef: HTMLDivElement | undefined;
  let frameId: number | null = null;

  createEffect(() => {
    props.asset.id;
    setSrc(api.getThumbnailUrl(props.asset.id, 'preview'));
  });

  function onImgError() {
    const fallback = api.getThumbnailUrl(props.asset.id, 'thumbnail');
    if (src() !== fallback) {
      setSrc(fallback);
    }
  }

  function isNearViewport(root: HTMLDivElement | undefined): boolean {
    if (!itemRef) return false;

    const margin = 1200;
    const itemRect = itemRef.getBoundingClientRect();
    const rootRect = root?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };

    return itemRect.bottom >= rootRect.top - margin && itemRect.top <= rootRect.bottom + margin;
  }

  function loadIfNear(root: HTMLDivElement | undefined) {
    if (!shouldLoad() && isNearViewport(root)) {
      setShouldLoad(true);
    }
  }

  function scheduleNearCheck(root: HTMLDivElement | undefined) {
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      loadIfNear(root);
    });
  }

  createEffect(() => {
    if (shouldLoad()) return;

    const root = props.scrollContainer?.();
    if (!itemRef || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      {
        root: root ?? null,
        rootMargin: '1200px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(itemRef);
    scheduleNearCheck(root);

    const onScroll = () => scheduleNearCheck(root);
    const onResize = () => scheduleNearCheck(root);

    root?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

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
      <Show when={shouldLoad()}>
        <img
          data-testid="gallery-thumb"
          src={src()}
          alt=""
          loading="lazy"
          decoding="async"
          onError={onImgError}
        />
      </Show>
    </div>
  );
}
