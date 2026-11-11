import { type FieldDatabase, getMeta, type LocalInspection, setMeta } from '@/lib/db';
import { type PullResponse, pullResponseSchema, PULL_PAGE_SIZE } from '@/lib/schemas';
import { apiFetch } from './api';
import { absorbRemoteClocks } from './clock';

/**
 * Merges one server inspection into the local copy. The server owns status changes it
 * made (cancelled, closed); a local submission still waiting in the outbox keeps the
 * device's `submitted` status until the server has answered for it.
 */
function mergeInspection(
  local: LocalInspection | undefined,
  server: PullResponse['changes']['inspections'][number],
): LocalInspection {
  const keepLocalSubmit = local?.status === 'submitted' && server.status === 'draft';
  const { rejectReason: _accepted, ...localFields } = local ?? {};
  return {
    ...localFields,
    ...server,
    status: keepLocalSubmit ? 'submitted' : server.status,
    submittedAtDevice: keepLocalSubmit ? local.submittedAtDevice : server.submittedAtDevice,
    hasCriticalFailure: Boolean(local?.hasCriticalFailure) || server.hasCriticalFailure,
    updatedAt: local?.updatedAt ?? server.createdAtDevice,
    syncState: keepLocalSubmit ? local.syncState : 'synced',
  };
}

/**
 * Applies one pull page in a single Dexie transaction and saves the new cursor in the
 * same transaction, so a crash can never record a cursor without its data. Every write
 * is a put keyed by id, so applying the same page twice changes nothing.
 */
export async function applyPullPage(database: FieldDatabase, page: PullResponse): Promise<void> {
  const tables = [
    database.templates,
    database.inspections,
    database.answerEvents,
    database.correctiveActions,
    database.meta,
  ];
  await database.transaction('rw', tables, async () => {
    const { templates, inspections, answerEvents, correctiveActions } = page.changes;
    if (templates.length) await database.templates.bulkPut(templates);

    if (inspections.length) {
      const locals = await database.inspections.bulkGet(inspections.map((i) => i.id));
      await database.inspections.bulkPut(
        inspections.map((server, index) => mergeInspection(locals[index], server)),
      );
    }

    if (answerEvents.length) {
      await database.answerEvents.bulkPut(
        answerEvents.map((event) => ({ ...event, syncState: 'synced' as const })),
      );
      await absorbRemoteClocks(
        database,
        answerEvents.map((event) => event.hlc),
      );
    }

    if (correctiveActions.length) await database.correctiveActions.bulkPut(correctiveActions);

    const cursor = (await getMeta('pullCursor', database)) ?? 0;
    if (page.nextCursor > cursor) await setMeta('pullCursor', page.nextCursor, database);
  });
}

/** Pulls pages until the server has nothing more. Returns the number of pages applied. */
export async function pullAll(database: FieldDatabase): Promise<number> {
  let pages = 0;
  for (;;) {
    const cursor = (await getMeta('pullCursor', database)) ?? 0;
    const response = await apiFetch(`/api/sync/pull?cursor=${cursor}&limit=${PULL_PAGE_SIZE}`);
    const page = pullResponseSchema.parse(await response.json());
    await applyPullPage(database, page);
    pages += 1;
    if (!page.hasMore) return pages;
  }
}
