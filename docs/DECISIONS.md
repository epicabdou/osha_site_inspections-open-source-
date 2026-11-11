# Decisions

One short record per decision: the context, what we chose, and what follows from it.
Records are never deleted; a reversed decision gets a new record that supersedes it.

| #   | Decision                                                                      | Status            |
| --- | ----------------------------------------------------------------------------- | ----------------- |
| 1   | [Dexie on IndexedDB, not SQLite in WebAssembly](#1-dexie-on-indexeddb)        | Accepted (M1)     |
| 2   | [Hand-written sync, not a sync product](#2-hand-written-sync)                 | Accepted (M2)     |
| 3   | [Route handlers, not Server Actions, for field writes](#3-route-handlers)     | Accepted (M2)     |
| 4   | [One static /field route with search-param navigation](#4-one-static-field)   | Implemented (M0)  |
| 5   | [Answers as events, not updated rows](#5-answers-as-events)                   | Implemented (M0)  |
| 6   | [Vercel Blob client uploads with an explicit confirm call](#6-blob-uploads)   | Accepted (M3)     |
| 7   | [An advisory lock keeps the pull cursor safe](#7-advisory-lock)               | Schema ready (M0) |
| 8   | [Single tenant, two roles](#8-single-tenant-two-roles)                        | Implemented (M0)  |
| 9   | [Package versions that differ from the brief](#9-versions)                    | Implemented (M0)  |
| 10  | [Cache Components and `ensureStatic`](#10-cache-components)                   | Implemented (M0)  |
| 11  | [node-postgres as the Postgres driver](#11-node-postgres)                     | Implemented (M0)  |
| 12  | [Every synced table carries `server_seq`, templates included](#12-server-seq) | Implemented (M0)  |
| 13  | [Clerk does not run on /field at all](#13-proxy-skips-field)                  | Implemented (M0)  |
| 14  | [Tooling details](#14-tooling)                                                | Implemented (M0)  |
| 15  | [Hosting setup: migrations run in the Vercel build](#15-hosting-setup)        | Implemented (M0)  |
| 16  | [Serwist in configurator mode, run after `next build`](#16-serwist)           | Implemented (M1)  |
| 17  | [Photo bytes stored as ArrayBuffer, not Blob](#17-photo-bytes)                | Implemented (M1)  |
| 18  | [Device-side details: extra table, sync states, clock format](#18-device)     | Implemented (M1)  |
| 19  | [Libraries added in M1](#19-m1-libraries)                                     | Implemented (M1)  |
| 20  | [A throwaway Postgres for end-to-end tests](#20-e2e-database)                 | Implemented (M1)  |

---

## 1. Dexie on IndexedDB

**Context.** The inspector's data must live on the device, survive reloads and restarts, and be
queryable by inspection and item. Options: IndexedDB (via Dexie) or SQLite compiled to WebAssembly
on top of OPFS.

**Decision.** Dexie 4 on IndexedDB.

**Consequences.** IndexedDB works in every target browser, including iOS Safari in and out of
standalone mode, with no WASM download on a cold, offline start. Dexie gives transactions, compound
indexes and `useLiveQuery` for React. Queries are simpler than SQL, which suits an event log keyed
by inspection and item. Tests run against `fake-indexeddb`. We give up SQL joins on the device,
which the field app does not need.

## 2. Hand-written sync

**Context.** Dexie Cloud, ElectricSQL, PowerSync and Zero all sync a local store with a server.

**Decision.** Write the sync protocol by hand: an outbox of mutations, an idempotent push, a
cursor-based pull, and a hybrid logical clock.

**Consequences.** The point of this project is to show how sync works, so the moving parts must be
visible, small and tested; a product would hide exactly the part reviewers want to read. We own the
correctness, which is why the property tests exist. There is no vendor lock-in and no extra paid
service. A real product with many entity types might reasonably choose a library instead.

## 3. Route handlers

**Context.** Next.js offers Server Actions for writes. The field app must queue writes while
offline and send them later, possibly after the app restarts.

**Decision.** Field writes go through `POST /api/sync/push` (a route handler). Server Actions are
used only in the online-only dashboard.

**Consequences.** The Dexie outbox survives restarts; a pending Server Action does not, and it is
bound to the build that rendered the page. A versioned JSON contract validated by Zod on both sides
is easier to test and to retry idempotently. Nothing in /field depends on the server rendering.

## 4. One static /field

**Context.** Inspections are created offline and get their id on the device. A route like
`/inspections/<id>` would have no cached HTML for an id the server has never seen, so reloading it
offline would fail.

**Decision.** The whole field app is one prerendered page, `/field`. Views are search params
(`/field?view=inspection&id=<uuid>&section=<id>`) changed with `history.pushState` /
`replaceState`, which Next.js syncs with `useSearchParams` without a request. The service worker
answers every `/field` navigation with the cached page.

**Consequences.** Any URL inside the field app reloads offline. The page's server component may not
read `cookies()`, `headers()`, `auth()` or `searchParams`; this is enforced by
`export const ensureStatic = 'navigation'` (record 10) and by `scripts/check-static-routes.mjs`
after every build. Deep links are search-param URLs rather than path segments.

## 5. Answers as events

**Context.** Two devices can answer the same item, and a safety record needs a full history.

**Decision.** Every answer is an immutable `answer_events` row. An item's current value is the
event with the highest `(hlc, deviceId)`, computed by one pure function (`lib/answers/reduce.ts`,
M1) used by the field app, the dashboard and the tests.

**Consequences.** Merging two devices is a set union, so it converges regardless of arrival order
(proved by a property test in M2). The audit trail is free. Removing an answer is itself an event
(`{ kind: 'cleared' }`). Storage grows with every tap, which is negligible at inspection scale.

## 6. Blob uploads

**Context.** Photos are large and arrive long after the answer that references them. Vercel
functions have request-body limits, and Blob's upload-completed webhook cannot reach a local dev
server.

**Decision.** The device uploads straight to Vercel Blob with a client-upload token from
`POST /api/photos/upload`, at a path derived from the photo's hash, then calls
`POST /api/photos/confirm` to record it.

**Consequences.** Photo bytes never pass through a function. Hash-derived paths make retries
idempotent ("already exists" counts as success). The explicit confirm works identically in local
development and production. A photo uploaded but never confirmed is retried by the device's queue.

## 7. Advisory lock

**Context.** Pull returns rows with `server_seq > cursor`. Sequence values are assigned when a row
is written but become visible when the transaction commits, so a transaction holding a lower value
can commit after one holding a higher value. A client that pulled in between would advance its
cursor past the late row and never see it.

**Decision.** Every transaction that assigns `server_seq` first takes
`pg_advisory_xact_lock(SERVER_SEQ_LOCK_KEY)` (defined in `server/db/schema.ts`), so assignment and
commit happen one transaction at a time.

**Consequences.** Pull can never skip a row. Writes that assign `server_seq` are serialised, which
caps write throughput; at demo scale this costs nothing measurable. Transaction-scoped advisory
locks also work behind Neon's transaction-mode connection pooler. The full trade-off and the
alternatives (commit-time logical clocks, `pg_current_snapshot()` horizons) are in `docs/SYNC.md`
(M2).

## 8. Single tenant, two roles

**Context.** The demo needs an inspector and a supervisor, nothing more.

**Decision.** One tenant. The role is Clerk `publicMetadata.role` (`inspector` or `supervisor`),
exposed in the session token by customising it to `{ "metadata": "{{user.public_metadata}}" }`,
which is Clerk's documented pattern for role-based access with metadata. The server reads it from
the verified token (`roleFromClaims` in `lib/auth/roles.ts`); a role sent by the client is never
used.

**Consequences.** No organisations, invitations or per-tenant data. Changing a user's role takes
effect when their session token refreshes (about a minute). Anything without a valid role gets no
access.

## 9. Versions

**Context.** The brief names Next.js 16, React 19.2, Node 22 LTS, and says to install current
stable versions. Checked on 2026-11-11.

**Decision.**

| Package              | Brief         | Installed | Why                                                                                                     |
| -------------------- | ------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `react`, `react-dom` | 19.2          | 19.3.1    | Current stable; supported by Next 16.4 and by `@clerk/nextjs` 7 (`~19.3.0-0`).                          |
| `typescript`         | (unspecified) | 6.0.3     | 7.0 (the native compiler) is `latest`, but `typescript-eslint` supports `<6.1.0`. Revisit when it does. |
| `eslint`             | (unspecified) | 9.39      | 10 is out, but `eslint-plugin-react` (used by `eslint-config-next`) supports only `^9.7`.               |
| `next`               | 16            | 16.4.6    | Current stable. Ships its docs in `node_modules/next/dist/docs`, which this project follows.            |
| Node                 | 22 LTS        | 22.x      | Kept as briefed. `engines` is `>=22.12.0 <23` because Vitest 5 needs 22.12+.                            |
| `@clerk/nextjs`      | (unspecified) | 7.9       | Clerk "Core 3": `<Show>` replaces `<SignedIn>`/`<SignedOut>`; `clerkMiddleware()` unchanged.            |

**Consequences.** Upgrading TypeScript to 7 and ESLint to 10 are tracked follow-ups.

## 10. Cache Components

**Context.** `create-next-app` 16.4 enables `cacheComponents` and `partialPrefetching` by default.
With Cache Components, Next.js 16.4 adds the `ensureStatic` route segment config: with
`'navigation'`, `next build` fails if any part of the route needs request-time rendering.

**Decision.** Keep both defaults and export `ensureStatic = 'navigation'` from `app/field/page.tsx`.

**Consequences.** The offline guarantee for `/field` is enforced by the framework at build time,
not by convention; a second check reads the build output (`pnpm build` runs it as `postbuild`).
Elsewhere, anything that reads the session (`auth()`) must sit inside `<Suspense>`, which is why the
dashboard renders a static heading and streams its content. The optional `experimental.useOffline`
hook is not adopted: the field app does not use Server Actions or RSC fetches, and connectivity is
derived from the sync engine's own requests (M2).

## 11. node-postgres

**Context.** Push processes each mutation in its own savepoint inside one transaction and takes an
advisory lock. Neon's HTTP driver does not support interactive transactions.

**Decision.** `pg` (node-postgres) with Drizzle's `node-postgres` adapter, using Neon's pooled
connection string. Server tests use PGlite with the same committed migrations.

**Consequences.** Full transaction support, and the same driver works against a local Postgres.
Added `pg` and `@types/pg` (not in the original stack table). The pool is small (`max: 5`) and
created lazily, so `next build` never needs `DATABASE_URL`.

## 12. Server seq

**Context.** The brief's table list gives `server_seq` to inspections, answer events and corrective
actions, and also says pull returns templates by cursor.

**Decision.** `templates` gets a `server_seq` column too. Photos and the idempotency ledger do not:
they are never pulled.

**Consequences.** One cursor covers everything a device pulls.

## 13. Proxy skips /field

**Context.** The brief says to leave `/field` public. Clerk's middleware can also redirect a page
request to refresh the session (the "handshake"), and the service worker fetches `/field` to
precache it.

**Decision.** The `proxy.ts` matcher excludes `/field` entirely (and static files). A unit test
pins the matcher (`tests/unit/proxy-matcher.test.ts`).

**Consequences.** The worker can never precache a redirect. Nothing is lost: `/field` reads no
session on the server; the browser SDK and `/api/*` handle auth.

## 14. Tooling

- **`@next/env`** (part of Next.js) loads `.env*` files for `drizzle.config.ts` and
  `playwright.config.ts` exactly as Next does.
- **`drizzle-kit` runs with `node --conditions=react-server`**, so `server/` modules can import
  `'server-only'` (which throws outside a server bundle) and drizzle-kit can still load the schema.
  Vitest aliases `server-only` and `client-only` to an empty module for the same reason.
- **No `"type": "module"`** in `package.json`, matching `create-next-app`; Playwright and
  drizzle-kit load the TypeScript configs as CommonJS, where `@next/env`'s named exports resolve.
- **CI builds forks with a placeholder Clerk publishable key.** Building needs only the key's
  format; the end-to-end job, which needs real keys and test users, runs only for branches of
  this repository.
- **`E2E_INSPECTOR_EMAIL` and `E2E_SUPERVISOR_EMAIL`** are test-only variables, documented in
  `.env.example`. Playwright signs users in with Clerk testing tokens, so no passwords are stored.
- **Postgres enums** for `inspection_status` and `corrective_action_status`, mirroring the Zod enums.

## 15. Hosting setup

**Context.** The demo runs on Vercel with Neon from the Vercel Marketplace. Preview deployments
may get their own Neon branch, and every environment must have the committed schema before new
code serves requests.

**Decision.**

- `vercel.json` sets the build command to `pnpm db:migrate && pnpm build`. Migrations are
  idempotent (drizzle-kit records applied ones), so each deployment brings its database up to
  date, then builds. A failed migration fails the deployment instead of serving code against the
  wrong schema.
- `pnpm db:migrate` prefers `DATABASE_URL_UNPOOLED` (a direct connection) for DDL; the app uses the
  pooled `DATABASE_URL`.
- Neon: free plan, region `iad1` (next to Vercel's default function region), Neon Auth off (Clerk
  handles identity, and a second user store would collect personal data for nothing).
- The Vercel Blob store is created in M3, when photo access (public or private) is decided with the
  upload code in front of us.

**Consequences.** Schema changes ship with the code that needs them. Migrations must stay
backward-compatible with the previous deployment while it drains (add columns before using them;
remove them a release later).

## 16. Serwist

**Context.** The brief asks for `@serwist/next` "with its post-build step, so it can precache
prerendered routes", or `@serwist/turbopack` when building with Turbopack. Next 16 builds with
Turbopack, and `@serwist/turbopack`'s route handler declares segment config that Cache Components
(record 10) does not allow; its own source says it is for apps without Cache Components.

**Decision.** `@serwist/next` in configurator mode: `pnpm build` runs
`next build && serwist build serwist.config.mjs`, which bundles `app/sw.ts` with esbuild into
`public/sw.js` and injects the precache manifest from the build output. Prerendered HTML is not
globbed (`precachePrerendered: false`), because that would also precache the `/dashboard` shell;
`/field` is precached by URL with the build id as its revision. Verified on a Vercel preview: the
file written after `next build` is deployed, and its manifest matches Vercel's
`/_next/static/immutable/` asset paths.

**Consequences.** One worker, built from source we can read. The worker never activates itself
(`skipWaiting: false`); the page reloads only after the user taps "Update". `/api/*` and
`/dashboard*` are network-only.

## 17. Photo bytes

**Context.** The brief's Dexie `photos` row holds a `blob`. The WebKit build used by Playwright
fails to store a `Blob` in IndexedDB (the transaction aborts), while every engine stores
`ArrayBuffer`s.

**Decision.** `photos.data` holds the compressed JPEG as an `ArrayBuffer`, with `mime` beside it.
A `Blob` is rebuilt for display and upload.

**Consequences.** Identical behaviour in Chromium, Firefox and WebKit, at the cost of one copy when
reading a photo.

## 18. Device

- **`correctiveActions` table.** Pull returns corrective actions on the inspector's inspections;
  the brief's Dexie schema has no table for them, so version 1 adds
  `correctiveActions: 'id, inspectionId'`.
- **Answer `syncState`.** `local`: saved on the device, not yet handed to the server. `queued`:
  in a push request, or waiting to retry one. `synced`: the server accepted it (or already had
  it). `rejected`: the server refused it; the reason is kept and the event never becomes the
  current value.
- **HLC format.** `<wallMs, 15 digits>-<counter, 5 digits>-<deviceId>`, so plain string order is
  clock order. The shared schema checks that the clock ends with the event's `deviceId`.
- **The critical flag is sticky.** `hasCriticalFailure` is set by the first critical fail and never
  cleared by a later pass, matching the server's rule that only a supervisor closes the corrective
  action. The banner shows the items whose current answer still fails.

## 19. M1 libraries

All within the brief's stack or its direct tooling: `dexie`, `dexie-react-hooks`,
`fake-indexeddb`; `serwist`, `@serwist/next`, `@serwist/cli`, and `esbuild` (which the Serwist
CLI uses, and which also bundles the seed script so it can resolve `@/` imports);
`@radix-ui/react-dialog` and `@radix-ui/react-toast`; `uuid` for UUIDv7 (the brief's id format,
which the platform has no built-in generator for).

## 20. E2E database

**Context.** End-to-end tests create inspections and, from M2, push them. They must never write
to the demo's Neon database.

**Decision.** Playwright starts the app with `DATABASE_URL` set to `E2E_DATABASE_URL`: a Docker
container locally and a `postgres:17` service container in CI. Global setup applies the
migrations, seeds the templates and truncates the data tables on every run.

**Consequences.** Tests are repeatable and isolated. Running them locally needs Docker (or any
Postgres you are happy to empty).

## 21. Push

**Context.** The brief fixes the contract (savepoint per mutation, a ledger, `accepted` /
`duplicate` / `rejected`) but leaves some edges open.

**Decision.**

- A batch is one transaction holding the `server_seq` advisory lock (record 7), with a savepoint
  per mutation. At most 100 mutations keeps the lock short.
- A previously accepted mutation answers `duplicate`; a previously rejected one answers with its
  stored rejection, so a retry never turns a refusal into something else.
- A malformed entry with a valid UUIDv7 `mutationId` is recorded as `invalid_payload`; one without a
  usable id is reported but cannot be recorded.
- The device treats an omitted result as a temporary server error (HTTP 502 in the engine):
  the entry returns to the queue and the engine backs off.

**Consequences.** Retries are always safe and always report the same outcome, which the
push-idempotency property test checks on random batches.

## 22. Photo storage

**Context.** Site photos can show people, plates and premises. Record 6 fixed the shape (client
upload with a token, then an explicit confirm); the store's access level and failure handling were
open.

**Decision.**

- The Blob store is **private** (`field-inspections-photos`, `iad1`). The dashboard and the field
  app load photos through `GET /api/photos/<hash>`, which checks the viewer is the inspection's
  inspector or a supervisor.
- A client token allows exactly one pathname, JPEG only, at most 5 MB, for 10 minutes, with no
  overwrite and no random suffix, so the path is a pure function of the hash.
- Confirm trusts storage, not the client: it reads the object's metadata with `head()` before
  recording the row.
- The queue retries network and 5xx failures (and storage's own temporary errors) with the sync
  backoff; a 4xx refusal marks the photo `rejected` and keeps it on the device.
- End-to-end tests upload to the same store; global setup deletes the photos of the previous run
  before emptying the test database.

**Consequences.** No public URL ever exists for a photo. Photo views cost a function invocation,
acceptable for a dashboard.
