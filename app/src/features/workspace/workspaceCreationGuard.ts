/**
 * WORKSPACE-CREATE-GUARD-001: one workspace folder flow (picker, then create or bind) at a
 * time. This is a transient "operation pending" state, not a rule about workspaces and
 * folders.
 *
 * `pending` is checked and set synchronously, before the operation's first await, so clicks
 * that arrive before React re-renders the disabled button are still rejected. It is
 * released in `finally`: on success, on a cancelled picker, and when the operation throws.
 */
export async function runExclusive<T>(
  pending: { current: boolean },
  onPendingChange: (isPending: boolean) => void,
  operation: () => Promise<T>,
): Promise<T | null> {
  if (pending.current) return null;
  pending.current = true;
  onPendingChange(true);
  try {
    return await operation();
  } finally {
    pending.current = false;
    onPendingChange(false);
  }
}
