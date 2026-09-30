/**
 * HARDEN-009 / HARDEN-010 — Keyboard-First Navigation & Shortcut Registry Test Suite
 *
 * Verifies:
 * 1. Surface mapping 1–6 (Terminal=1, Capture/Evidence=2, Changes=3, Verify=4, Agents=5, Governance=6)
 * 2. Position 7 is removed (Meta/Ctrl+7 does NOT resolve to any command)
 * 3. Bare digits 1–7 never trigger navigation
 * 4. Reserved shortcuts are strictly rejected (bare keys, Shift-only, Ctrl+C/D terminal controls, Cmd+C text editing, Cmd+Q OS reserved, Escape safety)
 * 5. Conflict detection and deterministic replacement
 * 6. Persistence & migration from legacy 1–7 (focus-capture / focus-evidence -> focus-capture-evidence)
 * 7. Restore defaults restores 1–6 platform defaults
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
  if (req.includes('types')) return shortcutsTypesMod;
  if (req.includes('shortcutNormalization')) return normalizationMod;
  if (req.includes('reservedShortcuts')) return reservedMod;
  if (req.includes('defaultShortcuts')) return defaultsMod;
  if (req.includes('shortcutPersistence')) return persistenceMod;
  if (req.includes('shortcutRegistry')) return registryMod;
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

const {
  ORDERED_APP_COMMANDS,
  ORDERED_MONITOR_VIEWS,
  APP_COMMAND_METADATA,
} = shortcutsTypesMod;

const {
  normalizeKey,
  normalizeKeyboardEvent,
  matchesBinding,
  formatShortcutDisplay,
} = normalizationMod;

const { validateShortcutBinding } = reservedMod;
const { DEFAULT_SHORTCUTS_MAC, DEFAULT_SHORTCUTS_WIN, getDefaultShortcuts } = defaultsMod;
const { sanitizeShortcutSettings } = persistenceMod;
const { ShortcutRegistry } = registryMod;

console.log('Running Keyboard-First Navigation & Shortcut Registry Test Suite (HARDEN-010)...\n');

// ---------------------------------------------------------------------------
// Test Group 1: Surface Numbering and Default Bindings 1–6
// ---------------------------------------------------------------------------
{
  console.log('--- Test Group 1: Surface Numbering & Platform Defaults 1–6 ---');

  assert.strictEqual(ORDERED_APP_COMMANDS.length, 6, 'Must contain exactly 6 commands');
  assert.deepStrictEqual(ORDERED_APP_COMMANDS, [
    'focus-terminal',
    'focus-capture-evidence',
    'focus-changes',
    'focus-verification',
    'focus-agents',
    'focus-governance',
  ]);

  assert.strictEqual(ORDERED_MONITOR_VIEWS.length, 5, 'Must contain exactly 5 monitor views');
  assert.deepStrictEqual(ORDERED_MONITOR_VIEWS, [
    'capture-evidence',
    'changes',
    'verification',
    'agents',
    'governance',
  ]);

  // Check positions in metadata
  assert.strictEqual(APP_COMMAND_METADATA['focus-terminal'].positionNumber, 1);
  assert.strictEqual(APP_COMMAND_METADATA['focus-capture-evidence'].positionNumber, 2);
  assert.strictEqual(APP_COMMAND_METADATA['focus-changes'].positionNumber, 3);
  assert.strictEqual(APP_COMMAND_METADATA['focus-verification'].positionNumber, 4);
  assert.strictEqual(APP_COMMAND_METADATA['focus-agents'].positionNumber, 5);
  assert.strictEqual(APP_COMMAND_METADATA['focus-governance'].positionNumber, 6);

  // Check macOS defaults
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_MAC['focus-terminal'], { key: '1', meta: true });
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_MAC['focus-capture-evidence'], { key: '2', meta: true });
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_MAC['focus-changes'], { key: '3', meta: true });
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_MAC['focus-verification'], { key: '4', meta: true });
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_MAC['focus-agents'], { key: '5', meta: true });
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_MAC['focus-governance'], { key: '6', meta: true });

  // Check Windows defaults
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_WIN['focus-terminal'], { key: '1', ctrl: true });
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_WIN['focus-capture-evidence'], { key: '2', ctrl: true });
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_WIN['focus-changes'], { key: '3', ctrl: true });
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_WIN['focus-verification'], { key: '4', ctrl: true });
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_WIN['focus-agents'], { key: '5', ctrl: true });
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_WIN['focus-governance'], { key: '6', ctrl: true });

  console.log('✓ 1–6 navigation mapping and platform defaults verified');
}

// ---------------------------------------------------------------------------
// Test Group 2: Event Normalization and Resolution
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 2: Event Normalization & Resolution ---');

  const macRegistry = new ShortcutRegistry(true, { version: 1, bindings: {} });
  const winRegistry = new ShortcutRegistry(false, { version: 1, bindings: {} });

  // macOS tests
  assert.strictEqual(
    macRegistry.findCommandForEvent({ key: '1', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    'focus-terminal',
  );
  assert.strictEqual(
    macRegistry.findCommandForEvent({ key: '2', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    'focus-capture-evidence',
  );
  assert.strictEqual(
    macRegistry.findCommandForEvent({ key: '3', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    'focus-changes',
  );
  assert.strictEqual(
    macRegistry.findCommandForEvent({ key: '4', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    'focus-verification',
  );
  assert.strictEqual(
    macRegistry.findCommandForEvent({ key: '5', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    'focus-agents',
  );
  assert.strictEqual(
    macRegistry.findCommandForEvent({ key: '6', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    'focus-governance',
  );

  // Position 7 is REMOVED
  assert.strictEqual(
    macRegistry.findCommandForEvent({ key: '7', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    null,
    'Meta+7 must NOT resolve to any command',
  );

  // Windows / Linux tests
  assert.strictEqual(
    winRegistry.findCommandForEvent({ key: '1', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }),
    'focus-terminal',
  );
  assert.strictEqual(
    winRegistry.findCommandForEvent({ key: '2', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }),
    'focus-capture-evidence',
  );
  assert.strictEqual(
    winRegistry.findCommandForEvent({ key: '7', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }),
    null,
    'Ctrl+7 must NOT resolve to any command',
  );

  console.log('✓ Normalization, dispatch, and obsolete position 7 removal verified');
}

// ---------------------------------------------------------------------------
// Test Group 3: Bare Keys and Protection of Terminal Typing
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 3: Bare Keys & Terminal Input Protection ---');

  const registry = new ShortcutRegistry(true, { version: 1, bindings: {} });

  // Bare digits must NEVER match any AppCommand
  for (let digit = 1; digit <= 9; digit++) {
    const matched = registry.findCommandForEvent({
      key: String(digit),
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    });
    assert.strictEqual(matched, null, `Bare digit ${digit} must not trigger global navigation`);
  }

  // Bare letters must NEVER match
  assert.strictEqual(
    registry.findCommandForEvent({ key: 'a', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }),
    null,
  );

  console.log('✓ Bare digits and letters safely pass through to terminal PTY input');
}

// ---------------------------------------------------------------------------
// Test Group 4: Reserved Shortcut Safety Policy
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 4: Reserved Shortcut Safety Policy ---');

  // Bare key rejection
  const bareRes = validateShortcutBinding({ key: '1' }, { isMac: true });
  assert.strictEqual(bareRes.allowed, false);
  assert.strictEqual(bareRes.reason, 'bare-key');

  // Shift-only rejection
  const shiftOnlyRes = validateShortcutBinding({ key: 'a', shift: true }, { isMac: true });
  assert.strictEqual(shiftOnlyRes.allowed, false);
  assert.strictEqual(shiftOnlyRes.reason, 'invalid-modifier');

  // Terminal control key rejection (Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+L, Ctrl+R, etc.)
  for (const ctrlKey of ['c', 'd', 'z', 'l', 'r', 'a', 'e', 'k', 'u', 'w', 'p', 'n']) {
    const res = validateShortcutBinding({ key: ctrlKey, ctrl: true }, { isMac: true });
    assert.strictEqual(res.allowed, false, `Ctrl+${ctrlKey.toUpperCase()} must be reserved for terminal`);
    assert.strictEqual(res.reason, 'terminal-input');
  }

  // Text editing rejection (Cmd+C, Cmd+V, Cmd+X, Cmd+A, Cmd+Z on Mac)
  for (const editKey of ['c', 'v', 'x', 'a', 'z']) {
    const res = validateShortcutBinding({ key: editKey, meta: true }, { isMac: true });
    assert.strictEqual(res.allowed, false, `Cmd+${editKey.toUpperCase()} must be reserved for text editing`);
    assert.strictEqual(res.reason, 'text-editing');
  }

  // OS reserved rejection (Cmd+Q, Cmd+W, Cmd+H, Cmd+M, Cmd+Tab on Mac)
  for (const osKey of ['q', 'w', 'h', 'm', 'tab', 'space']) {
    const res = validateShortcutBinding({ key: osKey, meta: true }, { isMac: true });
    assert.strictEqual(res.allowed, false, `Cmd+${osKey} must be reserved by OS`);
    assert.strictEqual(res.reason, 'os-reserved');
  }

  // Escape key safety
  const escRes = validateShortcutBinding({ key: 'escape', meta: true }, { isMac: true });
  assert.strictEqual(escRes.allowed, false);
  assert.strictEqual(escRes.reason, 'app-safety');

  console.log('✓ All safety and reservation policies strictly enforced');
}

// ---------------------------------------------------------------------------
// Test Group 5: Conflict Detection & Deterministic Replacement
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 5: Conflict Detection & Replacement ---');

  const registry = new ShortcutRegistry(true, { version: 1, bindings: {} });

  // Attempting to assign Cmd+3 (currently 'focus-changes') to 'focus-verification'
  const conflict = registry.validate({ key: '3', meta: true }, 'focus-verification');
  assert.strictEqual(conflict.allowed, false);
  assert.strictEqual(conflict.reason, 'duplicate-binding');
  assert.strictEqual(conflict.conflictingCommand, 'focus-changes');

  // Replace conflict
  const replaceRes = registry.setOverride('focus-verification', { key: '3', meta: true }, true);
  assert.strictEqual(replaceRes.success, true);

  // Now Cmd+3 resolves to focus-verification
  assert.strictEqual(
    registry.findCommandForEvent({ key: '3', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    'focus-verification',
  );

  // Restore defaults
  registry.resetNavigationOverrides();
  assert.strictEqual(
    registry.findCommandForEvent({ key: '3', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    'focus-changes',
  );

  console.log('✓ Conflict detection, deterministic replacement, and default restoration verified');
}

// ---------------------------------------------------------------------------
// Test Group 6: Persistence & Migration from Legacy 1–7 to Consolidated 1–6
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 6: Persistence & Migration from Legacy 1–7 ---');

  // Case A: Legacy with only focus-evidence override
  const legacyA = {
    version: 1,
    bindings: {
      'focus-evidence': { key: 'e', meta: true },
      'focus-changes': { key: 'c', meta: true },
    },
  };
  const sanitizedA = sanitizeShortcutSettings(legacyA);
  assert.deepStrictEqual(sanitizedA.bindings['focus-capture-evidence'], { key: 'e', meta: true });
  assert.strictEqual(sanitizedA.bindings['focus-evidence'], undefined, 'Deprecated key must be omitted');
  assert.deepStrictEqual(sanitizedA.bindings['focus-changes'], { key: 'c', meta: true });

  // Case B: Legacy with only focus-capture override
  const legacyB = {
    version: 1,
    bindings: {
      'focus-capture': { key: 'k', meta: true },
    },
  };
  const sanitizedB = sanitizeShortcutSettings(legacyB);
  assert.deepStrictEqual(sanitizedB.bindings['focus-capture-evidence'], { key: 'k', meta: true });

  // Case C: Precedence: focus-capture-evidence already exists -> preserve it over legacy
  const legacyC = {
    version: 1,
    bindings: {
      'focus-capture-evidence': { key: 'x', meta: true },
      'focus-evidence': { key: 'e', meta: true },
      'focus-capture': { key: 'c', meta: true },
    },
  };
  const sanitizedC = sanitizeShortcutSettings(legacyC);
  assert.deepStrictEqual(sanitizedC.bindings['focus-capture-evidence'], { key: 'x', meta: true });

  // Case D: Precedence: legacy focus-evidence preferred over legacy focus-capture
  const legacyD = {
    version: 1,
    bindings: {
      'focus-evidence': { key: 'e', meta: true },
      'focus-capture': { key: 'c', meta: true },
    },
  };
  const sanitizedD = sanitizeShortcutSettings(legacyD);
  assert.deepStrictEqual(sanitizedD.bindings['focus-capture-evidence'], { key: 'e', meta: true });

  // Case E: Malformed inputs degrade safely
  assert.deepStrictEqual(sanitizeShortcutSettings(null), { version: 1, bindings: {} });
  assert.deepStrictEqual(sanitizeShortcutSettings({ version: 2 }), { version: 1, bindings: {} });
  assert.deepStrictEqual(sanitizeShortcutSettings('corrupted string'), { version: 1, bindings: {} });

  console.log('✓ Migration precedence and malformed setting fallback verified');
}

console.log('\n=============================================================');
console.log('ALL KEYBOARD-FIRST NAVIGATION & REGISTRY TESTS PASSED (1–6)!');
console.log('=============================================================\n');
