/**
 * TERMINAL-CLIPBOARD-001: decides whether a terminal keydown copies the terminal selection.
 *
 * `pass` leaves the key to xterm, so Ctrl+C without a copy condition still reaches the PTY
 * as ETX (the terminal interrupt).
 * - macOS: Cmd+C or Cmd+Shift+C with a selection copies. Ctrl+C always interrupts.
 * - Windows: Ctrl+C or Ctrl+Shift+C with a selection copies. Plain Ctrl+C also clears the
 *   selection, so the next Ctrl+C interrupts again.
 * - Linux: Ctrl+Shift+C with a selection copies. Ctrl+C always interrupts.
 * - Unknown host (CROSSPLAT-005D): nothing is intercepted; every key reaches xterm.
 */

import type { ShortcutPlatform } from '../shortcuts/types';

export type TerminalCopyDecision = 'copy' | 'copy-and-clear' | 'pass';

export type TerminalCopyKeyEvent = Pick<
  KeyboardEvent,
  'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
>;

export function resolveTerminalCopyShortcut(
  event: TerminalCopyKeyEvent,
  platform: ShortcutPlatform,
  hasSelection: boolean,
): TerminalCopyDecision {
  if (!hasSelection || event.code !== 'KeyC' || event.altKey || platform === 'unknown') return 'pass';

  if (platform === 'macos') {
    return event.metaKey && !event.ctrlKey ? 'copy' : 'pass';
  }
  if (!event.ctrlKey || event.metaKey) return 'pass';
  if (event.shiftKey) return 'copy';
  return platform === 'windows' ? 'copy-and-clear' : 'pass';
}

/**
 * TERMINAL-CLIPBOARD-002: Windows Ctrl+V pastes. xterm would otherwise translate the key to
 * ^V (0x16) for the PTY and keep the WebView's paste from happening; returning `true` tells
 * the caller to leave the key to the WebView, whose native paste reaches xterm's paste path
 * (bracketed paste when the shell enabled it) and the PTY exactly once. macOS (Cmd+V) and
 * Linux keep their existing behaviour.
 */
export function isTerminalPasteShortcut(
  event: TerminalCopyKeyEvent,
  platform: ShortcutPlatform,
): boolean {
  return (
    platform === 'windows' &&
    event.code === 'KeyV' &&
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey
  );
}
