/**
 * TraceRelay / CapTerm Pure Repository Delta Engine
 *
 * Computes deterministic repository changes between two immutable RepositorySnapshots.
 *
 * CRITICAL INVARIANTS:
 * 1. Pure function: NEVER calls Git or shell commands. Operates solely on snapshot data.
 * 2. Honest baseline: Differentiates clean baseline from pre-existing dirty changes.
 * 3. Pre-existing changes are NOT attributed as newly introduced work.
 * 4. Summary-only limitations: Line counts are not fabricated when baseline was already modified.
 * 5. Concurrent mutation disclosure: Acknowledges that observed changes during window may have
 *    external contributors.
 */

import type {
  RepositorySnapshot,
  GitFileEvidence,
  GitDiffFileSummary,
} from '../evidenceCollectors/types';
import type {
  AttributionDeltaKind,
  ChangeAttributionScope,
  RepositoryDelta,
  RepositoryDeltaFile,
  RepositoryDeltaFileStatus,
} from './types';

/**
 * Computes the normalized RepositoryDelta comparing before and after snapshots.
 */
export function computeRepositoryDelta(
  before: RepositorySnapshot,
  after: RepositorySnapshot,
): RepositoryDelta {
  if (
    before.repositoryRoot &&
    after.repositoryRoot &&
    before.repositoryRoot !== after.repositoryRoot
  ) {
    throw new Error(
      `Cannot compute repository delta across different repository roots: '${before.repositoryRoot}' vs '${after.repositoryRoot}'`,
    );
  }

  const isCleanBaseline = before.status?.clean === true || (!before.status?.files?.length);
  const deltaScope: ChangeAttributionScope = isCleanBaseline
    ? 'clean-baseline'
    : 'dirty-baseline';

  const beforeFilesMap = new Map<string, GitFileEvidence>();
  for (const f of before.status?.files ?? []) {
    beforeFilesMap.set(f.path, f);
  }

  const beforeDiffMap = new Map<string, GitDiffFileSummary>();
  for (const d of before.diffSummary?.files ?? []) {
    beforeDiffMap.set(d.path, d);
  }

  const afterFilesMap = new Map<string, GitFileEvidence>();
  for (const f of after.status?.files ?? []) {
    afterFilesMap.set(f.path, f);
  }

  const afterDiffMap = new Map<string, GitDiffFileSummary>();
  for (const d of after.diffSummary?.files ?? []) {
    afterDiffMap.set(d.path, d);
  }

  const deltaFiles: RepositoryDeltaFile[] = [];

  // 1. Evaluate files present in AFTER snapshot
  for (const [path, afterFile] of afterFilesMap.entries()) {
    const beforeFile = beforeFilesMap.get(path);
    const afterDiff = afterDiffMap.get(path);
    const beforeDiff = beforeDiffMap.get(path);

    if (!beforeFile) {
      // File was not dirty/present in before status -> Newly introduced change
      const fileInsertions = afterDiff?.insertions ?? afterFile.insertions;
      const fileDeletions =
        afterDiff?.deletions ??
        (afterFile.status === 'untracked' ? (afterFile.deletions ?? 0) : afterFile.deletions);
      const isBinary = afterDiff?.binary ?? afterFile.binary;

      deltaFiles.push({
        path,
        previousPath: afterFile.previousPath,
        status: afterFile.status as RepositoryDeltaFileStatus,
        deltaKind: 'introduced',
        stagedBefore: false,
        stagedAfter: afterFile.staged,
        unstagedBefore: false,
        unstagedAfter: afterFile.unstaged,
        insertions: fileInsertions,
        deletions: fileDeletions,
        binary: isBinary,
      });
    } else {
      // File was already in before status. Check whether it changed further or remained unchanged.
      const statusChanged = beforeFile.status !== afterFile.status;
      const stagingChanged =
        beforeFile.staged !== afterFile.staged ||
        beforeFile.unstaged !== afterFile.unstaged;
      const numstatChanged =
        beforeDiff?.insertions !== afterDiff?.insertions ||
        beforeDiff?.deletions !== afterDiff?.deletions;

      const hasChanged = statusChanged || stagingChanged || numstatChanged;

      const deltaKind: AttributionDeltaKind = hasChanged
        ? 'changed-further'
        : 'unchanged-existing';

      // Line counts for dirty baseline:
      // If introduced/changed-further and both diffs exist, compute safe difference if possible
      let fileInsertions = afterDiff?.insertions ?? afterFile.insertions;
      let fileDeletions =
        afterDiff?.deletions ??
        (afterFile.status === 'untracked' ? (afterFile.deletions ?? 0) : afterFile.deletions);

      if (hasChanged && beforeDiff && afterDiff) {
        if (
          typeof afterDiff.insertions === 'number' &&
          typeof beforeDiff.insertions === 'number'
        ) {
          fileInsertions = Math.max(0, afterDiff.insertions - beforeDiff.insertions);
        }
        if (
          typeof afterDiff.deletions === 'number' &&
          typeof beforeDiff.deletions === 'number'
        ) {
          fileDeletions = Math.max(0, afterDiff.deletions - beforeDiff.deletions);
        }
      }

      deltaFiles.push({
        path,
        previousPath: afterFile.previousPath ?? beforeFile.previousPath,
        status: afterFile.status as RepositoryDeltaFileStatus,
        deltaKind,
        stagedBefore: beforeFile.staged,
        stagedAfter: afterFile.staged,
        unstagedBefore: beforeFile.unstaged,
        unstagedAfter: afterFile.unstaged,
        insertions: fileInsertions,
        deletions: fileDeletions,
        binary: afterDiff?.binary ?? beforeDiff?.binary,
      });
    }
  }

  // 2. Evaluate files present in BEFORE snapshot but missing from AFTER snapshot
  // (e.g. discarded modifications, reverted files, or tracked deletion committed)
  for (const [path, beforeFile] of beforeFilesMap.entries()) {
    if (!afterFilesMap.has(path)) {
      const beforeDiff = beforeDiffMap.get(path);
      deltaFiles.push({
        path,
        previousPath: beforeFile.previousPath,
        status: beforeFile.status as RepositoryDeltaFileStatus,
        deltaKind: 'removed',
        stagedBefore: beforeFile.staged,
        stagedAfter: false,
        unstagedBefore: beforeFile.unstaged,
        unstagedAfter: false,
        insertions: 0,
        deletions: beforeDiff?.deletions,
        binary: beforeDiff?.binary,
      });
    }
  }

  // 3. Aggregate totals only for files with actual observed delta during execution window
  // (i.e. exclude 'unchanged-existing' files from active delta counts)
  let addedCount = 0;
  let modifiedCount = 0;
  let deletedCount = 0;
  let renamedCount = 0;
  let untrackedCount = 0;
  let conflictedCount = 0;
  let totalInsertions: number | undefined;
  let totalDeletions: number | undefined;

  let activeChangesCount = 0;

  for (const file of deltaFiles) {
    if (file.deltaKind === 'unchanged-existing') {
      continue;
    }

    activeChangesCount += 1;

    switch (file.status) {
      case 'added':
        addedCount += 1;
        break;
      case 'modified':
        modifiedCount += 1;
        break;
      case 'deleted':
        deletedCount += 1;
        break;
      case 'renamed':
        renamedCount += 1;
        break;
      case 'untracked':
        untrackedCount += 1;
        break;
      case 'conflicted':
        conflictedCount += 1;
        break;
    }

    if (typeof file.insertions === 'number') {
      totalInsertions = (totalInsertions ?? 0) + file.insertions;
    }
    if (typeof file.deletions === 'number') {
      totalDeletions = (totalDeletions ?? 0) + file.deletions;
    }
  }

  // If clean baseline, preserve total numstat summary directly if available
  if (isCleanBaseline && after.diffSummary) {
    totalInsertions =
      after.diffSummary.totalObservedInsertions ??
      after.diffSummary.insertions ??
      totalInsertions;
    totalDeletions = after.diffSummary.deletions ?? totalDeletions;
  }

  return {
    filesChanged: activeChangesCount,
    addedCount,
    modifiedCount,
    deletedCount,
    renamedCount,
    untrackedCount,
    conflictedCount,
    insertions: totalInsertions,
    deletions: totalDeletions,
    deltaScope,
    files: deltaFiles,
  };
}

/**
 * Builds explicit semantic limitations for a computed attribution.
 */
export function deriveAttributionLimitations(
  scope: ChangeAttributionScope,
  delta?: RepositoryDelta,
): string[] {
  const limitations: string[] = [
    'Attribution reflects observed repository differences across the execution window; external processes, background tools, or concurrent human edits may have contributed.',
  ];

  if (scope === 'dirty-baseline') {
    limitations.push(
      'Repository contained uncommitted modifications prior to this execution. Pre-existing changes are separated at file summary level, but line-level additions and deletions may not be fully disjoint.',
    );
  }

  if (scope === 'partial') {
    limitations.push(
      'One or more repository collectors did not complete successfully. Attribution is partial.',
    );
  }

  if (scope === 'unsupported') {
    limitations.push('Working directory is not inside a supported Git repository.');
  }

  if (delta && delta.files.some((f) => f.binary)) {
    limitations.push('Binary files modified; line insertions and deletions are not available for binary content.');
  }

  return limitations;
}
