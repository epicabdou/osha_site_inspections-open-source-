import 'server-only';
import { clerkClient } from '@clerk/nextjs/server';

/**
 * Display names for Clerk user ids. The app stores only user ids; names are looked up
 * when the dashboard renders and never copied into the database.
 */
export async function displayNames(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({ userId: unique, limit: 100 });
    for (const user of data) {
      names.set(user.id, user.fullName || user.firstName || user.username || 'Unnamed user');
    }
  } catch (error) {
    // Names are a convenience: the dashboard still works with ids if Clerk is unreachable.
    console.warn('Could not load user names', error instanceof Error ? error.message : error);
  }
  return names;
}
