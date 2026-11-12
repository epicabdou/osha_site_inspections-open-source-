import { beforeEach, describe, expect, it } from 'vitest';
import { db, getMeta, type LastUser } from '@/lib/db';
import {
  createInspection,
  FieldActionError,
  recordAnswer,
  submitInspection,
} from '@/lib/field/actions';
import { SEED_TEMPLATES } from '@/server/seed/templates';
import { decodeHlc } from '@/lib/sync/hlc';

const user: LastUser = {
  userId: 'user_inspector',
  displayName: 'Demo Inspector',
  role: 'inspector',
};
const scaffold = SEED_TEMPLATES.find((t) => t.id === 'scaffold-inspection')!;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.templates.put(scaffold);
});

async function start() {
  return createInspection(
    { templateId: scaffold.id, templateVersion: scaffold.version, site: ' Plant room B2 ' },
    user,
  );
}

describe('createInspection', () => {
  it('writes the inspection and its outbox entry together', async () => {
    const inspection = await start();
    expect(inspection.site).toBe('Plant room B2');
    expect(inspection.status).toBe('draft');
    expect(inspection.syncState).toBe('local');
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      kind: 'inspection.create',
      state: 'queued',
      attempts: 0,
      payload: { id: inspection.id, templateVersion: 1, createdBy: user.userId },
    });
    expect(await getMeta('deviceId')).toBeTruthy();
  });

  it('fails without writing anything when the template is missing', async () => {
    await expect(
      createInspection({ templateId: 'missing', templateVersion: 1, site: 'X' }, user),
    ).rejects.toBeInstanceOf(FieldActionError);
    expect(await db.inspections.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('requires a site', async () => {
    await expect(
      createInspection({ templateId: scaffold.id, templateVersion: 1, site: '   ' }, user),
    ).rejects.toThrow('Enter a site name.');
  });
});

describe('recordAnswer', () => {
  it('adds an event and an outbox entry with increasing clocks', async () => {
    const inspection = await start();
    const a = await recordAnswer(
      {
        inspectionId: inspection.id,
        itemId: 'safe-way-up',
        value: { kind: 'pass_fail_na', result: 'pass' },
      },
      user,
    );
    const b = await recordAnswer(
      {
        inspectionId: inspection.id,
        itemId: 'safe-way-up',
        value: { kind: 'pass_fail_na', result: 'na' },
      },
      user,
    );
    expect(a.syncState).toBe('local');
    expect(b.hlc > a.hlc).toBe(true);
    expect(decodeHlc(b.hlc).deviceId).toBe(b.deviceId);
    expect(await db.answerEvents.count()).toBe(2);
    expect((await db.outbox.toArray()).map((e) => e.kind)).toEqual([
      'inspection.create',
      'answer.record',
      'answer.record',
    ]);
  });

  it('flags the inspection at once when a critical item fails, and keeps the flag', async () => {
    const inspection = await start();
    await recordAnswer(
      {
        inspectionId: inspection.id,
        itemId: 'guardrail-height',
        value: { kind: 'number', value: 700 },
      },
      user,
    );
    expect((await db.inspections.get(inspection.id))?.hasCriticalFailure).toBe(true);
    await recordAnswer(
      {
        inspectionId: inspection.id,
        itemId: 'guardrail-height',
        value: { kind: 'number', value: 1000 },
      },
      user,
    );
    expect((await db.inspections.get(inspection.id))?.hasCriticalFailure).toBe(true);
  });

  it('does not flag a fail on a non-critical item', async () => {
    const inspection = await start();
    await recordAnswer(
      {
        inspectionId: inspection.id,
        itemId: 'toe-boards',
        value: { kind: 'pass_fail_na', result: 'fail' },
      },
      user,
    );
    expect((await db.inspections.get(inspection.id))?.hasCriticalFailure).toBe(false);
  });

  it('rejects a value of the wrong kind and an unknown item', async () => {
    const inspection = await start();
    await expect(
      recordAnswer(
        {
          inspectionId: inspection.id,
          itemId: 'guardrail-height',
          value: { kind: 'text', value: '1m' },
        },
        user,
      ),
    ).rejects.toThrow('does not fit');
    await expect(
      recordAnswer(
        { inspectionId: inspection.id, itemId: 'nope', value: { kind: 'cleared' } },
        user,
      ),
    ).rejects.toThrow('Unknown');
    expect(await db.answerEvents.count()).toBe(0);
  });

  it('refuses new answers once the inspection is no longer a draft', async () => {
    const inspection = await start();
    await db.inspections.update(inspection.id, { status: 'cancelled' });
    await expect(
      recordAnswer(
        {
          inspectionId: inspection.id,
          itemId: 'safe-way-up',
          value: { kind: 'pass_fail_na', result: 'pass' },
        },
        user,
      ),
    ).rejects.toThrow('cancelled');
  });
});

describe('submitInspection', () => {
  it('is refused while items need attention', async () => {
    const inspection = await start();
    await expect(submitInspection(inspection.id)).rejects.toThrow('still need attention');
    expect((await db.inspections.get(inspection.id))?.status).toBe('draft');
  });

  it('queues the submission when every item is answered', async () => {
    const inspection = await start();
    for (const section of scaffold.sections) {
      for (const item of section.items) {
        const value =
          item.kind === 'pass_fail_na'
            ? ({ kind: 'pass_fail_na', result: 'pass' } as const)
            : item.kind === 'number'
              ? ({ kind: 'number', value: 1000 } as const)
              : item.kind === 'text'
                ? ({ kind: 'text', value: 'Fine' } as const)
                : ({ kind: 'photo' } as const);
        await recordAnswer(
          {
            inspectionId: inspection.id,
            itemId: item.id,
            value,
            photoHashes: item.kind === 'photo' ? ['b'.repeat(64)] : [],
          },
          user,
        );
      }
    }
    await submitInspection(inspection.id);
    const saved = await db.inspections.get(inspection.id);
    expect(saved?.status).toBe('submitted');
    expect(saved?.submittedAtDevice).toBeDefined();
    const last = (await db.outbox.toArray()).at(-1);
    expect(last).toMatchObject({
      kind: 'inspection.submit',
      payload: { inspectionId: inspection.id },
    });
  });
});
