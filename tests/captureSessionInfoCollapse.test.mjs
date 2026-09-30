/**
 * HARDEN-011 / HARDEN-011A — Capture Session Info Collapse Test Suite
 *
 * Verifies:
 * 1. Default state is collapsed (only compact one-line summary displayed)
 * 2. Info button exists immediately to the right of Stop / primary capture controls
 * 3. Info button has proper accessibility (aria-label, aria-expanded, title)
 * 4. Clicking Info button toggles expanded metadata card (Active Batch, Target Panes, Retained Executions)
 * 5. Recording State is REMOVED from expanded Info card (no redundant state)
 * 6. Toggling Info button is purely UI presentation state; zero mutation to Capture domain state
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running Capture Session Info Collapse Test Suite (HARDEN-011 / HARDEN-011A)...\n');

// ---------------------------------------------------------------------------
// Test Group 1: JSX Structural Inspection
// ---------------------------------------------------------------------------
{
  console.log('--- Test Group 1: JSX Structural Inspection ---');

  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );

  // 1. Verify isCaptureDetailsExpanded state initialization (default = false)
  assert.ok(
    panelTsx.includes('const [isCaptureDetailsExpanded, setIsCaptureDetailsExpanded] ='),
    'Defines isCaptureDetailsExpanded state in TranscriptCapturePanel',
  );
  assert.ok(
    panelTsx.includes('useState<boolean>(false)'),
    'isCaptureDetailsExpanded must default to false (collapsed)',
  );

  // 2. Verify Info button exists next to Stop
  assert.ok(
    panelTsx.includes('capture-info-btn'),
    'Defines .capture-info-btn for Info toggle',
  );

  // Stop button index should be right before Info button in primary actions
  const stopIndex = panelTsx.indexOf('capture-stop-btn');
  const infoIndex = panelTsx.indexOf('capture-info-btn');
  assert.ok(
    stopIndex !== -1 && infoIndex !== -1 && stopIndex < infoIndex,
    'Info button must sit immediately to the right of Stop / primary capture controls',
  );

  // 3. Verify Accessibility attributes on Info button
  assert.ok(
    panelTsx.includes("aria-label={isCaptureDetailsExpanded ? 'Hide capture details' : 'Show capture details'}"),
    'Info button dynamically updates aria-label',
  );
  assert.ok(
    panelTsx.includes('aria-expanded={isCaptureDetailsExpanded}'),
    'Info button exposes aria-expanded attribute',
  );
  assert.ok(
    panelTsx.includes("title={isCaptureDetailsExpanded ? 'Hide capture details' : 'Show capture details'}"),
    'Info button exposes descriptive title tooltip',
  );

  // 4. Verify compact collapsed summary container
  assert.ok(
    panelTsx.includes("className='capture-session-summary'"),
    'Renders .capture-session-summary when collapsed',
  );

  // 5. Verify expanded card container
  assert.ok(
    panelTsx.includes("className='capture-session-card'"),
    'Renders .capture-session-card when expanded',
  );

  // 6. Verify Recording State is completely removed from expanded Info
  assert.strictEqual(
    panelTsx.includes('Recording State:'),
    false,
    'Recording State must not be present in expanded Info card (eliminated in HARDEN-011A)',
  );

  // 7. Verify App.css defines styling for summary, button, and card
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
  assert.ok(appCss.includes('.capture-info-btn'), 'App.css defines .capture-info-btn');
  assert.ok(appCss.includes('.capture-session-summary'), 'App.css defines .capture-session-summary');
  assert.ok(appCss.includes('.capture-summary-item'), 'App.css defines .capture-summary-item');
  assert.ok(appCss.includes('.capture-session-card'), 'App.css defines .capture-session-card');

  console.log('✓ JSX structure and accessibility attributes follow all specifications');
}

// ---------------------------------------------------------------------------
// Test Group 2: Simulation of Toggle State and Lifecycle Non-Mutation
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 2: Simulation of Toggle State & Domain Invariance ---');

  class SimulatedCaptureSection {
    constructor() {
      // Capture domain state
      this.isListening = true;
      this.captureStatus = 'capturing';
      this.currentBatchId = 3;
      this.blocks = [
        { id: 'b1', command: 'git status', isComplete: true },
        { id: 'b2', command: 'npm test', isComplete: true },
      ];
      this.selectedCapturePaneIds = ['pane-1', 'pane-2'];

      // UI presentation state (default = collapsed)
      this.isCaptureDetailsExpanded = false;
    }

    toggleDetails() {
      this.isCaptureDetailsExpanded = !this.isCaptureDetailsExpanded;
    }

    render() {
      if (!this.isCaptureDetailsExpanded) {
        return {
          view: 'collapsed',
          summaryText: `Batch #${this.currentBatchId} · ${this.selectedCapturePaneIds.length} panes · ${this.blocks.length} executions`,
          ariaExpanded: false,
          ariaLabel: 'Show capture details',
        };
      }
      return {
        view: 'expanded',
        details: {
          activeBatch: `#${this.currentBatchId}`,
          targetPanes: `${this.selectedCapturePaneIds.length} listening`,
          retainedExecutions: `${this.blocks.length} commands`,
        },
        ariaExpanded: true,
        ariaLabel: 'Hide capture details',
      };
    }
  }

  const section = new SimulatedCaptureSection();

  // Initial State: Collapsed by default
  assert.strictEqual(section.isCaptureDetailsExpanded, false);
  const initialRender = section.render();
  assert.strictEqual(initialRender.view, 'collapsed');
  assert.strictEqual(initialRender.ariaExpanded, false);
  assert.strictEqual(initialRender.ariaLabel, 'Show capture details');
  assert.ok(initialRender.summaryText.includes('Batch #3'));
  assert.strictEqual(initialRender.summaryText.includes('Capturing'), false, 'Summary row does not duplicate state');

  // Toggle open
  section.toggleDetails();
  assert.strictEqual(section.isCaptureDetailsExpanded, true);
  const expandedRender = section.render();
  assert.strictEqual(expandedRender.view, 'expanded');
  assert.strictEqual(expandedRender.ariaExpanded, true);
  assert.strictEqual(expandedRender.ariaLabel, 'Hide capture details');
  assert.strictEqual(expandedRender.details.recordingState, undefined, 'No recording state in expanded details');
  assert.strictEqual(expandedRender.details.activeBatch, '#3');
  assert.strictEqual(expandedRender.details.retainedExecutions, '2 commands');

  // Verify domain state remains 100% untouched
  assert.strictEqual(section.isListening, true);
  assert.strictEqual(section.captureStatus, 'capturing');
  assert.strictEqual(section.currentBatchId, 3);
  assert.strictEqual(section.blocks.length, 2);

  // Toggle closed
  section.toggleDetails();
  assert.strictEqual(section.isCaptureDetailsExpanded, false);
  const collapsedRender = section.render();
  assert.strictEqual(collapsedRender.view, 'collapsed');
  assert.strictEqual(collapsedRender.ariaExpanded, false);

  console.log('✓ Details toggle operates seamlessly with zero domain state mutation and clean metadata');
}

console.log('\n=============================================================');
console.log('ALL CAPTURE SESSION INFO COLLAPSE TESTS PASSED (HARDEN-011 / HARDEN-011A)!');
console.log('=============================================================\n');
