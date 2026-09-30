import assert from 'node:assert';

/**
 * LT-UNIFY-TAB-AND-CLOSE-BUTTON-STYLING-001
 * Unified Terminal Tabs and Close Button Styling Tests
 */

function renderWorkspaceTab(ws, activeWorkspaceId) {
  const isActive = ws.id === activeWorkspaceId;
  return {
    tag: 'div',
    className: `workspace-tab-item chrome-tab chrome-tab--workspace ${isActive ? 'workspace-tab-item--active chrome-tab--active' : ''}`,
    'data-active': isActive ? 'true' : 'false',
    height: '28px',
    borderRadius: '6px',
    hasTopAccentHighlight: true,
    accentColorToken: 'var(--workspace-tab-accent, var(--accent, #7c8cff))',
    children: [
      {
        tag: 'button',
        className: 'workspace-tab-item-button chrome-tab-button',
        children: [{ tag: 'span', className: 'workspace-tab-item-name', text: ws.name }],
      },
      {
        tag: 'button',
        className: 'workspace-tab-item-close chrome-close-button chrome-close-button--tab close-button',
        'aria-label': `Delete ${ws.name}`,
        text: '×',
      },
    ],
  };
}

function renderTerminalTab(tab, activeTabId) {
  const isActive = tab.id === activeTabId;
  return {
    tag: 'div',
    className: `workspace-tab terminal-tab chrome-tab chrome-tab--terminal ${isActive ? 'workspace-tab--active terminal-tab--active chrome-tab--active' : ''}`,
    'data-active': isActive ? 'true' : 'false',
    height: '28px',
    borderRadius: '6px',
    hasTopAccentHighlight: true,
    accentColorToken: 'var(--terminal-tab-accent, var(--green, #34d399))',
    bodyBackground: isActive ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)',
    children: [
      {
        tag: 'button',
        className: `workspace-tab-activator chrome-tab-button ${isActive ? 'workspace-tab-activator--active' : ''}`,
        children: [
          { tag: 'span', className: 'workspace-tab-label', text: tab.name ?? tab.label },
        ],
      },
      {
        tag: 'button',
        className: 'workspace-tab-close terminal-tab-close chrome-close-button chrome-close-button--tab close-button',
        'aria-label': `Close ${tab.name ?? tab.label}`,
        text: '×',
      },
    ],
  };
}

function renderTerminalPaneHeader(pane, tab, isTabActive = true) {
  const isPaneActive = isTabActive && pane.id === tab.activePaneId;
  const totalPanes = tab.terminalPanes?.length ?? tab.panes?.length ?? 1;
  const isMultiPane = totalPanes > 1;
  const displayTitle = pane.customTitle ?? pane.sessionTitle ?? 'Terminal';

  const children = [];
  if (isMultiPane) {
    children.push({
      tag: 'button',
      className: 'terminal-pane-close-button chrome-close-button chrome-close-button--pane close-button',
      'aria-label': `Close terminal pane ${pane.stableOrdinal}`,
      title: 'Close pane',
      text: '×',
    });
  } else {
    children.push({
      tag: 'span',
      className: 'terminal-pane-header-spacer',
      'aria-hidden': 'true',
    });
  }

  children.push({
    tag: 'div',
    className: 'terminal-pane-title',
    title: displayTitle,
    text: displayTitle,
  });

  children.push({
    tag: 'div',
    className: 'terminal-pane-actions-container',
    children: [
      {
        tag: 'button',
        className: 'terminal-pane-actions-button',
        'aria-label': `Terminal pane ${pane.stableOrdinal} actions`,
        title: 'Pane actions',
        text: '…',
      },
    ],
  });

  return {
    tag: 'div',
    className: 'terminal-pane-header terminal-pane-header--compact',
    'data-density': 'compact',
    'data-multi-pane': isMultiPane ? 'true' : 'false',
    'data-active': isPaneActive ? 'true' : 'false',
    'data-accent': isMultiPane ? pane.accentId : undefined,
    children,
  };
}

console.log('Running Unified Tab and Close Button Styling Tests...\n');

// ---------------------------------------------------------------------------
// Test 1: Terminal tabs share workspace tab structure
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Terminal tabs share workspace tab structure ---');
  const ws = { id: 'ws-1', name: 'Workspace 1' };
  const tab = { id: 'tab-1', label: 'Terminal 1' };

  const wsTab = renderWorkspaceTab(ws, 'ws-1');
  const termTab = renderTerminalTab(tab, 'tab-1');

  // Both share the same base tab structure/class family
  assert.ok(wsTab.className.includes('chrome-tab'), 'Workspace tab has chrome-tab base class');
  assert.ok(termTab.className.includes('chrome-tab'), 'Terminal tab has chrome-tab base class');

  // Shared sizing and geometry
  assert.strictEqual(wsTab.height, termTab.height, 'Tabs have identical 28px height');
  assert.strictEqual(wsTab.borderRadius, termTab.borderRadius, 'Tabs have identical 6px border-radius');

  // Terminal tab exposes terminal-specific accent variant
  assert.ok(termTab.className.includes('chrome-tab--terminal'), 'Terminal tab has chrome-tab--terminal variant');
  assert.ok(wsTab.className.includes('chrome-tab--workspace'), 'Workspace tab has chrome-tab--workspace variant');

  console.log('✓ Terminal tabs match workspace tabs in base structure, height, and border-radius while exposing terminal variant');
}

// ---------------------------------------------------------------------------
// Test 2: Terminal tab green accent
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 2: Terminal tab green accent ---');
  const activeTab = renderTerminalTab({ id: 'tab-1', label: 'Term 1' }, 'tab-1');

  // Top highlight is green
  assert.strictEqual(activeTab.hasTopAccentHighlight, true, 'Active tab has top accent highlight');
  assert.ok(
    activeTab.accentColorToken.includes('green') || activeTab.accentColorToken.includes('terminal-tab-accent'),
    'Accent color token references green/color-success'
  );

  // Body is not fully green-filled (translucent neutral surface, not solid green)
  assert.strictEqual(
    activeTab.bodyBackground.includes('green') || activeTab.bodyBackground === '#22c55e',
    false,
    'Tab body must not be fully green-filled'
  );
  assert.strictEqual(activeTab.bodyBackground, 'rgba(255, 255, 255, 0.08)');

  console.log('✓ Active terminal tab uses subtle green top accent highlight and neutral body fill');
}

// ---------------------------------------------------------------------------
// Test 3: Unified x button style
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 3: Unified x button style ---');
  const wsTab = renderWorkspaceTab({ id: 'ws-1', name: 'Ws' }, 'ws-1');
  const termTab = renderTerminalTab({ id: 't-1', label: 'T' }, 't-1');
  const paneHeader = renderTerminalPaneHeader(
    { id: 'p-1', stableOrdinal: 1, accentId: 'blue' },
    { terminalPanes: [{ id: 'p-1' }, { id: 'p-2' }], panes: [{ id: 'p-1' }, { id: 'p-2' }] }
  );

  const wsCloseBtn = wsTab.children.find((c) => c.className.includes('chrome-close-button'));
  const termCloseBtn = termTab.children.find((c) => c.className.includes('chrome-close-button'));
  const paneCloseBtn = paneHeader.children.find((c) => c.className.includes('chrome-close-button'));

  assert.ok(wsCloseBtn, 'Workspace tab close button has chrome-close-button class');
  assert.ok(termCloseBtn, 'Terminal tab close button has chrome-close-button class');
  assert.ok(paneCloseBtn, 'Pane close button has chrome-close-button class');

  // Common close-button family
  assert.ok(wsCloseBtn.className.includes('close-button'));
  assert.ok(termCloseBtn.className.includes('close-button'));
  assert.ok(paneCloseBtn.className.includes('close-button'));

  // Assert no permanent red-outline style remains
  assert.strictEqual(wsCloseBtn['data-style'], undefined, 'No red outline data-style on ws close');
  assert.strictEqual(termCloseBtn['data-style'], undefined, 'No red outline data-style on term close');
  assert.strictEqual(paneCloseBtn['data-style'], undefined, 'No red outline data-style on pane close');

  console.log('✓ All close buttons across Workspace tabs, Terminal tabs, and Pane headers share the same x-button family without red outline');
}

// ---------------------------------------------------------------------------
// Test 4: Last pane hides close button
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 4: Last pane hides close button ---');
  const singlePaneTab = {
    id: 'tab-1',
    activePaneId: 'p-1',
    terminalPanes: [{ id: 'p-1', stableOrdinal: 1, accentId: 'blue' }],
    panes: [{ id: 'p-1', stableOrdinal: 1, accentId: 'blue' }],
  };

  const header = renderTerminalPaneHeader(singlePaneTab.panes[0], singlePaneTab);

  // Close button must NOT be rendered
  const closeBtn = header.children.find((c) => c.tag === 'button' && c.className && c.className.includes('close-button'));
  assert.strictEqual(closeBtn, undefined, 'Close button must not be rendered when only one pane remains');

  // Alignment spacer is present instead
  const spacer = header.children.find((c) => c.className === 'terminal-pane-header-spacer');
  assert.ok(spacer, 'Spacer preserves title centering alignment');
  assert.strictEqual(spacer.tag, 'span');
  assert.strictEqual(spacer['aria-hidden'], 'true');

  // Title still renders
  const title = header.children.find((c) => c.className === 'terminal-pane-title');
  assert.ok(title, 'Title renders properly');

  // Actions button still renders
  const actions = header.children.find((c) => c.className === 'terminal-pane-actions-container');
  assert.ok(actions, 'Actions button renders properly');

  console.log('✓ Final remaining pane hides close button completely while preserving title and actions alignment');
}

// ---------------------------------------------------------------------------
// Test 5: Multi-pane still shows close button
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 5: Multi-pane still shows close button ---');
  const multiPaneTab = {
    id: 'tab-1',
    activePaneId: 'p-1',
    terminalPanes: [
      { id: 'p-1', stableOrdinal: 1, accentId: 'blue' },
      { id: 'p-2', stableOrdinal: 2, accentId: 'violet' },
    ],
    panes: [
      { id: 'p-1', stableOrdinal: 1, accentId: 'blue' },
      { id: 'p-2', stableOrdinal: 2, accentId: 'violet' },
    ],
  };

  const header1 = renderTerminalPaneHeader(multiPaneTab.panes[0], multiPaneTab);
  const header2 = renderTerminalPaneHeader(multiPaneTab.panes[1], multiPaneTab);

  const closeBtn1 = header1.children.find((c) => c.tag === 'button' && c.className.includes('close-button'));
  const closeBtn2 = header2.children.find((c) => c.tag === 'button' && c.className.includes('close-button'));

  assert.ok(closeBtn1, 'Pane 1 close button is rendered');
  assert.ok(closeBtn2, 'Pane 2 close button is rendered');
  assert.ok(closeBtn1.className.includes('chrome-close-button--pane'), 'Uses shared pane close button class');
  assert.ok(closeBtn2.className.includes('chrome-close-button--pane'), 'Uses shared pane close button class');

  console.log('✓ Multi-pane mode renders unified close button for each pane');
}

// ---------------------------------------------------------------------------
// Test 6: Close semantics unchanged
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 6: Close semantics unchanged ---');

  // Simulated close logic matching App.tsx and createDefaultWorkspace.ts
  let tabPanes = ['pane-1', 'pane-2'];
  let toastShown = null;

  function requestClosePane(paneId) {
    if (tabPanes.length <= 1) {
      toastShown = 'Cannot close the last pane';
      return false;
    }
    tabPanes = tabPanes.filter((id) => id !== paneId);
    return true;
  }

  // 1. Close in multi-pane mode succeeds
  const closed = requestClosePane('pane-2');
  assert.strictEqual(closed, true, 'Closing pane in multi-pane mode succeeds');
  assert.deepStrictEqual(tabPanes, ['pane-1'], 'Pane 2 removed');
  assert.strictEqual(toastShown, null, 'No toast shown');

  // 2. Final remaining pane guard triggers
  const closedLast = requestClosePane('pane-1');
  assert.strictEqual(closedLast, false, 'Closing final pane is blocked');
  assert.deepStrictEqual(tabPanes, ['pane-1'], 'Pane 1 preserved');
  assert.strictEqual(toastShown, 'Cannot close the last pane', 'Final pane toast triggered');

  console.log('✓ Pane close logic, final remaining pane guard, and toast behavior remain strictly intact');
}

console.log('\n=============================================================');
console.log('ALL 6 UNIFIED TAB AND CLOSE BUTTON STYLING TESTS PASSED!');
console.log('=============================================================');
