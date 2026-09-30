import type { CaptureWarning } from './types';
import { isCaptureWarningCode } from './types';
import './CaptureWarningBanner.css';

export interface CaptureWarningBannerProps {
  workspaceId: string;
  terminalTabId: string;
  paneId: string;
  captureSessionId?: string;
  warning: CaptureWarning | null;
  onRetryCapture?: () => void;
  onDismiss: (
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
    captureSessionId: string,
    warningId: string,
  ) => void;
}

export function CaptureWarningBanner({
  workspaceId,
  terminalTabId,
  paneId,
  captureSessionId,
  warning,
  onRetryCapture,
  onDismiss,
}: CaptureWarningBannerProps) {
  // Defensive guard: Reject non-CaptureWarning objects or pane-shortcut messages
  if (
    warning == null ||
    typeof warning !== 'object' ||
    !warning.captureSessionId ||
    !isCaptureWarningCode(warning.code) ||
    warning.message === 'Maximum of 6 panes per terminal tab' ||
    warning.message === 'Maximum of 2 panes per terminal tab' ||
    warning.message === 'Cannot close the last pane'
  ) {
    return null;
  }

  // If warning belongs to a stale / non-current Capture session, render nothing
  if (captureSessionId && warning.captureSessionId !== captureSessionId) {
    return null;
  }

  const isError = warning.severity === 'error';
  const role = isError ? 'alert' : 'status';
  const ariaLive = isError ? 'assertive' : 'polite';

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss(
      workspaceId,
      terminalTabId,
      paneId,
      warning.captureSessionId,
      warning.id,
    );
  };

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRetryCapture?.();
  };

  return (
    <div
      className={`capture-warning-banner capture-warning-banner--${warning.severity}`}
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="capture-warning-banner-main">
        <span className="capture-warning-banner-icon" aria-hidden="true">
          {isError ? '✕' : '⚠'}
        </span>
        <div className="capture-warning-banner-body">
          {warning.title && (
            <span className="capture-warning-banner-title">
              {warning.title}
            </span>
          )}
          <span className="capture-warning-banner-message">
            {warning.message}
          </span>
        </div>
      </div>

      <div className="capture-warning-banner-actions">
        {warning.recoverable && onRetryCapture && (
          <button
            type="button"
            className="capture-warning-banner-btn capture-warning-banner-btn--retry"
            onClick={handleRetry}
            aria-label={`Retry capture for pane ${paneId}`}
            title="Retry capture"
          >
            Retry Capture
          </button>
        )}
        <button
          type="button"
          className="capture-warning-banner-btn capture-warning-banner-btn--dismiss"
          onClick={handleDismiss}
          aria-label={`Dismiss capture warning: ${warning.title || warning.message}`}
          title="Dismiss warning"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
