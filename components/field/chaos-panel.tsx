'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState, useSyncExternalStore } from 'react';
import { db } from '@/lib/db';
import {
  DEFAULT_DEMO_SETTINGS,
  DEMO_LIMITS,
  isDemoActive,
  isDemoModeEnabled,
  updateDemoSettings,
} from '@/lib/demo/settings';
import { downloadLocalData, wipeLocalData } from '@/lib/field/export';
import { syncEngine } from '@/lib/sync/engine';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useDemoSettings, useSyncStatus } from './hooks';

const HOUR = 60 * 60 * 1000;
const noSubscription = () => () => {};

/**
 * The demo chaos panel: break the network on purpose and watch the app recover.
 * Shown with `?demo=1` or when NEXT_PUBLIC_DEMO_MODE is true. Every request from the
 * sync engine and the photo queue goes through the one fetch wrapper that applies these
 * settings (lib/sync/api.ts), and the clock skew feeds the device clock and the HLC.
 */
export function ChaosPanel() {
  const enabled = useSyncExternalStore(
    noSubscription,
    () => isDemoModeEnabled(window.location.search),
    () => false,
  );
  if (!enabled) return null;
  return <Panel />;
}

/** "Demo mode" badge, shown whenever any chaos setting is active. */
export function DemoBadge() {
  const settings = useDemoSettings();
  if (!isDemoActive(settings)) return null;
  return (
    <span
      className="rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-black"
      data-testid="demo-badge"
    >
      Demo mode
    </span>
  );
}

function Panel() {
  const settings = useDemoSettings();
  const sync = useSyncStatus();
  const [wiping, setWiping] = useState(false);
  const ids = { latency: useId(), drop: useId(), skew: useId() };
  const queue = useLiveQuery(async () => {
    const [outbox, photos] = await Promise.all([
      db.outbox.orderBy('seq').toArray(),
      db.photos.where('uploadState').notEqual('uploaded').toArray(),
    ]);
    return { outbox, photos };
  }, []);

  const skewHours = settings.clockSkewMs / HOUR;

  return (
    <details
      className="border-accent bg-surface mx-auto mt-3 w-full max-w-2xl rounded-lg border-2"
      data-testid="chaos-panel"
    >
      <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-4 font-bold">
        <span>Demo controls</span>
        <DemoBadge />
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-muted text-sm">
          Break the network on purpose. Everything you do is still saved on this device; watch the
          queue drain when you restore it.
        </p>

        <label className="flex min-h-11 items-center gap-3 font-semibold">
          <input
            type="checkbox"
            className="size-6"
            checked={settings.forceOffline}
            onChange={(event) => void updateDemoSettings({ forceOffline: event.target.checked })}
          />
          Force offline
        </label>

        <div className="flex flex-col gap-1">
          <label htmlFor={ids.latency} className="font-semibold">
            Latency: {settings.latencyMs} ms
          </label>
          <input
            id={ids.latency}
            type="range"
            min={DEMO_LIMITS.latencyMs.min}
            max={DEMO_LIMITS.latencyMs.max}
            step={250}
            value={settings.latencyMs}
            onChange={(event) => void updateDemoSettings({ latencyMs: Number(event.target.value) })}
            className="min-h-11"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={ids.drop} className="font-semibold">
            Drop rate: {Math.round(settings.dropRate * 100)}% of requests fail
          </label>
          <input
            id={ids.drop}
            type="range"
            min={0}
            max={50}
            step={5}
            value={Math.round(settings.dropRate * 100)}
            onChange={(event) =>
              void updateDemoSettings({ dropRate: Number(event.target.value) / 100 })
            }
            className="min-h-11"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={ids.skew} className="font-semibold">
            Clock skew: {skewHours > 0 ? '+' : ''}
            {skewHours} h
          </label>
          <input
            id={ids.skew}
            type="range"
            min={-24}
            max={24}
            step={1}
            value={skewHours}
            onChange={(event) =>
              void updateDemoSettings({ clockSkewMs: Number(event.target.value) * HOUR })
            }
            className="min-h-11"
          />
        </div>

        <section aria-labelledby="queue-title" className="flex flex-col gap-2">
          <h3 id="queue-title" className="font-bold">
            Outbox and photo queue
          </h3>
          <p className="text-sm" role="status">
            Sync: {sync.phase}
            {sync.message ? ` — ${sync.message}` : ''}
          </p>
          {queue && queue.outbox.length + queue.photos.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="queue-table">
                <caption className="sr-only">Changes waiting for the server</caption>
                <thead>
                  <tr className="border-border border-b">
                    <th scope="col" className="p-1">
                      Kind
                    </th>
                    <th scope="col" className="p-1">
                      State
                    </th>
                    <th scope="col" className="p-1">
                      Attempts
                    </th>
                    <th scope="col" className="p-1">
                      Last error
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {queue.outbox.map((entry) => (
                    <tr key={entry.mutationId} className="border-border border-b">
                      <td className="p-1">{entry.kind}</td>
                      <td className="p-1">{entry.state}</td>
                      <td className="p-1">{entry.attempts}</td>
                      <td className="p-1">{entry.lastError ?? ''}</td>
                    </tr>
                  ))}
                  {queue.photos.map((photo) => (
                    <tr key={photo.hash} className="border-border border-b">
                      <td className="p-1">photo …{photo.hash.slice(-6)}</td>
                      <td className="p-1">{photo.uploadState}</td>
                      <td className="p-1">{photo.attempts}</td>
                      <td className="p-1">{photo.lastError ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted text-sm">Nothing waiting.</p>
          )}
        </section>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void syncEngine.syncNow()}>
            Sync now
          </Button>
          <Button variant="secondary" onClick={() => void downloadLocalData()}>
            Export local data as JSON
          </Button>
          <Button
            variant="secondary"
            disabled={!isDemoActive(settings)}
            onClick={() => void updateDemoSettings(DEFAULT_DEMO_SETTINGS)}
          >
            Reset demo settings
          </Button>
          <Button variant="danger" onClick={() => setWiping(true)}>
            Wipe local data
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={wiping}
        onOpenChange={setWiping}
        title="Wipe everything on this device?"
        confirmLabel="Wipe local data"
        onConfirm={() => {
          syncEngine.stop();
          void wipeLocalData().then(() => window.location.reload());
        }}
        extraAction={
          <Button variant="secondary" onClick={() => void downloadLocalData()}>
            Export first
          </Button>
        }
      >
        <p>
          This deletes every inspection, answer, photo and queued change stored on this device,
          including anything not yet synced. It cannot be undone.
        </p>
      </ConfirmDialog>
    </details>
  );
}
