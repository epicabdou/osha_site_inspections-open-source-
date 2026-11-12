import { beforeEach, describe, expect, it } from 'vitest';
import { db, getMeta } from '@/lib/db';
import type { PullResponse } from '@/lib/schemas';
import { applyPullPage } from '@/lib/sync/pull';
import { decodeHlc } from '@/lib/sync/hlc';
import { SEED_TEMPLATES } from '@/server/seed/templates';

const INSPECTION_ID = '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f';
const EVENT_ID = '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e70';

function page(overrides: Partial<PullResponse['changes']> = {}, nextCursor = 10): PullResponse {
  return {
    changes: {
      templates: [SEED_TEMPLATES[0]!],
      inspections: [
        {
          id: INSPECTION_ID,
          templateId: 'scaffold-inspection',
          templateVersion: 1,
          site: 'Warehouse A',
          status: 'draft',
          createdBy: 'user_inspector',
          createdAtDevice: '2026-11-11T09:30:00.000Z',
          hasCriticalFailure: false,
          serverReceivedAt: '2026-11-11T09:31:00.000Z',
        },
      ],
      answerEvents: [
        {
          id: EVENT_ID,
          inspectionId: INSPECTION_ID,
          itemId: 'safe-way-up',
          value: { kind: 'pass_fail_na', result: 'pass' },
          photoHashes: [],
          hlc: '009999999999999-00003-device-b',
          deviceId: 'device-b',
          authorId: 'user_inspector',
          deviceTime: '2026-11-11T09:30:30.000Z',
          serverReceivedAt: '2026-11-11T09:31:00.000Z',
        },
      ],
      correctiveActions: [],
      ...overrides,
    },
    nextCursor,
    hasMore: false,
  };
}

async function snapshot() {
  return {
    templates: await db.templates.toArray(),
    inspections: await db.inspections.toArray(),
    events: await db.answerEvents.toArray(),
    actions: await db.correctiveActions.toArray(),
    meta: await db.meta.toArray(),
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('applyPullPage', () => {
  it('stores every change and the cursor in one go', async () => {
    await applyPullPage(db, page());
    expect(await db.templates.count()).toBe(1);
    expect((await db.inspections.get(INSPECTION_ID))?.syncState).toBe('synced');
    expect((await db.answerEvents.get(EVENT_ID))?.syncState).toBe('synced');
    expect(await getMeta('pullCursor')).toBe(10);
  });

  it('absorbs remote clocks so the next local event sorts after them', async () => {
    await applyPullPage(db, page());
    const hlc = await getMeta('hlc');
    expect(hlc?.wallMs).toBe(9_999_999_999_999);
    expect(hlc?.counter).toBeGreaterThan(3);
    expect(decodeHlc('009999999999999-00003-device-b').wallMs).toBe(hlc?.wallMs);
  });

  it('applying the same page twice leaves the database unchanged', async () => {
    await applyPullPage(db, page());
    const first = await snapshot();
    await applyPullPage(db, page());
    const second = await snapshot();
    // The HLC is the one value allowed to move: merging a clock again only ever advances it.
    const strip = (s: typeof first) => ({ ...s, meta: s.meta.filter((row) => row.key !== 'hlc') });
    expect(strip(second)).toEqual(strip(first));
  });

  it('never moves the cursor backwards', async () => {
    await applyPullPage(db, page({}, 50));
    await applyPullPage(db, page({}, 20));
    expect(await getMeta('pullCursor')).toBe(50);
  });

  it('keeps a local submission that the server has not seen yet', async () => {
    await applyPullPage(db, page());
    await db.inspections.update(INSPECTION_ID, {
      status: 'submitted',
      submittedAtDevice: '2026-11-11T10:00:00.000Z',
      syncState: 'local',
    });
    await applyPullPage(db, page());
    const local = await db.inspections.get(INSPECTION_ID);
    expect(local?.status).toBe('submitted');
    expect(local?.submittedAtDevice).toBe('2026-11-11T10:00:00.000Z');
  });

  it('takes the server status when a supervisor cancelled the inspection', async () => {
    await applyPullPage(db, page());
    await db.inspections.update(INSPECTION_ID, { status: 'submitted' });
    const cancelled = page();
    cancelled.changes.inspections[0] = {
      ...cancelled.changes.inspections[0]!,
      status: 'cancelled',
      cancelledAt: '2026-11-11T10:05:00.000Z',
      cancelReason: 'Wrong site',
    };
    await applyPullPage(db, cancelled);
    const local = await db.inspections.get(INSPECTION_ID);
    expect(local?.status).toBe('cancelled');
    expect(local?.cancelReason).toBe('Wrong site');
  });

  it('never clears a critical flag raised on the device', async () => {
    await applyPullPage(db, page());
    await db.inspections.update(INSPECTION_ID, { hasCriticalFailure: true });
    await applyPullPage(db, page());
    expect((await db.inspections.get(INSPECTION_ID))?.hasCriticalFailure).toBe(true);
  });
});
