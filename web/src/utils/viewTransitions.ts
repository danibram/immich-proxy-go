export type ViewerTransitionDirection = 'open' | 'close';

type BrowserViewTransition = {
  ready: Promise<unknown>;
  finished: Promise<unknown>;
  updateCallbackDone: Promise<unknown>;
  skipTransition(): void;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => BrowserViewTransition;
};

type ViewerTransitionOptions = {
  direction: ViewerTransitionDirection;
  update: () => void;
  oldElement?: HTMLElement | null;
  getNewElement?: () => HTMLElement | null | undefined;
};

const PHOTO_TRANSITION_NAME = 'viewer-photo';
const GALLERY_TARGET_ATTRIBUTE = 'data-view-transition-asset-id';

let transitionSequence = 0;

type ActiveTransition = {
  transition: BrowserViewTransition;
  cleanup: () => void;
};

let activeTransition: ActiveTransition | null = null;

function motionIsReduced(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

function setTransitionName(element: HTMLElement | null | undefined) {
  if (!element) return () => undefined;

  const previousName = element.style.viewTransitionName;
  let active = true;
  element.style.viewTransitionName = PHOTO_TRANSITION_NAME;
  return () => {
    if (!active) return;
    active = false;
    element.style.viewTransitionName = previousName;
  };
}

/**
 * Finds the mounted gallery element that participates in the shared-photo
 * transition. Keeping this selector here makes the transition module the
 * owner of the DOM contract instead of coupling the viewer to gallery markup.
 */
export function findGalleryTransitionTarget(
  assetId: string,
  root: ParentNode = document
): HTMLElement | null {
  const targets = root.querySelectorAll<HTMLElement>(`[${GALLERY_TARGET_ATTRIBUTE}]`);
  for (const target of targets) {
    if (target.dataset.viewTransitionAssetId === assetId) return target;
  }
  return null;
}

/**
 * Runs a gallery/viewer state change as a shared-element transition.
 *
 * The latest requested state update is always performed. Superseded updates
 * become no-ops; unsupported browsers and visitors who prefer reduced motion
 * get the same behavior without animation.
 */
export function runViewerTransition(options: ViewerTransitionOptions): void {
  const transitionDocument = document as ViewTransitionDocument;
  const startViewTransition = transitionDocument.startViewTransition;
  const sequence = ++transitionSequence;

  // Starting a new View Transition does not cancel the old update callback:
  // the browser can invoke both callbacks asynchronously and out of order.
  // Clean the old session first, then make its eventual callback a stale
  // no-op so only the newest user intent can mutate application state.
  if (activeTransition) {
    activeTransition.cleanup();
    activeTransition.transition.skipTransition();
    activeTransition = null;
  }

  if (!startViewTransition || motionIsReduced()) {
    delete document.documentElement.dataset.viewerTransition;
    options.update();
    return;
  }

  document.documentElement.dataset.viewerTransition = options.direction;
  const restoreOldElement = setTransitionName(options.oldElement);
  let restoreNewElement: () => void = () => undefined;
  let cleaned = false;
  let updateRan = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    restoreOldElement();
    restoreNewElement();
  };

  try {
    const transition = startViewTransition.call(transitionDocument, () => {
      // The old snapshot has been captured. Remove the name from the old DOM
      // before rendering the destination so it cannot collide with the new
      // element's shared transition name.
      restoreOldElement();
      if (sequence !== transitionSequence) return;
      updateRan = true;
      options.update();
      if (sequence !== transitionSequence) return;
      restoreNewElement = setTransitionName(options.getNewElement?.());
    });

    const session: ActiveTransition = { transition, cleanup };
    // `ready` rejects when a browser skips a visual transition (for example,
    // a capture conflict). The state update still succeeds by design.
    void transition.ready.catch(() => undefined);
    void transition.updateCallbackDone.catch(() => undefined);
    if (sequence !== transitionSequence) {
      cleanup();
      transition.skipTransition();
      void transition.finished.catch(() => undefined);
      return;
    }
    activeTransition = session;
    void transition.finished
      .catch(() => undefined)
      .finally(() => {
        cleanup();
        if (activeTransition !== session) return;
        delete document.documentElement.dataset.viewerTransition;
        activeTransition = null;
      });
  } catch {
    cleanup();
    if (sequence === transitionSequence) {
      delete document.documentElement.dataset.viewerTransition;
      activeTransition = null;
    }
    if (!updateRan) options.update();
  }
}
