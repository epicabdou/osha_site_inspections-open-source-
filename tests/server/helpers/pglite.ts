import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/server/db/schema';

const migrationsFolder = fileURLToPath(new URL('../../../server/db/migrations', import.meta.url));

export type TestDatabase = {
  client: PGlite;
  db: PgliteDatabase<typeof schema>;
};

/**
 * A fresh in-memory Postgres with the committed Drizzle migrations applied,
 * so server tests run against exactly the schema that production gets.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { client, db };
}
