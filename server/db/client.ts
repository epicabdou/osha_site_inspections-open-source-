import 'server-only';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

let db: Database | undefined;

/**
 * The shared Postgres connection, created on first use so that `next build`
 * never needs DATABASE_URL. Uses node-postgres over TCP, which supports the
 * interactive transactions, savepoints and advisory locks that sync relies on.
 */
export function getDb(): Database {
  if (db) return db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. See .env.example.');
  }
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000 });
  db = drizzle(pool, { schema });
  return db;
}
