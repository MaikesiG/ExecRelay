/**
 * Canonical Shortcut Normalization Layer
 * HARDEN-009
 */

import type { NormalizedShortcut, ShortcutBinding } from './types';

export function isMacPlatform(): boolean {
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    return /Mac|iPod|iPhone|iPad/i.test(navigator.userAgent);
  }
  const proc =
    typeof globalThis !== 'undefined'
      ? (globalThis as { process?: { platform?: string } }).process
      : undefined;
  if (proc && proc.platform) {
    return proc.platform === 'darwin';
  }
  return true; // Default to macOS if unknown
}

/**
 * Normalizes a key name to a canonical, case-insensitive, portable string.
 * Examples:
 *   'Digit1' -> '1', '1' -> '1'
 *   'KeyC' -> 'c', 'C' -> 'c'
 *   'ArrowLeft' -> 'arrowleft'
 *   'Escape' -> 'escape'
 */
export function normalizeKey(key: string, code?: string): string {
  if (!key) return '';

  // 1. Digits from code or key
  if (code && /^Digit([0-9])$/i.test(code)) {
    const m = code.match(/^Digit([0-9])$/i);
    if (m) return m[1];
  }
  if (code && /^Numpad([0-9])$/i.test(code)) {
    const m = code.match(/^Numpad([0-9])$/i);
    if (m) return m[1];
  }
  if (/^[0-9]$/.test(key)) {
    return key;
  }

  // 2. Letters from code or key
  if (code && /^Key([A-Z])$/i.test(code)) {
    const m = code.match(/^Key([A-Z])$/i);
    if (m) return m[1].toLowerCase();
  }

  // 3. Special named keys
  const trimmed = key.trim().toLowerCase();
  if (trimmed === ' ' || trimmed === 'space') return 'space';
  if (trimmed === 'escape' || trimmed === 'esc') return 'escape';
  if (trimmed === 'arrowleft') return 'arrowleft';
  if (trimmed === 'arrowright') return 'arrowright';
  if (trimmed === 'arrowup') return 'arrowup';
  if (trimmed === 'arrowdown') return 'arrowdown';
  if (trimmed === 'enter' || trimmed === 'return') return 'enter';
  if (trimmed === 'tab') return 'tab';
  if (trimmed === 'backspace') return 'backspace';
  if (trimmed === 'delete') return 'delete';

  return trimmed;
}

/**
 * Normalizes a raw browser / DOM KeyboardEvent into a NormalizedShortcut.
 */
export function normalizeKeyboardEvent(event: KeyboardEvent): NormalizedShortcut {
  const key = normalizeKey(event.key, event.code);
  return {
    key,
    meta: Boolean(event.metaKey),
    ctrl: Boolean(event.ctrlKey),
    alt: Boolean(event.altKey),
    shift: Boolean(event.shiftKey),
  };
}

/**
 * Checks whether a configured ShortcutBinding matches a NormalizedShortcut.
 */
export function matchesBinding(
  binding: ShortcutBinding,
  shortcut: NormalizedShortcut,
): boolean {
  if (!binding || !shortcut) return false;

  const normalizedBindingKey = normalizeKey(binding.key);
  if (normalizedBindingKey !== shortcut.key) {
    return false;
  }

  const metaMatch = Boolean(binding.meta) === shortcut.meta;
  const ctrlMatch = Boolean(binding.ctrl) === shortcut.ctrl;
  const altMatch = Boolean(binding.alt) === shortcut.alt;
  const shiftMatch = Boolean(binding.shift) === shortcut.shift;

  return metaMatch && ctrlMatch && altMatch && shiftMatch;
}

/**
 * Converts a ShortcutBinding into a canonical NormalizedShortcut object.
 */
export function toNormalizedShortcut(binding: ShortcutBinding): NormalizedShortcut {
  return {
    key: normalizeKey(binding.key),
    meta: Boolean(binding.meta),
    ctrl: Boolean(binding.ctrl),
    alt: Boolean(binding.alt),
    shift: Boolean(binding.shift),
  };
}

/**
 * Checks equality between two ShortcutBindings.
 */
export function areBindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
  if (!a || !b) return false;
  const normA = toNormalizedShortcut(a);
  const normB = toNormalizedShortcut(b);
  return matchesBinding(normA, normB);
}

/**
 * Formats a ShortcutBinding into a platform-appropriate display string.
 * macOS: ⌘1, ⌃C, ⌥⇧1
 * Windows/Linux: Ctrl+1, Alt+1, Ctrl+Shift+1
 */
export function formatShortcutDisplay(
  binding: ShortcutBinding,
  isMac: boolean = isMacPlatform(),
): string {
  if (!binding || !binding.key) return '';

  const keyDisplay = formatKeyDisplay(normalizeKey(binding.key));

  if (isMac) {
    const parts: string[] = [];
    if (binding.ctrl) parts.push('⌃');
    if (binding.alt) parts.push('⌥');
    if (binding.shift) parts.push('⇧');
    if (binding.meta) parts.push('⌘');
    return `${parts.join('')}${keyDisplay}`;
  } else {
    const parts: string[] = [];
    if (binding.ctrl) parts.push('Ctrl');
    if (binding.alt) parts.push('Alt');
    if (binding.shift) parts.push('Shift');
    if (binding.meta) parts.push('Win');
    parts.push(keyDisplay);
    return parts.join('+');
  }
}

/**
 * Generates an accessible aria-label for a shortcut.
 * E.g., "Command 1" or "Control 1".
 */
export function formatShortcutAriaLabel(
  binding: ShortcutBinding,
  isMac: boolean = isMacPlatform(),
): string {
  if (!binding || !binding.key) return '';

  const keyName = binding.key.toUpperCase();
  const parts: string[] = [];

  if (isMac) {
    if (binding.ctrl) parts.push('Control');
    if (binding.alt) parts.push('Option');
    if (binding.shift) parts.push('Shift');
    if (binding.meta) parts.push('Command');
  } else {
    if (binding.ctrl) parts.push('Control');
    if (binding.alt) parts.push('Alt');
    if (binding.shift) parts.push('Shift');
    if (binding.meta) parts.push('Windows');
  }

  parts.push(keyName);
  return parts.join(' ');
}

function formatKeyDisplay(key: string): string {
  if (!key) return '';
  if (key === 'arrowleft') return '←';
  if (key === 'arrowright') return '→';
  if (key === 'arrowup') return '↑';
  if (key === 'arrowdown') return '↓';
  if (key === 'enter') return '↵';
  if (key === 'escape') return 'Esc';
  if (key === 'space') return 'Space';
  if (key === 'tab') return 'Tab';
  if (key === 'backspace') return '⌫';
  if (key === 'delete') return 'Del';
  return key.toUpperCase();
}
