import { expect, test } from '@playwright/test';
import { DISCLAIMER } from '@/components/ui/disclaimer';
import { hasClerkKeys } from './env';

test('the home page links to both areas and shows the disclaimer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Field Inspections' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Inspector app/ })).toHaveAttribute('href', '/field');
  await expect(page.getByRole('link', { name: /Supervisor dashboard/ })).toHaveAttribute(
    'href',
    '/dashboard',
  );
  await expect(page.getByRole('contentinfo')).toHaveText(DISCLAIMER);
});

test('/field renders from its static shell and reads search params on the device', async ({
  page,
}) => {
  const response = await page.goto('/field?view=inspection');
  // Served straight from the prerendered page, with no auth redirect in between.
  expect(response?.status()).toBe(200);
  expect(response?.request().redirectedFrom()).toBeNull();
  await expect(page.getByRole('heading', { name: 'Inspections' })).toBeVisible();
  await expect(page.getByTestId('field-view')).toHaveText('inspection');
  await expect(page.getByRole('contentinfo')).toHaveText(DISCLAIMER);
});

test('/dashboard sends signed-out visitors to sign-in', async ({ page }) => {
  test.skip(!hasClerkKeys(), 'Needs Clerk keys');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('/api routes answer 401 JSON to signed-out callers', async ({ request }) => {
  test.skip(!hasClerkKeys(), 'Needs Clerk keys');
  const response = await request.get('/api/sync/pull?cursor=0');
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: 'unauthenticated' });
});
