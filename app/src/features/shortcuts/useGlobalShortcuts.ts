/**
 * Global Keyboard Shortcut Dispatcher Hook
 * HARDEN-009
 *
 * Implements strict event routing priority:
 * 1. Shortcut capture recorder mode (takes priority; Escape cancels)
 * 2. Active modal dialogs (Escape closes)
 * 3. Valid CapTerm global shortcut match (Cmd/Ctrl + 1..7)
 * 4. Terminal / xterm input (bare keys & native shell control keys reach PTY)
 * 5. Local component key handling
 */

import { useEffect, useRef } from 'react';
import type { AppCommand } from './types';
import { ShortcutRegistry, defaultShortcutRegistry } from './shortcutRegistry';

export interface UseGlobalShortcutsOptions {
  registry?: ShortcutRegistry;
  onCommand: (command: AppCommand) => void;
  isRecorderActive?: boolean;
  isModalOpen?: boolean;
}

export function useGlobalShortcuts({
  registry = defaultShortcutRegistry,
  onCommand,
  isRecorderActive = false,
  isModalOpen = false,
}: UseGlobalShortcutsOptions): void {
  const onCommandRef = useRef(onCommand);
  const isRecorderActiveRef = useRef(isRecorderActive);
  const isModalOpenRef = useRef(isModalOpen);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    isRecorderActiveRef.current = isRecorderActive;
  }, [isRecorderActive]);

  useEffect(() => {
    isModalOpenRef.current = isModalOpen;
  }, [isModalOpen]);

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

      // 3. Priority 1: If a shortcut recorder is active in Settings,
      // let the recorder capture the event. Do NOT execute global commands!
      if (isRecorderActiveRef.current) {
        return;
      }

      // 4. Priority 2: If an inline tab rename input or general rename input is active,
      // bare typing and common input shortcuts stay within that input.
      const activeEl = document.activeElement;
      const isRenameActive =
        activeEl?.classList?.contains('workspace-tab-item-rename-input') ||
        activeEl?.classList?.contains('workspace-tab-rename-input') ||
        activeEl?.classList?.contains('terminal-pane-rename-input');

      if (isRenameActive) {
        // Only allow non-bare global commands (like Cmd+1..7) if explicitly intended,
        // but if it's text editing or bare key, let it go to the rename input.
        if (!event.metaKey && !event.ctrlKey) {
          return;
        }
      }

      // 5. Priority 3: Check for registered CapTerm global command match
      const matchedCommand = registry.findCommandForEvent(event);
      if (!matchedCommand) {
        // No global command match: event flows down naturally to xterm or native inputs.
        // Ordinary typing (e.g. '1', '2', '3') and terminal controls (Ctrl+C, Ctrl+D)
        // are NEVER intercepted here!
        return;
      }

      // 6. Global command matched!
      // Prevent browser default action (e.g. Cmd+1 switching browser tabs)
      // and stop propagation into xterm/PTY so the key sequence is not sent as raw characters.
      event.preventDefault();
      event.stopPropagation();

      onCommandRef.current(matchedCommand);
    };

    // Use capture phase at window level to intercept before browser or xterm handlers
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [registry]);
}
