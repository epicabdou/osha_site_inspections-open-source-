import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';
import { testUsers } from './env';

const users = testUsers();

test.describe('test users can sign in', () => {
  test.skip(!users, 'Needs Clerk keys and E2E_INSPECTOR_EMAIL / E2E_SUPERVISOR_EMAIL');

  test('the supervisor reaches the dashboard', async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto('/');
    await clerk.signIn({ page, emailAddress: users!.supervisor });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  });

  test('the inspector is kept out of the dashboard', async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto('/');
    await clerk.signIn({ page, emailAddress: users!.inspector });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole('heading', { name: 'This area is for supervisors' })).toBeVisible();
  });
});
