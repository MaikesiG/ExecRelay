/**
 * TraceRelay / CapTerm Execution Change Attribution Foundation
 *
 * Core domain types for attributing observed repository changes to Executions
 * and VerificationRuns by comparing before and after RepositorySnapshots.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. Attribution is evidence-backed temporal observation, NOT absolute causal proof.
 *    Distinguishes "repository changed during this execution window" from
 *    "this execution is cryptographically proven to be the sole cause".
 * 2. RepositorySnapshots are immutable point-in-time observations.
 * 3. Delta calculation is a pure function over before/after snapshots (no git calls inside delta engine).
 * 4. Honest baseline classification: distinguishes clean baseline from pre-existing dirty changes.
 * 5. Collector failure never mutates Execution outcome or Verification verdict.
 * 6. Line counts and full patch diffs are never fabricated or expanded beyond collected summary evidence.
 * 7. Concurrent external mutations are acknowledged as an explicit attribution limitation.
 */

import type {
  GitFileStatus,
} from '../evidenceCollectors/types';

/* ========================================================================== */
/* Attribution Targets & Status                                               */
/* ========================================================================== */

export type ChangeAttributionTargetType =
  | 'execution'
  | 'verification-run'
  | 'agent-run';

export type ChangeAttributionStatus =
  | 'pending'
  | 'completed'
  | 'partial'
  | 'unavailable'
  | 'failed';

/**
 * Baseline certainty classification:
 * - 'clean-baseline': Repository was clean before execution window. Strongest attribution confidence.
 * - 'dirty-baseline': Repository already had uncommitted changes before execution window.
 * - 'partial': Only partial before/after snapshot data could be gathered.
 * - 'unsupported': Directory is not inside a Git repository.
 */
export type ChangeAttributionScope =
  | 'clean-baseline'
  | 'dirty-baseline'
  | 'partial'
  | 'unsupported';

/**
 * Fine-grained per-file change classification relative to pre-execution baseline:
 * - 'introduced': File had no changes prior to execution; changed during execution window.
 * - 'changed-further': File was already dirty before execution and underwent additional modifications.
 * - 'removed': File was dirty or tracked before execution, but became clean or deleted during execution.
 * - 'unchanged-existing': File was dirty before execution and remained in the exact same dirty state.
 */
export type AttributionDeltaKind =
  | 'introduced'
  | 'changed-further'
  | 'removed'
  | 'unchanged-existing';

/* ========================================================================== */
/* Repository Delta Model                                                     */
/* ========================================================================== */

export type RepositoryDeltaFileStatus = GitFileStatus;

export interface RepositoryDeltaFile {
  path: string;
  previousPath?: string;
  status: RepositoryDeltaFileStatus;
  deltaKind: AttributionDeltaKind;

  stagedBefore?: boolean;
  stagedAfter?: boolean;
  unstagedBefore?: boolean;
  unstagedAfter?: boolean;

  insertions?: number;
  deletions?: number;
  binary?: boolean;
}

export interface RepositoryDelta {
  filesChanged: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  renamedCount: number;
  untrackedCount: number;
  conflictedCount: number;

  insertions?: number;
  deletions?: number;

  deltaScope: ChangeAttributionScope;
  files: RepositoryDeltaFile[];
}

/* ========================================================================== */
/* Change Attribution Record                                                  */
/* ========================================================================== */

export interface ChangeAttribution {
  id: string;
  workspaceId: string;

  targetType: ChangeAttributionTargetType;
  targetId: string;

  repositoryRoot: string;

  beforeSnapshotId?: string;
  afterSnapshotId?: string;

  status: ChangeAttributionStatus;
  scope: ChangeAttributionScope;

  delta?: RepositoryDelta;

  startedAt: number;
  completedAt?: number | null;

  /**
   * Transparent, semantic disclosures regarding attribution limits
   * (e.g. "Pre-existing uncommitted changes present at baseline", "Concurrent processes may have contributed").
   */
  limitations: string[];
}

/* ========================================================================== */
/* Repository Change Evidence (First-Class Evidence Artifact)                */
/* ========================================================================== */

export interface RepositoryChangeEvidence {
  id: string;
  attributionId: string;

  executionId?: string;
  verificationRunId?: string;
  agentRunId?: string;

  beforeSnapshotId: string;
  afterSnapshotId: string;

  repositoryRoot: string;
  delta: RepositoryDelta;

  createdAt: number;
}

/* ========================================================================== */
/* Type Guards                                                                */
/* ========================================================================== */

export function isChangeAttributionTargetType(
  value: unknown,
): value is ChangeAttributionTargetType {
  return (
    value === 'execution' ||
    value === 'verification-run' ||
    value === 'agent-run'
  );
}

export function isChangeAttributionStatus(
  value: unknown,
): value is ChangeAttributionStatus {
  return (
    value === 'pending' ||
    value === 'completed' ||
    value === 'partial' ||
    value === 'unavailable' ||
    value === 'failed'
  );
}

export function isChangeAttributionScope(
  value: unknown,
): value is ChangeAttributionScope {
  return (
    value === 'clean-baseline' ||
    value === 'dirty-baseline' ||
    value === 'partial' ||
    value === 'unsupported'
  );
}

export function isAttributionDeltaKind(
  value: unknown,
): value is AttributionDeltaKind {
  return (
    value === 'introduced' ||
    value === 'changed-further' ||
    value === 'removed' ||
    value === 'unchanged-existing'
  );
}

export function isRepositoryDelta(
  value: unknown,
): value is RepositoryDelta {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.filesChanged === 'number' &&
    typeof d.addedCount === 'number' &&
    typeof d.modifiedCount === 'number' &&
    Array.isArray(d.files) &&
    isChangeAttributionScope(d.deltaScope)
  );
}

export function isChangeAttribution(
  value: unknown,
): value is ChangeAttribution {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.id === 'string' &&
    typeof a.workspaceId === 'string' &&
    isChangeAttributionTargetType(a.targetType) &&
    typeof a.targetId === 'string' &&
    typeof a.repositoryRoot === 'string' &&
    isChangeAttributionStatus(a.status) &&
    isChangeAttributionScope(a.scope) &&
    typeof a.startedAt === 'number' &&
    Array.isArray(a.limitations)
  );
}

export function isRepositoryChangeEvidence(
  value: unknown,
): value is RepositoryChangeEvidence {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.attributionId === 'string' &&
    typeof e.beforeSnapshotId === 'string' &&
    typeof e.afterSnapshotId === 'string' &&
    typeof e.repositoryRoot === 'string' &&
    isRepositoryDelta(e.delta) &&
    typeof e.createdAt === 'number'
  );
}
