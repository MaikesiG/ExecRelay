/**
 * Canonical Shortcut Normalization Layer
 * SHORTCUT-002: Cross-Platform Platform Resolver & Normalization
 */

import type { NormalizedShortcut, ShortcutBinding, ShortcutPlatform } from './types';

export type { ShortcutPlatform };

/**
 * Detects the active host operating system.
 * Supports explicit dependency injection via `customEnv` for deterministic testing.
 */
export function detectPlatform(customEnv?: {
  userAgent?: string;
  platform?: string;
}): ShortcutPlatform {
  const ua =
    customEnv?.userAgent ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '');

  if (ua) {
    if (/Mac|iPod|iPhone|iPad/i.test(ua)) return 'macos';
    if (/Win/i.test(ua)) return 'windows';
    if (/Linux|X11/i.test(ua)) return 'linux';
  }

  const procPlatform =
    customEnv?.platform ??
    (typeof globalThis !== 'undefined'
      ? (globalThis as { process?: { platform?: string } }).process?.platform
      : undefined);

  if (procPlatform) {
    if (procPlatform === 'darwin') return 'macos';
    if (procPlatform === 'win32') return 'windows';
    if (procPlatform === 'linux') return 'linux';
  }

  return 'macos'; // Default to macOS if completely unknown
}

/**
 * Convenience helper returning whether the platform is macOS.
 * Backward compatible with existing call sites that pass nothing or a boolean.
 */
export function isMacPlatform(
  platformOrIsMac?: ShortcutPlatform | boolean,
): boolean {
  if (typeof platformOrIsMac === 'boolean') {
    return platformOrIsMac;
  }
  const platform = platformOrIsMac ?? detectPlatform();
  return platform === 'macos';
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
  if (trimmed === 'delete' || trimmed === 'del') return 'delete';
  if (trimmed === 'pageup') return 'pageup';
  if (trimmed === 'pagedown') return 'pagedown';
  if (trimmed === '[' || trimmed === 'bracketleft' || code === 'BracketLeft') return '[';
  if (trimmed === ']' || trimmed === 'bracketright' || code === 'BracketRight') return ']';
  if (trimmed === '/' || trimmed === 'slash' || code === 'Slash') return '/';
  if (trimmed === '\\' || trimmed === 'backslash' || code === 'Backslash') return '\\';
  if (trimmed === '-' || trimmed === 'minus' || code === 'Minus') return '-';
  if (trimmed === '=' || trimmed === 'equal' || code === 'Equal') return '=';
  if (/^f[1-9][0-2]?$/i.test(trimmed)) return trimmed.toLowerCase();

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

function resolvePlatform(platformOrIsMac?: ShortcutPlatform | boolean): ShortcutPlatform {
  if (typeof platformOrIsMac === 'boolean') {
    return platformOrIsMac ? 'macos' : 'windows';
  }
  return platformOrIsMac ?? detectPlatform();
}

/**
 * Formats a ShortcutBinding into a platform-appropriate display string.
 * macOS: ⌘1, ⌃C, ⌥⇧1, ⌘⇧D
 * Windows: Ctrl+1, Alt+1, Ctrl+Shift+W, Win+D
 * Linux: Ctrl+1, Alt+1, Ctrl+Shift+W, Super+D
 */
export function formatShortcutDisplay(
  binding: ShortcutBinding,
  platformOrIsMac?: ShortcutPlatform | boolean,
): string {
  if (!binding || !binding.key) return '';

  const platform = resolvePlatform(platformOrIsMac);
  const keyDisplay = formatKeyDisplay(normalizeKey(binding.key));

  if (platform === 'macos') {
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
    if (binding.meta) parts.push(platform === 'linux' ? 'Super' : 'Win');
    parts.push(keyDisplay);
    return parts.join('+');
  }
}

/**
 * Generates an accessible aria-label for a shortcut.
 * E.g., \"Command 1\", \"Control 1\", or \"Super 1\".
 */
export function formatShortcutAriaLabel(
  binding: ShortcutBinding,
  platformOrIsMac?: ShortcutPlatform | boolean,
): string {
  if (!binding || !binding.key) return '';

  const platform = resolvePlatform(platformOrIsMac);
  const keyName = binding.key.toUpperCase();
  const parts: string[] = [];

  if (platform === 'macos') {
    if (binding.ctrl) parts.push('Control');
    if (binding.alt) parts.push('Option');
    if (binding.shift) parts.push('Shift');
    if (binding.meta) parts.push('Command');
  } else {
    if (binding.ctrl) parts.push('Control');
    if (binding.alt) parts.push('Alt');
    if (binding.shift) parts.push('Shift');
    if (binding.meta) parts.push(platform === 'linux' ? 'Super' : 'Windows');
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

/**
 * Parses a textual chord string (e.g. 'Cmd+Shift+P', 'Meta+1', 'ctrl+alt+delete')
 * into a canonical ShortcutBinding object.
 */
export function parseShortcutChord(chord: string): ShortcutBinding | null {
  if (!chord || typeof chord !== 'string') return null;
  const trimmed = chord.trim();
  if (!trimmed) return null;

  const tokens: string[] = trimmed.endsWith('++')
    ? [...trimmed.slice(0, -2).split(/[+-]/).filter(Boolean), '+']
    : trimmed.split(/[+-]/).filter(Boolean);

  let meta = false;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let keyToken: string | null = null;

  for (const token of tokens) {
    const t = token.trim().toLowerCase();
    if (
      t === 'cmd' ||
      t === 'command' ||
      t === 'meta' ||
      t === 'super' ||
      t === 'win' ||
      t === 'windows' ||
      t === '⌘'
    ) {
      meta = true;
    } else if (t === 'ctrl' || t === 'control' || t === '⌃') {
      ctrl = true;
    } else if (t === 'alt' || t === 'opt' || t === 'option' || t === '⌥') {
      alt = true;
    } else if (t === 'shift' || t === '⇧') {
      shift = true;
    } else {
      keyToken = token.trim();
    }
  }

  if (!keyToken) {
    return null;
  }

  const key = normalizeKey(keyToken);
  return {
    key,
    ...(meta ? { meta: true } : {}),
    ...(ctrl ? { ctrl: true } : {}),
    ...(alt ? { alt: true } : {}),
    ...(shift ? { shift: true } : {}),
  };
}

/**
 * Returns a deterministic, canonical string representation of a ShortcutBinding:
 * e.g., 'Meta+Shift+P', 'Ctrl+1'.
 */
export function formatCanonicalChord(binding: ShortcutBinding): string {
  if (!binding || !binding.key) return '';
  const parts: string[] = [];
  if (binding.meta) parts.push('Meta');
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(normalizeKey(binding.key).toUpperCase());
  return parts.join('+');
}

/**
 * Compares two shortcut chords or bindings for canonical equivalence.
 * e.g. 'Cmd+Shift+P' equals 'Meta+Shift+P'
 */
export function areChordsEquivalent(
  a: string | ShortcutBinding,
  b: string | ShortcutBinding,
): boolean {
  const bindingA = typeof a === 'string' ? parseShortcutChord(a) : a;
  const bindingB = typeof b === 'string' ? parseShortcutChord(b) : b;
  if (!bindingA || !bindingB) return false;
  return areBindingsEqual(bindingA, bindingB);
}
