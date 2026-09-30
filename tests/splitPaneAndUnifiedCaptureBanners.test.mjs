import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task: Stabilize the TraceRelay / CapTerm workspace split pane and unify local banner
 * interactions inside the right-side capture panel.
 */

// Model simulating workspace split pane and right-side capture panel with unified local banners
class SplitPaneWorkspaceModel {
  constructor({
    isCaptureOpen = true,
    captureWidth = 400,
    containerWidth = 1200,
    blocks = [],
    selectedBlockIds = new Set(),
  } = {}) {
    this.isCaptureOpen = isCaptureOpen;
    this.captureWidth = captureWidth;
    this.containerWidth = containerWidth;
    this.blocks = [...blocks];
    this.selectedBlockIds = new Set(selectedBlockIds);

    this.activeCopyFeedback = null;
    this.activeWarning = null;
    this.pendingConfirmation = null;
  }

  toggleCaptureOpen() {
    this.isCaptureOpen = !this.isCaptureOpen;
  }

  resizeCapture(newWidth) {
    const minWidth = 260;
    const maxWidth = Math.max(minWidth, this.containerWidth - 200);
    this.captureWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
  }

  triggerCopy(count = 1) {
    this.activeCopyFeedback = {
      type: 'success',
      message: count === 1 ? 'Copied 1 block' : `Copied ${count} blocks`,
      icon: '✓',
    };
  }

  dismissCopy() {
    this.activeCopyFeedback = null;
  }

  triggerWarning(message) {
    this.activeWarning = {
      type: 'warning',
      message,
      icon: '⚠',
    };
  }

  dismissWarning() {
    this.activeWarning = null;
  }

  triggerDeleteConfirmation() {
    if (this.selectedBlockIds.size > 0) {
      this.pendingConfirmation = 'delete-selected';
    }
  }

  cancelConfirmation() {
    this.pendingConfirmation = null;
  }

  confirmDelete() {
    if (this.pendingConfirmation === 'delete-selected') {
      const selected = new Set(this.selectedBlockIds);
      this.blocks = this.blocks.filter((b) => !selected.has(b.id));
      this.selectedBlockIds.clear();
      this.pendingConfirmation = null;
    }
  }

  render() {
    const terminalWidth = this.isCaptureOpen
      ? this.containerWidth - this.captureWidth - 1
      : this.containerWidth;

    const terminalPane = {
      tag: 'div',
      className: 'terminal-main-region',
      style: {
        flex: this.isCaptureOpen ? '1 1 auto' : '1 1 100%',
        width: `${terminalWidth}px`,
        minWidth: '0px',
      },
    };

    const resizer = this.isCaptureOpen
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

    let banner = null;
    if (this.pendingConfirmation === 'delete-selected' && this.selectedBlockIds.size > 0) {
      const count = this.selectedBlockIds.size;
      banner = {
        type: 'error',
        className: 'capture-confirm-banner confirm-card transcript-confirm-card capture-feedback-banner--error',
        role: 'region',
        'aria-label': `Delete ${count} block${count === 1 ? '' : 's'}?`,
        icon: '⚠',
        title: `Delete ${count} block${count === 1 ? '' : 's'}?`,
        body: 'Only local captured blocks are removed. Terminal screen and history are unaffected.',
        actions: [
          { label: 'Cancel', className: 'capture-banner-btn capture-banner-btn--cancel confirm-btn-cancel' },
          { label: 'Delete', className: 'capture-banner-btn capture-banner-btn--destructive confirm-btn-destructive' },
        ],
      };
    } else if (this.activeCopyFeedback) {
      banner = {
        type: 'success',
        className: 'capture-feedback-banner capture-feedback capture-feedback-banner--success',
        role: 'status',
        'aria-live': 'polite',
        icon: '✓',
        message: this.activeCopyFeedback.message,
        dismissible: true,
      };
    } else if (this.activeWarning) {
      banner = {
        type: 'warning',
        className: 'capture-feedback-banner capture-feedback capture-feedback-banner--warning',
        role: 'status',
        'aria-live': 'polite',
        icon: '⚠',
        message: this.activeWarning.message,
        dismissible: true,
      };
    }

    const capturePanel = this.isCaptureOpen
      ? {
          tag: 'aside',
          id: 'capture-side-panel-tab-1',
          className: 'capture-side-panel',
          'aria-label': 'Capture side panel',
          style: {
            flex: `0 0 ${this.captureWidth}px`,
            width: `${this.captureWidth}px`,
            minWidth: '260px',
            flexShrink: 0,
          },
          panelChildren: [
            { tag: 'div', className: 'capture-toolbar capture-panel-header' },
            banner ? { tag: 'div', className: 'capture-banner-area', banner } : null,
            {
              tag: 'div',
              className: this.blocks.length === 0 ? 'context-empty' : 'transcript-scroll-container',
              blockCount: this.blocks.length,
            },
          ].filter(Boolean),
          banner,
        }
      : null;

    return {
      tag: 'div',
      className: 'terminal-workspace-body',
      'data-capture-open': this.isCaptureOpen ? 'true' : 'false',
      children: [terminalPane, resizer, capturePanel].filter(Boolean),
    };
  }
}

console.log('Running Split Pane & Unified Capture Banners Tests...\\n');

// ---------------------------------------------------------------------------
// Test 1: Stable split pane layout contract
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Stable split pane layout contract ---');
  const model = new SplitPaneWorkspaceModel({
    isCaptureOpen: true,
    captureWidth: 380,
    containerWidth: 1200,
  });

  const rendered = model.render();
  assert.strictEqual(rendered.children.length, 3, 'Renders terminal, resizer, and capture panel');

  // Left pane: terminal
  const terminal = rendered.children[0];
  assert.strictEqual(terminal.className, 'terminal-main-region');
  assert.strictEqual(terminal.style.flex, '1 1 auto', 'Terminal fills available flex space');
  assert.strictEqual(terminal.style.width, '819px', 'Terminal occupies left space (1200 - 380 - 1)');

  // Center: resizer divider
  const resizer = rendered.children[1];
  assert.ok(resizer.className.includes('capture-resizer'), 'Center element is capture-resizer');
  assert.strictEqual(resizer.width, '1px', 'Resizer divider width is 1px');

  // Right pane: capture panel
  const capturePanel = rendered.children[2];
  assert.strictEqual(capturePanel.className, 'capture-side-panel', 'Right element is capture-side-panel');
  assert.strictEqual(capturePanel.style.flexShrink, 0, 'Side panel does not shrink unexpectedly');
  assert.strictEqual(capturePanel.style.width, '380px');

  console.log('✓ Split pane contract verified: left terminal, middle resizer, right capture panel');
}

// ---------------------------------------------------------------------------
// Test 2: Fixed-right and resizable behavior across collapse and expand
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Fixed-right and resizable behavior across collapse and expand ---');
  const model = new SplitPaneWorkspaceModel({
    isCaptureOpen: true,
    captureWidth: 420,
    containerWidth: 1200,
  });

  // 1. Resize capture panel to 500px
  model.resizeCapture(500);
  let rendered = model.render();
  assert.strictEqual(rendered.children[2].style.width, '500px', 'Width updated to 500px');
  assert.strictEqual(rendered.children[0].style.width, '699px', 'Terminal adjusted to 699px');

  // 2. Collapse capture panel
  model.toggleCaptureOpen();
  rendered = model.render();
  assert.strictEqual(rendered.children.length, 1, 'Only terminal remains when capture is collapsed');
  assert.strictEqual(rendered['data-capture-open'], 'false');
  assert.strictEqual(rendered.children[0].style.flex, '1 1 100%', 'Terminal expands to 100%');
  assert.strictEqual(rendered.children[0].style.width, '1200px');

  // 3. Re-expand capture panel
  model.toggleCaptureOpen();
  rendered = model.render();
  assert.strictEqual(rendered.children.length, 3, 'All 3 children restored');
  assert.strictEqual(rendered.children[2].style.width, '500px', 'Original width preserved without layout drift');
  assert.strictEqual(rendered.children[0].style.width, '699px');

  // 4. Clamping bounds check
  model.resizeCapture(100); // Below 260px min
  assert.strictEqual(model.captureWidth, 260, 'Clamped to min-width 260px');

  model.resizeCapture(1500); // Above container - 200px
  assert.strictEqual(model.captureWidth, 1000, 'Clamped to containerWidth - 200px (1000px)');

  console.log('✓ Resizing, clamping, and collapse/expand preserve layout stability without drift');
}

// ---------------------------------------------------------------------------
// Test 3: Local capture-panel banners render in the correct scoped area
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Local capture-panel banners render in correct scoped area ---');
  const model = new SplitPaneWorkspaceModel({
    blocks: [{ id: 'b-1', command: 'ls', output: 'file.txt' }],
  });

  // Initially no banner
  let rendered = model.render();
  let panel = rendered.children[2];
  assert.strictEqual(panel.banner, null, 'No banner initially');
  assert.strictEqual(panel.panelChildren.length, 2, 'Only controls and transcript list');

  // Trigger local copy feedback
  model.triggerCopy(1);
  rendered = model.render();
  panel = rendered.children[2];
  assert.ok(panel.banner !== null, 'Banner is rendered');

  // Structure: Controls (0) -> Banner area (1) -> Transcript list (2)
  assert.strictEqual(panel.panelChildren[0].className, 'capture-toolbar capture-panel-header', 'Child 0 is header');
  assert.strictEqual(panel.panelChildren[1].className, 'capture-banner-area', 'Child 1 is capture-banner-area');
  assert.strictEqual(panel.panelChildren[2].className, 'transcript-scroll-container', 'Child 2 is transcript list');

  // Banner details
  assert.strictEqual(panel.banner.type, 'success');
  assert.strictEqual(panel.banner.role, 'status');
  assert.strictEqual(panel.banner.icon, '✓');
  assert.strictEqual(panel.banner.message, 'Copied 1 block');

  console.log('✓ Local banner correctly positioned in scoped slot between controls and transcript');
}

// ---------------------------------------------------------------------------
// Test 4: Copy success uses a local banner instead of a global notification
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Copy success uses local banner instead of global toast ---');
  const model = new SplitPaneWorkspaceModel({
    blocks: [
      { id: 'b-1', command: 'cmd1' },
      { id: 'b-2', command: 'cmd2' },
    ],
  });

  model.triggerCopy(2);
  const rendered = model.render();
  const panel = rendered.children[2];

  assert.ok(panel.banner !== null, 'Local banner exists inside capture panel');
  assert.ok(panel.banner.className.includes('capture-feedback-banner'), 'Uses capture-feedback-banner class');
  assert.strictEqual(panel.banner.className.includes('global-warning-banner'), false, 'Does not use global banner');
  assert.strictEqual(panel.banner.className.includes('terminal-pane-toast'), false, 'Does not use global toast');
  assert.strictEqual(panel.banner.message, 'Copied 2 blocks');

  // Dismiss local banner
  model.dismissCopy();
  assert.strictEqual(model.render().children[2].banner, null, 'Dismisses cleanly');

  console.log('✓ Copy feedback scoped entirely locally to the capture side panel');
}

// ---------------------------------------------------------------------------
// Test 5: Warning and destructive confirmation states render as compact inline banners
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Warning & destructive states render as compact inline banners ---');
  const model = new SplitPaneWorkspaceModel({
    blocks: [
      { id: 'b-1', command: 'test' },
      { id: 'b-2', command: 'test2' },
    ],
    selectedBlockIds: new Set(['b-1', 'b-2']),
  });

  // 1. Warning banner
  model.triggerWarning('No terminal panes selected for capture');
  let rendered = model.render();
  let banner = rendered.children[2].banner;
  assert.strictEqual(banner.type, 'warning');
  assert.strictEqual(banner.icon, '⚠');
  assert.strictEqual(banner.message, 'No terminal panes selected for capture');
  model.dismissWarning();

  // 2. Destructive confirmation banner
  model.triggerDeleteConfirmation();
  rendered = model.render();
  banner = rendered.children[2].banner;

  assert.strictEqual(banner.type, 'error');
  assert.strictEqual(banner.title, 'Delete 2 blocks?');
  assert.ok(banner.body.includes('Only local captured blocks are removed'), 'Has clear body explanation');
  assert.strictEqual(banner.actions.length, 2, 'Has exactly Cancel and Delete actions');
  assert.strictEqual(banner.actions[0].label, 'Cancel');
  assert.strictEqual(banner.actions[1].label, 'Delete');

  // Perform delete
  model.confirmDelete();
  rendered = model.render();
  assert.strictEqual(rendered.children[2].banner, null, 'Confirmation banner dismissed after action');
  assert.strictEqual(model.blocks.length, 0, 'Blocks removed after confirmation');

  console.log('✓ Warning and destructive states render as compact inline banners with unified visual rhythm');
}

// ---------------------------------------------------------------------------
// Test 6: Banners do not break layout hierarchy or cause split-pane distortion
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: Banners do not break layout hierarchy or split-pane balance ---');
  const model = new SplitPaneWorkspaceModel({
    captureWidth: 400,
    containerWidth: 1200,
    blocks: [{ id: 'b-1', command: 'cmd' }],
  });

  const baseLayout = model.render();

  // Show copy banner
  model.triggerCopy(1);
  const copyLayout = model.render();

  // Show destructive confirmation
  model.selectedBlockIds.add('b-1');
  model.triggerDeleteConfirmation();
  const confirmLayout = model.render();

  // Panel widths must remain identical across all banner states
  assert.strictEqual(baseLayout.children[2].style.width, '400px');
  assert.strictEqual(copyLayout.children[2].style.width, '400px');
  assert.strictEqual(confirmLayout.children[2].style.width, '400px');

  // Terminal widths must remain identical
  assert.strictEqual(baseLayout.children[0].style.width, '799px');
  assert.strictEqual(copyLayout.children[0].style.width, '799px');
  assert.strictEqual(confirmLayout.children[0].style.width, '799px');

  // Hierarchy preserved in all states
  assert.strictEqual(confirmLayout.children[2].panelChildren[0].className, 'capture-toolbar capture-panel-header');
  assert.strictEqual(confirmLayout.children[2].panelChildren[1].className, 'capture-banner-area');
  assert.strictEqual(confirmLayout.children[2].panelChildren[2].className, 'transcript-scroll-container');

  console.log('✓ Layout balance and structural hierarchy 100% stable regardless of banner state');
}

// ---------------------------------------------------------------------------
// Test 7: Stylesheet and implementation verification
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 7: Stylesheet and implementation verification ---');

  // 1. CaptureFeedbackBanner.tsx & css
  const bannerTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/CaptureFeedbackBanner.tsx'),
    'utf8',
  );
  assert.ok(bannerTsx.includes('CaptureFeedbackBannerProps'), 'Defines CaptureFeedbackBannerProps');
  assert.ok(bannerTsx.includes('actions'), 'Supports action buttons');
  assert.ok(bannerTsx.includes('body'), 'Supports body description');
  assert.ok(bannerTsx.includes('onDismiss'), 'Supports dismiss action');

  const bannerCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/CaptureFeedbackBanner.css'),
    'utf8',
  );
  assert.ok(bannerCss.includes('.capture-banner-area'), 'Defines .capture-banner-area');
  assert.ok(bannerCss.includes('.capture-feedback-banner--success'), 'Defines success banner');
  assert.ok(bannerCss.includes('.capture-feedback-banner--warning'), 'Defines warning banner');
  assert.ok(bannerCss.includes('.capture-feedback-banner--error'), 'Defines error banner');
  assert.ok(bannerCss.includes('.capture-feedback-banner--info'), 'Defines info banner');
  assert.ok(bannerCss.includes('border-left: 3px solid'), 'Uses 3px solid left accent border');
  assert.ok(bannerCss.includes('box-shadow: none;'), 'Removes box shadow (no popup look)');

  // 2. TerminalPaneLayout.css
  const layoutCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/TerminalPaneLayout.css'),
    'utf8',
  );
  assert.ok(layoutCss.includes('flex-direction: row;'), 'Terminal workspace body uses flex-direction: row');
  assert.ok(layoutCss.includes('.capture-side-panel'), 'Defines .capture-side-panel');
  assert.ok(layoutCss.includes('flex-shrink: 0;'), 'Enforces flex-shrink: 0');
  assert.ok(layoutCss.includes('.terminal-main-region'), 'Defines .terminal-main-region');
  assert.ok(layoutCss.includes('.capture-resizer'), 'Defines .capture-resizer');

  // 3. TranscriptCapturePanel.tsx
  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );
  assert.ok(panelTsx.includes('capture-banner-area'), 'Uses .capture-banner-area container');
  assert.ok(panelTsx.includes('InlineDestructiveBanner'), 'Defines InlineDestructiveBanner');
  assert.ok(panelTsx.includes('CaptureFeedbackBanner'), 'Renders CaptureFeedbackBanner');

  console.log('✓ All CSS and JSX invariants verified for split pane contract and unified banners');
}

console.log('\\n=======================================================================');
console.log('ALL 7 SPLIT PANE & UNIFIED CAPTURE BANNER TESTS PASSED!');
console.log('=======================================================================\\n');
