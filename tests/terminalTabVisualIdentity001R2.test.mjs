import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) =>
  fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

const chromeCss = read('../app/src/features/workspace/ChromeTabs.css');
const tabsCss = read('../app/src/features/workspace/WorkspaceTabs.css');
const tabsSource = read('../app/src/features/workspace/WorkspaceTabs.tsx');
const namingSource = read('../app/src/features/workspace/terminalTabName.ts');
const persistenceSource = read(
  '../app/src/features/workspace/workspacePersistence.ts',
);
const typesSource = read('../app/src/features/workspace/types.ts');

const identityColor =
  /var\(\s*--terminal-tab-identity-color,\s*var\(--terminal-tab-accent\)\s*\)/;
const terminalActiveRule = chromeCss.match(
  /\.chrome-tab--terminal\[data-active="true"\]::before,[\s\S]*?\n\}/,
)?.[0];
const terminalHoverRule = chromeCss.match(
  /\.chrome-tab--terminal:hover:not\(\.chrome-tab--active\):not\(\[data-active="true"\]\)::before,[\s\S]*?\n\}/,
)?.[0];

console.log('Running TAB-VISUAL-IDENTITY-001R2 tests...');

assert.ok(terminalActiveRule, 'Terminal active-accent rule exists');
assert.match(terminalActiveRule, identityColor);
assert.doesNotMatch(
  terminalActiveRule,
  /background:\s*(?:var\(--terminal-tab-accent\)|rgba?\([^)]*52[^)]*211[^)]*153|#[0-9a-f]{3,8})\s*;/i,
);

assert.ok(terminalHoverRule, 'Terminal inactive-hover accent rule exists');
assert.match(terminalHoverRule, identityColor);
assert.match(terminalHoverRule, /opacity:\s*0\.5;/);
assert.doesNotMatch(terminalHoverRule, /rgba\(52,\s*211,\s*153,/);

const terminalBorderRule = chromeCss.match(
  /\.chrome-tab--terminal\s*\{[\s\S]*?\n\}/,
)?.[0];
assert.ok(terminalBorderRule, 'Terminal identity-border rule exists');
assert.match(terminalBorderRule, identityColor);

for (const colorKey of ['emerald', 'blue', 'violet', 'amber']) {
  assert.match(
    namingSource,
    new RegExp(`'${colorKey}'`),
    `${colorKey} is a supported terminal identity key`,
  );
}
assert.match(
  namingSource,
  /return `var\(--terminal-tab-color-\$\{colorKey\}\)`;/,
);
assert.match(
  tabsSource,
  /'--terminal-tab-identity-color':\s*getTerminalTabColorCssValue\(tabColorKey\)/,
);

// Status state, active fill, focus indicator, and geometry stay independent.
assert.match(
  tabsCss,
  /\.workspace-tab-status-dot--ready,[\s\S]*?background:\s*var\(--green\);/,
);
assert.match(
  tabsCss,
  /\.workspace-tab-status-dot--capturing,[\s\S]*?background:\s*var\(--red\);/,
);
assert.match(
  chromeCss,
  /\.chrome-tab--terminal\.chrome-tab--active,[\s\S]*?background:\s*rgba\(255, 255, 255, 0\.08\);/,
);
assert.match(
  tabsCss,
  /\.workspace-tab-activator:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--accent\);/,
);
assert.match(
  chromeCss,
  /\.chrome-tab\s*\{[\s\S]*?height:\s*28px;[\s\S]*?border:\s*1px solid transparent;[\s\S]*?border-radius:\s*6px;/,
);

// Rename and persistence remain separate from the tab's colorKey presentation.
assert.match(
  tabsSource,
  /renameTerminalTab\(workspaceId, id, finalName\);/,
);
assert.match(typesSource, /colorKey\?:\s*TerminalTabColorKey/);
assert.match(persistenceSource, /colorKey:\s*getTerminalTabColorKey\(tab\)/);

console.log('TAB-VISUAL-IDENTITY-001R2 tests passed.');
