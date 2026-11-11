import { loadEnvConfig } from '@next/env';
import { defineConfig, devices } from '@playwright/test';

// Same env files as Next.js (.env.local etc.), so local runs need no extra setup.
loadEnvConfig(process.cwd());

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

/**
 * The app under test talks to E2E_DATABASE_URL, a throwaway Postgres (a Docker
 * container locally, a service container in CI). Global setup migrates, seeds and
 * empties it; it never touches DATABASE_URL.
 */
const databaseUrl = process.env.E2E_DATABASE_URL;

/**
 * End-to-end tests run against a production build (`next build` + `next start`) so the
 * service worker and the prerendered /field page behave as in production.
 * In CI the build is a separate step; locally the web server builds first.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: process.env.CI
      ? `pnpm start --port ${PORT}`
      : `pnpm build && pnpm start --port ${PORT}`,
    url: `${baseURL}/field`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: databaseUrl ? { DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: databaseUrl } : {},
  },
});
