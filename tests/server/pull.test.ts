import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pullResponseSchema } from '@/lib/schemas';
import { seedTemplates } from '@/server/seed/seed';
import { pullChanges } from '@/server/sync/pull';
import { insertEvent, insertInspection } from './helpers/fixtures';
import { createTestDatabase, type TestDatabase } from './helpers/pglite';

let t: TestDatabase;
const ALICE = 'user_alice';
const BOB = 'user_bob';

beforeAll(async () => {
  t = await createTestDatabase();
  await seedTemplates(t.db);
  const mine = await insertInspection(t.db, { createdBy: ALICE, site: 'Plant room B2' });
  const theirs = await insertInspection(t.db, { createdBy: BOB, site: 'Loading dock' });
  for (let i = 0; i < 5; i++) {
    await insertEvent(t.db, mine.id, 'safe-way-up', { kind: 'pass_fail_na', result: 'pass' });
  }
  await insertEvent(t.db, theirs.id, 'safe-way-up', { kind: 'pass_fail_na', result: 'fail' });
});

afterAll(async () => {
  await t.client.close();
});

async function pullEverything(userId: string, limit: number) {
  let cursor = 0;
  const pages = [];
  for (;;) {
    const page = pullResponseSchema.parse(await pullChanges(t.db, { userId }, cursor, limit));
    pages.push(page);
    expect(page.nextCursor).toBeGreaterThanOrEqual(cursor);
    cursor = page.nextCursor;
    if (!page.hasMore) return pages;
  }
}

describe('pullChanges', () => {
  it('returns all templates and only the caller’s own inspections and events', async () => {
    const [page] = await pullEverything(ALICE, 500);
    expect(page!.changes.templates.map((tpl) => tpl.id).sort()).toEqual([
      'fire-safety',
      'general-workplace',
      'scaffold-inspection',
    ]);
    expect(page!.changes.inspections.map((i) => i.site)).toEqual(['Plant room B2']);
    expect(page!.changes.answerEvents).toHaveLength(5);
    expect(page!.hasMore).toBe(false);
  });

  it('pages through changes in server_seq order without gaps or repeats', async () => {
    const pages = await pullEverything(ALICE, 2);
    expect(pages.length).toBe(5); // 3 templates + 1 inspection + 5 events = 9 rows
    const ids = pages.flatMap((p) => [
      ...p.changes.templates.map((x) => x.id),
      ...p.changes.inspections.map((x) => x.id),
      ...p.changes.answerEvents.map((x) => x.id),
    ]);
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
    expect(pages.at(-1)!.hasMore).toBe(false);
    for (const page of pages.slice(0, -1)) expect(page.hasMore).toBe(true);
  });

  it('returns nothing new past the latest cursor', async () => {
    const pages = await pullEverything(ALICE, 500);
    const again = await pullChanges(t.db, { userId: ALICE }, pages.at(-1)!.nextCursor, 500);
    expect(again.changes.answerEvents).toHaveLength(0);
    expect(again.nextCursor).toBe(pages.at(-1)!.nextCursor);
    expect(again.hasMore).toBe(false);
  });

  it('serialises times as ISO 8601 UTC and omits empty fields', async () => {
    const [page] = await pullEverything(ALICE, 500);
    const inspection = page!.changes.inspections[0]!;
    expect(inspection.createdAtDevice).toBe('2026-11-11T09:00:00.000Z');
    expect(inspection).not.toHaveProperty('cancelledAt');
    expect(page!.changes.answerEvents[0]!.deviceTime).toMatch(/Z$/);
  });
});

describe('seedTemplates', () => {
  it('is idempotent', async () => {
    expect(await seedTemplates(t.db)).toBe(0);
  });
});
