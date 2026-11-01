/**
 * CROSSPLAT-005A/005B: PathPolicy.
 *
 * Classifies a path string by syntax alone (no filesystem access) and decides whether it is
 * usable as a local path on the current host. A persisted workspace root written on another
 * platform must never become a terminal cwd or a repository-detection input here: on macOS,
 * `C:\Users\x` is a relative POSIX path, and on Windows `/Users/x` resolves against the
 * current drive.
 *
 * The policy is lexical. The input string is never trimmed, re-cased or re-separated, and
 * symlinks/junctions are never resolved: a path's identity is the string the user selected.
 * Comparison (`arePathsEquivalent`, `isPathInside`) folds only what Windows itself defines as
 * case-insensitive syntax, never a filesystem's component case rules.
 */

import { detectPlatform } from '../shortcuts/shortcutNormalization';

export type PathPlatform = 'posix' | 'windows';

export type PathSyntax =
  | 'posix-absolute' // /Users/x
  | 'windows-drive' // C:\x or C:/x
  | 'windows-unc' // \\server\share\x or //server/share/x (or an incomplete \\server)
  | 'windows-extended-drive' // \\?\C:\x
  | 'windows-extended-unc' // \\?\UNC\server\share\x
  | 'windows-device' // any other \\?\ or \\.\ form (\\.\pipe\x, \\?\Volume{...}\x)
  | 'windows-rooted' // \x: root of the current drive
  | 'windows-drive-relative' // C:x or C: (cwd of drive C)
  | 'relative' // project, ./x, ../x, foo\bar
  | 'home-shorthand' // ~/x, ~\x, ~
  | 'empty'; // '', whitespace, non-string, or contains NUL

/**
 * - local: usable as a local absolute path on this host.
 * - foreign: absolute path syntax of the other platform family.
 * - unsupported: this host's family, but not accepted as a root or cwd (extended/device paths).
 * - ambiguous: not absolute (relative, drive-relative, rooted or `~`); never resolved.
 * - invalid: empty, malformed, or a UNC path without both server and share.
 */
export type PathCompatibility = 'local' | 'foreign' | 'unsupported' | 'ambiguous' | 'invalid';

export interface PathClassification {
  syntax: PathSyntax;
  /** Platform family the syntax belongs to; null when it fits neither. */
  platform: PathPlatform | null;
  compatibility: PathCompatibility;
}

/** Host path family, from the app's existing host platform detection. */
export function hostPathPlatform(): PathPlatform {
  return detectPlatform() === 'windows' ? 'windows' : 'posix';
}

export function classifyPathSyntax(path: unknown): PathSyntax {
  if (typeof path !== 'string' || path.trim().length === 0 || path.includes('\0')) {
    return 'empty';
  }
  if (/^[\\/]{2}[?.][\\/]/.test(path)) {
    if (/^[\\/]{2}\?[\\/][A-Za-z]:[\\/]/.test(path)) return 'windows-extended-drive';
    if (/^[\\/]{2}\?[\\/]UNC[\\/]/i.test(path)) return 'windows-extended-unc';
    return 'windows-device';
  }
  if (/^[\\/]{2}/.test(path)) return 'windows-unc';
  if (/^[A-Za-z]:[\\/]/.test(path)) return 'windows-drive';
  if (/^[A-Za-z]:/.test(path)) return 'windows-drive-relative';
  if (path.startsWith('/')) return 'posix-absolute';
  if (path.startsWith('\\')) return 'windows-rooted';
  if (path === '~' || /^~[\\/]/.test(path)) return 'home-shorthand';
  return 'relative';
}

/** `\\server\share` with a non-empty server and share; `\\server` alone names no directory. */
function hasUncServerAndShare(path: string): boolean {
  return /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(path);
}

export function classifyPath(path: unknown, host: PathPlatform): PathClassification {
  const syntax = classifyPathSyntax(path);
  const windowsHost = host === 'windows';
  switch (syntax) {
    case 'posix-absolute':
      return { syntax, platform: 'posix', compatibility: windowsHost ? 'foreign' : 'local' };
    case 'windows-drive':
      return { syntax, platform: 'windows', compatibility: windowsHost ? 'local' : 'foreign' };
    case 'windows-unc':
      return {
        syntax,
        platform: 'windows',
        compatibility: !hasUncServerAndShare(path as string)
          ? 'invalid'
          : windowsHost
            ? 'local'
            : 'foreign',
      };
    case 'windows-extended-drive':
    case 'windows-extended-unc':
    case 'windows-device':
      return { syntax, platform: 'windows', compatibility: windowsHost ? 'unsupported' : 'foreign' };
    case 'windows-rooted':
    case 'windows-drive-relative':
      return { syntax, platform: 'windows', compatibility: 'ambiguous' };
    case 'relative':
    case 'home-shorthand':
      return { syntax, platform: null, compatibility: 'ambiguous' };
    case 'empty':
      return { syntax, platform: null, compatibility: 'invalid' };
  }
}

/** True only for a local absolute path on this host. */
export function isLocalPath(path: unknown, host: PathPlatform): path is string {
  return classifyPath(path, host).compatibility === 'local';
}

/** True for a plain relative path (`apps/web`, `apps\web`): no root, drive, `~` or prefix. */
export function isRelativePath(path: unknown): path is string {
  return classifyPathSyntax(path) === 'relative';
}

/**
 * Splits a local absolute path into a comparison prefix and its components. Only the prefix
 * is case-folded on Windows (drive letter, UNC server and share are case-insensitive by
 * definition); components keep their case, since Windows directories can be case-sensitive.
 * Returns null for a path that is not local, or that contains `.`/`..` components, which
 * would need resolution rather than comparison.
 */
function comparisonParts(path: unknown, host: PathPlatform): { prefix: string; parts: string[] } | null {
  if (!isLocalPath(path, host)) return null;
  const syntax = classifyPathSyntax(path);
  let prefix: string;
  let rest: string[];
  if (syntax === 'posix-absolute') {
    prefix = '/';
    rest = path.split('/');
  } else {
    const segments = path.split(/[\\/]/);
    if (syntax === 'windows-drive') {
      prefix = segments[0].toUpperCase();
      rest = segments.slice(1);
    } else {
      const [server, share, ...tail] = segments.filter(Boolean);
      prefix = `\\\\${server.toUpperCase()}\\${share.toUpperCase()}`;
      rest = tail;
    }
  }
  const parts = rest.filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) return null;
  return { prefix, parts };
}

/**
 * Lexical host-policy equality, not filesystem identity: two spellings of the same local
 * path (`C:\Repo`, `c:/Repo\`) are equal; aliases through symlinks, junctions, mapped drives
 * or `\\?\` are not, and neither are paths that are not local on this host.
 */
export function arePathsEquivalent(a: unknown, b: unknown, host: PathPlatform): boolean {
  const pa = comparisonParts(a, host);
  const pb = comparisonParts(b, host);
  return (
    pa !== null &&
    pb !== null &&
    pa.prefix === pb.prefix &&
    pa.parts.length === pb.parts.length &&
    pa.parts.every((part, i) => part === pb.parts[i])
  );
}

/** True when `child` is `root` or lies under it, by the same lexical rules as equality. */
export function isPathInside(root: unknown, child: unknown, host: PathPlatform): boolean {
  const r = comparisonParts(root, host);
  const c = comparisonParts(child, host);
  return (
    r !== null &&
    c !== null &&
    r.prefix === c.prefix &&
    c.parts.length >= r.parts.length &&
    r.parts.every((part, i) => part === c.parts[i])
  );
}
