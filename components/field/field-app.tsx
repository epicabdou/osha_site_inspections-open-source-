'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * Root of the inspector's app. Runs entirely in the browser: navigation inside the
 * app uses search params (e.g. `/field?view=inspection&id=<uuid>`) changed with
 * `history.pushState`, so no request leaves the device.
 *
 * M0 ships the static shell only. The device database, inspections and sync arrive
 * in M1 and M2.
 */
export function FieldApp() {
  const searchParams = useSearchParams();
  const view = searchParams.get('view') ?? 'home';

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Inspections</h1>
        <Link href="/" className="text-accent inline-flex min-h-11 items-center underline">
          Home
        </Link>
      </header>
      <section
        aria-labelledby="field-status"
        className="border-border bg-surface rounded-lg border p-4"
      >
        <h2 id="field-status" className="text-lg font-semibold">
          Inspector app shell
        </h2>
        <p className="text-muted mt-1">
          This page is prerendered and will be served from the device when offline. Current view:{' '}
          <code data-testid="field-view">{view}</code>
        </p>
      </section>
    </main>
  );
}
