import { useState, useRef, useEffect, useCallback } from 'react';
import type { TerminalPane } from './types';
import { getTerminalPaneDisplayTitle } from './types';
import { useProductCapabilities } from '../edition';
import './ChromeTabs.css';

export interface TerminalPaneHeaderProps {
  pane: TerminalPane;
  isPaneActive: boolean;
  isMultiPane: boolean;
  policyStatus?: 'active' | 'off' | 'unsupported';
  onSetActivePane: () => void;
  onClosePane?: () => void;
  onRenamePane?: (customTitle: string | null) => void;
}

export function TerminalPaneHeader({
  pane,
  isPaneActive,
  isMultiPane,
  policyStatus,
  onSetActivePane,
  onClosePane,
  onRenamePane,
}: TerminalPaneHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingValue, setEditingValue] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const actionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const isCancellingRef = useRef(false);

  const capabilities = useProductCapabilities();
  const showPolicyBadge = Boolean(capabilities.governance && policyStatus);
  const displayTitle = getTerminalPaneDisplayTitle(pane);

  const startRename = useCallback(() => {
    isCancellingRef.current = false;
    setEditingValue(pane.customTitle ?? displayTitle);
    setIsEditing(true);
    setIsMenuOpen(false);
  }, [pane.customTitle, displayTitle]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Click outside to close actions menu
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        actionsButtonRef.current &&
        !actionsButtonRef.current.contains(e.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const saveRename = useCallback(() => {
    if (isCancellingRef.current) {
      isCancellingRef.current = false;
      return;
    }
    const trimmed = editingValue.trim();
    onRenamePane?.(trimmed.length > 0 ? trimmed : null);
    setIsEditing(false);
  }, [editingValue, onRenamePane]);

  const cancelRename = useCallback(() => {
    isCancellingRef.current = true;
    setEditingValue(pane.customTitle ?? '');
    setIsEditing(false);
  }, [pane.customTitle]);

  return (
    <div
      className="terminal-pane-header terminal-pane-header--compact"
      data-density="compact"
      data-multi-pane={isMultiPane ? 'true' : 'false'}
      data-active={isPaneActive ? 'true' : 'false'}
      data-accent={isMultiPane ? pane.accentId : undefined}
    >
      {isMultiPane ? (
        <button
          type="button"
          className="terminal-pane-close-button chrome-close-button chrome-close-button--pane close-button"
          aria-label={`Close terminal pane ${pane.stableOrdinal}`}
          title="Close pane"
          onClick={(e) => {
            e.stopPropagation();
            onClosePane?.();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : (
        <span className="terminal-pane-header-spacer" aria-hidden="true" />
      )}

      {isEditing ? (
        <div className="terminal-pane-title terminal-pane-title--editing">
          <input
            ref={inputRef}
            type="text"
            className="terminal-pane-rename-input"
            aria-label={`Rename terminal pane ${pane.stableOrdinal}`}
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                saveRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={saveRename}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : (
        <div
          className="terminal-pane-title"
          title={displayTitle}
          onDoubleClick={(e) => {
            e.stopPropagation();
            startRename();
          }}
        >
          {displayTitle}
        </div>
      )}

      {showPolicyBadge && (
        <span
          className="terminal-pane-policy-badge"
          title={
            policyStatus === 'active'
              ? 'Interactive shell commands are evaluated before submission.'
              : policyStatus === 'off'
                ? 'Interactive shell policy is Off.'
                : 'Native policy interception unavailable for this shell.'
          }
          style={{
            fontSize: '9px',
            padding: '1px 5px',
            borderRadius: '3px',
            background:
              policyStatus === 'active'
                ? 'rgba(74, 222, 128, 0.15)'
                : 'rgba(255, 255, 255, 0.05)',
            color:
              policyStatus === 'active'
                ? '#4ade80'
                : '#8b949e',
            marginRight: '6px',
            cursor: 'default',
            display: 'inline-flex',
            alignItems: 'center',
            height: '16px',
            userSelect: 'none',
          }}
        >
          {policyStatus === 'active'
            ? 'Policy: Active'
            : policyStatus === 'off'
              ? 'Policy: Off'
              : 'Policy: Unsupported shell'}
        </span>
      )}

      <div className="terminal-pane-actions-container" ref={menuRef}>
        <button
          ref={actionsButtonRef}
          type="button"
          className="terminal-pane-actions-button"
          aria-label={`Terminal pane ${pane.stableOrdinal} actions`}
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          title="Pane actions"
          onClick={(e) => {
            e.stopPropagation();
            onSetActivePane();
            setIsMenuOpen((prev) => !prev);
          }}
        >
          <span aria-hidden="true">…</span>
        </button>

        {isMenuOpen && (
          <div className="terminal-pane-actions-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="terminal-pane-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                startRename();
              }}
            >
              Rename pane
            </button>
            {isMultiPane && (
              <button
                type="button"
                role="menuitem"
                className="terminal-pane-menu-item terminal-pane-menu-item--danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMenuOpen(false);
                  onClosePane?.();
                }}
              >
                Close pane
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
