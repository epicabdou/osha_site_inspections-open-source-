import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { correctiveActions, inspections } from '@/server/db/schema';
import type { Db } from '@/server/db/types';
import { lockServerSeq, nextServerSeq } from '@/server/sync/seq';

/** Inputs of the supervisor's two actions, validated with Zod on the server. */
export const cancelInspectionInput = z.object({
  inspectionId: z.uuid(),
  reason: z.string().trim().min(3, 'Give a reason (at least 3 characters).').max(500),
});
export const closeCorrectiveActionInput = z.object({
  actionId: z.uuid(),
  note: z.string().trim().min(3, 'Add a closing note (at least 3 characters).').max(2000),
});

export type MutationOutcome = { ok: true } | { ok: false; error: string };

/**
 * Cancels a draft or submitted inspection. The change bumps `server_seq`, so the
 * inspector's device learns about it on its next pull; answers it sends afterwards are
 * rejected with `inspection_cancelled`.
 */
export async function cancelInspection(
  db: Db,
  input: z.infer<typeof cancelInspectionInput>,
): Promise<MutationOutcome> {
  return db.transaction(async (tx) => {
    await lockServerSeq(tx);
    const updated = await tx
      .update(inspections)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: input.reason,
        serverSeq: nextServerSeq(),
      })
      .where(
        and(
          eq(inspections.id, input.inspectionId),
          inArray(inspections.status, ['draft', 'submitted']),
        ),
      )
      .returning({ id: inspections.id });
    return updated.length
      ? { ok: true }
      : { ok: false, error: 'Only inspections in progress or submitted can be cancelled.' };
  });
}

/**
 * Closes an open corrective action with a note. Only a supervisor does this: a later
 * pass on the same item never closes it, so the record stays honest.
 */
export async function closeCorrectiveAction(
  db: Db,
  supervisorId: string,
  input: z.infer<typeof closeCorrectiveActionInput>,
): Promise<MutationOutcome> {
  return db.transaction(async (tx) => {
    await lockServerSeq(tx);
    const updated = await tx
      .update(correctiveActions)
      .set({
        status: 'closed',
        closedAt: new Date(),
        closedBy: supervisorId,
        closeNote: input.note,
        serverSeq: nextServerSeq(),
      })
      .where(and(eq(correctiveActions.id, input.actionId), eq(correctiveActions.status, 'open')))
      .returning({ id: correctiveActions.id });
    return updated.length
      ? { ok: true }
      : { ok: false, error: 'This corrective action is already closed.' };
  });
}
