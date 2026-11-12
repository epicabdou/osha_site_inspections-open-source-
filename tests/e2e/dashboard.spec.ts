import { expect, test } from '@playwright/test';
import { hasFullStack, testUsers } from './env';
import {
  newDevice,
  newSupervisor,
  openInspection,
  openOnDashboard,
  readMeta,
  setDemoSettings,
} from './helpers/devices';
import { startInspection, waitForAllSynced } from './helpers/field';

/**
 * The supervisor's side of the story: conflicts from two devices (E2E 2), a cancellation
 * while the inspector is offline (E2E 3), and a device whose clock is 2 hours ahead (E2E 5).
 */
test.describe('dashboard', () => {
  test.skip(!hasFullStack(), 'Needs Clerk test users and E2E_DATABASE_URL');
  test.setTimeout(180_000);

  test('E2E 2: two devices answer the same item offline; the dashboard shows the conflict', async ({
    browser,
  }) => {
    const users = testUsers()!;
    const a = await newDevice(browser, users.inspector);
    const b = await newDevice(browser, users.inspector);
    const site = `Conflict ${Date.now()}`;

    await startInspection(a.page, site, 'Scaffold pre-use inspection');
    await waitForAllSynced(a.page);
    await b.page.reload(); // device B pulls the inspection
    await expect(b.page.getByRole('link', { name: new RegExp(site) })).toBeVisible();

    await a.context.setOffline(true);
    await b.context.setOffline(true);
    await openInspection(b.page, site);
    await a.page.getByTestId('item-safe-way-up').getByRole('button', { name: 'Pass' }).click();
    await b.page.getByTestId('item-safe-way-up').getByRole('button', { name: 'Fail' }).click();

    await a.context.setOffline(false);
    await b.context.setOffline(false);
    await waitForAllSynced(a.page);
    await waitForAllSynced(b.page);

    const supervisor = await newSupervisor(browser, users.supervisor);
    await openOnDashboard(supervisor.page, site);
    const item = supervisor.page.getByTestId('dashboard-item-safe-way-up');
    await expect(item.getByTestId('conflict-flag')).toBeVisible();
    await expect(item.getByTestId('history').locator('tbody tr')).toHaveCount(2);

    // Device A hears about B's answer on its next sync and flags the conflict too.
    await a.page.reload();
    await waitForAllSynced(a.page);
    await expect(a.page.getByTestId('item-safe-way-up').getByTestId('conflict-flag')).toBeVisible();
    await Promise.all([a.context.close(), b.context.close(), supervisor.context.close()]);
  });

  test('E2E 3: answers recorded after a supervisor cancels are rejected with the reason', async ({
    browser,
  }) => {
    const users = testUsers()!;
    const inspector = await newDevice(browser, users.inspector);
    const site = `Cancelled ${Date.now()}`;
    await startInspection(inspector.page, site, 'Scaffold pre-use inspection');
    await inspector.page
      .getByTestId('item-safe-way-up')
      .getByRole('button', { name: 'Pass' })
      .click();
    await waitForAllSynced(inspector.page);

    await inspector.context.setOffline(true);
    const supervisor = await newSupervisor(browser, users.supervisor);
    await openOnDashboard(supervisor.page, site);
    await supervisor.page
      .getByLabel('Reason for cancelling')
      .fill('Wrong site: this is plant room B3');
    await supervisor.page.getByRole('button', { name: 'Cancel inspection' }).click();
    // The page re-renders as cancelled: the form is gone and the banner shows the reason.
    await expect(supervisor.page.getByTestId('inspection-status')).toHaveText('Cancelled');
    await expect(
      supervisor.page
        .getByText('Reason: Wrong site: this is plant room B3')
        .filter({ visible: true }),
    ).toBeVisible();

    // Offline, the inspector does not know yet and keeps working.
    const item = inspector.page.getByTestId('item-access-gate');
    await item.getByRole('button', { name: 'Pass' }).click();
    await expect(item.getByTestId('answer-state')).toContainText('Saved on device');

    await inspector.context.setOffline(false);
    await expect(item.getByTestId('reject-reason')).toHaveText(
      'A supervisor cancelled this inspection.',
      {
        timeout: 30_000,
      },
    );
    await expect(item.getByTestId('answer-state')).toContainText('Rejected');
    await expect(
      inspector.page.getByText('A supervisor cancelled this inspection.').first(),
    ).toBeVisible();
    await expect(
      inspector.page.getByText('Reason: Wrong site: this is plant room B3'),
    ).toBeVisible();
    await Promise.all([inspector.context.close(), supervisor.context.close()]);
  });

  test('E2E 5: with one device 2 hours ahead, the history order is still correct', async ({
    browser,
  }) => {
    const users = testUsers()!;
    const ahead = await newDevice(browser, users.inspector);
    await setDemoSettings(ahead.page, { clockSkewMs: 2 * 60 * 60 * 1000 });
    const normal = await newDevice(browser, users.inspector);
    const site = `Clock skew ${Date.now()}`;

    // The fast device answers first...
    await startInspection(ahead.page, site, 'Scaffold pre-use inspection');
    await ahead.page.getByTestId('item-safe-way-up').getByRole('button', { name: 'Pass' }).click();
    await waitForAllSynced(ahead.page);
    await expect(ahead.page.getByTestId('clock-notice')).toContainText('2 hours ahead');

    // ...then the correct device sees that answer and changes it.
    await normal.page.reload();
    await openInspection(normal.page, site);
    await normal.page.getByTestId('item-safe-way-up').getByRole('button', { name: 'Fail' }).click();
    await waitForAllSynced(normal.page);

    const aheadId = await readMeta<string>(ahead.page, 'deviceId');
    const normalId = await readMeta<string>(normal.page, 'deviceId');
    const supervisor = await newSupervisor(browser, users.supervisor);
    await openOnDashboard(supervisor.page, site);
    const item = supervisor.page.getByTestId('dashboard-item-safe-way-up');
    await expect(item.getByTestId('current-answer')).toHaveText('Fail');
    await item.getByText(/History/).click();
    const rows = item.getByTestId('history').locator('tbody tr');
    await expect(rows).toHaveCount(2);
    // Causal order, not wall-clock order: the later change is last even though its device time is earlier.
    await expect(rows.nth(0)).toHaveAttribute('data-device', aheadId!);
    await expect(rows.nth(1)).toHaveAttribute('data-device', normalId!);
    await expect(item.getByTestId('conflict-flag')).toHaveCount(1); // two devices, two different values
    await Promise.all([ahead.context.close(), normal.context.close(), supervisor.context.close()]);
  });
});
