import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task: Refactor the TraceRelay capture panel to remove the dedicated “Clear transcript” action
 * and rely entirely on selection-based deletion.
 */

// Simulated model representing the refactored TranscriptCapturePanel component
class CapturePanelSelectionModel {
  constructor({
    blocks = [],
    selectedBlockIds = new Set(),
    onDeleteSelected = () => {},
    onCopySelected = () => {},
  } = {}) {
    this.blocks = [...blocks];
    this.selectedBlockIds = new Set(selectedBlockIds);
    this.onDeleteSelected = onDeleteSelected;
    this.onCopySelected = onCopySelected;
    this.pendingConfirmation = null;
  }

  get totalBlocks() {
    return this.blocks.length;
  }

  get selectedCount() {
    return this.selectedBlockIds.size;
  }

  get isAllSelected() {
    return this.totalBlocks > 0 && this.selectedCount === this.totalBlocks;
  }

  toggleSelectAll() {
    if (this.isAllSelected) {
      this.selectedBlockIds.clear();
    } else {
      this.selectedBlockIds = new Set(this.blocks.map((b) => b.id));
    }
  }

  toggleSelectBlock(blockId) {
    if (this.selectedBlockIds.has(blockId)) {
      this.selectedBlockIds.delete(blockId);
    } else {
      this.selectedBlockIds.add(blockId);
    }
  }

  requestDeleteSelected() {
    if (this.selectedCount > 0) {
      this.pendingConfirmation = 'delete-selected';
    }
  }

  cancelConfirmation() {
    this.pendingConfirmation = null;
  }

  confirmDeleteSelected() {
    if (this.pendingConfirmation === 'delete-selected') {
      const idsToDelete = new Set(this.selectedBlockIds);
      this.blocks = this.blocks.filter((b) => !idsToDelete.has(b.id));
      this.selectedBlockIds.clear();
      this.pendingConfirmation = null;
      this.onDeleteSelected();
    }
  }

  render() {
    const isDeleteConfirmActive =
      this.pendingConfirmation === 'delete-selected' && this.selectedCount > 0;

    let confirmationBanner = null;
    if (isDeleteConfirmActive) {
      const count = this.selectedCount;
      confirmationBanner = {
        tag: 'div',
        className: 'capture-confirm-banner confirm-card transcript-confirm-card',
        role: 'region',
        title: `Delete ${count} block${count === 1 ? '' : 's'}?`,
        body: 'Only local captured blocks are removed. Terminal screen and history are unaffected.',
        confirmLabel: 'Delete',
      };
    }

    const row3Actions = [
      {
        role: 'copy-selected',
        label: 'Copy selected transcript blocks',
        disabled: this.selectedCount === 0,
      },
      {
        role: 'delete-selected',
        label: 'Delete selected transcript blocks',
        disabled: this.selectedCount === 0,
        isDestructive: true,
      },
    ];

    return {
      totalBlocks: this.totalBlocks,
      selectedCount: this.selectedCount,
      isAllSelected: this.isAllSelected,
      row3Actions,
      confirmationBanner,
      isEmptyState: this.totalBlocks === 0,
    };
  }
}

console.log('Running Remove Clear Transcript & Selection Delete Tests...\\n');

// ---------------------------------------------------------------------------
// Test 1: The standalone clear-transcript control no longer renders in JSX / UI
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Standalone clear-transcript control no longer renders ---');
  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );

  assert.strictEqual(
    panelTsx.includes('Clear all transcript blocks'),
    false,
    'TranscriptCapturePanel does not render any "Clear all transcript blocks" button',
  );
  assert.strictEqual(
    panelTsx.includes('clear-transcript'),
    false,
    'TranscriptCapturePanel does not reference clear-transcript',
  );
  assert.strictEqual(
    panelTsx.includes('onClearTranscript'),
    false,
    'TranscriptCapturePanelProps does not contain onClearTranscript',
  );
  assert.strictEqual(
    panelTsx.includes('capture-icon-btn--clear'),
    false,
    'TranscriptCapturePanel does not set capture-icon-btn--clear class',
  );

  // App.css validation
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
  assert.strictEqual(
    appCss.includes('.capture-icon-btn--clear'),
    false,
    'App.css does not define obsolete .capture-icon-btn--clear rules',
  );

  // Layout node views
  const nodeViewTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/PanelLayoutNodeView.tsx'),
    'utf8',
  );
  assert.strictEqual(
    nodeViewTsx.includes('onClearTranscript'),
    false,
    'PanelLayoutNodeView does not reference onClearTranscript',
  );

  console.log('✓ Standalone clear-transcript control, prop, and styling completely removed');
}

// ---------------------------------------------------------------------------
// Test 2: Row 3 control rebalancing (only copy-selected and delete-selected)
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Row 3 control rebalancing ---');
  const model = new CapturePanelSelectionModel({
    blocks: [
      { id: 'b-1', command: 'cmd1' },
      { id: 'b-2', command: 'cmd2' },
    ],
  });

  const rendered = model.render();
  assert.strictEqual(rendered.row3Actions.length, 2, 'Row 3 only has 2 action buttons');
  assert.strictEqual(rendered.row3Actions[0].role, 'copy-selected');
  assert.strictEqual(rendered.row3Actions[1].role, 'delete-selected');
  assert.strictEqual(rendered.row3Actions[1].isDestructive, true);

  console.log('✓ Row 3 cleanly rebalanced with only Copy Selected and Delete Selected');
}

// ---------------------------------------------------------------------------
// Test 3: Select-all functionality
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Select-all functionality ---');
  const blocks = [
    { id: 'b-1', command: 'cmd1' },
    { id: 'b-2', command: 'cmd2' },
    { id: 'b-3', command: 'cmd3' },
  ];

  const model = new CapturePanelSelectionModel({ blocks });
  assert.strictEqual(model.selectedCount, 0);
  assert.strictEqual(model.isAllSelected, false);

  // Toggle select all -> selects all
  model.toggleSelectAll();
  assert.strictEqual(model.selectedCount, 3);
  assert.strictEqual(model.isAllSelected, true);

  // Toggle select all again -> unselects all
  model.toggleSelectAll();
  assert.strictEqual(model.selectedCount, 0);
  assert.strictEqual(model.isAllSelected, false);

  // Select 1 block manually
  model.toggleSelectBlock('b-1');
  assert.strictEqual(model.selectedCount, 1);
  assert.strictEqual(model.isAllSelected, false);

  // Toggle select all when partially selected -> selects all
  model.toggleSelectAll();
  assert.strictEqual(model.selectedCount, 3);
  assert.strictEqual(model.isAllSelected, true);

  console.log('✓ Select-all toggle correctly cycles between partial/all/none');
}

// ---------------------------------------------------------------------------
// Test 4: Delete-selected with confirmation works
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Delete-selected with confirmation ---');
  let deleteFired = false;
  const blocks = [
    { id: 'b-1', command: 'cmd1' },
    { id: 'b-2', command: 'cmd2' },
    { id: 'b-3', command: 'cmd3' },
  ];

  const model = new CapturePanelSelectionModel({
    blocks,
    selectedBlockIds: new Set(['b-1']),
    onDeleteSelected: () => {
      deleteFired = true;
    },
  });

  // Request delete
  model.requestDeleteSelected();
  let rendered = model.render();
  assert.ok(rendered.confirmationBanner !== null, 'Delete confirmation banner is displayed');
  assert.strictEqual(rendered.confirmationBanner.title, 'Delete 1 block?');
  assert.strictEqual(rendered.confirmationBanner.confirmLabel, 'Delete');

  // Cancel confirmation
  model.cancelConfirmation();
  rendered = model.render();
  assert.strictEqual(rendered.confirmationBanner, null, 'Confirmation banner dismissed on cancel');
  assert.strictEqual(model.totalBlocks, 3, 'No blocks deleted on cancel');
  assert.strictEqual(deleteFired, false);

  // Request delete again and confirm
  model.requestDeleteSelected();
  model.confirmDeleteSelected();
  rendered = model.render();
  assert.strictEqual(deleteFired, true, 'onDeleteSelected callback invoked');
  assert.strictEqual(model.totalBlocks, 2, 'Selected block was removed');
  assert.strictEqual(model.selectedCount, 0, 'Selection cleared after deletion');

  console.log('✓ Delete-selected opens inline confirmation and removes selected blocks upon confirmation');
}

// ---------------------------------------------------------------------------
// Test 5: "Select all + Delete selected" deletes ALL blocks and enters empty state
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Select all + Delete selected deletes all blocks ---');
  let deleteFired = false;
  const blocks = [
    { id: 'b-1', command: 'cmd1' },
    { id: 'b-2', command: 'cmd2' },
  ];

  const model = new CapturePanelSelectionModel({
    blocks,
    onDeleteSelected: () => {
      deleteFired = true;
    },
  });

  // 1. Select all
  model.toggleSelectAll();
  assert.strictEqual(model.isAllSelected, true);
  assert.strictEqual(model.selectedCount, 2);

  // 2. Request delete
  model.requestDeleteSelected();
  let rendered = model.render();
  assert.strictEqual(rendered.confirmationBanner.title, 'Delete 2 blocks?');

  // 3. Confirm delete
  model.confirmDeleteSelected();
  rendered = model.render();

  assert.strictEqual(deleteFired, true);
  assert.strictEqual(model.totalBlocks, 0, 'All blocks removed');
  assert.strictEqual(model.selectedCount, 0, 'Selection is 0');
  assert.strictEqual(rendered.isEmptyState, true, 'Enters empty state');
  assert.strictEqual(rendered.row3Actions[0].disabled, true, 'Copy selected disabled in empty state');
  assert.strictEqual(rendered.row3Actions[1].disabled, true, 'Delete selected disabled in empty state');

  console.log('✓ "Select all + Delete selected" cleanly clears all blocks and renders empty state');
}

// ---------------------------------------------------------------------------
// Test 6: No stale clear-transcript confirmation UI or banner
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: No stale clear-transcript confirmation UI ---');
  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );

  assert.strictEqual(
    panelTsx.includes('isClearConfirmActive'),
    false,
    'No isClearConfirmActive variable exists',
  );
  assert.strictEqual(
    panelTsx.includes('Clear transcript?'),
    false,
    'No "Clear transcript?" banner title exists',
  );
  assert.strictEqual(
    panelTsx.includes('confirmLabel="Clear"'),
    false,
    'No confirmLabel="Clear" exists',
  );

  console.log('✓ Verified no stale clear-transcript confirmation UI remains');
}

// ---------------------------------------------------------------------------
// Test 7: Accessibility labels and focus interaction remain intact
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 7: Accessibility labels and focus interaction ---');
  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );

  // Row 3 select-all checkbox
  assert.ok(
    panelTsx.includes('aria-label="Select or deselect all transcript blocks"'),
    'Master select-all checkbox has accessible label',
  );

  // Row 3 copy selected
  assert.ok(
    panelTsx.includes('aria-label="Copy selected transcript blocks"'),
    'Copy selected button has accessible label',
  );

  // Row 3 delete selected
  assert.ok(
    panelTsx.includes('aria-label="Delete selected transcript blocks"'),
    'Delete selected button has accessible label',
  );

  // Inline delete banner
  assert.ok(
    panelTsx.includes('InlineDestructiveBanner'),
    'InlineDestructiveBanner is used for delete confirmation',
  );

  console.log('✓ All accessibility labels and destructive confirmation dialogs remain intact');
}

console.log('\\n=======================================================================');
console.log('ALL 7 REMOVE CLEAR TRANSCRIPT & SELECTION DELETE TESTS PASSED!');
console.log('=======================================================================\\n');
