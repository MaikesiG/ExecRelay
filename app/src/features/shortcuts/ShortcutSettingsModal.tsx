/**
 * Keyboard Shortcut Settings Modal
 * SHORTCUT-002: Cross-Platform Navigation & Terminal Pane Shortcuts Configuration
 *
 * Implements a strict, safe, draft-based shortcut configuration workflow:
 * 1. Open modal -> snapshots effective configuration into draftBindings for current platform
 * 2. Editing modifies draft only (zero live mutation on keystrokes)
 * 3. Real-time validation & conflict detection across all commands on current platform
 * 4. Save -> validates all bindings atomically, applies overrides to current platform, persists to storage
 * 5. Cancel -> discards draft completely (zero persistence or runtime changes)
 * 6. Reset to Defaults -> loads canonical defaults for current platform into draft (requires Save to apply)
 * 7. Escape cancels active recording first; if not recording, closes modal as Cancel
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppCommand, ShortcutBinding } from './types';
import {
  ALL_CONFIGURABLE_COMMANDS,
  APP_COMMAND_METADATA,
  ORDERED_NAVIGATION_COMMANDS,
  ORDERED_TERMINAL_COMMANDS,
} from './types';
import { ShortcutRegistry, defaultShortcutRegistry } from './shortcutRegistry';
import { getDefaultShortcuts } from './defaultShortcuts';
import {
  formatShortcutDisplay,
  formatShortcutAriaLabel,
  normalizeKeyboardEvent,
  areBindingsEqual,
} from './shortcutNormalization';
import { validateShortcutBinding } from './reservedShortcuts';
import './ShortcutSettingsModal.css';

export interface ShortcutSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  registry?: ShortcutRegistry;
  onRecordingStateChange?: (isRecording: boolean) => void;
}

export function ShortcutSettingsModal(props: ShortcutSettingsModalProps) {
  if (!props.isOpen) return null;
  return <ShortcutSettingsModalContent {...props} />;
}

function ShortcutSettingsModalContent({
  onClose,
  registry = defaultShortcutRegistry,
  onRecordingStateChange,
}: ShortcutSettingsModalProps) {
  const platform = registry.getPlatform();
  const platformName =
    platform === 'macos'
      ? 'macOS'
      : platform === 'windows'
        ? 'Windows'
        : 'Linux';

  // Draft state representing working copy of bindings initialized fresh on mount
  const [draftBindings, setDraftBindings] = useState<Record<AppCommand, ShortcutBinding>>(() =>
    registry.getEffectiveBindings(),
  );
  const [recordingCommand, setRecordingCommand] = useState<AppCommand | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [conflictCommand, setConflictCommand] = useState<AppCommand | null>(null);
  const [, setIsDirty] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);

  // Notify parent when recording state changes so global dispatch ignores recording keys
  useEffect(() => {
    onRecordingStateChange?.(recordingCommand !== null);
  }, [recordingCommand, onRecordingStateChange]);

  const cancelRecording = useCallback(() => {
    setRecordingCommand(null);
    setValidationError(null);
    setConflictCommand(null);
  }, []);

  const handleCancelModal = useCallback(() => {
    cancelRecording();
    setIsDirty(false);
    onClose();
  }, [cancelRecording, onClose]);

  const handleResetToDefaults = useCallback(() => {
    const defaults = getDefaultShortcuts(platform);
    setDraftBindings(defaults);
    setValidationError(null);
    setConflictCommand(null);
    cancelRecording();
    setIsDirty(true);
  }, [cancelRecording, platform]);

  const handleSaveModal = useCallback(() => {
    if (recordingCommand !== null) return;

    const enabledCommands = ALL_CONFIGURABLE_COMMANDS.filter((cmd) => registry.isCommandEnabled(cmd));

    // Check for pairwise conflicts in draftBindings across all enabled commands
    for (let i = 0; i < enabledCommands.length; i++) {
      for (let j = i + 1; j < enabledCommands.length; j++) {
        const cmdA = enabledCommands[i];
        const cmdB = enabledCommands[j];
        if (areBindingsEqual(draftBindings[cmdA], draftBindings[cmdB])) {
          setValidationError(
            `Conflict: ${APP_COMMAND_METADATA[cmdA].label} and ${APP_COMMAND_METADATA[cmdB].label} share the same shortcut.`,
          );
          setConflictCommand(cmdB);
          return;
        }
      }
    }

    // Validate each binding in draftBindings against safety policies
    for (const cmd of enabledCommands) {
      const binding = draftBindings[cmd];
      const val = validateShortcutBinding(binding, {
        platform,
        targetCommand: cmd,
        existingBindings: draftBindings,
      });
      if (!val.allowed) {
        setValidationError(val.message ?? `Invalid shortcut for ${APP_COMMAND_METADATA[cmd].label}`);
        return;
      }
    }

    // Apply draft to registry atomically for the active platform
    const defaults = getDefaultShortcuts(platform);
    const overridesToSave: Partial<Record<AppCommand, ShortcutBinding>> = {};
    for (const cmd of enabledCommands) {
      const binding = draftBindings[cmd];
      if (!areBindingsEqual(binding, defaults[cmd])) {
        overridesToSave[cmd] = { ...binding };
      }
    }

    const result = registry.applyOverrides(overridesToSave);
    if (!result.success) {
      setValidationError(result.errors?.[0] ?? 'Failed to apply shortcut settings.');
      return;
    }

    setIsDirty(false);
    onClose();
  }, [draftBindings, onClose, platform, recordingCommand, registry]);

  // Handle keydown while recording a shortcut
  useEffect(() => {
    if (!recordingCommand) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape key cancels recording only
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

      // Validate candidate against safety policies and current draft assignments on active platform
      const validation = validateShortcutBinding(candidateBinding, {
        platform,
        targetCommand: recordingCommand,
        existingBindings: draftBindings,
      });

      if (!validation.allowed) {
        if (validation.reason === 'duplicate-binding' && validation.conflictingCommand) {
          const conflictingLabel =
            APP_COMMAND_METADATA[validation.conflictingCommand]?.label ??
            validation.conflictingCommand;
          setConflictCommand(validation.conflictingCommand);
          setValidationError(`Shortcut already assigned to ${conflictingLabel}.`);
          return;
        }

        setValidationError(validation.message || 'This shortcut cannot be used.');
        setConflictCommand(null);
        return;
      }

      // Valid shortcut with no conflict: apply to draft
      setDraftBindings((prev) => ({
        ...prev,
        [recordingCommand]: candidateBinding,
      }));
      setIsDirty(true);
      setValidationError(null);
      setConflictCommand(null);
      setRecordingCommand(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [recordingCommand, platform, draftBindings, cancelRecording]);

  // Close on Escape when not recording
  useEffect(() => {
    if (recordingCommand !== null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancelModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [recordingCommand, handleCancelModal]);

  const handleStartRecording = (cmd: AppCommand) => {
    setValidationError(null);
    setConflictCommand(null);
    setRecordingCommand(cmd);
  };

  const hasConflictOrError = validationError !== null;

  const renderCommandRow = (cmd: AppCommand) => {
    const meta = APP_COMMAND_METADATA[cmd];
    const binding = draftBindings[cmd];
    const isRecording = recordingCommand === cmd;
    const displayStr = binding ? formatShortcutDisplay(binding, platform) : 'Unbound';
    const ariaLabel = binding ? formatShortcutAriaLabel(binding, platform) : 'Unbound';

    return (
      <tr
        key={cmd}
        className={`shortcut-row ${isRecording ? 'shortcut-row--recording' : ''}`}
      >
        <td className='col-command'>
          <div className='command-label-wrapper'>
            {meta.positionNumber !== undefined && (
              <span className='command-position-badge'>{meta.positionNumber}</span>
            )}
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
  };

  return (
    <div
      className='shortcut-settings-backdrop'
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleCancelModal();
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
              Shortcuts for {platformName}
            </span>
          </div>
          <button
            type='button'
            className='shortcut-settings-close-btn'
            onClick={handleCancelModal}
            aria-label='Close keyboard shortcuts'
            title='Close'
          >
            ×
          </button>
        </div>

        <div className='shortcut-settings-content'>
          {/* Section 1: Workspace, terminal-tab, and surface navigation */}
          <div className='shortcut-settings-section'>
            <h3 className='shortcut-settings-section-title'>Workspace &amp; Tab Navigation</h3>
            <table className='shortcut-table' aria-label='Navigation shortcuts'>
              <thead>
                <tr>
                  <th scope='col' className='col-command'>Surface</th>
                  <th scope='col' className='col-shortcut'>Shortcut</th>
                  <th scope='col' className='col-actions'>Action</th>
                </tr>
              </thead>
              <tbody>
                {ORDERED_NAVIGATION_COMMANDS.filter((cmd) => registry.isCommandEnabled(cmd)).map(
                  renderCommandRow,
                )}
              </tbody>
            </table>
          </div>

          {/* Section 2: Terminal Panes */}
          <div className='shortcut-settings-section'>
            <h3 className='shortcut-settings-section-title'>Terminal Panes</h3>
            <table className='shortcut-table' aria-label='Terminal pane shortcuts'>
              <thead>
                <tr>
                  <th scope='col' className='col-command'>Action</th>
                  <th scope='col' className='col-shortcut'>Shortcut</th>
                  <th scope='col' className='col-actions'>Action</th>
                </tr>
              </thead>
              <tbody>
                {ORDERED_TERMINAL_COMMANDS.filter((cmd) => registry.isCommandEnabled(cmd)).map(
                  renderCommandRow,
                )}
              </tbody>
            </table>
          </div>

          {/* Inline Validation / Conflict Card */}
          {validationError && (
            <div
              className={`shortcut-feedback-banner ${
                conflictCommand ? 'shortcut-feedback-banner--conflict' : 'shortcut-feedback-banner--error'
              }`}
              role='alert'
            >
              <div className='shortcut-feedback-text'>
                <strong>{conflictCommand ? 'Shortcut Conflict:' : 'Unavailable Shortcut:'}</strong>{' '}
                {validationError}
              </div>
            </div>
          )}
        </div>

        <div className='shortcut-settings-footer'>
          <div className='shortcut-settings-footer-left'>
            <button
              type='button'
              className='shortcut-action-btn shortcut-restore-defaults-btn'
              onClick={handleResetToDefaults}
              title={`Reset shortcuts to ${platformName} defaults (requires Save to apply)`}
            >
              Reset to defaults
            </button>
          </div>
          <div className='shortcut-settings-footer-right'>
            <button
              type='button'
              className='shortcut-action-btn shortcut-cancel-modal-btn'
              onClick={handleCancelModal}
              title='Cancel and discard unsaved shortcut changes'
            >
              Cancel
            </button>
            <button
              type='button'
              className='shortcut-action-btn shortcut-save-btn'
              onClick={handleSaveModal}
              disabled={recordingCommand !== null || hasConflictOrError}
              title={
                hasConflictOrError
                  ? 'Resolve conflicts before saving'
                  : recordingCommand !== null
                    ? 'Finish recording before saving'
                    : 'Save shortcut changes'
              }
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
