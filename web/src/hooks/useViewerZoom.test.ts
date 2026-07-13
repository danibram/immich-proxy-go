import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useViewerZoom } from './useViewerZoom';

function flushEffects(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function makeStage() {
  const stage = document.createElement('div');
  const slide = document.createElement('div');
  const image = document.createElement('img');
  slide.className = 'vw-slide is-current';
  image.className = 'vw-img';
  slide.append(image);
  stage.append(slide);
  Object.defineProperty(stage, 'clientWidth', { value: 400 });
  Object.defineProperty(stage, 'clientHeight', { value: 300 });
  image.getBoundingClientRect = () => ({
    width: 400,
    height: 300,
    top: 0,
    left: 0,
    right: 400,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return stage;
}

describe('useViewerZoom', () => {
  it('zooms, caps at 5x and resets when the asset changes', async () => {
    await new Promise<void>((done) => {
      createRoot(async (dispose) => {
        const [assetId, setAssetId] = createSignal('one');
        const zoom = useViewerZoom({
          assetId,
          enabled: () => true,
          stageEl: () => makeStage(),
        });
        await flushEffects();

        zoom.zoomIn();
        expect(zoom.scale()).toBe(1.5);
        for (let i = 0; i < 10; i++) zoom.zoomIn();
        expect(zoom.scale()).toBe(5);
        expect(zoom.zoomed()).toBe(true);

        setAssetId('two');
        await flushEffects();
        expect(zoom.scale()).toBe(1);
        expect(zoom.transform()).toContain('scale(1)');
        dispose();
        done();
      });
    });
  });

  it('takes ownership of pan only after zoom and prevents wheel scrolling', async () => {
    await new Promise<void>((done) => {
      createRoot(async (dispose) => {
        const stage = makeStage();
        const zoom = useViewerZoom({
          assetId: () => 'one',
          enabled: () => true,
          stageEl: () => stage,
        });
        await flushEffects();

        const pointer = { pointerId: 1, clientX: 100, clientY: 100, currentTarget: stage } as PointerEvent;
        expect(zoom.onPointerDown(pointer)).toBe(false);
        zoom.onPointerUp(pointer);

        const preventDefault = vi.fn();
        zoom.onWheel({ deltaY: -200, preventDefault } as unknown as WheelEvent);
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(zoom.zoomed()).toBe(true);
        const image = stage.querySelector('img')!;
        image.getBoundingClientRect = () => ({
          width: 600,
          height: 450,
          top: 0,
          left: 0,
          right: 600,
          bottom: 450,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        });
        expect(zoom.onPointerDown(pointer)).toBe(true);
        expect(zoom.onPointerMove({ ...pointer, clientX: 140 } as PointerEvent)).toBe(true);
        expect(zoom.transform()).toMatch(/translate3d\((?!0px)/);
        dispose();
        done();
      });
    });
  });
});
