import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const emptyModule = fileURLToPath(new URL('./tests/stubs/empty.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      // These guard packages throw outside a bundler that sets the right
      // condition. Tests run server and client code in plain Node, so stub them.
      'server-only': emptyModule,
      'client-only': emptyModule,
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'server/**'],
      exclude: ['server/db/migrations/**', '**/*.d.ts'],
      reporter: ['text', 'html', 'lcov'],
      // The sync engine and the answer reducer are the heart of the project.
      thresholds: {
        'lib/sync/**': { lines: 90 },
        'lib/answers/**': { lines: 90 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/fake-indexeddb.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'property',
          include: ['tests/property/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/fake-indexeddb.ts'],
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          include: ['tests/server/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/fake-indexeddb.ts'],
          // Each file boots its own in-memory Postgres (PGlite); give it time.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
