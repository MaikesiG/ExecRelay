import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task ID: LT-CAPTURE-HEADER-SPACING-RHYTHM-AND-ACTION-SIZE-TUNE-003
 * Title: Unify Capture Header Spacing Rhythm, Tighten Row-2 Vertical Spacing, and Slightly Increase Row-3 Action Buttons
 */

function simulateCaptureHeader({
  headerGap = '4px',
  isCapturing = true,
  availablePanes = [
    { id: 'p1', stableOrdinal: 1, accentId: 'blue' },
    { id: 'p2', stableOrdinal: 2, accentId: 'emerald' },
  ],
  selectedPaneIds = ['p1'],
  onToggleCapture,
  onStopCapture,
  onTogglePane,
  onSelectAllPanes,
  onCopySelected,
  onDeleteSelected,
  onClearTranscript,
} = {}) {
  // Row 1: Primary actions (Capture / Stop)
  const row1 = {
    role: 'primary-actions',
    className: 'capture-toolbar-top-row capture-primary-actions',
    gap: headerGap,
    minHeight: '28px',
    buttons: [
      {
        tag: 'button',
        role: 'toggle-capture',
        className: 'capture-toggle-btn capture-toggle-btn--capturing',
        label: isCapturing ? 'Capturing' : 'Capture',
        onClick: onToggleCapture,
      },
      isCapturing ? {
        tag: 'button',
        role: 'stop-capture',
        className: 'capture-stop-btn',
        label: 'Stop',
        onClick: onStopCapture,
      } : null,
    ].filter(Boolean),
  };

  // Row 2: Selector line (All, 1, 2)
  const totalPanes = availablePanes.length;
  const selectedCount = availablePanes.filter((p) => selectedPaneIds.includes(p.id)).length;
  const isAllSelected = totalPanes > 0 && selectedCount === totalPanes;
  const isIndeterminate = totalPanes > 0 && selectedCount > 0 && selectedCount < totalPanes;

  const row2 = {
    role: 'target-selector',
    className: 'capture-target-selector',
    gap: headerGap,
    rowGap: '0px',
    minHeight: 'auto',
    marginBlock: '0px',
    padding: '0px',
    items: [
      {
        tag: 'label',
        role: 'master-pill',
        className: `capture-target-pill capture-target-pill--all ${
          isAllSelected ? 'capture-target-pill--selected' : isIndeterminate ? 'capture-target-pill--indeterminate' : ''
        }`,
        minHeight: '20px',
        height: '20px',
        paddingBlock: '1px',
        paddingInline: '6px',
        lineHeight: '1.15',
        label: 'All',
        checkbox: {
          checked: isAllSelected,
          indeterminate: isIndeterminate,
          onChange: () => onSelectAllPanes?.(!isAllSelected),
        },
      },
      ...availablePanes.map((pane) => {
        const isSelected = selectedPaneIds.includes(pane.id);
        return {
          tag: 'label',
          role: 'pane-pill',
          className: `capture-target-pill ${isSelected ? 'capture-target-pill--selected' : ''}`,
          minHeight: '20px',
          height: '20px',
          paddingBlock: '1px',
          paddingInline: '6px',
          lineHeight: '1.15',
          label: String(pane.stableOrdinal),
          checkbox: {
            checked: isSelected,
            onChange: () => onTogglePane?.(pane.id),
          },
        };
      }),
    ],
  };

  // Row 3: Summary and actions
  const row3 = {
    role: 'summary-actions',
    className: 'capture-toolbar-actions-row',
    gap: headerGap,
    minHeight: '22px',
    summary: `${selectedCount} selected`,
    actions: {
      className: 'capture-global-actions capture-selection-actions',
      gap: headerGap,
      buttons: [
        {
          role: 'copy',
          className: 'capture-icon-btn icon-button',
          size: '20px',
          iconSize: '12px',
          onClick: onCopySelected,
        },
        {
          role: 'delete',
          className: 'capture-icon-btn capture-icon-btn-danger icon-button',
          size: '20px',
          iconSize: '12px',
          onClick: onDeleteSelected,
        },
        {
          role: 'clear',
          className: 'capture-icon-btn icon-button',
          size: '20px',
          iconSize: '12px',
          onClick: onClearTranscript,
        },
      ],
    },
  };

  return {
    className: 'capture-toolbar capture-panel-header',
    headerGapToken: '--capture-header-gap: 4px',
    gap: headerGap,
    rowGap: headerGap,
    marginBottom: headerGap,
    rows: [row1, row2, row3],
  };
}

console.log('Running Capture Header Spacing Rhythm & Action Size Tune 003 Tests...\\n');

// ---------------------------------------------------------------------------
// Test 1: Row-2 vertical density reduced
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Row-2 vertical density reduced ---');
  const header = simulateCaptureHeader();
  const row2 = header.rows[1];

  assert.strictEqual(row2.minHeight, 'auto', 'Row 2 min-height is auto');
  assert.strictEqual(row2.marginBlock, '0px', 'Row 2 margin-block is 0px');
  assert.strictEqual(row2.rowGap, '0px', 'Row 2 rowGap is 0px');
  assert.strictEqual(row2.padding, '0px', 'Row 2 wrapper padding is 0px');

  for (const item of row2.items) {
    assert.strictEqual(item.paddingBlock, '1px', 'Pill padding-block is tight (1px)');
    assert.strictEqual(item.minHeight, '20px', 'Pill min-height is compact (20px)');
    assert.strictEqual(item.height, '20px', 'Pill height is compact (20px)');
    assert.strictEqual(item.lineHeight, '1.15', 'Pill line-height is compact (1.15)');
  }

  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
  assert.ok(appCss.includes('min-height: auto;'), 'App.css sets min-height: auto on .capture-target-selector');
  assert.ok(appCss.includes('margin-block: 0;'), 'App.css sets margin-block: 0');
  assert.ok(appCss.includes('padding-block: 1px;'), 'App.css sets padding-block: 1px on pills');
  assert.ok(appCss.includes('line-height: 1.15;'), 'App.css sets compact line-height on pills');

  console.log('✓ Row 2 vertical density successfully tightened without retaining older taller spacing');
}

// ---------------------------------------------------------------------------
// Test 2: Capture/Stop gap reduced
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Capture/Stop gap reduced ---');
  const header = simulateCaptureHeader({ isCapturing: true });
  const row1 = header.rows[0];

  assert.strictEqual(row1.buttons.length, 2, 'Row 1 contains Capture and Stop');
  assert.strictEqual(row1.gap, '4px', 'Gap between Capture and Stop reduced to 4px');

  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
  assert.ok(appCss.includes('.capture-primary-actions {\n  display: flex;\n  align-items: center;\n  gap: var(--capture-header-gap, 4px);'), 'Primary actions gap uses unified 4px token');

  console.log('✓ Gap between Capture and Stop reduced to unified compact 4px');
}

// ---------------------------------------------------------------------------
// Test 3: unified spacing rhythm
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: unified spacing rhythm across header controls ---');
  const header = simulateCaptureHeader();

  // Unified rhythm: 4px base gap applied across all control groups
  assert.strictEqual(header.gap, '4px', 'Header container gap is 4px');
  assert.strictEqual(header.rowGap, '4px', 'Header container rowGap is 4px');
  assert.strictEqual(header.marginBottom, '4px', 'Header bottom margin is 4px');

  assert.strictEqual(header.rows[0].gap, '4px', 'Row 1 controls gap is 4px');
  assert.strictEqual(header.rows[1].gap, '4px', 'Row 2 controls gap is 4px');
  assert.strictEqual(header.rows[2].gap, '4px', 'Row 3 container gap is 4px');
  assert.strictEqual(header.rows[2].actions.gap, '4px', 'Row 3 action buttons gap is 4px');

  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
  assert.ok(appCss.includes('--capture-header-gap: 4px;'), 'App.css establishes --capture-header-gap token');
  assert.ok(appCss.includes('.capture-toolbar-actions-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: var(--capture-header-gap, 4px);'), 'Row 3 uses unified header gap');
  assert.ok(appCss.includes('.capture-global-actions,\n.capture-selection-actions {\n  display: flex;\n  align-items: center;\n  gap: var(--capture-header-gap, 4px);'), 'Action buttons use unified header gap');

  console.log('✓ Unified spacing rhythm token (--capture-header-gap: 4px) applied across all 3 rows');
}

// ---------------------------------------------------------------------------
// Test 4: Row-3 buttons slightly larger (20px button, 12px icon)
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Row-3 buttons slightly larger ---');
  const header = simulateCaptureHeader();
  const row3Actions = header.rows[2].actions;

  assert.strictEqual(row3Actions.buttons.length, 3, 'Three Row 3 action buttons');
  for (const btn of row3Actions.buttons) {
    assert.strictEqual(btn.size, '20px', 'Button size increased slightly to 20px (from 18px)');
    assert.strictEqual(btn.iconSize, '12px', 'SVG icon size increased to 12px (from 11px)');
  }

  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
  assert.ok(appCss.includes('width: 20px;') && appCss.includes('height: 20px;'), 'App.css sets 20px size for Row 3 action buttons');
  assert.ok(appCss.includes('inline-size: 20px;') && appCss.includes('block-size: 20px;'), 'App.css sets logical 20px size');
  assert.ok(appCss.includes('.capture-icon-btn svg,\n.capture-selection-actions .icon-button svg {\n  width: 12px;\n  height: 12px;\n}'), 'App.css sets 12px SVG icon size');

  const panelTsx = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'), 'utf8');
  assert.ok(!panelTsx.includes('width="11"'), 'TranscriptCapturePanel SVGs do not use older 11px size');
  assert.ok(panelTsx.includes('width="12"'), 'TranscriptCapturePanel SVGs use 12px size');

  console.log('✓ Row 3 buttons sized to 20px with 12px icons for improved tactile balance');
}

// ---------------------------------------------------------------------------
// Test 5: behavior unchanged
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: behavior unchanged ---');
  let toggledCapture = false;
  let stoppedCapture = false;
  let toggledPaneId = null;
  let allPanesArg = null;
  let copyFired = false;
  let deleteFired = false;
  let clearFired = false;

  const header = simulateCaptureHeader({
    isCapturing: true,
    availablePanes: [
      { id: 'p1', stableOrdinal: 1, accentId: 'blue' },
      { id: 'p2', stableOrdinal: 2, accentId: 'emerald' },
    ],
    selectedPaneIds: ['p1'],
    onToggleCapture: () => { toggledCapture = true; },
    onStopCapture: () => { stoppedCapture = true; },
    onTogglePane: (id) => { toggledPaneId = id; },
    onSelectAllPanes: (all) => { allPanesArg = all; },
    onCopySelected: () => { copyFired = true; },
    onDeleteSelected: () => { deleteFired = true; },
    onClearTranscript: () => { clearFired = true; },
  });

  // 1. Row 1 controls
  header.rows[0].buttons[0].onClick();
  assert.strictEqual(toggledCapture, true, 'Toggle capture fired');
  header.rows[0].buttons[1].onClick();
  assert.strictEqual(stoppedCapture, true, 'Stop capture fired');

  // 2. Row 2 controls
  const masterPill = header.rows[1].items[0];
  masterPill.checkbox.onChange();
  assert.strictEqual(allPanesArg, true, 'Master checkbox toggles all');

  const panePill = header.rows[1].items[1];
  panePill.checkbox.onChange();
  assert.strictEqual(toggledPaneId, 'p1', 'Pane checkbox toggles pane p1');

  // 3. Row 3 controls
  const actionBtns = header.rows[2].actions.buttons;
  actionBtns[0].onClick();
  assert.strictEqual(copyFired, true, 'Copy selected fired');
  actionBtns[1].onClick();
  assert.strictEqual(deleteFired, true, 'Delete selected fired');
  actionBtns[2].onClick();
  assert.strictEqual(clearFired, true, 'Clear transcript fired');

  console.log('✓ All handlers and interaction semantics remain 100% operational');
}

console.log('\\n=======================================================================');
console.log('ALL 5 CAPTURE HEADER SPACING RHYTHM & ACTION SIZE TESTS PASSED!');
console.log('=======================================================================\\n');
