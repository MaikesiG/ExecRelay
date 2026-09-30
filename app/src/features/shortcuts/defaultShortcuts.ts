/**
 * Default Platform-Aware Shortcut Registry Configurations
 * HARDEN-010: Positions 1–6
 */

import type { AppCommand, ShortcutBinding } from './types';
import { isMacPlatform } from './shortcutNormalization';

export const DEFAULT_SHORTCUTS_MAC: Record<AppCommand, ShortcutBinding> = {
  'focus-terminal': { key: '1', meta: true },
  'focus-capture-evidence': { key: '2', meta: true },
  'focus-changes': { key: '3', meta: true },
  'focus-verification': { key: '4', meta: true },
  'focus-agents': { key: '5', meta: true },
  'focus-governance': { key: '6', meta: true },
};

export const DEFAULT_SHORTCUTS_WIN: Record<AppCommand, ShortcutBinding> = {
  'focus-terminal': { key: '1', ctrl: true },
  'focus-capture-evidence': { key: '2', ctrl: true },
  'focus-changes': { key: '3', ctrl: true },
  'focus-verification': { key: '4', ctrl: true },
  'focus-agents': { key: '5', ctrl: true },
  'focus-governance': { key: '6', ctrl: true },
};

/**
 * Returns a cloned record of default bindings for the active platform.
 */
export function getDefaultShortcuts(isMac: boolean = isMacPlatform()): Record<AppCommand, ShortcutBinding> {
  const source = isMac ? DEFAULT_SHORTCUTS_MAC : DEFAULT_SHORTCUTS_WIN;
  return {
    'focus-terminal': { ...source['focus-terminal'] },
    'focus-capture-evidence': { ...source['focus-capture-evidence'] },
    'focus-changes': { ...source['focus-changes'] },
    'focus-verification': { ...source['focus-verification'] },
    'focus-agents': { ...source['focus-agents'] },
    'focus-governance': { ...source['focus-governance'] },
  };
}
