/**
 * CROSSPLAT-005C — runtime interpretation of a persisted workspace root.
 *
 * Persisted: only the root path string (`rootPath`, or `unavailableRootPath` when PathPolicy did
 * not accept it on this host). Derived: everything else. Foreign vs unsupported follows from
 * PathPolicy on the current host; reachability is a runtime observation (`rootReachable`) taken at
 * lifecycle boundaries (restore, terminal start) and never persisted, because a share or drive
 * can come and go after the state is written.
 */

import { invoke } from '@tauri-apps/api/core';
import { classifyPath, type PathPlatform } from './pathPolicy';
import type { LogicalWorkspace, RepositoryContext } from './types';

export type WorkspaceRootState =
  | { kind: 'unbound' }
  | {
      kind: 'foreign' | 'unsupported' | 'local-supported-but-unreachable' | 'local-and-usable';
      path: string;
    };

type RootFields = Pick<LogicalWorkspace, 'rootPath' | 'unavailableRootPath' | 'rootReachable'>;

/**
 * - foreign: another platform family's path (`C:\repo` on POSIX, `/repo` on Windows)
 * - unsupported: this family's syntax ExecRelay does not accept (`\\?\…`, `\\.\…`, rooted,
 *   drive-relative, relative, `~`, `\\server` without a share)
 * - local-supported-but-unreachable: local syntax, last availability check failed
 * - local-and-usable: local syntax, not known to be unreachable
 */
export function deriveWorkspaceRootState(ws: RootFields, host: PathPlatform): WorkspaceRootState {
  const path = ws.rootPath ?? ws.unavailableRootPath;
  if (!path) return { kind: 'unbound' };
  const { compatibility } = classifyPath(path, host);
  if (compatibility === 'foreign') return { kind: 'foreign', path };
  if (compatibility !== 'local') return { kind: 'unsupported', path };
  return {
    kind: ws.rootReachable === false ? 'local-supported-but-unreachable' : 'local-and-usable',
    path,
  };
}

export interface WorkspaceRootNotice {
  message: string;
  /** The original root, shown verbatim. */
  path: string;
}

const ROOT_NOTICES: Partial<Record<WorkspaceRootState['kind'], string>> = {
  foreign: 'Workspace path belongs to another platform.',
  unsupported: 'This path format is not supported by ExecRelay.',
  'local-supported-but-unreachable': 'Workspace path is currently unavailable.',
};

/** User-facing notice for a root that cannot be used right now; null when it can (or is unbound). */
export function describeWorkspaceRootState(state: WorkspaceRootState): WorkspaceRootNotice | null {
  if (state.kind === 'unbound') return null;
  const message = ROOT_NOTICES[state.kind];
  return message ? { message, path: state.path } : null;
}

/** One native `is_dir` stat: no shell, no Git, no fallback. */
export async function isDirectory(path: string): Promise<boolean> {
  return await invoke<boolean>('path_is_directory', { path });
}

export interface WorkspaceRootEvaluation {
  state: WorkspaceRootState;
  /** Set only when the root is usable and the workspace had no repository context yet. */
  repository?: RepositoryContext;
}

/**
 * Lifecycle-boundary check: stats a local root once and, only when it is usable and has no
 * repository context, detects the repository from it. Foreign, unsupported and unbound roots
 * touch neither the filesystem nor Git.
 */
export async function evaluateWorkspaceRoot(
  ws: RootFields & Pick<LogicalWorkspace, 'repository'>,
  host: PathPlatform,
  deps: {
    isDirectory: (path: string) => Promise<boolean>;
    detectRepository: (path: string) => Promise<RepositoryContext | undefined>;
  },
): Promise<WorkspaceRootEvaluation> {
  const syntactic = deriveWorkspaceRootState({ ...ws, rootReachable: undefined }, host);
  if (syntactic.kind !== 'local-and-usable') return { state: syntactic };

  const reachable = await deps.isDirectory(syntactic.path).catch(() => false);
  if (!reachable) return { state: { kind: 'local-supported-but-unreachable', path: syntactic.path } };
  if (ws.repository) return { state: syntactic };
  const repository = await deps.detectRepository(syntactic.path).catch(() => undefined);
  return { state: syntactic, ...(repository ? { repository } : {}) };
}
