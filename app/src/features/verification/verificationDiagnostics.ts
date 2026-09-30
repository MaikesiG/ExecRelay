/**
 * TraceRelay / CapTerm Verification Memory & Lifecycle Diagnostics
 *
 * Lightweight development/test helper to sample in-memory object retention
 * across VerificationRuns, CriterionResults, and canonical Executions.
 *
 * HARDEN-012A: Used in tests and developer profiling to verify bounded growth.
 */

import type { LogicalWorkspace } from '../workspace/types';
import { terminalRuntimeRegistry } from '../terminal/terminalRuntimeRegistry';

export interface VerificationMemoryDiagnostics {
  verificationRunCount: number;
  criterionResultCount: number;
  retainedOutputChars: number;
  repositorySnapshotCount: number;
  changeAttributionCount: number;
  terminalRuntimeCount: number;
  activeRunId: string | null;
  hasActiveVerificationRuntime: boolean;
}

/**
 * Samples memory diagnostics for a workspace to audit object counts and bounds.
 */
export function sampleVerificationDiagnostics(
  workspace: LogicalWorkspace,
  activeRuntimeExists: boolean = false,
): VerificationMemoryDiagnostics {
  const runs = workspace.verification?.runs ?? [];
  const runCount = runs.length;

  let criterionResultCount = 0;
  for (const r of runs) {
    criterionResultCount += r.criterionResults.length;
  }

  let retainedOutputChars = 0;
  if (workspace.capture?.blocks) {
    for (const b of workspace.capture.blocks) {
      if (b.output) {
        retainedOutputChars += b.output.length;
      }
      if (b.rawOutput && b.rawOutput !== b.output) {
        retainedOutputChars += b.rawOutput.length;
      }
    }
  }

  return {
    verificationRunCount: runCount,
    criterionResultCount,
    retainedOutputChars,
    repositorySnapshotCount: workspace.repositorySnapshots?.length ?? 0,
    changeAttributionCount: workspace.changeAttributions?.length ?? 0,
    terminalRuntimeCount: terminalRuntimeRegistry.getAll().length,
    activeRunId: workspace.verification?.activeRunId ?? null,
    hasActiveVerificationRuntime: activeRuntimeExists,
  };
}

/**
 * Helper to check whether memory diagnostics adhere to configured upper bounds.
 */
export function assertDiagnosticsWithinBounds(
  diagnostics: VerificationMemoryDiagnostics,
  bounds: {
    maxRuns?: number;
    maxSnapshots?: number;
    maxAttributions?: number;
  } = {},
): boolean {
  const maxRuns = bounds.maxRuns ?? 50;
  const maxSnapshots = bounds.maxSnapshots ?? 20;
  const maxAttributions = bounds.maxAttributions ?? 50;

  return (
    diagnostics.verificationRunCount <= maxRuns &&
    diagnostics.repositorySnapshotCount <= maxSnapshots &&
    diagnostics.changeAttributionCount <= maxAttributions
  );
}
