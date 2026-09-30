import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { VerificationContract } from './types';
import './VerificationModals.css';

export interface VerificationProfileModalProps {
  isOpen: boolean;
  contract: VerificationContract;
  canDelete: boolean;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function VerificationProfileModal({
  isOpen,
  contract,
  canDelete,
  onRename,
  onDelete,
  onCancel,
}: VerificationProfileModalProps) {
  if (!isOpen) return null;

  return (
    <VerificationProfileModalDialog
      key={contract.id}
      contract={contract}
      canDelete={canDelete}
      onRename={onRename}
      onDelete={onDelete}
      onCancel={onCancel}
    />
  );
}

function VerificationProfileModalDialog({
  contract,
  canDelete,
  onRename,
  onDelete,
  onCancel,
}: Omit<VerificationProfileModalProps, 'isOpen'>) {
  const [name, setName] = useState(contract.name);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Profile name cannot be empty');
      return;
    }
    onRename(trimmed);
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
        aria-labelledby="verification-profile-modal-title"
        className="verification-modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="verification-modal-header">
          <h3 id="verification-profile-modal-title" className="verification-modal-title">
            Edit Verification Profile
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
            <label htmlFor="profile-name-input" className="verification-form-label">
              Profile Name
            </label>
            <input
              id="profile-name-input"
              ref={inputRef}
              type="text"
              className="verification-form-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
          </div>

          <div className="verification-profile-meta">
            <span>Contains {contract.criteria.length} check{contract.criteria.length === 1 ? '' : 's'}.</span>
          </div>

          {isConfirmingDelete && (
            <div className="verification-delete-warning-box">
              <p>
                Delete profile &quot;{contract.name}&quot;? Existing historical run records will not be deleted.
              </p>
              <div className="verification-delete-warning-actions">
                <button
                  type="button"
                  className="verification-btn verification-btn--danger"
                  onClick={onDelete}
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  className="verification-btn verification-btn--secondary"
                  onClick={() => setIsConfirmingDelete(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="verification-modal-footer">
          {!isConfirmingDelete && (
            <button
              type="button"
              className="verification-btn verification-btn--danger"
              disabled={!canDelete}
              title={canDelete ? 'Delete this profile' : 'Cannot delete the only profile'}
              onClick={() => setIsConfirmingDelete(true)}
            >
              Delete Profile
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
              onClick={handleSave}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
