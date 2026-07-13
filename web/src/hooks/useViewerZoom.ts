import { createEffect, createSignal } from 'solid-js';
import type { Accessor } from 'solid-js';

interface ViewerZoomOptions {
  assetId: Accessor<string>;
  enabled: Accessor<boolean>;
  stageEl: Accessor<HTMLDivElement | undefined>;
  maxScale?: number;
}

interface Point {
  x: number;
  y: number;
}

const MIN_SCALE = 1;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function useViewerZoom(options: ViewerZoomOptions) {
  const maxScale = options.maxScale ?? 5;
  const [scale, setScale] = createSignal(MIN_SCALE);
  const [x, setX] = createSignal(0);
  const [y, setY] = createSignal(0);
  const [interacting, setInteracting] = createSignal(false);

  const pointers = new Map<number, Point>();
  let gestureActive = false;
  let pinchStartDistance = 0;
  let pinchStartScale = MIN_SCALE;
  let pinchStartMidpoint: Point = { x: 0, y: 0 };
  let pinchStartTranslation: Point = { x: 0, y: 0 };
  let panStartPointer: Point | null = null;
  let panStartTranslation: Point = { x: 0, y: 0 };

  const zoomed = () => scale() > MIN_SCALE + 0.01;

  function mediaBaseSize(): { width: number; height: number } {
    const stage = options.stageEl();
    const media = stage?.querySelector<HTMLElement>('.vw-slide.is-current .vw-img');
    if (!stage || !media) {
      return { width: stage?.clientWidth ?? 0, height: stage?.clientHeight ?? 0 };
    }
    const rect = media.getBoundingClientRect();
    const currentScale = Math.max(scale(), MIN_SCALE);
    return { width: rect.width / currentScale, height: rect.height / currentScale };
  }

  function clampedTranslation(nextX: number, nextY: number, nextScale: number): Point {
    const stage = options.stageEl();
    if (!stage || nextScale <= MIN_SCALE) return { x: 0, y: 0 };
    const base = mediaBaseSize();
    const maxX = Math.max(0, (base.width * nextScale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (base.height * nextScale - stage.clientHeight) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, nextX)),
      y: Math.max(-maxY, Math.min(maxY, nextY)),
    };
  }

  function apply(nextScale: number, nextX = x(), nextY = y()) {
    const boundedScale = Math.max(MIN_SCALE, Math.min(maxScale, nextScale));
    const translation = clampedTranslation(nextX, nextY, boundedScale);
    setScale(boundedScale);
    setX(translation.x);
    setY(translation.y);
  }

  function reset() {
    pointers.clear();
    gestureActive = false;
    panStartPointer = null;
    setInteracting(false);
    setScale(MIN_SCALE);
    setX(0);
    setY(0);
  }

  function zoomBy(factor: number) {
    if (!options.enabled()) return;
    apply(scale() * factor);
  }

  function onWheel(event: WheelEvent) {
    if (!options.enabled()) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.002);
    apply(scale() * factor);
  }

  function onDoubleClick(event: MouseEvent) {
    if (!options.enabled()) return;
    event.preventDefault();
    if (zoomed()) reset();
    else apply(2.5);
  }

  // Returns true when zoom owns the pointer event. At scale 1 a single
  // pointer remains available to the carousel; a second pointer promotes the
  // gesture to pinch and cancels carousel movement.
  function onPointerDown(event: PointerEvent): boolean {
    if (!options.enabled()) return false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      gestureActive = true;
      setInteracting(true);
      pinchStartDistance = Math.max(1, distance(a, b));
      pinchStartScale = scale();
      pinchStartMidpoint = midpoint(a, b);
      pinchStartTranslation = { x: x(), y: y() };
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      return true;
    }

    if (zoomed()) {
      gestureActive = true;
      setInteracting(true);
      panStartPointer = { x: event.clientX, y: event.clientY };
      panStartTranslation = { x: x(), y: y() };
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      return true;
    }

    return false;
  }

  function onPointerMove(event: PointerEvent): boolean {
    if (!pointers.has(event.pointerId)) return false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const nextScale = pinchStartScale * (distance(a, b) / pinchStartDistance);
      const mid = midpoint(a, b);
      apply(
        nextScale,
        pinchStartTranslation.x + mid.x - pinchStartMidpoint.x,
        pinchStartTranslation.y + mid.y - pinchStartMidpoint.y
      );
      return true;
    }

    if (gestureActive && panStartPointer) {
      apply(
        scale(),
        panStartTranslation.x + event.clientX - panStartPointer.x,
        panStartTranslation.y + event.clientY - panStartPointer.y
      );
      return true;
    }
    return gestureActive;
  }

  function onPointerUp(event: PointerEvent): boolean {
    const owned = gestureActive || zoomed();
    pointers.delete(event.pointerId);
    if (pointers.size < 2) {
      pinchStartDistance = 0;
      const remaining = [...pointers.values()][0];
      panStartPointer = remaining ?? null;
      panStartTranslation = { x: x(), y: y() };
    }
    if (pointers.size === 0) {
      gestureActive = false;
      panStartPointer = null;
      setInteracting(false);
      apply(scale());
    }
    return owned;
  }

  createEffect(() => {
    options.assetId();
    reset();
  });

  const transform = () => `translate3d(${x()}px, ${y()}px, 0) scale(${scale()})`;

  return {
    scale,
    zoomed,
    interacting,
    transform,
    reset,
    zoomIn: () => zoomBy(1.5),
    zoomOut: () => zoomBy(1 / 1.5),
    onWheel,
    onDoubleClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
