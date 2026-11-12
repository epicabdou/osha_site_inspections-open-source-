import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type LocalPhoto } from '@/lib/db';
import { DEFAULT_DEMO_SETTINGS, updateDemoSettings } from '@/lib/demo/settings';
import { LOCAL_RETENTION_MS, prunePhotos, runUploadQueue } from '@/lib/photos/upload-queue';
import { AuthRequiredError, NetworkError, setTokenProvider } from '@/lib/sync/api';

const blob = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ put: blob.put }));

const INSPECTION = '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f';
const hash = (c: string) => c.repeat(64);

function photo(c: string, overrides: Partial<LocalPhoto> = {}): LocalPhoto {
  return {
    hash: hash(c),
    data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    inspectionId: INSPECTION,
    itemId: 'overview-photo',
    mime: 'image/jpeg',
    bytes: 4,
    uploadState: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: '2026-11-11T09:00:00.000Z',
    ...overrides,
  };
}

let calls: string[];
let server: (path: string, body: { hash: string }) => Response;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await updateDemoSettings(DEFAULT_DEMO_SETTINGS);
  setTokenProvider(async () => 'token');
  calls = [];
  blob.put.mockReset();
  blob.put.mockResolvedValue({ url: 'https://store.example/x' });
  server = (path, body) =>
    path === '/api/photos/upload'
      ? Response.json({
          status: 'upload',
          pathname: `inspections/${INSPECTION}/${body.hash}.jpg`,
          clientToken: 't',
        })
      : Response.json({ status: 'confirmed' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      calls.push(String(path));
      return server(String(path), JSON.parse(String(init.body)));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenProvider(null);
});

describe('runUploadQueue', () => {
  it('asks for a token, uploads, confirms, and marks the photo uploaded', async () => {
    await db.photos.add(photo('a'));
    await runUploadQueue(db);
    expect(calls).toEqual(['/api/photos/upload', '/api/photos/confirm']);
    expect(blob.put).toHaveBeenCalledWith(
      `inspections/${INSPECTION}/${hash('a')}.jpg`,
      expect.any(Blob),
      expect.objectContaining({ access: 'private', token: 't', contentType: 'image/jpeg' }),
    );
    expect((await db.photos.get(hash('a')))?.uploadState).toBe('uploaded');
  });

  it('skips the upload when the server already has the photo', async () => {
    server = (path) =>
      path === '/api/photos/upload' ? Response.json({ status: 'exists' }) : Response.json({});
    await db.photos.add(photo('a'));
    await runUploadQueue(db);
    expect(blob.put).not.toHaveBeenCalled();
    expect((await db.photos.get(hash('a')))?.uploadState).toBe('uploaded');
  });

  it('treats "already exists" in storage as success (a retry after a lost response)', async () => {
    blob.put.mockRejectedValue(
      new Error('Vercel Blob: This blob already exists, use `allowOverwrite: true`.'),
    );
    await db.photos.add(photo('a'));
    await runUploadQueue(db);
    expect(calls).toContain('/api/photos/confirm');
    expect((await db.photos.get(hash('a')))?.uploadState).toBe('uploaded');
  });

  it('keeps a photo pending with a retry time when the upload fails partway', async () => {
    blob.put.mockRejectedValue(new TypeError('Failed to fetch'));
    await db.photos.add(photo('a'));
    await expect(runUploadQueue(db)).rejects.toBeInstanceOf(NetworkError);
    const stored = await db.photos.get(hash('a'));
    expect(stored).toMatchObject({
      uploadState: 'pending',
      attempts: 1,
      lastError: 'Failed to fetch',
    });
    expect(stored!.nextAttemptAt).toBeGreaterThan(Date.now());
    // Not due yet: nothing happens. Once due, it resumes and completes.
    blob.put.mockResolvedValue({});
    await runUploadQueue(db);
    expect((await db.photos.get(hash('a')))?.uploadState).toBe('pending');
    await runUploadQueue(db, stored!.nextAttemptAt + 1);
    expect((await db.photos.get(hash('a')))?.uploadState).toBe('uploaded');
  });

  it('resumes a photo left "uploading" by a reload', async () => {
    await db.photos.add(photo('a', { uploadState: 'uploading' }));
    await runUploadQueue(db);
    expect((await db.photos.get(hash('a')))?.uploadState).toBe('uploaded');
  });

  it('marks a photo rejected when the server refuses it for good, and keeps it', async () => {
    server = () => Response.json({ error: 'not_owner' }, { status: 403 });
    await db.photos.add(photo('a'));
    await runUploadQueue(db);
    expect(await db.photos.get(hash('a'))).toMatchObject({ uploadState: 'rejected', attempts: 1 });
  });

  it('pauses without a session, keeping the photo pending', async () => {
    setTokenProvider(null);
    await db.photos.add(photo('a'));
    await expect(runUploadQueue(db)).rejects.toBeInstanceOf(AuthRequiredError);
    expect((await db.photos.get(hash('a')))?.uploadState).toBe('pending');
  });

  it('uploads at most two photos at a time', async () => {
    let active = 0;
    let peak = 0;
    blob.put.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {};
    });
    await db.photos.bulkAdd(['a', 'b', 'c', 'd', 'e'].map((c) => photo(c)));
    await runUploadQueue(db);
    expect(peak).toBe(2);
    expect(await db.photos.where('uploadState').equals('uploaded').count()).toBe(5);
  });

  it('respects the demo panel: forced offline means no request at all', async () => {
    await updateDemoSettings({ forceOffline: true });
    await db.photos.add(photo('a'));
    await expect(runUploadQueue(db)).rejects.toBeInstanceOf(NetworkError);
    expect(calls).toEqual([]);
    await updateDemoSettings(DEFAULT_DEMO_SETTINGS);
  });
});

describe('prunePhotos', () => {
  it('deletes uploaded photos of closed inspections or after 30 days, nothing else', async () => {
    const now = Date.parse('2026-12-31T00:00:00.000Z');
    const old = new Date(now - LOCAL_RETENTION_MS - 1).toISOString();
    const recent = new Date(now - 1000).toISOString();
    await db.inspections.add({
      id: INSPECTION,
      templateId: 'scaffold-inspection',
      templateVersion: 1,
      site: 'A',
      status: 'closed',
      createdBy: 'u',
      createdAtDevice: recent,
      hasCriticalFailure: false,
      updatedAt: recent,
      syncState: 'synced',
    });
    const otherInspection = '01935c4e-8f4b-7c3a-9d2e-000000000001';
    await db.photos.bulkAdd([
      photo('a', { uploadState: 'uploaded', uploadedAt: recent }), // closed inspection
      photo('b', { uploadState: 'uploaded', uploadedAt: old, inspectionId: otherInspection }), // 30 days
      photo('c', { uploadState: 'uploaded', uploadedAt: recent, inspectionId: otherInspection }),
      photo('d', { uploadState: 'pending' }), // never delete unsent work
    ]);
    expect(await prunePhotos(db, now)).toBe(2);
    expect((await db.photos.toCollection().primaryKeys()).sort()).toEqual([hash('c'), hash('d')]);
  });
});
