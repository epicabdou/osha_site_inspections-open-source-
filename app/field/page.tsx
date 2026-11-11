import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FieldApp } from '@/components/field/field-app';
import { FieldAppLoading } from '@/components/field/field-app-loading';

/**
 * The inspector's app: one statically prerendered page.
 *
 * Rules (see docs/ARCHITECTURE.md):
 * - Read no cookies(), headers(), auth() or searchParams here. All data comes from
 *   the device database inside <FieldApp />.
 * - `ensureStatic = 'navigation'` makes `next build` fail if this route ever needs
 *   request-time rendering, because the service worker serves this one cached page
 *   for every /field URL, offline included.
 */
export const ensureStatic = 'navigation';

export const metadata: Metadata = {
  title: 'Inspector',
};

export default function FieldPage() {
  return (
    <Suspense fallback={<FieldAppLoading />}>
      <FieldApp />
    </Suspense>
  );
}
