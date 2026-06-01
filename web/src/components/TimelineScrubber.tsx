import type { Accessor } from 'solid-js';
import { batch, createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { DateGroup } from '~/utils/dateUtils';
import { getUniqueYears } from '~/utils/dateUtils';

interface Props {
  scrollContainer?: Accessor<HTMLDivElement | undefined>;
  groupedAssets: Accessor<DateGroup[]>;
}

const PADDING_TOP = 24;
const PADDING_BOTTOM = 24;

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

  const scrubberYears = () => getUniqueYears(props.groupedAssets());

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
        const totalGroups = groups.length;
        const ratio = totalGroups > 1 ? groupIndex / (totalGroups - 1) : 0;
        const scrubberHeight = scrubberRef.clientHeight - PADDING_TOP - PADDING_BOTTOM;

        batch(() => {
          setCurrentLabel(group.scrubberLabel);
          setScrubberY(Math.min(ratio * scrubberHeight, scrubberHeight));
        });
      }
    }
  }

  function updateScrubberPosition(clientY: number, isDrag: boolean) {
    if (!scrubberRef) return;

    const groups = props.groupedAssets();
    const rect = scrubberRef.getBoundingClientRect();
    const availableHeight = rect.height - PADDING_TOP - PADDING_BOTTOM;
    const y = Math.max(0, Math.min(clientY - rect.top - PADDING_TOP, availableHeight));
    const ratio = availableHeight > 0 ? y / availableHeight : 0;

    const totalGroups = groups.length;
    const groupIndex = Math.min(Math.floor(ratio * totalGroups), totalGroups - 1);
    const group = groups[groupIndex];

    if (group) {
      batch(() => {
        setHoverY(y);
        setHoverLabel(group.scrubberLabel);

        if (isDrag) {
          setScrubberY(y);
          setCurrentLabel(group.scrubberLabel);
        }
      });

      const scrollContainer = getScrollContainer();
      if (isDrag && scrollContainer) {
        const element = document.getElementById(`group-${group.date}`);
        if (element) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const offset = elementRect.top - containerRect.top + scrollContainer.scrollTop;
          scrollContainer.scrollTop = offset;
        }
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
        <div
          class="scrub-years"
          style={{ top: `${PADDING_TOP}px`, bottom: `${PADDING_BOTTOM}px` }}
        >
          <For each={scrubberYears()}>
            {(year, index) => {
              const total = scrubberYears().length;
              const topPct = total > 1 ? (index() / (total - 1)) * 100 : 0;
              return (
                <span class="scrub-year" style={{ top: `${topPct}%` }}>
                  {year}
                </span>
              );
            }}
          </For>
        </div>
      </div>
    </Show>
  );
}
