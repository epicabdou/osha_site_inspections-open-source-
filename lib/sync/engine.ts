import { db, type FieldDatabase, getMeta, setMeta } from '@/lib/db';
import { AuthRequiredError, HttpError, NetworkError } from './api';
import { pullAll } from './pull';

/**
 * The sync engine: plain TypeScript, no React. Components read its state through
 * `useSyncStatus()` (useSyncExternalStore).
 *
 * M1 scope: pull (templates and the inspector's own data) on start, when the page
 * becomes visible and when the browser comes online. M2 adds the outbox push.
 */

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'paused' | 'error';

export type SyncSnapshot = {
  phase: SyncPhase;
  /** Human-readable detail for the current phase. */
  message?: string;
  lastSyncAt?: string;
};

const INITIAL: SyncSnapshot = { phase: 'idle' };

class SyncEngine {
  private snapshot: SyncSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private running = false;
  private started = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly database: FieldDatabase) {}

  getSnapshot = (): SyncSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }

  /** Starts the triggers. Safe to call more than once. */
  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    void getMeta('lastSyncAt', this.database).then((lastSyncAt) => {
      if (lastSyncAt) this.set({ lastSyncAt });
    });
    const onOnline = () => void this.syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.syncNow();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    this.cleanups.push(
      () => window.removeEventListener('online', onOnline),
      () => document.removeEventListener('visibilitychange', onVisible),
    );
    void this.syncNow();
  }

  /** Stops the triggers (sign-out, tests). */
  stop(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.started = false;
  }

  /** Runs one sync cycle now, unless one is already running in this tab. */
  async syncNow(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.set({ phase: 'syncing', message: undefined });
    try {
      await pullAll(this.database);
      const lastSyncAt = new Date().toISOString();
      await setMeta('lastSyncAt', lastSyncAt, this.database);
      this.set({ phase: 'idle', lastSyncAt });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        this.set({ phase: 'paused', message: 'Sign in to sync' });
      } else if (error instanceof NetworkError) {
        this.set({
          phase: 'offline',
          message: 'No connection. Your work is saved on this device.',
        });
      } else if (error instanceof HttpError) {
        this.set({ phase: 'error', message: `The server responded with ${error.status}.` });
      } else {
        console.error('Sync failed', error);
        this.set({ phase: 'error', message: 'Sync failed. It will retry.' });
      }
    } finally {
      this.running = false;
    }
  }
}

export const syncEngine = new SyncEngine(db);
