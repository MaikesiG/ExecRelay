/**
 * ActiveMonitorView Component
 * HARDEN-016: Primary scroll owner for active Monitor content.
 * Sibling to MonitorFooter inside MonitorPane.
 */

import { memo, type ReactNode } from 'react';
import type { MonitorView } from '../shortcuts/types';
import './ActiveMonitorView.css';

export interface ActiveMonitorViewProps {
  activeView: MonitorView;
  children: ReactNode;
  className?: string;
}

export const ActiveMonitorView = memo(function ActiveMonitorView({
  activeView,
  children,
  className = '',
}: ActiveMonitorViewProps) {
  return (
    <div
      className={`active-monitor-view ${className}`.trim()}
      data-testid="active-monitor-view"
      data-active-view={activeView}
      role="region"
      aria-label={`Active monitor surface: ${activeView}`}
    >
      {children}
    </div>
  );
});
