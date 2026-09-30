import { memo, useMemo, useCallback, useState } from 'react';
import type {
  CollectorCommandInput,
  CollectorCommandOutput,
  EvidenceCollectionRun,
  RepositorySnapshot,
  RepositoryFileLineStatsSource,
} from './types';
import {
  formatRepositoryPathsForClipboard,
  formatRepositoryChangesForClipboard,
  formatRepositoryFileChangeEvidence,
  resolveRepositoryFileChangeEvidence,
  resolveAllRepositoryChangesEvidence,
} from './repositoryEvidenceCopy';
import { runCollectorProcess } from './collectorRunner';
import type {
  EvidenceSelectionState,
} from '../evidenceSelection/types';
import {
  isItemSelected,
  createRepositoryFileSelectionItem,
  formatRepositoryFileText,
} from '../evidenceSelection';
import { copyToClipboard } from '../transcript/transcriptFormat';
import { openInFinder } from '../workspace/workspaceContext';
import { getRepositoryFileStatusPresentation } from './fileStatusPresentation';
import './RepositoryEvidenceView.css';

export interface RepositoryFileItemData {
  path: string;
  snapshotId?: string;
  status?: string;
  previousPath?: string;
  insertions?: number;
  deletions?: number;
  binary?: boolean;
  lineStatsSource?: RepositoryFileLineStatsSource;
  repositoryRoot?: string;
}

export interface RepositoryEvidenceViewProps {
  snapshot?: RepositorySnapshot | null;
  collectionRun?: EvidenceCollectionRun | null;
  isCollecting?: boolean;
  onRefresh?: () => void;
  selectionState?: EvidenceSelectionState;
  onToggleFileSelection?: (file: RepositoryFileItemData) => void;
  onSelectAllFiles?: (files: RepositoryFileItemData[]) => void;
  onClearFileSelection?: () => void;
  onCopyFeedback?: (message: string) => void;
  runner?: (input: CollectorCommandInput) => Promise<CollectorCommandOutput>;
  workspaceName?: string;
  workspaceRootPath?: string;
  repositoryRoot?: string;
  repositoryBranch?: string;
  onOpenFolder?: () => void;
}

export const RepositoryEvidenceView = memo(function RepositoryEvidenceView({
  snapshot,
  collectionRun,
  isCollecting = false,
  onRefresh,
  selectionState,
  onToggleFileSelection,
  onSelectAllFiles,
  onClearFileSelection,
  onCopyFeedback,
  runner,
  workspaceName,
  workspaceRootPath,
  repositoryRoot,
  repositoryBranch,
  onOpenFolder,
}: RepositoryEvidenceViewProps) {
  const metadata = snapshot?.metadata;
  const status = snapshot?.status;
  const diffSummary = snapshot?.diffSummary;

  const isUnsupported = collectionRun?.status === 'unsupported';
  const isFailed = collectionRun?.status === 'failed';
  const effectiveRepoRoot = repositoryRoot ?? snapshot?.repositoryRoot;
  const effectiveBranch = repositoryBranch ?? metadata?.branch;

  // Merge status files with diff summary to get numstats, prioritizing authoritative Git numstat
  // for tracked changes and derived working-tree line counts for untracked files.
  const fileItems: RepositoryFileItemData[] = useMemo(() => {
    if (!status || !status.files) return [];
    return status.files.map((file) => {
      const fileDiff = diffSummary?.files.find((f) => f.path === file.path);
      const isTrackedDiff =
        fileDiff?.insertions !== undefined || fileDiff?.deletions !== undefined;

      let insertions: number | undefined;
      let deletions: number | undefined;
      let binary: boolean | undefined;
      let lineStatsSource: RepositoryFileLineStatsSource;

      if (isTrackedDiff) {
        // Priority 1: Authoritative Git numstat for tracked / staged changes
        insertions = fileDiff?.insertions;
        deletions = fileDiff?.deletions;
        binary = fileDiff?.binary;
        lineStatsSource = 'git-numstat';
      } else if (file.status === 'untracked') {
        // Priority 2: Safe working-tree line count only for untracked files
        if (typeof file.insertions === 'number') {
          insertions = file.insertions;
          deletions = file.deletions ?? 0;
          binary = file.binary;
          lineStatsSource = file.lineStatsSource ?? 'working-tree-line-count';
        } else {
          binary = file.binary;
          lineStatsSource = 'unavailable';
        }
      } else {
        // Priority 3: Unavailable otherwise
        binary = fileDiff?.binary ?? file.binary;
        lineStatsSource = 'unavailable';
      }

      return {
        path: file.path,
        snapshotId: snapshot?.id,
        status: file.status,
        previousPath: file.previousPath,
        insertions,
        deletions,
        binary,
        lineStatsSource,
        repositoryRoot: snapshot?.repositoryRoot,
      };
    });
  }, [status, diffSummary, snapshot?.id, snapshot?.repositoryRoot]);

  // Aggregate stats separating Git diff metrics from derived untracked additions
  const aggregateStats = useMemo(() => {
    let gitInsertions = 0;
    let gitDeletions = 0;
    let untrackedInsertions = 0;
    let hasCountableLines = false;

    for (const item of fileItems) {
      if (item.lineStatsSource === 'working-tree-line-count') {
        if (typeof item.insertions === 'number') {
          untrackedInsertions += item.insertions;
          hasCountableLines = true;
        }
      } else {
        if (typeof item.insertions === 'number') {
          gitInsertions += item.insertions;
          hasCountableLines = true;
        }
        if (typeof item.deletions === 'number') {
          gitDeletions += item.deletions;
          hasCountableLines = true;
        }
      }
    }

    if (diffSummary) {
      if (typeof diffSummary.insertions === 'number') gitInsertions = diffSummary.insertions;
      if (typeof diffSummary.deletions === 'number') gitDeletions = diffSummary.deletions;
    }

    const totalInsertions = gitInsertions + untrackedInsertions;
    const totalDeletions = gitDeletions;

    return {
      gitInsertions,
      gitDeletions,
      untrackedInsertions,
      totalInsertions,
      totalDeletions,
      hasCountableLines:
        hasCountableLines ||
        typeof diffSummary?.insertions === 'number' ||
        typeof diffSummary?.deletions === 'number',
    };
  }, [fileItems, diffSummary]);

  // Compute selected count within repository files
  const selectedCount = useMemo(() => {
    if (!selectionState || fileItems.length === 0) return 0;
    return fileItems.filter((f) => {
      const key = createRepositoryFileSelectionItem(f).id;
      return isItemSelected(selectionState, key);
    }).length;
  }, [selectionState, fileItems]);

  const isAllSelected = fileItems.length > 0 && selectedCount === fileItems.length;

  const handleToggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      onClearFileSelection?.();
    } else {
      onSelectAllFiles?.(fileItems);
    }
  }, [isAllSelected, fileItems, onClearFileSelection, onSelectAllFiles]);

  const [isResolvingChanges, setIsResolvingChanges] = useState(false);

  // Copy paths: lightweight file/path inventory only
  const handleCopyPaths = useCallback(async () => {
    if (fileItems.length === 0) {
      await copyToClipboard('No repository changes observed.');
      onCopyFeedback?.('No repository changes to copy');
      return;
    }
    const text = formatRepositoryPathsForClipboard({
      files: fileItems,
      branch: metadata?.branch,
      headCommit: metadata?.headCommit,
    });
    await copyToClipboard(text);
    const count = fileItems.length;
    onCopyFeedback?.(`Copied ${count} changed ${count === 1 ? 'path' : 'paths'}`);
  }, [fileItems, metadata?.branch, metadata?.headCommit, onCopyFeedback]);

  // Copy changes: complete change evidence for all files
  const handleCopyChanges = useCallback(async () => {
    if (fileItems.length === 0) {
      await copyToClipboard('No repository changes observed.');
      onCopyFeedback?.('No repository changes to copy');
      return;
    }
    const repoRoot = snapshot?.repositoryRoot;
    if (!repoRoot) {
      onCopyFeedback?.('Repository root unavailable');
      return;
    }

    setIsResolvingChanges(true);
    try {
      const effectiveRunner = runner ?? runCollectorProcess;
      const resolvedFiles = await resolveAllRepositoryChangesEvidence(fileItems, {
        repositoryRoot: repoRoot,
        runCommand: effectiveRunner,
      });

      const text = formatRepositoryChangesForClipboard({
        files: resolvedFiles,
        branch: metadata?.branch,
        headCommit: metadata?.headCommit,
        totalInsertions: aggregateStats.totalInsertions,
        totalDeletions: aggregateStats.totalDeletions,
      });

      await copyToClipboard(text);
      onCopyFeedback?.('Copied repository changes');
    } catch (err) {
      console.warn('[RepositoryEvidenceView] Failed to copy changes:', err);
      onCopyFeedback?.('Failed to copy repository changes');
    } finally {
      setIsResolvingChanges(false);
    }
  }, [
    fileItems,
    snapshot?.repositoryRoot,
    runner,
    metadata?.branch,
    metadata?.headCommit,
    aggregateStats,
    onCopyFeedback,
  ]);

  // Per-file row copy: actual change evidence for single file
  const handleCopyOne = useCallback(
    async (file: RepositoryFileItemData) => {
      const repoRoot = file.repositoryRoot ?? snapshot?.repositoryRoot;
      if (!repoRoot) {
        const fallback = formatRepositoryFileText(file);
        await copyToClipboard(fallback);
        onCopyFeedback?.(`Copied ${file.path}`);
        return;
      }

      try {
        const effectiveRunner = runner ?? runCollectorProcess;
        const resolved = await resolveRepositoryFileChangeEvidence(file, {
          repositoryRoot: repoRoot,
          runCommand: effectiveRunner,
        });

        const text = formatRepositoryFileChangeEvidence(resolved);
        await copyToClipboard(text);
        onCopyFeedback?.(`Copied change evidence for ${file.path}`);
      } catch (err) {
        console.warn(`[RepositoryEvidenceView] Failed to copy evidence for ${file.path}:`, err);
        const fallback = formatRepositoryFileText(file);
        await copyToClipboard(fallback);
        onCopyFeedback?.(`Copied ${file.path}`);
      }
    },
    [snapshot?.repositoryRoot, runner, onCopyFeedback],
  );

  // Copy selected: copies selected files formatted text
  const handleCopySelected = useCallback(async () => {
    if (!selectionState || fileItems.length === 0) return;
    const selectedFiles = fileItems.filter((f) => {
      const key = createRepositoryFileSelectionItem(f).id;
      return isItemSelected(selectionState, key);
    });
    if (selectedFiles.length === 0) return;
    const text = selectedFiles.map(formatRepositoryFileText).join('\n');
    await copyToClipboard(text);
    onCopyFeedback?.(
      `Copied ${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'}`,
    );
  }, [selectionState, fileItems, onCopyFeedback]);

  const headCommit = metadata?.headCommit;
  const shortHead =
    headCommit && headCommit.trim().length > 0
      ? headCommit.trim().slice(0, 7)
      : null;

  const handleCopyCommit = useCallback(async () => {
    if (!shortHead) return;
    await copyToClipboard(shortHead);
    onCopyFeedback?.(`Copied commit ${shortHead}`);
  }, [shortHead, onCopyFeedback]);

  const handleOpenInFinder = useCallback(async () => {
    if (!effectiveRepoRoot) return;
    await openInFinder(effectiveRepoRoot);
  }, [effectiveRepoRoot]);

  return (
    <div
      className="repository-evidence-container"
      data-testid="repository-evidence-view"
      aria-label="Repository Engineering Evidence"
    >
      <div className="repository-evidence-header">
        <div className="repository-evidence-header-top">
          <div className="repository-evidence-title-group">
            <span className="repository-evidence-title">CHANGES</span>
            {workspaceName && (
              <span className="repository-workspace-name">{workspaceName}</span>
            )}
          </div>
        </div>

        {effectiveRepoRoot && (
          <div className="repository-evidence-meta-row">
            <div className="repository-evidence-meta-left">
              {shortHead && (
                <div className="repository-commit-group">
                  <span
                    className="repository-commit-badge"
                    title={`HEAD Commit: ${headCommit}`}
                  >
                    {shortHead}
                  </span>
                  <button
                    type="button"
                    className="compact-icon-btn repository-copy-commit-btn"
                    onClick={handleCopyCommit}
                    title="Copy commit"
                    aria-label="Copy commit"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              )}

              <button
                type="button"
                className="compact-icon-btn repository-open-finder-btn"
                onClick={handleOpenInFinder}
                disabled={!effectiveRepoRoot}
                title={`Open in Finder\n${effectiveRepoRoot}`}
                aria-label={`Open in Finder: ${effectiveRepoRoot}`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </button>

              {effectiveBranch && (
                <span className="repository-branch-badge" title={`Active Branch: ${effectiveBranch}`}>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span>branch: {effectiveBranch}</span>
                </span>
              )}
            </div>

            <div className="repository-evidence-meta-right">
              {onRefresh && (
                <button
                  type="button"
                  className={`compact-icon-btn repository-refresh-btn ${isCollecting ? 'repository-refresh-btn--loading' : ''}`}
                  onClick={onRefresh}
                  disabled={isCollecting}
                  title="Refresh changes"
                  aria-label="Refresh changes"
                >
                  <svg
                    className={isCollecting ? 'spin' : ''}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Unsupported Notice */}
      {isUnsupported && (
        <div className="repository-unsupported-note">
          Not a Git repository — repository evidence collection is unavailable for this directory.
        </div>
      )}

      {/* Failure / Error Notice (RELEASE-002: Truthful degradation without breaking Terminal) */}
      {isFailed && !isUnsupported && (
        <div className="repository-error-note" role="alert" data-testid="repository-error">
          <p className="repository-error-title">Could not refresh repository changes.</p>
          {collectionRun?.errorMessage && (
            <p className="repository-error-message">{collectionRun.errorMessage}</p>
          )}
        </div>
      )}

      {/* Snapshot Content */}
      {snapshot && !isUnsupported && (
        <div className="repository-snapshot-body">
          {/* Status Metrics & Header Copy Actions */}
          {status && (
            <div className="repository-status-summary">
              {status.clean ? (
                <div className="repository-clean-pill">
                  ✓ Working tree clean
                </div>
              ) : (
                <div className="repository-dirty-stats">
                  <span className="repository-change-count">
                    {status.files.length} {status.files.length === 1 ? 'file changed' : 'files changed'}
                  </span>
                  {aggregateStats.hasCountableLines && (
                    <span
                      className="repository-numstat-total"
                      title={
                        aggregateStats.untrackedInsertions > 0
                          ? `Total repository changes: +${aggregateStats.totalInsertions} (-${aggregateStats.totalDeletions}) [Git diff: +${aggregateStats.gitInsertions}, untracked: +${aggregateStats.untrackedInsertions}]`
                          : `Git numstat total: +${aggregateStats.totalInsertions} -${aggregateStats.totalDeletions}`
                      }
                      aria-label={
                        aggregateStats.untrackedInsertions > 0
                          ? `Total repository changes: +${aggregateStats.totalInsertions} (-${aggregateStats.totalDeletions})`
                          : `Git numstat total: +${aggregateStats.totalInsertions} -${aggregateStats.totalDeletions}`
                      }
                    >
                      <span className="numstat-ins">+{aggregateStats.totalInsertions}</span>
                      <span className="numstat-del">-{aggregateStats.totalDeletions}</span>
                    </span>
                  )}
                </div>
              )}

              {/* Action buttons: Copy paths & Copy changes */}
              <div className="repository-header-copy-actions">
                <button
                  type="button"
                  className="compact-icon-btn repository-copy-paths-btn"
                  onClick={handleCopyPaths}
                  disabled={fileItems.length === 0}
                  title="Copy file paths"
                  aria-label="Copy file paths"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M15.5 2H8.6c-.4 0-.8.2-1.1.5-.3.3-.5.7-.5 1.1v12.8c0 .4.2.8.5 1.1.3.3.7.5 1.1.5h9.8c.4 0 .8-.2 1.1-.5.3-.3.5-.7.5-1.1V6.5L15.5 2z" />
                    <path d="M3 7.6v12.8c0 .4.2.8.5 1.1.3.3.7.5 1.1.5h9.8" />
                    <path d="M15 2v5h5" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="compact-icon-btn repository-copy-changes-btn"
                  onClick={handleCopyChanges}
                  disabled={fileItems.length === 0 || isResolvingChanges}
                  title="Copy changes"
                  aria-label="Copy changes"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                    <path d="M9 13h6" />
                    <path d="M12 10v6" />
                    <path d="M9 17h6" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Files List with selection controls */}
          {fileItems.length > 0 && (
            <div className="repository-files-section">
              {/* Compact Toolbar for Selection and Bulk Copy */}
              <div className="repository-selection-toolbar">
                <label className="repository-select-all-label">
                  <input
                    type="checkbox"
                    className="compact-checkbox"
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                    title="Select all repository files"
                    aria-label="Select all repository files"
                  />
                  <span>Select all</span>
                </label>

                {selectedCount > 0 && (
                  <span className="repository-selected-count">
                    ({selectedCount} selected)
                  </span>
                )}

                {selectedCount > 0 && (
                  <div className="repository-toolbar-copy-group">
                    <button
                      type="button"
                      className="compact-btn repository-copy-btn"
                      onClick={onClearFileSelection}
                      title="Clear repository file selection"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="compact-btn repository-copy-btn"
                      onClick={handleCopySelected}
                      title="Copy selected files text"
                    >
                      Copy selected
                    </button>
                  </div>
                )}
              </div>

              <ul className="repository-files-list">
                {fileItems.map((file) => {
                  const selectionKey = createRepositoryFileSelectionItem(file).id;
                  const isChecked = selectionState ? isItemSelected(selectionState, selectionKey) : false;

                  const statusPresentation = getRepositoryFileStatusPresentation(file.status);

                  return (
                    <li
                      key={selectionKey}
                      className={`repository-file-item ${isChecked ? 'repository-file-item--selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="compact-checkbox repository-row-checkbox"
                        checked={isChecked}
                        onChange={() => onToggleFileSelection?.(file)}
                        title={`Select ${file.path}`}
                        aria-label={`Select ${file.path}`}
                      />
                      <span
                        className={`file-status-tag ${statusPresentation.className}`}
                        title={statusPresentation.title}
                        aria-label={statusPresentation.title}
                      >
                        {statusPresentation.label}
                      </span>
                      <span
                        className="repository-file-path"
                        title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                      >
                        {file.previousPath ? (
                          <>
                            <span className="repository-file-path-prev">{file.previousPath}</span>
                            <span className="repository-file-path-arrow" aria-hidden="true"> → </span>
                            <span className="repository-file-path-curr">{file.path}</span>
                          </>
                        ) : (
                          file.path
                        )}
                      </span>
                      {file.binary ? (
                        <span className="file-numstat file-numstat--binary" title="Binary file">
                          binary
                        </span>
                      ) : (file.insertions !== undefined || file.deletions !== undefined) ? (
                        <span
                          className="file-numstat"
                          title={
                            file.lineStatsSource === 'working-tree-line-count'
                              ? `Current file line count: +${file.insertions ?? 0} -${file.deletions ?? 0}`
                              : `Git numstat: +${file.insertions ?? 0} -${file.deletions ?? 0}`
                          }
                          aria-label={
                            file.lineStatsSource === 'working-tree-line-count'
                              ? `Current file line count: +${file.insertions ?? 0} -${file.deletions ?? 0}`
                              : `Git numstat: +${file.insertions ?? 0} -${file.deletions ?? 0}`
                          }
                        >
                          {file.insertions !== undefined && (
                            <span className="numstat-ins">+{file.insertions}</span>
                          )}
                          {file.deletions !== undefined && (
                            <span className="numstat-del">-{file.deletions}</span>
                          )}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="compact-icon-btn repository-row-copy-btn"
                        onClick={() => handleCopyOne(file)}
                        title="Copy change evidence"
                        aria-label={`Copy change evidence for ${file.path}`}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Unbound workspace state (Section 7) */}
      {!workspaceRootPath && (
        <div className="repository-unbound-state" data-testid="repository-unbound">
          <p className="repository-unbound-prompt">Choose a project folder to view repository changes.</p>
          {onOpenFolder && (
            <button
              type="button"
              className="compact-btn repository-open-folder-btn"
              onClick={onOpenFolder}
            >
              Open Folder
            </button>
          )}
        </div>
      )}

      {/* Bound non-Git workspace state (Section 5) */}
      {workspaceRootPath && !effectiveRepoRoot && (
        <div className="repository-no-git-state" data-testid="repository-no-git">
          <p className="repository-no-git-title">No Git repository detected.</p>
          <p className="repository-no-git-meta">Workspace folder: {workspaceRootPath}</p>
          <small className="repository-no-git-sub">Changes requires a Git repository.</small>
          {onOpenFolder && (
            <div style={{ marginTop: '10px' }}>
              <button
                type="button"
                className="compact-btn repository-open-folder-btn"
                onClick={onOpenFolder}
              >
                Change Folder...
              </button>
            </div>
          )}
        </div>
      )}

      {/* Initial state before any collection run for Git repos */}
      {workspaceRootPath && effectiveRepoRoot && !snapshot && !isUnsupported && !isCollecting && (
        <div className="repository-uncollected-prompt">
          <span>Inspect working tree status and diff summary</span>
        </div>
      )}
    </div>
  );
});
