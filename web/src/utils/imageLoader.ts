import { createComputed, createSignal, on, onCleanup, untrack } from 'solid-js';

/**
 * Backoff before retrying the same image URL once. Short on purpose: it only
 * needs to ride out a dropped connection or a momentary upstream blip, not a
 * real outage (the size downgrade and placeholder handle those).
 */
export const IMAGE_RETRY_DELAY_MS = 600;

interface Attempt {
  /** Index into the size ladder. */
  index: number;
  /** Whether this attempt is the one retry of the current size. */
  retry: boolean;
}

export interface RetryingImage {
  /** Current URL to load, or undefined once every attempt failed. */
  src: () => string | undefined;
  /** True when the ladder is exhausted: show the persistent placeholder. */
  failed: () => boolean;
  /** True once the current attempt's bytes rendered successfully. */
  loaded: () => boolean;
  /** Wire to the <img> load event. */
  onLoad: () => void;
  /** Wire to the <img> error event. */
  onError: () => void;
  /**
   * Wire to the <img> ref. Lets the machine detect an element that is
   * ALREADY complete for the current src — a browser-cached image can finish
   * loading before a key/ladder reset runs, and since the src doesn't change
   * afterwards there will never be another load event; without this check
   * the poster/placeholder stays on top of a fully loaded image forever.
   */
  attach: (el: HTMLImageElement) => void;
}

/**
 * Retry state machine for gallery tiles and viewer slides.
 *
 * Ladder semantics: for each size in `sizes`, try the plain URL first; on
 * error retry the SAME size once after a short backoff (the retry URL gets a
 * `retry` marker appended by `urlFor` so the original URL stays CDN-cacheable
 * and the retry actually re-fetches); on a second failure fall through to the
 * next (smaller) size; after the last size, report `failed` so the caller can
 * render a persistent placeholder. A component remount resets everything —
 * scrolling away and back gets a fresh ladder, exactly like before.
 *
 * A change in the size ladder itself (e.g. the viewer switching to fullsize
 * on zoom) or in `key` (e.g. a reused viewer slide navigating to another
 * asset) also resets the machine.
 */
export function createRetryingImage<Size extends string>(options: {
  sizes: () => readonly Size[];
  urlFor: (size: Size, retry: boolean) => string;
  /** Identity of the underlying image (asset id); a change resets the machine. */
  key?: () => string;
  retryDelayMs?: number;
}): RetryingImage {
  const retryDelayMs = options.retryDelayMs ?? IMAGE_RETRY_DELAY_MS;
  const [attempt, setAttempt] = createSignal<Attempt | null>({ index: 0, retry: false });
  const [loaded, setLoaded] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let element: HTMLImageElement | undefined;

  const currentSrc = (): string | undefined => {
    const current = untrack(attempt);
    if (!current) return undefined;
    const sizes = untrack(() => options.sizes());
    const size = sizes[Math.min(current.index, sizes.length - 1)];
    return options.urlFor(size, current.retry);
  };

  // If the rendered element already holds the current src fully decoded, no
  // load event is coming — mark loaded directly. Deferred a microtask so the
  // <img>'s reactive src attribute has been applied before comparing.
  const checkAlreadyComplete = () => {
    queueMicrotask(() => {
      const el = element;
      const src = currentSrc();
      if (!el || !src || untrack(loaded)) return;
      if (el.complete && el.naturalWidth > 0 && el.src.endsWith(src)) {
        setLoaded(true);
      }
    });
  };

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  // createComputed (not createEffect) so the reset applies synchronously in
  // the same update as the ladder change — the <img> must never observe a
  // stale attempt against the new ladder.
  createComputed(
    on(
      () => `${options.key?.() ?? ''}::${options.sizes().join('|')}`,
      () => {
        clearTimer();
        setAttempt({ index: 0, retry: false });
        setLoaded(false);
        checkAlreadyComplete();
      },
      { defer: true }
    )
  );

  onCleanup(clearTimer);

  return {
    src: () => {
      const current = attempt();
      if (!current) return undefined;
      const sizes = options.sizes();
      const size = sizes[Math.min(current.index, sizes.length - 1)];
      return options.urlFor(size, current.retry);
    },
    failed: () => attempt() === null,
    loaded,
    onLoad: () => setLoaded(true),
    attach: (el: HTMLImageElement) => {
      element = el;
      checkAlreadyComplete();
    },
    onError: () => {
      const current = untrack(attempt);
      // Ignore stray error events while already failed or mid-backoff.
      if (!current || timer !== undefined) return;
      if (!current.retry) {
        timer = setTimeout(() => {
          timer = undefined;
          setAttempt({ index: current.index, retry: true });
        }, retryDelayMs);
        return;
      }
      const sizes = untrack(() => options.sizes());
      if (current.index + 1 < sizes.length) {
        setAttempt({ index: current.index + 1, retry: false });
      } else {
        setAttempt(null);
      }
    },
  };
}
