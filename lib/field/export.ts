import { db, type FieldDatabase } from '@/lib/db';

/**
 * Everything on the device as JSON, photos excluded (they are listed by hash).
 * Offered before sign-out, before switching users, and for rejected work.
 */
export async function exportLocalData(database: FieldDatabase = db): Promise<string> {
  const [inspections, answerEvents, outbox, photos, correctiveActions, templates] =
    await Promise.all([
      database.inspections.toArray(),
      database.answerEvents.toArray(),
      database.outbox.toArray(),
      database.photos.toArray(),
      database.correctiveActions.toArray(),
      database.templates.toArray(),
    ]);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'field-inspections',
      inspections,
      answerEvents,
      outbox,
      photos: photos.map(({ data: _data, ...photo }) => photo),
      correctiveActions,
      templates: templates.map(({ id, version, title }) => ({ id, version, title })),
    },
    null,
    2,
  );
}

/** Saves the export as a file download. */
export async function downloadLocalData(database: FieldDatabase = db): Promise<void> {
  const json = await exportLocalData(database);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `field-inspections-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Number of changes on this device that the server has not yet answered for. */
export async function countUnsynced(database: FieldDatabase = db): Promise<number> {
  const [outbox, photos] = await Promise.all([
    database.outbox.count(),
    database.photos.where('uploadState').notEqual('uploaded').count(),
  ]);
  return outbox + photos;
}

/** Deletes the device database, photos included, so the next user sees nothing. */
export async function wipeLocalData(database: FieldDatabase = db): Promise<void> {
  database.close();
  await database.delete();
}
