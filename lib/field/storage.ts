import { getMeta, setMeta } from '@/lib/db';

/**
 * Asks the browser to keep this site's storage (IndexedDB) instead of evicting it under
 * pressure. Called once, after the first inspection is saved.
 */
export async function requestPersistentStorage(): Promise<boolean | undefined> {
  if (!navigator.storage?.persist) return undefined;
  if (await getMeta('persistRequested')) return navigator.storage.persisted?.();
  await setMeta('persistRequested', true);
  return navigator.storage.persist();
}

export type StorageInfo = { usage?: number; quota?: number; persisted?: boolean };

export async function storageInfo(): Promise<StorageInfo> {
  const [estimate, persisted] = await Promise.all([
    navigator.storage?.estimate?.(),
    navigator.storage?.persisted?.(),
  ]);
  return { usage: estimate?.usage, quota: estimate?.quota, persisted };
}

/** True when running as an installed app (home screen), on iOS or elsewhere. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

/** True on iPhone and iPad Safari (iPadOS reports itself as a Mac with touch). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
