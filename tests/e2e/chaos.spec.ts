import { expect, test } from '@playwright/test';
import { hasFullStack, testUsers } from './env';
import { signInToField, startInspection, waitForAllSynced } from './helpers/field';

/** The demo chaos panel: break the network on purpose and watch the app recover. */
test.describe('chaos panel', () => {
  test.skip(!hasFullStack(), 'Needs Clerk test users and E2E_DATABASE_URL');

  test('is hidden without ?demo=1', async ({ page }) => {
    await signInToField(page, testUsers()!.inspector);
    await expect(page.getByTestId('chaos-panel')).toHaveCount(0);
  });

  test('force offline queues work; turning it off drains the queue', async ({ page }) => {
    await signInToField(page, testUsers()!.inspector);
    await page.goto('/field?demo=1');
    await waitForAllSynced(page);
    const panel = page.getByTestId('chaos-panel');
    await panel.getByText('Demo controls').click();
    await panel.getByLabel('Force offline').check();
    await expect(page.getByTestId('demo-badge').first()).toBeVisible();

    await startInspection(page, `Chaos ${Date.now()}`, 'General workplace inspection');
    await page.getByTestId('item-walkways-clear').getByRole('button', { name: 'Pass' }).click();
    await panel.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByTestId('sync-badge')).toContainText('Offline');
    const queue = panel.getByTestId('queue-table');
    await expect(queue.locator('tbody tr')).toHaveCount(2); // create + answer
    await expect(queue.locator('tbody tr').first()).toContainText('inspection.create');
    await expect(queue.locator('tbody tr').first()).toContainText('forced by the demo panel');

    await panel.getByLabel('Force offline').uncheck();
    await panel.getByRole('button', { name: 'Sync now' }).click();
    await waitForAllSynced(page);
    await expect(panel.getByText('Nothing waiting.')).toBeVisible();
    await expect(page.getByTestId('demo-badge')).toHaveCount(0);
  });
});
