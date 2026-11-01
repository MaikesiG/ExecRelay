import { useState, useRef, useEffect, useCallback } from 'react';
import {
  getWorkspaceCaptureStatus,
  getWorkspaceCaptureStatusLabel,
  type LogicalWorkspace,
  type LogicalWorkspaceId,
} from './types';
import {
  resolveTabDropTarget,
  TAB_DRAG_THRESHOLD_PX,
  type WorkspaceDropPlacement,
} from './workspaceReorder';
import { useTabStripScroll } from './useTabStripScroll';
import './WorkspaceTabBar.css';
import './ChromeTabs.css';

export interface WorkspaceTabBarProps {
  workspaces: ReadonlyArray<LogicalWorkspace>;
  activeWorkspaceId: LogicalWorkspaceId;
  onSelectWorkspace: (workspaceId: LogicalWorkspaceId) => void;
  onCreateWorkspace: () => void;
  onRequestDeleteWorkspace: (workspaceId: LogicalWorkspaceId) => void;
  onRenameWorkspace: (workspaceId: LogicalWorkspaceId, name: string) => void;
  onReorderWorkspace: (
    draggedWorkspaceId: LogicalWorkspaceId,
    targetWorkspaceId: LogicalWorkspaceId,
    placement: WorkspaceDropPlacement,
  ) => void;
  onOpenFolder?: (targetWorkspaceId?: LogicalWorkspaceId) => void;
  /** Running app version from the app metadata; nothing is shown while unknown. */
  appVersion?: string | null;
  /** A folder picker / workspace setup is in progress; folder actions are unavailable. */
  isFolderFlowPending?: boolean;
}

export function WorkspaceTabBar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onRequestDeleteWorkspace,
  onRenameWorkspace,
  onReorderWorkspace,
  onOpenFolder,
  appVersion,
  isFolderFlowPending = false,
}: WorkspaceTabBarProps) {
  const [editingWorkspaceId, setEditingWorkspaceId] =
    useState<LogicalWorkspaceId | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState<string>('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [draggingWorkspaceId, setDraggingWorkspaceId] =
    useState<LogicalWorkspaceId | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    workspaceId: LogicalWorkspaceId;
    placement: WorkspaceDropPlacement;
  } | null>(null);

  const showCloseButton = workspaces.length >= 2;

  useEffect(() => {
    if (editingWorkspaceId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingWorkspaceId]);

  const startRename = useCallback(
    (ws: LogicalWorkspace) => {
      setEditingWorkspaceId(ws.id);
      setEditingWorkspaceName(ws.name);
    },
    [],
  );

  const saveRename = useCallback(
    (id: LogicalWorkspaceId, value: string) => {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        onRenameWorkspace(id, trimmed.slice(0, 40));
      }
      setEditingWorkspaceId(null);
    },
    [onRenameWorkspace],
  );

  const cancelRename = useCallback(() => {
    setEditingWorkspaceId(null);
  }, []);

  const { containerRef } = useTabStripScroll({
    activeId: activeWorkspaceId,
    itemsCount: workspaces.length,
  });

  // Pointer-based reorder, mirroring terminal tabs (WorkspaceTabs). HTML5 drag-and-drop is
  // not delivered to the Tauri webview while native drag-drop handling is enabled.
  const dragGestureRef = useRef<{
    workspaceId: LogicalWorkspaceId;
    startX: number;
    startY: number;
    pointerId: number;
    hasMovedPastThreshold: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const windowListenersRef = useRef<{
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
    onCancel: (e: PointerEvent) => void;
  } | null>(null);

  const clearDragState = useCallback(() => {
    const listeners = windowListenersRef.current;
    if (listeners) {
      window.removeEventListener('pointermove', listeners.onMove, true);
      window.removeEventListener('pointerup', listeners.onUp, true);
      window.removeEventListener('pointercancel', listeners.onCancel, true);
      windowListenersRef.current = null;
    }
    dragGestureRef.current = null;
    setDraggingWorkspaceId(null);
    setDropTarget(null);
  }, []);

  useEffect(() => clearDragState, [clearDragState]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragGestureRef.current) clearDragState();
    };
    const onBlur = () => {
      if (dragGestureRef.current) clearDragState();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [clearDragState]);

  const resolveDropTarget = useCallback(
    (clientX: number, draggedId: LogicalWorkspaceId) => {
      const container = containerRef.current;
      if (!container) return null;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>('.workspace-tab-item[data-workspace-id]'),
      ).map((el) => ({
        tabId: el.getAttribute('data-workspace-id') as LogicalWorkspaceId,
        rect: el.getBoundingClientRect(),
      }));
      return resolveTabDropTarget(items, clientX, draggedId);
    },
    [containerRef],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, ws: LogicalWorkspace) => {
      if (e.button !== 0 || editingWorkspaceId) return;
      clearDragState();
      dragGestureRef.current = {
        workspaceId: ws.id,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        hasMovedPastThreshold: false,
      };

      const onMove = (moveEvt: PointerEvent) => {
        const gesture = dragGestureRef.current;
        if (!gesture || gesture.pointerId !== moveEvt.pointerId) return;
        if (!gesture.hasMovedPastThreshold) {
          const distance = Math.hypot(
            moveEvt.clientX - gesture.startX,
            moveEvt.clientY - gesture.startY,
          );
          if (distance < TAB_DRAG_THRESHOLD_PX) return;
          gesture.hasMovedPastThreshold = true;
          setDraggingWorkspaceId(gesture.workspaceId);
        }
        moveEvt.preventDefault();
        const target = resolveDropTarget(moveEvt.clientX, gesture.workspaceId);
        setDropTarget(target ? { workspaceId: target.tabId, placement: target.placement } : null);
      };
      const onUp = (upEvt: PointerEvent) => {
        const gesture = dragGestureRef.current;
        if (!gesture || gesture.pointerId !== upEvt.pointerId) return;
        const target = gesture.hasMovedPastThreshold
          ? resolveDropTarget(upEvt.clientX, gesture.workspaceId)
          : null;
        const draggedId = gesture.workspaceId;
        const wasDragging = gesture.hasMovedPastThreshold;
        clearDragState();
        if (!wasDragging) return; // A plain press is a normal click: activation stays on onClick.
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 150);
        if (target && target.tabId !== draggedId) {
          onReorderWorkspace(draggedId, target.tabId, target.placement);
        }
      };
      const onCancel = (cancelEvt: PointerEvent) => {
        if (dragGestureRef.current?.pointerId === cancelEvt.pointerId) clearDragState();
      };
      windowListenersRef.current = { onMove, onUp, onCancel };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
    },
    [clearDragState, editingWorkspaceId, onReorderWorkspace, resolveDropTarget],
  );

  return (
    <nav
      className="workspace-tab-bar"
      role="tablist"
      aria-label="Workspace tabs"
    >
      <div
        ref={containerRef}
        className="workspace-tab-bar-list workspace-tabs-list"
      >
        {workspaces.map((ws) => {
          const isActive = ws.id === activeWorkspaceId;
          const isEditing = ws.id === editingWorkspaceId;
          const isDragging = ws.id === draggingWorkspaceId;
          const dropPlacement =
            dropTarget?.workspaceId === ws.id ? dropTarget.placement : null;
          const captureStatus = getWorkspaceCaptureStatus(ws);
          const statusLabel = getWorkspaceCaptureStatusLabel(captureStatus);

          return (
            <div
              key={ws.id}
              className={`workspace-tab-item chrome-tab chrome-tab--workspace ${isActive ? 'workspace-tab-item--active chrome-tab--active' : ''} ${isDragging ? 'workspace-tab-item--dragging' : ''} ${dropPlacement ? `workspace-tab-item--drop-${dropPlacement}` : ''}`}
              data-active={isActive ? 'true' : 'false'}
              data-workspace-id={ws.id}
            >
              {isEditing ? (
                <div className="workspace-tab-item-edit-container">
                  <span
                    className={`workspace-tab-status-dot workspace-tab-capture-status workspace-tab-status-dot--${captureStatus} workspace-tab-capture-status--${captureStatus}`}
                    role="status"
                    aria-label={statusLabel}
                    title={statusLabel}
                  />
                  <input
                    ref={renameInputRef}
                    type="text"
                    className="workspace-tab-item-rename-input"
                    value={editingWorkspaceName}
                    maxLength={40}
                    aria-label={`Rename ${ws.name}`}
                    onChange={(e) => {
                      e.stopPropagation();
                      setEditingWorkspaceName(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        saveRename(ws.id, editingWorkspaceName);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    onBlur={() => {
                      saveRename(ws.id, editingWorkspaceName);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  id={`workspace-tab-${ws.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`terminal-workspace-${ws.id}`}
                  className="workspace-tab-item-button"
                  onPointerDown={(e) => handlePointerDown(e, ws)}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    onSelectWorkspace(ws.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(ws);
                  }}
                  title={
                    ws.rootPath
                      ? `${ws.name}\nFolder: ${ws.rootPath}${ws.repository?.rootPath ? `\nRepository: ${ws.repository.rootPath}${ws.repository.branch ? ` (${ws.repository.branch})` : ''}` : '\nNo Git repository'}`
                      : `${ws.name} (Unbound workspace)`
                  }
                >
                  <span
                    className={`workspace-tab-status-dot workspace-tab-capture-status workspace-tab-status-dot--${captureStatus} workspace-tab-capture-status--${captureStatus}`}
                    role="status"
                    aria-label={statusLabel}
                    title={statusLabel}
                  />
                  <span
                    className="workspace-tab-item-name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(ws);
                    }}
                  >
                    {ws.name}
                  </span>
                  {!ws.rootPath && onOpenFolder && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="workspace-tab-bind-folder-btn"
                      aria-disabled={isFolderFlowPending || undefined}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenFolder(ws.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          e.preventDefault();
                          onOpenFolder(ws.id);
                        }
                      }}
                      aria-label={`Open folder for ${ws.name}`}
                      title="Open project folder for this workspace"
                    >
                      Open Folder
                    </span>
                  )}
                </button>
              )}

              {showCloseButton && (
                <button
                  type="button"
                  className="workspace-tab-item-close chrome-close-button chrome-close-button--tab close-button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestDeleteWorkspace(ws.id);
                  }}
                  aria-label={`Delete ${ws.name}`}
                  title={`Delete ${ws.name}`}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="workspace-tab-bar-add"
        onClick={() => {
          if (onOpenFolder) {
            onOpenFolder();
          } else {
            onCreateWorkspace();
          }
        }}
        disabled={isFolderFlowPending}
        aria-busy={isFolderFlowPending || undefined}
        aria-label="Open Folder"
        title={isFolderFlowPending ? 'Opening folder…' : 'Open Folder'}
      >
        +
      </button>

      {appVersion && (
        <span className="workspace-tab-bar-version" title={`ExecRelay version ${appVersion}`}>
          ExecRelay v{appVersion}
        </span>
      )}
    </nav>
  );
}
