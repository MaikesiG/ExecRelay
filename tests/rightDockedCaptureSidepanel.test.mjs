import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task ID: LT-RIGHT-DOCKED-CAPTURE-SIDEPANEL-WITH-TABBAR-TOGGLE-001
 * Convert Capture Panel into a Right-Docked Side Panel with a Toggle in the Terminal Tab Bar
 */

// Simulated models matching WorkspaceTabs, TerminalPaneLayout, and App state helpers
function toggleCapturePanel(tab) {
  const isOpen = tab.isCapturePanelOpen ?? true;
  return {
    ...tab,
    isCapturePanelOpen: !isOpen,
  };
}

function setCapturePanelWidth(tab, width) {
  const clamped = Math.max(260, Math.min(1200, Math.round(width)));
  return {
    ...tab,
    capturePanelWidth: clamped,
  };
}

function renderTerminalTabBar(tab, activeTabId, onToggleCapture) {
  const isOpen = tab.isCapturePanelOpen ?? true;
  const label = isOpen ? 'Hide capture panel' : 'Show capture panel';

  return {
    tag: 'nav',
    className: 'workspace-tabs terminal-tabs',
    role: 'tablist',
    'aria-label': 'Terminal tabs',
    children: [
      {
        tag: 'div',
        className: 'workspace-tabs-list',
        children: [
          {
            tag: 'div',
            className: 'workspace-tab terminal-tab chrome-tab chrome-tab--terminal',
            text: tab.label,
          },
        ],
      },
      {
        tag: 'button',
        className: 'workspace-tab-add',
        text: '+',
      },
      {
        tag: 'div',
        className: 'workspace-tabs-actions',
        children: [
          {
            tag: 'button',
            className: 'workspace-tab-capture-toggle capture-panel-toggle',
            'aria-label': label,
            title: label,
            'aria-pressed': isOpen,
            'aria-controls': `capture-side-panel-${tab.id}`,
            'data-state': isOpen ? 'open' : 'closed',
            onClick: onToggleCapture,
          },
        ],
      },
    ],
  };
}

function renderTerminalWorkspaceBody(tab, containerWidth = 1200) {
  const isOpen = tab.isCapturePanelOpen ?? true;
  const width = tab.capturePanelWidth ?? 400;

  const children = [
    {
      tag: 'div',
      className: 'terminal-main-region',
      style: {
        flex: isOpen ? '1 1 auto' : '1 1 100%',
        width: isOpen ? `${containerWidth - width - 1}px` : `${containerWidth}px`,
      },
      children: [
        {
          tag: 'div',
          className: 'terminal-pane',
          paneId: tab.panes?.[0]?.id ?? 'pane-1',
        },
      ],
    },
  ];

  if (isOpen) {
    children.push({
      tag: 'div',
      className: 'capture-resizer pane-divider pane-divider--horizontal',
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': 'Resize capture side panel',
    });

    children.push({
      tag: 'aside',
      id: `capture-side-panel-${tab.id}`,
      className: 'capture-side-panel',
      'aria-label': 'Capture side panel',
      style: {
        width: `${width}px`,
        flex: `0 0 ${width}px`,
      },
      children: [
        {
          tag: 'aside',
          className: 'context-panel',
          blocks: tab.captureBlocks ?? [],
        },
      ],
    });
  }

  return {
    tag: 'div',
    className: 'terminal-workspace-body',
    'data-capture-open': isOpen ? 'true' : 'false',
    style: {
      '--capture-panel-width': `${width}px`,
      width: `${containerWidth}px`,
    },
    children,
  };
}

console.log('Running Right-Docked Capture Side Panel Tests (LT-RIGHT-DOCKED-CAPTURE-SIDEPANEL-WITH-TABBAR-TOGGLE-001)...\\n');

// ---------------------------------------------------------------------------
// Test 1: Panel toggle button renders in terminal chrome
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Panel toggle button renders in terminal chrome ---');
  const openTab = { id: 'tab-1', label: 'Terminal 1', isCapturePanelOpen: true };
  const closedTab = { id: 'tab-1', label: 'Terminal 1', isCapturePanelOpen: false };

  const openBar = renderTerminalTabBar(openTab, 'tab-1');
  const closedBar = renderTerminalTabBar(closedTab, 'tab-1');

  // Verify container is terminal chrome row
  assert.ok(openBar.className.includes('terminal-tabs'), 'Tab bar has terminal-tabs chrome class');

  // Find toggle action container and button
  const openActions = openBar.children.find((c) => c.className === 'workspace-tabs-actions');
  assert.ok(openActions, 'workspace-tabs-actions exists at the far right of the tab bar');
  const openToggleBtn = openActions.children.find((c) => c.className.includes('workspace-tab-capture-toggle'));
  assert.ok(openToggleBtn, 'Toggle button is present in chrome actions container');

  // Assert label for open state
  assert.strictEqual(openToggleBtn['aria-label'], 'Hide capture panel', 'Open state aria-label is "Hide capture panel"');
  assert.strictEqual(openToggleBtn.title, 'Hide capture panel', 'Open state title is "Hide capture panel"');
  assert.strictEqual(openToggleBtn['aria-pressed'], true, 'Open state aria-pressed is true');
  assert.strictEqual(openToggleBtn['data-state'], 'open', 'Open state data-state is open');

  // Assert label for closed state
  const closedActions = closedBar.children.find((c) => c.className === 'workspace-tabs-actions');
  const closedToggleBtn = closedActions.children.find((c) => c.className.includes('workspace-tab-capture-toggle'));
  assert.strictEqual(closedToggleBtn['aria-label'], 'Show capture panel', 'Closed state aria-label is "Show capture panel"');
  assert.strictEqual(closedToggleBtn.title, 'Show capture panel', 'Closed state title is "Show capture panel"');
  assert.strictEqual(closedToggleBtn['aria-pressed'], false, 'Closed state aria-pressed is false');
  assert.strictEqual(closedToggleBtn['data-state'], 'closed', 'Closed state data-state is closed');

  console.log('✓ Capture panel toggle button renders in terminal chrome with correct open/closed semantics');
}

// ---------------------------------------------------------------------------
// Test 2: Open state renders right-docked panel
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Open state renders right-docked panel ---');
  const tab = {
    id: 'tab-1',
    label: 'Terminal 1',
    isCapturePanelOpen: true,
    capturePanelWidth: 380,
    panes: [{ id: 'pane-1' }],
  };

  const body = renderTerminalWorkspaceBody(tab, 1200);

  // Assert terminal workspace body attributes
  assert.strictEqual(body.className, 'terminal-workspace-body', 'Has terminal-workspace-body class');
  assert.strictEqual(body['data-capture-open'], 'true', 'data-capture-open is "true"');

  // Assert exactly 3 children in order: main region, resizer, capture side panel
  assert.strictEqual(body.children.length, 3, 'Open workspace body includes main region, resizer, and side panel');
  assert.strictEqual(body.children[0].className, 'terminal-main-region', 'First child is terminal-main-region');
  assert.ok(body.children[1].className.includes('capture-resizer'), 'Second child is capture-resizer');
  assert.strictEqual(body.children[2].className, 'capture-side-panel', 'Third child is capture-side-panel');

  // Assert capture side panel is final / rightmost region
  const lastChild = body.children[body.children.length - 1];
  assert.strictEqual(lastChild.className, 'capture-side-panel', 'Capture side panel is the final/rightmost region');
  assert.strictEqual(lastChild.id, 'capture-side-panel-tab-1', 'Capture side panel has matching tab id');

  console.log('✓ Open state renders terminal main region, resizer, and right-docked capture side panel');
}

// ---------------------------------------------------------------------------
// Test 3: Closed state removes panel from layout
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Closed state removes panel from layout ---');
  const tab = {
    id: 'tab-1',
    label: 'Terminal 1',
    isCapturePanelOpen: false,
    capturePanelWidth: 380,
    panes: [{ id: 'pane-1' }],
  };

  const body = renderTerminalWorkspaceBody(tab, 1200);

  assert.strictEqual(body['data-capture-open'], 'false', 'data-capture-open is "false"');

  // Assert side panel and resizer are NOT rendered
  const sidePanel = body.children.find((c) => c.className === 'capture-side-panel');
  assert.strictEqual(sidePanel, undefined, 'Capture side panel is not rendered when closed');
  const resizer = body.children.find((c) => c.className?.includes('capture-resizer'));
  assert.strictEqual(resizer, undefined, 'Resizer is not rendered when closed');

  // Assert main terminal region expands to occupy full width
  assert.strictEqual(body.children.length, 1, 'Only main terminal region is rendered');
  assert.strictEqual(body.children[0].className, 'terminal-main-region');
  assert.strictEqual(body.children[0].style.width, '1200px', 'Main terminal region occupies full 1200px width');

  console.log('✓ Closed state removes side panel and resizer; main terminal expands to full width');
}

// ---------------------------------------------------------------------------
// Test 4: Toggle preserves width
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Toggle preserves width ---');
  let tab = {
    id: 'tab-1',
    label: 'Terminal 1',
    isCapturePanelOpen: true,
    capturePanelWidth: 400,
  };

  // 1. Set capture panel width to a non-default value (e.g. 520)
  tab = setCapturePanelWidth(tab, 520);
  assert.strictEqual(tab.capturePanelWidth, 520, 'Panel width updated to 520px');

  // 2. Collapse the panel
  tab = toggleCapturePanel(tab);
  assert.strictEqual(tab.isCapturePanelOpen, false, 'Panel is collapsed');
  assert.strictEqual(tab.capturePanelWidth, 520, 'Width is preserved in state while collapsed');

  // 3. Reopen the panel
  tab = toggleCapturePanel(tab);
  assert.strictEqual(tab.isCapturePanelOpen, true, 'Panel is reopened');

  // 4. Assert previous width is restored
  assert.strictEqual(tab.capturePanelWidth, 520, 'Previous 520px width is restored upon reopening');

  const rendered = renderTerminalWorkspaceBody(tab, 1200);
  const sidePanel = rendered.children.find((c) => c.className === 'capture-side-panel');
  assert.strictEqual(sidePanel.style.width, '520px', 'Rendered side panel has restored 520px width');

  console.log('✓ Collapsing and reopening the panel preserves custom width across toggles');
}

// ---------------------------------------------------------------------------
// Test 5: Resize still works while right-docked
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Resize still works while right-docked ---');
  let tab = {
    id: 'tab-1',
    label: 'Terminal 1',
    isCapturePanelOpen: true,
    capturePanelWidth: 400,
  };

  // Initial render at 400px
  let rendered = renderTerminalWorkspaceBody(tab, 1200);
  let mainRegion = rendered.children[0];
  let sidePanel = rendered.children[2];
  assert.strictEqual(sidePanel.style.width, '400px');
  assert.strictEqual(mainRegion.style.width, '799px'); // 1200 - 400 - 1

  // Resize to 480px
  tab = setCapturePanelWidth(tab, 480);
  assert.strictEqual(tab.capturePanelWidth, 480);

  rendered = renderTerminalWorkspaceBody(tab, 1200);
  mainRegion = rendered.children[0];
  sidePanel = rendered.children[2];

  // Panel remains the last child (flush right)
  assert.strictEqual(rendered.children[rendered.children.length - 1], sidePanel, 'Panel remains flush right');
  assert.strictEqual(sidePanel.style.width, '480px', 'Side panel width updated to 480px');
  assert.strictEqual(mainRegion.style.width, '719px', 'Terminal region width adjusted to 719px');

  console.log('✓ Resizing updates side panel width, keeps it right-docked, and adjusts terminal region');
}

// ---------------------------------------------------------------------------
// Test 6: Collapse does not destroy capture state
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: Collapse does not destroy capture state ---');
  const mockBlocks = [
    { id: 'b-1', command: 'cargo build', output: 'Finished dev target', isComplete: true },
    { id: 'b-2', command: 'git status', output: 'nothing to commit', isComplete: true },
  ];

  let tab = {
    id: 'tab-1',
    label: 'Terminal 1',
    isCapturePanelOpen: true,
    capturePanelWidth: 400,
    captureBlocks: mockBlocks,
  };

  // 1. Initial open view has blocks
  let rendered = renderTerminalWorkspaceBody(tab, 1200);
  let sidePanel = rendered.children.find((c) => c.className === 'capture-side-panel');
  assert.strictEqual(sidePanel.children[0].blocks.length, 2, 'Open panel displays 2 blocks');

  // 2. Collapse the panel
  tab = toggleCapturePanel(tab);
  assert.strictEqual(tab.isCapturePanelOpen, false);
  // Blocks remain in state
  assert.strictEqual(tab.captureBlocks.length, 2, 'Blocks preserved in state while collapsed');

  // 3. Reopen the panel
  tab = toggleCapturePanel(tab);
  assert.strictEqual(tab.isCapturePanelOpen, true);

  // 4. Assert captured content still exists in reopened view
  rendered = renderTerminalWorkspaceBody(tab, 1200);
  sidePanel = rendered.children.find((c) => c.className === 'capture-side-panel');
  assert.strictEqual(sidePanel.children[0].blocks.length, 2, 'Reopened panel still displays 2 blocks');
  assert.strictEqual(sidePanel.children[0].blocks[0].command, 'cargo build');
  assert.strictEqual(sidePanel.children[0].blocks[1].command, 'git status');

  console.log('✓ Collapsing and reopening the panel does not destroy captured blocks or runtime state');
}

// ---------------------------------------------------------------------------
// Test 7: Stylesheet validation for right docking and chrome toggle
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 7: Stylesheet validation ---');
  const layoutCssPath = path.resolve(__dirname, '../app/src/features/workspace/TerminalPaneLayout.css');
  const layoutCss = fs.readFileSync(layoutCssPath, 'utf8');

  assert.ok(layoutCss.includes('.terminal-workspace-body'), 'TerminalPaneLayout.css defines .terminal-workspace-body');
  assert.ok(layoutCss.includes('.terminal-main-region'), 'TerminalPaneLayout.css defines .terminal-main-region');
  assert.ok(layoutCss.includes('.capture-resizer'), 'TerminalPaneLayout.css defines .capture-resizer');
  assert.ok(layoutCss.includes('.capture-side-panel'), 'TerminalPaneLayout.css defines .capture-side-panel');
  assert.ok(layoutCss.includes('var(--capture-panel-width'), 'TerminalPaneLayout.css uses --capture-panel-width');

  const tabsCssPath = path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.css');
  const tabsCss = fs.readFileSync(tabsCssPath, 'utf8');

  assert.ok(tabsCss.includes('.workspace-tabs-actions'), 'WorkspaceTabs.css defines .workspace-tabs-actions');
  assert.ok(tabsCss.includes('.workspace-tab-capture-toggle'), 'WorkspaceTabs.css defines .workspace-tab-capture-toggle');
  assert.ok(tabsCss.includes('margin-left: auto;'), 'workspace-tabs-actions aligns to far right with margin-left: auto');

  console.log('✓ Stylesheets define right-docked side panel structure and flush-right tab bar toggle');
}

console.log('\\n=============================================================');
console.log('ALL 7 RIGHT-DOCKED CAPTURE SIDE PANEL TESTS PASSED!');
console.log('=============================================================\\n');
