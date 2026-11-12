import { sql } from 'drizzle-orm';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import type { AnswerValue } from '@/lib/schemas';
import {
  answerEvents,
  correctiveActions,
  inspections,
  processedMutations,
} from '@/server/db/schema';
import { seedTemplates } from '@/server/seed/seed';
import { processPush, type PushUser } from '@/server/sync/push';
import { answerMutation, createMutation, submitMutation } from '../server/helpers/mutations';
import { createTestDatabase, type TestDatabase } from '../server/helpers/pglite';

/**
 * Property: processing the same push batch twice leaves Postgres unchanged.
 * A device retries a batch whenever it did not see the response (a dropped
 * connection, a timeout), so the server must apply every mutation at most once.
 * Batches mix valid answers, critical fails, rejections and malformed entries.
 */

let t: TestDatabase;
const inspector: PushUser = { userId: 'user_inspector', role: 'inspector' };

beforeAll(async () => {
  t = await createTestDatabase();
  await seedTemplates(t.db);
});

afterAll(async () => {
  await t.client.close();
});

const valueArb: fc.Arbitrary<AnswerValue> = fc.oneof(
  fc
    .constantFrom('pass', 'fail', 'na')
    .map((result) => ({ kind: 'pass_fail_na', result }) as AnswerValue),
  fc.integer({ min: 0, max: 2000 }).map((value) => ({ kind: 'number', value }) as AnswerValue),
  fc.constant({ kind: 'text', value: 'note' } as AnswerValue),
  fc.constant({ kind: 'cleared' } as AnswerValue),
);

const stepArb = fc.oneof(
  fc.record({
    type: fc.constant('answer' as const),
    item: fc.constantFrom(
      'tag-in-date',
      'guardrail-height',
      'toe-boards',
      'weather',
      'no-such-item',
    ),
    value: valueArb,
    device: fc.constantFrom('device-a', 'device-b'),
  }),
  fc.record({ type: fc.constant('submit' as const) }),
  fc.record({ type: fc.constant('malformed' as const) }),
  fc.record({ type: fc.constant('orphan' as const) }),
);

const batchArb = fc.record({
  create: fc.boolean(),
  steps: fc.array(stepArb, { maxLength: 15 }),
});

async function dump() {
  const [i, e, c, p] = await Promise.all([
    t.db.select().from(inspections).orderBy(inspections.id),
    t.db.select().from(answerEvents).orderBy(answerEvents.id),
    t.db.select().from(correctiveActions).orderBy(correctiveActions.sourceEventId),
    t.db.select().from(processedMutations).orderBy(processedMutations.mutationId),
  ]);
  return { inspections: i, answerEvents: e, correctiveActions: c, processedMutations: p };
}

describe('push (properties)', () => {
  it('processing the same batch twice leaves Postgres unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(batchArb, async ({ create, steps }) => {
        await t.db.execute(
          sql`truncate corrective_actions, photos, answer_events, inspections, processed_mutations`,
        );
        const createM = createMutation(inspector.userId);
        const id = createM.payload.id;
        const batch: unknown[] = create ? [createM] : [];
        for (const step of steps) {
          if (step.type === 'answer') {
            batch.push(
              answerMutation(inspector.userId, id, step.item, step.value, {
                deviceId: step.device,
              }),
            );
          } else if (step.type === 'submit') {
            batch.push(submitMutation(id));
          } else if (step.type === 'malformed') {
            batch.push({ mutationId: uuidv7(), kind: 'answer.record', payload: { nope: true } });
          } else {
            batch.push(
              answerMutation(inspector.userId, uuidv7(), 'toe-boards', { kind: 'cleared' }),
            );
          }
        }
        if (batch.length === 0) return;

        const first = await processPush(t.db, inspector, 'device-a', batch);
        const once = await dump();
        const second = await processPush(t.db, inspector, 'device-a', batch);
        expect(await dump()).toEqual(once);

        // The retry reports the same outcome for every mutation.
        expect(second.map((r) => (r.status === 'duplicate' ? 'accepted' : r.status))).toEqual(
          first.map((r) => r.status),
        );
        expect(second.map((r) => r.reason)).toEqual(first.map((r) => r.reason));
      }),
      { numRuns: 40 },
    );
  });
});
