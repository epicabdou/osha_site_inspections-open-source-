/**
 * The two roles in the app. A user's role lives in Clerk `publicMetadata.role`
 * and reaches the server inside the signed session token (see docs/DECISIONS.md,
 * "Single tenant, two roles"). The server never trusts a role sent by the client.
 */
export const ROLES = ['inspector', 'supervisor'] as const;

export type Role = (typeof ROLES)[number];

/** Narrows an unknown value to a Role, or returns null. */
export function parseRole(value: unknown): Role | null {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : null;
}

/**
 * Reads the role from verified Clerk session claims.
 *
 * The Clerk session token is customised to include `{ "metadata": "{{user.public_metadata}}" }`,
 * so the role is at `claims.metadata.role`. Anything else yields null (no access).
 */
export function roleFromClaims(claims: unknown): Role | null {
  if (typeof claims !== 'object' || claims === null) return null;
  const metadata = (claims as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  return parseRole((metadata as { role?: unknown }).role);
}
