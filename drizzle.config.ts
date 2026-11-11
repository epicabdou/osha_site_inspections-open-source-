import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

// Load .env, .env.local etc. the same way Next.js does.
loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    // Only `migrate` and `studio` connect; `generate` works without a database.
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
