import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useViewerCarousel } from './useViewerCarousel';

function flushEffects(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe('useViewerCarousel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('observes stage width once when the stage element is set', async () => {
    await new Promise<void>((done) => {
      createRoot(async (dispose) => {
        const [index, setIndex] = createSignal(0);
        const [stageEl, setStageEl] = createSignal<HTMLDivElement | undefined>(undefined);
        const observe = vi.fn();

        const div = document.createElement('div');
        Object.defineProperty(div, 'clientWidth', { value: 320, configurable: true });
        vi.stubGlobal(
          'ResizeObserver',
          class {
            constructor(cb: ResizeObserverCallback) {
              observe();
              cb([{ contentRect: { width: 320 } } as ResizeObserverEntry], this);
            }
            observe() {}
            disconnect() {}
          }
        );

        useViewerCarousel({
          index,
          count: () => 3,
          stageEl,
          onIndexChange: setIndex,
        });

        setStageEl(div);
        await flushEffects();
        setIndex(1);
        await flushEffects();

        expect(observe).toHaveBeenCalledTimes(1);
        dispose();
        done();
      });
    });
  });

  it('ignores bubbled transitionend events and commits index on track transform', async () => {
    await new Promise<void>((done) => {
      createRoot(async (dispose) => {
        const [index, setIndex] = createSignal(0);
        const onIndexChange = vi.fn((i: number) => setIndex(i));
        const div = document.createElement('div');
        Object.defineProperty(div, 'clientWidth', { value: 400, configurable: true });
        vi.stubGlobal(
          'ResizeObserver',
          class {
            constructor(cb: ResizeObserverCallback) {
              cb([{ contentRect: { width: 400 } } as ResizeObserverEntry], this);
            }
            observe() {}
            disconnect() {}
          }
        );

        const carousel = useViewerCarousel({
          index,
          count: () => 3,
          stageEl: () => div,
          onIndexChange,
          animated: true,
        });

        await flushEffects();
        carousel.step(1);

        const track = document.createElement('div');
        const child = document.createElement('canvas');
        track.appendChild(child);

        carousel.onTransitionEnd({
          target: child,
          currentTarget: track,
          propertyName: 'opacity',
        } as TransitionEvent);
        expect(onIndexChange).not.toHaveBeenCalled();

        carousel.onTransitionEnd({
          target: track,
          currentTarget: track,
          propertyName: 'opacity',
        } as TransitionEvent);
        expect(onIndexChange).not.toHaveBeenCalled();

        carousel.onTransitionEnd({
          target: track,
          currentTarget: track,
          propertyName: 'transform',
        } as TransitionEvent);
        expect(onIndexChange).toHaveBeenCalledWith(1);

        dispose();
        done();
      });
    });
  });

  it('commits navigation if the transform transitionend event is missed', async () => {
    vi.useFakeTimers();

    await new Promise<void>((done) => {
      createRoot(async (dispose) => {
        const [index, setIndex] = createSignal(0);
        const onIndexChange = vi.fn((i: number) => setIndex(i));
        const div = document.createElement('div');
        Object.defineProperty(div, 'clientWidth', { value: 400, configurable: true });
        vi.stubGlobal(
          'ResizeObserver',
          class {
            constructor(cb: ResizeObserverCallback) {
              cb([{ contentRect: { width: 400 } } as ResizeObserverEntry], this);
            }
            observe() {}
            disconnect() {}
          }
        );

        const carousel = useViewerCarousel({
          index,
          count: () => 3,
          stageEl: () => div,
          onIndexChange,
          animated: true,
        });

        await flushEffects();
        carousel.step(1);

        expect(onIndexChange).not.toHaveBeenCalled();
        vi.advanceTimersByTime(360);

        expect(onIndexChange).toHaveBeenCalledWith(1);
        dispose();
        done();
      });
    });
  });

  it('navigates immediately when requested for button and keyboard controls', async () => {
    await new Promise<void>((done) => {
      createRoot(async (dispose) => {
        const [index, setIndex] = createSignal(0);
        const onIndexChange = vi.fn((i: number) => setIndex(i));
        const div = document.createElement('div');
        Object.defineProperty(div, 'clientWidth', { value: 400, configurable: true });
        vi.stubGlobal(
          'ResizeObserver',
          class {
            constructor(cb: ResizeObserverCallback) {
              cb([{ contentRect: { width: 400 } } as ResizeObserverEntry], this);
            }
            observe() {}
            disconnect() {}
          }
        );

        const carousel = useViewerCarousel({
          index,
          count: () => 3,
          stageEl: () => div,
          onIndexChange,
          animated: true,
        });

        await flushEffects();
        carousel.step(1, true);

        expect(onIndexChange).toHaveBeenCalledWith(1);
        expect(index()).toBe(1);
        dispose();
        done();
      });
    });
  });

  it('navigates immediately by default when stage width is unavailable', async () => {
    await new Promise<void>((done) => {
      createRoot(async (dispose) => {
        const [index, setIndex] = createSignal(0);
        const onIndexChange = vi.fn((i: number) => setIndex(i));

        const carousel = useViewerCarousel({
          index,
          count: () => 3,
          stageEl: () => undefined,
          onIndexChange,
        });

        await flushEffects();
        carousel.step(1);

        expect(onIndexChange).toHaveBeenCalledWith(1);
        expect(index()).toBe(1);
        dispose();
        done();
      });
    });
  });
});
