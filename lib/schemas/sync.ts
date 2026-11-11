import { z } from 'zod';
import { answerEventSchema } from './answer';
import { isoUtc, uuidV7 } from './common';
import { inspectionSchema, inspectionStatus } from './inspection';
import { rejectReason } from './reject-reason';
import { templateSchema } from './template';

/** At most this many mutations per push request. */
export const MAX_PUSH_BATCH = 100;
/** Default and maximum page size for pull. */
export const PULL_PAGE_SIZE = 500;

export const MUTATION_KINDS = ['inspection.create', 'answer.record', 'inspection.submit'] as const;
export type MutationKind = (typeof MUTATION_KINDS)[number];

const mutationBase = { mutationId: uuidV7, hlc: z.string().min(1).max(64) };

export const submitPayloadSchema = z
  .object({ inspectionId: uuidV7, submittedAtDevice: isoUtc })
  .strict();
export type SubmitPayload = z.infer<typeof submitPayloadSchema>;

/**
 * One queued change. The device creates it in the same Dexie transaction as the data
 * it describes; the server applies it at most once (keyed by `mutationId`).
 */
export const mutationSchema = z.discriminatedUnion('kind', [
  z
    .object({ ...mutationBase, kind: z.literal('inspection.create'), payload: inspectionSchema })
    .strict(),
  z
    .object({ ...mutationBase, kind: z.literal('answer.record'), payload: answerEventSchema })
    .strict(),
  z
    .object({ ...mutationBase, kind: z.literal('inspection.submit'), payload: submitPayloadSchema })
    .strict(),
]);
export type Mutation = z.infer<typeof mutationSchema>;

/**
 * The push envelope. Mutations are validated one by one on the server, so one
 * malformed mutation is rejected as `invalid_payload` without failing the batch.
 */
export const pushRequestSchema = z
  .object({
    deviceId: z.string().min(1).max(64),
    mutations: z.array(z.unknown()).min(1).max(MAX_PUSH_BATCH),
  })
  .strict();
export type PushRequest = { deviceId: string; mutations: Mutation[] };

export const MUTATION_STATUSES = ['accepted', 'duplicate', 'rejected'] as const;
export const mutationResultSchema = z
  .object({
    mutationId: z.string(),
    status: z.enum(MUTATION_STATUSES),
    reason: rejectReason.optional(),
  })
  .strict();
export type MutationResult = z.infer<typeof mutationResultSchema>;

export const pushResponseSchema = z
  .object({ results: z.array(mutationResultSchema), serverTime: isoUtc })
  .strict();
export type PushResponse = z.infer<typeof pushResponseSchema>;

/** An inspection as the server sends it: the device shape plus server-owned fields. */
export const serverInspectionSchema = inspectionSchema.extend({
  status: inspectionStatus,
  serverReceivedAt: isoUtc,
  cancelledAt: isoUtc.optional(),
  cancelReason: z.string().optional(),
});
export type ServerInspection = z.infer<typeof serverInspectionSchema>;

export const serverAnswerEventSchema = answerEventSchema.extend({ serverReceivedAt: isoUtc });
export type ServerAnswerEvent = z.infer<typeof serverAnswerEventSchema>;

export const correctiveActionSchema = z
  .object({
    id: z.uuid(),
    inspectionId: z.uuid(),
    itemId: z.string(),
    sourceEventId: z.uuid(),
    status: z.enum(['open', 'closed']),
    createdAt: isoUtc,
    closedAt: isoUtc.optional(),
    closeNote: z.string().optional(),
  })
  .strict();
export type CorrectiveAction = z.infer<typeof correctiveActionSchema>;

export const pullQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(PULL_PAGE_SIZE).default(PULL_PAGE_SIZE),
});

export const pullResponseSchema = z
  .object({
    changes: z
      .object({
        templates: z.array(templateSchema),
        inspections: z.array(serverInspectionSchema),
        answerEvents: z.array(serverAnswerEventSchema),
        correctiveActions: z.array(correctiveActionSchema),
      })
      .strict(),
    nextCursor: z.number().int().min(0),
    hasMore: z.boolean(),
  })
  .strict();
export type PullResponse = z.infer<typeof pullResponseSchema>;
