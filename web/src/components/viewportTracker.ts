import { thumbnailLoader } from './thumbnailLoader';

type Root = HTMLElement | undefined;
type Evaluate = (root: Root) => void;

interface RootGroup {
  root: Root;
  entries: Map<Element, Evaluate>;
  observer: IntersectionObserver;
  scheduleSweep: () => void;
  frameId: number | null;
}

/**
 * Owns the position-evaluation sweep for a scroll container: ONE scroll
 * listener, ONE rAF-coalesced sweep and ONE IntersectionObserver shared by
 * every registered element, instead of one of each per element. The tracker
 * knows nothing about thumbnails — it runs opaque evaluate callbacks and
 * fires an injected hook when a sweep ends.
 */
export class ViewportTracker {
  private readonly groups = new Map<HTMLElement | null, RootGroup>();

  constructor(private readonly onSweepEnd?: () => void) {}

  /**
   * Registration evaluates the element synchronously (not on the next
   * frame): initial loads must not wait on rAF, which browsers throttle or
   * pause entirely in hidden tabs. Requires IntersectionObserver — callers
   * without it keep their own fallback.
   */
  register(el: Element, root: Root, evaluate: Evaluate): () => void {
    const group = this.groups.get(root ?? null) ?? this.createGroup(root);
    group.entries.set(el, evaluate);
    group.observer.observe(el);
    evaluate(root);
    return () => this.unregister(group, el, evaluate);
  }

  private createGroup(root: Root): RootGroup {
    const group: RootGroup = {
      root,
      entries: new Map(),
      observer: undefined as unknown as IntersectionObserver,
      scheduleSweep: () => {
        if (group.frameId !== null) return;
        group.frameId = requestAnimationFrame(() => {
          group.frameId = null;
          this.sweep(group);
        });
      },
      frameId: null,
    };

    group.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) group.scheduleSweep();
      },
      {
        root: root ?? null,
        rootMargin: '100% 0px',
        threshold: 0.01,
      }
    );

    root?.addEventListener('scroll', group.scheduleSweep, { passive: true });
    window.addEventListener('resize', group.scheduleSweep);
    this.groups.set(root ?? null, group);
    return group;
  }

  private sweep(group: RootGroup) {
    for (const evaluate of group.entries.values()) {
      evaluate(group.root);
    }
    this.onSweepEnd?.();
  }

  private unregister(group: RootGroup, el: Element, evaluate: Evaluate) {
    // A stale unregister (already run, element since re-registered) must
    // not evict the newer registration.
    if (group.entries.get(el) !== evaluate) return;
    group.entries.delete(el);
    group.observer.unobserve(el);
    if (group.entries.size > 0) return;

    group.observer.disconnect();
    group.root?.removeEventListener('scroll', group.scheduleSweep);
    window.removeEventListener('resize', group.scheduleSweep);
    if (group.frameId !== null) {
      cancelAnimationFrame(group.frameId);
      group.frameId = null;
    }
    this.groups.delete(group.root ?? null);
  }
}

export const viewportTracker = new ViewportTracker(() => thumbnailLoader.pump());
