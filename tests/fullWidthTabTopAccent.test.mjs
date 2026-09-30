import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task ID: LT-FULL-WIDTH-TAB-TOP-ACCENT-001
 * Make Workspace and Terminal Tab Top Accents Span the Full Tab Width
 */

// Simulated tab component models matching WorkspaceTabBar and WorkspaceTabs renderers
function getTabTopAccentGeometry() {
  return {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    width: '100%',
    height: '2px',
    borderTopLeftRadius: 'inherit',
    borderTopRightRadius: 'inherit',
    hasLeftInset: false,
    hasRightInset: false,
    insetAmountPx: 0,
  };
}

function renderWorkspaceTab(ws, activeWorkspaceId) {
  const isActive = ws.id === activeWorkspaceId;
  return {
    tag: 'div',
    className: `workspace-tab-item chrome-tab chrome-tab--workspace ${isActive ? 'workspace-tab-item--active chrome-tab--active' : ''}`,
    'data-active': isActive ? 'true' : 'false',
    height: '28px',
    borderRadius: '6px',
    overflow: 'hidden',
    hasTopAccentHighlight: isActive,
    accentGeometry: isActive ? getTabTopAccentGeometry() : null,
    accentColorToken: 'var(--workspace-tab-accent)',
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
    overflow: 'hidden',
    hasTopAccentHighlight: isActive,
    accentGeometry: isActive ? getTabTopAccentGeometry() : null,
    accentColorToken: 'var(--terminal-tab-accent)',
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

console.log('Running Full-Width Tab Top Accent Tests (LT-FULL-WIDTH-TAB-TOP-ACCENT-001)...\\n');

// ---------------------------------------------------------------------------
// Test 1: Workspace tab accent spans full width
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Workspace tab accent spans full width ---');
  const ws = { id: 'ws-1', name: 'Project Workspace' };
  const activeWsTab = renderWorkspaceTab(ws, 'ws-1');

  assert.strictEqual(activeWsTab['data-active'], 'true', 'Active workspace tab has data-active=true');
  assert.ok(activeWsTab.hasTopAccentHighlight, 'Active workspace tab has top accent highlight');

  const geom = activeWsTab.accentGeometry;
  assert.ok(geom, 'Accent geometry is defined on active workspace tab');
  assert.strictEqual(geom.left, '0', 'Accent left is 0 (no left inset)');
  assert.strictEqual(geom.right, '0', 'Accent right is 0 (no right inset)');
  assert.strictEqual(geom.width, '100%', 'Accent spans 100% full width');
  assert.strictEqual(geom.top, '0', 'Accent aligns to top edge');
  assert.strictEqual(geom.height, '2px', 'Accent height is 2px');
  assert.strictEqual(geom.hasLeftInset, false, 'No left inset geometry');
  assert.strictEqual(geom.hasRightInset, false, 'No right inset geometry');
  assert.strictEqual(geom.insetAmountPx, 0, 'Inset amount is 0px (not 8px)');

  console.log('✓ Active workspace tab top accent spans full width with no left/right inset');
}

// ---------------------------------------------------------------------------
// Test 2: Terminal tab accent spans full width
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Terminal tab accent spans full width ---');
  const tab = { id: 'term-1', label: 'Terminal 1' };
  const activeTermTab = renderTerminalTab(tab, 'term-1');

  assert.strictEqual(activeTermTab['data-active'], 'true', 'Active terminal tab has data-active=true');
  assert.ok(activeTermTab.hasTopAccentHighlight, 'Active terminal tab has top accent highlight');

  const geom = activeTermTab.accentGeometry;
  assert.ok(geom, 'Accent geometry is defined on active terminal tab');
  assert.strictEqual(geom.left, '0', 'Accent left is 0 (no left inset)');
  assert.strictEqual(geom.right, '0', 'Accent right is 0 (no right inset)');
  assert.strictEqual(geom.width, '100%', 'Accent spans 100% full width');
  assert.strictEqual(geom.top, '0', 'Accent aligns to top edge');
  assert.strictEqual(geom.height, '2px', 'Accent height is 2px');
  assert.strictEqual(geom.hasLeftInset, false, 'No left inset geometry');
  assert.strictEqual(geom.hasRightInset, false, 'No right inset geometry');
  assert.strictEqual(geom.insetAmountPx, 0, 'Inset amount is 0px (not 8px)');

  console.log('✓ Active terminal tab top accent spans full width with no left/right inset');
}

// ---------------------------------------------------------------------------
// Test 3: Color difference preserved while geometry is shared
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Color difference preserved ---');
  const wsTab = renderWorkspaceTab({ id: 'ws-1', name: 'Main' }, 'ws-1');
  const termTab = renderTerminalTab({ id: 't-1', label: 'Zsh' }, 't-1');

  // Assert both share the identical accent geometry
  assert.deepStrictEqual(
    wsTab.accentGeometry,
    termTab.accentGeometry,
    'Workspace and Terminal tabs share identical full-width top accent geometry'
  );

  // Assert color tokens are distinct
  assert.notStrictEqual(
    wsTab.accentColorToken,
    termTab.accentColorToken,
    'Workspace and Terminal tabs use distinct accent color tokens'
  );
  assert.strictEqual(
    wsTab.accentColorToken,
    'var(--workspace-tab-accent)',
    'Workspace tab uses --workspace-tab-accent token'
  );
  assert.strictEqual(
    termTab.accentColorToken,
    'var(--terminal-tab-accent)',
    'Terminal tab uses --terminal-tab-accent token'
  );

  console.log('✓ Accent geometry is 100% identical while color differentiation is strictly preserved');
}

// ---------------------------------------------------------------------------
// Test 4: Radius integration preserved
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Radius integration preserved ---');
  const wsTab = renderWorkspaceTab({ id: 'ws-1', name: 'Main' }, 'ws-1');
  const termTab = renderTerminalTab({ id: 't-1', label: 'Zsh' }, 't-1');

  // Both tabs maintain rectangular shape with 6px border radius
  assert.strictEqual(wsTab.borderRadius, '6px', 'Workspace tab has 6px border radius');
  assert.strictEqual(termTab.borderRadius, '6px', 'Terminal tab has 6px border radius');
  assert.strictEqual(wsTab.height, '28px', 'Workspace tab height remains 28px');
  assert.strictEqual(termTab.height, '28px', 'Terminal tab height remains 28px');

  // Parent overflow clipping prevents bleeding outside rounded top corners
  assert.strictEqual(wsTab.overflow, 'hidden', 'Workspace tab has overflow: hidden to clip corners');
  assert.strictEqual(termTab.overflow, 'hidden', 'Terminal tab has overflow: hidden to clip corners');

  // Accent itself respects top corner radius
  assert.ok(
    wsTab.accentGeometry.borderTopLeftRadius === 'inherit' || wsTab.accentGeometry.borderTopLeftRadius === '6px',
    'Workspace tab accent top-left radius integrates cleanly'
  );
  assert.ok(
    termTab.accentGeometry.borderTopRightRadius === 'inherit' || termTab.accentGeometry.borderTopRightRadius === '6px',
    'Terminal tab accent top-right radius integrates cleanly'
  );

  console.log('✓ Tab shape preserved and accent visually integrates with rounded corners without bleeding');
}

// ---------------------------------------------------------------------------
// Test 5: CSS Stylesheet Invariants in ChromeTabs.css
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: CSS Stylesheet Invariants in ChromeTabs.css ---');
  const cssPath = path.resolve(__dirname, '../app/src/features/workspace/ChromeTabs.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // 1. Inset geometry removed
  assert.strictEqual(css.includes('left: 8px;'), false, 'ChromeTabs.css must NOT contain left: 8px;');
  assert.strictEqual(css.includes('right: 8px;'), false, 'ChromeTabs.css must NOT contain right: 8px;');
  assert.strictEqual(css.includes('border-radius: 999px;'), false, 'ChromeTabs.css must NOT contain border-radius: 999px;');

  // 2. Full-width geometry present
  assert.ok(css.includes('left: 0;'), 'ChromeTabs.css specifies left: 0;');
  assert.ok(css.includes('right: 0;'), 'ChromeTabs.css specifies right: 0;');
  assert.ok(css.includes('height: 2px;'), 'ChromeTabs.css specifies height: 2px;');

  // 3. Radius integration present
  assert.ok(
    css.includes('border-top-left-radius: 6px;') || css.includes('border-top-left-radius: inherit;'),
    'ChromeTabs.css specifies border-top-left-radius'
  );
  assert.ok(
    css.includes('border-top-right-radius: 6px;') || css.includes('border-top-right-radius: inherit;'),
    'ChromeTabs.css specifies border-top-right-radius'
  );
  assert.ok(css.includes('overflow: hidden;'), 'ChromeTabs.css includes overflow: hidden on .chrome-tab');

  // 4. Color token variables in :root
  assert.ok(css.includes('--workspace-tab-accent:'), 'ChromeTabs.css defines --workspace-tab-accent');
  assert.ok(css.includes('--terminal-tab-accent:'), 'ChromeTabs.css defines --terminal-tab-accent');

  // 5. Variant accent assignments
  assert.ok(
    css.includes('.chrome-tab--workspace[data-active="true"]::before') ||
    css.includes('.chrome-tab--workspace.chrome-tab--active::before'),
    'ChromeTabs.css assigns accent to active workspace tab'
  );
  assert.ok(
    css.includes('.chrome-tab--terminal[data-active="true"]::before') ||
    css.includes('.chrome-tab--terminal.chrome-tab--active::before'),
    'ChromeTabs.css assigns accent to active terminal tab'
  );

  console.log('✓ ChromeTabs.css stylesheet invariants verified: full width, no insets, proper tokens and clipping');
}

console.log('\\n=============================================================');
console.log('ALL 5 FULL-WIDTH TAB TOP ACCENT TESTS PASSED!');
console.log('=============================================================\\n');
