import { useMemo, useState, useRef } from 'react';
import type { TerminalPaneHandle } from '../terminal/TerminalPane';
import type {
  TerminalSessionInfo,
  TerminalSessionStatus,
} from '../terminal/types';
import type { ShellIntegrationEvent } from '../terminal/shellIntegration';
import type {
  TerminalTab,
  LogicalWorkspaceId,
  CapturePanel,
} from './types';
import type { TerminalPaneToast } from '../warnings/types';
import {
  migrateTerminalTabToPanelLayoutTree,
  extractTerminalLayoutNode,
} from './panelLayoutTree';
import {
  PanelLayoutNodeView,
  type PanelLayoutTranscriptProps,
} from './PanelLayoutNodeView';
import { TranscriptCapturePanel } from '../transcript/TranscriptCapturePanel';
import './TerminalPaneLayout.css';

export interface TerminalPaneLayoutProps {
  workspaceId: LogicalWorkspaceId;
  tab: TerminalTab;
  isTabActive: boolean;
  terminalRefs: React.MutableRefObject<Map<string, TerminalPaneHandle>>;
  onSetActivePane: (paneId: string) => void;
  onSplitPaneRight?: (paneId: string) => void;
  onSplitPaneDown?: (paneId: string) => void;
  onClosePane?: (paneId: string) => void;
  onRenamePane?: (
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
    customTitle: string | null,
  ) => void;
  onResizePaneLayout: (splitRatio: number) => void;
  onResizeSplit?: (splitId: string, splitRatio: number) => void;
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
  ) => void;
  onSessionEnded: (
    workspaceId: string,
    tabId: string,
    paneId: string,
  ) => void;
  transcriptProps: PanelLayoutTranscriptProps;
  terminalPaneToast?: TerminalPaneToast | null;
  isCapturePanelOpen?: boolean;
  capturePanelWidth?: number;
  onResizeCaptureWidth?: (width: number) => void;
}

export function TerminalPaneLayout({
  workspaceId,
  tab,
  isTabActive,
  terminalRefs,
  onSetActivePane,
  onClosePane,
  onRenamePane,
  onResizePaneLayout,
  onResizeSplit,
  onRetryCapture,
  onDismissCaptureWarning,
  onStatusChange,
  onTerminalInput,
  onTerminalOutput,
  onSessionEnded,
  transcriptProps,
  terminalPaneToast,
  isCapturePanelOpen,
  capturePanelWidth,
  onResizeCaptureWidth,
}: TerminalPaneLayoutProps) {
  const migratedTab = useMemo(
    () => migrateTerminalTabToPanelLayoutTree(tab, workspaceId),
    [tab, workspaceId],
  );

  const isCaptureOpen = isCapturePanelOpen ?? tab.isCapturePanelOpen ?? true;
  const [localCaptureWidth, setLocalCaptureWidth] = useState<number | null>(null);
  const [prevTabId, setPrevTabId] = useState(tab.id);

  if (tab.id !== prevTabId) {
    setPrevTabId(tab.id);
    setLocalCaptureWidth(null);
  }

  const currentCaptureWidth =
    localCaptureWidth ?? capturePanelWidth ?? tab.capturePanelWidth ?? 400;

  const handleResizeSplit = (splitId: string, newRatio: number) => {
    if (onResizeSplit) {
      onResizeSplit(splitId, newRatio);
    } else {
      onResizePaneLayout(newRatio);
    }
  };

  const terminalLayoutNode = useMemo(
    () =>
      extractTerminalLayoutNode(
        migratedTab.panelLayout,
        migratedTab.capturePanelId,
      ),
    [migratedTab.panelLayout, migratedTab.capturePanelId],
  );

  const capturePanel = useMemo(
    () =>
      migratedTab.panels?.find((p): p is CapturePanel => p.kind === 'capture'),
    [migratedTab.panels],
  );

  const availablePanes = useMemo(
    () =>
      migratedTab.panes
        .slice()
        .sort((a, b) => a.stableOrdinal - b.stableOrdinal)
        .map((p) => ({
          id: p.id,
          stableOrdinal: p.stableOrdinal,
          accentId: p.accentId,
        })),
    [migratedTab.panes],
  );

  const paneBlocks = useMemo(
    () =>
      transcriptProps.blocks
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
        }),
    [transcriptProps.blocks, tab.id, workspaceId],
  );

  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingResizer, setIsDraggingResizer] = useState(false);
  const isDraggingResizerRef = useRef(false);

  const handleResizerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const container = workspaceBodyRef.current;
    if (!container) return;

    isDraggingResizerRef.current = true;
    setIsDraggingResizer(true);
    const containerRect = container.getBoundingClientRect();

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (!isDraggingResizerRef.current) return;
      moveEvent.preventDefault();

      const newWidth = containerRect.right - moveEvent.clientX;
      const minWidth = 260;
      const maxWidth = Math.max(minWidth, containerRect.width - 200);
      const clamped = Math.max(minWidth, Math.min(maxWidth, Math.round(newWidth)));
      setLocalCaptureWidth(clamped);
      onResizeCaptureWidth?.(clamped);
    };

    const handlePointerUp = () => {
      if (!isDraggingResizerRef.current) return;
      isDraggingResizerRef.current = false;
      setIsDraggingResizer(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      for (const p of tab.panes) {
        terminalRefs.current.get(p.id)?.refit();
      }
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const handleResizerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const containerWidth =
        workspaceBodyRef.current?.getBoundingClientRect().width ?? 1200;
      const maxWidth = Math.max(260, containerWidth - 200);
      const nextWidth = Math.min(maxWidth, currentCaptureWidth + 20);
      setLocalCaptureWidth(nextWidth);
      onResizeCaptureWidth?.(nextWidth);
      for (const p of tab.panes) {
        terminalRefs.current.get(p.id)?.refit();
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextWidth = Math.max(260, currentCaptureWidth - 20);
      setLocalCaptureWidth(nextWidth);
      onResizeCaptureWidth?.(nextWidth);
      for (const p of tab.panes) {
        terminalRefs.current.get(p.id)?.refit();
      }
    }
  };

  return (
    <section className="terminal-tab-content-shell">
      {isTabActive && (
        <div
          className="terminal-pane-toast-region"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {terminalPaneToast ? (
            <div className="terminal-pane-toast">
              {terminalPaneToast.message}
            </div>
          ) : null}
        </div>
      )}
      <div
        ref={workspaceBodyRef}
        className="terminal-workspace-body"
        data-capture-open={isCaptureOpen ? 'true' : 'false'}
        data-monitor-focused={transcriptProps.isMonitorFocused ? 'true' : undefined}
        style={{
          ['--capture-panel-width' as string]: `${currentCaptureWidth}px`,
        }}
      >
        <div className="terminal-main-region">
          <PanelLayoutNodeView
            key={
              terminalLayoutNode.type === 'panel'
                ? terminalLayoutNode.panelId
                : terminalLayoutNode.id
            }
            node={terminalLayoutNode}
            workspaceId={workspaceId}
            tab={migratedTab}
            isTabActive={isTabActive}
            terminalRefs={terminalRefs}
            onSetActivePane={onSetActivePane}
            onClosePane={onClosePane}
            onRenamePane={onRenamePane}
            onResizeSplit={handleResizeSplit}
            onRetryCapture={onRetryCapture}
            onDismissCaptureWarning={onDismissCaptureWarning}
            onStatusChange={onStatusChange}
            onTerminalInput={onTerminalInput}
            onTerminalOutput={onTerminalOutput}
            onSessionEnded={onSessionEnded}
            transcriptProps={transcriptProps}
          />
        </div>

        {isCaptureOpen && (
          <div
            className="capture-resizer pane-divider pane-divider--horizontal"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize capture side panel"
            tabIndex={0}
            data-dragging={isDraggingResizer ? 'true' : undefined}
            onPointerDown={handleResizerPointerDown}
            onKeyDown={handleResizerKeyDown}
          />
        )}

        {isCaptureOpen && (
          <aside
            id={`capture-side-panel-${tab.id}`}
            className="capture-side-panel"
            aria-label="Capture side panel"
          >
            <TranscriptCapturePanel
              isListening={transcriptProps.isListening}
              blocks={paneBlocks}
              currentBatchId={transcriptProps.currentBatchId}
              currentBatchBlockCount={transcriptProps.currentBatchBlockCount}
              selectedBlockIds={transcriptProps.selectedBlockIds}
              feedback={transcriptProps.feedback}
              availablePanes={availablePanes}
              selectedCapturePaneIds={capturePanel?.selectedCapturePaneIds ?? []}
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
              onSelectVerificationExecution={transcriptProps.onSelectVerificationExecution}
              onSelectVerificationProfile={transcriptProps.onSelectVerificationProfile}
              onCreateVerificationProfile={transcriptProps.onCreateVerificationProfile}
              onRenameVerificationProfile={transcriptProps.onRenameVerificationProfile}
              onDeleteVerificationProfile={transcriptProps.onDeleteVerificationProfile}
              onAddVerificationCriterion={transcriptProps.onAddVerificationCriterion}
              onUpdateVerificationCriterion={transcriptProps.onUpdateVerificationCriterion}
              onDeleteVerificationCriterion={transcriptProps.onDeleteVerificationCriterion}
              onReorderVerificationCriteria={transcriptProps.onReorderVerificationCriteria}
              repositorySnapshot={transcriptProps.repositorySnapshot}
              latestCollectionRun={transcriptProps.latestCollectionRun}
              isCollectingRepositoryEvidence={transcriptProps.isCollectingRepositoryEvidence}
              onRefreshRepositoryEvidence={transcriptProps.onRefreshRepositoryEvidence}
              changeAttributions={transcriptProps.changeAttributions}
              agentRuns={transcriptProps.agentRuns}
              activeAgentRun={transcriptProps.activeAgentRun}
              onVerifyAgentRun={transcriptProps.onVerifyAgentRun}
              onCancelAgentRun={transcriptProps.onCancelAgentRun}
              onStartAgentRun={transcriptProps.onStartAgentRun}
              activeView={transcriptProps.activeMonitorView}
              onViewChange={transcriptProps.onSelectMonitorView}
              isMonitorFocused={transcriptProps.isMonitorFocused}
              onToggleMonitorFocus={transcriptProps.onToggleMonitorFocus}
              workspaceName={transcriptProps.workspaceName}
              workspaceRootPath={transcriptProps.workspaceRootPath}
              repositoryRoot={transcriptProps.repositoryRoot}
              repositoryBranch={transcriptProps.repositoryBranch}
              onOpenFolder={transcriptProps.onOpenFolder}
            />
          </aside>
        )}
      </div>
    </section>
  );
}
