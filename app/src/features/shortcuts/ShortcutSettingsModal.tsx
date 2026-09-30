/**
 * Keyboard Shortcut Settings Modal
 * HARDEN-009
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppCommand, ShortcutBinding } from './types';
import { APP_COMMAND_METADATA, ORDERED_APP_COMMANDS } from './types';
import { ShortcutRegistry, defaultShortcutRegistry } from './shortcutRegistry';
import {
  formatShortcutDisplay,
  formatShortcutAriaLabel,
  normalizeKeyboardEvent,
} from './shortcutNormalization';
import './ShortcutSettingsModal.css';

export interface ShortcutSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  registry?: ShortcutRegistry;
  onRecordingStateChange?: (isRecording: boolean) => void;
}

export function ShortcutSettingsModal({
  isOpen,
  onClose,
  registry = defaultShortcutRegistry,
  onRecordingStateChange,
}: ShortcutSettingsModalProps) {
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  // Subscribe to registry mutations
  useEffect(() => {
    return registry.subscribe(forceUpdate);
  }, [registry, forceUpdate]);

  const [recordingCommand, setRecordingCommand] = useState<AppCommand | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [conflictCandidate, setConflictCandidate] = useState<{
    command: AppCommand;
    binding: ShortcutBinding;
    conflictingCommand: AppCommand;
  } | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const isMac = registry.getIsMac();

  // Notify parent when recording state changes so global dispatch ignores recording keys
  useEffect(() => {
    onRecordingStateChange?.(recordingCommand !== null);
  }, [recordingCommand, onRecordingStateChange]);

  const cancelRecording = useCallback(() => {
    setRecordingCommand(null);
    setValidationError(null);
    setConflictCandidate(null);
  }, []);

  // Handle keydown while recording a shortcut
  useEffect(() => {
    if (!isOpen || !recordingCommand) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape key cancels recording
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelRecording();
        return;
      }

      // Ignore bare modifier keydown events (e.g. user just pressed Meta or Shift)
      if (
        event.key === 'Meta' ||
        event.key === 'Control' ||
        event.key === 'Alt' ||
        event.key === 'Shift'
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const normalized = normalizeKeyboardEvent(event);
      const candidateBinding: ShortcutBinding = {
        key: normalized.key,
        meta: normalized.meta || undefined,
        ctrl: normalized.ctrl || undefined,
        alt: normalized.alt || undefined,
        shift: normalized.shift || undefined,
      };

      // Validate candidate against safety policies
      const validation = registry.validate(candidateBinding, recordingCommand);

      if (!validation.allowed) {
        if (validation.reason === 'duplicate-binding' && validation.conflictingCommand) {
          setConflictCandidate({
            command: recordingCommand,
            binding: candidateBinding,
            conflictingCommand: validation.conflictingCommand,
          });
          setValidationError(validation.message || 'Shortcut already assigned.');
          return;
        }

        setValidationError(validation.message || 'This shortcut cannot be used.');
        setConflictCandidate(null);
        return;
      }

      // Valid shortcut with no conflict: apply immediately
      registry.setOverride(recordingCommand, candidateBinding);
      cancelRecording();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isOpen, recordingCommand, registry, cancelRecording]);

  // Close on Escape when not recording
  useEffect(() => {
    if (!isOpen || recordingCommand !== null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, recordingCommand, onClose]);

  if (!isOpen) return null;

  const effectiveBindings = registry.getEffectiveBindings();

  const handleStartRecording = (cmd: AppCommand) => {
    setValidationError(null);
    setConflictCandidate(null);
    setRecordingCommand(cmd);
  };

  const handleConfirmReplace = () => {
    if (!conflictCandidate) return;
    registry.setOverride(
      conflictCandidate.command,
      conflictCandidate.binding,
      true, // replaceConflicting
    );
    cancelRecording();
  };

  const handleRestoreDefaults = () => {
    registry.resetNavigationOverrides();
    cancelRecording();
  };

  return (
    <div
      className='shortcut-settings-backdrop'
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          cancelRecording();
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        className='shortcut-settings-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='shortcut-settings-title'
      >
        <div className='shortcut-settings-header'>
          <div className='shortcut-settings-title-group'>
            <h2 id='shortcut-settings-title' className='shortcut-settings-title'>
              Keyboard Shortcuts
            </h2>
            <span className='shortcut-settings-subtitle'>
              Stable navigation surfaces ({isMac ? 'macOS defaults' : 'Windows/Linux defaults'})
            </span>
          </div>
          <button
            type='button'
            className='shortcut-settings-close-btn'
            onClick={() => {
              cancelRecording();
              onClose();
            }}
            aria-label='Close keyboard shortcuts'
            title='Close'
          >
            ×
          </button>
        </div>

        <div className='shortcut-settings-content'>
          <div className='shortcut-settings-section'>
            <h3 className='shortcut-settings-section-title'>Surface Navigation</h3>
            <table className='shortcut-table' aria-label='Navigation shortcuts'>
              <thead>
                <tr>
                  <th scope='col' className='col-command'>Surface</th>
                  <th scope='col' className='col-shortcut'>Shortcut</th>
                  <th scope='col' className='col-actions'>Action</th>
                </tr>
              </thead>
              <tbody>
                {ORDERED_APP_COMMANDS.filter((cmd) => registry.isCommandEnabled(cmd)).map((cmd) => {
                  const meta = APP_COMMAND_METADATA[cmd];
                  const binding = effectiveBindings[cmd];
                  const isRecording = recordingCommand === cmd;
                  const displayStr = binding ? formatShortcutDisplay(binding, isMac) : 'Unbound';
                  const ariaLabel = binding ? formatShortcutAriaLabel(binding, isMac) : 'Unbound';

                  return (
                    <tr
                      key={cmd}
                      className={`shortcut-row ${isRecording ? 'shortcut-row--recording' : ''}`}
                    >
                      <td className='col-command'>
                        <div className='command-label-wrapper'>
                          <span className='command-position-badge'>{meta.positionNumber}</span>
                          <span className='command-name'>{meta.label}</span>
                        </div>
                        <span className='command-desc'>{meta.description}</span>
                      </td>
                      <td className='col-shortcut'>
                        {isRecording ? (
                          <div className='recording-badge' aria-live='polite'>
                            <span className='recording-dot' />
                            <span className='recording-prompt'>Press shortcut…</span>
                          </div>
                        ) : (
                          <kbd className='shortcut-kbd' aria-label={ariaLabel}>
                            {displayStr}
                          </kbd>
                        )}
                      </td>
                      <td className='col-actions'>
                        {isRecording ? (
                          <button
                            type='button'
                            className='shortcut-action-btn shortcut-cancel-btn'
                            onClick={cancelRecording}
                            aria-label={`Cancel changing shortcut for ${meta.label}`}
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            type='button'
                            className='shortcut-action-btn shortcut-change-btn'
                            onClick={() => handleStartRecording(cmd)}
                            aria-label={`Change shortcut for ${meta.label}`}
                          >
                            Change
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Inline Validation / Conflict Card */}
          {validationError && (
            <div
              className={`shortcut-feedback-banner ${
                conflictCandidate ? 'shortcut-feedback-banner--conflict' : 'shortcut-feedback-banner--error'
              }`}
              role='alert'
            >
              <div className='shortcut-feedback-text'>
                <strong>{conflictCandidate ? 'Shortcut Conflict:' : 'Unavailable Shortcut:'}</strong>{' '}
                {validationError}
              </div>
              {conflictCandidate && (
                <div className='shortcut-conflict-actions'>
                  <button
                    type='button'
                    className='shortcut-action-btn shortcut-replace-btn'
                    onClick={handleConfirmReplace}
                  >
                    Replace
                  </button>
                  <button
                    type='button'
                    className='shortcut-action-btn shortcut-cancel-btn'
                    onClick={cancelRecording}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className='shortcut-settings-footer'>
          <div className='shortcut-settings-footer-left'>
            <span className='shortcut-hint-text'>
              Tip: Press <kbd className='mini-kbd'>Esc</kbd> while recording to cancel.
            </span>
          </div>
          <div className='shortcut-settings-footer-right'>
            <button
              type='button'
              className='shortcut-action-btn shortcut-restore-defaults-btn'
              onClick={handleRestoreDefaults}
              title='Reset all shortcuts to factory platform defaults'
            >
              Restore defaults
            </button>
            <button
              type='button'
              className='shortcut-action-btn shortcut-done-btn'
              onClick={() => {
                cancelRecording();
                onClose();
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
