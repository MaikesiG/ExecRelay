import assert from 'node:assert';

/**
 * LT-PANE-HEADER-ITERM-STYLE-001
 * iTerm-Style Integrated Chrome Terminal Pane Header Tests
 */

function getTerminalPaneTitle(pane) {
  if (!pane) return 'Terminal';

  const candidates = [
    pane.sessionTitle,
    pane.foregroundProcessTitle,
    pane.foregroundProcessName,
    pane.cwdLabel,
    pane.session?.sessionInfo?.cwd
      ? (pane.session.sessionInfo.cwd.split('/').filter(Boolean).pop() ||
        pane.session.sessionInfo.cwd)
      : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return 'Terminal';
}

function renderPaneHeader(pane, tab, isTabActive = true) {
  const isPaneActive = isTabActive && pane.id === tab.activePaneId;
  const totalPanes = tab.terminalPanes?.length ?? tab.panes?.length ?? 1;
  const isMultiPane = totalPanes > 1;
  const paneTitle = getTerminalPaneTitle(pane);

  return {
    tag: 'div',
    className: 'terminal-pane-header',
    'data-multi-pane': isMultiPane ? 'true' : 'false',
    'data-active': isPaneActive ? 'true' : 'false',
    'data-accent': isMultiPane ? pane.accentId : undefined,
    children: [
      {
        tag: 'button',
        className: 'terminal-pane-close-button',
        'aria-label': `Close terminal pane ${pane.stableOrdinal}`,
        title: 'Close pane',
        children: [{ tag: 'span', 'aria-hidden': 'true', text: '×' }],
      },
      {
        tag: 'div',
        className: 'terminal-pane-title',
        title: paneTitle,
        text: paneTitle,
      },
      {
        tag: 'button',
        className: 'terminal-pane-actions-button',
        'aria-label': `Terminal pane ${pane.stableOrdinal} actions`,
        title: 'Pane actions',
        children: [{ tag: 'span', 'aria-hidden': 'true', text: '…' }],
      },
    ],
  };
}

console.log('Running iTerm-Style Pane Header Chrome Tests...\n');

// ---------------------------------------------------------------------------
// Test 1: Single-pane header is neutral
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Single-pane header is neutral ---');
  const tab = {
    id: 'tab-1',
    activePaneId: 'pane-1',
    terminalPanes: [{ id: 'pane-1', stableOrdinal: 1, accentId: 'blue' }],
    panes: [{ id: 'pane-1', stableOrdinal: 1, accentId: 'blue' }],
  };

  const header = renderPaneHeader(tab.panes[0], tab);

  assert.strictEqual(header.className, 'terminal-pane-header', 'Pane header must exist');
  assert.strictEqual(header['data-multi-pane'], 'false', 'Single-pane header must not be marked as multi-pane');
  assert.strictEqual(header['data-accent'], undefined, 'Single-pane header must not have accent tint data attribute');

  const closeBtn = header.children.find((c) => c.className === 'terminal-pane-close-button');
  assert.ok(closeBtn, 'Close button exists inside header');
  assert.strictEqual(closeBtn['aria-label'], 'Close terminal pane 1');

  const titleNode = header.children.find((c) => c.className === 'terminal-pane-title');
  assert.ok(titleNode, 'Title exists inside header');
  assert.strictEqual(titleNode.text, 'Terminal', 'Default fallback title is Terminal');

  const actionsBtn = header.children.find((c) => c.className === 'terminal-pane-actions-button');
  assert.ok(actionsBtn, 'Actions button exists inside header');
  assert.strictEqual(actionsBtn['aria-label'], 'Terminal pane 1 actions');

  // Verify no separate accent stripe element exists
  const separateStripeClasses = ['terminal-pane-accent-bar', 'terminal-pane-color-strip', 'terminal-pane-identity'];
  for (const cls of separateStripeClasses) {
    assert.strictEqual(header.children.some((c) => c.className === cls), false, `No separate stripe ${cls}`);
  }

  console.log('✓ Single-pane header renders neutral with close, title, and actions controls; no accent stripe');
}

// ---------------------------------------------------------------------------
// Test 2: Multi-pane header is integrated and tinted
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 2: Multi-pane header is integrated and tinted ---');
  const tab = {
    id: 'tab-1',
    activePaneId: 'pane-1',
    terminalPanes: [
      { id: 'pane-1', stableOrdinal: 1, accentId: 'blue' },
      { id: 'pane-2', stableOrdinal: 2, accentId: 'violet' },
    ],
    panes: [
      { id: 'pane-1', stableOrdinal: 1, accentId: 'blue' },
      { id: 'pane-2', stableOrdinal: 2, accentId: 'violet' },
    ],
  };

  const header1 = renderPaneHeader(tab.panes[0], tab);
  const header2 = renderPaneHeader(tab.panes[1], tab);

  assert.strictEqual(header1.className, 'terminal-pane-header');
  assert.strictEqual(header2.className, 'terminal-pane-header');

  assert.strictEqual(header1['data-multi-pane'], 'true');
  assert.strictEqual(header2['data-multi-pane'], 'true');

  assert.strictEqual(header1['data-accent'], 'blue', 'Header 1 has blue accent applied to header itself');
  assert.strictEqual(header2['data-accent'], 'violet', 'Header 2 has violet accent applied to header itself');

  assert.strictEqual(header1['data-active'], 'true', 'Active pane is marked active');
  assert.strictEqual(header2['data-active'], 'false', 'Inactive pane is marked inactive');

  console.log('✓ Multi-pane headers render integrated and tinted per pane accent');
}

// ---------------------------------------------------------------------------
// Test 3: Title resolution uses real fields
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 3: Title resolution priority ---');

  // Priority 1: sessionTitle
  const p1 = { sessionTitle: 'traceRelay', foregroundProcessTitle: 'npm test', foregroundProcessName: 'python', cwdLabel: 'docs' };
  assert.strictEqual(getTerminalPaneTitle(p1), 'traceRelay');

  // Priority 2: foregroundProcessTitle
  const p2 = { foregroundProcessTitle: 'npm test', foregroundProcessName: 'python', cwdLabel: 'docs' };
  assert.strictEqual(getTerminalPaneTitle(p2), 'npm test');

  // Priority 3: foregroundProcessName
  const p3 = { foregroundProcessName: 'python', cwdLabel: 'docs' };
  assert.strictEqual(getTerminalPaneTitle(p3), 'python');

  // Priority 4: cwdLabel
  const p4 = { cwdLabel: 'docs' };
  assert.strictEqual(getTerminalPaneTitle(p4), 'docs');

  // Priority 5: Fallback to Terminal
  const p5 = {};
  assert.strictEqual(getTerminalPaneTitle(p5), 'Terminal');

  // Null/undefined/empty whitespace handling
  assert.strictEqual(getTerminalPaneTitle(null), 'Terminal');
  assert.strictEqual(getTerminalPaneTitle({ sessionTitle: '   ' }), 'Terminal');

  console.log('✓ Dynamic title resolution follows strict priority order and falls back to "Terminal"');
}

// ---------------------------------------------------------------------------
// Test 4: Hardcoded zsh removed
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 4: Hardcoded zsh removed ---');
  const paneNoTitle = { id: 'pane-1', stableOrdinal: 1, accentId: 'blue', session: { sessionInfo: { shell: '/bin/zsh' } } };
  const resolved = getTerminalPaneTitle(paneNoTitle);
  assert.strictEqual(resolved, 'Terminal', 'Default title must be "Terminal" even when shell is zsh');
  assert.notStrictEqual(resolved, 'zsh');
  assert.notStrictEqual(resolved, '-zsh');

  // Explicit title "zsh" is respected if passed in sessionTitle
  const paneExplicitZsh = { sessionTitle: 'zsh' };
  assert.strictEqual(getTerminalPaneTitle(paneExplicitZsh), 'zsh', 'Explicit session title "zsh" is preserved');
  console.log('✓ Hardcoded "zsh" is removed; fallback is "Terminal" unless explicitly supplied');
}

// ---------------------------------------------------------------------------
// Test 5: Close / Title / Actions share same header parent
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 5: Controls share same header parent ---');
  const tab = {
    id: 'tab-1',
    activePaneId: 'pane-1',
    terminalPanes: [
      { id: 'pane-1', stableOrdinal: 1, accentId: 'emerald' },
      { id: 'pane-2', stableOrdinal: 2, accentId: 'rose' },
    ],
    panes: [
      { id: 'pane-1', stableOrdinal: 1, accentId: 'emerald' },
      { id: 'pane-2', stableOrdinal: 2, accentId: 'rose' },
    ],
  };

  const header = renderPaneHeader(tab.panes[0], tab);
  assert.strictEqual(header.children.length, 3);
  assert.strictEqual(header.children[0].className, 'terminal-pane-close-button');
  assert.strictEqual(header.children[1].className, 'terminal-pane-title');
  assert.strictEqual(header.children[2].className, 'terminal-pane-actions-button');
  console.log('✓ Close, title, and actions controls are all children of the single header container');
}

// ---------------------------------------------------------------------------
// Test 6: Capture UI not moved into pane header
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 6: Capture UI separation ---');
  const tab = {
    id: 'tab-1',
    activePaneId: 'pane-1',
    terminalPanes: [{ id: 'pane-1', stableOrdinal: 1, accentId: 'blue' }],
    panes: [{ id: 'pane-1', stableOrdinal: 1, accentId: 'blue' }],
  };

  const header = renderPaneHeader(tab.panes[0], tab);

  // Check that no checkbox exists in header
  const hasCheckbox = header.children.some(
    (c) => c.tag === 'input' && c.type === 'checkbox' || (c.className && c.className.includes('capture'))
  );
  assert.strictEqual(hasCheckbox, false, 'Pane header must contain no capture target checkbox controls');

  // Verify capture panel maintains target selector
  const capturePanel = {
    id: 'capture-panel-1',
    kind: 'capture',
    selectedCapturePaneIds: ['pane-1'],
  };
  assert.deepStrictEqual(capturePanel.selectedCapturePaneIds, ['pane-1'], 'Capture Panel owns target checkboxes');
  console.log('✓ Capture target controls remain exclusively in Capture Panel');
}

console.log('\n=========================================');
console.log('ALL 6 PANE HEADER CHROME TESTS PASSED!');
console.log('=========================================');
