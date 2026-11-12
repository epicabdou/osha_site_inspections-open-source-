import { type FieldDatabase, getMeta, setMeta } from '@/lib/db';
import { encodeHlc, HLC_ZERO, merge, tick, decodeHlc } from './hlc';

/**
 * The device's notion of "now", including the demo chaos panel's clock skew.
 * Everything that stamps device time or advances the HLC goes through here.
 */
let skewMs = 0;

/** Sets the simulated clock skew (chaos panel). */
export function setClockSkew(ms: number): void {
  skewMs = ms;
}

/** Device time in epoch ms, including any simulated skew. */
export function deviceNow(): number {
  return Date.now() + skewMs;
}

/** Device time as ISO 8601 UTC. */
export function deviceNowIso(): string {
  return new Date(deviceNow()).toISOString();
}

/**
 * Advances the stored HLC for one local event and returns its encoded clock.
 * Must run inside a Dexie transaction that includes `meta`, together with the
 * write that uses the clock, so two events can never share a clock value.
 */
export async function nextHlc(database: FieldDatabase, deviceId: string): Promise<string> {
  const state = (await getMeta('hlc', database)) ?? HLC_ZERO;
  const next = tick(state, deviceNow());
  await setMeta('hlc', next, database);
  return encodeHlc(next, deviceId);
}

/**
 * Absorbs remote clocks (from pulled events) into the stored HLC.
 * Must run inside a Dexie transaction that includes `meta`.
 */
export async function absorbRemoteClocks(database: FieldDatabase, hlcs: string[]): Promise<void> {
  let latest: { wallMs: number; counter: number } | undefined;
  for (const hlc of hlcs) {
    try {
      const remote = decodeHlc(hlc);
      if (
        !latest ||
        remote.wallMs > latest.wallMs ||
        (remote.wallMs === latest.wallMs && remote.counter > latest.counter)
      ) {
        latest = { wallMs: remote.wallMs, counter: remote.counter };
      }
    } catch {
      // A malformed clock from the server is ignored rather than corrupting ours.
    }
  }
  if (!latest) return;
  const state = (await getMeta('hlc', database)) ?? HLC_ZERO;
  await setMeta('hlc', merge(state, latest, deviceNow()), database);
}
