import { useState, useRef, useEffect, useCallback } from 'react';
import {
  getWorkspaceCaptureStatus,
  getWorkspaceCaptureStatusLabel,
  type LogicalWorkspace,
  type LogicalWorkspaceId,
} from './types';
import type { WorkspaceDropPlacement } from './workspaceReorder';
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

  const clearDragState = useCallback(() => {
    setDraggingWorkspaceId(null);
    setDropTarget(null);
  }, []);

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
              onDragOver={(e) => {
                if (!draggingWorkspaceId) return;
                if (draggingWorkspaceId === ws.id) {
                  setDropTarget(null);
                  return;
                }
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const placement =
                  e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                setDropTarget({ workspaceId: ws.id, placement });
              }}
              onDrop={(e) => {
                e.preventDefault();
                const draggedId =
                  draggingWorkspaceId || e.dataTransfer.getData('text/plain');
                if (draggedId && dropPlacement) {
                  onReorderWorkspace(draggedId, ws.id, dropPlacement);
                }
                clearDragState();
              }}
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
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', ws.id);
                    setDraggingWorkspaceId(ws.id);
                  }}
                  onDragEnd={clearDragState}
                  onClick={() => onSelectWorkspace(ws.id)}
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
                      draggable={false}
                      className="workspace-tab-bind-folder-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenFolder(ws.id);
                      }}
                      onDragStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
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
        aria-label="Open Folder"
        title="Open Folder"
      >
        +
      </button>
    </nav>
  );
}
