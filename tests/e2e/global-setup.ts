import { clerkSetup } from '@clerk/testing/playwright';
import { hasClerkKeys } from './env';

/**
 * Fetches a Clerk Testing Token once per run, so sign-in flows are not blocked
 * by Clerk's bot protection. Skipped when no Clerk keys are configured; the
 * tests that need Clerk skip themselves in that case.
 */
export default async function globalSetup() {
  if (!hasClerkKeys()) {
    console.warn('Clerk keys not set: skipping clerkSetup(); auth tests will be skipped.');
    return;
  }
  await clerkSetup();
}
