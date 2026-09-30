/**
 * LT-WARNING-SCOPE-ISOLATION-001 / LT-SHORTCUT-TOAST-CAPTURE-LEAK-FIX-001
 * Warning Scope Domain Models & Toast Types
 *
 * Defines explicit ownership and isolation boundaries across independent notification domains:
 * 1. Global Warning: Owns App scope or explicit Workspace scope. Never references paneId or captureSessionId.
 * 2. Capture Warning: Owns exactly one Capture session in exactly one pane.
 *    Scoped by workspaceId + terminalTabId + paneId + captureSessionId.
 * 3. Terminal Pane Toast: Transient, non-blocking keyboard-command feedback.
 *    Never stored in Workspace, Terminal Tab, or Capture state.
 */

export type GlobalWarningScope = 'app' | 'workspace';

export type GlobalWarningSeverity = 'warning' | 'error';

export type GlobalWarningCode =
  | 'terminal-service-disconnected'
  | 'terminal-service-reconnecting'
  | 'application-configuration-error'
  | 'workspace-runtime-error';

export function isGlobalWarningCode(code: unknown): code is GlobalWarningCode {
  return (
    code === 'terminal-service-disconnected' ||
    code === 'terminal-service-reconnecting' ||
    code === 'application-configuration-error' ||
    code === 'workspace-runtime-error'
  );
}

export interface GlobalWarning {
  id: string;
  scope: GlobalWarningScope;
  workspaceId?: string;
  severity: GlobalWarningSeverity;
  code: GlobalWarningCode;
  title: string;
  message: string;
  dismissible: boolean;
  createdAt: number;
}

export type CaptureWarningSeverity = 'warning' | 'error';

export type CaptureWarningCode =
  | 'microphone-permission-denied'
  | 'audio-input-unavailable'
  | 'capture-start-failed'
  | 'transcription-disconnected'
  | 'transcription-failed'
  | 'capture-session-interrupted';

export function isCaptureWarningCode(
  code: unknown,
): code is CaptureWarningCode {
  return (
    code === 'microphone-permission-denied' ||
    code === 'audio-input-unavailable' ||
    code === 'capture-start-failed' ||
    code === 'transcription-disconnected' ||
    code === 'transcription-failed' ||
    code === 'capture-session-interrupted'
  );
}

export interface CaptureWarning {
  id: string;
  captureSessionId: string;
  severity: CaptureWarningSeverity;
  code: CaptureWarningCode;
  title?: string;
  message: string;
  recoverable: boolean;
  createdAt: number;
}

export type CaptureWarningKey =
  `${string}:${string}:${string}:${string}`;

export function buildCaptureWarningKey(
  workspaceId: string,
  terminalTabId: string,
  paneId: string,
  captureSessionId: string,
): CaptureWarningKey {
  return `${workspaceId}:${terminalTabId}:${paneId}:${captureSessionId}`;
}

/**
 * Terminal Pane Toast Types
 *
 * Dedicated domain for short-lived, non-blocking keyboard-command feedback.
 */
export type TerminalPaneToastMessage =
  | 'Maximum of 6 panes per terminal tab'
  | 'Maximum of 2 panes per terminal tab'
  | 'Cannot close the last pane';

export interface TerminalPaneToast {
  id: string;
  message: TerminalPaneToastMessage;
  createdAt: number;
}
