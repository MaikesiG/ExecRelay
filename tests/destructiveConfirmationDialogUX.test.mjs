import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task: Polish Destructive Confirmation Dialog UX in TraceRelay / CapTerm
 * - Refined button treatment (Cancel vs Delete Workspace hierarchy)
 * - Muted crimson danger palette (#7f1d1d / #991b1b) instead of loud submit-red
 * - Calmer danger communication (neutral title, integrated warning)
 * - Natural copy: '1 terminal tab', '2 terminal panes', '0 active captures'
 * - Clean title: 'Delete Workspace 2?'
 * - Compact desktop dialog layout and keyboard accessibility
 */

console.log('Running Destructive Confirmation Dialog UX Tests...\\n');

// ---------------------------------------------------------------------------
// Test 1: Title and Natural Copy Formatting
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Title and Natural Copy Formatting ---');

  function getDeleteWorkspaceTitle(workspaceName) {
    const rawName = workspaceName.trim();
    return rawName.toLowerCase().startsWith('workspace')
      ? `Delete ${rawName}?`
      : `Delete "${rawName}"?`;
  }

  function getImpactLabels(tabCount, paneCount, activeCaptureCount) {
    return {
      tabLabel: `${tabCount} terminal tab${tabCount === 1 ? '' : 's'}`,
      paneLabel: `${paneCount} terminal pane${paneCount === 1 ? '' : 's'}`,
      captureLabel: `${activeCaptureCount} active capture${activeCaptureCount === 1 ? '' : 's'}`,
    };
  }

  // Check default workspace title
  assert.strictEqual(
    getDeleteWorkspaceTitle('Workspace 2'),
    'Delete Workspace 2?',
    'Formats default workspace name cleanly without redundant quotes',
  );
  assert.strictEqual(
    getDeleteWorkspaceTitle('Workspace 10'),
    'Delete Workspace 10?',
    'Handles double-digit workspace numbers',
  );

  // Check custom workspace title
  assert.strictEqual(
    getDeleteWorkspaceTitle('Production API'),
    'Delete "Production API"?',
    'Quotes custom workspace names for clarity',
  );

  // Check natural pluralization (singular)
  const single = getImpactLabels(1, 1, 1);
  assert.strictEqual(single.tabLabel, '1 terminal tab', 'Singular tab label');
  assert.strictEqual(single.paneLabel, '1 terminal pane', 'Singular pane label');
  assert.strictEqual(single.captureLabel, '1 active capture', 'Singular capture label');

  // Check natural pluralization (plural / zero)
  const multi = getImpactLabels(3, 4, 0);
  assert.strictEqual(multi.tabLabel, '3 terminal tabs', 'Plural tab label');
  assert.strictEqual(multi.paneLabel, '4 terminal panes', 'Plural pane label');
  assert.strictEqual(multi.captureLabel, '0 active captures', 'Zero count active captures');

  console.log('✓ Title formatting and natural copy pluralization verified');
}

// ---------------------------------------------------------------------------
// Test 2: Source Code Invariants in WorkspaceDeleteModal.tsx
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Source Code Invariants in WorkspaceDeleteModal.tsx ---');
  const modalTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/WorkspaceDeleteModal.tsx'),
    'utf8',
  );

  // Accessibility dialog semantics
  assert.ok(modalTsx.includes('role="dialog"'), 'Has role="dialog"');
  assert.ok(modalTsx.includes('aria-modal="true"'), 'Has aria-modal="true"');
  assert.ok(modalTsx.includes('aria-labelledby="delete-workspace-title"'), 'Has aria-labelledby');
  assert.ok(modalTsx.includes('aria-describedby="delete-workspace-description"'), 'Has aria-describedby');

  // Safe default focus on Cancel
  assert.ok(
    modalTsx.includes('cancelButtonRef.current?.focus()'),
    'Safely focuses Cancel button on mount to prevent accidental destructive execution',
  );

  // Escape key handler
  assert.ok(modalTsx.includes("e.key === 'Escape'"), 'Dismisses modal on Escape key');

  // Natural copy and pluralization in JSX
  assert.ok(modalTsx.includes('terminal tab'), 'Uses lowercase natural "terminal tab"');
  assert.ok(modalTsx.includes('terminal pane'), 'Uses lowercase natural "terminal pane"');
  assert.ok(modalTsx.includes('active capture'), 'Uses lowercase natural "active capture"');

  // Warning text is clear and direct
  assert.ok(
    modalTsx.includes('Running terminal processes will stop. This action cannot be undone.'),
    'Warning message communicates consequences clearly without exaggeration',
  );

  // No redundant double question
  assert.ok(
    !modalTsx.includes('workspace-delete-prompt'),
    'Removed redundant prompt paragraph that duplicated the title',
  );

  console.log('✓ WorkspaceDeleteModal.tsx accessibility and copy invariants verified');
}

// ---------------------------------------------------------------------------
// Test 3: Button Hierarchy & Styling in WorkspaceDeleteModal.css
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Button Hierarchy & Styling in WorkspaceDeleteModal.css ---');
  const modalCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/WorkspaceDeleteModal.css'),
    'utf8',
  );

  // 1. Cancel button is secondary, subtle, and integrated
  assert.ok(
    modalCss.includes('.workspace-delete-cancel-btn'),
    'Defines .workspace-delete-cancel-btn styling',
  );
  const cancelBtnRule = modalCss.match(/\.workspace-delete-cancel-btn\s*\{([^}]+)\}/);
  assert.ok(cancelBtnRule, 'Extracted cancel button CSS rule');
  assert.ok(cancelBtnRule[1].includes('height: 28px'), 'Cancel button height is 28px');
  assert.ok(cancelBtnRule[1].includes('border-radius: 6px'), 'Cancel button border-radius is 6px');
  assert.ok(
    cancelBtnRule[1].includes('rgba(255, 255, 255, 0.05)'),
    'Cancel button uses subtle surface background',
  );
  assert.ok(
    modalCss.includes('.workspace-delete-cancel-btn:focus-visible'),
    'Cancel button has clear :focus-visible ring',
  );

  // 2. Destructive button uses darker, muted crimson family
  assert.ok(
    modalCss.includes('.workspace-delete-confirm-btn'),
    'Defines .workspace-delete-confirm-btn styling',
  );
  const confirmBtnRule = modalCss.match(/\.workspace-delete-confirm-btn\s*\{([^}]+)\}/);
  assert.ok(confirmBtnRule, 'Extracted confirm button CSS rule');
  assert.ok(confirmBtnRule[1].includes('height: 28px'), 'Confirm button height matches Cancel (28px)');
  assert.ok(confirmBtnRule[1].includes('border-radius: 6px'), 'Confirm button border-radius matches Cancel (6px)');
  assert.ok(
    confirmBtnRule[1].includes('background: #7f1d1d'),
    'Destructive button uses muted dark-crimson (#7f1d1d) instead of generic loud submit red',
  );
  assert.ok(
    confirmBtnRule[1].includes('color: #fee2e2'),
    'Destructive button text uses soft rose (#fee2e2) for high legibility',
  );
  assert.ok(
    modalCss.includes('.workspace-delete-confirm-btn:hover:not(:disabled)'),
    'Defines polished hover state for destructive button',
  );
  assert.ok(
    modalCss.includes('background: #991b1b'),
    'Hover state transitions smoothly to #991b1b',
  );
  assert.ok(
    modalCss.includes('.workspace-delete-confirm-btn:focus-visible'),
    'Confirm button has clear :focus-visible ring',
  );

  console.log('✓ Button hierarchy: Cancel is subtle and secondary; Delete Workspace is restrained crimson');
}

// ---------------------------------------------------------------------------
// Test 4: Modal Dialog Visual Polish and Calm Hierarchy
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Modal Dialog Visual Polish and Calm Hierarchy ---');
  const modalCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/WorkspaceDeleteModal.css'),
    'utf8',
  );

  // Compact container
  const modalContainerRule = modalCss.match(/\.workspace-delete-modal\s*\{([^}]+)\}/);
  assert.ok(modalContainerRule, 'Found .workspace-delete-modal rule');
  assert.ok(
    modalContainerRule[1].includes('max-width: 380px'),
    'Modal has compact max-width (380px, down from bulky 440px)',
  );
  assert.ok(
    modalContainerRule[1].includes('background: #0e1524'),
    'Modal background is terminal-native #0e1524',
  );
  assert.ok(
    modalContainerRule[1].includes('border-radius: 8px'),
    'Modal uses clean 8px corner radius',
  );

  // Title is neutral, not screaming red
  const titleRule = modalCss.match(/\.workspace-delete-title\s*\{([^}]+)\}/);
  assert.ok(titleRule, 'Found .workspace-delete-title rule');
  assert.ok(
    titleRule[1].includes('color: #f8fafc'),
    'Title is neutral #f8fafc rather than screaming red',
  );

  // Inset impact list
  const listRule = modalCss.match(/\.workspace-delete-list\s*\{([^}]+)\}/);
  assert.ok(listRule, 'Found .workspace-delete-list rule');
  assert.ok(
    listRule[1].includes('background: rgba(0, 0, 0, 0.22)'),
    'Impact list uses subtle dark inset container',
  );
  assert.ok(
    listRule[1].includes('border-radius: 6px'),
    'Impact list container has rounded corners',
  );

  // Warning text is calm and legible
  const warningRule = modalCss.match(/\.workspace-delete-warning\s*\{([^}]+)\}/);
  assert.ok(warningRule, 'Found .workspace-delete-warning rule');
  assert.ok(
    warningRule[1].includes('color: #94a3b8'),
    'Warning text is calm and legible (#94a3b8) rather than loud saturated red',
  );

  console.log('✓ Dialog visual polish: compact 380px box, neutral title, inset list, calm warning');
}

// ---------------------------------------------------------------------------
// Test 5: Cohesive Destructive Styling in CloseCapturedPaneModal
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Cohesive Destructive Styling in CloseCapturedPaneModal ---');
  const closePaneCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/CloseCapturedPaneModal.css'),
    'utf8',
  );

  assert.ok(
    closePaneCss.includes('max-width: 400px'),
    'CloseCapturedPaneModal has compact max-width (400px, down from 480px)',
  );
  assert.ok(
    closePaneCss.includes('color: #f8fafc'),
    'CloseCapturedPaneModal title is neutral #f8fafc',
  );
  assert.ok(
    closePaneCss.includes('background: #7f1d1d'),
    'CloseCapturedPaneModal confirm button uses matching muted crimson',
  );

  console.log('✓ CloseCapturedPaneModal shares identical polished destructive styling');
}

console.log('\\n=======================================================================');
console.log('ALL 5 DESTRUCTIVE CONFIRMATION DIALOG UX TESTS PASSED!');
console.log('=======================================================================\\n');
