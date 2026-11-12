import { put } from '@vercel/blob/client';
import type { FieldDatabase, LocalPhoto } from '@/lib/db';
import { PHOTO_CONTENT_TYPE, photoUploadResponseSchema } from '@/lib/schemas';
import { apiFetch, AuthRequiredError, HttpError, NetworkError, throughChaos } from '@/lib/sync/api';
import { reportRequest } from '@/lib/sync/connectivity';
import { backoffDelay } from '@/lib/sync/outbox';

/**
 * The photo upload queue. Photos travel separately from answers: the answer syncs in
 * seconds and names the photo by its hash; the photo follows when bandwidth allows.
 *
 * For each pending photo, two at a time:
 *   1. POST /api/photos/upload → a client token for `inspections/<id>/<hash>.jpg`
 *      (or "exists" if the server already has it);
 *   2. PUT the bytes straight to Vercel Blob ("already exists" counts as success);
 *   3. POST /api/photos/confirm → the server records the photo.
 *
 * It runs after every sync cycle. State lives in Dexie, so a reload resumes the queue.
 * Temporary failures retry with the sync engine's backoff; a refusal is final and the
 * photo stays on the device, marked rejected.
 */

export const UPLOAD_CONCURRENCY = 2;
/** Uploaded photos are kept on the device for this long, or until their inspection closes. */
export const LOCAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const TEMPORARY_BLOB_ERRORS = new Set([
  'BlobServiceNotAvailable',
  'BlobServiceRateLimited',
  'BlobUnknownError',
  'BlobClientTokenExpiredError',
  'BlobRequestAbortedError',
]);

/** Maps a storage failure to the app's error kinds. */
function classifyStorageError(error: unknown): Error {
  if (error instanceof TypeError) return new NetworkError(error.message);
  const name = (error as { name?: string } | null)?.name ?? '';
  if (TEMPORARY_BLOB_ERRORS.has(name)) return new NetworkError(name);
  return error instanceof Error ? error : new Error(String(error));
}

function alreadyExists(error: unknown): boolean {
  return error instanceof Error && /already exists/i.test(error.message);
}

function isTemporary(error: unknown): boolean {
  return (
    error instanceof NetworkError ||
    (error instanceof HttpError && (error.temporary || error.status === 409))
  );
}

async function uploadOne(database: FieldDatabase, photo: LocalPhoto): Promise<void> {
  await database.photos.update(photo.hash, { uploadState: 'uploading' });
  const ref = { inspectionId: photo.inspectionId, itemId: photo.itemId, hash: photo.hash };

  const ticket = photoUploadResponseSchema.parse(
    await (
      await apiFetch('/api/photos/upload', {
        method: 'POST',
        body: JSON.stringify({ ...ref, contentType: PHOTO_CONTENT_TYPE, size: photo.bytes }),
      })
    ).json(),
  );

  if (ticket.status === 'upload') {
    await throughChaos();
    try {
      await put(ticket.pathname, new Blob([photo.data], { type: PHOTO_CONTENT_TYPE }), {
        access: 'private',
        token: ticket.clientToken,
        contentType: PHOTO_CONTENT_TYPE,
        multipart: false,
      });
    } catch (error) {
      // A retry after a lost response: the bytes are already stored under the same hash.
      if (!alreadyExists(error)) throw classifyStorageError(error);
    }
    reportRequest(true);
  }

  await apiFetch('/api/photos/confirm', { method: 'POST', body: JSON.stringify(ref) });
  await database.photos.update(photo.hash, {
    uploadState: 'uploaded',
    uploadedAt: new Date().toISOString(),
    lastError: undefined,
  });
}

async function eachWithConcurrency<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item);
  });
  await Promise.all(workers);
}

/**
 * Uploads every photo that is due. Throws the first temporary failure (after recording
 * it on the photo) so the sync engine backs off and runs the queue again later.
 */
export async function runUploadQueue(database: FieldDatabase, now = Date.now()): Promise<void> {
  const due = (
    await database.photos.where('uploadState').anyOf(['pending', 'uploading']).toArray()
  ).filter((photo) => photo.nextAttemptAt <= now);

  let temporaryFailure: unknown;
  let pausedForAuth: unknown;
  await eachWithConcurrency(due, UPLOAD_CONCURRENCY, async (photo) => {
    try {
      await uploadOne(database, photo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AuthRequiredError || isTemporary(error)) {
        if (error instanceof NetworkError) reportRequest(false);
        const attempts = photo.attempts + 1;
        await database.photos.update(photo.hash, {
          uploadState: 'pending',
          attempts,
          nextAttemptAt: Date.now() + backoffDelay(attempts),
          lastError: message,
        });
        if (error instanceof AuthRequiredError) pausedForAuth ??= error;
        else temporaryFailure ??= error;
      } else {
        await database.photos.update(photo.hash, {
          uploadState: 'rejected',
          attempts: photo.attempts + 1,
          lastError: message,
        });
      }
    }
  });
  if (pausedForAuth) throw pausedForAuth;
  if (temporaryFailure) throw temporaryFailure;
}

/**
 * Frees device storage: an uploaded photo is deleted locally once its inspection is
 * closed, or 30 days after upload. Never touches a photo that has not been uploaded.
 */
export async function prunePhotos(database: FieldDatabase, now = Date.now()): Promise<number> {
  const uploaded = await database.photos.where('uploadState').equals('uploaded').toArray();
  const removable: string[] = [];
  for (const photo of uploaded) {
    const inspection = await database.inspections.get(photo.inspectionId);
    const old =
      photo.uploadedAt !== undefined && now - Date.parse(photo.uploadedAt) > LOCAL_RETENTION_MS;
    if (inspection?.status === 'closed' || old) removable.push(photo.hash);
  }
  await database.photos.bulkDelete(removable);
  return removable.length;
}

/** The after-cycle task registered with the sync engine. */
export async function photoQueueTask(database: FieldDatabase): Promise<void> {
  await runUploadQueue(database);
  await prunePhotos(database);
}
