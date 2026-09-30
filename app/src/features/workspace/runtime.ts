/**
 * Terminal Pane / Tab Runtime Isolation Model
 *
 * Provides isolated, ephemeral runtime state for terminal capture parsing, throttling timers,
 * input buffers, and decoders that must not live in persistent React workspace state.
 * Scoped strictly by workspaceId + terminalTabId + paneId.
 */

import type { LogicalWorkspaceId, TerminalTabId, TerminalPaneId } from './types';
import type { CaptureBatch, TranscriptBlock } from '../transcript/types';

export interface ActiveBlockParser {
  command: string;
  buffer: string;
  echoChecked: boolean;
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

export interface PaneCaptureRuntime {
  workspaceId: string;
  terminalTabId: string;
  paneId: string;
  paneOrdinal?: number;

  status: PaneCaptureStatus;

  captureSessionId: string | null;
  captureGroupId: string | null;

  currentBatch: CaptureBatch | null;
  batchCounter: number;

  activeBlockId: string | null;
  activeBlockParser: ActiveBlockParser | null;

  inputBuffer: string;
  flushTimer: number | null;
  textDecoder: TextDecoder;

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
    captureSessionId: null,
    captureGroupId: null,
    currentBatch: null,
    batchCounter: 0,
    activeBlockId: null,
    activeBlockParser: null,
    inputBuffer: '',
    flushTimer: null,
    textDecoder: new TextDecoder(),
    blocks: [],
  };
}

export const createTerminalPaneRuntime = createPaneCaptureRuntime;

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
  runtime.inputBuffer = '';
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
