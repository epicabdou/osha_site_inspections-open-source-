'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

/**
 * Navigation inside the field app. Everything lives on the one static /field page;
 * views are search params changed with history.pushState, which Next.js syncs with
 * useSearchParams. No request leaves the device. See docs/ARCHITECTURE.md.
 */
export type FieldRoute =
  | { view: 'home' }
  | { view: 'new' }
  | { view: 'inspection'; id: string; section?: string }
  | { view: 'settings' };

export function parseFieldRoute(params: URLSearchParams): FieldRoute {
  const view = params.get('view');
  const id = params.get('id');
  if (view === 'inspection' && id) {
    const section = params.get('section');
    return section ? { view, id, section } : { view, id };
  }
  if (view === 'new' || view === 'settings') return { view };
  return { view: 'home' };
}

/** Builds the URL for a route, keeping `demo=1` so the chaos panel stays open. */
export function fieldHref(route: FieldRoute, current?: URLSearchParams): string {
  const params = new URLSearchParams();
  if (route.view !== 'home') params.set('view', route.view);
  if (route.view === 'inspection') {
    params.set('id', route.id);
    if (route.section) params.set('section', route.section);
  }
  if (current?.get('demo') === '1') params.set('demo', '1');
  const query = params.toString();
  return query ? `/field?${query}` : '/field';
}

/** The current field route, from the URL. */
export function useFieldRoute(): FieldRoute {
  const params = useSearchParams();
  return useMemo(() => parseFieldRoute(new URLSearchParams(params.toString())), [params]);
}

/** Moves to a route without a request. */
export function navigate(route: FieldRoute, options: { replace?: boolean } = {}): void {
  const href = fieldHref(route, new URLSearchParams(window.location.search));
  if (options.replace) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  window.scrollTo({ top: 0 });
}
