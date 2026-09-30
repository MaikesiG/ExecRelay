import { memo, useState } from 'react';
import type {
  DiagnosticEvidence,
  StructuredEngineeringEvidence,
  TestSummaryEvidence,
  TypecheckSummaryEvidence,
} from './types';
import './StructuredEvidenceView.css';

export interface StructuredEvidenceViewProps {
  evidence: StructuredEngineeringEvidence[];
  onShowSourceEvidence?: (sourceEvidenceBlockIds: string[]) => void;
}

export const StructuredEvidenceView = memo(function StructuredEvidenceView({
  evidence,
  onShowSourceEvidence,
}: StructuredEvidenceViewProps) {
  const [showAllDiagnostics, setShowAllDiagnostics] = useState(false);

  if (!evidence || evidence.length === 0) {
    return null;
  }

  // Group evidence by category
  const testSummaries = evidence.filter(
    (e): e is TestSummaryEvidence => e.type === 'test-summary',
  );
  const diagnostics = evidence.filter(
    (e): e is DiagnosticEvidence => e.type === 'diagnostic',
  );
  const typecheckSummaries = evidence.filter(
    (e): e is TypecheckSummaryEvidence => e.type === 'typecheck-summary',
  );

  return (
    <div
      className="structured-evidence-container"
      data-testid="structured-engineering-evidence"
      aria-label="Structured Engineering Evidence"
    >
      <div className="structured-evidence-header">
        <span className="structured-evidence-title">Structured Evidence</span>
      </div>

      {/* Test Summaries */}
      {testSummaries.map((summary) => {
        const frameworkLabel =
          summary.framework === 'cargo-test'
            ? 'Cargo test'
            : summary.framework === 'jest'
              ? 'Jest'
              : summary.framework === 'vitest'
                ? 'Vitest'
                : summary.framework === 'pytest'
                  ? 'Pytest'
                  : 'Tests';

        return (
          <div
            key={summary.id}
            className="structured-evidence-card structured-evidence-card--test"
            data-testid="test-summary-card"
          >
            <div className="structured-evidence-card-header">
              <span className="structured-evidence-framework-badge">
                {frameworkLabel}
              </span>
              {summary.durationMs !== undefined && (
                <span className="structured-evidence-duration">
                  {(summary.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>

            <div className="structured-evidence-stats-row">
              {summary.passed !== undefined && (
                <span className="structured-stat-pill structured-stat-pill--passed">
                  ✓ {summary.passed} passed
                </span>
              )}
              {summary.failed !== undefined && summary.failed > 0 && (
                <span className="structured-stat-pill structured-stat-pill--failed">
                  ✕ {summary.failed} failed
                </span>
              )}
              {summary.failed === 0 && summary.passed !== undefined && (
                <span className="structured-stat-pill structured-stat-pill--neutral">
                  ✕ 0 failed
                </span>
              )}
              {summary.skipped !== undefined && summary.skipped > 0 && (
                <span className="structured-stat-pill structured-stat-pill--skipped">
                  ○ {summary.skipped} skipped
                </span>
              )}
              {summary.todo !== undefined && summary.todo > 0 && (
                <span className="structured-stat-pill structured-stat-pill--todo">
                  ◌ {summary.todo} todo
                </span>
              )}
            </div>

            {/* Suites / Files stats if present */}
            {(summary.suitesTotal !== undefined || summary.suitesPassed !== undefined) && (
              <div className="structured-evidence-subtext">
                Suites: {summary.suitesPassed ?? summary.suitesTotal ?? 0} /{' '}
                {summary.suitesTotal ?? (summary.suitesPassed ?? 0) + (summary.suitesFailed ?? 0)} passed
              </div>
            )}

            {/* Failed Tests list */}
            {summary.failedTests && summary.failedTests.length > 0 && (
              <div className="structured-evidence-failures-section">
                <span className="structured-failures-title">Failures:</span>
                <ul className="structured-failures-list">
                  {summary.failedTests.map((fail, idx) => (
                    <li key={idx} className="structured-failure-item">
                      <span className="structured-failure-name">
                        {fail.suite ? `${fail.suite} › ` : ''}
                        {fail.name ?? fail.file ?? 'Unknown test'}
                      </span>
                      {fail.message && (
                        <span className="structured-failure-msg">{fail.message}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {onShowSourceEvidence && summary.sourceEvidenceBlockIds.length > 0 && (
              <button
                type="button"
                className="structured-evidence-source-btn"
                onClick={() => onShowSourceEvidence(summary.sourceEvidenceBlockIds)}
                title="View canonical source evidence for this summary"
              >
                Show source evidence
              </button>
            )}
          </div>
        );
      })}

      {/* Typecheck Summaries & Diagnostics */}
      {diagnostics.length > 0 && (
        <div
          className="structured-evidence-card structured-evidence-card--diagnostic"
          data-testid="diagnostic-card"
        >
          <div className="structured-evidence-card-header">
            <span className="structured-evidence-framework-badge">
              TypeScript
            </span>
            <span className="structured-evidence-diag-count">
              {diagnostics.length} {diagnostics.length === 1 ? 'diagnostic' : 'diagnostics'}
            </span>
          </div>

          <div className="structured-diagnostics-list">
            {(showAllDiagnostics ? diagnostics : diagnostics.slice(0, 5)).map(
              (diag) => (
                <div key={diag.id} className="structured-diagnostic-item">
                  <div className="structured-diagnostic-location">
                    <code>
                      {diag.file ?? 'unknown'}
                      {diag.line !== undefined ? `:${diag.line}` : ''}
                      {diag.column !== undefined ? `:${diag.column}` : ''}
                    </code>
                    {diag.code && (
                      <span className="structured-diagnostic-code">
                        {diag.code}
                      </span>
                    )}
                  </div>
                  <div className="structured-diagnostic-message">
                    {diag.message}
                  </div>
                </div>
              ),
            )}

            {diagnostics.length > 5 && !showAllDiagnostics && (
              <button
                type="button"
                className="structured-more-diagnostics-btn"
                onClick={() => setShowAllDiagnostics(true)}
              >
                + {diagnostics.length - 5} more diagnostics
              </button>
            )}
          </div>

          {onShowSourceEvidence && diagnostics[0].sourceEvidenceBlockIds.length > 0 && (
            <button
              type="button"
              className="structured-evidence-source-btn"
              onClick={() => onShowSourceEvidence(diagnostics[0].sourceEvidenceBlockIds)}
              title="View canonical source evidence for diagnostics"
            >
              Show source evidence
            </button>
          )}
        </div>
      )}

      {/* Typecheck summary without individual diagnostics */}
      {diagnostics.length === 0 && typecheckSummaries.map((tc) => (
        <div
          key={tc.id}
          className="structured-evidence-card structured-evidence-card--diagnostic"
          data-testid="typecheck-summary-card"
        >
          <div className="structured-evidence-card-header">
            <span className="structured-evidence-framework-badge">
              TypeScript
            </span>
          </div>
          <div className="structured-evidence-stats-row">
            {tc.errorCount !== undefined && tc.errorCount > 0 && (
              <span className="structured-stat-pill structured-stat-pill--failed">
                ✕ {tc.errorCount} errors
              </span>
            )}
            {tc.errorCount === 0 && (
              <span className="structured-stat-pill structured-stat-pill--passed">
                ✓ 0 errors
              </span>
            )}
            {tc.warningCount !== undefined && tc.warningCount > 0 && (
              <span className="structured-stat-pill structured-stat-pill--skipped">
                ⚠ {tc.warningCount} warnings
              </span>
            )}
          </div>

          {onShowSourceEvidence && tc.sourceEvidenceBlockIds.length > 0 && (
            <button
              type="button"
              className="structured-evidence-source-btn"
              onClick={() => onShowSourceEvidence(tc.sourceEvidenceBlockIds)}
              title="View canonical source evidence for typecheck"
            >
              Show source evidence
            </button>
          )}
        </div>
      ))}
    </div>
  );
});
