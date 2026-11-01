/**
 * CAPTURE-DELETE-CONFIRM-001 — the Delete Selected confirmation stays in view.
 *
 * The Capture surface scrolls as a whole; only the control stack is pinned
 * (`.capture-sticky-header`, position: sticky). The confirmation used to render at the top of
 * `.evidence-section`, after that pinned stack, so a scrolled block list carried it out of view.
 * It now renders inside the pinned stack, directly after the selection/action row.
 *
 * 1. The confirmation is outside the block list (`.transcript-scroll-container`) and the
 *    evidence section
 * 2. It is the next element after the action row, inside the pinned control stack
 * 3. The control stack is sticky and the block list is not a separate scroller, so scrolling
 *    the list cannot move the confirmation out of view
 * 4. Cancel only closes the confirmation (selection untouched)
 * 5. Delete closes it and calls the existing onDeleteSelected exactly once
 * 6. Copy feedback and warnings stay in their panel-level regions, outside the scroller
 * 7. Capture evidence wiring is unchanged
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');
const panelPath = path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx');
const source = fs.readFileSync(panelPath, 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
const sf = ts.createSourceFile(panelPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const classOf = (node) => {
  const attrs = ts.isJsxElement(node) ? node.openingElement.attributes : ts.isJsxSelfClosingElement(node) ? node.attributes : null;
  const cls = attrs?.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'className');
  return cls?.initializer && ts.isStringLiteral(cls.initializer) ? cls.initializer.text : '';
};
const tagOf = (node) => (ts.isJsxElement(node) ? node.openingElement.tagName.getText(sf) : ts.isJsxSelfClosingElement(node) ? node.tagName.getText(sf) : '');
const ancestors = (node) => {
  const out = [];
  for (let n = node.parent; n; n = n.parent) if (ts.isJsxElement(n)) out.push(n);
  return out;
};
const find = (pred) => {
  const hits = [];
  const visit = (n) => {
    if (pred(n)) hits.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
};

const banners = find((n) => ts.isJsxSelfClosingElement(n) && n.tagName.getText(sf) === 'InlineDestructiveBanner');
assert.equal(banners.length, 1, 'one delete confirmation');
const banner = banners[0];
const chain = ancestors(banner);
const area = chain[0];
assert.equal(classOf(area), 'capture-banner-area');

// 1
for (const n of chain) {
  assert.ok(!classOf(n).includes('transcript-scroll-container'), 'not inside the block list');
  assert.ok(!classOf(n).includes('evidence-section'), 'not inside the evidence section');
}
console.log('✓ 1. Confirmation is outside the block list and the evidence section');

// 2
const stack = chain.find((n) => classOf(n).includes('capture-sticky-header capture-control-stack'));
assert.ok(stack, 'inside the pinned control stack');
const elements = stack.children
  .map((c) => (ts.isJsxExpression(c) && c.expression && ts.isBinaryExpression(c.expression) ? c.expression.right : c))
  .map((c) => (ts.isParenthesizedExpression(c) ? c.expression : c))
  .filter((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
const actionsAt = elements.findIndex((c) => classOf(c).includes('evidence-header-actions'));
assert.ok(actionsAt >= 0, 'action row in the stack');
assert.match(elements[actionsAt].getText(sf), /aria-label="Delete selected transcript blocks"/);
assert.equal(elements[actionsAt + 1], area, 'confirmation is the next element after the action row');
assert.equal(actionsAt + 1, elements.length - 1, 'nothing between the confirmation and the block list');
const section2 = source.indexOf('{/* SECTION 2: EVIDENCE (CAPTURED EXECUTIONS) */}');
assert.ok(banner.getStart(sf) < section2, 'renders before the evidence section');
console.log('✓ 2. Confirmation renders directly below the Copy/Delete Selected row');

// 3
const rule = (selector) => css.match(new RegExp(`(^|\\n)${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[2] ?? '';
assert.match(rule('.capture-sticky-header'), /position: sticky;/);
assert.match(rule('.transcript-scroll-container'), /overflow: visible;/, 'the list does not scroll on its own');
assert.match(rule('.capture-control-stack .capture-banner-area'), /padding: 4px 10px 0;/, 'aligned with the action row');
assert.ok(!/position:\s*(absolute|fixed)/.test(rule('.capture-control-stack .capture-banner-area')), 'stays in flow: no overlay');
console.log('✓ 3. The pinned stack carries the confirmation at any list scroll position');

// 4 and 5
const prop = (name) => {
  const attr = banner.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
  return attr.initializer.expression.getText(sf).replace(/\s+/g, ' ');
};
assert.equal(prop('onCancel'), '() => setPendingConfirmation(null)', 'Cancel only closes');
assert.equal(prop('onConfirm'), '() => { setPendingConfirmation(null); onDeleteSelected(); }', 'Delete closes and deletes');
assert.equal(prop('title'), "`Delete ${selectedCount} block${selectedCount === 1 ? '' : 's'}?`");
assert.match(source, /const isDeleteConfirmActive =\s*pendingConfirmation === 'delete-selected' && selectedCount > 0;/);
assert.equal((source.match(/onDeleteSelected\(\)/g) ?? []).length, 1, 'one delete path');
assert.ok(!/setSelected|onToggleSelect\(|clearSelection/.test(prop('onCancel')));
console.log('✓ 4–5. Cancel keeps the selection; Delete closes and deletes the selection once');

// 6
const overlay = find((n) => ts.isJsxElement(n) && classOf(n) === 'capture-floating-feedback-region')[0];
assert.ok(overlay, 'copy feedback overlay exists');
assert.equal(classOf(ancestors(overlay)[0]), 'capture-panel-container capture-panel-root', 'copy feedback is panel-level');
const global = find((n) => (ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n)) && tagOf(n) === 'MonitorGlobalFeedbackRegion');
assert.equal(global.length, 1);
assert.ok(!ancestors(global[0]).some((n) => /capture-evidence-view-surface|transcript-scroll-container/.test(classOf(n))), 'warnings stay outside the scroller');
console.log('✓ 6. Copy feedback and warnings stay in their panel-level regions');

// 7
for (const wiring of ['onDeleteBlock={onDeleteBlock}', 'onToggleSelect={onToggleSelect}', 'onCopyBlock={handleCardCopy}', 'onClick={handleCopySelectedClick}', "onClick={() => setPendingConfirmation('delete-selected')}"]) {
  assert.ok(source.includes(wiring), wiring);
}
console.log('✓ 7. Single-block delete, selection, copy and Capture wiring unchanged');

console.log('\nCAPTURE-DELETE-CONFIRM-001 tests passed.');
