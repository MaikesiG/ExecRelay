/**
 * TraceRelay / CapTerm Verification Engine
 *
 * Implements pure evaluation logic for Verification Contracts, Criteria, Runs,
 * and deterministic criterion evaluation against Execution evidence.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. Verification never replaces Execution. Real executions remain the source of execution truth.
 * 2. Deterministic evaluation:
 *    Verification evaluates whether trusted process exit codes satisfy explicit criteria.
 * 3. Strict Trust Boundary:
 *    A criterion may only become authoritatively 'passed' or 'failed' if backed by trusted
 *    execution evidence (e.g. outcomeSource === 'trusted-shell' && outcomeTrusted === true).
 *    Untrusted OSC markers, capture boundaries, or missing exit codes MUST produce 'error'.
 * 4. Immutable Historical Records:
 *    Criteria are snapshotted into VerificationRun.criteriaSnapshot.
 *    Rerunning verification creates a new VerificationRun (#2, #3, ...) without mutating previous runs.
 * 5. Active Runtime Indicator:
 *    Verify tab indicator represents ACTIVE RUNTIME ONLY.
 *    No dot when idle or for historical runs.
 */

import type { Execution } from '../execution/types';
import type {
  VerificationContract,
  VerificationCriterion,
  VerificationCriterionAvailability,
  VerificationCriterionResult,
  VerificationRun,
  VerificationRunStatus,
} from './types';

/**
 * Creates a deterministic VerificationCriterion with defaults.
 * Default expected exit code is strictly [0].
 */
export function createVerificationCriterion(params: {
  id?: string;
  label: string;
  command: string;
  expectedExitCodes?: number[];
  order?: number;
  workingDirectory?: string;
  cwd?: string;
  availability?: VerificationCriterionAvailability;
}): VerificationCriterion {
  const workingDir =
    params.workingDirectory && params.workingDirectory.trim().length > 0
      ? params.workingDirectory.trim()
      : params.cwd && params.cwd.trim().length > 0
      ? params.cwd.trim()
      : '.';

  return {
    id: params.id ?? `crit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'command',
    label: params.label,
    command: params.command,
    expectedExitCodes:
      params.expectedExitCodes && params.expectedExitCodes.length > 0
        ? [...params.expectedExitCodes]
        : [0],
    order: params.order ?? 0,
    workingDirectory: workingDir,
    cwd: workingDir,
    availability: params.availability ?? 'available',
  };
}

/**
 * Creates a VerificationContract with criteria ordered by their `order` index.
 */
export function createVerificationContract(params: {
  id?: string;
  workspaceId: string;
  name: string;
  criteria?: VerificationCriterion[];
}): VerificationContract {
  const criteria = (params.criteria ?? [])
    .slice()
    .sort((a, b) => a.order - b.order);

  return {
    id: params.id ?? `contract-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    workspaceId: params.workspaceId,
    name: params.name,
    criteria,
    createdAt: Date.now(),
  };
}

export interface DiscoverStandardCriteriaOptions {
  packageJson?: {
    scripts?: Record<string, string>;
  } | null;
  packageJsonContent?: string | null;
  scripts?: Record<string, string> | null;
  projectScripts?: Record<string, string> | null;
  availableScripts?: string[] | Record<string, string> | null;
  projectCwd?: string;
}

/**
 * Discovers standard verification criteria based on actual project scripts.
 * Recognizes standard semantics: test, typecheck, lint, build.
 * Does NOT invent commands that do not exist.
 */
export function discoverStandardCriteria(
  options?: DiscoverStandardCriteriaOptions,
  workspaceId?: string,
): VerificationCriterion[] {
  let scripts: Record<string, string> | null = null;

  if (options) {
    if (options.projectScripts) {
      scripts = options.projectScripts;
    } else if (options.scripts) {
      scripts = options.scripts;
    } else if (options.packageJson && typeof options.packageJson === 'object') {
      scripts = options.packageJson.scripts ?? null;
    } else if (
      typeof options.availableScripts === 'object' &&
      options.availableScripts !== null &&
      !Array.isArray(options.availableScripts)
    ) {
      scripts = options.availableScripts;
    } else if (Array.isArray(options.availableScripts)) {
      scripts = {};
      for (const name of options.availableScripts) {
        scripts[name] = name;
      }
    } else if (options.packageJsonContent) {
      try {
        const parsed = JSON.parse(options.packageJsonContent);
        if (parsed && typeof parsed.scripts === 'object') {
          scripts = parsed.scripts;
        }
      } catch {
        scripts = null;
      }
    }
  }

  // If explicit scripts object/options provided:
  if (scripts !== null) {
    const recognized: { script: string; label: string; command: string; key: string }[] = [
      { script: 'test', label: 'Test suite', command: 'npm test', key: 'test' },
      { script: 'typecheck', label: 'Typecheck', command: 'npm run typecheck', key: 'typecheck' },
      { script: 'lint', label: 'Linting', command: 'npm run lint', key: 'lint' },
      { script: 'build', label: 'Production build', command: 'npm run build', key: 'build' },
    ];

    const criteria: VerificationCriterion[] = [];
    let order = 1;

    for (const item of recognized) {
      if (Object.prototype.hasOwnProperty.call(scripts, item.script)) {
        criteria.push(
          createVerificationCriterion({
            id: workspaceId ? `crit-std-${workspaceId}-${item.key}` : undefined,
            label: item.label,
            command: item.command,
            expectedExitCodes: [0],
            order: order++,
            availability: 'available',
          }),
        );
      }
    }
    return criteria;
  }

  // If options was passed but had empty packageJson / no scripts:
  if (options && (options.packageJson !== undefined || options.projectScripts !== undefined || options.scripts !== undefined)) {
    return [];
  }

  // If no options provided, attempt to discover from current repository's package.json
  interface NodeFsModule {
    existsSync: (path: string) => boolean;
    readFileSync: (path: string, encoding: string) => string;
  }
  interface NodePathModule {
    resolve: (...paths: string[]) => string;
  }
  interface DynamicNodeEnv {
    process?: { cwd?: () => string };
    require?: (id: string) => unknown;
  }

  const env = globalThis as unknown as DynamicNodeEnv;
  if (env && typeof env.process?.cwd === 'function' && typeof env.require === 'function') {
    try {
      const fsMod = env.require('fs') as NodeFsModule | undefined;
      const pathMod = env.require('path') as NodePathModule | undefined;
      if (fsMod && pathMod) {
        const cwd = options?.projectCwd;
        if (cwd) {
          const pkgPath = pathMod.resolve(cwd, 'package.json');
          if (fsMod.existsSync(pkgPath)) {
            const content = fsMod.readFileSync(pkgPath, 'utf8');
            const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
            if (parsed && typeof parsed.scripts === 'object' && parsed.scripts !== null) {
              return discoverStandardCriteria({ projectScripts: parsed.scripts }, workspaceId);
            }
          }
        }
      }
    } catch {
      // Fall through
    }
  }

  if (options && (options.projectCwd !== undefined || options.projectScripts !== undefined)) {
    return [];
  }

  // Default fallback for TraceRelay local environment
  const defaultCommands = [
    { label: 'Test suite', command: 'npm test', key: 'test' },
    { label: 'Typecheck', command: 'npm run typecheck', key: 'typecheck' },
    { label: 'Linting', command: 'npm run lint', key: 'lint' },
    { label: 'Production build', command: 'npm run build', key: 'build' },
  ];

  return defaultCommands.map((item, index) =>
    createVerificationCriterion({
      id: workspaceId ? `crit-std-${workspaceId}-${item.key}` : undefined,
      label: item.label,
      command: item.command,
      expectedExitCodes: [0],
      order: index + 1,
      availability: 'available',
    }),
  );
}

/**
 * Reconciles criteria availability against available workspace commands or scripts.
 */
export function reconcileCriteriaAvailability(
  criteria: VerificationCriterion[],
  availableScripts?: string[] | Set<string> | Record<string, string>,
): VerificationCriterion[] {
  if (!availableScripts) return criteria;

  const scriptNames = new Set<string>();
  if (Array.isArray(availableScripts)) {
    for (const s of availableScripts) scriptNames.add(s);
  } else if (availableScripts instanceof Set) {
    for (const s of availableScripts) scriptNames.add(s);
  } else if (typeof availableScripts === 'object') {
    for (const k of Object.keys(availableScripts)) scriptNames.add(k);
  }

  return criteria.map((c) => {
    let script: string | null = null;
    const trimmed = c.command.trim();
    if (trimmed === 'npm test') {
      script = 'test';
    } else if (trimmed.startsWith('npm run ')) {
      script = trimmed.slice(8).trim().split(/\s+/)[0];
    }

    if (script && scriptNames.size > 0 && !scriptNames.has(script)) {
      return { ...c, availability: 'unavailable' };
    }
    return { ...c, availability: c.availability ?? 'available' };
  });
}

/**
 * Standard default verification contract for local development / testing.
 * Language/tool agnostic foundation; discovers actual project scripts.
 * HARDEN-VERIFY-DELETE-018: Stable contract and criteria IDs for canonical ownership.
 */
export function createDefaultVerificationContract(
  workspaceId: string,
  options?: DiscoverStandardCriteriaOptions,
): VerificationContract {
  const criteria = discoverStandardCriteria(options, workspaceId);

  return createVerificationContract({
    id: `contract-std-${workspaceId}`,
    workspaceId,
    name: 'Standard checks',
    criteria,
  });
}

/**
 * Creates a new VerificationRun by snapshotting the contract's criteria.
 *
 * CRITICAL RULE (Phase 11 & HARDEN-016.1):
 * The contract criteria must be snapshotted immutably into `criteriaSnapshot`
 * so future edits to the contract never alter historical verification runs.
 */
export function createVerificationRun(params: {
  id?: string;
  contract: VerificationContract;
  workspaceId: string;
  selectedCriterionIds?: string[];
}): VerificationRun {
  const now = Date.now();
  // HARDEN-VERIFY-DELETE-021: Defensively resolve selection against current valid contract criteria
  const validMap = new Map(params.contract.criteria.map((c) => [c.id, c]));
  const targetCriteria =
    params.selectedCriterionIds && params.selectedCriterionIds.length > 0
      ? params.selectedCriterionIds
          .map((id) => validMap.get(id))
          .filter((c): c is VerificationCriterion => c !== undefined)
      : params.contract.criteria;

  const criteriaSnapshot: VerificationCriterion[] = targetCriteria.map(
    (c) => ({
      id: c.id,
      type: c.type,
      label: c.label,
      command: c.command,
      expectedExitCodes: [...c.expectedExitCodes],
      order: c.order,
      workingDirectory: c.workingDirectory ?? c.cwd ?? '.',
      cwd: c.workingDirectory ?? c.cwd ?? '.',
      availability: c.availability ?? 'available',
    }),
  );

  const criterionResults: VerificationCriterionResult[] = criteriaSnapshot.map(
    (c) => ({
      criterionId: c.id,
      status: 'pending',
    }),
  );

  return {
    id: params.id ?? `run-${now}-${Math.random().toString(36).slice(2, 7)}`,
    contractId: params.contract.id,
    profileName: params.contract.name,
    workspaceId: params.workspaceId,
    status: 'pending',
    criteriaSnapshot,
    criterionResults,
    startedAt: now,
  };
}

/**
 * Creates a new VerificationRun continuing unfinished checks from a previous run (Section 25).
 * Preserves the original criteriaSnapshot ordering and sets continuedFromRunId.
 * Does NOT mutate the previous run.
 */
export function createContinuationVerificationRun(params: {
  previousRun: VerificationRun;
  id?: string;
  workspaceId?: string;
}): VerificationRun {
  const { previousRun } = params;
  const now = Date.now();

  const passedCriterionIds = new Set(
    previousRun.criterionResults
      .filter((r) => r.status === 'passed')
      .map((r) => r.criterionId),
  );

  // Preserve original criteriaSnapshot ordering
  const unfinishedSnapshot = previousRun.criteriaSnapshot.filter(
    (c) => !passedCriterionIds.has(c.id),
  );

  const criteriaSnapshot: VerificationCriterion[] = unfinishedSnapshot.map((c) => ({
    id: c.id,
    type: c.type,
    label: c.label,
    command: c.command,
    expectedExitCodes: [...c.expectedExitCodes],
    order: c.order,
    workingDirectory: c.workingDirectory ?? c.cwd ?? '.',
    cwd: c.workingDirectory ?? c.cwd ?? '.',
    availability: c.availability ?? 'available',
  }));

  const criterionResults: VerificationCriterionResult[] = criteriaSnapshot.map((c) => ({
    criterionId: c.id,
    status: 'pending',
  }));

  return {
    id: params.id ?? `run-${now}-${Math.random().toString(36).slice(2, 7)}`,
    contractId: previousRun.contractId,
    profileName: previousRun.profileName,
    workspaceId: params.workspaceId ?? previousRun.workspaceId,
    status: 'pending',
    criteriaSnapshot,
    criterionResults,
    startedAt: now,
    continuedFromRunId: previousRun.id,
  };
}

/**
 * Validates and parses expected exit codes input from string, number, or array.
 * Examples: "0", "0, 1", "0, 2", 0, [0, 1].
 */
export function parseExpectedExitCodes(
  input: string | number | number[] | undefined | null,
): { valid: boolean; exitCodes: number[]; error?: string } {
  if (input === undefined || input === null || input === '') {
    return { valid: true, exitCodes: [0] };
  }

  if (typeof input === 'number') {
    if (!Number.isInteger(input)) {
      return { valid: false, exitCodes: [], error: 'Exit code must be an integer' };
    }
    return { valid: true, exitCodes: [input] };
  }

  if (Array.isArray(input)) {
    if (input.length === 0) {
      return { valid: true, exitCodes: [0] };
    }
    for (const val of input) {
      if (typeof val !== 'number' || !Number.isInteger(val)) {
        return { valid: false, exitCodes: [], error: 'All exit codes must be integers' };
      }
    }
    return { valid: true, exitCodes: [...input] };
  }

  const raw = String(input).trim();
  if (raw.length === 0) {
    return { valid: true, exitCodes: [0] };
  }

  // Remove optional square brackets e.g. "[0, 1]" -> "0, 1"
  const cleaned = raw.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (cleaned.length === 0) {
    return { valid: true, exitCodes: [0] };
  }

  const tokens = cleaned.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  const parsedCodes: number[] = [];

  for (const token of tokens) {
    const num = Number(token);
    if (!Number.isInteger(num)) {
      return {
        valid: false,
        exitCodes: [],
        error: `Invalid exit code "${token}": must be an integer`,
      };
    }
    parsedCodes.push(num);
  }

  if (parsedCodes.length === 0) {
    return { valid: true, exitCodes: [0] };
  }

  return { valid: true, exitCodes: Array.from(new Set(parsedCodes)) };
}

/**
 * Validates user inputs for creating or editing a verification criterion.
 */
export function validateCriterionInput(params: {
  label: string;
  command: string;
  workingDirectory?: string;
  expectedExitCodes?: string | number | number[];
}): { valid: boolean; error?: string; exitCodes: number[]; workingDirectory: string } {
  const trimmedLabel = params.label?.trim() ?? '';
  if (trimmedLabel.length === 0) {
    return { valid: false, error: 'Check name cannot be empty', exitCodes: [], workingDirectory: '.' };
  }

  const trimmedCommand = params.command?.trim() ?? '';
  if (trimmedCommand.length === 0) {
    return { valid: false, error: 'Command cannot be empty', exitCodes: [], workingDirectory: '.' };
  }

  const rawWorkingDir = params.workingDirectory?.trim() ?? '.';
  const workingDir = rawWorkingDir.length === 0 ? '.' : rawWorkingDir;

  if (workingDir.startsWith('~')) {
    return {
      valid: false,
      error: `Working directory cannot use home directory shorthand: ${workingDir}`,
      exitCodes: [],
      workingDirectory: '.',
    };
  }

  if (
    workingDir.startsWith('/') ||
    workingDir.startsWith('\\') ||
    /^[a-zA-Z]:[/\\]/.test(workingDir)
  ) {
    return {
      valid: false,
      error: `Working directory must be relative to the workspace root: ${workingDir}`,
      exitCodes: [],
      workingDirectory: '.',
    };
  }

  const segments = workingDir.split(/[/\\]+/);
  const normalizedSegments: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (normalizedSegments.length === 0) {
        return {
          valid: false,
          error: `Working directory cannot escape workspace root: ${workingDir}`,
          exitCodes: [],
          workingDirectory: '.',
        };
      }
      normalizedSegments.pop();
    } else {
      normalizedSegments.push(seg);
    }
  }

  const exitCodesResult = parseExpectedExitCodes(params.expectedExitCodes);
  if (!exitCodesResult.valid) {
    return {
      valid: false,
      error: exitCodesResult.error ?? 'Invalid exit codes',
      exitCodes: [],
      workingDirectory: normalizedSegments.length === 0 ? '.' : normalizedSegments.join('/'),
    };
  }

  return {
    valid: true,
    exitCodes: exitCodesResult.exitCodes,
    workingDirectory: normalizedSegments.length === 0 ? '.' : normalizedSegments.join('/'),
  };
}

/**
 * Evaluates an Execution against a specific VerificationCriterion.
 *
 * CRITICAL TRUST BOUNDARY (Phase 5):
 * A criterion may only become authoritatively 'passed' or 'failed' if backed
 * by trusted execution evidence (outcomeTrusted === true && outcomeSource === 'trusted-shell').
 *
 * Untrusted outcomes, unknown exit codes, or capture boundary completions
 * MUST produce 'error' because the criterion cannot be authoritatively verified.
 */
export function evaluateCriterionResult(
  criterion: VerificationCriterion,
  execution: Execution,
): VerificationCriterionResult {
  const startedAt = execution.startedAt;
  const completedAt = execution.completedAt ?? Date.now();

  // 1. In-flight execution
  if (execution.lifecycle === 'running' || execution.lifecycle === 'pending') {
    return {
      criterionId: criterion.id,
      status: 'running',
      executionId: execution.id,
      observedExitCode: execution.exitCode,
      startedAt,
      message: 'Command is running...',
    };
  }

  // 2. Interrupted execution
  if (
    execution.lifecycle === 'interrupted' ||
    execution.completionSource === 'user-interrupt' ||
    execution.exitCode === 130
  ) {
    const isUserInterrupt =
      execution.completionSource === 'user-interrupt' ||
      execution.exitCode === 130 ||
      (execution.lifecycle === 'interrupted' && execution.completionSource !== 'pane-close');
    return {
      criterionId: criterion.id,
      status: isUserInterrupt ? 'interrupted' : 'error',
      executionId: execution.id,
      observedExitCode: execution.exitCode,
      startedAt,
      completedAt,
      message: isUserInterrupt
        ? 'Execution interrupted by user'
        : `Execution interrupted before completion (source: ${execution.completionSource ?? 'unknown'})`,
    };
  }

  // 3. Trust Boundary Validation
  const isTrusted =
    execution.outcomeTrusted === true &&
    execution.outcomeSource === 'trusted-shell';

  if (!isTrusted) {
    return {
      criterionId: criterion.id,
      status: 'error',
      executionId: execution.id,
      observedExitCode: execution.exitCode,
      startedAt,
      completedAt,
      message:
        execution.outcomeSource === 'unknown' || !execution.outcomeSource
          ? 'Execution outcome could not be authoritatively verified (untrusted or unauthenticated completion source)'
          : `Execution outcome source '${execution.outcomeSource}' is not trusted for authoritative verification`,
    };
  }

  // 4. Missing or null exit code
  if (execution.exitCode === null || execution.exitCode === undefined) {
    return {
      criterionId: criterion.id,
      status: 'error',
      executionId: execution.id,
      observedExitCode: null,
      startedAt,
      completedAt,
      message: 'Execution completed without an authoritative exit code',
    };
  }

  // 5. Authoritative Deterministic Evaluation
  const observedExitCode = execution.exitCode;
  const isSatisfied = criterion.expectedExitCodes.includes(observedExitCode);

  if (isSatisfied) {
    return {
      criterionId: criterion.id,
      status: 'passed',
      executionId: execution.id,
      observedExitCode,
      startedAt,
      completedAt,
      message: `Observed exit code ${observedExitCode} satisfies expected [${criterion.expectedExitCodes.join(', ')}]`,
    };
  }

  return {
    criterionId: criterion.id,
    status: 'failed',
    executionId: execution.id,
    observedExitCode,
    startedAt,
    completedAt,
    message: `Observed exit code ${observedExitCode} does not satisfy expected [${criterion.expectedExitCodes.join(', ')}]`,
  };
}

/**
 * Pure function to derive aggregate VerificationRun status from criterion results.
 *
 * DETERMINISTIC RULES (Phase 7 & HARDEN-016.1):
 * - If no results: 'pending'
 * - If any result is running: 'running'
 * - If cancelled: 'cancelled'
 * - If any result is 'error': 'error' (missing / untrusted / interrupted evidence)
 * - If any result is 'failed': 'failed'
 * - If all completed criteria 'passed': 'passed'
 */
export function deriveVerificationRunStatus(
  results: VerificationCriterionResult[],
  wasCancelled: boolean = false,
): VerificationRunStatus {
  if (results.length === 0) {
    return 'pending';
  }

  if (wasCancelled) {
    return 'cancelled';
  }

  // Check if any criterion is still running or pending
  const hasRunning = results.some((r) => r.status === 'running');
  const hasPending = results.some((r) => r.status === 'pending');

  if (hasRunning) {
    return 'running';
  }

  // If there are still pending criteria, and some haven't completed, it's either pending or running
  if (hasPending) {
    const hasCompletedAny = results.some(
      (r) =>
        r.status === 'passed' ||
        r.status === 'failed' ||
        r.status === 'error' ||
        r.status === 'interrupted',
    );
    return hasCompletedAny ? 'running' : 'pending';
  }

  // All criteria are finished.
  // Evaluate terminal aggregate status:
  // 1. If any criterion was interrupted or skipped without completion, run is cancelled
  if (results.some((r) => r.status === 'interrupted' || r.status === 'skipped')) {
    return 'cancelled';
  }

  // 2. Error takes precedence over pass (untrusted / unevaluable evidence)
  if (results.some((r) => r.status === 'error')) {
    return 'error';
  }

  // 3. Failed criterion causes run to fail
  if (results.some((r) => r.status === 'failed')) {
    return 'failed';
  }

  // 4. All passed
  if (results.every((r) => r.status === 'passed')) {
    return 'passed';
  }

  return 'error';
}

export type VerificationPresentationStatus =
  | 'pending'
  | 'running'
  | 'stopping'
  | 'stop-timeout'
  | 'passed'
  | 'failed'
  | 'error'
  | 'cancelled';

export interface VerificationPresentationInfo {
  status: VerificationPresentationStatus;
  badgeLabel: string;
  badgeClass: string;
}

/**
 * Derives a canonical unified presentation status across Verify tab, panel header, and Run History.
 * Ensures that UI truth never contradicts underlying execution or runtime truth.
 */
export function deriveVerificationPresentation(params: {
  run?: VerificationRun | null;
  isRunning?: boolean;
  isStopping?: boolean;
  isStopTimeout?: boolean;
}): VerificationPresentationInfo {
  const { run, isRunning, isStopping, isStopTimeout } = params;

  let status: VerificationPresentationStatus = run?.status ?? 'pending';

  if (isStopTimeout || run?.status === 'stop-timeout') {
    status = 'stop-timeout';
  } else if (isStopping || run?.status === 'stopping') {
    status = 'stopping';
  } else if (isRunning || run?.status === 'running') {
    if (
      run &&
      run.completedAt != null &&
      (run.status === 'passed' ||
        run.status === 'failed' ||
        run.status === 'error' ||
        run.status === 'cancelled')
    ) {
      status = run.status;
    } else {
      status = 'running';
    }
  }

  let badgeLabel: string;
  let badgeClass: string;

  switch (status) {
    case 'stopping':
      badgeLabel = 'STOPPING';
      badgeClass = 'stopping';
      break;
    case 'stop-timeout':
      badgeLabel = 'STOP ISSUE';
      badgeClass = 'stop-timeout';
      break;
    case 'running':
      badgeLabel = 'RUNNING';
      badgeClass = 'running';
      break;
    case 'passed':
      badgeLabel = 'PASSED';
      badgeClass = 'passed';
      break;
    case 'failed':
      badgeLabel = 'FAILED';
      badgeClass = 'failed';
      break;
    case 'error':
      badgeLabel = 'ERROR';
      badgeClass = 'error';
      break;
    case 'cancelled':
      badgeLabel = 'CANCELLED';
      badgeClass = 'cancelled';
      break;
    case 'pending':
    default:
      badgeLabel = 'PENDING';
      badgeClass = 'pending';
      break;
  }

  return { status, badgeLabel, badgeClass };
}

export interface VerificationTabIndicator {
  tone: 'neutral' | 'warning' | 'success' | 'danger' | 'none';
  label: string;
  tooltip: string;
  ariaLabel: string;
  dotClass: string;
  hasDot: boolean;
}

/**
 * Derives a compact status dot indicator for the Monitor Verify tab.
 * HARDEN-016.1 Section 3, 30, 47:
 * The Verify tab indicator represents ACTIVE RUNTIME ONLY!
 *
 * Mappings:
 * - RUNNING -> yellow (warning) dot
 * - STOPPING -> yellow (warning) dot
 * - STOP ISSUE (stop-timeout) -> red (danger) dot
 * - All other states (idle/pending, passed, failed, error, cancelled) -> NO DOT.
 */
export function deriveVerificationTabIndicator(
  presentation?: VerificationPresentationInfo | null,
): VerificationTabIndicator {
  const status = presentation?.status;

  switch (status) {
    case 'running':
      return {
        tone: 'warning',
        label: 'Running',
        tooltip: 'Verification running',
        ariaLabel: 'Verify — Verification running',
        dotClass: 'verify-status-dot verify-status-dot--warning',
        hasDot: true,
      };
    case 'stopping':
      return {
        tone: 'warning',
        label: 'Stopping',
        tooltip: 'Verification stopping',
        ariaLabel: 'Verify — Verification stopping',
        dotClass: 'verify-status-dot verify-status-dot--warning',
        hasDot: true,
      };
    case 'stop-timeout':
      return {
        tone: 'danger',
        label: 'Stop Issue',
        tooltip: 'Verification command is still running after stop request',
        ariaLabel: 'Verify — Verification command is still running after stop request',
        dotClass: 'verify-status-dot verify-status-dot--danger',
        hasDot: true,
      };
    case 'passed':
    case 'failed':
    case 'error':
    case 'cancelled':
    case 'pending':
    default:
      return {
        tone: 'none',
        label: 'Idle',
        tooltip: 'Verify',
        ariaLabel: 'Verify',
        dotClass: '',
        hasDot: false,
      };
  }
}

/**
 * Reconciles selection set to contain strictly valid, existing, runnable criterion IDs.
 * HARDEN-016.1 Section 11, 12:
 * Unavailable and deleted criterion IDs are automatically removed.
 */
export function reconcileVerificationSelection(
  criteria: VerificationCriterion[],
  selectedIds: Set<string> | string[],
): Set<string> {
  const selectedSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const runnableIds = new Set(
    criteria
      .filter((c) => c.availability !== 'unavailable')
      .map((c) => c.id),
  );

  const next = new Set<string>();
  for (const id of selectedSet) {
    if (runnableIds.has(id)) {
      next.add(id);
    }
  }
  return next;
}

/**
 * Derives selection counts adhering to invariant 0 <= selectedCount <= totalRunnableCount.
 */
export function deriveVerificationSelectionCounts(
  criteria: VerificationCriterion[],
  selectedIds: Set<string> | string[],
): {
  selectedCount: number;
  totalRunnableCount: number;
  validSelectedCriteria: VerificationCriterion[];
} {
  const selectedSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const runnableCriteria = criteria.filter((c) => c.availability !== 'unavailable');
  const validSelectedCriteria = runnableCriteria.filter((c) => selectedSet.has(c.id));

  return {
    selectedCount: validSelectedCriteria.length,
    totalRunnableCount: runnableCriteria.length,
    validSelectedCriteria,
  };
}

/**
 * Reconciles selection set against criteria, preserving existing selections for remaining criteria.
 * HARDEN-VERIFY-DELETE-018:
 * - Prunes deleted or unavailable criteria.
 * - Preserves existing user selection intent.
 * - If profile switches, selects all runnable criteria by default.
 */
export function reconcileSelectedCriterionIds(
  previousSelectedIds: Set<string> | string[],
  criteria: VerificationCriterion[],
  isProfileSwitch: boolean = false,
): Set<string> {
  if (isProfileSwitch) {
    const runnable = criteria.filter((c) => c.availability !== 'unavailable');
    return new Set(runnable.map((c) => c.id));
  }
  return reconcileVerificationSelection(criteria, previousSelectedIds);
}
