import { useEffect, useRef } from 'react';
import type { LogicalWorkspace } from './types';
import type { TerminalPaneToastMessage } from '../warnings/types';
import { ShortcutRegistry, defaultShortcutRegistry } from '../shortcuts/shortcutRegistry';
import { isTerminalCommand } from '../shortcuts/types';
import { findDirectionalPaneId } from './shortcutNavigation';

export type PaneShortcutAction =
  | 'splitRight'
  | 'splitDown'
  | 'closePane'
  | 'focusLeft'
  | 'focusRight'
  | 'focusUp'
  | 'focusDown';

export function isNonTerminalInput(el: Element | null): boolean {
  if (!el) return false;
  if (el.classList?.contains('xterm-helper-textarea')) {
    return false;
  }
  const tagName = el.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  if ((el as HTMLElement).isContentEditable) {
    return true;
  }
  return false;
}

/**
 * Pure fallback matching function for terminal pane shortcut actions.
 * Preserved for backward-compatible testing and standalone evaluations.
 */
export function matchesPaneShortcut(
  event: KeyboardEvent,
  isMac: boolean,
): PaneShortcutAction | null {
  const code = event.code;
  const key = event.key;

  if (isMac) {
    // macOS: Cmd + D -> Split Right
    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      (code === 'KeyD' || key.toLowerCase() === 'd')
    ) {
      return 'splitRight';
    }

    // macOS: Cmd + Shift + D -> Split Down
    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.shiftKey &&
      (code === 'KeyD' || key.toLowerCase() === 'd')
    ) {
      return 'splitDown';
    }

    // macOS: Cmd + Shift + W -> Close Active Pane
    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.shiftKey &&
      (code === 'KeyW' || key.toLowerCase() === 'w')
    ) {
      return 'closePane';
    }

    // macOS: Ctrl + Shift + Arrow Keys -> Directional Focus
    if (!event.metaKey && !event.altKey && event.ctrlKey && event.shiftKey) {
      if (code === 'ArrowLeft' || key === 'ArrowLeft') {
        return 'focusLeft';
      }
      if (code === 'ArrowRight' || key === 'ArrowRight') {
        return 'focusRight';
      }
      if (code === 'ArrowUp' || key === 'ArrowUp') {
        return 'focusUp';
      }
      if (code === 'ArrowDown' || key === 'ArrowDown') {
        return 'focusDown';
      }
    }
  } else {
    // Windows / Linux: Ctrl + Shift + \ -> Split Right
    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.shiftKey &&
      (code === 'Backslash' || key === '\\' || key === '|')
    ) {
      return 'splitRight';
    }

    // Windows / Linux: Ctrl + Shift + - -> Split Down
    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.shiftKey &&
      (code === 'Minus' || key === '-' || key === '_')
    ) {
      return 'splitDown';
    }

    // Windows / Linux: Ctrl + Shift + W -> Close Active Pane
    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.shiftKey &&
      (code === 'KeyW' || key.toLowerCase() === 'w')
    ) {
      return 'closePane';
    }

    // Windows / Linux: Alt + Arrow Keys -> Directional Focus
    if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
      if (code === 'ArrowLeft' || key === 'ArrowLeft') {
        return 'focusLeft';
      }
      if (code === 'ArrowRight' || key === 'ArrowRight') {
        return 'focusRight';
      }
      if (code === 'ArrowUp' || key === 'ArrowUp') {
        return 'focusUp';
      }
      if (code === 'ArrowDown' || key === 'ArrowDown') {
        return 'focusDown';
      }
    }
  }

  return null;
}

export interface UseTerminalPaneKeybindingsOptions {
  activeWorkspaceId: string | null;
  workspaces: ReadonlyArray<LogicalWorkspace>;
  isModalOpen: boolean;
  registry?: ShortcutRegistry;
  onSplitRight: (
    workspaceId: string,
    terminalTabId: string,
    sourcePaneId: string,
  ) => void;
  onSplitDown: (
    workspaceId: string,
    terminalTabId: string,
    sourcePaneId: string,
  ) => void;
  onClosePane: (
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
  ) => void;
  onSetActivePane: (
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
  ) => void;
  showTerminalPaneToast?: (message: TerminalPaneToastMessage) => void;
  onShowToast?: (message: TerminalPaneToastMessage) => void;
  /** @deprecated use showTerminalPaneToast instead */
  onShowFeedback?: (message: TerminalPaneToastMessage | string) => void;
}

export function useTerminalPaneKeybindings(
  options: UseTerminalPaneKeybindingsOptions,
): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 1. Guard against IME composition
      if (event.isComposing) {
        return;
      }

      // 2. Guard against already prevented events
      if (event.defaultPrevented) {
        return;
      }

      // 2b. Guard against event.repeat spam for structural actions
      if (event.repeat) {
        return;
      }

      // 3. Guard against active modal dialogs
      if (
        optionsRef.current.isModalOpen ||
        document.querySelector('[role="dialog"], [aria-modal="true"]') !== null
      ) {
        return;
      }

      // 4. Guard against inline rename inputs being edited
      if (
        document.querySelector(
          '.workspace-tab-item-rename-input, .workspace-tab-rename-input',
        ) !== null
      ) {
        return;
      }

      // 5. Guard against non-terminal inputs (e.g. text inputs, textareas, selects, contenteditable)
      const activeEl = document.activeElement;
      if (isNonTerminalInput(activeEl)) {
        return;
      }
      const targetEl = event.target as Element | null;
      if (isNonTerminalInput(targetEl)) {
        return;
      }

      // 6. Check configurable shortcut match via Registry
      const registry = optionsRef.current.registry ?? defaultShortcutRegistry;
      const matchedCommand = registry.findCommandForEvent(event, 'terminal');
      let action: PaneShortcutAction | null = null;

      if (matchedCommand && isTerminalCommand(matchedCommand)) {
        switch (matchedCommand) {
          case 'terminal.split-right':
            action = 'splitRight';
            break;
          case 'terminal.split-down':
            action = 'splitDown';
            break;
          case 'terminal.close-pane':
            action = 'closePane';
            break;
          case 'terminal.focus-left':
            action = 'focusLeft';
            break;
          case 'terminal.focus-right':
            action = 'focusRight';
            break;
          case 'terminal.focus-up':
            action = 'focusUp';
            break;
          case 'terminal.focus-down':
            action = 'focusDown';
            break;
        }
      }

      if (!action) {
        return;
      }

      // 7. Resolve current terminal context
      const {
        activeWorkspaceId,
        workspaces,
        onSplitRight,
        onSplitDown,
        onClosePane,
        onSetActivePane,
      } = optionsRef.current;

      const triggerToast = (message: TerminalPaneToastMessage) => {
        if (optionsRef.current.showTerminalPaneToast) {
          optionsRef.current.showTerminalPaneToast(message);
        } else if (optionsRef.current.onShowToast) {
          optionsRef.current.onShowToast(message);
        } else if (optionsRef.current.onShowFeedback) {
          optionsRef.current.onShowFeedback(message);
        }
      };

      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (!ws) {
        return;
      }

      const tab = ws.terminalTabs.find((t) => t.id === ws.activeTerminalTabId);
      if (!tab) {
        return;
      }

      const activePaneId = tab.activePaneId;
      if (!activePaneId || !tab.panes.some((p) => p.id === activePaneId)) {
        return;
      }

      // Prevent conflicting browser defaults and stop propagation to terminal/PTY
      event.preventDefault();
      event.stopPropagation();

      // Execute matched action
      switch (action) {
        case 'splitRight': {
          if (tab.panes.length >= 6) {
            triggerToast('Maximum of 6 panes per terminal tab');
          } else {
            onSplitRight(ws.id, tab.id, activePaneId);
          }
          break;
        }

        case 'splitDown': {
          if (tab.panes.length >= 6) {
            triggerToast('Maximum of 6 panes per terminal tab');
          } else {
            onSplitDown(ws.id, tab.id, activePaneId);
          }
          break;
        }

        case 'closePane': {
          if (tab.panes.length <= 1) {
            triggerToast('Cannot close the last pane');
          } else {
            onClosePane(ws.id, tab.id, activePaneId);
          }
          break;
        }

        case 'focusLeft': {
          const paneId = findDirectionalPaneId(tab, activePaneId, 'left');
          if (paneId) onSetActivePane(ws.id, tab.id, paneId);
          break;
        }

        case 'focusRight': {
          const paneId = findDirectionalPaneId(tab, activePaneId, 'right');
          if (paneId) onSetActivePane(ws.id, tab.id, paneId);
          break;
        }

        case 'focusUp': {
          const paneId = findDirectionalPaneId(tab, activePaneId, 'up');
          if (paneId) onSetActivePane(ws.id, tab.id, paneId);
          break;
        }

        case 'focusDown': {
          const paneId = findDirectionalPaneId(tab, activePaneId, 'down');
          if (paneId) onSetActivePane(ws.id, tab.id, paneId);
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);
}
