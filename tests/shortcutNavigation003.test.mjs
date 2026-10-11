/** SHORTCUT-NAVIGATION-003 focused command/default/geometry regression coverage. */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

function transpileTs(filePath, customRequire = require) {
  const js = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

const typesMod = transpileTs(path.resolve(__dirname, '../app/src/features/shortcuts/types.ts'));
const normalizationMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/shortcuts/shortcutNormalization.ts'),
  (request) => request.includes('types') ? typesMod : require(request),
);
const defaultsMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/shortcuts/defaultShortcuts.ts'),
  (request) => request.includes('types')
    ? typesMod
    : request.includes('shortcutNormalization')
      ? normalizationMod
      : require(request),
);
const persistenceMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/shortcuts/shortcutPersistence.ts'),
  (request) => request.includes('types')
    ? typesMod
    : request.includes('shortcutNormalization')
      ? normalizationMod
      : require(request),
);
const panelLayoutMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/workspace/panelLayoutTree.ts'),
  (request) => request.includes('./types') ? { getAccentForOrdinal: () => 'blue' } : require(request),
);
const navigationMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/workspace/shortcutNavigation.ts'),
  (request) => request.includes('./panelLayoutTree')
    ? panelLayoutMod
    : request.includes('./types')
      ? {}
      : require(request),
);

const { APP_COMMAND_METADATA, ALL_CONFIGURABLE_COMMANDS } = typesMod;
const { DEFAULT_SHORTCUTS_MAC } = defaultsMod;
const { normalizeKeyboardEvent, matchesBinding, areBindingsEqual } = normalizationMod;
const { sanitizeShortcutSettings } = persistenceMod;
const { findAdjacentId, selectAdjacentTerminalTab, findDirectionalPaneId } = navigationMod;

const expectedDefaults = {
  'workspace.previousTab': { key: '[', meta: true, shift: true },
  'workspace.nextTab': { key: ']', meta: true, shift: true },
  'terminal.previousTab': { key: '[', ctrl: true, shift: true },
  'terminal.nextTab': { key: ']', ctrl: true, shift: true },
  'terminal.focus-left': { key: 'arrowleft', ctrl: true, shift: true },
  'terminal.focus-right': { key: 'arrowright', ctrl: true, shift: true },
  'terminal.focus-up': { key: 'arrowup', ctrl: true, shift: true },
  'terminal.focus-down': { key: 'arrowdown', ctrl: true, shift: true },
};

for (const [command, binding] of Object.entries(expectedDefaults)) {
  assert.ok(ALL_CONFIGURABLE_COMMANDS.includes(command), `${command} is configurable`);
  assert.deepStrictEqual(DEFAULT_SHORTCUTS_MAC[command], binding, `${command} macOS default`);
  assert.ok(APP_COMMAND_METADATA[command].label.includes(':'), `${command} label communicates scope`);
}

for (const command of ['terminal.focus-left', 'terminal.focus-right', 'terminal.focus-up', 'terminal.focus-down']) {
  const binding = DEFAULT_SHORTCUTS_MAC[command];
  assert.strictEqual(Boolean(binding.meta || binding.alt), false, `${command} drops Option+Command`);
}
for (const oldKey of ['arrowleft', 'arrowright', 'arrowup', 'arrowdown']) {
  const oldDefault = { key: oldKey, meta: true, ctrl: false, alt: true, shift: false };
  assert.strictEqual(
    Object.values(DEFAULT_SHORTCUTS_MAC).some((binding) => matchesBinding(binding, oldDefault)),
    false,
    `Option+Command+${oldKey} is not a macOS default`,
  );
}

const normalizedCases = [
  [{ key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true }, expectedDefaults['workspace.previousTab']],
  [{ key: '}', code: 'BracketRight', metaKey: true, shiftKey: true }, expectedDefaults['workspace.nextTab']],
  [{ key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true }, expectedDefaults['terminal.previousTab']],
  [{ key: '}', code: 'BracketRight', ctrlKey: true, shiftKey: true }, expectedDefaults['terminal.nextTab']],
  [{ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, shiftKey: true }, expectedDefaults['terminal.focus-left']],
  [{ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, shiftKey: true }, expectedDefaults['terminal.focus-right']],
  [{ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, shiftKey: true }, expectedDefaults['terminal.focus-up']],
  [{ key: 'ArrowDown', code: 'ArrowDown', ctrlKey: true, shiftKey: true }, expectedDefaults['terminal.focus-down']],
];
for (const [event, binding] of normalizedCases) {
  assert.ok(areBindingsEqual(normalizeKeyboardEvent(event), binding), `normalizes ${event.code}`);
}

const historicalCustom = sanitizeShortcutSettings({
  version: 2,
  overrides: {
    macos: {
      'terminal.focus-left': { key: 'arrowleft', meta: true, alt: true },
    },
  },
}, 'macos');
assert.deepStrictEqual(
  historicalCustom.overrides.macos['terminal.focus-left'],
  { key: 'arrowleft', meta: true, alt: true },
  'indistinguishable persisted old-default values are preserved as user customizations',
);

assert.strictEqual(findAdjacentId(['w1'], 'w1', 1), null, 'one workspace is a no-op');
assert.strictEqual(findAdjacentId(['w1', 'w2', 'w3'], 'w1', -1), 'w3', 'workspace previous wraps');
assert.strictEqual(findAdjacentId(['w1', 'w2', 'w3'], 'w3', 1), 'w1', 'workspace next wraps');
assert.strictEqual(findAdjacentId(['w1', 'w2'], 'dead', 1), null, 'dead active workspace is safe');

const pane = (id, listening = false) => ({ id, capture: { isListening: listening } });
const tab = (id, activePaneId) => ({ id, activePaneId, panes: [pane(activePaneId)] });
const workspace = {
  id: 'w1',
  activeTerminalTabId: 't1',
  terminalTabs: [tab('t1', 'a'), tab('t2', 'b'), tab('t3', 'c')],
  panes: [pane('a'), pane('b', true), pane('c')],
  capture: { isListening: false, blocks: [] },
};
const nextTerminal = selectAdjacentTerminalTab(workspace, 1);
assert.strictEqual(nextTerminal.id, 'w1', 'terminal navigation does not switch workspace');
assert.strictEqual(nextTerminal.activeTerminalTabId, 't2', 'terminal next changes terminal tab only');
assert.strictEqual(nextTerminal.capture.isListening, true, 'target capture mirror remains correct');
assert.strictEqual(nextTerminal.terminalTabs, workspace.terminalTabs, 'terminal sessions and tab ownership are preserved');
assert.strictEqual(selectAdjacentTerminalTab(nextTerminal, -1).activeTerminalTabId, 't1', 'terminal previous wraps independently');
const oneTabWorkspace = { ...workspace, terminalTabs: [workspace.terminalTabs[0]], activeTerminalTabId: 't1' };
assert.strictEqual(selectAdjacentTerminalTab(oneTabWorkspace, 1), oneTabWorkspace, 'one terminal tab is a no-op');

const panels = [
  { id: 'pa', kind: 'terminal', paneId: 'a' },
  { id: 'pb', kind: 'terminal', paneId: 'b' },
  { id: 'pc', kind: 'terminal', paneId: 'c' },
  { id: 'capture', kind: 'capture', selectedCapturePaneIds: [] },
];
const twoPaneTab = (direction) => ({
  panes: [pane('a'), pane('b')],
  panels: panels.slice(0, 2),
  capturePanelId: 'capture',
  panelLayout: {
    type: 'split', id: `${direction}-split`, direction, ratio: 0.5,
    first: { type: 'panel', panelId: 'pa' },
    second: { type: 'panel', panelId: 'pb' },
  },
});
const horizontalTab = twoPaneTab('horizontal');
assert.strictEqual(findDirectionalPaneId(horizontalTab, 'a', 'right'), 'b', 'horizontal right follows geometry');
assert.strictEqual(findDirectionalPaneId(horizontalTab, 'b', 'left'), 'a', 'horizontal left follows geometry');
const verticalTab = twoPaneTab('vertical');
assert.strictEqual(findDirectionalPaneId(verticalTab, 'a', 'down'), 'b', 'vertical down follows geometry');
assert.strictEqual(findDirectionalPaneId(verticalTab, 'b', 'up'), 'a', 'vertical up follows geometry');

const nestedTab = {
  panes: [pane('a'), pane('b'), pane('c')],
  panels,
  capturePanelId: 'capture',
  panelLayout: {
    type: 'split', id: 'root', direction: 'horizontal', ratio: 0.8,
    first: {
      type: 'split', id: 'terminal-root', direction: 'horizontal', ratio: 0.6,
      first: { type: 'panel', panelId: 'pa' },
      second: {
        type: 'split', id: 'right-stack', direction: 'vertical', ratio: 0.35,
        first: { type: 'panel', panelId: 'pb' },
        second: { type: 'panel', panelId: 'pc' },
      },
    },
    second: { type: 'panel', panelId: 'capture' },
  },
};
assert.strictEqual(findDirectionalPaneId(nestedTab, 'a', 'right'), 'c', 'uneven nested right chooses closest center');
assert.strictEqual(findDirectionalPaneId(nestedTab, 'b', 'left'), 'a', 'nested left follows geometry');
assert.strictEqual(findDirectionalPaneId(nestedTab, 'b', 'down'), 'c', 'nested down follows geometry');
assert.strictEqual(findDirectionalPaneId(nestedTab, 'c', 'up'), 'b', 'nested up follows geometry');
assert.strictEqual(findDirectionalPaneId(nestedTab, 'a', 'left'), null, 'left edge does not wrap');
assert.strictEqual(findDirectionalPaneId(nestedTab, 'b', 'up'), null, 'top edge does not wrap');
assert.strictEqual(findDirectionalPaneId({ ...nestedTab, panes: [pane('a')] }, 'a', 'right'), null, 'single pane is a no-op');
assert.strictEqual(findDirectionalPaneId({ ...nestedTab, panes: [pane('a'), pane('c')] }, 'c', 'up'), null, 'deleted neighbor is never targeted');
assert.strictEqual(findDirectionalPaneId(nestedTab, 'dead', 'right'), null, 'restored stale active pane is safe');

console.log('SHORTCUT-NAVIGATION-003 command, default, normalization, tab, and nested geometry tests passed');
