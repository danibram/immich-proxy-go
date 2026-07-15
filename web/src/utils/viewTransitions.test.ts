import { afterEach, describe, expect, it, vi } from 'vitest';
import { findGalleryTransitionTarget, runViewerTransition } from './viewTransitions';

const originalStartViewTransition = (
  document as Document & { startViewTransition?: unknown }
).startViewTransition;

afterEach(() => {
  if (originalStartViewTransition) {
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: originalStartViewTransition,
    });
  } else {
    Reflect.deleteProperty(document, 'startViewTransition');
  }
  delete document.documentElement.dataset.viewerTransition;
  vi.restoreAllMocks();
});

describe('runViewerTransition', () => {
  it('falls back to an immediate update when the API is unavailable', () => {
    Reflect.deleteProperty(document, 'startViewTransition');
    const update = vi.fn();

    runViewerTransition({ direction: 'open', update });

    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveAttribute('data-viewer-transition');
  });

  it('pairs the old and new photo and cleans up after the transition', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const oldElement = document.createElement('div');
    const newElement = document.createElement('div');
    const update = vi.fn();
    const startViewTransition = vi.fn((callback: () => void) => {
      expect(oldElement.style.viewTransitionName).toBe('viewer-photo');
      callback();
      return {
        ready: Promise.resolve(),
        finished,
        updateCallbackDone: Promise.resolve(),
        skipTransition: vi.fn(),
      };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });

    runViewerTransition({
      direction: 'close',
      oldElement,
      update,
      getNewElement: () => newElement,
    });

    expect(update).toHaveBeenCalledOnce();
    expect(oldElement.style.viewTransitionName).toBe('');
    expect(newElement.style.viewTransitionName).toBe('viewer-photo');
    expect(document.documentElement.dataset.viewerTransition).toBe('close');

    finish();
    await finished;
    await Promise.resolve();

    expect(newElement.style.viewTransitionName).toBe('');
    expect(document.documentElement).not.toHaveAttribute('data-viewer-transition');
  });

  it('keeps only the newest asynchronous update when transitions overlap', async () => {
    const pending: Array<{
      callback: () => void;
      finish: () => void;
      finished: Promise<void>;
      skipTransition: ReturnType<typeof vi.fn>;
    }> = [];
    const startViewTransition = vi.fn((callback: () => void) => {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const entry = {
        callback,
        finish,
        finished,
        skipTransition: vi.fn(),
      };
      pending.push(entry);
      return {
        ready: Promise.resolve(),
        finished,
        updateCallbackDone: Promise.resolve(),
        skipTransition: entry.skipTransition,
      };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });

    const target = document.createElement('div');
    const staleUpdate = vi.fn();
    const latestUpdate = vi.fn();

    runViewerTransition({ direction: 'open', oldElement: target, update: staleUpdate });
    runViewerTransition({
      direction: 'close',
      update: latestUpdate,
      getNewElement: () => target,
    });

    expect(pending[0].skipTransition).toHaveBeenCalledOnce();

    // Native callbacks are asynchronous and may run out of order. The latest
    // intent must win even when the skipped callback arrives last.
    pending[1].callback();
    pending[0].callback();
    expect(latestUpdate).toHaveBeenCalledOnce();
    expect(staleUpdate).not.toHaveBeenCalled();
    expect(target.style.viewTransitionName).toBe('viewer-photo');

    pending[0].finish();
    await pending[0].finished;
    await Promise.resolve();
    expect(target.style.viewTransitionName).toBe('viewer-photo');

    pending[1].finish();
    await pending[1].finished;
    await Promise.resolve();
    expect(target.style.viewTransitionName).toBe('');
    expect(document.documentElement).not.toHaveAttribute('data-viewer-transition');
  });

  it('does not animate when reduced motion is requested', () => {
    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const startViewTransition = vi.fn();
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });
    const update = vi.fn();

    runViewerTransition({ direction: 'open', update });

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
  });
});

describe('findGalleryTransitionTarget', () => {
  it('finds the target through the transition-owned data contract', () => {
    const root = document.createElement('section');
    const target = document.createElement('div');
    target.dataset.viewTransitionAssetId = 'asset-with-special-"-characters';
    root.append(target);

    expect(findGalleryTransitionTarget('asset-with-special-"-characters', root)).toBe(target);
    expect(findGalleryTransitionTarget('missing', root)).toBeNull();
  });
});
