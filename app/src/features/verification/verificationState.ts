/**
 * TraceRelay / CapTerm Workspace Verification State Management
 *
 * Provides pure state reducers and accessors for Verification Contracts and Runs
 * within LogicalWorkspaces.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. Historical runs are immutable: adding a new run appends to the history array.
 * 2. Contract updates update the contract definition, but never retroactively mutate
 *    historical VerificationRuns (which hold their own criteriaSnapshot).
 * 3. Strict workspace isolation: contracts and runs belong strictly to their owning workspace.
 */

import type { LogicalWorkspace } from '../workspace/types';
import type {
  VerificationContract,
  VerificationCriterion,
  VerificationRun,
} from './types';
import { createVerificationContract } from './verificationModel';

export interface WorkspaceVerificationState {
  contracts: VerificationContract[];
  activeContractId: string | null;
  runs: VerificationRun[];
  activeRunId: string | null;
  selectedCriterionIds?: Set<string>;
}

/**
 * Creates deterministic default verification state for a workspace.
 * RELEASE-POLISH-VERIFY-023: A genuinely new workspace starts with zero verification criteria.
 * ExecRelay must not guess or automatically seed Test/Typecheck/Lint/Build commands.
 * HARDEN-VERIFY-DELETE-018: Guarantees stable contract and criteria identity.
 */
export function createDefaultWorkspaceVerificationState(
  workspaceId: string,
): WorkspaceVerificationState {
  const defaultContract = createVerificationContract({
    id: `contract-std-${workspaceId}`,
    workspaceId,
    name: 'Standard checks',
    criteria: [],
  });
  return {
    contracts: [defaultContract],
    activeContractId: defaultContract.id,
    runs: [],
    activeRunId: null,
    selectedCriterionIds: new Set<string>(),
  };
}

/**
 * Ensures workspace has initialized, canonical verification state.
 * Pure transformation: returns the same workspace if already initialized,
 * or a new workspace with initialized verification state.
 */
export function ensureWorkspaceVerificationState(
  workspace: LogicalWorkspace,
): LogicalWorkspace {
  if (workspace.verification && workspace.verification.contracts.length > 0) {
    const current = workspace.verification;
    let modified = false;

    // VERIFY-CWD-025: Ensure every criterion has workingDirectory defaulted to '.'
    const normalizedContracts = current.contracts.map((c) => {
      let contractModified = false;
      const criteria = (c.criteria ?? []).map((crit) => {
        if (!crit.workingDirectory || crit.workingDirectory.trim().length === 0) {
          contractModified = true;
          return {
            ...crit,
            workingDirectory: crit.cwd && crit.cwd.trim().length > 0 ? crit.cwd.trim() : '.',
          };
        }
        return crit;
      });
      if (contractModified) {
        modified = true;
        return { ...c, criteria };
      }
      return c;
    });

    const activeContract =
      normalizedContracts.find((c) => c.id === current.activeContractId) ??
      normalizedContracts[0];
    const validIds = new Set(
      activeContract ? activeContract.criteria.map((c) => c.id) : [],
    );

    let selectedCriterionIds = current.selectedCriterionIds;
    if (!selectedCriterionIds) {
      selectedCriterionIds = new Set(validIds);
      modified = true;
    } else {
      const filtered = new Set(
        Array.from(selectedCriterionIds).filter((id) => validIds.has(id)),
      );
      if (filtered.size !== selectedCriterionIds.size) {
        selectedCriterionIds = filtered;
        modified = true;
      }
    }

    if (modified) {
      return {
        ...workspace,
        verification: {
          ...current,
          contracts: normalizedContracts,
          selectedCriterionIds,
        },
      };
    }
    return workspace;
  }
  return {
    ...workspace,
    verification: createDefaultWorkspaceVerificationState(workspace.id),
  };
}

/**
 * Pure accessor: gets verification state for a workspace.
 * If uninitialized, returns deterministic default verification state.
 */
export function getOrCreateWorkspaceVerificationState(
  workspace: LogicalWorkspace,
): WorkspaceVerificationState {
  if (workspace.verification && workspace.verification.contracts.length > 0) {
    const contracts = workspace.verification.contracts;
    const activeContractId =
      workspace.verification.activeContractId ??
      contracts[0].id;
    const activeContract =
      contracts.find((c) => c.id === activeContractId) ?? contracts[0];
    const validIds = new Set(
      activeContract ? activeContract.criteria.map((c) => c.id) : [],
    );

    let selectedCriterionIds: Set<string>;
    if (workspace.verification.selectedCriterionIds) {
      selectedCriterionIds = new Set(
        Array.from(workspace.verification.selectedCriterionIds).filter((id) =>
          validIds.has(id),
        ),
      );
    } else {
      selectedCriterionIds = new Set(validIds);
    }

    return {
      contracts,
      activeContractId,
      runs: workspace.verification.runs ?? [],
      activeRunId: workspace.verification.activeRunId ?? null,
      selectedCriterionIds,
    };
  }

  return createDefaultWorkspaceVerificationState(workspace.id);
}

/**
 * Gets all verification contracts for a workspace.
 */
export function getWorkspaceContracts(
  workspace: LogicalWorkspace,
): VerificationContract[] {
  return getOrCreateWorkspaceVerificationState(workspace).contracts;
}

/**
 * Gets the active verification contract for a workspace.
 */
export function getActiveVerificationContract(
  workspace: LogicalWorkspace,
): VerificationContract {
  const state = getOrCreateWorkspaceVerificationState(workspace);
  const found = state.contracts.find((c) => c.id === state.activeContractId);
  return found ?? state.contracts[0];
}

/**
 * Gets all verification runs for a workspace in chronological order.
 */
export function getWorkspaceVerificationRuns(
  workspace: LogicalWorkspace,
): VerificationRun[] {
  return workspace.verification?.runs ?? [];
}

/**
 * Gets the latest verification run for a workspace.
 */
export function getLatestVerificationRun(
  workspace: LogicalWorkspace,
): VerificationRun | null {
  const runs = getWorkspaceVerificationRuns(workspace);
  if (runs.length === 0) return null;
  return runs[runs.length - 1];
}

export const MAX_RETAINED_VERIFICATION_RUNS = 50;

/**
 * Appends a new VerificationRun to a workspace's historical records.
 * IMMUTABILITY GUARANTEE: Does not mutate existing runs in the history array.
 * BOUNDED RETENTION: Caps historical runs at MAX_RETAINED_VERIFICATION_RUNS to prevent memory bloat.
 */
export function appendVerificationRunToWorkspace(
  workspace: LogicalWorkspace,
  run: VerificationRun,
  maxRetained: number = MAX_RETAINED_VERIFICATION_RUNS,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  let updatedRuns = [...current.runs, run];
  if (updatedRuns.length > maxRetained) {
    updatedRuns = updatedRuns.slice(updatedRuns.length - maxRetained);
  }

  return {
    ...workspace,
    verification: {
      ...current,
      runs: updatedRuns,
      activeRunId: run.id,
    },
  };
}

/**
 * Updates an in-progress VerificationRun in a workspace's state.
 * IMMUTABILITY PROTECTION: Prevents terminal historical runs from being mutated by late events.
 */
export function updateVerificationRunInWorkspace(
  workspace: LogicalWorkspace,
  updatedRun: VerificationRun,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const existingRun = current.runs.find((r) => r.id === updatedRun.id);
  if (
    existingRun &&
    (existingRun.status === 'passed' ||
      existingRun.status === 'failed' ||
      existingRun.status === 'error' ||
      existingRun.status === 'cancelled') &&
    existingRun !== updatedRun &&
    existingRun.completedAt != null &&
    updatedRun.status !== existingRun.status
  ) {
    return workspace;
  }

  const updatedRuns = current.runs.map((r) =>
    r.id === updatedRun.id ? updatedRun : r,
  );

  const isNonTerminal =
    updatedRun.status === 'running' ||
    updatedRun.status === 'pending' ||
    updatedRun.status === 'stopping' ||
    updatedRun.status === 'stop-timeout';

  const activeRun = isNonTerminal
    ? updatedRun
    : updatedRuns.find(
        (r) =>
          r.status === 'running' ||
          r.status === 'pending' ||
          r.status === 'stopping' ||
          r.status === 'stop-timeout',
      );

  return {
    ...workspace,
    verification: {
      ...current,
      runs: updatedRuns,
      activeRunId: activeRun ? activeRun.id : null,
    },
  };
}

/**
 * Updates or replaces a contract in the workspace.
 * HISTORICAL INTEGRITY: Existing runs in `verification.runs` retain their
 * immutable criteriaSnapshot and are NOT affected by contract updates.
 */
export function updateVerificationContractInWorkspace(
  workspace: LogicalWorkspace,
  contract: VerificationContract,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const updatedContracts = current.contracts.map((c) =>
    c.id === contract.id ? { ...contract, updatedAt: Date.now() } : c,
  );

  return {
    ...workspace,
    verification: {
      ...current,
      contracts: updatedContracts,
    },
  };
}

/**
 * Sets the active verification profile (contract) in the workspace.
 */
export function setActiveVerificationContractInWorkspace(
  workspace: LogicalWorkspace,
  contractId: string,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const targetContract = current.contracts.find((c) => c.id === contractId);
  if (!targetContract) {
    return workspace;
  }

  return {
    ...workspace,
    verification: {
      ...current,
      activeContractId: contractId,
      selectedCriterionIds: new Set(targetContract.criteria.map((c) => c.id)),
    },
  };
}

/**
 * Adds a new custom VerificationContract (profile) to the workspace and activates it.
 */
export function addVerificationContractToWorkspace(
  workspace: LogicalWorkspace,
  contract: VerificationContract,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  return {
    ...workspace,
    verification: {
      ...current,
      contracts: [...current.contracts, contract],
      activeContractId: contract.id,
    },
  };
}

/**
 * Renames an existing VerificationContract (profile).
 */
export function renameVerificationContractInWorkspace(
  workspace: LogicalWorkspace,
  contractId: string,
  newName: string,
): LogicalWorkspace {
  const trimmed = newName.trim();
  if (trimmed.length === 0) return workspace;

  const current = getOrCreateWorkspaceVerificationState(workspace);
  const updatedContracts = current.contracts.map((c) =>
    c.id === contractId ? { ...c, name: trimmed, updatedAt: Date.now() } : c,
  );

  return {
    ...workspace,
    verification: {
      ...current,
      contracts: updatedContracts,
    },
  };
}

/**
 * Deletes a VerificationContract (profile) from the workspace.
 * Section 39: Deterministic fallback when active profile is deleted:
 * - Switches to first remaining profile.
 * - If deleting the only remaining profile, recreates the default Standard checks profile.
 * - Does NOT delete historical runs, Executions, or Evidence.
 */
export function deleteVerificationContractFromWorkspace(
  workspace: LogicalWorkspace,
  contractId: string,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  let remainingContracts = current.contracts.filter((c) => c.id !== contractId);

  let nextActiveId: string;
  if (remainingContracts.length === 0) {
    const defaultContract = createVerificationContract({
      id: `contract-std-${workspace.id}`,
      workspaceId: workspace.id,
      name: 'Standard checks',
      criteria: [],
    });
    remainingContracts = [defaultContract];
    nextActiveId = defaultContract.id;
  } else if (current.activeContractId === contractId) {
    nextActiveId = remainingContracts[0].id;
  } else {
    nextActiveId = current.activeContractId ?? remainingContracts[0].id;
  }

  const nextActiveContract =
    remainingContracts.find((c) => c.id === nextActiveId) ?? remainingContracts[0];
  const nextSelectedIds = new Set(
    nextActiveContract ? nextActiveContract.criteria.map((c) => c.id) : [],
  );

  return {
    ...workspace,
    verification: {
      ...current,
      contracts: remainingContracts,
      activeContractId: nextActiveId,
      selectedCriterionIds: nextSelectedIds,
    },
  };
}

/**
 * Adds a new criterion to a contract and re-indexes orders.
 */
export function addCriterionToContractInWorkspace(
  workspace: LogicalWorkspace,
  contractId: string,
  criterion: VerificationCriterion,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const updatedContracts = current.contracts.map((c) => {
    if (c.id !== contractId) return c;
    const nextCriteria = [...c.criteria, criterion].map((crit, idx) => ({
      ...crit,
      order: idx + 1,
    }));
    return {
      ...c,
      criteria: nextCriteria,
      updatedAt: Date.now(),
    };
  });

  const isTargetActive =
    contractId === (current.activeContractId ?? current.contracts[0]?.id);
  const nextSelectedIds = new Set(
    Array.from(current.selectedCriterionIds ?? []),
  );
  if (isTargetActive) {
    nextSelectedIds.add(criterion.id);
  }

  return {
    ...workspace,
    verification: {
      ...current,
      contracts: updatedContracts,
      selectedCriterionIds: nextSelectedIds,
    },
  };
}

/**
 * Updates an existing criterion in a contract.
 */
export function updateCriterionInContractInWorkspace(
  workspace: LogicalWorkspace,
  contractId: string,
  updatedCriterion: VerificationCriterion,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const updatedContracts = current.contracts.map((c) => {
    if (c.id !== contractId) return c;
    const nextCriteria = c.criteria.map((crit) =>
      crit.id === updatedCriterion.id ? { ...updatedCriterion } : crit,
    );
    return {
      ...c,
      criteria: nextCriteria,
      updatedAt: Date.now(),
    };
  });

  return {
    ...workspace,
    verification: {
      ...current,
      contracts: updatedContracts,
    },
  };
}

/**
 * Deletes a criterion from a contract and re-indexes remaining criteria orders.
 * HARDEN-VERIFY-DELETE-018 & HARDEN-VERIFY-DELETE-021:
 * - Resolves target contract robustly (by contractId, or fallback to active/single contract).
 * - Verifies criterion exists before updating.
 * - Preserves remaining criteria IDs and re-indexes orders.
 * - Atomically prunes deleted criterion ID from canonical selectedCriterionIds.
 */
export function deleteCriterionFromContractInWorkspace(
  workspace: LogicalWorkspace,
  contractId: string,
  criterionId: string,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const targetContract =
    current.contracts.find((c) => c.id === contractId) ??
    (current.contracts.length === 1
      ? current.contracts[0]
      : current.contracts.find((c) => c.id === current.activeContractId));

  if (!targetContract) {
    return workspace;
  }

  const targetId = targetContract.id;
  const criterionExists = targetContract.criteria.some((c) => c.id === criterionId);
  if (!criterionExists) {
    return workspace;
  }

  const updatedContracts = current.contracts.map((c) => {
    if (c.id !== targetId) return c;
    const nextCriteria = c.criteria
      .filter((crit) => crit.id !== criterionId)
      .map((crit, idx) => ({
        ...crit,
        order: idx + 1,
      }));
    return {
      ...c,
      criteria: nextCriteria,
      updatedAt: Date.now(),
    };
  });

  // HARDEN-VERIFY-DELETE-021: Atomically produce remaining criteria + selectedCriterionIds filtered against remaining criteria
  const activeContract =
    updatedContracts.find(
      (c) => c.id === (current.activeContractId ?? updatedContracts[0].id),
    ) ?? updatedContracts[0];
  const validIds = new Set(activeContract ? activeContract.criteria.map((c) => c.id) : []);

  const nextSelectedCriterionIds = new Set(
    Array.from(current.selectedCriterionIds ?? []).filter(
      (id) => id !== criterionId && validIds.has(id),
    ),
  );

  return {
    ...workspace,
    verification: {
      ...current,
      contracts: updatedContracts,
      selectedCriterionIds: nextSelectedCriterionIds,
    },
  };
}

/**
 * Reorders criteria in a contract based on an explicit array of criterion IDs.
 */
export function reorderCriteriaInContractInWorkspace(
  workspace: LogicalWorkspace,
  contractId: string,
  orderedCriterionIds: string[],
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const updatedContracts = current.contracts.map((c) => {
    if (c.id !== contractId) return c;
    const map = new Map(c.criteria.map((crit) => [crit.id, crit]));
    const nextCriteria: VerificationCriterion[] = [];

    for (const id of orderedCriterionIds) {
      const found = map.get(id);
      if (found) {
        nextCriteria.push(found);
        map.delete(id);
      }
    }
    // Append any criteria not mentioned in orderedCriterionIds
    for (const remaining of map.values()) {
      nextCriteria.push(remaining);
    }

    const indexedCriteria = nextCriteria.map((crit, idx) => ({
      ...crit,
      order: idx + 1,
    }));

    return {
      ...c,
      criteria: indexedCriteria,
      updatedAt: Date.now(),
    };
  });

  return {
    ...workspace,
    verification: {
      ...current,
      contracts: updatedContracts,
    },
  };
}

/**
 * Toggles a single criterion selection in the workspace verification state.
 * Invariant: selectedCriterionIds ⊆ activeContract.criteria IDs.
 */
export function toggleCriterionSelectionInWorkspace(
  workspace: LogicalWorkspace,
  criterionId: string,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const activeContract = getActiveVerificationContract(workspace);
  const validIds = new Set(activeContract ? activeContract.criteria.map((c) => c.id) : []);

  if (!validIds.has(criterionId)) {
    return workspace;
  }

  const nextSelected = new Set(
    Array.from(current.selectedCriterionIds ?? []).filter((id) => validIds.has(id)),
  );
  if (nextSelected.has(criterionId)) {
    nextSelected.delete(criterionId);
  } else {
    nextSelected.add(criterionId);
  }

  return {
    ...workspace,
    verification: {
      ...current,
      selectedCriterionIds: nextSelected,
    },
  };
}

/**
 * Selects all criteria in the active contract.
 * Invariant: selectedCriterionIds = activeContract.criteria IDs.
 */
export function selectAllCriteriaInWorkspace(
  workspace: LogicalWorkspace,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const activeContract = getActiveVerificationContract(workspace);
  const validIds = new Set(activeContract ? activeContract.criteria.map((c) => c.id) : []);

  return {
    ...workspace,
    verification: {
      ...current,
      selectedCriterionIds: validIds,
    },
  };
}

/**
 * Clears selection in the active contract.
 * Invariant: selectedCriterionIds = empty set.
 */
export function clearCriteriaSelectionInWorkspace(
  workspace: LogicalWorkspace,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  return {
    ...workspace,
    verification: {
      ...current,
      selectedCriterionIds: new Set(),
    },
  };
}

/**
 * Sets explicit criteria selection in the active contract, filtered against valid criteria.
 * Invariant: selectedCriterionIds ⊆ activeContract.criteria IDs.
 */
export function setCriteriaSelectionInWorkspace(
  workspace: LogicalWorkspace,
  selectedIds: Set<string> | string[],
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const activeContract = getActiveVerificationContract(workspace);
  const validIds = new Set(activeContract ? activeContract.criteria.map((c) => c.id) : []);
  const rawList = Array.isArray(selectedIds) ? selectedIds : Array.from(selectedIds);
  const filtered = new Set(rawList.filter((id) => validIds.has(id)));

  return {
    ...workspace,
    verification: {
      ...current,
      selectedCriterionIds: filtered,
    },
  };
}

/**
 * Gets canonical effective verification selection for the active contract.
 * Invariant: returns Set<string> where all IDs ∈ activeContract.criteria.
 */
export function getCanonicalVerificationSelection(
  workspace: LogicalWorkspace,
): Set<string> {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  const activeContract = getActiveVerificationContract(workspace);
  const validIds = new Set(activeContract ? activeContract.criteria.map((c) => c.id) : []);
  return new Set(
    Array.from(current.selectedCriterionIds ?? validIds).filter((id) =>
      validIds.has(id),
    ),
  );
}

/**
 * Clears all historical VerificationRuns from a workspace.
 * PROFILE PRESERVATION: VerificationProfile (contracts), criteria, commands,
 * and criterion selections are strictly preserved.
 */
export function clearWorkspaceVerificationRuns(
  workspace: LogicalWorkspace,
): LogicalWorkspace {
  const current = getOrCreateWorkspaceVerificationState(workspace);
  return {
    ...workspace,
    verification: {
      ...current,
      runs: [],
      activeRunId: null,
    },
  };
}
