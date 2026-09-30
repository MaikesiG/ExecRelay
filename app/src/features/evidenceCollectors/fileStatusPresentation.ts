/**
 * Repository Evidence File Status Presentation Helper (HARDEN-006)
 *
 * Centralizes UI presentation for repository file status badges across
 * RepositoryEvidenceView and ChangeAttributionView.
 *
 * INVARIANTS:
 * 1. UI-only normalization: canonical status (e.g. 'untracked', 'modified') is never mutated.
 * 2. Stable geometry: all badges produce compact, single-character labels ('M', 'A', '+', 'D', 'R', '!', 'C')
 *    suitable for fixed-width badge containers without row squishing or badge overflow.
 * 3. Accessibility & clarity: full semantic meaning is provided in `title` and `aria-label`.
 * 4. Safe degradation: unknown, null, or undefined statuses degrade safely without throwing.
 */

import type { GitFileStatus } from './types';

export interface RepositoryFileStatusPresentation {
  /** Single-character status code displayed in the badge (e.g. 'M', '+', 'A', 'D', 'R', '!') */
  label: string;
  /** Human-readable descriptive title for tooltip and accessibility (e.g. 'Modified', 'Untracked / New') */
  title: string;
  /** Dedicated CSS class name for dark-theme semantic coloring */
  className: string;
}

/**
 * Returns the presentation mapping for a file status.
 *
 * Supports both semantic status strings ('modified', 'untracked', etc.)
 * and canonical Git porcelain short codes ('M', '??', 'A', 'D', 'R', etc.).
 */
export function getRepositoryFileStatusPresentation(
  status: GitFileStatus | string | undefined | null,
): RepositoryFileStatusPresentation {
  if (!status) {
    return {
      label: '?',
      title: 'Unknown',
      className: 'file-status-tag--unknown',
    };
  }

  const raw = String(status).trim();
  if (!raw) {
    return {
      label: '?',
      title: 'Unknown',
      className: 'file-status-tag--unknown',
    };
  }
  const normalized = raw.toLowerCase();

  switch (normalized) {
    case 'modified':
    case 'm':
      return {
        label: 'M',
        title: 'Modified',
        className: 'file-status-tag--modified',
      };

    case 'added':
    case 'a':
      return {
        label: 'A',
        title: 'Added',
        className: 'file-status-tag--added',
      };

    case 'untracked':
    case '??':
    case '?':
    case '+':
    case 'new':
      return {
        label: '+',
        title: 'Untracked / New',
        className: 'file-status-tag--untracked',
      };

    case 'deleted':
    case 'd':
      return {
        label: 'D',
        title: 'Deleted',
        className: 'file-status-tag--deleted',
      };

    case 'renamed':
    case 'r':
      return {
        label: 'R',
        title: 'Renamed',
        className: 'file-status-tag--renamed',
      };

    case 'copied':
    case 'c':
      return {
        label: 'C',
        title: 'Copied',
        className: 'file-status-tag--copied',
      };

    case 'conflicted':
    case '!':
    case 'u':
    case 'uu':
    case 'aa':
    case 'dd':
      return {
        label: '!',
        title: 'Conflicted',
        className: 'file-status-tag--conflicted',
      };

    default: {
      const fallbackLabel =
        raw.length === 1
          ? raw.toUpperCase()
          : (raw.slice(0, 1).toUpperCase() || '?');
      return {
        label: fallbackLabel,
        title: `Status: ${raw}`,
        className: 'file-status-tag--unknown',
      };
    }
  }
}
