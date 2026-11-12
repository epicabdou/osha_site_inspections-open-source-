import { db, type FieldDatabase, getMeta, setMeta } from '@/lib/db';
import { pushResponseSchema } from '@/lib/schemas';
import { apiFetch, AuthRequiredError, HttpError, NetworkError } from './api';
import { deviceNow } from './clock';
import { reportRequest } from './connectivity';
import {
  backoffDelay,
  recoverSending,
  releaseBatch,
  settleBatch,
  takeBatch,
  toMutation,
} from './outbox';
import { pullAll } from './pull';
import { onLocalWrite } from './signal';

/**
 * The sync engine: plain TypeScript, no React. Components read its state with
 * `useSyncExternalStore` (see components/field/hooks.ts).
 *
 * One cycle = push everything queued (in order, 100 per request) → pull until the
 * server has nothing more → run the after-cycle tasks (the photo upload queue).
 *
 * Triggers: app start, the `online` event, the page becoming visible, 2 s after the
 * last local write, and every 60 s while visible. After a failure it backs off
 * (2 s, 4 s, 8 s… capped at 5 min, with jitter). Only one tab syncs at a time
 * (Web Locks). No Background Sync APIs: iOS lacks them, and one code path is
 * easier to test.
 */

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'paused' | 'error';

export type SyncSnapshot = {
  phase: SyncPhase;
  /** Human-readable detail for the current phase. */
  message?: string;
  lastSyncAt?: string;
  /** Device clock minus server clock, from the last push, in ms. */
  clockOffsetMs?: number;
  /** When the next automatic retry is due (epoch ms), after a failure. */
  nextRetryAt?: number;
};

export const DEBOUNCE_MS = 2_000;
export const INTERVAL_MS = 60_000;
/** A device clock further than this from the server's gets a quiet notice. */
export const CLOCK_WARNING_MS = 5 * 60_000;

type AfterCycleTask = (database: FieldDatabase) => Promise<void>;

/**
 * Runs sync cycles for one device database. The app uses the `syncEngine` singleton;
 * tests create their own instances to simulate several devices.
 */
export class SyncEngine {
  private snapshot: SyncSnapshot = { phase: 'idle' };
  private readonly listeners = new Set<() => void>();
  private readonly afterCycle: AfterCycleTask[] = [];
  private readonly cleanups: (() => void)[] = [];
  private running: Promise<void> | null = null;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;

  constructor(
    private readonly database: FieldDatabase,
    private readonly lockName = 'sync',
  ) {}

  getSnapshot = (): SyncSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }

  /** Adds a task to run after every successful push and pull (e.g. photo uploads). */
  registerAfterCycle(task: AfterCycleTask): void {
    if (!this.afterCycle.includes(task)) this.afterCycle.push(task);
  }

  /** Starts the triggers. Safe to call more than once. */
  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    void Promise.all([
      getMeta('lastSyncAt', this.database),
      getMeta('clockOffsetMs', this.database),
    ]).then(([lastSyncAt, clockOffsetMs]) =>
      this.set({
        ...(lastSyncAt ? { lastSyncAt } : {}),
        ...(clockOffsetMs !== undefined ? { clockOffsetMs } : {}),
      }),
    );

    const onOnline = () => void this.syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.syncNow();
    };
    const interval = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        !this.snapshot.nextRetryAt
      ) {
        void this.syncNow();
      }
    }, INTERVAL_MS);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribe = onLocalWrite(() => this.schedule(DEBOUNCE_MS));
    this.cleanups.push(
      () => window.removeEventListener('online', onOnline),
      () => document.removeEventListener('visibilitychange', onVisible),
      () => clearInterval(interval),
      unsubscribe,
    );
    void recoverSending(this.database).then(() => this.syncNow());
  }

  /** Stops every trigger (sign-out, tests). */
  stop(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    clearTimeout(this.timer);
    this.started = false;
  }

  /** Runs a cycle after `delayMs`, replacing any cycle already scheduled. */
  schedule(delayMs: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), delayMs);
  }

  /**
   * Runs one sync cycle now. If a cycle is already running in this tab, waits for it.
   * If another tab holds the sync lock, does nothing: that tab is syncing.
   */
  syncNow(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    this.running = this.withLock(() => this.cycle()).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Resolves when no cycle is running in this tab. */
  whenIdle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private async withLock(run: () => Promise<void>): Promise<void> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) return run();
    await locks.request(this.lockName, { ifAvailable: true }, async (lock) => {
      if (lock) await run();
    });
  }

  private async cycle(): Promise<void> {
    this.set({ phase: 'syncing', message: undefined, nextRetryAt: undefined });
    try {
      await this.pushAll();
      await pullAll(this.database);
      reportRequest(true);
      for (const task of this.afterCycle) await task(this.database);
      this.failures = 0;
      const lastSyncAt = new Date().toISOString();
      await setMeta('lastSyncAt', lastSyncAt, this.database);
      this.set({ phase: 'idle', lastSyncAt });
    } catch (error) {
      this.handleFailure(error);
    }
  }

  /** Pushes queued mutations in order until the outbox is empty. */
  private async pushAll(): Promise<void> {
    const deviceId = await getMeta('deviceId', this.database);
    for (;;) {
      const batch = await takeBatch(this.database);
      if (batch.length === 0) return;
      try {
        const response = await apiFetch('/api/sync/push', {
          method: 'POST',
          body: JSON.stringify({
            deviceId: deviceId ?? 'unknown',
            mutations: batch.map(toMutation),
          }),
        });
        const body = pushResponseSchema.parse(await response.json());
        reportRequest(true);
        const settled = await settleBatch(this.database, batch, body.results);
        await this.recordClockOffset(body.serverTime);
        if (settled.accepted + settled.rejected < batch.length) {
          // The server skipped some mutations. They are back in the queue; retry later
          // rather than looping on them now.
          throw new HttpError(502);
        }
      } catch (error) {
        const failures = this.failures + 1;
        await releaseBatch(
          this.database,
          batch,
          error instanceof Error ? error.message : 'Unknown error',
          Date.now() + backoffDelay(failures),
        );
        throw error;
      }
    }
  }

  private async recordClockOffset(serverTime: string) {
    const offset = deviceNow() - Date.parse(serverTime);
    if (!Number.isFinite(offset)) return;
    await setMeta('clockOffsetMs', offset, this.database);
    this.set({ clockOffsetMs: offset });
  }

  private handleFailure(error: unknown) {
    if (error instanceof AuthRequiredError) {
      // Not an error: work continues on the device; sync resumes after sign-in.
      this.set({ phase: 'paused', message: 'Sign in to sync' });
      return;
    }
    this.failures += 1;
    const delay = backoffDelay(this.failures);
    const nextRetryAt = Date.now() + delay;
    if (error instanceof NetworkError) {
      reportRequest(false);
      this.set({
        phase: 'offline',
        message: 'No connection. Your work is saved on this device.',
        nextRetryAt,
      });
    } else if (error instanceof HttpError) {
      this.set({
        phase: 'error',
        message: `The server responded with ${error.status}. Retrying.`,
        nextRetryAt,
      });
    } else {
      console.error('Sync failed', error);
      this.set({ phase: 'error', message: 'Sync failed. Retrying.', nextRetryAt });
    }
    this.schedule(delay);
  }
}

export const syncEngine = new SyncEngine(db);

/** True when the clock offset is large enough to show the "device clock looks wrong" notice. */
export function clockLooksWrong(offsetMs: number | undefined): boolean {
  return offsetMs !== undefined && Math.abs(offsetMs) > CLOCK_WARNING_MS;
}
