import type { FieldDatabase, OutboxEntry } from '@/lib/db';
import { MAX_PUSH_BATCH, type Mutation, type MutationResult } from '@/lib/schemas';

/**
 * The outbox state machine.
 *
 *   queued ──take──▶ sending ──accepted/duplicate──▶ (deleted; record synced)
 *     ▲                 │
 *     └──network error──┤ (attempts + 1)
 *                       └──rejected──▶ (deleted; record keeps syncState 'rejected' + reason)
 *
 * An entry is removed only once the server has answered for it. Nothing is dropped
 * silently: a rejection is written onto the record it describes, which stays visible.
 */

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

/**
 * Delay before retry number `failures` (1-based): 2 s, 4 s, 8 s… capped at 5 minutes,
 * with ±20% jitter so many devices do not retry in lockstep.
 */
export function backoffDelay(failures: number, random: () => number = Math.random): number {
  const exponential = BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1);
  const jittered = Math.min(exponential, BACKOFF_MAX_MS) * (0.8 + 0.4 * random());
  return Math.round(Math.min(jittered, BACKOFF_MAX_MS));
}

/** The mutation an entry carries, in wire form. */
export function toMutation(entry: OutboxEntry): Mutation {
  return {
    mutationId: entry.mutationId,
    kind: entry.kind,
    payload: entry.payload,
    hlc: entry.hlc,
  } as Mutation;
}

function answerEventId(entry: OutboxEntry): string | undefined {
  return entry.kind === 'answer.record' ? (entry.payload as { id: string }).id : undefined;
}

function inspectionId(entry: OutboxEntry): string | undefined {
  if (entry.kind === 'inspection.create') return (entry.payload as { id: string }).id;
  if (entry.kind === 'inspection.submit')
    return (entry.payload as { inspectionId: string }).inspectionId;
  return undefined;
}

const tablesOf = (database: FieldDatabase) => [
  database.outbox,
  database.answerEvents,
  database.inspections,
];

/**
 * After a crash or reload mid-request, entries left in `sending` go back to `queued`.
 * Resending is safe: the server recognises a mutation id it has seen.
 */
export async function recoverSending(database: FieldDatabase): Promise<number> {
  return database.outbox.where('state').equals('sending').modify({ state: 'queued' });
}

/**
 * Takes the oldest queued entries, in order, and marks them `sending`. Order matters:
 * an answer must never reach the server before the inspection it belongs to.
 */
export async function takeBatch(
  database: FieldDatabase,
  max: number = MAX_PUSH_BATCH,
): Promise<OutboxEntry[]> {
  return database.transaction('rw', tablesOf(database), async () => {
    const entries = await database.outbox.orderBy('seq').limit(max).toArray();
    const batch = entries.filter((entry) => entry.state === 'queued');
    if (batch.length === 0) return [];
    await database.outbox.bulkUpdate(
      batch.map((entry) => ({ key: entry.seq!, changes: { state: 'sending' as const } })),
    );
    for (const entry of batch) {
      const eventId = answerEventId(entry);
      if (eventId) {
        await database.answerEvents
          .where('id')
          .equals(eventId)
          .and((event) => event.syncState === 'local')
          .modify({ syncState: 'queued' });
      }
      const id = inspectionId(entry);
      if (id) {
        await database.inspections
          .where('id')
          .equals(id)
          .and((inspection) => inspection.syncState === 'local')
          .modify({ syncState: 'queued' });
      }
    }
    return batch.map((entry) => ({ ...entry, state: 'sending' as const }));
  });
}

/**
 * Applies the server's answer for a batch in one transaction. Accepted and duplicate
 * entries are deleted and their records marked synced; rejected entries are deleted and
 * their records keep the rejection and its reason. An entry the server did not mention
 * (it never should) goes back to the queue.
 */
export async function settleBatch(
  database: FieldDatabase,
  batch: OutboxEntry[],
  results: MutationResult[],
): Promise<{ accepted: number; rejected: number }> {
  const byId = new Map(results.map((result) => [result.mutationId, result]));
  let accepted = 0;
  let rejected = 0;
  await database.transaction('rw', tablesOf(database), async () => {
    for (const entry of batch) {
      const result = byId.get(entry.mutationId);
      if (!result) {
        await database.outbox.update(entry.seq!, { state: 'queued', attempts: entry.attempts + 1 });
        continue;
      }
      await database.outbox.delete(entry.seq!);
      const ok = result.status !== 'rejected';
      if (ok) accepted += 1;
      else rejected += 1;
      const changes = ok
        ? { syncState: 'synced' as const, rejectReason: undefined }
        : { syncState: 'rejected' as const, rejectReason: result.reason ?? 'invalid_payload' };
      const eventId = answerEventId(entry);
      if (eventId) await database.answerEvents.update(eventId, changes);
      const id = inspectionId(entry);
      if (id) await database.inspections.update(id, changes);
    }
  });
  return { accepted, rejected };
}

/** A temporary failure (network, 5xx): the batch returns to the queue, one attempt more. */
export async function releaseBatch(
  database: FieldDatabase,
  batch: OutboxEntry[],
  error: string,
  nextAttemptAt: number,
): Promise<void> {
  await database.transaction('rw', database.outbox, async () => {
    for (const entry of batch) {
      await database.outbox.update(entry.seq!, {
        state: 'queued',
        attempts: entry.attempts + 1,
        lastError: error,
        nextAttemptAt,
      });
    }
  });
}

/** Number of entries still waiting for the server. */
export function outboxSize(database: FieldDatabase): Promise<number> {
  return database.outbox.count();
}
