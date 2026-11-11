import { pullQuerySchema } from '@/lib/schemas';
import { json, requireApiUser } from '@/server/api';
import { getDb } from '@/server/db/client';
import { pullChanges } from '@/server/sync/pull';

/**
 * GET /api/sync/pull?cursor=<n>&limit=500
 * Everything the caller may see with server_seq > cursor. See docs/SYNC.md.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const query = pullQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return json({ error: 'invalid_query' }, { status: 400 });

  const result = await pullChanges(getDb(), user, query.data.cursor, query.data.limit);
  return json(result);
}
