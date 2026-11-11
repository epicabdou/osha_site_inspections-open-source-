'use client';

import { useClerk } from '@clerk/nextjs';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getMeta, type LastUser } from '@/lib/db';
import { countUnsynced, downloadLocalData, wipeLocalData } from '@/lib/field/export';
import { formatBytes, formatDateTime } from '@/lib/field/format';
import { navigate } from '@/lib/field/navigation';
import { isStandalone, storageInfo, type StorageInfo } from '@/lib/field/storage';
import { syncEngine } from '@/lib/sync/engine';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { usePendingCount, useSyncStatus } from './hooks';

export function SettingsView({ user }: { user: LastUser }) {
  const clerk = useClerk();
  const pending = usePendingCount();
  const sync = useSyncStatus();
  const deviceId = useLiveQuery(() => getMeta('deviceId'), []);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const standalone = useSyncExternalStore(
    () => () => {},
    isStandalone,
    () => false,
  );
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void storageInfo().then(setStorage);
  }, []);

  async function signOut() {
    setBusy(true);
    const unsynced = await countUnsynced();
    if (unsynced > 0 && !confirming) {
      setConfirming(true);
      setBusy(false);
      return;
    }
    syncEngine.stop();
    // Delete the device database (and with it every photo) so a shared tablet leaks nothing.
    await wipeLocalData();
    if (clerk.loaded) await clerk.signOut({ redirectUrl: '/' });
    else router.replace('/');
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">Signed in</h2>
        <p>
          {user.displayName} · {user.role ?? 'no role'}
        </p>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">Sync</h2>
        <p>
          {pending === 0 ? 'Everything is synced.' : `${pending} change(s) waiting to sync.`}
          {sync.message ? ` ${sync.message}` : ''}
        </p>
        <p className="text-muted text-sm">Last synced {formatDateTime(sync.lastSyncAt)}</p>
        <Button
          variant="secondary"
          className="mt-2 self-start"
          onClick={() => void syncEngine.syncNow()}
        >
          Sync now
        </Button>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">This device</h2>
        <p>
          Storage used: {storage?.usage !== undefined ? formatBytes(storage.usage) : 'unknown'}
          {storage?.quota !== undefined ? ` of ${formatBytes(storage.quota)}` : ''}
        </p>
        <p>
          Storage is {storage?.persisted ? 'kept by the browser' : 'not yet marked as persistent'}.
        </p>
        <p>{standalone ? 'Running as an installed app.' : 'Running in the browser.'}</p>
        <p className="text-muted text-sm">Device id {deviceId ?? 'not set yet'}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Your data</h2>
        <Button variant="secondary" className="self-start" onClick={() => void downloadLocalData()}>
          Export local data as JSON
        </Button>
        <Button
          variant="danger"
          className="self-start"
          disabled={busy}
          onClick={() => void signOut()}
        >
          Sign out and remove data from this device
        </Button>
      </section>

      <Button variant="secondary" className="self-start" onClick={() => navigate({ view: 'home' })}>
        Back
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Some work has not synced"
        confirmLabel="Sign out and delete it"
        busy={busy}
        onConfirm={() => void signOut()}
        extraAction={
          <Button variant="secondary" onClick={() => void downloadLocalData()}>
            Export as JSON first
          </Button>
        }
      >
        <p>
          {pending} change{pending === 1 ? '' : 's'} on this device never reached the server.
          Signing out deletes them from this device.
        </p>
      </ConfirmDialog>
    </div>
  );
}
