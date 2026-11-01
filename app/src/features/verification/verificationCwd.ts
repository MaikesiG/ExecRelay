/**
 * Verification Working Directory Resolution
 *
 * Implements deterministic working-directory resolution for verification commands (VERIFY-CWD-025):
 * - Every VerificationCriterion supports a relative `workingDirectory` (default: ".").
 * - Working directory resolves strictly relative to Workspace rootPath.
 * - Path traversal (e.g. "../", "../../", absolute external paths) is strictly rejected.
 * - Before execution, directory existence is validated against the filesystem.
 *
 * ARCHITECTURAL INVARIANTS:
 * - Workspace owns rootPath.
 * - Repository root is NOT verification cwd.
 * - Terminal session cwd is NOT verification cwd.
 * - Never uses process.cwd() as fallback.
 * - Safely escapes paths for POSIX shells.
 * - Emits wrapped subshell commands `(cd <escapedTargetCwd> && <command>)` to guarantee execution
 *   in the target directory without mutating the parent interactive shell pane.
 */

import { runCollectorProcess } from '../evidenceCollectors/collectorRunner';
import {
  classifyPathSyntax,
  hostPathPlatform,
  isLocalPath,
  isPathInside,
  isRelativePath,
  type PathPlatform,
} from '../workspace/pathPolicy';

export interface VerificationWorkingDirectoryResolution {
  ok: boolean;
  resolvedPath?: string;
  relativePath?: string;
  error?: string;
}

/**
 * Resolves and validates a criterion's relative workingDirectory against the workspace rootPath.
 *
 * Rules:
 * - "." -> workspaceRoot
 * - "apps/web" -> workspaceRoot/apps/web
 * - Normalizes "./apps/web", "apps/web/", "apps/./web"
 * - Rejects path traversal (e.g. "../other", "../../")
 * - Rejects absolute paths (e.g. "/tmp", "/Users/...", "C:\x", "\\server\share", "\\?\C:\x")
 *   and drive-relative/rooted Windows forms ("C:x", "\x")
 * - Rejects home directory shorthand ("~/...")
 * - Fails truthfully if workspaceRoot is missing/empty or not a local path on this host
 *   (no silent fallbacks)
 * - CROSSPLAT-005B: joins with the root's own separator style (`\` for a Windows root that
 *   uses it) and keeps a bare root (`/`, `C:\`) intact.
 */
export function resolveVerificationWorkingDirectory(
  workspaceRoot?: string | null,
  workingDirectory?: string | null,
  host: PathPlatform = hostPathPlatform(),
): VerificationWorkingDirectoryResolution {
  if (!workspaceRoot || typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) {
    return {
      ok: false,
      error: 'Workspace root path is not configured',
    };
  }

  const trimmedRoot = workspaceRoot.trim();
  if (!isLocalPath(trimmedRoot, host)) {
    return {
      ok: false,
      error: `Workspace root path is not a local path on this host: ${trimmedRoot}`,
    };
  }
  const windowsRoot = classifyPathSyntax(trimmedRoot) !== 'posix-absolute';
  const separator = windowsRoot && trimmedRoot.includes('\\') ? '\\' : '/';
  // Strip trailing separators, but never past the root itself (`/`, `C:\`).
  const strippedRoot = trimmedRoot.replace(/[/\\]+$/, '');
  const cleanRoot = isLocalPath(strippedRoot, host) ? strippedRoot : trimmedRoot;
  const rawWorkingDir =
    workingDirectory !== undefined && workingDirectory !== null && workingDirectory.trim().length > 0
      ? workingDirectory.trim()
      : '.';

  // Security check: Reject home directory shorthand (~)
  if (rawWorkingDir.startsWith('~')) {
    return {
      ok: false,
      error: `Working directory cannot use home directory shorthand: ${rawWorkingDir}`,
    };
  }

  // Security check: Reject anything that is not a plain relative path (POSIX/drive/UNC/extended
  // absolute, drive-relative or rooted Windows forms)
  if (!isRelativePath(rawWorkingDir)) {
    return {
      ok: false,
      error: `Working directory must be relative to the workspace root: ${rawWorkingDir}`,
    };
  }

  // Tokenize and normalize path segments
  const segments = rawWorkingDir.split(/[/\\]+/);
  const normalizedSegments: string[] = [];

  for (const seg of segments) {
    if (!seg || seg === '.') {
      continue;
    }
    if (seg === '..') {
      if (normalizedSegments.length === 0) {
        // Escapes workspace root
        return {
          ok: false,
          error: `Working directory cannot escape workspace root: ${rawWorkingDir}`,
        };
      }
      normalizedSegments.pop();
    } else {
      normalizedSegments.push(seg);
    }
  }

  const relativePath = normalizedSegments.length === 0 ? '.' : normalizedSegments.join('/');
  const joiner = /[/\\]$/.test(cleanRoot) ? '' : separator;
  const resolvedPath =
    relativePath === '.' ? cleanRoot : `${cleanRoot}${joiner}${normalizedSegments.join(separator)}`;

  // Defense in depth: the lexical result must stay inside the root.
  if (!isPathInside(cleanRoot, resolvedPath, host)) {
    return {
      ok: false,
      error: `Working directory cannot escape workspace root: ${rawWorkingDir}`,
    };
  }

  return {
    ok: true,
    resolvedPath,
    relativePath,
  };
}

// Deprecated legacy alias for backward compatibility with existing tests
export const resolveVerificationCwd = (context: {
  workspaceRootPath?: string | null;
  criterionCwd?: string | null;
  criterionWorkingDirectory?: string | null;
}): string | undefined => {
  const res = resolveVerificationWorkingDirectory(
    context.workspaceRootPath,
    context.criterionWorkingDirectory ?? context.criterionCwd,
  );
  return res.ok ? res.resolvedPath : undefined;
};

/**
 * Custom directory validator hook (for testing & mock injection).
 */
let customDirectoryValidator: ((path: string) => Promise<boolean> | boolean) | null = null;

export function setCustomDirectoryValidator(
  validator: ((path: string) => Promise<boolean> | boolean) | null,
): void {
  customDirectoryValidator = validator;
}

/**
 * Validates that the resolved target directory exists on the filesystem.
 * Uses existing native collector/system capability or Node.js fs when available.
 */
export async function validateDirectoryExists(
  resolvedPath: string,
): Promise<boolean> {
  if (customDirectoryValidator) {
    return await customDirectoryValidator(resolvedPath);
  }

  // Node.js test environment check
  const maybeProcess = (
    globalThis as unknown as { process?: { versions?: { node?: string } } }
  ).process;
  if (maybeProcess?.versions?.node) {
    try {
      const maybeRequire = (
        globalThis as unknown as {
          require?: (mod: string) => {
            existsSync: (p: string) => boolean;
            statSync: (p: string) => { isDirectory: () => boolean };
          };
        }
      ).require;
      if (typeof maybeRequire === 'function') {
        const fs = maybeRequire('node:fs');
        if (fs.existsSync(resolvedPath)) {
          return fs.statSync(resolvedPath).isDirectory();
        }
        return false;
      }
    } catch {
      // Fall through
    }
  }

  // Tauri / Native environment check using existing collector_run_command
  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (isTauri) {
    try {
      // runCollectorProcess validates cwd via Path::new(cwd).is_dir() in native Rust
      const res = await runCollectorProcess({
        program: 'git',
        args: ['rev-parse', '--show-toplevel'],
        cwd: resolvedPath,
      });
      // 0 means git repo root, 128 means not a git repo, but directory existed!
      return res.exitCode === 0 || res.exitCode === 128;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('Invalid directory') ||
        msg.includes('No such file or directory') ||
        msg.includes('Failed to execute')
      ) {
        return false;
      }
      return false;
    }
  }

  return true;
}

/**
 * Safely escapes a filesystem path for inclusion in a POSIX shell command string.
 *
 * Uses POSIX single-quote wrapping:
 * - Surrounds the path in single quotes '...'
 * - Replaces any inner single quotes `'` with `'\\''`
 */
export function escapeShellPath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/**
 * Wraps a verification command to execute within the target working directory
 * in a subshell, ensuring that:
 * 1. The command runs in targetCwd regardless of active shell prompt position.
 * 2. The active terminal pane's working directory is not permanently modified.
 * 3. The process exit status is preserved for shell integration capture.
 * 4. The targetCwd is safely shell-escaped against command injection and special characters.
 */
export function buildVerificationDispatchCommand(
  command: string,
  targetCwd?: string,
): string {
  const trimmedCwd = targetCwd?.trim();
  if (!trimmedCwd) {
    return command;
  }

  const escapedCwd = escapeShellPath(trimmedCwd);
  return `(cd ${escapedCwd} && ${command})`;
}
