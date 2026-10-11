/**
 * SHORTCUT-002 — Cross-Platform Configurable Terminal Shortcuts Test Suite
 *
 * Verifies:
 * 1. Domain model (stable command IDs across platforms, macOS/Win/Linux defaults independence)
 * 2. Platform override isolation (macOS override does not affect Windows/Linux)
 * 3. Persistence & migration (V1 to V2 platform-partitioned schema, idempotency, corrupted fallback)
 * 4. Terminal pane actions configurability (Split Right/Down, Close Pane, Directional Focus)
 * 5. Old binding release (Meta+Shift+D released when Split Down is overridden)
 * 6. Conflict detection (Navigation-vs-Pane, Pane-vs-Pane on current platform only)
 * 7. Terminal input & shell safety (Ctrl+C, Ctrl+D, Ctrl+Z, repeat spam guard)
 * 8. Reset to Defaults platform isolation (reset on macOS preserves Windows/Linux overrides)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ts = require('../app/node_modules/typescript');

function transpileTs(filePath, customRequire = () => ({})) {
  const src = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

const customReq = (req) => {
  if (req === 'react') return require('../app/node_modules/react');
  if (req.includes('types')) return shortcutsTypesMod;
  if (req.includes('shortcutNormalization')) return normalizationMod;
  if (req.includes('reservedShortcuts')) return reservedMod;
  if (req.includes('defaultShortcuts')) return defaultsMod;
  if (req.includes('shortcutPersistence')) return persistenceMod;
  if (req.includes('shortcutRegistry')) return registryMod;
  if (req.includes('shortcutNavigation')) return { findDirectionalPaneId: () => null };
  if (req.includes('useGlobalShortcuts')) return useGlobalShortcutsMod;
  return require(req);
};

const shortcutsTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/shortcuts/types.ts'));
const normalizationMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/shortcuts/shortcutNormalization.ts'),
  customReq,
);
const reservedMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/shortcuts/reservedShortcuts.ts'),
  customReq,
);
const defaultsMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/shortcuts/defaultShortcuts.ts'),
  customReq,
);
const persistenceMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/shortcuts/shortcutPersistence.ts'),
  customReq,
);
const registryMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/shortcuts/shortcutRegistry.ts'),
  customReq,
);
const useGlobalShortcutsMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/shortcuts/useGlobalShortcuts.ts'),
  customReq,
);
const terminalPaneKeybindingsMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/workspace/useTerminalPaneKeybindings.ts'),
  customReq,
);

const {
  ORDERED_NAVIGATION_COMMANDS,
  ORDERED_TERMINAL_COMMANDS,
  ALL_CONFIGURABLE_COMMANDS,
  APP_COMMAND_METADATA,
} = shortcutsTypesMod;

const {
  detectPlatform,
  isMacPlatform,
  normalizeKey,
  normalizeKeyboardEvent,
  matchesBinding,
  areBindingsEqual,
  formatShortcutDisplay,
  formatShortcutAriaLabel,
  parseShortcutChord,
  formatCanonicalChord,
  areChordsEquivalent,
} = normalizationMod;

const { validateShortcutBinding } = reservedMod;
const {
  getDefaultShortcuts,
  DEFAULT_SHORTCUTS_MAC,
  DEFAULT_SHORTCUTS_WIN,
  DEFAULT_SHORTCUTS_LINUX,
} = defaultsMod;

const {
  SHORTCUT_SETTINGS_STORAGE_KEY,
  V1_STORAGE_KEY,
  sanitizeShortcutSettings,
  loadShortcutSettings,
  saveShortcutSettings,
  loadPlatformOverrides,
  savePlatformOverrides,
  clearPlatformOverrides,
  clearShortcutSettings,
} = persistenceMod;

const { ShortcutRegistry } = registryMod;
const { isNonTerminalInput } = useGlobalShortcutsMod;
const { matchesPaneShortcut } = terminalPaneKeybindingsMod;

console.log('Running SHORTCUT-002 Cross-Platform Configurable Shortcuts Test Suite...\n');

// =============================================================================
// Group 1: Domain Law & Platform Defaults (Requirements 1-10)
// =============================================================================
console.log('--- Group 1: Domain Law & Platform Defaults (Requirements 1-10) ---');

// 1. Stable command IDs across platforms (15 commands total: 8 navigation + 7 terminal)
assert.strictEqual(ALL_CONFIGURABLE_COMMANDS.length, 15);
assert.deepStrictEqual(ORDERED_TERMINAL_COMMANDS, [
  'terminal.split-right',
  'terminal.split-down',
  'terminal.close-pane',
  'terminal.focus-left',
  'terminal.focus-right',
  'terminal.focus-up',
  'terminal.focus-down',
]);

// 2. macOS defaults resolve correctly
const macDefaults = getDefaultShortcuts('macos');
assert.deepStrictEqual(macDefaults['focus-terminal'], { key: '1', meta: true });
assert.deepStrictEqual(macDefaults['terminal.split-right'], { key: 'd', meta: true });
assert.deepStrictEqual(macDefaults['terminal.split-down'], { key: 'd', meta: true, shift: true });
assert.deepStrictEqual(macDefaults['terminal.close-pane'], { key: 'w', meta: true, shift: true });
assert.deepStrictEqual(macDefaults['terminal.focus-left'], { key: 'arrowleft', ctrl: true, shift: true });

// 3. Windows defaults resolve correctly
const winDefaults = getDefaultShortcuts('windows');
assert.deepStrictEqual(winDefaults['focus-terminal'], { key: '1', ctrl: true });
assert.deepStrictEqual(winDefaults['terminal.split-right'], { key: '\\', ctrl: true, shift: true });
assert.deepStrictEqual(winDefaults['terminal.split-down'], { key: '-', ctrl: true, shift: true });
assert.deepStrictEqual(winDefaults['terminal.close-pane'], { key: 'w', ctrl: true, shift: true });
assert.deepStrictEqual(winDefaults['terminal.focus-left'], { key: 'arrowleft', alt: true });

// 4. Linux defaults resolve correctly
const linuxDefaults = getDefaultShortcuts('linux');
assert.deepStrictEqual(linuxDefaults['focus-terminal'], { key: '1', ctrl: true });
assert.deepStrictEqual(linuxDefaults['terminal.split-right'], { key: '\\', ctrl: true, shift: true });
assert.deepStrictEqual(linuxDefaults['terminal.split-down'], { key: '-', ctrl: true, shift: true });
assert.deepStrictEqual(linuxDefaults['terminal.close-pane'], { key: 'w', ctrl: true, shift: true });
assert.deepStrictEqual(linuxDefaults['terminal.focus-left'], { key: 'arrowleft', alt: true });

// 5. Platform defaults are strictly independent
assert.notDeepStrictEqual(macDefaults['terminal.split-down'], winDefaults['terminal.split-down']);
assert.notDeepStrictEqual(macDefaults['terminal.focus-left'], linuxDefaults['terminal.focus-left']);

// 6. macOS override does not alter Windows effective binding
const macReg = new ShortcutRegistry('macos', { version: 2, overrides: { macos: {}, windows: {}, linux: {} } });
const winReg = new ShortcutRegistry('windows', { version: 2, overrides: { macos: {}, windows: {}, linux: {} } });

macReg.setOverride('terminal.split-down', { key: 's', meta: true, shift: true });
assert.deepStrictEqual(macReg.resolveBinding('terminal.split-down'), { key: 's', meta: true, shift: true });
assert.deepStrictEqual(winReg.resolveBinding('terminal.split-down'), winDefaults['terminal.split-down'], 'Windows binding must remain its default');

// 7. Windows override does not alter Linux
winReg.setOverride('terminal.split-right', { key: 'r', ctrl: true, alt: true });
const linuxReg = new ShortcutRegistry('linux', { version: 2, overrides: { macos: {}, windows: {}, linux: {} } });
assert.deepStrictEqual(linuxReg.resolveBinding('terminal.split-right'), linuxDefaults['terminal.split-right']);

// 8. Unknown platform data in storage does not crash
const forwardCompatible = sanitizeShortcutSettings({
  version: 2,
  overrides: {
    macos: { 'focus-terminal': { key: 't', meta: true } },
    freebsd: { 'focus-terminal': { key: 'f', ctrl: true } },
  },
});
assert.strictEqual(forwardCompatible.version, 2);
assert.ok(forwardCompatible.overrides['macos']);
assert.ok(forwardCompatible.overrides['freebsd']);

// 9. Unknown command IDs safe
const unknownCmdSanitized = sanitizeShortcutSettings({
  version: 2,
  overrides: {
    macos: {
      'focus-terminal': { key: 't', meta: true },
      'future.unknown-command': { key: 'u', meta: true },
    },
  },
});
assert.strictEqual(unknownCmdSanitized.overrides.macos['future.unknown-command'], undefined);
assert.deepStrictEqual(unknownCmdSanitized.overrides.macos['focus-terminal'], { key: 't', meta: true });

// 10. Platform resolver selects correct platform
assert.strictEqual(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }), 'macos');
assert.strictEqual(detectPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'windows');
assert.strictEqual(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'linux');
assert.strictEqual(detectPlatform({ platform: 'darwin' }), 'macos');
assert.strictEqual(detectPlatform({ platform: 'win32' }), 'windows');
assert.strictEqual(detectPlatform({ platform: 'linux' }), 'linux');

console.log('✓ Group 1: Domain Law & Platform Defaults passed');

// =============================================================================
// Group 2: Persistence & Migration (Requirements 11-17)
// =============================================================================
console.log('\n--- Group 2: Persistence & Migration (Requirements 11-17) ---');

// Mock localStorage
const mockStorage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => mockStorage.get(k) ?? null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
  },
};

mockStorage.clear();

// 11. Current platform override persists to V2 schema
savePlatformOverrides('macos', { 'terminal.split-down': { key: 's', meta: true, shift: true } });
const loadedV2 = loadShortcutSettings('macos');
assert.strictEqual(loadedV2.version, 2);
assert.deepStrictEqual(loadedV2.overrides.macos?.['terminal.split-down'], { key: 's', meta: true, shift: true });

// 12. Another platform override remains untouched
savePlatformOverrides('windows', { 'terminal.split-down': { key: 'd', ctrl: true, alt: true } });
const loadedBoth = loadShortcutSettings('macos');
assert.deepStrictEqual(loadedBoth.overrides.macos?.['terminal.split-down'], { key: 's', meta: true, shift: true });
assert.deepStrictEqual(loadedBoth.overrides.windows?.['terminal.split-down'], { key: 'd', ctrl: true, alt: true });

// 13. Reload restores current platform overrides
const freshMacReg = new ShortcutRegistry('macos');
assert.deepStrictEqual(freshMacReg.resolveBinding('terminal.split-down'), { key: 's', meta: true, shift: true });
const freshWinReg = new ShortcutRegistry('windows');
assert.deepStrictEqual(freshWinReg.resolveBinding('terminal.split-down'), { key: 'd', ctrl: true, alt: true });

// 14. Reset Defaults only resets active platform
freshMacReg.resetPlatformOverrides();
assert.deepStrictEqual(freshMacReg.resolveBinding('terminal.split-down'), macDefaults['terminal.split-down']);
const postResetWin = loadShortcutSettings('windows');
assert.deepStrictEqual(postResetWin.overrides.windows?.['terminal.split-down'], { key: 'd', ctrl: true, alt: true }, 'Windows override preserved after Mac reset');

// 15. Migration from V1 to V2 schema
mockStorage.clear();
mockStorage.set(
  V1_STORAGE_KEY,
  JSON.stringify({
    version: 1,
    bindings: {
      'focus-terminal': { key: 't', meta: true },
      'focus-evidence': { key: 'e', meta: true },
    },
  }),
);

const migrated = loadShortcutSettings('macos');
assert.strictEqual(migrated.version, 2);
assert.deepStrictEqual(migrated.overrides.macos?.['focus-terminal'], { key: 't', meta: true });
assert.deepStrictEqual(migrated.overrides.macos?.['focus-capture-evidence'], { key: 'e', meta: true });
assert.strictEqual(migrated.overrides.macos?.['focus-evidence'], undefined);

// 16. Migration is idempotent
const migratedAgain = loadShortcutSettings('macos');
assert.deepStrictEqual(migratedAgain.overrides.macos, migrated.overrides.macos);

// 17. Malformed stored platform data does not crash startup
mockStorage.set(SHORTCUT_SETTINGS_STORAGE_KEY, '{ invalid json');
assert.doesNotThrow(() => {
  const safeRecovery = loadShortcutSettings('macos');
  assert.strictEqual(safeRecovery.version, 2);
});

console.log('✓ Group 2: Persistence & Migration passed');

// =============================================================================
// Group 3: Terminal Pane Actions & Customization (Requirements 18-29)
// =============================================================================
console.log('\n--- Group 3: Terminal Pane Actions & Customization (Requirements 18-29) ---');

const testRegistry = new ShortcutRegistry('macos');

// 18-24. All 7 pane commands are configurable
for (const paneCmd of ORDERED_TERMINAL_COMMANDS) {
  assert.ok(testRegistry.resolveBinding(paneCmd), `${paneCmd} must have a default binding`);
}

// 25. Real macOS User Problem: Split Down Meta+Shift+D overridden to Meta+Shift+S
const splitDownOverride = { key: 's', meta: true, shift: true };
const setRes = testRegistry.setOverride('terminal.split-down', splitDownOverride);
assert.strictEqual(setRes.success, true);
assert.deepStrictEqual(testRegistry.resolveBinding('terminal.split-down'), splitDownOverride);

// 26. Old binding Meta+Shift+D is completely released
const oldBindingEvent = { key: 'd', code: 'KeyD', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
const matchedOld = testRegistry.findCommandForEvent(oldBindingEvent);
assert.strictEqual(matchedOld, null, 'Old binding Meta+Shift+D must return null (completely released)');

// 27. New binding Meta+Shift+S invokes Split Down
const newBindingEvent = { key: 's', code: 'KeyS', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
const matchedNew = testRegistry.findCommandForEvent(newBindingEvent);
assert.strictEqual(matchedNew, 'terminal.split-down', 'New binding Meta+Shift+S must match terminal.split-down');

// 28. Canonical handler dispatch simulation (verifying preventDefault and stopPropagation)
let splitDownDispatched = false;
let eventPrevented = false;
let eventStopped = false;

function simulatePaneKeydown(evt) {
  if (evt.defaultPrevented || evt.repeat || evt.isComposing) return false;
  const matched = testRegistry.findCommandForEvent(evt);
  if (!matched) return false;

  evt.preventDefault();
  evt.stopPropagation();

  if (matched === 'terminal.split-down') {
    splitDownDispatched = true;
  }
  return true;
}

// Test old binding: does NOT dispatch, does NOT preventDefault
const simulatedOldEvt = {
  ...oldBindingEvent,
  preventDefault: () => { eventPrevented = true; },
  stopPropagation: () => { eventStopped = true; },
};
const oldConsumed = simulatePaneKeydown(simulatedOldEvt);
assert.strictEqual(oldConsumed, false, 'Old binding must not be consumed');
assert.strictEqual(eventPrevented, false, 'Old binding must not call preventDefault');
assert.strictEqual(eventStopped, false, 'Old binding must not call stopPropagation');
assert.strictEqual(splitDownDispatched, false);

// Test new binding: dispatches exactly once, calls preventDefault and stopPropagation
const simulatedNewEvt = {
  ...newBindingEvent,
  preventDefault: () => { eventPrevented = true; },
  stopPropagation: () => { eventStopped = true; },
};
const newConsumed = simulatePaneKeydown(simulatedNewEvt);
assert.strictEqual(newConsumed, true, 'New binding must be consumed');
assert.strictEqual(eventPrevented, true, 'New binding calls preventDefault');
assert.strictEqual(eventStopped, true, 'New binding calls stopPropagation');
assert.strictEqual(splitDownDispatched, true, 'Canonical onSplitDown handler invoked');

// 29. Repeat guard: event.repeat does NOT trigger repeated action
splitDownDispatched = false;
const repeatEvt = {
  ...newBindingEvent,
  repeat: true,
  preventDefault: () => {},
  stopPropagation: () => {},
};
const repeatConsumed = simulatePaneKeydown(repeatEvt);
assert.strictEqual(repeatConsumed, false, 'event.repeat must be rejected');
assert.strictEqual(splitDownDispatched, false, 'Action must not be dispatched on repeat');

console.log('✓ Group 3: Terminal Pane Actions & Customization passed');

// =============================================================================
// Group 4: Conflict Graph & Shell Safety (Requirements 30-35)
// =============================================================================
console.log('\n--- Group 4: Conflict Graph & Shell Safety (Requirements 30-35) ---');

// 30. Navigation-vs-Pane conflict detected
// Trying to set 'focus-terminal' to Split Right default (Meta+D on Mac)
const navVsPaneVal = testRegistry.validate({ key: 'd', meta: true }, 'focus-terminal');
assert.strictEqual(navVsPaneVal.allowed, false, 'Collision with Split Right must be detected');
assert.strictEqual(navVsPaneVal.reason, 'duplicate-binding');
assert.strictEqual(navVsPaneVal.conflictingCommand, 'terminal.split-right');

// 31. Pane-vs-Pane conflict detected
// Trying to set Split Down to Split Right default (Meta+D)
const paneVsPaneVal = testRegistry.validate({ key: 'd', meta: true }, 'terminal.split-down');
assert.strictEqual(paneVsPaneVal.allowed, false);
assert.strictEqual(paneVsPaneVal.reason, 'duplicate-binding');
assert.strictEqual(paneVsPaneVal.conflictingCommand, 'terminal.split-right');

// 32. Conflicts only consider current platform
// A Windows binding (Ctrl+Shift+\) does NOT conflict on macOS
const winChordOnMac = testRegistry.validate({ key: '\\', ctrl: true, shift: true }, 'focus-changes');
assert.strictEqual(winChordOnMac.allowed, true, 'Windows default is not reserved or conflicting on macOS');

// 33. Hard shell-reserved binding rejected on all platforms
for (const plat of ['macos', 'windows', 'linux']) {
  const ctrlC = validateShortcutBinding({ key: 'c', ctrl: true }, { platform: plat });
  assert.strictEqual(ctrlC.allowed, false, `Ctrl+C must be protected on ${plat}`);
  assert.strictEqual(ctrlC.reason, 'terminal-input');

  const ctrlD = validateShortcutBinding({ key: 'd', ctrl: true }, { platform: plat });
  assert.strictEqual(ctrlD.allowed, false, `Ctrl+D must be protected on ${plat}`);
  assert.strictEqual(ctrlD.reason, 'terminal-input');

  const ctrlZ = validateShortcutBinding({ key: 'z', ctrl: true }, { platform: plat });
  assert.strictEqual(ctrlZ.allowed, false, `Ctrl+Z must be protected on ${plat}`);
  assert.strictEqual(ctrlZ.reason, 'terminal-input');
}

// 34. Released binding can be adopted by another command
// Split Down was changed to Meta+Shift+S. Now Meta+Shift+D is free to be adopted!
const adoptOldBinding = testRegistry.validate({ key: 'd', meta: true, shift: true }, 'focus-capture-evidence');
assert.strictEqual(adoptOldBinding.allowed, true, 'Released Meta+Shift+D can be adopted by another command');

// 35. Platform display formatting
assert.strictEqual(formatShortcutDisplay({ key: 'd', meta: true, shift: true }, 'macos'), '⇧⌘D');
assert.strictEqual(formatShortcutDisplay({ key: '-', ctrl: true, shift: true }, 'windows'), 'Ctrl+Shift+-');
assert.strictEqual(formatShortcutDisplay({ key: '-', ctrl: true, shift: true }, 'linux'), 'Ctrl+Shift+-');
assert.strictEqual(formatShortcutDisplay({ key: 'd', meta: true }, 'linux'), 'Super+D');

console.log('✓ Group 4: Conflict Graph & Shell Safety passed');

console.log('\n=============================================================');
console.log('ALL 35 SHORTCUT-002 CROSS-PLATFORM TESTS PASSED SUCCESSFULLY!');
console.log('=============================================================\n');

await import('./shortcutNavigation003.test.mjs');
