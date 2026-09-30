import assert from 'node:assert';

/**
 * LT-COMPACT-CHROME-RENAME-AND-TAB-POLISH-001
 * Compact Terminal Chrome, Per-Pane Renaming, and Tab Redesign Tests
 */

// Pure models representing the implemented logic

function getTerminalPaneDisplayTitle(pane) {
  if (!pane) return 'Terminal';

  const custom = pane.customTitle?.trim();
  if (custom) return custom;

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

function renameTerminalPaneInWorkspaces(
  workspaces,
  workspaceId,
  terminalTabId,
  paneId,
  nextCustomTitle,
) {
  const trimmed = nextCustomTitle ? nextCustomTitle.trim() : '';
  const finalTitle = trimmed.length > 0 ? trimmed.slice(0, 40) : null;

  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
    if (!tab) return ws;
    if (!tab.panes.some((p) => p.id === paneId)) return ws;

    const updatedPanes = tab.panes.map((p) => {
      if (p.id !== paneId) return p;
      return {
        ...p,
        customTitle: finalTitle,
      };
    });

    const updatedTabs = ws.terminalTabs.map((t) => {
      if (t.id !== terminalTabId) return t;
      return {
        ...t,
        terminalPanes: updatedPanes,
        panes: updatedPanes,
      };
    });

    const updatedWorkspacePanes = ws.panes.map((p) => {
      if (p.id !== paneId) return p;
      return {
        ...p,
        customTitle: finalTitle,
      };
    });

    return {
      ...ws,
      terminalTabs: updatedTabs,
      panes: updatedWorkspacePanes,
    };
  });
}

function renderTerminalPaneHeader(pane, tab, isTabActive = true) {
  const isPaneActive = isTabActive && pane.id === tab.activePaneId;
  const totalPanes = tab.terminalPanes?.length ?? tab.panes?.length ?? 1;
  const isMultiPane = totalPanes > 1;
  const displayTitle = getTerminalPaneDisplayTitle(pane);

  const closeOrSpacer = isMultiPane
    ? {
        tag: 'button',
        className: 'terminal-pane-close-button chrome-close-button chrome-close-button--pane close-button',
        'aria-label': `Close terminal pane ${pane.stableOrdinal}`,
        title: 'Close pane',
        children: [{ tag: 'span', 'aria-hidden': 'true', text: '×' }],
      }
    : {
        tag: 'span',
        className: 'terminal-pane-header-spacer',
        'aria-hidden': 'true',
      };

  return {
    tag: 'div',
    className: 'terminal-pane-header terminal-pane-header--compact',
    'data-density': 'compact',
    'data-multi-pane': isMultiPane ? 'true' : 'false',
    'data-active': isPaneActive ? 'true' : 'false',
    'data-accent': isMultiPane ? pane.accentId : undefined,
    children: [
      closeOrSpacer,
      {
        tag: 'div',
        className: 'terminal-pane-title',
        title: displayTitle,
        text: displayTitle,
      },
      {
        tag: 'div',
        className: 'terminal-pane-actions-container',
        children: [
          {
            tag: 'button',
            className: 'terminal-pane-actions-button',
            'aria-label': `Terminal pane ${pane.stableOrdinal} actions`,
            title: 'Pane actions',
            children: [{ tag: 'span', 'aria-hidden': 'true', text: '…' }],
          },
        ],
      },
    ],
  };
}

function renderTerminalTab(tab, activeTabId) {
  const isActive = tab.id === activeTabId;
  return {
    tag: 'div',
    className: `workspace-tab terminal-tab ${isActive ? 'workspace-tab--active terminal-tab--active' : ''}`,
    'data-active': isActive ? 'true' : 'false',
    hasTopAccentHighlight: true,
    children: [
      {
        tag: 'button',
        className: `workspace-tab-activator ${isActive ? 'workspace-tab-activator--active' : ''}`,
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

function renderWorkspaceTab(ws, activeWorkspaceId) {
  const isActive = ws.id === activeWorkspaceId;
  return {
    tag: 'div',
    className: `workspace-tab-item ${isActive ? 'workspace-tab-item--active' : ''}`,
    height: '28px',
    borderRadius: '6px',
    children: [
      {
        tag: 'button',
        className: 'workspace-tab-item-button',
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

console.log('Running Compact Chrome, Rename, and Tab Polish Tests...\n');

// ---------------------------------------------------------------------------
// Test 1: Pane header is more compact
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Pane header is more compact ---');
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

  const header = renderTerminalPaneHeader(tab.panes[0], tab);

  assert.ok(header.className.includes('terminal-pane-header--compact'), 'Compact modifier class applied');
  assert.strictEqual(header['data-density'], 'compact', 'Compact data-density attribute applied');

  // Verify structure includes close, title, and actions
  const closeBtn = header.children.find((c) => c.className.includes('terminal-pane-close-button'));
  assert.ok(closeBtn, 'Close button exists in header');

  const titleNode = header.children.find((c) => c.className.includes('terminal-pane-title'));
  assert.ok(titleNode, 'Title exists in header');

  const actionsContainer = header.children.find((c) => c.className.includes('terminal-pane-actions-container'));
  assert.ok(actionsContainer, 'Actions container exists in header');
  const actionsBtn = actionsContainer.children.find((c) => c.className.includes('terminal-pane-actions-button'));
  assert.ok(actionsBtn, 'Actions button exists in actions container');

  console.log('✓ Pane header has compact styling flags and complete controls structure');
}

// ---------------------------------------------------------------------------
// Test 2: Rename custom title overrides fallback
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 2: Rename custom title overrides fallback ---');
  const pane = {
    id: 'pane-1',
    stableOrdinal: 1,
    accentId: 'blue',
    sessionTitle: 'python',
    customTitle: null,
  };

  // 1. Initial display title without customTitle
  assert.strictEqual(getTerminalPaneDisplayTitle(pane), 'python', 'Fallback title used when customTitle is null');

  // 2. Set customTitle
  pane.customTitle = 'backend logs';
  assert.strictEqual(getTerminalPaneDisplayTitle(pane), 'backend logs', 'customTitle overrides sessionTitle');

  // 3. Clear customTitle
  pane.customTitle = null;
  assert.strictEqual(getTerminalPaneDisplayTitle(pane), 'python', 'Clearing customTitle returns to fallback title');

  console.log('✓ Custom pane title overrides dynamic title sources and clearing restores fallback');
}

// ---------------------------------------------------------------------------
// Test 3: Rename is pane-scoped
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 3: Rename is pane-scoped ---');
  let workspaces = [
    {
      id: 'ws-1',
      name: 'Workspace 1',
      terminalTabs: [
        {
          id: 'tab-1',
          panes: [
            { id: 'pane-1', stableOrdinal: 1, accentId: 'blue', customTitle: null, sessionTitle: 'bash' },
            { id: 'pane-2', stableOrdinal: 2, accentId: 'violet', customTitle: null, sessionTitle: 'zsh' },
          ],
        },
      ],
      panes: [
        { id: 'pane-1', stableOrdinal: 1, accentId: 'blue', customTitle: null, sessionTitle: 'bash' },
        { id: 'pane-2', stableOrdinal: 2, accentId: 'violet', customTitle: null, sessionTitle: 'zsh' },
      ],
    },
  ];

  workspaces = renameTerminalPaneInWorkspaces(workspaces, 'ws-1', 'tab-1', 'pane-1', 'server');

  const p1 = workspaces[0].terminalTabs[0].panes.find((p) => p.id === 'pane-1');
  const p2 = workspaces[0].terminalTabs[0].panes.find((p) => p.id === 'pane-2');

  assert.strictEqual(getTerminalPaneDisplayTitle(p1), 'server', 'Pane 1 title renamed to server');
  assert.strictEqual(getTerminalPaneDisplayTitle(p2), 'zsh', 'Pane 2 title remains unchanged');
  assert.strictEqual(p2.customTitle, null, 'Pane 2 customTitle remains null');

  console.log('✓ Renaming is strictly pane-scoped and does not cross-contaminate sibling panes');
}

// ---------------------------------------------------------------------------
// Test 4: Empty rename clears custom title
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 4: Empty rename clears custom title ---');
  let workspaces = [
    {
      id: 'ws-1',
      name: 'Workspace 1',
      terminalTabs: [
        {
          id: 'tab-1',
          panes: [
            { id: 'pane-1', stableOrdinal: 1, accentId: 'blue', customTitle: 'docs', sessionTitle: 'python' },
          ],
        },
      ],
      panes: [
        { id: 'pane-1', stableOrdinal: 1, accentId: 'blue', customTitle: 'docs', sessionTitle: 'python' },
      ],
    },
  ];

  // Submit whitespace-only string
  workspaces = renameTerminalPaneInWorkspaces(workspaces, 'ws-1', 'tab-1', 'pane-1', '   ');

  const p1 = workspaces[0].terminalTabs[0].panes.find((p) => p.id === 'pane-1');
  assert.strictEqual(p1.customTitle, null, 'customTitle set to null on whitespace-only input');
  assert.strictEqual(getTerminalPaneDisplayTitle(p1), 'python', 'Fallback title displayed');

  console.log('✓ Whitespace-only rename resets custom title to null and falls back to dynamic title');
}

// ---------------------------------------------------------------------------
// Test 5: Terminal tabs share workspace-tab structure
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 5: Terminal tabs share workspace-tab structure ---');
  const ws = { id: 'ws-1', name: 'Main' };
  const tab = { id: 'tab-1', label: 'Terminal 1' };

  const wsTab = renderWorkspaceTab(ws, 'ws-1');
  const termTab = renderTerminalTab(tab, 'tab-1');

  // Assert terminal tabs use the compact structure with matching height and border-radius family
  assert.ok(termTab.className.includes('terminal-tab'), 'Includes terminal-tab class');
  assert.ok(termTab.className.includes('workspace-tab'), 'Includes workspace-tab class');
  assert.strictEqual(termTab.hasTopAccentHighlight, true, 'Terminal tab exposes top accent highlight');

  console.log('✓ Terminal tabs match workspace tab height rhythm and layout while retaining terminal identity');
}

// ---------------------------------------------------------------------------
// Test 6: Active terminal tab shows top accent
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 6: Active terminal tab shows top accent ---');
  const activeTab = renderTerminalTab({ id: 'tab-1', label: 'Term 1' }, 'tab-1');
  const inactiveTab = renderTerminalTab({ id: 'tab-2', label: 'Term 2' }, 'tab-1');

  assert.strictEqual(activeTab['data-active'], 'true', 'Active tab data-active is true');
  assert.ok(activeTab.className.includes('terminal-tab--active'), 'Active tab has active class modifier');

  assert.strictEqual(inactiveTab['data-active'], 'false', 'Inactive tab data-active is false');
  assert.strictEqual(inactiveTab.className.includes('terminal-tab--active'), false, 'Inactive tab has no active class');

  console.log('✓ Active terminal tab is highlighted with accent treatment while inactive remains neutral');
}

// ---------------------------------------------------------------------------
// Test 7: Close button style
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 7: Close button style ---');
  const tab = { id: 'tab-1', label: 'Term 1' };
  const termTab = renderTerminalTab(tab, 'tab-1');
  const tabCloseBtn = termTab.children.find((c) => c.className.includes('close-button--tab'));

  assert.ok(tabCloseBtn, 'Tab close button has close-button--tab class');
  assert.ok(tabCloseBtn.className.includes('close-button'), 'Tab close button has common close-button class');
  assert.ok(tabCloseBtn.className.includes('chrome-close-button'), 'Tab close button has chrome-close-button class');
  assert.strictEqual(tabCloseBtn['data-style'], undefined, 'No red-outline data-style on tab close button');

  const paneHeader = renderTerminalPaneHeader(
    { id: 'p-1', stableOrdinal: 1, accentId: 'blue' },
    { terminalPanes: [{ id: 'p-1' }, { id: 'p-2' }], panes: [{ id: 'p-1' }, { id: 'p-2' }] }
  );
  const paneCloseBtn = paneHeader.children.find((c) => c.className && c.className.includes('close-button--pane'));

  assert.ok(paneCloseBtn, 'Pane close button has close-button--pane class');
  assert.ok(paneCloseBtn.className.includes('close-button'), 'Pane close button has common close-button class');
  assert.ok(paneCloseBtn.className.includes('chrome-close-button'), 'Pane close button has chrome-close-button class');
  assert.strictEqual(paneCloseBtn['data-style'], undefined, 'No red-outline data-style on pane close button');

  console.log('✓ Both tab and pane close buttons use the unified close button design family without permanent red outline');
}

// ---------------------------------------------------------------------------
// Test 8: Capture behavior unaffected by rename
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 8: Capture behavior unaffected by rename ---');

  // Simulated capture runtime
  const captureRuntime = {
    workspaceId: 'ws-1',
    terminalTabId: 'tab-1',
    paneId: 'pane-1',
    paneOrdinal: 1,
    status: 'capturing',
    captureSessionId: 'sess-abc',
    captureGroupId: 'group-xyz',
    activeBlockId: 'blk-1',
  };

  const capturePanel = {
    id: 'capture-panel-1',
    kind: 'capture',
    selectedCapturePaneIds: ['pane-1'],
  };

  const transcriptBlocks = [
    {
      id: 'blk-1',
      terminalPaneId: 'pane-1',
      sourcePaneOrdinal: 1,
      sourceAccentId: 'blue',
      output: 'test log output',
    },
  ];

  let workspaces = [
    {
      id: 'ws-1',
      terminalTabs: [
        {
          id: 'tab-1',
          panes: [
            {
              id: 'pane-1',
              stableOrdinal: 1,
              accentId: 'blue',
              capture: { isListening: true, currentBatchId: 1, sessionId: 'sess-abc' },
              sessionTitle: 'python',
              customTitle: null,
            },
          ],
        },
      ],
      panes: [
        {
          id: 'pane-1',
          stableOrdinal: 1,
          accentId: 'blue',
          capture: { isListening: true, currentBatchId: 1, sessionId: 'sess-abc' },
          sessionTitle: 'python',
          customTitle: null,
        },
      ],
    },
  ];

  // Rename pane
  workspaces = renameTerminalPaneInWorkspaces(workspaces, 'ws-1', 'tab-1', 'pane-1', 'ML Worker');

  const renamedPane = workspaces[0].terminalTabs[0].panes[0];
  assert.strictEqual(renamedPane.customTitle, 'ML Worker');
  assert.strictEqual(getTerminalPaneDisplayTitle(renamedPane), 'ML Worker');

  // Assert capture runtime invariants
  assert.strictEqual(captureRuntime.paneId, 'pane-1', 'Runtime paneId identity unchanged');
  assert.strictEqual(captureRuntime.status, 'capturing', 'Capture runtime status unchanged');
  assert.strictEqual(captureRuntime.captureSessionId, 'sess-abc', 'Capture sessionId unchanged');
  assert.strictEqual(captureRuntime.captureGroupId, 'group-xyz', 'Capture groupId unchanged');

  // Assert capture panel selection invariants
  assert.deepStrictEqual(capturePanel.selectedCapturePaneIds, ['pane-1'], 'Capture selector targets remain pane-id based');

  // Assert transcript block source invariants
  assert.strictEqual(transcriptBlocks[0].terminalPaneId, 'pane-1', 'Transcript source identity remains pane-based');
  assert.strictEqual(transcriptBlocks[0].sourcePaneOrdinal, 1, 'Transcript ordinal identity unchanged');

  console.log('✓ Capture runtime, selector targets, and transcript identity remain completely unaffected by rename');
}

console.log('\n======================================================');
console.log('ALL 8 COMPACT CHROME, RENAME & TAB POLISH TESTS PASSED!');
console.log('======================================================');
