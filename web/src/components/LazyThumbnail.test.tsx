import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '~/api/client';
import type { Asset } from '~/api/types';
import LazyThumbnail from './LazyThumbnail';

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];

  constructor(
    private readonly callback: IntersectionObserverCallback,
    public readonly options?: IntersectionObserverInit
  ) {
    TestIntersectionObserver.instances.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();

  trigger(entry: Partial<IntersectionObserverEntry> = {}) {
    this.callback(
      [
        {
          isIntersecting: true,
          target: document.createElement('div'),
          boundingClientRect: {} as DOMRectReadOnly,
          intersectionRatio: 1,
          intersectionRect: {} as DOMRectReadOnly,
          rootBounds: null,
          time: 0,
          ...entry,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver
    );
  }
}

const asset: Asset = {
  id: 'asset-1',
  deviceAssetId: 'asset-1',
  deviceId: 'web',
  ownerId: 'owner-1',
  type: 'IMAGE',
  originalPath: '/original.jpg',
  originalFileName: 'asset-1.jpg',
  thumbhash: '',
  fileCreatedAt: '2026-01-01T00:00:00.000Z',
  fileModifiedAt: '2026-01-01T00:00:00.000Z',
  localDateTime: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isFavorite: false,
  isArchived: false,
  isTrashed: false,
  isOffline: false,
  duration: '0:00',
  checksum: 'checksum',
  hasMetadata: false,
};

describe('LazyThumbnail', () => {
  const originalIntersectionObserver = window.IntersectionObserver;

  beforeEach(() => {
    TestIntersectionObserver.instances = [];
    window.IntersectionObserver = TestIntersectionObserver as unknown as typeof IntersectionObserver;
    api.setShareKey('share-key');
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.IntersectionObserver = originalIntersectionObserver;
  });

  it('loads a thumbnail when it enters the preload zone', async () => {
    let rootRef: HTMLDivElement | undefined;
    const { getByTestId } = render(() => (
      <div ref={rootRef} data-testid="scroll-root">
        <LazyThumbnail asset={asset} scrollContainer={() => rootRef} />
      </div>
    ));

    const root = getByTestId('scroll-root') as HTMLDivElement;
    const slot = getByTestId('gallery-thumb-slot') as HTMLDivElement;

    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 600 }),
    });
    Object.defineProperty(slot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100, bottom: 220 }),
    });

    TestIntersectionObserver.instances[0]?.trigger();

    await waitFor(() => {
      const image = getByTestId('gallery-thumb') as HTMLImageElement;
      expect(image.getAttribute('src')).toBe('/share/share-key/api/assets/asset-1/thumbnail.jpg?size=preview');
    });
  });

  it('cancels an in-flight image that leaves the cancel zone and reloads it when it returns', async () => {
    let rootRef: HTMLDivElement | undefined;
    const { getByTestId, queryByTestId } = render(() => (
      <div ref={rootRef} data-testid="scroll-root">
        <LazyThumbnail asset={asset} scrollContainer={() => rootRef} />
      </div>
    ));

    const root = getByTestId('scroll-root') as HTMLDivElement;
    const slot = getByTestId('gallery-thumb-slot') as HTMLDivElement;
    let top = 100;
    let bottom = 220;

    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 600 }),
    });
    Object.defineProperty(slot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top, bottom }),
    });

    TestIntersectionObserver.instances[0]?.trigger();
    await waitFor(() => {
      const image = getByTestId('gallery-thumb') as HTMLImageElement;
      expect(image.getAttribute('src')).toBe('/share/share-key/api/assets/asset-1/thumbnail.jpg?size=preview');
    });

    top = 2600;
    bottom = 2720;
    fireEvent.scroll(root);

    await waitFor(() => {
      expect(queryByTestId('gallery-thumb')).toBeNull();
    });

    top = 120;
    bottom = 240;
    fireEvent.scroll(root);

    await waitFor(() => {
      const image = getByTestId('gallery-thumb') as HTMLImageElement;
      expect(image.getAttribute('src')).toBe('/share/share-key/api/assets/asset-1/thumbnail.jpg?size=preview');
    });
  });

  it('falls back to thumbnail size when preview fails', async () => {
    let rootRef: HTMLDivElement | undefined;
    const { getByTestId } = render(() => (
      <div ref={rootRef} data-testid="scroll-root">
        <LazyThumbnail asset={asset} scrollContainer={() => rootRef} />
      </div>
    ));

    const root = getByTestId('scroll-root') as HTMLDivElement;
    const slot = getByTestId('gallery-thumb-slot') as HTMLDivElement;

    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 600 }),
    });
    Object.defineProperty(slot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100, bottom: 220 }),
    });

    TestIntersectionObserver.instances[0]?.trigger();

    await waitFor(() => {
      const image = getByTestId('gallery-thumb') as HTMLImageElement;
      expect(image.getAttribute('src')).toBe('/share/share-key/api/assets/asset-1/thumbnail.jpg?size=preview');
    });

    fireEvent.error(getByTestId('gallery-thumb'));

    await waitFor(() => {
      const image = getByTestId('gallery-thumb') as HTMLImageElement;
      expect(image.getAttribute('src')).toBe('/share/share-key/api/assets/asset-1/thumbnail.webp?size=thumbnail');
    });
  });
});
