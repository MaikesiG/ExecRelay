/**
 * TraceRelay / CapTerm Verification Layer Foundation
 *
 * Core domain types for Verification Contracts, Criteria, Runs, and Criterion Results.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. Verification is NOT the same thing as Execution.
 *    - Execution answers: "What actually happened when this command/tool ran?"
 *    - Verification answers: "Does the available trusted evidence satisfy a specific requirement?"
 * 2. Verification never replaces Execution. Real executions remain the source of execution truth.
 * 3. Execution outcome success != Verification criterion success.
 *    - Execution outcome is determined by process exit code / OS outcome.
 *    - Verification criterion status is determined by whether the trusted outcome satisfies explicit expected exit codes.
 * 4. Deterministic criteria evaluation:
 *    - V1 supports deterministic command criteria matching expectedExitCodes (default [0]).
 *    - Text heuristics MUST NEVER be used to decide verification pass/fail.
 * 5. Strict trust boundary:
 *    - A criterion may only become authoritatively 'passed' or 'failed' from trusted execution evidence
 *      (e.g. outcomeSource === 'trusted-shell' && outcomeTrusted === true).
 *    - Unknown, untrusted, or interrupted executions (e.g. capture-boundary, pane-close, spoofed OSC)
 *      MUST produce 'error' (unevaluable).
 * 6. Historical integrity & Snapshotting:
 *    - Every VerificationRun is immutable upon completion.
 *    - Evaluated criteria are snapshotted into VerificationRun.criteriaSnapshot so that future edits
 *      to a contract never alter historical verification records.
 *    - Rerunning verification creates a new VerificationRun (#2, #3, ...) without mutating previous runs.
 * 7. Four-Layer State Model (HARDEN-016.1):
 *    - VerificationProfile: Editable user configuration.
 *    - VerificationSelection: Ephemeral run-planning state.
 *    - VerificationRun: Immutable historical execution snapshot.
 *    - VerificationRuntime: Ephemeral ownership of an active run.
 */

export type VerificationCriterionType = 'command';

export type VerificationCriterionStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'error'
  | 'interrupted'
  | 'skipped';

export type VerificationRunStatus =
  | 'pending'
  | 'running'
  | 'stopping'
  | 'stop-timeout'
  | 'passed'
  | 'failed'
  | 'error'
  | 'cancelled';

export type VerificationCriterionAvailability = 'available' | 'unavailable';

export interface VerificationCriterion {
  id: string;
  type: VerificationCriterionType;
  label: string;
  command: string;
  expectedExitCodes: number[];
  order: number;
  workingDirectory?: string;
  cwd?: string;
  availability?: VerificationCriterionAvailability;
}

export type VerificationProfile = VerificationContract;

export interface VerificationContract {
  id: string;
  workspaceId: string;
  name: string;
  criteria: VerificationCriterion[];
  createdAt: number;
  updatedAt?: number;
}

export interface VerificationSelection {
  activeProfileId: string;
  selectedCriterionIds: Set<string>;
}

export type VerificationRuntimePhase = 'running' | 'stopping' | 'stop_issue';

export interface VerificationRuntime {
  runId: string;
  currentCriterionIndex: number;
  currentExecutionId: string | null;
  phase: VerificationRuntimePhase;
  cancelRequested: boolean;
}

export interface VerificationCriterionResult {
  criterionId: string;
  status: VerificationCriterionStatus;
  executionId?: string;
  observedExitCode?: number | null;
  startedAt?: number;
  completedAt?: number;
  message?: string;
}

export interface VerificationRun {
  id: string;
  contractId: string;
  profileName?: string;
  workspaceId: string;
  status: VerificationRunStatus;
  /**
   * Immutable snapshot of the contract's criteria evaluated during this run.
   * Guarantees that editing the contract in the future never rewrites history.
   */
  criteriaSnapshot: VerificationCriterion[];
  criterionResults: VerificationCriterionResult[];
  startedAt: number;
  completedAt?: number | null;
  attributionId?: string;
  continuedFromRunId?: string;
}

/* ========================================================================== */
/* Type Guards                                                                */
/* ========================================================================== */

export function isVerificationCriterionType(
  value: unknown,
): value is VerificationCriterionType {
  return value === 'command';
}

export function isVerificationCriterionStatus(
  value: unknown,
): value is VerificationCriterionStatus {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'passed' ||
    value === 'failed' ||
    value === 'error' ||
    value === 'interrupted' ||
    value === 'skipped'
  );
}

export function isVerificationRunStatus(
  value: unknown,
): value is VerificationRunStatus {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'stopping' ||
    value === 'stop-timeout' ||
    value === 'passed' ||
    value === 'failed' ||
    value === 'error' ||
    value === 'cancelled'
  );
}

export function isVerificationCriterion(
  value: unknown,
): value is VerificationCriterion {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    isVerificationCriterionType(c.type) &&
    typeof c.label === 'string' &&
    typeof c.command === 'string' &&
    Array.isArray(c.expectedExitCodes) &&
    typeof c.order === 'number'
  );
}

export function isVerificationContract(
  value: unknown,
): value is VerificationContract {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.workspaceId === 'string' &&
    typeof c.name === 'string' &&
    Array.isArray(c.criteria) &&
    typeof c.createdAt === 'number'
  );
}

export function isVerificationCriterionResult(
  value: unknown,
): value is VerificationCriterionResult {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.criterionId === 'string' &&
    isVerificationCriterionStatus(r.status)
  );
}

export function isVerificationRun(value: unknown): value is VerificationRun {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.contractId === 'string' &&
    typeof r.workspaceId === 'string' &&
    isVerificationRunStatus(r.status) &&
    Array.isArray(r.criteriaSnapshot) &&
    Array.isArray(r.criterionResults) &&
    typeof r.startedAt === 'number'
  );
}
