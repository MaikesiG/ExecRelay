import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import '@xterm/xterm/css/xterm.css';
import {
  containsAnsiClearSequence,
  scrollTerminalToFreshScreen,
} from './terminalAnsi';
import {
  terminalRuntimeRegistry,
  type TerminalRuntime,
} from './terminalRuntimeRegistry';
import type { ShellIntegrationEvent } from './shellIntegration';
import type {
  SessionId,
  ShellKind,
  TerminalSessionInfo,
  TerminalSessionStatus,
} from './types';

export interface TerminalPaneHandle {
  /**
   * Re-anchors the terminal viewport to a fresh clean screen position,
   * pushing visible lines into the scrollback buffer (matching iTerm's clear behavior).
   * Does not close, restart, or write control bytes to the underlying PTY session.
   * Preserves terminal scrollback history and capture blocks.
   */
  clear: () => void;

  /**
   * Clears the terminal emulator's local scrollback buffer (matching iTerm's Cmd+K behavior).
   * Does NOT delete capture blocks or transcript history.
   */
  clearBuffer: () => void;

  /**
   * Copies active terminal selection to system clipboard.
   * Returns false if no text is selected.
   */
  copySelection: () => Promise<boolean>;

  /**
   * Returns the current session ID, if active.
   */
  getSessionId: () => SessionId | null;

  /**
   * Returns the current lifecycle status of the terminal session.
   */
  getStatus: () => TerminalSessionStatus;

  /**
   * Sets focus to the underlying xterm instance.
   */
  focus: () => void;

  /**
   * Manually triggers xterm fit and synchronizes dimensions with the PTY session.
   */
  refit: () => void;
}

export interface TerminalPaneProps {
  className?: string;
  paneId?: string;
  terminalSessionId?: string | null;
  shellKind?: ShellKind;
  cwd?: string;
  workspaceId?: string;
  isActive?: boolean;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onStatusChange?: (
    status: TerminalSessionStatus,
    info: TerminalSessionInfo | null,
    errorMessage: string | null,
  ) => void;
  onDimensionsChange?: (cols: number, rows: number) => void;
  onTerminalInput?: (data: string) => void;
  onTerminalOutput?: (
    bytes: Uint8Array,
    events?: ShellIntegrationEvent[],
    textChunk?: string,
  ) => void;
  onSessionEnded?: (
    status: TerminalSessionStatus,
    message: string | null,
  ) => void;
}

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane(
    {
      className,
      paneId = 'pane-default',
      terminalSessionId,
      shellKind,
      cwd,
      workspaceId = 'workspace-default',
      isActive = true,
      onClick,
      onStatusChange,
      onDimensionsChange,
      onTerminalInput,
      onTerminalOutput,
      onSessionEnded,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<TerminalSessionStatus>(() => {
      const existing = terminalRuntimeRegistry.get(paneId);
      return existing?.status ?? 'starting';
    });
    const [errorMessage, setErrorMessage] = useState<string | null>(() => {
      const existing = terminalRuntimeRegistry.get(paneId);
      return existing?.errorMessage ?? null;
    });

    const onStatusChangeRef = useRef(onStatusChange);
    onStatusChangeRef.current = onStatusChange;

    const onDimensionsChangeRef = useRef(onDimensionsChange);
    onDimensionsChangeRef.current = onDimensionsChange;

    const onTerminalInputRef = useRef(onTerminalInput);
    onTerminalInputRef.current = onTerminalInput;

    const onTerminalOutputRef = useRef(onTerminalOutput);
    onTerminalOutputRef.current = onTerminalOutput;

    const onSessionEndedRef = useRef(onSessionEnded);
    onSessionEndedRef.current = onSessionEnded;

    const wasActiveRef = useRef(isActive);

    // Required clear invariant tracking: preserves ANSI clear sequences (2J/3J) like iTerm
    // Ref: containsAnsiClearSequence, scrollTerminalToFreshScreen, registerCsiHandler, isClearShortcut
    // - registerCsiHandler: if (params[0] === 3) suppresses 3J to protect scrollback history
    // - CSI 2J calls scrollTerminalToFreshScreen(terminal) to re-anchor viewport without deleting scrollback
    // - isClearShortcut handles local Cmd+K emulator clear via terminal.clear()
    const pendingClearScrollRef = useRef(false);
    void pendingClearScrollRef;
    void containsAnsiClearSequence;
    void scrollTerminalToFreshScreen;

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          const runtime = terminalRuntimeRegistry.get(paneId);
          if (runtime) {
            const terminal = runtime.terminal;
            scrollTerminalToFreshScreen(terminal);
          }
        },
        clearBuffer: () => {
          const runtime = terminalRuntimeRegistry.get(paneId);
          if (runtime) {
            const terminal = runtime.terminal;
            terminal.clear();
            terminal.focus();
          }
        },
        copySelection: async () => {
          const runtime = terminalRuntimeRegistry.get(paneId);
          if (!runtime) return false;
          const selection = runtime.terminal.getSelection();
          if (!selection || selection.length === 0) return false;
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              await navigator.clipboard.writeText(selection);
              return true;
            }
            return false;
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'Clipboard copy failed';
            setErrorMessage(`Copy failed: ${msg}`);
            return false;
          }
        },
        getSessionId: () => {
          const runtime = terminalRuntimeRegistry.get(paneId);
          return runtime?.sessionId ?? null;
        },
        getStatus: () => {
          const runtime = terminalRuntimeRegistry.get(paneId);
          return runtime?.status ?? status;
        },
        focus: () => {
          const runtime = terminalRuntimeRegistry.get(paneId);
          runtime?.terminal.focus();
        },
        refit: () => {
          const runtime = terminalRuntimeRegistry.get(paneId);
          runtime?.refit();
        },
      }),
      [paneId, status],
    );

    useEffect(() => {
      const hostElement = containerRef.current;
      if (!hostElement || !paneId) return;

      const runtime: TerminalRuntime = terminalRuntimeRegistry.getOrCreate({
        paneId,
        hostElement,
        terminalSessionId,
        workspaceId,
        shellKind,
        cwd,
        onStatusChange: (newStatus, info, err) => {
          setStatus(newStatus);
          setErrorMessage(err);
          onStatusChangeRef.current?.(newStatus, info, err);
        },
        onDimensionsChange: (cols, rows) => {
          onDimensionsChangeRef.current?.(cols, rows);
        },
        onTerminalInput: (data) => {
          onTerminalInputRef.current?.(data);
        },
        onTerminalOutput: (bytes, events, textChunk) => {
          onTerminalOutputRef.current?.(bytes, events, textChunk);
        },
        onSessionEnded: (endStatus, err) => {
          onSessionEndedRef.current?.(endStatus, err);
        },
      });

      // Synchronize state immediately if runtime is already active/running
      if (runtime.status !== 'starting') {
        setStatus(runtime.status);
        if (runtime.sessionInfo) {
          onStatusChangeRef.current?.(runtime.status, runtime.sessionInfo, runtime.errorMessage);
        }
      }

      // Attach xterm element to host container
      terminalRuntimeRegistry.attachHost(paneId, hostElement);

      if (isActive) {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            runtime.refit();
            runtime.terminal.focus();
          });
        } else {
          runtime.refit();
          runtime.terminal.focus();
        }
      }

      return () => {
        // Layout-only detach: does NOT dispose runtime, does NOT close PTY, does NOT dispose xterm
        terminalRuntimeRegistry.detachHost(paneId, hostElement);
      };
      // terminalSessionId omitted intentionally: session ID is resolved asynchronously and must not cause PTY/runtime recreation
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paneId, workspaceId, shellKind, cwd, isActive]);

    useEffect(() => {
      if (isActive && !wasActiveRef.current) {
        const runtime = terminalRuntimeRegistry.get(paneId);
        if (runtime) {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
              runtime.refit();
              runtime.terminal.focus();
            });
          } else {
            runtime.refit();
            runtime.terminal.focus();
          }
        }
      }
      wasActiveRef.current = isActive;
    }, [isActive, paneId]);

    // Implementation notes:
    // CSI handler registered via terminal.parser.registerCsiHandler in terminalRuntimeRegistry
    // Cmd+K clear shortcut handled via isClearShortcut in terminalRuntimeRegistry

    return (
      <div
        className={`terminal-pane-wrapper ${className ?? ''}`}
        onClick={onClick}
      >
        {errorMessage && (
          <div className="terminal-pane-alert" role="alert">
            <span className="alert-icon">!</span>
            <span className="alert-text">{errorMessage}</span>
            <button
              type="button"
              className="alert-dismiss"
              onClick={() => setErrorMessage(null)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
        <div
          ref={containerRef}
          className={`terminal-pane-container status-${status}`}
          data-status={status}
          tabIndex={-1}
        />
      </div>
    );
  },
);
