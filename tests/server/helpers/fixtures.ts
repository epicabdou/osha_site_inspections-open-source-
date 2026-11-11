import { v7 as uuidv7 } from 'uuid';
import type { AnswerValue } from '@/lib/schemas';
import { answerEvents, inspections } from '@/server/db/schema';
import type { Db } from '@/server/db/types';
import { lockServerSeq } from '@/server/sync/seq';

/** Inserts an inspection directly (bypassing push) for read-side tests. */
export async function insertInspection(
  db: Db,
  values: Partial<typeof inspections.$inferInsert> & { createdBy: string },
) {
  return db.transaction(async (tx) => {
    await lockServerSeq(tx);
    const [row] = await tx
      .insert(inspections)
      .values({
        id: uuidv7(),
        templateId: 'scaffold-inspection',
        templateVersion: 1,
        site: 'Warehouse A',
        createdAtDevice: new Date('2026-11-11T09:00:00.000Z'),
        ...values,
      })
      .returning();
    return row!;
  });
}

let clock = 1_794_430_000_000;

/** Inserts an answer event directly, with a fresh, increasing clock. */
export async function insertEvent(
  db: Db,
  inspectionId: string,
  itemId: string,
  value: AnswerValue,
  deviceId = 'device-a',
) {
  clock += 1;
  return db.transaction(async (tx) => {
    await lockServerSeq(tx);
    const [row] = await tx
      .insert(answerEvents)
      .values({
        id: uuidv7(),
        inspectionId,
        itemId,
        value,
        hlc: `${String(clock).padStart(15, '0')}-00000-${deviceId}`,
        deviceId,
        authorId: 'user_inspector',
        deviceTime: new Date(clock),
      })
      .returning();
    return row!;
  });
}
