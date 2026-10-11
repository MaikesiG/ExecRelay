import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { LogicalWorkspace } from './types';
import './WorkspaceResetModal.css';

export interface WorkspaceResetModalProps {
  workspace: LogicalWorkspace;
  onCancel: () => void;
  onConfirm: (workspaceId: string) => void;
}

export function WorkspaceResetModal({
  workspace,
  onCancel,
  onConfirm,
}: WorkspaceResetModalProps) {
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

  const rawName = workspace.name.trim();
  const titleText = rawName.toLowerCase().startsWith('workspace')
    ? `Reset ${rawName}?`
    : `Reset "${rawName}"?`;

  return (
    <div
      className="workspace-reset-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-workspace-title"
        aria-describedby="reset-workspace-description"
        className="workspace-reset-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="reset-workspace-title" className="workspace-reset-title">
          {titleText}
        </h3>

        <div
          id="reset-workspace-description"
          className="workspace-reset-body"
        >
          <p className="workspace-reset-subtext">
            This clears this workspace's Terminal screen history, Capture history,
            Changes evidence, and completed Verification results.
          </p>
          <p className="workspace-reset-preserved-text">
            Your files, Git changes, shell sessions, working directories, and Verification
            configuration will not be changed.
          </p>
        </div>

        <div className="workspace-reset-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="button button-secondary workspace-reset-cancel-btn"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button-danger workspace-reset-confirm-btn"
            onClick={() => onConfirm(workspace.id)}
          >
            Reset Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
