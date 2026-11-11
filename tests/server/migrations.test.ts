import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerEvents, inspections, templates } from '@/server/db/schema';
import { createTestDatabase, type TestDatabase } from './helpers/pglite';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.client.close();
});

describe('initial migration', () => {
  it('creates every table', async () => {
    const result = await t.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'answer_events',
        'corrective_actions',
        'inspections',
        'photos',
        'processed_mutations',
        'templates',
      ]),
    );
  });

  it('assigns server_seq from one sequence shared by every synced table', async () => {
    const [template] = await t.db
      .insert(templates)
      .values({
        id: 'scaffold-inspection',
        version: 1,
        title: 'Scaffold pre-use inspection',
        definition: {
          id: 'scaffold-inspection',
          version: 1,
          title: 'Scaffold pre-use inspection',
          sections: [
            {
              id: 'base',
              title: 'Base',
              items: [{ id: 'base-plates', prompt: 'Base plates', kind: 'pass_fail_na' }],
            },
          ],
        },
      })
      .returning();

    const [inspection] = await t.db
      .insert(inspections)
      .values({
        id: '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f',
        templateId: 'scaffold-inspection',
        templateVersion: 1,
        site: 'Plant room B2',
        createdBy: 'user_inspector',
        createdAtDevice: new Date('2026-11-11T09:30:00.000Z'),
      })
      .returning();

    const [event] = await t.db
      .insert(answerEvents)
      .values({
        id: '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e70',
        inspectionId: '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f',
        itemId: 'base-plates',
        value: { kind: 'pass_fail_na', result: 'pass' },
        hlc: '000001234567890:0000:device-a',
        deviceId: 'device-a',
        authorId: 'user_inspector',
        deviceTime: new Date('2026-11-11T09:31:00.000Z'),
      })
      .returning();

    const seqs = [template!.serverSeq, inspection!.serverSeq, event!.serverSeq];
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(3);
    expect(inspection!.status).toBe('draft');
    expect(event!.photoHashes).toEqual([]);
  });

  it('rejects an inspection that points at an unknown template version', async () => {
    await expect(
      t.db.insert(inspections).values({
        id: '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e71',
        templateId: 'scaffold-inspection',
        templateVersion: 99,
        site: 'Warehouse A',
        createdBy: 'user_inspector',
        createdAtDevice: new Date('2026-11-11T09:30:00.000Z'),
      }),
    ).rejects.toThrow();
  });
});
