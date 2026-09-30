/**
 * ExecRelay Workspace Context & Repository Binding
 *
 * Implements core domain functions for:
 * 1. Resolving workspace folder basename
 * 2. Safe, non-interpolated Git repository detection
 * 3. Native folder picker invocation and cancellation handling
 * 4. Binding/updating workspace rootPath and repository context
 *
 * ARCHITECTURAL INVARIANTS:
 * - Workspace owns rootPath ("This is the project context this Workspace represents").
 * - RepositoryContext owns repository rootPath (detected Git root associated with the Workspace).
 * - TerminalSession owns current runtime cwd.
 * - Execution records actual observed cwd.
 * - Changes consumes repository rootPath.
 * - Verify defaults to Workspace rootPath.
 * - Git detection failure != Workspace failure.
 * - Picker cancellation is a normal no-op.
 */

import { invoke } from '@tauri-apps/api/core';
import { resolveRepositoryRoot } from '../evidenceCollectors/repositoryResolver';
import { runCollectorProcess } from '../evidenceCollectors/collectorRunner';
import type {
  CollectorCommandInput,
  CollectorCommandOutput,
} from '../evidenceCollectors/types';
import type { LogicalWorkspace, RepositoryContext } from './types';

/**
 * Resolves the desktop window title dynamically based on workspace binding state:
 * - Bound workspace: "{activeWorkspace.name} — ExecRelay"
 * - Unbound / no active workspace: "ExecRelay"
 *
 * Invariant: Never includes branch, cwd, terminal name, or full filesystem path.
 */
export function resolveWindowTitle(activeWorkspace?: LogicalWorkspace | null): string {
  const isBound = Boolean(
    activeWorkspace?.rootPath && activeWorkspace.rootPath.trim().length > 0,
  );
  if (isBound && activeWorkspace?.name) {
    return `${activeWorkspace.name} — ExecRelay`;
  }
  return 'ExecRelay';
}

/**
 * Dynamically updates the desktop window title in both Web (document.title)
 * and Tauri native desktop window environments.
 */
export async function updateWindowTitle(title: string): Promise<void> {
  if (typeof document !== 'undefined') {
    document.title = title;
  }
  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  if (isTauri) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setTitle(title);
    } catch {
      // Ignored in headless/unsupported test environments
    }
  }
}

/**
 * Custom finder opener hook (for deterministic testing & headless mock injection).
 */
let customFinderOpener: ((path: string) => Promise<void>) | null = null;

export function setCustomFinderOpener(
  opener: ((path: string) => Promise<void>) | null,
): void {
  customFinderOpener = opener;
}

/**
 * Opens a repository root path in macOS Finder using safe structured invocation.
 */
export async function openInFinder(path?: string): Promise<void> {
  if (!path || typeof path !== 'string' || path.trim().length === 0) {
    return;
  }
  const cleanPath = path.trim();

  if (customFinderOpener) {
    return await customFinderOpener(cleanPath);
  }

  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (isTauri) {
    try {
      await invoke('open_in_finder', { path: cleanPath });
      return;
    } catch (err) {
      console.warn('[WorkspaceContext] Tauri open_in_finder failed:', err);
    }
  }

  // Web / development fallback
  console.log('[WorkspaceContext] Open in Finder:', cleanPath);
}

/**
 * Extracts a human-friendly workspace name from a directory path.
 * Examples:
 *   "/Users/max/projects/careerneed" -> "careerneed"
 *   "/Users/max/projects/careerneed/" -> "careerneed"
 *   "/tmp" -> "tmp"
 *   "/" -> "Workspace"
 */
export function resolveWorkspaceFolderBasename(folderPath: string): string {
  if (!folderPath || typeof folderPath !== 'string') {
    return 'Workspace';
  }

  const normalized = folderPath.trim().replace(/[/\\]+$/, '');
  if (!normalized) {
    return 'Workspace';
  }

  const parts = normalized.split(/[/\\]/).filter(Boolean);
  const last = parts.pop();
  return last && last.trim().length > 0 ? last.trim() : 'Workspace';
}

/**
 * Custom folder picker hook (for deterministic testing & headless mock injection).
 */
let customFolderPicker: (() => Promise<string | null>) | null = null;

export function setCustomFolderPicker(
  picker: (() => Promise<string | null>) | null,
): void {
  customFolderPicker = picker;
}

/**
 * Opens a native folder selection dialog.
 * Returns the selected absolute path, or `null` if cancelled by user.
 */
export async function openFolderPicker(): Promise<string | null> {
  // 1. Custom mock picker if registered (for test harness)
  if (customFolderPicker) {
    return await customFolderPicker();
  }

  // 2. Tauri native environment
  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (isTauri) {
    try {
      const selected = await invoke<string | null>('select_folder');
      if (selected && typeof selected === 'string' && selected.trim().length > 0) {
        return selected.trim();
      }
      return null;
    } catch (err) {
      console.error('[WorkspaceContext] Tauri select_folder failed:', err);
      // In packaged Tauri, NEVER silently fall back to window.prompt!
      throw new Error(
        `Native folder picker failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  // 3. Web / Dev / Mock fallback
  if (typeof window !== 'undefined') {
    const nav = window.navigator as unknown as { userAgent?: string };
    const isMock = nav.userAgent?.includes('Node.js') || nav.userAgent?.includes('jsdom');
    if (!isMock) {
      const input = window.prompt?.('Enter project folder path:');
      if (input && input.trim().length > 0) {
        return input.trim();
      }
    }
  }

  return null;
}

/**
 * Safely detects whether a directory belongs to a Git repository using safe
 * structured program/args invocation (`git rev-parse --show-toplevel`).
 *
 * Returns a RepositoryContext if a Git root is found, or `undefined` if non-Git.
 */
export async function detectRepositoryContext(
  rootPath?: string,
  runner: (input: CollectorCommandInput) => Promise<CollectorCommandOutput> = runCollectorProcess,
): Promise<RepositoryContext | undefined> {
  if (!rootPath || typeof rootPath !== 'string' || rootPath.trim().length === 0) {
    return undefined;
  }

  const cleanPath = rootPath.trim();
  const repoRoot = await resolveRepositoryRoot(cleanPath, runner);

  if (!repoRoot) {
    return undefined;
  }

  // Optionally detect active branch cheaply
  let branch: string | undefined;
  try {
    const branchRes = await runner({
      program: 'git',
      args: ['rev-parse', '--abbrev-ref', 'HEAD'],
      cwd: repoRoot,
    });
    if (branchRes.exitCode === 0) {
      const b = branchRes.stdout.trim();
      if (b && b !== 'HEAD') {
        branch = b;
      }
    }
  } catch {
    // Branch detection is optional; non-fatal
  }

  return {
    vcs: 'git',
    rootPath: repoRoot,
    branch,
  };
}

/**
 * Updates a workspace with a new rootPath and repository context.
 * If the repository changed, clears outdated snapshots and attribution records
 * to prevent cross-repository contamination (Section 29).
 */
export function bindWorkspaceRootPath(
  workspace: LogicalWorkspace,
  rootPath?: string,
  repository?: RepositoryContext,
): LogicalWorkspace {
  const previousRepoRoot = workspace.repository?.rootPath;
  const nextRepoRoot = repository?.rootPath;
  const repoChanged = previousRepoRoot !== nextRepoRoot;

  return {
    ...workspace,
    rootPath: rootPath ?? undefined,
    projectCwd: rootPath ?? undefined,
    repository: repository ?? undefined,
    repositorySnapshots: repoChanged ? undefined : workspace.repositorySnapshots,
    latestCollectionRun: repoChanged ? undefined : workspace.latestCollectionRun,
    changeAttributions: repoChanged ? undefined : workspace.changeAttributions,
  };
}
