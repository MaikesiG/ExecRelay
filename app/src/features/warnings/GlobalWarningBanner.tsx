import type { GlobalWarning } from './types';
import { filterVisibleGlobalWarnings } from './state';
import './GlobalWarningBanner.css';

export interface GlobalWarningBannerProps {
  warnings: GlobalWarning[];
  activeWorkspaceId: string | null;
  onDismiss: (warningId: string) => void;
}

export function GlobalWarningBanner({
  warnings,
  activeWorkspaceId,
  onDismiss,
}: GlobalWarningBannerProps) {
  const visibleWarnings = filterVisibleGlobalWarnings(
    warnings,
    activeWorkspaceId,
  );

  if (visibleWarnings.length === 0) {
    return null;
  }

  return (
    <div
      className="global-warning-banner-stack"
      aria-label="System warning notifications"
    >
      {visibleWarnings.map((warning) => {
        const isError = warning.severity === 'error';
        const role = isError ? 'alert' : 'status';
        const ariaLive = isError ? 'assertive' : 'polite';

        return (
          <div
            key={warning.id}
            className={`global-warning-banner global-warning-banner--${warning.severity}`}
            role={role}
            aria-live={ariaLive}
            aria-atomic="true"
          >
            <div className="global-warning-banner-content">
              <span className="global-warning-banner-icon" aria-hidden="true">
                {isError ? '✕' : '⚠'}
              </span>
              <div className="global-warning-banner-text">
                <span className="global-warning-banner-title">
                  {warning.title}
                </span>
                {warning.title && warning.message && (
                  <span className="global-warning-banner-separator">—</span>
                )}
                <span className="global-warning-banner-message">
                  {warning.message}
                </span>
              </div>
            </div>

            {warning.dismissible && (
              <button
                type="button"
                className="global-warning-banner-dismiss"
                onClick={() => onDismiss(warning.id)}
                aria-label={`Dismiss warning: ${warning.title || warning.message}`}
                title="Dismiss warning"
              >
                Dismiss
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
