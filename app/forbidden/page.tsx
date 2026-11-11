import type { Metadata } from 'next';
import Link from 'next/link';
import { SignOutButton } from '@clerk/nextjs';

export const metadata: Metadata = {
  title: 'Not allowed',
};

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">This area is for supervisors</h1>
      <p className="text-muted">
        Your account does not have the supervisor role. Inspectors use the inspector app.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/field"
          className="bg-accent text-accent-foreground inline-flex min-h-11 items-center rounded-md px-4 font-semibold"
        >
          Open the inspector app
        </Link>
        <SignOutButton redirectUrl="/">
          <button
            type="button"
            className="border-border inline-flex min-h-11 items-center rounded-md border-2 px-4 font-semibold"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
