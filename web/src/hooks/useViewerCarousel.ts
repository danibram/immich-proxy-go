import { batch, createEffect, createSignal, onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';

interface Options {
  index: Accessor<number>;
  count: Accessor<number>;
  stageEl: Accessor<HTMLDivElement | undefined>;
  onIndexChange: (index: number) => void;
  onSwipeStart?: () => void;
  animated?: boolean;
}

export function useViewerCarousel(options: Options) {
  const [stageWidth, setStageWidth] = createSignal(0);
  const [dx, setDx] = createSignal(0);
  const [anim, setAnim] = createSignal(false);

  let pendingStep = 0;
  let dragStartX: number | null = null;
  let transitionFallbackId: number | null = null;

  const hasPrev = () => options.index() > 0;
  const hasNext = () => options.index() < options.count() - 1;

  function goToIndex(newIndex: number) {
    if (newIndex < 0 || newIndex >= options.count()) return;
    options.onIndexChange(newIndex);
  }

  function clearTransitionFallback() {
    if (transitionFallbackId !== null) {
      window.clearTimeout(transitionFallbackId);
      transitionFallbackId = null;
    }
  }

  function commitPendingStep() {
    if (pendingStep !== 0) {
      const dir = pendingStep;
      pendingStep = 0;
      batch(() => {
        setAnim(false);
        setDx(0);
        goToIndex(options.index() + dir);
      });
    } else {
      setAnim(false);
    }
  }

  function step(dir: -1 | 1, immediate = false) {
    // A step requested while another is mid-animation must not overwrite the
    // pending one (fast swipes would coalesce into a single image change and
    // feel stuck). Commit the in-flight step first so both land.
    if (pendingStep !== 0) {
      clearTransitionFallback();
      commitPendingStep();
    }
    const w = stageWidth();
    if (dir > 0 && !hasNext()) return;
    if (dir < 0 && !hasPrev()) return;
    if (immediate || !options.animated || !w) {
      clearTransitionFallback();
      pendingStep = 0;
      batch(() => {
        setAnim(false);
        setDx(0);
        goToIndex(options.index() + dir);
      });
      return;
    }
    clearTransitionFallback();
    pendingStep = dir;
    setAnim(true);
    setDx(-dir * w);
    transitionFallbackId = window.setTimeout(commitPendingStep, 360);
  }

  function onTransitionEnd(event: TransitionEvent) {
    // Ignore bubbled transitions (e.g. ProtectedImage opacity fade on vw-btn hover).
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== 'transform') return;

    clearTransitionFallback();
    commitPendingStep();
  }

  function resetMotion() {
    clearTransitionFallback();
    setDx(0);
    pendingStep = 0;
    setAnim(false);
  }

  function cancelGesture() {
    dragStartX = null;
    resetMotion();
  }

  createEffect(() => {
    options.index();
    resetMotion();
  });

  createEffect(() => {
    const el = options.stageEl();
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setStageWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setStageWidth(el.clientWidth);
    onCleanup(() => ro.disconnect());
  });

  function onPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, .vid-bar, .vid-dock, [data-no-swipe]')) return;

    // Starting a drag cancels the previous step's CSS transition, so its
    // transitionend never fires; commit it now or that swipe gets swallowed
    // (only the 360ms fallback would rescue it, racing this gesture).
    if (pendingStep !== 0) {
      clearTransitionFallback();
      commitPendingStep();
    }
    dragStartX = e.clientX;
    setAnim(false);
    options.onSwipeStart?.();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (dragStartX === null) return;
    let delta = e.clientX - dragStartX;
    if ((delta > 0 && !hasPrev()) || (delta < 0 && !hasNext())) {
      delta *= 0.3;
    }
    setDx(delta);
  }

  function onPointerUp() {
    if (dragStartX === null) return;
    dragStartX = null;
    const w = stageWidth();
    const threshold = w * 0.2;
    const offset = dx();

    if (offset <= -threshold && hasNext()) {
      step(1);
    } else if (offset >= threshold && hasPrev()) {
      step(-1);
    } else {
      setAnim(true);
      setDx(0);
    }
  }

  const trackTransform = () => {
    const w = stageWidth();
    return `translateX(${-w + dx()}px)`;
  };

  onCleanup(clearTransitionFallback);

  return {
    stageWidth,
    anim,
    hasPrev,
    hasNext,
    step,
    onTransitionEnd,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancelGesture,
    trackTransform,
  };
}
