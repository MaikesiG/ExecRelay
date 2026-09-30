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
  PanelLayoutNode,
  TerminalPanel,
  CapturePanel,
} from './types';
import { getAccentForOrdinal } from './types';
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
      const panes: PersistedPaneV1[] = tab.panes.map((p) => ({
        id: p.id,
        stableOrdinal: p.stableOrdinal,
        accentId: p.accentId,
        customTitle: p.customTitle ?? null,
        lastKnownCwd: p.lastKnownCwd ?? p.session?.sessionInfo?.cwd ?? null,
      }));

      return {
        id: tab.id,
        name: tab.name ?? tab.label,
        label: tab.label,
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

  return {
    schemaVersion: 1,
    activeWorkspaceId: validActiveId,
    activeMonitorView,
    workspaces: cleanWorkspaces,
  };
}

/**
 * Validates and hydrates a serialized state document into fresh runtime workspace objects.
 * Spawns NO live processes; creates clean initial PTY configurations and reconciled verification states.
 */
export function deserializeWorkspaceState(raw: unknown): HydratedWorkspaceState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;

  // Schema version validation: must be exact version 1 (B13: unknown future versions fail safely)
  if (candidate.schemaVersion !== WORKSPACE_PERSISTENCE_SCHEMA_VERSION) {
    console.warn(
      `[WorkspacePersistence] Unsupported schemaVersion: ${candidate.schemaVersion}. Safe fallback to default state.`,
    );
    return null;
  }

  if (!Array.isArray(candidate.workspaces) || candidate.workspaces.length === 0) {
    return null;
  }

  try {
    const hydratedWorkspaces: LogicalWorkspace[] = [];

    for (const rawWs of candidate.workspaces) {
      if (!rawWs || typeof rawWs !== 'object') continue;
      const wsObj = rawWs as Record<string, unknown>;

      const id =
        typeof wsObj.id === 'string' && wsObj.id.trim().length > 0
          ? wsObj.id.trim()
          : `workspace-${Date.now()}`;
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

      for (const rawTab of rawTabs) {
        if (!rawTab || typeof rawTab !== 'object') continue;
        const tabObj = rawTab as Record<string, unknown>;
        const tabId =
          typeof tabObj.id === 'string' && tabObj.id.trim().length > 0
            ? tabObj.id.trim()
            : `tab-${Date.now()}`;
        const tabName =
          typeof tabObj.name === 'string' && tabObj.name.trim().length > 0
            ? tabObj.name.trim()
            : 'Terminal 1';

        const rawPanes = Array.isArray(tabObj.panes) ? tabObj.panes : [];
        const tabPanes: TerminalPane[] = [];

        for (let pIdx = 0; pIdx < rawPanes.length; pIdx++) {
          const rawPane = rawPanes[pIdx];
          if (!rawPane || typeof rawPane !== 'object') continue;
          const paneObj = rawPane as Record<string, unknown>;
          const paneId =
            typeof paneObj.id === 'string' && paneObj.id.trim().length > 0
              ? paneObj.id.trim()
              : `pane-${tabId}-${pIdx + 1}`;
          const stableOrdinal =
            typeof paneObj.stableOrdinal === 'number' &&
            paneObj.stableOrdinal >= 1 &&
            paneObj.stableOrdinal <= 6
              ? paneObj.stableOrdinal
              : pIdx + 1;
          const accentId: PaneAccentId =
            typeof paneObj.accentId === 'string' &&
            ['blue', 'violet', 'emerald', 'amber', 'cyan', 'rose'].includes(
              paneObj.accentId,
            )
              ? (paneObj.accentId as PaneAccentId)
              : getAccentForOrdinal(stableOrdinal);
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
        }

        const activePaneId =
          typeof tabObj.activePaneId === 'string' &&
          tabPanes.some((p) => p.id === tabObj.activePaneId)
            ? (tabObj.activePaneId as string)
            : tabPanes[0].id;

        const terminalPanels: TerminalPanel[] = tabPanes.map((p) => ({
          id: `panel-${p.id}`,
          kind: 'terminal',
          paneId: p.id,
          terminalSessionId: null,
        }));

        const capturePanel: CapturePanel = {
          id: `capture-panel-${tabId}`,
          kind: 'capture',
          selectedCapturePaneIds: tabPanes.map((p) => p.id),
          groupStatus: 'ready',
        };

        const fallbackLayout: PanelLayoutNode = {
          type: 'panel',
          panelId: terminalPanels[0].id,
        };

        const panelLayout =
          tabObj.panelLayout && typeof tabObj.panelLayout === 'object'
            ? (tabObj.panelLayout as PanelLayoutNode)
            : fallbackLayout;

        const freshTab: TerminalTab = {
          id: tabId,
          workspaceId: id,
          label: tabName,
          name: tabName,
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
          capturePanelWidth:
            typeof tabObj.capturePanelWidth === 'number'
              ? tabObj.capturePanelWidth
              : 400,
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
          label: 'Terminal 1',
          name: 'Terminal 1',
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
      }

      const activeTerminalTabId =
        typeof wsObj.activeTerminalTabId === 'string' &&
        tabs.some((t) => t.id === wsObj.activeTerminalTabId)
          ? (wsObj.activeTerminalTabId as string)
          : tabs[0].id;

      let initialVerification: WorkspaceVerificationState | undefined = undefined;
      if (wsObj.verification && typeof wsObj.verification === 'object') {
        const rawV = wsObj.verification as Record<string, unknown>;
        if (Array.isArray(rawV.contracts) && rawV.contracts.length > 0) {
          const rawContracts = Array.isArray(rawV.contracts) ? (rawV.contracts as VerificationContract[]) : [];
          const contracts: VerificationContract[] = rawContracts.map((c) => ({
            ...c,
            criteria: (c.criteria ?? []).map((crit) => {
              const rawCrit = crit as unknown as Record<string, unknown>;
              const legacyCwd = typeof rawCrit.cwd === 'string' ? rawCrit.cwd.trim() : '';
              return {
                ...crit,
                workingDirectory:
                  typeof crit.workingDirectory === 'string' && crit.workingDirectory.trim().length > 0
                    ? crit.workingDirectory.trim()
                    : legacyCwd.length > 0
                    ? legacyCwd
                    : '.',
              };
            }),
          }));

          const activeContractId =
            typeof rawV.activeContractId === 'string' &&
            contracts.some((c) => c.id === rawV.activeContractId)
              ? rawV.activeContractId
              : contracts[0].id;

          const rawRuns = Array.isArray(rawV.runs) ? (rawV.runs as VerificationRun[]) : [];
          const runs: VerificationRun[] = rawRuns.map((r) => ({
            ...r,
            criteriaSnapshot: (r.criteriaSnapshot ?? []).map((sc) => {
              const rawSc = sc as unknown as Record<string, unknown>;
              const legacyCwd = typeof rawSc.cwd === 'string' ? rawSc.cwd.trim() : '';
              return {
                ...sc,
                workingDirectory:
                  typeof sc.workingDirectory === 'string' && sc.workingDirectory.trim().length > 0
                    ? sc.workingDirectory.trim()
                    : legacyCwd.length > 0
                    ? legacyCwd
                    : '.',
              };
            }),
          }));
          const selectedCriterionIds = Array.isArray(rawV.selectedCriterionIds)
            ? new Set<string>(
                rawV.selectedCriterionIds.filter(
                  (cId): cId is string => typeof cId === 'string',
                ),
              )
            : undefined;

          initialVerification = {
            contracts,
            activeContractId,
            runs,
            activeRunId: null,
            selectedCriterionIds,
          };
        }
      }

      const maxBatchId = hydratedBlocks.reduce(
        (max, b) => Math.max(max, b.batchId ?? 0),
        0,
      );

      // Construct fresh LogicalWorkspace (B1: Clean runtime boundaries)
      const workspace: LogicalWorkspace = {
        id,
        name,
        rootPath,
        projectCwd: rootPath,
        // Repository is intentionally unhydrated here; re-detected fresh on startup (B4)
        repository: undefined,
        terminalTabs: tabs,
        activeTerminalTabId,
        panes: allWorkspacePanes,
        capture: {
          isListening: false,
          currentBatch: null,
          batchCounter: maxBatchId,
          blocks: hydratedBlocks,
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
      return null;
    }

    const activeWorkspaceId =
      typeof candidate.activeWorkspaceId === 'string' &&
      hydratedWorkspaces.some((w) => w.id === candidate.activeWorkspaceId)
        ? (candidate.activeWorkspaceId as string)
        : hydratedWorkspaces[0].id;

    const validViews: MonitorView[] = [
      'capture-evidence',
      'changes',
      'verification',
      'agents',
      'governance',
    ];
    const activeMonitorView =
      typeof candidate.activeMonitorView === 'string' &&
      validViews.includes(candidate.activeMonitorView as MonitorView)
        ? (candidate.activeMonitorView as MonitorView)
        : undefined;

    return {
      workspaces: hydratedWorkspaces,
      activeWorkspaceId,
      activeMonitorView,
    };
  } catch (err) {
    console.warn('[WorkspacePersistence] Error during state hydration:', err);
    return null;
  }
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
