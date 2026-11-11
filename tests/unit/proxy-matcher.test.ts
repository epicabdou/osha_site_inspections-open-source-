import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import { config } from '@/proxy';

const matches = (path: string) =>
  unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` });

describe('proxy matcher', () => {
  it.each(['/', '/dashboard', '/dashboard/inspections/abc', '/api/sync/push', '/sign-in'])(
    'runs Clerk on %s',
    (path) => {
      expect(matches(path)).toBe(true);
    },
  );

  // /field must never be redirected by auth, or the service worker could
  // precache a redirect instead of the app.
  it.each([
    '/field',
    '/field?view=inspection&id=01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f',
    '/_next/static/chunks/main.js',
    '/sw.js',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
  ])('skips %s', (path) => {
    expect(matches(path)).toBe(false);
  });

  it('does not treat other paths that start with "field" as the field app', () => {
    expect(matches('/fieldwork')).toBe(true);
  });
});
