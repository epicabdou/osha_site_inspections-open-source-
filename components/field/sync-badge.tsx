'use client';

import type { SyncState } from '@/lib/schemas';
import { formatTime } from '@/lib/field/format';
import { useConnectivity } from '@/lib/sync/connectivity';
import { usePendingCount, useSyncStatus } from './hooks';

/** Always-visible sync summary: iOS cannot sync in the background, so show what waits. */
export function SyncBadge() {
  const status = useSyncStatus();
  const pending = usePendingCount();
  const online = useConnectivity();
  const phase =
    !online && status.phase !== 'syncing' && status.phase !== 'paused' ? 'offline' : status.phase;

  let label: string;
  let tone: string;
  switch (phase) {
    case 'syncing':
      label = 'Syncing…';
      tone = 'border-accent text-accent';
      break;
    case 'offline':
      label = 'Offline';
      tone = 'border-border text-foreground';
      break;
    case 'paused':
      label = 'Sign in to sync';
      tone = 'border-border text-foreground';
      break;
    case 'error':
      label = 'Sync problem';
      tone = 'border-danger text-danger';
      break;
    default:
      label = pending === 0 ? 'All synced' : 'Waiting to sync';
      tone = pending === 0 ? 'border-ok text-ok' : 'border-border text-foreground';
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-3 text-sm font-semibold ${tone}`}
      title={
        status.message ??
        (status.lastSyncAt ? `Last synced ${formatTime(status.lastSyncAt)}` : undefined)
      }
      data-testid="sync-badge"
    >
      <span>{label}</span>
      {pending > 0 && (
        <span
          className="bg-foreground text-background rounded-full px-2 py-0.5 text-xs"
          data-testid="pending-count"
        >
          {pending} waiting
        </span>
      )}
    </div>
  );
}

const SYNC_STATE_TEXT: Record<SyncState, string> = {
  local: 'Saved on device',
  queued: 'Queued',
  synced: 'Synced',
  rejected: 'Rejected',
};

const SYNC_STATE_TONE: Record<SyncState, string> = {
  local: 'text-muted',
  queued: 'text-muted',
  synced: 'text-ok',
  rejected: 'text-danger',
};

/** The sync state of one answer, in words (never colour alone). */
export function SyncStateLabel({ state }: { state: SyncState }) {
  return (
    <span className={`text-sm font-semibold ${SYNC_STATE_TONE[state]}`} data-sync-state={state}>
      {SYNC_STATE_TEXT[state]}
    </span>
  );
}
