/**
 * Versioned Shortcut Settings Persistence
 * HARDEN-010
 *
 * Persists user overrides only. Defaults are never stored to allow default
 * evolution across versions. Invalid/corrupted settings degrade safely without crashing.
 *
 * Includes deterministic migration from legacy 1–7 bindings (focus-capture/focus-evidence)
 * to consolidated 1–6 bindings (focus-capture-evidence).
 */

import type { AppCommand, KeyboardShortcutSettings, ShortcutBinding } from './types';
import { ORDERED_APP_COMMANDS } from './types';
import { normalizeKey } from './shortcutNormalization';

export const SHORTCUT_SETTINGS_STORAGE_KEY = 'execrelay:keyboard_shortcuts:v1';
export const LEGACY_SHORTCUT_SETTINGS_STORAGE_KEY = 'tracerelay:keyboard_shortcuts:v1';

export function createEmptyShortcutSettings(): KeyboardShortcutSettings {
  return {
    version: 1,
    bindings: {},
  };
}

/**
 * Validates, sanitizes, and migrates a raw parsed settings object.
 *
 * Migration rule (HARDEN-010):
 * If the legacy commands 'focus-capture' or 'focus-evidence' exist:
 * 1. If 'focus-capture-evidence' already has an override, preserve it.
 * 2. Otherwise, if 'focus-evidence' has an override, migrate it to 'focus-capture-evidence'.
 * 3. Otherwise, if 'focus-capture' has an override, migrate it to 'focus-capture-evidence'.
 * 4. Deprecated keys ('focus-capture', 'focus-evidence') are omitted from cleanBindings.
 */
export function sanitizeShortcutSettings(raw: unknown): KeyboardShortcutSettings {
  if (!raw || typeof raw !== 'object') {
    return createEmptyShortcutSettings();
  }

  const candidate = raw as { version?: unknown; bindings?: unknown };
  if (candidate.version !== 1 || !candidate.bindings || typeof candidate.bindings !== 'object') {
    return createEmptyShortcutSettings();
  }

  const cleanBindings: Partial<Record<AppCommand, ShortcutBinding>> = {};
  const rawBindings = candidate.bindings as Record<string, unknown>;

  const parseBinding = (rawB: unknown): ShortcutBinding | null => {
    if (rawB && typeof rawB === 'object') {
      const b = rawB as Record<string, unknown>;
      if (typeof b.key === 'string' && b.key.trim().length > 0) {
        return {
          key: normalizeKey(b.key),
          ...(b.meta ? { meta: true } : {}),
          ...(b.ctrl ? { ctrl: true } : {}),
          ...(b.alt ? { alt: true } : {}),
          ...(b.shift ? { shift: true } : {}),
        };
      }
    }
    return null;
  };

  // 1. Process standard current commands
  for (const cmd of ORDERED_APP_COMMANDS) {
    const parsed = parseBinding(rawBindings[cmd]);
    if (parsed) {
      cleanBindings[cmd] = parsed;
    }
  }

  // 2. Migration precedence for legacy 'focus-capture' and 'focus-evidence'
  if (!cleanBindings['focus-capture-evidence']) {
    const legacyEvidence = parseBinding(rawBindings['focus-evidence']);
    const legacyCapture = parseBinding(rawBindings['focus-capture']);

    if (legacyEvidence) {
      cleanBindings['focus-capture-evidence'] = legacyEvidence;
    } else if (legacyCapture) {
      cleanBindings['focus-capture-evidence'] = legacyCapture;
    }
  }

  return {
    version: 1,
    bindings: cleanBindings,
  };
}

/**
 * Loads persisted shortcut settings from localStorage safely.
 */
export function loadShortcutSettings(): KeyboardShortcutSettings {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return createEmptyShortcutSettings();
    }
    let isLegacy = false;
    let raw = window.localStorage.getItem(SHORTCUT_SETTINGS_STORAGE_KEY);
    if (!raw) {
      raw = window.localStorage.getItem(LEGACY_SHORTCUT_SETTINGS_STORAGE_KEY);
      if (raw) isLegacy = true;
    }
    if (!raw) {
      return createEmptyShortcutSettings();
    }
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeShortcutSettings(parsed);
    if (isLegacy && Object.keys(sanitized.bindings).length > 0) {
      try {
        window.localStorage.setItem(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
      } catch {
        // Ignore write errors during migration
      }
    }
    return sanitized;
  } catch {
    // Fail safely on corrupt JSON or blocked storage
    return createEmptyShortcutSettings();
  }
}

/**
 * Saves shortcut settings to localStorage safely.
 */
export function saveShortcutSettings(settings: KeyboardShortcutSettings): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const sanitized = sanitizeShortcutSettings(settings);
    window.localStorage.setItem(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage quota or access errors safely
  }
}

/**
 * Clears user shortcut overrides from localStorage (Restore defaults).
 */
export function clearShortcutSettings(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    window.localStorage.removeItem(SHORTCUT_SETTINGS_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_SHORTCUT_SETTINGS_STORAGE_KEY);
  } catch {
    // Ignore errors safely
  }
}
