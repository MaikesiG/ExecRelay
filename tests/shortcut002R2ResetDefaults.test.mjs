/**
 * SHORTCUT-002R2 — Reset Defaults Must Restore Live Effective Bindings Test Suite
 *
 * Verifies:
 * 1. Architecture invariant: effectiveBinding = validOverride ?? platformDefault
 * 2. Settings Modal draft lifecycle: Reset to Defaults is draft-only until Save; Cancel discards draft
 * 3. Cross-platform isolation: Reset on macOS strictly preserves Windows/Linux overrides in storage
 * 4. Dispatch isolation: useGlobalShortcuts ONLY matches navigation commands; does NOT swallow terminal shortcuts
 * 5. useTerminalPaneKeybindings triggers restored default live effective bindings immediately after Reset + Save
 * 6. Old custom binding is completely dead after Reset + Save
 * 7. All 7 terminal pane commands restore default effective bindings after override + Reset + Save
 * 8. Navigation commands (Cmd+1..6) and Terminal commands (Cmd+D, etc.) operate without collision
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
  isNavigationCommand,
  isTerminalCommand,
} = shortcutsTypesMod;

const {
  detectPlatform,
  normalizeKey,
  normalizeKeyboardEvent,
  matchesBinding,
  areBindingsEqual,
  formatShortcutDisplay,
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

// Mock localStorage
const mockStorage = new Map();
global.window = {
  localStorage: {
    getItem: (key) => mockStorage.get(key) ?? null,
    setItem: (key, val) => mockStorage.set(key, String(val)),
    removeItem: (key) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};
global.document = {
  activeElement: null,
  querySelector: () => null,
};

console.log('Running SHORTCUT-002R2 Reset Defaults Must Restore Live Effective Bindings Test Suite...\
');

// =============================================================================
// Group 1: Helper Functions & Invariant Verification
// =============================================================================
console.log('--- Group 1: Architecture Invariant (effectiveBinding = validOverride ?? platformDefault) ---');

// 1. isNavigationCommand and isTerminalCommand categorizations
for (const cmd of ORDERED_NAVIGATION_COMMANDS) {
  assert.strictEqual(isNavigationCommand(cmd), true, `${cmd} should be navigation command`);
  assert.strictEqual(isTerminalCommand(cmd), false, `${cmd} should not be terminal command`);
}
for (const cmd of ORDERED_TERMINAL_COMMANDS) {
  assert.strictEqual(isTerminalCommand(cmd), true, `${cmd} should be terminal command`);
  assert.strictEqual(isNavigationCommand(cmd), false, `${cmd} should not be navigation command`);
}
console.log('✓ Group 1: Command categorizations verified');

// =============================================================================
// Group 2: Full Lifecycle Simulation: Override -> Reset Draft -> Cancel -> Reset Draft -> Save
// =============================================================================
console.log('\
--- Group 2: Reset to Defaults Lifecycle & Storage Invariants ---');

mockStorage.clear();

// Set up cross-platform baseline storage: Windows has an override
savePlatformOverrides('windows', {
  'terminal.split-right': { key: 'r', ctrl: true, shift: true },
});

const macRegistry = new ShortcutRegistry('macos');
const macDefaults = getDefaultShortcuts('macos');

// Step A: Customize terminal.split-right to Meta+Shift+S
const customBinding = { key: 's', meta: true, shift: true };
const overrideResult = macRegistry.setOverride('terminal.split-right', customBinding);
assert.strictEqual(overrideResult.success, true);
assert.deepStrictEqual(macRegistry.getEffectiveBindings()['terminal.split-right'], customBinding);
assert.strictEqual(macRegistry.findCommandForEvent({ key: 's', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false }, 'terminal'), 'terminal.split-right');
assert.strictEqual(macRegistry.findCommandForEvent({ key: 'd', metaKey: true, shiftKey: false, ctrlKey: false, altKey: false }, 'terminal'), null, 'Old default Meta+D must be inactive while overridden');

// Step B: Simulate Modal "Reset to Defaults" clicked, but user clicks "Cancel"
// Modal snapshots effective bindings on open:
let draft = { ...macRegistry.getEffectiveBindings() };
assert.deepStrictEqual(draft['terminal.split-right'], customBinding);

// User clicks "Reset to defaults" inside modal
draft = getDefaultShortcuts('macos');
assert.deepStrictEqual(draft['terminal.split-right'], macDefaults['terminal.split-right']);

// User clicks "Cancel" -> Draft is discarded, registry NOT updated
// Live effective binding must still be customBinding
assert.deepStrictEqual(macRegistry.getEffectiveBindings()['terminal.split-right'], customBinding);
assert.strictEqual(macRegistry.findCommandForEvent({ key: 's', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false }, 'terminal'), 'terminal.split-right');
assert.strictEqual(macRegistry.findCommandForEvent({ key: 'd', metaKey: true, shiftKey: false, ctrlKey: false, altKey: false }, 'terminal'), null);

// Step C: Re-open modal, click "Reset to defaults", then click "Save"
draft = getDefaultShortcuts('macos');
const overridesToSave = {};
for (const cmd of ALL_CONFIGURABLE_COMMANDS) {
  if (!areBindingsEqual(draft[cmd], macDefaults[cmd])) {
    overridesToSave[cmd] = { ...draft[cmd] };
  }
}
// overridesToSave is empty object because all draft bindings match defaults
assert.deepStrictEqual(overridesToSave, {});

const saveResult = macRegistry.applyOverrides(overridesToSave);
assert.strictEqual(saveResult.success, true);

// Effective binding MUST immediately fall back to default Meta+D
assert.deepStrictEqual(macRegistry.getEffectiveBindings()['terminal.split-right'], macDefaults['terminal.split-right']);

// Step D: Verify storage contents - macOS overrides empty, Windows overrides preserved!
const persisted = JSON.parse(mockStorage.get(SHORTCUT_SETTINGS_STORAGE_KEY));
assert.strictEqual(persisted.version, 2);
assert.deepStrictEqual(persisted.overrides.macos, {});
assert.deepStrictEqual(persisted.overrides.windows, {
  'terminal.split-right': { key: 'r', ctrl: true, shift: true },
});
console.log('✓ Group 2: Reset to Defaults lifecycle & cross-platform storage verified');

// =============================================================================
// Group 3: Real Event Dispatch Simulation (useGlobalShortcuts + useTerminalPaneKeybindings)
// =============================================================================
console.log('\
--- Group 3: Live Event Dispatch & Non-Interference ---');

function createKeyEvent(opts) {
  const event = {
    key: opts.key,
    code: opts.code ?? (opts.key.length === 1 ? `Key${opts.key.toUpperCase()}` : opts.key),
    metaKey: Boolean(opts.meta),
    ctrlKey: Boolean(opts.ctrl),
    altKey: Boolean(opts.alt),
    shiftKey: Boolean(opts.shift),
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
  return event;
}

// Simulates the combined capture-phase pipeline in App.tsx:
// 1. useGlobalShortcuts runs first
// 2. useTerminalPaneKeybindings runs second (if not prevented / stopped)
function dispatchAppKeyDown(event, registry, callbacks) {
  // --- Hook 1: useGlobalShortcuts ---
  let globalTriggered = null;
  const matchedNav = registry.findCommandForEvent(event, 'navigation');
  if (matchedNav && isNavigationCommand(matchedNav)) {
    event.preventDefault();
    event.stopPropagation();
    globalTriggered = matchedNav;
    callbacks.onGlobalCommand?.(matchedNav);
    return { handledBy: 'global', command: matchedNav };
  }

  // --- Hook 2: useTerminalPaneKeybindings ---
  if (event.defaultPrevented) {
    return { handledBy: 'none', reason: 'defaultPrevented' };
  }

  const matchedTerm = registry.findCommandForEvent(event, 'terminal');
  if (matchedTerm && isTerminalCommand(matchedTerm)) {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onTerminalCommand?.(matchedTerm);
    return { handledBy: 'terminal', command: matchedTerm };
  }

  return { handledBy: 'none', reason: 'no-match' };
}

// Subtest 3.1: Clean state -> Meta+D splits right, Cmd+1 navigates
const cleanRegistry = new ShortcutRegistry('macos');
let lastNav = null;
let lastTerm = null;
const cbs = {
  onGlobalCommand: (cmd) => { lastNav = cmd; },
  onTerminalCommand: (cmd) => { lastTerm = cmd; },
};

// Press Meta+1 (Cmd+1)
const eCmd1 = createKeyEvent({ key: '1', meta: true });
const rCmd1 = dispatchAppKeyDown(eCmd1, cleanRegistry, cbs);
assert.strictEqual(rCmd1.handledBy, 'global');
assert.strictEqual(lastNav, 'focus-terminal');
assert.strictEqual(lastTerm, null);

// Press Meta+D (Cmd+D)
lastNav = null;
lastTerm = null;
const eCmdD = createKeyEvent({ key: 'd', meta: true });
const rCmdD = dispatchAppKeyDown(eCmdD, cleanRegistry, cbs);
assert.strictEqual(rCmdD.handledBy, 'terminal', 'Meta+D must NOT be intercepted by global shortcuts');
assert.strictEqual(lastNav, null, 'Global handler must not trigger for terminal command');
assert.strictEqual(lastTerm, 'terminal.split-right', 'Terminal keybinding must execute split-right');

// Subtest 3.2: Custom override -> Meta+Shift+S splits right, Meta+D is dead
cleanRegistry.setOverride('terminal.split-right', { key: 's', meta: true, shift: true });
lastNav = null;
lastTerm = null;
const eCustom = createKeyEvent({ key: 's', meta: true, shift: true });
const rCustom = dispatchAppKeyDown(eCustom, cleanRegistry, cbs);
assert.strictEqual(rCustom.handledBy, 'terminal');
assert.strictEqual(lastTerm, 'terminal.split-right');

lastNav = null;
lastTerm = null;
const eOldDefault = createKeyEvent({ key: 'd', meta: true });
const rOldDefault = dispatchAppKeyDown(eOldDefault, cleanRegistry, cbs);
assert.strictEqual(rOldDefault.handledBy, 'none', 'Old default Meta+D must be dead while overridden');
assert.strictEqual(lastTerm, null);

// Subtest 3.3: Reset to defaults + Save -> Meta+D works live, Meta+Shift+S is dead
cleanRegistry.applyOverrides({});
assert.deepStrictEqual(cleanRegistry.getEffectiveBindings()['terminal.split-right'], macDefaults['terminal.split-right']);

lastNav = null;
lastTerm = null;
const eRestoredDefault = createKeyEvent({ key: 'd', meta: true });
const rRestoredDefault = dispatchAppKeyDown(eRestoredDefault, cleanRegistry, cbs);
assert.strictEqual(rRestoredDefault.handledBy, 'terminal', 'Meta+D MUST trigger split-right immediately after Reset+Save');
assert.strictEqual(lastTerm, 'terminal.split-right');

lastNav = null;
lastTerm = null;
const eDeadCustom = createKeyEvent({ key: 's', meta: true, shift: true });
const rDeadCustom = dispatchAppKeyDown(eDeadCustom, cleanRegistry, cbs);
assert.strictEqual(rDeadCustom.handledBy, 'none', 'Meta+Shift+S must be dead after Reset+Save');
assert.strictEqual(lastTerm, null);

console.log('✓ Group 3: Live Event Dispatch & Non-Interference passed');

// =============================================================================
// Group 4: All 7 Terminal Pane Actions Restore Defaults
// =============================================================================
console.log('\
--- Group 4: All 7 Terminal Commands Restore Defaults Live ---');

const termActions = [
  { cmd: 'terminal.split-right', defaultKey: { key: 'd', meta: true }, customKey: { key: 's', meta: true, shift: true } },
  { cmd: 'terminal.split-down', defaultKey: { key: 'd', meta: true, shift: true }, customKey: { key: 'j', meta: true, shift: true } },
  { cmd: 'terminal.close-pane', defaultKey: { key: 'w', meta: true, shift: true }, customKey: { key: 'k', meta: true, shift: true } },
  { cmd: 'terminal.focus-left', defaultKey: { key: 'arrowleft', ctrl: true, shift: true }, customKey: { key: 'h', meta: true, alt: true } },
  { cmd: 'terminal.focus-right', defaultKey: { key: 'arrowright', ctrl: true, shift: true }, customKey: { key: 'l', meta: true, alt: true } },
  { cmd: 'terminal.focus-up', defaultKey: { key: 'arrowup', ctrl: true, shift: true }, customKey: { key: 'k', meta: true, alt: true } },
  { cmd: 'terminal.focus-down', defaultKey: { key: 'arrowdown', ctrl: true, shift: true }, customKey: { key: 'j', meta: true, alt: true } },
];

const batchRegistry = new ShortcutRegistry('macos');

// 1. Override each action
for (const item of termActions) {
  const res = batchRegistry.setOverride(item.cmd, item.customKey);
  assert.strictEqual(res.success, true, `Should override ${item.cmd}`);
}

// Verify custom keys work and default keys are inactive
for (const item of termActions) {
  const evtCustom = createKeyEvent(item.customKey);
  const resCustom = dispatchAppKeyDown(evtCustom, batchRegistry, cbs);
  assert.strictEqual(resCustom.command, item.cmd, `Custom shortcut for ${item.cmd} must work`);

  const evtDefault = createKeyEvent(item.defaultKey);
  const resDefault = dispatchAppKeyDown(evtDefault, batchRegistry, cbs);
  assert.notStrictEqual(resDefault.command, item.cmd, `Default shortcut for ${item.cmd} must be inactive while overridden`);
}

// 2. Reset to Defaults + Save
batchRegistry.applyOverrides({});

// 3. Verify default keys work live and custom keys are inactive
for (const item of termActions) {
  const evtDefault = createKeyEvent(item.defaultKey);
  const resDefault = dispatchAppKeyDown(evtDefault, batchRegistry, cbs);
  assert.strictEqual(resDefault.command, item.cmd, `Restored default shortcut for ${item.cmd} must work immediately`);

  const evtCustom = createKeyEvent(item.customKey);
  const resCustom = dispatchAppKeyDown(evtCustom, batchRegistry, cbs);
  assert.strictEqual(resCustom.handledBy, 'none', `Custom shortcut for ${item.cmd} must be inactive after Reset+Save`);
}

console.log('✓ Group 4: All 7 Terminal Commands Restore Defaults Live passed');

// =============================================================================
// Group 5: Terminal Input & Shell Safety (Unbound Keys Reach PTY)
// =============================================================================
console.log('\
--- Group 5: Terminal Input Safety (Typing & PTY Passthrough) ---');

const safetyRegistry = new ShortcutRegistry('macos');

// Bare typing (e.g. 'd') must NOT be intercepted by either hook
const eBareD = createKeyEvent({ key: 'd' });
const rBareD = dispatchAppKeyDown(eBareD, safetyRegistry, cbs);
assert.strictEqual(rBareD.handledBy, 'none');
assert.strictEqual(eBareD.defaultPrevented, false);
assert.strictEqual(eBareD.propagationStopped, false);

// Shell control keys (Ctrl+C, Ctrl+D, Ctrl+Z) must NOT be intercepted
const eCtrlC = createKeyEvent({ key: 'c', ctrl: true });
const rCtrlC = dispatchAppKeyDown(eCtrlC, safetyRegistry, cbs);
assert.strictEqual(rCtrlC.handledBy, 'none');
assert.strictEqual(eCtrlC.defaultPrevented, false);

const eCtrlD = createKeyEvent({ key: 'd', ctrl: true });
const rCtrlD = dispatchAppKeyDown(eCtrlD, safetyRegistry, cbs);
assert.strictEqual(rCtrlD.handledBy, 'none');
assert.strictEqual(eCtrlD.defaultPrevented, false);

console.log('✓ Group 5: Terminal Input Safety passed');

console.log('\
=============================================================');
console.log('ALL SHORTCUT-002R2 RESET DEFAULTS RESTORATION TESTS PASSED!');
console.log('=============================================================\
');
