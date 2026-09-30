/**
 * TraceRelay / CapTerm Safe Collector Process Runner
 *
 * Implements strict, structured native command execution for read-only collectors.
 *
 * SECURITY INVARIANTS:
 * 1. Takes program and argument vector only — absolutely NO shell strings or `sh -c`.
 * 2. Only approved programs ('git') are allowed.
 * 3. Mutating Git subcommands (commit, push, checkout, etc.) are strictly rejected.
 * 4. In Tauri environment, delegates to native `collector_run_command` in Rust.
 * 5. In Node.js / test environment, safely invokes `child_process.spawnSync` with `shell: false`.
 */

import { invoke } from '@tauri-apps/api/core';
import type { CollectorCommandInput, CollectorCommandOutput } from './types';

export const ALLOWED_PROGRAMS: readonly string[] = ['git'];

export const ALLOWED_GIT_SUBCOMMANDS: readonly string[] = [
  'status',
  'diff',
  'rev-parse',
  'branch',
  'log',
  'show',
  'version',
];

export const DISALLOWED_MUTATING_KEYWORDS: readonly string[] = [
  'commit',
  'push',
  'pull',
  'checkout',
  'reset',
  'clean',
  'stash',
  'rebase',
  'merge',
  'cherry-pick',
  'revert',
  'tag',
  'clone',
  'init',
  'config',
];

/**
 * Validates that the command input conforms to read-only security invariants.
 * Throws an Error if any constraint is violated.
 */
export function validateCollectorCommand(input: CollectorCommandInput): void {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid collector command input');
  }

  if (!ALLOWED_PROGRAMS.includes(input.program)) {
    throw new Error(
      `Security policy violation: Program '${input.program}' is not permitted for evidence collection`,
    );
  }

  if (input.program === 'git') {
    if (!Array.isArray(input.args) || input.args.length === 0) {
      throw new Error(
        'Security policy violation: Git collector command requires a subcommand',
      );
    }

    const firstArg = input.args[0];
    if (!ALLOWED_GIT_SUBCOMMANDS.includes(firstArg)) {
      throw new Error(
        `Security policy violation: Git subcommand '${firstArg}' is not permitted for evidence collection`,
      );
    }

    for (const arg of input.args) {
      const lower = String(arg).toLowerCase();
      const stripped = lower.replace(/^-+/, '');
      for (const disallowed of DISALLOWED_MUTATING_KEYWORDS) {
        if (
          lower === disallowed ||
          stripped === disallowed ||
          lower.startsWith(`${disallowed}=`) ||
          stripped.startsWith(`${disallowed}=`)
        ) {
          throw new Error(
            `Security policy violation: Mutating keyword '${disallowed}' is forbidden in collector execution`,
          );
        }
      }
    }
  }
}

/**
 * Custom runner override (useful for mock injection during isolated unit testing).
 */
let customRunner: ((input: CollectorCommandInput) => Promise<CollectorCommandOutput>) | null =
  null;

export function setCustomCollectorRunner(
  runner: ((input: CollectorCommandInput) => Promise<CollectorCommandOutput>) | null,
): void {
  customRunner = runner;
}

/**
 * Runs a validated read-only collector subprocess without shell interpolation.
 */
export async function runCollectorProcess(
  input: CollectorCommandInput,
): Promise<CollectorCommandOutput> {
  // 1. Client-side security verification
  validateCollectorCommand(input);

  // 2. Custom mock hook if provided
  if (customRunner) {
    return await customRunner(input);
  }

  // 3. Tauri environment
  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (isTauri) {
    return await invoke<CollectorCommandOutput>('collector_run_command', {
      input,
    });
  }

  // 4. Node.js environment (for automated test runners & CLI scripts)
  const globalAny = globalThis as unknown as {
    process?: {
      versions?: { node?: string };
    };
  };

  if (globalAny.process?.versions?.node) {
    const cpModuleName = 'node:child_process';
    const cp = (await import(/* @vite-ignore */ cpModuleName)) as {
      spawnSync?: (
        prog: string,
        args: string[],
        opts: Record<string, unknown>,
      ) => {
        status: number | null;
        stdout: string;
        stderr: string;
        signal: string | null;
        error?: { code?: string; message: string };
      };
      default?: {
        spawnSync?: (
          prog: string,
          args: string[],
          opts: Record<string, unknown>,
        ) => {
          status: number | null;
          stdout: string;
          stderr: string;
          signal: string | null;
          error?: { code?: string; message: string };
        };
      };
    };
    const spawnSync = cp.spawnSync ?? cp.default?.spawnSync;
    if (!spawnSync) {
      throw new Error('child_process.spawnSync is unavailable in this environment');
    }
    const start = Date.now();

    const res = spawnSync(input.program, input.args, {
      cwd: input.cwd,
      timeout: input.timeoutMs ?? 15000,
      encoding: 'utf8',
      shell: false, // CRITICAL: NEVER use shell interpolation
      maxBuffer: 4 * 1024 * 1024,
    });

    const durationMs = Date.now() - start;

    if (res.error) {
      if (res.error.code === 'ENOENT') {
        return {
          exitCode: 127,
          stdout: '',
          stderr: `Executable '${input.program}' not found on system path`,
          durationMs,
        };
      }
      throw res.error;
    }

    return {
      exitCode: res.status ?? (res.signal ? 128 : 0),
      stdout: res.stdout || '',
      stderr: res.stderr || '',
      durationMs,
    };
  }

  throw new Error('No supported collector execution environment available');
}
