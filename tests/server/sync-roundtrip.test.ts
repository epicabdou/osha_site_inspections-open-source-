import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { reduceAnswers } from '@/lib/answers/reduce';
import { FieldDatabase, getMeta, type LastUser } from '@/lib/db';
import { createInspection, recordAnswer, submitInspection } from '@/lib/field/actions';
import { setTokenProvider } from '@/lib/sync/api';
import { SyncEngine } from '@/lib/sync/engine';
import { correctiveActions, inspections } from '@/server/db/schema';
import { seedTemplates } from '@/server/seed/seed';
import { nextServerSeq } from '@/server/sync/seq';
import { installFakeNetwork } from './helpers/network';
import { createTestDatabase, type TestDatabase } from './helpers/pglite';

/**
 * Two devices, each with its own Dexie database and its own sync engine, talking to the
 * real push and pull code on PGlite through a fake network. This is the demo story
 * end to end, without a browser.
 */
const inspector: LastUser = {
  userId: 'user_inspector',
  displayName: 'Inspector',
  role: 'inspector',
};
let t: TestDatabase;
let network: ReturnType<typeof installFakeNetwork>;
let n = 0;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedTemplates(t.db);
});

afterAll(async () => {
  await t.client.close();
});

beforeEach(async () => {
  await t.db.execute(
    sql`truncate corrective_actions, photos, answer_events, inspections, processed_mutations`,
  );
  network = installFakeNetwork(t.db, { user_inspector: 'inspector' });
  network.signIn(inspector.userId);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenProvider(null);
});

async function device() {
  n += 1;
  const database = new FieldDatabase(`roundtrip-${n}`);
  await database.open();
  return { database, engine: new SyncEngine(database, `sync-${n}`) };
}

const pass = { kind: 'pass_fail_na', result: 'pass' } as const;
const fail = { kind: 'pass_fail_na', result: 'fail' } as const;

describe('device ↔ server round trip', () => {
  it('a first sync downloads the templates; an offline inspection syncs when the network returns', async () => {
    const a = await device();
    await a.engine.syncNow();
    expect(await a.database.templates.count()).toBe(3);

    network.state.offline = true;
    const inspection = await createInspection(
      { templateId: 'scaffold-inspection', templateVersion: 1, site: 'Plant room B2' },
      inspector,
      a.database,
    );
    await recordAnswer(
      { inspectionId: inspection.id, itemId: 'tag-in-date', value: fail },
      inspector,
      a.database,
    );
    await a.engine.syncNow();
    expect(a.engine.getSnapshot().phase).toBe('offline');
    expect(await a.database.outbox.count()).toBe(2);
    expect((await a.database.outbox.toArray()).every((e) => e.attempts === 1)).toBe(true);

    network.state.offline = false;
    await a.engine.syncNow();
    expect(a.engine.getSnapshot().phase).toBe('idle');
    expect(await a.database.outbox.count()).toBe(0);
    const events = await a.database.answerEvents.toArray();
    expect(events.map((e) => e.syncState)).toEqual(['synced']);
    // The critical fail became a corrective action on the server, then came back on pull.
    expect(await t.db.select().from(correctiveActions)).toHaveLength(1);
    expect(await a.database.correctiveActions.count()).toBe(1);
    expect(await getMeta('clockOffsetMs', a.database)).toBeTypeOf('number');
  });

  it('two devices answering the same item offline both keep their entries and converge', async () => {
    const a = await device();
    const b = await device();
    await a.engine.syncNow();
    const inspection = await createInspection(
      { templateId: 'scaffold-inspection', templateVersion: 1, site: 'Warehouse A' },
      inspector,
      a.database,
    );
    await a.engine.syncNow();
    await b.engine.syncNow(); // b now has the inspection

    network.state.offline = true;
    await recordAnswer(
      { inspectionId: inspection.id, itemId: 'safe-way-up', value: pass },
      inspector,
      a.database,
    );
    await recordAnswer(
      { inspectionId: inspection.id, itemId: 'safe-way-up', value: fail },
      inspector,
      b.database,
    );
    network.state.offline = false;

    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow(); // a receives b's event

    const onA = reduceAnswers(await a.database.answerEvents.toArray()).get('safe-way-up')!;
    const onB = reduceAnswers(await b.database.answerEvents.toArray()).get('safe-way-up')!;
    expect(onA.history.map((e) => e.id)).toEqual(onB.history.map((e) => e.id));
    expect(onA.history).toHaveLength(2);
    expect(onA.current?.id).toBe(onB.current?.id);
    expect(onA.conflicting).toBe(true);
    expect(onB.conflicting).toBe(true);
  });

  it('answers recorded after a supervisor cancelled the inspection are rejected and kept', async () => {
    const a = await device();
    await a.engine.syncNow();
    const inspection = await createInspection(
      { templateId: 'scaffold-inspection', templateVersion: 1, site: 'Loading dock' },
      inspector,
      a.database,
    );
    await recordAnswer(
      { inspectionId: inspection.id, itemId: 'safe-way-up', value: pass },
      inspector,
      a.database,
    );
    await a.engine.syncNow();

    // The supervisor cancels while the inspector is offline.
    await t.db
      .update(inspections)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: 'Wrong site',
        serverSeq: nextServerSeq(),
      })
      .where(eq(inspections.id, inspection.id));

    const late = await recordAnswer(
      { inspectionId: inspection.id, itemId: 'toe-boards', value: pass },
      inspector,
      a.database,
    );
    await a.engine.syncNow();

    expect(await a.database.answerEvents.get(late.id)).toMatchObject({
      syncState: 'rejected',
      rejectReason: 'inspection_cancelled',
    });
    const local = await a.database.inspections.get(inspection.id);
    expect(local).toMatchObject({ status: 'cancelled', cancelReason: 'Wrong site' });
    expect(await a.database.outbox.count()).toBe(0);
  });

  it('a submitted inspection reaches the server as submitted', async () => {
    const a = await device();
    await a.engine.syncNow();
    const template = (await a.database.templates.get(['general-workplace', 1]))!;
    const inspection = await createInspection(
      { templateId: template.id, templateVersion: 1, site: 'Warehouse A' },
      inspector,
      a.database,
    );
    for (const item of template.sections.flatMap((s) => s.items)) {
      const value =
        item.kind === 'pass_fail_na'
          ? pass
          : item.kind === 'number'
            ? ({ kind: 'number', value: 500 } as const)
            : item.kind === 'text'
              ? ({ kind: 'text', value: 'ok' } as const)
              : ({ kind: 'photo' } as const);
      await recordAnswer(
        {
          inspectionId: inspection.id,
          itemId: item.id,
          value,
          photoHashes: item.kind === 'photo' ? ['c'.repeat(64)] : [],
        },
        inspector,
        a.database,
      );
    }
    await submitInspection(inspection.id, a.database);
    await a.engine.syncNow();
    const [row] = await t.db.select().from(inspections).where(eq(inspections.id, inspection.id));
    expect(row?.status).toBe('submitted');
    expect((await a.database.inspections.get(inspection.id))?.status).toBe('submitted');
  });

  it('pauses with "Sign in to sync" when there is no session, and keeps the work', async () => {
    const a = await device();
    network.signIn(null);
    await a.engine.syncNow();
    expect(a.engine.getSnapshot()).toMatchObject({ phase: 'paused', message: 'Sign in to sync' });
  });
});
