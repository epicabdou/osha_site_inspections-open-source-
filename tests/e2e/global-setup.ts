import { execSync } from 'node:child_process';
import { clerkSetup } from '@clerk/testing/playwright';
import { del } from '@vercel/blob';
import { Client } from 'pg';
import { hasClerkKeys } from './env';

/**
 * 1. Prepares the throwaway e2e database: applies the committed migrations, seeds the
 *    templates, and empties every data table so each run starts clean. Photos uploaded by
 *    earlier runs are deleted from Blob storage first, so test files never accumulate.
 * 2. Fetches a Clerk Testing Token so sign-in flows are not blocked by bot protection.
 */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (url) {
    const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url };
    execSync('pnpm db:migrate', { env, stdio: 'inherit' });
    execSync('pnpm db:seed', { env, stdio: 'inherit' });
    const client = new Client({ connectionString: url });
    await client.connect();
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const uploaded = await client
      .query<{ pathname: string }>(
        `select 'inspections/' || inspection_id || '/' || hash || '.jpg' as pathname from photos`,
      )
      .catch(() => ({ rows: [] as { pathname: string }[] }));
    if (token && uploaded.rows.length > 0) {
      await del(
        uploaded.rows.map((row) => row.pathname),
        { token },
      );
    }
    await client.query(
      'truncate corrective_actions, photos, answer_events, inspections, processed_mutations',
    );
    await client.end();
  } else {
    console.warn('E2E_DATABASE_URL not set: tests that need the database will be skipped.');
  }

  if (!hasClerkKeys()) {
    console.warn('Clerk keys not set: skipping clerkSetup(); auth tests will be skipped.');
    return;
  }
  await clerkSetup();
}
