import type { Role } from '@/lib/auth/roles';

export {};

declare global {
  /**
   * Custom claims added to the Clerk session token in the Clerk Dashboard
   * (Sessions → Customize session token): `{ "metadata": "{{user.public_metadata}}" }`.
   */
  interface CustomJwtSessionClaims {
    metadata?: {
      role?: Role;
    };
  }
}
