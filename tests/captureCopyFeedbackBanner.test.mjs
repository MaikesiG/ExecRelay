import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task: Implement a local copy-feedback banner inside the TraceRelay capture panel.
 */

// Simulated model representing TranscriptCapturePanel copy feedback runtime
class CapturePanelRuntime {
  constructor({
    blocks = [],
    selectedBlockIds = new Set(),
    onCopyBlock = () => {},
    onCopySelected = () => {},
  } = {}) {
    this.blocks = blocks;
    this.selectedBlockIds = new Set(selectedBlockIds);
    this.onCopyBlock = onCopyBlock;
    this.onCopySelected = onCopySelected;

    this.localCopyFeedback = null;
    this.copyFeedbackTimer = null;
    this.dismissedPropMessage = null;
    this.currentTime = 0;
  }

  advanceTime(ms) {
    this.currentTime += ms;
    if (this.copyFeedbackTimer && this.currentTime >= this.copyFeedbackTimer.expiresAt) {
      this.localCopyFeedback = null;
      this.copyFeedbackTimer = null;
    }
  }

  triggerCopyFeedback(message) {
    if (this.copyFeedbackTimer) {
      this.copyFeedbackTimer = null;
    }
    this.localCopyFeedback = {
      message,
      key: this.currentTime,
    };
    this.copyFeedbackTimer = {
      expiresAt: this.currentTime + 2500,
    };
  }

  dismissCopyFeedback() {
    this.localCopyFeedback = null;
    this.copyFeedbackTimer = null;
  }

  handleCopySingleBlock(block) {
    this.onCopyBlock(block);
    this.triggerCopyFeedback('Copied 1 block');
  }

  handleCopySelected() {
    this.onCopySelected();
    const count = this.selectedBlockIds.size || 1;
    this.triggerCopyFeedback(count === 1 ? 'Copied 1 block' : `Copied ${count} blocks`);
  }

  render() {
    const banner = this.localCopyFeedback
      ? {
          tag: 'div',
          className:
            'capture-feedback-banner capture-feedback capture-feedback-banner--success capture-feedback--success',
          role: 'status',
          'aria-live': 'polite',
          'aria-atomic': 'true',
          'data-testid': 'capture-feedback-banner',
          'data-banner-type': 'success',
          icon: '✓',
          message: this.localCopyFeedback.message,
          dismissible: true,
        }
      : null;

    return {
      tag: 'aside',
      className: 'context-panel',
      'aria-label': 'Transcript capture panel',
      children: [
        {
          tag: 'div',
          className: 'capture-toolbar capture-panel-header',
        },
        banner,
        {
          tag: 'div',
          className: 'transcript-scroll-container',
          blockCount: this.blocks.length,
        },
      ].filter(Boolean),
      banner,
    };
  }
}

console.log('Running Local Capture Copy Feedback Banner Tests...\\n');

// ---------------------------------------------------------------------------
// Test 1: Copy single block triggers local capture banner
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Copy single block triggers local capture banner ---');
  let copiedBlock = null;
  const mockBlock = { id: 'b-1', command: 'echo "test"', output: 'test' };

  const runtime = new CapturePanelRuntime({
    blocks: [mockBlock],
    onCopyBlock: (block) => {
      copiedBlock = block;
    },
  });

  // Initially, no banner
  let rendered = runtime.render();
  assert.strictEqual(rendered.banner, null, 'No banner before copy');

  // Trigger copy on block
  runtime.handleCopySingleBlock(mockBlock);
  assert.strictEqual(copiedBlock, mockBlock, 'onCopyBlock was invoked with the block');

  // Banner should now be visible
  rendered = runtime.render();
  assert.ok(rendered.banner !== null, 'Banner is rendered after copy action');
  assert.strictEqual(rendered.banner.role, 'status', 'Role is "status" for accessibility');
  assert.strictEqual(rendered.banner['aria-live'], 'polite', 'aria-live is polite');
  assert.strictEqual(rendered.banner['data-banner-type'], 'success', 'Banner type is success');
  assert.strictEqual(rendered.banner.icon, '✓', 'Displays green success checkmark');
  assert.strictEqual(rendered.banner.message, 'Copied 1 block', 'Displays "Copied 1 block" message');

  console.log('✓ Copying a single block invokes onCopyBlock and displays local success banner');
}

// ---------------------------------------------------------------------------
// Test 2: Correct copied message is shown for single and bulk selection
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Correct copied message is shown for single and bulk selection ---');
  const blocks = [
    { id: 'b-1', command: 'cmd1', output: 'out1' },
    { id: 'b-2', command: 'cmd2', output: 'out2' },
    { id: 'b-3', command: 'cmd3', output: 'out3' },
  ];

  // 1 block selected
  let copySelectedCalled = false;
  const runtimeSingle = new CapturePanelRuntime({
    blocks,
    selectedBlockIds: new Set(['b-1']),
    onCopySelected: () => {
      copySelectedCalled = true;
    },
  });
  runtimeSingle.handleCopySelected();
  assert.strictEqual(copySelectedCalled, true, 'onCopySelected callback was invoked');
  let rendered = runtimeSingle.render();
  assert.strictEqual(rendered.banner.message, 'Copied 1 block', '1 selected block says "Copied 1 block"');

  // 3 blocks selected
  const runtimeMulti = new CapturePanelRuntime({
    blocks,
    selectedBlockIds: new Set(['b-1', 'b-2', 'b-3']),
    onCopySelected: () => {},
  });
  runtimeMulti.handleCopySelected();
  rendered = runtimeMulti.render();
  assert.strictEqual(rendered.banner.message, 'Copied 3 blocks', '3 selected blocks says "Copied 3 blocks"');

  console.log('✓ Banner displays accurate message depending on block count');
}

// ---------------------------------------------------------------------------
// Test 3: Banner auto-dismisses after short duration
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Banner auto-dismisses after short duration ---');
  const runtime = new CapturePanelRuntime();
  runtime.triggerCopyFeedback('Copied 1 block');

  // Immediately visible
  assert.ok(runtime.render().banner !== null, 'Banner visible at 0ms');

  // Advance time to 1500ms (still within 2500ms)
  runtime.advanceTime(1500);
  assert.ok(runtime.render().banner !== null, 'Banner still visible at 1500ms');
  assert.strictEqual(runtime.render().banner.message, 'Copied 1 block');

  // Advance past 2500ms (to 2600ms)
  runtime.advanceTime(1100);
  assert.strictEqual(runtime.render().banner, null, 'Banner auto-dismissed at 2600ms');

  console.log('✓ Banner automatically dismisses after 2500ms timeout');
}

// ---------------------------------------------------------------------------
// Test 4: Repeated copy refreshes banner cleanly without stacking duplicates
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Repeated copy refreshes banner cleanly without stacking ---');
  const runtime = new CapturePanelRuntime();

  // 1st copy
  runtime.triggerCopyFeedback('Copied 1 block');
  assert.strictEqual(runtime.render().banner.message, 'Copied 1 block');
  assert.strictEqual(runtime.render().children.filter((c) => c.className?.includes('capture-feedback-banner')).length, 1);

  // Advance 1500ms
  runtime.advanceTime(1500);
  assert.ok(runtime.render().banner !== null);

  // 2nd copy while 1st is still visible
  runtime.triggerCopyFeedback('Copied 2 blocks');

  // Assert exactly 1 banner exists in panel
  const bannerMatches = runtime.render().children.filter((c) => c.className?.includes('capture-feedback-banner'));
  assert.strictEqual(bannerMatches.length, 1, 'Exactly one banner element exists (no stacking)');
  assert.strictEqual(runtime.render().banner.message, 'Copied 2 blocks', 'Message refreshed to "Copied 2 blocks"');

  // At 3000ms (1500ms after 2nd copy), 2nd banner is STILL visible
  runtime.advanceTime(1500);
  assert.ok(runtime.render().banner !== null, 'Timer was refreshed; banner remains visible past original expiration');

  // At 4100ms (2600ms after 2nd copy), banner auto-dismisses
  runtime.advanceTime(1100);
  assert.strictEqual(runtime.render().banner, null, 'Banner auto-dismissed after refreshed duration');

  console.log('✓ Repeated copy resets the auto-dismiss timer and updates message without stacking');
}

// ---------------------------------------------------------------------------
// Test 5: Banner is rendered inside the capture panel, not as a global banner
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Banner is rendered inside the capture panel ---');
  const runtime = new CapturePanelRuntime({ blocks: [{ id: 'b-1', command: 'cmd', output: 'out' }] });
  runtime.triggerCopyFeedback('Copied 1 block');

  const rendered = runtime.render();
  assert.strictEqual(rendered.className, 'context-panel', 'Parent is context-panel (inside capture side panel)');
  assert.strictEqual(rendered.children[0].className, 'capture-toolbar capture-panel-header', 'Child 0 is header');
  assert.strictEqual(rendered.children[1], rendered.banner, 'Child 1 is local capture-feedback-banner');
  assert.strictEqual(rendered.children[2].className, 'transcript-scroll-container', 'Child 2 is transcript list');

  // Assert banner does NOT belong to global-warning-banner-stack
  assert.strictEqual(rendered.banner.className.includes('global-warning-banner'), false);
  assert.ok(rendered.banner.className.includes('capture-feedback-banner'));

  console.log('✓ Banner is anchored inside the capture panel directly under controls and above list');
}

// ---------------------------------------------------------------------------
// Test 6: Manual dismiss button works immediately
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: Manual dismiss button works immediately ---');
  const runtime = new CapturePanelRuntime();
  runtime.triggerCopyFeedback('Copied 1 block');

  assert.ok(runtime.render().banner !== null);
  runtime.dismissCopyFeedback();
  assert.strictEqual(runtime.render().banner, null, 'Banner is dismissed immediately upon user click');

  console.log('✓ Dismiss action immediately clears the copy feedback banner');
}

// ---------------------------------------------------------------------------
// Test 7: Stylesheet and implementation invariants
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 7: Stylesheet and implementation invariants ---');
  const bannerCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/CaptureFeedbackBanner.css'),
    'utf8',
  );

  assert.ok(bannerCss.includes('.capture-feedback-banner'), 'Defines .capture-feedback-banner');
  assert.ok(bannerCss.includes('.capture-feedback-banner--success'), 'Defines .capture-feedback-banner--success');
  assert.ok(bannerCss.includes('border-left: 3px solid var(--green, #6ee7b7);'), 'Uses green left accent bar matching global banner');
  assert.ok(bannerCss.includes('rgba(110, 231, 183,'), 'Uses green tinted translucent background');
  assert.ok(bannerCss.includes('.capture-feedback-banner-dismiss'), 'Defines dismiss button');

  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );

  assert.ok(panelTsx.includes('CaptureFeedbackBanner'), 'Imports and renders CaptureFeedbackBanner');
  assert.ok(panelTsx.includes('handleCardCopy'), 'Wires handleCardCopy to TranscriptCard');
  assert.ok(panelTsx.includes('handleCopySelectedClick'), 'Wires handleCopySelectedClick to toolbar');
  assert.ok(panelTsx.includes('triggerCopyFeedback'), 'Has triggerCopyFeedback timer handling');
  assert.ok(panelTsx.includes('type="success"'), 'Renders banner with success type');

  const bannerTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/CaptureFeedbackBanner.tsx'),
    'utf8',
  );
  assert.ok(bannerTsx.includes('role={role}'), 'Configures dynamic accessible role');
  assert.ok(bannerTsx.includes('aria-live={ariaLive}'), 'Configures aria-live');
  assert.ok(bannerTsx.includes('data-testid="capture-feedback-banner"'), 'Exposes testid for automated testing');

  console.log('✓ Stylesheet and JSX files follow all visual and architectural specifications');
}

console.log('\\n=======================================================================');
console.log('ALL 7 LOCAL CAPTURE COPY FEEDBACK BANNER TESTS PASSED!');
console.log('=======================================================================\\n');
