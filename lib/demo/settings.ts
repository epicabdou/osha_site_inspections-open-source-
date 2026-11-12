import { type DemoSettings, getMeta, setMeta } from '@/lib/db';
import { setClockSkew } from '@/lib/sync/clock';

/**
 * Demo chaos settings: break the network on purpose and watch the app recover.
 * Kept in memory for the fetch wrapper and the clock, persisted in Dexie `meta`.
 */
export const DEFAULT_DEMO_SETTINGS: DemoSettings = {
  forceOffline: false,
  latencyMs: 0,
  dropRate: 0,
  clockSkewMs: 0,
};

export const DEMO_LIMITS = {
  latencyMs: { min: 0, max: 5_000 },
  dropRate: { min: 0, max: 0.5 },
  clockSkewMs: { min: -24 * 60 * 60 * 1000, max: 24 * 60 * 60 * 1000 },
} as const;

let current: DemoSettings = DEFAULT_DEMO_SETTINGS;
const listeners = new Set<() => void>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function sanitise(settings: DemoSettings): DemoSettings {
  return {
    forceOffline: Boolean(settings.forceOffline),
    latencyMs: clamp(settings.latencyMs, DEMO_LIMITS.latencyMs.min, DEMO_LIMITS.latencyMs.max),
    dropRate: clamp(settings.dropRate, DEMO_LIMITS.dropRate.min, DEMO_LIMITS.dropRate.max),
    clockSkewMs: clamp(
      settings.clockSkewMs,
      DEMO_LIMITS.clockSkewMs.min,
      DEMO_LIMITS.clockSkewMs.max,
    ),
  };
}

function apply(settings: DemoSettings) {
  current = settings;
  setClockSkew(settings.clockSkewMs);
  for (const listener of listeners) listener();
}

/** The settings in effect now. */
export function getDemoSettings(): DemoSettings {
  return current;
}

/** True when any chaos setting differs from normal. */
export function isDemoActive(settings: DemoSettings = current): boolean {
  return (
    settings.forceOffline ||
    settings.latencyMs > 0 ||
    settings.dropRate > 0 ||
    settings.clockSkewMs !== 0
  );
}

/** Loads saved settings from the device database. */
export async function loadDemoSettings(): Promise<DemoSettings> {
  const saved = await getMeta('demoSettings');
  apply(sanitise({ ...DEFAULT_DEMO_SETTINGS, ...saved }));
  return current;
}

/** Changes and saves settings. */
export async function updateDemoSettings(patch: Partial<DemoSettings>): Promise<DemoSettings> {
  const next = sanitise({ ...current, ...patch });
  apply(next);
  await setMeta('demoSettings', next);
  return next;
}

/** For useSyncExternalStore. */
export function subscribeDemoSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when the chaos panel should be shown: `?demo=1` or NEXT_PUBLIC_DEMO_MODE. */
export function isDemoModeEnabled(search: string): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return true;
  return new URLSearchParams(search).get('demo') === '1';
}
