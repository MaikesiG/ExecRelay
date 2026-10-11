/**
 * Pure state reducer for safe Workspace Reset (WORKSPACE-RESET-001 / WORKSPACE-RESET-001R)
 *
 * Clears accumulated execution/evidence/session presentation state for a LogicalWorkspace:
 * - Capture blocks and batch history
 * - Selection sets (workspace and pane mirrors)
 * - Changes evidence (snapshots, collection runs, attributions)
 * - Completed Verification runs
 *
 * Strictly preserves:
 * - Workspace identity, name, rootPath, repository context, projectCwd
 * - Terminal tabs, pane hierarchies, split layout, active tab
 * - Terminal tab semantic names and identity color keys
 * - Terminal pane PTY session bindings, cwd, status, ordinals, and accents
 * - Capture target scope configuration (ALL vs explicit pane IDs)
 * - Verification contracts (profiles), criteria, active profile, and criterion selection
 * - Agent runs and active agent run identity (strictly out of scope for workspace reset)
 */

import type { LogicalWorkspace } from './types';
import { clearWorkspaceVerificationRuns } from '../verification/verificationState';

export function resetWorkspaceState(workspace: LogicalWorkspace): LogicalWorkspace {
  const now = Date.now();

  // Reset each pane's capture metadata and selection mirror
  const resetPanes = workspace.panes.map((p) => ({
    ...p,
    capture: {
      ...p.capture,
      isListening: false,
      hasRetainedData: false,
      currentBatchId: null,
      warning: null,
    },
    selection: {
      selectedBlockIds: new Set<string>(),
      updatedAt: now,
    },
  }));

  // Update terminal tabs with reset panes and cleared tab capture metadata
  const resetTabs = workspace.terminalTabs.map((t) => ({
    ...t,
    terminalPanes: t.terminalPanes.map((p) => {
      const matched = resetPanes.find((rp) => rp.id === p.id);
      return matched ?? p;
    }),
    panes: t.panes.map((p) => {
      const matched = resetPanes.find((rp) => rp.id === p.id);
      return matched ?? p;
    }),
    capture: t.capture
      ? {
          ...t.capture,
          isListening: false,
          hasRetainedData: false,
          currentBatchId: null,
          warning: null,
        }
      : undefined,
  }));

  // Clear completed verification runs while preserving contracts, criteria, and selections
  const clearedVerification = workspace.verification
    ? clearWorkspaceVerificationRuns(workspace).verification
    : undefined;

  return {
    ...workspace,
    terminalTabs: resetTabs,
    panes: resetPanes,
    capture: {
      ...workspace.capture,
      isListening: false,
      blocks: [],
      currentBatch: null,
      // batchCounter is preserved monotonically
      // targetScope is preserved
    },
    selection: {
      selectedBlockIds: new Set<string>(),
      updatedAt: now,
    },
    verification: clearedVerification,
    repositorySnapshots: [],
    latestCollectionRun: undefined,
    changeAttributions: [],
  };
}

export function getWorkspaceResetBlocker(
  workspace: LogicalWorkspace | null | undefined,
  isVerificationRunning: boolean,
): string | null {
  if (!workspace) return 'No active workspace selected.';

  if (isVerificationRunning || Boolean(workspace.verification?.activeRunId)) {
    return 'Verification is currently running. Finish or cancel it before resetting the workspace.';
  }

  if (
    workspace.capture.isListening ||
    (workspace.capture.currentBatch !== null &&
      workspace.capture.currentBatch.stoppedAt === null) ||
    workspace.panes.some((p) => p.capture.isListening)
  ) {
    return 'Capture is currently active. Stop Capture before resetting the workspace.';
  }

  return null;
}
