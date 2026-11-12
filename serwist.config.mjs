// @ts-check
// Serwist "configurator" mode: `serwist build` runs after `next build`, bundles
// app/sw.ts with esbuild and injects the precache manifest. See docs/ARCHITECTURE.md.
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { serwist } from '@serwist/next/config';

/** A revision for /field that changes with every build. */
function buildRevision() {
  if (existsSync('.next/BUILD_ID')) return readFileSync('.next/BUILD_ID', 'utf8').trim();
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return randomUUID();
  }
}

export default serwist({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // Prerendered HTML is not globbed: that would precache other static pages, including
  // the /dashboard shell. Only /field is precached, by URL, with a per-build revision.
  precachePrerendered: false,
  additionalPrecacheEntries: [{ url: '/field', revision: buildRevision() }],
  globIgnores: ['**/*.map'],
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
});
