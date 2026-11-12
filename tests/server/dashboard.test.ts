import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { correctiveActions, inspections } from '@/server/db/schema';
import { cancelInspection, closeCorrectiveAction } from '@/server/dashboard/mutations';
import {
  getInspectionDetail,
  listInspections,
  listOpenFindings,
  parseFilters,
} from '@/server/dashboard/queries';
import { seedTemplates } from '@/server/seed/seed';
import { processPush } from '@/server/sync/push';
import { answerMutation, createMutation, submitMutation } from './helpers/mutations';
import { createTestDatabase, type TestDatabase } from './helpers/pglite';

let t: TestDatabase;
const inspector = { userId: 'user_inspector', role: 'inspector' as const };
const fail = { kind: 'pass_fail_na', result: 'fail' } as const;
const pass = { kind: 'pass_fail_na', result: 'pass' } as const;

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
});

async function inspection(site: string, overrides: Parameters<typeof createMutation>[1] = {}) {
  const create = createMutation(inspector.userId, { site, ...overrides });
  await processPush(t.db, inspector, 'device-a', [create]);
  return create.payload.id;
}

describe('parseFilters', () => {
  it('keeps valid filters and drops empty or malformed ones', () => {
    expect(
      parseFilters({
        status: 'submitted',
        site: ' dock ',
        template: '',
        from: '2026-11-01',
        to: 'yesterday',
      }),
    ).toEqual({ status: 'submitted', site: 'dock', from: '2026-11-01' });
    expect(parseFilters({ status: 'deleted', site: ['a', 'b'] })).toEqual({ site: 'a' });
  });
});

describe('listInspections', () => {
  it('lists newest first with template titles and filters by status, site, template and dates', async () => {
    const a = await inspection('Warehouse A', { createdAtDevice: '2026-11-01T08:00:00.000Z' });
    await inspection('Loading dock', {
      createdAtDevice: '2026-11-05T08:00:00.000Z',
      templateId: 'fire-safety',
    });
    await processPush(t.db, inspector, 'device-a', [submitMutation(a)]);

    const all = await listInspections(t.db, {});
    expect(all.map((i) => i.site)).toEqual(['Loading dock', 'Warehouse A']);
    expect(all[1]?.templateTitle).toBe('Scaffold pre-use inspection');
    expect(all[0]?.lastSyncedAt).toBeInstanceOf(Date);

    expect((await listInspections(t.db, { status: 'submitted' })).map((i) => i.site)).toEqual([
      'Warehouse A',
    ]);
    expect((await listInspections(t.db, { site: 'dock' })).map((i) => i.site)).toEqual([
      'Loading dock',
    ]);
    expect((await listInspections(t.db, { template: 'fire-safety' })).map((i) => i.site)).toEqual([
      'Loading dock',
    ]);
    expect((await listInspections(t.db, { from: '2026-11-02' })).map((i) => i.site)).toEqual([
      'Loading dock',
    ]);
    expect((await listInspections(t.db, { to: '2026-11-01' })).map((i) => i.site)).toEqual([
      'Warehouse A',
    ]);
    // Wildcards in the search box are literal characters, not patterns.
    expect(await listInspections(t.db, { site: '%' })).toEqual([]);
  });
});

describe('findings and detail', () => {
  it('lists open corrective actions with their item prompt, and the full answer history', async () => {
    const id = await inspection('Plant room B2');
    const first = answerMutation(inspector.userId, id, 'tag-in-date', fail);
    const second = answerMutation(inspector.userId, id, 'tag-in-date', pass, {
      deviceId: 'device-b',
    });
    await processPush(t.db, inspector, 'device-a', [first, second]);

    const findings = await listOpenFindings(t.db);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      site: 'Plant room B2',
      prompt: expect.stringContaining('tag at the access point'),
    });

    const detail = await getInspectionDetail(t.db, id);
    expect(detail?.template?.id).toBe('scaffold-inspection');
    expect(detail?.events.map((e) => e.id)).toEqual([first.payload.id, second.payload.id]);
    expect(detail?.events[0]?.note).toBeUndefined();
    expect(await getInspectionDetail(t.db, '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f')).toBeNull();
  });
});

describe('supervisor actions', () => {
  it('cancels a draft or submitted inspection and bumps server_seq so devices hear about it', async () => {
    const id = await inspection('Loading dock');
    const [before] = await t.db.select().from(inspections).where(eq(inspections.id, id));
    expect(await cancelInspection(t.db, { inspectionId: id, reason: 'Wrong site' })).toEqual({
      ok: true,
    });
    const [after] = await t.db.select().from(inspections).where(eq(inspections.id, id));
    expect(after).toMatchObject({ status: 'cancelled', cancelReason: 'Wrong site' });
    expect(after!.serverSeq).toBeGreaterThan(before!.serverSeq);
    expect(await cancelInspection(t.db, { inspectionId: id, reason: 'Again' })).toMatchObject({
      ok: false,
    });
    // The inspector's later answers are refused.
    const late = await processPush(t.db, inspector, 'device-a', [
      answerMutation(inspector.userId, id, 'toe-boards', pass),
    ]);
    expect(late[0]).toMatchObject({ status: 'rejected', reason: 'inspection_cancelled' });
  });

  it('closes a corrective action with a note, once', async () => {
    const id = await inspection('Warehouse A');
    await processPush(t.db, inspector, 'device-a', [
      answerMutation(inspector.userId, id, 'tag-in-date', fail),
    ]);
    const [action] = await t.db.select().from(correctiveActions);
    const input = { actionId: action!.id, note: 'Scaffold re-tagged by the supervisor' };
    expect(await closeCorrectiveAction(t.db, 'user_supervisor', input)).toEqual({ ok: true });
    const [closed] = await t.db.select().from(correctiveActions);
    expect(closed).toMatchObject({
      status: 'closed',
      closedBy: 'user_supervisor',
      closeNote: input.note,
    });
    expect(closed!.serverSeq).toBeGreaterThan(action!.serverSeq);
    expect(await closeCorrectiveAction(t.db, 'user_supervisor', input)).toMatchObject({
      ok: false,
    });
    expect(await listOpenFindings(t.db)).toHaveLength(0);
  });
});

describe('demo seed', () => {
  it('creates a submitted inspection with a critical failure, an open action and superseded answers, once', async () => {
    const { seedDemoInspection } = await import('@/server/seed/demo');
    expect(await seedDemoInspection(t.db, 'user_demo')).toBeGreaterThan(10);
    expect(await seedDemoInspection(t.db, 'user_demo')).toBe(0);
    const [row] = await listInspections(t.db, {});
    expect(row).toMatchObject({
      site: 'Plant room B2',
      status: 'submitted',
      hasCriticalFailure: true,
    });
    const findings = await listOpenFindings(t.db);
    expect(findings.map((f) => f.itemId)).toEqual(['tag-in-date']);
    const detail = await getInspectionDetail(t.db, row!.id);
    const guardrail = detail!.events.filter((e) => e.itemId === 'guardrail-height');
    expect(guardrail).toHaveLength(2);
  });
});
