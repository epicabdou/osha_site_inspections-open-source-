/** True when real Clerk keys are configured (see .env.example). */
export function hasClerkKeys(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

/** The two test users' email addresses (see README, "Test users"). */
export function testUsers(): { inspector: string; supervisor: string } | null {
  const inspector = process.env.E2E_INSPECTOR_EMAIL;
  const supervisor = process.env.E2E_SUPERVISOR_EMAIL;
  if (!hasClerkKeys() || !inspector || !supervisor) return null;
  return { inspector, supervisor };
}
