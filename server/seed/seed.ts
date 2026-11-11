import 'server-only';
import { templateSchema } from '@/lib/schemas';
import { templates } from '@/server/db/schema';
import type { Db } from '@/server/db/types';
import { lockServerSeq } from '@/server/sync/seq';
import { SEED_TEMPLATES } from './templates';

/**
 * Publishes the seed templates. Idempotent: a template version that already exists
 * is left untouched, because published versions are immutable.
 */
export async function seedTemplates(db: Db): Promise<number> {
  let inserted = 0;
  await db.transaction(async (tx) => {
    await lockServerSeq(tx);
    for (const template of SEED_TEMPLATES) {
      const definition = templateSchema.parse(template);
      const rows = await tx
        .insert(templates)
        .values({
          id: definition.id,
          version: definition.version,
          title: definition.title,
          definition,
        })
        .onConflictDoNothing()
        .returning({ id: templates.id });
      inserted += rows.length;
    }
  });
  return inserted;
}
