/**
 * Repository Root Resolution Utility
 *
 * Resolves the absolute filesystem path of the enclosing Git repository root
 * using non-interactive `git rev-parse --show-toplevel`.
 */

import { runCollectorProcess } from './collectorRunner';
import type { CollectorCommandInput, CollectorCommandOutput } from './types';

/**
 * Resolves the top-level repository root directory for a given working directory.
 * Returns `null` if the directory is not inside a Git repository.
 */
export async function resolveRepositoryRoot(
  cwd?: string,
  runner: (input: CollectorCommandInput) => Promise<CollectorCommandOutput> = runCollectorProcess,
): Promise<string | null> {
  try {
    const res = await runner({
      program: 'git',
      args: ['rev-parse', '--show-toplevel'],
      cwd,
    });

    if (res.exitCode === 0) {
      const trimmed = res.stdout.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    return null;
  } catch {
    return null;
  }
}
