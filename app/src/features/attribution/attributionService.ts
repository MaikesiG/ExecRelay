/**
 * TraceRelay / CapTerm Change Attribution Orchestration Service
 *
 * Coordinates before and after repository snapshots, computes repository deltas,
 * produces immutable ChangeAttribution records and first-class RepositoryChangeEvidence.
 *
 * CRITICAL INVARIANTS:
 * 1. Collector failures NEVER alter user Execution outcome or Verification verdict.
 * 2. Produced attributions and snapshots are strictly immutable.
 * 3. Unavailable or partial snapshots are recorded transparently without fabricating deltas.
 */

import { computeRepositoryDelta, deriveAttributionLimitations } from './deltaEngine';
import type {
  ChangeAttribution,
  ChangeAttributionStatus,
  ChangeAttributionScope,
  ChangeAttributionTargetType,
  RepositoryChangeEvidence,
  RepositoryDelta,
} from './types';
import type { RepositorySnapshot } from '../evidenceCollectors/types';

export interface CreatePendingAttributionOptions {
  workspaceId: string;
  targetType: ChangeAttributionTargetType;
  targetId: string;
  repositoryRoot?: string;
  beforeSnapshotId?: string;
}

export interface FinalizeAttributionOptions {
  attribution: ChangeAttribution;
  beforeSnapshot?: RepositorySnapshot | null;
  afterSnapshot?: RepositorySnapshot | null;
  errorMessage?: string;
}

/**
 * Creates a pending attribution record at the start of a tracked execution window.
 */
export function createPendingAttribution(
  options: CreatePendingAttributionOptions,
): ChangeAttribution {
  const startedAt = Date.now();
  const id = `attr-${startedAt}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    workspaceId: options.workspaceId,
    targetType: options.targetType,
    targetId: options.targetId,
    repositoryRoot: options.repositoryRoot ?? '',
    beforeSnapshotId: options.beforeSnapshotId,
    status: 'pending',
    scope: 'partial',
    startedAt,
    completedAt: null,
    limitations: [],
  };
}

/**
 * Finalizes an attribution record given the before and after RepositorySnapshots.
 */
export function finalizeChangeAttribution(
  options: FinalizeAttributionOptions,
): ChangeAttribution {
  const { attribution, beforeSnapshot, afterSnapshot, errorMessage } = options;
  const completedAt = Date.now();

  // Case 1: Before snapshot was unavailable or failed
  if (!beforeSnapshot) {
    const limitations = [
      'Pre-execution repository snapshot was unavailable. Cannot compute relative change delta.',
      ...(errorMessage ? [`Collector error: ${errorMessage}`] : []),
      ...deriveAttributionLimitations('partial'),
    ];

    return {
      ...attribution,
      status: 'unavailable',
      scope: 'partial',
      completedAt,
      limitations,
    };
  }

  // Case 2: After snapshot was unavailable or failed
  if (!afterSnapshot) {
    const limitations = [
      'Post-execution repository snapshot could not be collected. Attribution is incomplete.',
      ...(errorMessage ? [`Collector error: ${errorMessage}`] : []),
      ...deriveAttributionLimitations('partial'),
    ];

    return {
      ...attribution,
      beforeSnapshotId: beforeSnapshot.id,
      repositoryRoot: beforeSnapshot.repositoryRoot,
      status: 'partial',
      scope: 'partial',
      completedAt,
      limitations,
    };
  }

  // Case 2b: Snapshots belong to different repository roots (Section 19)
  if (
    beforeSnapshot.repositoryRoot &&
    afterSnapshot.repositoryRoot &&
    beforeSnapshot.repositoryRoot !== afterSnapshot.repositoryRoot
  ) {
    const limitations = [
      `Cross-repository attribution forbidden: before snapshot '${beforeSnapshot.repositoryRoot}' does not match after snapshot '${afterSnapshot.repositoryRoot}'.`,
      ...deriveAttributionLimitations('partial'),
    ];

    return {
      ...attribution,
      beforeSnapshotId: beforeSnapshot.id,
      afterSnapshotId: afterSnapshot.id,
      repositoryRoot: beforeSnapshot.repositoryRoot,
      status: 'failed',
      scope: 'partial',
      completedAt,
      limitations,
    };
  }

  // Case 3: Both snapshots successfully available
  const delta: RepositoryDelta = computeRepositoryDelta(beforeSnapshot, afterSnapshot);
  const scope: ChangeAttributionScope = delta.deltaScope;
  const status: ChangeAttributionStatus = 'completed';
  const limitations = deriveAttributionLimitations(scope, delta);

  return {
    ...attribution,
    beforeSnapshotId: beforeSnapshot.id,
    afterSnapshotId: afterSnapshot.id,
    repositoryRoot: afterSnapshot.repositoryRoot || beforeSnapshot.repositoryRoot,
    status,
    scope,
    delta,
    completedAt,
    limitations,
  };
}

/**
 * Creates a first-class RepositoryChangeEvidence artifact from a completed attribution.
 */
export function createRepositoryChangeEvidence(
  attribution: ChangeAttribution,
): RepositoryChangeEvidence | null {
  if (!attribution.delta || !attribution.beforeSnapshotId || !attribution.afterSnapshotId) {
    return null;
  }

  return {
    id: `rce-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    attributionId: attribution.id,
    executionId: attribution.targetType === 'execution' ? attribution.targetId : undefined,
    verificationRunId:
      attribution.targetType === 'verification-run' ? attribution.targetId : undefined,
    agentRunId: attribution.targetType === 'agent-run' ? attribution.targetId : undefined,
    beforeSnapshotId: attribution.beforeSnapshotId,
    afterSnapshotId: attribution.afterSnapshotId,
    repositoryRoot: attribution.repositoryRoot,
    delta: attribution.delta,
    createdAt: Date.now(),
  };
}
