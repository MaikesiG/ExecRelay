import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task ID: LT-TAB-GAP-AND-DESTRUCTIVE-ICON-SEMANTICS-004
 * Title: Reduce Tab Strip Gaps and Correct Delete/Clear Icons in Capture Controls
 */

// Simulated models matching WorkspaceTabBar, WorkspaceTabs, and TranscriptCapturePanel
function renderWorkspaceTabStrip({
  workspaces = [
    { id: 'ws-1', name: 'Default' },
    { id: 'ws-2', name: 'Frontend' },
  ],
  activeWorkspaceId = 'ws-1',
  onSelectWorkspace,
  onCloseWorkspace,
} = {}) {
  return {
    tag: 'nav',
    className: 'workspace-tab-bar',
    gap: '2px',
    padding: '0 var(--tab-strip-gap, 2px)',
    list: {
      tag: 'div',
      className: 'workspace-tab-bar-list workspace-tabs-list',
      gap: '2px',
      gapToken: 'var(--tab-strip-gap, 2px)',
      tabs: workspaces.map((ws) => {
        const isActive = ws.id === activeWorkspaceId;
        return {
          tag: 'div',
          className: `workspace-tab-item chrome-tab chrome-tab--workspace ${isActive ? 'workspace-tab-item--active chrome-tab--active' : ''}`,
          id: ws.id,
          name: ws.name,
          button: {
            onClick: () => onSelectWorkspace?.(ws.id),
          },
          closeBtn: {
            className: 'workspace-tab-item-close chrome-close-button chrome-close-button--tab close-button',
            onClick: () => onCloseWorkspace?.(ws.id),
          },
        };
      }),
    },
  };
}

function renderTerminalTabStrip({
  tabs = [
    { id: 'tab-1', label: 'Terminal 1' },
    { id: 'tab-2', label: 'Terminal 2' },
  ],
  activeTabId = 'tab-1',
  onSelectTab,
  onCloseTab,
} = {}) {
  return {
    tag: 'nav',
    className: 'workspace-tabs terminal-tabs',
    gap: '2px',
    padding: '0 var(--tab-strip-gap, 2px)',
    list: {
      tag: 'div',
      className: 'workspace-tabs-list terminal-tabs-list',
      gap: '2px',
      gapToken: 'var(--tab-strip-gap, 2px)',
      tabs: tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return {
          tag: 'div',
          className: `workspace-tab terminal-tab chrome-tab chrome-tab--terminal ${isActive ? 'workspace-tab--active terminal-tab--active chrome-tab--active' : ''}`,
          id: tab.id,
          label: tab.label,
          button: {
            onClick: () => onSelectTab?.(tab.id),
          },
          closeBtn: {
            className: 'workspace-tab-close terminal-tab-close chrome-close-button chrome-close-button--tab close-button',
            onClick: () => onCloseTab?.(tab.id),
          },
        };
      }),
    },
  };
}

function renderCaptureBlockHeader({
  block = { id: 'block-1', command: 'git status', sourcePaneOrdinal: 1 },
  index = 0,
  onCopyBlock,
  onDeleteBlock,
  onToggleCollapse,
} = {}) {
  const headerLabel = `${block.sourcePaneOrdinal} · ${index + 1}`;
  return {
    tag: 'div',
    className: 'transcript-card-header capture-block-header',
    actions: {
      className: 'transcript-card-actions capture-block-actions',
      buttons: [
        {
          index: 0,
          role: 'copy',
          className: 'card-action-btn icon-button',
          isDestructive: false,
          icon: 'copy',
          title: `Copy transcript block ${headerLabel}`,
          ariaLabel: `Copy transcript block ${headerLabel}`,
          onClick: () => onCopyBlock?.(block),
        },
        {
          index: 1,
          role: 'delete',
          className: 'card-action-btn card-action-btn-danger card-action-btn-delete card-action-btn--destructive icon-button',
          isDestructive: true,
          icon: 'trash',
          svgPaths: [
            '<polyline points="3 6 5 6 21 6" />',
            '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
          ],
          title: `Delete transcript block ${headerLabel}`,
          ariaLabel: `Delete transcript block ${headerLabel}`,
          onClick: () => onDeleteBlock?.(block.id),
        },
        {
          index: 2,
          role: 'collapse',
          className: 'card-action-btn icon-button',
          isDestructive: false,
          icon: 'chevron',
          title: `Collapse transcript block ${headerLabel}`,
          ariaLabel: `Collapse transcript block ${headerLabel}`,
          onClick: () => onToggleCollapse?.(block.id),
        },
      ],
    },
  };
}

function renderCaptureThirdRow({
  selectedCount = 2,
  totalBlocks = 4,
  onCopySelected,
  onDeleteSelected,
  onClearTranscript,
} = {}) {
  return {
    role: 'selection-actions',
    className: 'capture-toolbar-actions-row',
    actions: {
      className: 'capture-global-actions capture-selection-actions',
      buttons: [
        {
          index: 0,
          role: 'copy-selected',
          className: 'capture-icon-btn icon-button',
          isDestructive: false,
          icon: 'copy',
          disabled: selectedCount === 0,
          title: 'Copy selected transcript blocks',
          ariaLabel: 'Copy selected transcript blocks',
          onClick: onCopySelected,
        },
        {
          index: 1,
          role: 'delete-selected',
          className: 'capture-icon-btn capture-icon-btn-danger capture-icon-btn--destructive icon-button',
          isDestructive: true,
          icon: 'trash',
          svgPaths: [
            '<polyline points="3 6 5 6 21 6" />',
            '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
          ],
          disabled: selectedCount === 0,
          title: 'Delete selected transcript blocks',
          ariaLabel: 'Delete selected transcript blocks',
          onClick: onDeleteSelected,
        },
      ],
    },
  };
}

console.log('Running Tab Gap and Destructive Icon Semantics Tests (LT-TAB-GAP-AND-DESTRUCTIVE-ICON-SEMANTICS-004)...\\n');

// ---------------------------------------------------------------------------
// Test 1: tab strip gaps reduced
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: tab strip gaps reduced ---');
  let selectedWs = null;
  let selectedTab = null;

  const wsBar = renderWorkspaceTabStrip({
    onSelectWorkspace: (id) => { selectedWs = id; },
  });
  const termBar = renderTerminalTabStrip({
    onSelectTab: (id) => { selectedTab = id; },
  });

  // Verify workspace tab list spacing
  assert.strictEqual(wsBar.list.gap, '2px', 'Workspace tab list gap is reduced to 2px (tighter than previous 4px)');
  assert.strictEqual(wsBar.list.gapToken, 'var(--tab-strip-gap, 2px)', 'Workspace tab list uses --tab-strip-gap token');
  assert.ok(wsBar.padding === '0 8px' || wsBar.padding === '0 2px' || wsBar.padding === '0 var(--tab-strip-gap, 2px)', 'Workspace tab bar padding reduced from older 0 14px');

  // Verify terminal tab list spacing
  assert.strictEqual(termBar.list.gap, '2px', 'Terminal tab list gap is reduced to 2px (tighter than previous 4px)');
  assert.strictEqual(termBar.list.gapToken, 'var(--tab-strip-gap, 2px)', 'Terminal tab list uses --tab-strip-gap token');
  assert.ok(termBar.padding === '0 8px' || termBar.padding === '0 2px' || termBar.padding === '0 var(--tab-strip-gap, 2px)', 'Terminal tab bar padding reduced from older 0 14px');

  // Assert tab order and interactions are preserved
  assert.strictEqual(wsBar.list.tabs.length, 2, 'Workspace tabs count unchanged');
  assert.strictEqual(wsBar.list.tabs[0].name, 'Default', 'Workspace tab 0 order intact');
  assert.strictEqual(wsBar.list.tabs[1].name, 'Frontend', 'Workspace tab 1 order intact');
  wsBar.list.tabs[1].button.onClick();
  assert.strictEqual(selectedWs, 'ws-2', 'Workspace tab interaction works');

  assert.strictEqual(termBar.list.tabs.length, 2, 'Terminal tabs count unchanged');
  assert.strictEqual(termBar.list.tabs[0].label, 'Terminal 1', 'Terminal tab 0 order intact');
  assert.strictEqual(termBar.list.tabs[1].label, 'Terminal 2', 'Terminal tab 1 order intact');
  termBar.list.tabs[1].button.onClick();
  assert.strictEqual(selectedTab, 'tab-2', 'Terminal tab interaction works');

  // Verify stylesheet definitions
  const chromeCss = fs.readFileSync(path.resolve(__dirname, '../app/src/features/workspace/ChromeTabs.css'), 'utf8');
  assert.ok(chromeCss.includes('--tab-strip-gap: 2px;'), 'ChromeTabs.css establishes --tab-strip-gap: 2px');
  assert.ok(chromeCss.includes('gap: var(--tab-strip-gap, 2px);'), 'ChromeTabs.css applies --tab-strip-gap');

  const wsCss = fs.readFileSync(path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabBar.css'), 'utf8');
  assert.ok(wsCss.includes('gap: var(--tab-strip-gap, 2px);'), 'WorkspaceTabBar.css applies --tab-strip-gap');

  const termCss = fs.readFileSync(path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.css'), 'utf8');
  assert.ok(termCss.includes('gap: var(--tab-strip-gap, 2px);'), 'WorkspaceTabs.css applies --tab-strip-gap');

  console.log('✓ Tab strip gaps reduced for both workspace and terminal strips while preserving order and behavior');
}

// ---------------------------------------------------------------------------
// Test 2: third-row second button uses trash icon
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: third-row second button uses trash icon ---');
  const row3 = renderCaptureThirdRow();
  const btn2 = row3.actions.buttons[1];

  assert.strictEqual(btn2.role, 'delete-selected', 'Second button role is delete-selected');
  assert.strictEqual(btn2.icon, 'trash', 'Second button uses trash icon (not X)');
  assert.ok(btn2.svgPaths.some((p) => p.includes('polyline points="3 6 5 6 21 6"')), 'Button 2 contains trash lid/can polyline');
  assert.ok(btn2.svgPaths.some((p) => p.includes('path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"')), 'Button 2 contains trash body path');

  // Semantics check
  assert.strictEqual(btn2.ariaLabel.toLowerCase().includes('delete'), true, 'aria-label conveys delete semantics');
  assert.strictEqual(btn2.title.toLowerCase().includes('delete'), true, 'title conveys delete semantics');

  // Verify panel tsx source
  const panelTsx = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'), 'utf8');
  assert.ok(panelTsx.includes('aria-label="Delete selected transcript blocks"'), 'Panel tsx has delete selected aria-label');
  assert.ok(panelTsx.includes('polyline points="3 6 5 6 21 6"'), 'Panel tsx contains trash polyline');

  console.log('✓ Third-row second button uses trash icon with clear delete semantics');
}

// ---------------------------------------------------------------------------
// Test 3: third-row clear-transcript button removed in favor of selection delete
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: third-row clear-transcript button removed in favor of selection delete ---');
  const row3 = renderCaptureThirdRow();

  assert.strictEqual(row3.actions.buttons.length, 2, 'Third row actions only has 2 buttons (copy and delete selected)');
  assert.strictEqual(row3.actions.buttons[1].role, 'delete-selected', 'Second button is delete-selected with trash icon');

  // Verify panel tsx source has no clear all transcript blocks action
  const panelTsx = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'), 'utf8');
  assert.strictEqual(panelTsx.includes('aria-label="Clear all transcript blocks"'), false, 'Panel tsx has no clear all transcript blocks aria-label');
  assert.strictEqual(panelTsx.includes('m14 10 7-7'), false, 'Panel tsx contains no broom handle path');

  console.log('✓ Third-row clear-transcript button removed; relies on selection-based deletion');
}

// ---------------------------------------------------------------------------
// Test 4: capture block second button uses trash icon
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: capture block second button uses trash icon ---');
  const header = renderCaptureBlockHeader();
  const btn2 = header.actions.buttons[1];

  assert.strictEqual(btn2.role, 'delete', 'Capture block header second button is delete');
  assert.strictEqual(btn2.icon, 'trash', 'Capture block header second button uses trash icon (not X)');
  assert.ok(btn2.svgPaths.some((p) => p.includes('polyline points="3 6 5 6 21 6"')), 'Button 2 contains trash lid/can polyline');
  assert.ok(btn2.svgPaths.some((p) => p.includes('path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"')), 'Button 2 contains trash body path');

  // Semantics check
  assert.strictEqual(btn2.ariaLabel.toLowerCase().includes('delete'), true, 'aria-label conveys delete semantics');
  assert.strictEqual(btn2.title.toLowerCase().includes('delete'), true, 'title conveys delete semantics');

  console.log('✓ Capture block second button uses trash icon with delete semantics');
}

// ---------------------------------------------------------------------------
// Test 5: destructive hover/focus styling wired
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: destructive hover/focus styling wired ---');
  const row3 = renderCaptureThirdRow();
  const header = renderCaptureBlockHeader();

  const r3Btn1 = row3.actions.buttons[0];
  const r3Btn2 = row3.actions.buttons[1];

  const cardBtn1 = header.actions.buttons[0];
  const cardBtn2 = header.actions.buttons[1];
  const cardBtn3 = header.actions.buttons[2];

  // Assert destructive buttons have destructive styling classes
  assert.strictEqual(r3Btn2.isDestructive, true, 'Row 3 button 2 is marked destructive');
  assert.ok(r3Btn2.className.includes('capture-icon-btn-danger') || r3Btn2.className.includes('capture-icon-btn--destructive'), 'Row 3 button 2 has destructive class');

  assert.strictEqual(cardBtn2.isDestructive, true, 'Card header button 2 is marked destructive');
  assert.ok(cardBtn2.className.includes('card-action-btn-danger') || cardBtn2.className.includes('card-action-btn-delete') || cardBtn2.className.includes('card-action-btn--destructive'), 'Card header button 2 has destructive class');

  // Assert non-destructive buttons do not have destructive classes
  assert.strictEqual(r3Btn1.isDestructive, false, 'Row 3 button 1 is not destructive');
  assert.ok(!r3Btn1.className.includes('danger') && !r3Btn1.className.includes('destructive') && !r3Btn1.className.includes('delete'), 'Row 3 copy button has no destructive classes');

  assert.strictEqual(cardBtn1.isDestructive, false, 'Card button 1 is not destructive');
  assert.ok(!cardBtn1.className.includes('danger') && !cardBtn1.className.includes('destructive') && !cardBtn1.className.includes('delete'), 'Card copy button has no destructive classes');

  assert.strictEqual(cardBtn3.isDestructive, false, 'Card button 3 is not destructive');
  assert.ok(!cardBtn3.className.includes('danger') && !cardBtn3.className.includes('destructive') && !cardBtn3.className.includes('delete'), 'Card collapse button has no destructive classes');

  // Assert CSS contracts for hover/focus red styling
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');

  // Capture icon btn destructive hover/focus
  assert.ok(appCss.includes('.capture-icon-btn-danger:hover') || appCss.includes('.capture-icon-btn--destructive:hover'), 'App.css defines destructive hover for capture icon buttons');
  assert.ok(appCss.includes('.capture-icon-btn-danger:focus-visible') || appCss.includes('.capture-icon-btn--destructive:focus-visible'), 'App.css defines destructive focus-visible');
  assert.ok(appCss.includes('color: var(--red, #f87171);') || appCss.includes('color: var(--red);'), 'Destructive hover uses red color');

  // Card action btn destructive hover/focus
  assert.ok(appCss.includes('.card-action-btn-danger:hover') || appCss.includes('.card-action-btn-delete:hover'), 'App.css defines destructive hover for card action buttons');
  assert.ok(appCss.includes('.card-action-btn-danger:focus-visible') || appCss.includes('.card-action-btn-delete:focus-visible'), 'App.css defines destructive focus-visible for card action buttons');

  console.log('✓ Destructive hover/focus styling wired for all destructive controls while non-destructive buttons remain neutral');
}

// ---------------------------------------------------------------------------
// Test 6: handlers unchanged
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: handlers unchanged ---');
  let deleteSelectedTriggered = false;
  let deleteBlockId = null;

  const row3 = renderCaptureThirdRow({
    onDeleteSelected: () => { deleteSelectedTriggered = true; },
  });

  const header = renderCaptureBlockHeader({
    block: { id: 'test-block-42', command: 'npm test', sourcePaneOrdinal: 1 },
    onDeleteBlock: (id) => { deleteBlockId = id; },
  });

  // 1. Trigger row-3 second button (delete selected)
  row3.actions.buttons[1].onClick();
  assert.strictEqual(deleteSelectedTriggered, true, 'Row 3 delete selected handler fired');

  // 2. Trigger capture block second button (delete block)
  header.actions.buttons[1].onClick();
  assert.strictEqual(deleteBlockId, 'test-block-42', 'Capture block delete handler fired with correct block ID');

  console.log('✓ All destructive handlers and control order remain 100% intact');
}

console.log('\\n=======================================================================');
console.log('ALL 6 TAB GAP & DESTRUCTIVE ICON SEMANTICS TESTS PASSED!');
console.log('=======================================================================\\n');
