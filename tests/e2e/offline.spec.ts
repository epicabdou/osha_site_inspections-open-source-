import { expect, test } from '@playwright/test';
import { hasFullStack, testUsers } from './env';
import {
  answerEverything,
  signInToField,
  startInspection,
  waitForAllSynced,
  waitForServiceWorker,
} from './helpers/field';
import { e2eQuery } from './helpers/db';
import { withGpsExif } from './helpers/jpeg';

/**
 * E2E 1 — the demo story. After one online visit, the inspector goes offline, reloads
 * /field, completes and submits an inspection with a photo, reloads again offline and
 * finds everything there. Back online, everything syncs to the server.
 */
test.describe('offline inspection', () => {
  test.skip(!hasFullStack(), 'Needs Clerk test users and E2E_DATABASE_URL');

  test('complete an inspection with no network and keep it across reloads', async ({
    page,
    context,
  }) => {
    const users = testUsers()!;
    await signInToField(page, users.inspector);
    await waitForServiceWorker(page);
    await waitForAllSynced(page); // templates have downloaded
    const photo = {
      name: 'site.jpg',
      mimeType: 'image/jpeg',
      buffer: withGpsExif(await page.screenshot({ type: 'jpeg', quality: 80 })),
    };

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your inspections' })).toBeVisible();

    const site = `Plant room B2 ${Date.now()}`;
    await startInspection(page, site, 'General workplace inspection');
    await answerEverything(page, photo);

    await page.getByRole('button', { name: 'Review and submit' }).click();
    await page.getByRole('button', { name: 'Submit inspection' }).click();
    await expect(page.locator('header').getByText('Submitted', { exact: true })).toBeVisible();

    // Reload while still offline: everything comes back from the device.
    await page.reload();
    await expect(page.getByRole('heading', { name: site, level: 1 })).toBeVisible();
    await expect(page.locator('header').getByText('Submitted', { exact: true })).toBeVisible();
    await expect(page.getByText(/11 of 11 answered/)).toBeVisible();
    await expect(page.getByTestId('pending-count')).toBeVisible();

    // Back in coverage: the queue drains on its own and the server has the inspection.
    await context.setOffline(false);
    await expect
      .poll(
        async () => {
          const [row] = await e2eQuery<{ status: string; events: string }>(
            `select i.status, count(e.id)::text as events
               from inspections i left join answer_events e on e.inspection_id = i.id
              where i.site = $1 group by i.id`,
            [site],
          );
          return row ? `${row.status}:${row.events}` : 'missing';
        },
        { timeout: 30_000 },
      )
      .toBe('submitted:11');
  });

  test('the app is installable: manifest and service worker are in place', async ({ page }) => {
    await page.goto('/field');
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();
    const manifest = await (await page.request.get(manifestHref!)).json();
    expect(manifest).toMatchObject({ start_url: '/field', display: 'standalone' });
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect((await page.request.get('/sw.js')).ok()).toBe(true);
  });
});
