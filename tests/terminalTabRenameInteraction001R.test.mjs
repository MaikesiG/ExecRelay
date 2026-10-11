/** TAB-NAME-001R — real rename gesture and pointer-boundary regression tests. */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

function loadTs(relPath) {
  const source = fs.readFileSync(path.resolve(__dirname, relPath), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
  return mod.exports;
}

const names = loadTs('../app/src/features/workspace/terminalTabName.ts');
const workspaceTabsSource = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.tsx'),
  'utf8',
);

const activatorStart = workspaceTabsSource.indexOf(
  'className={`workspace-tab-activator',
);
const activatorEnd = workspaceTabsSource.indexOf('</button>', activatorStart);
const activatorMarkup = workspaceTabsSource.slice(activatorStart, activatorEnd);
const labelStart = activatorMarkup.indexOf('className="workspace-tab-label"');
const labelEnd = activatorMarkup.indexOf('>', labelStart);
const labelOpeningTag = activatorMarkup.slice(labelStart, labelEnd);

assert.ok(activatorStart >= 0 && activatorEnd > activatorStart);
assert.match(
  activatorMarkup,
  /onDoubleClick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*startRename\(tab\);/,
  'the pointer-capturing activator must own the rename gesture',
);
assert.doesNotMatch(
  labelOpeningTag,
  /onDoubleClick/,
  'the rename gesture must not depend on a child that pointer capture can retarget away from',
);
assert.match(
  workspaceTabsSource,
  /const startRename = useCallback\([\s\S]*?clearDragState\(\);[\s\S]*?setEditingTerminalTabId\(tab\.id\)/,
  'rename must clear pending drag state before entering edit mode',
);
assert.match(
  workspaceTabsSource,
  /className="workspace-tab-edit-container"[\s\S]*?onPointerDown=\{\(e\) => \{\s*e\.stopPropagation\(\);/,
  'the editing surface must isolate pointerdown from tab dragging',
);

function makeTab(id, baseName, paneId, sessionId) {
  const capture = {
    isListening: false,
    hasRetainedData: true,
    currentBatchId: 7,
    sessionId: `capture-${paneId}`,
  };
  const pane = {
    id: paneId,
    terminalTabId: id,
    terminalSessionId: sessionId,
    session: { sessionId, status: 'running', sessionInfo: null },
    capture,
  };
  return {
    id,
    workspaceId: 'ws-1',
    baseName,
    name: baseName,
    label: baseName,
    panes: [pane],
    terminalPanes: [pane],
    capture,
  };
}

class RenameInteractionHarness {
  constructor(tabs, activeTabId) {
    this.tabs = tabs;
    this.activeTabId = activeTabId;
    this.editingTabId = null;
    this.editingValue = '';
    this.inputFocused = false;
    this.dragGesture = null;
    this.draggingTabId = null;
    this.pointerCapturedBy = null;
    this.isCancelling = false;
    this.renameCalls = [];
    this.selectionCalls = [];
  }

  displayName(index) {
    return names.getTerminalTabDisplayName(this.tabs[index]);
  }

  renderTab(index) {
    const tab = this.tabs[index];
    if (tab.id === this.editingTabId) {
      return { type: 'input', value: this.editingValue, focused: this.inputFocused };
    }
    return { type: 'label', value: this.displayName(index) };
  }

  clearDragState() {
    this.dragGesture = null;
    this.draggingTabId = null;
    this.pointerCapturedBy = null;
  }

  pointerDownTab(index) {
    if (this.editingTabId) return;
    const tab = this.tabs[index];
    this.pointerCapturedBy = tab.id;
    this.dragGesture = { tabId: tab.id, hasMovedPastThreshold: false };
  }

  pointerUpTab(index) {
    if (!this.dragGesture) return;
    const tab = this.tabs[index];
    this.clearDragState();
    this.activeTabId = tab.id;
    this.selectionCalls.push(tab.id);
  }

  doubleClickTab(index) {
    // A real double-click is two pointer sequences followed by dblclick. Pointer
    // capture makes the activator the reliable event boundary.
    this.pointerDownTab(index);
    this.pointerUpTab(index);
    this.pointerDownTab(index);
    this.pointerUpTab(index);
    const tab = this.tabs[index];
    this.clearDragState();
    this.isCancelling = false;
    this.editingTabId = tab.id;
    this.editingValue = names.getTerminalTabBaseName(tab);
    this.inputFocused = true;
  }

  pointerDownInput() {
    // The edit container stops propagation, so no tab pointer handler runs.
  }

  typeInInput(value) {
    assert.ok(this.editingTabId, 'input must be rendered before typing');
    this.editingValue = value;
  }

  saveRename() {
    if (this.isCancelling) {
      this.isCancelling = false;
      return;
    }
    const trimmed = this.editingValue.trim();
    if (trimmed) {
      const baseName = names.normalizeTerminalTabBaseName(trimmed);
      this.renameCalls.push({ id: this.editingTabId, baseName });
      this.tabs = this.tabs.map((tab) =>
        tab.id === this.editingTabId
          ? { ...tab, baseName, name: baseName, label: baseName }
          : tab,
      );
    }
    this.editingTabId = null;
    this.inputFocused = false;
  }

  pressInputKey(key) {
    if (key === 'Enter') this.saveRename();
    if (key === 'Escape') {
      this.isCancelling = true;
      this.editingTabId = null;
      this.inputFocused = false;
    }
  }

  blurInput() {
    this.saveRename();
  }
}

console.log('Running TAB-NAME-001R terminal tab rename interaction tests...');

const first = makeTab('tab-1', 'Terminal', 'pane-1', 'session-1');
const second = makeTab('tab-2', 'Terminal', 'pane-2', 'session-2');
const third = makeTab('tab-3', 'Terminal', 'pane-3', 'session-3');
const originalSecond = second;
const originalPane = second.panes[0];
const originalCapture = second.capture;

const harness = new RenameInteractionHarness([first, second, third], first.id);
harness.doubleClickTab(1);
assert.deepStrictEqual(harness.renderTab(1), {
  type: 'input',
  value: 'Terminal',
  focused: true,
});
assert.strictEqual(harness.activeTabId, second.id, 'double-click activates the target tab');
assert.strictEqual(harness.dragGesture, null, 'rename begins with no pending drag gesture');

harness.pointerDownInput();
assert.strictEqual(harness.dragGesture, null, 'input pointerdown cannot initiate dragging');
harness.pointerDownTab(1);
assert.strictEqual(harness.dragGesture, null, 'an editing tab cannot initiate dragging');

harness.typeInInput('Backend');
assert.strictEqual(harness.renderTab(1).value, 'Backend');
harness.pressInputKey('Enter');
assert.deepStrictEqual(harness.renameCalls.at(-1), {
  id: second.id,
  baseName: 'Backend',
});
assert.strictEqual(harness.renderTab(1).value, 'Backend');
assert.strictEqual(harness.tabs[1].baseName, 'Backend');
assert.notStrictEqual(harness.tabs[1].baseName, 'Backend 2');
assert.ok(!harness.renderTab(1).value.includes('Backend 2'));

assert.strictEqual(harness.tabs[1].id, originalSecond.id);
assert.strictEqual(harness.tabs[1].panes[0], originalPane);
assert.strictEqual(harness.tabs[1].panes[0].terminalSessionId, 'session-2');
assert.strictEqual(harness.tabs[1].capture, originalCapture);

harness.doubleClickTab(1);
harness.typeInInput('API');
harness.blurInput();
assert.strictEqual(harness.renderTab(1).value, 'API', 'blur saves the rename');

harness.doubleClickTab(1);
harness.typeInInput('Discarded');
harness.pressInputKey('Escape');
harness.blurInput();
assert.strictEqual(harness.renderTab(1).value, 'API', 'Escape cancels the rename');

harness.pointerDownTab(2);
harness.pointerUpTab(2);
assert.strictEqual(harness.activeTabId, third.id, 'normal click activation remains intact');

const afterClose = [harness.tabs[1], harness.tabs[2]];
assert.strictEqual(names.getTerminalTabDisplayName(afterClose[0]), 'API');
assert.strictEqual(afterClose[0].baseName, 'API');

console.log('✓ TAB-NAME-001R rename, focus, save/cancel, drag isolation, and identity tests pass');
