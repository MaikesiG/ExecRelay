/**
 * Global Keyboard Shortcut Dispatcher Hook
 * HARDEN-009 / SHORTCUT-001
 *
 * Implements strict event routing priority:
 * 1. Non-composing & non-repeat check
 * 2. Active modal dialogs (modals own keyboard interaction)
 * 3. Shortcut capture recorder mode (takes priority; Escape cancels)
 * 4. Non-terminal inputs & text editing fields (typing stays inside input)
 * 5. Valid ExecRelay global shortcut match (Cmd/Ctrl + configured bindings)
 * 6. Terminal / xterm input (bare keys & native shell control keys reach PTY)
 * 7. Local component key handling
 */

import { useEffect, useRef } from 'react';
import { type AppCommand, isNavigationCommand } from './types';
import { ShortcutRegistry, defaultShortcutRegistry } from './shortcutRegistry';

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

      // 3. Guard against event.repeat spam for global commands
      if (event.repeat) {
        return;
      }

      // 4. Priority 1: If a modal dialog is open, do NOT execute global shortcuts behind it
      if (
        isModalOpenRef.current ||
        (typeof document !== 'undefined' &&
          document.querySelector('[role="dialog"], [aria-modal="true"]') !== null)
      ) {
        return;
      }

      // 5. Priority 2: If a shortcut recorder is active in Settings,
      // let the recorder capture the event. Do NOT execute global commands!
      if (isRecorderActiveRef.current) {
        return;
      }

      // 6. Priority 3: Non-terminal text inputs, textareas, selects, or contenteditable
      // Ordinary typing and text editing commands remain within the input
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      if (isNonTerminalInput(activeEl) || isNonTerminalInput(event.target as Element | null)) {
        return;
      }

      // 7. Priority 4: Check for registered ExecRelay global navigation command match
      const matchedCommand = registry.findCommandForEvent(event, 'navigation');
      if (!matchedCommand || !isNavigationCommand(matchedCommand)) {
        // No global command match: event flows down naturally to terminal pane shortcuts,
        // xterm or native inputs.
        // Ordinary typing (e.g. '1', '2', '3') and terminal controls (Ctrl+C, Ctrl+D)
        // are NEVER intercepted here!
        return;
      }

      // 8. Global command matched!
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
