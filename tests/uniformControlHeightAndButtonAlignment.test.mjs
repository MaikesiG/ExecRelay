/**
 * TERMINAL-V01-UI-POLISH-004 & TERMINAL-V01-UI-POLISH-005
 * Enforce Uniform Control Height (28px), Compact Codex-Like Density & Icon-Only Profile Actions
 *
 * Regression test suite verifying:
 * 1. Canonical tokens: --monitor-control-height: 28px; --monitor-icon-button-size: 28px;
 *    --monitor-control-icon-size: 14px; --monitor-control-radius: 6px; defined in :root.
 * 2. Uniform 28px height across management / monitor action controls:
 *    - Capture: Clear, Copy, Create Prompt, Capture actions (Start, Pause, Resume, Stop)
 *    - Changes: Copy paths, Copy changes, Copy commit, Open in Finder, Refresh, Open Folder
 *    - Verify: Edit (icon-only), + New (icon-only), Run, Stop, Cancel, Continue, + Add Check, Run Selected, View execution, Show/Hide baseline
 * 3. Full-width buttons (Run Selected, Continue, + Add Check) are strictly 28px (not taller).
 * 4. Flex centering & vertical alignment:
 *    - display: inline-flex; align-items: center; justify-content: center; line-height: 1;
 *    - padding-block: 0; (vertical centering from flex, not font-metric padding)
 *    - box-sizing: border-box;
 * 5. Icon-only buttons are square at 28px × 28px (Copy commit, Open in Finder, Refresh, icon-btn, info-btn, profile-btn).
 * 6. Select controls (Profile select) use the same 28px control height and align with buttons.
 * 7. Profile row actions: Edit & + New are icon-only buttons with tooltips and accessible names.
 * 8. Horizontal rows align on a shared vertical center line (align-items: center).
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
const verifCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.css'),
  'utf8',
);
const verifTsx = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.tsx'),
  'utf8',
);
const repoCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/RepositoryEvidenceView.css'),
  'utf8',
);
const footerCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/monitor/MonitorFooter.css'),
  'utf8',
);
const attrCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/attribution/ChangeAttributionView.css'),
  'utf8',
);
const verifModalCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/verification/VerificationModals.css'),
  'utf8',
);
const wsTabsTsx = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.tsx'),
  'utf8',
);
const wsTabsCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.css'),
  'utf8',
);
const paneHeaderTsx = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/TerminalPaneHeader.tsx'),
  'utf8',
);
const editionConfigTs = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/edition/editionConfig.ts'),
  'utf8',
);
const repoViewTsx = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/RepositoryEvidenceView.tsx'),
  'utf8',
);

console.log('Running Compact Control Height (28px) & Button Alignment Regression Tests...\\n');

// ============================================================================
// Test 1: Shared Monitor Design Tokens
// ============================================================================
console.log('--- Test 1: Shared Monitor Design Tokens in App.css ---');
{
  assert.ok(
    appCss.includes('--monitor-control-height: 28px;'),
    'App.css must declare canonical --monitor-control-height: 28px in :root',
  );
  assert.ok(
    appCss.includes('--monitor-icon-button-size: 28px;'),
    'App.css must declare canonical --monitor-icon-button-size: 28px in :root',
  );
  assert.ok(
    appCss.includes('--monitor-control-icon-size: 14px;'),
    'App.css must declare canonical --monitor-control-icon-size: 14px in :root',
  );
  assert.ok(
    appCss.includes('--monitor-control-radius: 6px;'),
    'App.css must declare canonical --monitor-control-radius: 6px in :root',
  );
  assert.ok(
    appCss.includes('--monitor-control-gap: 6px;'),
    'App.css must declare --monitor-control-gap: 6px in :root',
  );
  assert.ok(
    appCss.includes('--monitor-section-gap: 8px;'),
    'App.css must declare --monitor-section-gap: 8px in :root',
  );
  console.log('✓ Canonical 28px control height and compact tokens defined');
}

// ============================================================================
// Test 2: Verify Management Controls (VerificationPanel.css & ChangeAttributionView.css)
// ============================================================================
console.log('\\n--- Test 2: Verify Action Controls Sizing & Alignment ---');
{
  // 1. Profile select
  assert.ok(
    verifCss.includes('.verification-profile-select {') &&
    verifCss.includes('height: var(--monitor-control-height, 28px);'),
    'verification-profile-select must use --monitor-control-height: 28px',
  );
  assert.ok(
    verifCss.includes('.verification-profile-select {') &&
    verifCss.includes('padding-block: 0;'),
    'verification-profile-select must use padding-block: 0;',
  );

  // 2. Profile buttons: Edit, + New as compact 28px × 28px icon buttons
  assert.ok(
    verifCss.includes('.verification-profile-btn {') &&
    verifCss.includes('width: var(--monitor-icon-button-size, 28px);') &&
    verifCss.includes('height: var(--monitor-icon-button-size, 28px);'),
    'verification-profile-btn must use --monitor-icon-button-size: 28px',
  );
  assert.ok(
    verifCss.includes('.verification-profile-btn {') &&
    verifCss.includes('display: inline-flex;') &&
    verifCss.includes('align-items: center;') &&
    verifCss.includes('justify-content: center;'),
    'verification-profile-btn must use flex centering',
  );

  // Profile Action Buttons are Icon-Only (ADDITIONAL UI REQUIREMENT)
  assert.ok(
    verifTsx.includes('title="Edit verification profile"') &&
    verifTsx.includes('aria-label="Edit verification profile"'),
    'Edit profile button must have tooltip and aria-label "Edit verification profile"',
  );
  assert.ok(
    verifTsx.includes('title="Create verification profile"') &&
    verifTsx.includes('aria-label="Create verification profile"'),
    'Create profile button must have tooltip and aria-label "Create verification profile"',
  );
  assert.ok(
    !verifTsx.includes('>Edit</button>') && !verifTsx.includes('>+ New</button>'),
    'Profile action buttons must not contain visible text labels Edit or + New',
  );

  // 3. Per-check Run button
  assert.ok(
    verifCss.includes('.verification-single-run-btn {') &&
    verifCss.includes('height: var(--monitor-control-height, 28px);'),
    'verification-single-run-btn must use --monitor-control-height: 28px',
  );
  assert.ok(
    verifCss.includes('.verification-single-run-btn {') &&
    verifCss.includes('padding-block: 0;'),
    'verification-single-run-btn must use padding-block: 0;',
  );

  // 4. + Add Check button
  assert.ok(
    verifCss.includes('.verification-add-check-btn {') &&
    verifCss.includes('height: var(--monitor-control-height, 28px);'),
    'verification-add-check-btn must use --monitor-control-height: 28px',
  );
  assert.ok(
    verifCss.includes('.verification-add-check-btn {') &&
    verifCss.includes('padding-block: 0;'),
    'verification-add-check-btn must use padding-block: 0;',
  );

  // 5. Run Selected button (Full-width is NOT taller)
  assert.ok(
    verifCss.includes('.verification-run-btn {') &&
    verifCss.includes('height: var(--monitor-control-height, 28px);'),
    'verification-run-btn (Run Selected) must use --monitor-control-height: 28px',
  );
  assert.ok(
    verifCss.includes('.verification-run-btn {') &&
    verifCss.includes('padding-block: 0;'),
    'verification-run-btn must use padding-block: 0;',
  );

  // 6. Stop and Cancel buttons
  assert.ok(
    verifCss.includes('.verification-stop-btn {') &&
    verifCss.includes('height: var(--monitor-control-height, 28px);'),
    'verification-stop-btn must use --monitor-control-height: 28px',
  );
  assert.ok(
    verifCss.includes('.verification-cancel-btn {') &&
    verifCss.includes('height: var(--monitor-control-height, 28px);'),
    'verification-cancel-btn must use --monitor-control-height: 28px',
  );

  // 7. Continue button (Full-width is NOT taller)
  assert.ok(
    verifCss.includes('.verification-continue-btn {') &&
    verifCss.includes('height: var(--monitor-control-height, 28px);'),
    'verification-continue-btn must use --monitor-control-height: 28px',
  );
  assert.ok(
    verifCss.includes('.verification-continue-btn {') &&
    verifCss.includes('padding-block: 0;'),
    'verification-continue-btn must use padding-block: 0;',
  );

  // 8. View execution button
  assert.ok(
    verifCss.includes('.verification-view-exec-btn {') &&
    verifCss.includes('height: var(--monitor-control-height, 28px);'),
    'verification-view-exec-btn must use --monitor-control-height: 28px',
  );
  assert.ok(
    verifCss.includes('.verification-view-exec-btn {') &&
    verifCss.includes('padding-block: 0;'),
    'verification-view-exec-btn must use padding-block: 0;',
  );

  // 9. Show baseline / Hide baseline button
  assert.ok(
    attrCss.includes('.attribution-toggle-btn {') &&
    attrCss.includes('height: var(--monitor-control-height, 28px);'),
    'attribution-toggle-btn must use --monitor-control-height: 28px',
  );
  assert.ok(
    attrCss.includes('.attribution-toggle-btn {') &&
    attrCss.includes('padding-block: 0;'),
    'attribution-toggle-btn must use padding-block: 0;',
  );

  // 10. Icon-only action buttons: 28px × 28px
  assert.ok(
    verifCss.includes('.verification-icon-btn {') &&
    verifCss.includes('width: var(--monitor-icon-button-size, 28px);') &&
    verifCss.includes('height: var(--monitor-icon-button-size, 28px);'),
    'verification-icon-btn must be square 28px × 28px',
  );

  console.log('✓ Verify action controls, selects, and full-width buttons share identical 28px height');
}

// ============================================================================
// Test 3: Changes Management Controls (RepositoryEvidenceView.css)
// ============================================================================
console.log('\\n--- Test 3: Changes Action Controls Sizing & Alignment ---');
{
  // 1. Copy paths & Copy changes
  assert.ok(
    repoCss.includes('.repository-copy-paths-btn,') &&
    repoCss.includes('height: var(--monitor-icon-button-size, 28px);'),
    'repository-copy-paths-btn and copy-changes-btn must use --monitor-icon-button-size: 28px',
  );

  // 2. Icon-only actions: Copy commit, Open in Finder, Refresh
  assert.ok(
    repoCss.includes('.repository-copy-commit-btn,') &&
    repoCss.includes('width: var(--monitor-icon-button-size, 28px);') &&
    repoCss.includes('height: var(--monitor-icon-button-size, 28px);'),
    'repository-copy-commit-btn and open-finder-btn must be square 28px × 28px',
  );
  assert.ok(
    repoCss.includes('.repository-refresh-btn {') &&
    repoCss.includes('width: var(--monitor-icon-button-size, 28px);') &&
    repoCss.includes('height: var(--monitor-icon-button-size, 28px);'),
    'repository-refresh-btn must be square 28px × 28px',
  );

  // 3. Compact button system in Changes
  assert.ok(
    repoCss.includes('.compact-btn {') &&
    repoCss.includes('height: var(--monitor-control-height, 28px);'),
    'compact-btn in Changes must use --monitor-control-height: 28px',
  );
  assert.ok(
    repoCss.includes('.compact-icon-btn {') &&
    repoCss.includes('width: var(--monitor-icon-button-size, 28px);') &&
    repoCss.includes('height: var(--monitor-icon-button-size, 28px);'),
    'compact-icon-btn in Changes must be square 28px × 28px',
  );

  // 4. Open folder button (in non-git / unbound states)
  assert.ok(
    repoCss.includes('.repository-open-folder-btn {') &&
    repoCss.includes('height: var(--monitor-control-height, 28px);'),
    'repository-open-folder-btn must use --monitor-control-height: 28px',
  );

  console.log('✓ Changes action controls and icon-only buttons strictly conform to 28px height');
}

// ============================================================================
// Test 4: Capture & Monitor Footer Action Controls
// ============================================================================
console.log('\\n--- Test 4: Capture & Monitor Footer Action Controls ---');
{
  // 1. MonitorFooter buttons: Clear, Copy, Create Prompt
  assert.ok(
    footerCss.includes('.monitor-footer .compact-btn {') &&
    footerCss.includes('height: var(--monitor-control-height, 28px);'),
    'MonitorFooter compact-btn (Clear, Copy, Create Prompt) must use --monitor-control-height: 28px',
  );
  assert.ok(
    footerCss.includes('.monitor-footer .compact-btn {') &&
    footerCss.includes('padding-block: 0;'),
    'MonitorFooter compact-btn must use padding-block: 0;',
  );
  assert.ok(
    footerCss.includes('.monitor-footer-info {') &&
    footerCss.includes('align-items: center;'),
    'MonitorFooter info region must use align-items: center to align on the shared center line',
  );

  // 2. Capture panel primary actions: Start, Pause, Resume, Stop
  assert.ok(
    appCss.includes('.capture-action-btn {') &&
    appCss.includes('height: var(--monitor-control-height, 28px);'),
    'capture-action-btn must use --monitor-control-height: 28px',
  );
  assert.ok(
    appCss.includes('.capture-action-btn {') &&
    appCss.includes('padding-block: 0;'),
    'capture-action-btn must use padding-block: 0;',
  );

  // 3. Capture toggle & info buttons
  assert.ok(
    appCss.includes('.capture-toggle-btn {') &&
    appCss.includes('height: var(--monitor-control-height, 28px);'),
    'capture-toggle-btn must use --monitor-control-height: 28px',
  );
  assert.ok(
    appCss.includes('.capture-info-btn {') &&
    appCss.includes('width: var(--monitor-icon-button-size, 28px);') &&
    appCss.includes('height: var(--monitor-icon-button-size, 28px);'),
    'capture-info-btn must be square 28px × 28px',
  );

  console.log('✓ Capture controls and MonitorFooter buttons strictly conform to 28px height');
}

// ============================================================================
// Test 5: Horizontal Rows Vertical Center Line Alignment
// ============================================================================
console.log('\\n--- Test 5: Horizontal Rows Center Line Alignment ---');
{
  // 1. Verify profile row: PROFILE [Standard checks] [Edit] [+ New] [PENDING]
  assert.ok(
    verifCss.includes('.verification-header {') &&
    verifCss.includes('align-items: center;'),
    'verification-header row must use align-items: center',
  );
  assert.ok(
    verifCss.includes('.verification-header-profile-group {') &&
    verifCss.includes('align-items: center;'),
    'verification-header-profile-group must use align-items: center',
  );
  assert.ok(
    verifCss.includes('.verification-profile-actions {') &&
    verifCss.includes('align-items: center;'),
    'verification-profile-actions must use align-items: center',
  );

  // 2. Changes header metadata row: e0eb093 [copy] [open-folder] branch: dev [refresh]
  assert.ok(
    repoCss.includes('.repository-evidence-meta-row {') &&
    repoCss.includes('align-items: center;'),
    'repository-evidence-meta-row must use align-items: center',
  );
  assert.ok(
    repoCss.includes('.repository-evidence-meta-left {') &&
    repoCss.includes('align-items: center;'),
    'repository-evidence-meta-left must use align-items: center',
  );
  assert.ok(
    repoCss.includes('.repository-evidence-meta-right {') &&
    repoCss.includes('align-items: center;'),
    'repository-evidence-meta-right must use align-items: center',
  );

  // 3. MonitorFooter actions row
  assert.ok(
    footerCss.includes('.monitor-footer {') &&
    footerCss.includes('align-items: center;'),
    'monitor-footer container must use align-items: center',
  );
  assert.ok(
    footerCss.includes('.monitor-footer-actions {') &&
    footerCss.includes('align-items: center;'),
    'monitor-footer-actions must use align-items: center',
  );

  console.log('✓ All horizontal management control rows align on one shared vertical center line');
}

// ============================================================================
// Test 6: Verification Modals Control Heights
// ============================================================================
console.log('\\n--- Test 6: Verification Modals Control Heights ---');
{
  assert.ok(
    verifModalCss.includes('.verification-btn {') &&
    verifModalCss.includes('height: var(--monitor-control-height, 28px);'),
    'verification-btn in modals must use --monitor-control-height: 28px',
  );
  assert.ok(
    verifModalCss.includes('.verification-modal-close-btn {') &&
    verifModalCss.includes('height: var(--monitor-icon-button-size, 28px);'),
    'verification-modal-close-btn must use --monitor-icon-button-size: 28px',
  );
  console.log('✓ Verification modal buttons normalized to 28px control height');
}

// ============================================================================
// Test 7: Policy: Off Badge Hidden from Public Terminal Edition (A1)
// ============================================================================
console.log("\\n--- Test 7: Policy Badge Hidden from Public Edition ---");
{
  // 1. Verify editionConfig defines governance: false for public terminal edition
  assert.ok(
    editionConfigTs.includes("governance: false"),
    "Terminal edition must have governance: false",
  );
  assert.ok(
    editionConfigTs.includes("governance: true"),
    "Internal edition must have governance: true",
  );

  // 2. TerminalPaneHeader gates policy badge behind capabilities.governance
  assert.ok(
    paneHeaderTsx.includes("useProductCapabilities()") &&
    paneHeaderTsx.includes("showPolicyBadge = Boolean(capabilities.governance && policyStatus)"),
    "TerminalPaneHeader must gate policy badge behind capabilities.governance",
  );
  assert.ok(
    paneHeaderTsx.includes("{showPolicyBadge && ("),
    "Policy badge rendering must depend on showPolicyBadge",
  );

  console.log("✓ Policy: Off badge strictly hidden from public Terminal edition, visible in internal edition");
}

// ============================================================================
// Test 8: WorkspaceTabs Shortcuts & Collapse/Expand Controls (A17-A20)
// ============================================================================
console.log("\\n--- Test 8: WorkspaceTabs Shortcuts & Collapse/Expand Controls ---");
{
  // 1. Keyboard shortcuts icon button: 28px × 28px, 15px icon, tooltip & aria-label
  assert.ok(
    wsTabsCss.includes(".workspace-tab-shortcuts-btn,") &&
    wsTabsCss.includes("width: var(--monitor-icon-button-size, 28px);") &&
    wsTabsCss.includes("height: var(--monitor-icon-button-size, 28px);"),
    "workspace-tab-shortcuts-btn must be square 28px × 28px",
  );
  assert.ok(
    wsTabsTsx.includes('className="workspace-tab-shortcuts-btn"') &&
    wsTabsTsx.includes('aria-label="Keyboard shortcuts"') &&
    wsTabsTsx.includes('title="Keyboard shortcuts"'),
    "workspace-tab-shortcuts-btn must have tooltip and aria-label \"Keyboard shortcuts\"",
  );
  assert.ok(
    wsTabsTsx.includes('width="15"') && wsTabsTsx.includes('height="15"'),
    "workspace-tab-shortcuts-btn icon must be 15px",
  );

  // 2. Collapse/expand monitor pane icon button: 28px × 28px, stateful tooltips & aria-label
  assert.ok(
    wsTabsCss.includes(".workspace-tab-capture-toggle {") &&
    wsTabsCss.includes("width: var(--monitor-icon-button-size, 28px);") &&
    wsTabsCss.includes("height: var(--monitor-icon-button-size, 28px);"),
    "workspace-tab-capture-toggle must be square 28px × 28px",
  );
  assert.ok(
    wsTabsTsx.includes("isOpen ? 'Collapse monitor pane' : 'Expand monitor pane'"),
    "capture-toggle must dynamically update tooltip and aria-label to Collapse/Expand monitor pane",
  );

  // 3. Hover and focus-visible feedback
  assert.ok(
    wsTabsCss.includes(".workspace-tab-shortcuts-btn:hover,") &&
    wsTabsCss.includes(".workspace-tab-capture-toggle:hover {"),
    "Shortcut and collapse buttons must provide hover feedback",
  );
  assert.ok(
    wsTabsCss.includes(".workspace-tab-shortcuts-btn:focus-visible,") &&
    wsTabsCss.includes(".workspace-tab-capture-toggle:focus-visible {"),
    "Shortcut and collapse buttons must provide focus-visible feedback",
  );

  console.log("✓ WorkspaceTabs shortcut and collapse/expand controls strictly conform to 28px square sizing and stateful semantics");
}

// ============================================================================
// Test 9: Changes Copy Paths & Copy Changes Semantic Icon Actions (A11, A12)
// ============================================================================
console.log("\\n--- Test 9: Changes Copy Paths & Copy Changes Semantic Icon Actions ---");
{
  // 1. Copy file paths action
  assert.ok(
    repoViewTsx.includes('className="compact-icon-btn repository-copy-paths-btn"') &&
    repoViewTsx.includes('title="Copy file paths"') &&
    repoViewTsx.includes('aria-label="Copy file paths"'),
    "Copy paths must be icon button with title and aria-label \"Copy file paths\"",
  );
  // Files icon check
  assert.ok(
    repoViewTsx.includes("M15.5 2H8.6") && repoViewTsx.includes("M3 7.6v12.8"),
    "Copy file paths must use semantic Files icon",
  );

  // 2. Copy changes action
  assert.ok(
    repoViewTsx.includes('className="compact-icon-btn repository-copy-changes-btn"') &&
    repoViewTsx.includes('title="Copy changes"') &&
    repoViewTsx.includes('aria-label="Copy changes"'),
    "Copy changes must be icon button with title and aria-label \"Copy changes\"",
  );
  // FileDiff icon check
  assert.ok(
    repoViewTsx.includes("M14.5 2H6") && repoViewTsx.includes("M9 13h6") && repoViewTsx.includes("M12 10v6"),
    "Copy changes must use semantic FileDiff icon",
  );

  // 3. Sizing in CSS: square 28px × 28px with padding: 0
  assert.ok(
    repoCss.includes(".repository-copy-paths-btn,") &&
    repoCss.includes("width: var(--monitor-icon-button-size, 28px);") &&
    repoCss.includes("height: var(--monitor-icon-button-size, 28px);") &&
    repoCss.includes("padding: 0;"),
    "Copy paths and copy changes must be square 28px × 28px with padding: 0",
  );

  console.log("✓ Copy file paths and Copy changes use semantic Files/Diff icons and square 28px sizing");
}

// ============================================================================
// Test 10: Shared Monitor Control Classes & Token Layer (A25)
// ============================================================================
console.log("\\n--- Test 10: Shared Monitor Control Classes & Token Layer ---");
{
  assert.ok(
    appCss.includes(".monitor-control {") &&
    appCss.includes("height: var(--monitor-control-height, 28px);") &&
    appCss.includes("padding-block: 0;"),
    "App.css must define .monitor-control class with 28px height and padding-block: 0",
  );
  assert.ok(
    appCss.includes(".monitor-control--icon {") &&
    appCss.includes("width: var(--monitor-icon-button-size, 28px);"),
    "App.css must define .monitor-control--icon class",
  );
  assert.ok(
    appCss.includes(".monitor-control--primary {"),
    "App.css must define .monitor-control--primary class",
  );
  assert.ok(
    appCss.includes(".monitor-control--danger {"),
    "App.css must define .monitor-control--danger class",
  );
  assert.ok(
    appCss.includes(".monitor-form-group {"),
    "App.css must define .monitor-form-group class",
  );

  // Select styling with appearance: none and custom arrow
  assert.ok(
    verifCss.includes("appearance: none;") &&
    verifCss.includes("background-image: url("),
    "verification-profile-select must use appearance: none with custom SVG arrow",
  );

  console.log("✓ Shared monitor control token and class layer verified");
}

console.log('\\n=============================================================');
console.log('ALL COMPACT CONTROL & BUTTON ALIGNMENT REGRESSION TESTS PASSED!');
console.log('=============================================================\\n');
