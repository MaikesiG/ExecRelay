import assert from 'node:assert';

/**
 * Pure Panel Layout Tree Tests
 * Tests for LT-PANEL-LAYOUT-TREE-001
 */

const PANE_ACCENT_PALETTE = [
  'blue',
  'violet',
  'emerald',
  'amber',
  'cyan',
  'rose',
];

function getAccentForOrdinal(ordinal) {
  const index = (ordinal - 1) % PANE_ACCENT_PALETTE.length;
  return PANE_ACCENT_PALETTE[Math.max(0, index)];
}

function clampSplitRatio(ratio) {
  if (typeof ratio !== 'number' || Number.isNaN(ratio)) return 0.5;
  return Math.max(0.2, Math.min(0.8, ratio));
}

function findPanelNode(node, panelId) {
  if (!node) return null;
  if (node.type === 'panel') {
    return node.panelId === panelId ? node : null;
  }
  return findPanelNode(node.first, panelId) || findPanelNode(node.second, panelId);
}

function findParentSplit(node, panelId) {
  if (!node || node.type === 'panel') return null;
  if (
    (node.first.type === 'panel' && node.first.panelId === panelId) ||
    (node.second.type === 'panel' && node.second.panelId === panelId)
  ) {
    return node;
  }
  return findParentSplit(node.first, panelId) || findParentSplit(node.second, panelId);
}

function replacePanelNode(node, panelId, replacement) {
  if (node.type === 'panel') {
    return node.panelId === panelId ? replacement : node;
  }
  return {
    ...node,
    first: replacePanelNode(node.first, panelId, replacement),
    second: replacePanelNode(node.second, panelId, replacement),
  };
}

function updateSplitRatio(node, splitId, ratio) {
  if (node.type === 'panel') return node;
  if (node.id === splitId) {
    return { ...node, ratio: clampSplitRatio(ratio) };
  }
  return {
    ...node,
    first: updateSplitRatio(node.first, splitId, ratio),
    second: updateSplitRatio(node.second, splitId, ratio),
  };
}

function collectPanelIds(node) {
  if (!node) return [];
  if (node.type === 'panel') return [node.panelId];
  return [...collectPanelIds(node.first), ...collectPanelIds(node.second)];
}

function removePanelNodeAndCollapse(node, panelId) {
  if (node.type === 'panel') {
    return node.panelId === panelId ? null : node;
  }
  const newFirst = removePanelNodeAndCollapse(node.first, panelId);
  const newSecond = removePanelNodeAndCollapse(node.second, panelId);

  if (newFirst === null && newSecond === null) return null;
  if (newFirst === null) return newSecond;
  if (newSecond === null) return newFirst;

  return { ...node, first: newFirst, second: newSecond };
}

function validatePanelLayout(layout, panels, terminalPanes) {
  const errors = [];
  if (!layout) return { isValid: false, errors: ['Layout tree is null or undefined'] };

  const panelMap = new Map();
  for (const p of panels) {
    if (panelMap.has(p.id)) errors.push(`Duplicate panel registered with id: ${p.id}`);
    panelMap.set(p.id, p);
  }

  const capturePanels = panels.filter((p) => p.kind === 'capture');
  if (capturePanels.length !== 1) {
    errors.push(`Expected exactly 1 CapturePanel, but found ${capturePanels.length}`);
  }

  if (terminalPanes) {
    const paneIdSet = new Set(terminalPanes.map((p) => p.id));
    const terminalPanels = panels.filter((p) => p.kind === 'terminal');
    const seenPaneIds = new Set();
    for (const tp of terminalPanels) {
      if (!paneIdSet.has(tp.paneId)) {
        errors.push(`TerminalPanel ${tp.id} references non-existent paneId: ${tp.paneId}`);
      }
      if (seenPaneIds.has(tp.paneId)) {
        errors.push(`Multiple TerminalPanels reference paneId: ${tp.paneId}`);
      }
      seenPaneIds.add(tp.paneId);
    }
  }

  const seenPanelIdsInTree = new Set();
  function validateNode(node, path) {
    if (!node) {
      errors.push(`Split node at ${path} is missing a child`);
      return;
    }
    if (node.type === 'panel') {
      if (!node.panelId) errors.push(`Panel leaf at ${path} has empty panelId`);
      if (!panelMap.has(node.panelId)) errors.push(`Panel leaf references unregistered panelId: ${node.panelId}`);
      if (seenPanelIdsInTree.has(node.panelId)) errors.push(`Panel ID appears more than once in layout tree: ${node.panelId}`);
      seenPanelIdsInTree.add(node.panelId);
    } else if (node.type === 'split') {
      if (!node.first || !node.second) errors.push(`Split node ${node.id || path} must have two children`);
      if (typeof node.ratio !== 'number' || node.ratio < 0.2 || node.ratio > 0.8) {
        errors.push(`Split node ${node.id || path} ratio ${node.ratio} is out of bounds [0.2, 0.8]`);
      }
      if (node.first) validateNode(node.first, `${path}.first`);
      if (node.second) validateNode(node.second, `${path}.second`);
    } else {
      errors.push(`Invalid node type at ${path}`);
    }
  }

  validateNode(layout, 'root');

  for (const panel of panels) {
    if (!seenPanelIdsInTree.has(panel.id)) {
      errors.push(`Registered panel ${panel.id} does not appear in layout tree`);
    }
  }

  return { isValid: errors.length === 0, errors };
}

function migrateTerminalTabToPanelLayoutTree(tab, workspaceId = tab.workspaceId) {
  const rawPanes = (tab.terminalPanes && tab.terminalPanes.length > 0)
    ? tab.terminalPanes
    : (tab.panes && tab.panes.length > 0)
      ? tab.panes
      : [];

  const existingOrdinals = new Set(
    rawPanes
      .map((p) => p.stableOrdinal)
      .filter((n) => typeof n === 'number' && n >= 1 && n <= 6),
  );

  let nextAutoOrdinal = 1;
  const migratedPanes = rawPanes.map((pane) => {
    let ordinal = pane.stableOrdinal;
    if (typeof ordinal !== 'number' || ordinal < 1 || ordinal > 6) {
      while (existingOrdinals.has(nextAutoOrdinal) && nextAutoOrdinal <= 6) {
        nextAutoOrdinal++;
      }
      ordinal = nextAutoOrdinal;
      existingOrdinals.add(ordinal);
      nextAutoOrdinal++;
    }
    const accentId = pane.accentId || getAccentForOrdinal(ordinal);
    return {
      ...pane,
      stableOrdinal: ordinal,
      accentId,
    };
  });

  const activePaneId =
    tab.activeTerminalPaneId ||
    tab.activePaneId ||
    migratedPanes[0]?.id ||
    'pane-1';

  if (
    tab.panelLayout &&
    tab.panelLayout.type &&
    tab.panels &&
    tab.panels.length > 0 &&
    tab.capturePanelId
  ) {
    const nextOrdinal =
      tab.nextTerminalPaneOrdinal ||
      Math.max(...migratedPanes.map((p) => p.stableOrdinal), 0) + 1;

    return {
      ...tab,
      terminalPanes: migratedPanes,
      panes: migratedPanes,
      activeTerminalPaneId: activePaneId,
      activePaneId,
      nextTerminalPaneOrdinal: nextOrdinal,
    };
  }

  const terminalPanels = migratedPanes.map((p) => ({
    id: `panel-${p.id}`,
    kind: 'terminal',
    paneId: p.id,
  }));

  const capturePanelId = tab.capturePanelId || `capture-panel-${tab.id}`;
  const capturePanel = {
    id: capturePanelId,
    kind: 'capture',
    selectedCapturePaneIds: [activePaneId],
  };

  let panelLayout;

  if (terminalPanels.length <= 1) {
    const singlePanel = terminalPanels[0] ?? {
      id: `panel-${activePaneId}`,
      kind: 'terminal',
      paneId: activePaneId,
    };
    if (terminalPanels.length === 0) {
      terminalPanels.push(singlePanel);
    }
    panelLayout = {
      type: 'split',
      id: `split-root-${tab.id}`,
      direction: 'horizontal',
      ratio: 0.65,
      first: { type: 'panel', panelId: singlePanel.id },
      second: { type: 'panel', panelId: capturePanel.id },
    };
  } else {
    const [p1, p2] = terminalPanels;
    const direction = tab.paneLayoutDirection ?? 'horizontal';
    const splitRatio = tab.paneSplitRatio ?? 0.5;

    const terminalSplit = {
      type: 'split',
      id: `split-terminals-${tab.id}`,
      direction,
      ratio: clampSplitRatio(splitRatio),
      first: { type: 'panel', panelId: p1.id },
      second: { type: 'panel', panelId: p2.id },
    };

    panelLayout = {
      type: 'split',
      id: `split-root-${tab.id}`,
      direction: 'horizontal',
      ratio: 0.65,
      first: terminalSplit,
      second: { type: 'panel', panelId: capturePanel.id },
    };
  }

  const panels = [...terminalPanels, capturePanel];
  const maxOrdinal = Math.max(...migratedPanes.map((p) => p.stableOrdinal), 0);
  const nextOrdinal = tab.nextTerminalPaneOrdinal || maxOrdinal + 1;

  return {
    ...tab,
    workspaceId,
    terminalPanes: migratedPanes,
    panes: migratedPanes,
    panels,
    capturePanelId,
    panelLayout,
    activeTerminalPaneId: activePaneId,
    activePaneId,
    nextTerminalPaneOrdinal: nextOrdinal,
    paneIds: migratedPanes.map((p) => p.id),
  };
}

console.log('Running Panel Layout Tree Tests...');

// Test 1: findPanelNode
{
  const layout = {
    type: 'split',
    id: 's1',
    direction: 'horizontal',
    ratio: 0.65,
    first: { type: 'panel', panelId: 'p-term-1' },
    second: { type: 'panel', panelId: 'p-cap-1' },
  };
  assert.strictEqual(findPanelNode(layout, 'p-term-1')?.panelId, 'p-term-1');
  assert.strictEqual(findPanelNode(layout, 'p-cap-1')?.panelId, 'p-cap-1');
  assert.strictEqual(findPanelNode(layout, 'non-existent'), null);
  console.log('✓ findPanelNode works correctly');
}

// Test 2: findParentSplit
{
  const layout = {
    type: 'split',
    id: 'root-split',
    direction: 'horizontal',
    ratio: 0.65,
    first: {
      type: 'split',
      id: 'nested-split',
      direction: 'vertical',
      ratio: 0.5,
      first: { type: 'panel', panelId: 'p1' },
      second: { type: 'panel', panelId: 'p2' },
    },
    second: { type: 'panel', panelId: 'cap' },
  };

  assert.strictEqual(findParentSplit(layout, 'p1')?.id, 'nested-split');
  assert.strictEqual(findParentSplit(layout, 'p2')?.id, 'nested-split');
  assert.strictEqual(findParentSplit(layout, 'cap')?.id, 'root-split');
  assert.strictEqual(findParentSplit(layout, 'missing'), null);
  console.log('✓ findParentSplit finds direct parent split');
}

// Test 3: replacePanelNode
{
  const layout = {
    type: 'split',
    id: 's1',
    direction: 'horizontal',
    ratio: 0.5,
    first: { type: 'panel', panelId: 'p1' },
    second: { type: 'panel', panelId: 'p2' },
  };

  const newSubtree = {
    type: 'split',
    id: 's2',
    direction: 'vertical',
    ratio: 0.5,
    first: { type: 'panel', panelId: 'p1' },
    second: { type: 'panel', panelId: 'p3' },
  };

  const replaced = replacePanelNode(layout, 'p1', newSubtree);
  assert.strictEqual(replaced.first.type, 'split');
  assert.strictEqual(replaced.first.id, 's2');
  assert.strictEqual(replaced.second.panelId, 'p2');
  console.log('✓ replacePanelNode replaces leaf with subtree');
}

// Test 4: updateSplitRatio & clampSplitRatio
{
  const layout = {
    type: 'split',
    id: 's1',
    direction: 'horizontal',
    ratio: 0.5,
    first: {
      type: 'split',
      id: 's2',
      direction: 'vertical',
      ratio: 0.5,
      first: { type: 'panel', panelId: 'p1' },
      second: { type: 'panel', panelId: 'p2' },
    },
    second: { type: 'panel', panelId: 'cap' },
  };

  const updated = updateSplitRatio(layout, 's2', 0.9); // Should clamp to 0.8
  assert.strictEqual(updated.first.ratio, 0.8);
  assert.strictEqual(updated.ratio, 0.5); // s1 remains unchanged

  const clampedLow = updateSplitRatio(layout, 's1', 0.1); // Should clamp to 0.2
  assert.strictEqual(clampedLow.ratio, 0.2);
  console.log('✓ updateSplitRatio updates targeted split with clamping [0.2, 0.8]');
}

// Test 5: collectPanelIds
{
  const layout = {
    type: 'split',
    id: 's1',
    direction: 'horizontal',
    ratio: 0.65,
    first: {
      type: 'split',
      id: 's2',
      direction: 'vertical',
      ratio: 0.5,
      first: { type: 'panel', panelId: 'p1' },
      second: { type: 'panel', panelId: 'p2' },
    },
    second: { type: 'panel', panelId: 'cap' },
  };
  const ids = collectPanelIds(layout);
  assert.deepStrictEqual(ids, ['p1', 'p2', 'cap']);
  console.log('✓ collectPanelIds returns all panels in traversal order');
}

// Test 6: removePanelNodeAndCollapse
{
  // Tree: Split(s1) -> [Split(s2: p1, p2), cap]
  // Removing p1 collapses s2 to p2: Split(s1) -> [p2, cap]
  const layout = {
    type: 'split',
    id: 's1',
    direction: 'horizontal',
    ratio: 0.65,
    first: {
      type: 'split',
      id: 's2',
      direction: 'vertical',
      ratio: 0.5,
      first: { type: 'panel', panelId: 'p1' },
      second: { type: 'panel', panelId: 'p2' },
    },
    second: { type: 'panel', panelId: 'cap' },
  };

  const collapsed = removePanelNodeAndCollapse(layout, 'p1');
  assert.strictEqual(collapsed.type, 'split');
  assert.strictEqual(collapsed.first.type, 'panel');
  assert.strictEqual(collapsed.first.panelId, 'p2');
  assert.strictEqual(collapsed.second.panelId, 'cap');

  // Simple 2-leaf split removal collapses to surviving leaf
  const simple = {
    type: 'split',
    id: 'simple',
    direction: 'horizontal',
    ratio: 0.5,
    first: { type: 'panel', panelId: 'a' },
    second: { type: 'panel', panelId: 'b' },
  };
  const collapsedSimple = removePanelNodeAndCollapse(simple, 'a');
  assert.strictEqual(collapsedSimple.type, 'panel');
  assert.strictEqual(collapsedSimple.panelId, 'b');
  console.log('✓ removePanelNodeAndCollapse collapses tree correctly');
}

// Test 7: validatePanelLayout
{
  const panels = [
    { id: 'p1', kind: 'terminal', paneId: 'pane-1' },
    { id: 'p2', kind: 'terminal', paneId: 'pane-2' },
    { id: 'cap', kind: 'capture', selectedCapturePaneIds: ['pane-1'] },
  ];
  const terminalPanes = [
    { id: 'pane-1', stableOrdinal: 1, accentId: 'blue' },
    { id: 'pane-2', stableOrdinal: 2, accentId: 'violet' },
  ];
  const validLayout = {
    type: 'split',
    id: 's1',
    direction: 'horizontal',
    ratio: 0.65,
    first: {
      type: 'split',
      id: 's2',
      direction: 'vertical',
      ratio: 0.5,
      first: { type: 'panel', panelId: 'p1' },
      second: { type: 'panel', panelId: 'p2' },
    },
    second: { type: 'panel', panelId: 'cap' },
  };

  const validRes = validatePanelLayout(validLayout, panels, terminalPanes);
  assert.strictEqual(validRes.isValid, true, 'Valid layout passes validation');
  assert.strictEqual(validRes.errors.length, 0);

  // Missing capture panel
  const noCapPanels = panels.filter((p) => p.kind !== 'capture');
  const invalidRes = validatePanelLayout(validLayout, noCapPanels, terminalPanes);
  assert.strictEqual(invalidRes.isValid, false);

  // Duplicate panel leaf in tree
  const dupTree = {
    type: 'split',
    id: 's1',
    direction: 'horizontal',
    ratio: 0.5,
    first: { type: 'panel', panelId: 'p1' },
    second: { type: 'panel', panelId: 'p1' },
  };
  const dupRes = validatePanelLayout(dupTree, panels, terminalPanes);
  assert.strictEqual(dupRes.isValid, false);
  console.log('✓ validatePanelLayout validates invariants and detects errors');
}

// Test 8: migrateTerminalTabToPanelLayoutTree
{
  // 1-pane legacy tab
  const legacyOnePaneTab = {
    id: 'tab-1',
    workspaceId: 'ws-1',
    label: 'Tab 1',
    panes: [{ id: 'pane-1' }],
    activePaneId: 'pane-1',
  };

  const migrated1 = migrateTerminalTabToPanelLayoutTree(legacyOnePaneTab);
  assert.strictEqual(migrated1.terminalPanes.length, 1);
  assert.strictEqual(migrated1.terminalPanes[0].stableOrdinal, 1);
  assert.strictEqual(migrated1.terminalPanes[0].accentId, 'blue');
  assert.strictEqual(migrated1.panels.length, 2); // 1 terminal + 1 capture
  assert.strictEqual(migrated1.panels[1].kind, 'capture');
  assert.strictEqual(migrated1.panelLayout.type, 'split');
  assert.strictEqual(migrated1.panelLayout.first.panelId, 'panel-pane-1');
  assert.strictEqual(migrated1.panelLayout.second.panelId, migrated1.capturePanelId);

  const val1 = validatePanelLayout(migrated1.panelLayout, migrated1.panels, migrated1.terminalPanes);
  assert.strictEqual(val1.isValid, true, 'Migrated 1-pane tab passes validation');

  // 2-pane vertical legacy tab
  const legacyTwoPaneTab = {
    id: 'tab-2',
    workspaceId: 'ws-1',
    label: 'Tab 2',
    panes: [{ id: 'pane-a' }, { id: 'pane-b' }],
    activePaneId: 'pane-b',
    paneLayoutDirection: 'vertical',
    paneSplitRatio: 0.4,
  };

  const migrated2 = migrateTerminalTabToPanelLayoutTree(legacyTwoPaneTab);
  assert.strictEqual(migrated2.terminalPanes.length, 2);
  assert.strictEqual(migrated2.terminalPanes[0].stableOrdinal, 1);
  assert.strictEqual(migrated2.terminalPanes[0].accentId, 'blue');
  assert.strictEqual(migrated2.terminalPanes[1].stableOrdinal, 2);
  assert.strictEqual(migrated2.terminalPanes[1].accentId, 'violet');
  assert.strictEqual(migrated2.panels.length, 3); // 2 terminal + 1 capture

  // Structure: Split(horizontal) -> [Split(vertical: pane-a, pane-b), CapturePanel]
  assert.strictEqual(migrated2.panelLayout.type, 'split');
  assert.strictEqual(migrated2.panelLayout.direction, 'horizontal');
  assert.strictEqual(migrated2.panelLayout.first.type, 'split');
  assert.strictEqual(migrated2.panelLayout.first.direction, 'vertical');
  assert.strictEqual(migrated2.panelLayout.first.ratio, 0.4);
  assert.strictEqual(migrated2.panelLayout.second.panelId, migrated2.capturePanelId);

  const val2 = validatePanelLayout(migrated2.panelLayout, migrated2.panels, migrated2.terminalPanes);
  assert.strictEqual(val2.isValid, true, 'Migrated 2-pane tab passes validation');

  console.log('✓ migrateTerminalTabToPanelLayoutTree correctly migrates 1-pane and 2-pane states');
}

console.log('ALL PANEL LAYOUT TREE TESTS PASSED SUCCESSFULLY!');
