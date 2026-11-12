import { expect, type Page, test } from '@playwright/test';
import { jpegHasExif } from '@/lib/photos/compress';
import { hasFullStack, testUsers } from './env';
import { e2eQuery } from './helpers/db';
import { signInToField, startInspection, waitForAllSynced } from './helpers/field';
import { uniqueScreenshot, withGpsExif } from './helpers/jpeg';

/** Every stored photo's bytes, read straight from the device database. */
async function storedPhotos(
  page: Page,
): Promise<{ hash: string; bytes: number[]; uploadState: string }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('field-inspections');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction('photos').objectStore('photos').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () =>
            resolve(
              (request.result as { hash: string; data: ArrayBuffer; uploadState: string }[]).map(
                (p) => ({
                  hash: p.hash,
                  bytes: Array.from(new Uint8Array(p.data)),
                  uploadState: p.uploadState,
                }),
              ),
            );
        };
      }),
  );
}

const isBlobUpload = (url: URL) =>
  url.hostname === 'vercel.com' && url.pathname.startsWith('/api/blob');

test.describe('photos', () => {
  test.skip(!hasFullStack(), 'Needs Clerk test users and E2E_DATABASE_URL');

  test('compression strips EXIF, including GPS location, before anything is stored', async ({
    page,
  }) => {
    await signInToField(page, testUsers()!.inspector);
    await waitForAllSynced(page);
    const original = withGpsExif(await uniqueScreenshot(page, 90));
    expect(jpegHasExif(original)).toBe(true);

    await startInspection(page, `EXIF check ${Date.now()}`, 'Scaffold pre-use inspection');
    await page.getByRole('button', { name: /Platform and edges/ }).click();
    const item = page.getByTestId('item-overview-photo');
    await item.getByTestId('photo-input-overview-photo').setInputFiles({
      name: 'site.jpg',
      mimeType: 'image/jpeg',
      buffer: original,
    });
    await expect(item.getByRole('img')).toBeVisible();

    const [stored] = await storedPhotos(page);
    const bytes = new Uint8Array(stored!.bytes);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8); // still a JPEG
    expect(jpegHasExif(bytes)).toBe(false);
    // The GPS reference letters from the original EXIF block are nowhere in the output.
    expect(Buffer.from(bytes).includes(Buffer.from('Exif\0\0'))).toBe(false);
  });

  test.describe('upload queue', () => {
    // WebKit cannot intercept requests from a page a service worker controls, and this test
    // is about the photo queue, not the worker: block it so the network cut is reliable.
    test.use({ serviceWorkers: 'block' });

    test('E2E 4: an upload that fails partway resumes after a reload and completes', async ({
      page,
      context,
    }) => {
      await signInToField(page, testUsers()!.inspector);
      await waitForAllSynced(page);
      const jpeg = await uniqueScreenshot(page);

      // Storage is unreachable: every direct upload to Blob fails mid-flight. (The Blob client
      // retries on its own, so the photo stays "uploading" or goes back to "pending".)
      await context.route(isBlobUpload, (route) => route.abort('connectionreset'));
      const site = `Photo queue ${Date.now()}`;
      await startInspection(page, site, 'Scaffold pre-use inspection');
      await page.getByRole('button', { name: /Platform and edges/ }).click();
      const item = page.getByTestId('item-overview-photo');
      await item.getByTestId('photo-input-overview-photo').setInputFiles({
        name: 'site.jpg',
        mimeType: 'image/jpeg',
        buffer: jpeg,
      });
      await expect(item.getByText('Waiting to upload')).toBeVisible();
      // The answer itself syncs; only the photo waits.
      await expect(item.getByTestId('answer-state')).toContainText('Synced', { timeout: 20_000 });
      await page.waitForTimeout(3_000);
      expect(['pending', 'uploading']).toContain((await storedPhotos(page))[0]?.uploadState);
      expect(
        await e2eQuery(
          `select 1 from photos p join inspections i on i.id = p.inspection_id where i.site = $1`,
          [site],
        ),
      ).toHaveLength(0);

      // Reload with storage reachable again: the queue resumes from the device database.
      await context.unroute(isBlobUpload);
      await page.reload();
      await waitForAllSynced(page);
      await expect
        .poll(
          async () => {
            const rows = await e2eQuery<{ count: string }>(
              `select count(*)::text as count from photos p join inspections i on i.id = p.inspection_id where i.site = $1`,
              [site],
            );
            return Number(rows[0]?.count);
          },
          { timeout: 30_000 },
        )
        .toBe(1);
      await page.getByRole('button', { name: /Platform and edges/ }).click();
      await expect(page.getByTestId('item-overview-photo').getByText('Uploaded')).toBeVisible();
    });
  });
});
