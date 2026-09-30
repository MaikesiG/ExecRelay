import { memo, useMemo, useState, useEffect } from "react";
import type {
  VerificationContract,
  VerificationCriterion,
  VerificationCriterionResult,
  VerificationRun,
} from "./types";
import { deriveVerificationPresentation } from "./verificationModel";
import { ChangeAttributionView } from "../attribution/ChangeAttributionView";
import type { ChangeAttribution } from "../attribution/types";
import { VerificationCheckModal } from "./VerificationCheckModal";
import { VerificationProfileModal } from "./VerificationProfileModal";
import { NewProfileModal } from "./NewProfileModal";
import { stripAnsiAndControl } from "../transcript/transcriptFormat";
import { formatExecutionDuration } from "../execution";
import type { TranscriptBlock } from "../transcript/types";
import type { DiagnosticEvidence } from "../structuredEvidence/types";
import "./VerificationPanel.css";

export interface VerificationPanelProps {
  contract: VerificationContract;
  contracts?: VerificationContract[];
  activeRun: VerificationRun | null;
  historicalRuns: VerificationRun[];
  isRunning: boolean;
  isStopping?: boolean;
  isStopTimeout?: boolean;
  blocks?: TranscriptBlock[];
  selectedCriterionIds?: Set<string>;
  onToggleSelectCriterion?: (criterionId: string) => void;
  onSelectAllCriteria?: () => void;
  onClearCriteriaSelection?: () => void;
  onRunVerification: (selectedCriterionIds?: string[]) => void;
  onCancelVerification: () => void;
  onStopVerification?: () => void;
  onContinueUnfinished?: (run: VerificationRun) => void;
  onSelectRun?: (runId: string) => void;
  onSelectExecution?: (executionId: string) => void;
  onViewSnapshot?: (snapshotId: string) => void;
  changeAttributions?: ChangeAttribution[];

  // Profile and criteria management (HARDEN-012B):
  onSelectProfile?: (contractId: string) => void;
  onCreateProfile?: (name: string) => void;
  onRenameProfile?: (contractId: string, name: string) => void;
  onDeleteProfile?: (contractId: string) => void;
  onAddCriterion?: (
    contractId: string,
    criterion: {
      label: string;
      command: string;
      workingDirectory?: string;
      expectedExitCodes?: number[];
    },
  ) => void;
  onUpdateCriterion?: (contractId: string, criterion: VerificationCriterion) => void;
  onDeleteCriterion?: (contractId: string, criterionId: string) => void;
  onReorderCriteria?: (contractId: string, orderedCriterionIds: string[]) => void;
  onClearRunHistory?: () => void;
}

function getStatusSymbol(status: string): string {
  switch (status) {
    case "passed":
      return "✓";
    case "failed":
      return "✕";
    case "error":
      return "⚠";
    case "running":
      return "●";
    case "interrupted":
      return "⏹";
    case "skipped":
      return "⊘";
    case "pending":
    default:
      return "○";
  }
}

/**
 * Extracts bounded diagnostic or failure output from a canonical execution block.
 */
function extractFailureEvidence(
  res: VerificationCriterionResult,
  block?: TranscriptBlock | null,
): string | null {
  if (block) {
    // 1. Structured diagnostics if available (e.g. TypeScript compiler errors, linter rules)
    if (block.structuredEvidence && block.structuredEvidence.length > 0) {
      const diagnostics = block.structuredEvidence.filter(
        (s): s is DiagnosticEvidence => s.type === "diagnostic" && s.severity === "error",
      );
      if (diagnostics.length > 0) {
        return diagnostics
          .slice(0, 6)
          .map((d) => {
            const loc = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}: ` : "";
            return `${loc}${d.code ? `[${d.code}] ` : ""}${d.message}`;
          })
          .join("\n");
      }
    }

    // 2. Cleaned raw output: extract first matching error lines or top output lines
    if (block.output && block.output.trim().length > 0) {
      const clean = stripAnsiAndControl(block.output).trim();
      const lines = clean.split("\n").filter((l) => l.trim().length > 0);
      const errorLines = lines.filter((l) =>
        /error|failed|exception|TS\d+|cannot find|type error|syntax error/i.test(l),
      );
      const chosen = errorLines.length > 0 ? errorLines.slice(0, 8) : lines.slice(0, 8);
      const excerpt = chosen.join("\n").slice(0, 800);
      if (excerpt.length > 0) {
        return excerpt;
      }
    }
  }

  // 3. Fallback to result message
  return res.message ?? null;
}

export const VerificationPanel = memo(function VerificationPanel({
  contract,
  contracts,
  activeRun,
  historicalRuns,
  isRunning,
  isStopping,
  isStopTimeout,
  blocks,
  selectedCriterionIds: propsSelectedCriterionIds,
  onToggleSelectCriterion,
  onSelectAllCriteria,
  onClearCriteriaSelection,
  onRunVerification,
  onCancelVerification,
  onStopVerification,
  onContinueUnfinished,
  onSelectRun,
  onSelectExecution,
  onViewSnapshot,
  changeAttributions,
  onSelectProfile,
  onCreateProfile,
  onRenameProfile,
  onDeleteProfile,
  onAddCriterion,
  onUpdateCriterion,
  onDeleteCriterion,
  onReorderCriteria,
  onClearRunHistory,
}: VerificationPanelProps) {
  const availableContracts = contracts && contracts.length > 0 ? contracts : [contract];

  // Defensive derivation of valid criteria IDs from the active contract
  const validCriterionIds = useMemo(
    () => new Set(contract.criteria.map((criterion) => criterion.id)),
    [contract.criteria],
  );

  // Preferred flow (HARDEN-VERIFY-DELETE-021 Section 2 & 3):
  // LogicalWorkspace.verification.selectedCriterionIds
  // → VerificationPanel
  // → derive valid/effective selection
  // → render
  //
  // Invariant: effectiveSelectedCriterionIds ⊆ activeContract.criteria IDs at every stable state.
  const effectiveSelectedCriterionIds = useMemo(() => {
    const canonicalIds = propsSelectedCriterionIds ?? validCriterionIds;
    return new Set(
      Array.from(canonicalIds).filter((id) => validCriterionIds.has(id)),
    );
  }, [propsSelectedCriterionIds, validCriterionIds]);

  // Modal dialog states
  const [isCheckModalOpen, setIsCheckModalOpen] = useState(false);
  const [checkModalMode, setCheckModalMode] = useState<"add" | "edit">("add");
  const [editingCriterion, setEditingCriterion] = useState<VerificationCriterion | null>(null);

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isNewProfileModalOpen, setIsNewProfileModalOpen] = useState(false);

  // Historical Run selection (Phase 11)
  const [selectedHistoricalRunId, setSelectedHistoricalRunId] = useState<string | null>(null);

  // When a new active run starts or updates, reset any manual historical selection so current run is immediately visible
  useEffect(() => {
    if (activeRun) {
      setSelectedHistoricalRunId(null);
    }
  }, [activeRun]);

  const displayedRun =
    (selectedHistoricalRunId
      ? historicalRuns.find((r) => r.id === selectedHistoricalRunId)
      : null) ??
    activeRun ??
    (historicalRuns.length > 0 ? historicalRuns[historicalRuns.length - 1] : null);

  // Run History lists strictly historical/previous runs, separating the active Current Run
  const effectiveHistoricalRuns = useMemo(() => {
    if (!activeRun) return historicalRuns;
    return historicalRuns.filter((r) => r.id !== activeRun.id);
  }, [historicalRuns, activeRun]);

  // Criteria displayed:
  // HARDEN-VERIFY-EDITABILITY-022: The criteria list strictly represents the active profile
  // configuration (contract.criteria), which remains mutable for future runs.
  // Historical runs represent immutable evidence and never permanently lock or replace the profile.
  const criteria: VerificationCriterion[] = contract.criteria;

  const resultsMap = new Map<string, VerificationCriterionResult>();
  if (displayedRun) {
    for (const res of displayedRun.criterionResults) {
      resultsMap.set(res.criterionId, res);
    }
  }

  // Section 21, 40, 41: Active-run locking
  const isLocked = isRunning || Boolean(isStopping) || Boolean(isStopTimeout);

  const isTargetActiveRun = Boolean(activeRun && displayedRun?.id === activeRun.id);
  const presentation = deriveVerificationPresentation({
    run: displayedRun,
    isRunning: isTargetActiveRun ? isRunning : displayedRun?.status === "running",
    isStopping: isTargetActiveRun ? isStopping : displayedRun?.status === "stopping",
    isStopTimeout: isTargetActiveRun ? isStopTimeout : displayedRun?.status === "stop-timeout",
  });

  const failedResults = useMemo(() => {
    if (!displayedRun) return [];
    return displayedRun.criterionResults.filter(
      (r) => r.status === "failed" || r.status === "error",
    );
  }, [displayedRun]);

  const isRunFailed = Boolean(
    displayedRun &&
      (displayedRun.status === "failed" ||
        displayedRun.status === "error" ||
        failedResults.length > 0),
  );

  const runAttribution = displayedRun
    ? (changeAttributions?.find(
        (a) =>
          a.targetId === displayedRun.id ||
          a.id === displayedRun.attributionId,
      ) ?? null)
    : null;

  // Continuation detection for unfinished cancelled runs (Section 24, 25)
  const latestHistoricalRun =
    historicalRuns.length > 0 ? historicalRuns[historicalRuns.length - 1] : null;

  const unfinishedCriteriaFromLatest = useMemo(() => {
    if (!latestHistoricalRun || latestHistoricalRun.status !== "cancelled") {
      return [];
    }
    const passedIds = new Set(
      latestHistoricalRun.criterionResults
        .filter((r) => r.status === "passed")
        .map((r) => r.criterionId),
    );
    return latestHistoricalRun.criteriaSnapshot.filter((c) => !passedIds.has(c.id));
  }, [latestHistoricalRun]);

  // Checkbox handlers (batch selection only)
  const handleToggleCriterionCheck = (criterionId: string) => {
    onToggleSelectCriterion?.(criterionId);
  };

  const handleSelectAll = () => {
    onSelectAllCriteria?.();
  };

  const handleClearSelection = () => {
    onClearCriteriaSelection?.();
  };

  // Reorder criteria handlers
  const handleMoveCriterion = (fromIndex: number, toIndex: number) => {
    if (fromIndex < 0 || fromIndex >= contract.criteria.length) return;
    if (toIndex < 0 || toIndex >= contract.criteria.length) return;

    const currentOrder = contract.criteria.map((c) => c.id);
    const [movedId] = currentOrder.splice(fromIndex, 1);
    currentOrder.splice(toIndex, 0, movedId);

    onReorderCriteria?.(contract.id, currentOrder);
  };

  // Modal openers
  const handleOpenAddCheck = () => {
    setCheckModalMode("add");
    setEditingCriterion(null);
    setIsCheckModalOpen(true);
  };

  const handleOpenEditCheck = (criterion: VerificationCriterion) => {
    setCheckModalMode("edit");
    setEditingCriterion(criterion);
    setIsCheckModalOpen(true);
  };

  const handleSaveCheck = (data: {
    label: string;
    command: string;
    workingDirectory: string;
    expectedExitCodes: number[];
  }) => {
    if (checkModalMode === "add") {
      onAddCriterion?.(contract.id, data);
    } else if (editingCriterion) {
      onUpdateCriterion?.(contract.id, {
        ...editingCriterion,
        label: data.label,
        command: data.command,
        workingDirectory: data.workingDirectory,
        expectedExitCodes: data.expectedExitCodes,
      });
    }
    setIsCheckModalOpen(false);
  };

  const handleDeleteEditingCheck = () => {
    if (editingCriterion) {
      onDeleteCriterion?.(contract.id, editingCriterion.id);
      setIsCheckModalOpen(false);
    }
  };

  // Running progression calculation (Section 23)
  const runningIdx = displayedRun
    ? displayedRun.criterionResults.findIndex((r) => r.status === "running")
    : -1;
  const completedCount = displayedRun
    ? displayedRun.criterionResults.filter(
        (r) => r.status !== "pending" && r.status !== "running",
      ).length
    : 0;
  const totalInRun = displayedRun
    ? displayedRun.criteriaSnapshot.length
    : contract.criteria.length;
  const currentProgressStep =
    runningIdx !== -1 ? runningIdx + 1 : Math.min(completedCount + 1, totalInRun);
  const runningCriterion =
    isTargetActiveRun && runningIdx !== -1 && displayedRun
      ? displayedRun.criteriaSnapshot[runningIdx]
      : null;

  return (
    <div className="verification-panel" role="region" aria-label="Verification checks">
      {/* Compact Unified Verification Header (HARDEN-012B.1) */}
      <div className="verification-header">
        <div className="verification-header-profile-group">
          <span className="verification-profile-label">Profile</span>
          <select
            className="verification-profile-select"
            value={contract.id}
            disabled={isLocked}
            onChange={(e) => onSelectProfile?.(e.target.value)}
            title={contract.name}
            aria-label="Select Verification Profile"
          >
            {availableContracts.map((c) => (
              <option key={c.id} value={c.id} title={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          <span
            className={`verification-profile-status-dot verification-profile-status-dot--${presentation.badgeClass}`}
            title={presentation.badgeLabel}
            aria-label={presentation.badgeLabel}
            role="status"
            data-testid="verification-profile-status-dot"
          />

          <div className="verification-profile-actions">
            <button
              type="button"
              className="verification-profile-btn"
              disabled={isLocked}
              onClick={() => setIsProfileModalOpen(true)}
              title="Edit verification profile"
              aria-label="Edit verification profile"
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
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
            <button
              type="button"
              className="verification-profile-btn"
              disabled={isLocked}
              onClick={() => setIsNewProfileModalOpen(true)}
              title="Create verification profile"
              aria-label="Create verification profile"
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
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Current or Latest Run Section: Primary information hierarchy (Sections 4, 5, 13) */}
      {displayedRun && (
        <div
          className={`verification-current-run-section verification-current-run-section--${presentation.badgeClass}`}
        >
          <div className="verification-current-run-header">
            <span className="verification-current-run-title">
              {isTargetActiveRun ? "CURRENT RUN" : "LATEST RUN"}
            </span>
            <span
              className={`verification-run-badge verification-run-badge--${presentation.badgeClass}`}
              data-testid="verification-run-status"
            >
              {presentation.badgeLabel}
            </span>
          </div>

          <div className="verification-current-run-body">
            <div className="verification-current-run-meta">
              Run · {displayedRun.profileName ?? contract.name}
            </div>

            {/* In-Progress Running State */}
            {isLocked && isTargetActiveRun && (
              <>
                <div className="verification-current-run-step">
                  Check {currentProgressStep} of {totalInRun}
                </div>
                {runningCriterion && (
                  <div className="verification-current-run-command-info">
                    <div className="verification-current-run-label">
                      {runningCriterion.label}
                    </div>
                    <code className="verification-current-run-command">
                      {runningCriterion.command}
                    </code>
                  </div>
                )}
                <div className="verification-current-run-actions">
                  <button
                    type="button"
                    className="verification-stop-btn verification-cancel-btn"
                    onClick={onStopVerification ?? onCancelVerification}
                    disabled={isStopping || isStopTimeout}
                    aria-label={
                      isStopping
                        ? "Stopping verification run"
                        : isStopTimeout
                        ? "Stop incomplete: command is still running"
                        : "Stop verification run"
                    }
                  >
                    {isStopping
                      ? "Stopping…"
                      : isStopTimeout
                      ? "Still running…"
                      : "Stop"}
                  </button>
                </div>
              </>
            )}

            {/* Completed Failed State — Prominently displays failed criteria & failure evidence */}
            {!isLocked && isRunFailed && failedResults.length > 0 && (
              <div className="verification-failed-criteria-list">
                {failedResults.map((res) => {
                  const crit = displayedRun.criteriaSnapshot.find(
                    (c) => c.id === res.criterionId,
                  );
                  if (!crit) return null;
                  const failedBlock = res.executionId
                    ? blocks?.find(
                        (b) =>
                          b.id === res.executionId ||
                          b.executionId === res.executionId,
                      )
                    : null;
                  const failureExcerpt = extractFailureEvidence(res, failedBlock);
                  const duration =
                    res.startedAt && res.completedAt
                      ? formatExecutionDuration(res.startedAt, res.completedAt)
                      : null;

                  return (
                    <div
                      key={crit.id}
                      className="verification-failed-criterion-card"
                    >
                      <div className="verification-failed-criterion-header">
                        <span className="verification-criterion-status-icon verification-criterion-status-icon--failed">
                          ✕
                        </span>
                        <span className="verification-failed-criterion-label">
                          {crit.label}
                        </span>
                        <span className="verification-failed-criterion-badge">
                          {res.status === "error" ? "ERROR" : "FAILED"}
                        </span>
                      </div>

                      <code className="verification-failed-criterion-command">
                        {crit.command}
                      </code>

                      <div className="verification-failed-criterion-meta">
                        <span>
                          Expected: exit [{crit.expectedExitCodes.join(", ")}]
                        </span>
                        <span>
                          Observed: exit{" "}
                          {res.observedExitCode !== null &&
                          res.observedExitCode !== undefined
                            ? res.observedExitCode
                            : "non-zero"}
                        </span>
                        {duration && <span>Duration: {duration}</span>}
                      </div>

                      {res.executionId && (
                        <div className="verification-failed-criterion-exec-id">
                          Execution: <code>{res.executionId}</code>
                        </div>
                      )}

                      {failureExcerpt && (
                        <div className="verification-failure-evidence">
                          <div className="verification-failure-evidence-title">
                            Failure evidence:
                          </div>
                          <pre className="verification-failure-evidence-text">
                            {failureExcerpt}
                          </pre>
                        </div>
                      )}

                      {res.executionId && onSelectExecution && (
                        <button
                          type="button"
                          className="verification-view-exec-btn"
                          onClick={() => onSelectExecution(res.executionId!)}
                          title="View execution"
                          aria-label="View execution"
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
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Completed Passed State */}
            {!isLocked && displayedRun.status === "passed" && (
              <div className="verification-run-summary-passed">
                ✓ All {displayedRun.criteriaSnapshot.length} checks passed.
              </div>
            )}

            {/* Completed Cancelled State */}
            {!isLocked && displayedRun.status === "cancelled" && (
              <div className="verification-run-summary-cancelled">
                ⏹ Run cancelled by user.
              </div>
            )}

            {/* Divider between Run Evidence and Repository Impact */}
            <hr className="verification-run-divider" />

            {/* Secondary Repository Impact Section (Sections 4, 6, 13) */}
            {runAttribution ? (
              <ChangeAttributionView attribution={runAttribution} onViewSnapshot={onViewSnapshot} />
            ) : (
              <div className="verification-attribution-unavailable">
                <span className="attribution-title">Repository Impact</span>
                <span className="attribution-unavailable-note">
                  Repository attribution unavailable for this run.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selection Toolbar (Section 15) */}
      {contract.criteria.length > 0 && (
        <div className="verification-selection-toolbar">
          <span className="verification-selection-count">
            {effectiveSelectedCriterionIds.size} of {contract.criteria.length} selected
          </span>
          <div className="verification-selection-quick-actions">
            <button
              type="button"
              className="verification-link-btn"
              disabled={isLocked || effectiveSelectedCriterionIds.size === contract.criteria.length || contract.criteria.length === 0}
              onClick={handleSelectAll}
            >
              Select all
            </button>
            <span className="verification-toolbar-divider">•</span>
            <button
              type="button"
              className="verification-link-btn"
              disabled={isLocked || effectiveSelectedCriterionIds.size === 0}
              onClick={handleClearSelection}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Criteria List */}
      <div className="verification-criteria-list" role="list">
        {criteria.length === 0 ? (
          <div className="context-empty">
            <span className="context-empty-icon" aria-hidden="true">○</span>
            <p>No verification checks configured.</p>
            <small>Add the commands you want to run for this profile.</small>
          </div>
        ) : (
          criteria.map((criterion, idx) => {
            const result = resultsMap.get(criterion.id);
            const status = result?.status ?? "pending";
            const symbol = getStatusSymbol(status);
            const isChecked = effectiveSelectedCriterionIds.has(criterion.id);

            return (
              <div
                key={criterion.id}
                className={`verification-criterion-card verification-criterion-card--${status}`}
                role="listitem"
                data-testid={`verification-criterion-${idx}`}
              >
                <div className="verification-criterion-main">
                  <div className="verification-criterion-left">
                    {/* Left-side batch selection checkbox (Section 12, 13) */}
                    <input
                      type="checkbox"
                      className="verification-criterion-checkbox"
                      checked={isChecked}
                      disabled={isLocked}
                      onChange={() => handleToggleCriterionCheck(criterion.id)}
                      aria-label={`Include ${criterion.label} in Run Selected`}
                    />

                    <span
                      className={`verification-criterion-status-icon verification-criterion-status-icon--${status}`}
                      aria-label={`Status: ${status}`}
                    >
                      {symbol}
                    </span>

                    <span className="verification-criterion-label" title={criterion.label}>
                      {criterion.label}
                    </span>

                  </div>

                  {/* Right Actions: reorder buttons, edit/delete row actions, eye button, Run button */}
                  <div className="verification-criterion-right-actions">
                    {/* Reorder and Edit Actions */}
                    <div className="verification-criterion-row-actions">
                      <button
                        type="button"
                        className="verification-icon-btn"
                        disabled={isLocked || idx === 0}
                        onClick={() => handleMoveCriterion(idx, idx - 1)}
                        title="Move check up"
                        aria-label="Move check up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="verification-icon-btn"
                        disabled={isLocked || idx === criteria.length - 1}
                        onClick={() => handleMoveCriterion(idx, idx + 1)}
                        title="Move check down"
                        aria-label="Move check down"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="verification-icon-btn"
                        disabled={isLocked}
                        onClick={() => handleOpenEditCheck(criterion)}
                        title="Edit check"
                        aria-label="Edit check"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="verification-icon-btn verification-icon-btn--danger"
                        disabled={isLocked}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteCriterion?.(contract.id, criterion.id);
                        }}
                        title="Delete check"
                        aria-label="Delete check"
                      >
                        ✕
                      </button>
                    </div>
                    {result?.executionId && onSelectExecution && (
                      <button
                        type="button"
                        className="verification-view-exec-btn"
                        onClick={() => onSelectExecution(result.executionId!)}
                        title="View execution"
                        aria-label="View execution"
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
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                    )}

                    {/* Section 18, 19, 20: Individual per-check Run button */}
                    <button
                      type="button"
                      className="verification-single-run-btn"
                      disabled={isLocked}
                      onClick={() => onRunVerification([criterion.id])}
                      title={`Run ${criterion.label} only`}
                      aria-label={`Run ${criterion.label}`}
                    >
                      Run
                    </button>
                  </div>
                </div>

                {/* Dedicated full-width metadata area (VERIFY-UI-030) */}
                <div className="verification-criterion-metadata-area">
                  <code className="verification-criterion-command" title={criterion.command}>
                    {criterion.command}
                  </code>
                  {criterion.workingDirectory && criterion.workingDirectory !== '.' && (
                    <span
                      className="verification-criterion-cwd"
                      title={`Working directory: ${criterion.workingDirectory}`}
                    >
                      cwd: {criterion.workingDirectory}
                    </span>
                  )}
                </div>

                {/* Metadata / Exit code row */}
                <div className="verification-criterion-meta">
                  <span>
                    Expected: exit [{criterion.expectedExitCodes.join(", ")}]
                  </span>
                  {result?.observedExitCode !== undefined && result.observedExitCode !== null && (
                    <span className="verification-criterion-observed">
                      Observed: exit {result.observedExitCode}
                    </span>
                  )}
                </div>

                {/* Failure or Error explanation */}
                {result?.message && (status === "error" || status === "failed") && (
                  <div
                    className={`verification-criterion-msg verification-criterion-msg--${status}`}
                  >
                    {result.message}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add Check Button (Section 8) */}
      <div className="verification-add-check-area">
        <button
          type="button"
          className="verification-add-check-btn"
          disabled={isLocked}
          onClick={handleOpenAddCheck}
        >
          + Add Check
        </button>
      </div>

      {/* Continue unfinished checks button (Section 24, 25) */}
      {!isLocked && unfinishedCriteriaFromLatest.length > 0 && onContinueUnfinished && (
        <div className="verification-continuation-area">
          <button
            type="button"
            className="verification-continue-btn"
            onClick={() => onContinueUnfinished(latestHistoricalRun!)}
          >
            Continue unfinished ({unfinishedCriteriaFromLatest.length})
          </button>
        </div>
      )}

      {/* Action Controls (Section 16, 23) */}
      {(isLocked || contract.criteria.length > 0) && (
        <div className="verification-actions">
          {isLocked ? (
            <div className="verification-current-run-actions" style={{ justifyContent: "flex-start", width: "100%" }}>
              <div className="verification-running-progress">
                <span className="verification-running-dot">●</span>
                <span>
                  Running {currentProgressStep} / {totalInRun}
                </span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="verification-run-btn"
              onClick={() => onRunVerification(Array.from(effectiveSelectedCriterionIds))}
              disabled={effectiveSelectedCriterionIds.size === 0}
              aria-label="Run selected verification checks"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
                aria-hidden="true"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {effectiveSelectedCriterionIds.size > 0
                ? `Run Selected (${effectiveSelectedCriterionIds.size})`
                : "Run Selected"}
            </button>
          )}
        </div>
      )}

      {/* Historical Runs with Metadata (Section 50) */}
      {effectiveHistoricalRuns.length > 0 && (
        <div className="verification-history-section">
          <div className="verification-history-header">
            <span className="verification-history-title">Run History</span>
            {onClearRunHistory && (
              <button
                type="button"
                className="verification-clear-history-btn"
                disabled={isLocked}
                onClick={() => {
                  setSelectedHistoricalRunId(null);
                  onClearRunHistory();
                }}
                title="Clear run history"
                aria-label="Clear run history"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            )}
          </div>
          {effectiveHistoricalRuns.map((r, i) => {
            const isHistoricalActive = Boolean(activeRun && r.id === activeRun.id);
            const rPres = deriveVerificationPresentation({
              run: r,
              isRunning: isHistoricalActive ? isRunning : r.status === "running",
              isStopping: isHistoricalActive ? isStopping : r.status === "stopping",
              isStopTimeout: isHistoricalActive ? isStopTimeout : r.status === "stop-timeout",
            });
            const checkCount = r.criteriaSnapshot.length;
            const contractMatch = availableContracts.find((c) => c.id === r.contractId);
            const runProfileName =
              r.profileName ?? contractMatch?.name ?? (checkCount === 1 ? r.criteriaSnapshot[0]?.label : "Profile");

            const passedCount = r.criterionResults.filter((res) => res.status === "passed").length;
            const failedCount = r.criterionResults.filter((res) => res.status === "failed").length;
            const errorCount = r.criterionResults.filter((res) => res.status === "error").length;
            const isExpanded = selectedHistoricalRunId === r.id;

            const summaryText =
              r.status === "passed"
                ? `${passedCount} passed`
                : failedCount > 0
                ? `${passedCount} passed · ${failedCount} failed`
                : errorCount > 0
                ? `${passedCount} passed · ${errorCount} error`
                : r.status === "cancelled"
                ? `${passedCount} passed · cancelled`
                : `${passedCount} passed`;

            const histAttr = changeAttributions?.find(
              (a) => a.targetId === r.id || a.id === r.attributionId,
            );

            return (
              <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div
                  className={`verification-history-item ${isExpanded ? "verification-history-item--active" : ""}`}
                  onClick={() => {
                    setSelectedHistoricalRunId(isExpanded ? null : r.id);
                    onSelectRun?.(r.id);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                >
                  <div className="verification-history-item-left">
                    <span className="verification-history-run-num">Run #{i + 1}</span>
                    <span className="verification-history-run-meta">
                      {runProfileName} • {checkCount} {checkCount === 1 ? "check" : "checks"}
                      {r.continuedFromRunId ? " (continuation)" : ""} • {summaryText}
                    </span>
                  </div>
                  <span
                    className={`verification-run-badge verification-run-badge--${rPres.badgeClass}`}
                  >
                    {rPres.badgeLabel}
                  </span>
                </div>

                {/* Expanded Historical Run Details */}
                {isExpanded && (
                  <div className="verification-history-details">
                    {r.criteriaSnapshot.map((crit) => {
                      const res = r.criterionResults.find((x) => x.criterionId === crit.id);
                      const critStatus = res?.status ?? "pending";
                      return (
                        <div key={crit.id} className="verification-history-detail-item">
                          <div className="verification-history-detail-left">
                            <span className={`verification-criterion-status-icon verification-criterion-status-icon--${critStatus}`}>
                              {getStatusSymbol(critStatus)}
                            </span>
                            <span className="verification-history-detail-label">{crit.label}</span>
                            <code className="verification-history-detail-command">{crit.command}</code>
                            {crit.workingDirectory && crit.workingDirectory !== '.' && (
                              <span
                                className="verification-criterion-cwd"
                                title={`Working directory: ${crit.workingDirectory}`}
                              >
                                cwd: {crit.workingDirectory}
                              </span>
                            )}
                          </div>
                          {res?.executionId && onSelectExecution && (
                            <button
                              type="button"
                              className="verification-view-exec-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectExecution(res.executionId!);
                              }}
                              title="View execution"
                              aria-label="View execution"
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
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {/* Historical run attribution (Section 11) */}
                    <div className="verification-history-attribution">
                      {histAttr ? (
                        <ChangeAttributionView attribution={histAttr} onViewSnapshot={onViewSnapshot} />
                      ) : (
                        <div className="verification-attribution-unavailable">
                          <span className="attribution-title">Repository Impact</span>
                          <span className="attribution-unavailable-note">
                            Repository attribution unavailable.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <VerificationCheckModal
        isOpen={isCheckModalOpen}
        mode={checkModalMode}
        initialCriterion={editingCriterion}
        onSave={handleSaveCheck}
        onCancel={() => setIsCheckModalOpen(false)}
        onDelete={handleDeleteEditingCheck}
      />

      <VerificationProfileModal
        isOpen={isProfileModalOpen}
        contract={contract}
        canDelete={availableContracts.length > 1}
        onRename={(newName) => {
          onRenameProfile?.(contract.id, newName);
          setIsProfileModalOpen(false);
        }}
        onDelete={() => {
          onDeleteProfile?.(contract.id);
          setIsProfileModalOpen(false);
        }}
        onCancel={() => setIsProfileModalOpen(false)}
      />

      <NewProfileModal
        isOpen={isNewProfileModalOpen}
        onConfirm={(name) => {
          onCreateProfile?.(name);
          setIsNewProfileModalOpen(false);
        }}
        onCancel={() => setIsNewProfileModalOpen(false)}
      />
    </div>
  );
});
