import { describe, expect, it } from 'vitest';
import { parseRole, roleFromClaims } from '@/lib/auth/roles';

describe('parseRole', () => {
  it('accepts the two roles', () => {
    expect(parseRole('inspector')).toBe('inspector');
    expect(parseRole('supervisor')).toBe('supervisor');
  });

  it.each([undefined, null, '', 'admin', 'Supervisor', 1, {}])('rejects %j', (value) => {
    expect(parseRole(value)).toBeNull();
  });
});

describe('roleFromClaims', () => {
  it('reads metadata.role from session claims', () => {
    expect(roleFromClaims({ sub: 'user_1', metadata: { role: 'supervisor' } })).toBe('supervisor');
  });

  it.each([
    null,
    'claims',
    {},
    { metadata: null },
    { metadata: 'supervisor' },
    { metadata: { role: 'owner' } },
    // A role at the top level is not where the app puts it, so it is ignored.
    { role: 'supervisor' },
  ])('returns null for %j', (claims) => {
    expect(roleFromClaims(claims)).toBeNull();
  });
});
