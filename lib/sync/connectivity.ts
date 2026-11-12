import { useSyncExternalStore } from 'react';

/**
 * Connectivity as the app experiences it. `navigator.onLine` alone is not enough: it
 * reports true on Wi-Fi with no internet. The app is offline when the browser says so
 * OR the last sync request failed with a network error, and back online after a
 * request succeeds.
 */

let lastRequestOk = true;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Called by the sync engine and upload queue after every request. */
export function reportRequest(ok: boolean): void {
  if (ok === lastRequestOk) return;
  lastRequestOk = ok;
  emit();
}

/** True when the device appears to be online. */
export function isOnline(): boolean {
  const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  return browserOnline && lastRequestOk;
}

/** Subscribes to connectivity changes (browser events and request outcomes). */
export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** React hook: whether the device appears to be online (see module docs). */
export function useConnectivity(): boolean {
  return useSyncExternalStore(subscribeConnectivity, isOnline, () => true);
}
