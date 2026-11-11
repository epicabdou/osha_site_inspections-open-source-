'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-renders the dashboard every 15 seconds while visible, so new syncs appear during a demo. */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
