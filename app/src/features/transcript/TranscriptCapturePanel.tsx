import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  getCaptureStatus,
  deriveHasRetainedData,
  type TranscriptBlock,
  type TranscriptFeedback,
  type CaptureStatus,
} from './types';
import type { PaneAccentId } from '../workspace/types';
import {
  normalizeOutput,
  normalizeCommand,
  formatBlockLabel,
  cleanTranscriptForDisplay,
  copyToClipboard,
} from './transcriptFormat';
import {
  deriveExecutionLifecycle,
  deriveExecutionOutcome,
  formatExecutionDuration,
  formatExecutionTimestamp,
} from './captureBlockModel';
import { CaptureFeedbackBanner } from './CaptureFeedbackBanner';
import { VerificationPanel } from '../verification/VerificationPanel';
import {
  type VerificationContract,
  type VerificationCriterion,
  type VerificationRun,
  deriveVerificationPresentation,
  deriveVerificationTabIndicator,
} from '../verification';
import { executionFromTranscriptBlock } from '../execution';
import { StructuredEvidenceView } from '../structuredEvidence/StructuredEvidenceView';
import {
  parseEngineeringEvidence,
  buildParseContext,
} from '../structuredEvidence';
import {
  RepositoryEvidenceView,
  type RepositoryFileItemData,
} from '../evidenceCollectors/RepositoryEvidenceView';
import type {
  RepositorySnapshot,
  EvidenceCollectionRun,
} from '../evidenceCollectors/types';
import { ChangeAttributionView } from '../attribution/ChangeAttributionView';
import type { ChangeAttribution } from '../attribution/types';
import { useProductCapabilities, isMonitorViewEnabled } from '../edition';
import {
  createEvidenceSelectionState,
  toggleItemSelection,
  selectMultipleItems,
  deselectMultipleItems,
  clearEvidenceSelection,
  createRepositoryFileSelectionItem,
  createExecutionSelectionItem,
  getSelectedItems,
  getSelectedCount,
  resolveEvidenceSelections,
  formatResolvedEvidenceForClipboard,
  type EvidenceSelectionState,
  type EvidenceSelectionItem,
} from '../evidenceSelection';
import { runCollectorProcess } from '../evidenceCollectors/collectorRunner';
import { PromptComposerModal } from '../promptComposer';
import { type MonitorView, isMacPlatform } from '../shortcuts';
import {
  MonitorGlobalFeedbackRegion,
  createMonitorFeedbackStore,
  type MonitorFeedback,
  MonitorFooter,
} from '../monitor';

export interface TranscriptCardProps {
  block: TranscriptBlock;
  index: number;
  isSelected: boolean;
  isCollapsed: boolean;
  showRawOutput?: boolean;
  attribution?: ChangeAttribution | null;
  onToggleSelect: (blockId: string) => void;
  onToggleCollapsed: (blockId: string) => void;
  onCopyBlock: (block: TranscriptBlock) => void;
  onDeleteBlock: (blockId: string) => void;
  onCopyText?: (text: string, label: string) => void;
  onRerunCommand?: (
    command: string,
    paneId: string,
    workspaceId?: string,
    terminalTabId?: string,
  ) => void;
}

export const TranscriptCard = memo(function TranscriptCard({
  block,
  index,
  isSelected,
  isCollapsed,
  showRawOutput = false,
  attribution,
  onToggleSelect,
  onToggleCollapsed,
  onCopyBlock,
  onDeleteBlock,
  onCopyText,
  onRerunCommand,
}: TranscriptCardProps) {
  const [showRaw, setShowRaw] = useState(showRawOutput);

  const displayResult = useMemo(
    () => cleanTranscriptForDisplay(block.output),
    [block.output],
  );

  const rawOutput = block.rawOutput ?? block.output;
  const isRawDifferent = useMemo(() => {
    if (!rawOutput) return false;
    return (
      displayResult.rawText !== displayResult.cleanedText ||
      displayResult.hasHiddenPrompts ||
      displayResult.hasCollapsedBlankLines ||
      normalizeOutput(rawOutput) !== displayResult.cleanedText
    );
  }, [rawOutput, displayResult]);

  const displayOutput = showRaw
    ? normalizeOutput(rawOutput)
    : displayResult.cleanedText;

  const headerLabel = formatBlockLabel(block.sourcePaneOrdinal ?? 1, index + 1);

  const lifecycle = useMemo(() => deriveExecutionLifecycle(block), [block]);
  const outcome = useMemo(() => deriveExecutionOutcome(block), [block]);
  const isError =
    outcome === 'failed' ||
    Boolean(block.hasDiagnosticError) ||
    Boolean(block.hasError);

  let statusBadgeType: string;
  let statusBadgeLabel: string;
  if (lifecycle === 'running') {
    statusBadgeType = 'running';
    statusBadgeLabel = 'running';
  } else if (lifecycle === 'interrupted') {
    statusBadgeType = 'interrupted';
    statusBadgeLabel = 'interrupted';
  } else if (outcome === 'succeeded') {
    statusBadgeType = 'succeeded';
    statusBadgeLabel = 'succeeded';
  } else if (outcome === 'failed') {
    statusBadgeType = 'failed';
    statusBadgeLabel = 'failed';
  } else {
    statusBadgeType = 'finished';
    statusBadgeLabel = 'finished';
  }

  let outcomeText = 'outcome unknown';
  if (lifecycle === 'running') {
    outcomeText = 'running';
  } else if (lifecycle === 'interrupted') {
    outcomeText = 'interrupted';
  } else if (outcome === 'succeeded') {
    outcomeText = 'succeeded';
  } else if (outcome === 'failed') {
    outcomeText = 'failed';
  }

  const duration = useMemo(
    () => formatExecutionDuration(block.startedAt, block.completedAt),
    [block.startedAt, block.completedAt],
  );

  const structuredEvidence = useMemo(() => {
    if (block.structuredEvidence) return block.structuredEvidence;
    if (!block.output && !block.rawOutput) return [];
    const exec = executionFromTranscriptBlock(block);
    return parseEngineeringEvidence(
      buildParseContext(exec, exec.evidenceBlocks),
    );
  }, [block]);

  const handleShowSourceEvidence = useCallback(() => {
    if (isCollapsed) {
      onToggleCollapsed(block.id);
    }
    setShowRaw(true);
  }, [block.id, isCollapsed, onToggleCollapsed]);

  const handleHeaderClick = () => {
    onToggleSelect(block.id);
  };

  const handleCheckboxChange = () => {
    onToggleSelect(block.id);
  };

  const handleCopyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCopyBlock(block);
  };

  const handleRerunCommandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRerunCommand?.(
      block.command,
      block.terminalPaneId,
      block.workspaceId,
      block.terminalTabId,
    );
  };

  const handleCopyCommandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cmd = normalizeCommand(block.command);
    if (onCopyText) {
      onCopyText(cmd, 'Copied command');
    } else {
      copyToClipboard(cmd);
    }
  };

  const handleCopyOutputClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCopyText) {
      onCopyText(displayOutput, isError ? 'Copied error' : 'Copied output');
    } else {
      copyToClipboard(displayOutput);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteBlock(block.id);
  };

  const handleToggleCollapseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapsed(block.id);
  };

  return (
    <div
      className={`transcript-card ${isSelected ? 'transcript-card-selected' : ''}`}
    >
      {/* 1. Header row */}
      <div
        className='transcript-card-header capture-block-header'
        onClick={handleHeaderClick}
      >
        <div className='transcript-card-header-left capture-block-meta'>
          <label
            className='transcript-card-checkbox-label'
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type='checkbox'
              className='transcript-checkbox'
              checked={isSelected}
              onChange={handleCheckboxChange}
              aria-label={`Select transcript block ${headerLabel}`}
            />
          </label>
          <span
            className='transcript-source-indicator'
            data-accent={block.sourcePaneAccentId ?? 'blue'}
            aria-hidden='true'
          />
          <span className='transcript-block-index'>{headerLabel}</span>
          <span
            className={`capture-status-badge capture-status-badge--${statusBadgeType}`}
            role={lifecycle === 'running' ? 'status' : undefined}
            aria-label={`Execution status: ${statusBadgeLabel}`}
            title={`Status: ${statusBadgeLabel}${block.completionSource ? ` (${block.completionSource})` : ''}`}
          >
            <span className='capture-status-badge-dot' aria-hidden='true' />
            <span>{statusBadgeLabel}</span>
          </span>
        </div>

        <div
          className='transcript-card-actions capture-block-actions'
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type='button'
            className='card-action-btn icon-button'
            onClick={handleCopyClick}
            title={`Copy transcript block ${headerLabel}`}
            aria-label={`Copy transcript block ${headerLabel}`}
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              aria-hidden='true'
            >
              <rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
              <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
            </svg>
          </button>
          <button
            type='button'
            className='card-action-btn card-action-btn-danger card-action-btn-delete card-action-btn--destructive icon-button'
            onClick={handleDeleteClick}
            title={`Delete transcript block ${headerLabel}`}
            aria-label={`Delete transcript block ${headerLabel}`}
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              aria-hidden='true'
            >
              <polyline points='3 6 5 6 21 6' />
              <path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
              <line x1='10' y1='11' x2='10' y2='17' />
              <line x1='14' y1='11' x2='14' y2='17' />
            </svg>
          </button>
          <button
            type='button'
            className='card-action-btn icon-button'
            onClick={handleToggleCollapseClick}
            title={
              isCollapsed
                ? `Expand transcript block ${headerLabel}`
                : `Collapse transcript block ${headerLabel}`
            }
            aria-label={
              isCollapsed
                ? `Expand transcript block ${headerLabel}`
                : `Collapse transcript block ${headerLabel}`
            }
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              className={`collapse-icon ${isCollapsed ? 'collapsed' : ''}`}
              aria-hidden='true'
            >
              <polyline points='6 9 12 15 18 9' />
            </svg>
          </button>
        </div>
      </div>

      {/* 2. Command block */}
      <div
        className='transcript-command-row capture-command-line'
        data-block-type='command'
      >
        <span className='transcript-prompt-symbol' aria-hidden='true'>
          $
        </span>
        <code className='transcript-command-text'>{block.command}</code>
        {block.agentRunId && (
          <span
            className='agent-run-exec-badge'
            title={`Associated with AgentRun ${block.agentRunId}`}
            style={{
              fontSize: '9px',
              padding: '1px 4px',
              borderRadius: '3px',
              background: 'rgba(56, 139, 253, 0.15)',
              color: '#58a6ff',
              marginLeft: '4px',
            }}
          >
            🤖 agent
          </span>
        )}
        <div className='capture-cmd-actions'>
          {onRerunCommand && (
            <button
              type='button'
              className='card-subaction-btn capture-rerun-cmd-btn'
              onClick={handleRerunCommandClick}
              title='Rerun command in terminal'
              aria-label={`Rerun command ${block.command}`}
            >
              <svg
                width='10'
                height='10'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
                aria-hidden='true'
              >
                <polyline points='23 4 23 10 17 10' />
                <path d='M20.49 15a9 9 0 1 1-2.12-9.36L23 10' />
              </svg>
            </button>
          )}
          <button
            type='button'
            className='card-subaction-btn capture-copy-cmd-btn'
            onClick={handleCopyCommandClick}
            title='Copy command'
            aria-label='Copy command'
          >
            <svg
              width='10'
              height='10'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              aria-hidden='true'
            >
              <rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
              <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
            </svg>
          </button>
        </div>
      </div>

      {/* 3. Output area */}
      {!isCollapsed && (
        <div
          className={`transcript-output-area ${isError ? 'transcript-output-area--error' : ''}`}
          data-block-type={isError ? 'error' : 'output'}
          data-has-hidden-prompts={
            displayResult.hasHiddenPrompts ? 'true' : undefined
          }
          data-hidden-prompt-count={
            displayResult.hiddenPromptCount || undefined
          }
        >
          {block.output ? (
            <div className='capture-output-container'>
              <div className='capture-output-header'>
                <span
                  className={`capture-type-tag capture-type-tag--${isError ? 'error' : 'output'}`}
                >
                  {isError ? 'error' : 'output'}
                </span>
                <div className='capture-output-header-actions'>
                  {isRawDifferent && (
                    <button
                      type='button'
                      className={`card-subaction-btn capture-toggle-raw-btn ${showRaw ? 'capture-toggle-raw-btn--active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowRaw((prev) => !prev);
                      }}
                      title={
                        showRaw
                          ? 'Show clean presentation'
                          : 'Show raw evidence'
                      }
                      aria-label={
                        showRaw
                          ? 'Show clean presentation'
                          : 'Show raw evidence'
                      }
                    >
                      <span>{showRaw ? 'Clean' : 'Raw'}</span>
                    </button>
                  )}
                  <button
                    type='button'
                    className='card-subaction-btn capture-copy-output-btn'
                    onClick={handleCopyOutputClick}
                    title={isError ? 'Copy error output' : 'Copy output'}
                    aria-label={isError ? 'Copy error output' : 'Copy output'}
                  >
                    <svg
                      width='10'
                      height='10'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      aria-hidden='true'
                    >
                      <rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
                      <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
                    </svg>
                  </button>
                </div>
              </div>
              <pre
                className={`transcript-output-text capture-output ${isError ? 'capture-output--error' : ''}`}
              >
                {displayOutput}
              </pre>
            </div>
          ) : (
            <span className='transcript-output-empty'>
              {!block.isComplete ? 'Executing command…' : 'No output'}
            </span>
          )}
        </div>
      )}

      {/* 3.5 Structured Engineering Evidence */}
      {!isCollapsed && structuredEvidence && structuredEvidence.length > 0 && (
        <StructuredEvidenceView
          evidence={structuredEvidence}
          onShowSourceEvidence={handleShowSourceEvidence}
        />
      )}

      {/* 3.6 Repository Change Attribution */}
      {!isCollapsed && attribution && (
        <ChangeAttributionView attribution={attribution} />
      )}

      {/* 4. Status / Metadata row */}
      {!isCollapsed && (
        <div
          className='capture-status-row'
          data-block-type='status'
          aria-label='Execution details'
        >
          <span
            className='capture-status-time'
            title={`Started at ${new Date(block.startedAt).toLocaleTimeString()}`}
          >
            {formatExecutionTimestamp(block.startedAt)}
          </span>
          {duration && (
            <span
              className='capture-status-duration'
              title='Execution duration'
            >
              {duration}
            </span>
          )}
          {block.exitCode !== null && block.exitCode !== undefined && (
            <span
              className={`capture-exit-code ${block.exitCode !== 0 ? 'capture-exit-code--error' : ''}`}
              title={`Exit code ${block.exitCode}`}
            >
              exit {block.exitCode}
            </span>
          )}
          <span
            className={`capture-status-state-pill capture-status-state-pill--${statusBadgeType}`}
            title={
              block.completionSource
                ? `Completion source: ${block.completionSource}`
                : undefined
            }
          >
            {outcomeText}
          </span>
        </div>
      )}
    </div>
  );
});

interface InlineDestructiveBannerProps {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function InlineDestructiveBanner({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: InlineDestructiveBannerProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelBtnRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <CaptureFeedbackBanner
      type='error'
      title={title}
      icon='⚠'
      className='capture-confirm-banner confirm-card transcript-confirm-card'
      role='region'
      ariaLive='polite'
      onKeyDown={handleKeyDown}
      body={
        <p className='capture-confirm-banner-body confirm-card-body'>{body}</p>
      }
      actions={
        <div className='capture-confirm-banner-actions confirm-card-actions'>
          <button
            ref={cancelBtnRef}
            type='button'
            className='capture-banner-btn capture-banner-btn--cancel confirm-btn-cancel'
            onClick={onCancel}
            aria-label='Cancel'
          >
            Cancel
          </button>
          <button
            type='button'
            className='capture-banner-btn capture-banner-btn--destructive confirm-btn-destructive'
            onClick={onConfirm}
            aria-label={confirmLabel}
          >
            {confirmLabel}
          </button>
        </div>
      }
    />
  );
}

export { InlineDestructiveBanner as ConfirmCard };

export interface CaptureTargetPaneInfo {
  id: string;
  stableOrdinal: number;
  accentId: PaneAccentId;
}

export interface TranscriptCapturePanelProps {
  isListening: boolean;
  blocks: TranscriptBlock[];
  currentBatchId: number | null;
  currentBatchBlockCount: number;
  selectedBlockIds: Set<string>;
  feedback: TranscriptFeedback | null;
  availablePanes?: CaptureTargetPaneInfo[];
  selectedCapturePaneIds?: string[];
  isTargetSelectorLocked?: boolean;
  captureStatusOverride?: CaptureStatus;
  onToggleListening: () => void;
  onStartCapture?: () => void;
  onPauseCapture?: () => void;
  onResumeCapture?: () => void;
  onStopCapture?: () => void;
  onToggleSelectCapturePane?: (paneId: string) => void;
  onSelectAllCapturePanes?: (all: boolean) => void;
  onToggleSelect: (blockId: string) => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onCopyBlock: (block: TranscriptBlock) => void;
  onCopyCurrentBatch?: () => void;
  onCopySelected: () => void;
  onDeleteBlock: (blockId: string) => void;
  onDeleteSelected: () => void;
  onRerunCommand?: (
    command: string,
    paneId: string,
    workspaceId?: string,
    terminalTabId?: string,
  ) => void;
  verificationContract?: VerificationContract;
  verificationContracts?: VerificationContract[];
  activeVerificationRun?: VerificationRun | null;
  latestVerificationRun?: VerificationRun | null;
  historicalVerificationRuns?: VerificationRun[];
  isVerificationRunning?: boolean;
  isVerificationStopping?: boolean;
  isVerificationStopTimeout?: boolean;
  selectedVerificationCriterionIds?: Set<string>;
  onToggleSelectVerificationCriterion?: (criterionId: string) => void;
  onSelectAllVerificationCriteria?: () => void;
  onClearVerificationCriteriaSelection?: () => void;
  onRunVerification?: (selectedCriterionIds?: string[]) => void;
  onCancelVerification?: () => void;
  onStopVerification?: () => void;
  onContinueUnfinished?: (run: VerificationRun) => void;
  onSelectVerificationExecution?: (executionId: string) => void;
  onSelectVerificationProfile?: (contractId: string) => void;
  onCreateVerificationProfile?: (name: string) => void;
  onRenameVerificationProfile?: (contractId: string, name: string) => void;
  onDeleteVerificationProfile?: (contractId: string) => void;
  onAddVerificationCriterion?: (
    contractId: string,
    criterion: {
      label: string;
      command: string;
      workingDirectory?: string;
      expectedExitCodes?: number[];
    },
  ) => void;
  onUpdateVerificationCriterion?: (
    contractId: string,
    criterion: VerificationCriterion,
  ) => void;
  onDeleteVerificationCriterion?: (
    contractId: string,
    criterionId: string,
  ) => void;
  onReorderVerificationCriteria?: (
    contractId: string,
    orderedCriterionIds: string[],
  ) => void;
  onClearRunHistory?: () => void;
  repositorySnapshot?: RepositorySnapshot | null;
  latestCollectionRun?: EvidenceCollectionRun | null;
  isCollectingRepositoryEvidence?: boolean;
  onRefreshRepositoryEvidence?: () => void;
  changeAttributions?: ChangeAttribution[];
  agentRuns?: unknown[];
  activeAgentRun?: unknown | null;
  onVerifyAgentRun?: (runId: string) => void;
  onCancelAgentRun?: (runId: string) => void;
  onStartAgentRun?: (taskText?: string, adapterId?: string) => void;
  activeComparisonRunIds?: [string, string] | null;
  onCompareAgentRuns?: (runIdA: string, runIdB: string) => void;
  onCloseComparison?: () => void;
  activeView?: MonitorView;
  onViewChange?: (view: MonitorView) => void;
  isMonitorFocused?: boolean;
  onToggleMonitorFocus?: () => void;
  workspaceName?: string;
  workspaceRootPath?: string;
  repositoryRoot?: string;
  repositoryBranch?: string;
  onOpenFolder?: () => void;
}

export const TranscriptCapturePanel = memo(function TranscriptCapturePanel(
  props: TranscriptCapturePanelProps,
) {
  const {
    isListening,
    blocks,
    currentBatchId,
    selectedBlockIds,
    feedback,
    availablePanes,
    selectedCapturePaneIds,
    isTargetSelectorLocked,
    captureStatusOverride,
    onToggleListening,
    onStopCapture,
    onToggleSelectCapturePane,
    onSelectAllCapturePanes,
    onToggleSelect,
    onSelectAllVisible,
    onClearSelection,
    onCopyBlock,
    onCopySelected,
    onDeleteBlock,
    onDeleteSelected,
    onRerunCommand,
    verificationContract,
    verificationContracts,
    activeVerificationRun,
    latestVerificationRun,
    historicalVerificationRuns,
    isVerificationRunning,
    isVerificationStopping,
    isVerificationStopTimeout,
    selectedVerificationCriterionIds,
    onToggleSelectVerificationCriterion,
    onSelectAllVerificationCriteria,
    onClearVerificationCriteriaSelection,
    onRunVerification,
    onCancelVerification,
    onStopVerification,
    onContinueUnfinished,
    onSelectVerificationExecution,
    onSelectVerificationProfile,
    onCreateVerificationProfile,
    onRenameVerificationProfile,
    onDeleteVerificationProfile,
    onAddVerificationCriterion,
    onUpdateVerificationCriterion,
    onDeleteVerificationCriterion,
    onReorderVerificationCriteria,
    onClearRunHistory,
    repositorySnapshot,
    latestCollectionRun,
    isCollectingRepositoryEvidence,
    onRefreshRepositoryEvidence,
    changeAttributions,
    activeView,
    onViewChange,
    isMonitorFocused,
    onToggleMonitorFocus,
    workspaceName,
    workspaceRootPath,
    repositoryRoot,
    repositoryBranch,
    onOpenFolder,
  } = props;

  const capabilities = useProductCapabilities();
  const isMac = useMemo(() => isMacPlatform(), []);
  const [internalViewMode, setInternalViewMode] =
    useState<MonitorView>('capture-evidence');
  const [isCaptureDetailsExpanded, setIsCaptureDetailsExpanded] =
    useState<boolean>(false);
  const rawActiveView = activeView ?? internalViewMode;
  const activeMonitorView = isMonitorViewEnabled(rawActiveView, capabilities)
    ? rawActiveView
    : 'capture-evidence';
  const handleSelectView = useCallback(
    (view: MonitorView) => {
      if (!isMonitorViewEnabled(view, capabilities)) {
        return;
      }
      setInternalViewMode(view);
      onViewChange?.(view);
    },
    [capabilities, onViewChange],
  );

  const [feedbackStore] = useState(() => createMonitorFeedbackStore());
  const [feedbackItems, setFeedbackItems] = useState<MonitorFeedback[]>([]);

  useEffect(() => {
    return () => {
      feedbackStore.destroy();
    };
  }, [feedbackStore]);

  useEffect(() => {
    return feedbackStore.subscribe(() => {
      setFeedbackItems(feedbackStore.getItems());
    });
  }, [feedbackStore]);

  useEffect(() => {
    if (feedback && feedback.message) {
      feedbackStore.push({
        level: feedback.type === 'error' ? 'error' : 'info',
        source: 'capture',
        title: feedback.message,
      });
    }
  }, [feedback, feedbackStore]);

  const triggerCopyFeedback = useCallback(
    (message: string) => {
      feedbackStore.push({
        level: 'success',
        source: 'clipboard',
        title: message,
      });
    },
    [feedbackStore],
  );
  const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<string>>(
    new Set(),
  );
  const [pendingConfirmation, setPendingConfirmation] = useState<
    'delete-selected' | null
  >(null);

  const effectiveWorkspaceId =
    activeVerificationRun?.workspaceId ??
    verificationContract?.workspaceId ??
    repositorySnapshot?.workspaceId ??
    blocks[0]?.workspaceId ??
    'workspace-default';

  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  const toggleCollapsed = useCallback((blockId: string) => {
    setCollapsedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);

  const selectedCount = selectedBlockIds.size;
  const totalBlocks = blocks.length;
  const isAllSelected = totalBlocks > 0 && selectedCount === totalBlocks;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate =
        totalBlocks > 0 && selectedCount > 0 && selectedCount < totalBlocks;
    }
  }, [totalBlocks, selectedCount]);

  const handleSelectAllChange = () => {
    if (isAllSelected) {
      onClearSelection();
    } else {
      onSelectAllVisible();
    }
  };

  const totalPanes = availablePanes?.length ?? 0;
  const selectedPanesCount = availablePanes
    ? availablePanes.filter((p) => selectedCapturePaneIds?.includes(p.id))
        .length
    : 0;
  const isAllPanesSelected =
    totalPanes > 0 && selectedPanesCount === totalPanes;
  const isPanesIndeterminate =
    totalPanes > 0 && selectedPanesCount > 0 && selectedPanesCount < totalPanes;

  const selectAllPanesCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllPanesCheckboxRef.current) {
      selectAllPanesCheckboxRef.current.indeterminate = isPanesIndeterminate;
    }
  }, [isPanesIndeterminate]);

  const handleToggleSelectAllPanes = useCallback(() => {
    if (
      isTargetSelectorLocked ||
      !availablePanes ||
      availablePanes.length === 0
    )
      return;
    const shouldSelect = !isAllPanesSelected;
    if (onSelectAllCapturePanes) {
      onSelectAllCapturePanes(shouldSelect);
    } else if (onToggleSelectCapturePane) {
      for (const pane of availablePanes) {
        const isSelected = selectedCapturePaneIds?.includes(pane.id) ?? false;
        if (isSelected !== shouldSelect) {
          onToggleSelectCapturePane(pane.id);
        }
      }
    }
  }, [
    isTargetSelectorLocked,
    availablePanes,
    isAllPanesSelected,
    onSelectAllCapturePanes,
    onToggleSelectCapturePane,
    selectedCapturePaneIds,
  ]);

  const hasRetainedData = deriveHasRetainedData(blocks, currentBatchId);
  const captureStatus =
    captureStatusOverride ?? getCaptureStatus(isListening, hasRetainedData);

  let captureDotClass = 'capture-status-dot--idle';

  if (captureStatus === 'capturing') {
    captureDotClass = 'capture-status-dot--capturing';
  } else if (captureStatus === 'paused') {
    captureDotClass = 'capture-status-dot--paused';
  }

  const isDeleteConfirmActive =
    pendingConfirmation === 'delete-selected' && selectedCount > 0;

  const handleCardCopy = useCallback(
    (block: TranscriptBlock) => {
      onCopyBlock(block);
      triggerCopyFeedback('Copied 1 block');
    },
    [onCopyBlock, triggerCopyFeedback],
  );

  const handleCopyText = useCallback(
    (text: string, label: string) => {
      copyToClipboard(text);
      triggerCopyFeedback(label);
    },
    [triggerCopyFeedback],
  );

  const handleCopySelectedClick = useCallback(() => {
    onCopySelected();
    const count = selectedCount || 1;
    triggerCopyFeedback(
      count === 1 ? 'Copied 1 block' : `Copied ${count} blocks`,
    );
  }, [onCopySelected, selectedCount, triggerCopyFeedback]);

  // Canonical Evidence Selection State
  const [evidenceSelection, setEvidenceSelection] =
    useState<EvidenceSelectionState>(createEvidenceSelectionState);
  const [isPromptComposerOpen, setIsPromptComposerOpen] = useState(false);
  const [isSelectionCopied, setIsSelectionCopied] = useState(false);

  const handleToggleFileSelection = useCallback(
    (file: RepositoryFileItemData) => {
      setEvidenceSelection((prev) =>
        toggleItemSelection(prev, createRepositoryFileSelectionItem(file)),
      );
    },
    [],
  );

  const handleSelectAllFiles = useCallback(
    (files: RepositoryFileItemData[]) => {
      setEvidenceSelection((prev) =>
        selectMultipleItems(prev, files.map(createRepositoryFileSelectionItem)),
      );
    },
    [],
  );

  const handleClearFileSelection = useCallback(() => {
    setEvidenceSelection((prev) => {
      const repoKeys = Array.from(prev.items.values())
        .filter((i) => i.kind === 'repository-file')
        .map((i) => i.id);
      return deselectMultipleItems(prev, repoKeys);
    });
  }, []);

  const selectedExecutionItems = useMemo(() => {
    return blocks
      .filter((b) => selectedBlockIds.has(b.id))
      .map((b) =>
        createExecutionSelectionItem({
          id: b.id,
          command: b.command,
          exitCode: b.exitCode,
          outcome: b.outcome,
          completedAt: b.completedAt ?? undefined,
          cwd: b.cwd,
          output: b.output,
          structuredSummary: (() => {
            const firstEv = b.structuredEvidence?.[0];
            if (!firstEv) return undefined;
            if (firstEv.type === 'test-summary') {
              return `${firstEv.framework}: ${firstEv.passed ?? 0} passed, ${firstEv.failed ?? 0} failed`;
            }
            if (firstEv.type === 'diagnostic') {
              return `${firstEv.tool}: ${firstEv.message}`;
            }
            if (
              firstEv.type === 'typecheck-summary' ||
              firstEv.type === 'lint-summary'
            ) {
              return `${firstEv.tool}: ${firstEv.errorCount ?? 0} errors`;
            }
            return undefined;
          })(),
        }),
      );
  }, [blocks, selectedBlockIds]);

  // Canonical unified Evidence Selection State combining repository files and executions
  const activeSelectionState: EvidenceSelectionState = useMemo(() => {
    const combined = new Map(evidenceSelection.items);
    for (const execItem of selectedExecutionItems) {
      combined.set(execItem.id, execItem);
    }
    return {
      items: combined,
      updatedAt: evidenceSelection.updatedAt,
    };
  }, [evidenceSelection, selectedExecutionItems]);

  const allSelectedEvidenceItems: EvidenceSelectionItem[] = useMemo(
    () => getSelectedItems(activeSelectionState),
    [activeSelectionState],
  );

  const totalSelectedEvidenceCount = getSelectedCount(activeSelectionState);

  const handleClearAllEvidenceSelection = useCallback(() => {
    onClearSelection();
    setEvidenceSelection(clearEvidenceSelection);
  }, [onClearSelection]);

  const handleRefreshRepositoryEvidence = useCallback(async () => {
    if (!onRefreshRepositoryEvidence) return;
    try {
      feedbackStore.push({
        level: 'info',
        source: 'repository',
        title: 'Refreshing repository evidence…',
      });
      await onRefreshRepositoryEvidence();
      feedbackStore.push({
        level: 'success',
        source: 'repository',
        title: 'Repository evidence refreshed',
      });
    } catch (err: unknown) {
      feedbackStore.push({
        level: 'error',
        source: 'repository',
        title: 'Repository collection failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [onRefreshRepositoryEvidence, feedbackStore]);

  const handleCopySelectedEvidence = useCallback(async () => {
    if (allSelectedEvidenceItems.length === 0) return;

    try {
      const resolvedItems = await resolveEvidenceSelections(
        allSelectedEvidenceItems,
        {
          workspaceId: effectiveWorkspaceId,
          blocks,
          repositorySnapshot,
          runCommand: runCollectorProcess,
          verificationContract,
          verificationContracts,
          activeVerificationRun,
          latestVerificationRun,
          historicalVerificationRuns,
          changeAttributions,
          agentRuns: undefined,
          activeAgentRun: undefined,
          agentEventIngress: undefined,
        },
      );

      const text = formatResolvedEvidenceForClipboard(resolvedItems);
      await copyToClipboard(text);
      setIsSelectionCopied(true);
      setTimeout(() => setIsSelectionCopied(false), 2000);

      const totalCount = allSelectedEvidenceItems.length;
      const unavailableCount = resolvedItems.filter(
        (i) => i.kind === 'unavailable',
      ).length;

      if (unavailableCount > 0) {
        triggerCopyFeedback(
          `Copied ${totalCount - unavailableCount} ${totalCount - unavailableCount === 1 ? 'item' : 'items'}; ${unavailableCount} unavailable`,
        );
      } else {
        triggerCopyFeedback(
          `Copied ${totalCount} ${totalCount === 1 ? 'evidence item' : 'evidence items'}`,
        );
      }
    } catch (err: unknown) {
      console.warn(
        '[TranscriptCapturePanel] Failed to copy selected evidence:',
        err,
      );
      feedbackStore.push({
        level: 'error',
        source: 'clipboard',
        title: 'Could not copy selected evidence',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [
    allSelectedEvidenceItems,
    effectiveWorkspaceId,
    blocks,
    repositorySnapshot,
    verificationContract,
    verificationContracts,
    activeVerificationRun,
    latestVerificationRun,
    historicalVerificationRuns,
    changeAttributions,
    triggerCopyFeedback,
    feedbackStore,
  ]);

  const targetVerificationRun =
    activeVerificationRun ?? latestVerificationRun ?? null;
  const isTrulyRunning = Boolean(
    activeVerificationRun && isVerificationRunning,
  );
  const isTrulyStopping = Boolean(
    activeVerificationRun && isVerificationStopping,
  );
  const isTrulyStopTimeout = Boolean(
    activeVerificationRun && isVerificationStopTimeout,
  );

  const verificationPresentation = useMemo(() => {
    return deriveVerificationPresentation({
      run: targetVerificationRun,
      isRunning: isTrulyRunning,
      isStopping: isTrulyStopping,
      isStopTimeout: isTrulyStopTimeout,
    });
  }, [
    targetVerificationRun,
    isTrulyRunning,
    isTrulyStopping,
    isTrulyStopTimeout,
  ]);

  const verifyTabIndicator = useMemo(() => {
    return deriveVerificationTabIndicator(verificationPresentation);
  }, [verificationPresentation]);

  return (
    <aside className='context-panel' aria-label='Transcript capture panel'>
      {/* Shared Monitor Global Feedback Region */}
      <MonitorGlobalFeedbackRegion
        items={feedbackItems}
        onDismiss={(id) => feedbackStore.dismiss(id)}
      />
      {/* 5-Position Stable Monitor Navigation Tab Strip (Positions 2–6) */}
      <div
        className='capture-view-segmented-control monitor-view-nav'
        role='tablist'
        aria-label='Monitor views'
      >
        <button
          type='button'
          role='tab'
          aria-selected={activeMonitorView === 'capture-evidence'}
          className={`capture-view-tab-btn ${activeMonitorView === 'capture-evidence' ? 'capture-view-tab-btn--active' : ''}`}
          onClick={() => handleSelectView('capture-evidence')}
          title={`Capture & Evidence (${isMac ? '⌘2' : 'Ctrl+2'})`}
        >
          <span className='monitor-tab-label'>Capture</span>
          {captureStatus === 'capturing' && (
            <span
              className='capture-status-dot capture-status-dot--capturing'
              style={{ width: 6, height: 6 }}
            />
          )}
          {blocks.length > 0 && (
            <span
              className='monitor-tab-count-badge'
              aria-label={`${blocks.length} ${blocks.length === 1 ? 'execution' : 'executions'}`}
            >
              {blocks.length}
            </span>
          )}
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={activeMonitorView === 'changes'}
          className={`capture-view-tab-btn ${activeMonitorView === 'changes' ? 'capture-view-tab-btn--active' : ''}`}
          onClick={() => handleSelectView('changes')}
          title={`Repository Changes (${isMac ? '⌘3' : 'Ctrl+3'})`}
        >
          <span className='monitor-tab-label'>Changes</span>
          {repositorySnapshot?.status?.files &&
            repositorySnapshot.status.files.length > 0 && (
              <span
                className='monitor-tab-count-badge'
                aria-label={`${repositorySnapshot.status.files.length} changed ${repositorySnapshot.status.files.length === 1 ? 'file' : 'files'}`}
              >
                {repositorySnapshot.status.files.length}
              </span>
            )}
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={activeMonitorView === 'verification'}
          className={`capture-view-tab-btn ${activeMonitorView === 'verification' ? 'capture-view-tab-btn--active' : ''}`}
          onClick={() => handleSelectView('verification')}
          title={`${verifyTabIndicator.tooltip} (${isMac ? '⌘4' : 'Ctrl+4'})`}
          aria-label={verifyTabIndicator.ariaLabel}
        >
          <span className='monitor-tab-label'>Verify</span>
          {verifyTabIndicator.hasDot && (
            <span className={verifyTabIndicator.dotClass} aria-hidden='true' />
          )}
        </button>

        {/* RELEASE-POLISH-VERIFY-023: Hide unused expand/enlarge control for public Terminal v0.1 */}
        {capabilities.agents && onToggleMonitorFocus && (
          <button
            type='button'
            className='monitor-focus-toggle-btn'
            onClick={onToggleMonitorFocus}
            title={
              isMonitorFocused
                ? `Exit Focus Mode (${isMac ? '⌘1' : 'Ctrl+1'})`
                : 'Focus Monitor'
            }
            aria-label={isMonitorFocused ? 'Exit Focus Mode' : 'Focus Monitor'}
            aria-pressed={isMonitorFocused}
          >
            {isMonitorFocused ? '⤓' : '⤢'}
          </button>
        )}
      </div>
      {/* Surface 2: Consolidated Capture View */}
      {activeMonitorView === 'capture-evidence' && (
        <div
          className='capture-evidence-view-surface'
          data-view='capture-evidence'
        >
          {/* SECTION 1: CAPTURE CONTROLS & SESSION INFO */}
          <section className='capture-section' aria-label='Capture controls'>
            <div className='capture-toolbar capture-panel-header'>
              {/* Row 1: Capture state indicator & action controls */}
              <div className='capture-toolbar-top-row'>
                <div
                  className={`capture-state-indicator capture-state-indicator--${captureStatus}`}
                  aria-label={`Recording state: ${captureStatus}`}
                >
                  <span
                    className={`capture-status-dot ${captureDotClass}`}
                    aria-hidden='true'
                  />
                  <span className='capture-state-text'>
                    {captureStatus === 'capturing'
                      ? 'Capturing'
                      : captureStatus === 'paused'
                        ? 'Paused'
                        : 'Idle'}
                  </span>
                </div>

                <div className='capture-primary-actions'>
                  {captureStatus === 'capturing' && (
                    <button
                      type='button'
                      className='capture-action-btn capture-pause-btn'
                      onClick={onToggleListening}
                      aria-label='Pause capture'
                      title='Pause capture'
                    >
                      <svg
                        width='10'
                        height='10'
                        viewBox='0 0 24 24'
                        fill='currentColor'
                        aria-hidden='true'
                      >
                        <rect x='6' y='4' width='4' height='16' rx='1' />
                        <rect x='14' y='4' width='4' height='16' rx='1' />
                      </svg>
                      <span>Pause</span>
                    </button>
                  )}

                  {captureStatus === 'paused' && (
                    <button
                      type='button'
                      className='capture-action-btn capture-resume-btn'
                      onClick={onToggleListening}
                      aria-label='Resume capture'
                      title='Resume capture'
                    >
                      <svg
                        width='10'
                        height='10'
                        viewBox='0 0 24 24'
                        fill='currentColor'
                        aria-hidden='true'
                      >
                        <polygon points='6,4 20,12 6,20' />
                      </svg>
                      <span>Resume</span>
                    </button>
                  )}

                  {captureStatus !== 'capturing' &&
                    captureStatus !== 'paused' && (
                      <button
                        type='button'
                        className='capture-action-btn capture-start-btn'
                        onClick={onToggleListening}
                        aria-label='Start capture'
                        title='Start capture'
                      >
                        <svg
                          width='10'
                          height='10'
                          viewBox='0 0 24 24'
                          fill='currentColor'
                          aria-hidden='true'
                        >
                          <polygon points='6,4 20,12 6,20' />
                        </svg>
                        <span>Start Capture</span>
                      </button>
                    )}

                  {onStopCapture &&
                    (captureStatus === 'capturing' ||
                      captureStatus === 'paused') && (
                      <button
                        type='button'
                        className='capture-action-btn capture-stop-btn'
                        onClick={onStopCapture}
                        aria-label='Stop capture'
                        title='Stop capture'
                      >
                        <span
                          className='capture-stop-icon'
                          aria-hidden='true'
                        />
                        <span>Stop</span>
                      </button>
                    )}

                  <button
                    type='button'
                    className={`capture-action-btn capture-icon-btn capture-info-btn ${isCaptureDetailsExpanded ? 'capture-info-btn--active' : ''}`}
                    onClick={() => setIsCaptureDetailsExpanded((prev) => !prev)}
                    aria-label={
                      isCaptureDetailsExpanded
                        ? 'Hide capture details'
                        : 'Show capture details'
                    }
                    title={
                      isCaptureDetailsExpanded
                        ? 'Hide capture details'
                        : 'Show capture details'
                    }
                    aria-expanded={isCaptureDetailsExpanded}
                  >
                    <svg
                      width='14'
                      height='14'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      aria-hidden='true'
                    >
                      <circle cx='12' cy='12' r='10' />
                      <line x1='12' y1='16' x2='12' y2='12' />
                      <line x1='12' y1='8' x2='12.01' y2='8' />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Row 2: Visible Capture target selector */}
              {availablePanes && availablePanes.length > 0 && (
                <fieldset
                  className='capture-target-selector'
                  aria-label='Capture terminal selection'
                >
                  <label
                    className={`capture-target-pill capture-target-pill--all ${
                      isAllPanesSelected
                        ? 'capture-target-pill--selected'
                        : isPanesIndeterminate
                          ? 'capture-target-pill--indeterminate'
                          : ''
                    }`}
                  >
                    <input
                      ref={selectAllPanesCheckboxRef}
                      type='checkbox'
                      className='capture-target-checkbox capture-target-checkbox--master'
                      checked={isAllPanesSelected}
                      disabled={isTargetSelectorLocked}
                      onChange={handleToggleSelectAllPanes}
                      aria-label='Listen to all terminal panes'
                      aria-checked={
                        isPanesIndeterminate ? 'mixed' : isAllPanesSelected
                      }
                    />
                    <span className='capture-target-all-label'>All</span>
                  </label>
                  {availablePanes.map((pane) => {
                    const isSelected =
                      selectedCapturePaneIds?.includes(pane.id) ?? false;

                    return (
                      <label
                        key={pane.id}
                        className={`capture-target-pill ${isSelected ? 'capture-target-pill--selected' : ''}`}
                        data-accent={pane.accentId}
                      >
                        <input
                          type='checkbox'
                          className='capture-target-checkbox'
                          checked={isSelected}
                          disabled={isTargetSelectorLocked}
                          onChange={() => onToggleSelectCapturePane?.(pane.id)}
                          aria-label={`Listen to terminal pane ${pane.stableOrdinal}`}
                        />
                        <span
                          className='capture-target-dot'
                          aria-hidden='true'
                        />
                        <span aria-hidden='true'>{pane.stableOrdinal}</span>
                      </label>
                    );
                  })}
                </fieldset>
              )}
            </div>

            {/* Capture Session Details & Metrics */}
            {!isCaptureDetailsExpanded ? (
              <div
                className='capture-session-summary'
                aria-label='Capture summary'
              >
                {currentBatchId !== null && (
                  <>
                    <span className='capture-summary-item'>
                      Batch #{currentBatchId}
                    </span>
                    <span className='capture-summary-dot' aria-hidden='true'>
                      ·
                    </span>
                  </>
                )}
                <span className='capture-summary-item'>
                  {selectedPanesCount}/{totalPanes} panes
                </span>
                <span className='capture-summary-dot' aria-hidden='true'>
                  ·
                </span>
                <span className='capture-summary-item'>
                  {blocks.length}{' '}
                  {blocks.length === 1 ? 'execution' : 'executions'}
                </span>
              </div>
            ) : (
              <div className='capture-session-card'>
                {currentBatchId !== null && (
                  <div className='capture-session-metric-row'>
                    <span className='capture-session-metric-label'>
                      Active Batch:
                    </span>
                    <span className='capture-session-metric-value'>
                      #{currentBatchId}
                    </span>
                  </div>
                )}
                <div className='capture-session-metric-row'>
                  <span className='capture-session-metric-label'>
                    Target Panes:
                  </span>
                  <span className='capture-session-metric-value'>
                    {selectedPanesCount} of {totalPanes} listening
                  </span>
                </div>
                <div className='capture-session-metric-row'>
                  <span className='capture-session-metric-label'>
                    Retained Executions:
                  </span>
                  <span className='capture-session-metric-value'>
                    {blocks.length}{' '}
                    {blocks.length === 1 ? 'command' : 'commands'}
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 2: EVIDENCE (CAPTURED EXECUTIONS) */}
          <section className='evidence-section' aria-label='Captured evidence'>
            <div className='evidence-header-actions capture-panel-header'>
              {/* Bulk selection & global actions */}
              <div className='capture-toolbar-actions-row'>
                <label className='capture-select-all-label'>
                  <input
                    ref={selectAllCheckboxRef}
                    type='checkbox'
                    className='capture-checkbox'
                    checked={isAllSelected}
                    disabled={totalBlocks === 0}
                    onChange={handleSelectAllChange}
                    aria-label='Select or deselect all transcript blocks'
                  />
                  <span className='capture-selection-count'>
                    {selectedCount} selected
                  </span>
                </label>

                <div className='capture-global-actions capture-selection-actions'>
                  <button
                    type='button'
                    className='capture-icon-btn icon-button'
                    onClick={handleCopySelectedClick}
                    disabled={selectedCount === 0}
                    aria-label='Copy selected transcript blocks'
                    title='Copy selected transcript blocks'
                  >
                    <svg
                      width='12'
                      height='12'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      aria-hidden='true'
                    >
                      <rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
                      <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
                    </svg>
                  </button>
                  <button
                    type='button'
                    className='capture-icon-btn capture-icon-btn-danger capture-icon-btn--destructive icon-button'
                    data-destructive-hover='true'
                    onClick={() => setPendingConfirmation('delete-selected')}
                    disabled={selectedCount === 0}
                    aria-label='Delete selected transcript blocks'
                    title='Delete selected transcript blocks'
                  >
                    <svg
                      width='12'
                      height='12'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      aria-hidden='true'
                    >
                      <polyline points='3 6 5 6 21 6' />
                      <path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
                      <line x1='10' y1='11' x2='10' y2='17' />
                      <line x1='14' y1='11' x2='14' y2='17' />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Inline Destructive Confirmation Banner (stays local to Evidence deletion; banners support type="success") */}
            {isDeleteConfirmActive && (
              <div
                className='capture-banner-area'
                aria-label='Capture panel notifications'
              >
                <InlineDestructiveBanner
                  title={`Delete ${selectedCount} block${selectedCount === 1 ? '' : 's'}?`}
                  body='Only local captured blocks are removed. Terminal screen and history are unaffected.'
                  confirmLabel='Delete'
                  onCancel={() => setPendingConfirmation(null)}
                  onConfirm={() => {
                    setPendingConfirmation(null);
                    onDeleteSelected();
                    feedbackStore.push({
                      level: 'info',
                      source: 'evidence',
                      title: `Deleted ${selectedCount} execution ${selectedCount === 1 ? 'record' : 'records'}`,
                    });
                  }}
                />
              </div>
            )}

            {/* Empty state combinations (Section 9) or Execution Cards */}
            {blocks.length === 0 ? (
              <div className='context-empty'>
                <span className='context-empty-icon' aria-hidden='true'>
                  ◫
                </span>
                <p>
                  {isListening
                    ? 'Waiting for captured executions'
                    : 'No captured executions yet'}
                </p>
                <small>
                  {isListening
                    ? 'Run commands in the terminal to record executions.'
                    : 'Start Capture above to begin recording terminal commands.'}
                </small>
              </div>
            ) : (
              <div className='transcript-scroll-container'>
                <div className='transcript-card-list'>
                  {blocks.map((block, index) => {
                    const cardAttribution = changeAttributions?.find(
                      (a) =>
                        a.targetId === block.id || a.id === block.attributionId,
                    );
                    return (
                      <TranscriptCard
                        key={block.id}
                        block={block}
                        index={index}
                        isSelected={selectedBlockIds.has(block.id)}
                        isCollapsed={collapsedBlockIds.has(block.id)}
                        attribution={cardAttribution}
                        onToggleSelect={onToggleSelect}
                        onToggleCollapsed={toggleCollapsed}
                        onCopyBlock={handleCardCopy}
                        onDeleteBlock={onDeleteBlock}
                        onCopyText={handleCopyText}
                        onRerunCommand={onRerunCommand}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      {/* Surface 3: Repository Changes View */}
      {activeMonitorView === 'changes' && (
        <div className='changes-view-surface' data-view='changes'>
          <RepositoryEvidenceView
            snapshot={repositorySnapshot}
            collectionRun={latestCollectionRun}
            isCollecting={isCollectingRepositoryEvidence}
            onRefresh={handleRefreshRepositoryEvidence}
            selectionState={evidenceSelection}
            onToggleFileSelection={handleToggleFileSelection}
            onSelectAllFiles={handleSelectAllFiles}
            onClearFileSelection={handleClearFileSelection}
            onCopyFeedback={triggerCopyFeedback}
            workspaceName={workspaceName}
            workspaceRootPath={workspaceRootPath}
            repositoryRoot={repositoryRoot}
            repositoryBranch={repositoryBranch}
            onOpenFolder={onOpenFolder}
          />
        </div>
      )}
      {/* Surface 4: Verification View */}
      {activeMonitorView === 'verification' && (
        <div className='verification-view-surface' data-view='verification'>
          {verificationContract ? (
            <VerificationPanel
              contract={verificationContract}
              contracts={verificationContracts}
              activeRun={activeVerificationRun ?? null}
              historicalRuns={historicalVerificationRuns ?? []}
              isRunning={isTrulyRunning}
              isStopping={isTrulyStopping}
              isStopTimeout={isTrulyStopTimeout}
              blocks={blocks}
              selectedCriterionIds={selectedVerificationCriterionIds}
              onToggleSelectCriterion={onToggleSelectVerificationCriterion}
              onSelectAllCriteria={onSelectAllVerificationCriteria}
              onClearCriteriaSelection={onClearVerificationCriteriaSelection}
              onRunVerification={onRunVerification ?? (() => {})}
              onCancelVerification={onCancelVerification ?? (() => {})}
              onStopVerification={
                onStopVerification ?? onCancelVerification ?? (() => {})
              }
              onContinueUnfinished={onContinueUnfinished}
              changeAttributions={changeAttributions}
              onSelectProfile={onSelectVerificationProfile}
              onCreateProfile={onCreateVerificationProfile}
              onRenameProfile={onRenameVerificationProfile}
              onDeleteProfile={onDeleteVerificationProfile}
              onAddCriterion={onAddVerificationCriterion}
              onUpdateCriterion={onUpdateVerificationCriterion}
              onDeleteCriterion={onDeleteVerificationCriterion}
              onReorderCriteria={onReorderVerificationCriteria}
              onClearRunHistory={onClearRunHistory}
              onSelectExecution={(execId) => {
                handleSelectView('capture-evidence');
                onToggleSelect(execId);
                onSelectVerificationExecution?.(execId);
              }}
            />
          ) : (
            <div className='context-empty'>
              <span className='context-empty-icon' aria-hidden='true'>
                ✓
              </span>
              <p>No verification contract</p>
              <small>
                Configure a verification contract or run automated verification
                checks.
              </small>
            </div>
          )}
        </div>
      )}
      {/* Fixed Monitor Footer: Shared cross-domain EvidenceSelection actions for all surfaces 2–6 */}
      <MonitorFooter
        selectionState={activeSelectionState}
        totalSelectedCount={totalSelectedEvidenceCount}
        isCopied={isSelectionCopied}
        onClear={handleClearAllEvidenceSelection}
        onCopy={handleCopySelectedEvidence}
        onCreatePrompt={() => setIsPromptComposerOpen(true)}
      />
      {/* Modals: Prompt Composer & Agent Comparison */}
      <PromptComposerModal
        isOpen={isPromptComposerOpen}
        selectedItems={allSelectedEvidenceItems}
        repositoryRoot={repositorySnapshot?.repositoryRoot}
        onClose={() => setIsPromptComposerOpen(false)}
        onCopySuccess={triggerCopyFeedback}
      />
    </aside>
  );
});
