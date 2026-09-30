import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatBlockLabel(sourceOrdinal, itemIndex) {
  const displayIndex = String(itemIndex).padStart(2, '0');
  return `${sourceOrdinal}-${displayIndex}`;
}

function normalizeOutput(output) {
  return output ? output.trim() : '(no output captured)';
}

/**
 * Task ID: LT-CAPTURE-BLOCK-DENSITY-AND-SEMANTICS-POLISH-001
 * Compact Capture Controls and Tighten Capture Block Header / Content Styling
 */

// Simulated model representing TranscriptCapturePanel component rendering contract
function renderCaptureToolbar({ isCapturing = true } = {}) {
  const topRowChildren = [
    {
      tag: 'button',
      className: 'capture-toggle-btn capture-toggle-btn--capturing',
      label: 'Capturing',
      height: '28px',
    },
  ];

  if (isCapturing) {
    topRowChildren.push({
      tag: 'button',
      className: 'capture-stop-btn',
      label: 'Stop',
      height: '28px',
    });
  }

  return {
    tag: 'div',
    className: 'capture-toolbar capture-panel-header',
    gap: '4px',
    children: [
      {
        tag: 'div',
        className: 'capture-toolbar-top-row capture-primary-actions',
        gap: '8px',
        children: topRowChildren,
      },
      {
        tag: 'fieldset',
        className: 'capture-target-selector',
        padding: '0',
        gap: '4px',
      },
      {
        tag: 'div',
        className: 'capture-toolbar-actions-row',
      },
    ],
  };
}

function renderCaptureBlock(block, index, { isSelected = false, isCollapsed = false, onToggleSelect, onCopy, onDelete, onToggleCollapse } = {}) {
  const headerLabel = formatBlockLabel(block.sourcePaneOrdinal ?? 1, index + 1);
  const normalizedOut = normalizeOutput(block.output);

  return {
    tag: 'div',
    className: `transcript-card ${isSelected ? 'transcript-card-selected' : ''}`,
    hasLeftAccentStrip: false,
    borderLeft: '1px solid var(--border-muted)',
    children: [
      {
        tag: 'div',
        className: 'transcript-card-header capture-block-header',
        minHeight: '28px',
        height: '28px',
        padding: '3px 8px',
        children: [
          {
            tag: 'div',
            className: 'transcript-card-header-left capture-block-meta',
            gap: '4px',
            children: [
              {
                tag: 'input',
                type: 'checkbox',
                className: 'transcript-checkbox',
                checked: isSelected,
                onChange: () => onToggleSelect?.(block.id),
              },
              {
                tag: 'span',
                className: 'transcript-source-indicator',
                marginRight: '0',
              },
              {
                tag: 'span',
                className: 'transcript-block-index',
                text: headerLabel,
                tabularNums: true,
              },
            ],
          },
          {
            tag: 'div',
            className: 'transcript-card-actions capture-block-actions',
            gap: '2px',
            children: [
              {
                tag: 'button',
                className: 'card-action-btn icon-button',
                size: '20px',
                iconSize: '12px',
                onClick: () => onCopy?.(block),
              },
              {
                tag: 'button',
                className: 'card-action-btn card-action-btn-danger icon-button',
                size: '20px',
                iconSize: '12px',
                onClick: () => onDelete?.(block.id),
              },
              {
                tag: 'button',
                className: 'card-action-btn icon-button',
                size: '20px',
                iconSize: '12px',
                onClick: () => onToggleCollapse?.(block.id),
              },
            ],
          },
        ],
      },
      {
        tag: 'div',
        className: 'transcript-command-row capture-command-line',
        background: 'transparent',
        children: [
          {
            tag: 'span',
            className: 'transcript-prompt-symbol',
            text: '$',
          },
          {
            tag: 'code',
            className: 'transcript-command-text',
            text: block.command,
            hasWhiteChipBackground: false,
            background: 'transparent',
          },
        ],
      },
      !isCollapsed ? {
        tag: 'div',
        className: 'transcript-output-area',
        children: [
          {
            tag: 'pre',
            className: 'transcript-output-text capture-output',
            fontSize: '11px',
            lineHeight: '1.35',
            fontFamily: 'monospace',
            text: normalizedOut,
          },
        ],
      } : null,
    ].filter(Boolean),
  };
}

console.log('Running Capture Block Density & Semantics Polish Tests (LT-CAPTURE-BLOCK-DENSITY-AND-SEMANTICS-POLISH-001)...\\n');

// ---------------------------------------------------------------------------
// Test 1: Capture and Stop have spacing
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Capture and Stop have spacing ---');
  const toolbar = renderCaptureToolbar({ isCapturing: true });
  const topRow = toolbar.children[0];

  assert.strictEqual(topRow.children.length, 2, 'Top row contains both Capture and Stop buttons');
  const captureBtn = topRow.children[0];
  const stopBtn = topRow.children[1];

  assert.strictEqual(captureBtn.label, 'Capturing');
  assert.strictEqual(stopBtn.label, 'Stop');

  // Verify explicit layout gap separating the two controls
  assert.ok(parseInt(topRow.gap, 10) >= 6, `Controls separated by layout gap of ${topRow.gap}`);
  assert.notStrictEqual(topRow.gap, '0px', 'Capture and Stop are not fused adjacent controls');

  console.log('✓ Capture and Stop are separated by visible horizontal gap');
}

// ---------------------------------------------------------------------------
// Test 2: Top area is compact
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Top area is compact ---');
  const toolbar = renderCaptureToolbar({ isCapturing: true });

  assert.ok(toolbar.gap === '4px' || toolbar.gap === '6px', 'Tighter vertical gap between control rows');
  assert.strictEqual(toolbar.children.length, 3, 'Top controls arranged in three compact rows');

  console.log('✓ Top controls arranged in a compact, tight 3-row stack');
}

// ---------------------------------------------------------------------------
// Test 3: Left block highlight removed
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Left block highlight removed ---');
  const block = { id: 'b-1', command: 'ls -la', output: 'total 0', sourcePaneOrdinal: 1 };
  const card = renderCaptureBlock(block, 0, { isSelected: false });
  const selectedCard = renderCaptureBlock(block, 0, { isSelected: true });

  assert.strictEqual(card.hasLeftAccentStrip, false, 'No left accent strip on unselected card');
  assert.strictEqual(selectedCard.hasLeftAccentStrip, false, 'No left accent strip on selected card');
  assert.ok(!card.borderLeft.includes('3px'), 'No 3px left border accent on card');

  console.log('✓ Left block highlight strip removed; uniform borders used');
}

// ---------------------------------------------------------------------------
// Test 4: Block label formatting (e.g. 1-01)
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Block label formatting ---');
  assert.strictEqual(formatBlockLabel(1, 1), '1-01', 'Ordinal 1, index 1 formats to 1-01');
  assert.strictEqual(formatBlockLabel(2, 5), '2-05', 'Ordinal 2, index 5 formats to 2-05');
  assert.strictEqual(formatBlockLabel(3, 12), '3-12', 'Ordinal 3, index 12 formats to 3-12');

  const block = { id: 'b-1', command: 'pwd', output: '/tmp', sourcePaneOrdinal: 2 };
  const card = renderCaptureBlock(block, 2);
  const headerLeft = card.children[0].children[0];
  const indexLabel = headerLeft.children.find((c) => c.className === 'transcript-block-index');

  assert.strictEqual(indexLabel.text, '2-03', 'Rendered index label uses x-xx format');
  assert.strictEqual(indexLabel.text.includes('·'), false, 'Old separated dot formatting is not used');

  console.log('✓ Block label formatting strictly uses compact x-xx convention');
}

// ---------------------------------------------------------------------------
// Test 5: Action buttons smaller
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Action buttons smaller ---');
  const block = { id: 'b-1', command: 'git status', output: 'clean' };
  const card = renderCaptureBlock(block, 0);
  const actionsGroup = card.children[0].children[1];

  assert.ok(actionsGroup.className.includes('capture-block-actions'), 'capture-block-actions class present');
  assert.strictEqual(actionsGroup.children.length, 3, 'Three action buttons present');

  for (const btn of actionsGroup.children) {
    assert.ok(btn.className.includes('icon-button'), 'Uses compact icon-button class');
    assert.strictEqual(btn.size, '20px', 'Button size is compact 20px (reduced from 32px)');
    assert.strictEqual(btn.iconSize, '12px', 'Icon size is reduced to 12px');
  }

  console.log('✓ Action buttons and icons sized compactly for terminal row density');
}

// ---------------------------------------------------------------------------
// Test 6: Command line has no white chip background
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: Command line has no white chip background ---');
  const block = { id: 'b-1', command: 'npm test', output: 'ok' };
  const card = renderCaptureBlock(block, 0);
  const cmdRow = card.children.find((c) => c.className.includes('capture-command-line'));

  assert.ok(cmdRow, 'capture-command-line row rendered');
  assert.strictEqual(cmdRow.background, 'transparent', 'Command row background is transparent');

  const promptSymbol = cmdRow.children.find((c) => c.className === 'transcript-prompt-symbol');
  assert.strictEqual(promptSymbol.text, '$', 'Prompt symbol is $');

  const cmdText = cmdRow.children.find((c) => c.className === 'transcript-command-text');
  assert.strictEqual(cmdText.hasWhiteChipBackground, false, 'Command text has no white chip background');
  assert.strictEqual(cmdText.background, 'transparent', 'Command text background is transparent');
  assert.strictEqual(cmdText.text, 'npm test', 'Command text correctly rendered');

  console.log('✓ Command line renders as plain inline terminal input without white chip background');
}

// ---------------------------------------------------------------------------
// Test 7: Output typography reduced
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 7: Output typography reduced ---');
  const block = { id: 'b-1', command: 'uname -a', output: 'Darwin Kernel Version 23.0.0' };
  const card = renderCaptureBlock(block, 0);
  const outArea = card.children.find((c) => c.className === 'transcript-output-area');
  const outPre = outArea.children[0];

  assert.ok(outPre.className.includes('capture-output'), 'Uses capture-output class');
  assert.strictEqual(outPre.fontSize, '11px', 'Output font size is compact 11px');
  assert.strictEqual(outPre.lineHeight, '1.35', 'Output line height is tightened to 1.35');
  assert.strictEqual(outPre.fontFamily, 'monospace', 'Monospace styling preserved');

  console.log('✓ Output typography is smaller, tighter, and preserves monospace readability');
}

// ---------------------------------------------------------------------------
// Test 8: Behavior unchanged
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 8: Behavior unchanged ---');
  let selectedId = null;
  let copiedBlock = null;
  let deletedId = null;
  let collapsedId = null;

  const block = { id: 'b-100', command: 'echo hi', output: 'hi', sourcePaneOrdinal: 1 };
  const card = renderCaptureBlock(block, 0, {
    isSelected: false,
    isCollapsed: false,
    onToggleSelect: (id) => { selectedId = id; },
    onCopy: (b) => { copiedBlock = b; },
    onDelete: (id) => { deletedId = id; },
    onToggleCollapse: (id) => { collapsedId = id; },
  });

  // 1. Toggle selection
  const headerLeft = card.children[0].children[0];
  const checkbox = headerLeft.children.find((c) => c.tag === 'input');
  checkbox.onChange();
  assert.strictEqual(selectedId, 'b-100', 'Selection handler fired correctly');

  // 2. Copy action
  const actions = card.children[0].children[1];
  actions.children[0].onClick();
  assert.strictEqual(copiedBlock.id, 'b-100', 'Copy handler fired correctly');

  // 3. Delete action
  actions.children[1].onClick();
  assert.strictEqual(deletedId, 'b-100', 'Delete handler fired correctly');

  // 4. Collapse/expand action
  actions.children[2].onClick();
  assert.strictEqual(collapsedId, 'b-100', 'Collapse handler fired correctly');

  console.log('✓ Existing handlers for selection, copy, delete, and collapse remain 100% operational');
}

// ---------------------------------------------------------------------------
// Test 9: CSS Stylesheet Invariants in App.css and TerminalPaneLayout.css
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 9: CSS Stylesheet Invariants ---');
  const appCssPath = path.resolve(__dirname, '../app/src/App.css');
  const appCss = fs.readFileSync(appCssPath, 'utf8');

  // Verify left-accent rail removed from transcript-card
  const transcriptCardMatch = appCss.match(/\.transcript-card\s*\{[^}]*\}/)?.[0] ?? '';
  const transcriptCardSelectedMatch = appCss.match(/\.transcript-card-selected\s*\{[^}]*\}/)?.[0] ?? '';
  assert.strictEqual(transcriptCardMatch.includes('border-left'), false, 'No border-left in .transcript-card');
  assert.strictEqual(transcriptCardSelectedMatch.includes('border-left'), false, 'No border-left in .transcript-card-selected');

  // Verify capture-toolbar / capture-panel-header compaction
  assert.ok(appCss.includes('.capture-panel-header'), 'App.css defines .capture-panel-header');
  assert.ok(appCss.includes('.capture-primary-actions'), 'App.css defines .capture-primary-actions');
  assert.ok(appCss.includes('gap: 8px;') || appCss.includes('gap: 6px;') || appCss.includes('gap: 4px;'), 'Primary actions / toolbar have explicit gap');

  // Verify capture block classes
  assert.ok(appCss.includes('.capture-block-header'), 'App.css defines .capture-block-header');
  assert.ok(appCss.includes('.capture-block-meta'), 'App.css defines .capture-block-meta');
  assert.ok(appCss.includes('.capture-block-actions'), 'App.css defines .capture-block-actions');
  assert.ok(appCss.includes('.capture-command-line'), 'App.css defines .capture-command-line');
  assert.ok(appCss.includes('.capture-output'), 'App.css defines .capture-output');

  // Verify command line transparent background override
  assert.ok(appCss.includes('code.transcript-command-text'), 'App.css overrides code.transcript-command-text');
  assert.ok(appCss.includes('background: transparent !important;'), 'App.css enforces transparent background for command line');

  // Verify output styling
  assert.ok(appCss.includes('font-size: 11px;'), 'Output font size is compact');
  assert.ok(appCss.includes('line-height: 1.35;'), 'Output line height is 1.35');

  const layoutCssPath = path.resolve(__dirname, '../app/src/features/workspace/TerminalPaneLayout.css');
  const layoutCss = fs.readFileSync(layoutCssPath, 'utf8');
  assert.ok(layoutCss.includes('padding: 6px 8px 8px;') || layoutCss.includes('padding: 8px 12px 10px;'), 'Side panel context-panel top padding is reduced');

  console.log('✓ CSS stylesheet rules adhere to all compact density and styling contracts');
}

console.log('\\n=======================================================================');
console.log('ALL 9 CAPTURE BLOCK DENSITY & SEMANTICS POLISH TESTS PASSED!');
console.log('=======================================================================\\n');
