import { v7 as uuidv7 } from 'uuid';
import { isCriticalFailure, submitProblems, valueMatchesItem } from '@/lib/answers/evaluate';
import { reduceAnswers } from '@/lib/answers/reduce';
import {
  type FieldDatabase,
  getMeta,
  type LastUser,
  type LocalAnswerEvent,
  type LocalInspection,
  type OutboxEntry,
  setMeta,
  db as defaultDb,
} from '@/lib/db';
import {
  answerEventSchema,
  type AnswerValue,
  findTemplateItem,
  inspectionSchema,
  type Mutation,
  submitPayloadSchema,
} from '@/lib/schemas';
import { deviceNowIso, nextHlc } from '@/lib/sync/clock';

/**
 * Every write the inspector makes. Each one writes the data and its outbox entry in
 * a single Dexie transaction, so a change can never exist without the mutation
 * that will send it, or the other way round.
 */

export class FieldActionError extends Error {
  constructor(
    message: string,
    readonly code:
      'no_template' | 'no_inspection' | 'not_editable' | 'unknown_item' | 'invalid' | 'not_ready',
  ) {
    super(message);
    this.name = 'FieldActionError';
  }
}

/** Returns this device's id, creating it on first use. Run inside a transaction with `meta`. */
export async function ensureDeviceId(database: FieldDatabase = defaultDb): Promise<string> {
  const existing = await getMeta('deviceId', database);
  if (existing) return existing;
  const deviceId = uuidv7();
  await setMeta('deviceId', deviceId, database);
  return deviceId;
}

function outboxEntry(mutation: Mutation, createdAt: string): OutboxEntry {
  return {
    mutationId: mutation.mutationId,
    kind: mutation.kind,
    payload: mutation.payload,
    hlc: mutation.hlc,
    state: 'queued',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt,
  };
}

/** Starts an inspection on the device, locked to one template version. */
export async function createInspection(
  input: { templateId: string; templateVersion: number; site: string },
  user: LastUser,
  database: FieldDatabase = defaultDb,
): Promise<LocalInspection> {
  return database.transaction(
    'rw',
    [database.templates, database.inspections, database.outbox, database.meta],
    async () => {
      const template = await database.templates.get([input.templateId, input.templateVersion]);
      if (!template)
        throw new FieldActionError('That checklist is not on this device.', 'no_template');
      const deviceId = await ensureDeviceId(database);
      const hlc = await nextHlc(database, deviceId);
      const now = deviceNowIso();
      const parsed = inspectionSchema.safeParse({
        id: uuidv7(),
        templateId: template.id,
        templateVersion: template.version,
        site: input.site.trim(),
        status: 'draft',
        createdBy: user.userId,
        createdAtDevice: now,
        hasCriticalFailure: false,
      });
      if (!parsed.success) throw new FieldActionError('Enter a site name.', 'invalid');
      const inspection: LocalInspection = { ...parsed.data, updatedAt: now, syncState: 'local' };
      await database.inspections.add(inspection);
      await database.outbox.add(
        outboxEntry(
          { mutationId: uuidv7(), kind: 'inspection.create', payload: parsed.data, hlc },
          now,
        ),
      );
      return inspection;
    },
  );
}

/**
 * Records one answer as a new, permanent event. A fail on a critical item flags the
 * inspection at once, without waiting for sync; the flag never clears by itself.
 */
export async function recordAnswer(
  input: {
    inspectionId: string;
    itemId: string;
    value: AnswerValue;
    note?: string | undefined;
    photoHashes?: string[] | undefined;
  },
  user: LastUser,
  database: FieldDatabase = defaultDb,
): Promise<LocalAnswerEvent> {
  return database.transaction(
    'rw',
    [
      database.templates,
      database.inspections,
      database.answerEvents,
      database.outbox,
      database.meta,
    ],
    async () => {
      const inspection = await database.inspections.get(input.inspectionId);
      if (!inspection) throw new FieldActionError('Inspection not found.', 'no_inspection');
      if (inspection.status !== 'draft') {
        throw new FieldActionError(`This inspection is ${inspection.status}.`, 'not_editable');
      }
      const template = await database.templates.get([
        inspection.templateId,
        inspection.templateVersion,
      ]);
      if (!template) throw new FieldActionError('The checklist is missing.', 'no_template');
      const item = findTemplateItem(template, input.itemId);
      if (!item) throw new FieldActionError('Unknown checklist item.', 'unknown_item');
      if (!valueMatchesItem(item, input.value)) {
        throw new FieldActionError('That answer does not fit this item.', 'invalid');
      }

      const deviceId = await ensureDeviceId(database);
      const hlc = await nextHlc(database, deviceId);
      const now = deviceNowIso();
      const note = input.note?.trim() ? input.note.trim() : undefined;
      const parsed = answerEventSchema.safeParse({
        id: uuidv7(),
        inspectionId: inspection.id,
        itemId: item.id,
        value: input.value,
        ...(note ? { note } : {}),
        photoHashes: input.photoHashes ?? [],
        hlc,
        deviceId,
        authorId: user.userId,
        deviceTime: now,
      });
      if (!parsed.success) throw new FieldActionError('That answer is not valid.', 'invalid');

      const event: LocalAnswerEvent = { ...parsed.data, syncState: 'local' };
      await database.answerEvents.add(event);
      await database.outbox.add(
        outboxEntry(
          { mutationId: uuidv7(), kind: 'answer.record', payload: parsed.data, hlc },
          now,
        ),
      );

      const critical = isCriticalFailure(item, input.value);
      await database.inspections.update(inspection.id, {
        updatedAt: now,
        ...(critical ? { hasCriticalFailure: true } : {}),
      });
      return event;
    },
  );
}

/** Submits an inspection. Offline, the submission waits in the outbox like everything else. */
export async function submitInspection(
  inspectionId: string,
  database: FieldDatabase = defaultDb,
): Promise<void> {
  const tables = [
    database.templates,
    database.inspections,
    database.answerEvents,
    database.outbox,
    database.meta,
  ];
  await database.transaction('rw', tables, async () => {
    const inspection = await database.inspections.get(inspectionId);
    if (!inspection) throw new FieldActionError('Inspection not found.', 'no_inspection');
    if (inspection.status !== 'draft') {
      throw new FieldActionError(`This inspection is ${inspection.status}.`, 'not_editable');
    }
    const template = await database.templates.get([
      inspection.templateId,
      inspection.templateVersion,
    ]);
    if (!template) throw new FieldActionError('The checklist is missing.', 'no_template');
    const events = await database.answerEvents.where('inspectionId').equals(inspectionId).toArray();
    const problems = submitProblems(template, reduceAnswers(events));
    if (problems.length > 0) {
      throw new FieldActionError(
        `${problems.length} item${problems.length === 1 ? '' : 's'} still need attention.`,
        'not_ready',
      );
    }
    const deviceId = await ensureDeviceId(database);
    const hlc = await nextHlc(database, deviceId);
    const now = deviceNowIso();
    const payload = submitPayloadSchema.parse({ inspectionId, submittedAtDevice: now });
    await database.inspections.update(inspectionId, {
      status: 'submitted',
      submittedAtDevice: now,
      updatedAt: now,
    });
    await database.outbox.add(
      outboxEntry({ mutationId: uuidv7(), kind: 'inspection.submit', payload, hlc }, now),
    );
  });
}
