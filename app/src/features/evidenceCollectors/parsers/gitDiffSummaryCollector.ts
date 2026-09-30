import type {
  EvidenceCollector,
  EvidenceCollectorContext,
  GitDiffFileSummary,
  GitDiffSummaryEvidence,
} from '../types';

export const GIT_DIFF_SUMMARY_COLLECTOR_ID = 'git-diff-summary';
export const GIT_DIFF_SUMMARY_COLLECTOR_VERSION = '1.0.0';

/**
 * Parses machine-readable NUL-delimited output from `git diff --numstat -z`.
 * Properly extracts line insertions, deletions, binary files, and filenames with spaces or renames.
 */
export function parseGitNumstatZ(output: string): GitDiffFileSummary[] {
  if (!output || output.length === 0) {
    return [];
  }

  const tokens = output.split('\0');
  const files: GitDiffFileSummary[] = [];

  let i = 0;
  while (i < tokens.length) {
    const entry = tokens[i];
    i++;
    if (!entry) continue;

    const tabParts = entry.split('\t');
    if (tabParts.length < 3) continue;

    const insStr = tabParts[0].trim();
    const delStr = tabParts[1].trim();
    let filePath = tabParts.slice(2).join('\t');

    // In -z mode for renames, filePath is empty, and the next two tokens are oldPath and newPath
    if (!filePath && i < tokens.length) {
      const _oldPath = tokens[i];
      i++;
      const newPath = i < tokens.length ? tokens[i] : undefined;
      if (newPath !== undefined) {
        i++;
      }
      filePath = newPath || _oldPath || 'renamed-file';
    }

    const isBinary = insStr === '-' && delStr === '-';
    const insNum = isBinary ? undefined : parseInt(insStr, 10);
    const delNum = isBinary ? undefined : parseInt(delStr, 10);

    files.push({
      path: filePath,
      insertions: insNum !== undefined && !isNaN(insNum) ? insNum : undefined,
      deletions: delNum !== undefined && !isNaN(delNum) ? delNum : undefined,
      binary: isBinary ? true : undefined,
      source: isBinary ? 'unavailable' : 'git-numstat',
    });
  }

  return files;
}

/**
 * Collector that inspects working-tree and staged diff metrics.
 * Note: Never gathers or persists full patch text.
 */
export const gitDiffSummaryCollector: EvidenceCollector = {
  id: GIT_DIFF_SUMMARY_COLLECTOR_ID,
  version: GIT_DIFF_SUMMARY_COLLECTOR_VERSION,
  type: 'git-diff-summary',

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
  ): Promise<GitDiffSummaryEvidence> {
    const cwd = context.repositoryRoot;

    // 1. Gather unstaged diff numstat
    const unstagedRes = await context.runCommand({
      program: 'git',
      args: ['diff', '--numstat', '-z'],
      cwd,
    });

    // 2. Gather staged diff numstat
    const stagedRes = await context.runCommand({
      program: 'git',
      args: ['diff', '--cached', '--numstat', '-z'],
      cwd,
    });

    const unstagedFiles = parseGitNumstatZ(unstagedRes.stdout);
    const stagedFiles = parseGitNumstatZ(stagedRes.stdout);

    // Merge by path
    const fileMap = new Map<string, GitDiffFileSummary>();

    for (const f of stagedFiles) {
      fileMap.set(f.path, { ...f, source: f.binary ? 'unavailable' : 'git-numstat' });
    }

    for (const f of unstagedFiles) {
      const existing = fileMap.get(f.path);
      if (!existing) {
        fileMap.set(f.path, { ...f, source: f.binary ? 'unavailable' : 'git-numstat' });
      } else {
        const isBinary = existing.binary || f.binary;
        fileMap.set(f.path, {
          path: f.path,
          insertions: (existing.insertions ?? 0) + (f.insertions ?? 0),
          deletions: (existing.deletions ?? 0) + (f.deletions ?? 0),
          binary: isBinary,
          source: isBinary ? 'unavailable' : 'git-numstat',
        });
      }
    }

    const mergedFiles = Array.from(fileMap.values());
    let totalInsertions = 0;
    let totalDeletions = 0;
    let hasCountableLines = false;

    for (const f of mergedFiles) {
      if (f.insertions !== undefined) {
        totalInsertions += f.insertions;
        hasCountableLines = true;
      }
      if (f.deletions !== undefined) {
        totalDeletions += f.deletions;
        hasCountableLines = true;
      }
    }

    return {
      id: `${context.collectionRunId}-git-diff`,
      type: 'git-diff-summary',
      collectorId: GIT_DIFF_SUMMARY_COLLECTOR_ID,
      collectorVersion: GIT_DIFF_SUMMARY_COLLECTOR_VERSION,
      collectionRunId: context.collectionRunId,
      workspaceId: context.workspaceId,
      repositoryRoot: context.repositoryRoot,
      createdAt: Date.now(),
      filesChanged: mergedFiles.length,
      insertions: hasCountableLines ? totalInsertions : undefined,
      deletions: hasCountableLines ? totalDeletions : undefined,
      files: mergedFiles,
      scope: 'all',
    };
  },
};
