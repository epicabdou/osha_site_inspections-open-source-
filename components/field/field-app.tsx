'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { LastUser } from '@/lib/db';
import { loadDemoSettings } from '@/lib/demo/settings';
import { fieldHref, navigate, useFieldRoute } from '@/lib/field/navigation';
import { photoQueueTask } from '@/lib/photos/upload-queue';
import { clockLooksWrong, syncEngine } from '@/lib/sync/engine';
import { buttonClass } from '@/components/ui/button';
import { ClerkBridge } from './clerk-bridge';
import { FieldAppLoading } from './field-app-loading';
import { useLastUser, useSyncStatus } from './hooks';
import { HomeView } from './home-view';
import { InspectionView } from './inspection-view';
import { NewInspectionView } from './new-inspection-view';
import { SettingsView } from './settings-view';
import { SyncBadge } from './sync-badge';

/**
 * Root of the inspector's app. Runs entirely in the browser from the device database:
 * it works with no network and without Clerk's script, once a user has signed in on
 * this device at least once.
 */
export function FieldApp() {
  const lastUser = useLastUser();

  useEffect(() => {
    syncEngine.registerAfterCycle(photoQueueTask);
    void loadDemoSettings().then(() => syncEngine.start());
  }, []);

  return (
    <>
      <ClerkBridge />
      {lastUser === undefined ? (
        <FieldAppLoading />
      ) : lastUser === null ? (
        <SignInGate />
      ) : (
        <FieldShell user={lastUser} />
      )}
    </>
  );
}

function SignInGate() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">Inspections</h1>
      <p className="text-lg">Sign in once with a connection to use the app offline.</p>
      <p className="text-muted">
        After that, this device keeps your checklists and your work, signal or not.
      </p>
      <Link href="/sign-in?redirect_url=/field" className={buttonClass('primary')}>
        Sign in
      </Link>
    </main>
  );
}

function FieldShell({ user }: { user: LastUser }) {
  const route = useFieldRoute();

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-background/95 border-border sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-2">
          <a
            href={fieldHref({ view: 'home' })}
            onClick={(event) => {
              event.preventDefault();
              navigate({ view: 'home' });
            }}
            className="inline-flex min-h-11 items-center text-lg font-bold"
          >
            Inspections
          </a>
          <div className="flex items-center gap-2">
            <SyncBadge />
            <a
              href={fieldHref({ view: 'settings' })}
              onClick={(event) => {
                event.preventDefault();
                navigate({ view: 'settings' });
              }}
              className="border-border inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 px-3 text-sm font-semibold"
              aria-label={`Settings for ${user.displayName}`}
            >
              {initials(user.displayName)}
            </a>
          </div>
        </div>
      </header>
      {user.role === 'supervisor' && (
        <p className="bg-surface border-border border-b px-4 py-2 text-center text-sm">
          You are signed in as a supervisor. Inspections are recorded by inspectors;{' '}
          <Link className="text-accent underline" href="/dashboard">
            open the dashboard
          </Link>
          .
        </p>
      )}
      <ClockNotice />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-4 pb-32">
        {route.view === 'new' ? (
          <NewInspectionView user={user} />
        ) : route.view === 'inspection' ? (
          <InspectionView key={route.id} user={user} id={route.id} section={route.section} />
        ) : route.view === 'settings' ? (
          <SettingsView user={user} />
        ) : (
          <HomeView />
        )}
      </main>
    </div>
  );
}

/** A quiet notice when the device clock is more than 5 minutes from the server's. */
function ClockNotice() {
  const { clockOffsetMs } = useSyncStatus();
  if (!clockLooksWrong(clockOffsetMs)) return null;
  const minutes = Math.round(Math.abs(clockOffsetMs!) / 60_000);
  const amount = minutes >= 90 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;
  return (
    <p
      className="text-muted border-border border-b px-4 py-2 text-center text-sm"
      data-testid="clock-notice"
    >
      This device&apos;s clock looks wrong (about {amount} {clockOffsetMs! > 0 ? 'ahead' : 'behind'}
      ). Your answers still sync in the right order.
    </p>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}
