import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) =>
  fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

const tabsSource = read('../app/src/features/workspace/WorkspaceTabs.tsx');
const tabsCss = read('../app/src/features/workspace/WorkspaceTabs.css');
const chromeCss = read('../app/src/features/workspace/ChromeTabs.css');
const captureSource = read(
  '../app/src/features/transcript/TranscriptCapturePanel.tsx',
);
const typesSource = read('../app/src/features/workspace/types.ts');

console.log('Running TAB-VISUAL-IDENTITY-001R tests...');

// The identity presentation element is removed, not merely hidden.
assert.doesNotMatch(tabsSource, /terminal-tab-identity-dot/);
assert.doesNotMatch(tabsCss, /terminal-tab-identity-dot/);

// Terminal tabs contain ZERO status dots (CAPTURE-STATUS-001)
assert.strictEqual(
  tabsSource.match(/className="workspace-tab-status-lights"/g)?.length ?? 0,
  0,
);
assert.strictEqual(
  tabsSource.match(/workspace-tab-status-dot/g)?.length ?? 0,
  0,
);
assert.match(typesSource, /return \[\s*\{\s*paneId: targetPaneId,\s*status,/);

// Existing status colors remain state-derived and independent of identity.
assert.match(
  tabsCss,
  /\.workspace-tab-status-dot--ready,[\s\S]*?background:\s*var\(--green\);/,
);
assert.match(
  tabsCss,
  /\.workspace-tab-status-dot--capturing,[\s\S]*?background:\s*var\(--red\);/,
);
assert.match(
  tabsCss,
  /\.workspace-tab-status-dot--paused\s*\{\s*background:\s*#f59e0b;/,
);

// Stable identity still comes from colorKey, now through the reserved border.
assert.match(tabsSource, /const tabColorKey = getTerminalTabColorKey\(tab\)/);
assert.match(
  tabsSource,
  /'--terminal-tab-identity-color':\s*getTerminalTabColorCssValue\(tabColorKey\)/,
);
assert.match(tabsSource, /data-tab-color=\{tabColorKey\}/);
assert.match(
  chromeCss,
  /\.chrome-tab--terminal\s*\{[\s\S]*?border-color:\s*var\([\s\S]*?--terminal-tab-identity-color/,
);
assert.match(
  chromeCss,
  /\.chrome-tab--terminal\.chrome-tab--active,[\s\S]*?border-color:\s*var\([\s\S]*?--terminal-tab-identity-color/,
);

// Active, hover, focus, and geometry rules remain independently present.
assert.match(
  chromeCss,
  /\.chrome-tab--terminal\.chrome-tab--active,[\s\S]*?background:\s*rgba\(255, 255, 255, 0\.08\);/,
);
assert.match(
  chromeCss,
  /\.chrome-tab--terminal:hover:not\(\.chrome-tab--active\)[\s\S]*?::before/,
);
assert.match(
  tabsCss,
  /\.workspace-tab-activator:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--accent\);/,
);
assert.match(
  chromeCss,
  /\.chrome-tab\s*\{[\s\S]*?height:\s*28px;[\s\S]*?border:\s*1px solid transparent;[\s\S]*?box-sizing:\s*border-box;/,
);

// Capture cleanly removes the identity dot in 001R3, keeping the same color key.
assert.doesNotMatch(captureSource, /className='capture-target-dot'/);
assert.match(captureSource, /data-tab-color=\{terminalTabColorKey\}/);
assert.doesNotMatch(captureSource, /workspace-tab-status-dot/);

console.log('TAB-VISUAL-IDENTITY-001R tests passed.');
