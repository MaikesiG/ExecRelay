import { useState, useRef, useEffect, useCallback } from 'react';
import {
  type TerminalTab,
  type TerminalTabId,
  type TerminalPane,
  type CaptureStatusLight,
  type LogicalWorkspaceId,
  getCaptureStatusLightsForTab,
} from './types';
import type { TranscriptBlock } from '../transcript/types';
import { useTabStripScroll } from './useTabStripScroll';
import './WorkspaceTabs.css';
import './ChromeTabs.css';

export interface WorkspaceTabsProps {
  workspaceId?: LogicalWorkspaceId;
  tabs: ReadonlyArray<TerminalTab>;
  activeTabId: TerminalTabId;
  onSelectTab: (tabId: TerminalTabId) => void;
  onCreateTab: () => void;
  onCloseTab: (tabId: TerminalTabId) => void;
  onRenameTab?: (tabId: TerminalTabId, name: string) => void;
  renameTerminalTab?: (
    workspaceId: string,
    terminalTabId: string,
    name: string,
  ) => void;
  getStatusLights?: (tab: TerminalTab) => CaptureStatusLight[];
  blocks?: ReadonlyArray<TranscriptBlock>;
  panes?: ReadonlyArray<TerminalPane>;
  isCapturePanelOpen?: boolean;
  onToggleCapturePanel?: () => void;
  onOpenShortcutSettings?: () => void;
}

export function WorkspaceTabs({
  workspaceId,
  tabs,
  activeTabId,
  onSelectTab,
  onCreateTab,
  onCloseTab,
  onRenameTab,
  renameTerminalTab,
  getStatusLights,
  blocks,
  panes,
  isCapturePanelOpen,
  onToggleCapturePanel,
  onOpenShortcutSettings,
}: WorkspaceTabsProps) {
  const isLastTab = tabs.length <= 1;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isOpen = isCapturePanelOpen ?? activeTab?.isCapturePanelOpen ?? true;

  const [editingTerminalTabId, setEditingTerminalTabId] =
    useState<TerminalTabId | null>(null);
  const [editingTerminalTabName, setEditingTerminalTabName] =
    useState<string>('');
  const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId);

  // Reset editing state on workspace change during render per React guidelines
  if (workspaceId !== prevWorkspaceId) {
    setPrevWorkspaceId(workspaceId);
    setEditingTerminalTabId(null);
    setEditingTerminalTabName('');
  }

  const isEditingValid =
    editingTerminalTabId !== null &&
    tabs.some((t) => t.id === editingTerminalTabId);
  const activeEditingTabId = isEditingValid ? editingTerminalTabId : null;

  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const isCancellingRef = useRef<boolean>(false);

  useEffect(() => {
    if (activeEditingTabId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [activeEditingTabId]);

  const startRename = useCallback((tab: TerminalTab) => {
    isCancellingRef.current = false;
    setEditingTerminalTabId(tab.id);
    setEditingTerminalTabName(tab.name ?? tab.label);
  }, []);

  const saveRename = useCallback(
    (id: TerminalTabId, value: string) => {
      if (isCancellingRef.current) {
        isCancellingRef.current = false;
        return;
      }
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        const finalName = trimmed.slice(0, 40);
        onRenameTab?.(id, finalName);
        if (renameTerminalTab && workspaceId) {
          renameTerminalTab(workspaceId, id, finalName);
        }
      }
      setEditingTerminalTabId(null);
    },
    [onRenameTab, renameTerminalTab, workspaceId],
  );

  const cancelRename = useCallback(() => {
    isCancellingRef.current = true;
    setEditingTerminalTabId(null);
  }, []);

  const { containerRef } = useTabStripScroll({
    activeId: activeTabId,
    itemsCount: tabs.length,
  });

  return (
    <nav
      className="workspace-tabs terminal-tabs"
      role="tablist"
      aria-label="Terminal tabs"
    >
      <div
        ref={containerRef}
        className="workspace-tabs-list terminal-tabs-list"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isEditing = tab.id === activeEditingTabId;
          const tabDisplayName = tab.name ?? tab.label;
          const statusLights = getStatusLights
            ? getStatusLights(tab)
            : getCaptureStatusLightsForTab(tab, { blocks, panes });

          return (
            <div
              key={tab.id}
              className={`workspace-tab terminal-tab chrome-tab chrome-tab--terminal ${isActive ? 'workspace-tab--active terminal-tab--active chrome-tab--active' : ''} ${isEditing ? 'workspace-tab--editing terminal-tab--editing' : ''}`}
              data-active={isActive ? 'true' : 'false'}
              data-tab-id={tab.id}
            >
              {isEditing ? (
                <div
                  className="workspace-tab-edit-container"
                  role="tab"
                  id={`terminal-tab-${tab.id}`}
                  aria-selected={isActive}
                  aria-controls={`terminal-panel-${tab.id}`}
                >
                  <span className="workspace-tab-status-lights" aria-hidden="true">
                    {statusLights.map((light) => (
                      <span
                        key={light.paneId}
                        className={`workspace-tab-status-dot workspace-tab-status-dot--${light.status}`}
                      />
                    ))}
                  </span>
                  <input
                    ref={renameInputRef}
                    type="text"
                    className="workspace-tab-rename-input"
                    value={editingTerminalTabName}
                    maxLength={40}
                    aria-label={`Rename ${tabDisplayName}`}
                    onChange={(e) => {
                      e.stopPropagation();
                      setEditingTerminalTabName(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        saveRename(tab.id, editingTerminalTabName);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    onBlur={() => {
                      saveRename(tab.id, editingTerminalTabName);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  id={`terminal-tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`terminal-panel-${tab.id}`}
                  className={`workspace-tab-activator ${isActive ? 'workspace-tab-activator--active' : ''}`}
                  onClick={() => onSelectTab(tab.id)}
                  title={tabDisplayName}
                >
                  <span className="workspace-tab-status-lights" aria-hidden="true">
                    {statusLights.map((light) => (
                      <span
                        key={light.paneId}
                        className={`workspace-tab-status-dot workspace-tab-status-dot--${light.status}`}
                      />
                    ))}
                  </span>
                  <span
                    className="workspace-tab-label"
                    title={tabDisplayName}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(tab);
                    }}
                  >
                    {tabDisplayName}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="workspace-tab-close terminal-tab-close chrome-close-button chrome-close-button--tab close-button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                }}
                disabled={isLastTab}
                aria-label={`Close ${tabDisplayName}`}
                title={
                  isLastTab
                    ? 'At least one terminal tab is required'
                    : `Close ${tabDisplayName}`
                }
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="workspace-tab-add"
        onClick={onCreateTab}
        aria-label="New terminal tab"
        title="New terminal tab"
      >
        +
      </button>

      <div className="workspace-tabs-actions">
        {onOpenShortcutSettings && (
          <button
            type="button"
            className="workspace-tab-shortcuts-btn"
            onClick={onOpenShortcutSettings}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="M6 8h.001" />
              <path d="M10 8h.001" />
              <path d="M14 8h.001" />
              <path d="M18 8h.001" />
              <path d="M8 12h.001" />
              <path d="M12 12h.001" />
              <path d="M16 12h.001" />
              <path d="M7 16h10" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="workspace-tab-capture-toggle capture-panel-toggle"
          onClick={onToggleCapturePanel}
          aria-label={isOpen ? 'Collapse monitor pane' : 'Expand monitor pane'}
          title={isOpen ? 'Collapse monitor pane' : 'Expand monitor pane'}
          aria-pressed={isOpen}
          aria-controls={`capture-side-panel-${activeTabId}`}
          data-state={isOpen ? 'open' : 'closed'}
        >
          {isOpen ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M15 3v18" />
              <path d="m8 9 3 3-3 3" />
            </svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M15 3v18" />
              <path d="m11 9-3 3 3 3" />
            </svg>
          )}
        </button>
      </div>
    </nav>
  );
}
