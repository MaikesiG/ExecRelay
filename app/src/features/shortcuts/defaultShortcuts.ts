/**
 * Default Platform-Aware Shortcut Registry Configurations
 * SHORTCUT-002: Navigation (1–4) + Terminal Panes
 */

import type { AppCommand, ShortcutBinding, ShortcutPlatform } from './types';
import { detectPlatform } from './shortcutNormalization';

export const DEFAULT_SHORTCUTS_MAC: Record<AppCommand, ShortcutBinding> = {
  // Navigation Surfaces (1–4)
  'focus-terminal': { key: '1', meta: true },
  'focus-capture-evidence': { key: '2', meta: true },
  'focus-changes': { key: '3', meta: true },
  'focus-verification': { key: '4', meta: true },
  'workspace.previousTab': { key: '[', meta: true, shift: true },
  'workspace.nextTab': { key: ']', meta: true, shift: true },
  'terminal.previousTab': { key: '[', ctrl: true, shift: true },
  'terminal.nextTab': { key: ']', ctrl: true, shift: true },

  // Terminal Panes
  'terminal.split-right': { key: 'd', meta: true },
  'terminal.split-down': { key: 'd', meta: true, shift: true },
  'terminal.close-pane': { key: 'w', meta: true, shift: true },
  'terminal.focus-left': { key: 'arrowleft', ctrl: true, shift: true },
  'terminal.focus-right': { key: 'arrowright', ctrl: true, shift: true },
  'terminal.focus-up': { key: 'arrowup', ctrl: true, shift: true },
  'terminal.focus-down': { key: 'arrowdown', ctrl: true, shift: true },
};

export const DEFAULT_SHORTCUTS_WIN: Record<AppCommand, ShortcutBinding> = {
  // Navigation Surfaces (1–4)
  'focus-terminal': { key: '1', ctrl: true },
  'focus-capture-evidence': { key: '2', ctrl: true },
  'focus-changes': { key: '3', ctrl: true },
  'focus-verification': { key: '4', ctrl: true },
  'workspace.previousTab': { key: '[', ctrl: true, shift: true },
  'workspace.nextTab': { key: ']', ctrl: true, shift: true },
  'terminal.previousTab': { key: 'pageup', ctrl: true },
  'terminal.nextTab': { key: 'pagedown', ctrl: true },

  // Terminal Panes
  'terminal.split-right': { key: '\\', ctrl: true, shift: true },
  'terminal.split-down': { key: '-', ctrl: true, shift: true },
  'terminal.close-pane': { key: 'w', ctrl: true, shift: true },
  'terminal.focus-left': { key: 'arrowleft', alt: true },
  'terminal.focus-right': { key: 'arrowright', alt: true },
  'terminal.focus-up': { key: 'arrowup', alt: true },
  'terminal.focus-down': { key: 'arrowdown', alt: true },
};

export const DEFAULT_SHORTCUTS_LINUX: Record<AppCommand, ShortcutBinding> = {
  // Navigation Surfaces (1–4)
  'focus-terminal': { key: '1', ctrl: true },
  'focus-capture-evidence': { key: '2', ctrl: true },
  'focus-changes': { key: '3', ctrl: true },
  'focus-verification': { key: '4', ctrl: true },
  'workspace.previousTab': { key: '[', ctrl: true, shift: true },
  'workspace.nextTab': { key: ']', ctrl: true, shift: true },
  'terminal.previousTab': { key: 'pageup', ctrl: true },
  'terminal.nextTab': { key: 'pagedown', ctrl: true },

  // Terminal Panes
  'terminal.split-right': { key: '\\', ctrl: true, shift: true },
  'terminal.split-down': { key: '-', ctrl: true, shift: true },
  'terminal.close-pane': { key: 'w', ctrl: true, shift: true },
  'terminal.focus-left': { key: 'arrowleft', alt: true },
  'terminal.focus-right': { key: 'arrowright', alt: true },
  'terminal.focus-up': { key: 'arrowup', alt: true },
  'terminal.focus-down': { key: 'arrowdown', alt: true },
};

/**
 * Returns a cloned record of default bindings for the active platform.
 * Supports passing `ShortcutPlatform` ('macos' | 'windows' | 'linux')
 * or a boolean `isMac` for backward compatibility.
 */
export function getDefaultShortcuts(
  platformOrIsMac?: ShortcutPlatform | boolean,
): Record<AppCommand, ShortcutBinding> {
  let source: Record<AppCommand, ShortcutBinding>;

  if (typeof platformOrIsMac === 'boolean') {
    source = platformOrIsMac ? DEFAULT_SHORTCUTS_MAC : DEFAULT_SHORTCUTS_WIN;
  } else {
    const platform = platformOrIsMac ?? detectPlatform();
    switch (platform) {
      case 'macos':
        source = DEFAULT_SHORTCUTS_MAC;
        break;
      case 'windows':
        source = DEFAULT_SHORTCUTS_WIN;
        break;
      case 'linux':
        source = DEFAULT_SHORTCUTS_LINUX;
        break;
      default:
        source = DEFAULT_SHORTCUTS_MAC;
        break;
    }
  }

  const result: Partial<Record<AppCommand, ShortcutBinding>> = {};
  for (const [cmd, binding] of Object.entries(source)) {
    result[cmd as AppCommand] = { ...binding };
  }
  return result as Record<AppCommand, ShortcutBinding>;
}
