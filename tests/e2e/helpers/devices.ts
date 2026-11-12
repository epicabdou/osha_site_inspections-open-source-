import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { DemoSettings } from '@/lib/db';
import { gotoAfterSignIn, signInToField, waitForAllSynced } from './field';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect } from '@playwright/test';

/** A separate browser profile: its own cookies, its own device database, its own device id. */
export async function newDevice(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInToField(page, email);
  await waitForAllSynced(page);
  return { context, page };
}

/** A supervisor's browser, signed in, on the dashboard. */
export async function newSupervisor(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await setupClerkTestingToken({ page });
  await page.goto('/');
  await clerk.signIn({ page, emailAddress: email });
  await gotoAfterSignIn(page, '/dashboard');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  return { context, page };
}

/** Reads a value from the device database's meta table. */
export async function readMeta<T>(page: Page, key: string): Promise<T | undefined> {
  return page.evaluate(
    (metaKey) =>
      new Promise<T | undefined>((resolve, reject) => {
        const open = indexedDB.open('field-inspections');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction('meta').objectStore('meta').get(metaKey);
          request.onsuccess = () => resolve((request.result as { value: T } | undefined)?.value);
          request.onerror = () => reject(request.error);
        };
      }),
    key,
  );
}

/** Writes the demo settings (as the chaos panel would) and reloads so they take effect. */
export async function setDemoSettings(page: Page, settings: Partial<DemoSettings>) {
  await page.evaluate(
    (patch) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('field-inspections');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('meta', 'readwrite');
          const store = tx.objectStore('meta');
          const read = store.get('demoSettings');
          read.onsuccess = () => {
            const current = (read.result as { value: object } | undefined)?.value ?? {
              forceOffline: false,
              latencyMs: 0,
              dropRate: 0,
              clockSkewMs: 0,
            };
            store.put({ key: 'demoSettings', value: { ...current, ...patch } });
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    settings,
  );
  await page.reload();
}

/** Opens an inspection from the field app's list by its site. */
export async function openInspection(page: Page, site: string) {
  await page.getByRole('link', { name: 'Inspections', exact: true }).click();
  await page.getByRole('link', { name: new RegExp(site) }).click();
  await expect(page.getByRole('heading', { name: site, level: 1 })).toBeVisible();
}

/** Opens an inspection on the dashboard by its site. */
export async function openOnDashboard(page: Page, site: string) {
  await page.goto('/dashboard');
  const href = await page.getByRole('link', { name: site }).first().getAttribute('href');
  await page.goto(href!);
  await expect(page.getByRole('heading', { name: site, level: 1 })).toBeVisible();
}
