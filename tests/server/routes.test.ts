import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedTemplates } from '@/server/seed/seed';
import { createMutation } from './helpers/mutations';
import { createTestDatabase, type TestDatabase } from './helpers/pglite';

/**
 * Route handlers with Clerk's auth() mocked: the role and user id always come from the
 * session claims, never from the request.
 */
const session = vi.hoisted(() => ({
  current: null as null | { userId: string; sessionClaims: unknown },
}));
const database = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => session.current ?? { userId: null, sessionClaims: null },
}));
vi.mock('@/server/db/client', () => ({ getDb: () => database.current }));

const { POST: push } = await import('@/app/api/sync/push/route');
const { GET: pull } = await import('@/app/api/sync/pull/route');

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedTemplates(t.db);
  database.current = t.db;
});

afterAll(async () => {
  await t.client.close();
});

beforeEach(() => {
  session.current = null;
});

const signIn = (userId: string, role: unknown) => {
  session.current = { userId, sessionClaims: { sub: userId, metadata: { role } } };
};

const pushRequest = (body: unknown) =>
  new Request('http://localhost/api/sync/push', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/sync/push', () => {
  it('401 without a session', async () => {
    const response = await push(pushRequest({ deviceId: 'd', mutations: [] }));
    expect(response.status).toBe(401);
  });

  it('403 for a user without a role', async () => {
    signIn('user_x', undefined);
    expect((await push(pushRequest({ deviceId: 'd', mutations: [{}] }))).status).toBe(403);
  });

  it('400 for a malformed envelope or more than 100 mutations', async () => {
    signIn('user_inspector', 'inspector');
    expect((await push(pushRequest('not json'))).status).toBe(400);
    expect((await push(pushRequest({ deviceId: 'd', mutations: [] }))).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, () => ({}));
    expect((await push(pushRequest({ deviceId: 'd', mutations: tooMany }))).status).toBe(400);
  });

  it('applies mutations as the session user and reports server time', async () => {
    signIn('user_inspector', 'inspector');
    const create = createMutation('user_inspector');
    const response = await push(pushRequest({ deviceId: 'device-a', mutations: [create] }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { results: unknown[]; serverTime: string };
    expect(body.results).toEqual([{ mutationId: create.mutationId, status: 'accepted' }]);
    expect(Date.parse(body.serverTime)).not.toBeNaN();
  });

  it('a role claimed in the request body is ignored', async () => {
    signIn('user_super', 'supervisor');
    const create = { ...createMutation('user_super'), role: 'inspector' };
    const response = await push(pushRequest({ deviceId: 'd', mutations: [create] }));
    const body = (await response.json()) as { results: { reason?: string }[] };
    // The extra key makes the mutation invalid; without it, the supervisor is forbidden.
    expect(body.results[0]?.reason).toBe('invalid_payload');
    const { role: _role, ...clean } = create;
    const again = await push(
      pushRequest({
        deviceId: 'd',
        mutations: [{ ...clean, mutationId: createMutation('x').mutationId }],
      }),
    );
    expect(((await again.json()) as { results: { reason?: string }[] }).results[0]?.reason).toBe(
      'forbidden',
    );
  });
});

describe('GET /api/sync/pull', () => {
  it('401 without a session', async () => {
    expect((await pull(new Request('http://localhost/api/sync/pull'))).status).toBe(401);
  });

  it('400 for a bad cursor', async () => {
    signIn('user_inspector', 'inspector');
    expect((await pull(new Request('http://localhost/api/sync/pull?cursor=-1'))).status).toBe(400);
  });

  it('returns templates to a signed-in inspector', async () => {
    signIn('user_inspector', 'inspector');
    const response = await pull(new Request('http://localhost/api/sync/pull?cursor=0&limit=500'));
    const body = (await response.json()) as { changes: { templates: unknown[] } };
    expect(body.changes.templates).toHaveLength(3);
  });
});
