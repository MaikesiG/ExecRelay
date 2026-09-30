/**
 * TraceRelay / CapTerm Verification Lifecycle Reconciliation
 *
 * Core invariant:
 * RUNNING may be displayed only while there is a genuinely unresolved active
 * Verification execution/runtime.
 *
 * Reconciliation functions guarantee:
 * 1. Distinction between activeRun (unresolved) and latestRun (most recent historical/current).
 * 2. Automatic, deterministic reconciliation of orphaned runs (e.g. after app reload, session teardown).
 * 3. Idempotent finalization: duplicate exit/close events never corrupt completed runs.
 * 4. Honest terminal outcomes: orphaned runs are marked ERROR with explanatory evidence, never fabricated PASS.
 */

import type { LogicalWorkspace } from '../workspace/types';
import type {
  VerificationCriterionResult,
  VerificationRun,
  VerificationRunStatus,
} from './types';
import {
  getWorkspaceVerificationRuns,
  updateVerificationRunInWorkspace,
} from './verificationState';

export function isNonTerminalVerificationStatus(
  status: VerificationRunStatus,
): boolean {
  return (
    status === 'running' ||
    status === 'pending' ||
    status === 'stopping' ||
    status === 'stop-timeout'
  );
}

export function isTerminalVerificationStatus(
  status: VerificationRunStatus,
): boolean {
  return (
    status === 'passed' ||
    status === 'failed' ||
    status === 'error' ||
    status === 'cancelled'
  );
}

/**
 * HARDEN-VERIFY-EDITABILITY-022: Canonical verification runtime activity check.
 * Profile configuration should be locked only while live Verification execution
 * ownership remains active.
 *
 * Terminal outcomes ('cancelled', 'completed', null/undefined) release runtime ownership.
 * Active states ('running', 'stopping', 'stop-timeout') retain runtime ownership.
 */
export function isVerificationRuntimeActive(
  runtime: { lifecycle?: string } | null | undefined,
): boolean {
  if (!runtime) return false;
  return (
    runtime.lifecycle === 'running' ||
    runtime.lifecycle === 'stopping' ||
    runtime.lifecycle === 'stop-timeout'
  );
}

/**
 * Gets the genuinely active (unresolved, non-terminal) verification run for a workspace, if any.
 * Returns null if no run is currently active or if activeRunId points to a completed/terminal run.
 */
export function getActiveVerificationRun(
  workspace: LogicalWorkspace,
): VerificationRun | null {
  const runs = getWorkspaceVerificationRuns(workspace);
  const activeId = workspace.verification?.activeRunId;

  if (activeId) {
    const candidate = runs.find((r) => r.id === activeId);
    if (candidate && isNonTerminalVerificationStatus(candidate.status)) {
      return candidate;
    }
    // If activeId points to a terminal run, it is not an active run
    return null;
  }

  // If activeRunId is not set, verify whether the latest run is still non-terminal
  if (runs.length > 0) {
    const latest = runs[runs.length - 1];
    if (isNonTerminalVerificationStatus(latest.status)) {
      return latest;
    }
  }

  return null;
}

export interface VerificationReconciliationResult {
  workspace: LogicalWorkspace;
  wasReconciled: boolean;
  orphanedRunIds: string[];
}

/**
 * Reconciles workspace verification state against runtime ownership.
 *
 * Scenarios handled:
 * 1. App Reload / Lost Runtime:
 *    A run is marked running/pending/stopping/stop-timeout in workspace state, but there is
 *    no active runtime in memory. Reconciles the run to ERROR with a clear reason.
 * 2. Stale activeRunId:
 *    activeRunId points to a run that is already in a terminal state (passed/failed/error/cancelled).
 *    Cleans up activeRunId to null.
 * 3. Concurrent orphan cleanup:
 *    Any earlier runs left in non-terminal states while another run is active are reconciled to ERROR.
 */
export function reconcileWorkspaceVerificationState(params: {
  workspace: LogicalWorkspace;
  hasActiveRuntime: boolean;
  activeRunIdInRuntime?: string | null;
  reconciliationReason?: string;
}): VerificationReconciliationResult {
  const {
    workspace,
    hasActiveRuntime,
    activeRunIdInRuntime,
    reconciliationReason = 'Verification runtime was interrupted or lost before authoritative completion',
  } = params;

  if (!workspace.verification || workspace.verification.runs.length === 0) {
    return { workspace, wasReconciled: false, orphanedRunIds: [] };
  }

  const current = workspace.verification;
  const orphanedRunIds: string[] = [];
  let stateModified = false;

  const updatedRuns = current.runs.map((run) => {
    // If this run is already terminal, leave it completely untouched (idempotency & immutability)
    if (isTerminalVerificationStatus(run.status)) {
      return run;
    }

    // This run has a non-terminal status (running, pending, stopping, stop-timeout)
    const isOwnedByRuntime =
      hasActiveRuntime &&
      activeRunIdInRuntime != null &&
      run.id === activeRunIdInRuntime;

    if (!isOwnedByRuntime) {
      // Orphaned run detected!
      orphanedRunIds.push(run.id);
      stateModified = true;

      const updatedCriterionResults: VerificationCriterionResult[] =
        run.criterionResults.map((r) => {
          if (r.status === 'running' || r.status === 'pending') {
            return {
              ...r,
              status: 'error',
              completedAt: Date.now(),
              message: reconciliationReason,
            };
          }
          return r;
        });

      return {
        ...run,
        status: 'error' as const,
        criterionResults: updatedCriterionResults,
        completedAt: run.completedAt ?? Date.now(),
      };
    }

    return run;
  });

  // Reconcile activeRunId: must be null if there is no active, non-terminal run
  let nextActiveRunId: string | null = null;
  if (hasActiveRuntime && activeRunIdInRuntime) {
    const activeCandidate = updatedRuns.find(
      (r) => r.id === activeRunIdInRuntime && isNonTerminalVerificationStatus(r.status),
    );
    if (activeCandidate) {
      nextActiveRunId = activeCandidate.id;
    }
  }

  if (current.activeRunId !== nextActiveRunId) {
    stateModified = true;
  }

  // HARDEN-VERIFY-DELETE-021: Reconcile selection against active contract criteria
  const activeContract =
    current.contracts.find((c) => c.id === current.activeContractId) ??
    current.contracts[0];
  const validIds = new Set(activeContract ? activeContract.criteria.map((c) => c.id) : []);

  let nextSelectedCriterionIds = current.selectedCriterionIds;
  if (!nextSelectedCriterionIds) {
    nextSelectedCriterionIds = new Set(validIds);
    stateModified = true;
  } else {
    const filtered = new Set(
      Array.from(nextSelectedCriterionIds).filter((id) => validIds.has(id)),
    );
    if (filtered.size !== nextSelectedCriterionIds.size) {
      nextSelectedCriterionIds = filtered;
      stateModified = true;
    }
  }

  if (!stateModified) {
    return { workspace, wasReconciled: false, orphanedRunIds: [] };
  }

  const reconciledWorkspace: LogicalWorkspace = {
    ...workspace,
    verification: {
      ...current,
      runs: updatedRuns,
      activeRunId: nextActiveRunId,
      selectedCriterionIds: nextSelectedCriterionIds,
    },
  };

  return {
    workspace: reconciledWorkspace,
    wasReconciled: true,
    orphanedRunIds,
  };
}

export interface MinimalVerificationRuntime {
  workspaceId: string;
  terminalTabId: string;
  terminalPaneId: string;
  targetSessionId?: string;
  runId: string;
  expectedCriterionId?: string;
  lifecycle: string;
  advanceTimer?: ReturnType<typeof setTimeout> | null;
  stopFallbackTimer?: ReturnType<typeof setTimeout> | null;
}

/**
 * Reconciles verification state when an owning terminal pane, tab, or session is closed or exits.
 */
export function reconcileVerificationTeardown(params: {
  workspace: LogicalWorkspace;
  runtime: MinimalVerificationRuntime | null;
  targetWorkspaceId: string;
  targetPaneId?: string;
  targetTabId?: string;
  targetSessionId?: string;
  reason: string;
}): {
  workspace: LogicalWorkspace;
  runtimeCleared: boolean;
  cancelledRun: VerificationRun | null;
} {
  const {
    workspace,
    runtime,
    targetWorkspaceId,
    targetPaneId,
    targetTabId,
    targetSessionId,
    reason,
  } = params;

  if (!runtime || runtime.workspaceId !== targetWorkspaceId) {
    return { workspace, runtimeCleared: false, cancelledRun: null };
  }

  const matchesPane = targetPaneId && runtime.terminalPaneId === targetPaneId;
  const matchesTab = targetTabId && runtime.terminalTabId === targetTabId;
  const matchesSession =
    targetSessionId && runtime.targetSessionId === targetSessionId;

  if (!matchesPane && !matchesTab && !matchesSession) {
    return { workspace, runtimeCleared: false, cancelledRun: null };
  }

  // Clear any pending timers on runtime
  if (runtime.advanceTimer) {
    clearTimeout(runtime.advanceTimer);
    runtime.advanceTimer = null;
  }
  if (runtime.stopFallbackTimer) {
    clearTimeout(runtime.stopFallbackTimer);
    runtime.stopFallbackTimer = null;
  }

  const currentRun = workspace.verification?.runs.find(
    (r) => r.id === runtime.runId,
  );

  if (!currentRun || isTerminalVerificationStatus(currentRun.status)) {
    return { workspace, runtimeCleared: true, cancelledRun: null };
  }

  const updatedResults: VerificationCriterionResult[] =
    currentRun.criterionResults.map((r) => {
      if (
        (r.criterionId === runtime.expectedCriterionId &&
          r.status === 'running') ||
        r.status === 'running'
      ) {
        return {
          ...r,
          status: 'error',
          completedAt: Date.now(),
          message: reason,
        };
      }
      if (r.status === 'pending') {
        return {
          ...r,
          status: 'skipped',
          message: reason,
        };
      }
      return r;
    });

  const cancelledRun: VerificationRun = {
    ...currentRun,
    status: 'cancelled',
    criterionResults: updatedResults,
    completedAt: Date.now(),
  };

  const updatedWs = updateVerificationRunInWorkspace(workspace, cancelledRun);

  return {
    workspace: updatedWs,
    runtimeCleared: true,
    cancelledRun,
  };
}
