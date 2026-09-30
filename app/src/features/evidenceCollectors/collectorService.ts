/**
 * TraceRelay / CapTerm Evidence Collector Orchestration Service
 *
 * Coordinates execution of read-only evidence collectors against a target repository,
 * builds point-in-time RepositorySnapshots, and tracks EvidenceCollectionRun provenance.
 *
 * INVARIANTS:
 * 1. Safe process execution boundary: no shell strings or command concatenation.
 * 2. Unsupported repositories are cleanly reported with status 'unsupported' without raising an error.
 * 3. Individual collector errors are safely isolated.
 * 4. Produced RepositorySnapshots are immutable.
 */

import { DEFAULT_COLLECTOR_REGISTRY } from './collectorRegistry';
import { runCollectorProcess } from './collectorRunner';
import { resolveRepositoryRoot } from './repositoryResolver';
import type {
  CollectorCommandInput,
  CollectorCommandOutput,
  EvidenceCollectionRun,
  EvidenceCollector,
  EvidenceCollectorContext,
  GitDiffSummaryEvidence,
  GitStatusEvidence,
  RepositoryMetadataEvidence,
  RepositorySnapshot,
} from './types';

export interface CollectRepositoryOptions {
  workspaceId: string;
  repositoryRoot?: string;
  cwd?: string;
  collectors?: readonly EvidenceCollector[];
  runner?: (input: CollectorCommandInput) => Promise<CollectorCommandOutput>;
}

export interface CollectionResult {
  run: EvidenceCollectionRun;
  snapshot?: RepositorySnapshot;
}

/**
 * Actively collects repository engineering evidence (metadata, status, diff summary)
 * for a workspace and creates an immutable snapshot.
 */
export async function collectRepositoryEvidence(
  options: CollectRepositoryOptions,
): Promise<CollectionResult> {
  const runner = options.runner ?? runCollectorProcess;
  const collectors = options.collectors ?? DEFAULT_COLLECTOR_REGISTRY;
  const startedAt = Date.now();
  const collectionRunId = `col-run-${startedAt}-${Math.random().toString(36).slice(2, 7)}`;

  const collectorIds = collectors.map((c) => c.id);

  const run: EvidenceCollectionRun = {
    id: collectionRunId,
    workspaceId: options.workspaceId,
    collectorIds,
    status: 'running',
    startedAt,
    completedAt: null,
  };

  try {
    // 1. Resolve repository root (explicit repositoryRoot takes strict precedence)
    const repoRoot =
      (options.repositoryRoot && options.repositoryRoot.trim().length > 0
        ? options.repositoryRoot.trim()
        : null) ?? (await resolveRepositoryRoot(options.cwd, runner));

    if (!repoRoot) {
      run.status = 'unsupported';
      run.errorMessage = 'Directory is not inside a Git repository';
      run.completedAt = Date.now();
      return { run };
    }

    run.repositoryRoot = repoRoot;

    const context: EvidenceCollectorContext = {
      workspaceId: options.workspaceId,
      repositoryRoot: repoRoot,
      collectionRunId,
      runCommand: runner,
    };

    let metadata: RepositoryMetadataEvidence | undefined;
    let status: GitStatusEvidence | undefined;
    let diffSummary: GitDiffSummaryEvidence | undefined;

    // 2. Execute each supported collector with error isolation
    for (const collector of collectors) {
      try {
        const isSupported = await collector.supports(context);
        if (!isSupported) {
          continue;
        }

        const evidence = await collector.collect(context);
        if (evidence.type === 'repository-metadata') {
          metadata = evidence as RepositoryMetadataEvidence;
        } else if (evidence.type === 'git-status') {
          status = evidence as GitStatusEvidence;
        } else if (evidence.type === 'git-diff-summary') {
          diffSummary = evidence as GitDiffSummaryEvidence;
        }
      } catch (err) {
        console.warn(
          `[EvidenceCollectorService] Collector '${collector.id}' failed safely for workspace '${options.workspaceId}':`,
          err,
        );
      }
    }

    // 3. Compute derived totals across Git numstat and untracked file line counts
    if (diffSummary) {
      let untrackedInsertions = 0;
      if (status?.files) {
        for (const f of status.files) {
          if (f.status === 'untracked' && typeof f.insertions === 'number') {
            untrackedInsertions += f.insertions;
          }
        }
      }
      diffSummary.untrackedInsertions = untrackedInsertions;
      diffSummary.totalObservedInsertions = (diffSummary.insertions ?? 0) + untrackedInsertions;
    }

    // 4. Assemble immutable snapshot
    const snapshot: RepositorySnapshot = {
      id: `snap-${collectionRunId}`,
      collectionRunId,
      workspaceId: options.workspaceId,
      repositoryRoot: repoRoot,
      createdAt: Date.now(),
      metadata,
      status,
      diffSummary,
    };

    run.status = 'completed';
    run.completedAt = Date.now();

    return {
      run,
      snapshot,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[EvidenceCollectorService] Repository collection failed for workspace '${options.workspaceId}':`,
      err,
    );
    run.status = 'failed';
    run.errorMessage = errMsg;
    run.completedAt = Date.now();
    return { run };
  }
}
