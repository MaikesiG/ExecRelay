import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { type TerminalPaneHandle } from './features/terminal/TerminalPane';
import { terminalRuntimeRegistry } from './features/terminal/terminalRuntimeRegistry';
import { terminalApi } from './features/terminal/terminalApi';
import {
  formatTranscriptBlock,
  normalizeCommand,
  isTerminalClearCommand,
  copyToClipboard,
} from './features/transcript/transcriptFormat';
import { detectErrorFromOutput } from './features/transcript/captureBlockModel';
import {
  createEvidenceBlock,
  evidenceBlocksFromTranscriptBlock,
  executionFromTranscriptBlock,
  DEFAULT_LOCAL_HUMAN_ACTOR,
  type ExecutionIntent,
} from './features/execution';
import {
  parseEngineeringEvidence,
  buildParseContext,
} from './features/structuredEvidence';
import {
  collectRepositoryEvidence,
  type RepositorySnapshot,
} from './features/evidenceCollectors';
import {
  createPendingAttribution,
  finalizeChangeAttribution,
} from './features/attribution';
import {
  createVerificationContract,
  createVerificationCriterion,
  createVerificationRun,
  createContinuationVerificationRun,
  evaluateCriterionResult,
  deriveVerificationRunStatus,
  getActiveVerificationContract,
  getWorkspaceContracts,
  getWorkspaceVerificationRuns,
  getLatestVerificationRun,
  getActiveVerificationRun,
  reconcileWorkspaceVerificationState,
  reconcileVerificationTeardown,
  appendVerificationRunToWorkspace,
  updateVerificationRunInWorkspace,
  setActiveVerificationContractInWorkspace,
  addVerificationContractToWorkspace,
  renameVerificationContractInWorkspace,
  deleteVerificationContractFromWorkspace,
  addCriterionToContractInWorkspace,
  updateCriterionInContractInWorkspace,
  deleteCriterionFromContractInWorkspace,
  reorderCriteriaInContractInWorkspace,
  getCanonicalVerificationSelection,
  toggleCriterionSelectionInWorkspace,
  selectAllCriteriaInWorkspace,
  clearCriteriaSelectionInWorkspace,
  clearWorkspaceVerificationRuns,
  isVerificationRuntimeActive,
  resolveVerificationWorkingDirectory,
  validateDirectoryExists,
  buildVerificationDispatchCommand,
  createDefaultWorkspaceVerificationState,
  ensureWorkspaceVerificationState,
  type VerificationRun,
  type VerificationCriterion,
  type VerificationCriterionResult,
} from './features/verification';
import {
  ProductEditionProvider,
  getEditionConfig,
  isMonitorViewEnabled,
} from './features/edition';
import {
  sanitizeTranscriptChunk,
  splitPromptTail,
  processInitialEcho,
} from './features/transcript/transcriptSanitization';
import type {
  TranscriptBlock,
  CaptureBatch,
  TranscriptFeedback,
  CaptureExecutionState,
  ExecutionLifecycle,
  ExecutionOutcome,
  ExecutionCompletionSource,
  ShellIntegrationLevel,
} from './features/transcript/types';
import type { ShellIntegrationEvent } from './features/terminal/shellIntegration';
import type {
  TerminalSessionInfo,
  TerminalSessionStatus,
} from './features/terminal/types';
import {
  createDefaultLogicalWorkspace,
  createDefaultTerminalTab,
  createDefaultTerminalPane,
  createPaneCaptureRuntime,
  cleanupPaneCaptureRuntime,
  getPaneCaptureRuntimeKey,
  splitPaneInWorkspaces,
  closePaneInWorkspaces,
  renameTerminalPaneInWorkspaces,
  setActivePaneInWorkspaces,
  resizePaneLayoutInWorkspaces,
  resizeSplitInWorkspaces,
  toggleCapturePanelInWorkspaces,
  setCapturePanelWidthInWorkspaces,
  getNextUnusedStableOrdinal,
  WorkspaceTabs,
  WorkspaceTabBar,
  WorkspaceDeleteModal,
  TerminalPaneLayout,
  useTerminalPaneKeybindings,
  type LogicalWorkspace,
  type LogicalWorkspaceId,
  type TerminalTab,
  type TerminalTabId,
  type TerminalPaneId,
  getCaptureGroupStatus,
  isPaneCaptureActive,
  getPaneCaptureCloseImpact,
  setActivePaneCaptureRuntimesRegistry,
  CloseCapturedPaneModal,
  type PaneCaptureCloseImpact,
  type CapturePanel,
  type PaneCaptureRuntime,
  type PaneCaptureRuntimeKey,
  type PanelLayoutTranscriptProps,
  openFolderPicker,
  detectRepositoryContext,
  resolveWorkspaceFolderBasename,
  bindWorkspaceRootPath,
  resolveWindowTitle,
  updateWindowTitle,
  type RepositoryContext,
  loadPersistedWorkspaceState,
  savePersistedWorkspaceState,
} from './features/workspace';
import {
  useGlobalShortcuts,
  ShortcutSettingsModal,
  defaultShortcutRegistry,
  type AppCommand,
  type MonitorView,
  type ActiveWorkspaceSurface,
} from './features/shortcuts';
import {
  type GlobalWarning,
  type CaptureWarning,
  type TerminalPaneToast,
  type TerminalPaneToastMessage,
  addGlobalWarning,
  dismissGlobalWarning,
  clearWorkspaceGlobalWarnings,
  setCaptureWarningInWorkspaces,
  dismissCaptureWarningInWorkspaces,
  clearCaptureWarningInWorkspaces,
  GlobalWarningBanner,
} from './features/warnings';

const MAX_RETAINED_SNAPSHOTS = 20;
const MAX_RETAINED_ATTRIBUTIONS = 50;

function App() {
  // WORKSPACE-PERSISTENCE-001 (B1, B2, B13): Hydrate persisted state on startup
  const [persistedSnapshot] = useState(() => loadPersistedWorkspaceState());

  // Domain Model: Top-level workspaces array and active workspace pointer
  // HARDEN-012C: App reload / startup verification reconciliation
  // Reconciles any stale runs left in non-terminal status when no live runtime exists
  // HARDEN-VERIFY-DELETE-018: Guarantees canonical verification state is initialized on startup
  const [workspaces, setWorkspaces] = useState<LogicalWorkspace[]>(() => {
    if (persistedSnapshot && persistedSnapshot.workspaces.length > 0) {
      return persistedSnapshot.workspaces;
    }
    const initial = [createDefaultLogicalWorkspace()];
    return initial.map((ws) => {
      const ensured = ensureWorkspaceVerificationState(ws);
      const { workspace: recWs } = reconcileWorkspaceVerificationState({
        workspace: ensured,
        hasActiveRuntime: false,
        activeRunIdInRuntime: null,
        reconciliationReason:
          'Verification runtime was interrupted by application restart',
      });
      return recWs;
    });
  });
  const [activeWorkspaceId, setActiveWorkspaceId] =
    useState<LogicalWorkspaceId>(() => {
      if (persistedSnapshot && persistedSnapshot.activeWorkspaceId) {
        const found = persistedSnapshot.workspaces.some(
          (w) => w.id === persistedSnapshot.activeWorkspaceId,
        );
        if (found) return persistedSnapshot.activeWorkspaceId;
      }
      return workspaces[0]?.id ?? 'workspace-1';
    });

  // Default workspace number tracking for non-colliding default names
  const nextWorkspaceNumberRef = useRef<number>(2);

  // Workspace delete confirmation modal state
  const [pendingDeleteWorkspaceId, setPendingDeleteWorkspaceId] =
    useState<LogicalWorkspaceId | null>(null);

  // Captured pane close confirmation modal state
  interface PendingCloseCapturedPane {
    workspaceId: string;
    terminalTabId: string;
    paneId: string;
    impact: PaneCaptureCloseImpact;
  }

  const [pendingCloseCapturedPane, setPendingCloseCapturedPane] =
    useState<PendingCloseCapturedPane | null>(null);

  // Synchronization refs to eliminate stale closures in high-frequency event handlers
  const workspacesRef = useRef<LogicalWorkspace[]>(workspaces);
  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const activeWorkspaceIdRef = useRef<LogicalWorkspaceId>(activeWorkspaceId);
  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  // HARDEN-009 / HARDEN-010: Surface Navigation & Keyboard Shortcuts
  const [activeSurface, setActiveSurface] = useState<ActiveWorkspaceSurface>({
    kind: 'terminal',
  });
  const [activeMonitorView, setActiveMonitorView] =
    useState<MonitorView>(() => persistedSnapshot?.activeMonitorView ?? 'capture-evidence');
  const [isMonitorFocused, setIsMonitorFocused] = useState<boolean>(false);
  const [isShortcutSettingsOpen, setIsShortcutSettingsOpen] =
    useState<boolean>(false);
  const [isShortcutRecorderActive, setIsShortcutRecorderActive] =
    useState<boolean>(false);
  const lastActiveTerminalPaneIdRef = useRef<string | null>(null);

  // WORKSPACE-PERSISTENCE-001 (B4): Re-detect repository context on startup from rootPath
  useEffect(() => {
    workspaces.forEach((ws) => {
      if (ws.rootPath && ws.rootPath.trim().length > 0) {
        detectRepositoryContext(ws.rootPath)
          .then((detectedRepo) => {
            if (detectedRepo) {
              setWorkspaces((prev) =>
                prev.map((w) =>
                  w.id === ws.id
                    ? {
                        ...w,
                        repository: detectedRepo,
                      }
                    : w,
                ),
              );
            }
          })
          .catch(() => {
            // Safe fallback: non-git / missing folder does not crash (B10, B11)
          });
      }
    });
    // Run once on initial startup mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WORKSPACE-PERSISTENCE-001 (B14, B17): Debounced persistence auto-save
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      savePersistedWorkspaceState({
        workspaces,
        activeWorkspaceId,
        activeMonitorView,
      });
      saveTimeoutRef.current = null;
    }, 400);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        // Synchronous final flush of the latest logical persisted snapshot during teardown (HISTORY-024C)
        savePersistedWorkspaceState({
          workspaces: workspacesRef.current,
          activeWorkspaceId: activeWorkspaceIdRef.current,
          activeMonitorView,
        });
      }
    };
  }, [workspaces, activeWorkspaceId, activeMonitorView]);

  // Immediate save on page/window unload
  useEffect(() => {
    const handleUnload = () => {
      savePersistedWorkspaceState({
        workspaces: workspacesRef.current,
        activeWorkspaceId: activeWorkspaceIdRef.current,
        activeMonitorView,
      });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleUnload);
      window.addEventListener('pagehide', handleUnload);
      return () => {
        window.removeEventListener('beforeunload', handleUnload);
        window.removeEventListener('pagehide', handleUnload);
      };
    }
  }, [activeMonitorView]);

  const ensureCapturePanelOpen = useCallback(() => {
    const ws = workspacesRef.current.find(
      (w) => w.id === activeWorkspaceIdRef.current,
    );
    if (!ws) return;
    const tab = ws.terminalTabs.find((t) => t.id === ws.activeTerminalTabId);
    if (tab && tab.isCapturePanelOpen === false) {
      setWorkspaces((prev) =>
        toggleCapturePanelInWorkspaces(prev, ws.id, tab.id),
      );
    }
  }, []);

  // Canonical Product Edition & Capability configuration (RELEASE-001)
  const editionConfig = useMemo(() => getEditionConfig(), []);
  const capabilities = editionConfig.capabilities;

  useEffect(() => {
    defaultShortcutRegistry.setCapabilities(capabilities);
  }, [capabilities]);

  useGlobalShortcuts({
    registry: defaultShortcutRegistry,
    isRecorderActive: isShortcutRecorderActive,
    isModalOpen:
      isShortcutSettingsOpen ||
      pendingDeleteWorkspaceId !== null ||
      pendingCloseCapturedPane !== null,
    onCommand: (command: AppCommand) => {
      switch (command) {
        case 'focus-terminal': {
          if (isMonitorFocused) {
            setIsMonitorFocused(false);
          }
          const ws = workspacesRef.current.find(
            (w) => w.id === activeWorkspaceIdRef.current,
          );
          const tab = ws?.terminalTabs.find(
            (t) => t.id === ws.activeTerminalTabId,
          );
          const targetPaneId =
            lastActiveTerminalPaneIdRef.current &&
            tab?.panes.some(
              (p) => p.id === lastActiveTerminalPaneIdRef.current,
            )
              ? lastActiveTerminalPaneIdRef.current
              : (tab?.activePaneId ?? tab?.panes[0]?.id);

          if (targetPaneId) {
            terminalRefs.current.get(targetPaneId)?.focus();
            setActiveSurface({ kind: 'terminal', paneId: targetPaneId });
          }
          break;
        }
        case 'focus-capture-evidence': {
          ensureCapturePanelOpen();
          setActiveMonitorView('capture-evidence');
          setActiveSurface({ kind: 'monitor', view: 'capture-evidence' });
          break;
        }
        case 'focus-changes': {
          ensureCapturePanelOpen();
          setActiveMonitorView('changes');
          setActiveSurface({ kind: 'monitor', view: 'changes' });
          break;
        }
        case 'focus-verification': {
          ensureCapturePanelOpen();
          setActiveMonitorView('verification');
          setActiveSurface({ kind: 'monitor', view: 'verification' });
          break;
        }
        case 'focus-agents': {
          if (!capabilities.agents) break;
          ensureCapturePanelOpen();
          setActiveMonitorView('agents');
          setActiveSurface({ kind: 'monitor', view: 'agents' });
          break;
        }
        case 'focus-governance': {
          if (!capabilities.governance) break;
          ensureCapturePanelOpen();
          setActiveMonitorView('governance');
          setActiveSurface({ kind: 'monitor', view: 'governance' });
          break;
        }
      }
    },
  });

  // Section 3 & 5: Active Verification Run ephemeral runtime state ref
  type VerificationRuntimeLifecycle =
    | 'running'
    | 'stopping'
    | 'stop-timeout'
    | 'cancelled'
    | 'completed';

  interface ActiveVerificationRuntime {
    workspaceId: string;
    terminalTabId: string;
    terminalPaneId: string;
    terminalSessionId?: string;
    targetSessionId?: string;
    runId: string;
    profileId: string;
    criteriaSnapshot: VerificationCriterion[];
    criterionResults: VerificationCriterionResult[];
    currentCriterionIndex: number;
    currentCriterionId: string;
    expectedCriterionId?: string;
    currentExecutionId?: string;
    expectedExecutionId?: string;
    lifecycle: VerificationRuntimeLifecycle;
    cancelled: boolean;
    beforeSnapshot?: RepositorySnapshot | null;
    stopRequestedAt?: number;
    advanceTimer?: ReturnType<typeof setTimeout> | null;
    stopFallbackTimer?: ReturnType<typeof setTimeout> | null;
    isProcessingCompletion?: boolean;
  }
  const [isVerificationStopping, setIsVerificationStopping] = useState(false);
  const [isVerificationStopTimeout, setIsVerificationStopTimeout] = useState(false);
  const verificationRuntimeRef = useRef<ActiveVerificationRuntime | null>(null);
  const executeVerificationCriterionRef = useRef<
    | ((
        workspaceId: string,
        terminalTabId: string,
        terminalPaneId: string,
        runId: string,
        criterion: VerificationCriterion,
      ) => Promise<void>)
    | null
  >(null);
  const handleVerificationExecutionCompletedRef = useRef<
    ((block: TranscriptBlock) => void) | null
  >(null);

  // Transient local UI presentation states
  const [copyHint, setCopyHint] = useState<string | null>(null);

  // Independent Notification Domain 3: Terminal Pane Toast (transient keyboard-command feedback)
  const [terminalPaneToast, setTerminalPaneToast] =
    useState<TerminalPaneToast | null>(null);
  const terminalPaneToastTimeoutRef = useRef<number | null>(null);

  const showTerminalPaneToast = useCallback(
    (message: TerminalPaneToastMessage) => {
      if (terminalPaneToastTimeoutRef.current !== null) {
        window.clearTimeout(terminalPaneToastTimeoutRef.current);
      }
      const toast: TerminalPaneToast = {
        id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message,
        createdAt: Date.now(),
      };
      setTerminalPaneToast(toast);
      terminalPaneToastTimeoutRef.current = window.setTimeout(() => {
        setTerminalPaneToast(null);
        terminalPaneToastTimeoutRef.current = null;
      }, 2500);
    },
    [],
  );

  // Local transcript action feedback (e.g. "Copied 1 block", "Transcript cleared")
  const [transcriptFeedback, setTranscriptFeedback] =
    useState<TranscriptFeedback | null>(null);
  const transcriptFeedbackTimeoutRef = useRef<number | null>(null);

  const showTranscriptFeedback = useCallback(
    (message: string, type: 'success' | 'error') => {
      if (transcriptFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(transcriptFeedbackTimeoutRef.current);
      }
      setTranscriptFeedback({ message, type });
      transcriptFeedbackTimeoutRef.current = window.setTimeout(() => {
        setTranscriptFeedback(null);
        transcriptFeedbackTimeoutRef.current = null;
      }, 2500);
    },
    [],
  );

  // Independent Notification Domain 1: Global Warnings (app or workspace scoped)
  const [globalWarnings, setGlobalWarnings] = useState<GlobalWarning[]>([]);

  const addGlobalWarningAction = useCallback((warning: GlobalWarning) => {
    setGlobalWarnings((prev) => addGlobalWarning(prev, warning));
  }, []);

  const dismissGlobalWarningAction = useCallback((warningId: string) => {
    setGlobalWarnings((prev) => dismissGlobalWarning(prev, warningId));
  }, []);

  const clearWorkspaceGlobalWarningsAction = useCallback(
    (workspaceId: string) => {
      setGlobalWarnings((prev) =>
        clearWorkspaceGlobalWarnings(prev, workspaceId),
      );
    },
    [],
  );

  // Independent Notification Domain 2: Capture Warnings (pane-scoped, owning capture session)
  const setCaptureWarningAction = useCallback(
    (
      workspaceId: string,
      terminalTabId: string,
      paneId: string,
      captureSessionId: string,
      warning: CaptureWarning,
    ) => {
      setWorkspaces((prev) =>
        setCaptureWarningInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          paneId,
          captureSessionId,
          warning,
        ),
      );
    },
    [],
  );

  const dismissCaptureWarningAction = useCallback(
    (
      workspaceId: string,
      terminalTabId: string,
      paneId: string,
      captureSessionId: string,
      warningId: string,
    ) => {
      setWorkspaces((prev) =>
        dismissCaptureWarningInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          paneId,
          captureSessionId,
          warningId,
        ),
      );
    },
    [],
  );

  const clearCaptureWarningAction = useCallback(
    (
      workspaceId: string,
      terminalTabId: string,
      paneId: string,
      captureSessionId?: string,
    ) => {
      setWorkspaces((prev) =>
        clearCaptureWarningInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          paneId,
          captureSessionId,
        ),
      );
    },
    [],
  );

  // Per-terminal-pane isolated ephemeral runtimes and handles
  const paneCaptureRuntimesRef = useRef<
    Map<PaneCaptureRuntimeKey, PaneCaptureRuntime>
  >(new Map());
  useEffect(() => {
    setActivePaneCaptureRuntimesRegistry(paneCaptureRuntimesRef.current);
  }, []);
  const terminalRefs = useRef<Map<TerminalPaneId, TerminalPaneHandle>>(
    new Map(),
  );

  const findPaneCaptureRuntime = useCallback(
    (
      workspaceId: string,
      terminalTabId: string,
      paneId: string,
    ): PaneCaptureRuntime | null => {
      const key = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, paneId);
      return paneCaptureRuntimesRef.current.get(key) ?? null;
    },
    [],
  );

  const getOrCreatePaneCaptureRuntime = useCallback(
    (
      workspaceId: LogicalWorkspaceId,
      terminalTabId: TerminalTabId,
      paneId: TerminalPaneId,
    ): PaneCaptureRuntime | null => {
      const workspace = workspacesRef.current.find(
        (w) => w.id === workspaceId,
      );
      if (!workspace) {
        return null;
      }
      const tab = workspace.terminalTabs.find(
        (t) => t.id === terminalTabId && t.workspaceId === workspaceId,
      );
      if (!tab || !tab.paneIds.includes(paneId)) return null;

      const key = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, paneId);
      let runtime = paneCaptureRuntimesRef.current.get(key);
      if (!runtime) {
        const paneOrdinal =
          tab.panes.find((p) => p.id === paneId)?.stableOrdinal ?? 1;
        runtime = createPaneCaptureRuntime(
          workspaceId,
          terminalTabId,
          paneId,
          paneOrdinal,
        );
        paneCaptureRuntimesRef.current.set(key, runtime);
      }
      return runtime;
    },
    [],
  );

  const cancelPendingFlush = useCallback(
    (
      workspaceId: string,
      terminalTabId?: string,
      paneId?: string,
    ) => {
      if (terminalTabId && paneId) {
        const key = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, paneId);
        const runtime = paneCaptureRuntimesRef.current.get(key);
        if (runtime && runtime.flushTimer !== null) {
          window.clearTimeout(runtime.flushTimer);
          runtime.flushTimer = null;
        }
        return;
      }
      const targetPaneId = workspaceId;
      for (const runtime of paneCaptureRuntimesRef.current.values()) {
        if (runtime.paneId === targetPaneId) {
          if (runtime.flushTimer !== null) {
            window.clearTimeout(runtime.flushTimer);
            runtime.flushTimer = null;
          }
        }
      }
    },
    [],
  );

  const updateWorkspace = useCallback(
    (
      workspaceId: LogicalWorkspaceId,
      updater: (workspace: LogicalWorkspace) => LogicalWorkspace,
    ) => {
      setWorkspaces((prev) => {
        const idx = prev.findIndex((w) => w.id === workspaceId);
        if (idx === -1) return prev;
        const target = prev[idx];
        const updated = updater(target);
        if (updated === target) return prev;
        const next = [...prev];
        next[idx] = updated;
        workspacesRef.current = next;
        return next;
      });
    },
    [],
  );

interface CreateWorkspaceOptions {
  name?: string;
  rootPath?: string;
  repository?: RepositoryContext;
  activate?: boolean;
}

  // Required Workspace Lifecycle & Management API
  const createWorkspace = useCallback(
    (options?: CreateWorkspaceOptions): LogicalWorkspace => {
      const nextNum = nextWorkspaceNumberRef.current;
      nextWorkspaceNumberRef.current += 1;
      const newWorkspaceId: LogicalWorkspaceId = `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newTabId: TerminalTabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newPaneId: TerminalPaneId = `pane-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const folderBasename = options?.rootPath
        ? resolveWorkspaceFolderBasename(options.rootPath)
        : null;
      const name = options?.name ?? folderBasename ?? `Workspace ${nextNum}`;

      const newPane = createDefaultTerminalPane(newTabId, newPaneId);
      const newTab = createDefaultTerminalTab(
        newTabId,
        newWorkspaceId,
        'Terminal 1',
        newPaneId,
        newPane,
      );
      const newWorkspace: LogicalWorkspace = {
        id: newWorkspaceId,
        name,
        rootPath: options?.rootPath,
        projectCwd: options?.rootPath,
        repository: options?.repository,
        terminalTabs: [newTab],
        activeTerminalTabId: newTabId,
        panes: [newPane],
        capture: {
          isListening: false,
          currentBatch: null,
          batchCounter: 0,
          blocks: [],
        },
        selection: {
          selectedBlockIds: new Set<string>(),
          updatedAt: 0,
        },
        terminalTabIds: [newTabId],
        verification: createDefaultWorkspaceVerificationState(newWorkspaceId),
      };

      const newRuntime = createPaneCaptureRuntime(
        newWorkspaceId,
        newTabId,
        newPaneId,
        1,
      );
      const runtimeKey = getPaneCaptureRuntimeKey(
        newWorkspaceId,
        newTabId,
        newPaneId,
      );
      paneCaptureRuntimesRef.current.set(runtimeKey, newRuntime);

      setWorkspaces((prev) => [...prev, newWorkspace]);
      if (options?.activate !== false) {
        setActiveWorkspaceId(newWorkspaceId);
      }

      return newWorkspace;
    },
    [],
  );

  const getWorkspace = useCallback(
    (workspaceId: LogicalWorkspaceId): LogicalWorkspace | null => {
      return workspacesRef.current.find((w) => w.id === workspaceId) ?? null;
    },
    [],
  );

  const getActiveWorkspace = useCallback((): LogicalWorkspace | null => {
    return (
      workspacesRef.current.find(
        (w) => w.id === activeWorkspaceIdRef.current,
      ) ?? null
    );
  }, []);

  const setActiveWorkspace = useCallback((workspaceId: LogicalWorkspaceId) => {
    const ws = workspacesRef.current.find((w) => w.id === workspaceId);
    if (!ws) return;
    if (terminalPaneToastTimeoutRef.current !== null) {
      window.clearTimeout(terminalPaneToastTimeoutRef.current);
      terminalPaneToastTimeoutRef.current = null;
    }
    setTerminalPaneToast(null);
    setActiveWorkspaceId(workspaceId);
  }, []);

  const renameWorkspace = useCallback(
    (workspaceId: LogicalWorkspaceId, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      const finalName = trimmed.slice(0, 40);
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === workspaceId ? { ...w, name: finalName } : w)),
      );
    },
    [],
  );

  const renameTerminalTab = useCallback(
    (
      workspaceId: string,
      terminalTabId: string,
      name: string,
    ) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const finalName = trimmed.slice(0, 40);
      setWorkspaces((prev) =>
        prev.map((ws) => {
          if (ws.id !== workspaceId) return ws;
          const tabExists = ws.terminalTabs.some((t) => t.id === terminalTabId);
          if (!tabExists) return ws;
          return {
            ...ws,
            terminalTabs: ws.terminalTabs.map((t) =>
              t.id === terminalTabId
                ? { ...t, label: finalName, name: finalName }
                : t,
            ),
          };
        }),
      );
    },
    [],
  );

  const handleRenameTerminalPane = useCallback(
    (
      workspaceId: string,
      terminalTabId: string,
      paneId: string,
      nextCustomTitle: string | null,
    ) => {
      setWorkspaces((prev) =>
        renameTerminalPaneInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          paneId,
          nextCustomTitle,
        ),
      );
    },
    [],
  );

  const splitPaneRight = useCallback(
    (workspaceId: string, terminalTabId: string, sourcePaneId: string) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;
      if (tab.panes.length >= 6) {
        showTerminalPaneToast('Maximum of 6 panes per terminal tab');
        return;
      }
      if (!tab.panes.some((p) => p.id === sourcePaneId)) return;

      const newPaneId: TerminalPaneId = `pane-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nextOrdinal = getNextUnusedStableOrdinal(tab.panes);
      const newPane = createDefaultTerminalPane(
        terminalTabId,
        newPaneId,
        nextOrdinal,
      );
      const newRuntime = createPaneCaptureRuntime(
        workspaceId,
        terminalTabId,
        newPaneId,
        nextOrdinal,
      );
      const runtimeKey = getPaneCaptureRuntimeKey(
        workspaceId,
        terminalTabId,
        newPaneId,
      );
      paneCaptureRuntimesRef.current.set(runtimeKey, newRuntime);

      setWorkspaces((prev) =>
        splitPaneInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          sourcePaneId,
          'horizontal',
          newPane,
        ),
      );

      setTimeout(() => {
        terminalRefs.current.get(newPaneId)?.focus();
      }, 50);
    },
    [showTerminalPaneToast],
  );

  const splitPaneDown = useCallback(
    (workspaceId: string, terminalTabId: string, sourcePaneId: string) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;
      if (tab.panes.length >= 6) {
        showTerminalPaneToast('Maximum of 6 panes per terminal tab');
        return;
      }
      if (!tab.panes.some((p) => p.id === sourcePaneId)) return;

      const newPaneId: TerminalPaneId = `pane-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nextOrdinal = getNextUnusedStableOrdinal(tab.panes);
      const newPane = createDefaultTerminalPane(
        terminalTabId,
        newPaneId,
        nextOrdinal,
      );
      const newRuntime = createPaneCaptureRuntime(
        workspaceId,
        terminalTabId,
        newPaneId,
        nextOrdinal,
      );
      const runtimeKey = getPaneCaptureRuntimeKey(
        workspaceId,
        terminalTabId,
        newPaneId,
      );
      paneCaptureRuntimesRef.current.set(runtimeKey, newRuntime);

      setWorkspaces((prev) =>
        splitPaneInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          sourcePaneId,
          'vertical',
          newPane,
        ),
      );

      setTimeout(() => {
        terminalRefs.current.get(newPaneId)?.focus();
      }, 50);
    },
    [showTerminalPaneToast],
  );

  const setActivePane = useCallback(
    (workspaceId: string, terminalTabId: string, paneId: string) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab || !tab.panes.some((p) => p.id === paneId)) return;

      const targetPane = tab.panes.find((p) => p.id === paneId);
      const targetIsListening = targetPane?.capture.isListening ?? false;

      setWorkspaces((prev) => {
        const next = setActivePaneInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          paneId,
        );
        const isCurrentActiveTab =
          workspaceId === activeWorkspaceIdRef.current &&
          terminalTabId === ws.activeTerminalTabId;

        if (!isCurrentActiveTab) return next;

        return next.map((w) =>
          w.id === workspaceId
            ? {
                ...w,
                capture: {
                  ...w.capture,
                  isListening: targetIsListening,
                },
              }
            : w,
        );
      });

      lastActiveTerminalPaneIdRef.current = paneId;
      setActiveSurface({ kind: 'terminal', paneId });
      terminalRefs.current.get(paneId)?.focus();
    },
    [],
  );

  const closePane = useCallback(
    (workspaceId: string, terminalTabId: string, paneId: string) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab || tab.panes.length <= 1) return;
      if (!tab.panes.some((p) => p.id === paneId)) return;

      // Section 26: If verification is targeting this pane, safely cancel and release runtime
      if (
        verificationRuntimeRef.current &&
        verificationRuntimeRef.current.workspaceId === workspaceId &&
        verificationRuntimeRef.current.terminalPaneId === paneId
      ) {
        const currentWs = workspacesRef.current.find((w) => w.id === workspaceId);
        if (currentWs) {
          const { workspace: updatedWs } = reconcileVerificationTeardown({
            workspace: currentWs,
            runtime: verificationRuntimeRef.current,
            targetWorkspaceId: workspaceId,
            targetPaneId: paneId,
            reason: 'Terminal pane was closed during verification',
          });
          updateWorkspace(workspaceId, () => updatedWs);
        }
        verificationRuntimeRef.current = null;
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);
        showTranscriptFeedback('Verification stopped: terminal pane was closed', 'error');
      }

      const runtimeKey = getPaneCaptureRuntimeKey(
        workspaceId,
        terminalTabId,
        paneId,
      );
      const runtime = paneCaptureRuntimesRef.current.get(runtimeKey);
      if (runtime) {
        cleanupPaneCaptureRuntime(runtime);
        paneCaptureRuntimesRef.current.delete(runtimeKey);
      }
      terminalRefs.current.delete(paneId);
      terminalRuntimeRegistry.dispose(paneId);

      let survivingPaneId: string | null = null;
      setWorkspaces((prev) => {
        const { workspaces: next, nextActivePaneId } = closePaneInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          paneId,
        );
        survivingPaneId = nextActivePaneId;

        const updatedWs = next.find((w) => w.id === workspaceId);
        if (!updatedWs) return next;
        const updatedTab = updatedWs.terminalTabs.find(
          (t) => t.id === terminalTabId,
        );
        if (!updatedTab) return next;

        const capturePanel = updatedTab.panels?.find(
          (p): p is CapturePanel => p.kind === 'capture',
        );

        const newGroupStatus = getCaptureGroupStatus(
          workspaceId,
          terminalTabId,
          capturePanel?.selectedCapturePaneIds,
          paneCaptureRuntimesRef.current,
        );

        const isGroupCapturing = newGroupStatus === 'capturing';

        const finalTabs = updatedWs.terminalTabs.map((t) => {
          if (t.id !== terminalTabId) return t;
          const updatedPanels = (t.panels ?? []).map((p) =>
            p.id === capturePanel?.id
              ? { ...p, groupStatus: newGroupStatus }
              : p,
          );
          return {
            ...t,
            panels: updatedPanels,
            capture: {
              ...t.capture,
              isListening: isGroupCapturing,
            },
          };
        });

        const isCurrentActiveTab =
          workspaceId === activeWorkspaceIdRef.current &&
          terminalTabId === ws.activeTerminalTabId;

        return next.map((w) => {
          if (w.id !== workspaceId) return w;
          return {
            ...w,
            terminalTabs: finalTabs,
            capture: {
              ...w.capture,
              isListening: isCurrentActiveTab
                ? isGroupCapturing
                : w.capture.isListening,
            },
          };
        });
      });

      const survivingPanes = tab.panes.filter((p) => p.id !== paneId);
      setTimeout(() => {
        for (const sp of survivingPanes) {
          terminalRefs.current.get(sp.id)?.refit();
        }
        if (survivingPaneId) {
          terminalRefs.current.get(survivingPaneId)?.focus();
        }
      }, 50);
    },
    [showTranscriptFeedback, updateWorkspace],
  );

  const confirmCloseCapturedPane = useCallback(
    (workspaceId: string, terminalTabId: string, paneId: string) => {
      // 1. Re-resolve the pane and its exact PaneCaptureRuntime.
      const currentWorkspaces = workspacesRef.current;
      const ws = currentWorkspaces.find((w) => w.id === workspaceId);
      if (!ws) {
        setPendingCloseCapturedPane(null);
        return;
      }
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) {
        setPendingCloseCapturedPane(null);
        return;
      }
      const targetPane = tab.panes.find((p) => p.id === paneId);
      // 2. Safely no-op if the pane no longer exists.
      if (!targetPane) {
        setPendingCloseCapturedPane(null);
        return;
      }

      if (tab.panes.length <= 1) {
        setPendingCloseCapturedPane(null);
        showTerminalPaneToast('Cannot close the last pane');
        return;
      }

      const runtimeKey = getPaneCaptureRuntimeKey(
        workspaceId,
        terminalTabId,
        paneId,
      );
      const runtime = paneCaptureRuntimesRef.current.get(runtimeKey);

      // 3. Safely close modal if Capture is no longer active.
      if (
        !runtime ||
        (runtime.status !== 'capturing' && runtime.status !== 'paused')
      ) {
        setPendingCloseCapturedPane(null);
        closePane(workspaceId, terminalTabId, paneId);
        return;
      }

      // 4. Finalize active transcript block only for the target runtime.
      let finalBlockOutput: string | undefined;
      let finalizedBlockId: string | null = null;
      const now = Date.now();

      if (runtime.activeBlockId && runtime.activeBlockParser) {
        finalizedBlockId = runtime.activeBlockId;
        finalBlockOutput = splitPromptTail(
          runtime.activeBlockParser.buffer,
        ).substantiveOutput;
      }

      // 5. Cancel only target runtime flush timer.
      cancelPendingFlush(workspaceId, terminalTabId, paneId);

      // 6. Clear only target runtime:
      //    activeBlockId, activeBlockParser, inputBuffer,
      //    decoder stream state as necessary, captureSessionId, captureGroupId, status
      const previousSessionId =
        runtime.captureSessionId ?? targetPane.capture.sessionId;

      runtime.activeBlockId = null;
      runtime.activeBlockParser = null;
      runtime.inputBuffer = '';
      runtime.textDecoder = new TextDecoder();
      runtime.captureSessionId = null;
      runtime.captureGroupId = null;
      runtime.status = 'idle';

      // 7. Clear only target pane/session Capture warning state.
      if (previousSessionId) {
        clearCaptureWarningAction(
          workspaceId,
          terminalTabId,
          paneId,
          previousSessionId,
        );
      } else {
        clearCaptureWarningAction(
          workspaceId,
          terminalTabId,
          paneId,
        );
      }

      // 9. Dispose target PTY/xterm/Capture runtime.
      if (
        verificationRuntimeRef.current &&
        verificationRuntimeRef.current.workspaceId === workspaceId &&
        verificationRuntimeRef.current.terminalPaneId === paneId
      ) {
        const currentWs = workspacesRef.current.find((w) => w.id === workspaceId);
        if (currentWs) {
          const { workspace: updatedWs } = reconcileVerificationTeardown({
            workspace: currentWs,
            runtime: verificationRuntimeRef.current,
            targetWorkspaceId: workspaceId,
            targetPaneId: paneId,
            reason: 'Terminal pane was closed during verification',
          });
          updateWorkspace(workspaceId, () => updatedWs);
        }
        verificationRuntimeRef.current = null;
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);
        showTranscriptFeedback('Verification stopped: terminal pane was closed', 'error');
      }

      cleanupPaneCaptureRuntime(runtime);
      paneCaptureRuntimesRef.current.delete(runtimeKey);
      terminalRefs.current.delete(paneId);
      terminalRuntimeRegistry.dispose(paneId);

      // 8. Remove paneId from CapturePanel.selectedCapturePaneIds.
      // 10. Remove target TerminalPane and TerminalPanel.
      // 11. Remove target leaf from panelLayout.
      // 12. Collapse redundant split nodes.
      // 13. Update activeTerminalPaneId if the removed pane was active.
      // 15. Recompute aggregate Capture state from surviving group runtimes.
      let survivingPaneId: string | null = null;
      let finalizedVerificationBlock: TranscriptBlock | null = null;
      setWorkspaces((prev) => {
        const currentWs = prev.find((w) => w.id === workspaceId);
        let updatedBlocks = currentWs?.capture.blocks ?? [];
        if (finalizedBlockId) {
          updatedBlocks = updatedBlocks.map((b) => {
            if (b.id === finalizedBlockId && !b.isComplete) {
              const updated = {
                ...b,
                ...(finalBlockOutput !== undefined
                  ? { output: finalBlockOutput }
                  : {}),
                completedAt: now,
                isComplete: true,
                lifecycle: 'interrupted' as ExecutionLifecycle,
                outcome: 'unknown' as ExecutionOutcome,
                executionState: 'interrupted' as CaptureExecutionState,
                completionSource: 'pane-close' as ExecutionCompletionSource,
              };
              finalizedVerificationBlock = updated;
              return updated;
            }
            return b;
          });
        }

        const { workspaces: next, nextActivePaneId } = closePaneInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          paneId,
        );
        survivingPaneId = nextActivePaneId;

        const updatedWs = next.find((w) => w.id === workspaceId);
        if (!updatedWs) return next;
        const updatedTab = updatedWs.terminalTabs.find(
          (t) => t.id === terminalTabId,
        );
        if (!updatedTab) return next;

        const capturePanel = updatedTab.panels?.find(
          (p): p is CapturePanel => p.kind === 'capture',
        );

        const newGroupStatus = getCaptureGroupStatus(
          workspaceId,
          terminalTabId,
          capturePanel?.selectedCapturePaneIds,
          paneCaptureRuntimesRef.current,
        );

        const isGroupCapturing = newGroupStatus === 'capturing';

        const finalTabs = updatedWs.terminalTabs.map((t) => {
          if (t.id !== terminalTabId) return t;
          const updatedPanels = (t.panels ?? []).map((p) =>
            p.id === capturePanel?.id
              ? { ...p, groupStatus: newGroupStatus }
              : p,
          );
          return {
            ...t,
            panels: updatedPanels,
            capture: {
              ...t.capture,
              isListening: isGroupCapturing,
            },
          };
        });

        const isCurrentActiveTab =
          workspaceId === activeWorkspaceIdRef.current &&
          terminalTabId === ws.activeTerminalTabId;

        return next.map((w) => {
          if (w.id !== workspaceId) return w;
          return {
            ...w,
            terminalTabs: finalTabs,
            capture: {
              ...w.capture,
              isListening: isCurrentActiveTab
                ? isGroupCapturing
                : w.capture.isListening,
              blocks: updatedBlocks,
            },
          };
        });
      });

      // 14. Refit surviving visible terminal panes.
      const survivingPanes = tab.panes.filter((p) => p.id !== paneId);
      setTimeout(() => {
        for (const sp of survivingPanes) {
          terminalRefs.current.get(sp.id)?.refit();
        }
        if (survivingPaneId) {
          terminalRefs.current.get(survivingPaneId)?.focus();
        }
      }, 50);

      // 16. Close modal.
      setPendingCloseCapturedPane(null);

      if (finalizedVerificationBlock) {
        handleVerificationExecutionCompletedRef.current?.(finalizedVerificationBlock);
      }
    },
    [
      cancelPendingFlush,
      clearCaptureWarningAction,
      closePane,
      showTerminalPaneToast,
      showTranscriptFeedback,
      updateWorkspace,
    ],
  );

  const requestCloseTerminalPane = useCallback(
    (workspaceId: string, terminalTabId: string, paneId: string) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;
      if (tab.panes.length <= 1) {
        showTerminalPaneToast('Cannot close the last pane');
        return;
      }
      if (!tab.panes.some((p) => p.id === paneId)) return;

      if (
        isPaneCaptureActive(
          workspaceId,
          terminalTabId,
          paneId,
          paneCaptureRuntimesRef.current,
        )
      ) {
        const impact = getPaneCaptureCloseImpact(
          workspaceId,
          terminalTabId,
          paneId,
          paneCaptureRuntimesRef.current,
          tab,
        );
        setPendingCloseCapturedPane({
          workspaceId,
          terminalTabId,
          paneId,
          impact,
        });
        return;
      }

      closePane(workspaceId, terminalTabId, paneId);
    },
    [closePane, showTerminalPaneToast],
  );

  const resizePaneLayout = useCallback(
    (workspaceId: string, terminalTabId: string, splitRatio: number) => {
      setWorkspaces((prev) =>
        resizePaneLayoutInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          splitRatio,
        ),
      );
    },
    [],
  );

  const resizeSplit = useCallback(
    (
      workspaceId: string,
      terminalTabId: string,
      splitId: string,
      splitRatio: number,
    ) => {
      setWorkspaces((prev) =>
        resizeSplitInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          splitId,
          splitRatio,
        ),
      );
    },
    [],
  );

  const handleToggleCapturePanel = useCallback(
    (workspaceId: string, terminalTabId: string) => {
      setWorkspaces((prev) =>
        toggleCapturePanelInWorkspaces(prev, workspaceId, terminalTabId),
      );
      setTimeout(() => {
        const ws = workspacesRef.current.find((w) => w.id === workspaceId);
        const tab = ws?.terminalTabs.find((t) => t.id === terminalTabId);
        if (tab) {
          for (const pane of tab.panes) {
            terminalRefs.current.get(pane.id)?.refit();
          }
        }
      }, 50);
    },
    [],
  );

  const handleResizeCaptureWidth = useCallback(
    (workspaceId: string, terminalTabId: string, width: number) => {
      setWorkspaces((prev) =>
        setCapturePanelWidthInWorkspaces(
          prev,
          workspaceId,
          terminalTabId,
          width,
        ),
      );
    },
    [],
  );

  const requestDeleteWorkspace = useCallback(
    (workspaceId: LogicalWorkspaceId) => {
      if (workspacesRef.current.length <= 1) return;
      setPendingDeleteWorkspaceId(workspaceId);
    },
    [],
  );

  const confirmDeleteWorkspace = useCallback(
    (workspaceId: LogicalWorkspaceId) => {
      const currentWorkspaces = workspacesRef.current;
      if (currentWorkspaces.length <= 1) {
        setPendingDeleteWorkspaceId(null);
        return;
      }
      const target = currentWorkspaces.find((w) => w.id === workspaceId);
      if (!target) {
        setPendingDeleteWorkspaceId(null);
        return;
      }

      let nextActiveId = activeWorkspaceIdRef.current;
      if (activeWorkspaceIdRef.current === workspaceId) {
        const currentIndex = currentWorkspaces.findIndex(
          (w) => w.id === workspaceId,
        );
        if (currentIndex + 1 < currentWorkspaces.length) {
          nextActiveId = currentWorkspaces[currentIndex + 1].id;
        } else if (currentIndex > 0) {
          nextActiveId = currentWorkspaces[currentIndex - 1].id;
        }
      }

      for (const tab of target.terminalTabs) {
        for (const pane of tab.panes) {
          const runtimeKey = getPaneCaptureRuntimeKey(
            workspaceId,
            tab.id,
            pane.id,
          );
          const runtime = paneCaptureRuntimesRef.current.get(runtimeKey);
          if (runtime) {
            cleanupPaneCaptureRuntime(runtime);
            paneCaptureRuntimesRef.current.delete(runtimeKey);
          }
          terminalRefs.current.delete(pane.id);
          terminalRuntimeRegistry.dispose(pane.id);
        }
      }

      setPendingDeleteWorkspaceId(null);

      if (
        verificationRuntimeRef.current &&
        verificationRuntimeRef.current.workspaceId === workspaceId
      ) {
        if (verificationRuntimeRef.current.advanceTimer) {
          clearTimeout(verificationRuntimeRef.current.advanceTimer);
        }
        if (verificationRuntimeRef.current.stopFallbackTimer) {
          clearTimeout(verificationRuntimeRef.current.stopFallbackTimer);
        }
        verificationRuntimeRef.current = null;
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);
      }

      if (nextActiveId !== activeWorkspaceIdRef.current) {
        setActiveWorkspaceId(nextActiveId);
      }

      setWorkspaces((prev) => prev.filter((w) => w.id !== workspaceId));
      clearWorkspaceGlobalWarningsAction(workspaceId);
    },
    [clearWorkspaceGlobalWarningsAction],
  );

  // Active workspace and pane resolution
  const activeWorkspace =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  // Dynamic desktop window title (TERMINAL-V01-UI-POLISH-001)
  useEffect(() => {
    const title = resolveWindowTitle(activeWorkspace);
    updateWindowTitle(title).catch(() => {});
  }, [activeWorkspace]);
  const activeTerminalTab = activeWorkspace
    ? activeWorkspace.terminalTabs.find(
        (t) =>
          t.id === activeWorkspace.activeTerminalTabId &&
          t.workspaceId === activeWorkspace.id,
      ) ?? null
    : null;
  const activeTerminalPane = activeTerminalTab && activeWorkspace
    ? activeWorkspace.panes.find(
        (p) =>
          p.id === activeTerminalTab.activePaneId &&
          p.terminalTabId === activeTerminalTab.id,
      ) ?? null
    : null;

  const handleClear = useCallback(() => {
    if (!activeTerminalPane) return;
    terminalRefs.current.get(activeTerminalPane.id)?.clear();
  }, [activeTerminalPane]);

  const handleCopy = useCallback(async () => {
    if (!activeTerminalPane) return;
    const activeTerminal = terminalRefs.current.get(activeTerminalPane.id);
    const success = await activeTerminal?.copySelection();
    if (!success) {
      setCopyHint('Select terminal text to copy.');
    } else {
      setCopyHint('Copied to clipboard');
    }
    setTimeout(() => {
      setCopyHint(null);
    }, 2500);
  }, [activeTerminalPane]);

  void handleClear;
  void handleCopy;
  void copyHint;
  void getWorkspace;
  void getActiveWorkspace;
  void addGlobalWarningAction;
  void setCaptureWarningAction;
  void clearCaptureWarningAction;

  useTerminalPaneKeybindings({
    activeWorkspaceId,
    workspaces,
    isModalOpen:
      pendingDeleteWorkspaceId !== null || pendingCloseCapturedPane !== null,
    onSplitRight: splitPaneRight,
    onSplitDown: splitPaneDown,
    onClosePane: requestCloseTerminalPane,
    onSetActivePane: setActivePane,
    showTerminalPaneToast,
  });

  const formatBlocksForCopy = (blocksToCopy: TranscriptBlock[]): string => {
    return blocksToCopy
      .map((b) => formatTranscriptBlock(b.command, b.output))
      .join('\n\n');
  };

  const handleSelectTerminalTab = useCallback(
    (tabId: TerminalTabId) => {
      if (!activeWorkspaceId) return;
      if (terminalPaneToastTimeoutRef.current !== null) {
        window.clearTimeout(terminalPaneToastTimeoutRef.current);
        terminalPaneToastTimeoutRef.current = null;
      }
      setTerminalPaneToast(null);
      updateWorkspace(activeWorkspaceId, (prev) => {
        if (prev.activeTerminalTabId === tabId) return prev;
        const targetTab = prev.terminalTabs.find((t) => t.id === tabId);
        const targetPane = targetTab
          ? prev.panes.find((p) => p.id === targetTab.activePaneId)
          : null;
        const targetIsListening =
          targetPane?.capture?.isListening ??
          targetTab?.capture?.isListening ??
          false;
        return {
          ...prev,
          activeTerminalTabId: tabId,
          capture: {
            ...prev.capture,
            isListening: targetIsListening,
          },
        };
      });
    },
    [activeWorkspaceId, updateWorkspace],
  );

  const handleCreateTerminalTab = useCallback(() => {
    if (!activeWorkspaceId) return;
    const ws = workspacesRef.current.find((w) => w.id === activeWorkspaceId);
    if (!ws) return;

    // Generate unique label: Terminal N, where N is not reused among currently open tabs in this workspace
    const existingLabels = new Set(ws.terminalTabs.map((t) => t.label));
    let nextN = 1;
    while (existingLabels.has(`Terminal ${nextN}`)) {
      nextN++;
    }
    const label = `Terminal ${nextN}`;
    const newTabId: TerminalTabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newPaneId: TerminalPaneId = `pane-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const newPane = createDefaultTerminalPane(newTabId, newPaneId, 1, 'blue');
    const newTab: TerminalTab = createDefaultTerminalTab(
      newTabId,
      ws.id,
      label,
      newPaneId,
      newPane,
    );

    const newRuntime = createPaneCaptureRuntime(ws.id, newTabId, newPaneId, 1);
    const runtimeKey = getPaneCaptureRuntimeKey(ws.id, newTabId, newPaneId);
    paneCaptureRuntimesRef.current.set(runtimeKey, newRuntime);

    updateWorkspace(ws.id, (prev) => ({
      ...prev,
      terminalTabs: [...prev.terminalTabs, newTab],
      terminalTabIds: [...prev.terminalTabIds, newTabId],
      panes: [...prev.panes, newPane],
      activeTerminalTabId: newTabId,
      capture: {
        ...prev.capture,
        isListening: false,
      },
    }));
  }, [activeWorkspaceId, updateWorkspace]);

  const handleCloseTerminalTab = useCallback(
    (tabId: TerminalTabId) => {
      if (!activeWorkspaceId) return;
      const ws = workspacesRef.current.find((w) => w.id === activeWorkspaceId);
      if (!ws) return;
      const currentTabs = ws.terminalTabs;

      // 1. Do nothing if it is the final terminal tab in active Workspace
      if (currentTabs.length <= 1) {
        return;
      }
      if (!currentTabs.some((t) => t.id === tabId)) {
        return;
      }

      const targetTab = currentTabs.find((t) => t.id === tabId);
      const targetPaneIds = targetTab?.paneIds ?? [];

      // Calculate next active tab before removal: right neighbor preferred, left fallback
      const currentIndex = currentTabs.findIndex((t) => t.id === tabId);
      let nextActiveTabId = ws.activeTerminalTabId;
      if (ws.activeTerminalTabId === tabId) {
        if (currentIndex + 1 < currentTabs.length) {
          nextActiveTabId = currentTabs[currentIndex + 1].id;
        } else if (currentIndex > 0) {
          nextActiveTabId = currentTabs[currentIndex - 1].id;
        }
      }

      // If verification is targeting this tab, safely cancel and release runtime
      if (
        verificationRuntimeRef.current &&
        verificationRuntimeRef.current.workspaceId === ws.id &&
        verificationRuntimeRef.current.terminalTabId === tabId
      ) {
        const { workspace: updatedWs } = reconcileVerificationTeardown({
          workspace: ws,
          runtime: verificationRuntimeRef.current,
          targetWorkspaceId: ws.id,
          targetTabId: tabId,
          reason: 'Terminal tab was closed during verification',
        });
        verificationRuntimeRef.current = null;
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);
        updateWorkspace(ws.id, () => updatedWs);
        showTranscriptFeedback('Verification stopped: terminal tab was closed', 'error');
      }

      // Cancel/cleanup only target TerminalPanes and runtimes
      for (const paneId of targetPaneIds) {
        const runtimeKey = getPaneCaptureRuntimeKey(ws.id, tabId, paneId);
        const runtime = paneCaptureRuntimesRef.current.get(runtimeKey);
        if (runtime) {
          cleanupPaneCaptureRuntime(runtime);
          paneCaptureRuntimesRef.current.delete(runtimeKey);
        }
        terminalRefs.current.delete(paneId);
        terminalRuntimeRegistry.dispose(paneId);
      }

      const nextActiveTab = currentTabs.find((t) => t.id === nextActiveTabId);
      const nextActivePane = nextActiveTab
        ? ws.panes.find((p) => p.id === nextActiveTab.activePaneId)
        : null;
      const nextIsListening =
        nextActivePane?.capture?.isListening ??
        nextActiveTab?.capture?.isListening ??
        false;

      updateWorkspace(ws.id, (prev) => ({
        ...prev,
        terminalTabs: prev.terminalTabs.filter((t) => t.id !== tabId),
        terminalTabIds: prev.terminalTabIds.filter((id) => id !== tabId),
        panes: prev.panes.filter((p) => !targetPaneIds.includes(p.id)),
        activeTerminalTabId: nextActiveTabId,
        capture: {
          ...prev.capture,
          isListening: nextIsListening,
        },
      }));
    },
    [activeWorkspaceId, updateWorkspace, showTranscriptFeedback],
  );

  const handleStartCaptureGroup = useCallback(
    (workspaceId: LogicalWorkspaceId, terminalTabId: TerminalTabId) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;

      const capturePanel = tab.panels?.find(
        (p): p is CapturePanel => p.kind === 'capture',
      );
      const validPaneIds = (capturePanel?.selectedCapturePaneIds ?? []).filter(
        (id) => tab.panes.some((p) => p.id === id),
      );

      if (validPaneIds.length === 0) {
        showTranscriptFeedback(
          'No terminal panes selected for capture.',
          'error',
        );
        return;
      }

      const nextBatchId = ws.capture.batchCounter + 1;
      const newBatch: CaptureBatch = {
        id: nextBatchId,
        startedAt: Date.now(),
        stoppedAt: null,
      };
      const captureGroupId = `cg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const selectedIdSet = new Set(validPaneIds);

      for (const paneId of validPaneIds) {
        const captureSessionId = `cs-${paneId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const runtime = getOrCreatePaneCaptureRuntime(
          workspaceId,
          terminalTabId,
          paneId,
        );
        if (runtime) {
          cancelPendingFlush(workspaceId, terminalTabId, paneId);
          runtime.captureGroupId = captureGroupId;
          runtime.captureSessionId = captureSessionId;
          runtime.status = 'capturing';
          runtime.currentBatch = newBatch;
          runtime.activeBlockId = null;
          runtime.activeBlockParser = null;
          runtime.inputBuffer = '';
          runtime.textDecoder = new TextDecoder();
        }
      }

      updateWorkspace(workspaceId, (prev) => {
        const updatedPanes = prev.panes.map((p) => {
          if (p.terminalTabId === terminalTabId && selectedIdSet.has(p.id)) {
            const key = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, p.id);
            const runtime = paneCaptureRuntimesRef.current.get(key);
            return {
              ...p,
              capture: {
                ...p.capture,
                isListening: true,
                hasRetainedData: true,
                currentBatchId: nextBatchId,
                sessionId: runtime?.captureSessionId ?? p.capture.sessionId,
                warning: null,
              },
            };
          }
          return p;
        });

        const updatedTabs = prev.terminalTabs.map((t) => {
          if (t.id !== terminalTabId) return t;
          const panel = t.panels?.find(
            (p): p is CapturePanel => p.kind === 'capture',
          );
          const updatedPanels = (t.panels ?? []).map((p) =>
            p.id === panel?.id
              ? {
                  ...p,
                  selectedCapturePaneIds: validPaneIds,
                  groupStatus: 'capturing' as const,
                }
              : p,
          );
          return {
            ...t,
            panels: updatedPanels,
            capture: {
              ...t.capture,
              isListening: true,
              hasRetainedData: true,
              currentBatchId: nextBatchId,
              warning: null,
            },
          };
        });

        return {
          ...prev,
          terminalTabs: updatedTabs,
          panes: updatedPanes,
          capture: {
            ...prev.capture,
            isListening: true,
            currentBatch: newBatch,
            batchCounter: nextBatchId,
          },
        };
      });
    },
    [
      cancelPendingFlush,
      getOrCreatePaneCaptureRuntime,
      showTranscriptFeedback,
      updateWorkspace,
    ],
  );

  const handlePauseCaptureGroup = useCallback(
    (workspaceId: LogicalWorkspaceId, terminalTabId: TerminalTabId) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;

      const capturePanel = tab.panels?.find(
        (p): p is CapturePanel => p.kind === 'capture',
      );
      const selectedIds = new Set(capturePanel?.selectedCapturePaneIds ?? []);

      const activeGroupRuntimes = tab.panes
        .filter((p) => selectedIds.has(p.id))
        .map((p) => findPaneCaptureRuntime(workspaceId, terminalTabId, p.id))
        .filter(
          (r): r is PaneCaptureRuntime =>
            r !== null && r.status === 'capturing',
        );

      if (activeGroupRuntimes.length === 0) return;

      const finalizedMap = new Map<string, string | undefined>();
      const now = Date.now();

      for (const r of activeGroupRuntimes) {
        cancelPendingFlush(workspaceId, terminalTabId, r.paneId);
        if (r.activeBlockId && r.activeBlockParser) {
          const out = splitPromptTail(r.activeBlockParser.buffer).substantiveOutput;
          finalizedMap.set(r.activeBlockId, out);
        }
        r.activeBlockId = null;
        r.activeBlockParser = null;
        r.inputBuffer = '';
        r.status = 'paused';
      }

      updateWorkspace(workspaceId, (prev) => {
        const updatedBlocks = prev.capture.blocks.map((b) => {
          if (finalizedMap.has(b.id) && !b.isComplete) {
            const out = finalizedMap.get(b.id);
            return {
              ...b,
              ...(out !== undefined ? { output: out } : {}),
              completedAt: now,
              isComplete: true,
              lifecycle: 'interrupted' as ExecutionLifecycle,
              outcome: 'unknown' as ExecutionOutcome,
              executionState: 'interrupted' as CaptureExecutionState,
              completionSource: 'capture-stop' as ExecutionCompletionSource,
            };
          }
          return b;
        });

        const updatedPanes = prev.panes.map((p) => {
          if (p.terminalTabId === terminalTabId && selectedIds.has(p.id)) {
            return {
              ...p,
              capture: {
                ...p.capture,
                isListening: false,
              },
            };
          }
          return p;
        });

        const updatedTabs = prev.terminalTabs.map((t) => {
          if (t.id !== terminalTabId) return t;
          const panel = t.panels?.find(
            (p): p is CapturePanel => p.kind === 'capture',
          );
          const updatedPanels = (t.panels ?? []).map((p) =>
            p.id === panel?.id ? { ...p, groupStatus: 'paused' as const } : p,
          );
          return {
            ...t,
            panels: updatedPanels,
            capture: {
              ...t.capture,
              isListening: false,
            },
          };
        });

        return {
          ...prev,
          terminalTabs: updatedTabs,
          panes: updatedPanes,
          capture: {
            ...prev.capture,
            isListening: false,
            blocks: updatedBlocks,
          },
        };
      });
    },
    [cancelPendingFlush, findPaneCaptureRuntime, updateWorkspace],
  );

  const handleResumeCaptureGroup = useCallback(
    (workspaceId: LogicalWorkspaceId, terminalTabId: TerminalTabId) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;

      const capturePanel = tab.panels?.find(
        (p): p is CapturePanel => p.kind === 'capture',
      );
      const selectedIds = new Set(capturePanel?.selectedCapturePaneIds ?? []);

      const pausedRuntimes = tab.panes
        .filter((p) => selectedIds.has(p.id))
        .map((p) => findPaneCaptureRuntime(workspaceId, terminalTabId, p.id))
        .filter(
          (r): r is PaneCaptureRuntime =>
            r !== null && r.status === 'paused',
        );

      if (pausedRuntimes.length === 0) return;

      for (const r of pausedRuntimes) {
        r.status = 'capturing';
        r.activeBlockId = null;
        r.activeBlockParser = null;
        r.inputBuffer = '';
      }

      updateWorkspace(workspaceId, (prev) => {
        const updatedPanes = prev.panes.map((p) => {
          if (p.terminalTabId === terminalTabId && selectedIds.has(p.id)) {
            return {
              ...p,
              capture: {
                ...p.capture,
                isListening: true,
              },
            };
          }
          return p;
        });

        const updatedTabs = prev.terminalTabs.map((t) => {
          if (t.id !== terminalTabId) return t;
          const panel = t.panels?.find(
            (p): p is CapturePanel => p.kind === 'capture',
          );
          const updatedPanels = (t.panels ?? []).map((p) =>
            p.id === panel?.id ? { ...p, groupStatus: 'capturing' as const } : p,
          );
          return {
            ...t,
            panels: updatedPanels,
            capture: {
              ...t.capture,
              isListening: true,
            },
          };
        });

        return {
          ...prev,
          terminalTabs: updatedTabs,
          panes: updatedPanes,
          capture: {
            ...prev.capture,
            isListening: true,
          },
        };
      });
    },
    [findPaneCaptureRuntime, updateWorkspace],
  );

  const handleStopCaptureGroup = useCallback(
    (workspaceId: LogicalWorkspaceId, terminalTabId: TerminalTabId) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;

      const capturePanel = tab.panels?.find(
        (p): p is CapturePanel => p.kind === 'capture',
      );
      const selectedIds = new Set(capturePanel?.selectedCapturePaneIds ?? []);

      const activeGroupRuntimes = tab.panes
        .filter((p) => selectedIds.has(p.id))
        .map((p) => findPaneCaptureRuntime(workspaceId, terminalTabId, p.id))
        .filter(
          (r): r is PaneCaptureRuntime =>
            r !== null && (r.status === 'capturing' || r.status === 'paused'),
        );

      const finalizedMap = new Map<string, string | undefined>();
      const now = Date.now();

      for (const r of activeGroupRuntimes) {
        cancelPendingFlush(workspaceId, terminalTabId, r.paneId);
        if (r.activeBlockId && r.activeBlockParser) {
          const out = splitPromptTail(r.activeBlockParser.buffer).substantiveOutput;
          finalizedMap.set(r.activeBlockId, out);
        }
        r.activeBlockId = null;
        r.activeBlockParser = null;
        r.inputBuffer = '';
        r.status = 'idle';
        r.captureSessionId = null;
        r.captureGroupId = null;
      }

      const stoppedBatch = ws.capture.currentBatch
        ? {
            ...ws.capture.currentBatch,
            stoppedAt: now,
          }
        : null;

      updateWorkspace(workspaceId, (prev) => {
        const updatedBlocks = prev.capture.blocks.map((b) => {
          if (finalizedMap.has(b.id) && !b.isComplete) {
            const out = finalizedMap.get(b.id);
            return {
              ...b,
              ...(out !== undefined ? { output: out } : {}),
              completedAt: now,
              isComplete: true,
              lifecycle: 'interrupted' as ExecutionLifecycle,
              outcome: 'unknown' as ExecutionOutcome,
              executionState: 'interrupted' as CaptureExecutionState,
              completionSource: 'capture-stop' as ExecutionCompletionSource,
            };
          }
          return b;
        });

        const nextSelected = new Set(prev.selection.selectedBlockIds);
        if (stoppedBatch) {
          for (const b of prev.capture.blocks) {
            if (b.batchId === stoppedBatch.id) {
              nextSelected.delete(b.id);
            }
          }
        }

        const updatedPanes = prev.panes.map((p) => {
          if (p.terminalTabId === terminalTabId && selectedIds.has(p.id)) {
            return {
              ...p,
              capture: {
                ...p.capture,
                isListening: false,
                sessionId: null,
                warning: null,
              },
            };
          }
          return p;
        });

        const updatedTabs = prev.terminalTabs.map((t) => {
          if (t.id !== terminalTabId) return t;
          const panel = t.panels?.find(
            (p): p is CapturePanel => p.kind === 'capture',
          );
          const updatedPanels = (t.panels ?? []).map((p) =>
            p.id === panel?.id ? { ...p, groupStatus: 'ready' as const } : p,
          );
          return {
            ...t,
            panels: updatedPanels,
            capture: {
              ...t.capture,
              isListening: false,
              warning: null,
            },
          };
        });

        return {
          ...prev,
          terminalTabs: updatedTabs,
          panes: updatedPanes,
          capture: {
            ...prev.capture,
            isListening: false,
            currentBatch: stoppedBatch,
            blocks: updatedBlocks,
          },
          selection: {
            selectedBlockIds: nextSelected,
            updatedAt: now,
          },
        };
      });
    },
    [cancelPendingFlush, findPaneCaptureRuntime, updateWorkspace],
  );

  const handleToggleListening = useCallback(
    (workspaceId: LogicalWorkspaceId, terminalTabId: TerminalTabId) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;
      const capturePanel = tab.panels?.find(
        (p): p is CapturePanel => p.kind === 'capture',
      );

      const status = getCaptureGroupStatus(
        workspaceId,
        terminalTabId,
        capturePanel?.selectedCapturePaneIds,
        paneCaptureRuntimesRef.current,
      );

      if (status === 'capturing') {
        handlePauseCaptureGroup(workspaceId, terminalTabId);
      } else if (status === 'paused') {
        handleResumeCaptureGroup(workspaceId, terminalTabId);
      } else {
        handleStartCaptureGroup(workspaceId, terminalTabId);
      }
    },
    [
      handlePauseCaptureGroup,
      handleResumeCaptureGroup,
      handleStartCaptureGroup,
    ],
  );

  const handleToggleSelectCapturePane = useCallback(
    (
      workspaceId: LogicalWorkspaceId,
      terminalTabId: TerminalTabId,
      paneId: TerminalPaneId,
    ) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;
      const capturePanel = tab.panels?.find(
        (p): p is CapturePanel => p.kind === 'capture',
      );

      const status = getCaptureGroupStatus(
        workspaceId,
        terminalTabId,
        capturePanel?.selectedCapturePaneIds,
        paneCaptureRuntimesRef.current,
      );
      if (status === 'capturing' || status === 'paused') {
        return;
      }

      updateWorkspace(workspaceId, (prev) => {
        const updatedTabs = prev.terminalTabs.map((t) => {
          if (t.id !== terminalTabId) return t;
          const panel = t.panels?.find(
            (p): p is CapturePanel => p.kind === 'capture',
          );
          if (!panel) return t;

          const currentSelected = new Set(panel.selectedCapturePaneIds ?? []);
          if (currentSelected.has(paneId)) {
            currentSelected.delete(paneId);
          } else {
            currentSelected.add(paneId);
          }

          const updatedPanels = (t.panels ?? []).map((p) =>
            p.id === panel.id
              ? {
                  ...p,
                  selectedCapturePaneIds: Array.from(currentSelected),
                }
              : p,
          );

          return {
            ...t,
            panels: updatedPanels,
          };
        });

        return {
          ...prev,
          terminalTabs: updatedTabs,
        };
      });
    },
    [updateWorkspace],
  );

  const handleSelectAllCapturePanes = useCallback(
    (
      workspaceId: LogicalWorkspaceId,
      terminalTabId: TerminalTabId,
      all: boolean,
    ) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;
      const capturePanel = tab.panels?.find(
        (p): p is CapturePanel => p.kind === 'capture',
      );

      const status = getCaptureGroupStatus(
        workspaceId,
        terminalTabId,
        capturePanel?.selectedCapturePaneIds,
        paneCaptureRuntimesRef.current,
      );
      if (status === 'capturing' || status === 'paused') {
        return;
      }

      updateWorkspace(workspaceId, (prev) => {
        const updatedTabs = prev.terminalTabs.map((t) => {
          if (t.id !== terminalTabId) return t;
          const panel = t.panels?.find(
            (p): p is CapturePanel => p.kind === 'capture',
          );
          if (!panel) return t;

          const allPaneIds = tab.panes.map((p) => p.id);
          const nextSelected = all ? allPaneIds : [];

          const updatedPanels = (t.panels ?? []).map((p) =>
            p.id === panel.id
              ? {
                  ...p,
                  selectedCapturePaneIds: nextSelected,
                }
              : p,
          );

          return {
            ...t,
            panels: updatedPanels,
          };
        });

        return {
          ...prev,
          terminalTabs: updatedTabs,
        };
      });
    },
    [updateWorkspace],
  );

  const handleRetryCapture = useCallback(
    (workspaceId: string, tabId: string, paneId: string) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === tabId);
      if (!tab) return;
      const targetPane = tab.panes.find((p) => p.id === paneId);
      if (!targetPane) return;

      const nextBatchId = ws.capture.batchCounter + 1;
      const newBatch: CaptureBatch = {
        id: nextBatchId,
        startedAt: Date.now(),
        stoppedAt: null,
      };
      const nextCaptureSessionId = `capture-${workspaceId}-${tabId}-${paneId}-${nextBatchId}`;

      const runtime = getOrCreatePaneCaptureRuntime(workspaceId, tabId, paneId);
      if (runtime) {
        cancelPendingFlush(workspaceId, tabId, paneId);
        runtime.activeBlockId = null;
        runtime.activeBlockParser = null;
        runtime.inputBuffer = '';
        runtime.status = 'capturing';
        runtime.captureSessionId = nextCaptureSessionId;
        runtime.currentBatch = newBatch;
      }

      updateWorkspace(workspaceId, (prev) => {
        const updatedPanes = prev.panes.map((p) =>
          p.id === paneId
            ? {
                ...p,
                capture: {
                  ...p.capture,
                  isListening: true,
                  hasRetainedData: true,
                  currentBatchId: nextBatchId,
                  sessionId: nextCaptureSessionId,
                  warning: null,
                },
              }
            : p,
        );

        const updatedTabs = prev.terminalTabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                capture: {
                  ...t.capture,
                  isListening: true,
                  hasRetainedData: true,
                  currentBatchId: nextBatchId,
                  sessionId: nextCaptureSessionId,
                  warning: null,
                },
              }
            : t,
        );

        return {
          ...prev,
          terminalTabs: updatedTabs,
          panes: updatedPanes,
          capture: {
            ...prev.capture,
            isListening: true,
            currentBatch: newBatch,
            batchCounter: nextBatchId,
          },
        };
      });
    },
    [cancelPendingFlush, getOrCreatePaneCaptureRuntime, updateWorkspace],
  );

  const handleToggleSelect = useCallback(
    (workspaceId: LogicalWorkspaceId, blockId: string) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const activeTabId = ws.activeTerminalTabId;
      const activeTab = ws.terminalTabs.find((t) => t.id === activeTabId);
      const activePaneId = activeTab?.activePaneId;

      updateWorkspace(workspaceId, (prev) => {
        const next = new Set(prev.selection.selectedBlockIds);
        if (next.has(blockId)) {
          next.delete(blockId);
        } else {
          next.add(blockId);
        }

        const updatedPanes = activePaneId
          ? prev.panes.map((p) =>
              p.id === activePaneId
                ? {
                    ...p,
                    selection: {
                      selectedBlockIds: next,
                      updatedAt: Date.now(),
                    },
                  }
                : p,
            )
          : prev.panes;

        return {
          ...prev,
          panes: updatedPanes,
          selection: {
            selectedBlockIds: next,
            updatedAt: Date.now(),
          },
        };
      });
    },
    [updateWorkspace],
  );

  const handleSelectAllVisible = useCallback(
    (workspaceId: LogicalWorkspaceId) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const activeTabId = ws.activeTerminalTabId;
      const activeTab = ws.terminalTabs.find((t) => t.id === activeTabId);
      const activePaneId = activeTab?.activePaneId;

      const tabBlockIds = ws.capture.blocks
        .filter(
          (b) =>
            (b.terminalPaneId && activePaneId && b.terminalPaneId === activePaneId) ||
            b.terminalTabId === activeTabId ||
            !b.terminalTabId,
        )
        .map((b) => b.id);

      updateWorkspace(workspaceId, (prev) => {
        const updatedPanes = activePaneId
          ? prev.panes.map((p) =>
              p.id === activePaneId
                ? {
                    ...p,
                    selection: {
                      selectedBlockIds: new Set(tabBlockIds),
                      updatedAt: Date.now(),
                    },
                  }
                : p,
            )
          : prev.panes;

        return {
          ...prev,
          panes: updatedPanes,
          selection: {
            selectedBlockIds: new Set(tabBlockIds),
            updatedAt: Date.now(),
          },
        };
      });
    },
    [updateWorkspace],
  );

  const handleClearSelection = useCallback(
    (workspaceId: LogicalWorkspaceId) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const activeTabId = ws.activeTerminalTabId;
      const activeTab = ws.terminalTabs.find((t) => t.id === activeTabId);
      const activePaneId = activeTab?.activePaneId;

      updateWorkspace(workspaceId, (prev) => {
        const updatedPanes = activePaneId
          ? prev.panes.map((p) =>
              p.id === activePaneId
                ? {
                    ...p,
                    selection: {
                      selectedBlockIds: new Set<string>(),
                      updatedAt: Date.now(),
                    },
                  }
                : p,
            )
          : prev.panes;

        return {
          ...prev,
          panes: updatedPanes,
          selection: {
            selectedBlockIds: new Set<string>(),
            updatedAt: Date.now(),
          },
        };
      });
    },
    [updateWorkspace],
  );

  const handleCopyBlock = useCallback(
    async (block: TranscriptBlock) => {
      const text = formatTranscriptBlock(block.command, block.output);
      const ok = await copyToClipboard(text);
      if (ok) {
        showTranscriptFeedback('Copied 1 block', 'success');
      } else {
        showTranscriptFeedback('Could not copy to the clipboard.', 'error');
      }
    },
    [showTranscriptFeedback],
  );

  const handleCopyCurrentBatch = useCallback(
    async (workspaceId: LogicalWorkspaceId) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const activeTabId = ws.activeTerminalTabId;
      const activeTab = ws.terminalTabs.find((t) => t.id === activeTabId);
      const activePane = activeTab
        ? ws.panes.find((p) => p.id === activeTab.activePaneId)
        : null;
      const batchId =
        activePane?.capture?.currentBatchId ??
        activeTab?.capture?.currentBatchId ??
        ws.capture.currentBatch?.id;
      if (!batchId) return;

      const currentBatchBlocks = ws.capture.blocks.filter(
        (b) =>
          b.batchId === batchId &&
          ((b.terminalPaneId && activePane && b.terminalPaneId === activePane.id) ||
            b.terminalTabId === activeTabId ||
            !b.terminalTabId),
      );
      if (currentBatchBlocks.length === 0) return;

      const text = formatBlocksForCopy(currentBatchBlocks);
      const ok = await copyToClipboard(text);
      if (ok) {
        const count = currentBatchBlocks.length;
        showTranscriptFeedback(
          count === 1 ? 'Copied 1 block' : `Copied ${count} blocks`,
          'success',
        );
      } else {
        showTranscriptFeedback('Could not copy to the clipboard.', 'error');
      }
    },
    [showTranscriptFeedback],
  );

  const handleCopySelected = useCallback(
    async (workspaceId: LogicalWorkspaceId) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;

      const activeTabId = ws.activeTerminalTabId;
      const activeTab = ws.terminalTabs.find((t) => t.id === activeTabId);
      const activePane = activeTab
        ? ws.panes.find((p) => p.id === activeTab.activePaneId)
        : null;

      const selectedBlocks = ws.capture.blocks.filter(
        (b) =>
          ws.selection.selectedBlockIds.has(b.id) &&
          ((b.terminalPaneId && activePane && b.terminalPaneId === activePane.id) ||
            b.terminalTabId === activeTabId ||
            !b.terminalTabId),
      );
      if (selectedBlocks.length === 0) return;

      const text = formatBlocksForCopy(selectedBlocks);
      const ok = await copyToClipboard(text);
      if (ok) {
        const count = selectedBlocks.length;
        showTranscriptFeedback(
          count === 1 ? 'Copied 1 block' : `Copied ${count} blocks`,
          'success',
        );
      } else {
        showTranscriptFeedback('Could not copy to the clipboard.', 'error');
      }
    },
    [showTranscriptFeedback],
  );

  const removeTranscriptBlocks = useCallback(
    (
      workspaceId: LogicalWorkspaceId,
      blockIdsToRemove: ReadonlySet<string>,
    ): number => {
      if (blockIdsToRemove.size === 0) return 0;
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return 0;

      for (const runtime of paneCaptureRuntimesRef.current.values()) {
        if (
          runtime.workspaceId === workspaceId &&
          runtime.activeBlockId !== null &&
          blockIdsToRemove.has(runtime.activeBlockId)
        ) {
          cancelPendingFlush(
            runtime.workspaceId,
            runtime.terminalTabId,
            runtime.paneId,
          );
          runtime.activeBlockId = null;
          runtime.activeBlockParser = null;
        }
      }

      // Section 10E: Audit manual Capture deletion.
      // If a Capture execution is referenced by a retained VerificationRun, do not silently delete it.
      const referencedExecutionIds = new Set<string>();
      for (const run of ws.verification?.runs ?? []) {
        for (const cr of run.criterionResults ?? []) {
          if (cr.executionId) {
            referencedExecutionIds.add(cr.executionId);
          }
        }
      }

      const hasReferencedBlock = ws.capture.blocks.some(
        (b) =>
          blockIdsToRemove.has(b.id) &&
          (referencedExecutionIds.has(b.id) ||
            (b.executionId !== undefined && referencedExecutionIds.has(b.executionId))),
      );

      if (hasReferencedBlock) {
        showTranscriptFeedback(
          'This execution is referenced by verification history.',
          'error',
        );
        return 0;
      }

      const currentBlocks = ws.capture.blocks;
      const removedCount = currentBlocks.filter((b) =>
        blockIdsToRemove.has(b.id),
      ).length;

      if (removedCount === 0) return 0;

      const nextBlocks = currentBlocks.filter(
        (b) => !blockIdsToRemove.has(b.id),
      );

      const remainingPaneIds = new Set(
        nextBlocks.map((b) => b.terminalPaneId).filter(Boolean),
      );
      const remainingTabIds = new Set(
        nextBlocks.map((b) => b.terminalTabId).filter(Boolean),
      );

      updateWorkspace(workspaceId, (prev) => {
        const nextSelected = new Set(prev.selection.selectedBlockIds);
        for (const id of blockIdsToRemove) {
          nextSelected.delete(id);
        }

        const updatedPanes = prev.panes.map((p) => {
          const hasBlocks =
            remainingPaneIds.has(p.id) ||
            remainingTabIds.has(p.terminalTabId);
          if (!hasBlocks && !p.capture.isListening) {
            return {
              ...p,
              capture: {
                ...p.capture,
                isListening: false,
                hasRetainedData: false,
                currentBatchId: null,
              },
            };
          }
          return p;
        });

        const updatedTabs = prev.terminalTabs.map((t) => {
          if (!remainingTabIds.has(t.id) && !t.capture?.isListening) {
            return {
              ...t,
              capture: {
                ...t.capture,
                isListening: false,
                hasRetainedData: false,
                currentBatchId: null,
              },
            };
          }
          return t;
        });

        return {
          ...prev,
          terminalTabs: updatedTabs,
          panes: updatedPanes,
          capture: {
            ...prev.capture,
            blocks: nextBlocks,
          },
          selection: {
            selectedBlockIds: nextSelected,
            updatedAt: Date.now(),
          },
        };
      });

      return removedCount;
    },
    [cancelPendingFlush, updateWorkspace, showTranscriptFeedback],
  );

  const handleDeleteBlock = useCallback(
    (workspaceId: LogicalWorkspaceId, blockId: string) => {
      const removed = removeTranscriptBlocks(workspaceId, new Set([blockId]));
      if (removed > 0) {
        showTranscriptFeedback('Block removed.', 'success');
      }
    },
    [removeTranscriptBlocks, showTranscriptFeedback],
  );

  const handleDeleteSelected = useCallback(
    (workspaceId: LogicalWorkspaceId) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const selectedIds = new Set(ws.selection.selectedBlockIds);
      if (selectedIds.size === 0) return;

      const removed = removeTranscriptBlocks(workspaceId, selectedIds);
      if (removed > 0) {
        showTranscriptFeedback(
          removed === 1 ? '1 block removed.' : `${removed} blocks removed.`,
          'success',
        );
      }
    },
    [removeTranscriptBlocks, showTranscriptFeedback],
  );

  // Terminal I/O & Lifecycle Handlers
  const handleTerminalInput = useCallback(
    (
      workspaceId: LogicalWorkspaceId,
      terminalTabId: TerminalTabId,
      terminalPaneId: TerminalPaneId,
      data: string,
      options?: {
        executionId?: string;
        intent?: ExecutionIntent;
        verificationRunId?: string;
        verificationCriterionId?: string;
        agentRunId?: string;
        agentExecutionLinkSource?: string;
      },
    ) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;

      const runtimeKey = getPaneCaptureRuntimeKey(
        workspaceId,
        terminalTabId,
        terminalPaneId,
      );
      const runtime = paneCaptureRuntimesRef.current.get(runtimeKey);
      if (!runtime || runtime.status !== 'capturing' || !runtime.currentBatch) {
        return;
      }

      // Section 12: Protect active verification pane from manual stdin corruption during command execution
      const activeVerification = verificationRuntimeRef.current;
      if (
        activeVerification &&
        activeVerification.workspaceId === workspaceId &&
        activeVerification.terminalPaneId === terminalPaneId &&
        activeVerification.expectedExecutionId &&
        options?.intent !== 'verification'
      ) {
        return;
      }

      for (let i = 0; i < data.length; i++) {
        const char = data[i];

        if (char === '\r' || char === '\n') {
          if (char === '\r' && i + 1 < data.length && data[i + 1] === '\n') {
            i++;
          }

          const rawCommand = runtime.inputBuffer;
          runtime.inputBuffer = '';

          const cleanCommand = normalizeCommand(rawCommand);

          // Clear is a terminal display reset, NOT a transcript or capture-history deletion.
          if (isTerminalClearCommand(cleanCommand)) {
            cancelPendingFlush(workspaceId, terminalTabId, terminalPaneId);

            const prevActiveId = runtime.activeBlockId;
            const prevParser = runtime.activeBlockParser;
            const now = Date.now();

            runtime.activeBlockId = null;
            runtime.activeBlockParser = null;

            // Finalize previous active block output if one was in flight
            if (prevActiveId && prevParser) {
              const prevFinalOutput = splitPromptTail(
                prevParser.buffer,
              ).substantiveOutput;

              const currentWs = workspacesRef.current.find(
                (w) => w.id === workspaceId,
              );
              const existingBlock = currentWs?.capture.blocks.find(
                (b) => b.id === prevActiveId,
              );

              const finalOut =
                prevFinalOutput !== undefined
                  ? prevFinalOutput
                  : existingBlock?.output ?? '';
              const errCheck = detectErrorFromOutput(finalOut);
              const outcome: ExecutionOutcome =
                existingBlock?.exitCode != null
                  ? existingBlock.exitCode === 0
                    ? 'succeeded'
                    : 'failed'
                  : 'unknown';
              const updated: TranscriptBlock = {
                ...(existingBlock ?? {
                  id: prevActiveId,
                  batchId: runtime.currentBatch.id,
                  command: prevParser.command,
                  rawCommand: prevParser.command,
                  startedAt: now,
                  type: 'command',
                  executionId: prevActiveId,
                  actorId: DEFAULT_LOCAL_HUMAN_ACTOR.id,
                  executionSource: 'terminal',
                  intent: 'interactive',
                  workspaceId,
                  terminalTabId,
                  terminalPaneId,
                  terminalLabelAtCapture: tab.label,
                }),
                output: finalOut,
                completedAt: now,
                isComplete: true,
                lifecycle: 'finished',
                outcome,
                executionState: (outcome === 'failed'
                  ? 'failed'
                  : 'completed') as CaptureExecutionState,
                completionSource:
                  existingBlock?.completionSource ?? 'capture-boundary',
                shellIntegrationLevel:
                  existingBlock?.shellIntegrationLevel ?? 'none',
                hasDiagnosticError: errCheck.isError,
                hasError: outcome === 'failed' || errCheck.isError,
              };
              const eb = evidenceBlocksFromTranscriptBlock(updated);
              updated.evidenceBlocks = eb;
              updated.evidenceBlockIds = eb.map((x) => x.id);
              const exec = executionFromTranscriptBlock(updated);
              const se = parseEngineeringEvidence(buildParseContext(exec, eb));
              updated.structuredEvidence = se.length > 0 ? se : undefined;
              exec.structuredEvidence = updated.structuredEvidence;

              updateWorkspace(workspaceId, (prev) => {
                const updatedBlocks = prev.capture.blocks.map((b) => {
                  if (b.id === prevActiveId && !b.isComplete) {
                    return updated;
                  }
                  return b;
                });

                return {
                  ...prev,
                  capture: {
                    ...prev.capture,
                    blocks: updatedBlocks,
                  },
                };
              });

              if (
                updated.intent === 'verification' ||
                verificationRuntimeRef.current?.expectedExecutionId === prevActiveId ||
                verificationRuntimeRef.current?.currentExecutionId === prevActiveId
              ) {
                handleVerificationExecutionCompletedRef.current?.(updated);
              }
            }

            continue;
          }

          // Do not create a block for blank Enter or pure cursor/control keystrokes
          if (cleanCommand.length > 0) {
            cancelPendingFlush(workspaceId, terminalTabId, terminalPaneId);

            const prevActiveId = runtime.activeBlockId;
            const prevParser = runtime.activeBlockParser;
            const now = Date.now();
            const batchId = runtime.currentBatch.id;
            const blockId =
              options?.executionId ??
              `block-${now}-${Math.random().toString(36).slice(2, 7)}`;

            const targetPane = tab.panes.find((p) => p.id === terminalPaneId);

            const newBlock: TranscriptBlock = {
              id: blockId,
              batchId,
              command: cleanCommand,
              rawCommand: rawCommand,
              output: '',
              startedAt: now,
              completedAt: null,
              isComplete: false,
              type: 'command',
              executionId: blockId,
              actorId: DEFAULT_LOCAL_HUMAN_ACTOR.id,
              executionSource: 'terminal',
              intent: options?.intent ?? 'interactive',
              verificationRunId: options?.verificationRunId,
              verificationCriterionId: options?.verificationCriterionId,
              agentRunId: options?.agentRunId,
              agentExecutionLinkSource: options?.agentExecutionLinkSource,
              executionState: 'running',
              lifecycle: 'running',
              outcome: 'unknown',
              completionSource: undefined,
              exitCode: null,
              hasError: false,
              hasDiagnosticError: false,
              evidenceBlockIds: [`${blockId}-cmd`],
              evidenceBlocks: [
                createEvidenceBlock({
                  id: `${blockId}-cmd`,
                  executionId: blockId,
                  type: 'command',
                  rawText: rawCommand,
                  displayText: cleanCommand,
                  createdAt: now,
                  cleanupApplied: rawCommand !== cleanCommand,
                }),
              ],
              workspaceId,
              terminalTabId,
              terminalPaneId,
              terminalLabelAtCapture: tab.label,
              sourcePaneId: terminalPaneId,
              sourcePaneOrdinal: targetPane?.stableOrdinal ?? 1,
              sourcePaneAccentId: targetPane?.accentId ?? 'blue',
              captureSessionId: runtime.captureSessionId ?? undefined,
              captureGroupId: runtime.captureGroupId ?? undefined,
            };

            runtime.activeBlockId = blockId;
            runtime.activeBlockParser = {
              command: cleanCommand,
              buffer: '',
              echoChecked: false,
            };

            const prevFinalOutput = prevParser
              ? splitPromptTail(prevParser.buffer).substantiveOutput
              : undefined;

            const currentWs = workspacesRef.current.find(
              (w) => w.id === workspaceId,
            );
            const existingBlock = prevActiveId
              ? currentWs?.capture.blocks.find((b) => b.id === prevActiveId)
              : null;

            let prevFinalizedBlock: TranscriptBlock | null = null;
            if (prevActiveId && prevParser) {
              const finalOut =
                prevFinalOutput !== undefined
                  ? prevFinalOutput
                  : existingBlock?.output ?? '';
              const errCheck = detectErrorFromOutput(finalOut);
              const outcome: ExecutionOutcome =
                existingBlock?.exitCode != null
                  ? existingBlock.exitCode === 0
                    ? 'succeeded'
                    : 'failed'
                  : 'unknown';
              const blockToFinalize: TranscriptBlock = {
                ...(existingBlock ?? {
                  id: prevActiveId,
                  batchId,
                  command: prevParser.command,
                  rawCommand: prevParser.command,
                  startedAt: now,
                  type: 'command',
                  executionId: prevActiveId,
                  actorId: DEFAULT_LOCAL_HUMAN_ACTOR.id,
                  executionSource: 'terminal',
                  intent: 'interactive',
                  workspaceId,
                  terminalTabId,
                  terminalPaneId,
                  terminalLabelAtCapture: tab.label,
                }),
                output: finalOut,
                completedAt: now,
                isComplete: true,
                lifecycle: 'finished',
                outcome,
                executionState: (outcome === 'failed'
                  ? 'failed'
                  : 'completed') as CaptureExecutionState,
                completionSource:
                  existingBlock?.completionSource ?? 'capture-boundary',
                shellIntegrationLevel:
                  existingBlock?.shellIntegrationLevel ?? 'none',
                hasDiagnosticError: errCheck.isError,
                hasError: outcome === 'failed' || errCheck.isError,
              };
              const eb = evidenceBlocksFromTranscriptBlock(blockToFinalize);
              blockToFinalize.evidenceBlocks = eb;
              blockToFinalize.evidenceBlockIds = eb.map((x) => x.id);
              const exec = executionFromTranscriptBlock(blockToFinalize);
              const se = parseEngineeringEvidence(buildParseContext(exec, eb));
              blockToFinalize.structuredEvidence =
                se.length > 0 ? se : undefined;
              exec.structuredEvidence = blockToFinalize.structuredEvidence;
              prevFinalizedBlock = blockToFinalize;
            }

            updateWorkspace(workspaceId, (prev) => {
              const updatedBlocks = prev.capture.blocks.map((b) => {
                if (b.id === prevActiveId && !b.isComplete && prevFinalizedBlock) {
                  return prevFinalizedBlock;
                }
                return b;
              });
              const nextBlocks = [...updatedBlocks, newBlock];
              const nextSelected = new Set(prev.selection.selectedBlockIds);
              nextSelected.add(blockId);

              const updatedPanes = prev.panes.map((p) =>
                p.id === terminalPaneId
                  ? {
                      ...p,
                      capture: {
                        ...p.capture,
                        isListening: true,
                        hasRetainedData: true,
                        currentBatchId: batchId,
                      },
                    }
                  : p,
              );

              const updatedTabs = prev.terminalTabs.map((t) =>
                t.id === terminalTabId
                  ? {
                      ...t,
                      capture: {
                        ...t.capture,
                        isListening: true,
                        hasRetainedData: true,
                        currentBatchId: batchId,
                      },
                    }
                  : t,
              );

              return {
                ...prev,
                terminalTabs: updatedTabs,
                panes: updatedPanes,
                capture: {
                  ...prev.capture,
                  blocks: nextBlocks,
                },
                selection: {
                  selectedBlockIds: nextSelected,
                  updatedAt: now,
                },
              };
            });

            // Immediate persistence on command execution transition (HISTORY-024C)
            savePersistedWorkspaceState({
              workspaces: workspacesRef.current,
              activeWorkspaceId: activeWorkspaceIdRef.current,
              activeMonitorView,
            });

            if (
              prevFinalizedBlock &&
              (prevFinalizedBlock.intent === 'verification' ||
                verificationRuntimeRef.current?.expectedExecutionId === prevActiveId ||
                verificationRuntimeRef.current?.currentExecutionId === prevActiveId)
            ) {
              handleVerificationExecutionCompletedRef.current?.(prevFinalizedBlock);
            }
          }
        } else if (char === '\x7f' || char === '\b') {
          runtime.inputBuffer = runtime.inputBuffer.slice(0, -1);
        } else if (char === '\x03') {
          runtime.inputBuffer = '';
        } else if (char === '\x1b') {
          // Skip ANSI escape sequences
          let j = i + 1;
          if (j < data.length && (data[j] === '[' || data[j] === 'O')) {
            j++;
            while (j < data.length && !/[A-Za-z~]/.test(data[j])) {
              j++;
            }
          }
          i = j;
        } else if (char >= ' ' || char === '\t') {
          runtime.inputBuffer += char;
        }
      }
    },
    [cancelPendingFlush, updateWorkspace, activeMonitorView],
  );

  const handleTerminalOutput = useCallback(
    (
      workspaceId: LogicalWorkspaceId,
      terminalTabId: TerminalTabId,
      terminalPaneId: TerminalPaneId,
      bytes: Uint8Array,
      events?: ShellIntegrationEvent[],
      textChunk?: string,
    ) => {
      try {
        const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;

      const runtimeKey = getPaneCaptureRuntimeKey(
        workspaceId,
        terminalTabId,
        terminalPaneId,
      );
      const runtime = paneCaptureRuntimesRef.current.get(runtimeKey);
      if (!runtime || runtime.status !== 'capturing') return;

      const currentActiveId = runtime.activeBlockId;
      const parser = runtime.activeBlockParser;

      if (currentActiveId && parser && bytes.length > 0) {
        const rawChunk = textChunk ?? runtime.textDecoder.decode(bytes, { stream: true });
        const sanitized = sanitizeTranscriptChunk(rawChunk);
        if (sanitized) {
          parser.buffer += sanitized;

          const echoResult = processInitialEcho(
            parser.buffer,
            parser.command,
            parser.echoChecked,
          );
          parser.buffer = echoResult.buffer;
          parser.echoChecked = echoResult.echoChecked;

          if (parser.buffer.length > 500000) {
            parser.buffer =
              '\n[Output truncated to 500,000 characters by resource limit]\n' +
              parser.buffer.slice(-500000);
          }

          const capturedRuntime = runtime;
          if (runtime.flushTimer === null) {
            runtime.flushTimer = window.setTimeout(() => {
              capturedRuntime.flushTimer = null;
              const currentWs = workspacesRef.current.find(
                (w) => w.id === workspaceId,
              );
              if (!currentWs) return;
              const currentTab = currentWs.terminalTabs.find(
                (t) => t.id === terminalTabId,
              );
              if (!currentTab) return;
              if (
                paneCaptureRuntimesRef.current.get(runtimeKey) !==
                capturedRuntime
              ) {
                return;
              }
              const activeId = capturedRuntime.activeBlockId;
              const activeParser = capturedRuntime.activeBlockParser;
              if (activeId && activeParser) {
                updateWorkspace(workspaceId, (prev) => {
                  const updated = prev.capture.blocks.map((b) =>
                    b.id === activeId ? { ...b, output: activeParser.buffer } : b,
                  );
                  return {
                    ...prev,
                    capture: {
                      ...prev.capture,
                      blocks: updated,
                    },
                  };
                });
              }
            }, 60);
          }
        }
      }

      // Process shell integration events to drive Execution lifecycle, outcome, and native policy
      if (events && events.length > 0) {
        for (const ev of events) {
          if (ev.type === 'command-start') {
            if (runtime.activeBlockId) {
              const activeId = runtime.activeBlockId;
              const isTrusted = ev.trust === 'trusted';
              updateWorkspace(workspaceId, (prev) => {
                const updated = prev.capture.blocks.map((b) =>
                  b.id === activeId
                    ? {
                        ...b,
                        lifecycle: 'running' as ExecutionLifecycle,
                        outcome: 'unknown' as ExecutionOutcome,
                        shellIntegrationLevel: (isTrusted
                          ? 'rich'
                          : b.shellIntegrationLevel ?? 'basic') as ShellIntegrationLevel,

                      }
                    : b,
                );
                return {
                  ...prev,
                  capture: { ...prev.capture, blocks: updated },
                };
              });
            }
          } else if (ev.type === 'command-end') {
            // CRITICAL TRUST BOUNDARY:
            // Only TRUSTED shell events carrying the verified session nonce can
            // establish authoritative command completion and exit status!
            // Generic or unauthenticated OSC 133 sequences (from child processes,
            // remote shells, or adversaries) MUST NOT alter outcome or exitCode!
            if (ev.trust === 'trusted') {
              const activeId = runtime.activeBlockId;
              const activeParser = runtime.activeBlockParser;
              const now = Date.now();
              cancelPendingFlush(workspaceId, terminalTabId, terminalPaneId);

              if (activeId && activeParser) {
                const substantiveOut = splitPromptTail(
                  activeParser.buffer,
                ).substantiveOutput;
                const exitCode = ev.exitCode;
                const outcome: ExecutionOutcome =
                  exitCode !== null
                    ? exitCode === 0
                      ? 'succeeded'
                      : 'failed'
                    : 'unknown';
                const errCheck = detectErrorFromOutput(
                  substantiveOut ?? activeParser.buffer,
                );

                const currentWs = workspacesRef.current.find(
                  (w) => w.id === workspaceId,
                );
                const existingBlock = currentWs?.capture.blocks.find(
                  (b) => b.id === activeId,
                );

                const finalOut =
                  substantiveOut !== undefined
                    ? substantiveOut
                    : existingBlock?.output ?? activeParser.buffer;

                const finalizedBlock: TranscriptBlock = {
                  ...(existingBlock ?? {
                    id: activeId,
                    batchId: runtime.currentBatch?.id ?? 1,
                    command: activeParser.command,
                    rawCommand: activeParser.command,
                    startedAt: now,
                    type: 'command',
                    executionId: activeId,
                    actorId: DEFAULT_LOCAL_HUMAN_ACTOR.id,
                    executionSource: 'terminal',
                    intent: 'interactive',
                    workspaceId,
                    terminalTabId,
                    terminalPaneId,
                    terminalLabelAtCapture: tab.label,
                  }),
                  output: finalOut,
                  completedAt: now,
                  isComplete: true,
                  lifecycle: 'finished',
                  outcome,
                  outcomeSource: 'trusted-shell',
                  outcomeTrusted: true,
                  executionState: (outcome === 'failed'
                    ? 'failed'
                    : 'completed') as CaptureExecutionState,
                  exitCode,
                  completionSource: 'shell',
                  shellIntegrationLevel: 'rich',
                  hasDiagnosticError: errCheck.isError,
                  hasError: outcome === 'failed' || errCheck.isError,
                };

                const eb = evidenceBlocksFromTranscriptBlock(finalizedBlock);
                finalizedBlock.evidenceBlocks = eb;
                finalizedBlock.evidenceBlockIds = eb.map((x) => x.id);
                const exec = executionFromTranscriptBlock(finalizedBlock);
                const se = parseEngineeringEvidence(buildParseContext(exec, eb));
                finalizedBlock.structuredEvidence =
                  se.length > 0 ? se : undefined;
                exec.structuredEvidence = finalizedBlock.structuredEvidence;

                updateWorkspace(workspaceId, (prev) => {
                  const updatedBlocks = prev.capture.blocks.map((b) => {
                    if (b.id === activeId && !b.isComplete) {
                      return finalizedBlock;
                    }
                    return b;
                  });

                  return {
                    ...prev,
                    capture: {
                      ...prev.capture,
                      blocks: updatedBlocks,
                    },
                  };
                });

                runtime.activeBlockId = null;
                runtime.activeBlockParser = null;

                // Immediate persistence on command completion (HISTORY-024C)
                savePersistedWorkspaceState({
                  workspaces: workspacesRef.current,
                  activeWorkspaceId: activeWorkspaceIdRef.current,
                  activeMonitorView,
                });

                if (
                  finalizedBlock.intent === 'verification' ||
                  verificationRuntimeRef.current?.expectedExecutionId === activeId ||
                  verificationRuntimeRef.current?.currentExecutionId === activeId
                ) {
                  handleVerificationExecutionCompletedRef.current?.(finalizedBlock);
                }
              }
            } else {
              // Untrusted command-end (generic OSC 133 or mismatched nonce)
              // Update shellIntegrationLevel to 'basic' if currently 'none', but DO NOT finalize or set outcome!
              if (runtime.activeBlockId) {
                const activeId = runtime.activeBlockId;
                updateWorkspace(workspaceId, (prev) => {
                  const updated = prev.capture.blocks.map((b) =>
                    b.id === activeId &&
                    (!b.shellIntegrationLevel || b.shellIntegrationLevel === 'none')
                      ? {
                          ...b,
                          shellIntegrationLevel: 'basic' as ShellIntegrationLevel,
                        }
                      : b,
                  );
                  return {
                    ...prev,
                    capture: { ...prev.capture, blocks: updated },
                  };
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Capture] Terminal output handling failed safely:', err);
    }
  },
  [cancelPendingFlush, updateWorkspace, activeMonitorView],
);

  const handleStatusChange = useCallback(
    (
      workspaceId: LogicalWorkspaceId,
      terminalTabId: TerminalTabId,
      terminalPaneId: TerminalPaneId,
      status: TerminalSessionStatus,
      info: TerminalSessionInfo | null,
    ) => {
      updateWorkspace(workspaceId, (prev) => ({
        ...prev,
        panes: prev.panes.map((p) =>
          p.id === terminalPaneId
            ? {
                ...p,
                terminalSessionId:
                  info?.sessionId ?? p.terminalSessionId ?? p.session.sessionId,
                lastKnownCwd: info?.cwd ?? p.lastKnownCwd ?? null,
                session: {
                  sessionId: info?.sessionId ?? p.session.sessionId,
                  status,
                  sessionInfo: info ?? p.session.sessionInfo,
                },
              }
            : p,
        ),
        terminalTabs: prev.terminalTabs.map((t) =>
          t.id === terminalTabId
            ? {
                ...t,
                terminalPanes:
                  t.terminalPanes?.map((p) =>
                    p.id === terminalPaneId
                      ? {
                          ...p,
                          terminalSessionId:
                            info?.sessionId ??
                            p.terminalSessionId ??
                            p.session.sessionId,
                          lastKnownCwd: info?.cwd ?? p.lastKnownCwd ?? null,
                          session: {
                            sessionId: info?.sessionId ?? p.session.sessionId,
                            status,
                            sessionInfo: info ?? p.session.sessionInfo,
                          },
                        }
                      : p,
                  ) ?? [],
                panes: t.panes.map((p) =>
                  p.id === terminalPaneId
                    ? {
                        ...p,
                        terminalSessionId:
                          info?.sessionId ??
                          p.terminalSessionId ??
                          p.session.sessionId,
                        lastKnownCwd: info?.cwd ?? p.lastKnownCwd ?? null,
                        session: {
                          sessionId: info?.sessionId ?? p.session.sessionId,
                          status,
                          sessionInfo: info ?? p.session.sessionInfo,
                        },
                      }
                    : p,
                ),
                panels:
                  t.panels?.map((panel) =>
                    panel.kind === 'terminal' && panel.paneId === terminalPaneId
                      ? {
                          ...panel,
                          terminalSessionId:
                            info?.sessionId ?? panel.terminalSessionId ?? null,
                        }
                      : panel,
                  ) ?? [],
                pane: {
                  sessionId: info?.sessionId ?? t.pane?.sessionId ?? null,
                  status,
                  sessionInfo: info ?? t.pane?.sessionInfo ?? null,
                },
              }
            : t,
        ),
      }));
    },
    [updateWorkspace],
  );

  const handleSessionEnded = useCallback(
    (
      workspaceId: LogicalWorkspaceId,
      terminalTabId: TerminalTabId,
      terminalPaneId: TerminalPaneId,
    ) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!ws) return;
      const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
      if (!tab) return;

      cancelPendingFlush(workspaceId, terminalTabId, terminalPaneId);

      const runtimeKey = getPaneCaptureRuntimeKey(
        workspaceId,
        terminalTabId,
        terminalPaneId,
      );
      const runtime = paneCaptureRuntimesRef.current.get(runtimeKey);
      if (runtime && runtime.activeBlockId && runtime.activeBlockParser) {
        const finalizedOutput = splitPromptTail(
          runtime.activeBlockParser.buffer,
        ).substantiveOutput;
        const activeId = runtime.activeBlockId;
        const now = Date.now();

        const currentWs = workspacesRef.current.find((w) => w.id === workspaceId);
        const existingBlock = currentWs?.capture.blocks.find(
          (b) => b.id === activeId,
        );

        const outcome: ExecutionOutcome =
          existingBlock?.exitCode != null
            ? existingBlock.exitCode === 0
              ? 'succeeded'
              : 'failed'
            : 'unknown';
        const errCheck = detectErrorFromOutput(finalizedOutput || '');
        const updatedBlock: TranscriptBlock = {
          ...(existingBlock ?? {
            id: activeId,
            batchId: runtime.currentBatch?.id ?? 1,
            command: runtime.activeBlockParser.command,
            rawCommand: runtime.activeBlockParser.command,
            startedAt: now,
            type: 'command',
            executionId: activeId,
            actorId: DEFAULT_LOCAL_HUMAN_ACTOR.id,
            executionSource: 'terminal',
            intent: 'interactive',
            workspaceId,
            terminalTabId,
            terminalPaneId,
            terminalLabelAtCapture: tab.label,
          }),
          output: finalizedOutput,
          completedAt: now,
          isComplete: true,
          lifecycle: 'finished',
          outcome,
          executionState: (outcome === 'failed'
            ? 'failed'
            : 'completed') as CaptureExecutionState,
          completionSource: 'shell',
          hasDiagnosticError: errCheck.isError,
          hasError: outcome === 'failed' || errCheck.isError,
        };
        const eb = evidenceBlocksFromTranscriptBlock(updatedBlock);
        updatedBlock.evidenceBlocks = eb;
        updatedBlock.evidenceBlockIds = eb.map((x) => x.id);
        const exec = executionFromTranscriptBlock(updatedBlock);
        const se = parseEngineeringEvidence(buildParseContext(exec, eb));
        updatedBlock.structuredEvidence = se.length > 0 ? se : undefined;
        exec.structuredEvidence = updatedBlock.structuredEvidence;

        updateWorkspace(workspaceId, (prev) => {
          const updated = prev.capture.blocks.map((b) => {
            if (b.id === activeId && !b.isComplete) {
              return updatedBlock;
            }
            return b;
          });
          return {
            ...prev,
            capture: {
              ...prev.capture,
              blocks: updated,
            },
          };
        });

        runtime.activeBlockId = null;
        runtime.activeBlockParser = null;

        if (
          updatedBlock.intent === 'verification' ||
          verificationRuntimeRef.current?.expectedExecutionId === activeId ||
          verificationRuntimeRef.current?.currentExecutionId === activeId
        ) {
          handleVerificationExecutionCompletedRef.current?.(updatedBlock);
        }
      }

      // Section 16: If verification is targeting this session/pane and is still unresolved, reconcile immediately
      if (
        verificationRuntimeRef.current &&
        verificationRuntimeRef.current.workspaceId === workspaceId &&
        verificationRuntimeRef.current.terminalPaneId === terminalPaneId
      ) {
        const { workspace: updatedWs } = reconcileVerificationTeardown({
          workspace: ws,
          runtime: verificationRuntimeRef.current,
          targetWorkspaceId: workspaceId,
          targetPaneId: terminalPaneId,
          reason: 'Terminal session exited before verification completion',
        });
        verificationRuntimeRef.current = null;
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);
        updateWorkspace(workspaceId, () => updatedWs);
        showTranscriptFeedback('Verification error: terminal session exited', 'error');
      }
    },
    [cancelPendingFlush, updateWorkspace, showTranscriptFeedback],
  );

  // Clean up all terminal pane runtimes on unmount
  useEffect(() => {
    const runtimes = paneCaptureRuntimesRef.current;
    return () => {
      for (const runtime of runtimes.values()) {
        cleanupPaneCaptureRuntime(runtime);
      }
      runtimes.clear();
      runtimes.clear();
      if (terminalPaneToastTimeoutRef.current !== null) {
        window.clearTimeout(terminalPaneToastTimeoutRef.current);
        terminalPaneToastTimeoutRef.current = null;
      }
      if (transcriptFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(transcriptFeedbackTimeoutRef.current);
        transcriptFeedbackTimeoutRef.current = null;
      }
    };
  }, []);

  const activeTerminalPaneBlocks = useMemo(() => {
    if (!activeTerminalPane || !activeTerminalTab || !activeWorkspace) return [];
    return activeWorkspace.capture.blocks.filter(
      (b) =>
        (b.terminalPaneId && b.terminalPaneId === activeTerminalPane.id) ||
        b.terminalTabId === activeTerminalTab.id ||
        !b.terminalTabId,
    );
  }, [activeWorkspace, activeTerminalTab, activeTerminalPane]);

  const currentBatchId =
    activeTerminalPane?.capture?.currentBatchId ??
    activeTerminalTab?.capture?.currentBatchId ??
    null;
  const currentBatchBlocks = currentBatchId !== null
    ? activeTerminalPaneBlocks.filter(
        (b) => b.batchId === currentBatchId,
      )
    : [];

  const pendingDeleteWorkspace = pendingDeleteWorkspaceId
    ? workspaces.find((w) => w.id === pendingDeleteWorkspaceId) ?? null
    : null;

  const activeCapturePanel = activeTerminalTab?.panels?.find(
    (p): p is CapturePanel => p.kind === 'capture',
  );

  const aggregateCaptureStatus = activeCapturePanel?.groupStatus ?? 'ready';

  const isTargetSelectorLocked =
    aggregateCaptureStatus === 'capturing' || aggregateCaptureStatus === 'paused';

  const handleRerunCommand = useCallback(
    async (
      command: string,
      targetPaneId: string,
      targetWorkspaceId?: string,
      targetTabId?: string,
    ) => {
      const wsId = targetWorkspaceId ?? activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) {
        showTranscriptFeedback('Cannot rerun: workspace not found', 'error');
        return;
      }

      const tabId = targetTabId ?? ws.activeTerminalTabId;
      const tab = ws.terminalTabs.find((t) => t.id === tabId);
      if (!tab) {
        showTranscriptFeedback('Cannot rerun: terminal tab not found', 'error');
        return;
      }

      const pane = tab.panes.find((p) => p.id === targetPaneId);
      if (!pane) {
        showTranscriptFeedback(
          'Cannot rerun: target terminal pane is closed',
          'error',
        );
        return;
      }

      const targetSessionId =
        terminalRefs.current.get(targetPaneId)?.getSessionId() ??
        pane.session?.sessionId;

      if (!targetSessionId) {
        showTranscriptFeedback(
          'Cannot rerun: terminal session is not active',
          'error',
        );
        return;
      }

      // Ensure capture runtime is active if paused or idle
      const runtimeKey = getPaneCaptureRuntimeKey(wsId, tabId, targetPaneId);
      let runtime = paneCaptureRuntimesRef.current.get(runtimeKey);
      if (!runtime) {
        runtime =
          getOrCreatePaneCaptureRuntime(wsId, tabId, targetPaneId) ?? undefined;
      }
      if (runtime && runtime.status !== 'capturing') {
        if (!runtime.currentBatch) {
          const nextBatchId = ws.capture.batchCounter + 1;
          runtime.currentBatch = {
            id: nextBatchId,
            startedAt: Date.now(),
            stoppedAt: null,
          };
        }
        runtime.status = 'capturing';
      }

      // Focus target terminal pane
      terminalRefs.current.get(targetPaneId)?.focus();

      // Transmit command to PTY stdin
      const commandBytes = new TextEncoder().encode(command + '\r');
      try {
        await terminalApi.write(targetSessionId, Array.from(commandBytes));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showTranscriptFeedback(`Rerun failed: ${msg}`, 'error');
        return;
      }

      // Feed into handleTerminalInput to trigger Execution lifecycle
      handleTerminalInput(wsId, tabId, targetPaneId, command + '\r');
      showTranscriptFeedback(`Rerunning: ${command}`, 'success');
    },
    [
      getOrCreatePaneCaptureRuntime,
      handleTerminalInput,
      showTranscriptFeedback,
    ],
  );

  // ==========================================================================
  // Verification Runner Orchestration (Phases 1-13 & HARDEN-012A)
  // ==========================================================================

  const handleVerificationCriterionImmediateFailureRef = useRef<
    | ((
        workspaceId: string,
        runId: string,
        criterionId: string,
        errResult: VerificationCriterionResult,
      ) => void)
    | null
  >(null);

  /**
   * Explicit async scheduler boundary to prevent synchronous recursion
   * and linear stack-depth growth across criteria progression.
   */
  const advanceVerificationRuntime = useCallback(
    (
      workspaceId: string,
      terminalTabId: string,
      terminalPaneId: string,
      runId: string,
      nextCriterion: VerificationCriterion,
    ) => {
      const runtime = verificationRuntimeRef.current;
      if (
        !runtime ||
        runtime.runId !== runId ||
        runtime.cancelled ||
        runtime.lifecycle !== 'running'
      ) {
        return;
      }

      if (runtime.advanceTimer) {
        clearTimeout(runtime.advanceTimer);
        runtime.advanceTimer = null;
      }

      // Microtask boundary guarantees invocation starts from a clean call stack (depth 1)
      Promise.resolve().then(() => {
        const currentRt = verificationRuntimeRef.current;
        if (
          !currentRt ||
          currentRt.runId !== runId ||
          currentRt.cancelled ||
          currentRt.lifecycle !== 'running'
        ) {
          return;
        }
        try {
          const promise = executeVerificationCriterionRef.current?.(
            workspaceId,
            terminalTabId,
            terminalPaneId,
            runId,
            nextCriterion,
          );
          if (promise && typeof promise.catch === 'function') {
            promise.catch((err) => {
              console.error('[VerificationRuntime] Unhandled execution error:', err);
              handleVerificationCriterionImmediateFailureRef.current?.(
                workspaceId,
                runId,
                nextCriterion.id,
                {
                  criterionId: nextCriterion.id,
                  status: 'error',
                  message: `Verification execution failed: ${err instanceof Error ? err.message : String(err)}`,
                  startedAt: Date.now(),
                  completedAt: Date.now(),
                },
              );
            });
          }
        } catch (err) {
          console.error('[VerificationRuntime] Synchronous execution error:', err);
          handleVerificationCriterionImmediateFailureRef.current?.(
            workspaceId,
            runId,
            nextCriterion.id,
            {
              criterionId: nextCriterion.id,
              status: 'error',
              message: `Verification execution error: ${err instanceof Error ? err.message : String(err)}`,
              startedAt: Date.now(),
              completedAt: Date.now(),
            },
          );
        }
      });
    },
    [],
  );

  const handleVerificationCriterionImmediateFailure = useCallback(
    (
      workspaceId: string,
      runId: string,
      criterionId: string,
      errResult: VerificationCriterionResult,
    ) => {
      const runtime = verificationRuntimeRef.current;
      if (!runtime || runtime.runId !== runId) return;

      // Always clear any claimed execution ownership on immediate failure
      runtime.currentExecutionId = undefined;
      runtime.expectedExecutionId = undefined;

      setWorkspaces((prev) => {
        const ws = prev.find((w) => w.id === workspaceId);
        if (!ws) return prev;
        const currentRun = ws.verification?.runs.find((r) => r.id === runId);
        if (!currentRun) return prev;

        const updatedResults = currentRun.criterionResults.map((r) =>
          r.criterionId === criterionId ? errResult : r,
        );

        if (runtime.cancelled || runtime.lifecycle === 'stopping') {
          const finalResults = updatedResults.map((r) =>
            r.status === 'pending'
              ? { ...r, status: 'skipped' as const, message: 'Verification was stopped' }
              : r,
          );
          const cancelledRun: VerificationRun = {
            ...currentRun,
            status: 'cancelled',
            criterionResults: finalResults,
            completedAt: Date.now(),
          };
          verificationRuntimeRef.current = null;
          setIsVerificationStopping(false);
          setIsVerificationStopTimeout(false);
          const next = prev.map((w) =>
            w.id === ws.id ? updateVerificationRunInWorkspace(w, cancelledRun) : w,
          );
          workspacesRef.current = next;
          showTranscriptFeedback('Verification stopped', 'success');
          return next;
        }

        // Continue to next criterion via explicit async scheduler boundary (Section 3)
        const nextIndex = runtime.currentCriterionIndex + 1;
        if (nextIndex < currentRun.criteriaSnapshot.length) {
          runtime.currentCriterionIndex = nextIndex;
          const nextCriterion = currentRun.criteriaSnapshot[nextIndex];
          runtime.currentCriterionId = nextCriterion.id;
          runtime.expectedCriterionId = nextCriterion.id;
          runtime.currentExecutionId = undefined;
          runtime.expectedExecutionId = undefined;

          const inProgressRun: VerificationRun = {
            ...currentRun,
            status: currentRun.status === 'running' ? 'running' : 'pending',
            criterionResults: updatedResults,
          };

          const next = prev.map((w) =>
            w.id === ws.id ? updateVerificationRunInWorkspace(w, inProgressRun) : w,
          );
          workspacesRef.current = next;

          advanceVerificationRuntime(
            runtime.workspaceId,
            runtime.terminalTabId,
            runtime.terminalPaneId,
            runtime.runId,
            nextCriterion,
          );
          return next;
        } else {
          const finalStatus = deriveVerificationRunStatus(updatedResults);
          const completedRun: VerificationRun = {
            ...currentRun,
            status: finalStatus,
            criterionResults: updatedResults,
            completedAt: Date.now(),
          };
          verificationRuntimeRef.current = null;
          setIsVerificationStopping(false);
          setIsVerificationStopTimeout(false);
          const next = prev.map((w) =>
            w.id === ws.id ? updateVerificationRunInWorkspace(w, completedRun) : w,
          );
          workspacesRef.current = next;

          const passedCount = updatedResults.filter((r) => r.status === 'passed').length;
          const totalCount = currentRun.criteriaSnapshot.length;
          const isSingleErr = totalCount === 1 && finalStatus === 'error';
          showTranscriptFeedback(
            isSingleErr
              ? (errResult.message ?? 'Verification check failed with error')
              : `Verification ${finalStatus.toUpperCase()}: ${passedCount}/${totalCount} passed`,
            finalStatus === 'passed' ? 'success' : 'error',
          );
          return next;
        }
      });
    },
    [advanceVerificationRuntime, showTranscriptFeedback],
  );

  useEffect(() => {
    handleVerificationCriterionImmediateFailureRef.current =
      handleVerificationCriterionImmediateFailure;
  }, [handleVerificationCriterionImmediateFailure]);

  const executeVerificationCriterion = useCallback(
    async (
      workspaceId: string,
      terminalTabId: string,
      terminalPaneId: string,
      runId: string,
      criterion: VerificationCriterion,
    ) => {
      try {
        const runtime = verificationRuntimeRef.current;
        if (
          !runtime ||
          runtime.runId !== runId ||
          runtime.cancelled ||
          runtime.lifecycle !== 'running'
        ) {
          return;
        }

        // VERIFY-CWD-026: Pre-dispatch safety: ensure no execution ownership is claimed before validation
        runtime.currentExecutionId = undefined;
        runtime.expectedExecutionId = undefined;

        // 1. Identify workspace and target terminal session
        const ws = workspacesRef.current.find((w) => w.id === workspaceId);
        if (!ws) {
          handleVerificationCriterionImmediateFailure(workspaceId, runId, criterion.id, {
            criterionId: criterion.id,
            status: 'error',
            message: 'Workspace not found',
            startedAt: Date.now(),
            completedAt: Date.now(),
          });
          return;
        }

        const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
        const pane = tab?.panes.find((p) => p.id === terminalPaneId);
        const targetSessionId =
          terminalRefs.current.get(terminalPaneId)?.getSessionId() ??
          pane?.session?.sessionId ??
          pane?.terminalSessionId ??
          runtime.targetSessionId;

        if (!targetSessionId) {
          handleVerificationCriterionImmediateFailure(workspaceId, runId, criterion.id, {
            criterionId: criterion.id,
            status: 'error',
            message: 'Target terminal session is not active',
            startedAt: Date.now(),
            completedAt: Date.now(),
          });
          return;
        }

        runtime.targetSessionId = targetSessionId;

        // 2. Pre-dispatch validation: Resolve working directory and validate boundary (VERIFY-CWD-025 / VERIFY-CWD-026)
        const cwdResolution = resolveVerificationWorkingDirectory(
          ws.rootPath,
          criterion.workingDirectory ?? criterion.cwd,
        );

        if (!cwdResolution.ok || !cwdResolution.resolvedPath) {
          handleVerificationCriterionImmediateFailure(workspaceId, runId, criterion.id, {
            criterionId: criterion.id,
            status: 'error',
            message: cwdResolution.error ?? 'Invalid working directory',
            startedAt: Date.now(),
            completedAt: Date.now(),
          });
          return;
        }

        const targetCwd = cwdResolution.resolvedPath;

        // 3. Pre-dispatch validation: Validate directory existence before execution
        const dirExists = await validateDirectoryExists(targetCwd);
        if (!dirExists) {
          const displayPath =
            criterion.workingDirectory && criterion.workingDirectory !== '.'
              ? criterion.workingDirectory
              : targetCwd;
          handleVerificationCriterionImmediateFailure(workspaceId, runId, criterion.id, {
            criterionId: criterion.id,
            status: 'error',
            message: `Verification working directory does not exist: ${displayPath}`,
            startedAt: Date.now(),
            completedAt: Date.now(),
          });
          return;
        }

        // 4. Prepare dispatch command
        const dispatchCommand = buildVerificationDispatchCommand(criterion.command, targetCwd);

        // ---------------------------------------------------------------------
        // PRE-DISPATCH VALIDATION COMPLETE & SUCCESSFUL!
        // Only now does the runtime claim real execution ownership and enter running state.
        // ---------------------------------------------------------------------

        // 5. Focus target terminal pane
        terminalRefs.current.get(terminalPaneId)?.focus();

        // 6. Generate deterministic executionId and claim execution ownership
        const executionId = `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        runtime.currentExecutionId = executionId;
        runtime.expectedExecutionId = executionId;
        runtime.currentCriterionId = criterion.id;
        runtime.expectedCriterionId = criterion.id;
        runtime.terminalSessionId = targetSessionId;
        runtime.targetSessionId = targetSessionId;
        runtime.isProcessingCompletion = false;

        console.log('[VerificationRuntime] Criterion Launch:', {
          workspaceId: runtime.workspaceId,
          verificationRunId: runtime.runId,
          profileId: runtime.profileId,
          criterionId: criterion.id,
          criterionIndex: runtime.currentCriterionIndex,
          terminalSessionId: targetSessionId,
          executionId,
        });

        // 7. Mark criterion as running in workspace state AND synchronously update workspacesRef.current
        setWorkspaces((prev) => {
          const currentWs = prev.find((w) => w.id === workspaceId);
          if (!currentWs) return prev;
          const run = currentWs.verification?.runs.find((r) => r.id === runId);
          if (!run) return prev;
          const updatedRun: VerificationRun = {
            ...run,
            status: 'running',
            criterionResults: run.criterionResults.map((r) =>
              r.criterionId === criterion.id
                ? { ...r, status: 'running' as const, startedAt: Date.now() }
                : r,
            ),
          };
          const next = prev.map((w) =>
            w.id === workspaceId ? updateVerificationRunInWorkspace(w, updatedRun) : w,
          );
          workspacesRef.current = next;
          return next;
        });

        // 8. Ensure pane capture runtime is capturing
        const runtimeKey = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, terminalPaneId);
        let paneRuntime = paneCaptureRuntimesRef.current.get(runtimeKey);
        if (!paneRuntime) {
          paneRuntime =
            getOrCreatePaneCaptureRuntime(workspaceId, terminalTabId, terminalPaneId) ??
            undefined;
        }
        if (paneRuntime && paneRuntime.status !== 'capturing') {
          if (!paneRuntime.currentBatch) {
            const nextBatchId = (ws?.capture.batchCounter ?? 0) + 1;
            paneRuntime.currentBatch = {
              id: nextBatchId,
              startedAt: Date.now(),
              stoppedAt: null,
            };
          }
          paneRuntime.status = 'capturing';
        }

        // 9. Create and register execution block BEFORE writing to PTY
        const now = Date.now();
        const newBlock: TranscriptBlock = {
          id: executionId,
          batchId: paneRuntime?.currentBatch?.id ?? 1,
          command: dispatchCommand,
          rawCommand: dispatchCommand,
          output: '',
          startedAt: now,
          completedAt: null,
          isComplete: false,
          type: 'command',
          executionId,
          actorId: DEFAULT_LOCAL_HUMAN_ACTOR.id,
          executionSource: 'terminal',
          intent: 'verification',
          verificationRunId: runId,
          verificationCriterionId: criterion.id,
          executionState: 'running',
          lifecycle: 'running',
          outcome: 'unknown',
          exitCode: null,
          hasError: false,
          hasDiagnosticError: false,
          evidenceBlockIds: [`${executionId}-cmd`],
          evidenceBlocks: [
            createEvidenceBlock({
              id: `${executionId}-cmd`,
              executionId,
              type: 'command',
              rawText: dispatchCommand,
              displayText: dispatchCommand,
              createdAt: now,
            }),
          ],
          workspaceId,
          terminalTabId,
          terminalPaneId,
          terminalLabelAtCapture: tab?.label ?? 'Terminal 1',
          sourcePaneId: terminalPaneId,
          sourcePaneOrdinal: pane?.stableOrdinal ?? 1,
          sourcePaneAccentId: pane?.accentId ?? 'blue',
          cwd: targetCwd,
          captureSessionId: paneRuntime?.captureSessionId ?? undefined,
          captureGroupId: paneRuntime?.captureGroupId ?? undefined,
        };

        if (paneRuntime) {
          paneRuntime.activeBlockId = executionId;
          paneRuntime.activeBlockParser = {
            command: dispatchCommand,
            buffer: '',
            echoChecked: false,
          };
        }

        updateWorkspace(workspaceId, (prev) => ({
          ...prev,
          capture: {
            ...prev.capture,
            blocks: [...prev.capture.blocks, newBlock],
          },
        }));

        // 10. Transmit command to PTY stdin (Section 4: dispatch failure must release runtime)
        const commandBytes = new TextEncoder().encode(dispatchCommand + '\r');
        try {
          await terminalApi.write(targetSessionId, Array.from(commandBytes));
        } catch (err) {
          // Dispatch failure: clear execution ownership immediately
          runtime.currentExecutionId = undefined;
          runtime.expectedExecutionId = undefined;
          if (paneRuntime && paneRuntime.activeBlockId === executionId) {
            paneRuntime.activeBlockId = null;
          }
          updateWorkspace(workspaceId, (prev) => ({
            ...prev,
            capture: {
              ...prev.capture,
              blocks: prev.capture.blocks.filter((b) => b.id !== executionId),
            },
          }));

          const msg = err instanceof Error ? err.message : String(err);
          handleVerificationCriterionImmediateFailure(workspaceId, runId, criterion.id, {
            criterionId: criterion.id,
            status: 'error',
            message: `Failed to transmit command: ${msg}`,
            startedAt: Date.now(),
            completedAt: Date.now(),
          });
          return;
        }
      } catch (err) {
        console.error('[VerificationRuntime] executeVerificationCriterion exception:', err);
        const runtime = verificationRuntimeRef.current;
        if (runtime) {
          runtime.currentExecutionId = undefined;
          runtime.expectedExecutionId = undefined;
        }
        const msg = err instanceof Error ? err.message : String(err);
        handleVerificationCriterionImmediateFailure(workspaceId, runId, criterion.id, {
          criterionId: criterion.id,
          status: 'error',
          message: `Internal verification error: ${msg}`,
          startedAt: Date.now(),
          completedAt: Date.now(),
        });
      }
    },
    [getOrCreatePaneCaptureRuntime, handleVerificationCriterionImmediateFailure, updateWorkspace],
  );

  useEffect(() => {
    executeVerificationCriterionRef.current = executeVerificationCriterion;
  }, [executeVerificationCriterion]);

  const handleVerificationExecutionCompleted = useCallback(
    (block: TranscriptBlock) => {
      try {
        const runtime = verificationRuntimeRef.current;
        if (!runtime) return;

      const activeExecId =
        runtime.currentExecutionId ?? runtime.expectedExecutionId;
      const activeCriterionId =
        runtime.currentCriterionId ?? runtime.expectedCriterionId;

      // Identity and correlation verification (Section 3, 5, 8 & 12)
      if (
        block.intent !== 'verification' ||
        block.workspaceId !== runtime.workspaceId ||
        block.verificationRunId !== runtime.runId ||
        (activeCriterionId &&
          block.verificationCriterionId !== activeCriterionId) ||
        (activeExecId &&
          block.id !== activeExecId &&
          block.executionId !== activeExecId)
      ) {
        return;
      }

      // Idempotency: guard against duplicate execution completion handling (Section 14)
      if (runtime.isProcessingCompletion) {
        return;
      }
      runtime.isProcessingCompletion = true;

      // Clear active execution ownership immediately (Section 15)
      runtime.currentExecutionId = undefined;
      runtime.expectedExecutionId = undefined;

      const ws = workspacesRef.current.find((w) => w.id === runtime.workspaceId);
      if (!ws) {
        runtime.isProcessingCompletion = false;
        return;
      }
      const currentRun = ws.verification?.runs.find((r) => r.id === runtime.runId);
      if (!currentRun) {
        runtime.isProcessingCompletion = false;
        return;
      }

      const criterion = runtime.criteriaSnapshot.find(
        (c) => c.id === (block.verificationCriterionId ?? activeCriterionId),
      );
      if (!criterion) {
        runtime.isProcessingCompletion = false;
        return;
      }

      // Check cancellation / stopping (Section 5, 7, 8, 9, 10, 11)
      if (
        runtime.cancelled ||
        runtime.lifecycle === 'stopping' ||
        runtime.lifecycle === 'stop-timeout'
      ) {
        if (runtime.stopFallbackTimer) {
          clearTimeout(runtime.stopFallbackTimer);
          runtime.stopFallbackTimer = null;
        }
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);

        // Convert to Execution preserving real partial output and exit code (e.g. 130)
        const execution = executionFromTranscriptBlock(block);

        const finalResults = runtime.criterionResults.map((r) => {
          if (r.criterionId === criterion.id) {
            return {
              criterionId: criterion.id,
              status: 'interrupted' as const,
              executionId: execution.id,
              observedExitCode: execution.exitCode,
              startedAt: execution.startedAt,
              completedAt: execution.completedAt ?? Date.now(),
              message: 'Execution interrupted by user',
            };
          }
          if (r.status === 'pending') {
            return {
              ...r,
              status: 'skipped' as const,
              message: 'Verification was stopped by user',
            };
          }
          return r;
        });

        const cancelledRun: VerificationRun = {
          ...currentRun,
          status: 'cancelled',
          criterionResults: finalResults,
          completedAt: Date.now(),
        };

        verificationRuntimeRef.current = null;
        setWorkspaces((prev) =>
          prev.map((w) =>
            w.id === ws.id ? updateVerificationRunInWorkspace(w, cancelledRun) : w,
          ),
        );
        showTranscriptFeedback('Verification stopped', 'success');
        return;
      }

      // Convert to Execution and evaluate pure deterministic verdict
      const execution = executionFromTranscriptBlock(block);
      const evaluatedResult = evaluateCriterionResult(criterion, execution);

      // Idempotently update criterionResults array in runtime
      const updatedResults = runtime.criterionResults.map((r) =>
        r.criterionId === criterion.id ? evaluatedResult : r,
      );
      runtime.criterionResults = updatedResults;

      // Handle Infrastructure Error: Stops the queue immediately! (Section 10)
      if (evaluatedResult.status === 'error') {
        const finalResults = updatedResults.map((r) =>
          r.status === 'pending'
            ? {
                ...r,
                status: 'skipped' as const,
                message: 'Skipped due to prior verification error',
              }
            : r,
        );
        const errorRun: VerificationRun = {
          ...currentRun,
          status: 'error',
          criterionResults: finalResults,
          completedAt: Date.now(),
        };
        verificationRuntimeRef.current = null;
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);
        setWorkspaces((prev) =>
          prev.map((w) =>
            w.id === ws.id ? updateVerificationRunInWorkspace(w, errorRun) : w,
          ),
        );
        showTranscriptFeedback(
          `Verification error: ${evaluatedResult.message ?? 'Unknown error'}`,
          'error',
        );
        return;
      }

      // Sequential progression via explicit scheduler boundary (Section 3, 4, 8 & 9)
      const nextIndex = runtime.currentCriterionIndex + 1;
      if (nextIndex < runtime.criteriaSnapshot.length) {
        runtime.currentCriterionIndex = nextIndex;
        const nextCriterion = runtime.criteriaSnapshot[nextIndex];
        runtime.currentCriterionId = nextCriterion.id;
        runtime.expectedCriterionId = nextCriterion.id;
        runtime.currentExecutionId = undefined;
        runtime.expectedExecutionId = undefined;
        runtime.isProcessingCompletion = false; // Reset lock for next criterion

        const inProgressRun: VerificationRun = {
          ...currentRun,
          status: 'running',
          criterionResults: updatedResults,
        };

        setWorkspaces((prev) =>
          prev.map((w) =>
            w.id === ws.id ? updateVerificationRunInWorkspace(w, inProgressRun) : w,
          ),
        );

        advanceVerificationRuntime(
          runtime.workspaceId,
          runtime.terminalTabId,
          runtime.terminalPaneId,
          runtime.runId,
          nextCriterion,
        );
      } else {
        // Complete run (Section 7)
        const finalStatus = deriveVerificationRunStatus(updatedResults);
        const beforeSnapshot = runtime.beforeSnapshot;
        const targetRunId = runtime.runId;
        const targetWsId = runtime.workspaceId;
        const targetPaneId = runtime.terminalPaneId;

        verificationRuntimeRef.current = null;
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);

        const completedRun: VerificationRun = {
          ...currentRun,
          status: finalStatus,
          criterionResults: updatedResults,
          completedAt: Date.now(),
        };
        setWorkspaces((prev) =>
          prev.map((w) =>
            w.id === ws.id ? updateVerificationRunInWorkspace(w, completedRun) : w,
          ),
        );

        const passedCount = updatedResults.filter((r) => r.status === 'passed').length;
        const totalCount = runtime.criteriaSnapshot.length;
        showTranscriptFeedback(
          `Verification ${finalStatus.toUpperCase()}: ${passedCount}/${totalCount} passed`,
          finalStatus === 'passed' ? 'success' : 'error',
        );

        // Asynchronously collect after-snapshot and compute attribution (bounded)
        const activePane = ws.terminalTabs
          .find((t) => t.paneIds.includes(targetPaneId))
          ?.panes.find((p) => p.id === targetPaneId);
        const cwd = activePane?.session.sessionInfo?.cwd ?? undefined;

        (async () => {
          try {
            const pendingAttr = createPendingAttribution({
              workspaceId: targetWsId,
              targetType: 'verification-run',
              targetId: targetRunId,
              repositoryRoot: beforeSnapshot?.repositoryRoot,
              beforeSnapshotId: beforeSnapshot?.id,
            });

            const res = await collectRepositoryEvidence({
              workspaceId: targetWsId,
              cwd,
            });

            const finalizedAttr = finalizeChangeAttribution({
              attribution: pendingAttr,
              beforeSnapshot,
              afterSnapshot: res.snapshot ?? null,
              errorMessage: res.run.errorMessage ?? undefined,
            });

            updateWorkspace(targetWsId, (prev) => {
              const nextSnapshots = res.snapshot
                ? [...(prev.repositorySnapshots ?? []), res.snapshot].slice(-MAX_RETAINED_SNAPSHOTS)
                : prev.repositorySnapshots;

              const nextAttributions = [
                ...(prev.changeAttributions ?? []),
                finalizedAttr,
              ].slice(-MAX_RETAINED_ATTRIBUTIONS);

              const targetRun = prev.verification?.runs.find((r) => r.id === targetRunId);
              const updatedTargetRun = targetRun
                ? { ...targetRun, attributionId: finalizedAttr.id }
                : null;

              return {
                ...prev,
                repositorySnapshots: nextSnapshots,
                latestCollectionRun: res.run,
                changeAttributions: nextAttributions,
                verification: updatedTargetRun
                  ? {
                      ...prev.verification!,
                      runs: prev.verification!.runs.map((r) =>
                        r.id === targetRunId ? updatedTargetRun : r,
                      ),
                    }
                  : prev.verification,
              };
            });
          } catch (err) {
            console.warn('[ChangeAttribution] Post-verification attribution failed safely:', err);
          }
        })();
      }
    } catch (err) {
      console.error('[VerificationRuntime] handleVerificationExecutionCompleted exception:', err);
      const runtime = verificationRuntimeRef.current;
      if (runtime) {
        verificationRuntimeRef.current = null;
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);
        updateWorkspace(runtime.workspaceId, (prev) => {
          const currentRun = prev.verification?.runs.find((r) => r.id === runtime.runId);
          if (!currentRun) return prev;
          return updateVerificationRunInWorkspace(prev, {
            ...currentRun,
            status: 'error',
            completedAt: Date.now(),
          });
        });
        showTranscriptFeedback('Verification error during completion processing', 'error');
      }
    }
  },
  [advanceVerificationRuntime, showTranscriptFeedback, updateWorkspace],
  );

  useEffect(() => {
    handleVerificationExecutionCompletedRef.current = handleVerificationExecutionCompleted;
  }, [handleVerificationExecutionCompleted]);

  const handleRunVerification = useCallback(
    async (workspaceId?: string, selectedCriterionIds?: string[]) => {
      const wsId = workspaceId ?? activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) {
        showTranscriptFeedback('Cannot run verification: workspace not found', 'error');
        return;
      }

      // Section 13, 21: Active-run locking & reconciliation
      const { workspace: cleanWs } = reconcileWorkspaceVerificationState({
        workspace: ws,
        hasActiveRuntime: Boolean(verificationRuntimeRef.current),
        activeRunIdInRuntime: verificationRuntimeRef.current?.runId,
      });
      if (cleanWs !== ws) {
        setWorkspaces((prev) =>
          prev.map((w) => (w.id === wsId ? cleanWs : w)),
        );
      }

      if (verificationRuntimeRef.current) {
        const rt = verificationRuntimeRef.current;
        const isStillRunning = ws.verification?.runs.some(
          (r) =>
            r.id === rt.runId &&
            (r.status === 'running' || r.status === 'pending' || r.status === 'stopping' || r.status === 'stop-timeout'),
        );
        if (isStillRunning && !rt.cancelled) {
          if (rt.lifecycle === 'stopping') {
            showTranscriptFeedback('Verification is still stopping.', 'error');
            return;
          }
          if (rt.lifecycle === 'stop-timeout') {
            showTranscriptFeedback('A verification command is still running.', 'error');
            return;
          }
          showTranscriptFeedback('A verification run is already in progress for this workspace', 'error');
          return;
        }
      }

      const tab = ws.terminalTabs.find((t) => t.id === ws.activeTerminalTabId);
      if (!tab) {
        showTranscriptFeedback('Cannot run verification: active terminal tab not found', 'error');
        return;
      }
      const paneId = tab.activePaneId;
      const contract = getActiveVerificationContract(ws);
      if (!contract || contract.criteria.length === 0) {
        showTranscriptFeedback('Cannot run verification: no criteria defined in contract', 'error');
        return;
      }

      // HARDEN-VERIFY-DELETE-021 Section 7: Run Selected Safety
      // Immediately before starting a VerificationRun:
      // resolve selected IDs against current criteria again.
      // Only current valid criteria may enter the immutable run snapshot.
      // If canonical state somehow contains a stale ID, it must not become part of the run.
      // Do not fabricate a criterion for a missing ID.
      const validCriterionIds = new Set(contract.criteria.map((c) => c.id));
      const rawSelection =
        selectedCriterionIds !== undefined
          ? selectedCriterionIds
          : Array.from(getCanonicalVerificationSelection(ws));

      const effectiveSelectedCriterionIds = rawSelection.filter((id) =>
        validCriterionIds.has(id),
      );

      if (effectiveSelectedCriterionIds.length === 0) {
        showTranscriptFeedback('Cannot run verification: no criteria selected', 'error');
        return;
      }

      // Section 6, 10, 15, 16, 18: Create new immutable VerificationRun with criteria snapshot
      const newRun = createVerificationRun({
        contract,
        workspaceId: wsId,
        selectedCriterionIds: effectiveSelectedCriterionIds,
      });

      if (newRun.criteriaSnapshot.length === 0) {
        showTranscriptFeedback('Cannot run verification: selected criteria not found in profile', 'error');
        return;
      }

      const activePane = tab.panes.find((p) => p.id === paneId);
      const cwd = activePane?.session.sessionInfo?.cwd ?? undefined;
      const targetSessionId =
        terminalRefs.current.get(paneId)?.getSessionId() ??
        activePane?.session?.sessionId;

      (async () => {
        let beforeSnapshot: RepositorySnapshot | null = null;
        try {
          const res = await collectRepositoryEvidence({
            workspaceId: wsId,
            cwd,
          });
          if (res.snapshot) {
            beforeSnapshot = res.snapshot;
            updateWorkspace(wsId, (prev) => ({
              ...prev,
              latestCollectionRun: res.run,
              repositorySnapshots: [...(prev.repositorySnapshots ?? []), res.snapshot!].slice(-MAX_RETAINED_SNAPSHOTS),
            }));
          }
        } catch (err) {
          console.warn('[ChangeAttribution] Pre-verification snapshot failed safely:', err);
        }

        verificationRuntimeRef.current = {
          workspaceId: wsId,
          terminalTabId: tab.id,
          terminalPaneId: paneId,
          terminalSessionId: targetSessionId ?? undefined,
          targetSessionId: targetSessionId ?? undefined,
          runId: newRun.id,
          profileId: contract.id,
          criteriaSnapshot: newRun.criteriaSnapshot,
          criterionResults: newRun.criterionResults,
          currentCriterionIndex: 0,
          currentCriterionId: newRun.criteriaSnapshot[0].id,
          expectedCriterionId: newRun.criteriaSnapshot[0].id,
          lifecycle: 'running',
          cancelled: false,
          beforeSnapshot,
        };
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);

        setWorkspaces((prev) => {
          const next = prev.map((w) =>
            w.id === wsId ? appendVerificationRunToWorkspace(w, newRun) : w,
          );
          workspacesRef.current = next;
          return next;
        });

        const startLabel =
          newRun.criteriaSnapshot.length === 1
            ? newRun.criteriaSnapshot[0].label
            : contract.name;
        showTranscriptFeedback(`Starting verification: ${startLabel}`, 'success');

        advanceVerificationRuntime(
          wsId,
          tab.id,
          paneId,
          newRun.id,
          newRun.criteriaSnapshot[0],
        );
      })();
    },
    [advanceVerificationRuntime, showTranscriptFeedback, updateWorkspace],
  );

  const handleStopVerification = useCallback(
    (workspaceId?: string) => {
      const wsId = workspaceId ?? activeWorkspaceIdRef.current;
      const runtime = verificationRuntimeRef.current;
      if (!runtime || runtime.workspaceId !== wsId) {
        return;
      }

      // Repeated Stop protection (Section 21)
      if (
        runtime.lifecycle === 'stopping' ||
        runtime.lifecycle === 'stop-timeout' ||
        runtime.cancelled
      ) {
        return;
      }

      const activeExecId =
        runtime.currentExecutionId ?? runtime.expectedExecutionId;

      // Section 16: Check if current execution has already completed!
      if (activeExecId) {
        const ws = workspacesRef.current.find((w) => w.id === wsId);
        const completedBlock = ws?.capture.blocks.find(
          (b) =>
            (b.id === activeExecId || b.executionId === activeExecId) &&
            b.isComplete,
        );
        if (completedBlock) {
          // Reconcile completion immediately! Do NOT send Ctrl+C! Do NOT enter STOPPING!
          handleVerificationExecutionCompleted(completedBlock);
          return;
        }
      }

      // If no active execution in flight, cancel cleanly immediately without Ctrl+C
      if (!activeExecId) {
        if (runtime.stopFallbackTimer) {
          clearTimeout(runtime.stopFallbackTimer);
          runtime.stopFallbackTimer = null;
        }
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);
        verificationRuntimeRef.current = null;

        setWorkspaces((prev) => {
          const currentWs = prev.find((w) => w.id === wsId);
          if (!currentWs) return prev;
          const currentRun = currentWs.verification?.runs.find(
            (r) => r.id === runtime.runId,
          );
          if (!currentRun) return prev;
          const cancelledRun: VerificationRun = {
            ...currentRun,
            status: 'cancelled',
            completedAt: Date.now(),
          };
          const next = prev.map((w) =>
            w.id === wsId ? updateVerificationRunInWorkspace(w, cancelledRun) : w,
          );
          workspacesRef.current = next;
          return next;
        });
        showTranscriptFeedback('Verification stopped', 'success');
        return;
      }

      runtime.lifecycle = 'stopping';
      runtime.cancelled = true;
      runtime.stopRequestedAt = Date.now();
      setIsVerificationStopping(true);

      if (runtime.advanceTimer) {
        clearTimeout(runtime.advanceTimer);
        runtime.advanceTimer = null;
      }

      showTranscriptFeedback('Stopping verification…', 'error');

      // Resolve exact target terminal session (Section 5)
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      const tab = ws?.terminalTabs.find((t) => t.id === runtime.terminalTabId);
      const pane = tab?.panes.find((p) => p.id === runtime.terminalPaneId);
      const targetSessionId =
        runtime.terminalSessionId ??
        runtime.targetSessionId ??
        terminalRefs.current.get(runtime.terminalPaneId)?.getSessionId() ??
        pane?.session?.sessionId;

      if (!targetSessionId) {
        if (runtime.stopFallbackTimer) {
          clearTimeout(runtime.stopFallbackTimer);
          runtime.stopFallbackTimer = null;
        }
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(false);
        verificationRuntimeRef.current = null;

        setWorkspaces((prev) => {
          const currentWs = prev.find((w) => w.id === wsId);
          if (!currentWs) return prev;
          const currentRun = currentWs.verification?.runs.find(
            (r) => r.id === runtime.runId,
          );
          if (!currentRun) return prev;
          const cancelledRun: VerificationRun = {
            ...currentRun,
            status: 'cancelled',
            completedAt: Date.now(),
          };
          return prev.map((w) =>
            w.id === wsId ? updateVerificationRunInWorkspace(w, cancelledRun) : w,
          );
        });
        showTranscriptFeedback('Verification stopped', 'success');
        return;
      }

      // Send ETX (\x03 / Ctrl+C) to exact PTY session
      terminalApi
        .write({
          sessionId: targetSessionId,
          data: [3],
        })
        .catch((err) => {
          console.warn('[Verification] Failed to write ETX to terminal session:', err);
        });

      if (runtime.terminalPaneId && runtime.terminalTabId) {
        try {
          handleTerminalInput(wsId, runtime.terminalTabId, runtime.terminalPaneId, '\x03');
        } catch {
          // ignore
        }
      }

      // Update workspace run status to 'stopping' (Section 9, 14, 18)
      setWorkspaces((prev) => {
        const currentWs = prev.find((w) => w.id === wsId);
        if (!currentWs) return prev;
        const currentRun = currentWs.verification?.runs.find((r) => r.id === runtime.runId);
        if (!currentRun) return prev;

        const stoppingRun: VerificationRun = {
          ...currentRun,
          status: 'stopping',
        };
        return prev.map((w) =>
          w.id === wsId ? updateVerificationRunInWorkspace(w, stoppingRun) : w,
        );
      });

      // Section 7, 10: Grace timeout does NOT finalize as cancelled!
      // Transitions to explicit 'stop-timeout' (still running) state, retaining runtime ownership.
      runtime.stopFallbackTimer = setTimeout(() => {
        const currentRt = verificationRuntimeRef.current;
        if (!currentRt || currentRt.runId !== runtime.runId || currentRt.lifecycle !== 'stopping') {
          return;
        }

        currentRt.lifecycle = 'stop-timeout';
        setIsVerificationStopping(false);
        setIsVerificationStopTimeout(true);

        setWorkspaces((prev) => {
          const currentWs = prev.find((w) => w.id === wsId);
          if (!currentWs) return prev;
          const currentRun = currentWs.verification?.runs.find((r) => r.id === runtime.runId);
          if (!currentRun) return prev;

          const timeoutRun: VerificationRun = {
            ...currentRun,
            status: 'stop-timeout',
          };
          return prev.map((w) =>
            w.id === wsId ? updateVerificationRunInWorkspace(w, timeoutRun) : w,
          );
        });

        showTranscriptFeedback('Verification command is still running', 'error');
      }, 4000);
    },
    [showTranscriptFeedback, handleTerminalInput, handleVerificationExecutionCompleted],
  );

  const handleCancelVerification = handleStopVerification;

  // Profile & Criteria Management Handlers (HARDEN-012B)
  const handleSelectVerificationProfile = useCallback(
    (contractId: string) => {
      const wsId = activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;
      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) {
        showTranscriptFeedback('Cannot switch profile while verification is in progress', 'error');
        return;
      }
      updateWorkspace(wsId, (prev) =>
        setActiveVerificationContractInWorkspace(prev, contractId),
      );
    },
    [updateWorkspace, showTranscriptFeedback],
  );

  const handleCreateVerificationProfile = useCallback(
    (name: string) => {
      const wsId = activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;
      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) {
        showTranscriptFeedback('Cannot create profile while verification is in progress', 'error');
        return;
      }
      const newContract = createVerificationContract({
        workspaceId: wsId,
        name: name.trim(),
        criteria: [],
      });
      updateWorkspace(wsId, (prev) =>
        addVerificationContractToWorkspace(prev, newContract),
      );
      showTranscriptFeedback('Verification profile created.', 'success');
    },
    [updateWorkspace, showTranscriptFeedback],
  );

  const handleRenameVerificationProfile = useCallback(
    (contractId: string, newName: string) => {
      const wsId = activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;
      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) {
        showTranscriptFeedback('Cannot rename profile while verification is in progress', 'error');
        return;
      }
      updateWorkspace(wsId, (prev) =>
        renameVerificationContractInWorkspace(prev, contractId, newName),
      );
      showTranscriptFeedback('Verification profile saved.', 'success');
    },
    [updateWorkspace, showTranscriptFeedback],
  );

  const handleDeleteVerificationProfile = useCallback(
    (contractId: string) => {
      const wsId = activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;
      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) {
        showTranscriptFeedback('Cannot delete profile while verification is in progress', 'error');
        return;
      }
      updateWorkspace(wsId, (prev) =>
        deleteVerificationContractFromWorkspace(prev, contractId),
      );
      showTranscriptFeedback('Verification profile deleted.', 'success');
    },
    [updateWorkspace, showTranscriptFeedback],
  );

  const handleAddVerificationCriterion = useCallback(
    (
      contractId: string,
      criterionParams: {
        label: string;
        command: string;
        workingDirectory?: string;
        expectedExitCodes?: number[];
      },
    ) => {
      const wsId = activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;
      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) {
        showTranscriptFeedback('Cannot edit checks while verification is in progress', 'error');
        return;
      }
      const contract = ws.verification?.contracts.find((c) => c.id === contractId);
      const nextOrder = (contract?.criteria.length ?? 0) + 1;
      const criterion = createVerificationCriterion({
        label: criterionParams.label,
        command: criterionParams.command,
        workingDirectory: criterionParams.workingDirectory,
        expectedExitCodes: criterionParams.expectedExitCodes ?? [0],
        order: nextOrder,
      });
      updateWorkspace(wsId, (prev) =>
        addCriterionToContractInWorkspace(prev, contractId, criterion),
      );
      showTranscriptFeedback('Verification check added.', 'success');
    },
    [updateWorkspace, showTranscriptFeedback],
  );

  const handleUpdateVerificationCriterion = useCallback(
    (contractId: string, criterion: VerificationCriterion) => {
      const wsId = activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;
      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) {
        showTranscriptFeedback('Cannot edit checks while verification is in progress', 'error');
        return;
      }
      updateWorkspace(wsId, (prev) =>
        updateCriterionInContractInWorkspace(prev, contractId, criterion),
      );
      showTranscriptFeedback('Verification check saved.', 'success');
    },
    [updateWorkspace, showTranscriptFeedback],
  );

  const handleDeleteVerificationCriterion = useCallback(
    (contractId: string, criterionId: string) => {
      const wsId = activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;
      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) {
        showTranscriptFeedback('Cannot edit checks while verification is in progress', 'error');
        return;
      }

      const targetContract =
        ws.verification?.contracts.find((c) => c.id === contractId) ??
        getActiveVerificationContract(ws);
      const criterionExists = targetContract?.criteria.some((c) => c.id === criterionId);

      if (!criterionExists) {
        showTranscriptFeedback('Could not delete verification check: check not found', 'error');
        return;
      }

      updateWorkspace(wsId, (prev) =>
        deleteCriterionFromContractInWorkspace(prev, contractId, criterionId),
      );

      showTranscriptFeedback('Verification check deleted.', 'success');
    },
    [updateWorkspace, showTranscriptFeedback],
  );

  const handleReorderVerificationCriteria = useCallback(
    (contractId: string, orderedCriterionIds: string[]) => {
      const wsId = activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;
      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) return;
      updateWorkspace(wsId, (prev) =>
        reorderCriteriaInContractInWorkspace(prev, contractId, orderedCriterionIds),
      );
    },
    [updateWorkspace],
  );

  const handleToggleSelectVerificationCriterion = useCallback(
    (criterionId: string) => {
      const wsId = activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;
      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) return;
      updateWorkspace(wsId, (prev) =>
        toggleCriterionSelectionInWorkspace(prev, criterionId),
      );
    },
    [updateWorkspace],
  );

  const handleSelectAllVerificationCriteria = useCallback(() => {
    const wsId = activeWorkspaceIdRef.current;
    const ws = workspacesRef.current.find((w) => w.id === wsId);
    if (!ws) return;
    if (isVerificationRuntimeActive(verificationRuntimeRef.current)) return;
    updateWorkspace(wsId, (prev) => selectAllCriteriaInWorkspace(prev));
  }, [updateWorkspace]);

  const handleClearVerificationCriteriaSelection = useCallback(() => {
    const wsId = activeWorkspaceIdRef.current;
    const ws = workspacesRef.current.find((w) => w.id === wsId);
    if (!ws) return;
    if (isVerificationRuntimeActive(verificationRuntimeRef.current)) return;
    updateWorkspace(wsId, (prev) => clearCriteriaSelectionInWorkspace(prev));
  }, [updateWorkspace]);

  const handleClearVerificationHistory = useCallback(
    (workspaceId?: string) => {
      const wsId = workspaceId ?? activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;

      // Active runtime clear guard (Section 1, 8):
      // If runtime lifecycle is running, stopping, or stop-timeout, do not clear history.
      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) {
        return;
      }

      setWorkspaces((prev) => {
        const next = prev.map((w) =>
          w.id === wsId ? clearWorkspaceVerificationRuns(w) : w,
        );
        workspacesRef.current = next;
        return next;
      });

      savePersistedWorkspaceState({
        workspaces: workspacesRef.current,
        activeWorkspaceId: activeWorkspaceIdRef.current,
        activeMonitorView,
      });
    },
    [activeMonitorView],
  );

  const handleContinueUnfinishedVerification = useCallback(
    async (previousRun: VerificationRun) => {
      const wsId = activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) {
        showTranscriptFeedback('Cannot continue verification: workspace not found', 'error');
        return;
      }

      if (isVerificationRuntimeActive(verificationRuntimeRef.current)) {
        showTranscriptFeedback('A verification run is already in progress', 'error');
        return;
      }

      const tab = ws.terminalTabs.find((t) => t.id === ws.activeTerminalTabId);
      if (!tab) {
        showTranscriptFeedback('Cannot run verification: active terminal tab not found', 'error');
        return;
      }
      const paneId = tab.activePaneId;

      const newRun = createContinuationVerificationRun({
        previousRun,
        workspaceId: wsId,
      });

      if (newRun.criteriaSnapshot.length === 0) {
        showTranscriptFeedback('No unfinished checks to continue', 'error');
        return;
      }

      const activePane = tab.panes.find((p) => p.id === paneId);
      const cwd = activePane?.session.sessionInfo?.cwd ?? undefined;
      const targetSessionId =
        terminalRefs.current.get(paneId)?.getSessionId() ??
        activePane?.session?.sessionId;

      let beforeSnapshot: RepositorySnapshot | null = null;
      try {
        const res = await collectRepositoryEvidence({
          workspaceId: wsId,
          cwd,
        });
        if (res.snapshot) {
          beforeSnapshot = res.snapshot;
          updateWorkspace(wsId, (prev) => ({
            ...prev,
            latestCollectionRun: res.run,
            repositorySnapshots: [...(prev.repositorySnapshots ?? []), res.snapshot!].slice(-MAX_RETAINED_SNAPSHOTS),
          }));
        }
      } catch (err) {
        console.warn('[ChangeAttribution] Pre-verification snapshot failed safely:', err);
      }

      verificationRuntimeRef.current = {
        workspaceId: wsId,
        terminalTabId: tab.id,
        terminalPaneId: paneId,
        terminalSessionId: targetSessionId ?? undefined,
        targetSessionId: targetSessionId ?? undefined,
        runId: newRun.id,
        profileId: newRun.contractId ?? 'continuation',
        criteriaSnapshot: newRun.criteriaSnapshot,
        criterionResults: newRun.criterionResults,
        currentCriterionIndex: 0,
        currentCriterionId: newRun.criteriaSnapshot[0].id,
        expectedCriterionId: newRun.criteriaSnapshot[0].id,
        lifecycle: 'running',
        cancelled: false,
        beforeSnapshot,
      };
      setIsVerificationStopping(false);
      setIsVerificationStopTimeout(false);

      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === wsId ? appendVerificationRunToWorkspace(w, newRun) : w,
        ),
      );

      showTranscriptFeedback(`Continuing unfinished verification (${newRun.criteriaSnapshot.length} checks)`, 'success');

      advanceVerificationRuntime(
        wsId,
        tab.id,
        paneId,
        newRun.id,
        newRun.criteriaSnapshot[0],
      );
    },
    [advanceVerificationRuntime, showTranscriptFeedback, updateWorkspace],
  );

  const [isCollectingRepo, setIsCollectingRepo] = useState(false);

  const handleRefreshRepositoryEvidence = useCallback(
    async (workspaceId?: string) => {
      const wsId = workspaceId ?? activeWorkspaceIdRef.current;
      const ws = workspacesRef.current.find((w) => w.id === wsId);
      if (!ws) return;

      const repoRoot = ws.repository?.rootPath;
      if (!repoRoot) return;

      setIsCollectingRepo(true);
      try {
        const { run, snapshot } = await collectRepositoryEvidence({
          workspaceId: wsId,
          repositoryRoot: repoRoot,
        });

        updateWorkspace(wsId, (prev) => {
          const nextSnapshots = snapshot
            ? [...(prev.repositorySnapshots ?? []), snapshot]
            : prev.repositorySnapshots;

          return {
            ...prev,
            latestCollectionRun: run,
            repositorySnapshots: nextSnapshots,
          };
        });
      } catch (err) {
        console.warn('Repository evidence collection failed:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        const failedRun = {
          id: `col-run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          workspaceId: wsId,
          repositoryRoot: repoRoot,
          collectorIds: [],
          status: 'failed' as const,
          errorMessage: errMsg,
          startedAt: Date.now(),
          completedAt: Date.now(),
        };
        updateWorkspace(wsId, (prev) => ({
          ...prev,
          latestCollectionRun: failedRun,
        }));
      } finally {
        setIsCollectingRepo(false);
      }
    },
    [updateWorkspace],
  );

  const handleOpenFolder = useCallback(
    async (targetWorkspaceId?: LogicalWorkspaceId): Promise<LogicalWorkspace | null> => {
      try {
        const selectedPath = await openFolderPicker();
        if (!selectedPath || selectedPath.trim().length === 0) {
          // Cancellation is a clean no-op: create no Workspace, switch no Workspace, show no error toast, preserve current Workspace
          return null;
        }

        const cleanPath = selectedPath.trim();
        const detectedRepo = await detectRepositoryContext(cleanPath);
        const folderName = resolveWorkspaceFolderBasename(cleanPath);

        // Case 1: Target existing unbound workspace (e.g. from Changes CTA or tab button)
        if (targetWorkspaceId) {
          const targetWs = workspacesRef.current.find((w) => w.id === targetWorkspaceId);
          if (targetWs) {
            updateWorkspace(targetWorkspaceId, (prev) => {
              const updated = bindWorkspaceRootPath(prev, cleanPath, detectedRepo);
              return {
                ...updated,
                name: prev.rootPath ? prev.name : folderName,
              };
            });
            setActiveWorkspaceId(targetWorkspaceId);

            if (detectedRepo?.rootPath) {
              handleRefreshRepositoryEvidence(targetWorkspaceId);
            }

            return workspacesRef.current.find((w) => w.id === targetWorkspaceId) ?? null;
          }
        }

        // Case 2: Create new workspace bound to selected folder (from Workspace + or Open Folder button)
        const newWs = createWorkspace({
          name: folderName,
          rootPath: cleanPath,
          repository: detectedRepo,
          activate: true,
        });

        if (detectedRepo?.rootPath) {
          handleRefreshRepositoryEvidence(newWs.id);
        }

        return newWs;
      } catch (err) {
        console.error('[WorkspaceContext] Folder picker failed:', err);
        showTranscriptFeedback(
          `Failed to open project folder: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
        return null;
      }
    },
    [
      createWorkspace,
      updateWorkspace,
      handleRefreshRepositoryEvidence,
      showTranscriptFeedback,
    ],
  );



  const transcriptProps: PanelLayoutTranscriptProps = {
    blocks: activeWorkspace?.capture.blocks ?? [],
    currentBatchId: currentBatchId,
    currentBatchBlockCount: currentBatchBlocks.length,
    selectedBlockIds:
      activeTerminalPane?.selection.selectedBlockIds.size &&
      activeTerminalPane.selection.selectedBlockIds.size > 0
        ? activeTerminalPane.selection.selectedBlockIds
        : activeWorkspace?.selection.selectedBlockIds ?? new Set<string>(),
    feedback: transcriptFeedback,
    isListening: aggregateCaptureStatus === 'capturing',
    captureStatus: aggregateCaptureStatus,
    isTargetSelectorLocked,
    onToggleListening: () =>
      activeWorkspace &&
      activeTerminalTab &&
      handleToggleListening(activeWorkspace.id, activeTerminalTab.id),
    onStartCapture: () =>
      activeWorkspace &&
      activeTerminalTab &&
      handleStartCaptureGroup(activeWorkspace.id, activeTerminalTab.id),
    onPauseCapture: () =>
      activeWorkspace &&
      activeTerminalTab &&
      handlePauseCaptureGroup(activeWorkspace.id, activeTerminalTab.id),
    onResumeCapture: () =>
      activeWorkspace &&
      activeTerminalTab &&
      handleResumeCaptureGroup(activeWorkspace.id, activeTerminalTab.id),
    onStopCapture: () =>
      activeWorkspace &&
      activeTerminalTab &&
      handleStopCaptureGroup(activeWorkspace.id, activeTerminalTab.id),
    onToggleSelectCapturePane: (paneId: string) =>
      activeWorkspace &&
      activeTerminalTab &&
      handleToggleSelectCapturePane(
        activeWorkspace.id,
        activeTerminalTab.id,
        paneId,
      ),
    onSelectAllCapturePanes: (all: boolean) =>
      activeWorkspace &&
      activeTerminalTab &&
      handleSelectAllCapturePanes(
        activeWorkspace.id,
        activeTerminalTab.id,
        all,
      ),
    onToggleSelect: (blockId: string) =>
      activeWorkspace && handleToggleSelect(activeWorkspace.id, blockId),
    onSelectAllVisible: () =>
      activeWorkspace && handleSelectAllVisible(activeWorkspace.id),
    onClearSelection: () =>
      activeWorkspace && handleClearSelection(activeWorkspace.id),
    onCopyBlock: handleCopyBlock,
    onCopyCurrentBatch: () =>
      activeWorkspace && handleCopyCurrentBatch(activeWorkspace.id),
    onCopySelected: () =>
      activeWorkspace && handleCopySelected(activeWorkspace.id),
    onDeleteBlock: (blockId: string) =>
      activeWorkspace && handleDeleteBlock(activeWorkspace.id, blockId),
    onDeleteSelected: () =>
      activeWorkspace && handleDeleteSelected(activeWorkspace.id),
    onRerunCommand: handleRerunCommand,
    verificationContract: activeWorkspace
      ? getActiveVerificationContract(activeWorkspace)
      : undefined,
    verificationContracts: activeWorkspace
      ? getWorkspaceContracts(activeWorkspace)
      : [],
    activeVerificationRun: activeWorkspace
      ? getActiveVerificationRun(activeWorkspace)
      : null,
    latestVerificationRun: activeWorkspace
      ? getLatestVerificationRun(activeWorkspace)
      : null,
    historicalVerificationRuns: activeWorkspace
      ? getWorkspaceVerificationRuns(activeWorkspace)
      : [],
    isVerificationRunning: Boolean(
      activeWorkspace &&
        getActiveVerificationRun(activeWorkspace)?.status === 'running',
    ),
    isVerificationStopping:
      isVerificationStopping ||
      Boolean(
        activeWorkspace &&
          getActiveVerificationRun(activeWorkspace)?.status === 'stopping',
      ),
    isVerificationStopTimeout:
      isVerificationStopTimeout ||
      Boolean(
        activeWorkspace &&
          getActiveVerificationRun(activeWorkspace)?.status === 'stop-timeout',
      ),
    selectedVerificationCriterionIds: activeWorkspace
      ? getCanonicalVerificationSelection(activeWorkspace)
      : undefined,
    onToggleSelectVerificationCriterion: handleToggleSelectVerificationCriterion,
    onSelectAllVerificationCriteria: handleSelectAllVerificationCriteria,
    onClearVerificationCriteriaSelection: handleClearVerificationCriteriaSelection,
    onRunVerification: (criterionIds?: string[]) => handleRunVerification(activeWorkspace?.id, criterionIds),
    onCancelVerification: () => handleCancelVerification(activeWorkspace?.id),
    onStopVerification: () => handleStopVerification(activeWorkspace?.id),
    onContinueUnfinished: handleContinueUnfinishedVerification,
    onSelectVerificationExecution: (execId: string) => {
      if (activeWorkspace) {
        handleToggleSelect(activeWorkspace.id, execId);
      }
    },
    onSelectVerificationProfile: handleSelectVerificationProfile,
    onCreateVerificationProfile: handleCreateVerificationProfile,
    onRenameVerificationProfile: handleRenameVerificationProfile,
    onDeleteVerificationProfile: handleDeleteVerificationProfile,
    onAddVerificationCriterion: handleAddVerificationCriterion,
    onUpdateVerificationCriterion: handleUpdateVerificationCriterion,
    onDeleteVerificationCriterion: handleDeleteVerificationCriterion,
    onReorderVerificationCriteria: handleReorderVerificationCriteria,
    onClearRunHistory: () => handleClearVerificationHistory(activeWorkspace?.id),
    repositorySnapshot:
      activeWorkspace?.repositorySnapshots && activeWorkspace.repositorySnapshots.length > 0
        ? activeWorkspace.repositorySnapshots[activeWorkspace.repositorySnapshots.length - 1]
        : null,
    latestCollectionRun: activeWorkspace?.latestCollectionRun ?? null,
    isCollectingRepositoryEvidence: isCollectingRepo,
    onRefreshRepositoryEvidence: () => handleRefreshRepositoryEvidence(activeWorkspace?.id),
    changeAttributions: activeWorkspace?.changeAttributions ?? [],
    agentRuns: [],
    activeAgentRun: null,
    onVerifyAgentRun: () => {},
    onCancelAgentRun: () => {},
    onStartAgentRun: () => {},
    activeMonitorView,
    onSelectMonitorView: (view: MonitorView) => {
      if (isMonitorViewEnabled(view, capabilities)) {
        setActiveMonitorView(view);
      }
    },
    isMonitorFocused,
    onToggleMonitorFocus: () => setIsMonitorFocused((prev) => !prev),
    activeWorkspaceSurface: activeSurface,
    workspaceName: activeWorkspace?.name,
    workspaceRootPath: activeWorkspace?.rootPath,
    repositoryRoot: activeWorkspace?.repository?.rootPath,
    repositoryBranch: activeWorkspace?.repository?.branch,
    onOpenFolder: () => handleOpenFolder(activeWorkspace?.id),
  };

  if (!activeWorkspace || !activeTerminalTab || !activeTerminalPane) {
    return (
      <main className="workspace">
        <div className="terminal-pane-alert" role="alert">
          <span className="alert-text">
            Active workspace, terminal tab, or terminal pane not found.
          </span>
        </div>
      </main>
    );
  }

  return (
    <ProductEditionProvider>
      <div className="app-layout">
      {/* Row 1: Workspace Tab Bar */}
      <WorkspaceTabBar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={setActiveWorkspace}
        onCreateWorkspace={() => handleOpenFolder()}
        onOpenFolder={handleOpenFolder}
        onRequestDeleteWorkspace={requestDeleteWorkspace}
        onRenameWorkspace={renameWorkspace}
      />

      {/* Global Warning Banner: Active Application/Workspace Warning Stack */}
      <GlobalWarningBanner
        warnings={globalWarnings}
        activeWorkspaceId={activeWorkspaceId}
        onDismiss={dismissGlobalWarningAction}
      />

      {/* Row 2: Terminal Tabs for Active Workspace */}
      <WorkspaceTabs
        workspaceId={activeWorkspace.id}
        tabs={activeWorkspace.terminalTabs}
        activeTabId={activeWorkspace.activeTerminalTabId}
        onSelectTab={handleSelectTerminalTab}
        onCreateTab={handleCreateTerminalTab}
        onCloseTab={handleCloseTerminalTab}
        onRenameTab={(tabId, name) =>
          renameTerminalTab(activeWorkspace.id, tabId, name)
        }
        renameTerminalTab={renameTerminalTab}
        blocks={activeWorkspace.capture.blocks}
        panes={activeWorkspace.panes}
        isCapturePanelOpen={
          activeWorkspace.terminalTabs.find(
            (t) => t.id === activeWorkspace.activeTerminalTabId,
          )?.isCapturePanelOpen ?? true
        }
        onToggleCapturePanel={() =>
          handleToggleCapturePanel(
            activeWorkspace.id,
            activeWorkspace.activeTerminalTabId,
          )
        }
        onOpenShortcutSettings={() => setIsShortcutSettingsOpen(true)}
      />

      {/* Main Area: Terminals & Transcript Capture Panel */}
      <section className="workspace-grid" style={{ flex: '1 1 0%', minHeight: 0 }}>
        <section className="terminal-panel" aria-label="Terminal">

          <div className="terminal-content-area">
            {workspaces.map((ws) => {
              const isWorkspaceActive = ws.id === activeWorkspaceId;
              return (
                <div
                  key={ws.id}
                  id={`terminal-workspace-${ws.id}`}
                  className={
                    isWorkspaceActive
                      ? 'terminal-workspace-container terminal-workspace-container--active'
                      : 'terminal-workspace-container terminal-workspace-container--inactive'
                  }
                >
                  {ws.terminalTabs.map((tab) => {
                    const isTabActive =
                      isWorkspaceActive && tab.id === ws.activeTerminalTabId;

                    return (
                      <section
                        key={tab.id}
                        id={`terminal-panel-${ws.id}-${tab.id}`}
                        role="tabpanel"
                        aria-labelledby={`terminal-tab-${tab.id}`}
                        className={
                          isTabActive
                            ? 'terminal-tab-pane terminal-tab-pane--active'
                            : 'terminal-tab-pane terminal-tab-pane--inactive'
                        }
                      >
                        <TerminalPaneLayout
                          workspaceId={ws.id}
                          tab={tab}
                          isTabActive={isTabActive}
                          terminalRefs={terminalRefs}
                          onSetActivePane={(paneId) =>
                            setActivePane(ws.id, tab.id, paneId)
                          }
                          onSplitPaneRight={(paneId) =>
                            splitPaneRight(ws.id, tab.id, paneId)
                          }
                          onSplitPaneDown={(paneId) =>
                            splitPaneDown(ws.id, tab.id, paneId)
                          }
                          onClosePane={(paneId) =>
                            requestCloseTerminalPane(ws.id, tab.id, paneId)
                          }
                          onRenamePane={handleRenameTerminalPane}
                          onResizePaneLayout={(splitRatio) =>
                            resizePaneLayout(ws.id, tab.id, splitRatio)
                          }
                          onResizeSplit={(splitId, splitRatio) =>
                            resizeSplit(ws.id, tab.id, splitId, splitRatio)
                          }
                          onRetryCapture={(paneId) =>
                            handleRetryCapture(ws.id, tab.id, paneId)
                          }
                          onDismissCaptureWarning={dismissCaptureWarningAction}
                          onStatusChange={handleStatusChange}
                          onTerminalInput={handleTerminalInput}
                          onTerminalOutput={handleTerminalOutput}
                          onSessionEnded={handleSessionEnded}
                          transcriptProps={transcriptProps}
                          terminalPaneToast={isTabActive ? terminalPaneToast : null}
                          isCapturePanelOpen={tab.isCapturePanelOpen ?? true}
                          capturePanelWidth={tab.capturePanelWidth ?? 400}
                          onResizeCaptureWidth={(width) =>
                            handleResizeCaptureWidth(ws.id, tab.id, width)
                          }
                        />
                      </section>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      </section>

      {/* Delete Workspace Confirmation Modal */}
      {pendingDeleteWorkspace && (
        <WorkspaceDeleteModal
          workspace={pendingDeleteWorkspace}
          onCancel={() => setPendingDeleteWorkspaceId(null)}
          onConfirm={confirmDeleteWorkspace}
        />
      )}

      {/* Close Captured Pane Confirmation Modal */}
      {pendingCloseCapturedPane && (
        <CloseCapturedPaneModal
          impact={pendingCloseCapturedPane.impact}
          onCancel={() => {
            const paneId = pendingCloseCapturedPane.paneId;
            setPendingCloseCapturedPane(null);
            setTimeout(() => {
              terminalRefs.current.get(paneId)?.focus();
            }, 50);
          }}
          onConfirm={() =>
            confirmCloseCapturedPane(
              pendingCloseCapturedPane.workspaceId,
              pendingCloseCapturedPane.terminalTabId,
              pendingCloseCapturedPane.paneId,
            )
          }
        />
      )}

      {/* Keyboard Shortcuts Settings Modal */}
      <ShortcutSettingsModal
        isOpen={isShortcutSettingsOpen}
        onClose={() => setIsShortcutSettingsOpen(false)}
        registry={defaultShortcutRegistry}
        onRecordingStateChange={setIsShortcutRecorderActive}
      />
      </div>
    </ProductEditionProvider>
  );
}

export default App;
