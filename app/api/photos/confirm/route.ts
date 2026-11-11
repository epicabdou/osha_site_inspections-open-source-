import { photoConfirmRequestSchema } from '@/lib/schemas';
import { json, requireApiUser } from '@/server/api';
import { getDb } from '@/server/db/client';
import { confirmUpload, PhotoRequestError } from '@/server/photos/photos';

/**
 * POST /api/photos/confirm
 * Records an uploaded photo once storage confirms it. An explicit call instead of Blob's
 * upload-completed callback, which cannot reach a local dev server.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const parsed = photoConfirmRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_request' }, { status: 400 });
  try {
    return json(await confirmUpload(getDb(), user, parsed.data));
  } catch (error) {
    if (error instanceof PhotoRequestError)
      return json({ error: error.code }, { status: error.status });
    throw error;
  }
}
