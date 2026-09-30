import { useState, useRef, type PointerEvent, type KeyboardEvent } from 'react';
import type { PaneLayoutDirection } from './types';
import './PaneDivider.css';

export interface PaneDividerProps {
  direction: PaneLayoutDirection;
  splitRatio: number;
  onResize: (newRatio: number) => void;
  onResizeEnd?: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function PaneDivider({
  direction,
  splitRatio,
  onResize,
  onResizeEnd,
  containerRef,
}: PaneDividerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    isDraggingRef.current = true;
    setIsDragging(true);
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (!isDraggingRef.current) return;
      moveEvent.preventDefault();

      let ratio = 0.5;
      if (direction === 'horizontal') {
        if (rect.width > 0) {
          ratio = (moveEvent.clientX - rect.left) / rect.width;
        }
      } else {
        if (rect.height > 0) {
          ratio = (moveEvent.clientY - rect.top) / rect.height;
        }
      }

      const clamped = Math.max(0.2, Math.min(0.8, ratio));
      onResize(clamped);
    };

    const handlePointerUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResizeEnd?.();
    };

    document.body.style.cursor =
      direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (direction === 'horizontal') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onResize(Math.max(0.2, splitRatio - 0.05));
        onResizeEnd?.();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onResize(Math.min(0.8, splitRatio + 0.05));
        onResizeEnd?.();
      }
    } else {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onResize(Math.max(0.2, splitRatio - 0.05));
        onResizeEnd?.();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onResize(Math.min(0.8, splitRatio + 0.05));
        onResizeEnd?.();
      }
    }
  };

  return (
    <div
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-label="Resize terminal panes"
      aria-valuenow={Math.round(splitRatio * 100)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
      className={`pane-divider pane-divider--${direction}`}
      data-dragging={isDragging ? 'true' : undefined}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}
