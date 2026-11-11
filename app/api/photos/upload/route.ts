import { photoUploadRequestSchema } from '@/lib/schemas';
import { json, requireApiUser } from '@/server/api';
import { getDb } from '@/server/db/client';
import { PhotoRequestError, requestUpload } from '@/server/photos/photos';

/**
 * POST /api/photos/upload
 * Checks auth, ownership, content type and the 5 MB limit, then issues a Vercel Blob
 * client-upload token for `inspections/<inspectionId>/<hash>.jpg`. The bytes go from the
 * device straight to storage, never through this function.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const parsed = photoUploadRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_request' }, { status: 400 });
  try {
    return json(await requestUpload(getDb(), user, parsed.data));
  } catch (error) {
    if (error instanceof PhotoRequestError)
      return json({ error: error.code }, { status: error.status });
    throw error;
  }
}
