import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { hasClerkKeys, hasFullStack, testUsers } from './env';
import { newSupervisor, openOnDashboard } from './helpers/devices';
import { signInToField, startInspection, waitForAllSynced } from './helpers/field';

/**
 * Accessibility pass: axe reports no serious or critical violations on the pages people
 * use. Checked against WCAG 2.1 A and AA rules.
 */
async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious,
    `${label}: ${JSON.stringify(
      serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target) })),
      null,
      2,
    )}`,
  ).toEqual([]);
}

test('home page and signed-out field app', async ({ page }) => {
  test.skip(!hasClerkKeys(), 'Needs Clerk keys');
  await page.goto('/');
  await expectNoSeriousViolations(page, 'home');
  await page.goto('/field');
  await expect(page.getByText('Sign in once with a connection')).toBeVisible();
  await expectNoSeriousViolations(page, 'field sign-in gate');
});

test.describe('signed in', () => {
  test.skip(!hasFullStack(), 'Needs Clerk test users and E2E_DATABASE_URL');
  test.setTimeout(150_000);

  test('field app views and the demo panel', async ({ page }) => {
    await signInToField(page, testUsers()!.inspector);
    await waitForAllSynced(page);
    await expectNoSeriousViolations(page, 'field home');

    await page.goto('/field?view=new&demo=1');
    await expect(page.getByRole('heading', { name: 'New inspection' })).toBeVisible();
    await page.getByText('Demo controls').click();
    await expectNoSeriousViolations(page, 'new inspection + demo panel');

    await page.goto('/field');
    const site = `Accessibility ${Date.now()}`;
    await startInspection(page, site, 'Scaffold pre-use inspection');
    await page.getByTestId('item-tag-in-date').getByRole('button', { name: 'Fail' }).click();
    await expect(page.getByTestId('critical-banner').first()).toBeVisible();
    await expectNoSeriousViolations(page, 'inspection with a critical failure');

    await page.goto('/field?view=settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expectNoSeriousViolations(page, 'settings');
  });

  test('dashboard overview and inspection detail', async ({ page, browser }) => {
    await signInToField(page, testUsers()!.inspector);
    const site = `Dashboard a11y ${Date.now()}`;
    await startInspection(page, site, 'Scaffold pre-use inspection');
    await page.getByTestId('item-tag-in-date').getByRole('button', { name: 'Fail' }).click();
    await waitForAllSynced(page);

    const supervisor = await newSupervisor(browser, testUsers()!.supervisor);
    await expectNoSeriousViolations(supervisor.page, 'dashboard overview');
    await openOnDashboard(supervisor.page, site);
    await expectNoSeriousViolations(supervisor.page, 'inspection detail');
    await supervisor.context.close();
  });
});
