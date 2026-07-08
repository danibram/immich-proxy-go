import type { Accessor } from 'solid-js';
import { batch, createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { DateGroup } from '~/utils/dateUtils';
import { findGroupAt, type TimelineLayout } from './timeline/layout';

interface Props {
  scrollContainer?: Accessor<HTMLDivElement | undefined>;
  groupedAssets: Accessor<DateGroup[]>;
  /** Computed timeline geometry — date labels map to exact offsets. */
  layout: Accessor<TimelineLayout>;
  /** Offset of the layout box inside the scroll container's content. */
  layoutTop: Accessor<number>;
}

const PADDING_TOP = 40;
const PADDING_BOTTOM = 96;
/** A group is "current" once its top is within this many px of the viewport top. */
const GROUP_TOP_BIAS = 150;

export default function TimelineScrubber(props: Props) {
  let scrubberRef: HTMLDivElement | undefined;

  const getScrollContainer = () => props.scrollContainer?.();

  let scrollThrottleId: number | null = null;
  let scrollTimeoutId: number | null = null;

  const [isDragging, setIsDragging] = createSignal(false);
  const [isHovering, setIsHovering] = createSignal(false);
  const [isScrolling, setIsScrolling] = createSignal(false);
  const [hoverLabel, setHoverLabel] = createSignal<string | null>(null);
  const [currentLabel, setCurrentLabel] = createSignal<string | null>(null);
  const [scrubberY, setScrubberY] = createSignal(0);
  const [hoverY, setHoverY] = createSignal(0);
  const [isTouchDevice, setIsTouchDevice] = createSignal(false);

  function handleScroll() {
    if (isDragging()) return;

    setIsScrolling(true);

    if (scrollTimeoutId !== null) {
      clearTimeout(scrollTimeoutId);
    }

    scrollTimeoutId = window.setTimeout(() => {
      setIsScrolling(false);
    }, 1000);

    if (scrollThrottleId !== null) return;

    scrollThrottleId = requestAnimationFrame(() => {
      scrollThrottleId = null;
      updateScrollPosition();
    });
  }

  /**
   * The date group at a given container scrollTop, straight from the
   * computed layout — no DOM scans, exact offsets.
   */
  function getGroupAtScrollTop(scrollTop: number): DateGroup | undefined {
    const containerRef = getScrollContainer();
    const shape = props.layout();
    if (shape.groups.length === 0) return undefined;

    if (containerRef) {
      const scrolledToBottom =
        scrollTop + containerRef.clientHeight >= containerRef.scrollHeight - 100;
      if (scrolledToBottom) return shape.groups[shape.groups.length - 1].group;
    }

    return findGroupAt(shape, scrollTop - props.layoutTop() + GROUP_TOP_BIAS)?.group;
  }

  function updateScrollPosition() {
    const containerRef = getScrollContainer();
    if (!containerRef || !scrubberRef) return;

    const maxScroll = containerRef.scrollHeight - containerRef.clientHeight;
    const scrollRatio = maxScroll > 0 ? containerRef.scrollTop / maxScroll : 0;
    const scrubberHeight = scrubberRef.clientHeight - PADDING_TOP - PADDING_BOTTOM;

    const group = getGroupAtScrollTop(containerRef.scrollTop);
    if (group) {
      batch(() => {
        setCurrentLabel(group.scrubberLabel);
        setScrubberY(Math.min(scrollRatio * scrubberHeight, scrubberHeight));
      });
    }
  }

  function updateScrubberPosition(clientY: number, isDrag: boolean) {
    if (!scrubberRef) return;

    const rect = scrubberRef.getBoundingClientRect();
    const availableHeight = rect.height - PADDING_TOP - PADDING_BOTTOM;
    const y = Math.max(0, Math.min(clientY - rect.top - PADDING_TOP, availableHeight));
    const ratio = availableHeight > 0 ? y / availableHeight : 0;

    const scrollContainer = getScrollContainer();
    const targetScrollTop = scrollContainer
      ? ratio * Math.max(scrollContainer.scrollHeight - scrollContainer.clientHeight, 0)
      : 0;
    const group = getGroupAtScrollTop(targetScrollTop);

    if (group) {
      batch(() => {
        setHoverY(y);
        setHoverLabel(group.scrubberLabel);

        if (isDrag) {
          setScrubberY(y);
          setCurrentLabel(group.scrubberLabel);
        }
      });

      if (isDrag && scrollContainer) {
        // Teleport freely: the gallery derives its render window from
        // scrollTop and defers image loads while the position is jumping,
        // so no per-move throttling is needed here.
        scrollContainer.scrollTop = targetScrollTop;
      }
    }
  }

  function handleScrubberMouseDown(e: MouseEvent) {
    e.preventDefault();
    setIsDragging(true);
    updateScrubberPosition(e.clientY, true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    updateScrubberPosition(e.clientY, true);
  }

  function handleMouseUp() {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }

  function handleScrubberHover(e: MouseEvent) {
    if (!isDragging()) {
      updateScrubberPosition(e.clientY, false);
    }
  }

  function handleTouchStart(e: TouchEvent) {
    e.preventDefault();
    setIsTouchDevice(true);
    setIsDragging(true);
    setIsHovering(true);
    if (e.touches[0]) {
      updateScrubberPosition(e.touches[0].clientY, true);
    }
  }

  function handleTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (e.touches[0]) {
      updateScrubberPosition(e.touches[0].clientY, true);
    }
  }

  function handleTouchEnd() {
    batch(() => {
      setIsDragging(false);
      setIsHovering(false);
      setHoverLabel(null);
    });
  }

  function handleScrubberEnter() {
    if (!isTouchDevice()) setIsHovering(true);
  }

  function handleScrubberLeave() {
    if (!isTouchDevice()) {
      setIsHovering(false);
      if (!isDragging()) setHoverLabel(null);
    }
  }

  createEffect(() => {
    const el = getScrollContainer();
    if (!el) return;
    const onScroll = () => handleScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => el.removeEventListener('scroll', onScroll));
  });

  onMount(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    setTimeout(updateScrollPosition, 100);
  });

  onCleanup(() => {
    if (scrollThrottleId !== null) cancelAnimationFrame(scrollThrottleId);
    if (scrollTimeoutId !== null) clearTimeout(scrollTimeoutId);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  });

  const showIndicator = () => isScrolling() || isHovering() || isDragging();

  return (
    <Show when={props.groupedAssets().length > 1}>
      <div
        ref={scrubberRef}
        class={`scrubber ${showIndicator() ? 'is-active' : ''}`}
        onMouseDown={handleScrubberMouseDown}
        onMouseEnter={handleScrubberEnter}
        onMouseLeave={handleScrubberLeave}
        onMouseMove={handleScrubberHover}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div class="scrub-track">
          <div
            class="scrub-thumb-wrap"
            style={{ top: `${PADDING_TOP + (isHovering() || isDragging() ? hoverY() : scrubberY())}px` }}
          >
            <span class="scrub-bubble">{isHovering() || isDragging() ? hoverLabel() : currentLabel()}</span>
            <span class="scrub-grip" />
          </div>
        </div>
        {/* While dragging, shield the whole viewport from hit-testing: the
            gallery is scrolling fast under the cursor, and without this the
            browser recomputes :hover (thumb-veil fades) on every frame,
            which janks the scrub. Mounted only during the drag, so idle
            clicks on photos are never intercepted. */}
        <Show when={isDragging()}>
          <div class="scrub-drag-shield" />
        </Show>
      </div>
    </Show>
  );
}
