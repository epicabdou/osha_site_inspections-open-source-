import { pushRequestSchema } from '@/lib/schemas';
import { json, requireApiUser } from '@/server/api';
import { getDb } from '@/server/db/client';
import { processPush } from '@/server/sync/push';

/**
 * POST /api/sync/push
 * Body: { deviceId, mutations: Mutation[] } (at most 100). Each mutation is applied at
 * most once; the response has one result per mutation and the server time. See docs/SYNC.md.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = pushRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, { status: 400 });

  const results = await processPush(getDb(), user, parsed.data.deviceId, parsed.data.mutations);
  return json({ results, serverTime: new Date().toISOString() });
}
