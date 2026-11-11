import fc from 'fast-check';
import { describe, it } from 'vitest';
import { parseRole, roleFromClaims, ROLES } from '@/lib/auth/roles';

/**
 * Access control rests on these two functions, so check them against arbitrary
 * input rather than a handful of examples: nothing outside the two known roles
 * may ever be granted a role.
 */
describe('role parsing (properties)', () => {
  it('parseRole only ever returns one of the known roles, or null', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const role = parseRole(value);
        return role === null || (ROLES as readonly unknown[]).includes(role);
      }),
    );
  });

  it('roleFromClaims grants a role only when metadata.role is exactly a known role', () => {
    fc.assert(
      fc.property(fc.anything(), (role) => {
        const parsed = roleFromClaims({ metadata: { role } });
        const expected = typeof role === 'string' && (ROLES as readonly string[]).includes(role);
        return expected ? parsed === role : parsed === null;
      }),
    );
  });
});
