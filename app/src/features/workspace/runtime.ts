/**
 * Terminal Pane / Tab Runtime Isolation Model
 *
 * Provides isolated, ephemeral runtime state for terminal capture parsing, throttling timers,
 * input buffers, and decoders that must not live in persistent React workspace state.
 * Scoped strictly by workspaceId + terminalTabId + paneId.
 */

import type { LogicalWorkspaceId, TerminalTabId, TerminalPaneId } from './types';
import type { CaptureBatch, TranscriptBlock } from '../transcript/types';
import { StreamingTranscriptSanitizer } from '../transcript/transcriptSanitization';
import type {
  PendingExecutionInput,
  ShellLifecycleState,
} from '../terminal/commandBoundaryReconciler';
import { resetCommandBoundaryRuntime } from '../terminal/commandBoundaryReconciler';

export interface ActiveBlockParser {
  command: string;
  buffer: string;
  echoChecked: boolean;
  /** Trusted command-start cwd, kept for finalization before the block state commits. */
  cwd?: string;
}

export type PaneCaptureRuntimeKey = `${string}:${string}:${string}`;

export function getPaneCaptureRuntimeKey(
  workspaceId: string,
  terminalTabId: string,
  paneId: string,
): PaneCaptureRuntimeKey {
  return `${workspaceId}:${terminalTabId}:${paneId}`;
}

export type PaneCaptureStatus = 'idle' | 'capturing' | 'paused' | 'error';

/**
 * Observation a VerificationRun temporarily holds on its target pane so verification executions
 * are recorded and reconciled. It is not a user Capture command: `restoreStatus` is the user's
 * Capture status (the prior status, replaced by any explicit user Capture action during the run)
 * and is applied when the run releases the lease.
 */
export interface VerificationCaptureLease {
  runId: string;
  restoreStatus: PaneCaptureStatus;
  /** Batch created only so verification output could be recorded; dropped on release. */
  verificationBatch: CaptureBatch | null;
}

export interface PaneCaptureRuntime {
  workspaceId: string;
  terminalTabId: string;
  paneId: string;
  paneOrdinal?: number;

  status: PaneCaptureStatus;
  verificationLease: VerificationCaptureLease | null;

  captureSessionId: string | null;
  captureGroupId: string | null;

  currentBatch: CaptureBatch | null;
  batchCounter: number;

  activeBlockId: string | null;
  activeBlockParser: ActiveBlockParser | null;

  inputBuffer: string;
  shellLifecycleState: ShellLifecycleState;
  pendingExecutionInput: PendingExecutionInput | null;
  flushTimer: number | null;
  textDecoder: TextDecoder;
  sanitizer: StreamingTranscriptSanitizer;

  blocks: TranscriptBlock[];
}

// Backward-compatible aliases
export type TerminalPaneRuntime = PaneCaptureRuntime;
export type TerminalTabRuntime = PaneCaptureRuntime;

export function createPaneCaptureRuntime(
  workspaceId: LogicalWorkspaceId | string,
  terminalTabId: TerminalTabId | string,
  paneId: TerminalPaneId | string,
  paneOrdinal?: number,
): PaneCaptureRuntime {
  return {
    workspaceId,
    terminalTabId,
    paneId,
    paneOrdinal: paneOrdinal ?? 1,
    status: 'idle',
    verificationLease: null,
    captureSessionId: null,
    captureGroupId: null,
    currentBatch: null,
    batchCounter: 0,
    activeBlockId: null,
    activeBlockParser: null,
    inputBuffer: '',
    shellLifecycleState: 'initializing',
    pendingExecutionInput: null,
    flushTimer: null,
    textDecoder: new TextDecoder(),
    sanitizer: new StreamingTranscriptSanitizer(),
    blocks: [],
  };
}

export const createTerminalPaneRuntime = createPaneCaptureRuntime;

/** The user's Capture status for a pane, independent of any verification lease. */
export function getUserCaptureStatus(runtime: PaneCaptureRuntime): PaneCaptureStatus {
  return runtime.verificationLease?.restoreStatus ?? runtime.status;
}

/**
 * Arms observation for a verification run. The lease is held for the whole run: re-acquiring
 * for a later criterion of the same pane keeps the user's status it already recorded.
 */
export function acquireVerificationCaptureLease(
  runtime: PaneCaptureRuntime,
  runId: string,
  createBatch: () => CaptureBatch,
): void {
  if (!runtime.verificationLease) {
    runtime.verificationLease = { runId, restoreStatus: runtime.status, verificationBatch: null };
  }
  runtime.verificationLease.runId = runId;
  if (!runtime.currentBatch) {
    runtime.currentBatch = createBatch();
    runtime.verificationLease.verificationBatch = runtime.currentBatch;
  }
  runtime.status = 'capturing';
}

/**
 * Records an explicit user Capture action on a pane that a verification run is observing.
 * Returns true when deferred: the run keeps observing and the status applies on release.
 */
export function deferUserCaptureStatus(
  runtime: PaneCaptureRuntime,
  status: PaneCaptureStatus,
): boolean {
  if (!runtime.verificationLease) return false;
  runtime.verificationLease.restoreStatus = status;
  return true;
}

/** Ends a run's lease and applies the user's Capture status. Other runs' leases are untouched. */
export function releaseVerificationCaptureLease(
  runtime: PaneCaptureRuntime,
  runId: string,
): void {
  const lease = runtime.verificationLease;
  if (!lease || lease.runId !== runId) return;
  runtime.verificationLease = null;
  runtime.status = lease.restoreStatus;
  if (lease.verificationBatch && runtime.currentBatch === lease.verificationBatch) {
    runtime.currentBatch = null;
  }
}

export function createTerminalTabRuntime(
  workspaceId: LogicalWorkspaceId | string,
  terminalTabId: TerminalTabId | string,
  paneId?: TerminalPaneId | string,
): TerminalTabRuntime {
  return createPaneCaptureRuntime(
    workspaceId,
    terminalTabId,
    paneId ?? `pane-${terminalTabId}`,
  );
}

export function cleanupPaneCaptureRuntime(runtime: PaneCaptureRuntime): void {
  if (runtime.flushTimer !== null) {
    window.clearTimeout(runtime.flushTimer);
    runtime.flushTimer = null;
  }
  runtime.activeBlockId = null;
  runtime.activeBlockParser = null;
  runtime.sanitizer?.reset();
  resetCommandBoundaryRuntime(runtime);
}

export const cleanupTerminalPaneRuntime = cleanupPaneCaptureRuntime;
export const cleanupTerminalTabRuntime = cleanupPaneCaptureRuntime;

export function getCaptureGroupStatus(
  workspaceId: string,
  terminalTabId: string,
  capturePanelOrSelectedPaneIds:
    | { selectedCapturePaneIds?: string[] }
    | string[]
    | undefined,
  paneCaptureRuntimes: Map<PaneCaptureRuntimeKey, PaneCaptureRuntime>,
): 'ready' | 'capturing' | 'paused' | 'error' {
  const selectedPaneIds = Array.isArray(capturePanelOrSelectedPaneIds)
    ? capturePanelOrSelectedPaneIds
    : capturePanelOrSelectedPaneIds?.selectedCapturePaneIds;

  if (!selectedPaneIds || selectedPaneIds.length === 0) {
    return 'ready';
  }
  const groupRuntimes: PaneCaptureRuntime[] = [];
  for (const paneId of selectedPaneIds) {
    const key = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, paneId);
    const r = paneCaptureRuntimes.get(key);
    if (r) groupRuntimes.push(r);
  }

  const isAnyCapturing = groupRuntimes.some((r) => r.status === 'capturing');
  if (isAnyCapturing) return 'capturing';

  const isAnyPaused = groupRuntimes.some((r) => r.status === 'paused');
  if (isAnyPaused) return 'paused';

  const isAnyError = groupRuntimes.some((r) => (r.status as string) === 'error');
  if (isAnyError) return 'error';

  return 'ready';
}

let activePaneCaptureRuntimesRegistry = new Map<
  PaneCaptureRuntimeKey,
  PaneCaptureRuntime
>();

export function setActivePaneCaptureRuntimesRegistry(
  registry: Map<PaneCaptureRuntimeKey, PaneCaptureRuntime>,
): void {
  activePaneCaptureRuntimesRegistry = registry;
}

export function getActivePaneCaptureRuntimesRegistry(): Map<
  PaneCaptureRuntimeKey,
  PaneCaptureRuntime
> {
  return activePaneCaptureRuntimesRegistry;
}

export function isPaneCaptureActive(
  workspaceId: string,
  terminalTabId: string,
  paneId: string,
  paneCaptureRuntimes: Map<
    PaneCaptureRuntimeKey,
    PaneCaptureRuntime
  > = activePaneCaptureRuntimesRegistry,
): boolean {
  const key = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, paneId);
  const runtime = paneCaptureRuntimes?.get(key);
  if (!runtime) return false;
  return runtime.status === 'capturing' || runtime.status === 'paused';
}

export interface PaneCaptureCloseImpact {
  paneOrdinal: number;
  captureStatus: 'capturing' | 'paused';
  otherActiveCapturedPaneCount: number;
  isOnlyActiveCapturedTarget: boolean;
}

export function getPaneCaptureCloseImpact(
  workspaceId: string,
  terminalTabId: string,
  paneId: string,
  paneCaptureRuntimes: Map<
    PaneCaptureRuntimeKey,
    PaneCaptureRuntime
  > = activePaneCaptureRuntimesRegistry,
  tabOrPanes?:
    | { panes?: { id: string; stableOrdinal?: number }[] }
    | { id: string; stableOrdinal?: number }[],
): PaneCaptureCloseImpact {
  const key = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, paneId);
  const runtime = paneCaptureRuntimes?.get(key);
  const captureStatus: 'capturing' | 'paused' =
    runtime?.status === 'paused' ? 'paused' : 'capturing';

  let paneOrdinal = runtime?.paneOrdinal ?? 1;
  const panesList = Array.isArray(tabOrPanes)
    ? tabOrPanes
    : tabOrPanes?.panes;

  if (panesList) {
    const found = panesList.find((p) => p.id === paneId);
    if (found && typeof found.stableOrdinal === 'number') {
      paneOrdinal = found.stableOrdinal;
    }
  }

  let otherActiveCapturedPaneCount = 0;
  if (panesList) {
    for (const p of panesList) {
      if (
        p.id !== paneId &&
        isPaneCaptureActive(workspaceId, terminalTabId, p.id, paneCaptureRuntimes)
      ) {
        otherActiveCapturedPaneCount++;
      }
    }
  } else if (paneCaptureRuntimes) {
    for (const r of paneCaptureRuntimes.values()) {
      if (
        r.workspaceId === workspaceId &&
        r.terminalTabId === terminalTabId &&
        r.paneId !== paneId &&
        (r.status === 'capturing' || r.status === 'paused')
      ) {
        otherActiveCapturedPaneCount++;
      }
    }
  }

  const isOnlyActiveCapturedTarget = otherActiveCapturedPaneCount === 0;

  return {
    paneOrdinal,
    captureStatus,
    otherActiveCapturedPaneCount,
    isOnlyActiveCapturedTarget,
  };
}
