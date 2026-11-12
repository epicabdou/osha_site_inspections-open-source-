import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reduceAnswers, type ReducibleEvent } from '@/lib/answers/reduce';
import { encodeHlc } from '@/lib/sync/hlc';
import type { AnswerValue } from '@/lib/schemas';

/**
 * Property: the current answers depend only on the SET of events, never on the order
 * they arrived in. That is what makes sync converge: two devices that end up holding
 * the same events show the same answers, however the events travelled.
 */

const value: fc.Arbitrary<AnswerValue> = fc.oneof(
  fc
    .constantFrom('pass', 'fail', 'na')
    .map((result) => ({ kind: 'pass_fail_na', result }) as AnswerValue),
  fc.integer({ min: -5, max: 5 }).map((v) => ({ kind: 'number', value: v }) as AnswerValue),
  fc.constant({ kind: 'cleared' } as AnswerValue),
);

const eventsArb = fc
  .array(
    fc.record({
      itemId: fc.constantFrom('item-a', 'item-b', 'item-c'),
      deviceId: fc.constantFrom('device-1', 'device-2', 'device-3'),
      wallMs: fc.integer({ min: 0, max: 40 }),
      counter: fc.integer({ min: 0, max: 2 }),
      value,
      note: fc.option(fc.constantFrom('loose', 'ok'), { nil: undefined }),
    }),
    { maxLength: 40 },
  )
  .map((rows) =>
    rows.map((row, index): ReducibleEvent => ({
      id: `event-${String(index).padStart(3, '0')}`,
      itemId: row.itemId,
      value: row.value,
      note: row.note,
      photoHashes: [],
      // Clocks may collide across devices; the device id in the clock breaks ties.
      hlc: encodeHlc({ wallMs: row.wallMs, counter: row.counter }, row.deviceId),
      deviceId: row.deviceId,
    })),
  );

/** A canonical, order-free description of the reduced answers. */
function describeAnswers(events: ReducibleEvent[]) {
  return [...reduceAnswers(events).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, answer]) => ({
      itemId,
      current: answer.current?.id ?? null,
      history: answer.history.map((e) => e.id),
      conflicting: answer.conflicting,
    }));
}

/** What a device stores: events keyed by id (Dexie bulkPut), so re-delivery changes nothing. */
function deviceStore(...deliveries: ReducibleEvent[][]): ReducibleEvent[] {
  const byId = new Map<string, ReducibleEvent>();
  for (const delivery of deliveries) for (const event of delivery) byId.set(event.id, event);
  return [...byId.values()];
}

describe('convergence (properties)', () => {
  it('any order of the same events gives the same current answers', () => {
    fc.assert(
      fc.property(
        eventsArb.chain((events) =>
          fc.tuple(fc.constant(events), fc.shuffledSubarray(events, { minLength: events.length })),
        ),
        ([events, shuffled]) => {
          expect(describeAnswers(shuffled)).toEqual(describeAnswers(events));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('two devices that exchange events in different orders, with re-deliveries, agree', () => {
    fc.assert(
      fc.property(
        eventsArb.chain((events) =>
          fc.tuple(
            fc.constant(events),
            fc.subarray(events), // what device A recorded
            fc.shuffledSubarray(events, { minLength: events.length }), // the order B hears things
          ),
        ),
        ([events, onA, arrivalOrder]) => {
          const onB = events.filter((e) => !onA.includes(e));
          // A: its own events, then everything B pushed, with some delivered twice.
          const deviceA = deviceStore(onA, onB, onB.slice(0, 3));
          // B: its own events, then everything else in a scrambled order.
          const deviceB = deviceStore(onB, arrivalOrder, onA);
          expect(describeAnswers(deviceA)).toEqual(describeAnswers(deviceB));
        },
      ),
      { numRuns: 500 },
    );
  });
});
