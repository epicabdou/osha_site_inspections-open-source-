import 'server-only';
import type { CorrectiveAction, ServerAnswerEvent, ServerInspection } from '@/lib/schemas';
import type { answerEvents, correctiveActions, inspections } from '@/server/db/schema';

type InspectionRow = typeof inspections.$inferSelect;
type AnswerEventRow = typeof answerEvents.$inferSelect;
type CorrectiveActionRow = typeof correctiveActions.$inferSelect;

const iso = (date: Date) => date.toISOString();

/** Postgres row → the shape the device and the shared schemas expect. Nulls become absent. */
export function serializeInspection(row: InspectionRow): ServerInspection {
  return {
    id: row.id,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    site: row.site,
    status: row.status,
    createdBy: row.createdBy,
    createdAtDevice: iso(row.createdAtDevice),
    ...(row.submittedAtDevice ? { submittedAtDevice: iso(row.submittedAtDevice) } : {}),
    hasCriticalFailure: row.hasCriticalFailure,
    serverReceivedAt: iso(row.serverReceivedAt),
    ...(row.cancelledAt ? { cancelledAt: iso(row.cancelledAt) } : {}),
    ...(row.cancelReason ? { cancelReason: row.cancelReason } : {}),
  };
}

export function serializeAnswerEvent(row: AnswerEventRow): ServerAnswerEvent {
  return {
    id: row.id,
    inspectionId: row.inspectionId,
    itemId: row.itemId,
    value: row.value,
    ...(row.note ? { note: row.note } : {}),
    photoHashes: row.photoHashes,
    hlc: row.hlc,
    deviceId: row.deviceId,
    authorId: row.authorId,
    deviceTime: iso(row.deviceTime),
    serverReceivedAt: iso(row.serverReceivedAt),
  };
}

export function serializeCorrectiveAction(row: CorrectiveActionRow): CorrectiveAction {
  return {
    id: row.id,
    inspectionId: row.inspectionId,
    itemId: row.itemId,
    sourceEventId: row.sourceEventId,
    status: row.status,
    createdAt: iso(row.createdAt),
    ...(row.closedAt ? { closedAt: iso(row.closedAt) } : {}),
    ...(row.closeNote ? { closeNote: row.closeNote } : {}),
  };
}
