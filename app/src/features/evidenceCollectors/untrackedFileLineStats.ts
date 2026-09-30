/**
 * Untracked File Line Stats Inspector (HARDEN-007)
 *
 * Derives line addition statistics for untracked / newly created files that Git numstat
 * does not cover, preserving strict truth boundaries and provenance.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Do NOT fake Git numstat: line stats derived from working tree inspection are explicitly
 *    labeled as 'working-tree-line-count', distinct from 'git-numstat'.
 * 2. Do NOT mutate canonical Git status: file remains status === 'untracked', NEVER converted to 'added'.
 * 3. Bounded reads: files exceeding MAX_UNTRACKED_FILE_INSPECTION_BYTES are safely marked as unavailable
 *    (oversized: true) rather than returning a truncated guess or causing memory bloat.
 * 4. Binary safety: binary files (NUL bytes detected) are marked as binary without misleading text counts.
 * 5. Deterministic newline counting: follows standard textual expectations (empty -> 0, "a\n" -> 1, "a\nb" -> 2).
 * 6. Structured path handling: uses direct filesystem / argument vector APIs; NEVER uses shell interpolation.
 */

import type { CollectorCommandInput, CollectorCommandOutput, RepositoryFileLineStatsSource } from './types';

/** Maximum file size in bytes to inspect for line counting (4 MiB) */
export const MAX_UNTRACKED_FILE_INSPECTION_BYTES = 4 * 1024 * 1024;

/** Number of bytes to inspect for NUL bytes to detect binary content */
export const BINARY_SAMPLE_BYTES = 8000;

export type UntrackedLineStatsStatus = 'computed' | 'unavailable';

export interface UntrackedFileLineStatsResult {
  status: UntrackedLineStatsStatus;
  additions?: number;
  deletions?: number;
  lineCount?: number;
  binary?: boolean;
  oversized?: boolean;
  source: RepositoryFileLineStatsSource;
  reason?: string;
}

export interface MinimalFsApi {
  statSync?: (path: string) => { isFile: () => boolean; size: number };
  readFileSync?: (path: string) => Uint8Array | { length: number; [i: number]: number; toString: (enc: string) => string };
  promises?: {
    stat: (path: string) => Promise<{ isFile: () => boolean; size: number }>;
    readFile: (path: string) => Promise<Uint8Array | { length: number; [i: number]: number; toString: (enc: string) => string }>;
  };
}

export interface InspectUntrackedFileOptions {
  maxSizeBytes?: number;
  fsModule?: MinimalFsApi;
  runCommand?: (input: CollectorCommandInput) => Promise<CollectorCommandOutput>;
}

/**
 * Deterministically counts lines in a text string according to standard textual conventions:
 * - Empty string ("") -> 0 lines
 * - Single line without trailing newline ("a") -> 1 line
 * - Single line with trailing newline ("a\n") -> 1 line
 * - Two lines without trailing newline ("a\nb") -> 2 lines
 * - Two lines with trailing newline ("a\nb\n") -> 2 lines
 * - Handles both Unix (LF) and Windows (CRLF) newlines consistently.
 */
export function countTextLines(text: string): number {
  if (!text || text.length === 0) return 0;

  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      count++;
    }
  }

  // If the last character is not a newline, count the final unterminated line
  const lastChar = text[text.length - 1];
  if (lastChar !== '\n' && lastChar !== '\r') {
    count++;
  }

  return count;
}

/**
 * Inspects a byte buffer for the presence of NUL (0x00) bytes to determine if content is binary.
 */
export function isBinaryBuffer(
  buffer: Uint8Array | number[] | { length: number; [index: number]: number },
  sampleLength: number = BINARY_SAMPLE_BYTES,
): boolean {
  const len = Math.min(buffer.length, sampleLength);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Safely inspects an untracked working-tree file to derive its line count.
 */
export async function inspectUntrackedFileLineStats(
  repoRoot: string,
  relativePath: string,
  options?: InspectUntrackedFileOptions,
): Promise<UntrackedFileLineStatsResult> {
  const maxSizeBytes = options?.maxSizeBytes ?? MAX_UNTRACKED_FILE_INSPECTION_BYTES;

  // 1. Try Node.js fs when available (Node test runner, desktop Node CLI)
  const globalAny = globalThis as unknown as {
    process?: {
      versions?: { node?: string };
    };
  };

  let fsApi: MinimalFsApi | undefined = options?.fsModule;
  if (!fsApi && globalAny.process?.versions?.node) {
    try {
      const fsModuleName = 'node:fs';
      const imported = (await import(/* @vite-ignore */ fsModuleName)) as { default?: MinimalFsApi };
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
          ? pathMod.resolve(repoRoot)
          : repoRoot;
      const fullPath =
        pathMod && typeof pathMod.resolve === 'function'
          ? pathMod.resolve(resolvedRoot, relativePath)
          : `${repoRoot}/${relativePath}`;

      // Boundary check: ensure path does not escape repository root
      if (
        pathMod &&
        typeof pathMod.resolve === 'function' &&
        !fullPath.startsWith(resolvedRoot)
      ) {
        return {
          status: 'unavailable',
          source: 'unavailable',
          reason: 'Path escapes repository root boundary',
        };
      }

      let stat: { isFile: () => boolean; size: number };
      if (fsApi.statSync) {
        stat = fsApi.statSync(fullPath);
      } else if (fsApi.promises?.stat) {
        stat = await fsApi.promises.stat(fullPath);
      } else {
        throw new Error('No stat method on fsApi');
      }

      if (!stat.isFile()) {
        return {
          status: 'unavailable',
          source: 'unavailable',
          reason: 'Target is not a regular file',
        };
      }

      // Check file size threshold
      if (stat.size > maxSizeBytes) {
        return {
          status: 'unavailable',
          oversized: true,
          binary: false,
          source: 'unavailable',
          reason: `File size (${stat.size} bytes) exceeds maximum safe inspection limit (${maxSizeBytes} bytes)`,
        };
      }

      // Empty file
      if (stat.size === 0) {
        return {
          status: 'computed',
          additions: 0,
          deletions: 0,
          lineCount: 0,
          binary: false,
          source: 'working-tree-line-count',
        };
      }

      // Read bounded buffer
      let buffer: Uint8Array | { length: number; [i: number]: number; toString: (enc: string) => string };
      if (fsApi.readFileSync) {
        buffer = fsApi.readFileSync(fullPath);
      } else if (fsApi.promises?.readFile) {
        buffer = await fsApi.promises.readFile(fullPath);
      } else {
        throw new Error('No readFile method on fsApi');
      }

      // Check for binary content
      if (isBinaryBuffer(buffer)) {
        return {
          status: 'unavailable',
          binary: true,
          source: 'unavailable',
          reason: 'Binary file detected',
        };
      }

      // Decode UTF-8 and count lines deterministically
      const text = buffer.toString('utf8');
      const lines = countTextLines(text);

      return {
        status: 'computed',
        additions: lines,
        deletions: 0,
        lineCount: lines,
        binary: false,
        source: 'working-tree-line-count',
      };
    } catch (err: unknown) {
      const errCode =
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as { code: string }).code
          : undefined;
      if (errCode === 'ENOENT') {
        return {
          status: 'unavailable',
          source: 'unavailable',
          reason: 'File does not exist on disk',
        };
      }
      // If fs inspection failed, continue to fallback below
    }
  }

  // 2. Fallback: When Node fs is unavailable (e.g. Tauri Webview), use read-only collector runCommand
  if (options?.runCommand) {
    try {
      const res = await options.runCommand({
        program: 'git',
        args: ['diff', '--no-index', '--numstat', '-z', '--', '/dev/null', relativePath],
        cwd: repoRoot,
        timeoutMs: 5000,
      });

      // git diff --no-index outputs: "<ins>\t<del>\t\0/dev/null\0<path>\0"
      if (res.stdout && res.stdout.length > 0) {
        const tokens = res.stdout.split('\0');
        if (tokens.length > 0) {
          const tabParts = tokens[0].split('\t');
          if (tabParts.length >= 2) {
            const insStr = tabParts[0].trim();
            const delStr = tabParts[1].trim();

            if (insStr === '-' && delStr === '-') {
              return {
                status: 'unavailable',
                binary: true,
                source: 'unavailable',
                reason: 'Binary file detected by Git diff',
              };
            }

            const insNum = parseInt(insStr, 10);
            if (!isNaN(insNum)) {
              return {
                status: 'computed',
                additions: insNum,
                deletions: 0,
                lineCount: insNum,
                binary: false,
                source: 'working-tree-line-count',
              };
            }
          }
        }
      }
    } catch {
      // Degrades safely to unavailable
    }
  }

  return {
    status: 'unavailable',
    source: 'unavailable',
    reason: 'File line stats could not be inspected',
  };
}
