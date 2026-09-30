import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { VerificationCriterion } from './types';
import { validateCriterionInput } from './verificationModel';
import './VerificationModals.css';

export interface VerificationCheckModalProps {
  isOpen: boolean;
  mode: 'add' | 'edit';
  initialCriterion?: VerificationCriterion | null;
  onSave: (data: {
    label: string;
    command: string;
    workingDirectory: string;
    expectedExitCodes: number[];
  }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function VerificationCheckModal({
  isOpen,
  mode,
  initialCriterion,
  onSave,
  onCancel,
  onDelete,
}: VerificationCheckModalProps) {
  if (!isOpen) return null;

  return (
    <VerificationCheckModalDialog
      key={initialCriterion?.id ?? 'new-check'}
      mode={mode}
      initialCriterion={initialCriterion}
      onSave={onSave}
      onCancel={onCancel}
      onDelete={onDelete}
    />
  );
}

function VerificationCheckModalDialog({
  mode,
  initialCriterion,
  onSave,
  onCancel,
  onDelete,
}: Omit<VerificationCheckModalProps, 'isOpen'>) {
  const [label, setLabel] = useState(() => (mode === 'edit' && initialCriterion ? initialCriterion.label : ''));
  const [command, setCommand] = useState(() => (mode === 'edit' && initialCriterion ? initialCriterion.command : ''));
  const [workingDirectory, setWorkingDirectory] = useState(() =>
    mode === 'edit' && initialCriterion
      ? initialCriterion.workingDirectory ?? initialCriterion.cwd ?? '.'
      : '.',
  );
  const [exitCodesStr, setExitCodesStr] = useState(() =>
    mode === 'edit' && initialCriterion ? initialCriterion.expectedExitCodes.join(', ') : '0',
  );
  const [error, setError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const validation = validateCriterionInput({
      label,
      command,
      workingDirectory,
      expectedExitCodes: exitCodesStr,
    });

    if (!validation.valid) {
      setError(validation.error ?? 'Validation failed');
      return;
    }

    onSave({
      label: label.trim(),
      command: command.trim(),
      workingDirectory: validation.workingDirectory,
      expectedExitCodes: validation.exitCodes,
    });
  };

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

  const titleText = mode === 'add' ? 'Add Verification Check' : 'Edit Verification Check';

  return (
    <div
      className="verification-modal-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-check-modal-title"
        className="verification-modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="verification-modal-header">
          <h3 id="verification-check-modal-title" className="verification-modal-title">
            {titleText}
          </h3>
          <button
            type="button"
            className="verification-modal-close-btn"
            onClick={onCancel}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        <div className="verification-modal-body">
          {error && (
            <div className="verification-modal-error" role="alert">
              {error}
            </div>
          )}

          <div className="verification-form-group">
            <label htmlFor="check-name-input" className="verification-form-label">
              Check Name
            </label>
            <input
              id="check-name-input"
              ref={nameInputRef}
              type="text"
              className="verification-form-input"
              placeholder="e.g. Backend tests"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (error) setError(null);
              }}
            />
          </div>

          <div className="verification-form-group">
            <label htmlFor="check-command-input" className="verification-form-label">
              Command (executed in target shell)
            </label>
            <input
              id="check-command-input"
              type="text"
              className="verification-form-input verification-form-input--command"
              placeholder="e.g. cd apps/api && pytest -q"
              value={command}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setCommand(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <span className="verification-form-hint">
              Supports standard shell syntax (subdirectories, &&, flags).
            </span>
          </div>

          <div className="verification-form-group">
            <label htmlFor="check-working-directory-input" className="verification-form-label">
              Working Directory
            </label>
            <input
              id="check-working-directory-input"
              type="text"
              className="verification-form-input verification-form-input--working-directory"
              placeholder="."
              value={workingDirectory}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setWorkingDirectory(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <span className="verification-form-hint">
              Relative to workspace root
            </span>
          </div>

          <div className="verification-form-group">
            <label htmlFor="check-exitcodes-input" className="verification-form-label">
              Expected Exit Codes
            </label>
            <input
              id="check-exitcodes-input"
              type="text"
              className="verification-form-input"
              placeholder="0"
              value={exitCodesStr}
              onChange={(e) => {
                setExitCodesStr(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <span className="verification-form-hint">
              Comma-separated integers that represent a successful check (usually 0).
            </span>
          </div>
        </div>

        <div className="verification-modal-footer">
          {mode === 'edit' && onDelete && (
            <button
              type="button"
              className="verification-btn verification-btn--danger verification-btn--delete-check"
              onClick={onDelete}
            >
              Delete Check
            </button>
          )}
          <div className="verification-modal-footer-right">
            <button
              type="button"
              className="verification-btn verification-btn--secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="verification-btn verification-btn--primary"
              onClick={handleSubmit}
            >
              {mode === 'add' ? 'Add Check' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
