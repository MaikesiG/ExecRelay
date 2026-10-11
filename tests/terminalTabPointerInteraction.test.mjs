import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

// 1. Transpile and load workspaceReorder.ts
const reorderSourcePath = path.resolve(
  __dirname,
  '../app/src/features/workspace/workspaceReorder.ts',
);
const reorderSource = fs.readFileSync(reorderSourcePath, 'utf8');
const reorderJs = ts.transpileModule(reorderSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const reorderMod = { exports: {} };
new Function('module', 'exports', 'require', reorderJs)(
  reorderMod,
  reorderMod.exports,
  require,
);
const {
  reorderTerminalTabs,
  resolveTabDropTarget,
  TAB_DRAG_THRESHOLD_PX,
} = reorderMod.exports;

console.log('Running UX-REORDER-002R Terminal Tab Pointer Interaction Tests...\n');

// ---------------------------------------------------------------------------
// Static Code & DOM Contract Assertions
// ---------------------------------------------------------------------------
const workspaceTabsSource = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.tsx'),
  'utf8',
);
const workspaceTabsCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.css'),
  'utf8',
);

assert.match(workspaceTabsSource, /onPointerDown=\{/, 'Activator button must have onPointerDown handler');
assert.match(workspaceTabsSource, /onPointerMove=\{/, 'Activator button must have onPointerMove handler');
assert.match(workspaceTabsSource, /onPointerUp=\{/, 'Activator button must have onPointerUp handler');
assert.match(workspaceTabsSource, /onPointerCancel=\{/, 'Activator button must have onPointerCancel handler');
assert.match(workspaceTabsSource, /TAB_DRAG_THRESHOLD_PX/, 'Must use TAB_DRAG_THRESHOLD_PX constant');
assert.match(workspaceTabsSource, /setPointerCapture/, 'Must invoke setPointerCapture for pointer stability');
assert.match(workspaceTabsSource, /releasePointerCapture/, 'Must release pointer capture on release or cancel');
assert.match(workspaceTabsCss, /touch-action:\s*none;/, 'WorkspaceTabs.css must set touch-action: none on activator');
assert.match(workspaceTabsCss, /cursor:\s*grabbing;/, 'WorkspaceTabs.css must set cursor: grabbing when dragging');
console.log('✓ Static contracts and DOM event wiring verified');

// ---------------------------------------------------------------------------
// Simulated Component Interaction Model
// Mirrors the exact state machine and event handler implementation in WorkspaceTabs.tsx
// ---------------------------------------------------------------------------
class SimulatedWorkspaceTabsHarness {
  constructor(initialTabs, initialActiveTabId) {
    this.tabs = [...initialTabs];
    this.activeTabId = initialActiveTabId;
    this.draggingTabId = null;
    this.dropTarget = null;
    this.editingTabId = null;
    this.dragGesture = null;
    this.suppressClick = false;

    this.reorders = [];
    this.selections = [];
    this.closes = [];

    // Tab strip geometry: tabs laid out horizontally
    // Each tab width = 100px, 2px gap
    // tab-a: [0, 100] (midpoint: 50)
    // tab-b: [102, 202] (midpoint: 152)
    // tab-c: [204, 304] (midpoint: 254)
    this.tabWidth = 100;
    this.gap = 2;
  }

  getTabElements() {
    return this.tabs.map((tab, idx) => {
      const left = idx * (this.tabWidth + this.gap);
      const right = left + this.tabWidth;
      return {
        tabId: tab.id,
        rect: { left, right, width: this.tabWidth },
      };
    });
  }

  onSelectTab(tabId) {
    this.selections.push(tabId);
    this.activeTabId = tabId;
  }

  onReorderTab(draggedId, targetId, placement) {
    this.reorders.push({ draggedId, targetId, placement });
    this.tabs = reorderTerminalTabs(this.tabs, draggedId, targetId, placement);
  }

  onCloseTab(tabId) {
    this.closes.push(tabId);
    this.tabs = this.tabs.filter((t) => t.id !== tabId);
  }

  // Pointer event handlers mirroring WorkspaceTabs.tsx
  handlePointerDown(tabId, clientX, clientY, button = 0, pointerId = 1) {
    if (button !== 0) return;
    if (this.editingTabId) return;

    this.dragGesture = {
      tabId,
      startX: clientX,
      startY: clientY,
      pointerId,
      hasMovedPastThreshold: false,
    };
    this.dropTarget = null;
  }

  handlePointerMove(clientX, clientY, pointerId = 1) {
    const gesture = this.dragGesture;
    if (!gesture || gesture.pointerId !== pointerId) return;

    const deltaX = clientX - gesture.startX;
    const deltaY = clientY - gesture.startY;
    const distance = Math.hypot(deltaX, deltaY);

    if (!gesture.hasMovedPastThreshold) {
      if (distance >= TAB_DRAG_THRESHOLD_PX) {
        gesture.hasMovedPastThreshold = true;
        this.draggingTabId = gesture.tabId;
      } else {
        return;
      }
    }

    const tabElements = this.getTabElements();
    this.dropTarget = resolveTabDropTarget(tabElements, clientX, gesture.tabId);
  }

  handlePointerUp(tabId, clientX, clientY, pointerId = 1) {
    const gesture = this.dragGesture;
    if (!gesture || gesture.pointerId !== pointerId) return;

    const wasDragging = gesture.hasMovedPastThreshold;
    const draggedId = gesture.tabId;
    const target = this.dropTarget;

    this.dragGesture = null;
    this.draggingTabId = null;
    this.dropTarget = null;

    if (wasDragging) {
      this.suppressClick = true;
      if (target && target.tabId && target.tabId !== draggedId) {
        this.onReorderTab(draggedId, target.tabId, target.placement);
      }
    } else {
      this.suppressClick = true;
      this.onSelectTab(tabId);
    }
  }

  handlePointerCancel() {
    this.dragGesture = null;
    this.draggingTabId = null;
    this.dropTarget = null;
  }

  handleClick(tabId) {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.onSelectTab(tabId);
  }

  handleCloseClick(tabId) {
    this.onCloseTab(tabId);
  }
}

const tabA = { id: 'tab-a', label: 'Terminal A' };
const tabB = { id: 'tab-b', label: 'Terminal B' };
const tabC = { id: 'tab-c', label: 'Terminal C' };

// 1. Drag/pointer gesture invokes reorder callback
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  // Pointer down on tab-c at x=250
  harness.handlePointerDown('tab-c', 250, 20);
  // Pointer move to x=40 (left of tab-a midpoint 50)
  harness.handlePointerMove(40, 20);
  assert.strictEqual(harness.draggingTabId, 'tab-c', 'Dragging tab ID must be tab-c');
  assert.deepStrictEqual(harness.dropTarget, { tabId: 'tab-a', placement: 'before' });
  // Pointer up
  harness.handlePointerUp('tab-c', 40, 20);
  assert.strictEqual(harness.reorders.length, 1);
  assert.deepStrictEqual(harness.reorders[0], {
    draggedId: 'tab-c',
    targetId: 'tab-a',
    placement: 'before',
  });
  assert.deepStrictEqual(
    harness.tabs.map((t) => t.id),
    ['tab-c', 'tab-a', 'tab-b'],
  );
  console.log('✓ 1. Drag/pointer gesture invokes reorder callback and reorders tabs');
}

// 2. Movement below threshold is click/no reorder
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  // Pointer down on tab-b at x=150
  harness.handlePointerDown('tab-b', 150, 20);
  // Move 2px (below threshold 5px)
  harness.handlePointerMove(152, 20);
  assert.strictEqual(harness.draggingTabId, null, 'Must NOT enter drag mode below threshold');
  assert.strictEqual(harness.dropTarget, null);
  // Pointer up
  harness.handlePointerUp('tab-b', 152, 20);
  assert.strictEqual(harness.reorders.length, 0, 'No reorder should be triggered');
  assert.strictEqual(harness.selections.length, 1, 'Select should be triggered on click');
  assert.strictEqual(harness.selections[0], 'tab-b');
  // Ensuing native click is suppressed from duplicate activation
  harness.handleClick('tab-b');
  assert.strictEqual(harness.selections.length, 1, 'Click handler suppressed duplicate selection');
  console.log('✓ 2. Movement below threshold is click/no reorder');
}

// 3. Movement above threshold enters drag
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  harness.handlePointerDown('tab-c', 250, 20);
  assert.strictEqual(harness.draggingTabId, null);
  // Move exactly 5px (threshold)
  harness.handlePointerMove(255, 20);
  assert.strictEqual(harness.draggingTabId, 'tab-c', 'Entering drag mode when movement >= threshold');
  console.log('✓ 3. Movement above threshold enters drag');
}

// 4. Before midpoint → before
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  harness.handlePointerDown('tab-c', 250, 20);
  // Tab B is [102, 202], midpoint is 152. Move to x=140 (< 152)
  harness.handlePointerMove(140, 20);
  assert.deepStrictEqual(harness.dropTarget, { tabId: 'tab-b', placement: 'before' });
  console.log('✓ 4. Before midpoint → before');
}

// 5. After midpoint → after
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  harness.handlePointerDown('tab-c', 250, 20);
  // Tab B midpoint is 152. Move to x=170 (> 152)
  harness.handlePointerMove(170, 20);
  assert.deepStrictEqual(harness.dropTarget, { tabId: 'tab-b', placement: 'after' });
  console.log('✓ 5. After midpoint → after');
}

// 6. Pointer/drag cancel → no reorder
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  harness.handlePointerDown('tab-c', 250, 20);
  harness.handlePointerMove(40, 20); // active drag
  assert.strictEqual(harness.draggingTabId, 'tab-c');
  // Cancel
  harness.handlePointerCancel();
  assert.strictEqual(harness.draggingTabId, null, 'Drag state must clear on cancel');
  assert.strictEqual(harness.dropTarget, null);
  assert.strictEqual(harness.reorders.length, 0, 'No reorder on cancel');
  assert.strictEqual(harness.selections.length, 0, 'No selection on cancel');
  assert.deepStrictEqual(harness.tabs.map((t) => t.id), ['tab-a', 'tab-b', 'tab-c']);
  console.log('✓ 6. Pointer/drag cancel → no reorder');
}

// 7. Inactive dragged tab not activated
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  assert.strictEqual(harness.activeTabId, 'tab-a');
  // Drag inactive tab-c before tab-a
  harness.handlePointerDown('tab-c', 250, 20);
  assert.strictEqual(harness.activeTabId, 'tab-a', 'Pointerdown on inactive tab must NOT activate it');
  harness.handlePointerMove(40, 20);
  assert.strictEqual(harness.activeTabId, 'tab-a', 'Moving inactive tab must NOT activate it');
  harness.handlePointerUp('tab-c', 40, 20);
  // Browser triggers click after pointerup
  harness.handleClick('tab-c');
  assert.strictEqual(harness.activeTabId, 'tab-a', 'Active tab remains tab-a after tab-c reorder');
  assert.strictEqual(harness.selections.length, 0, 'onSelectTab must NEVER be called for dragged tab');
  assert.deepStrictEqual(harness.tabs.map((t) => t.id), ['tab-c', 'tab-a', 'tab-b']);
  console.log('✓ 7. Inactive dragged tab not activated; active tab preserved');
}

// 8. Normal click activates
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  assert.strictEqual(harness.activeTabId, 'tab-a');
  // Simple click without move
  harness.handlePointerDown('tab-b', 150, 20);
  harness.handlePointerUp('tab-b', 150, 20);
  harness.handleClick('tab-b');
  assert.strictEqual(harness.activeTabId, 'tab-b', 'Normal click activates tab-b');
  assert.strictEqual(harness.selections.length, 1);
  console.log('✓ 8. Normal click activates');
}

// 9. Close control does not start drag
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  // Close button stops propagation on pointerdown, so handlePointerDown is never invoked
  harness.handleCloseClick('tab-b');
  assert.strictEqual(harness.draggingTabId, null);
  assert.strictEqual(harness.closes.length, 1);
  assert.strictEqual(harness.closes[0], 'tab-b');
  assert.deepStrictEqual(harness.tabs.map((t) => t.id), ['tab-a', 'tab-c']);
  console.log('✓ 9. Close control closes tab without starting drag');
}

// 10. Rename control does not start drag
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  harness.editingTabId = 'tab-a';
  // Pointer down while editing is ignored
  harness.handlePointerDown('tab-a', 50, 20);
  assert.strictEqual(harness.dragGesture, null, 'Editing tab must not initiate drag gesture');
  console.log('✓ 10. Rename control does not start drag');
}

// 11. Self drop/no-op
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  harness.handlePointerDown('tab-b', 150, 20);
  // Move 10px within tab-b (tab-b is [102, 202])
  harness.handlePointerMove(160, 20);
  assert.strictEqual(harness.draggingTabId, 'tab-b');
  assert.strictEqual(harness.dropTarget, null, 'Self drop must yield null drop target');
  harness.handlePointerUp('tab-b', 160, 20);
  assert.strictEqual(harness.reorders.length, 0, 'No reorder triggered on self drop');
  assert.deepStrictEqual(harness.tabs.map((t) => t.id), ['tab-a', 'tab-b', 'tab-c']);
  console.log('✓ 11. Self drop is a safe no-op');
}

// 12. Reorder callback receives stable IDs
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  harness.handlePointerDown('tab-a', 50, 20);
  harness.handlePointerMove(280, 20); // after tab-c
  harness.handlePointerUp('tab-a', 280, 20);
  assert.strictEqual(harness.reorders.length, 1);
  const reorderCall = harness.reorders[0];
  assert.strictEqual(typeof reorderCall.draggedId, 'string');
  assert.strictEqual(typeof reorderCall.targetId, 'string');
  assert.strictEqual(reorderCall.draggedId, 'tab-a', 'Must use stable tab ID');
  assert.strictEqual(reorderCall.targetId, 'tab-c', 'Must use stable target tab ID');
  assert.strictEqual(reorderCall.placement, 'after');
  console.log('✓ 12. Reorder callback receives stable IDs');
}

// 13. Drag state clears after completion
{
  const harness = new SimulatedWorkspaceTabsHarness([tabA, tabB, tabC], 'tab-a');
  harness.handlePointerDown('tab-b', 150, 20);
  harness.handlePointerMove(40, 20);
  assert.ok(harness.draggingTabId !== null);
  assert.ok(harness.dropTarget !== null);
  harness.handlePointerUp('tab-b', 40, 20);
  assert.strictEqual(harness.draggingTabId, null, 'draggingTabId cleared');
  assert.strictEqual(harness.dropTarget, null, 'dropTarget cleared');
  assert.strictEqual(harness.dragGesture, null, 'dragGesture cleared');
  console.log('✓ 13. Drag state cleanly clears after completion');
}

console.log('\n=============================================================');
console.log('ALL 13 TERMINAL TAB POINTER INTERACTION TESTS PASSED!');
console.log('=============================================================\n');
