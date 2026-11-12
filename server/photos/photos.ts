import 'server-only';
import { eq } from 'drizzle-orm';
import {
  MAX_PHOTO_BYTES,
  PHOTO_CONTENT_TYPE,
  type PhotoConfirmRequest,
  type PhotoUploadRequest,
  type PhotoUploadResponse,
  photoPathname,
} from '@/lib/schemas';
import type { ApiUser } from '@/server/api';
import { inspections, photos } from '@/server/db/schema';
import type { Db } from '@/server/db/types';
import { issueUploadToken, statPhoto } from './storage';

/** Why a photo request was refused; mapped to an HTTP status by the route. */
export class PhotoRequestError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    readonly code: string,
  ) {
    super(code);
  }
}

/** The photo's inspection must exist and belong to the caller (or the caller supervises). */
async function assertCanAccess(db: Db, user: ApiUser, inspectionId: string, write: boolean) {
  const [inspection] = await db
    .select({ createdBy: inspections.createdBy })
    .from(inspections)
    .where(eq(inspections.id, inspectionId))
    .limit(1);
  if (!inspection) throw new PhotoRequestError(404, 'inspection_not_found');
  const owner = inspection.createdBy === user.userId;
  if (write ? !owner : !owner && user.role !== 'supervisor') {
    throw new PhotoRequestError(403, 'not_owner');
  }
}

/**
 * Step 1 of an upload: checks the request and issues a client token for the photo's
 * hash-derived pathname. A photo already recorded needs no upload.
 */
export async function requestUpload(
  db: Db,
  user: ApiUser,
  request: PhotoUploadRequest,
): Promise<PhotoUploadResponse> {
  if (user.role !== 'inspector') throw new PhotoRequestError(403, 'forbidden');
  await assertCanAccess(db, user, request.inspectionId, true);
  const [existing] = await db
    .select({ hash: photos.hash })
    .from(photos)
    .where(eq(photos.hash, request.hash));
  if (existing) return { status: 'exists' };
  const pathname = photoPathname(request.inspectionId, request.hash);
  return { status: 'upload', pathname, clientToken: await issueUploadToken(pathname) };
}

/**
 * Step 3 of an upload: records the photo, but only once storage confirms the bytes are
 * there, are a JPEG and are within the size limit. Idempotent on the hash.
 */
export async function confirmUpload(db: Db, user: ApiUser, request: PhotoConfirmRequest) {
  if (user.role !== 'inspector') throw new PhotoRequestError(403, 'forbidden');
  await assertCanAccess(db, user, request.inspectionId, true);
  // Photos are content-addressed: the same bytes (a library photo reused on a second
  // inspection, say) are stored and recorded once, under the first inspection's path.
  // The upload step already answered "exists" for them, so confirm them as they are.
  const [existing] = await db
    .select({ hash: photos.hash })
    .from(photos)
    .where(eq(photos.hash, request.hash));
  if (existing) return { status: 'confirmed' as const };
  const pathname = photoPathname(request.inspectionId, request.hash);
  const stored = await statPhoto(pathname);
  if (!stored) throw new PhotoRequestError(409, 'not_uploaded');
  if (stored.contentType !== PHOTO_CONTENT_TYPE || stored.size > MAX_PHOTO_BYTES) {
    throw new PhotoRequestError(422, 'invalid_photo');
  }
  await db
    .insert(photos)
    .values({
      hash: request.hash,
      inspectionId: request.inspectionId,
      itemId: request.itemId,
      blobUrl: stored.url,
      bytes: stored.size,
      mime: stored.contentType,
      uploadedBy: user.userId,
    })
    .onConflictDoNothing({ target: photos.hash });
  return { status: 'confirmed' as const };
}

/** Finds a recorded photo the caller may view. */
export async function findViewablePhoto(db: Db, user: ApiUser, hash: string) {
  const [photo] = await db.select().from(photos).where(eq(photos.hash, hash)).limit(1);
  if (!photo) throw new PhotoRequestError(404, 'not_found');
  await assertCanAccess(db, user, photo.inspectionId, false);
  return { ...photo, pathname: photoPathname(photo.inspectionId, photo.hash) };
}
