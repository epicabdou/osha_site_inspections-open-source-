import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Field Inspections</h1>
        <p className="text-muted text-lg">
          An offline-first safety inspection app. Inspectors work with no signal; everything syncs
          correctly when they are back in coverage, even if a supervisor changed the same inspection
          in the meantime.
        </p>
      </header>

      <nav aria-label="Choose an area" className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/field"
          className="bg-accent text-accent-foreground flex min-h-24 flex-col justify-center rounded-lg px-5 py-4"
        >
          <span className="text-xl font-semibold">Inspector app</span>
          <span>Works offline once you have signed in.</span>
        </Link>
        <Link
          href="/dashboard"
          className="border-border bg-surface flex min-h-24 flex-col justify-center rounded-lg border-2 px-5 py-4"
        >
          <span className="text-xl font-semibold">Supervisor dashboard</span>
          <span className="text-muted">Needs a connection and the supervisor role.</span>
        </Link>
      </nav>
    </main>
  );
}
