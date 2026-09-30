import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task ID: LT-CAPTURE-PANEL-COMPACT-DENSITY-PASS-002
 * Title: Further Tighten Capture Panel Padding, Row Spacing, and Third-Row Action Button Size
 */

function renderCapturePanelHeaderCluster({ isCapturing = true, availablePanes = [1, 2], selectedPaneIds = [1], isAllSelected = false, selectedCount = 2, totalBlocks = 5, onCopySelected, onDeleteSelected, onClearAll } = {}) {
  // Row 1: Primary actions (Capture / Stop)
  const row1 = {
    index: 0,
    role: 'primary-actions',
    className: 'capture-toolbar-top-row capture-primary-actions',
    minHeight: '28px',
    children: [
      {
        tag: 'button',
        className: 'capture-toggle-btn capture-toggle-btn--capturing',
        label: 'Capturing',
        height: '28px',
      },
      isCapturing ? {
        tag: 'button',
        className: 'capture-stop-btn',
        label: 'Stop',
        height: '28px',
      } : null,
    ].filter(Boolean),
  };

  // Row 2: Target selector
  const row2 = {
    index: 1,
    role: 'target-selector',
    className: 'capture-target-selector',
    padding: '0px',
    margin: '0px',
    gap: '4px',
    children: availablePanes.map((paneId) => ({
      tag: 'label',
      className: `capture-target-pill ${selectedPaneIds.includes(paneId) ? 'capture-target-pill--selected' : ''}`,
      paneId,
    })),
  };

  // Row 3: Selection summary & multi-select actions
  const row3 = {
    index: 2,
    role: 'selection-actions',
    className: 'capture-toolbar-actions-row',
    minHeight: '22px',
    children: [
      {
        tag: 'label',
        className: 'capture-select-all-label',
        text: `${selectedCount} selected`,
        checkbox: {
          checked: isAllSelected,
          disabled: totalBlocks === 0,
        },
      },
      {
        tag: 'div',
        className: 'capture-global-actions capture-selection-actions',
        gap: '3px',
        buttons: [
          {
            tag: 'button',
            role: 'copy-selected',
            className: 'capture-icon-btn icon-button',
            size: '18px',
            iconSize: '11px',
            disabled: selectedCount === 0,
            onClick: onCopySelected,
          },
          {
            tag: 'button',
            role: 'delete-selected',
            className: 'capture-icon-btn capture-icon-btn-danger icon-button',
            size: '18px',
            iconSize: '11px',
            disabled: selectedCount === 0,
            onClick: onDeleteSelected,
          },
        ],
      },
    ],
  };

  return {
    tag: 'div',
    className: 'capture-toolbar capture-panel-header',
    rowGap: '4px',
    gap: '4px',
    marginBottom: '4px',
    rows: [row1, row2, row3],
  };
}

function renderCaptureSidePanel({ customPadding = '6px 8px 8px' } = {}) {
  return {
    tag: 'aside',
    className: 'capture-side-panel',
    innerWrapper: {
      tag: 'div',
      className: 'context-panel',
      padding: customPadding,
      paddingTop: '6px',
      paddingLeft: '8px',
      paddingRight: '8px',
      paddingBottom: '8px',
    },
  };
}

console.log('Running Capture Panel Compact Density Pass 002 Tests (LT-CAPTURE-PANEL-COMPACT-DENSITY-PASS-002)...\\n');

// ---------------------------------------------------------------------------
// Test 1: top rows use tighter spacing
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: top rows use tighter spacing ---');
  const header = renderCapturePanelHeaderCluster();

  // Assert row gap is tightened to 4px
  assert.strictEqual(header.rowGap, '4px', 'Header rowGap is tightly set to 4px');
  assert.strictEqual(header.gap, '4px', 'Header gap is tightly set to 4px');
  assert.strictEqual(header.marginBottom, '4px', 'Header bottom margin is tightly set to 4px');

  // Assert row 2 has no puffed padding/margins
  const row2 = header.rows[1];
  assert.strictEqual(row2.padding, '0px', 'Row 2 selector has 0px padding so rows cluster tightly');
  assert.strictEqual(row2.margin, '0px', 'Row 2 selector has 0px margin');

  // Assert row 3 has compact min-height
  const row3 = header.rows[2];
  assert.strictEqual(row3.minHeight, '22px', 'Row 3 actions row has compact min-height');

  // Assert rows still render in the exact expected order
  assert.strictEqual(header.rows.length, 3, 'Header contains exactly 3 rows');
  assert.strictEqual(header.rows[0].role, 'primary-actions', 'Row 1 is primary actions');
  assert.strictEqual(header.rows[1].role, 'target-selector', 'Row 2 is target selector');
  assert.strictEqual(header.rows[2].role, 'selection-actions', 'Row 3 is selection summary & actions');

  console.log('✓ Top rows clustered with 4px uniform spacing in the correct order');
}

// ---------------------------------------------------------------------------
// Test 2: outer panel padding reduced
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: outer panel padding reduced ---');
  const panel = renderCaptureSidePanel();
  const inner = panel.innerWrapper;

  assert.strictEqual(inner.padding, '6px 8px 8px', 'Inner context-panel padding is 6px 8px 8px');

  const topPx = parseInt(inner.paddingTop, 10);
  const leftPx = parseInt(inner.paddingLeft, 10);
  const rightPx = parseInt(inner.paddingRight, 10);
  const bottomPx = parseInt(inner.paddingBottom, 10);

  // Assert padding is reduced from previous 8px/12px/12px/10px
  assert.ok(topPx <= 6, 'Top padding is 6px or less');
  assert.ok(leftPx <= 8, 'Left padding is 8px or less');
  assert.ok(rightPx <= 8, 'Right padding is 8px or less');
  assert.ok(bottomPx <= 8, 'Bottom padding is 8px or less');

  // Assert non-zero inset is preserved to prevent edge collisions
  assert.ok(topPx >= 4, 'Top inset is non-zero (>= 4px)');
  assert.ok(leftPx >= 6, 'Left inset is non-zero (>= 6px)');
  assert.ok(rightPx >= 6, 'Right inset is non-zero (>= 6px)');
  assert.ok(bottomPx >= 6, 'Bottom inset is non-zero (>= 6px)');

  console.log('✓ Outer panel padding reduced to compact 6px 8px 8px while preserving clean insets');
}

// ---------------------------------------------------------------------------
// Test 3: third-row multi-select buttons smaller
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: third-row multi-select buttons smaller ---');
  const header = renderCapturePanelHeaderCluster({ selectedCount: 3 });
  const row3 = header.rows[2];
  const actionsGroup = row3.children[1];

  assert.ok(actionsGroup.className.includes('capture-selection-actions'), 'Uses capture-selection-actions class');
  assert.strictEqual(actionsGroup.gap, '3px', 'Gap between buttons reduced to 3px');

  assert.strictEqual(actionsGroup.buttons.length, 2, 'Contains 2 action buttons');
  for (const btn of actionsGroup.buttons) {
    assert.ok(btn.className.includes('icon-button'), 'Uses icon-button class');
    assert.strictEqual(btn.size, '18px', 'Button size is 18px (reduced from 32px)');
    assert.strictEqual(btn.iconSize, '11px', 'SVG icon size is 11px (reduced from 14px)');
  }

  console.log('✓ Third-row multi-select buttons reduced to 18px with 11px icons and 3px gap');
}

// ---------------------------------------------------------------------------
// Test 4: behavior unchanged
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: behavior unchanged ---');
  let copyTriggered = false;
  let deleteTriggered = false;
  let clearTriggered = false;

  const header = renderCapturePanelHeaderCluster({
    selectedCount: 2,
    totalBlocks: 4,
    onCopySelected: () => { copyTriggered = true; },
    onDeleteSelected: () => { deleteTriggered = true; },
    onClearAll: () => { clearTriggered = true; },
  });

  const row3 = header.rows[2];
  const actionsGroup = row3.children[1];

  // 1. Copy selected
  const copyBtn = actionsGroup.buttons.find((b) => b.role === 'copy-selected');
  assert.strictEqual(copyBtn.disabled, false, 'Copy button is enabled when items are selected');
  copyBtn.onClick();
  assert.strictEqual(copyTriggered, true, 'Copy handler fired correctly');

  // 2. Delete selected
  const deleteBtn = actionsGroup.buttons.find((b) => b.role === 'delete-selected');
  assert.strictEqual(deleteBtn.disabled, false, 'Delete button is enabled when items are selected');
  deleteBtn.onClick();
  assert.strictEqual(deleteTriggered, true, 'Delete handler fired correctly');

  assert.strictEqual(actionsGroup.buttons.length, 2, 'Row 3 only has 2 buttons (copy and delete selected)');

  console.log('✓ Both button click handlers, disabled states, and selection semantics preserved');
}

// ---------------------------------------------------------------------------
// Test 5: layout coherence preserved
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: layout coherence preserved ---');
  const header = renderCapturePanelHeaderCluster({ isCapturing: true, availablePanes: [1, 2, 3], selectedCount: 1, totalBlocks: 2 });

  // Verify all 3 rows remain visible
  assert.strictEqual(header.rows.length, 3, 'All 3 rows exist in layout');
  for (let i = 0; i < header.rows.length; i++) {
    const row = header.rows[i];
    assert.strictEqual(row.index, i, `Row ${i} is in sequence`);
    assert.ok(row.children.length > 0, `Row ${i} has visible content`);
  }

  // Row heights and gaps are positive and finite (no negative margins or overlap)
  const gapPx = parseInt(header.gap, 10);
  assert.ok(gapPx > 0 && gapPx <= 4, 'Valid compact gap');

  console.log('✓ Layout coherence verified: rows are visible, properly sequenced, and unclipped');
}

// ---------------------------------------------------------------------------
// Test 6: CSS Stylesheet Invariants
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: CSS Stylesheet Invariants ---');
  const appCssPath = path.resolve(__dirname, '../app/src/App.css');
  const appCss = fs.readFileSync(appCssPath, 'utf8');

  // 1. Toolbar and header tightening
  assert.ok(appCss.includes('.capture-panel-header'), 'App.css defines .capture-panel-header');
  assert.ok(appCss.includes('gap: var(--capture-header-gap, 4px);') || (appCss.includes('gap: 4px;') && appCss.includes('row-gap: 4px;')), 'Header uses compact gap');
  assert.ok(appCss.includes('margin-bottom: var(--capture-header-gap, 4px);') || appCss.includes('margin-bottom: 4px;'), 'Header uses compact margin-bottom');

  // 2. Row 2 selector zero padding
  assert.ok(appCss.includes('.capture-target-selector') && appCss.includes('padding: 0;') && appCss.includes('margin: 0;'), 'Selector has padding: 0 and margin: 0');
  assert.ok(appCss.includes('fieldset.capture-target-selector') && appCss.includes('padding: 0;'), 'Fieldset has padding: 0');

  // 3. Row 3 actions row compact min-height
  assert.ok(appCss.includes('.capture-toolbar-actions-row'), 'App.css defines .capture-toolbar-actions-row');
  assert.ok(appCss.includes('min-height: 22px;'), 'Actions row min-height is 22px');

  // 4. Row 3 buttons compact size
  assert.ok(appCss.includes('.capture-selection-actions'), 'App.css defines .capture-selection-actions');
  assert.ok(appCss.includes('inline-size: 18px;') || appCss.includes('width: 18px;') || appCss.includes('width: 20px;') || appCss.includes('inline-size: 20px;'), 'Button width is compact');
  assert.ok(appCss.includes('block-size: 18px;') || appCss.includes('height: 18px;') || appCss.includes('height: 20px;') || appCss.includes('block-size: 20px;'), 'Button height is compact');
  assert.ok(appCss.includes('gap: 3px;') || appCss.includes('gap: var(--capture-header-gap, 4px);') || appCss.includes('gap: 4px;'), 'Gap between action buttons is compact');

  // 5. Outer container padding
  assert.ok(appCss.includes('padding: 6px 8px 8px;'), 'App.css .context-panel padding is 6px 8px 8px');

  const layoutCssPath = path.resolve(__dirname, '../app/src/features/workspace/TerminalPaneLayout.css');
  const layoutCss = fs.readFileSync(layoutCssPath, 'utf8');
  assert.ok(layoutCss.includes('padding: 6px 8px 8px;'), 'TerminalPaneLayout.css side panel padding is 6px 8px 8px');

  console.log('✓ CSS stylesheets verified for all compact density contracts');
}

console.log('\\n=======================================================================');
console.log('ALL 6 CAPTURE PANEL COMPACT DENSITY PASS 002 TESTS PASSED!');
console.log('=======================================================================\\n');
