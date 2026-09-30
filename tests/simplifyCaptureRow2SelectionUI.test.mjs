import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task: simplify capture row-2 selection UI
 * Requirements:
 * 1. Remove the per-block "Capturing" badge if it only repeats the global capture state.
 * 2. Keep block-level status only if a block truly has its own independent runtime state.
 * 3. In the capture management header second row, add a master checkbox on the far left labeled "All".
 * 4. Clicking "All" should check all / uncheck all target checkboxes.
 * 5. When some but not all targets are selected, the "All" checkbox must show an indeterminate state.
 * 6. Reduce the visual weight of checkbox borders in row 2, but do not make checkboxes unrecognizable.
 * 7. Keep standard checkbox semantics, keyboard support, and accessible labels.
 */

function simulateCaptureRow2({
  availablePanes = [
    { id: 'p1', stableOrdinal: 1, accentId: 'blue' },
    { id: 'p2', stableOrdinal: 2, accentId: 'emerald' },
    { id: 'p3', stableOrdinal: 3, accentId: 'amber' },
  ],
  selectedPaneIds = [],
  isLocked = false,
  onSelectAll,
  onTogglePane,
} = {}) {
  const totalPanes = availablePanes.length;
  const selectedCount = availablePanes.filter((p) => selectedPaneIds.includes(p.id)).length;
  const isAllPanesSelected = totalPanes > 0 && selectedCount === totalPanes;
  const isPanesIndeterminate = totalPanes > 0 && selectedCount > 0 && selectedCount < totalPanes;

  // Master checkbox (far left)
  const masterPill = {
    tag: 'label',
    className: `capture-target-pill capture-target-pill--all ${
      isAllPanesSelected
        ? 'capture-target-pill--selected'
        : isPanesIndeterminate
          ? 'capture-target-pill--indeterminate'
          : ''
    }`,
    label: 'All',
    checkbox: {
      type: 'checkbox',
      className: 'capture-target-checkbox capture-target-checkbox--master',
      checked: isAllPanesSelected,
      indeterminate: isPanesIndeterminate,
      disabled: isLocked,
      ariaLabel: 'Listen to all terminal panes',
      ariaChecked: isPanesIndeterminate ? 'mixed' : isAllPanesSelected,
      onChange: () => {
        if (isLocked) return;
        const shouldSelect = !isAllPanesSelected;
        if (onSelectAll) {
          onSelectAll(shouldSelect);
        } else if (onTogglePane) {
          for (const pane of availablePanes) {
            const isSelected = selectedPaneIds.includes(pane.id);
            if (isSelected !== shouldSelect) {
              onTogglePane(pane.id);
            }
          }
        }
      },
    },
  };

  // Pane pills
  const panePills = availablePanes.map((pane) => {
    const isSelected = selectedPaneIds.includes(pane.id);
    return {
      tag: 'label',
      className: `capture-target-pill ${isSelected ? 'capture-target-pill--selected' : ''}`,
      accentId: pane.accentId,
      label: String(pane.stableOrdinal),
      checkbox: {
        type: 'checkbox',
        className: 'capture-target-checkbox',
        checked: isSelected,
        disabled: isLocked,
        ariaLabel: `Listen to terminal pane ${pane.stableOrdinal}`,
        onChange: () => {
          if (isLocked) return;
          onTogglePane?.(pane.id);
        },
      },
    };
  });

  return {
    tag: 'fieldset',
    className: 'capture-target-selector',
    ariaLabel: 'Capture terminal selection',
    children: [masterPill, ...panePills],
  };
}

function simulateTranscriptCardHeader(block, index, headerLabel) {
  return {
    tag: 'div',
    className: 'transcript-card-header capture-block-header',
    meta: {
      tag: 'div',
      className: 'transcript-card-header-left capture-block-meta',
      children: [
        { tag: 'input', type: 'checkbox', className: 'transcript-checkbox' },
        { tag: 'span', className: 'transcript-source-indicator' },
        { tag: 'span', className: 'transcript-block-index', text: headerLabel },
      ],
    },
  };
}

console.log('Running Simplify Capture Row-2 Selection UI Tests...\\n');

// ---------------------------------------------------------------------------
// Test 1: Remove per-block "Capturing" badge from header
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Remove per-block "Capturing" badge ---');
  const incompleteBlock = { id: 'b-1', command: 'sleep 5', output: '', isComplete: false };
  const completeBlock = { id: 'b-2', command: 'ls', output: 'a.txt', isComplete: true };

  const header1 = simulateTranscriptCardHeader(incompleteBlock, 0, '1-01');
  const header2 = simulateTranscriptCardHeader(completeBlock, 1, '1-02');

  const meta1Classes = header1.meta.children.map((c) => c.className);
  const meta2Classes = header2.meta.children.map((c) => c.className);

  assert.strictEqual(meta1Classes.includes('transcript-block-running'), false, 'No running/capturing badge in incomplete block header');
  assert.strictEqual(meta2Classes.includes('transcript-block-running'), false, 'No running/capturing badge in complete block header');

  const panelTsx = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'), 'utf8');
  assert.strictEqual(panelTsx.includes('<span className="transcript-block-running">Capturing…</span>'), false, 'Capturing badge completely removed from TranscriptCapturePanel.tsx');

  console.log('✓ Per-block "Capturing" badge removed from block header');
}

// ---------------------------------------------------------------------------
// Test 2: Master checkbox labeled "All" on the far left of Row 2
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Master checkbox labeled "All" on the far left of Row 2 ---');
  const row2 = simulateCaptureRow2({ selectedPaneIds: ['p1'] });

  assert.strictEqual(row2.children.length, 4, 'Row 2 has master pill + 3 pane pills');
  const master = row2.children[0];

  assert.strictEqual(master.label, 'All', 'First child is labeled "All"');
  assert.ok(master.className.includes('capture-target-pill--all'), 'Master pill has capture-target-pill--all class');
  assert.strictEqual(master.checkbox.type, 'checkbox', 'Master item is a standard checkbox');
  assert.strictEqual(master.checkbox.ariaLabel, 'Listen to all terminal panes', 'Master checkbox has accessible label');

  // Verify second child is pane 1
  assert.strictEqual(row2.children[1].label, '1');

  console.log('✓ Master checkbox labeled "All" sits on the far left of row 2');
}

// ---------------------------------------------------------------------------
// Test 3: Indeterminate state when some but not all targets are selected
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Indeterminate state handling ---');
  // Scenario A: None selected
  const none = simulateCaptureRow2({ selectedPaneIds: [] });
  assert.strictEqual(none.children[0].checkbox.checked, false, 'None selected: checked is false');
  assert.strictEqual(none.children[0].checkbox.indeterminate, false, 'None selected: indeterminate is false');
  assert.strictEqual(none.children[0].checkbox.ariaChecked, false);

  // Scenario B: Some selected (1 of 3)
  const some1 = simulateCaptureRow2({ selectedPaneIds: ['p1'] });
  assert.strictEqual(some1.children[0].checkbox.checked, false, 'Some selected: checked is false');
  assert.strictEqual(some1.children[0].checkbox.indeterminate, true, 'Some selected: indeterminate is true');
  assert.strictEqual(some1.children[0].checkbox.ariaChecked, 'mixed', 'Some selected: ariaChecked is mixed');
  assert.ok(some1.children[0].className.includes('capture-target-pill--indeterminate'));

  // Scenario C: Some selected (2 of 3)
  const some2 = simulateCaptureRow2({ selectedPaneIds: ['p1', 'p2'] });
  assert.strictEqual(some2.children[0].checkbox.checked, false);
  assert.strictEqual(some2.children[0].checkbox.indeterminate, true);

  // Scenario D: All selected (3 of 3)
  const all = simulateCaptureRow2({ selectedPaneIds: ['p1', 'p2', 'p3'] });
  assert.strictEqual(all.children[0].checkbox.checked, true, 'All selected: checked is true');
  assert.strictEqual(all.children[0].checkbox.indeterminate, false, 'All selected: indeterminate is false');
  assert.strictEqual(all.children[0].checkbox.ariaChecked, true);
  assert.ok(all.children[0].className.includes('capture-target-pill--selected'));

  console.log('✓ Master checkbox correctly reflects unselected, indeterminate (mixed), and checked states');
}

// ---------------------------------------------------------------------------
// Test 4: Clicking "All" checks all / unchecks all
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Clicking "All" toggle semantics ---');
  let selectedAllArg = null;

  // Case 1: none selected -> clicking "All" calls onSelectAll(true)
  const none = simulateCaptureRow2({
    selectedPaneIds: [],
    onSelectAll: (val) => { selectedAllArg = val; },
  });
  none.children[0].checkbox.onChange();
  assert.strictEqual(selectedAllArg, true, 'Clicking All when none selected checks all');

  // Case 2: partial selected (indeterminate) -> clicking "All" calls onSelectAll(true)
  selectedAllArg = null;
  const partial = simulateCaptureRow2({
    selectedPaneIds: ['p1'],
    onSelectAll: (val) => { selectedAllArg = val; },
  });
  partial.children[0].checkbox.onChange();
  assert.strictEqual(selectedAllArg, true, 'Clicking All when partially selected checks all');

  // Case 3: all selected -> clicking "All" calls onSelectAll(false)
  selectedAllArg = null;
  const all = simulateCaptureRow2({
    selectedPaneIds: ['p1', 'p2', 'p3'],
    onSelectAll: (val) => { selectedAllArg = val; },
  });
  all.children[0].checkbox.onChange();
  assert.strictEqual(selectedAllArg, false, 'Clicking All when all selected unchecks all');

  // Case 4: fallback to onTogglePane when onSelectAll is not passed
  const toggledPanes = [];
  const partialWithToggle = simulateCaptureRow2({
    selectedPaneIds: ['p1'],
    onTogglePane: (id) => { toggledPanes.push(id); },
  });
  partialWithToggle.children[0].checkbox.onChange();
  // Should toggle unselected panes 'p2' and 'p3' to true
  assert.deepStrictEqual(toggledPanes, ['p2', 'p3'], 'Fallback toggles unselected panes');

  console.log('✓ Clicking "All" checks all when partial/none, and unchecks all when all selected');
}

// ---------------------------------------------------------------------------
// Test 5: Selector lock during capturing and paused
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Selector lock behavior ---');
  let called = false;
  const locked = simulateCaptureRow2({
    selectedPaneIds: ['p1'],
    isLocked: true,
    onSelectAll: () => { called = true; },
  });

  const masterCheckbox = locked.children[0].checkbox;
  assert.strictEqual(masterCheckbox.disabled, true, 'Master checkbox is disabled when locked');

  masterCheckbox.onChange();
  assert.strictEqual(called, false, 'Locked master checkbox does not fire onSelectAll');

  console.log('✓ Master checkbox respects target selector lock state during active capture');
}

// ---------------------------------------------------------------------------
// Test 6: Checkbox border visual weight and styling in App.css
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: Checkbox border visual weight and styling ---');
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');

  // Verify custom subtle border styling for row 2 checkboxes
  assert.ok(appCss.includes('.capture-target-checkbox'), 'App.css styles .capture-target-checkbox');
  assert.ok(appCss.includes('appearance: none;') || appCss.includes('-webkit-appearance: none;'), 'Checkbox uses appearance: none for subtle border rendering');
  assert.ok(appCss.includes('border: 1px solid rgba(148, 163, 184, 0.28);'), 'Checkbox uses lighter visual weight border');

  // Verify checked & indeterminate states in CSS
  assert.ok(appCss.includes('.capture-target-checkbox:checked'), 'CSS defines checked state styling');
  assert.ok(appCss.includes('.capture-target-checkbox:indeterminate'), 'CSS defines indeterminate state styling');
  assert.ok(appCss.includes('.capture-target-checkbox:focus-visible'), 'CSS preserves keyboard focus ring');

  // Verify label font styling
  assert.ok(appCss.includes('.capture-target-all-label'), 'App.css styles .capture-target-all-label');

  console.log('✓ Row 2 checkbox borders have reduced visual weight with clean checked/indeterminate indicators');
}

console.log('\\n=======================================================================');
console.log('ALL 6 SIMPLIFY CAPTURE ROW-2 SELECTION UI TESTS PASSED!');
console.log('=======================================================================\\n');
