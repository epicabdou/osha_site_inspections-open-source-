import { vi } from 'vitest';
import { pullQuerySchema, pushRequestSchema } from '@/lib/schemas';
import { setTokenProvider } from '@/lib/sync/api';
import type { Role } from '@/lib/auth/roles';
import type { Db } from '@/server/db/types';
import { pullChanges } from '@/server/sync/pull';
import { processPush } from '@/server/sync/push';

/**
 * A fake network between simulated devices and the real server code on PGlite.
 * `fetch` is replaced with a router for /api/sync/push and /api/sync/pull; the bearer
 * token is the user id. `offline` makes every request fail like a dropped connection.
 */
export function installFakeNetwork(db: Db, roles: Record<string, Role>) {
  const state = { offline: false, requests: 0 };

  const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    state.requests += 1;
    if (state.offline) throw new TypeError('Failed to fetch');
    const url = new URL(String(input), 'http://localhost');
    const userId = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') ?? '';
    const role = roles[userId];
    if (!role) return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 });

    if (url.pathname === '/api/sync/push') {
      const body = pushRequestSchema.parse(JSON.parse(String(init?.body)));
      const results = await processPush(db, { userId, role }, body.deviceId, body.mutations);
      return Response.json({ results, serverTime: new Date().toISOString() });
    }
    if (url.pathname === '/api/sync/pull') {
      const query = pullQuerySchema.parse(Object.fromEntries(url.searchParams));
      return Response.json(await pullChanges(db, { userId }, query.cursor, query.limit));
    }
    return new Response('not found', { status: 404 });
  });

  vi.stubGlobal('fetch', fakeFetch);
  return {
    state,
    /** Signs the (single, global) token provider in as `userId`, or out. */
    signIn(userId: string | null) {
      setTokenProvider(userId ? async () => userId : null);
    },
  };
}
