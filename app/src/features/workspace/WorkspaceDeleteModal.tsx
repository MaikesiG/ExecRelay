import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { LogicalWorkspace } from './types';
import './WorkspaceDeleteModal.css';

export interface WorkspaceDeleteModalProps {
  workspace: LogicalWorkspace;
  onCancel: () => void;
  onConfirm: (workspaceId: string) => void;
}

export function WorkspaceDeleteModal({
  workspace,
  onCancel,
  onConfirm,
}: WorkspaceDeleteModalProps) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      onCancel();
    }
  };

  const tabCount = workspace.terminalTabs.length;
  const paneCount = workspace.panes.length;
  const activeCaptureCount = workspace.panes.filter(
    (p) => p.capture.isListening,
  ).length;

  const rawName = workspace.name.trim();
  const titleText = rawName.toLowerCase().startsWith('workspace')
    ? `Delete ${rawName}?`
    : `Delete "${rawName}"?`;

  return (
    <div
      className="workspace-delete-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-workspace-title"
        aria-describedby="delete-workspace-description"
        className="workspace-delete-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="delete-workspace-title" className="workspace-delete-title">
          {titleText}
        </h3>

        <div
          id="delete-workspace-description"
          className="workspace-delete-body"
        >
          <p className="workspace-delete-subtext">This will close:</p>
          <ul className="workspace-delete-list">
            <li>
              <span className="workspace-delete-bullet" aria-hidden="true">•</span>
              <span>{tabCount} terminal tab{tabCount === 1 ? '' : 's'}</span>
            </li>
            <li>
              <span className="workspace-delete-bullet" aria-hidden="true">•</span>
              <span>{paneCount} terminal pane{paneCount === 1 ? '' : 's'}</span>
            </li>
            <li>
              <span className="workspace-delete-bullet" aria-hidden="true">•</span>
              <span>{activeCaptureCount} active capture{activeCaptureCount === 1 ? '' : 's'}</span>
            </li>
          </ul>
          <p className="workspace-delete-warning">
            Running terminal processes will stop. This action cannot be undone.
          </p>
        </div>

        <div className="workspace-delete-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="button button-secondary workspace-delete-cancel-btn"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button-danger workspace-delete-confirm-btn"
            onClick={() => onConfirm(workspace.id)}
          >
            Delete Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
