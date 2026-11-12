#!/usr/bin/env node
// Fails the build if a route that must work offline is not fully static.
//
// The service worker answers every /field navigation with the one prerendered
// /field page. If /field ever needed request-time rendering, a reload offline
// would have nothing correct to show. `export const ensureStatic = 'navigation'`
// in app/field/page.tsx already makes `next build` fail in that case; this script
// is a second, independent check on the build output, so removing that export
// cannot silently break the offline guarantee.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATIC_ROUTES = ['/field'];
const distDir = join(process.cwd(), '.next');

/** @param {string} message */
function fail(message) {
  console.error(`\n✖ Static route check failed: ${message}\n`);
  process.exit(1);
}

const manifestPath = join(distDir, 'prerender-manifest.json');
if (!existsSync(manifestPath)) {
  fail(`${manifestPath} not found. Run \`next build\` first.`);
}

/** @type {{ routes: Record<string, { compute?: string, initialRevalidateSeconds?: number | false, htmlSize?: number }> }} */
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

for (const route of STATIC_ROUTES) {
  const entry = manifest.routes[route];
  if (!entry) {
    fail(`${route} was not prerendered at build time.`);
  }
  if (entry.compute !== undefined && entry.compute !== 'static') {
    fail(`${route} needs request-time rendering (compute: "${entry.compute}"); it must be static.`);
  }
  if (entry.initialRevalidateSeconds !== false) {
    fail(`${route} revalidates (${entry.initialRevalidateSeconds}s); it must be fully static.`);
  }
  // `next start` serves the HTML from .next/server/app. On Vercel the build adapter
  // moves it into its own output, so fall back to the size Next recorded for it.
  const html = join(distDir, 'server', 'app', `${route.slice(1)}.html`);
  if (!existsSync(html) && !(typeof entry.htmlSize === 'number' && entry.htmlSize > 0)) {
    fail(`${route} has no prerendered HTML (looked for ${html} and a recorded htmlSize).`);
  }
  console.info(`✓ ${route} is fully static`);
}
