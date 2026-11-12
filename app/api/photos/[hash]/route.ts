import { photoHash } from '@/lib/schemas';
import { json, requireApiUser } from '@/server/api';
import { getDb } from '@/server/db/client';
import { findViewablePhoto, PhotoRequestError } from '@/server/photos/photos';
import { readPhoto } from '@/server/photos/storage';

/**
 * GET /api/photos/<hash>
 * Streams a photo from the private Blob store to its inspector or a supervisor.
 */
export async function GET(_request: Request, context: RouteContext<'/api/photos/[hash]'>) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { hash } = await context.params;
  if (!photoHash.safeParse(hash).success) return json({ error: 'invalid_hash' }, { status: 400 });

  try {
    const photo = await findViewablePhoto(getDb(), user, hash);
    const blob = await readPhoto(photo.pathname);
    if (!blob || blob.statusCode !== 200) return json({ error: 'not_found' }, { status: 404 });
    return new Response(blob.stream, {
      headers: {
        'Content-Type': photo.mime,
        // Private to the signed-in user's browser; never stored by shared caches.
        'Cache-Control': 'private, max-age=3600, immutable',
      },
    });
  } catch (error) {
    if (error instanceof PhotoRequestError)
      return json({ error: error.code }, { status: error.status });
    throw error;
  }
}
