import { beforeEach, describe, expect, it } from 'vitest';
import { db, type LastUser } from '@/lib/db';
import { createInspection, recordAnswer } from '@/lib/field/actions';
import {
  BACKOFF_MAX_MS,
  backoffDelay,
  recoverSending,
  releaseBatch,
  settleBatch,
  takeBatch,
  toMutation,
} from '@/lib/sync/outbox';
import { mutationSchema } from '@/lib/schemas';
import { SEED_TEMPLATES } from '@/server/seed/templates';

const user: LastUser = { userId: 'user_inspector', displayName: 'Inspector', role: 'inspector' };
const scaffold = SEED_TEMPLATES[0]!;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.templates.put(scaffold);
});

async function seedOutbox() {
  const inspection = await createInspection(
    { templateId: scaffold.id, templateVersion: 1, site: 'Warehouse A' },
    user,
  );
  const event = await recordAnswer(
    {
      inspectionId: inspection.id,
      itemId: 'safe-way-up',
      value: { kind: 'pass_fail_na', result: 'pass' },
    },
    user,
  );
  return { inspection, event };
}

describe('backoffDelay', () => {
  it('doubles from 2 s and caps at 5 minutes, within ±20% jitter', () => {
    expect(backoffDelay(1, () => 0.5)).toBe(2_000);
    expect(backoffDelay(2, () => 0.5)).toBe(4_000);
    expect(backoffDelay(3, () => 0.5)).toBe(8_000);
    expect(backoffDelay(30, () => 0.5)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(1, () => 0)).toBe(1_600);
    expect(backoffDelay(1, () => 1)).toBe(2_400);
    expect(backoffDelay(30, () => 1)).toBe(BACKOFF_MAX_MS);
  });
});

describe('outbox state machine', () => {
  it('queued → sending: takes entries in order and marks their records queued', async () => {
    const { inspection, event } = await seedOutbox();
    const batch = await takeBatch(db);
    expect(batch.map((e) => e.kind)).toEqual(['inspection.create', 'answer.record']);
    expect((await db.outbox.toArray()).every((e) => e.state === 'sending')).toBe(true);
    expect((await db.answerEvents.get(event.id))?.syncState).toBe('queued');
    expect((await db.inspections.get(inspection.id))?.syncState).toBe('queued');
    for (const entry of batch)
      expect(mutationSchema.safeParse(toMutation(entry)).success).toBe(true);
  });

  it('does not take entries that are already sending', async () => {
    await seedOutbox();
    await takeBatch(db);
    expect(await takeBatch(db)).toEqual([]);
  });

  it('sending → accepted/duplicate: deletes the entry and marks the record synced', async () => {
    const { inspection, event } = await seedOutbox();
    const batch = await takeBatch(db);
    await settleBatch(db, batch, [
      { mutationId: batch[0]!.mutationId, status: 'accepted' },
      { mutationId: batch[1]!.mutationId, status: 'duplicate' },
    ]);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.answerEvents.get(event.id))?.syncState).toBe('synced');
    expect((await db.inspections.get(inspection.id))?.syncState).toBe('synced');
  });

  it('sending → rejected: deletes the entry, keeps the record with its reason', async () => {
    const { event } = await seedOutbox();
    const batch = await takeBatch(db);
    const outcome = await settleBatch(db, batch, [
      { mutationId: batch[0]!.mutationId, status: 'accepted' },
      { mutationId: batch[1]!.mutationId, status: 'rejected', reason: 'inspection_cancelled' },
    ]);
    expect(outcome).toEqual({ accepted: 1, rejected: 1 });
    expect(await db.outbox.count()).toBe(0);
    const stored = await db.answerEvents.get(event.id);
    expect(stored).toMatchObject({ syncState: 'rejected', rejectReason: 'inspection_cancelled' });
  });

  it('sending → queued on a network error, with one more attempt and a retry time', async () => {
    const { event } = await seedOutbox();
    const batch = await takeBatch(db);
    await releaseBatch(db, batch, 'Network request failed', 12_345);
    const entries = await db.outbox.toArray();
    expect(entries.map((e) => [e.state, e.attempts, e.nextAttemptAt, e.lastError])).toEqual([
      ['queued', 1, 12_345, 'Network request failed'],
      ['queued', 1, 12_345, 'Network request failed'],
    ]);
    // The answer is still handed to sync, not lost and not rejected.
    expect((await db.answerEvents.get(event.id))?.syncState).toBe('queued');
    expect(await takeBatch(db)).toHaveLength(2);
  });

  it('an entry the server did not answer for goes back to the queue', async () => {
    await seedOutbox();
    const batch = await takeBatch(db);
    await settleBatch(db, batch, [{ mutationId: batch[0]!.mutationId, status: 'accepted' }]);
    const left = await db.outbox.toArray();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ state: 'queued', attempts: 1, kind: 'answer.record' });
  });

  it('recovers entries left in sending by a crash or reload', async () => {
    await seedOutbox();
    await takeBatch(db);
    expect(await recoverSending(db)).toBe(2);
    expect((await db.outbox.toArray()).every((e) => e.state === 'queued')).toBe(true);
  });
});
