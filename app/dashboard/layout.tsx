import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { AutoRefresh } from '@/components/dashboard/auto-refresh';

/** Supervisor area. Online only; proxy.ts and every page re-check the supervisor role. */
export default function DashboardLayout({ children }: LayoutProps<'/dashboard'>) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-border border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/dashboard" className="inline-flex min-h-11 items-center text-xl font-bold">
            Supervisor dashboard
          </Link>
          <UserButton />
        </div>
      </header>
      <AutoRefresh />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
