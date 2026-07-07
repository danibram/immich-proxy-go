import type { Accessor } from 'solid-js';
import { batch, createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { DateGroup } from '~/utils/dateUtils';

interface Props {
  scrollContainer?: Accessor<HTMLDivElement | undefined>;
  groupedAssets: Accessor<DateGroup[]>;
}

const PADDING_TOP = 40;
const PADDING_BOTTOM = 96;

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

  function updateScrollPosition() {
    const containerRef = getScrollContainer();
    if (!containerRef || !scrubberRef) return;

    const maxScroll = containerRef.scrollHeight - containerRef.clientHeight;
    const scrollRatio = maxScroll > 0 ? containerRef.scrollTop / maxScroll : 0;
    const scrubberHeight = scrubberRef.clientHeight - PADDING_TOP - PADDING_BOTTOM;

    const groups = props.groupedAssets();
    const domGroups = containerRef.querySelectorAll('[data-group-date]');
    let visibleGroup: Element | null = null;
    let lastGroup: Element | null = null;
    const containerTop = containerRef.getBoundingClientRect().top;

    for (const group of domGroups) {
      const rect = group.getBoundingClientRect();
      lastGroup = group;
      if (rect.top <= containerTop + 150) {
        visibleGroup = group;
      }
    }

    const scrolledToBottom =
      containerRef.scrollTop + containerRef.clientHeight >= containerRef.scrollHeight - 100;
    if (scrolledToBottom && lastGroup) {
      visibleGroup = lastGroup;
    }

    if (visibleGroup) {
      const date = visibleGroup.getAttribute('data-group-date');
      const groupIndex = groups.findIndex((g) => g.date === date);
      const group = groups[groupIndex];

      if (group) {
        batch(() => {
          setCurrentLabel(group.scrubberLabel);
          setScrubberY(Math.min(scrollRatio * scrubberHeight, scrubberHeight));
        });
      }
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
        scrollContainer.scrollTop = targetScrollTop;
      }
    }
  }

  function getGroupAtScrollTop(scrollTop: number): DateGroup | undefined {
    const scrollContainer = getScrollContainer();
    const groups = props.groupedAssets();
    if (!scrollContainer) return groups[0];

    let activeGroup = groups[0];
    const containerTop = scrollContainer.getBoundingClientRect().top;
    for (const group of groups) {
      const element = document.getElementById(`group-${group.date}`);
      if (!element) continue;

      const elementTop = element.getBoundingClientRect().top - containerTop + scrollContainer.scrollTop;
      if (elementTop <= scrollTop + 150) {
        activeGroup = group;
      } else {
        break;
      }
    }

    return activeGroup;
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
