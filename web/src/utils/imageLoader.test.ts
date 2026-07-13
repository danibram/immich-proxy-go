import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRetryingImage, IMAGE_RETRY_DELAY_MS, type RetryingImage } from './imageLoader';

type Size = 'fullsize' | 'preview' | 'thumbnail';

const urlFor = (size: Size, retry: boolean) => `/thumb?size=${size}${retry ? '&retry=1' : ''}`;

describe('createRetryingImage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function withLoader(
    sizes: () => readonly Size[],
    run: (loader: RetryingImage) => void
  ) {
    createRoot((dispose) => {
      const loader = createRetryingImage({ sizes, urlFor });
      try {
        run(loader);
      } finally {
        dispose();
      }
    });
  }

  it('starts with the first size and a clean URL (no retry marker)', () => {
    withLoader(
      () => ['thumbnail'],
      (loader) => {
        expect(loader.src()).toBe('/thumb?size=thumbnail');
        expect(loader.failed()).toBe(false);
        expect(loader.loaded()).toBe(false);
      }
    );
  });

  it('retries the same size once after a backoff, with the retry marker', () => {
    withLoader(
      () => ['thumbnail'],
      (loader) => {
        loader.onError();
        // During the backoff the src is unchanged — no request churn.
        expect(loader.src()).toBe('/thumb?size=thumbnail');
        expect(loader.failed()).toBe(false);

        vi.advanceTimersByTime(IMAGE_RETRY_DELAY_MS);
        expect(loader.src()).toBe('/thumb?size=thumbnail&retry=1');
      }
    );
  });

  it('fails permanently after the retry of the last size', () => {
    withLoader(
      () => ['thumbnail'],
      (loader) => {
        loader.onError();
        vi.advanceTimersByTime(IMAGE_RETRY_DELAY_MS);
        loader.onError();
        expect(loader.failed()).toBe(true);
        expect(loader.src()).toBeUndefined();
      }
    );
  });

  it('downgrades through the size ladder before failing', () => {
    withLoader(
      () => ['preview', 'thumbnail'],
      (loader) => {
        expect(loader.src()).toBe('/thumb?size=preview');

        loader.onError();
        vi.advanceTimersByTime(IMAGE_RETRY_DELAY_MS);
        expect(loader.src()).toBe('/thumb?size=preview&retry=1');

        // Second failure of the same size: downgrade immediately.
        loader.onError();
        expect(loader.src()).toBe('/thumb?size=thumbnail');

        loader.onError();
        vi.advanceTimersByTime(IMAGE_RETRY_DELAY_MS);
        expect(loader.src()).toBe('/thumb?size=thumbnail&retry=1');

        loader.onError();
        expect(loader.failed()).toBe(true);
      }
    );
  });

  it('ignores error events while the backoff timer is pending', () => {
    withLoader(
      () => ['preview', 'thumbnail'],
      (loader) => {
        loader.onError();
        loader.onError();
        loader.onError();
        vi.advanceTimersByTime(IMAGE_RETRY_DELAY_MS);
        // Still on the retry of the FIRST size — the extra events did not
        // fast-forward the ladder.
        expect(loader.src()).toBe('/thumb?size=preview&retry=1');
      }
    );
  });

  it('tracks load state', () => {
    withLoader(
      () => ['thumbnail'],
      (loader) => {
        expect(loader.loaded()).toBe(false);
        loader.onLoad();
        expect(loader.loaded()).toBe(true);
      }
    );
  });

  it('resets the machine when the key (asset) changes on a reused slide', () => {
    createRoot((dispose) => {
      const [assetId, setAssetId] = createSignal('asset-a');
      const loader = createRetryingImage({
        sizes: () => ['preview', 'thumbnail'] as const,
        urlFor,
        key: assetId,
      });

      loader.onLoad();
      expect(loader.loaded()).toBe(true);

      // Carousel navigates: same component instance, new asset. Fresh state.
      setAssetId('asset-b');
      expect(loader.loaded()).toBe(false);
      expect(loader.failed()).toBe(false);
      expect(loader.src()).toBe('/thumb?size=preview');

      dispose();
    });
  });

  it('resets the machine when the size ladder changes (viewer zoom)', () => {
    createRoot((dispose) => {
      const [sizes, setSizes] = createSignal<readonly Size[]>(['preview', 'thumbnail']);
      const loader = createRetryingImage({ sizes, urlFor });

      // Exhaust the ladder completely.
      loader.onError();
      vi.advanceTimersByTime(IMAGE_RETRY_DELAY_MS);
      loader.onError();
      loader.onError();
      vi.advanceTimersByTime(IMAGE_RETRY_DELAY_MS);
      loader.onError();
      expect(loader.failed()).toBe(true);

      // Zooming switches the ladder: fresh machine, first size, clean URL.
      setSizes(['fullsize', 'preview', 'thumbnail']);
      expect(loader.failed()).toBe(false);
      expect(loader.loaded()).toBe(false);
      expect(loader.src()).toBe('/thumb?size=fullsize');

      dispose();
    });
  });
});
