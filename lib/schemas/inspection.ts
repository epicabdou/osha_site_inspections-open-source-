import { z } from 'zod';
import { isoUtc, slug, userId, uuidV7 } from './common';

export const INSPECTION_STATUSES = ['draft', 'submitted', 'cancelled', 'closed'] as const;
export const inspectionStatus = z.enum(INSPECTION_STATUSES);
export type InspectionStatus = z.infer<typeof inspectionStatus>;

/** An inspection, created on the device and locked to one template version. */
export const inspectionSchema = z
  .object({
    id: uuidV7,
    templateId: slug,
    templateVersion: z.number().int().positive(),
    site: z.string().trim().min(1).max(200),
    status: inspectionStatus,
    createdBy: userId,
    createdAtDevice: isoUtc,
    submittedAtDevice: isoUtc.optional(),
    hasCriticalFailure: z.boolean(),
  })
  .strict();
export type Inspection = z.infer<typeof inspectionSchema>;
