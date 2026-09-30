/**
 * Monitor Global Feedback Region
 * HARDEN-010
 *
 * Renders operational action feedback visible across all Monitor views.
 */

import { memo } from 'react';
import type { MonitorFeedback, MonitorFeedbackLevel } from './types';
import './MonitorGlobalFeedbackRegion.css';

export interface MonitorGlobalFeedbackRegionProps {
  items: ReadonlyArray<MonitorFeedback>;
  onDismiss: (id: string) => void;
}

const LEVEL_ICONS: Record<MonitorFeedbackLevel, string> = {
  success: '✓',
  info: 'ℹ',
  warning: '⚠',
  error: '✕',
};

export const MonitorGlobalFeedbackRegion = memo(function MonitorGlobalFeedbackRegion({
  items,
  onDismiss,
}: MonitorGlobalFeedbackRegionProps) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div
      className='monitor-global-feedback-region'
      role='region'
      aria-label='Monitor notifications'
      aria-live='polite'
      aria-atomic='false'
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={`monitor-feedback-card monitor-feedback-card--${item.level}`}
          data-source={item.source}
          data-level={item.level}
        >
          <div className='monitor-feedback-left'>
            <span
              className={`monitor-feedback-icon monitor-feedback-icon--${item.level}`}
              aria-hidden='true'
            >
              {LEVEL_ICONS[item.level] ?? 'ℹ'}
            </span>
            <div className='monitor-feedback-body'>
              <span className='monitor-feedback-title'>{item.title}</span>
              {item.message && (
                <span className='monitor-feedback-message'>{item.message}</span>
              )}
            </div>
          </div>

          {item.dismissible !== false && (
            <button
              type='button'
              className='monitor-feedback-dismiss-btn'
              onClick={() => onDismiss(item.id)}
              aria-label={`Dismiss notification: ${item.title}`}
              title='Dismiss'
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
});
