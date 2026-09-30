/**
 * TraceRelay Typed Terminal Protocol Contract
 *
 * NOTE: These TypeScript definitions form the canonical client-side contract for
 * terminal session management, IPC inputs, and streaming event payloads.
 * They MUST remain strictly synchronized with `native/src/terminal/types.rs`.
 */

export type TabId = string;
export type SessionId = string;

/**
 * Supported or auto-detected shell flavors.
 */
export type ShellKind =
  | 'default'
  | 'zsh'
  | 'bash'
  | 'powershell'
  | 'pwsh'
  | 'cmd'
  | 'sh';

/**
 * Terminal session lifecycle states.
 */
export type TerminalSessionStatus =
  | 'starting'
  | 'running'
  | 'exited'
  | 'error';

/**
 * Mode defining whether a tab's title is user-customized or derived from shell/cwd.
 */
export type TabTitleMode = 'auto' | 'manual';

/**
 * UI representation of an open terminal tab.
 */
export interface TerminalTab {
  id: TabId;
  title: string;
  titleMode: TabTitleMode;
  sessionId: SessionId;
  createdAt: number;
}

/**
 * Summary metadata for an active or historical terminal session.
 */
export interface TerminalSessionInfo {
  sessionId: SessionId;
  shell: string;
  shellKind: ShellKind;
  status: TerminalSessionStatus;
  cwd?: string | null;
  cols: number;
  rows: number;
  exitCode?: number | null;
  integrationNonce?: string | null;
}

/* ========================================================================== */
/* Tauri Command Input Payloads                                               */
/* ========================================================================== */

/**
 * Request payload for `terminal_create_session`.
 */
export interface CreateTerminalSessionInput {
  shellKind?: ShellKind;
  cwd?: string;
  cols?: number;
  rows?: number;
  integrationNonce?: string;
}

/**
 * Request payload for `terminal_write`.
 * The wire payload is strictly a byte/numeric array (`number[]` or `Uint8Array`).
 */
export interface WriteTerminalInput {
  sessionId: SessionId;
  data: number[] | Uint8Array;
}

/**
 * Request payload for `terminal_resize`.
 */
export interface ResizeTerminalInput {
  sessionId: SessionId;
  cols: number;
  rows: number;
}

/**
 * Request payload for `terminal_close_session`.
 */
export interface CloseTerminalSessionInput {
  sessionId: SessionId;
}

/* ========================================================================== */
/* Tauri Streaming Event Payloads                                             */
/* ========================================================================== */

/**
 * Payload emitted on `terminal://output`.
 * Preserved as raw bytes (numeric array) without UTF-8 or ANSI decoding.
 */
export interface TerminalOutputEvent {
  sessionId: SessionId;
  data: number[];
}

/**
 * Reason codes for session termination.
 */
export type TerminalExitReason =
  | 'exited'
  | 'closed'
  | 'reader_eof'
  | 'child_wait_error';

/**
 * Payload emitted on `terminal://exit`.
 */
export interface TerminalExitEvent {
  sessionId: SessionId;
  exitCode?: number | null;
  reason: TerminalExitReason;
}

/**
 * Operation during which an error occurred.
 */
export type TerminalErrorOperation =
  | 'create'
  | 'read'
  | 'write'
  | 'resize'
  | 'close'
  | 'emit';

/**
 * Payload emitted on `terminal://error`.
 */
export interface TerminalErrorEvent {
  sessionId?: SessionId | null;
  code: string;
  message: string;
  operation: TerminalErrorOperation;
}

/**
 * Status transition payload (legacy/compatibility).
 */
export interface TerminalStatusEvent {
  sessionId: SessionId;
  status: TerminalSessionStatus;
  error?: string | null;
}
