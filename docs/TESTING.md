# Testing

The tests are part of the portfolio. The aim is that a reviewer can read them to learn what the
system guarantees, then run them to see it hold.

## Layers

| Layer    | Tool                                   | Location         | Command              |
| -------- | -------------------------------------- | ---------------- | -------------------- |
| Unit     | Vitest (+ `fake-indexeddb` from M1)    | `tests/unit`     | `pnpm test:unit`     |
| Property | Vitest + fast-check                    | `tests/property` | `pnpm test:property` |
| Server   | Vitest + PGlite running the migrations | `tests/server`   | `pnpm test:server`   |
| E2E      | Playwright + `@clerk/testing`          | `tests/e2e`      | `pnpm test:e2e`      |

`pnpm test` runs unit, property and server tests together; `pnpm test:coverage` adds a coverage
report in `coverage/`. CI requires at least 90% line coverage on `lib/sync` and
`lib/answers`.

### Server tests

`tests/server/helpers/pglite.ts` starts an in-memory Postgres (PGlite) and applies the committed
Drizzle migrations from `server/db/migrations`, so server tests run against exactly the schema
production gets. No database server or `DATABASE_URL` is needed.

### End-to-end tests

Playwright runs against a production build (`next build` + `next start` on port 3100) in Chromium
and WebKit, so the prerendered `/field` page (and, from M1, the service worker) behave as in
production. Locally, `pnpm test:e2e` builds first and reuses a server already running on that port.

The app needs real Clerk keys to serve any page that passes through `proxy.ts`, so E2E tests need
`.env.local` with `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Tests that create
data also need `E2E_DATABASE_URL`, a throwaway Postgres that global setup migrates, seeds and
empties on every run:

```bash
docker run -d --name fi-e2e-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=field_e2e -p 5433:5432 postgres:17-alpine
```

Sign-in tests also
need `E2E_INSPECTOR_EMAIL` and `E2E_SUPERVISOR_EMAIL` (see README, "Test users"); they are skipped
when those are missing. Playwright signs users in with Clerk testing tokens, so no passwords are
stored anywhere.

First run only:

```bash
pnpm exec playwright install chromium webkit
```

On failure, traces and screenshots are kept in `test-results/`; open one with
`pnpm exec playwright show-trace <path-to-trace.zip>`. CI uploads them as an artifact.

## What exists today

| Test                              | What it shows                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `unit/schemas.test.ts`            | Template, inspection and answer schemas accept and reject what they should.                    |
| `unit/roles.test.ts`              | Roles are read only from `metadata.role` in the session claims.                                |
| `unit/proxy-matcher.test.ts`      | Clerk runs on `/dashboard` and `/api`, and never on `/field` or static files.                  |
| `property/roles.property.test.ts` | For any input, no value other than the two roles is ever granted a role.                       |
| `server/migrations.test.ts`       | The migration creates every table; one sequence orders all synced tables.                      |
| `e2e/smoke.spec.ts`               | `/field` is served from its static shell with no redirect; disclaimer shown.                   |
| `e2e/auth.spec.ts`                | Both test users sign in; only the supervisor reaches the dashboard.                            |
| `unit/hlc.test.ts`                | The clock never goes backwards, absorbs remote clocks, survives 2 h of skew.                   |
| `unit/reduce.test.ts`             | The latest event wins; `cleared` removes the answer; conflicts are flagged.                    |
| `unit/evaluate.test.ts`           | Fails, out-of-range readings, critical items and submit rules.                                 |
| `unit/field-actions.test.ts`      | Each write lands with its outbox entry; critical fails flag at once.                           |
| `unit/pull-apply.test.ts`         | A pull page applies atomically, twice without change, and respects local work.                 |
| `unit/dexie-migrations.test.ts`   | Schema version 1 has every table and index; data survives reopening.                           |
| `unit/compress.test.ts`           | Resizing maths and the EXIF detector used by the browser test.                                 |
| `unit/seed-templates.test.ts`     | The demo checklists are valid and match the brief (10–15 items, 2–3 critical).                 |
| `server/pull.test.ts`             | Pull pages by `server_seq` without gaps or repeats, scoped to the caller.                      |
| `e2e/offline.spec.ts`             | E2E 1: complete and submit an inspection offline, reload, keep it, then sync it to the server. |
| `unit/outbox.test.ts`             | Every outbox transition, including a network error while sending, and backoff timing.          |
| `unit/engine.test.ts`             | Sync triggers (start, online, visible, debounce, interval), backoff, pause, Web Locks.         |
| `unit/api.test.ts`                | The fetch wrapper: token, status mapping, and every chaos setting.                             |
| `server/push.test.ts`             | Accepted, duplicate, each rejection reason, savepoints, corrective actions created once.       |
| `server/routes.test.ts`           | Route handlers with Clerk mocked: 401, 403, 400, and identity from the session only.           |
| `server/sync-roundtrip.test.ts`   | Two devices and the server, end to end in Node (see below).                                    |

Build-time checks complement the tests: `ensureStatic = 'navigation'` on `/field` and
`scripts/check-static-routes.mjs` (run as `postbuild`) both fail the build if `/field` stops being
fully static.

## Property tests

Property tests state a rule and let fast-check search for a counterexample among many generated
inputs. When one fails, fast-check shrinks it to a minimal case and prints the seed to replay it.

| Property                                                                                                                                                | Milestone |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Role parsing never grants a role outside `inspector` / `supervisor`                                                                                     | M0        |
| Any order of the same set of events gives the same current answers, and two devices that exchange events in different orders (with re-deliveries) agree | M2        |
| Applying the same pull page twice leaves the device database unchanged                                                                                  | M2        |
| Processing the same push batch twice leaves Postgres unchanged, and reports the same outcome per mutation                                               | M2        |

Each property was checked against a deliberately broken implementation: for example, making the
reducer pick the last event _received_ instead of the highest clock makes the convergence property
fail within two runs, with a two-event counterexample.

## The device ↔ server round trip

`tests/server/sync-roundtrip.test.ts` runs two simulated devices, each with its own Dexie database
(fake-indexeddb) and its own real `SyncEngine`, against the real push and pull code on PGlite,
through a fake network that can be switched off. It covers the demo story without a browser:
offline work syncing when the network returns, two devices answering the same item offline and
converging with the conflict flagged on both, answers rejected after a supervisor cancels, a
submission reaching the server, and sync pausing without a session.
