import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getMeta, type LastUser } from '@/lib/db';
import { DEFAULT_DEMO_SETTINGS, updateDemoSettings } from '@/lib/demo/settings';
import { createInspection } from '@/lib/field/actions';
import { setTokenProvider } from '@/lib/sync/api';
import { isOnline, reportRequest, subscribeConnectivity } from '@/lib/sync/connectivity';
import { clockLooksWrong, DEBOUNCE_MS, INTERVAL_MS, SyncEngine } from '@/lib/sync/engine';
import { SEED_TEMPLATES } from '@/server/seed/templates';

/**
 * The engine's triggers and failure handling, with the browser simulated: `window` and
 * `document` are event targets, the network is a stub, and timers are fake.
 */
const user: LastUser = { userId: 'user_inspector', displayName: 'Inspector', role: 'inspector' };
const emptyPage = {
  changes: { templates: [], inspections: [], answerEvents: [], correctiveActions: [] },
  nextCursor: 0,
  hasMore: false,
};

class FakeDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

let fakeWindow: EventTarget;
let fakeDocument: FakeDocument;
let fetchMock: ReturnType<typeof vi.fn>;
let engine: SyncEngine;

function respond(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    handler(String(url), init),
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.templates.put(SEED_TEMPLATES[0]!);
  await updateDemoSettings(DEFAULT_DEMO_SETTINGS);
  // Only timers and Date: fake-indexeddb schedules its work with setImmediate.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  fakeWindow = new EventTarget();
  fakeDocument = new FakeDocument();
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('navigator', { onLine: true });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  respond(() => Response.json(emptyPage));
  setTokenProvider(async () => 'token');
  engine = new SyncEngine(db, 'engine-test');
});

afterEach(async () => {
  // Let any in-flight cycle finish so it cannot leak into the next test.
  await engine.whenIdle();
  engine.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setTokenProvider(null);
  reportRequest(true);
});

const pulls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/sync/pull')).length;
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('SyncEngine triggers', () => {
  it('syncs on start, on the online event and when the page becomes visible', async () => {
    engine.start();
    await vi.waitFor(() => expect(pulls()).toBe(1));
    await engine.whenIdle();
    fakeWindow.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(pulls()).toBe(2));
    await engine.whenIdle();
    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(pulls()).toBe(2);
    fakeDocument.visibilityState = 'visible';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(pulls()).toBe(3));
    expect(await getMeta('lastSyncAt')).toBeDefined();
  });

  it('syncs 2 s after the last local write, debounced', async () => {
    engine.start();
    await vi.waitFor(() => expect(pulls()).toBe(1));
    await engine.whenIdle();
    await createInspection(
      { templateId: 'scaffold-inspection', templateVersion: 1, site: 'A' },
      user,
    );
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100);
    await createInspection(
      { templateId: 'scaffold-inspection', templateVersion: 1, site: 'B' },
      user,
    );
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100);
    expect(pulls()).toBe(1);
    respond((url, init) => {
      if (!url.startsWith('/api/sync/push')) return Response.json(emptyPage);
      const { mutations } = JSON.parse(String(init?.body)) as {
        mutations: { mutationId: string }[];
      };
      const results = mutations.map((m) => ({ mutationId: m.mutationId, status: 'accepted' }));
      return Response.json({ results, serverTime: new Date().toISOString() });
    });
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/sync/push')).toBe(true),
    );
    await engine.whenIdle();
    expect(await db.outbox.count()).toBe(0);
  });

  it('syncs every 60 s while visible and online', async () => {
    engine.start();
    await vi.waitFor(() => expect(pulls()).toBe(1));
    await engine.whenIdle();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await vi.waitFor(() => expect(pulls()).toBe(2));
    await engine.whenIdle();
    fakeDocument.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(pulls()).toBe(2);
  });

  it('stop() removes every trigger', async () => {
    engine.start();
    await vi.waitFor(() => expect(pulls()).toBe(1));
    await engine.whenIdle();
    engine.stop();
    fakeWindow.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(pulls()).toBe(1);
  });
});

describe('SyncEngine failures', () => {
  it('backs off after a network error and retries on its own', async () => {
    respond(() => Promise.reject(new TypeError('Failed to fetch')));
    await engine.syncNow();
    const snapshot = engine.getSnapshot();
    expect(snapshot.phase).toBe('offline');
    expect(snapshot.nextRetryAt).toBeGreaterThan(Date.now());
    expect(isOnline()).toBe(false);
    respond(() => Response.json(emptyPage));
    await vi.advanceTimersByTimeAsync(3_000); // first backoff is 2 s ± 20%
    await vi.waitFor(() => expect(engine.getSnapshot().phase).toBe('idle'));
    expect(isOnline()).toBe(true);
  });

  it('reports server errors and unexpected failures as errors, and retries', async () => {
    respond(() => new Response('', { status: 500 }));
    await engine.syncNow();
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'error',
      message: expect.stringContaining('500'),
    });
    respond(() => new Response('not json', { status: 200 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await engine.syncNow();
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'error',
      message: 'Sync failed. Retrying.',
    });
  });

  it('pauses, without retrying, when there is no session', async () => {
    setTokenProvider(null);
    await engine.syncNow();
    expect(engine.getSnapshot().phase).toBe('paused');
    expect(engine.getSnapshot().nextRetryAt).toBeUndefined();
  });

  it('runs one cycle at a time and runs after-cycle tasks', async () => {
    const task = vi.fn(async () => {});
    engine.registerAfterCycle(task);
    engine.registerAfterCycle(task);
    const [first, second] = [engine.syncNow(), engine.syncNow()];
    expect(first).toBe(second);
    await first;
    expect(task).toHaveBeenCalledTimes(1);
    expect(pulls()).toBe(1);
  });

  it('skips the cycle when another tab holds the sync lock', async () => {
    const request = vi.fn(
      async (_name: string, _options: unknown, run: (lock: unknown) => Promise<void>) => run(null),
    );
    vi.stubGlobal('navigator', { onLine: true, locks: { request } });
    await engine.syncNow();
    expect(request).toHaveBeenCalledWith(
      'engine-test',
      { ifAvailable: true },
      expect.any(Function),
    );
    expect(pulls()).toBe(0);
    request.mockImplementation(async (_n, _o, run) => run({ name: 'engine-test' }));
    await engine.syncNow();
    expect(pulls()).toBe(1);
  });
});

describe('connectivity', () => {
  it('is offline when the browser says so or the last request failed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConnectivity(listener);
    reportRequest(false);
    expect(isOnline()).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    reportRequest(false);
    expect(listener).toHaveBeenCalledOnce();
    reportRequest(true);
    expect(isOnline()).toBe(true);
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOnline()).toBe(false);
    fakeWindow.dispatchEvent(new Event('offline'));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    fakeWindow.dispatchEvent(new Event('online'));
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('clock warning', () => {
  it('warns beyond 5 minutes either way', () => {
    expect(clockLooksWrong(undefined)).toBe(false);
    expect(clockLooksWrong(4 * 60_000)).toBe(false);
    expect(clockLooksWrong(6 * 60_000)).toBe(true);
    expect(clockLooksWrong(-2 * 60 * 60_000)).toBe(true);
  });
});

describe('SyncEngine protocol errors', () => {
  it('backs off instead of looping when the server omits results', async () => {
    await createInspection(
      { templateId: 'scaffold-inspection', templateVersion: 1, site: 'A' },
      user,
    );
    respond((url) =>
      url.startsWith('/api/sync/push')
        ? Response.json({ results: [], serverTime: new Date().toISOString() })
        : Response.json(emptyPage),
    );
    await engine.syncNow();
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'error',
      message: expect.stringContaining('502'),
    });
    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({ state: 'queued', attempts: 1 });
  });
});
