import { z } from 'zod';

/** A UUIDv7, created on the device for every record and mutation. */
export const uuidV7 = z.uuidv7();

/**
 * An ISO 8601 timestamp in UTC (`...Z`). Offsets are rejected so every stored
 * time has one unambiguous form; display code converts to the device's locale.
 */
export const isoUtc = z.iso.datetime({ offset: false });

/** A Clerk user id. Opaque to the app. */
export const userId = z.string().min(1).max(255);

/** A stable slug such as `scaffold-inspection` or `base-plate`. */
export const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single hyphens');
