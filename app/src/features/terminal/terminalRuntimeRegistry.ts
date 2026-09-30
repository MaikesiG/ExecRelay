/**
 * TraceRelay Terminal Runtime Registry
 *
 * Implements decoupled lifecycle ownership for TerminalSession and TerminalRuntime.
 * Ensures that layout changes (split, resize, reparent, close sibling) do NOT destroy
 * or recreate existing PTY sessions, xterm instances, shell integration nonces, or buffers.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { terminalApi } from './terminalApi';
import {
  containsAnsiClearSequence,
  scrollTerminalToFreshScreen,
} from './terminalAnsi';
import {
  ShellIntegrationStreamParser,
  type ShellIntegrationEvent,
} from './shellIntegration';
import type {
  SessionId,
  ShellKind,
  TerminalExitEvent,
  TerminalSessionInfo,
  TerminalSessionStatus,
} from './types';

export interface CreateTerminalRuntimeOptions {
  paneId: string;
  hostElement?: HTMLElement | null;
  terminalSessionId?: string | null;
  workspaceId: string;
  terminalTabId?: string;
  shellKind?: ShellKind;
  cwd?: string;
  initialCols?: number;
  initialRows?: number;
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

export class TerminalRuntime {
  public readonly paneId: string;
  public readonly workspaceId: string;
  public readonly terminalTabId?: string;
  public readonly shellKind?: ShellKind;
  public readonly cwd?: string;
  public readonly nonce: string;
  public readonly registry: TerminalRuntimeRegistry | null = null;
  public readonly textDecoder = new TextDecoder();
  public readonly textEncoder = new TextEncoder();

  public sessionId: SessionId | null = null;
  public status: TerminalSessionStatus = 'starting';
  public sessionInfo: TerminalSessionInfo | null = null;
  public errorMessage: string | null = null;

  public readonly terminal: Terminal;
  public readonly fitAddon: FitAddon;
  public readonly shellParser: ShellIntegrationStreamParser;

  public hostElement: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeAnimationFrameId: number | null = null;

  public lastDispatchedCols: number = 0;
  public lastDispatchedRows: number = 0;
  private lastHostSize: { width: number; height: number } | null = null;
  public pendingClearScroll: boolean = false;
  public isDisposed: boolean = false;

  private unlistenOutput: (() => void) | null = null;
  private unlistenExit: (() => void) | null = null;
  private unlistenError: (() => void) | null = null;
  private dataDisposable: { dispose: () => void } | null = null;
  private csiClearDisposable: { dispose: () => void } | null = null;

  public onStatusChange?: (
    status: TerminalSessionStatus,
    info: TerminalSessionInfo | null,
    errorMessage: string | null,
  ) => void;
  public onDimensionsChange?: (cols: number, rows: number) => void;
  public onTerminalInput?: (data: string) => void;
  public onTerminalOutput?: (
    bytes: Uint8Array,
    events?: ShellIntegrationEvent[],
    textChunk?: string,
  ) => void;
  public onSessionEnded?: (
    status: TerminalSessionStatus,
    message: string | null,
  ) => void;

  public initPromise: Promise<TerminalSessionInfo | null> | null = null;

  constructor(
    options: CreateTerminalRuntimeOptions,
    registry?: TerminalRuntimeRegistry | null,
  ) {
    this.paneId = options.paneId;
    this.workspaceId = options.workspaceId;
    this.terminalTabId = options.terminalTabId;
    this.shellKind = options.shellKind;
    this.cwd = options.cwd;
    this.registry = registry ?? null;

    this.onStatusChange = options.onStatusChange;
    this.onDimensionsChange = options.onDimensionsChange;
    this.onTerminalInput = options.onTerminalInput;
    this.onTerminalOutput = options.onTerminalOutput;
    this.onSessionEnded = options.onSessionEnded;

    this.nonce =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    this.shellParser = new ShellIntegrationStreamParser(this.nonce);

    this.terminal = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: false,
      scrollback: 10000,
      fontFamily:
        '"SF Mono", "Cascadia Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: '#060a11',
        foreground: '#c9d4e8',
        cursor: '#c9d4e8',
        cursorAccent: '#060a11',
        selectionBackground: 'rgba(124, 140, 255, 0.38)',
        selectionForeground: '#ffffff',
        black: '#1f293d',
        red: '#f87171',
        green: '#6ee7b7',
        yellow: '#fbbf77',
        blue: '#7c8cff',
        magenta: '#c084fc',
        cyan: '#38bdf8',
        white: '#e8eefb',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#7dd3fc',
        brightWhite: '#f8fafc',
      },
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Register CSI J handler to intercept 3J (Erase Scrollback) and 2J (Erase Display)
    // so clear commands behave like iTerm (pushing lines to scrollback instead of wiping them).
    this.csiClearDisposable = this.terminal.parser.registerCsiHandler(
      { final: 'J' },
      (params) => {
        if (params[0] === 3) {
          return true;
        }
        if (params[0] === 2) {
          if (this.terminal.buffer.active.type === 'normal') {
            scrollTerminalToFreshScreen(this.terminal);
            return true;
          }
        }
        return false;
      },
    );

    // Custom keyboard shortcuts: Cmd+Shift+C / Ctrl+Shift+C (copy) and Cmd+K (clear scrollback)
    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') {
        return true;
      }

      const isMac =
        typeof navigator !== 'undefined' &&
        /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
      const isCopyShortcut =
        event.code === 'KeyC' &&
        event.shiftKey &&
        (isMac ? event.metaKey : event.ctrlKey);

      if (isCopyShortcut) {
        const selection = this.terminal.getSelection();
        if (selection && selection.length > 0) {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(selection).catch((err) => {
              const msg =
                err instanceof Error ? err.message : 'Clipboard copy failed';
              this.errorMessage = `Copy shortcut failed: ${msg}`;
              this.onStatusChange?.(this.status, this.sessionInfo, this.errorMessage);
            });
          }
          return false;
        }
      }

      const isClearShortcut =
        (event.code === 'KeyK' || event.key.toLowerCase() === 'k') &&
        !event.shiftKey &&
        !event.altKey &&
        isMac &&
        event.metaKey;

      if (isClearShortcut) {
        this.terminal.clear();
        this.terminal.focus();
        return false;
      }

      return true;
    });

    // onData -> stdin
    this.dataDisposable = this.terminal.onData((data: string) => {
      this.onTerminalInput?.(data);

      const currentSessionId = this.sessionId;
      if (!currentSessionId || this.status !== 'running' || this.isDisposed) {
        return;
      }

      const encodedBytes = new TextEncoder().encode(data);
      terminalApi
        .write({
          sessionId: currentSessionId,
          data: Array.from(encodedBytes),
        })
        .catch((err) => {
          if (!this.isDisposed) {
            const msg = err instanceof Error ? err.message : String(err);
            this.updateStatus('error', null, `Write failed: ${msg}`);
          }
        });
    });

    // Attach host element immediately if provided so initial dimensions can be measured
    if (options.hostElement) {
      this.attachHost(options.hostElement);
    }

    // Determine initial dimensions from explicit options, fitted terminal, or fallback
    let initialCols = options.initialCols;
    let initialRows = options.initialRows;

    if (initialCols === undefined || initialRows === undefined) {
      if (
        options.hostElement &&
        options.hostElement.clientWidth > 0 &&
        options.hostElement.clientHeight > 0 &&
        this.terminal.cols > 0 &&
        this.terminal.rows > 0
      ) {
        initialCols = initialCols ?? this.terminal.cols;
        initialRows = initialRows ?? this.terminal.rows;
      }
    }

    initialCols = initialCols ?? 80;
    initialRows = initialRows ?? 24;

    // Start native session setup with exact dimensions
    this.initPromise = this.setupSession(initialCols, initialRows);
  }

  public updateStatus(
    newStatus: TerminalSessionStatus,
    info: TerminalSessionInfo | null,
    err: string | null,
  ): void {
    this.status = newStatus;
    if (info) this.sessionInfo = info;
    this.errorMessage = err;
    this.onStatusChange?.(newStatus, info, err);
    if (newStatus === 'exited' || newStatus === 'error') {
      this.onSessionEnded?.(newStatus, err);
    }
  }

  public handleOutputBytes(data: number[]): void {
    if (this.isDisposed) return;
    const rawBytes = new Uint8Array(data);
    const rawText = this.textDecoder.decode(rawBytes, { stream: true });
    const { cleanText, events } = this.shellParser.parse(rawText);
    const bytes =
      cleanText === rawText
        ? rawBytes
        : this.textEncoder.encode(cleanText);

    const hasClearSeq = containsAnsiClearSequence(rawBytes);
    if (hasClearSeq) {
      this.pendingClearScroll = true;
    }
    this.terminal.write(bytes, () => {
      if (
        this.pendingClearScroll &&
        this.terminal.buffer.active.type === 'normal'
      ) {
        this.terminal.scrollToBottom();
        this.terminal.refresh(0, this.terminal.rows - 1);
        this.terminal.focus();
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            if (!this.isDisposed) {
              this.terminal.scrollToBottom();
              this.terminal.focus();
            }
          });
        }
        if (!hasClearSeq) {
          this.pendingClearScroll = false;
        } else {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
              this.pendingClearScroll = false;
            });
          } else {
            this.pendingClearScroll = false;
          }
        }
      }
    });
    try {
      this.onTerminalOutput?.(bytes, events, cleanText);
    } catch (err) {
      console.warn('[TerminalRuntime] onTerminalOutput failed safely:', err);
    }
  }

  private async setupSession(
    initialCols: number,
    initialRows: number,
  ): Promise<TerminalSessionInfo | null> {
    this.updateStatus('starting', null, null);

    // Bounded early buffers scoped strictly by sessionId to prevent cross-session event leakage
    const earlyOutputBuffer = new Map<string, number[][]>();
    const earlyExitEvents = new Map<string, TerminalExitEvent>();

    try {
      if (this.registry) {
        await this.registry.ensureGlobalListeners();
      } else {
        this.unlistenOutput = await terminalApi.onOutput((event) => {
          if (this.isDisposed) return;
          if (this.sessionId !== null) {
            // Once this session ID is known, handle only events matching this exact sessionId
            if (event.sessionId === this.sessionId) {
              this.handleOutputBytes(event.data);
            }
          } else {
            // Before sessionId is resolved, buffer events partitioned by event.sessionId
            const existing = earlyOutputBuffer.get(event.sessionId) ?? [];
            existing.push(event.data);
            earlyOutputBuffer.set(event.sessionId, existing);
          }
        });

        this.unlistenExit = await terminalApi.onExit((event) => {
          if (this.isDisposed) return;
          if (this.sessionId !== null) {
            if (event.sessionId === this.sessionId) {
              this.updateStatus('exited', null, null);
            }
          } else {
            earlyExitEvents.set(event.sessionId, event);
          }
        });

        this.unlistenError = await terminalApi.onError((event) => {
          if (this.isDisposed) return;
          if (!event.sessionId || (this.sessionId !== null && event.sessionId === this.sessionId)) {
            this.updateStatus('error', null, `Runtime error: ${event.message}`);
          }
        });
      }

      if (this.isDisposed) {
        if (this.unlistenOutput) {
          this.unlistenOutput();
          this.unlistenOutput = null;
        }
        if (this.unlistenExit) {
          this.unlistenExit();
          this.unlistenExit = null;
        }
        if (this.unlistenError) {
          this.unlistenError();
          this.unlistenError = null;
        }
        return null;
      }

      const cols = initialCols > 0 ? initialCols : (this.terminal.cols > 0 ? this.terminal.cols : 80);
      const rows = initialRows > 0 ? initialRows : (this.terminal.rows > 0 ? this.terminal.rows : 24);

      this.lastDispatchedCols = cols;
      this.lastDispatchedRows = rows;

      const createPromise = terminalApi.createSession({
        shellKind: this.shellKind,
        cwd: this.cwd,
        cols,
        rows,
        integrationNonce: this.nonce,
      });

      this.initPromise = createPromise.then((info) => {
        this.sessionId = info.sessionId;
        this.sessionInfo = info;
        return info;
      });

      const sessionInfo = await this.initPromise;

      if (this.isDisposed || !sessionInfo) {
        if (sessionInfo) {
          if (this.registry) {
            this.registry.unbindSession(sessionInfo.sessionId);
          }
          terminalApi
            .closeSession({ sessionId: sessionInfo.sessionId })
            .catch(() => {});
        }
        return null;
      }

      const effectiveNonce = sessionInfo.integrationNonce || this.nonce;
      this.shellParser.setExpectedNonce(effectiveNonce);

      const createdId = sessionInfo.sessionId;
      this.sessionId = createdId;
      this.sessionInfo = sessionInfo;
      this.onDimensionsChange?.(cols, rows);

      if (this.registry) {
        this.registry.bindSession(createdId, this);
      }



      if (!this.registry) {
        // Flush early output buffer ONLY for this session
        const earlyChunks = earlyOutputBuffer.get(createdId);
        if (earlyChunks) {
          for (const chunk of earlyChunks) {
            this.handleOutputBytes(chunk);
          }
          earlyOutputBuffer.delete(createdId);
        }
        earlyOutputBuffer.clear();

        const earlyExit = earlyExitEvents.get(createdId);
        if (earlyExit) {
          this.updateStatus('exited', sessionInfo, null);
        } else {
          this.updateStatus('running', sessionInfo, null);
        }
        earlyExitEvents.clear();
      } else {
        if (this.status !== 'exited') {
          this.updateStatus('running', sessionInfo, null);
        }
      }

      if (this.hostElement) {
        this.terminal.focus();
      }
      return sessionInfo;
    } catch (err) {
      if (!this.isDisposed) {
        const msg = err instanceof Error ? err.message : String(err);
        this.updateStatus('error', null, `Failed to initialize session: ${msg}`);
      }
      return null;
    }
  }

  public attachHost(element: HTMLElement): void {
    if (this.isDisposed) return;
    if (this.hostElement === element) {
      this.refit();
      return;
    }

    if (this.hostElement) {
      this.detachHost(this.hostElement);
    }

    this.hostElement = element;

    if (!this.terminal.element) {
      try {
        this.terminal.open(element);
      } catch {
        // Safe fallback in headless/test environments where element is synthetic
      }
    } else {
      if (this.terminal.element.parentElement !== element) {
        try {
          element.appendChild(this.terminal.element);
        } catch {
          // Safe fallback in headless/test environments
        }
      }
    }

    if (
      element &&
      typeof element.clientWidth === 'number' &&
      element.clientWidth > 0 &&
      element.clientHeight > 0
    ) {
      try {
        this.fitAddon.fit();
      } catch {
        // Safe fallback in headless/test environments
      }
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const width = Math.floor(entry.contentRect.width);
        const height = Math.floor(entry.contentRect.height);
        if (width <= 0 || height <= 0) return;
        if (
          this.lastHostSize &&
          this.lastHostSize.width === width &&
          this.lastHostSize.height === height
        ) {
          return;
        }
        this.lastHostSize = { width, height };

        if (this.resizeAnimationFrameId !== null) {
          if (typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.resizeAnimationFrameId);
          }
          this.resizeAnimationFrameId = null;
        }
        if (typeof requestAnimationFrame === 'function') {
          this.resizeAnimationFrameId = requestAnimationFrame(() => {
            this.resizeAnimationFrameId = null;
            this.refit();
          });
        } else {
          this.refit();
        }
      });
      this.resizeObserver.observe(element);
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        this.refit();
      });
    } else {
      this.refit();
    }
  }

  public detachHost(element?: HTMLElement): void {
    if (element && this.hostElement !== element) return;
    if (this.resizeAnimationFrameId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.resizeAnimationFrameId);
      }
      this.resizeAnimationFrameId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.hostElement = null;
    this.lastHostSize = null;
  }

  public refit(): void {
    if (this.isDisposed) return;
    if (
      this.hostElement &&
      typeof this.hostElement.clientWidth === 'number' &&
      (this.hostElement.clientWidth === 0 || this.hostElement.clientHeight === 0)
    ) {
      return;
    }
    try {
      this.fitAddon.fit();
      const cols = this.terminal.cols;
      const rows = this.terminal.rows;
      const currentSessionId = this.sessionId;

      if (
        currentSessionId &&
        cols > 0 &&
        rows > 0 &&
        (cols !== this.lastDispatchedCols || rows !== this.lastDispatchedRows)
      ) {
        this.lastDispatchedCols = cols;
        this.lastDispatchedRows = rows;
        this.onDimensionsChange?.(cols, rows);
        terminalApi
          .resize({
            sessionId: currentSessionId,
            cols,
            rows,
          })
          .catch((err) => {
            if (!this.isDisposed) {
              const msg = err instanceof Error ? err.message : String(err);
              this.updateStatus('error', null, `Resize failed: ${msg}`);
            }
          });
      }
    } catch {
      // Ignore transient fit errors during rapid container layout changes
    }
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.detachHost();

    this.dataDisposable?.dispose();
    this.csiClearDisposable?.dispose();

    if (this.unlistenOutput) {
      this.unlistenOutput();
      this.unlistenOutput = null;
    }
    if (this.unlistenExit) {
      this.unlistenExit();
      this.unlistenExit = null;
    }
    if (this.unlistenError) {
      this.unlistenError();
      this.unlistenError = null;
    }

    const idToClose = this.sessionId;
    if (idToClose) {
      if (this.registry) {
        this.registry.unbindSession(idToClose);
      }

      terminalApi
        .closeSession({ sessionId: idToClose })
        .catch((err) => {
          const errMsg = String(err);
          if (!errMsg.includes('SESSION_NOT_FOUND')) {
            console.warn(
              `Unexpected error during session cleanup for ${idToClose}:`,
              err,
            );
          }
        });
    }

    this.shellParser.setExpectedNonce(null);
    this.shellParser.reset();
    try {
      this.textDecoder.decode();
    } catch {
      // Ignore transient decode flush errors
    }
    this.terminal.dispose();
  }
}

export class TerminalRuntimeRegistry {
  private runtimes = new Map<string, TerminalRuntime>();
  private runtimesBySessionId = new Map<string, TerminalRuntime>();
  private earlyOutputBuffer = new Map<string, number[][]>();
  private earlyExitEvents = new Map<string, TerminalExitEvent>();

  private unlistenOutput: (() => void) | null = null;
  private unlistenExit: (() => void) | null = null;
  private unlistenError: (() => void) | null = null;
  private listenersInitialized: boolean = false;
  private initListenersPromise: Promise<void> | null = null;

  public async ensureGlobalListeners(): Promise<void> {
    if (this.listenersInitialized) return;
    if (this.initListenersPromise) return this.initListenersPromise;

    this.initListenersPromise = (async () => {
      try {
        this.unlistenOutput = await terminalApi.onOutput((event) => {
          const runtime = this.runtimesBySessionId.get(event.sessionId);
          if (runtime && !runtime.isDisposed) {
            runtime.handleOutputBytes(event.data);
          } else {
            let queue = this.earlyOutputBuffer.get(event.sessionId);
            if (!queue) {
              queue = [];
              this.earlyOutputBuffer.set(event.sessionId, queue);
            }
            if (queue.length < 500) {
              queue.push(event.data);
            }
          }
        });

        this.unlistenExit = await terminalApi.onExit((event) => {
          const runtime = this.runtimesBySessionId.get(event.sessionId);
          if (runtime && !runtime.isDisposed) {
            runtime.updateStatus('exited', null, null);
          } else {
            this.earlyExitEvents.set(event.sessionId, event);
          }
        });

        this.unlistenError = await terminalApi.onError((event) => {
          if (!event.sessionId) {
            for (const r of this.runtimes.values()) {
              if (!r.isDisposed) {
                r.updateStatus('error', null, `Runtime error: ${event.message}`);
              }
            }
          } else {
            const runtime = this.runtimesBySessionId.get(event.sessionId);
            if (runtime && !runtime.isDisposed) {
              runtime.updateStatus('error', null, `Runtime error: ${event.message}`);
            }
          }
        });

        this.listenersInitialized = true;
      } catch (err) {
        console.warn('[TerminalRuntimeRegistry] Failed to initialize global listeners:', err);
      } finally {
        this.initListenersPromise = null;
      }
    })();

    return this.initListenersPromise;
  }

  public bindSession(sessionId: string, runtime: TerminalRuntime): void {
    this.runtimesBySessionId.set(sessionId, runtime);
    const early = this.earlyOutputBuffer.get(sessionId);
    if (early) {
      for (const chunk of early) {
        runtime.handleOutputBytes(chunk);
      }
      this.earlyOutputBuffer.delete(sessionId);
    }
    const exitEv = this.earlyExitEvents.get(sessionId);
    if (exitEv) {
      runtime.updateStatus('exited', runtime.sessionInfo, null);
      this.earlyExitEvents.delete(sessionId);
    }
  }

  public unbindSession(sessionId: string): void {
    this.runtimesBySessionId.delete(sessionId);
    this.earlyOutputBuffer.delete(sessionId);
    this.earlyExitEvents.delete(sessionId);
  }

  public get(paneId: string): TerminalRuntime | undefined {
    return this.runtimes.get(paneId);
  }

  public getBySessionId(sessionId: string): TerminalRuntime | undefined {
    const direct = this.runtimesBySessionId.get(sessionId);
    if (direct && !direct.isDisposed) return direct;
    for (const runtime of this.runtimes.values()) {
      if (runtime.sessionId === sessionId && !runtime.isDisposed) {
        return runtime;
      }
    }
    return undefined;
  }

  public has(paneId: string): boolean {
    const r = this.runtimes.get(paneId);
    return Boolean(r && !r.isDisposed);
  }

  public getOrCreate(options: CreateTerminalRuntimeOptions): TerminalRuntime {
    let runtime = this.runtimes.get(options.paneId);
    if (runtime && !runtime.isDisposed) {
      if (options.onStatusChange) runtime.onStatusChange = options.onStatusChange;
      if (options.onDimensionsChange) runtime.onDimensionsChange = options.onDimensionsChange;
      if (options.onTerminalInput) runtime.onTerminalInput = options.onTerminalInput;
      if (options.onTerminalOutput) runtime.onTerminalOutput = options.onTerminalOutput;
      if (options.onSessionEnded) runtime.onSessionEnded = options.onSessionEnded;
      if (options.hostElement) {
        runtime.attachHost(options.hostElement);
      }
      return runtime;
    }

    runtime = new TerminalRuntime(options, this);
    this.runtimes.set(options.paneId, runtime);
    return runtime;
  }

  public attachHost(paneId: string, element: HTMLElement): void {
    const runtime = this.runtimes.get(paneId);
    if (runtime && !runtime.isDisposed) {
      runtime.attachHost(element);
    }
  }

  public detachHost(paneId: string, element?: HTMLElement): void {
    const runtime = this.runtimes.get(paneId);
    if (runtime) {
      runtime.detachHost(element);
    }
  }

  public dispose(paneId: string): void {
    const runtime = this.runtimes.get(paneId);
    if (runtime) {
      if (runtime.sessionId) {
        this.unbindSession(runtime.sessionId);
      }
      runtime.dispose();
      this.runtimes.delete(paneId);
    }
  }

  public disposeAll(): void {
    for (const runtime of this.runtimes.values()) {
      runtime.dispose();
    }
    this.runtimes.clear();
    this.runtimesBySessionId.clear();
    this.earlyOutputBuffer.clear();
    this.earlyExitEvents.clear();
    if (this.unlistenOutput) {
      this.unlistenOutput();
      this.unlistenOutput = null;
    }
    if (this.unlistenExit) {
      this.unlistenExit();
      this.unlistenExit = null;
    }
    if (this.unlistenError) {
      this.unlistenError();
      this.unlistenError = null;
    }
    this.listenersInitialized = false;
  }

  public getAll(): TerminalRuntime[] {
    return Array.from(this.runtimes.values());
  }
}

export const terminalRuntimeRegistry = new TerminalRuntimeRegistry();
