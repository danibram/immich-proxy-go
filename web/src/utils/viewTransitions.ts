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

let activeTransition: BrowserViewTransition | null = null;
let transitionSequence = 0;

function motionIsReduced(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

function setTransitionName(element: HTMLElement | null | undefined) {
  if (!element) return () => undefined;

  const previousName = element.style.viewTransitionName;
  element.style.viewTransitionName = PHOTO_TRANSITION_NAME;
  return () => {
    element.style.viewTransitionName = previousName;
  };
}

/**
 * Runs a gallery/viewer state change as a shared-element transition.
 *
 * The state update is always performed. Unsupported browsers and visitors
 * who prefer reduced motion get the same behavior without animation.
 */
export function runViewerTransition(options: ViewerTransitionOptions): void {
  const transitionDocument = document as ViewTransitionDocument;
  const startViewTransition = transitionDocument.startViewTransition;

  if (!startViewTransition || motionIsReduced()) {
    options.update();
    return;
  }

  // A user can close the viewer before its opening animation has settled.
  // The first DOM update has already happened by then, so finish its visual
  // overlay and let the newer transition own the screen.
  activeTransition?.skipTransition();

  const sequence = ++transitionSequence;
  document.documentElement.dataset.viewerTransition = options.direction;
  const restoreOldElement = setTransitionName(options.oldElement);
  let restoreNewElement: () => void = () => undefined;
  let updateRan = false;

  try {
    const transition = startViewTransition.call(transitionDocument, () => {
      // The old snapshot has been captured. Remove the name from the old DOM
      // before rendering the destination so it cannot collide with the new
      // element's shared transition name.
      restoreOldElement();
      updateRan = true;
      options.update();
      restoreNewElement = setTransitionName(options.getNewElement?.());
    });

    activeTransition = transition;
    // `ready` rejects when a browser skips a visual transition (for example,
    // a capture conflict). The state update still succeeds by design.
    void transition.ready.catch(() => undefined);
    void transition.finished
      .catch(() => undefined)
      .finally(() => {
        restoreOldElement();
        restoreNewElement();
        if (sequence !== transitionSequence) return;
        delete document.documentElement.dataset.viewerTransition;
        activeTransition = null;
      });
  } catch {
    restoreOldElement();
    delete document.documentElement.dataset.viewerTransition;
    activeTransition = null;
    if (!updateRan) options.update();
  }
}
