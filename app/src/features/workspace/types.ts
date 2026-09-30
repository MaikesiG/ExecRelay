/**
 * LT-004B / LT-PANE-MODEL-001 Domain Model:
 * LogicalWorkspace -> TerminalTab -> TerminalPane
 *
 * Establishes explicit three-level domain ownership:
 * - LogicalWorkspace owns shared listening, shared capture batch, unified transcript timeline,
 *   shared selection set, and terminal tab membership.
 * - TerminalTab owns tab metadata and a one-pane layout container (paneIds, rootPaneId, activePaneId, paneLayout).
 * - TerminalPane owns independent PTY/shell session, independent xterm instance/scrollback,
 *   capture listening state, capture retained-data state, current batch identity, and selection set.
 */

import type {
  TerminalSessionInfo,
  TerminalSessionStatus,
} from '../terminal/types';
import type {
  CaptureBatch,
  TranscriptBlock,
  CaptureStatus,
} from '../transcript/types';
import { getCaptureStatus, deriveHasRetainedData } from '../transcript/types';

import type { CaptureWarning } from '../warnings/types';
import type { WorkspaceVerificationState } from '../verification/verificationState';

export type LogicalWorkspaceId = string;
export type TerminalTabId = string;
export type TerminalPaneId = string;

export type PanelKind = 'terminal' | 'capture';
export type SplitDirection = 'horizontal' | 'vertical';

export type PaneAccentId =
  | 'blue'
  | 'violet'
  | 'emerald'
  | 'amber'
  | 'cyan'
  | 'rose';

export const PANE_ACCENT_PALETTE: readonly PaneAccentId[] = [
  'blue',
  'violet',
  'emerald',
  'amber',
  'cyan',
  'rose',
] as const;

export function getAccentForOrdinal(ordinal: number): PaneAccentId {
  const index = (ordinal - 1) % PANE_ACCENT_PALETTE.length;
  return PANE_ACCENT_PALETTE[Math.max(0, index)];
}

export function getNextUnusedStableOrdinal(
  panes: ReadonlyArray<TerminalPane>,
): number {
  const used = new Set(panes.map((p) => p.stableOrdinal));
  for (let i = 1; i <= 6; i++) {
    if (!used.has(i)) {
      return i;
    }
  }
  return 6;
}

export interface TerminalPane {
  id: TerminalPaneId;
  terminalTabId: TerminalTabId;
  stableOrdinal: number; // 1 through 6; never renumber
  accentId: PaneAccentId;

  customTitle?: string | null;
  sessionTitle?: string | null;
  foregroundProcessTitle?: string | null;
  foregroundProcessName?: string | null;
  cwdLabel?: string | null;
  lastKnownCwd?: string | null;

  terminalSessionId?: string | null;
  session: {
    sessionId: string | null;
    status: TerminalSessionStatus;
    sessionInfo: TerminalSessionInfo | null;
  };

  capture: {
    isListening: boolean;
    hasRetainedData: boolean;
    currentBatchId: number | null;
    sessionId?: string | null;
    warning?: CaptureWarning | null;
  };

  selection: {
    selectedBlockIds: Set<string>;
    updatedAt: number;
  };
}

export interface TerminalPanel {
  id: string;
  kind: 'terminal';
  paneId: TerminalPaneId;
  terminalSessionId?: string | null;
}

export interface CapturePanel {
  id: string;
  kind: 'capture';
  selectedCapturePaneIds: TerminalPaneId[];
  groupStatus?: 'ready' | 'capturing' | 'paused' | 'error';
}

export type TabPanel = TerminalPanel | CapturePanel;

export interface PanelLeafNode {
  type: 'panel';
  panelId: string;
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: PanelLayoutNode;
  second: PanelLayoutNode;
}

export type PanelLayoutNode = PanelLeafNode | SplitNode;

export type PaneLayoutNode = {
  kind: 'pane';
  paneId: TerminalPaneId;
};

export type PaneLayoutDirection = 'horizontal' | 'vertical';

export interface TerminalTab {
  id: TerminalTabId;
  workspaceId: LogicalWorkspaceId;
  label: string;
  name?: string;

  terminalPanes: TerminalPane[];
  panes: TerminalPane[];
  panels: TabPanel[];

  capturePanelId: string;
  panelLayout: PanelLayoutNode;

  activeTerminalPaneId: TerminalPaneId;
  activePaneId: TerminalPaneId;

  nextTerminalPaneOrdinal: number;

  paneIds: TerminalPaneId[];
  rootPaneId: TerminalPaneId;
  paneLayoutDirection?: PaneLayoutDirection | null;
  paneSplitRatio?: number;
  paneLayout?: PaneLayoutNode;

  // Right-docked side panel state
  isCapturePanelOpen?: boolean;
  capturePanelWidth?: number;

  // Compatibility adapters for unmigrated UI/selectors
  pane?: {
    sessionId: string | null;
    status: TerminalSessionStatus;
    sessionInfo: TerminalSessionInfo | null;
  };

  capture?: {
    isListening: boolean;
    hasRetainedData?: boolean;
    currentBatchId?: number | null;
    sessionId?: string | null;
    warning?: CaptureWarning | null;
  };
}

export interface RepositoryContext {
  vcs: 'git';
  rootPath: string;
  branch?: string;
}

export interface LogicalWorkspace {
  id: LogicalWorkspaceId;
  name: string;

  rootPath?: string;
  repository?: RepositoryContext;

  terminalTabs: TerminalTab[];
  activeTerminalTabId: TerminalTabId;
  panes: TerminalPane[];

  capture: {
    isListening: boolean;
    currentBatch: CaptureBatch | null;
    batchCounter: number;
    blocks: TranscriptBlock[];
  };

  selection: {
    selectedBlockIds: Set<string>;
    updatedAt: number;
  };

  terminalTabIds: TerminalTabId[];

  verification?: WorkspaceVerificationState;

  repositorySnapshots?: import('../evidenceCollectors/types').RepositorySnapshot[];
  latestCollectionRun?: import('../evidenceCollectors/types').EvidenceCollectionRun;
  changeAttributions?: import('../attribution/types').ChangeAttribution[];
  agentRuns?: unknown[];
  activeAgentRunId?: string;
  projectCwd?: string;

  policyConfig?: unknown;
  policyAuditEvents?: unknown[];
}

export interface CaptureStatusLight {
  paneId: string;
  status: CaptureStatus;
}

export function getCaptureStatusLightsForTab(
  tabOrId: TerminalTab | TerminalTabId,
  context?:
    | {
        tabLookup?: (id: string) => TerminalTab | undefined;
        paneLookup?: (id: string) => TerminalPane | undefined;
        panes?: ReadonlyArray<TerminalPane>;
        blocks?: ReadonlyArray<TranscriptBlock>;
      }
    | ReadonlyArray<TranscriptBlock>,
): CaptureStatusLight[] {
  let tabLookup: ((id: string) => TerminalTab | undefined) | undefined;
  let paneLookup: ((id: string) => TerminalPane | undefined) | undefined;
  let panes: ReadonlyArray<TerminalPane> | undefined;
  let blocks: ReadonlyArray<TranscriptBlock> | undefined;

  if (Array.isArray(context)) {
    blocks = context;
  } else if (context && typeof context === 'object') {
    if ('tabLookup' in context) {
      tabLookup = context.tabLookup;
    }
    if ('paneLookup' in context) {
      paneLookup = context.paneLookup;
    }
    if ('panes' in context) {
      panes = context.panes;
    }
    if ('blocks' in context) {
      blocks = context.blocks;
    }
  }

  const tab =
    typeof tabOrId === 'string'
      ? tabLookup?.(tabOrId)
      : tabOrId;

  const targetPaneId =
    tab?.activePaneId ??
    tab?.paneIds?.[0] ??
    (typeof tabOrId === 'string' ? tabOrId : 'pane-1');

  const targetPane =
    paneLookup?.(targetPaneId) ??
    panes?.find((p) => p.id === targetPaneId);

  const isListening = Boolean(
    targetPane ? targetPane.capture.isListening : tab?.capture?.isListening,
  );
  const currentBatchId = targetPane
    ? targetPane.capture.currentBatchId
    : tab?.capture?.currentBatchId;
  const hasRetainedDataFallback = targetPane
    ? targetPane.capture.hasRetainedData
    : tab?.capture?.hasRetainedData;

  const tabBlocks =
    blocks !== undefined && tab !== undefined
      ? blocks.filter(
          (b: TranscriptBlock) =>
            (b.terminalPaneId && b.terminalPaneId === targetPaneId) ||
            b.terminalTabId === tab.id ||
            !b.terminalTabId,
        )
      : undefined;

  const hasRetainedData = deriveHasRetainedData(
    tabBlocks,
    currentBatchId,
    hasRetainedDataFallback,
  );

  const status = getCaptureStatus(isListening, hasRetainedData);

  return [
    {
      paneId: targetPaneId,
      status,
    },
  ];
}

export type WorkspaceId = LogicalWorkspaceId;
export type Workspace = LogicalWorkspace;

export type TerminalPaneState = TerminalPane;

export interface TerminalPaneTitleFields {
  customTitle?: string | null;
  sessionTitle?: string | null;
  foregroundProcessTitle?: string | null;
  foregroundProcessName?: string | null;
  cwdLabel?: string | null;
}

export function getTerminalPaneTitle(
  pane?: (Partial<TerminalPane> & TerminalPaneTitleFields) | null,
): string {
  return getTerminalPaneDisplayTitle(pane);
}

export function getTerminalPaneDisplayTitle(
  pane?: (Partial<TerminalPane> & TerminalPaneTitleFields) | null,
): string {
  if (!pane) return 'Terminal';

  const custom = pane.customTitle?.trim();
  if (custom) return custom;

  const candidates = [
    pane.sessionTitle,
    pane.foregroundProcessTitle,
    pane.foregroundProcessName,
    pane.cwdLabel,
    pane.session?.sessionInfo?.cwd
      ? (pane.session.sessionInfo.cwd.split('/').filter(Boolean).pop() ||
        pane.session.sessionInfo.cwd)
      : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return 'Terminal';
}
