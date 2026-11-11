import { z } from 'zod';
import { photoHash } from './answer';
import { slug, uuidV7 } from './common';

/** Largest photo the server accepts, after compression on the device. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_CONTENT_TYPE = 'image/jpeg';

/** Where a photo lives in Blob storage: derived from its hash, so uploads are idempotent. */
export function photoPathname(inspectionId: string, hash: string): string {
  return `inspections/${inspectionId}/${hash}.jpg`;
}

const photoRef = { inspectionId: uuidV7, itemId: slug, hash: photoHash };

/** POST /api/photos/upload: asks for a client-upload token. */
export const photoUploadRequestSchema = z
  .object({
    ...photoRef,
    contentType: z.literal(PHOTO_CONTENT_TYPE),
    size: z.number().int().positive().max(MAX_PHOTO_BYTES),
  })
  .strict();
export type PhotoUploadRequest = z.infer<typeof photoUploadRequestSchema>;

export const photoUploadResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('upload'), pathname: z.string(), clientToken: z.string() }),
  z.object({ status: z.literal('exists') }),
]);
export type PhotoUploadResponse = z.infer<typeof photoUploadResponseSchema>;

/** POST /api/photos/confirm: records a photo once its bytes are in storage. */
export const photoConfirmRequestSchema = z.object(photoRef).strict();
export type PhotoConfirmRequest = z.infer<typeof photoConfirmRequestSchema>;
