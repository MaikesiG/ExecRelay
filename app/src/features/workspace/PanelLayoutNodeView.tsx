import React, { useRef } from 'react';
import type {
  PanelLayoutNode,
  TerminalTab,
  LogicalWorkspaceId,
  CapturePanel,
} from './types';
import {
  DerivedSurfaceErrorBoundary,
  type DerivedSurfaceErrorBoundaryProps,
} from './DerivedSurfaceErrorBoundary';
import { TerminalPaneHeader } from './TerminalPaneHeader';
import { collectPanelIds } from './panelLayoutTree';
import { PaneDivider } from './PaneDivider';
import {
  TerminalPane as TerminalPaneView,
  type TerminalPaneHandle,
} from '../terminal/TerminalPane';
import type { ShellIntegrationEvent } from '../terminal/shellIntegration';
import type {
  TerminalSessionInfo,
  TerminalSessionStatus,
} from '../terminal/types';
import { CaptureWarningBanner } from '../warnings';
import { TranscriptCapturePanel } from '../transcript/TranscriptCapturePanel';
import type {
  TranscriptBlock,
  TranscriptFeedback,
  CaptureStatus,
} from '../transcript/types';
import type {
  VerificationContract,
  VerificationRun,
} from '../verification';

export interface PanelLayoutTranscriptProps {
  blocks: TranscriptBlock[];
  currentBatchId: number | null;
  currentBatchBlockCount: number;
  selectedBlockIds: Set<string>;
  feedback: TranscriptFeedback | null;
  isListening: boolean;
  captureStatus?: CaptureStatus;
  isTargetSelectorLocked?: boolean;
  availableCapturePanes?: import('../transcript/TranscriptCapturePanel').CaptureTargetPaneInfo[];
  selectedCapturePaneIds?: string[];
  captureTargetMode?: 'all' | 'explicit';
  listeningCapturePaneCount?: number;
  onToggleListening: () => void;
  onStartCapture?: () => void;
  onPauseCapture?: () => void;
  onResumeCapture?: () => void;
  onStopCapture?: () => void;
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
  onSelectCapturePaneId?: (paneId: string) => void;
  onToggleSelectCapturePane?: (paneId: string) => void;
  onSelectAllCapturePanes?: (all: boolean) => void;
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
  onAddVerificationCriterion?: (contractId: string, criterion: { label: string; command: string; expectedExitCodes?: number[] }) => void;
  onUpdateVerificationCriterion?: (contractId: string, criterion: import('../verification/types').VerificationCriterion) => void;
  onDeleteVerificationCriterion?: (contractId: string, criterionId: string) => void;
  onReorderVerificationCriteria?: (contractId: string, orderedCriterionIds: string[]) => void;
  onClearRunHistory?: () => void;
  repositorySnapshot?: import('../evidenceCollectors/types').RepositorySnapshot | null;
  latestCollectionRun?: import('../evidenceCollectors/types').EvidenceCollectionRun | null;
  isCollectingRepositoryEvidence?: boolean;
  onRefreshRepositoryEvidence?: () => void;
  changeAttributions?: import('../attribution/types').ChangeAttribution[];
  activeMonitorView?: import('../shortcuts/types').MonitorView;
  onSelectMonitorView?: (view: import('../shortcuts/types').MonitorView) => void;
  isMonitorFocused?: boolean;
  onToggleMonitorFocus?: () => void;
  activeWorkspaceSurface?: import('../shortcuts/types').ActiveWorkspaceSurface;
  workspaceName?: string;
  workspaceRootPath?: string;
  repositoryRoot?: string;
  repositoryBranch?: string;
  onOpenFolder?: () => void;
}

export interface PanelLayoutNodeViewProps {
  node: PanelLayoutNode;
  workspaceId: LogicalWorkspaceId;
  tab: TerminalTab;
  isTabActive: boolean;
  terminalRefs: React.MutableRefObject<Map<string, TerminalPaneHandle>>;
  onSetActivePane: (paneId: string) => void;
  onClosePane?: (paneId: string) => void;
  onRenamePane?: (
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
    customTitle: string | null,
  ) => void;
  onResizeSplit: (splitId: string, newRatio: number) => void;
  onRetryCapture?: (paneId: string) => void;
  onDismissCaptureWarning?: (
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
    captureSessionId: string,
    warningId: string,
  ) => void;
  onStatusChange: (
    workspaceId: string,
    tabId: string,
    paneId: string,
    status: TerminalSessionStatus,
    info: TerminalSessionInfo | null,
  ) => void;
  onTerminalInput: (
    workspaceId: string,
    tabId: string,
    paneId: string,
    data: string,
  ) => void;
  onTerminalOutput: (
    workspaceId: string,
    tabId: string,
    paneId: string,
    bytes: Uint8Array,
    events?: ShellIntegrationEvent[],
    textChunk?: string,
  ) => void;
  onSessionEnded: (
    workspaceId: string,
    tabId: string,
    paneId: string,
  ) => void;
  transcriptProps: PanelLayoutTranscriptProps;
}

export { DerivedSurfaceErrorBoundary as PanelErrorBoundary };
export type { DerivedSurfaceErrorBoundaryProps as PanelErrorBoundaryProps };

export function PanelLayoutNodeView({
  node,
  workspaceId,
  tab,
  isTabActive,
  terminalRefs,
  onSetActivePane,
  onClosePane,
  onRenamePane,
  onResizeSplit,
  onRetryCapture,
  onDismissCaptureWarning,
  onStatusChange,
  onTerminalInput,
  onTerminalOutput,
  onSessionEnded,
  transcriptProps,
}: PanelLayoutNodeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (node.type === 'panel') {
    const panel = tab.panels?.find((p) => p.id === node.panelId);

    if (!panel) {
      return null;
    }

    if (panel.kind === 'terminal') {
      const pane = tab.panes.find((p) => p.id === panel.paneId);
      if (!pane) return null;

      const isPaneActive = isTabActive && pane.id === tab.activePaneId;
      const totalPanes = tab.terminalPanes?.length ?? tab.panes?.length ?? 1;
      const isMultiPane = totalPanes > 1;

      return (
        <div
          className={`terminal-pane ${isPaneActive ? 'terminal-pane--active' : ''}`}
          data-active={isPaneActive}
          data-pane-id={pane.id}
          data-stable-ordinal={pane.stableOrdinal}
          data-accent={pane.accentId}
          aria-current={isPaneActive ? 'true' : undefined}
          onClick={() => onSetActivePane(pane.id)}
          style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}
        >
          <TerminalPaneHeader
            pane={pane}
            isPaneActive={isPaneActive}
            isMultiPane={isMultiPane}
            onSetActivePane={() => onSetActivePane(pane.id)}
            onClosePane={() => onClosePane?.(pane.id)}
            onRenamePane={(customTitle) =>
              onRenamePane?.(workspaceId, tab.id, pane.id, customTitle)
            }
          />

          {onDismissCaptureWarning && (
            <CaptureWarningBanner
              workspaceId={workspaceId}
              terminalTabId={tab.id}
              paneId={pane.id}
              captureSessionId={pane.capture?.sessionId ?? undefined}
              warning={pane.capture?.warning ?? null}
              onRetryCapture={
                onRetryCapture ? () => onRetryCapture(pane.id) : undefined
              }
              onDismiss={onDismissCaptureWarning}
            />
          )}

          <TerminalPaneView
            key={pane.id}
            paneId={pane.id}
            terminalSessionId={
              pane.terminalSessionId ?? pane.session?.sessionId ?? undefined
            }
            workspaceId={workspaceId}
            cwd={
              pane.lastKnownCwd ??
              pane.session?.sessionInfo?.cwd ??
              transcriptProps.workspaceRootPath
            }
            isActive={isPaneActive}
            onClick={() => onSetActivePane(pane.id)}
            ref={(handle) => {
              if (handle) {
                terminalRefs.current.set(pane.id, handle);
              } else {
                terminalRefs.current.delete(pane.id);
              }
            }}
            onStatusChange={(status, info) =>
              onStatusChange(workspaceId, tab.id, pane.id, status, info)
            }
            onTerminalInput={(data) =>
              onTerminalInput(workspaceId, tab.id, pane.id, data)
            }
            onTerminalOutput={(bytes, events, textChunk) =>
              onTerminalOutput(workspaceId, tab.id, pane.id, bytes, events, textChunk)
            }
            onSessionEnded={() =>
              onSessionEnded(workspaceId, tab.id, pane.id)
            }
          />
        </div>
      );
    }

    if (panel.kind === 'capture') {
      const capturePanel = panel as CapturePanel;

      const availablePanes = tab.panes
        .slice()
        .sort((a, b) => a.stableOrdinal - b.stableOrdinal)
        .map((p) => ({
          id: p.id,
          stableOrdinal: p.stableOrdinal,
          accentId: p.accentId,
        }));

      const paneBlocks = transcriptProps.blocks
        .filter((b) => {
          if (b.terminalTabId && b.terminalTabId !== tab.id) {
            return false;
          }
          if (b.workspaceId && b.workspaceId !== workspaceId) {
            return false;
          }
          return true;
        })
        .sort((a, b) => {
          if (a.startedAt !== b.startedAt) {
            return a.startedAt - b.startedAt;
          }
          return a.id.localeCompare(b.id);
        });

      return (
        <div
          className="capture-panel-leaf-wrapper"
          style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, display: 'flex' }}
        >
          <DerivedSurfaceErrorBoundary surfaceName="Capture panel" panelId={panel.id}>
          <TranscriptCapturePanel
            isListening={transcriptProps.isListening}
            blocks={paneBlocks}
            currentBatchId={transcriptProps.currentBatchId}
            currentBatchBlockCount={transcriptProps.currentBatchBlockCount}
            selectedBlockIds={transcriptProps.selectedBlockIds}
            feedback={transcriptProps.feedback}
            availablePanes={transcriptProps.availableCapturePanes ?? availablePanes}
            selectedCapturePaneIds={
              transcriptProps.selectedCapturePaneIds ??
              capturePanel.selectedCapturePaneIds ??
              []
            }
            captureTargetMode={transcriptProps.captureTargetMode}
            listeningPaneCount={transcriptProps.listeningCapturePaneCount}
            isTargetSelectorLocked={transcriptProps.isTargetSelectorLocked}
            captureStatusOverride={transcriptProps.captureStatus}
            onToggleListening={transcriptProps.onToggleListening}
            onStartCapture={transcriptProps.onStartCapture}
            onPauseCapture={transcriptProps.onPauseCapture}
            onResumeCapture={transcriptProps.onResumeCapture}
            onStopCapture={transcriptProps.onStopCapture}
            onToggleSelectCapturePane={
              transcriptProps.onToggleSelectCapturePane
                ? (paneId) =>
                    transcriptProps.onToggleSelectCapturePane!(paneId)
                : undefined
            }
            onSelectAllCapturePanes={transcriptProps.onSelectAllCapturePanes}
            onToggleSelect={transcriptProps.onToggleSelect}
            onSelectAllVisible={transcriptProps.onSelectAllVisible}
            onClearSelection={transcriptProps.onClearSelection}
            onCopyBlock={transcriptProps.onCopyBlock}
            onCopyCurrentBatch={transcriptProps.onCopyCurrentBatch}
            onCopySelected={transcriptProps.onCopySelected}
            onDeleteBlock={transcriptProps.onDeleteBlock}
            onDeleteSelected={transcriptProps.onDeleteSelected}
            onRerunCommand={transcriptProps.onRerunCommand}
            verificationContract={transcriptProps.verificationContract}
            verificationContracts={transcriptProps.verificationContracts}
            activeVerificationRun={transcriptProps.activeVerificationRun}
            latestVerificationRun={transcriptProps.latestVerificationRun}
            historicalVerificationRuns={transcriptProps.historicalVerificationRuns}
            isVerificationRunning={transcriptProps.isVerificationRunning}
            isVerificationStopping={transcriptProps.isVerificationStopping}
            isVerificationStopTimeout={transcriptProps.isVerificationStopTimeout}
            selectedVerificationCriterionIds={transcriptProps.selectedVerificationCriterionIds}
            onToggleSelectVerificationCriterion={transcriptProps.onToggleSelectVerificationCriterion}
            onSelectAllVerificationCriteria={transcriptProps.onSelectAllVerificationCriteria}
            onClearVerificationCriteriaSelection={transcriptProps.onClearVerificationCriteriaSelection}
            onRunVerification={transcriptProps.onRunVerification}
            onCancelVerification={transcriptProps.onCancelVerification}
            onStopVerification={transcriptProps.onStopVerification}
            onContinueUnfinished={transcriptProps.onContinueUnfinished}
            onSelectVerificationExecution={transcriptProps.onSelectVerificationExecution}
            onSelectVerificationProfile={transcriptProps.onSelectVerificationProfile}
            onCreateVerificationProfile={transcriptProps.onCreateVerificationProfile}
            onRenameVerificationProfile={transcriptProps.onRenameVerificationProfile}
            onDeleteVerificationProfile={transcriptProps.onDeleteVerificationProfile}
            onAddVerificationCriterion={transcriptProps.onAddVerificationCriterion}
            onUpdateVerificationCriterion={transcriptProps.onUpdateVerificationCriterion}
            onDeleteVerificationCriterion={transcriptProps.onDeleteVerificationCriterion}
            onReorderVerificationCriteria={transcriptProps.onReorderVerificationCriteria}
            onClearRunHistory={transcriptProps.onClearRunHistory}
            repositorySnapshot={transcriptProps.repositorySnapshot}
            latestCollectionRun={transcriptProps.latestCollectionRun}
            isCollectingRepositoryEvidence={transcriptProps.isCollectingRepositoryEvidence}
            onRefreshRepositoryEvidence={transcriptProps.onRefreshRepositoryEvidence}
            changeAttributions={transcriptProps.changeAttributions}
            activeView={transcriptProps.activeMonitorView}
            onViewChange={transcriptProps.onSelectMonitorView}
            isMonitorFocused={transcriptProps.isMonitorFocused}
            onToggleMonitorFocus={transcriptProps.onToggleMonitorFocus}
          />
        </DerivedSurfaceErrorBoundary>
        </div>
      );
    }

    return null;
  }

  // Node is SplitNode
  const handleResizeEnd = () => {
    // Refit all descendant visible terminal panes under this split node
    const descendantPanelIds = collectPanelIds(node);
    for (const panelId of descendantPanelIds) {
      const p = tab.panels?.find((item) => item.id === panelId);
      if (p && p.kind === 'terminal') {
        terminalRefs.current.get(p.paneId)?.refit();
      }
    }
  };

  const isRow = node.direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={`panel-split-node panel-split-node--${node.direction}`}
      style={{
        display: 'flex',
        flexDirection: isRow ? 'row' : 'column',
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* First Child */}
      <div
        className="split-node-branch split-node-branch--first"
        style={{
          flex: `${node.ratio} 1 0%`,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <PanelLayoutNodeView
          key={
            node.first.type === 'panel'
              ? node.first.panelId
              : node.first.id
          }
          node={node.first}
          workspaceId={workspaceId}
          tab={tab}
          isTabActive={isTabActive}
          terminalRefs={terminalRefs}
          onSetActivePane={onSetActivePane}
          onClosePane={onClosePane}
          onRenamePane={onRenamePane}
          onResizeSplit={onResizeSplit}
          onRetryCapture={onRetryCapture}
          onDismissCaptureWarning={onDismissCaptureWarning}
          onStatusChange={onStatusChange}
          onTerminalInput={onTerminalInput}
          onTerminalOutput={onTerminalOutput}
          onSessionEnded={onSessionEnded}
          transcriptProps={transcriptProps}
        />
      </div>

      {/* Draggable Divider */}
      <PaneDivider
        key={`divider-${node.id}`}
        direction={node.direction}
        splitRatio={node.ratio}
        onResize={(newRatio) => onResizeSplit(node.id, newRatio)}
        onResizeEnd={handleResizeEnd}
        containerRef={containerRef}
      />

      {/* Second Child */}
      <div
        className="split-node-branch split-node-branch--second"
        style={{
          flex: `${1 - node.ratio} 1 0%`,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <PanelLayoutNodeView
          key={
            node.second.type === 'panel'
              ? node.second.panelId
              : node.second.id
          }
          node={node.second}
          workspaceId={workspaceId}
          tab={tab}
          isTabActive={isTabActive}
          terminalRefs={terminalRefs}
          onSetActivePane={onSetActivePane}
          onClosePane={onClosePane}
          onRenamePane={onRenamePane}
          onResizeSplit={onResizeSplit}
          onRetryCapture={onRetryCapture}
          onDismissCaptureWarning={onDismissCaptureWarning}
          onStatusChange={onStatusChange}
          onTerminalInput={onTerminalInput}
          onTerminalOutput={onTerminalOutput}
          onSessionEnded={onSessionEnded}
          transcriptProps={transcriptProps}
        />
      </div>
    </div>
  );
}
