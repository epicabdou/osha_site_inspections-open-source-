/**
 * A tiny event channel from the write actions to the sync engine, so the engine can
 * schedule a sync shortly after the inspector's last change without the actions
 * importing the engine.
 */
const listeners = new Set<() => void>();

/** Called after every successful local write. */
export function notifyLocalWrite(): void {
  for (const listener of listeners) listener();
}

/** Subscribes to local writes; returns an unsubscribe function. */
export function onLocalWrite(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
