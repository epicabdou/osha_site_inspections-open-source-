import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { FieldDatabase } from '@/lib/db';

/**
 * One test per Dexie schema version: create the previous version with fixtures, open
 * it with the current code, and check nothing was lost. Version 1 is the first, so it
 * checks that a fresh database gets every table and index the code relies on.
 */

const NAME = 'migration-test';

afterEach(async () => {
  await Dexie.delete(NAME);
});

describe('Dexie schema', () => {
  it('version 1 creates every table with its indexes', async () => {
    const database = new FieldDatabase(NAME);
    await database.open();
    expect(database.verno).toBe(1);
    const tables = Object.fromEntries(
      database.tables.map((table) => [
        table.name,
        [table.schema.primKey.src, ...table.schema.indexes.map((index) => index.src)],
      ]),
    );
    expect(tables).toEqual({
      templates: ['[id+version]', 'id'],
      inspections: ['id', 'status', 'updatedAt'],
      answerEvents: ['id', 'inspectionId', '[inspectionId+itemId]', 'syncState'],
      outbox: ['++seq', 'mutationId', 'state', 'nextAttemptAt'],
      photos: ['hash', 'inspectionId', 'uploadState'],
      correctiveActions: ['id', 'inspectionId'],
      meta: ['key'],
    });
    database.close();
  });

  it('data written with version 1 is still there when reopened', async () => {
    const first = new FieldDatabase(NAME);
    await first.meta.put({ key: 'pullCursor', value: 42 });
    await first.outbox.add({
      mutationId: '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f',
      kind: 'inspection.submit',
      payload: {
        inspectionId: '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e70',
        submittedAtDevice: '2026-11-11T10:00:00.000Z',
      },
      hlc: '000000000000001-00000-d',
      state: 'queued',
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: '2026-11-11T10:00:00.000Z',
    });
    first.close();

    const reopened = new FieldDatabase(NAME);
    expect(await reopened.meta.get('pullCursor')).toEqual({ key: 'pullCursor', value: 42 });
    expect(await reopened.outbox.count()).toBe(1);
    reopened.close();
  });
});
