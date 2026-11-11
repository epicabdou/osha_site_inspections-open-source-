import { z } from 'zod';
import { isoUtc, slug, userId, uuidV7 } from './common';
import { rejectReason } from './reject-reason';

/** SHA-256 of the compressed photo bytes, as 64 lowercase hex characters. */
export const photoHash = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a SHA-256 hex digest');

/** The value an inspector gave. `cleared` records that an answer was removed. */
export const answerValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pass_fail_na'), result: z.enum(['pass', 'fail', 'na']) }).strict(),
  z.object({ kind: z.literal('number'), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal('text'), value: z.string().max(5000) }).strict(),
  z.object({ kind: z.literal('photo') }).strict(),
  z.object({ kind: z.literal('cleared') }).strict(),
]);
export type AnswerValue = z.infer<typeof answerValueSchema>;

export const SYNC_STATES = ['local', 'queued', 'synced', 'rejected'] as const;
export const syncState = z.enum(SYNC_STATES);
export type SyncState = z.infer<typeof syncState>;

/**
 * One answer, stored as a permanent event. An item's current value is the event
 * with the highest (hlc, deviceId); see lib/answers/reduce.ts.
 *
 * This is the shape that travels over the wire (no `syncState`, which is local).
 */
export const answerEventSchema = z
  .object({
    id: uuidV7,
    inspectionId: uuidV7,
    itemId: slug,
    value: answerValueSchema,
    note: z.string().max(5000).optional(),
    photoHashes: z.array(photoHash).max(20),
    /** Hybrid logical clock, `<wallMs 15 digits>-<counter 5 digits>-<deviceId>`; see lib/sync/hlc.ts. */
    hlc: z
      .string()
      .max(100)
      .regex(/^\d{15}-\d{5}-.+$/, 'Expected a hybrid logical clock'),
    deviceId: z.string().min(1).max(64),
    authorId: userId,
    deviceTime: isoUtc,
  })
  .strict()
  .refine((event) => event.hlc.endsWith(`-${event.deviceId}`), {
    message: 'The clock must end with the event’s deviceId',
    path: ['hlc'],
  });
export type AnswerEventPayload = z.infer<typeof answerEventSchema>;

/** An answer event as stored on the device, with its sync state. */
export const localAnswerEventSchema = answerEventSchema.extend({
  syncState,
  rejectReason: rejectReason.optional(),
});
export type AnswerEvent = z.infer<typeof localAnswerEventSchema>;
