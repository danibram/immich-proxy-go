import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewportTracker } from './viewportTracker';

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];

  constructor(
    private readonly callback: IntersectionObserverCallback,
    public readonly options?: IntersectionObserverInit
  ) {
    TestIntersectionObserver.instances.push(this);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  trigger(isIntersecting = true) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

describe('ViewportTracker', () => {
  const originalIntersectionObserver = window.IntersectionObserver;
  let rafCallbacks: FrameRequestCallback[];

  const flushFrame = () => {
    const callbacks = rafCallbacks;
    rafCallbacks = [];
    for (const callback of callbacks) callback(performance.now());
  };

  beforeEach(() => {
    TestIntersectionObserver.instances = [];
    window.IntersectionObserver = TestIntersectionObserver as unknown as typeof IntersectionObserver;
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    window.IntersectionObserver = originalIntersectionObserver;
    vi.unstubAllGlobals();
  });

  function makeRoot() {
    const root = document.createElement('div');
    return {
      root,
      addListener: vi.spyOn(root, 'addEventListener'),
      removeListener: vi.spyOn(root, 'removeEventListener'),
    };
  }

  it('evaluates an element synchronously on registration', () => {
    const tracker = new ViewportTracker();
    const { root } = makeRoot();
    const evaluate = vi.fn();

    tracker.register(document.createElement('div'), root, evaluate);

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith(root);
  });

  it('shares one scroll listener and one IntersectionObserver across registrations', () => {
    const tracker = new ViewportTracker();
    const { root, addListener } = makeRoot();

    tracker.register(document.createElement('div'), root, vi.fn());
    tracker.register(document.createElement('div'), root, vi.fn());
    tracker.register(document.createElement('div'), root, vi.fn());

    expect(TestIntersectionObserver.instances).toHaveLength(1);
    expect(addListener.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1);
    expect(TestIntersectionObserver.instances[0].observe).toHaveBeenCalledTimes(3);
    expect(TestIntersectionObserver.instances[0].options).toMatchObject({
      root,
      rootMargin: '100% 0px',
    });
  });

  it('coalesces scroll events into one rAF sweep over every registered element', () => {
    const onSweepEnd = vi.fn();
    const tracker = new ViewportTracker(onSweepEnd);
    const { root } = makeRoot();
    const first = vi.fn();
    const second = vi.fn();

    tracker.register(document.createElement('div'), root, first);
    tracker.register(document.createElement('div'), root, second);
    first.mockClear();
    second.mockClear();

    root.dispatchEvent(new Event('scroll'));
    root.dispatchEvent(new Event('scroll'));
    root.dispatchEvent(new Event('scroll'));
    expect(rafCallbacks).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();

    flushFrame();

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(root);
    expect(second).toHaveBeenCalledTimes(1);
    expect(onSweepEnd).toHaveBeenCalledTimes(1);
    // The hook fires after the evaluates, not between them.
    expect(onSweepEnd.mock.invocationCallOrder[0]).toBeGreaterThan(
      second.mock.invocationCallOrder[0]
    );
  });

  it('sweeps when the IntersectionObserver reports an intersection', () => {
    const tracker = new ViewportTracker();
    const { root } = makeRoot();
    const evaluate = vi.fn();

    tracker.register(document.createElement('div'), root, evaluate);
    evaluate.mockClear();

    TestIntersectionObserver.instances[0].trigger(false);
    expect(rafCallbacks).toHaveLength(0);

    TestIntersectionObserver.instances[0].trigger(true);
    flushFrame();
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('stops evaluating an element after its unregister callback runs', () => {
    const tracker = new ViewportTracker();
    const { root } = makeRoot();
    const kept = vi.fn();
    const removed = vi.fn();
    const removedEl = document.createElement('div');

    tracker.register(document.createElement('div'), root, kept);
    const unregister = tracker.register(removedEl, root, removed);
    kept.mockClear();
    removed.mockClear();

    unregister();
    expect(TestIntersectionObserver.instances[0].unobserve).toHaveBeenCalledWith(removedEl);

    root.dispatchEvent(new Event('scroll'));
    flushFrame();

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it('tears down the observer and listeners when the last element unregisters', () => {
    const tracker = new ViewportTracker();
    const { root, removeListener } = makeRoot();

    const unregisterFirst = tracker.register(document.createElement('div'), root, vi.fn());
    const unregisterSecond = tracker.register(document.createElement('div'), root, vi.fn());

    unregisterFirst();
    expect(TestIntersectionObserver.instances[0].disconnect).not.toHaveBeenCalled();

    unregisterSecond();
    expect(TestIntersectionObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1);

    // A registration after teardown starts a fresh group.
    tracker.register(document.createElement('div'), root, vi.fn());
    expect(TestIntersectionObserver.instances).toHaveLength(2);
  });

  it('keeps separate roots in separate groups', () => {
    const tracker = new ViewportTracker();
    const { root: firstRoot } = makeRoot();
    const { root: secondRoot } = makeRoot();
    const first = vi.fn();
    const second = vi.fn();

    tracker.register(document.createElement('div'), firstRoot, first);
    tracker.register(document.createElement('div'), secondRoot, second);
    first.mockClear();
    second.mockClear();

    expect(TestIntersectionObserver.instances).toHaveLength(2);

    firstRoot.dispatchEvent(new Event('scroll'));
    flushFrame();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('unregistering twice is a no-op and cannot evict a later registration', () => {
    const tracker = new ViewportTracker();
    const { root } = makeRoot();
    const el = document.createElement('div');

    const unregister = tracker.register(el, root, vi.fn());
    unregister();

    const evaluate = vi.fn();
    tracker.register(el, root, evaluate);
    evaluate.mockClear();
    unregister();

    root.dispatchEvent(new Event('scroll'));
    flushFrame();
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
