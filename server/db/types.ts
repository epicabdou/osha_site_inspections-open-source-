import 'server-only';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/**
 * Any Drizzle Postgres database or transaction over this schema: node-postgres in
 * production, PGlite in tests. Server modules take this instead of a concrete driver.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
