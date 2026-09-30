import { useState } from 'react';
import type { ChangeAttribution } from './types';
import { getRepositoryFileStatusPresentation } from '../evidenceCollectors/fileStatusPresentation';
import './ChangeAttributionView.css';

export interface ChangeAttributionViewProps {
  attribution: ChangeAttribution;
  onViewSnapshot?: (snapshotId: string) => void;
  titleOverride?: string;
}

export function ChangeAttributionView({
  attribution,
  onViewSnapshot,
  titleOverride,
}: ChangeAttributionViewProps) {
  const [showFiles, setShowFiles] = useState(true);
  const [showBaselineFiles, setShowBaselineFiles] = useState(false);
  const [showLimitations, setShowLimitations] = useState(false);

  const delta = attribution.delta;
  const isCleanBaseline = attribution.scope === 'clean-baseline';
  const isVerification = attribution.targetType === 'verification-run';

  // Separate active run changes from pre-existing baseline modifications
  const runChanges = delta
    ? delta.files.filter((f) => f.deltaKind !== 'unchanged-existing')
    : [];
  const baselineFiles = delta
    ? delta.files.filter((f) => f.deltaKind === 'unchanged-existing')
    : [];

  const hasRunChanges = runChanges.length > 0;
  const hasBaselineFiles =
    baselineFiles.length > 0 && attribution.scope === 'dirty-baseline';

  const title =
    titleOverride ??
    (isVerification ? 'Repository Impact' : 'Repository Changes');

  return (
    <section
      className="change-attribution-container"
      aria-label={isVerification ? 'Repository verification impact' : 'Repository change attribution'}
    >
      {/* Header */}
      <div className="change-attribution-header">
        <div className="attribution-title-group">
          <span className="attribution-badge-icon" aria-hidden="true">
            Δ
          </span>
          <span className="attribution-title">{title}</span>
          <span
            className={`attribution-scope-badge attribution-scope-badge--${attribution.scope}`}
            title={
              isCleanBaseline
                ? 'Repository was clean at baseline before execution'
                : 'Repository already contained uncommitted changes prior to execution'
            }
          >
            {isCleanBaseline ? 'Clean baseline' : 'Dirty baseline'}
          </span>
        </div>

        <div className="attribution-window-note">
          {hasRunChanges
            ? `Observed during ${isVerification ? 'verification run' : 'execution window'}`
            : isCleanBaseline
            ? `No changes during ${isVerification ? 'verification run' : 'execution window'}`
            : `Pre-existing before ${isVerification ? 'verification' : 'execution'}`}
        </div>
      </div>

      {/* Summary metrics row for changes during this run */}
      {delta ? (
        <div className="attribution-metrics-row">
          <span className="attribution-files-summary">
            {runChanges.length === 0 ? (
              <span className="attribution-no-changes">
                0 new files changed during this {isVerification ? 'run' : 'execution'}
              </span>
            ) : (
              <span className="attribution-changes-count">
                {runChanges.length} file{runChanges.length === 1 ? '' : 's'} changed during this {isVerification ? 'run' : 'execution'}
              </span>
            )}
          </span>

          {hasRunChanges &&
            (typeof delta.insertions === 'number' ||
              typeof delta.deletions === 'number') && (
              <span className="attribution-numstat">
                {typeof delta.insertions === 'number' && (
                  <span className="numstat-ins">+{delta.insertions}</span>
                )}
                {typeof delta.deletions === 'number' && (
                  <span className="numstat-del">-{delta.deletions}</span>
                )}
              </span>
            )}

          {hasRunChanges && (
            <button
              type="button"
              className="attribution-toggle-btn"
              onClick={() => setShowFiles((prev) => !prev)}
              aria-expanded={showFiles}
            >
              {showFiles ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
      ) : (
        <div className="attribution-unavailable-note">
          {attribution.status === 'pending'
            ? 'Collecting post-execution changes...'
            : 'Repository attribution unavailable.'}
        </div>
      )}

      {/* Changed files list — strictly files modified during the run */}
      {delta && hasRunChanges && showFiles && (
        <div className="attribution-files-section">
          <ul className="attribution-files-list">
            {runChanges.map((file) => {
              const statusPresentation = getRepositoryFileStatusPresentation(file.status);

              return (
                <li key={file.path} className="attribution-file-item">
                  <span
                    className={`file-status-tag ${statusPresentation.className}`}
                    title={statusPresentation.title}
                    aria-label={statusPresentation.title}
                  >
                    {statusPresentation.label}
                  </span>

                  <span className="attribution-file-path" title={file.path}>
                    {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                  </span>

                  <span
                    className={`attribution-delta-kind-tag delta-kind--${file.deltaKind}`}
                    title={`Attribution classification: ${file.deltaKind}`}
                  >
                    {file.deltaKind === 'changed-further'
                      ? 'changed further'
                      : file.deltaKind === 'introduced'
                        ? 'new'
                        : file.deltaKind}
                  </span>

                  {(typeof file.insertions === 'number' || typeof file.deletions === 'number') && (
                    <span className="file-numstat">
                      {typeof file.insertions === 'number' && (
                        <span className="numstat-ins">+{file.insertions}</span>
                      )}
                      {typeof file.deletions === 'number' && (
                        <span className="numstat-del">-{file.deletions}</span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Pre-existing Dirty Baseline Section — Separated & Collapsed by Default */}
      {delta && hasBaselineFiles && (
        <div className="attribution-baseline-section">
          <div className="attribution-baseline-header">
            <div className="attribution-baseline-title-group">
              <span className="attribution-baseline-title">
                Pre-existing changes before {isVerification ? 'verification' : 'execution'}
              </span>
              <span className="attribution-baseline-count">
                {baselineFiles.length} file{baselineFiles.length === 1 ? '' : 's'}
              </span>
            </div>
            <button
              type="button"
              className="attribution-toggle-btn attribution-baseline-toggle-btn"
              onClick={() => setShowBaselineFiles((prev) => !prev)}
              aria-expanded={showBaselineFiles}
              title={showBaselineFiles ? 'Hide baseline' : 'Show baseline'}
              aria-label={showBaselineFiles ? 'Hide baseline' : 'Show baseline'}
            >
              {showBaselineFiles ? (
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
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="2" x2="23" y2="23" />
                </svg>
              ) : (
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
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          <div className="attribution-baseline-note">
            These changes existed before this {isVerification ? 'VerificationRun' : 'execution'} started.
          </div>

          {showBaselineFiles && (
            <ul className="attribution-files-list attribution-baseline-list">
              {baselineFiles.map((file) => {
                const statusPresentation = getRepositoryFileStatusPresentation(file.status);

                return (
                  <li key={file.path} className="attribution-file-item attribution-file-item--baseline">
                    <span
                      className={`file-status-tag ${statusPresentation.className}`}
                      title={statusPresentation.title}
                      aria-label={statusPresentation.title}
                    >
                      {statusPresentation.label}
                    </span>

                    <span className="attribution-file-path" title={file.path}>
                      {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                    </span>

                    <span
                      className="attribution-delta-kind-tag delta-kind--unchanged-existing"
                      title="Pre-existing change present prior to this run"
                    >
                      pre-existing
                    </span>

                    {(typeof file.insertions === 'number' || typeof file.deletions === 'number') && (
                      <span className="file-numstat">
                        {typeof file.insertions === 'number' && (
                          <span className="numstat-ins">+{file.insertions}</span>
                        )}
                        {typeof file.deletions === 'number' && (
                          <span className="numstat-del">-{file.deletions}</span>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Snapshot navigation links & Limitations drawer */}
      <div className="attribution-footer">
        <div className="attribution-snapshot-links">
          {attribution.beforeSnapshotId && onViewSnapshot && (
            <button
              type="button"
              className="attribution-snapshot-btn"
              onClick={() => onViewSnapshot(attribution.beforeSnapshotId!)}
            >
              Before: {attribution.beforeSnapshotId.slice(0, 16)}
            </button>
          )}
          {attribution.afterSnapshotId && onViewSnapshot && (
            <button
              type="button"
              className="attribution-snapshot-btn"
              onClick={() => onViewSnapshot(attribution.afterSnapshotId!)}
            >
              After: {attribution.afterSnapshotId.slice(0, 16)}
            </button>
          )}
        </div>

        {attribution.limitations.length > 0 && (
          <div className="attribution-limitations-toggle">
            <button
              type="button"
              className="attribution-limitations-btn"
              onClick={() => setShowLimitations((prev) => !prev)}
              aria-expanded={showLimitations}
            >
              {showLimitations ? 'Hide attribution limits' : 'Attribution limits'}
            </button>
          </div>
        )}
      </div>

      {showLimitations && attribution.limitations.length > 0 && (
        <ul className="attribution-limitations-list">
          {attribution.limitations.map((lim, idx) => (
            <li key={idx} className="attribution-limitation-item">
              {lim}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
