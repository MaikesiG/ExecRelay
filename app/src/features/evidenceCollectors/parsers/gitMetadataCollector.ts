import type {
  EvidenceCollector,
  EvidenceCollectorContext,
  RepositoryMetadataEvidence,
} from '../types';

export const GIT_METADATA_COLLECTOR_ID = 'git-repository-metadata';
export const GIT_METADATA_COLLECTOR_VERSION = '1.0.0';

/**
 * Collector that inspects the current repository root, active branch, and HEAD commit.
 */
export const gitMetadataCollector: EvidenceCollector = {
  id: GIT_METADATA_COLLECTOR_ID,
  version: GIT_METADATA_COLLECTOR_VERSION,
  type: 'git-repository-metadata',

  async supports(context: EvidenceCollectorContext): Promise<boolean> {
    const res = await context.runCommand({
      program: 'git',
      args: ['rev-parse', '--is-inside-work-tree'],
      cwd: context.repositoryRoot,
    });
    return res.exitCode === 0 && res.stdout.trim() === 'true';
  },

  async collect(
    context: EvidenceCollectorContext,
  ): Promise<RepositoryMetadataEvidence> {
    const cwd = context.repositoryRoot;

    // 1. Get HEAD commit hash
    const headRes = await context.runCommand({
      program: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd,
    });
    const headCommit =
      headRes.exitCode === 0 && headRes.stdout.trim().length > 0
        ? headRes.stdout.trim()
        : undefined;

    // 2. Get active branch name
    const branchRes = await context.runCommand({
      program: 'git',
      args: ['branch', '--show-current'],
      cwd,
    });
    let branch: string | undefined;
    let detachedHead = false;

    if (branchRes.exitCode === 0) {
      const b = branchRes.stdout.trim();
      if (b.length > 0) {
        branch = b;
      } else if (headCommit) {
        detachedHead = true;
        branch = `HEAD detached at ${headCommit.slice(0, 7)}`;
      }
    }

    return {
      id: `${context.collectionRunId}-git-meta`,
      type: 'repository-metadata',
      vcs: 'git',
      collectorId: GIT_METADATA_COLLECTOR_ID,
      collectorVersion: GIT_METADATA_COLLECTOR_VERSION,
      collectionRunId: context.collectionRunId,
      workspaceId: context.workspaceId,
      repositoryRoot: context.repositoryRoot,
      createdAt: Date.now(),
      branch,
      headCommit,
      detachedHead: detachedHead || undefined,
    };
  },
};
