import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { PaneCaptureCloseImpact } from './runtime';
import './CloseCapturedPaneModal.css';

export interface CloseCapturedPaneModalProps {
  impact: PaneCaptureCloseImpact;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CloseCapturedPaneModal({
  impact,
  onCancel,
  onConfirm,
}: CloseCapturedPaneModalProps) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter') {
      // Prevent accidental confirm unless confirm button itself is focused
      if (document.activeElement !== confirmButtonRef.current) {
        e.preventDefault();
        e.stopPropagation();
        if (document.activeElement === cancelButtonRef.current) {
          onCancel();
        }
      }
    }
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      className="close-captured-pane-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-captured-pane-title"
        aria-describedby="close-captured-pane-description"
        className="close-captured-pane-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="close-captured-pane-title" className="close-captured-pane-title">
          Stop capture and close pane?
        </h3>

        <div
          id="close-captured-pane-description"
          className="close-captured-pane-body"
        >
          {impact.isOnlyActiveCapturedTarget ? (
            <>
              <p className="close-captured-pane-prompt">
                Terminal pane {impact.paneOrdinal} is currently the only captured target.
              </p>
              <p className="close-captured-pane-subtext">Closing it will:</p>
              <ul className="close-captured-pane-list">
                <li>
                  <span className="close-captured-pane-bullet" aria-hidden="true">•</span>
                  <span>Stop Capture</span>
                </li>
                <li>
                  <span className="close-captured-pane-bullet" aria-hidden="true">•</span>
                  <span>Finalize its active transcript block</span>
                </li>
                <li>
                  <span className="close-captured-pane-bullet" aria-hidden="true">•</span>
                  <span>End its terminal session</span>
                </li>
                <li>
                  <span className="close-captured-pane-bullet" aria-hidden="true">•</span>
                  <span>Remove target {impact.paneOrdinal} from this Capture panel</span>
                </li>
              </ul>
            </>
          ) : (
            <>
              <p className="close-captured-pane-prompt">
                Terminal pane {impact.paneOrdinal} is currently being captured.
              </p>
              <p className="close-captured-pane-subtext">Closing it will:</p>
              <ul className="close-captured-pane-list">
                <li>
                  <span className="close-captured-pane-bullet" aria-hidden="true">•</span>
                  <span>Stop Capture for pane {impact.paneOrdinal}</span>
                </li>
                <li>
                  <span className="close-captured-pane-bullet" aria-hidden="true">•</span>
                  <span>Finalize its active transcript block</span>
                </li>
                <li>
                  <span className="close-captured-pane-bullet" aria-hidden="true">•</span>
                  <span>End its terminal session</span>
                </li>
                <li>
                  <span className="close-captured-pane-bullet" aria-hidden="true">•</span>
                  <span>Remove target {impact.paneOrdinal} from this Capture panel</span>
                </li>
              </ul>
              <p className="close-captured-pane-continue">
                Capture in {impact.otherActiveCapturedPaneCount} other pane(s) will continue.
              </p>
            </>
          )}
        </div>

        <div className="close-captured-pane-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="button button-secondary close-captured-pane-cancel-btn"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className="button button-danger close-captured-pane-confirm-btn"
            onClick={onConfirm}
          >
            Stop Capture &amp; Close Pane
          </button>
        </div>
      </div>
    </div>
  );
}
