import type { ExecutionIntent } from '../execution/types';

export type ShellLifecycleState = 'initializing' | 'trusted' | 'fallback';

export interface PendingExecutionInput {
  executionId?: string;
  intent?: ExecutionIntent;
  verificationRunId?: string;
  verificationCriterionId?: string;
  agentRunId?: string;
  agentExecutionLinkSource?: import('../execution/types').AgentExecutionLinkSource;
}

export interface CommandBoundaryRuntimeState {
  shellLifecycleState: ShellLifecycleState;
  inputBuffer: string;
  pendingExecutionInput: PendingExecutionInput | null;
}

export interface FallbackReplay {
  data: string;
  pendingInput: PendingExecutionInput | null;
}

export interface TrustedCommandStartReconciliation {
  bufferedInput: string;
  pendingInput: PendingExecutionInput | null;
}

export function shellLifecycleStateFromAvailability(
  shellIntegrationAvailable: boolean | undefined,
): ShellLifecycleState {
  return shellIntegrationAvailable === false ? 'fallback' : 'initializing';
}

export function bufferPendingTerminalInput(
  runtime: CommandBoundaryRuntimeState,
  data: string,
  pendingInput?: PendingExecutionInput,
): void {
  if (pendingInput) {
    runtime.pendingExecutionInput = pendingInput;
  }

  for (const char of data) {
    if (char === '\x03') {
      runtime.inputBuffer = '';
      runtime.pendingExecutionInput = null;
    } else if (char === '\x7f' || char === '\b') {
      runtime.inputBuffer = runtime.inputBuffer.slice(0, -1);
    } else if (char === '\r' || char === '\n') {
      runtime.inputBuffer += '\n';
    } else if (char >= ' ' || char === '\t') {
      runtime.inputBuffer += char;
    }
  }

  if (runtime.inputBuffer.length > 65536) {
    runtime.inputBuffer = runtime.inputBuffer.slice(-65536);
  }
}

export function transitionShellLifecycle(
  runtime: CommandBoundaryRuntimeState,
  nextState: ShellLifecycleState,
): FallbackReplay | null {
  if (runtime.shellLifecycleState === 'trusted' && nextState !== 'trusted') {
    return null;
  }

  runtime.shellLifecycleState = nextState;
  if (nextState !== 'fallback' || runtime.inputBuffer.length === 0) {
    return null;
  }

  const replay = {
    data: runtime.inputBuffer,
    pendingInput: runtime.pendingExecutionInput,
  };
  runtime.inputBuffer = '';
  runtime.pendingExecutionInput = null;
  return replay;
}

export function consumeTrustedCommandStart(
  runtime: CommandBoundaryRuntimeState,
): TrustedCommandStartReconciliation {
  runtime.shellLifecycleState = 'trusted';
  const reconciliation = {
    bufferedInput: runtime.inputBuffer.trimEnd(),
    pendingInput: runtime.pendingExecutionInput,
  };
  runtime.pendingExecutionInput = null;
  runtime.inputBuffer = '';
  return reconciliation;
}

export function resetCommandBoundaryRuntime(
  runtime: CommandBoundaryRuntimeState,
): void {
  runtime.shellLifecycleState = 'initializing';
  runtime.inputBuffer = '';
  runtime.pendingExecutionInput = null;
}
