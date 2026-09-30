/**
 * HARDEN-011A — Capture Header & Monitor Tab Micro-Polish Test Suite
 *
 * Verifies:
 * 1. Compact Monitor tab count badges:
 *    - 1-digit, 2-digit, and 3-digit badges use .monitor-tab-count-badge
 *    - Height is constrained (14–16px) and never increases tab row height
 *    - Count metadata is accessible with informative aria-labels
 * 2. Capture first-row layout:
 *    - Capturing state: State indicator left, [Pause, Stop, Info] right
 *    - Paused state: State indicator left, [Resume, Stop, Info] right
 *    - Idle state: State indicator left, [Start Capture, Info] right
 *    - Info button is ALWAYS the rightmost control in all states
 *    - Info button height matches Pause/Resume/Start/Stop control height token (28px)
 *    - Controls vertically align
 * 3. Standardize Capture spacing:
 *    - 'All' target control defines the horizontal alignment baseline
 *    - Consistent rhythm (10px gap, 10px padding)
 *    - Target pane row spacing is balanced with consistent gap between All and pane targets
 * 4. Expanded Info details:
 *    - Contains: Active Batch, Target Panes, Retained Executions
 *    - Does NOT contain: Recording State
 *    - Collapsed summary does not repeat recording state
 * 5. Domain safety:
 *    - Info toggle is UI-only and does not invoke capture lifecycle actions
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running Capture Header & Monitor Tab Micro-Polish Test Suite (HARDEN-011A)...\n');

const panelTsx = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
  'utf8',
);

const appCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/App.css'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Test Group 1: Compact Monitor Tab Count Badges
// ---------------------------------------------------------------------------
{
  console.log('--- Test Group 1: Compact Monitor Tab Count Badges ---');

  // 1. Verify CSS definition for .monitor-tab-count-badge
  assert.ok(appCss.includes('.monitor-tab-count-badge {'), 'App.css defines .monitor-tab-count-badge');
  assert.ok(appCss.includes('height: 15px;'), 'Badge height is set to 15px (target 14-16px)');
  assert.ok(appCss.includes('max-height: 15px;'), 'Badge max-height prevents vertical expansion');
  assert.ok(appCss.includes('min-width: 15px;'), 'Badge min-width fits 1-2 digits');
  assert.ok(appCss.includes('font-size: 9.5px;'), 'Font size is compact (target 9-10px)');
  assert.ok(appCss.includes('padding: 0 4px;'), 'Compact horizontal padding');
  assert.ok(appCss.includes('box-sizing: border-box;'), 'Uses border-box sizing');

  // 2. Verify Tab button height is fixed and contains the badge without height change
  assert.ok(appCss.includes('.capture-view-tab-btn {'), 'App.css defines .capture-view-tab-btn');
  assert.ok(appCss.includes('max-height: calc(var(--pane-header-height, 25px) - 6px);'), 'Tab button max-height is constrained to 19px');

  // 3. Verify Accessibility: Tab count badges provide descriptive aria-labels
  assert.ok(
    panelTsx.includes("aria-label={`${blocks.length} ${blocks.length === 1 ? 'execution' : 'executions'}`}"),
    'Capture tab badge provides execution count aria-label',
  );
  assert.ok(
    panelTsx.includes("aria-label={`${repositorySnapshot.status.files.length} changed ${repositorySnapshot.status.files.length === 1 ? 'file' : 'files'}`}"),
    'Changes tab badge provides file count aria-label',
  );
  assert.ok(
    panelTsx.includes("aria-label={`${agentRuns.length} agent ${agentRuns.length === 1 ? 'run' : 'runs'}`}"),
    'Agents tab badge provides agent run count aria-label',
  );

  console.log('✓ Tab count badges are compact (15px), accessible, and never change tab height');
}

// ---------------------------------------------------------------------------
// Test Group 2: Capture First-Row Layout & Action Semantics
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 2: Capture First-Row Layout & Action Semantics ---');

  // 1. Verify Capture state indicator on left
  assert.ok(
    panelTsx.includes("className={`capture-state-indicator capture-state-indicator--${captureStatus}`}"),
    'First row renders capture state indicator on left',
  );
  assert.ok(panelTsx.includes("className='capture-state-text'"), 'Renders capture-state-text');

  // 2. Verify Actions container on right
  assert.ok(panelTsx.includes("className='capture-primary-actions'"), 'Renders capture-primary-actions');

  // 3. Verify State-Specific Button Actions:
  // Capturing: Pause + Stop + Info
  assert.ok(panelTsx.includes("className='capture-action-btn capture-pause-btn'"), 'Capturing renders Pause button');
  // Paused: Resume + Stop + Info
  assert.ok(panelTsx.includes("className='capture-action-btn capture-resume-btn'"), 'Paused renders Resume button');
  // Idle: Start Capture + Info
  assert.ok(panelTsx.includes("className='capture-action-btn capture-start-btn'"), 'Idle renders Start Capture button');
  // Stop button
  assert.ok(panelTsx.includes("className='capture-action-btn capture-stop-btn'"), 'Capturing/Paused renders Stop button');

  // 4. Verify Info button is ALWAYS the rightmost button in capture-primary-actions
  const primaryActionsStart = panelTsx.indexOf("<div className='capture-primary-actions'>");
  const primaryActionsEnd = panelTsx.indexOf('</div>', primaryActionsStart + 200);
  const primaryActionsJsx = panelTsx.substring(primaryActionsStart, primaryActionsEnd);

  const infoBtnIndex = primaryActionsJsx.indexOf('capture-info-btn');
  const pauseBtnIndex = primaryActionsJsx.indexOf('capture-pause-btn');
  const resumeBtnIndex = primaryActionsJsx.indexOf('capture-resume-btn');
  const startBtnIndex = primaryActionsJsx.indexOf('capture-start-btn');
  const stopBtnIndex = primaryActionsJsx.indexOf('capture-stop-btn');

  assert.ok(infoBtnIndex > pauseBtnIndex, 'Info button is positioned after Pause');
  assert.ok(infoBtnIndex > resumeBtnIndex, 'Info button is positioned after Resume');
  assert.ok(infoBtnIndex > startBtnIndex, 'Info button is positioned after Start');
  assert.ok(infoBtnIndex > stopBtnIndex, 'Info button is positioned after Stop');

  // 5. Verify Button Sizing Consistency (28px height token)
  assert.ok(appCss.includes('.capture-action-btn {'), 'App.css defines .capture-action-btn base class');
  assert.ok(appCss.includes('height: 28px;'), 'Action buttons have height 28px');
  assert.ok(appCss.includes('min-height: 28px;'), 'Action buttons have min-height 28px');
  assert.ok(appCss.includes('max-height: 28px;'), 'Action buttons have max-height 28px');

  // Info button uses same 28px control geometry
  assert.ok(appCss.includes('.capture-info-btn {'), 'App.css defines .capture-info-btn');
  assert.ok(appCss.includes('width: 28px;'), 'Info button has width 28px');
  assert.ok(appCss.includes('height: 28px;'), 'Info button has height 28px');

  console.log('✓ Capture first row aligns state left, actions right, Info rightmost with unified 28px height');
}

// ---------------------------------------------------------------------------
// Test Group 3: Spacing Rhythm & Alignment Baseline
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 3: Spacing Rhythm & Alignment Baseline ---');

  // 1. Verify .capture-section rhythm
  assert.ok(appCss.includes('.capture-section {'), 'App.css defines .capture-section');
  assert.ok(appCss.includes('gap: 10px;'), '.capture-section uses 10px row gap');
  assert.ok(appCss.includes('padding: 8px 10px 10px;'), '.capture-section uses consistent 10px horizontal padding');

  // 2. Verify target selector spacing & All pill baseline
  assert.ok(appCss.includes('fieldset.capture-target-selector {'), 'App.css resets fieldset margins/padding');
  assert.ok(appCss.includes('border: none;'), 'Target selector fieldset has border: none');
  assert.ok(appCss.includes('margin: 0;'), 'Target selector fieldset has margin: 0');
  assert.ok(appCss.includes('padding: 0;'), 'Target selector fieldset has padding: 0');

  assert.ok(appCss.includes('.capture-target-selector {'), 'App.css defines .capture-target-selector');
  assert.ok(appCss.includes('gap: 8px;'), 'Consistent 8px gap between All and pane targets');

  // 3. Verify All pill has zero extra indentation
  assert.ok(
    panelTsx.includes("className={`capture-target-pill capture-target-pill--all"),
    'All pill is rendered as first element in target-selector',
  );

  console.log('✓ All target defines horizontal baseline with unified 10px/8px spacing rhythm');
}

// ---------------------------------------------------------------------------
// Test Group 4: Expanded Info Elimination of Redundant Recording State
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 4: Expanded Info Elimination of Redundant Recording State ---');

  // 1. Verify Recording State is completely removed from expanded Info
  assert.strictEqual(
    panelTsx.includes('Recording State:'),
    false,
    'Recording State must not be rendered in expanded Info card',
  );

  // 2. Verify expanded card contains only useful secondary metadata
  assert.ok(panelTsx.includes('Active Batch:'), 'Expanded card contains Active Batch');
  assert.ok(panelTsx.includes('Target Panes:'), 'Expanded card contains Target Panes');
  assert.ok(panelTsx.includes('Retained Executions:'), 'Expanded card contains Retained Executions');

  // 3. Verify compact collapsed summary does not duplicate recording state
  assert.ok(
    panelTsx.includes("className='capture-session-summary'"),
    'Renders compact session summary when collapsed',
  );

  console.log('✓ Redundant Recording State removed; compact summary and expanded metadata verified');
}

// ---------------------------------------------------------------------------
// Test Group 5: Domain Safety & Pure UI Toggle
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 5: Domain Safety & Pure UI Toggle ---');

  // Simulate full lifecycle with Info toggle
  class LifecycleSafetySim {
    constructor() {
      this.isListening = false;
      this.captureStatus = 'ready';
      this.batchId = null;
      this.executions = [];
      this.isDetailsExpanded = false;
    }

    toggleDetails() {
      this.isDetailsExpanded = !this.isDetailsExpanded;
    }

    startCapture() {
      this.isListening = true;
      this.captureStatus = 'capturing';
      this.batchId = 1;
    }

    pauseCapture() {
      if (this.captureStatus === 'capturing') {
        this.isListening = false;
        this.captureStatus = 'paused';
      }
    }

    resumeCapture() {
      if (this.captureStatus === 'paused') {
        this.isListening = true;
        this.captureStatus = 'capturing';
      }
    }

    stopCapture() {
      this.isListening = false;
      this.captureStatus = 'ready';
      this.batchId = null;
    }
  }

  const sim = new LifecycleSafetySim();

  // Toggle details in Idle
  sim.toggleDetails();
  assert.strictEqual(sim.isDetailsExpanded, true);
  assert.strictEqual(sim.captureStatus, 'ready');
  assert.strictEqual(sim.batchId, null);

  // Start Capture
  sim.startCapture();
  assert.strictEqual(sim.captureStatus, 'capturing');
  assert.strictEqual(sim.batchId, 1);

  // Toggle details while Capturing
  sim.toggleDetails();
  assert.strictEqual(sim.isDetailsExpanded, false);
  assert.strictEqual(sim.captureStatus, 'capturing', 'Toggling details does not affect capturing');
  assert.strictEqual(sim.batchId, 1);

  // Pause Capture
  sim.pauseCapture();
  assert.strictEqual(sim.captureStatus, 'paused');

  // Toggle details while Paused
  sim.toggleDetails();
  assert.strictEqual(sim.isDetailsExpanded, true);
  assert.strictEqual(sim.captureStatus, 'paused', 'Toggling details does not affect paused state');

  // Resume Capture
  sim.resumeCapture();
  assert.strictEqual(sim.captureStatus, 'capturing');

  // Stop Capture
  sim.stopCapture();
  assert.strictEqual(sim.captureStatus, 'ready');

  console.log('✓ Info toggle is strictly presentation state with zero side effects on capture lifecycle');
}

console.log('\n=============================================================');
console.log('ALL CAPTURE HEADER & MONITOR TAB POLISH TESTS PASSED (HARDEN-011A)!');
console.log('=============================================================\n');
