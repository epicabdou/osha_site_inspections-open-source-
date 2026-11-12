/**
 * `pnpm db:seed`: publishes the demo templates and one past inspection (with a critical
 * failure, an open corrective action and superseded answers) to DATABASE_URL.
 * Safe to run more than once. SEED_INSPECTOR_USER_ID sets who owns the demo inspection;
 * use the demo inspector's Clerk user id so it also appears on that inspector's devices.
 */
import 'server-only';
import { loadEnvConfig } from '@next/env';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/server/db/schema';
import { seedDemoInspection } from './demo';
import { seedTemplates } from './seed';

async function main() {
  loadEnvConfig(process.cwd());
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set. See .env.example.');
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    const templates = await seedTemplates(db);
    const inspector = process.env.SEED_INSPECTOR_USER_ID || 'demo-inspector';
    const answers = await seedDemoInspection(db, inspector);
    console.info(
      `Seed complete: ${templates} new template version(s), ${answers} new demo record(s).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
