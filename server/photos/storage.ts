import 'server-only';
import { get, head } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { MAX_PHOTO_BYTES, PHOTO_CONTENT_TYPE } from '@/lib/schemas';

/**
 * Vercel Blob, private store. Photo bytes go straight from the device to storage with a
 * short-lived client token scoped to one pathname; they never pass through a function.
 */

function readWriteToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not set. See .env.example.');
  return token;
}

/** A client token that can upload exactly one JPEG, at most 5 MB, to `pathname`, for 10 minutes. */
export function issueUploadToken(pathname: string): Promise<string> {
  return generateClientTokenFromReadWriteToken({
    token: readWriteToken(),
    pathname,
    allowedContentTypes: [PHOTO_CONTENT_TYPE],
    maximumSizeInBytes: MAX_PHOTO_BYTES,
    addRandomSuffix: false,
    allowOverwrite: false,
    validUntil: Date.now() + 10 * 60_000,
  });
}

/** Metadata of a stored photo, or null if nothing is stored at `pathname`. */
export async function statPhoto(pathname: string) {
  try {
    return await head(pathname, { token: readWriteToken() });
  } catch (error) {
    // A missing object is an expected answer, not a server error, whatever the SDK calls it.
    const { name = '', message = '' } = (error ?? {}) as { name?: string; message?: string };
    if (name === 'BlobNotFoundError' || /not found|does not exist/i.test(message)) return null;
    throw error;
  }
}

/** The stored bytes as a stream, for the authenticated photo route. */
export function readPhoto(pathname: string) {
  return get(pathname, { access: 'private', token: readWriteToken() });
}
