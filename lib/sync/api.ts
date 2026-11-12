import { getDemoSettings } from '@/lib/demo/settings';

/**
 * The one fetch wrapper used by the sync engine and the photo upload queue.
 * It adds the Clerk session token and applies the demo chaos settings, so
 * "force offline", latency and dropped requests behave exactly like the real thing.
 */

/** The request never got an HTTP response (offline, DNS, dropped connection). Temporary. */
export class NetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** There is no live session, so sync is paused until the user signs in. Not an error. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Sign in to sync');
    this.name = 'AuthRequiredError';
  }
}

/** The server answered with an error status. 5xx is temporary; 4xx is not. */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Server responded with ${status}`);
    this.name = 'HttpError';
  }
  get temporary(): boolean {
    return this.status >= 500 || this.status === 429 || this.status === 408;
  }
}

/**
 * The session is valid but the account has no role in this app (or the wrong one).
 * Like AuthRequiredError, retrying will not help until an administrator grants a role,
 * so sync pauses instead of backing off. Extends HttpError so per-request handling of
 * a 403 (for example a refused photo) is unchanged.
 */
export class ForbiddenError extends HttpError {
  constructor() {
    super(403);
    this.name = 'ForbiddenError';
  }
}

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;

/**
 * Registered by the React layer once Clerk has loaded. Until then, sync reports
 * "Sign in to sync" and the field app keeps working from the device database.
 */
export function setTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

/** True when a token provider is registered (Clerk loaded with a session). */
export function hasTokenProvider(): boolean {
  return tokenProvider !== null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Applies the demo chaos settings to a request about to be made; throws NetworkError when
 * the request is "dropped" or the device is forced offline. Every request from the sync
 * engine and the photo queue passes through here.
 */
export async function throughChaos(): Promise<void> {
  const settings = getDemoSettings();
  if (settings.latencyMs > 0) await sleep(settings.latencyMs);
  if (settings.forceOffline) throw new NetworkError('Offline (forced by the demo panel)');
  if (settings.dropRate > 0 && Math.random() < settings.dropRate) {
    throw new NetworkError('Request dropped (demo panel)');
  }
}

/**
 * Fetches an app endpoint with the session token. Resolves only for 2xx responses.
 * Throws AuthRequiredError, NetworkError or HttpError.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  await throughChaos();
  const token = tokenProvider ? await tokenProvider().catch(() => null) : null;
  if (!token) throw new AuthRequiredError();

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, cache: 'no-store' });
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : undefined);
  }
  if (response.status === 401) throw new AuthRequiredError();
  if (response.status === 403) throw new ForbiddenError();
  if (!response.ok) throw new HttpError(response.status);
  return response;
}
