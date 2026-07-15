import { afterEach, describe, expect, it, vi } from 'vitest';
import { runViewerTransition } from './viewTransitions';

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
