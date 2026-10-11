/**
 * Versioned Shortcut Settings Persistence
 * SHORTCUT-002: Platform-Segregated V2 Persistence & V1 Migration
 *
 * Persists user overrides partitioned by operating system platform:
 * {
 *   version: 2,
 *   overrides: {
 *     macos: { ... },
 *     windows: { ... },
 *     linux: { ... }
 *   }
 * }
 *
 * Defaults are never stored to allow default evolution across versions.
 * Existing stored values are treated as explicit user overrides. Historical defaults cannot be
 * distinguished from intentional customizations in this schema, so they are preserved.
 * Invalid/corrupted settings degrade safely without crashing.
 */

import type {
  AppCommand,
  KeyboardShortcutSettingsV1,
  KeyboardShortcutSettingsV2,
  ShortcutBinding,
  ShortcutPlatform,
} from './types';
import { ALL_CONFIGURABLE_COMMANDS } from './types';
import { detectPlatform, normalizeKey } from './shortcutNormalization';

export const SHORTCUT_SETTINGS_STORAGE_KEY = 'execrelay:keyboard_shortcuts:v1';
export const V1_STORAGE_KEY = 'execrelay:keyboard_shortcuts:v1';
export const LEGACY_SHORTCUT_SETTINGS_STORAGE_KEY = 'tracerelay:keyboard_shortcuts:v1';

export function createEmptyShortcutSettings(): {
  version: 1;
  bindings: Record<string, never>;
} {
  return {
    version: 1,
    bindings: {},
  };
}

function parseBinding(rawB: unknown): ShortcutBinding | null {
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
}

function sanitizePlatformMap(
  rawMap: unknown,
): Partial<Record<AppCommand, ShortcutBinding>> {
  if (!rawMap || typeof rawMap !== 'object') {
    return {};
  }
  const clean: Partial<Record<AppCommand, ShortcutBinding>> = {};
  const rawRecord = rawMap as Record<string, unknown>;

  for (const cmd of ALL_CONFIGURABLE_COMMANDS) {
    const parsed = parseBinding(rawRecord[cmd]);
    if (parsed) {
      clean[cmd] = parsed;
    }
  }

  // Handle legacy 1-7 capture/evidence migration
  if (!clean['focus-capture-evidence']) {
    const legacyEvidence = parseBinding(rawRecord['focus-evidence']);
    const legacyCapture = parseBinding(rawRecord['focus-capture']);

    if (legacyEvidence) {
      clean['focus-capture-evidence'] = legacyEvidence;
    } else if (legacyCapture) {
      clean['focus-capture-evidence'] = legacyCapture;
    }
  }

  return clean;
}

/**
 * Validates, sanitizes, and migrates raw parsed settings data.
 * - If V2: validates overrides per platform, ignores unknown command IDs.
 * - If V1: safely migrates machine-local flat bindings to clean V1 bindings.
 * - If malformed: safely returns empty V1 fallback.
 */
export function sanitizeShortcutSettings(
  raw: unknown,
  currentPlatform: ShortcutPlatform = detectPlatform(),
): KeyboardShortcutSettingsV2 | KeyboardShortcutSettingsV1 {
  if (!raw || typeof raw !== 'object') {
    return createEmptyShortcutSettings();
  }

  const candidate = raw as {
    version?: unknown;
    overrides?: unknown;
    bindings?: unknown;
  };

  // Case 1: Version 2 schema (Platform-partitioned)
  if (candidate.version === 2 && candidate.overrides && typeof candidate.overrides === 'object') {
    const rawOverrides = candidate.overrides as Record<string, unknown>;
    const cleanOverrides: KeyboardShortcutSettingsV2['overrides'] = {};

    // Standard platforms
    for (const p of ['macos', 'windows', 'linux'] as const) {
      if (rawOverrides[p]) {
        cleanOverrides[p] = sanitizePlatformMap(rawOverrides[p]);
      }
    }

    // Preserve unknown forward platforms safely without crashing
    for (const [key, val] of Object.entries(rawOverrides)) {
      if (key !== 'macos' && key !== 'windows' && key !== 'linux' && val && typeof val === 'object') {
        (cleanOverrides as Record<string, unknown>)[key] = val;
      }
    }

    return {
      version: 2,
      overrides: cleanOverrides,
      bindings: cleanOverrides[currentPlatform] ? { ...cleanOverrides[currentPlatform] } : {},
    };
  }

  // Case 2: Version 1 schema (Flat machine-local bindings)
  if (candidate.version === 1 && candidate.bindings && typeof candidate.bindings === 'object') {
    const cleanBindings = sanitizePlatformMap(candidate.bindings);
    return {
      version: 1,
      bindings: cleanBindings,
    };
  }

  // Fallback for malformed / unrecognized inputs
  return createEmptyShortcutSettings();
}

/**
 * Loads persisted shortcut settings from localStorage safely.
 * Performs automatic one-way, idempotent migration from V1 to V2.
 */
export function loadShortcutSettings(
  currentPlatform: ShortcutPlatform = detectPlatform(),
): KeyboardShortcutSettingsV2 {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {
        version: 2,
        overrides: { macos: {}, windows: {}, linux: {} },
        bindings: {},
      };
    }

    let isLegacy = false;
    let raw = window.localStorage.getItem(SHORTCUT_SETTINGS_STORAGE_KEY);

    if (!raw) {
      raw = window.localStorage.getItem(LEGACY_SHORTCUT_SETTINGS_STORAGE_KEY);
      if (raw) isLegacy = true;
    }

    if (!raw) {
      return {
        version: 2,
        overrides: { macos: {}, windows: {}, linux: {} },
        bindings: {},
      };
    }

    const parsed = JSON.parse(raw);
    const sanitized = sanitizeShortcutSettings(parsed, currentPlatform);

    // If loaded from V1 or legacy, migrate to V2 in canonical storage key
    if (sanitized.version === 1 || isLegacy) {
      const v2Settings: KeyboardShortcutSettingsV2 = {
        version: 2,
        overrides: {
          macos: {},
          windows: {},
          linux: {},
          [currentPlatform]: { ...sanitized.bindings },
        },
        bindings: { ...sanitized.bindings },
      };
      try {
        window.localStorage.setItem(
          SHORTCUT_SETTINGS_STORAGE_KEY,
          JSON.stringify(v2Settings),
        );
      } catch {
        // Ignore write errors during migration
      }
      return v2Settings;
    }

    return sanitized as KeyboardShortcutSettingsV2;
  } catch {
    // Fail safely on corrupt JSON or blocked storage
    return {
      version: 2,
      overrides: { macos: {}, windows: {}, linux: {} },
      bindings: {},
    };
  }
}

/**
 * Saves shortcut settings to localStorage safely in V2 schema.
 */
export function saveShortcutSettings(
  settings: KeyboardShortcutSettingsV2 | KeyboardShortcutSettingsV1,
  currentPlatform: ShortcutPlatform = detectPlatform(),
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    let payload: KeyboardShortcutSettingsV2;
    if (settings.version === 2 && 'overrides' in settings) {
      const sanitized = sanitizeShortcutSettings(settings, currentPlatform);
      if (sanitized.version === 2) {
        payload = {
          version: 2,
          overrides: sanitized.overrides,
          bindings: sanitized.overrides[currentPlatform] ? { ...sanitized.overrides[currentPlatform] } : {},
        };
      } else {
        payload = {
          version: 2,
          overrides: {
            macos: {},
            windows: {},
            linux: {},
            [currentPlatform]: sanitized.bindings,
          },
          bindings: sanitized.bindings,
        };
      }
    } else {
      const clean = sanitizePlatformMap((settings as KeyboardShortcutSettingsV1).bindings);
      payload = {
        version: 2,
        overrides: {
          macos: {},
          windows: {},
          linux: {},
          [currentPlatform]: clean,
        },
        bindings: clean,
      };
    }

    window.localStorage.setItem(
      SHORTCUT_SETTINGS_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Ignore storage quota or access errors safely
  }
}

/**
 * Loads user overrides for a specific platform.
 */
export function loadPlatformOverrides(
  platform: ShortcutPlatform = detectPlatform(),
): Partial<Record<AppCommand, ShortcutBinding>> {
  const settings = loadShortcutSettings(platform);
  return settings.overrides[platform] ? { ...settings.overrides[platform] } : {};
}

/**
 * Saves user overrides for a specific platform without altering other platforms.
 */
export function savePlatformOverrides(
  platform: ShortcutPlatform,
  overrides: Partial<Record<AppCommand, ShortcutBinding>>,
): void {
  const current = loadShortcutSettings(platform);
  const nextOverrides = { ...current.overrides };
  nextOverrides[platform] = { ...overrides };
  saveShortcutSettings(
    {
      version: 2,
      overrides: nextOverrides,
    },
    platform,
  );
}

/**
 * Clears user overrides for a specific platform only (Restore defaults on active OS).
 */
export function clearPlatformOverrides(
  platform: ShortcutPlatform = detectPlatform(),
): void {
  const current = loadShortcutSettings(platform);
  const nextOverrides = { ...current.overrides };
  delete nextOverrides[platform];
  const hasRemaining = Object.values(nextOverrides).some(
    (m) => m && Object.keys(m).length > 0,
  );
  if (!hasRemaining) {
    clearShortcutSettings();
  } else {
    saveShortcutSettings(
      {
        version: 2,
        overrides: nextOverrides,
      },
      platform,
    );
  }
}

/**
 * Clears all shortcut overrides across all platforms (Hard Reset).
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
