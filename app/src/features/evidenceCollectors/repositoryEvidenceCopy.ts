/**
 * Repository Evidence Copy Semantics (HARDEN-008)
 *
 * Implements deterministic, bounded, provenance-aware clipboard formatting and evidence resolution
 * for repository changes.
 *
 * INVARIANTS:
 * 1. Per-file copy copies actual change evidence (Git diff for tracked, working-tree content for untracked).
 * 2. Header exposes explicit 'Copy paths' (lightweight inventory) and 'Copy changes' (full change evidence).
 * 3. Canonical GitFileStatus is never mutated (untracked remains 'untracked').
 * 4. Binary files omit raw binary bytes and render an explicit 'Content: binary' disclosure.
 * 5. Bounded reads: per-file limit (64 KiB) and aggregate limit (512 KiB) with explicit truncation markers.
 * 6. Structured execution: never interpolates repository paths into shell strings.
 * 7. Presentation-only UI: React components call services/formatters, never reading filesystem directly.
 */

import type { GitFileStatus, RepositoryFileLineStatsSource } from './types';
import { getRepositoryFileStatusPresentation } from './fileStatusPresentation';
import { isBinaryBuffer, type MinimalFsApi } from './untrackedFileLineStats';

export const MAX_PER_FILE_COPY_BYTES = 64 * 1024; // 64 KiB
export const MAX_AGGREGATE_COPY_BYTES = 512 * 1024; // 512 KiB

/**
 * Resolved evidence item for a single repository file ready for clipboard formatting.
 */
export interface RepositoryFileEvidenceResolved {
  path: string;
  previousPath?: string;
  status: GitFileStatus | string;
  insertions?: number;
  deletions?: number;
  binary?: boolean;
  lineStatsSource?: RepositoryFileLineStatsSource;
  evidenceSource?: string;
  patch?: string;
  content?: string;
  language?: string;
  truncated?: boolean;
  unavailableReason?: string;
}

export interface FormatRepositoryPathsOptions {
  files: Array<{
    path: string;
    previousPath?: string;
    status?: GitFileStatus | string;
  }>;
  branch?: string;
  headCommit?: string;
}

export interface FormatRepositoryChangesOptions {
  files: RepositoryFileEvidenceResolved[];
  branch?: string;
  headCommit?: string;
  totalInsertions?: number;
  totalDeletions?: number;
  maxAggregateBytes?: number;
}

export interface ResolveEvidenceOptions {
  repositoryRoot: string;
  runCommand?: (input: {
    program: string;
    args: string[];
    cwd?: string;
    timeoutMs?: number;
  }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  fsModule?: MinimalFsApi | unknown;
  maxPerFileBytes?: number;
}

/**
 * Maps common file extensions to markdown code block language identifiers.
 */
export function getLanguageForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
      return 'ts';
    case 'tsx':
      return 'tsx';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'js';
    case 'jsx':
      return 'jsx';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'html':
      return 'html';
    case 'rs':
      return 'rust';
    case 'py':
      return 'python';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'bash';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'toml':
      return 'toml';
    case 'sql':
      return 'sql';
    default:
      return '';
  }
}

/**
 * Safely encloses text in markdown code fences without breaking if the text contains backticks.
 */
export function fenceCode(code: string, lang: string = ''): string {
  let fence = '```';
  while (code.includes(fence)) {
    fence += '`';
  }
  return `${fence}${lang}\n${code}\n${fence}`;
}

/**
 * Extracts unified diff hunks from a raw git diff output starting at the first `@@` marker.
 * If no `@@` marker is present (e.g. pure file rename, permission change, or custom diff),
 * returns the full trimmed diff.
 */
export function extractHunkOrDiff(rawDiff: string): string {
  if (!rawDiff) return '';
  const trimmed = rawDiff.trim();
  const hunkIndex = trimmed.indexOf('@@');
  if (hunkIndex !== -1) {
    return trimmed.slice(hunkIndex).trim();
  }
  return trimmed;
}

/**
 * Splits a full multi-file unified git diff output into individual file diffs keyed by target file path.
 */
export function splitGitDiffByFile(fullDiff: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fullDiff || fullDiff.trim().length === 0) return map;

  const lines = fullDiff.split('\n');
  let currentFile: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (currentFile && currentLines.length > 0) {
        map.set(currentFile, currentLines.join('\n'));
      }
      const parts = line.slice('diff --git '.length).trim();
      const bIdx = parts.lastIndexOf(' b/');
      if (bIdx !== -1) {
        let bPath = parts.slice(bIdx + 3).trim();
        if (bPath.startsWith('"') && bPath.endsWith('"')) {
          bPath = bPath.slice(1, -1);
        }
        currentFile = bPath;
        currentLines = [line];
      } else {
        currentFile = null;
        currentLines = [];
      }
    } else if (currentFile) {
      currentLines.push(line);
    }
  }

  if (currentFile && currentLines.length > 0) {
    map.set(currentFile, currentLines.join('\n'));
  }

  return map;
}

/**
 * Formats a lightweight changed-files inventory for clipboard copying (Copy paths).
 *
 * Example:
 * # Repository Changed Files
 *
 * Branch: main
 * Baseline: f263cbf
 *
 * M app/src/App.tsx
 * + app/src/features/monitor/MonitorPane.tsx
 * A app/src/NewService.ts
 * D app/src/OldPanel.tsx
 * R app/src/OldView.tsx -> app/src/EvidenceView.tsx
 */
export function formatRepositoryPathsForClipboard(
  options: FormatRepositoryPathsOptions,
): string {
  const lines: string[] = ['# Repository Changed Files'];
  const headerMeta: string[] = [];

  if (options.branch) {
    headerMeta.push(`Branch: ${options.branch}`);
  }
  if (options.headCommit) {
    headerMeta.push(`Baseline: ${options.headCommit.slice(0, 7)}`);
  }

  if (headerMeta.length > 0) {
    lines.push('');
    lines.push(...headerMeta);
  }

  lines.push('');

  if (!options.files || options.files.length === 0) {
    lines.push('No repository changes observed.');
    return lines.join('\n');
  }

  for (const file of options.files) {
    const pres = getRepositoryFileStatusPresentation(file.status);
    let pathStr = file.path;
    if (file.previousPath) {
      pathStr = `${file.previousPath} -> ${file.path}`;
    }
    lines.push(`${pres.label} ${pathStr}`);
  }

  return lines.join('\n');
}

/**
 * Formats change evidence for a single repository file.
 * Used for both individual row copy ("Copy change evidence") and as the building block
 * for aggregate changes copy ("Copy changes").
 */
export function formatRepositoryFileChangeEvidence(
  file: RepositoryFileEvidenceResolved,
): string {
  const lines: string[] = [];

  // Header path: show rename old -> new if available
  let headerPath = file.path;
  if (file.previousPath) {
    headerPath = `${file.previousPath} -> ${file.path}`;
  }
  lines.push(`## ${headerPath}`);
  lines.push('');

  // Status (canonical status name)
  const canonicalStatus = String(file.status || 'unknown').toLowerCase();
  lines.push(`Status: ${canonicalStatus}`);

  // Observed line changes
  if (file.insertions !== undefined || file.deletions !== undefined) {
    const ins = file.insertions ?? 0;
    const del = file.deletions ?? 0;
    lines.push(`Observed line changes: +${ins} -${del}`);
  }

  // Binary file
  if (file.binary) {
    lines.push('Content: binary');
    lines.push('Content body omitted.');
    return lines.join('\n');
  }

  // Evidence source
  const source = file.evidenceSource || (canonicalStatus === 'untracked' ? 'current working-tree file' : 'Git diff');
  lines.push(`Evidence source: ${source}`);
  lines.push('');

  // Content or Patch
  if (file.patch) {
    let patchText = file.patch;
    if (file.truncated) {
      patchText += `\n[TRUNCATED: repository evidence for ${file.path} exceeded copy limit]`;
    }
    lines.push(fenceCode(patchText, 'diff'));
  } else if (file.content !== undefined) {
    let contentText = file.content;
    if (file.truncated) {
      contentText += `\n[TRUNCATED: repository evidence for ${file.path} exceeded copy limit]`;
    }
    const lang = file.language ?? getLanguageForPath(file.path);
    lines.push(fenceCode(contentText, lang));
  } else if (file.unavailableReason) {
    lines.push(file.unavailableReason);
  } else {
    lines.push('Content unavailable from collected repository evidence.');
  }

  return lines.join('\n');
}

/**
 * Formats all repository change evidence into a coherent Markdown document for AI analysis (Copy changes).
 */
export function formatRepositoryChangesForClipboard(
  options: FormatRepositoryChangesOptions,
): string {
  const lines: string[] = ['# Repository Changes'];
  const headerMeta: string[] = [];

  if (options.branch) {
    headerMeta.push(`Branch: ${options.branch}`);
  }
  if (options.headCommit) {
    headerMeta.push(`Baseline: ${options.headCommit.slice(0, 7)}`);
  }

  const filesCount = options.files?.length ?? 0;
  headerMeta.push(`Files changed: ${filesCount}`);

  if (
    options.totalInsertions !== undefined ||
    options.totalDeletions !== undefined
  ) {
    const ins = options.totalInsertions ?? 0;
    const del = options.totalDeletions ?? 0;
    headerMeta.push(`Observed line changes: +${ins} -${del}`);
  }

  if (headerMeta.length > 0) {
    lines.push('');
    lines.push(...headerMeta);
  }

  lines.push('');

  if (filesCount === 0) {
    lines.push('No repository changes observed.');
    return lines.join('\n');
  }

  const maxAggregateBytes =
    options.maxAggregateBytes ?? MAX_AGGREGATE_COPY_BYTES;
  let currentByteLength = lines.join('\n').length;

  for (let i = 0; i < options.files.length; i++) {
    const file = options.files[i];
    const fileBlock = formatRepositoryFileChangeEvidence(file);
    const blockBytes = fileBlock.length + 2; // +2 for '\n\n'

    if (currentByteLength + blockBytes > maxAggregateBytes && i > 0) {
      const omittedFiles = options.files.length - i;
      lines.push(
        `[TRUNCATED: repository evidence exceeded aggregate copy limit of ${maxAggregateBytes} bytes (${omittedFiles} files omitted)]`,
      );
      break;
    }

    lines.push(fileBlock);
    lines.push('');
    currentByteLength += blockBytes;
  }

  // Remove trailing blank line if present
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

/**
 * Resolves on-demand change evidence for a single repository file.
 */
export async function resolveRepositoryFileChangeEvidence(
  file: {
    path: string;
    previousPath?: string;
    status?: GitFileStatus | string;
    insertions?: number;
    deletions?: number;
    binary?: boolean;
    lineStatsSource?: RepositoryFileLineStatsSource;
  },
  options: ResolveEvidenceOptions,
): Promise<RepositoryFileEvidenceResolved> {
  const maxBytes = options.maxPerFileBytes ?? MAX_PER_FILE_COPY_BYTES;
  const canonicalStatus = String(file.status || 'unknown').toLowerCase();

  // 1. Binary file check
  if (file.binary) {
    return {
      path: file.path,
      previousPath: file.previousPath,
      status: file.status || 'unknown',
      insertions: file.insertions,
      deletions: file.deletions,
      binary: true,
      lineStatsSource: 'unavailable',
      evidenceSource: 'binary',
    };
  }

  // 2. Untracked file: read current working-tree file content
  if (canonicalStatus === 'untracked') {
    let fsApi: MinimalFsApi | undefined = options.fsModule as MinimalFsApi | undefined;
    const globalAny = globalThis as unknown as {
      process?: { versions?: { node?: string } };
    };

    if (!fsApi && globalAny.process?.versions?.node) {
      try {
        const fsModuleName = 'node:fs';
        const imported = (await import(/* @vite-ignore */ fsModuleName)) as {
          default?: MinimalFsApi;
        };
        fsApi = imported.default || (imported as unknown as MinimalFsApi);
      } catch {
        // Fallback below
      }
    }

    if (fsApi) {
      try {
        let pathMod: { resolve: (...paths: string[]) => string } | null = null;
        try {
          const pathModuleName = 'node:path';
          const imported = (await import(/* @vite-ignore */ pathModuleName)) as {
            default?: { resolve: (...paths: string[]) => string };
            resolve?: (...paths: string[]) => string;
          };
          pathMod =
            imported.default ||
            (imported.resolve ? (imported as { resolve: (...paths: string[]) => string }) : null);
        } catch {
          pathMod = null;
        }

        const resolvedRoot =
          pathMod && typeof pathMod.resolve === 'function'
            ? pathMod.resolve(options.repositoryRoot)
            : options.repositoryRoot;
        const fullPath =
          pathMod && typeof pathMod.resolve === 'function'
            ? pathMod.resolve(resolvedRoot, file.path)
            : `${options.repositoryRoot}/${file.path}`;

        if (
          pathMod &&
          typeof pathMod.resolve === 'function' &&
          !fullPath.startsWith(resolvedRoot)
        ) {
          return {
            path: file.path,
            status: 'untracked',
            unavailableReason: 'Path escapes repository root boundary.',
          };
        }

        let stat: { size: number };
        if (fsApi.statSync) {
          stat = fsApi.statSync(fullPath);
        } else if (fsApi.promises?.stat) {
          stat = await fsApi.promises.stat(fullPath);
        } else {
          throw new Error('No stat method on fsApi');
        }

        if (stat.size === 0) {
          return {
            path: file.path,
            status: 'untracked',
            insertions: 0,
            deletions: 0,
            content: '',
            language: getLanguageForPath(file.path),
            evidenceSource: 'current working-tree file',
          };
        }

        let buffer: Uint8Array | { length: number; [i: number]: number; toString: (enc: string) => string };
        if (fsApi.readFileSync) {
          buffer = fsApi.readFileSync(fullPath);
        } else if (fsApi.promises?.readFile) {
          buffer = await fsApi.promises.readFile(fullPath);
        } else {
          throw new Error('No readFile on fsApi');
        }

        if (isBinaryBuffer(buffer)) {
          return {
            path: file.path,
            status: 'untracked',
            binary: true,
            evidenceSource: 'current working-tree file',
          };
        }

        let text = buffer.toString('utf8');
        let truncated = false;

        if (text.length > maxBytes) {
          text = text.slice(0, maxBytes);
          truncated = true;
        }

        return {
          path: file.path,
          status: 'untracked',
          insertions: file.insertions,
          deletions: 0,
          content: text,
          language: getLanguageForPath(file.path),
          truncated,
          evidenceSource: 'current working-tree file',
        };
      } catch (err: unknown) {
        const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : undefined;
        if (code === 'ENOENT') {
          return {
            path: file.path,
            status: 'untracked',
            unavailableReason: 'File does not exist on disk.',
          };
        }
      }
    }

    // Fallback via runCommand for untracked files
    if (options.runCommand) {
      try {
        const res = await options.runCommand({
          program: 'git',
          args: ['diff', '--no-index', '-u', '--', '/dev/null', file.path],
          cwd: options.repositoryRoot,
        });

        if (res.stdout) {
          let patch = extractHunkOrDiff(res.stdout);
          let truncated = false;
          if (patch.length > maxBytes) {
            patch = patch.slice(0, maxBytes);
            truncated = true;
          }
          return {
            path: file.path,
            status: 'untracked',
            insertions: file.insertions,
            deletions: 0,
            patch,
            truncated,
            evidenceSource: 'current working-tree file',
          };
        }
      } catch {
        // Fall through
      }
    }

    return {
      path: file.path,
      status: 'untracked',
      unavailableReason: 'Content unavailable from working tree.',
    };
  }

  // 3. Deleted file: do NOT read from disk!
  if (canonicalStatus === 'deleted') {
    if (options.runCommand) {
      try {
        let diffRes = await options.runCommand({
          program: 'git',
          args: ['diff', '-u', '--', file.path],
          cwd: options.repositoryRoot,
        });

        if (!diffRes.stdout || diffRes.stdout.trim().length === 0) {
          diffRes = await options.runCommand({
            program: 'git',
            args: ['diff', '--cached', '-u', '--', file.path],
            cwd: options.repositoryRoot,
          });
        }

        if (diffRes.stdout && diffRes.stdout.trim().length > 0) {
          let patch = extractHunkOrDiff(diffRes.stdout);
          let truncated = false;
          if (patch.length > maxBytes) {
            patch = patch.slice(0, maxBytes);
            truncated = true;
          }
          return {
            path: file.path,
            status: 'deleted',
            insertions: file.insertions ?? 0,
            deletions: file.deletions,
            patch,
            truncated,
            evidenceSource: 'Git diff',
          };
        }
      } catch {
        // Fall through
      }
    }

    return {
      path: file.path,
      status: 'deleted',
      insertions: file.insertions ?? 0,
      deletions: file.deletions,
      evidenceSource: 'Git diff',
      unavailableReason: 'Content unavailable from collected repository evidence.',
    };
  }

  // 4. Staged added file
  if (canonicalStatus === 'added') {
    if (options.runCommand) {
      try {
        const diffRes = await options.runCommand({
          program: 'git',
          args: ['diff', '--cached', '-u', '--', file.path],
          cwd: options.repositoryRoot,
        });

        if (diffRes.stdout && diffRes.stdout.trim().length > 0) {
          let patch = extractHunkOrDiff(diffRes.stdout);
          let truncated = false;
          if (patch.length > maxBytes) {
            patch = patch.slice(0, maxBytes);
            truncated = true;
          }
          return {
            path: file.path,
            status: 'added',
            insertions: file.insertions,
            deletions: file.deletions ?? 0,
            patch,
            truncated,
            evidenceSource: 'staged Git diff',
          };
        }
      } catch {
        // Fall through
      }
    }

    return {
      path: file.path,
      status: 'added',
      insertions: file.insertions,
      deletions: file.deletions ?? 0,
      evidenceSource: 'staged Git diff',
      unavailableReason: 'Content unavailable from collected repository evidence.',
    };
  }

  // 5. Modified, Renamed, Copied, Conflicted files
  if (options.runCommand) {
    try {
      const gitArgs = ['diff', '-u'];
      if (canonicalStatus === 'renamed' || canonicalStatus === 'copied') {
        gitArgs.push('-M');
      }
      gitArgs.push('--', file.path);
      if (file.previousPath) {
        gitArgs.push(file.previousPath);
      }

      const unstagedRes = await options.runCommand({
        program: 'git',
        args: gitArgs,
        cwd: options.repositoryRoot,
      });

      const stagedArgs = ['diff', '--cached', '-u'];
      if (canonicalStatus === 'renamed' || canonicalStatus === 'copied') {
        stagedArgs.push('-M');
      }
      stagedArgs.push('--', file.path);
      if (file.previousPath) {
        stagedArgs.push(file.previousPath);
      }

      const stagedRes = await options.runCommand({
        program: 'git',
        args: stagedArgs,
        cwd: options.repositoryRoot,
      });

      const combinedDiff = [unstagedRes.stdout, stagedRes.stdout]
        .filter((s) => s && s.trim().length > 0)
        .join('\n');

      if (combinedDiff.trim().length > 0) {
        let patch = extractHunkOrDiff(combinedDiff);
        let truncated = false;
        if (patch.length > maxBytes) {
          patch = patch.slice(0, maxBytes);
          truncated = true;
        }

        let evidenceSource = 'Git diff';
        if (canonicalStatus === 'conflicted') {
          evidenceSource = 'Git conflict diff';
        } else if (
          (!unstagedRes.stdout || unstagedRes.stdout.trim().length === 0) &&
          stagedRes.stdout && stagedRes.stdout.trim().length > 0
        ) {
          evidenceSource = 'staged Git diff';
        }

        return {
          path: file.path,
          previousPath: file.previousPath,
          status: file.status || 'modified',
          insertions: file.insertions,
          deletions: file.deletions,
          patch,
          truncated,
          evidenceSource,
        };
      }
    } catch {
      // Fall through
    }
  }

  return {
    path: file.path,
    previousPath: file.previousPath,
    status: file.status || 'modified',
    insertions: file.insertions,
    deletions: file.deletions,
    evidenceSource: 'Git diff',
    unavailableReason: 'Content unavailable from collected repository evidence.',
  };
}

/**
 * Resolves change evidence for all files in a repository evidence dataset.
 * Uses batch Git diff retrieval for speed and consistency.
 */
export async function resolveAllRepositoryChangesEvidence(
  files: Array<{
    path: string;
    previousPath?: string;
    status?: GitFileStatus | string;
    insertions?: number;
    deletions?: number;
    binary?: boolean;
    lineStatsSource?: RepositoryFileLineStatsSource;
  }>,
  options: ResolveEvidenceOptions,
): Promise<RepositoryFileEvidenceResolved[]> {
  const maxBytes = options.maxPerFileBytes ?? MAX_PER_FILE_COPY_BYTES;
  const results: RepositoryFileEvidenceResolved[] = [];

  // 1. Batch fetch git diffs (staged + unstaged) across the repository
  let unstagedDiffMap = new Map<string, string>();
  let stagedDiffMap = new Map<string, string>();

  if (options.runCommand) {
    try {
      const [unstagedRes, stagedRes] = await Promise.all([
        options.runCommand({
          program: 'git',
          args: ['diff', '-u', '-M'],
          cwd: options.repositoryRoot,
        }),
        options.runCommand({
          program: 'git',
          args: ['diff', '--cached', '-u', '-M'],
          cwd: options.repositoryRoot,
        }),
      ]);

      if (unstagedRes.stdout) {
        unstagedDiffMap = splitGitDiffByFile(unstagedRes.stdout);
      }
      if (stagedRes.stdout) {
        stagedDiffMap = splitGitDiffByFile(stagedRes.stdout);
      }
    } catch {
      // Fallback to per-file resolution
    }
  }

  // 2. Resolve each file
  for (const file of files) {
    const canonicalStatus = String(file.status || 'unknown').toLowerCase();

    // Binary file
    if (file.binary) {
      results.push({
        path: file.path,
        previousPath: file.previousPath,
        status: file.status || 'unknown',
        insertions: file.insertions,
        deletions: file.deletions,
        binary: true,
        lineStatsSource: 'unavailable',
        evidenceSource: 'binary',
      });
      continue;
    }

    // Untracked file: resolve via single-file helper (reads current file)
    if (canonicalStatus === 'untracked') {
      const resolved = await resolveRepositoryFileChangeEvidence(file, options);
      results.push(resolved);
      continue;
    }

    // Tracked file: look up in batch diff maps
    const unstagedDiff = unstagedDiffMap.get(file.path);
    const stagedDiff = stagedDiffMap.get(file.path);

    if (unstagedDiff || stagedDiff) {
      const combined = [unstagedDiff, stagedDiff]
        .filter((s) => s && s.trim().length > 0)
        .join('\n');

      let patch = extractHunkOrDiff(combined);
      let truncated = false;
      if (patch.length > maxBytes) {
        patch = patch.slice(0, maxBytes);
        truncated = true;
      }

      let evidenceSource = 'Git diff';
      if (canonicalStatus === 'added' || (!unstagedDiff && stagedDiff)) {
        evidenceSource = 'staged Git diff';
      } else if (canonicalStatus === 'conflicted') {
        evidenceSource = 'Git conflict diff';
      }

      results.push({
        path: file.path,
        previousPath: file.previousPath,
        status: file.status || 'modified',
        insertions: file.insertions,
        deletions: file.deletions,
        patch,
        truncated,
        evidenceSource,
      });
    } else {
      // Fallback: per-file on-demand resolution
      const resolved = await resolveRepositoryFileChangeEvidence(file, options);
      results.push(resolved);
    }
  }

  return results;
}
