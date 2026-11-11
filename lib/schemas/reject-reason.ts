import { z } from 'zod';

/**
 * Why the server rejected a mutation. A rejection is final: the device marks the
 * record rejected, shows the reason, and never retries it. Shared by client and server.
 */
export const REJECT_REASONS = [
  'inspection_not_found',
  'inspection_cancelled',
  'inspection_closed',
  'inspection_submitted',
  'not_owner',
  'unknown_template_version',
  'unknown_item',
  'invalid_payload',
  'forbidden',
] as const;
export const rejectReason = z.enum(REJECT_REASONS);
export type RejectReason = z.infer<typeof rejectReason>;

/** Plain-language text for each rejection reason, shown next to the rejected record. */
export const REJECT_REASON_TEXT: Record<RejectReason, string> = {
  inspection_not_found: 'The server has no record of this inspection.',
  inspection_cancelled: 'A supervisor cancelled this inspection.',
  inspection_closed: 'This inspection is closed.',
  inspection_submitted: 'This inspection was already submitted.',
  not_owner: 'This inspection belongs to another inspector.',
  unknown_template_version: 'The server does not know this template version.',
  unknown_item: 'This item is not part of the inspection’s template.',
  invalid_payload: 'The data was not in the expected format.',
  forbidden: 'Your role is not allowed to do this.',
};
