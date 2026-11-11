import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Import boundaries that protect the offline guarantees (see docs/ARCHITECTURE.md):
 * - Server code never imports the device database (lib/db.ts) or Dexie.
 * - Client and shared code never imports server/.
 * The 'server-only' and 'client-only' packages enforce the same rules at build time;
 * these lint rules catch the mistake earlier, in the editor.
 */
const serverImportBan = {
  group: ['@/server', '@/server/*', '**/server/*'],
  message: 'server/ is server-only. Shared code belongs in lib/.',
};
const deviceDbBan = {
  group: ['@/lib/db', 'dexie', 'dexie-react-hooks', 'fake-indexeddb'],
  message: 'The device database is client-only. Server code talks to Postgres via server/db.',
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `any` needs an eslint-disable comment with a reason (`-- why`).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    files: ['components/**', 'lib/**', 'app/field/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [serverImportBan] }],
    },
  },
  {
    files: ['server/**', 'app/api/**', 'app/dashboard/**', 'proxy.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [deviceDbBan] }],
    },
  },
  {
    // Node scripts and config files may log to the console.
    files: ['scripts/**', '*.config.*', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    'public/sw.js',
    'server/db/migrations/**',
  ]),
]);

export default eslintConfig;
