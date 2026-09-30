/**
 * TraceRelay Terminal IPC Boundary Implementation
 *
 * Provides typed functions and listeners for communicating with the native
 * Tauri terminal runtime via command invocation and event streams.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  CreateTerminalSessionInput,
  WriteTerminalInput,
  ResizeTerminalInput,
  CloseTerminalSessionInput,
  TerminalSessionInfo,
  TerminalOutputEvent,
  TerminalExitEvent,
  TerminalErrorEvent,
  SessionId,
} from './types';

/**
 * Tauri command names registered in native/core.
 */
export const TERMINAL_COMMANDS = {
  CREATE: 'terminal_create_session',
  WRITE: 'terminal_write',
  RESIZE: 'terminal_resize',
  CLOSE: 'terminal_close_session',
  INFO: 'terminal_session_info',
  LIST: 'terminal_list_sessions',
} as const;

/**
 * Tauri event names emitted by native/core.
 */
export const TERMINAL_EVENTS = {
  OUTPUT: 'terminal://output',
  EXIT: 'terminal://exit',
  ERROR: 'terminal://error',
} as const;

/**
 * Type-safe interface representing the Tauri IPC terminal API bridge.
 */
export interface TerminalApiContract {
  createSession(input?: CreateTerminalSessionInput): Promise<TerminalSessionInfo>;
  write(input: WriteTerminalInput): Promise<void>;
  write(sessionId: SessionId, data: number[] | Uint8Array): Promise<void>;
  resize(input: ResizeTerminalInput): Promise<void>;
  resize(sessionId: SessionId, cols: number, rows: number): Promise<void>;
  closeSession(input: CloseTerminalSessionInput): Promise<void>;
  closeSession(sessionId: SessionId): Promise<void>;
  close(input: CloseTerminalSessionInput): Promise<void>;
  close(sessionId: SessionId): Promise<void>;
  sessionInfo(sessionId: string): Promise<TerminalSessionInfo>;
  listSessions(): Promise<TerminalSessionInfo[]>;
  onOutput(callback: (event: TerminalOutputEvent) => void): Promise<() => void>;
  onExit(callback: (event: TerminalExitEvent) => void): Promise<() => void>;
  onError(callback: (event: TerminalErrorEvent) => void): Promise<() => void>;
}

/**
 * Creates a new in-memory terminal session and spawns its native PTY process.
 */
export async function createSession(
  input?: CreateTerminalSessionInput,
): Promise<TerminalSessionInfo> {
  return await invoke<TerminalSessionInfo>(TERMINAL_COMMANDS.CREATE, {
    input: input ?? {},
  });
}

/**
 * Writes raw byte input to the session's PTY stdin.
 * Accepts either a WriteTerminalInput object or (sessionId, data) arguments.
 * Normalizes Uint8Array or numeric array into a canonical JSON number array.
 */
export function write(input: WriteTerminalInput): Promise<void>;
export function write(
  sessionId: SessionId,
  data: number[] | Uint8Array,
): Promise<void>;
export async function write(
  arg1: WriteTerminalInput | SessionId,
  arg2?: number[] | Uint8Array,
): Promise<void> {
  const sessionId = typeof arg1 === 'string' ? arg1 : arg1.sessionId;
  const rawData = typeof arg1 === 'string' ? (arg2 ?? []) : arg1.data;
  const normalizedData = Array.from(rawData);

  await invoke<void>(TERMINAL_COMMANDS.WRITE, {
    input: {
      sessionId,
      data: normalizedData,
    },
  });
}

/**
 * Resizes the PTY window dimensions for the specified session.
 * Accepts either a ResizeTerminalInput object or (sessionId, cols, rows) arguments.
 */
export function resize(input: ResizeTerminalInput): Promise<void>;
export function resize(
  sessionId: SessionId,
  cols: number,
  rows: number,
): Promise<void>;
export async function resize(
  arg1: ResizeTerminalInput | SessionId,
  arg2?: number,
  arg3?: number,
): Promise<void> {
  const sessionId = typeof arg1 === 'string' ? arg1 : arg1.sessionId;
  const cols = typeof arg1 === 'string' ? (arg2 ?? 80) : arg1.cols;
  const rows = typeof arg1 === 'string' ? (arg3 ?? 24) : arg1.rows;

  await invoke<void>(TERMINAL_COMMANDS.RESIZE, {
    input: {
      sessionId,
      cols,
      rows,
    },
  });
}

/**
 * Closes an active terminal session and terminates its child shell process.
 * Accepts either a CloseTerminalSessionInput object or a sessionId string.
 */
export function close(input: CloseTerminalSessionInput): Promise<void>;
export function close(sessionId: SessionId): Promise<void>;
export async function close(
  inputOrSessionId: CloseTerminalSessionInput | SessionId,
): Promise<void> {
  const sessionId =
    typeof inputOrSessionId === 'string'
      ? inputOrSessionId
      : inputOrSessionId.sessionId;

  await invoke<void>(TERMINAL_COMMANDS.CLOSE, {
    input: {
      sessionId,
    },
  });
}

export const closeSession = close;

/**
 * Retrieves metadata for a specific terminal session.
 */
export async function sessionInfo(
  sessionId: string,
): Promise<TerminalSessionInfo> {
  return await invoke<TerminalSessionInfo>(TERMINAL_COMMANDS.INFO, {
    input: {
      sessionId,
    },
  });
}

/**
 * Lists metadata for all active terminal sessions.
 */
export async function listSessions(): Promise<TerminalSessionInfo[]> {
  return await invoke<TerminalSessionInfo[]>(TERMINAL_COMMANDS.LIST);
}

/**
 * Subscribes to raw output byte events emitted by the native PTY reader loop.
 * Returns the unlisten function.
 */
export async function onOutput(
  callback: (event: TerminalOutputEvent) => void,
): Promise<() => void> {
  return await listen<TerminalOutputEvent>(TERMINAL_EVENTS.OUTPUT, (event) => {
    callback(event.payload);
  });
}

/**
 * Subscribes to session termination events emitted upon child process exit.
 * Returns the unlisten function.
 */
export async function onExit(
  callback: (event: TerminalExitEvent) => void,
): Promise<() => void> {
  return await listen<TerminalExitEvent>(TERMINAL_EVENTS.EXIT, (event) => {
    callback(event.payload);
  });
}

/**
 * Subscribes to non-fatal error events emitted by the native terminal reader.
 * Returns the unlisten function.
 */
export async function onError(
  callback: (event: TerminalErrorEvent) => void,
): Promise<() => void> {
  return await listen<TerminalErrorEvent>(TERMINAL_EVENTS.ERROR, (event) => {
    callback(event.payload);
  });
}

/**
 * Exported terminal API client namespace.
 */
export const terminalApi: TerminalApiContract = {
  createSession,
  write,
  resize,
  closeSession,
  close,
  sessionInfo,
  listSessions,
  onOutput,
  onExit,
  onError,
};
