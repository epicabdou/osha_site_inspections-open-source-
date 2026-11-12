import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Navigates right after a sign-in. Clerk may still be redirecting (to the sign-in
 * fallback URL), which interrupts a navigation started at the same moment; wait for it to
 * settle and try again.
 */
export async function gotoAfterSignIn(page: Page, url: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url);
      return;
    } catch (error) {
      if (attempt >= 2 || !/interrupted by another navigation/.test(String(error))) throw error;
      await page.waitForLoadState('load');
    }
  }
}

/** Signs in through Clerk's testing helpers, then opens the field app online. */
export async function signInToField(page: Page, emailAddress: string) {
  await setupClerkTestingToken({ page });
  await page.goto('/');
  await clerk.signIn({ page, emailAddress });
  await gotoAfterSignIn(page, '/field');
  await expect(page.getByRole('heading', { name: 'Your inspections' })).toBeVisible();
}

/** Waits until the service worker controls the page and /field is precached. */
export async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
    }
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) {
            if (new URL(request.url).pathname === '/field') return true;
          }
        }
        return false;
      }),
    )
    .toBe(true);
}

/** Waits until the sync badge reports nothing waiting. */
export async function waitForAllSynced(page: Page) {
  await expect(page.getByTestId('sync-badge')).toContainText('All synced', { timeout: 30_000 });
}

/** Starts an inspection from the home view. */
export async function startInspection(page: Page, site: string, templateTitle: string) {
  await page.getByRole('button', { name: 'Start an inspection' }).click();
  await page.getByRole('combobox', { name: 'Site' }).fill(site);
  await page.getByRole('radio', { name: new RegExp(templateTitle) }).check();
  await page.getByRole('button', { name: 'Start inspection' }).click();
  await expect(page.getByRole('heading', { name: site, level: 1 })).toBeVisible();
}

/**
 * Answers every item in the open inspection with passing values: Pass, a reading in
 * range, a short text, and a photo for photo items.
 */
export async function answerEverything(
  page: Page,
  photo: { name: string; mimeType: string; buffer: Buffer },
) {
  const sections = page.getByRole('navigation', { name: 'Sections' }).getByRole('button');
  const count = await sections.count();
  for (let s = 0; s < count; s++) {
    const title = ((await sections.nth(s).textContent()) ?? '').replace('✓', '').trim();
    await sections.nth(s).click();
    // Wait for the section to render before counting its items.
    await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
    const items = page.locator('article[data-testid^="item-"]');
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      const item = items.nth(i);
      if (await item.getByRole('button', { name: 'Pass' }).count()) {
        await item.getByRole('button', { name: 'Pass' }).click();
        await expect(item.getByRole('button', { name: 'Pass' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      } else if (await item.getByLabel(/^Reading/).count()) {
        const range = (await item.locator('p[id$="-range"]').textContent()) ?? '';
        const numbers = range.match(/\d+/g)?.map(Number) ?? [1000];
        const value =
          numbers.length >= 2 ? Math.round((numbers[0]! + numbers[1]!) / 2) : numbers[0]! + 10;
        await item.getByLabel(/^Reading/).fill(String(value));
        await item.getByRole('button', { name: 'Save' }).click();
        await expect(item.getByTestId('answer-state')).toContainText(
          /Saved on device|Queued|Synced/,
        );
      } else if (await item.locator('textarea').count()) {
        await item.locator('textarea').first().fill('Checked, nothing to report.');
        await item.getByRole('button', { name: 'Save' }).click();
        await expect(item.getByTestId('answer-state')).toContainText(
          /Saved on device|Queued|Synced/,
        );
      } else {
        await item.locator('input[type="file"][data-testid^="photo-input-"]').setInputFiles(photo);
        await expect(item.getByRole('img')).toBeVisible();
      }
    }
  }
}
