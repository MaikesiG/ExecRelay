import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xtermPkg from '../app/node_modules/@xterm/xterm/lib/xterm.js';
const { Terminal } = xtermPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task: Refine xterm terminal viewport scrollbar in TraceRelay / CapTerm
 * Visual target matching iTerm / macOS terminal overlay chrome:
 * - Narrow (6px), low-contrast, dark-gray thumb (rgba(255, 255, 255, 0.22))
 * - Minimal / transparent track
 * - Positioned flush against the terminal's right edge
 * - No light-gray reserved gutter or wide browser-style scrollbar
 * - Subdued default state, subtle hover/active states
 * - Separate styling from capture panel
 */

console.log('Running Terminal Viewport Scrollbar Styling Tests...\\n');

// ---------------------------------------------------------------------------
// Test 1: DOM Hierarchy and Scrollbar Responsibility Analysis
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: DOM Hierarchy and Scrollbar Responsibility ---');

  // Verify that div.xterm-viewport is the sole vertical scroll container
  const term = new Terminal({ rows: 10, cols: 60, scrollback: 1000 });

  // In xterm, viewport is the internal element with class .xterm-viewport
  // It handles scrolling for terminal content.
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');

  // Verify outer containers prevent accidental nested scrollbars
  const wrapperMatch = appCss.match(/\.terminal-pane-wrapper\s*\{([^}]+)\}/);
  assert.ok(wrapperMatch, 'Found .terminal-pane-wrapper rule in App.css');
  assert.ok(
    wrapperMatch[1].includes('overflow: hidden'),
    '.terminal-pane-wrapper has overflow: hidden (no outer scrollbar)',
  );

  const containerMatch = appCss.match(/\.terminal-pane-container\s*\{([^}]+)\}/);
  assert.ok(containerMatch, 'Found .terminal-pane-container rule in App.css');
  assert.ok(
    containerMatch[1].includes('overflow: hidden'),
    '.terminal-pane-container has overflow: hidden (no intermediate scrollbar)',
  );

  // Verify that ONLY .xterm-viewport has overflow-y: auto / scroll
  const viewportMatch = appCss.match(/\.terminal-pane-container\s+\.xterm-viewport\s*\{([^}]+)\}/);
  assert.ok(viewportMatch, 'Found .terminal-pane-container .xterm-viewport in App.css');
  assert.ok(
    viewportMatch[1].includes('overflow-y: auto !important'),
    '.xterm-viewport is the designated scroll container',
  );
  assert.ok(
    viewportMatch[1].includes('overflow-x: hidden'),
    '.xterm-viewport prevents accidental horizontal scrollbar',
  );

  console.log('✓ Exactly one scroll container (.xterm-viewport); zero nested scrollbars');
}

// ---------------------------------------------------------------------------
// Test 2: WebKit Custom Scrollbar Rules (6px width, transparent track, capsule thumb)
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: WebKit Custom Scrollbar Rules ---');
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');

  // 1. Scrollbar width must be 6px
  const scrollbarWidthMatch = appCss.match(
    /\.xterm-viewport::-webkit-scrollbar[^{]*\{([^}]+)\}/,
  );
  assert.ok(scrollbarWidthMatch, 'Found .xterm-viewport::-webkit-scrollbar rule');
  assert.ok(
    scrollbarWidthMatch[1].includes('width: 6px'),
    'Scrollbar width is set to 6px (matching iTerm / macOS overlay)',
  );

  // 2. Track must be transparent (no light gray gutter)
  const trackMatch = appCss.match(
    /\.xterm-viewport::-webkit-scrollbar-track[^{]*\{([^}]+)\}/,
  );
  assert.ok(trackMatch, 'Found .xterm-viewport::-webkit-scrollbar-track rule');
  assert.ok(
    trackMatch[1].includes('background: transparent'),
    'Scrollbar track is transparent (no reserved light gutter)',
  );

  // 3. Thumb must be dark, low-contrast, rounded capsule
  const thumbMatch = appCss.match(
    /\.xterm-viewport::-webkit-scrollbar-thumb[^{]*\{([^}]+)\}/,
  );
  assert.ok(thumbMatch, 'Found .xterm-viewport::-webkit-scrollbar-thumb rule');
  const thumbCss = thumbMatch[1];
  assert.ok(
    thumbCss.includes('rgba(255, 255, 255, 0.22)'),
    'Thumb default background is subtle dark-gray (rgba(255, 255, 255, 0.22))',
  );
  assert.ok(
    thumbCss.includes('border-radius: 999px'),
    'Thumb has fully rounded capsule border-radius (999px)',
  );
  assert.ok(
    thumbCss.includes('background-clip: padding-box'),
    'Thumb uses background-clip: padding-box for crisp rendering',
  );

  // 4. Hover and Active states
  const thumbHoverMatch = appCss.match(
    /\.xterm-viewport::-webkit-scrollbar-thumb:hover[^{]*\{([^}]+)\}/,
  );
  assert.ok(thumbHoverMatch, 'Found thumb:hover rule');
  assert.ok(
    thumbHoverMatch[1].includes('rgba(255, 255, 255, 0.38)'),
    'Thumb hover background subtly brightens to rgba(255, 255, 255, 0.38)',
  );

  const thumbActiveMatch = appCss.match(
    /\.xterm-viewport::-webkit-scrollbar-thumb:active[^{]*\{([^}]+)\}/,
  );
  assert.ok(thumbActiveMatch, 'Found thumb:active rule');
  assert.ok(
    thumbActiveMatch[1].includes('rgba(255, 255, 255, 0.5)'),
    'Thumb active/dragging background provides visible feedback (rgba(255, 255, 255, 0.5))',
  );

  console.log('✓ WebKit scrollbar rules: 6px width, transparent track, dark capsule thumb, smooth hover/active');
}

// ---------------------------------------------------------------------------
// Test 3: Firefox / Standard Cross-Browser Compatibility
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Firefox / Standard CSS Scrollbar Properties ---');
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');

  // Verify scrollbar-width: thin
  assert.ok(
    appCss.includes('scrollbar-width: thin;'),
    'Defines scrollbar-width: thin for Firefox / CSS standards',
  );

  // Verify scrollbar-color: rgba(255, 255, 255, 0.22) transparent
  assert.ok(
    appCss.includes('scrollbar-color: rgba(255, 255, 255, 0.22) transparent;'),
    'Defines scrollbar-color with dark thumb and transparent track for Firefox',
  );

  // Verify hover state for scrollbar-color
  assert.ok(
    appCss.includes('scrollbar-color: rgba(255, 255, 255, 0.38) transparent;'),
    'Defines hover scrollbar-color for Firefox',
  );

  console.log('✓ Cross-browser standard scrollbar properties properly configured');
}

// ---------------------------------------------------------------------------
// Test 4: Flush Placement Against Terminal Right Edge
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Flush Placement Against Terminal Right Edge ---');
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');

  // In .terminal-pane-container, padding-right must be 0 so .xterm and .xterm-viewport
  // extend flush to the right edge of the terminal pane.
  const containerMatch = appCss.match(/\.terminal-pane-container\s*\{([^}]+)\}/);
  assert.ok(containerMatch, 'Found .terminal-pane-container rule in App.css');
  assert.ok(
    containerMatch[1].includes('padding: 10px 0 10px 14px;'),
    '.terminal-pane-container has padding: 10px 0 10px 14px (flush right edge, 14px left margin)',
  );

  console.log('✓ Terminal pane container padding-right is 0; scrollbar is flush against right edge');
}

// ---------------------------------------------------------------------------
// Test 5: Capture Panel Scrollbar Isolation
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Capture Panel Scrollbar Styling Isolation ---');
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');

  // Verify capture panel transcript has its own distinct styles (blue-accented theme)
  assert.ok(
    appCss.includes('.transcript-scroll-container::-webkit-scrollbar'),
    'Capture panel transcript retains its own scrollbar selector',
  );
  assert.ok(
    appCss.includes('rgba(124, 140, 255, 0.2)'),
    'Capture panel transcript retains its blue-tinted thumb styling',
  );

  console.log('✓ Capture panel scrollbar remains isolated with its dedicated design');
}

// ---------------------------------------------------------------------------
// Test 6: Terminal Buffer and Scrollback Integrity Preserved
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: Terminal Buffer and Scrollback Integrity Preserved ---');
  const term = new Terminal({ rows: 5, cols: 40, scrollback: 100 });

  let text = '';
  for (let i = 1; i <= 20; i++) {
    text += `Output line ${i}\r\n`;
  }

  await new Promise((resolve) => {
    term.write(text, resolve);
  });

  // Check buffer size and scrolling
  assert.strictEqual(term.buffer.active.length, 21, 'Buffer accumulated 21 lines');
  assert.strictEqual(term.buffer.active.baseY, 16, 'baseY is 16 (16 lines in scrollback)');

  // Verify that the scrollback line content is intact
  const firstLine = term.buffer.active.getLine(0).translateToString(true);
  assert.strictEqual(firstLine, 'Output line 1', 'Scrollback line 0 intact');
  const lastLine = term.buffer.active.getLine(19).translateToString(true);
  assert.strictEqual(lastLine, 'Output line 20', 'Buffer line 19 intact');

  console.log('✓ Terminal buffer accumulation and scrollback integrity 100% functional');
}

console.log('\\n=======================================================================');
console.log('ALL 6 TERMINAL VIEWPORT SCROLLBAR STYLING TESTS PASSED!');
console.log('=======================================================================\\n');
