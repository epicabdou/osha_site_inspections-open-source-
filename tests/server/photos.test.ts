import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { photos } from '@/server/db/schema';
import { seedTemplates } from '@/server/seed/seed';
import { insertInspection } from './helpers/fixtures';
import { createTestDatabase, type TestDatabase } from './helpers/pglite';

/** Photo upload and confirm rules, with Blob storage replaced by a fake. */
const storage = vi.hoisted(() => ({
  stored: new Map<string, { contentType: string; size: number }>(),
}));
vi.mock('@/server/photos/storage', () => ({
  issueUploadToken: async (pathname: string) => `token-for:${pathname}`,
  statPhoto: async (pathname: string) => {
    const blob = storage.stored.get(pathname);
    return blob ? { ...blob, url: `https://store.example/${pathname}`, pathname } : null;
  },
  readPhoto: async () => null,
}));

const { confirmUpload, findViewablePhoto, PhotoRequestError, requestUpload } =
  await import('@/server/photos/photos');

let t: TestDatabase;
const inspector = { userId: 'user_inspector', role: 'inspector' as const };
const other = { userId: 'user_other', role: 'inspector' as const };
const supervisor = { userId: 'user_supervisor', role: 'supervisor' as const };
const HASH = 'a'.repeat(64);
let inspectionId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedTemplates(t.db);
});

afterAll(async () => {
  await t.client.close();
});

beforeEach(async () => {
  await t.db.execute(
    sql`truncate corrective_actions, photos, answer_events, inspections, processed_mutations`,
  );
  storage.stored.clear();
  inspectionId = (await insertInspection(t.db, { createdBy: inspector.userId })).id;
});

const request = () => ({
  inspectionId,
  itemId: 'overview-photo',
  hash: HASH,
  contentType: 'image/jpeg' as const,
  size: 120_000,
});

async function rejectsWith(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PhotoRequestError);
  expect(error).toMatchObject({ status, code });
}

describe('requestUpload', () => {
  it('issues a token scoped to the hash-derived pathname', async () => {
    expect(await requestUpload(t.db, inspector, request())).toEqual({
      status: 'upload',
      pathname: `inspections/${inspectionId}/${HASH}.jpg`,
      clientToken: `token-for:inspections/${inspectionId}/${HASH}.jpg`,
    });
  });

  it('says "exists" when the photo is already recorded', async () => {
    storage.stored.set(`inspections/${inspectionId}/${HASH}.jpg`, {
      contentType: 'image/jpeg',
      size: 1,
    });
    await confirmUpload(t.db, inspector, { inspectionId, itemId: 'overview-photo', hash: HASH });
    expect(await requestUpload(t.db, inspector, request())).toEqual({ status: 'exists' });
  });

  it('refuses other inspectors, supervisors and unknown inspections', async () => {
    await rejectsWith(requestUpload(t.db, other, request()), 403, 'not_owner');
    await rejectsWith(requestUpload(t.db, supervisor, request()), 403, 'forbidden');
    await rejectsWith(
      requestUpload(t.db, inspector, {
        ...request(),
        inspectionId: '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f',
      }),
      404,
      'inspection_not_found',
    );
  });
});

describe('confirmUpload', () => {
  it('records the photo only once storage has it, and is idempotent', async () => {
    const ref = { inspectionId, itemId: 'overview-photo', hash: HASH };
    await rejectsWith(confirmUpload(t.db, inspector, ref), 409, 'not_uploaded');
    storage.stored.set(`inspections/${inspectionId}/${HASH}.jpg`, {
      contentType: 'image/jpeg',
      size: 98_765,
    });
    await confirmUpload(t.db, inspector, ref);
    await confirmUpload(t.db, inspector, ref);
    const rows = await t.db.select().from(photos);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hash: HASH,
      bytes: 98_765,
      mime: 'image/jpeg',
      uploadedBy: inspector.userId,
    });
  });

  it('refuses a stored object that is not a JPEG or is too large', async () => {
    const ref = { inspectionId, itemId: 'overview-photo', hash: HASH };
    storage.stored.set(`inspections/${inspectionId}/${HASH}.jpg`, {
      contentType: 'text/html',
      size: 10,
    });
    await rejectsWith(confirmUpload(t.db, inspector, ref), 422, 'invalid_photo');
    storage.stored.set(`inspections/${inspectionId}/${HASH}.jpg`, {
      contentType: 'image/jpeg',
      size: 6 * 1024 * 1024,
    });
    await rejectsWith(confirmUpload(t.db, inspector, ref), 422, 'invalid_photo');
  });
});

describe('the same photo on a second inspection', () => {
  it('is "exists" on upload and confirms without a second copy in storage', async () => {
    storage.stored.set(`inspections/${inspectionId}/${HASH}.jpg`, {
      contentType: 'image/jpeg',
      size: 10,
    });
    await confirmUpload(t.db, inspector, { inspectionId, itemId: 'overview-photo', hash: HASH });
    const second = (await insertInspection(t.db, { createdBy: inspector.userId })).id;
    expect(await requestUpload(t.db, inspector, { ...request(), inspectionId: second })).toEqual({
      status: 'exists',
    });
    // Nothing is stored under the second inspection's path, and that is fine.
    expect(
      await confirmUpload(t.db, inspector, {
        inspectionId: second,
        itemId: 'overview-photo',
        hash: HASH,
      }),
    ).toEqual({ status: 'confirmed' });
    expect(await t.db.select().from(photos)).toHaveLength(1);
  });
});

describe('findViewablePhoto', () => {
  it('lets the owner and supervisors view a photo, nobody else', async () => {
    storage.stored.set(`inspections/${inspectionId}/${HASH}.jpg`, {
      contentType: 'image/jpeg',
      size: 10,
    });
    await confirmUpload(t.db, inspector, { inspectionId, itemId: 'overview-photo', hash: HASH });
    expect((await findViewablePhoto(t.db, inspector, HASH)).pathname).toContain(HASH);
    expect((await findViewablePhoto(t.db, supervisor, HASH)).hash).toBe(HASH);
    await rejectsWith(findViewablePhoto(t.db, other, HASH), 403, 'not_owner');
    await rejectsWith(findViewablePhoto(t.db, supervisor, 'b'.repeat(64)), 404, 'not_found');
  });
});
