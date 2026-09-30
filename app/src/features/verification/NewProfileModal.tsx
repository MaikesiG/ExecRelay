import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import './VerificationModals.css';

export interface NewProfileModalProps {
  isOpen: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function NewProfileModal({
  isOpen,
  onConfirm,
  onCancel,
}: NewProfileModalProps) {
  if (!isOpen) return null;

  return (
    <NewProfileModalDialog
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function NewProfileModalDialog({
  onConfirm,
  onCancel,
}: Omit<NewProfileModalProps, 'isOpen'>) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Profile name cannot be empty');
      return;
    }
    onConfirm(trimmed);
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
        aria-labelledby="new-profile-modal-title"
        className="verification-modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="verification-modal-header">
          <h3 id="new-profile-modal-title" className="verification-modal-title">
            New Verification Profile
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
            <label htmlFor="new-profile-name-input" className="verification-form-label">
              Profile Name
            </label>
            <input
              id="new-profile-name-input"
              ref={inputRef}
              type="text"
              className="verification-form-input"
              placeholder="e.g. Backend, Release, Smoke Tests"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
          </div>
        </div>

        <div className="verification-modal-footer">
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
              onClick={handleCreate}
            >
              Create Profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
