import 'server-only';
import { sql } from 'drizzle-orm';
import { SERVER_SEQ_LOCK_KEY } from '@/server/db/schema';
import type { Db } from '@/server/db/types';

/**
 * Serialises `server_seq` assignment with commit order. Call first in every
 * transaction that inserts or updates a synced row. The lock is released at commit
 * or rollback, so no transaction can draw a lower `server_seq` and commit after a
 * higher one is visible, and pull's cursor never skips a row. See docs/SYNC.md.
 */
export async function lockServerSeq(tx: Db): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${SERVER_SEQ_LOCK_KEY})`);
}

/** The next value of the shared sequence, for updates (inserts use the column default). */
export function nextServerSeq() {
  return sql<number>`nextval('server_seq')`;
}
