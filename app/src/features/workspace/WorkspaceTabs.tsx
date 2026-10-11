import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type CSSProperties,
} from 'react';
import {
  type TerminalTab,
  type TerminalTabId,
  type TerminalPane,
  type CaptureStatusLight,
  type LogicalWorkspaceId,
} from './types';
import {
  type TerminalTabDropPlacement,
  resolveTabDropTarget,
  TAB_DRAG_THRESHOLD_PX,
} from './workspaceReorder';
import type { TranscriptBlock } from '../transcript/types';
import { useTabStripScroll } from './useTabStripScroll';
import {
  getTerminalTabBaseName,
  getTerminalTabColorCssValue,
  getTerminalTabColorKey,
  getTerminalTabDisplayName,
  normalizeTerminalTabBaseName,
} from './terminalTabName';
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
  onReorderTab?: (
    draggedTabId: TerminalTabId,
    targetTabId: TerminalTabId,
    placement: TerminalTabDropPlacement,
  ) => void;
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
  onResetWorkspace?: () => void;
  isResetBlocked?: boolean;
  resetBlockReason?: string | null;
}

export function WorkspaceTabs({
  workspaceId,
  tabs,
  activeTabId,
  onSelectTab,
  onCreateTab,
  onCloseTab,
  onRenameTab,
  onReorderTab,
  renameTerminalTab,
  isCapturePanelOpen,
  onToggleCapturePanel,
  onOpenShortcutSettings,
  onResetWorkspace,
  isResetBlocked,
  resetBlockReason,
}: WorkspaceTabsProps) {
  const isLastTab = tabs.length <= 1;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isOpen = isCapturePanelOpen ?? activeTab?.isCapturePanelOpen ?? true;

  const [editingTerminalTabId, setEditingTerminalTabId] =
    useState<TerminalTabId | null>(null);
  const [editingTerminalTabName, setEditingTerminalTabName] =
    useState<string>('');
  const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId);

  const [draggingTabId, setDraggingTabId] =
    useState<TerminalTabId | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    tabId: TerminalTabId;
    placement: TerminalTabDropPlacement;
  } | null>(null);
  const dropTargetRef = useRef<{
    tabId: TerminalTabId;
    placement: TerminalTabDropPlacement;
  } | null>(null);

  const dragGestureRef = useRef<{
    tabId: TerminalTabId;
    startX: number;
    startY: number;
    pointerId: number;
    hasMovedPastThreshold: boolean;
  } | null>(null);

  const suppressClickRef = useRef<boolean>(false);

  // Reset editing state on workspace change during render per React guidelines
  if (workspaceId !== prevWorkspaceId) {
    setPrevWorkspaceId(workspaceId);
    setEditingTerminalTabId(null);
    setEditingTerminalTabName('');
    setDraggingTabId(null);
    setDropTarget(null);
  }

  useEffect(() => {
    dragGestureRef.current = null;
    dropTargetRef.current = null;
  }, [workspaceId]);

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

  const activePointerListenersRef = useRef<{
    pointerId: number;
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
    onCancel: (e: PointerEvent) => void;
  } | null>(null);

  const removeWindowPointerListeners = useCallback(() => {
    if (activePointerListenersRef.current && typeof window !== 'undefined') {
      window.removeEventListener(
        'pointermove',
        activePointerListenersRef.current.onMove,
        true,
      );
      window.removeEventListener(
        'pointerup',
        activePointerListenersRef.current.onUp,
        true,
      );
      window.removeEventListener(
        'pointercancel',
        activePointerListenersRef.current.onCancel,
        true,
      );
      activePointerListenersRef.current = null;
    }
  }, []);

  const clearDragState = useCallback(() => {
    removeWindowPointerListeners();
    dragGestureRef.current = null;
    dropTargetRef.current = null;
    setDraggingTabId(null);
    setDropTarget(null);
  }, [removeWindowPointerListeners]);

  useEffect(() => {
    return () => {
      removeWindowPointerListeners();
    };
  }, [removeWindowPointerListeners]);

  const startRename = useCallback(
    (tab: TerminalTab) => {
      clearDragState();
      isCancellingRef.current = false;
      setEditingTerminalTabId(tab.id);
      setEditingTerminalTabName(getTerminalTabBaseName(tab));
    },
    [clearDragState],
  );

  const saveRename = useCallback(
    (id: TerminalTabId, value: string) => {
      if (isCancellingRef.current) {
        isCancellingRef.current = false;
        return;
      }
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        const finalName = normalizeTerminalTabBaseName(trimmed);
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

  // Window-level escape and blur handlers to safely abort any in-flight drag
  useEffect(() => {
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragGestureRef.current) {
        clearDragState();
      }
    };
    const onWindowBlur = () => {
      if (dragGestureRef.current) {
        clearDragState();
      }
    };
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [clearDragState]);

  const { containerRef } = useTabStripScroll({
    activeId: activeTabId,
    itemsCount: tabs.length,
  });

  const processPointerMove = useCallback(
    (
      clientX: number,
      clientY: number,
      pointerId: number,
      originalEvent?: Event,
    ) => {
      const gesture = dragGestureRef.current;
      if (!gesture || gesture.pointerId !== pointerId) return;

      const deltaX = clientX - gesture.startX;
      const deltaY = clientY - gesture.startY;
      const distance = Math.hypot(deltaX, deltaY);

      if (!gesture.hasMovedPastThreshold) {
        if (distance >= TAB_DRAG_THRESHOLD_PX) {
          gesture.hasMovedPastThreshold = true;
          setDraggingTabId(gesture.tabId);
        } else {
          return;
        }
      }

      if (originalEvent && typeof originalEvent.preventDefault === 'function') {
        originalEvent.preventDefault();
      }

      const container = containerRef.current;
      if (!container) return;

      const tabElements = Array.from(
        container.querySelectorAll<HTMLElement>('.terminal-tab[data-tab-id]'),
      ).map((el) => ({
        tabId: el.getAttribute('data-tab-id') as TerminalTabId,
        rect: el.getBoundingClientRect(),
      }));

      const nextDropTarget = resolveTabDropTarget(
        tabElements,
        clientX,
        gesture.tabId,
      );

      dropTargetRef.current = nextDropTarget;
      setDropTarget(nextDropTarget);
    },
    [containerRef],
  );

  const processPointerUp = useCallback(
    (
      clientX: number,
      _clientY: number,
      pointerId: number,
      targetTabId?: TerminalTabId,
    ) => {
      const gesture = dragGestureRef.current;
      if (!gesture || gesture.pointerId !== pointerId) return;

      const wasDragging = gesture.hasMovedPastThreshold;
      const draggedId = gesture.tabId;

      let target = dropTargetRef.current;
      const container = containerRef.current;
      if (wasDragging && container) {
        const tabElements = Array.from(
          container.querySelectorAll<HTMLElement>('.terminal-tab[data-tab-id]'),
        ).map((el) => ({
          tabId: el.getAttribute('data-tab-id') as TerminalTabId,
          rect: el.getBoundingClientRect(),
        }));
        const finalTarget = resolveTabDropTarget(
          tabElements,
          clientX,
          draggedId,
        );
        if (finalTarget) {
          target = finalTarget;
        }
      }

      clearDragState();

      if (wasDragging) {
        suppressClickRef.current = true;
        if (typeof window !== 'undefined') {
          const suppressWindowClick = (clickEvt: MouseEvent) => {
            clickEvt.stopPropagation();
            clickEvt.preventDefault();
            window.removeEventListener('click', suppressWindowClick, true);
          };
          window.addEventListener('click', suppressWindowClick, true);
          setTimeout(() => {
            window.removeEventListener('click', suppressWindowClick, true);
          }, 150);
        }

        if (target && target.tabId && target.tabId !== draggedId) {
          const tab = { id: target.tabId };
          const dropPlacement = target.placement;
          onReorderTab?.(draggedId, tab.id, dropPlacement);
        }
      } else {
        suppressClickRef.current = true;
        onSelectTab(targetTabId ?? gesture.tabId);
      }
    },
    [clearDragState, containerRef, onReorderTab, onSelectTab],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, tab: TerminalTab) => {
      if (e.button !== 0) return;
      if (activeEditingTabId) return;

      if (typeof e.currentTarget.setPointerCapture === 'function') {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ignored in unsupported test environments
        }
      }

      dragGestureRef.current = {
        tabId: tab.id,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        hasMovedPastThreshold: false,
      };
      dropTargetRef.current = null;

      removeWindowPointerListeners();

      if (typeof window !== 'undefined') {
        const pId = e.pointerId;
        const onWinMove = (winEvt: PointerEvent) => {
          if (dragGestureRef.current?.pointerId === winEvt.pointerId) {
            processPointerMove(
              winEvt.clientX,
              winEvt.clientY,
              winEvt.pointerId,
              winEvt,
            );
          }
        };

        const onWinUp = (winEvt: PointerEvent) => {
          if (dragGestureRef.current?.pointerId === winEvt.pointerId) {
            processPointerUp(
              winEvt.clientX,
              winEvt.clientY,
              winEvt.pointerId,
              tab.id,
            );
          }
        };

        const onWinCancel = (winEvt: PointerEvent) => {
          if (dragGestureRef.current?.pointerId === winEvt.pointerId) {
            clearDragState();
          }
        };

        activePointerListenersRef.current = {
          pointerId: pId,
          onMove: onWinMove,
          onUp: onWinUp,
          onCancel: onWinCancel,
        };

        window.addEventListener('pointermove', onWinMove, true);
        window.addEventListener('pointerup', onWinUp, true);
        window.addEventListener('pointercancel', onWinCancel, true);
      }
    },
    [
      activeEditingTabId,
      clearDragState,
      processPointerMove,
      processPointerUp,
      removeWindowPointerListeners,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      processPointerMove(e.clientX, e.clientY, e.pointerId, e.nativeEvent);
    },
    [processPointerMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, tab: TerminalTab) => {
      if (typeof e.currentTarget.releasePointerCapture === 'function') {
        try {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        } catch {
          // Ignored
        }
      }
      processPointerUp(e.clientX, e.clientY, e.pointerId, tab.id);
    },
    [processPointerUp],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (typeof e.currentTarget.releasePointerCapture === 'function') {
        try {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        } catch {
          // Ignored
        }
      }
      clearDragState();
    },
    [clearDragState],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && dragGestureRef.current) {
        dragGestureRef.current = null;
        clearDragState();
      }
    },
    [clearDragState],
  );

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
          const isDragging = tab.id === draggingTabId;
          const dropPlacement =
            dropTarget?.tabId === tab.id ? dropTarget.placement : null;
          const tabDisplayName = getTerminalTabDisplayName(tab);
          const tabColorKey = getTerminalTabColorKey(tab);
          const tabIdentityStyle = {
            '--terminal-tab-identity-color':
              getTerminalTabColorCssValue(tabColorKey),
          } as CSSProperties;

          return (
            <div
              key={tab.id}
              className={`workspace-tab terminal-tab chrome-tab chrome-tab--terminal ${isActive ? 'workspace-tab--active terminal-tab--active chrome-tab--active' : ''} ${isEditing ? 'workspace-tab--editing terminal-tab--editing' : ''} ${isDragging ? 'workspace-tab--dragging terminal-tab--dragging' : ''} ${dropPlacement ? `workspace-tab--drop-${dropPlacement} terminal-tab--drop-${dropPlacement}` : ''}`}
              data-active={isActive ? 'true' : 'false'}
              data-tab-id={tab.id}
              data-tab-color={tabColorKey}
              style={tabIdentityStyle}
            >
              {isEditing ? (
                <div
                  className="workspace-tab-edit-container"
                  role="tab"
                  id={`terminal-tab-${tab.id}`}
                  aria-selected={isActive}
                  aria-controls={`terminal-panel-${tab.id}`}
                  draggable={false}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                >
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
                  onPointerDown={(e) => handlePointerDown(e, tab)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={(e) => handlePointerUp(e, tab)}
                  onPointerCancel={handlePointerCancel}
                  onKeyDown={handleKeyDown}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    onSelectTab(tab.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(tab);
                  }}
                  title={tabDisplayName}
                >
                  <span
                    className="workspace-tab-label"
                    title={tabDisplayName}
                  >
                    {tabDisplayName}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="workspace-tab-close terminal-tab-close chrome-close-button chrome-close-button--tab close-button"
                draggable={false}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
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
        {onResetWorkspace && (
          <button
            type="button"
            className="workspace-tab-reset-btn"
            onClick={onResetWorkspace}
            disabled={isResetBlocked}
            aria-label="Reset workspace"
            title={resetBlockReason ?? 'Reset workspace'}
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
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
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
