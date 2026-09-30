/**
 * TraceRelay / CapTerm Evidence Collectors Foundation
 *
 * Domain types for active evidence collection (Git repository metadata,
 * working tree status, diff summary metrics).
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. A Collector ACTIVELY GATHERS additional engineering evidence; a Parser INTERPRETS existing output.
 * 2. Collected evidence is DERIVED supplementary evidence; it never overrides Execution outcome or Verification verdict.
 * 3. V1 collectors are strictly read-only and operate without shell interpolation (`program` + `args`).
 * 4. Full diff bodies and remote credentials are not persisted by default.
 * 5. Repository snapshots are immutable point-in-time observations.
 * 6. Every collected object maintains provenance (`collectorId`, `collectorVersion`, `collectionRunId`, `repositoryRoot`).
 */

/* ========================================================================== */
/* Collector Definition & Status                                              */
/* ========================================================================== */

export type EvidenceCollectorType =
  | 'git-repository-metadata'
  | 'git-status'
  | 'git-diff-summary';

export type EvidenceCollectionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'unsupported';

export interface EvidenceCollectorDefinition {
  id: string;
  type: EvidenceCollectorType;
  version: string;
  name: string;
}

/**
 * Audit record of an evidence collection execution.
 */
export interface EvidenceCollectionRun {
  id: string;
  workspaceId: string;
  repositoryRoot?: string;
  collectorIds: string[];
  status: EvidenceCollectionStatus;
  startedAt: number;
  completedAt?: number | null;
  executionIds?: string[];
  errorMessage?: string | null;
}

/* ========================================================================== */
/* Base Collected Evidence                                                    */
/* ========================================================================== */

export interface CollectedEvidenceBase {
  id: string;
  type: string;
  collectorId: string;
  collectorVersion: string;
  collectionRunId: string;
  workspaceId: string;
  repositoryRoot: string;
  executionId?: string;
  createdAt: number;
}

/* ========================================================================== */
/* 1. Git Repository Metadata Evidence                                        */
/* ========================================================================== */

export interface RepositoryMetadataEvidence extends CollectedEvidenceBase {
  type: 'repository-metadata';
  vcs: 'git';
  branch?: string;
  headCommit?: string;
  detachedHead?: boolean;
}

/* ========================================================================== */
/* 2. Git Working-Tree Status Evidence                                        */
/* ========================================================================== */

export type RepositoryFileLineStatsSource =
  | 'git-numstat'
  | 'working-tree-line-count'
  | 'unavailable';

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted';

export interface GitFileEvidence {
  path: string;
  previousPath?: string;
  status: GitFileStatus;
  staged?: boolean;
  unstaged?: boolean;
  insertions?: number;
  deletions?: number;
  binary?: boolean;
  lineStatsSource?: RepositoryFileLineStatsSource;
}

export interface GitStatusEvidence extends CollectedEvidenceBase {
  type: 'git-status';
  clean: boolean;
  files: GitFileEvidence[];
  modifiedCount: number;
  addedCount: number;
  deletedCount: number;
  renamedCount: number;
  untrackedCount: number;
  conflictedCount: number;
}

/* ========================================================================== */
/* 3. Git Diff Summary Evidence                                               */
/* ========================================================================== */

export interface GitDiffFileSummary {
  path: string;
  insertions?: number;
  deletions?: number;
  binary?: boolean;
  source?: RepositoryFileLineStatsSource;
}

export interface GitDiffSummaryEvidence extends CollectedEvidenceBase {
  type: 'git-diff-summary';
  filesChanged: number;
  insertions?: number;
  deletions?: number;
  untrackedInsertions?: number;
  totalObservedInsertions?: number;
  files: GitDiffFileSummary[];
  scope: 'all' | 'unstaged' | 'staged';
}

/* ========================================================================== */
/* Point-in-time Repository Snapshot                                          */
/* ========================================================================== */

export interface RepositorySnapshot {
  id: string;
  collectionRunId: string;
  workspaceId: string;
  repositoryRoot: string;
  createdAt: number;
  metadata?: RepositoryMetadataEvidence;
  status?: GitStatusEvidence;
  diffSummary?: GitDiffSummaryEvidence;
}

/* ========================================================================== */
/* Safe Native Command Invocation Contracts                                   */
/* ========================================================================== */

export interface CollectorCommandInput {
  program: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface CollectorCommandOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface EvidenceCollectorContext {
  workspaceId: string;
  repositoryRoot: string;
  collectionRunId: string;
  runCommand: (input: CollectorCommandInput) => Promise<CollectorCommandOutput>;
}

export interface EvidenceCollector {
  id: string;
  version: string;
  type: EvidenceCollectorType;
  supports(context: EvidenceCollectorContext): Promise<boolean>;
  collect(context: EvidenceCollectorContext): Promise<CollectedEvidenceBase>;
}

/* ========================================================================== */
/* Type Guards                                                                */
/* ========================================================================== */

export function isEvidenceCollectionStatus(
  value: unknown,
): value is EvidenceCollectionStatus {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'unsupported'
  );
}

export function isEvidenceCollectionRun(
  value: unknown,
): value is EvidenceCollectionRun {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.workspaceId === 'string' &&
    Array.isArray(r.collectorIds) &&
    isEvidenceCollectionStatus(r.status) &&
    typeof r.startedAt === 'number'
  );
}

export function isRepositoryMetadataEvidence(
  value: unknown,
): value is RepositoryMetadataEvidence {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    e.type === 'repository-metadata' &&
    e.vcs === 'git' &&
    typeof e.repositoryRoot === 'string' &&
    typeof e.collectorId === 'string'
  );
}

export function isGitStatusEvidence(
  value: unknown,
): value is GitStatusEvidence {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    e.type === 'git-status' &&
    typeof e.clean === 'boolean' &&
    Array.isArray(e.files) &&
    typeof e.modifiedCount === 'number' &&
    typeof e.addedCount === 'number'
  );
}

export function isGitDiffSummaryEvidence(
  value: unknown,
): value is GitDiffSummaryEvidence {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    e.type === 'git-diff-summary' &&
    typeof e.filesChanged === 'number' &&
    Array.isArray(e.files)
  );
}

export function isRepositorySnapshot(
  value: unknown,
): value is RepositorySnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.collectionRunId === 'string' &&
    typeof s.workspaceId === 'string' &&
    typeof s.repositoryRoot === 'string' &&
    typeof s.createdAt === 'number'
  );
}
