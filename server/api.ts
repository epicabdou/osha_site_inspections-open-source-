import 'server-only';
import type { Role } from '@/lib/auth/roles';
import { getSessionUser } from './auth';

export type ApiUser = { userId: string; role: Role };

/** A JSON response that is never cached by browsers, CDNs or the service worker. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return Response.json(body, { ...init, headers });
}

/**
 * For route handlers: the signed-in user with a valid role, or an error response.
 * The role comes from the verified session token, never from the request.
 */
export async function requireApiUser(): Promise<ApiUser | Response> {
  const user = await getSessionUser();
  if (!user) return json({ error: 'unauthenticated' }, { status: 401 });
  if (!user.role) return json({ error: 'forbidden' }, { status: 403 });
  return { userId: user.userId, role: user.role };
}
