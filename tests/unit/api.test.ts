import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { DEFAULT_DEMO_SETTINGS, updateDemoSettings } from '@/lib/demo/settings';
import {
  apiFetch,
  AuthRequiredError,
  externalFetch,
  hasTokenProvider,
  HttpError,
  NetworkError,
  setTokenProvider,
} from '@/lib/sync/api';

const ok = () => new Response('{}', { status: 200 });

beforeEach(async () => {
  await db.delete();
  await db.open();
  await updateDemoSettings(DEFAULT_DEMO_SETTINGS);
  setTokenProvider(async () => 'token-123');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setTokenProvider(null);
  await updateDemoSettings(DEFAULT_DEMO_SETTINGS);
});

describe('apiFetch', () => {
  it('sends the session token and JSON content type, and never caches', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/api/sync/push', { method: 'POST', body: '{}' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-123');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.cache).toBe('no-store');
  });

  it('pauses without a token provider or a token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok()),
    );
    setTokenProvider(null);
    expect(hasTokenProvider()).toBe(false);
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(AuthRequiredError);
    setTokenProvider(async () => null);
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(AuthRequiredError);
    setTokenProvider(async () => {
      throw new Error('Clerk not loaded');
    });
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps 401 to sign-in-required and other statuses to HttpError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(AuthRequiredError);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    const temporary = await apiFetch('/x').catch((e: unknown) => e);
    expect(temporary).toBeInstanceOf(HttpError);
    expect((temporary as HttpError).temporary).toBe(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 400 })),
    );
    expect(((await apiFetch('/x').catch((e: unknown) => e)) as HttpError).temporary).toBe(false);
  });

  it('maps a transport failure to NetworkError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('demo chaos settings', () => {
  it('force offline fails like a dropped connection, without a request', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    await updateDemoSettings({ forceOffline: true });
    await expect(apiFetch('/x')).rejects.toThrow('forced by the demo panel');
    await expect(externalFetch('https://blob.example/x')).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops the configured share of requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok()),
    );
    await updateDemoSettings({ dropRate: 0.5 });
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.2).mockReturnValueOnce(0.9);
    await expect(apiFetch('/x')).rejects.toThrow('dropped');
    await expect(apiFetch('/x')).resolves.toBeInstanceOf(Response);
  });

  it('adds latency before each request', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    await updateDemoSettings({ latencyMs: 1_500 });
    const pending = apiFetch('/x');
    await vi.advanceTimersByTimeAsync(1_499);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('clamps settings to their limits', async () => {
    const settings = await updateDemoSettings({ dropRate: 9, latencyMs: -5, clockSkewMs: 1e12 });
    expect(settings).toMatchObject({
      dropRate: 0.5,
      latencyMs: 0,
      clockSkewMs: 24 * 60 * 60 * 1000,
    });
  });
});

describe('externalFetch', () => {
  it('passes through without a token and maps transport failures', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    setTokenProvider(null);
    await expect(
      externalFetch('https://blob.example/x', { method: 'PUT' }),
    ).resolves.toBeInstanceOf(Response);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('reset'))),
    );
    await expect(externalFetch('https://blob.example/x')).rejects.toBeInstanceOf(NetworkError);
  });
});
