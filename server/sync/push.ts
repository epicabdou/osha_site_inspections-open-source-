import 'server-only';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Role } from '@/lib/auth/roles';
import { isCriticalFailure, valueMatchesItem } from '@/lib/answers/evaluate';
import {
  findTemplateItem,
  type Mutation,
  type MutationResult,
  mutationSchema,
  type RejectReason,
  uuidV7,
} from '@/lib/schemas';
import {
  answerEvents,
  correctiveActions,
  inspections,
  processedMutations,
  templates,
} from '@/server/db/schema';
import type { Db } from '@/server/db/types';
import { lockServerSeq, nextServerSeq } from './seq';

export type PushUser = { userId: string; role: Role };

/** A final, expected refusal. Rolls back the mutation's savepoint and is recorded. */
class Rejection extends Error {
  constructor(readonly reason: RejectReason) {
    super(reason);
  }
}

const reject = (reason: RejectReason): never => {
  throw new Rejection(reason);
};

const STATUS_REASON: Record<string, RejectReason | undefined> = {
  cancelled: 'inspection_cancelled',
  closed: 'inspection_closed',
  submitted: 'inspection_submitted',
};

async function loadOwnedDraft(tx: Db, user: PushUser, inspectionId: string) {
  const [inspection] = await tx
    .select()
    .from(inspections)
    .where(eq(inspections.id, inspectionId))
    .limit(1);
  if (!inspection) return reject('inspection_not_found');
  if (inspection.createdBy !== user.userId) return reject('not_owner');
  const blocked = STATUS_REASON[inspection.status];
  if (blocked) return reject(blocked);
  return inspection;
}

async function applyCreate(
  tx: Db,
  user: PushUser,
  mutation: Extract<Mutation, { kind: 'inspection.create' }>,
) {
  const inspection = mutation.payload;
  if (user.role !== 'inspector') reject('forbidden');
  if (inspection.createdBy !== user.userId) reject('not_owner');
  if (inspection.status !== 'draft' || inspection.submittedAtDevice) reject('invalid_payload');

  const [template] = await tx
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.id, inspection.templateId),
        eq(templates.version, inspection.templateVersion),
      ),
    )
    .limit(1);
  if (!template) reject('unknown_template_version');

  const inserted = await tx
    .insert(inspections)
    .values({
      id: inspection.id,
      templateId: inspection.templateId,
      templateVersion: inspection.templateVersion,
      site: inspection.site,
      status: 'draft',
      createdBy: user.userId,
      createdAtDevice: new Date(inspection.createdAtDevice),
      // The server decides this from accepted events, never from the client's flag.
      hasCriticalFailure: false,
    })
    .onConflictDoNothing({ target: inspections.id })
    .returning({ id: inspections.id });
  if (inserted.length === 0) {
    // The id exists already (another mutation created it). Fine if it is ours.
    const [existing] = await tx
      .select({ createdBy: inspections.createdBy })
      .from(inspections)
      .where(eq(inspections.id, inspection.id));
    if (existing?.createdBy !== user.userId) reject('not_owner');
  }
}

async function applyAnswer(
  tx: Db,
  user: PushUser,
  mutation: Extract<Mutation, { kind: 'answer.record' }>,
) {
  const event = mutation.payload;
  if (event.authorId !== user.userId) reject('not_owner');
  const inspection = await loadOwnedDraft(tx, user, event.inspectionId);

  const [template] = await tx
    .select({ definition: templates.definition })
    .from(templates)
    .where(
      and(
        eq(templates.id, inspection.templateId),
        eq(templates.version, inspection.templateVersion),
      ),
    )
    .limit(1);
  if (!template) return reject('unknown_template_version');
  const item = findTemplateItem(template.definition, event.itemId);
  if (!item) return reject('unknown_item');
  if (!valueMatchesItem(item, event.value)) return reject('invalid_payload');

  const inserted = await tx
    .insert(answerEvents)
    .values({
      id: event.id,
      inspectionId: event.inspectionId,
      itemId: event.itemId,
      value: event.value,
      note: event.note ?? null,
      photoHashes: event.photoHashes,
      hlc: event.hlc,
      deviceId: event.deviceId,
      authorId: user.userId,
      deviceTime: new Date(event.deviceTime),
    })
    .onConflictDoNothing({ target: answerEvents.id })
    .returning({ id: answerEvents.id });

  if (inserted.length > 0 && isCriticalFailure(item, event.value)) {
    // An accepted critical fail raises one corrective action, unique on its source event.
    await tx
      .insert(correctiveActions)
      .values({
        id: uuidv7(),
        inspectionId: event.inspectionId,
        itemId: event.itemId,
        sourceEventId: event.id,
      })
      .onConflictDoNothing({ target: correctiveActions.sourceEventId });
    if (!inspection.hasCriticalFailure) {
      await tx
        .update(inspections)
        .set({ hasCriticalFailure: true, serverSeq: nextServerSeq() })
        .where(eq(inspections.id, inspection.id));
    }
  }
}

async function applySubmit(
  tx: Db,
  user: PushUser,
  mutation: Extract<Mutation, { kind: 'inspection.submit' }>,
) {
  const { inspectionId, submittedAtDevice } = mutation.payload;
  await loadOwnedDraft(tx, user, inspectionId);
  await tx
    .update(inspections)
    .set({
      status: 'submitted',
      submittedAtDevice: new Date(submittedAtDevice),
      serverSeq: nextServerSeq(),
    })
    .where(eq(inspections.id, inspectionId));
}

async function apply(tx: Db, user: PushUser, mutation: Mutation): Promise<void> {
  switch (mutation.kind) {
    case 'inspection.create':
      return applyCreate(tx, user, mutation);
    case 'answer.record':
      return applyAnswer(tx, user, mutation);
    case 'inspection.submit':
      return applySubmit(tx, user, mutation);
  }
}

/** Best-effort mutation id from a payload that failed validation, so the client can match it. */
function rawMutationId(raw: unknown): string | undefined {
  const id = (raw as { mutationId?: unknown } | null)?.mutationId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Applies a batch of mutations in order and returns one result per mutation.
 *
 * - The batch runs in one transaction that first takes the `server_seq` advisory lock.
 * - Each mutation runs in its own savepoint: a rejection rolls back only that mutation.
 * - Every outcome (accepted or rejected) is recorded in `processed_mutations`; a mutation
 *   id seen before returns its stored result, as `duplicate` when it had been accepted.
 * - A rejection is final and never retried by the client. An unexpected error aborts the
 *   whole batch (nothing is recorded), so the client retries it later.
 */
export async function processPush(
  db: Db,
  user: PushUser,
  deviceId: string,
  rawMutations: unknown[],
): Promise<MutationResult[]> {
  return db.transaction(async (tx) => {
    await lockServerSeq(tx);
    const results: MutationResult[] = [];

    for (const raw of rawMutations) {
      const parsed = mutationSchema.safeParse(raw);
      const mutationId = parsed.success ? parsed.data.mutationId : rawMutationId(raw);

      if (!mutationId || !uuidV7.safeParse(mutationId).success) {
        // Without a valid id there is nothing to record against; report it and move on.
        results.push({
          mutationId: mutationId ?? '',
          status: 'rejected',
          reason: 'invalid_payload',
        });
        continue;
      }

      const [seen] = await tx
        .select({ result: processedMutations.result })
        .from(processedMutations)
        .where(eq(processedMutations.mutationId, mutationId))
        .limit(1);
      if (seen) {
        const stored = seen.result as MutationResult;
        results.push(stored.status === 'accepted' ? { mutationId, status: 'duplicate' } : stored);
        continue;
      }

      let result: MutationResult;
      if (!parsed.success) {
        result = { mutationId, status: 'rejected', reason: 'invalid_payload' };
      } else {
        try {
          await tx.transaction(async (savepoint) => apply(savepoint, user, parsed.data));
          result = { mutationId, status: 'accepted' };
        } catch (error) {
          if (!(error instanceof Rejection)) throw error;
          result = { mutationId, status: 'rejected', reason: error.reason };
        }
      }

      await tx.insert(processedMutations).values({ mutationId, deviceId, result });
      results.push(result);
    }
    return results;
  });
}
