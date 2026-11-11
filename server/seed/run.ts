/**
 * `pnpm db:seed`: publishes the demo templates (and, from M5, the demo history)
 * to DATABASE_URL. Safe to run more than once.
 */
import 'server-only';
import { loadEnvConfig } from '@next/env';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/server/db/schema';
import { seedTemplates } from './seed';

async function main() {
  loadEnvConfig(process.cwd());
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set. See .env.example.');
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    const templates = await seedTemplates(db);
    console.info(`Seed complete: ${templates} new template version(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
