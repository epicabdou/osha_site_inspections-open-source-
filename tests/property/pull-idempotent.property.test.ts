import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FieldDatabase } from '@/lib/db';
import type { PullResponse } from '@/lib/schemas';
import { encodeHlc } from '@/lib/sync/hlc';
import { applyPullPage } from '@/lib/sync/pull';
import { SEED_TEMPLATES } from '@/server/seed/templates';

/**
 * Property: applying the same pull page twice leaves the device database unchanged.
 * A device may receive a page again (a retry after a dropped response, or a crash
 * between applying a page and the next request), so applying must be idempotent.
 */

const uuid = (n: number) => `01935c4e-8f4b-7c3a-9d2e-${String(n).padStart(12, '0')}`;
const iso = (ms: number) => new Date(1_794_430_000_000 + ms).toISOString();

const pageArb: fc.Arbitrary<PullResponse> = fc
  .record({
    templates: fc.subarray(SEED_TEMPLATES),
    inspections: fc.uniqueArray(
      fc.record({
        n: fc.integer({ min: 1, max: 20 }),
        status: fc.constantFrom('draft', 'submitted', 'cancelled', 'closed'),
        critical: fc.boolean(),
        cancelled: fc.boolean(),
      }),
      { selector: (i) => i.n, maxLength: 5 },
    ),
    events: fc.uniqueArray(
      fc.record({
        n: fc.integer({ min: 100, max: 300 }),
        inspection: fc.integer({ min: 1, max: 20 }),
        item: fc.constantFrom('safe-way-up', 'toe-boards', 'weather'),
        wall: fc.integer({ min: 0, max: 10_000_000 }),
        device: fc.constantFrom('device-a', 'device-b'),
      }),
      { selector: (e) => e.n, maxLength: 12 },
    ),
    nextCursor: fc.integer({ min: 0, max: 1_000 }),
    hasMore: fc.boolean(),
  })
  .map(({ templates, inspections, events, nextCursor, hasMore }) => ({
    changes: {
      templates,
      inspections: inspections.map((i) => ({
        id: uuid(i.n),
        templateId: 'scaffold-inspection',
        templateVersion: 1,
        site: `Site ${i.n}`,
        status: i.status,
        createdBy: 'user_inspector',
        createdAtDevice: iso(i.n),
        hasCriticalFailure: i.critical,
        serverReceivedAt: iso(i.n + 1),
        ...(i.status === 'cancelled' && i.cancelled
          ? { cancelledAt: iso(i.n + 2), cancelReason: 'Wrong site' }
          : {}),
      })),
      answerEvents: events.map((e) => ({
        id: uuid(e.n),
        inspectionId: uuid(e.inspection),
        itemId: e.item,
        value: { kind: 'pass_fail_na', result: 'pass' } as const,
        photoHashes: [],
        hlc: encodeHlc({ wallMs: e.wall, counter: 0 }, e.device),
        deviceId: e.device,
        authorId: 'user_inspector',
        deviceTime: iso(e.wall),
        serverReceivedAt: iso(e.wall + 5),
      })),
      correctiveActions: [],
    },
    nextCursor,
    hasMore,
  }));

let run = 0;

async function snapshot(database: FieldDatabase) {
  const [templates, inspections, events, actions, meta] = await Promise.all([
    database.templates.toArray(),
    database.inspections.toArray(),
    database.answerEvents.toArray(),
    database.correctiveActions.toArray(),
    database.meta.toArray(),
  ]);
  // The HLC only ever moves forward when a clock is absorbed again; everything else must match.
  return { templates, inspections, events, actions, meta: meta.filter((row) => row.key !== 'hlc') };
}

describe('pull apply (properties)', () => {
  it('applying the same page twice leaves the database unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(pageArb, fc.option(pageArb, { nil: undefined }), async (page, earlier) => {
        run += 1;
        const database = new FieldDatabase(`pull-property-${run}`);
        await database.open();
        try {
          if (earlier) await applyPullPage(database, earlier); // some prior state
          await applyPullPage(database, page);
          const once = await snapshot(database);
          await applyPullPage(database, page);
          expect(await snapshot(database)).toEqual(once);
        } finally {
          database.close();
          await database.delete();
        }
      }),
      { numRuns: 60 },
    );
  });
});
