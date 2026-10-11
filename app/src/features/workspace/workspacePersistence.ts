/**
 * ExecRelay Workspace & Terminal State Persistence (WORKSPACE-PERSISTENCE-001)
 *
 * Implements versioned serialization, safe storage, and clean hydration of:
 * - LogicalWorkspace identity, name, rootPath, and active tab
 * - TerminalTab structure, pane layout topology, and active pane
 * - TerminalPane stable ordinal, accent, custom title, and lastKnownCwd
 * - Active Monitor surface tab (capture, changes, verification)
 *
 * CRITICAL ARCHITECTURAL BOUNDARIES:
 * - Persists logical UI/workspace state ONLY.
 * - NEVER persists live PTY handles, process PIDs, shell instances, or native handles.
 * - NEVER restores active VerificationRuntime (active verification states reconciled to clean restart status).
 * - NEVER trusts stale persisted repository branch/HEAD (re-detected on startup via detectRepositoryContext).
 * - Corrupted, invalid, or future schema versions degrade safely to default state without crashing.
 */

import type {
  LogicalWorkspace,
  LogicalWorkspaceId,
  TerminalTab,
  TerminalPane,
  PaneAccentId,
  TerminalTabColorKey,
  PanelLayoutNode,
  TerminalPanel,
  CapturePanel,
} from './types';
import { getAccentForOrdinal } from './types';
import { clampSplitRatio } from './panelLayoutTree';
import type { CaptureTargetScope } from '../transcript/captureTargetScope';
import { normalizeCaptureTargetScope } from '../transcript/captureTargetScope';
import {
  getTerminalTabBaseName,
  getTerminalTabColorKey,
  getNextTerminalTabColorKey,
  isTerminalTabColorKey,
  migrateLegacyTerminalTabBaseName,
} from './terminalTabName';
import {
  ensureWorkspaceVerificationState,
  reconcileWorkspaceVerificationState,
} from '../verification';
import type { WorkspaceVerificationState } from '../verification/verificationState';
import type { VerificationContract, VerificationRun } from '../verification/types';
import type { MonitorView } from '../shortcuts/types';
import type { TranscriptBlock } from '../transcript/types';

export const WORKSPACE_PERSISTENCE_STORAGE_KEY = 'execrelay:workspace-state:v1';
export const LEGACY_WORKSPACE_PERSISTENCE_STORAGE_KEY = 'tracerelay:workspace-state:v1';
export const WORKSPACE_PERSISTENCE_SCHEMA_VERSION = 1;
export const MAX_VERIFICATION_RUNS_PER_WORKSPACE = 50;
export const MAX_RETAINED_CAPTURE_BLOCKS = 100;
export const MAX_PERSISTED_CAPTURE_OUTPUT_CHARS = 100_000;
export const MAX_PERSISTED_CAPTURE_TOTAL_CHARS = 1_000_000;

export interface PersistedPaneV1 {
  id: string;
  stableOrdinal: number;
  accentId: PaneAccentId;
  customTitle?: string | null;
  lastKnownCwd?: string | null;
}

export interface PersistedTabV1 {
  id: string;
  baseName?: string;
  colorKey?: TerminalTabColorKey;
  name?: string;
  label?: string;
  activePaneId: string;
  isCapturePanelOpen?: boolean;
  capturePanelWidth?: number;
  panes: PersistedPaneV1[];
  panelLayout?: PanelLayoutNode;
}

export interface PersistedWorkspaceCaptureV1 {
  blocks: TranscriptBlock[];
  targetScope?: CaptureTargetScope;
}

export interface PersistedWorkspaceVerificationV1 {
  contracts: VerificationContract[];
  activeContractId: string | null;
  runs?: VerificationRun[];
  selectedCriterionIds?: string[];
}

export interface PersistedWorkspaceV1 {
  id: string;
  name: string;
  rootPath?: string | null;
  activeTerminalTabId: string;
  terminalTabs: PersistedTabV1[];
  capture?: PersistedWorkspaceCaptureV1;
  verification?: PersistedWorkspaceVerificationV1;
}

export interface PersistedWorkspaceStateV1 {
  schemaVersion: 1;
  activeWorkspaceId: string;
  activeMonitorView?: MonitorView;
  workspaces: PersistedWorkspaceV1[];
}

export interface HydratedWorkspaceState {
  workspaces: LogicalWorkspace[];
  activeWorkspaceId: LogicalWorkspaceId;
  activeMonitorView?: MonitorView;
}

/**
 * Storage adapter interface for pluggable test/headless and native desktop environments.
 */
export interface WorkspaceStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let customStorageAdapter: WorkspaceStorageAdapter | null = null;

export function setWorkspaceStorageAdapter(adapter: WorkspaceStorageAdapter | null): void {
  customStorageAdapter = adapter;
}

function getStorage(): WorkspaceStorageAdapter | null {
  if (customStorageAdapter) {
    return customStorageAdapter;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

/**
 * Serializes runtime workspaces state into the canonical versioned DTO.
 * Explicitly strips all runtime handles, session IDs, process references,
 * and ephemeral stream/run states.
 */
export function serializeWorkspaceState(
  workspaces: LogicalWorkspace[],
  activeWorkspaceId: LogicalWorkspaceId,
  activeMonitorView?: MonitorView,
): PersistedWorkspaceStateV1 {
  const cleanWorkspaces: PersistedWorkspaceV1[] = workspaces.map((ws) => {
    const tabs: PersistedTabV1[] = ws.terminalTabs.map((tab) => {
      const baseName = getTerminalTabBaseName(tab);
      const panes: PersistedPaneV1[] = tab.panes.map((p) => ({
        id: p.id,
        stableOrdinal: p.stableOrdinal,
        accentId: p.accentId,
        customTitle: p.customTitle ?? null,
        lastKnownCwd: p.lastKnownCwd ?? p.session?.sessionInfo?.cwd ?? null,
      }));

      return {
        id: tab.id,
        baseName,
        colorKey: getTerminalTabColorKey(tab),
        name: baseName,
        label: baseName,
        activePaneId: tab.activePaneId,
        isCapturePanelOpen: tab.isCapturePanelOpen,
        capturePanelWidth: tab.capturePanelWidth,
        panes,
        panelLayout: tab.panelLayout,
      };
    });

    // HISTORY-024C: Evidence Retention V1 & Referential Integrity
    let candidateRuns: VerificationRun[] = [];
    if (
      ws.verification &&
      Array.isArray(ws.verification.contracts) &&
      ws.verification.contracts.length > 0 &&
      Array.isArray(ws.verification.runs)
    ) {
      candidateRuns = ws.verification.runs.slice(-MAX_VERIFICATION_RUNS_PER_WORKSPACE);
    }

    const getReferencedExecutionIds = (runs: VerificationRun[]): Set<string> => {
      const ids = new Set<string>();
      for (const r of runs) {
        for (const cr of r.criterionResults ?? []) {
          if (cr.executionId) ids.add(cr.executionId);
        }
      }
      return ids;
    };

    const allCandidateBlocks =
      ws.capture && Array.isArray(ws.capture.blocks)
        ? ws.capture.blocks.filter(
            (b) =>
              b &&
              typeof b === 'object' &&
              typeof b.id === 'string' &&
              typeof b.command === 'string' &&
              b.command.trim().length > 0,
          )
        : [];

    const prepareBlockOutput = (b: TranscriptBlock): string => {
      let output = b.output ?? '';
      if (output.length > MAX_PERSISTED_CAPTURE_OUTPUT_CHARS) {
        const half = Math.floor(MAX_PERSISTED_CAPTURE_OUTPUT_CHARS / 2);
        const head = output.slice(0, half);
        const tail = output.slice(-half);
        output = `${head}\n\n... [Output truncated for storage limit: showing first ${half.toLocaleString()} and last ${half.toLocaleString()} of ${b.output.length.toLocaleString()} characters] ...\n\n${tail}`;
      }
      return output;
    };

    const getEstimatedChars = (b: TranscriptBlock): number => {
      const outLen = Math.min(b.output?.length ?? 0, MAX_PERSISTED_CAPTURE_OUTPUT_CHARS);
      return (b.command?.length ?? 0) + outLen + 300;
    };

    // Section 10D: If protected evidence exceeds storage budget, evict oldest runs first
    while (candidateRuns.length > 0) {
      const refIds = getReferencedExecutionIds(candidateRuns);
      const protectedBlocks = allCandidateBlocks.filter(
        (b) =>
          refIds.has(b.id) ||
          (b.executionId !== undefined && refIds.has(b.executionId)),
      );
      let protectedChars = 0;
      for (const b of protectedBlocks) {
        protectedChars += getEstimatedChars(b);
      }
      if (
        protectedBlocks.length <= MAX_RETAINED_CAPTURE_BLOCKS &&
        protectedChars <= MAX_PERSISTED_CAPTURE_TOTAL_CHARS
      ) {
        break;
      }
      // Evict oldest VerificationRun to satisfy budget
      candidateRuns.shift();
    }

    const finalRefIds = getReferencedExecutionIds(candidateRuns);
    const isProtected = (b: TranscriptBlock): boolean =>
      finalRefIds.has(b.id) ||
      (b.executionId !== undefined && finalRefIds.has(b.executionId));

    const protectedBlocks = allCandidateBlocks.filter(isProtected);
    const unreferencedBlocks = allCandidateBlocks.filter((b) => !isProtected(b));

    let protectedChars = 0;
    for (const b of protectedBlocks) {
      protectedChars += getEstimatedChars(b);
    }

    const remainingCountBudget = Math.max(
      0,
      MAX_RETAINED_CAPTURE_BLOCKS - protectedBlocks.length,
    );
    let remainingCharsBudget = Math.max(
      0,
      MAX_PERSISTED_CAPTURE_TOTAL_CHARS - protectedChars,
    );

    // Section 10C: Evict oldest unreferenced Capture history first
    const retainedUnreferenced: TranscriptBlock[] = [];
    for (let i = unreferencedBlocks.length - 1; i >= 0; i--) {
      if (retainedUnreferenced.length >= remainingCountBudget) break;
      const b = unreferencedBlocks[i];
      const est = getEstimatedChars(b);
      if (retainedUnreferenced.length > 0 && remainingCharsBudget - est < 0) {
        break;
      }
      remainingCharsBudget -= est;
      retainedUnreferenced.unshift(b);
    }

    const retainedIdSet = new Set<string>([
      ...protectedBlocks.map((b) => b.id),
      ...retainedUnreferenced.map((b) => b.id),
    ]);
    const blocksToSerialize = allCandidateBlocks.filter((b) =>
      retainedIdSet.has(b.id),
    );

    let capture: PersistedWorkspaceCaptureV1 | undefined = undefined;
    if (blocksToSerialize.length > 0) {
      const retainedBlocks: TranscriptBlock[] = blocksToSerialize.map((b) => {
        const output = prepareBlockOutput(b);
        return {
          id: b.id,
          batchId: b.batchId,
          command: b.command,
          rawCommand: b.rawCommand ?? b.command,
          output,
          rawOutput: b.rawOutput,
          startedAt: b.startedAt,
          completedAt: typeof b.completedAt === 'number' ? b.completedAt : null,
          isComplete: Boolean(b.isComplete),
          workspaceId: b.workspaceId ?? ws.id,
          terminalTabId: b.terminalTabId,
          terminalPaneId: b.terminalPaneId,
          terminalLabelAtCapture: b.terminalLabelAtCapture,
          sourcePaneId: b.sourcePaneId,
          sourcePaneOrdinal: b.sourcePaneOrdinal,
          sourcePaneAccentId: b.sourcePaneAccentId,
          cwd: b.cwd,
          exitCode: b.exitCode ?? null,
          lifecycle: b.lifecycle ?? (b.isComplete ? 'finished' : 'running'),
          outcome: b.outcome ?? 'unknown',
          completionSource: b.completionSource,
          outcomeSource: b.outcomeSource,
          outcomeTrusted: b.outcomeTrusted,
          shellIntegrationLevel: b.shellIntegrationLevel,
          hasError: b.hasError,
          hasDiagnosticError: b.hasDiagnosticError,
          structuredEvidence: b.structuredEvidence,
          attributionId: b.attributionId,
          agentRunId: b.agentRunId,
          agentExecutionLinkSource: b.agentExecutionLinkSource,
          verificationRunId: b.verificationRunId,
          verificationCriterionId: b.verificationCriterionId,
          executionId: b.executionId ?? b.id,
          type: b.type ?? 'command',
          intent: b.intent,
          actorId: b.actorId,
          executionSource: b.executionSource,
          executionState:
            b.executionState ?? (b.isComplete ? 'completed' : 'running'),
        };
      });

      capture = {
        blocks: retainedBlocks,
        targetScope: ws.capture?.targetScope,
      };
    } else if (ws.capture?.targetScope) {
      capture = {
        blocks: [],
        targetScope: ws.capture.targetScope,
      };
    }

    let verification: PersistedWorkspaceVerificationV1 | undefined = undefined;
    if (
      ws.verification &&
      Array.isArray(ws.verification.contracts) &&
      ws.verification.contracts.length > 0
    ) {
      verification = {
        contracts: ws.verification.contracts,
        activeContractId: ws.verification.activeContractId,
        runs: candidateRuns,
        selectedCriterionIds: ws.verification.selectedCriterionIds
          ? Array.from(ws.verification.selectedCriterionIds)
          : undefined,
      };
    }

    return {
      id: ws.id,
      name: ws.name,
      rootPath: ws.rootPath && ws.rootPath.trim().length > 0 ? ws.rootPath.trim() : null,
      activeTerminalTabId: ws.activeTerminalTabId,
      terminalTabs: tabs,
      capture,
      verification,
    };
  });

  const validActiveId =
    workspaces.some((w) => w.id === activeWorkspaceId)
      ? activeWorkspaceId
      : (workspaces[0]?.id ?? 'workspace-1');

  const validMonitorViews: MonitorView[] = [
    'capture-evidence',
    'changes',
    'verification',
  ];
  const safeActiveMonitorView =
    activeMonitorView && validMonitorViews.includes(activeMonitorView)
      ? activeMonitorView
      : undefined;

  return {
    schemaVersion: 1,
    activeWorkspaceId: validActiveId,
    activeMonitorView: safeActiveMonitorView,
    workspaces: cleanWorkspaces,
  };
}

/**
 * HARDENING-002: Recursively validates, sanitizes, and repairs a panel layout tree.
 * Guarantees:
 * - Cycle detection and immediate branch termination.
 * - Out-of-bounds / NaN split ratios clamped to [0.2, 0.8] via clampSplitRatio.
 * - Split direction normalized to 'horizontal' | 'vertical'.
 * - Stale panel leaves (nonexistent or duplicate) pruned and parent split nodes collapsed.
 * - Every valid terminal pane in the tab is represented in the resulting tree.
 * - Never throws; degrades safely to a single panel or auto-attached split tree.
 */
export function sanitizePanelLayout(
  rawLayout: unknown,
  validTerminalPanels: TerminalPanel[],
  capturePanel: CapturePanel,
  diagnostics?: string[],
): PanelLayoutNode {
  const allowedPanelIds = new Set<string>([
    ...validTerminalPanels.map((p) => p.id),
    capturePanel.id,
  ]);
  const visitedNodes = new Set<unknown>();
  const usedPanelIds = new Set<string>();

  function sanitizeNode(node: unknown): PanelLayoutNode | null {
    if (!node || typeof node !== 'object') {
      return null;
    }
    if (visitedNodes.has(node)) {
      diagnostics?.push('layout-cycle');
      return null;
    }
    visitedNodes.add(node);

    const n = node as Record<string, unknown>;
    if (n.type === 'panel') {
      if (typeof n.panelId !== 'string' || !allowedPanelIds.has(n.panelId)) {
        diagnostics?.push('stale-panel-leaf');
        return null;
      }
      if (usedPanelIds.has(n.panelId)) {
        diagnostics?.push('duplicate-panel-leaf');
        return null;
      }
      usedPanelIds.add(n.panelId);
      return {
        type: 'panel',
        panelId: n.panelId,
      };
    }

    if (n.type === 'split') {
      const sanitizedFirst = sanitizeNode(n.first);
      const sanitizedSecond = sanitizeNode(n.second);

      if (!sanitizedFirst && !sanitizedSecond) {
        diagnostics?.push('empty-split-node');
        return null;
      }
      if (!sanitizedFirst) {
        diagnostics?.push('collapsed-split-node');
        return sanitizedSecond;
      }
      if (!sanitizedSecond) {
        diagnostics?.push('collapsed-split-node');
        return sanitizedFirst;
      }

      const direction: 'horizontal' | 'vertical' =
        n.direction === 'vertical' ? 'vertical' : 'horizontal';
      const rawRatio = typeof n.ratio === 'number' ? n.ratio : 0.5;
      const ratio = clampSplitRatio(rawRatio);
      if (typeof n.ratio !== 'number' || n.ratio < 0.2 || n.ratio > 0.8) {
        diagnostics?.push('clamped-split-ratio');
      }
      const splitId =
        typeof n.id === 'string' && n.id.trim().length > 0
          ? n.id.trim()
          : `split-${Math.random().toString(36).slice(2, 9)}`;

      return {
        type: 'split',
        id: splitId,
        direction,
        ratio,
        first: sanitizedFirst,
        second: sanitizedSecond,
      };
    }

    return null;
  }

  let currentRoot = sanitizeNode(rawLayout);

  if (!currentRoot) {
    const firstPanel = validTerminalPanels[0] ?? {
      id: `panel-fallback`,
      kind: 'terminal',
      paneId: 'fallback',
      terminalSessionId: null,
    };
    currentRoot = {
      type: 'panel',
      panelId: firstPanel.id,
    };
    usedPanelIds.add(firstPanel.id);
    diagnostics?.push('fallback-panel-layout');
  }

  // Ensure every valid terminal panel is present in the layout
  for (const tp of validTerminalPanels) {
    if (!usedPanelIds.has(tp.id)) {
      currentRoot = {
        type: 'split',
        id: `split-auto-${tp.id}`,
        direction: 'horizontal',
        ratio: 0.5,
        first: currentRoot,
        second: {
          type: 'panel',
          panelId: tp.id,
        },
      };
      usedPanelIds.add(tp.id);
      diagnostics?.push('unrepresented-pane-attached');
    }
  }

  return currentRoot;
}

export interface WorkspaceStateRecoveryResult {
  state: HydratedWorkspaceState | null;
  diagnostics: string[];
}

/**
 * Validates, repairs, and hydrates a serialized state document into fresh runtime workspace objects.
 * Guarantees resilience against malformed, partial, stale, cyclic, or corrupted state.
 * Returns non-sensitive diagnostic tags for observed recovery issues.
 */
export function deserializeWorkspaceStateWithDiagnostics(raw: unknown): WorkspaceStateRecoveryResult {
  const diagnostics: string[] = [];

  if (!raw || typeof raw !== 'object') {
    diagnostics.push('invalid-root');
    return { state: null, diagnostics };
  }

  const candidate = raw as Record<string, unknown>;

  // Schema version validation: must be exact version 1 (B13: unknown future versions fail safely)
  if (candidate.schemaVersion !== WORKSPACE_PERSISTENCE_SCHEMA_VERSION) {
    console.warn(
      `[WorkspacePersistence] Unsupported schemaVersion: ${candidate.schemaVersion}. Safe fallback to default state.`,
    );
    diagnostics.push('unsupported-schema-version');
    return { state: null, diagnostics };
  }

  if (!Array.isArray(candidate.workspaces) || candidate.workspaces.length === 0) {
    diagnostics.push('empty-workspaces');
    return { state: null, diagnostics };
  }

  try {
    const hydratedWorkspaces: LogicalWorkspace[] = [];
    const seenWorkspaceIds = new Set<string>();

    for (let wsIdx = 0; wsIdx < candidate.workspaces.length; wsIdx++) {
      const rawWs = candidate.workspaces[wsIdx];
      if (!rawWs || typeof rawWs !== 'object') {
        diagnostics.push('invalid-workspace');
        continue;
      }
      const wsObj = rawWs as Record<string, unknown>;

      if (typeof wsObj.id !== 'string' || wsObj.id.trim().length === 0) {
        diagnostics.push('invalid-workspace');
        continue;
      }
      const id = wsObj.id.trim();

      if (seenWorkspaceIds.has(id)) {
        diagnostics.push('duplicate-workspace-id');
        continue;
      }
      seenWorkspaceIds.add(id);

      const name =
        typeof wsObj.name === 'string' && wsObj.name.trim().length > 0
          ? wsObj.name.trim()
          : 'Workspace';
      const rootPath =
        typeof wsObj.rootPath === 'string' && wsObj.rootPath.trim().length > 0
          ? wsObj.rootPath.trim()
          : undefined;

      const rawCapture =
        wsObj.capture && typeof wsObj.capture === 'object'
          ? (wsObj.capture as Record<string, unknown>)
          : null;
      const rawBlocks =
        rawCapture && Array.isArray(rawCapture.blocks)
          ? (rawCapture.blocks as TranscriptBlock[])
          : [];

      const hydratedBlocks: TranscriptBlock[] = [];
      for (const b of rawBlocks) {
        if (!b || typeof b !== 'object') continue;
        if (typeof b.id !== 'string' || typeof b.command !== 'string') continue;
        hydratedBlocks.push({
          ...b,
          isComplete: Boolean(b.isComplete),
          completedAt: typeof b.completedAt === 'number' ? b.completedAt : null,
          workspaceId: typeof b.workspaceId === 'string' ? b.workspaceId : id,
        });
      }

      const rawTabs = Array.isArray(wsObj.terminalTabs) ? wsObj.terminalTabs : [];
      const tabs: TerminalTab[] = [];
      const allWorkspacePanes: TerminalPane[] = [];
      const seenTabIds = new Set<string>();

      for (let tIdx = 0; tIdx < rawTabs.length; tIdx++) {
        const rawTab = rawTabs[tIdx];
        if (!rawTab || typeof rawTab !== 'object') {
          diagnostics.push('invalid-tab');
          continue;
        }
        const tabObj = rawTab as Record<string, unknown>;
        const tabId =
          typeof tabObj.id === 'string' && tabObj.id.trim().length > 0
            ? tabObj.id.trim()
            : `tab-${id}-${tIdx + 1}`;

        if (seenTabIds.has(tabId)) {
          diagnostics.push('duplicate-tab-id');
          continue;
        }
        seenTabIds.add(tabId);

        const persistedBaseName =
          typeof tabObj.baseName === 'string' &&
          tabObj.baseName.trim().length > 0
            ? tabObj.baseName
            : typeof tabObj.name === 'string' && tabObj.name.trim().length > 0
              ? tabObj.name
              : typeof tabObj.label === 'string' &&
                  tabObj.label.trim().length > 0
                ? tabObj.label
                : undefined;
        const tabBaseName = migrateLegacyTerminalTabBaseName(persistedBaseName);
        const tabColorKey = isTerminalTabColorKey(tabObj.colorKey)
          ? tabObj.colorKey
          : getNextTerminalTabColorKey(tabs);

        const rawPanes = Array.isArray(tabObj.panes) ? tabObj.panes : [];
        const tabPanes: TerminalPane[] = [];
        const seenPaneIds = new Set<string>();
        const seenOrdinals = new Set<number>();

        for (let pIdx = 0; pIdx < rawPanes.length; pIdx++) {
          const rawPane = rawPanes[pIdx];
          if (!rawPane || typeof rawPane !== 'object') {
            diagnostics.push('invalid-pane');
            continue;
          }
          const paneObj = rawPane as Record<string, unknown>;
          const paneId =
            typeof paneObj.id === 'string' && paneObj.id.trim().length > 0
              ? paneObj.id.trim()
              : `pane-${tabId}-${pIdx + 1}`;

          if (seenPaneIds.has(paneId)) {
            diagnostics.push('duplicate-pane-id');
            continue;
          }
          seenPaneIds.add(paneId);

          let stableOrdinal: number;
          if (
            typeof paneObj.stableOrdinal === 'number' &&
            paneObj.stableOrdinal >= 1 &&
            paneObj.stableOrdinal <= 6 &&
            !seenOrdinals.has(paneObj.stableOrdinal)
          ) {
            stableOrdinal = paneObj.stableOrdinal;
          } else {
            let nextAuto = 1;
            while (seenOrdinals.has(nextAuto) && nextAuto <= 6) {
              nextAuto++;
            }
            stableOrdinal = nextAuto <= 6 ? nextAuto : Math.min(6, tabPanes.length + 1);
            diagnostics.push('reassigned-pane-ordinal');
          }
          seenOrdinals.add(stableOrdinal);

          let accentId: PaneAccentId;
          if (
            typeof paneObj.accentId === 'string' &&
            ['blue', 'violet', 'emerald', 'amber', 'cyan', 'rose'].includes(
              paneObj.accentId,
            )
          ) {
            accentId = paneObj.accentId as PaneAccentId;
          } else {
            accentId = getAccentForOrdinal(stableOrdinal);
            if (paneObj.accentId !== undefined) {
              diagnostics.push('invalid-accent');
            }
          }

          const customTitle =
            typeof paneObj.customTitle === 'string' &&
            paneObj.customTitle.trim().length > 0
              ? paneObj.customTitle.trim()
              : null;
          const lastKnownCwd =
            typeof paneObj.lastKnownCwd === 'string' &&
            paneObj.lastKnownCwd.trim().length > 0
              ? paneObj.lastKnownCwd.trim()
              : null;

          const hasBlocksForThisPane = hydratedBlocks.some(
            (b) => b.terminalPaneId === paneId || b.sourcePaneId === paneId,
          );

          const freshPane: TerminalPane = {
            id: paneId,
            terminalTabId: tabId,
            stableOrdinal,
            accentId,
            customTitle,
            lastKnownCwd,
            session: {
              sessionId: null,
              status: 'starting',
              sessionInfo: null,
            },
            capture: {
              isListening: false,
              hasRetainedData: hasBlocksForThisPane,
              currentBatchId: null,
              sessionId: null,
              warning: null,
            },
            selection: {
              selectedBlockIds: new Set<string>(),
              updatedAt: 0,
            },
          };

          tabPanes.push(freshPane);
          allWorkspacePanes.push(freshPane);
        }

        // Ensure at least one pane exists per tab
        if (tabPanes.length === 0) {
          const fallbackPane: TerminalPane = {
            id: `pane-${tabId}-1`,
            terminalTabId: tabId,
            stableOrdinal: 1,
            accentId: 'blue',
            customTitle: null,
            lastKnownCwd: null,
            session: { sessionId: null, status: 'starting', sessionInfo: null },
            capture: {
              isListening: false,
              hasRetainedData: hydratedBlocks.length > 0,
              currentBatchId: null,
              sessionId: null,
              warning: null,
            },
            selection: { selectedBlockIds: new Set(), updatedAt: 0 },
          };
          tabPanes.push(fallbackPane);
          allWorkspacePanes.push(fallbackPane);
          diagnostics.push('empty-panes-fallback');
        }

        let activePaneId: string;
        if (
          typeof tabObj.activePaneId === 'string' &&
          tabPanes.some((p) => p.id === tabObj.activePaneId)
        ) {
          activePaneId = tabObj.activePaneId as string;
        } else {
          activePaneId = tabPanes[0].id;
          if (tabObj.activePaneId !== undefined) {
            diagnostics.push('stale-active-pane');
          }
        }

        const terminalPanels: TerminalPanel[] = tabPanes.map((p) => ({
          id: `panel-${p.id}`,
          kind: 'terminal',
          paneId: p.id,
          terminalSessionId: null,
        }));

        const validPaneIdSet = new Set(tabPanes.map((p) => p.id));
        let selectedCapturePaneIds: string[] = tabPanes.map((p) => p.id);
        const rawCapturePanel =
          tabObj.capturePanel && typeof tabObj.capturePanel === 'object'
            ? (tabObj.capturePanel as Record<string, unknown>)
            : null;
        if (rawCapturePanel && Array.isArray(rawCapturePanel.selectedCapturePaneIds)) {
          const filtered = rawCapturePanel.selectedCapturePaneIds.filter(
            (pId): pId is string => typeof pId === 'string' && validPaneIdSet.has(pId),
          );
          if (filtered.length > 0) {
            if (filtered.length !== rawCapturePanel.selectedCapturePaneIds.length) {
              diagnostics.push('stale-capture-target-pane');
            }
            selectedCapturePaneIds = filtered;
          }
        }

        const capturePanel: CapturePanel = {
          id: `capture-panel-${tabId}`,
          kind: 'capture',
          selectedCapturePaneIds,
          groupStatus: 'ready',
        };

        const panelLayout = sanitizePanelLayout(
          tabObj.panelLayout,
          terminalPanels,
          capturePanel,
          diagnostics,
        );

        const capturePanelWidth =
          typeof tabObj.capturePanelWidth === 'number' &&
          !Number.isNaN(tabObj.capturePanelWidth) &&
          tabObj.capturePanelWidth >= 100 &&
          tabObj.capturePanelWidth <= 2000
            ? tabObj.capturePanelWidth
            : 400;

        const freshTab: TerminalTab = {
          id: tabId,
          workspaceId: id,
          baseName: tabBaseName,
          colorKey: tabColorKey,
          label: tabBaseName,
          name: tabBaseName,
          terminalPanes: tabPanes,
          panes: tabPanes,
          panels: [...terminalPanels, capturePanel],
          capturePanelId: capturePanel.id,
          panelLayout,
          activeTerminalPaneId: activePaneId,
          activePaneId,
          nextTerminalPaneOrdinal: tabPanes.length + 1,
          paneIds: tabPanes.map((p) => p.id),
          rootPaneId: tabPanes[0].id,
          isCapturePanelOpen:
            typeof tabObj.isCapturePanelOpen === 'boolean'
              ? tabObj.isCapturePanelOpen
              : true,
          capturePanelWidth,
          pane: tabPanes[0].session,
          capture: tabPanes[0].capture,
        };

        tabs.push(freshTab);
      }

      // Ensure at least one tab exists per workspace
      if (tabs.length === 0) {
        const fallbackTabId = `tab-${id}-1`;
        const fallbackPaneId = `pane-${fallbackTabId}-1`;
        const fallbackPane: TerminalPane = {
          id: fallbackPaneId,
          terminalTabId: fallbackTabId,
          stableOrdinal: 1,
          accentId: 'blue',
          customTitle: null,
          lastKnownCwd: null,
          session: { sessionId: null, status: 'starting', sessionInfo: null },
          capture: {
            isListening: false,
            hasRetainedData: false,
            currentBatchId: null,
            sessionId: null,
            warning: null,
          },
          selection: { selectedBlockIds: new Set(), updatedAt: 0 },
        };
        const fallbackTerminalPanel: TerminalPanel = {
          id: `panel-${fallbackPaneId}`,
          kind: 'terminal',
          paneId: fallbackPaneId,
          terminalSessionId: null,
        };
        const fallbackCapturePanel: CapturePanel = {
          id: `capture-panel-${fallbackTabId}`,
          kind: 'capture',
          selectedCapturePaneIds: [fallbackPaneId],
        };
        const fallbackTab: TerminalTab = {
          id: fallbackTabId,
          workspaceId: id,
          baseName: 'Terminal',
          colorKey: 'emerald',
          label: 'Terminal',
          name: 'Terminal',
          terminalPanes: [fallbackPane],
          panes: [fallbackPane],
          panels: [fallbackTerminalPanel, fallbackCapturePanel],
          capturePanelId: fallbackCapturePanel.id,
          panelLayout: { type: 'panel', panelId: fallbackTerminalPanel.id },
          activeTerminalPaneId: fallbackPaneId,
          activePaneId: fallbackPaneId,
          nextTerminalPaneOrdinal: 2,
          paneIds: [fallbackPaneId],
          rootPaneId: fallbackPaneId,
          isCapturePanelOpen: true,
          capturePanelWidth: 400,
          pane: fallbackPane.session,
          capture: fallbackPane.capture,
        };
        tabs.push(fallbackTab);
        allWorkspacePanes.push(fallbackPane);
        diagnostics.push('empty-tabs-fallback');
      }

      let activeTerminalTabId: string;
      if (
        typeof wsObj.activeTerminalTabId === 'string' &&
        tabs.some((t) => t.id === wsObj.activeTerminalTabId)
      ) {
        activeTerminalTabId = wsObj.activeTerminalTabId as string;
      } else {
        activeTerminalTabId = tabs[0].id;
        if (wsObj.activeTerminalTabId !== undefined) {
          diagnostics.push('stale-active-tab');
        }
      }

      let initialVerification: WorkspaceVerificationState | undefined = undefined;
      if (wsObj.verification && typeof wsObj.verification === 'object') {
        const rawV = wsObj.verification as Record<string, unknown>;
        if (Array.isArray(rawV.contracts) && rawV.contracts.length > 0) {
          const rawContracts = rawV.contracts as VerificationContract[];
          const seenContractIds = new Set<string>();
          const contracts: VerificationContract[] = [];

          for (let cIdx = 0; cIdx < rawContracts.length; cIdx++) {
            const c = rawContracts[cIdx];
            if (!c || typeof c !== 'object') continue;
            const cId =
              typeof c.id === 'string' && c.id.trim().length > 0
                ? c.id.trim()
                : `contract-${cIdx + 1}`;

            if (seenContractIds.has(cId)) {
              diagnostics.push('duplicate-verification-contract-id');
              continue;
            }
            seenContractIds.add(cId);

            const seenCritIds = new Set<string>();
            const rawCriteria = Array.isArray(c.criteria) ? c.criteria : [];
            const criteria = [];
            for (let crIdx = 0; crIdx < rawCriteria.length; crIdx++) {
              const crit = rawCriteria[crIdx];
              if (!crit || typeof crit !== 'object') continue;
              const critId =
                typeof crit.id === 'string' && crit.id.trim().length > 0
                  ? crit.id.trim()
                  : `criterion-${crIdx + 1}`;

              if (seenCritIds.has(critId)) {
                diagnostics.push('duplicate-verification-criterion-id');
                continue;
              }
              seenCritIds.add(critId);

              const rawCrit = crit as unknown as Record<string, unknown>;
              const legacyCwd = typeof rawCrit.cwd === 'string' ? rawCrit.cwd.trim() : '';
              criteria.push({
                ...crit,
                id: critId,
                workingDirectory:
                  typeof crit.workingDirectory === 'string' &&
                  crit.workingDirectory.trim().length > 0
                    ? crit.workingDirectory.trim()
                    : legacyCwd.length > 0
                    ? legacyCwd
                    : '.',
              });
            }

            contracts.push({
              ...c,
              id: cId,
              criteria,
            });
          }

          if (contracts.length > 0) {
            let activeContractId = contracts[0].id;
            if (
              typeof rawV.activeContractId === 'string' &&
              contracts.some((c) => c.id === rawV.activeContractId)
            ) {
              activeContractId = rawV.activeContractId;
            } else if (rawV.activeContractId !== undefined) {
              diagnostics.push('stale-active-contract');
            }

            const rawRuns = Array.isArray(rawV.runs) ? (rawV.runs as VerificationRun[]) : [];
            const runs: VerificationRun[] = rawRuns.map((r) => ({
              ...r,
              criteriaSnapshot: (r.criteriaSnapshot ?? []).map((sc) => {
                const rawSc = sc as unknown as Record<string, unknown>;
                const legacyCwd = typeof rawSc.cwd === 'string' ? rawSc.cwd.trim() : '';
                return {
                  ...sc,
                  workingDirectory:
                    typeof sc.workingDirectory === 'string' &&
                    sc.workingDirectory.trim().length > 0
                      ? sc.workingDirectory.trim()
                      : legacyCwd.length > 0
                      ? legacyCwd
                      : '.',
                };
              }),
              criterionResults: Array.isArray(r.criterionResults) ? r.criterionResults : [],
            }));

            const allCritIds = new Set<string>(
              contracts.flatMap((c) => c.criteria.map((cr) => cr.id)),
            );
            let selectedCriterionIds: Set<string> | undefined = undefined;
            if (Array.isArray(rawV.selectedCriterionIds)) {
              const validSelected = rawV.selectedCriterionIds.filter(
                (cId): cId is string => typeof cId === 'string' && allCritIds.has(cId),
              );
              if (validSelected.length !== rawV.selectedCriterionIds.length) {
                diagnostics.push('stale-criterion-selection');
              }
              selectedCriterionIds = new Set<string>(validSelected);
            }

            if (rawV.activeRunId !== null && rawV.activeRunId !== undefined) {
              diagnostics.push('stripped-active-run');
            }

            initialVerification = {
              contracts,
              activeContractId,
              runs,
              activeRunId: null,
              selectedCriterionIds,
            };
          }
        }
      }

      const maxBatchId = hydratedBlocks.reduce(
        (max, b) => Math.max(max, b.batchId ?? 0),
        0,
      );

      const allMonitorablePaneIds = allWorkspacePanes.map((p) => p.id);
      const targetScope =
        rawCapture &&
        typeof rawCapture === 'object' &&
        (rawCapture as Record<string, unknown>).targetScope
          ? normalizeCaptureTargetScope(
              (rawCapture as Record<string, unknown>).targetScope as CaptureTargetScope,
              allMonitorablePaneIds,
            )
          : undefined;

      // Construct fresh LogicalWorkspace (B1: Clean runtime boundaries)
      const workspace: LogicalWorkspace = {
        id,
        name,
        rootPath,
        projectCwd: rootPath,
        repository: undefined,
        terminalTabs: tabs,
        activeTerminalTabId,
        panes: allWorkspacePanes,
        capture: {
          isListening: false,
          currentBatch: null,
          batchCounter: maxBatchId,
          blocks: hydratedBlocks,
          targetScope,
        },
        selection: {
          selectedBlockIds: new Set<string>(),
          updatedAt: 0,
        },
        terminalTabIds: tabs.map((t) => t.id),
        verification: initialVerification,
      };

      // HARDEN-012C / B16: Reconcile verification state so no active runtime is running
      const ensuredVerification = ensureWorkspaceVerificationState(workspace);
      const { workspace: reconciledWorkspace } =
        reconcileWorkspaceVerificationState({
          workspace: ensuredVerification,
          hasActiveRuntime: false,
          activeRunIdInRuntime: null,
          reconciliationReason:
            'Verification runtime was interrupted by application restart',
        });

      hydratedWorkspaces.push(reconciledWorkspace);
    }

    if (hydratedWorkspaces.length === 0) {
      diagnostics.push('no-valid-workspaces');
      return { state: null, diagnostics };
    }

    let activeWorkspaceId = hydratedWorkspaces[0].id;
    if (
      typeof candidate.activeWorkspaceId === 'string' &&
      hydratedWorkspaces.some((w) => w.id === candidate.activeWorkspaceId)
    ) {
      activeWorkspaceId = candidate.activeWorkspaceId as string;
    } else if (candidate.activeWorkspaceId !== undefined) {
      diagnostics.push('stale-active-workspace');
    }

    const validViews: MonitorView[] = [
      'capture-evidence',
      'changes',
      'verification',
    ];
    let activeMonitorView: MonitorView | undefined = undefined;
    if (typeof candidate.activeMonitorView === 'string') {
      if (validViews.includes(candidate.activeMonitorView as MonitorView)) {
        activeMonitorView = candidate.activeMonitorView as MonitorView;
      } else {
        activeMonitorView = 'capture-evidence';
        diagnostics.push('normalized-monitor-view');
      }
    }

    return {
      state: {
        workspaces: hydratedWorkspaces,
        activeWorkspaceId,
        activeMonitorView,
      },
      diagnostics,
    };
  } catch (err) {
    console.warn('[WorkspacePersistence] Error during state hydration:', err);
    diagnostics.push('hydration-exception');
    return { state: null, diagnostics };
  }
}

/**
 * Validates and hydrates a serialized state document into fresh runtime workspace objects.
 * Spawns NO live processes; creates clean initial PTY configurations and reconciled verification states.
 */
export function deserializeWorkspaceState(raw: unknown): HydratedWorkspaceState | null {
  return deserializeWorkspaceStateWithDiagnostics(raw).state;
}


/**
 * Loads persisted workspace state safely from local storage.
 * Fails safely on missing data, corrupt JSON, or schema mismatch without throwing.
 */
export function loadPersistedWorkspaceState(): HydratedWorkspaceState | null {
  try {
    const storage = getStorage();
    if (!storage) return null;

    let isLegacy = false;
    let raw = storage.getItem(WORKSPACE_PERSISTENCE_STORAGE_KEY);
    if (!raw) {
      raw = storage.getItem(LEGACY_WORKSPACE_PERSISTENCE_STORAGE_KEY);
      if (raw) {
        isLegacy = true;
      }
    }
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const hydrated = deserializeWorkspaceState(parsed);

    if (isLegacy && hydrated && hydrated.workspaces.length > 0) {
      try {
        const serialized = serializeWorkspaceState(
          hydrated.workspaces,
          hydrated.activeWorkspaceId,
          hydrated.activeMonitorView,
        );
        storage.setItem(
          WORKSPACE_PERSISTENCE_STORAGE_KEY,
          JSON.stringify(serialized),
        );
      } catch (err) {
        console.warn(
          '[WorkspacePersistence] Failed to write migrated workspace state:',
          err,
        );
      }
    }

    return hydrated;
  } catch (err) {
    console.warn('[WorkspacePersistence] Failed to read or parse persisted state:', err);
    return null;
  }
}

/**
 * Persists current workspace state atomically and boundedly.
 */
export function savePersistedWorkspaceState(state: {
  workspaces: LogicalWorkspace[];
  activeWorkspaceId: LogicalWorkspaceId;
  activeMonitorView?: MonitorView;
}): void {
  try {
    const storage = getStorage();
    if (!storage) return;

    const serialized = serializeWorkspaceState(
      state.workspaces,
      state.activeWorkspaceId,
      state.activeMonitorView,
    );
    storage.setItem(WORKSPACE_PERSISTENCE_STORAGE_KEY, JSON.stringify(serialized));
  } catch (err) {
    console.warn('[WorkspacePersistence] Failed to write workspace state:', err);
  }
}

/**
 * Clears saved workspace persistence state (reset to default).
 */
export function clearPersistedWorkspaceState(): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    storage.removeItem(WORKSPACE_PERSISTENCE_STORAGE_KEY);
    storage.removeItem(LEGACY_WORKSPACE_PERSISTENCE_STORAGE_KEY);
  } catch (err) {
    console.warn('[WorkspacePersistence] Failed to clear persisted state:', err);
  }
}
