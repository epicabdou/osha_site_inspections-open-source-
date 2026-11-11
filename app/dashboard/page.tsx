import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UserButton } from '@clerk/nextjs';
import { requireSupervisor } from '@/server/auth';

export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * Supervisor dashboard. Online only: Server Components read Postgres per request.
 * The heading is part of the static shell; everything that reads the session
 * streams in behind <Suspense> (required with Cache Components).
 */
export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Supervisor dashboard</h1>
        <UserButton />
      </header>
      <Suspense fallback={<p role="status">Loading…</p>}>
        <DashboardContent />
      </Suspense>
    </main>
  );
}

async function DashboardContent() {
  const user = await requireSupervisor();
  return (
    <section className="border-border bg-surface rounded-lg border p-4">
      <p>
        Signed in with the <strong data-testid="dashboard-role">{user.role}</strong> role.
      </p>
      <p className="text-muted mt-1">
        Inspections, critical findings and corrective actions arrive in milestone M4.
      </p>
    </section>
  );
}
