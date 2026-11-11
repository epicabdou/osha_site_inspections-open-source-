import 'server-only';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { roleFromClaims, type Role } from '@/lib/auth/roles';

export type SessionUser = {
  userId: string;
  role: Role | null;
};

/**
 * The signed-in user from the verified Clerk session, or null.
 * The role comes from the session token's claims, never from the request body.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;
  return { userId, role: roleFromClaims(sessionClaims) };
}

/** For Server Components and Server Actions: a supervisor, or a redirect away. */
export async function requireSupervisor(): Promise<SessionUser & { role: 'supervisor' }> {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');
  if (user.role !== 'supervisor') redirect('/forbidden');
  return { ...user, role: 'supervisor' };
}
