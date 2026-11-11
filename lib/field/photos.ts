import {
  type FieldDatabase,
  type LastUser,
  type LocalAnswerEvent,
  db as defaultDb,
} from '@/lib/db';
import { reduceItem } from '@/lib/answers/reduce';
import type { AnswerValue } from '@/lib/schemas';
import { compressImage, MAX_UPLOAD_BYTES, sha256Hex } from '@/lib/photos/compress';
import { deviceNowIso } from '@/lib/sync/clock';
import { FieldActionError, recordAnswer } from './actions';

/**
 * Adds a photo to an item's answer.
 *
 * Compression and hashing happen first, outside any transaction (crypto.subtle is not
 * a Dexie promise). Then one transaction stores the photo row, a new answer event that
 * references the hash, and that event's outbox entry. The photo uploads later, on its
 * own queue; the answer syncs in seconds.
 */
export async function addPhoto(
  input: { inspectionId: string; itemId: string; file: Blob; value?: AnswerValue },
  user: LastUser,
  database: FieldDatabase = defaultDb,
): Promise<LocalAnswerEvent> {
  const blob = await compressImage(input.file);
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new FieldActionError('That photo is too large even after compression.', 'invalid');
  }
  const hash = await sha256Hex(blob);
  const data = await blob.arrayBuffer();

  const tables = [
    database.photos,
    database.templates,
    database.inspections,
    database.answerEvents,
    database.outbox,
    database.meta,
  ];
  return database.transaction('rw', tables, async () => {
    const existing = await database.photos.get(hash);
    if (!existing) {
      await database.photos.add({
        hash,
        data,
        inspectionId: input.inspectionId,
        itemId: input.itemId,
        mime: 'image/jpeg',
        bytes: blob.size,
        uploadState: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
        createdAt: deviceNowIso(),
      });
    }
    const events = await database.answerEvents
      .where('[inspectionId+itemId]')
      .equals([input.inspectionId, input.itemId])
      .toArray();
    const current = reduceItem(input.itemId, events).current;
    const photoHashes = [...(current?.photoHashes ?? [])];
    if (!photoHashes.includes(hash)) photoHashes.push(hash);
    return recordAnswer(
      {
        inspectionId: input.inspectionId,
        itemId: input.itemId,
        value: input.value ?? current?.value ?? { kind: 'photo' },
        note: current?.note,
        photoHashes,
      },
      user,
      database,
    );
  });
}

/** Removes a photo from an item's answer by recording a new event without it. */
export async function removePhoto(
  input: { inspectionId: string; itemId: string; hash: string },
  user: LastUser,
  database: FieldDatabase = defaultDb,
): Promise<LocalAnswerEvent> {
  const tables = [
    database.templates,
    database.inspections,
    database.answerEvents,
    database.outbox,
    database.meta,
  ];
  return database.transaction('rw', tables, async () => {
    const events = await database.answerEvents
      .where('[inspectionId+itemId]')
      .equals([input.inspectionId, input.itemId])
      .toArray();
    const current = reduceItem(input.itemId, events).current;
    if (!current) throw new FieldActionError('There is no answer to change.', 'invalid');
    const photoHashes = current.photoHashes.filter((hash) => hash !== input.hash);
    const value: AnswerValue =
      current.value.kind === 'photo' && photoHashes.length === 0
        ? { kind: 'cleared' }
        : current.value;
    return recordAnswer(
      {
        inspectionId: input.inspectionId,
        itemId: input.itemId,
        value,
        note: current.note,
        photoHashes,
      },
      user,
      database,
    );
  });
}
