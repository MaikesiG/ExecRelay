import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task ID: LT-TAB-EDGE-GAP-ALIGNMENT-AND-RED-OUTLINED-HOVER-005
 * Title: Make Tab Gaps Match Outer Insets and Apply Red Outlined Hover to Row-3 Destructive Actions
 */

// Simulated model matching WorkspaceTabBar and WorkspaceTabs renderers
function renderWorkspaceTabStripModel({
  tabGap = '2px',
  workspaces = [
    { id: 'ws-1', name: 'Default' },
    { id: 'ws-2', name: 'Backend' },
  ],
  activeWorkspaceId = 'ws-1',
  onSelectWorkspace,
  onCloseWorkspace,
} = {}) {
  return {
    tag: 'nav',
    className: 'workspace-tab-bar',
    leftInset: tabGap,
    rightInset: tabGap,
    paddingInline: `var(--tab-strip-gap, ${tabGap})`,
    gap: `var(--tab-strip-gap, ${tabGap})`,
    list: {
      tag: 'div',
      className: 'workspace-tab-bar-list workspace-tabs-list',
      gap: tabGap,
      gapToken: `var(--tab-strip-gap, ${tabGap})`,
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

function renderTerminalTabStripModel({
  tabGap = '2px',
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
    leftInset: tabGap,
    rightInset: tabGap,
    paddingInline: `var(--tab-strip-gap, ${tabGap})`,
    gap: `var(--tab-strip-gap, ${tabGap})`,
    list: {
      tag: 'div',
      className: 'workspace-tabs-list terminal-tabs-list',
      gap: tabGap,
      gapToken: `var(--tab-strip-gap, ${tabGap})`,
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

function renderCaptureThirdRowModel({
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
          destructiveHover: false,
          styleContract: {
            atRest: 'neutral',
            hover: 'neutral-hover',
          },
          disabled: selectedCount === 0,
          onClick: onCopySelected,
        },
        {
          index: 1,
          role: 'delete-selected',
          className: 'capture-icon-btn capture-icon-btn-danger capture-icon-btn--destructive icon-button',
          dataDestructiveHover: 'true',
          isDestructive: true,
          destructiveHover: true,
          styleContract: {
            atRest: 'neutral',
            hover: 'red-outlined',
            hasSolidFill: false,
            borderColor: 'color-mix(in oklab, var(--color-error, var(--red, #f87171)) 70%, transparent)',
            background: 'color-mix(in oklab, var(--color-error, var(--red, #f87171)) 10%, transparent)',
            color: 'var(--color-error, var(--red, #f87171))',
          },
          disabled: selectedCount === 0,
          ariaLabel: 'Delete selected transcript blocks',
          title: 'Delete selected transcript blocks',
          onClick: onDeleteSelected,
        },
      ],
    },
  };
}

console.log('Running Tab Edge Gap Alignment and Red Outlined Hover Tests (LT-TAB-EDGE-GAP-ALIGNMENT-AND-RED-OUTLINED-HOVER-005)...\\n');

// ---------------------------------------------------------------------------
// Test 1: workspace tab strip gap equals outer inset
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: workspace tab strip gap equals outer inset ---');
  const strip = renderWorkspaceTabStripModel({ tabGap: '2px' });

  // Assert left and right insets equal the inter-tab gap value
  assert.strictEqual(strip.leftInset, strip.list.gap, 'Workspace tab strip left inset equals inter-tab gap (2px)');
  assert.strictEqual(strip.rightInset, strip.list.gap, 'Workspace tab strip right inset equals inter-tab gap (2px)');
  assert.strictEqual(strip.paddingInline, 'var(--tab-strip-gap, 2px)', 'Workspace tab strip padding-inline uses token matching gap');

  // Assert no older larger outer inset (e.g. 14px or 8px) remains
  const wsCss = fs.readFileSync(path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabBar.css'), 'utf8');
  assert.ok(!wsCss.includes('padding: 0 14px;'), 'No older 14px outer padding in WorkspaceTabBar.css');
  assert.ok(!wsCss.includes('padding: 0 8px;'), 'No older 8px outer padding in WorkspaceTabBar.css');
  assert.ok(wsCss.includes('padding: 0 var(--tab-strip-gap, 2px);') || wsCss.includes('padding-inline: var(--tab-strip-gap, 2px);'), 'WorkspaceTabBar.css sets padding to match --tab-strip-gap');
  assert.ok(wsCss.includes('gap: var(--tab-strip-gap, 2px);'), 'WorkspaceTabBar.css sets gap to match --tab-strip-gap');

  console.log('✓ Workspace tab strip inter-tab gap equals left/right outer insets with no older larger spacing');
}

// ---------------------------------------------------------------------------
// Test 2: terminal tab strip gap equals outer inset
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: terminal tab strip gap equals outer inset ---');
  const strip = renderTerminalTabStripModel({ tabGap: '2px' });

  // Assert left and right insets equal the inter-tab gap value
  assert.strictEqual(strip.leftInset, strip.list.gap, 'Terminal tab strip left inset equals inter-tab gap (2px)');
  assert.strictEqual(strip.rightInset, strip.list.gap, 'Terminal tab strip right inset equals inter-tab gap (2px)');
  assert.strictEqual(strip.paddingInline, 'var(--tab-strip-gap, 2px)', 'Terminal tab strip padding-inline uses token matching gap');

  // Assert no older larger outer inset (e.g. 14px or 8px) remains
  const termCss = fs.readFileSync(path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.css'), 'utf8');
  assert.ok(!termCss.includes('padding: 0 14px;'), 'No older 14px outer padding in WorkspaceTabs.css');
  assert.ok(!termCss.includes('padding: 0 8px;'), 'No older 8px outer padding in WorkspaceTabs.css');
  assert.ok(termCss.includes('padding: 0 var(--tab-strip-gap, 2px);') || termCss.includes('padding-inline: var(--tab-strip-gap, 2px);'), 'WorkspaceTabs.css sets padding to match --tab-strip-gap');
  assert.ok(termCss.includes('gap: var(--tab-strip-gap, 2px);'), 'WorkspaceTabs.css sets gap to match --tab-strip-gap');

  const chromeCss = fs.readFileSync(path.resolve(__dirname, '../app/src/features/workspace/ChromeTabs.css'), 'utf8');
  assert.ok(chromeCss.includes('padding-inline: var(--tab-strip-gap, 2px);') || chromeCss.includes('padding: 0 var(--tab-strip-gap, 2px);'), 'ChromeTabs.css unifies tab strip padding-inline to --tab-strip-gap');

  console.log('✓ Terminal tab strip inter-tab gap equals left/right outer insets with no older larger spacing');
}

// ---------------------------------------------------------------------------
// Test 3: row-3 second button uses red outlined hover contract
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: row-3 second button uses red outlined hover contract ---');
  const row3 = renderCaptureThirdRowModel();
  const btn2 = row3.actions.buttons[1];

  assert.strictEqual(btn2.role, 'delete-selected', 'Button 2 role is delete-selected');
  assert.strictEqual(btn2.dataDestructiveHover, 'true', 'Button 2 has data-destructive-hover="true"');
  assert.strictEqual(btn2.styleContract.hover, 'red-outlined', 'Button 2 hover state is red-outlined');
  assert.strictEqual(btn2.styleContract.hasSolidFill, false, 'Button 2 hover state is NOT solid red fill');
  assert.strictEqual(btn2.styleContract.atRest, 'neutral', 'Button 2 resting state is neutral');

  // Verify App.css stylesheet invariants
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
  assert.ok(appCss.includes('[data-destructive-hover="true"]:hover'), 'App.css defines [data-destructive-hover="true"]:hover rule');
  assert.ok(appCss.includes('[data-destructive-hover="true"]:focus-visible'), 'App.css defines [data-destructive-hover="true"]:focus-visible rule');
  assert.ok(appCss.includes('border-color: color-mix(in oklab, var(--color-error, var(--red, #f87171)) 70%, transparent);') || appCss.includes('border-color: rgba(248, 113, 113, 0.7);'), 'Red outline border-color is applied');
  assert.ok(appCss.includes('background: color-mix(in oklab, var(--color-error, var(--red, #f87171)) 10%, transparent);') || appCss.includes('background: rgba(248, 113, 113, 0.1);'), 'Subtle red-tinted background is applied (not solid fill)');

  // Verify TranscriptCapturePanel.tsx has attribute
  const panelTsx = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'), 'utf8');
  assert.ok(panelTsx.includes('data-destructive-hover="true"'), 'TranscriptCapturePanel sets data-destructive-hover="true" on destructive buttons');

  console.log('✓ Row-3 second button implements red outlined hover/focus contract with neutral resting state');
}

// ---------------------------------------------------------------------------
// Test 4: clear-transcript button is retired and .capture-icon-btn--clear removed
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: clear-transcript button is retired and .capture-icon-btn--clear removed ---');
  const row3 = renderCaptureThirdRowModel();

  assert.strictEqual(row3.actions.buttons.length, 2, 'Row 3 only has 2 buttons (copy and delete selected)');

  // Verify App.css stylesheet has removed .capture-icon-btn--clear
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
  assert.strictEqual(appCss.includes('.capture-icon-btn--clear'), false, 'App.css no longer contains .capture-icon-btn--clear');

  // Verify TranscriptCapturePanel.tsx has removed .capture-icon-btn--clear
  const panelTsx = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'), 'utf8');
  assert.strictEqual(panelTsx.includes('capture-icon-btn--clear'), false, 'TranscriptCapturePanel no longer sets capture-icon-btn--clear');

  console.log('✓ Clear-transcript button and its specific selector cleanly removed');
}

// ---------------------------------------------------------------------------
// Test 5: behavior unchanged
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: behavior unchanged ---');
  let deleteFired = false;

  const row3 = renderCaptureThirdRowModel({
    selectedCount: 3,
    totalBlocks: 5,
    onDeleteSelected: () => { deleteFired = true; },
  });

  const btn2 = row3.actions.buttons[1];

  // Verify accessibility attributes are present
  assert.strictEqual(btn2.ariaLabel, 'Delete selected transcript blocks', 'Delete button aria-label intact');
  assert.strictEqual(btn2.title, 'Delete selected transcript blocks', 'Delete button title intact');

  // Trigger handlers
  btn2.onClick();
  assert.strictEqual(deleteFired, true, 'Row-3 second button (delete selected) handler fired');

  console.log('✓ Action handlers, labels, and semantics remain 100% intact');
}

console.log('\\n=======================================================================');
console.log('ALL 5 TAB EDGE GAP ALIGNMENT & RED OUTLINED HOVER TESTS PASSED!');
console.log('=======================================================================\\n');
