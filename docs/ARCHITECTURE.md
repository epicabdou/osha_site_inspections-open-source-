# Architecture

Field Inspections is split into three areas with different rules. The inspector's app must open
and work with no network; the supervisor's dashboard assumes one.

| Area         | Purpose                | Rendering                                                  | Works offline |
| ------------ | ---------------------- | ---------------------------------------------------------- | ------------- |
| `/field`     | Inspector's app        | One statically prerendered page; all data from Dexie       | Yes           |
| `/dashboard` | Supervisor's view      | Server Components and Server Actions, supervisor role only | No            |
| `/api/*`     | Sync and photo uploads | Route handlers, authenticated, idempotent                  | n/a           |

```mermaid
flowchart LR
  subgraph Device["Inspector's device (works offline)"]
    UI["/field<br/>FieldApp (React)"] --> Dexie[(Dexie / IndexedDB<br/>events, outbox, photos)]
    Engine["Sync engine<br/>lib/sync"] --> Dexie
    Queue["Photo upload queue<br/>lib/photos"] --> Dexie
    SW["Service worker<br/>precaches /field"]
  end
  subgraph Server["Vercel"]
    Push["POST /api/sync/push"]
    Pull["GET /api/sync/pull"]
    Photos["POST /api/photos/upload, /confirm"]
    Dash["/dashboard<br/>Server Components"]
  end
  PG[(Postgres / Neon)]
  Blob[(Vercel Blob)]

  Engine -- "mutations" --> Push
  Pull -- "changes since cursor" --> Engine
  Queue -- "token, confirm" --> Photos
  Queue -- "photo bytes" --> Blob
  Push --> PG
  Pull --> PG
  Photos --> PG
  Dash --> PG
```

Only the arrows between the device and the server need a connection. Everything inside the device
box works with none.

## Status

| Piece                                 | Milestone | State       |
| ------------------------------------- | --------- | ----------- |
| Static `/field` shell, `ensureStatic` | M0        | Done        |
| Clerk, `proxy.ts`, role checks        | M0        | Done        |
| Postgres schema and first migration   | M0        | Done        |
| Dexie, inspections, answers, Serwist  | M1        | Done        |
| Outbox, push, pull, HLC               | M2        | Not started |
| Photos                                | M3        | Not started |
| Dashboard                             | M4        | Not started |

## Why /field is one static route

An inspection created offline gets its id on the device. The server has never rendered
`/inspections/<that-id>`, so reloading that URL offline would have nothing cached to show. Instead
the whole field app lives on `/field`:

- Views are search params: `/field?view=inspection&id=<uuid>&section=<sectionId>`.
- They change with `window.history.pushState` / `replaceState`. Next.js syncs these with
  `useSearchParams`, and no request leaves the device.
- The page's server component reads no `cookies()`, `headers()`, `auth()` or `searchParams`. It
  renders `<FieldApp />` inside `<Suspense>`; `useSearchParams` makes that subtree render in the
  browser, so the prerendered HTML is identical for every `/field` URL.

**How it is enforced.** `app/field/page.tsx` exports `ensureStatic = 'navigation'`, so `next build`
fails if the route ever needs request-time rendering (see `docs/DECISIONS.md` #10). After the build,
`scripts/check-static-routes.mjs` independently checks the build output: `/field` must be in the
prerender manifest with `compute: "static"`, no revalidation, and a prerendered HTML file. CI runs
both on every pull request.

## Auth boundaries

- `proxy.ts` runs `clerkMiddleware()`. `/dashboard*` requires a signed-in supervisor (others go to
  sign-in or `/forbidden`). `/api/*` requires a signed-in user and answers `401` JSON otherwise.
- `/field` is not matched by the proxy at all, so neither auth nor Clerk's session handshake can
  ever redirect it. The service worker will precache it, and a precached redirect would break the
  offline app. A unit test pins the matcher.
- Every route handler and Server Action calls `auth()` itself and reads the role from the verified
  session claims (`server/auth.ts`). The proxy is the outer fence, not the only one.
- The field app runs from `meta.lastUser` on the device whether or not Clerk's browser script has
  loaded (M1). Only sync needs a live session.

## Code boundaries

| Path          | Runs on        | May import                    | Must not import        |
| ------------- | -------------- | ----------------------------- | ---------------------- |
| `lib/schemas` | Both           | `zod`                         | `server/`, `lib/db.ts` |
| `lib/db.ts`   | Device only    | Dexie, `client-only`          | `server/`              |
| `lib/*` other | Device or both | `lib/schemas`                 | `server/`              |
| `server/`     | Server only    | `server-only`, Drizzle, `lib` | `lib/db.ts`, Dexie     |
| `components/` | Device         | `lib/`                        | `server/`              |

The `server-only` and `client-only` packages make a wrong import fail the build; ESLint
`no-restricted-imports` rules in `eslint.config.mjs` catch it earlier, in the editor.

## Service worker strategy

`app/sw.ts`, bundled by `serwist build` after `next build` (see `docs/DECISIONS.md` #16):

- Precache the build assets and the `/field` page (by URL, revisioned with the build id).
- Answer every navigation to `/field`, with any search params, with the cached `/field` page.
- Network-only for `/api/*` and `/dashboard*`; never cache their responses.
- Stale-while-revalidate for Clerk's browser script; the app must work if it fails to load.
- Registered from a client component (`components/ui/service-worker.tsx`) with
  `updateViaCache: 'none'`. When a new version is waiting, an "Update available" toast appears; the
  new worker activates only when the user taps "Update", never on its own, so an open inspection is
  never swapped out.

## The field app on the device

- **Data.** `lib/db.ts` (Dexie): templates, inspections, answer events, the outbox, photos,
  corrective actions and `meta` (device id, last user, pull cursor, HLC, demo settings).
- **Writes.** `lib/field/actions.ts` (`createInspection`, `recordAnswer`, `submitInspection`) and
  `lib/field/photos.ts`. Each writes its data and its outbox entry in one Dexie transaction.
  Photos are compressed and hashed before the transaction opens.
- **Reads.** Components use `useLiveQuery`; the current value of every item comes from
  `lib/answers/reduce.ts`, failures and submit checks from `lib/answers/evaluate.ts`.
- **Who is signed in.** `components/field/clerk-bridge.tsx` saves `{ userId, displayName, role }`
  to `meta.lastUser` after a sign-in and hands the sync engine a token provider. The app runs from
  `lastUser` whether or not Clerk loaded. A different user signing in while another user's work is
  unsynced is blocked until that work is exported or deliberately deleted; sign-out with unsynced
  work asks first, then deletes the device database.
- **Navigation.** `lib/field/navigation.ts`: `?view=home|new|inspection|settings`, `id`,
  `section`.

## Repository layout

```
app/
  field/page.tsx            static shell, renders <FieldApp />
  dashboard/                Server Components (+ Server Actions from M4)
  sign-in/                  Clerk <SignIn />
  forbidden/                shown to signed-in users without the supervisor role
  layout.tsx                ClerkProvider (static), disclaimer footer
proxy.ts                    clerkMiddleware()
components/field/  components/dashboard/  components/ui/
lib/
  auth/roles.ts             role parsing from session claims (shared)
  schemas/                  Zod schemas shared by device and server
server/                     every module imports 'server-only'
  auth.ts                   session user and role checks
  db/schema.ts              Drizzle schema
  db/migrations/            committed drizzle-kit migrations
  db/client.ts              lazy node-postgres pool
scripts/check-static-routes.mjs
tests/  unit/  property/  server/  e2e/
docs/
```
