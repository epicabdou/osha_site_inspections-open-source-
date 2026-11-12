/**
 * Hybrid logical clock (HLC).
 *
 * Each device keeps `(wallMs, counter)`. The clock never goes backwards, even if the
 * device's wall clock does, and it absorbs every remote clock it sees, so an event
 * created after seeing another event always sorts after it. Encoded as a fixed-width
 * string ending in the device id, plain string order is clock order.
 *
 * Format: `<wallMs, 15 digits>-<counter, 5 digits>-<deviceId>`.
 */

export type HlcState = {
  /** Milliseconds since the epoch, as the clock understands "now". */
  wallMs: number;
  /** Orders events within the same millisecond. */
  counter: number;
};

const WALL_DIGITS = 15;
const COUNTER_DIGITS = 5;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;

/** The clock before any event: sorts before every real clock. */
export const HLC_ZERO: HlcState = { wallMs: 0, counter: 0 };

function normalise(state: HlcState): HlcState {
  // A counter overflow borrows the next millisecond rather than breaking the encoding.
  if (state.counter > MAX_COUNTER) return { wallMs: state.wallMs + 1, counter: 0 };
  return state;
}

/**
 * Advances the clock for a local event.
 * `wallMs` becomes the larger of the stored value and `nowMs`; the counter resets
 * when `wallMs` moved and increments otherwise.
 */
export function tick(state: HlcState, nowMs: number): HlcState {
  const wallMs = Math.max(state.wallMs, Math.floor(nowMs));
  const counter = wallMs === state.wallMs ? state.counter + 1 : 0;
  return normalise({ wallMs, counter });
}

/**
 * Absorbs a clock received from elsewhere (pulled events), so that the next local
 * event sorts after everything this device has seen.
 */
export function merge(state: HlcState, remote: HlcState, nowMs: number): HlcState {
  const now = Math.floor(nowMs);
  const wallMs = Math.max(state.wallMs, remote.wallMs, now);
  let counter: number;
  if (wallMs === state.wallMs && wallMs === remote.wallMs) {
    counter = Math.max(state.counter, remote.counter) + 1;
  } else if (wallMs === state.wallMs) {
    counter = state.counter + 1;
  } else if (wallMs === remote.wallMs) {
    counter = remote.counter + 1;
  } else {
    counter = 0;
  }
  return normalise({ wallMs, counter });
}

/** Encodes a clock and device id as a string whose natural order is clock order. */
export function encodeHlc(state: HlcState, deviceId: string): string {
  if (!deviceId) throw new Error('encodeHlc: deviceId is required');
  const wall = String(state.wallMs).padStart(WALL_DIGITS, '0');
  const counter = String(state.counter).padStart(COUNTER_DIGITS, '0');
  return `${wall}-${counter}-${deviceId}`;
}

/** Decodes a clock string. Throws on anything that was not produced by `encodeHlc`. */
export function decodeHlc(hlc: string): HlcState & { deviceId: string } {
  const match = /^(\d{15})-(\d{5})-(.+)$/.exec(hlc);
  if (!match) throw new Error(`Invalid HLC: ${hlc}`);
  return { wallMs: Number(match[1]), counter: Number(match[2]), deviceId: match[3]! };
}

/** True if `hlc` is a well-formed clock string. */
export function isHlc(hlc: string): boolean {
  return /^\d{15}-\d{5}-.+$/.test(hlc);
}

/** Compares two clock strings: negative if `a` is earlier. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
