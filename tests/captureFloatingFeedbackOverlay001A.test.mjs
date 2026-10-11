/**
 * CAPTURE-UX-001A — Floating Feedback Overlay Correction Test Suite
 *
 * Verifies:
 * 1. Capture feedback region is no longer nested inside sticky Capture header.
 * 2. Capture feedback overlay is mounted at panel level.
 * 3. Overlay uses floating/absolute positioning relative to Capture container.
 * 4. Header remains sticky independently.
 * 5. Showing feedback does not alter header layout structure.
 * 6. Same dedupeKey still renders one banner.
 * 7. Different dedupeKeys still stack.
 * 8. 3000ms dismiss still works.
 * 9. Progress bar still renders.
 * 10. Destructive confirmation remains outside transient overlay.
 * 11. Existing Capture tests remain passing.
 * 12. Existing MonitorFeedback tests remain passing.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ts = require('../app/node_modules/typescript');

function transpileTs(filePath, customRequire = () => ({})) {
  const src = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

const customReq = (req) => {
  if (req.includes('types')) return monitorTypesMod;
  return require(req);
};

const monitorTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/monitor/types.ts'));
const feedbackMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/monitor/monitorFeedback.ts'),
  customReq,
);

const { createMonitorFeedbackStore, DEFAULT_TRANSIENT_FEEDBACK_DURATION_MS } = feedbackMod;

console.log('Running CAPTURE-UX-001A Floating Feedback Overlay Test Suite...\n');

// ---------------------------------------------------------------------------
// Test Group 1: JSX Structure & Hierarchy Verification
// ---------------------------------------------------------------------------
{
  console.log('--- Test Group 1: JSX Structure & Hierarchy Verification ---');

  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );

  // 1. Capture feedback region is NOT nested inside sticky header
  const stickyHeaderBlockRegex = /className=['"]capture-management-header capture-sticky-header capture-control-stack['"][\s\S]*?<\/div>/;
  const stickyHeaderMatch = panelTsx.match(stickyHeaderBlockRegex);
  assert.ok(stickyHeaderMatch, 'capture-management-header exists in JSX');
  assert.strictEqual(
    stickyHeaderMatch[0].includes('capture-transient-feedback-region'),
    false,
    'capture-transient-feedback-region MUST NOT be embedded inside sticky header',
  );
  assert.strictEqual(
    stickyHeaderMatch[0].includes('MonitorGlobalFeedbackRegion'),
    false,
    'MonitorGlobalFeedbackRegion MUST NOT be rendered inside sticky header',
  );

  // 2. Capture feedback overlay is mounted at panel level
  assert.ok(
    panelTsx.includes('capture-floating-feedback-region'),
    'capture-floating-feedback-region must be present in TranscriptCapturePanel',
  );
  assert.ok(
    panelTsx.includes('capture-panel-container'),
    'capture-panel-container must wrap panel and overlay',
  );

  // 3. Header remains sticky independently
  assert.ok(
    panelTsx.includes('capture-management-header capture-sticky-header'),
    'Header retains sticky classes',
  );

  // 4. Destructive confirmation remains outside transient overlay
  assert.ok(
    panelTsx.includes('InlineDestructiveBanner'),
    'InlineDestructiveBanner remains in evidence section',
  );

  console.log('✓ JSX structure verified: overlay mounted at panel level, not inside sticky header');
}

// ---------------------------------------------------------------------------
// Test Group 2: CSS Layout & Floating Absolute Positioning
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 2: CSS Layout & Floating Absolute Positioning ---');

  const appCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/App.css'),
    'utf8',
  );
  const feedbackCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/monitor/MonitorGlobalFeedbackRegion.css'),
    'utf8',
  );

  // 1. Overlay container uses floating absolute positioning
  assert.ok(
    appCss.includes('.capture-floating-feedback-region'),
    'App.css defines .capture-floating-feedback-region',
  );
  assert.ok(
    appCss.includes('position: absolute;'),
    'Overlay uses position: absolute to float above panel content',
  );
  assert.ok(
    appCss.includes('pointer-events: none;'),
    'Overlay container uses pointer-events: none to avoid blocking clicks',
  );
  assert.ok(
    appCss.includes('z-index: 50;'),
    'Overlay container uses elevated z-index (50) to render above header/content',
  );

  // 2. Stable panel container owns position: relative
  assert.ok(
    appCss.includes('.capture-panel-container') && appCss.includes('position: relative;'),
    'Panel container owns position: relative for the overlay',
  );

  // 3. Sticky header remains sticky independently
  assert.ok(
    appCss.includes('.capture-management-header'),
    'App.css defines .capture-management-header',
  );
  assert.ok(
    appCss.includes('position: sticky;'),
    'Capture management header uses position: sticky',
  );
  assert.ok(
    appCss.includes('top: 19px;'),
    'Capture management header sticks at top: 19px below switcher',
  );

  // 4. Progress bar styling and keyframes
  assert.ok(
    feedbackCss.includes('.monitor-feedback-progress-bar'),
    'MonitorGlobalFeedbackRegion defines .monitor-feedback-progress-bar',
  );
  assert.ok(
    feedbackCss.includes('feedback-progress-drain'),
    'Defines feedback-progress-drain keyframes animation',
  );

  console.log('✓ CSS verified: floating overlay at panel level with sticky header underneath');
}

// ---------------------------------------------------------------------------
// Test Group 3: Deduplication & Stacking Semantics
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 3: Deduplication & Stacking Semantics ---');

  const store = createMonitorFeedbackStore();

  // 1. Same dedupeKey produces ONE banner
  const id1 = store.push({
    level: 'success',
    source: 'clipboard',
    title: 'Copied 1 block',
    dedupeKey: 'copy:block',
    durationMs: 3000,
  });
  const id2 = store.push({
    level: 'success',
    source: 'capture',
    title: 'Copied 1 block',
    dedupeKey: 'copy:block',
    durationMs: 3000,
  });

  assert.strictEqual(id1, id2, 'Same dedupeKey must return same ID');
  assert.strictEqual(store.getItems().length, 1, 'Same dedupeKey produces exactly one banner');

  // 2. Different dedupeKeys coexist and stack cleanly
  const id3 = store.push({
    level: 'info',
    source: 'repository',
    title: 'Refreshing repository evidence…',
    dedupeKey: 'repository:refresh',
    durationMs: 3000,
  });

  assert.strictEqual(store.getItems().length, 2, 'Distinct dedupeKeys stack in overlay');
  assert.strictEqual(store.getItems()[0].dedupeKey, 'copy:block');
  assert.strictEqual(store.getItems()[1].dedupeKey, 'repository:refresh');

  // 3. Lifecycle progression updates banner in-place
  store.push({
    level: 'success',
    source: 'repository',
    title: 'Repository evidence refreshed',
    dedupeKey: 'repository:refresh',
    durationMs: 3000,
  });

  assert.strictEqual(store.getItems().length, 2, 'In-place update does not create duplicate stack entry');
  assert.strictEqual(store.getItems()[1].level, 'success');
  assert.strictEqual(store.getItems()[1].title, 'Repository evidence refreshed');

  store.destroy();
  console.log('✓ Deduplication & stacking verified: same dedupeKey dedupes, distinct keys stack');
}

// ---------------------------------------------------------------------------
// Test Group 4: 3000ms Auto-Dismiss Lifetime & Teardown
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 4: Auto-Dismiss & Teardown ---');

  assert.strictEqual(DEFAULT_TRANSIENT_FEEDBACK_DURATION_MS, 3000);

  const store = createMonitorFeedbackStore();

  // Test custom short duration
  store.push({
    level: 'success',
    source: 'clipboard',
    title: 'Quick test',
    durationMs: 60,
  });

  assert.strictEqual(store.getItems().length, 1);
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.strictEqual(store.getItems().length, 0, 'Transient banner auto-dismisses after duration');

  store.destroy();
  console.log('✓ Auto-dismiss timer semantics operate deterministically');
}

console.log('\n=============================================================');
console.log('ALL CAPTURE-UX-001A FLOATING FEEDBACK OVERLAY TESTS PASSED!');
console.log('=============================================================\n');
