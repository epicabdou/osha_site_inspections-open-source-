/// <reference lib="webworker" />
/**
 * Service worker source, bundled by `serwist build` after `next build`
 * (see serwist.config.mjs). Strategy, in order of precedence:
 *
 * 1. /api/* and /dashboard*: network only. Never cached.
 * 2. Any navigation to /field (any search params): the precached /field page,
 *    so every view of the field app opens offline.
 * 3. Build assets (/_next/static) and icons: precached, then cache-first.
 * 4. Clerk's browser scripts: stale-while-revalidate. The app works without them.
 *
 * A new worker waits until the page asks it to activate (the "Update available"
 * toast), so an open inspection is never swapped out from under the inspector.
 */
import {
  CacheFirst,
  ExpirationPlugin,
  NavigationRoute,
  NetworkOnly,
  type PrecacheEntry,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist';

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dashboard')),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url }) =>
        /\.clerk\.accounts\.dev$|^clerk\./.test(url.hostname) &&
        url.pathname.includes('/npm/@clerk/'),
      handler: new StaleWhileRevalidate({
        cacheName: 'clerk-scripts',
        plugins: [new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 7 * 24 * 60 * 60 })],
      }),
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
      handler: new CacheFirst({
        cacheName: 'next-static',
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && /\.(?:png|svg|ico|webp|webmanifest)$/.test(url.pathname),
      handler: new StaleWhileRevalidate({ cacheName: 'static-assets' }),
    },
  ],
});

// Every navigation to /field, whatever the search params, gets the one precached page.
serwist.registerRoute(
  new NavigationRoute(serwist.createHandlerBoundToUrl('/field'), {
    allowlist: [/^\/field(?:\?.*)?$/],
  }),
);

// Serwist handles { type: "SKIP_WAITING" } messages itself when skipWaiting is false.

serwist.addEventListeners();
