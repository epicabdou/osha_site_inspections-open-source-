import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  answerEvents,
  correctiveActions,
  inspections,
  processedMutations,
} from '@/server/db/schema';
import { seedTemplates } from '@/server/seed/seed';
import { processPush, type PushUser } from '@/server/sync/push';
import { answerMutation, createMutation, submitMutation } from './helpers/mutations';
import { createTestDatabase, type TestDatabase } from './helpers/pglite';

let t: TestDatabase;
const inspector: PushUser = { userId: 'user_inspector', role: 'inspector' };
const otherInspector: PushUser = { userId: 'user_other', role: 'inspector' };
const supervisor: PushUser = { userId: 'user_supervisor', role: 'supervisor' };
const pass = { kind: 'pass_fail_na', result: 'pass' } as const;
const fail = { kind: 'pass_fail_na', result: 'fail' } as const;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedTemplates(t.db);
});

beforeEach(async () => {
  await t.db.execute(
    sql`truncate corrective_actions, photos, answer_events, inspections, processed_mutations`,
  );
});

afterAll(async () => {
  await t.client.close();
});

const push = (user: PushUser, mutations: unknown[]) =>
  processPush(t.db, user, 'device-a', mutations);

/** Creates an inspection owned by `user` and returns its id. */
async function newInspection(user: PushUser = inspector) {
  const create = createMutation(user.userId);
  expect(await push(user, [create])).toEqual([
    { mutationId: create.mutationId, status: 'accepted' },
  ]);
  return create.payload.id;
}

describe('push: accepted and duplicate', () => {
  it('accepts a create, answers and a submit in one batch', async () => {
    const create = createMutation(inspector.userId);
    const id = create.payload.id;
    const answer = answerMutation(inspector.userId, id, 'safe-way-up', pass);
    const submit = submitMutation(id);
    const results = await push(inspector, [create, answer, submit]);
    expect(results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    const [row] = await t.db.select().from(inspections).where(eq(inspections.id, id));
    expect(row?.status).toBe('submitted');
    expect(row?.submittedAtDevice?.toISOString()).toBe('2026-11-11T09:30:00.000Z');
    expect(await t.db.select().from(answerEvents)).toHaveLength(1);
  });

  it('returns the stored result for a mutation id seen before, and changes nothing', async () => {
    const id = await newInspection();
    const answer = answerMutation(inspector.userId, id, 'safe-way-up', pass);
    expect((await push(inspector, [answer]))[0]?.status).toBe('accepted');
    const before = await t.db.select().from(answerEvents);
    expect(await push(inspector, [answer])).toEqual([
      { mutationId: answer.mutationId, status: 'duplicate' },
    ]);
    expect(await t.db.select().from(answerEvents)).toEqual(before);
  });

  it('a retried rejection returns the same rejection', async () => {
    const answer = answerMutation(
      inspector.userId,
      '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f',
      'safe-way-up',
      pass,
    );
    const first = await push(inspector, [answer]);
    expect(first[0]).toMatchObject({ status: 'rejected', reason: 'inspection_not_found' });
    expect(await push(inspector, [answer])).toEqual(first);
  });

  it('a rejected mutation does not roll back the others in its batch', async () => {
    const id = await newInspection();
    const good = answerMutation(inspector.userId, id, 'safe-way-up', pass);
    const bad = answerMutation(inspector.userId, id, 'not-an-item', pass);
    const alsoGood = answerMutation(inspector.userId, id, 'toe-boards', pass);
    const results = await push(inspector, [good, bad, alsoGood]);
    expect(results.map((r) => r.status)).toEqual(['accepted', 'rejected', 'accepted']);
    expect(await t.db.select().from(answerEvents)).toHaveLength(2);
    expect(await t.db.select().from(processedMutations)).toHaveLength(4); // + the create
  });
});

describe('push: every rejection reason', () => {
  it('inspection_not_found', async () => {
    const results = await push(inspector, [
      answerMutation(inspector.userId, '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f', 'safe-way-up', pass),
    ]);
    expect(results[0]).toMatchObject({ status: 'rejected', reason: 'inspection_not_found' });
  });

  it.each([
    ['cancelled', 'inspection_cancelled'],
    ['closed', 'inspection_closed'],
    ['submitted', 'inspection_submitted'],
  ] as const)('answering a %s inspection is rejected with %s', async (status, reason) => {
    const id = await newInspection();
    await t.db.update(inspections).set({ status }).where(eq(inspections.id, id));
    const results = await push(inspector, [
      answerMutation(inspector.userId, id, 'safe-way-up', pass),
      submitMutation(id),
    ]);
    expect(results.map((r) => r.reason)).toEqual([reason, reason]);
  });

  it('not_owner: another inspector cannot answer or submit', async () => {
    const id = await newInspection();
    const results = await push(otherInspector, [
      answerMutation(otherInspector.userId, id, 'safe-way-up', pass),
      submitMutation(id),
    ]);
    expect(results.map((r) => r.reason)).toEqual(['not_owner', 'not_owner']);
  });

  it('not_owner: a client cannot create an inspection, or answer, as someone else', async () => {
    const results = await push(inspector, [createMutation(otherInspector.userId)]);
    expect(results[0]).toMatchObject({ status: 'rejected', reason: 'not_owner' });
    const id = await newInspection();
    const forged = await push(inspector, [
      answerMutation(otherInspector.userId, id, 'safe-way-up', pass),
    ]);
    expect(forged[0]).toMatchObject({ status: 'rejected', reason: 'not_owner' });
  });

  it('unknown_template_version', async () => {
    const results = await push(inspector, [
      createMutation(inspector.userId, { templateVersion: 99 }),
    ]);
    expect(results[0]).toMatchObject({ status: 'rejected', reason: 'unknown_template_version' });
    expect(await t.db.select().from(inspections)).toHaveLength(0);
  });

  it('unknown_item', async () => {
    const id = await newInspection();
    const results = await push(inspector, [
      answerMutation(inspector.userId, id, 'guard-dog', pass),
    ]);
    expect(results[0]).toMatchObject({ status: 'rejected', reason: 'unknown_item' });
  });

  it('invalid_payload: a value of the wrong kind, or a malformed mutation', async () => {
    const id = await newInspection();
    const wrongKind = answerMutation(inspector.userId, id, 'guardrail-height', {
      kind: 'text',
      value: '1m',
    });
    const malformed = {
      mutationId: '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e71',
      kind: 'answer.record',
      payload: {},
    };
    const noId = { kind: 'inspection.create' };
    const results = await push(inspector, [wrongKind, malformed, noId]);
    expect(results.map((r) => r.reason)).toEqual([
      'invalid_payload',
      'invalid_payload',
      'invalid_payload',
    ]);
  });

  it('forbidden: a supervisor cannot create inspections', async () => {
    const results = await push(supervisor, [createMutation(supervisor.userId)]);
    expect(results[0]).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});

describe('push: critical failures', () => {
  it('an accepted critical fail creates one corrective action and flags the inspection', async () => {
    const id = await newInspection();
    const critical = answerMutation(inspector.userId, id, 'tag-in-date', fail);
    await push(inspector, [critical]);
    await push(inspector, [critical]); // a retry
    const actions = await t.db.select().from(correctiveActions);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      sourceEventId: critical.payload.id,
      status: 'open',
      itemId: 'tag-in-date',
    });
    const [row] = await t.db.select().from(inspections).where(eq(inspections.id, id));
    expect(row?.hasCriticalFailure).toBe(true);
  });

  it('a reading outside the range on a critical item counts too', async () => {
    const id = await newInspection();
    await push(inspector, [
      answerMutation(inspector.userId, id, 'guardrail-height', { kind: 'number', value: 800 }),
    ]);
    expect(await t.db.select().from(correctiveActions)).toHaveLength(1);
  });

  it('a later pass does not close the corrective action', async () => {
    const id = await newInspection();
    await push(inspector, [
      answerMutation(inspector.userId, id, 'tag-in-date', fail),
      answerMutation(inspector.userId, id, 'tag-in-date', pass),
    ]);
    const [action] = await t.db.select().from(correctiveActions);
    expect(action?.status).toBe('open');
  });

  it('a fail on a non-critical item raises nothing', async () => {
    const id = await newInspection();
    await push(inspector, [answerMutation(inspector.userId, id, 'toe-boards', fail)]);
    expect(await t.db.select().from(correctiveActions)).toHaveLength(0);
  });
});

describe('push: server_seq', () => {
  it('bumps server_seq when an inspection changes, so pull sees the change', async () => {
    const id = await newInspection();
    const [before] = await t.db.select().from(inspections).where(eq(inspections.id, id));
    await push(inspector, [submitMutation(id)]);
    const [after] = await t.db.select().from(inspections).where(eq(inspections.id, id));
    expect(after!.serverSeq).toBeGreaterThan(before!.serverSeq);
  });
});
