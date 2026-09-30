import type { ReactNode } from 'react';
import './CaptureFeedbackBanner.css';

export type CaptureBannerType = 'success' | 'warning' | 'error' | 'info';

export interface CaptureBannerAction {
  label: string;
  onClick: () => void;
  isDestructive?: boolean;
  className?: string;
  ariaLabel?: string;
  ref?: React.Ref<HTMLButtonElement>;
}

export interface CaptureFeedbackBannerProps {
  type?: CaptureBannerType;
  message?: ReactNode;
  title?: string;
  body?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  onDismiss?: () => void;
  dismissAriaLabel?: string;
  actions?: CaptureBannerAction[] | ReactNode;
  className?: string;
  role?: string;
  ariaLive?: 'polite' | 'assertive' | 'off';
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}

/**
 * CaptureFeedbackBanner
 *
 * Unified local status and feedback banner scoped inside the capture panel.
 * Uses the same visual language as the app's global warning banner system
 * (tinted translucent background, left accent border, typography, semantic icon, dismiss/actions)
 * but compact and lightweight for the narrow side-panel capture area.
 */
export function CaptureFeedbackBanner({
  type = 'success',
  message,
  title,
  body,
  children,
  icon: customIcon,
  onDismiss,
  dismissAriaLabel = 'Dismiss feedback',
  actions,
  className = '',
  role: customRole,
  ariaLive: customAriaLive,
  onKeyDown,
}: CaptureFeedbackBannerProps) {
  const isError = type === 'error';
  const role = customRole || (isError ? 'alert' : actions ? 'region' : 'status');
  const ariaLive =
    customAriaLive || (isError ? 'assertive' : actions ? 'polite' : 'polite');

  const defaultIcon =
    type === 'success' ? '✓' : isError ? '✕' : type === 'warning' ? '⚠' : 'ℹ';
  const icon = customIcon !== undefined ? customIcon : defaultIcon;

  const contentText = message || children;

  return (
    <div
      className={`capture-feedback-banner capture-feedback capture-feedback-banner--${type} capture-feedback--${type} ${className}`.trim()}
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      aria-label={title || (typeof contentText === 'string' ? contentText : undefined)}
      data-testid="capture-feedback-banner"
      data-banner-type={type}
      onKeyDown={onKeyDown}
    >
      <div className="capture-feedback-banner-header">
        <div className="capture-feedback-banner-heading capture-feedback-banner-content">
          <span className="capture-feedback-banner-icon" aria-hidden="true">
            {icon}
          </span>
          <div className="capture-feedback-banner-text">
            {title && (
              <strong className="capture-feedback-banner-title confirm-card-title">{title}</strong>
            )}
            {title && contentText && (
              <span className="capture-feedback-banner-separator">—</span>
            )}
            {contentText && (
              <span className="capture-feedback-banner-message">
                {contentText}
              </span>
            )}
          </div>
        </div>

        {actions && (
          <div className="capture-feedback-banner-actions">
            {Array.isArray(actions)
              ? actions.map((action, idx) => (
                  <button
                    key={idx}
                    ref={action.ref}
                    type="button"
                    className={
                      action.className ||
                      `capture-banner-btn ${
                        action.isDestructive
                          ? 'capture-banner-btn--destructive confirm-btn-destructive'
                          : 'capture-banner-btn--cancel confirm-btn-cancel'
                      }`
                    }
                    onClick={action.onClick}
                    aria-label={action.ariaLabel || action.label}
                  >
                    {action.label}
                  </button>
                ))
              : actions}
          </div>
        )}

        {onDismiss && !actions && (
          <button
            type="button"
            className="capture-feedback-banner-dismiss"
            onClick={onDismiss}
            aria-label={dismissAriaLabel}
            title={dismissAriaLabel}
          >
            ✕
          </button>
        )}
      </div>

      {body && (
        <div className="capture-feedback-banner-body">
          {body}
        </div>
      )}
    </div>
  );
}
