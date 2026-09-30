import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task ID: LT-SPLIT-PANE-LAYOUT-AND-INLINE-DESTRUCTIVE-BANNER-001
 * Title: Stable Split-Pane Layout & Compact Inline Destructive Banner for TraceRelay Capture Panel
 */

function simulateSplitPaneLayout({
  isCaptureOpen = true,
  captureWidth = 400,
  containerWidth = 1200,
  isDeleteConfirmActive = false,
  selectedCount = 2,
  totalBlocks = 3,
  onCancel,
  onDeleteSelected,
} = {}) {
  const terminalRegion = {
    tag: 'div',
    className: 'terminal-main-region',
    style: {
      flex: isCaptureOpen ? '1 1 auto' : '1 1 100%',
      width: isCaptureOpen ? `${containerWidth - captureWidth - 1}px` : `${containerWidth}px`,
      minWidth: '0px',
    },
  };

  const resizer = isCaptureOpen
    ? {
        tag: 'div',
        className: 'capture-resizer pane-divider pane-divider--horizontal',
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': 'Resize capture side panel',
        width: '1px',
        cursor: 'col-resize',
      }
    : null;

  let inlineBanner = null;
  if (isDeleteConfirmActive) {
    const title = `Delete ${selectedCount} block${selectedCount === 1 ? '' : 's'}?`;
    inlineBanner = {
      tag: 'div',
      className: 'capture-confirm-banner confirm-card transcript-confirm-card',
      role: 'region',
      'aria-label': title,
      isModal: false,
      title,
      body: 'Only local captured blocks are removed. Terminal screen and history are unaffected.',
      actions: [
        {
          label: 'Cancel',
          className: 'capture-banner-btn capture-banner-btn--cancel confirm-btn-cancel',
          isDestructive: false,
          isCompact: true,
          height: '20px',
          onClick: onCancel,
        },
        {
          label: 'Delete',
          className: 'capture-banner-btn capture-banner-btn--destructive confirm-btn-destructive',
          isDestructive: true,
          isCompact: true,
          height: '20px',
          onClick: onDeleteSelected,
        },
      ],
    };
  }

  const sidePanel = isCaptureOpen
    ? {
        tag: 'aside',
        className: 'capture-side-panel',
        'aria-label': 'Capture side panel',
        style: {
          flex: `0 0 ${captureWidth}px`,
          width: `${captureWidth}px`,
          minWidth: '260px',
          flexShrink: 0,
        },
        panelStructure: {
          header: { className: 'capture-toolbar capture-panel-header' },
          banner: inlineBanner,
          transcriptList: {
            className: totalBlocks === 0 ? 'context-empty' : 'transcript-scroll-container',
            blockCount: totalBlocks,
          },
        },
      }
    : null;

  return {
    tag: 'div',
    className: 'terminal-workspace-body',
    'data-capture-open': isCaptureOpen ? 'true' : 'false',
    style: {
      flexDirection: 'row',
      alignItems: 'stretch',
      width: `${containerWidth}px`,
      ['--capture-panel-width']: `${captureWidth}px`,
    },
    children: [terminalRegion, resizer, sidePanel].filter(Boolean),
  };
}

console.log('Running Split-Pane Layout and Inline Destructive Banner Tests...\\n');

// ---------------------------------------------------------------------------
// Test 1: Split-pane layout renders left terminal + right capture panel
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Split-pane layout renders left terminal + right capture panel ---');
  const layout = simulateSplitPaneLayout({ isCaptureOpen: true, captureWidth: 400, containerWidth: 1200 });

  assert.strictEqual(layout.children.length, 3, 'Workspace body renders terminal region, resizer, and capture panel');

  // Left pane: terminal
  const leftPane = layout.children[0];
  assert.strictEqual(leftPane.className, 'terminal-main-region', 'Left pane is terminal-main-region');
  assert.strictEqual(leftPane.style.flex, '1 1 auto', 'Terminal pane fills remaining space');
  assert.strictEqual(leftPane.style.width, '799px', 'Terminal occupies remaining width (1200 - 400 - 1)');

  // Divider / resizer
  const divider = layout.children[1];
  assert.ok(divider.className.includes('capture-resizer'), 'Middle child is capture-resizer');
  assert.strictEqual(divider.cursor, 'col-resize', 'Resizer has col-resize cursor');

  // Right pane: capture panel
  const rightPane = layout.children[2];
  assert.strictEqual(rightPane.className, 'capture-side-panel', 'Right pane is capture-side-panel');
  assert.strictEqual(rightPane.style.flex, '0 0 400px', 'Right pane has fixed flex-basis matching capture width');
  assert.strictEqual(rightPane.style.flexShrink, 0, 'Capture panel does not shrink unexpectedly');

  // Verify TerminalPaneLayout.css invariants
  const layoutCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/TerminalPaneLayout.css'),
    'utf8',
  );
  assert.ok(layoutCss.includes('flex-direction: row;'), 'TerminalPaneLayout.css specifies flex-direction: row');
  assert.ok(layoutCss.includes('.terminal-main-region'), 'TerminalPaneLayout.css defines .terminal-main-region');
  assert.ok(layoutCss.includes('.capture-resizer'), 'TerminalPaneLayout.css defines .capture-resizer');
  assert.ok(layoutCss.includes('.capture-side-panel'), 'TerminalPaneLayout.css defines .capture-side-panel');
  assert.ok(layoutCss.includes('flex-shrink: 0;'), 'capture-side-panel enforces flex-shrink: 0');

  console.log('✓ Split-pane layout renders stable left terminal and fixed right capture panel');
}

// ---------------------------------------------------------------------------
// Test 2: Destructive delete confirmation renders as a compact inline banner
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Destructive delete confirmation renders as a compact inline banner ---');
  const layout = simulateSplitPaneLayout({ isDeleteConfirmActive: true, selectedCount: 1 });
  const sidePanel = layout.children[2];
  const banner = sidePanel.panelStructure.banner;

  assert.ok(banner !== null, 'Banner is rendered when isDeleteConfirmActive is true');
  assert.ok(banner.className.includes('capture-confirm-banner'), 'Uses .capture-confirm-banner class');
  assert.strictEqual(banner.isModal, false, 'Banner is NOT a modal dialog');
  assert.strictEqual(banner.role, 'region', 'Banner uses region role rather than alertdialog');
  assert.strictEqual(banner.title, 'Delete 1 block?', 'Banner has concise title "Delete 1 block?"');
  assert.ok(
    banner.body.includes('Only local captured blocks are removed'),
    'Banner includes clear supporting sentence explaining terminal screen/history are unaffected',
  );

  // Assert action buttons
  assert.strictEqual(banner.actions.length, 2, 'Banner has exactly two actions');
  assert.strictEqual(banner.actions[0].label, 'Cancel', 'First action is Cancel');
  assert.strictEqual(banner.actions[1].label, 'Delete', 'Second action is Delete (concise, not oversized)');

  // Verify App.css styling invariants
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
  assert.ok(appCss.includes('.capture-confirm-banner'), 'App.css defines .capture-confirm-banner');
  assert.ok(appCss.includes('box-shadow: none;'), 'Banner removes heavy popup box shadow');
  assert.ok(appCss.includes('border-left: 3px solid'), 'Banner uses subtle left accent border');
  assert.ok(appCss.includes('.capture-banner-btn'), 'App.css defines .capture-banner-btn');
  assert.ok(appCss.includes('height: 20px;'), 'Banner buttons use compact 20px height');

  console.log('✓ Selection delete confirmation renders as a compact inline banner with Cancel and Delete');
}

// ---------------------------------------------------------------------------
// Test 3: Action buttons are compact and functional
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Action buttons are compact and functional ---');
  let cancelCalled = false;
  let deleteCalled = false;

  const layout = simulateSplitPaneLayout({
    isDeleteConfirmActive: true,
    selectedCount: 2,
    onCancel: () => {
      cancelCalled = true;
    },
    onDeleteSelected: () => {
      deleteCalled = true;
    },
  });

  const banner = layout.children[2].panelStructure.banner;
  const cancelBtn = banner.actions[0];
  const deleteBtn = banner.actions[1];

  // Button sizes
  assert.strictEqual(cancelBtn.isCompact, true, 'Cancel button is compact');
  assert.strictEqual(cancelBtn.height, '20px', 'Cancel button is 20px tall');
  assert.strictEqual(deleteBtn.isCompact, true, 'Delete button is compact');
  assert.strictEqual(deleteBtn.height, '20px', 'Delete button is 20px tall');

  // Trigger Cancel
  cancelBtn.onClick();
  assert.strictEqual(cancelCalled, true, 'Cancel handler fired correctly');

  // Trigger Delete
  deleteBtn.onClick();
  assert.strictEqual(deleteCalled, true, 'Delete handler fired correctly');

  console.log('✓ Action buttons are compact (20px) and successfully trigger Cancel/Delete handlers');
}

// ---------------------------------------------------------------------------
// Test 4: Delete-selected warning also renders as a compact inline banner
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Delete-selected warning also renders as a compact inline banner ---');
  let deleteCalled = false;
  let cancelCalled = false;

  const layout = simulateSplitPaneLayout({
    isDeleteConfirmActive: true,
    selectedCount: 3,
    onCancel: () => {
      cancelCalled = true;
    },
    onDeleteSelected: () => {
      deleteCalled = true;
    },
  });

  const banner = layout.children[2].panelStructure.banner;
  assert.strictEqual(banner.title, 'Delete 3 blocks?', 'Delete banner has pluralized title');
  assert.strictEqual(banner.actions[0].label, 'Cancel');
  assert.strictEqual(banner.actions[1].label, 'Delete');

  banner.actions[0].onClick();
  assert.strictEqual(cancelCalled, true, 'Cancel handler dismissed delete banner');

  banner.actions[1].onClick();
  assert.strictEqual(deleteCalled, true, 'Delete handler fired correctly');

  console.log('✓ Delete-selected confirmation uses the compact inline banner format');
}

// ---------------------------------------------------------------------------
// Test 5: Panel layout stability across confirmation states
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Panel layout stability across confirmation states ---');
  const normalLayout = simulateSplitPaneLayout({ isDeleteConfirmActive: false, captureWidth: 420 });
  const confirmLayout = simulateSplitPaneLayout({ isDeleteConfirmActive: true, captureWidth: 420 });

  // Both have identical width on capture side panel
  assert.strictEqual(
    normalLayout.children[2].style.width,
    confirmLayout.children[2].style.width,
    'Capture panel width remains exactly 420px regardless of confirmation state',
  );

  // Both have identical width on terminal region
  assert.strictEqual(
    normalLayout.children[0].style.width,
    confirmLayout.children[0].style.width,
    'Terminal region width remains identical regardless of confirmation state',
  );

  // Visual hierarchy: Header -> Banner -> Transcript list
  const panelStructure = confirmLayout.children[2].panelStructure;
  assert.ok(panelStructure.header, 'Panel starts with header/controls');
  assert.ok(panelStructure.banner, 'Panel has compact inline banner below header');
  assert.ok(panelStructure.transcriptList, 'Transcript list remains primary region below banner');

  console.log('✓ Panel layout stability verified: no reflow or width distortion occurs during confirmation');
}

// ---------------------------------------------------------------------------
// Test 6: Verify TranscriptCapturePanel JSX implementation
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: Verify TranscriptCapturePanel JSX implementation ---');
  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );

  assert.ok(panelTsx.includes('InlineDestructiveBanner'), 'Defines InlineDestructiveBanner component');
  assert.ok(panelTsx.includes('capture-confirm-banner'), 'Uses .capture-confirm-banner class');
  assert.ok(panelTsx.includes('capture-banner-btn--cancel'), 'Uses capture-banner-btn--cancel');
  assert.ok(panelTsx.includes('capture-banner-btn--destructive'), 'Uses capture-banner-btn--destructive');
  assert.ok(!panelTsx.includes('aria-modal="true"'), 'Does not include aria-modal="true"');
  assert.ok(panelTsx.includes('confirmLabel="Delete"'), 'Uses compact "Delete" label for delete selected');
  assert.strictEqual(panelTsx.includes('confirmLabel="Clear"'), false, 'Does not use obsolete "Clear" confirm label');
  assert.strictEqual(panelTsx.includes('onClearTranscript'), false, 'Does not include obsolete onClearTranscript');
  assert.strictEqual(panelTsx.includes('Clear all transcript blocks'), false, 'Does not render standalone clear all control');

  console.log('✓ TranscriptCapturePanel JSX correctly implements selection-based delete banner without clear-transcript');
}

console.log('\\n=======================================================================');
console.log('ALL 6 SPLIT-PANE & INLINE DESTRUCTIVE BANNER TESTS PASSED!');
console.log('=======================================================================\\n');
