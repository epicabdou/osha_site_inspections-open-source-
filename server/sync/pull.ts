import 'server-only';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { PullResponse } from '@/lib/schemas';
import { answerEvents, correctiveActions, inspections, templates } from '@/server/db/schema';
import type { Db } from '@/server/db/types';
import { serializeAnswerEvent, serializeCorrectiveAction, serializeInspection } from './serialize';

export type PullUser = { userId: string };

type Change =
  | { seq: number; type: 'template'; value: PullResponse['changes']['templates'][number] }
  | { seq: number; type: 'inspection'; value: PullResponse['changes']['inspections'][number] }
  | { seq: number; type: 'answerEvent'; value: PullResponse['changes']['answerEvents'][number] }
  | {
      seq: number;
      type: 'correctiveAction';
      value: PullResponse['changes']['correctiveActions'][number];
    };

/**
 * Everything the user may see with `server_seq > cursor`, oldest first, at most
 * `limit` rows across all tables.
 *
 * An inspector pulls every published template, their own inspections, the events on
 * those inspections and the corrective actions raised from them. Each table is asked
 * for its first `limit + 1` rows past the cursor, so the global first `limit` rows are
 * always among the candidates, and `hasMore` is exact.
 */
export async function pullChanges(
  db: Db,
  user: PullUser,
  cursor: number,
  limit: number,
): Promise<PullResponse> {
  const take = limit + 1;
  const own = db
    .select({ id: inspections.id })
    .from(inspections)
    .where(eq(inspections.createdBy, user.userId));

  const [templateRows, inspectionRows, eventRows, actionRows] = await Promise.all([
    db
      .select()
      .from(templates)
      .where(gt(templates.serverSeq, cursor))
      .orderBy(asc(templates.serverSeq))
      .limit(take),
    db
      .select()
      .from(inspections)
      .where(and(eq(inspections.createdBy, user.userId), gt(inspections.serverSeq, cursor)))
      .orderBy(asc(inspections.serverSeq))
      .limit(take),
    db
      .select()
      .from(answerEvents)
      .where(and(inArray(answerEvents.inspectionId, own), gt(answerEvents.serverSeq, cursor)))
      .orderBy(asc(answerEvents.serverSeq))
      .limit(take),
    db
      .select()
      .from(correctiveActions)
      .where(
        and(inArray(correctiveActions.inspectionId, own), gt(correctiveActions.serverSeq, cursor)),
      )
      .orderBy(asc(correctiveActions.serverSeq))
      .limit(take),
  ]);

  const candidates: Change[] = [
    ...templateRows.map((row) => ({
      seq: row.serverSeq,
      type: 'template' as const,
      value: row.definition,
    })),
    ...inspectionRows.map((row) => ({
      seq: row.serverSeq,
      type: 'inspection' as const,
      value: serializeInspection(row),
    })),
    ...eventRows.map((row) => ({
      seq: row.serverSeq,
      type: 'answerEvent' as const,
      value: serializeAnswerEvent(row),
    })),
    ...actionRows.map((row) => ({
      seq: row.serverSeq,
      type: 'correctiveAction' as const,
      value: serializeCorrectiveAction(row),
    })),
  ].sort((a, b) => a.seq - b.seq);

  const page = candidates.slice(0, limit);
  const changes: PullResponse['changes'] = {
    templates: [],
    inspections: [],
    answerEvents: [],
    correctiveActions: [],
  };
  for (const change of page) {
    if (change.type === 'template') changes.templates.push(change.value);
    else if (change.type === 'inspection') changes.inspections.push(change.value);
    else if (change.type === 'answerEvent') changes.answerEvents.push(change.value);
    else changes.correctiveActions.push(change.value);
  }

  return {
    changes,
    nextCursor: page.at(-1)?.seq ?? cursor,
    hasMore: candidates.length > limit,
  };
}
