import type {
  EvidenceCollector,
  EvidenceCollectorContext,
  GitFileEvidence,
  GitFileStatus,
  GitStatusEvidence,
} from '../types';
import { inspectUntrackedFileLineStats } from '../untrackedFileLineStats';

export const GIT_STATUS_COLLECTOR_ID = 'git-status';
export const GIT_STATUS_COLLECTOR_VERSION = '1.0.0';

/**
 * Parses machine-readable NUL-delimited output from `git status --porcelain=v1 -z`.
 * Properly handles spaces in filenames, Unicode characters, and rename pairs without quotes.
 */
export function parseGitPorcelainV1Z(output: string): GitFileEvidence[] {
  if (!output || output.length === 0) {
    return [];
  }

  const files: GitFileEvidence[] = [];
  // Split by NUL byte (\0)
  const tokens = output.split('\0');
  let i = 0;

  while (i < tokens.length) {
    const entry = tokens[i];
    i++;
    if (!entry || entry.length < 3) continue;

    const x = entry[0];
    const y = entry[1];
    // entry format: "XY <path>"
    const rawPath = entry.slice(3);

    const staged = x !== ' ' && x !== '?';
    const unstaged = y !== ' ' && y !== '?';

    let status: GitFileStatus;
    let previousPath: string | undefined;

    // Check conflict states first
    const isConflict =
      (x === 'U' || y === 'U') ||
      (x === 'A' && y === 'A') ||
      (x === 'D' && y === 'D');

    if (isConflict) {
      status = 'conflicted';
    } else if (x === '?' && y === '?') {
      status = 'untracked';
    } else if (x === 'R' || y === 'R') {
      status = 'renamed';
      // In -z mode, the next token is the original path before rename
      if (i < tokens.length) {
        previousPath = tokens[i];
        i++;
      }
    } else if (x === 'C' || y === 'C') {
      status = 'copied';
      if (i < tokens.length) {
        previousPath = tokens[i];
        i++;
      }
    } else if (x === 'A' || y === 'A') {
      status = 'added';
    } else if (x === 'D' || y === 'D') {
      status = 'deleted';
    } else {
      status = 'modified';
    }

    files.push({
      path: rawPath,
      previousPath,
      status,
      staged,
      unstaged,
    });
  }

  return files;
}

/**
 * Collector that inspects the working-tree and staging area status.
 */
export const gitStatusCollector: EvidenceCollector = {
  id: GIT_STATUS_COLLECTOR_ID,
  version: GIT_STATUS_COLLECTOR_VERSION,
  type: 'git-status',

  async supports(context: EvidenceCollectorContext): Promise<boolean> {
    const res = await context.runCommand({
      program: 'git',
      args: ['rev-parse', '--is-inside-work-tree'],
      cwd: context.repositoryRoot,
    });
    return res.exitCode === 0 && res.stdout.trim() === 'true';
  },

  async collect(context: EvidenceCollectorContext): Promise<GitStatusEvidence> {
    const res = await context.runCommand({
      program: 'git',
      args: ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      cwd: context.repositoryRoot,
    });

    if (res.exitCode !== 0) {
      throw new Error(
        `git status failed with exit code ${res.exitCode}: ${res.stderr}`,
      );
    }

    const files = parseGitPorcelainV1Z(res.stdout);

    let modifiedCount = 0;
    let addedCount = 0;
    let deletedCount = 0;
    let renamedCount = 0;
    let untrackedCount = 0;
    let conflictedCount = 0;

    for (const f of files) {
      switch (f.status) {
        case 'modified':
          modifiedCount++;
          break;
        case 'added':
          addedCount++;
          break;
        case 'deleted':
          deletedCount++;
          break;
        case 'renamed':
        case 'copied':
          renamedCount++;
          break;
        case 'untracked':
          untrackedCount++;
          break;
        case 'conflicted':
          conflictedCount++;
          break;
      }
    }

    // Inspect untracked files to derive safe working-tree line counts
    for (const f of files) {
      if (f.status === 'untracked') {
        try {
          const stats = await inspectUntrackedFileLineStats(
            context.repositoryRoot,
            f.path,
            { runCommand: context.runCommand },
          );
          if (stats.status === 'computed') {
            f.insertions = stats.additions;
            f.deletions = stats.deletions ?? 0;
            f.binary = false;
            f.lineStatsSource = 'working-tree-line-count';
          } else {
            f.binary = stats.binary;
            f.lineStatsSource = 'unavailable';
          }
        } catch {
          f.lineStatsSource = 'unavailable';
        }
      }
    }

    return {
      id: `${context.collectionRunId}-git-status`,
      type: 'git-status',
      collectorId: GIT_STATUS_COLLECTOR_ID,
      collectorVersion: GIT_STATUS_COLLECTOR_VERSION,
      collectionRunId: context.collectionRunId,
      workspaceId: context.workspaceId,
      repositoryRoot: context.repositoryRoot,
      createdAt: Date.now(),
      clean: files.length === 0,
      files,
      modifiedCount,
      addedCount,
      deletedCount,
      renamedCount,
      untrackedCount,
      conflictedCount,
    };
  },
};
