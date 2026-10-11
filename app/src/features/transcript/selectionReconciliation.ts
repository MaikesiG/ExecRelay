export function reconcileSelectedBlockIds(
  selectedBlockIds: ReadonlySet<string>,
  availableBlockIds: ReadonlySet<string>,
): Set<string> {
  const reconciled = new Set<string>();
  for (const blockId of selectedBlockIds) {
    if (availableBlockIds.has(blockId)) {
      reconciled.add(blockId);
    }
  }
  return reconciled;
}

export function selectAllBlockIds(
  selectableBlockIds: Iterable<string>,
): Set<string> {
  return new Set(selectableBlockIds);
}

export function toggleSelectedBlockId(
  selectedBlockIds: ReadonlySet<string>,
  blockId: string,
  availableBlockIds: ReadonlySet<string>,
): Set<string> {
  const next = reconcileSelectedBlockIds(selectedBlockIds, availableBlockIds);
  if (!availableBlockIds.has(blockId)) return next;
  if (next.has(blockId)) {
    next.delete(blockId);
  } else {
    next.add(blockId);
  }
  return next;
}

interface SelectionMirror {
  selection: {
    selectedBlockIds: Set<string>;
    updatedAt: number;
  };
}

export function synchronizeBlockSelection<T extends SelectionMirror>(
  panes: readonly T[],
  selectedBlockIds: ReadonlySet<string>,
  updatedAt: number,
): { selectedBlockIds: Set<string>; panes: T[] } {
  const canonicalSelectedBlockIds = new Set(selectedBlockIds);
  return {
    selectedBlockIds: canonicalSelectedBlockIds,
    panes: panes.map((pane) => ({
      ...pane,
      selection: {
        selectedBlockIds: new Set(canonicalSelectedBlockIds),
        updatedAt,
      },
    })),
  };
}
