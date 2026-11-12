import { describe, expect, it } from 'vitest';
import { compareHlc, decodeHlc, encodeHlc, HLC_ZERO, isHlc, merge, tick } from '@/lib/sync/hlc';

const DEVICE = '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f';

describe('tick', () => {
  it('follows the wall clock when it moves forward', () => {
    const a = tick(HLC_ZERO, 1_000);
    expect(a).toEqual({ wallMs: 1_000, counter: 0 });
    expect(tick(a, 2_000)).toEqual({ wallMs: 2_000, counter: 0 });
  });

  it('increments the counter within the same millisecond', () => {
    const a = tick(HLC_ZERO, 1_000);
    expect(tick(a, 1_000)).toEqual({ wallMs: 1_000, counter: 1 });
  });

  it('never goes backwards when the wall clock does', () => {
    const a = tick(HLC_ZERO, 5_000);
    const b = tick(a, 1_000); // the device clock jumped back 4 seconds
    expect(b).toEqual({ wallMs: 5_000, counter: 1 });
    expect(compareHlc(encodeHlc(b, DEVICE), encodeHlc(a, DEVICE))).toBe(1);
  });

  it('borrows the next millisecond instead of overflowing the counter', () => {
    expect(tick({ wallMs: 7, counter: 99_999 }, 7)).toEqual({ wallMs: 8, counter: 0 });
  });
});

describe('merge', () => {
  it('jumps ahead of a remote clock that is in the future', () => {
    const local = tick(HLC_ZERO, 1_000);
    const merged = merge(local, { wallMs: 9_000, counter: 4 }, 1_000);
    expect(merged).toEqual({ wallMs: 9_000, counter: 5 });
    // The next local event, even with a slow wall clock, sorts after the remote one.
    const next = tick(merged, 1_001);
    expect(next.wallMs).toBe(9_000);
    expect(next.counter).toBe(6);
  });

  it('uses the larger counter when all three clocks agree', () => {
    expect(merge({ wallMs: 10, counter: 2 }, { wallMs: 10, counter: 7 }, 10)).toEqual({
      wallMs: 10,
      counter: 8,
    });
  });

  it('keeps its own clock when the remote one is older', () => {
    expect(merge({ wallMs: 50, counter: 3 }, { wallMs: 10, counter: 9 }, 20)).toEqual({
      wallMs: 50,
      counter: 4,
    });
  });

  it('resets the counter when the wall clock is ahead of both', () => {
    expect(merge({ wallMs: 50, counter: 3 }, { wallMs: 40, counter: 9 }, 60)).toEqual({
      wallMs: 60,
      counter: 0,
    });
  });
});

describe('encoding', () => {
  it('round-trips', () => {
    const hlc = encodeHlc({ wallMs: 1_794_430_000_123, counter: 42 }, DEVICE);
    expect(hlc).toBe(`001794430000123-00042-${DEVICE}`);
    expect(decodeHlc(hlc)).toEqual({ wallMs: 1_794_430_000_123, counter: 42, deviceId: DEVICE });
    expect(isHlc(hlc)).toBe(true);
  });

  it('sorts as plain strings in clock order', () => {
    const clocks = [
      { wallMs: 2, counter: 0 },
      { wallMs: 1, counter: 10 },
      { wallMs: 1, counter: 9 },
      { wallMs: 100, counter: 0 },
    ];
    const encoded = clocks.map((c) => encodeHlc(c, DEVICE)).sort();
    expect(encoded.map((h) => decodeHlc(h).wallMs * 1000 + decodeHlc(h).counter)).toEqual([
      1009, 1010, 2000, 100000,
    ]);
  });

  it('breaks exact ties by device id', () => {
    const a = encodeHlc({ wallMs: 5, counter: 0 }, 'device-a');
    const b = encodeHlc({ wallMs: 5, counter: 0 }, 'device-b');
    expect(compareHlc(a, b)).toBe(-1);
  });

  it('rejects malformed clocks', () => {
    expect(() => decodeHlc('yesterday')).toThrow();
    expect(isHlc('1-2-3')).toBe(false);
    expect(() => encodeHlc({ wallMs: 1, counter: 0 }, '')).toThrow();
  });
});

describe('clock skew', () => {
  it('keeps causal order when one device is 2 hours ahead', () => {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const now = 1_794_430_000_000;
    // Device A runs 2 hours fast and answers first.
    const a = tick(HLC_ZERO, now + TWO_HOURS);
    // Device B (correct clock) receives A's event, then answers.
    const b = tick(merge(tick(HLC_ZERO, now), a, now + 1), now + 2);
    expect(compareHlc(encodeHlc(b, 'device-b'), encodeHlc(a, 'device-a'))).toBe(1);
  });
});
