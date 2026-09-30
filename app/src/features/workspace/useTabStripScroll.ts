import { useRef, useEffect, useCallback } from 'react';

export interface UseTabStripScrollOptions {
  activeId: string | null | undefined;
  itemsCount: number;
}

export interface UseTabStripScrollResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  scrollToActiveTab: (smooth?: boolean) => void;
}

/**
 * Calculates and applies scroll position to bring a tab into view within
 * the tab strip container without triggering page-level or vertical layout jumps.
 */
export function scrollTabIntoView(
  container: HTMLElement,
  tabElement: HTMLElement,
  smooth = true,
): void {
  const containerRect = container.getBoundingClientRect();
  const tabRect = tabElement.getBoundingClientRect();

  // Tab position relative to the container viewport
  const tabLeftRelativeToContainer = tabRect.left - containerRect.left;
  const tabRightRelativeToContainer = tabRect.right - containerRect.left;

  // Margin so the tab and its border/accent are not flush against the container edge
  const edgePadding = 4;

  if (tabLeftRelativeToContainer < edgePadding) {
    // Tab is cut off or hidden on the left
    const targetScrollLeft =
      container.scrollLeft + tabLeftRelativeToContainer - edgePadding;
    const finalLeft = Math.max(0, targetScrollLeft);
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
        left: finalLeft,
        behavior: smooth ? 'smooth' : 'auto',
      });
    } else {
      container.scrollLeft = finalLeft;
    }
  } else if (tabRightRelativeToContainer > containerRect.width - edgePadding) {
    // Tab is cut off or hidden on the right
    const targetScrollLeft =
      container.scrollLeft +
      (tabRightRelativeToContainer - containerRect.width) +
      edgePadding;
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const finalLeft = Math.min(maxScroll, targetScrollLeft);
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
        left: finalLeft,
        behavior: smooth ? 'smooth' : 'auto',
      });
    } else {
      container.scrollLeft = finalLeft;
    }
  }
}

/**
 * Updates data attributes on the container indicating whether content overflows
 * to the left and/or right, used for understated iTerm-like edge fade masks.
 */
export function updateOverflowAttributes(container: HTMLElement): void {
  const canScrollLeft = container.scrollLeft > 2;
  const maxScroll = container.scrollWidth - container.clientWidth;
  const canScrollRight = container.scrollLeft < maxScroll - 2;

  if (canScrollLeft) {
    container.setAttribute('data-overflow-left', 'true');
  } else {
    container.removeAttribute('data-overflow-left');
  }

  if (canScrollRight) {
    container.setAttribute('data-overflow-right', 'true');
  } else {
    container.removeAttribute('data-overflow-right');
  }
}

/**
 * Hook for centralized iTerm-like tab strip scroll behavior:
 * - Maps mouse wheel to horizontal scrolling when cursor is over the strip
 * - Keeps active tab smoothly in view
 * - Auto-scrolls newly created tabs into view
 * - Updates edge overflow hint attributes
 */
export function useTabStripScroll({
  activeId,
  itemsCount,
}: UseTabStripScrollOptions): UseTabStripScrollResult {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const scrollToActiveTab = useCallback(
    (smooth = true) => {
      const container = containerRef.current;
      if (!container) return;

      const activeEl = container.querySelector(
        '[data-active="true"], .workspace-tab-item--active, .terminal-tab--active, [aria-selected="true"]',
      ) as HTMLElement | null;

      if (activeEl) {
        scrollTabIntoView(container, activeEl, smooth);
        updateOverflowAttributes(container);
      }
    },
    [],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Handle vertical mouse wheel converted to horizontal scroll over tab strip
    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
        if (el.scrollWidth > el.clientWidth) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
          updateOverflowAttributes(el);
        }
      }
    };

    const handleScroll = () => {
      updateOverflowAttributes(el);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('scroll', handleScroll, { passive: true });

    updateOverflowAttributes(el);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateOverflowAttributes(el);
      });
      resizeObserver.observe(el);
    }

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    const requestFrame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: () => void) => setTimeout(cb, 0);
    const cancelFrame =
      typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame
        : (id: number) => clearTimeout(id);

    const frameId = requestFrame(() => {
      scrollToActiveTab(true);
    });

    return () => {
      cancelFrame(frameId as number);
    };
  }, [activeId, itemsCount, scrollToActiveTab]);

  return {
    containerRef,
    scrollToActiveTab,
  };
}
