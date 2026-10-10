---
title: "Anti-corruption layer: the Supabase client SDK"
created: 2026-10-10
type: refactor-plan
---

# Anti-corruption layer: the Supabase client SDK

This is a plan, not code. It follows the module 4 prompt `m4l5-3-anti-corruption-layer` step by step: discovery, identification, classification, diagnosis, design. It uses the terms of `context/domain/glossary.md`: a **watched product** with its **own shop** and one **decision** per matched shop, the **price observations** a **shop item**'s **watchers** share, the **shop gate** and its **request cap**, and **unread** for an answer that can't be read.

- **Code.** Every `path:line` points into this worktree's HEAD, 5eefce2 (`origin/main`). A citation marked "S-01 branch" points to `refactor/decision-route-guardian` at 3df527b, M-2's first slice, which is pushed and not merged.
- **Library.** Facts about the SDK come from the installed packages' source and doc comments under `node_modules/`: `@supabase/supabase-js`, `@supabase/postgrest-js` and `@supabase/auth-js` 2.116.0, and `@supabase/ssr` 0.12.7. Nothing was fetched from the web, and nothing ran against Supabase or a shop.
- **Counts** come from `git grep` and ast-grep 0.50 over `src/`. Every zero was confirmed with grep.

## In short

- **The leak:** the Supabase client SDK, `@supabase/supabase-js` with `@supabase/ssr`. The middleware builds one client per request, and that client crosses five layers. 25 app files know the client or the SDK's types, and 12 test-side files imitate it or type it.
- **The port:** `Backend` in `src/lib/services/backend.ts`. It has five narrow parts, `watchlist`, `decisions`, `priceObservations`, `counter` and `session`, whose operations are today's functions without the client parameter.
- **The adapter:** `src/lib/supabase/`, the only directory that names the SDK. Its `records.ts` holds the value objects (`StoredDecision` and its siblings), the only code that knows a table, a column or a row. `database.ts` and `session.ts` are the only code that reads the SDK's answers.
- **The plan:** five phases. The port comes first, then its consumers, then the SDK's code moves behind it, and finally a lint rule keeps it there.
- **The main risk:** M-2's open slices S-02 and S-03 rewrite the same decision code, so the order is the owner's call (Open question 1).

## Step 0: Context

### What the documents declare

| what                  | declaration                                                                                                                                                                                                                                                                                             | kept in the code?                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| the shops' APIs       | "One adapter per shop behind a common interface, each with a health check on a known EAN" (`context/foundation/shape-notes.md:264`). The endpoints are internal and can change without notice, so "Implement one adapter per shop" (`docs/research/polish-drugstore-price-apis.md:326`).                | yes: `ShopAdapter` and `SHOP_ADAPTERS` (`src/lib/services/shops/registry.ts:34-90`)                                                                                      |
| the gate's counter    | "The gate is a small module with injected dependencies: `fetch`, `reserve`, `reportBlock` and a logger. A thin binding wires those to a Supabase client, which keeps `astro:env` and the network out of unit tests." (`context/archive/2026-09-26-polite-shop-access/plan.md:69`, also `:49`)           | half: the core takes `ShopGateDeps` (`src/lib/services/shop-gate.ts:46-56`, `:70-71`), but the binding sits in the same module, which imports the SDK (`:1`, `:172-207`) |
| the counter's storage | "Keep counters in Supabase for the MVP; if a Durable Object is ever added, decide consciously …" (`context/foundation/infrastructure.md:97`)                                                                                                                                                            | not applicable: the counter stayed in Supabase                                                                                                                           |
| zod                   | "TypeScript with Zod schemas keeps adapter contracts explicit" (`context/foundation/tech-stack.md:24`). Forms are validated "with zod via `import { z } from "astro/zod"` (no extra dependency)" (`CLAUDE.md:55`).                                                                                      | yes                                                                                                                                                                      |
| Supabase              | None. The infrastructure research keeps it: "the database stays on Supabase" (`context/foundation/infrastructure.md:17`). The rules bind its client instead: "Pages and routes use `locals.supabase` and never create a second client" (`CLAUDE.md:53`), and the null-client contract (`CLAUDE.md:54`). | by convention, in every page and route that holds the client                                                                                                             |

Two more rules decide where code that talks to a library lives: "Shared types (entities, DTOs) belong in `src/types.ts` and business logic in `src/lib/services/`" (`CLAUDE.md:60`), and "Define each shared constant or helper in one module" (`context/foundation/lessons.md:44`).

### The stack and its dependencies

The app runs Astro 7 SSR on Cloudflare Workers, with React 19 islands, Tailwind 4 and Supabase (Postgres with RLS, PostgREST, Auth). These are the runtime dependencies (`package.json:19-40`) and where each is imported:

| dependency                                                                                                                          | range (installed)               | where it's imported                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@supabase/supabase-js`                                                                                                             | `^2.99.1` (2.116.0)             | 8 service modules and `src/env.d.ts`; 10 test files and the test stub; 6 scripts and 2 e2e files                                                                       |
| `@supabase/ssr`                                                                                                                     | `^0.12.7` (0.12.7, pre-1.0)     | `src/lib/supabase.ts` only                                                                                                                                             |
| `astro`                                                                                                                             | `^7.3.2` (7.3.2)                | the routes' `APIRoute`, the middleware, `src/lib/supabase.ts:2-3` and `src/lib/config-status.ts:1`; its `astro/zod` (zod 4.6.2) in 12 service and shop-adapter modules |
| `react`, `react-dom`                                                                                                                | `^19.2.6`                       | the components                                                                                                                                                         |
| `lucide-react`, `class-variance-authority`, `@radix-ui/react-slot`, `clsx`, `tailwind-merge`                                        | see `package.json:25`, `:32-37` | the components and `src/lib/utils.ts`                                                                                                                                  |
| `@astrojs/cloudflare`, `@astrojs/react`, `@astrojs/sitemap`, `@astrojs/check`, `@tailwindcss/vite`, `tailwindcss`, `tw-animate-css` | see `package.json:19-40`        | the build and the CSS                                                                                                                                                  |

Two external dependencies are not npm packages. The shops' APIs are reached only through `gate.fetch`, and one adapter maps each (`src/lib/services/shops/`). The Supabase platform holds the tables, views and RLS policies in `supabase/migrations/`.

### The code's layers

| layer                | files                                                                                                                                                      | what it does with the SDK today                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| request context      | `src/lib/supabase.ts`, `src/middleware.ts`, `src/env.d.ts`                                                                                                 | builds the request's one client, asks Auth for the user, puts both in `Astro.locals`    |
| pages                | `src/pages/watchlist.astro`, `src/pages/watchlist/[id].astro`, `src/pages/auth/set-password.astro`, `src/pages/auth/signin.astro`, `src/pages/index.astro` | take the client from `Astro.locals` and hand it to services; read the SDK's `User`      |
| routes               | the 9 files under `src/pages/api/`                                                                                                                         | the same; the four auth routes call Auth themselves                                     |
| use-case services    | `price-targets.ts`, `price-refresh.ts`, `shop-matching.ts` under `src/lib/services/`                                                                       | pass the client on and never query                                                      |
| data-access services | `watchlist.ts`, `matches.ts`, `prices.ts`, `shop-gate.ts` (its binding), `auth.ts` under `src/lib/services/`                                               | build queries, call the two RPCs and Auth, turn rows and errors into domain types       |
| rules                | `matching.ts`, `price-comparison.ts`, `watchlist-rows.ts`, `match-step.ts`, `match-view.ts`                                                                | none: they take domain types                                                            |
| browser              | the 30 modules `islandConfig` lists (`eslint.config.js:95-126`)                                                                                            | none: lint refuses `@supabase/*` there                                                  |
| database             | `supabase/migrations/` (8 files)                                                                                                                           | tables, two views, three functions (two of them the app's RPCs) and RLS on `auth.uid()` |
| tooling              | 6 files in `scripts/`, 2 in `tests/e2e/`                                                                                                                   | the SDK directly, by design                                                             |

### Priors

- **The project map** can't see this dependency: "Not graphed: … the Supabase client passed through `Astro.locals`" (`context/map/repo-map.md:206`). It lists "migrations ↔ hand-kept `src/types.ts`" as a coupling that no check compares (`:113`).
- **The domain map's** #1 candidate is the watched product with its decisions (`context/domain/domain-distillation.md:307`), which `context/domain/02-invariant-aggregate-refactor.md` turns into a guardian. That plan reads and writes through `loadWatchedProduct(supabase, id)` and `saveDecision(supabase, change)`, the latter over a `record_decision` SQL function (`:208-223`). This plan keeps the guardian and its rules and changes only what their persistence takes: the port instead of the client.
- **M-2 is open** (`context/foundation/roadmap.md:57-59`). S-01 is ready and pushed on its branch. S-02 (the own-shop backstop and `record_decision`) and S-03 (the page's lookups through the guardian) are proposed. The guardian is a module of functions with `kind` unions and no I/O (S-01 branch: `src/lib/services/watched-product.ts:5-10`, `:52-53`, `:100-120`). This design follows that idiom.
- **The observability audit** of 2026-10-05 asked for "One shared error-to-log helper" (X2, `context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:133`). It also found Auth's code and status thrown away at the routes (S4, `:111`), conflicts implemented as database errors (W3, `:123`), and any 23503 read as `gone` (W5, `:125`).

## Step 1: Leaking dependencies

### Signals, per dependency

| signal                                                  | Supabase client SDK                                                                                                              | zod (`astro/zod`)                                                                                                | the shops' APIs                                                                          | Astro                                            | React and the UI libraries |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------- |
| one package in many layers                              | **yes**, 5 layers: request context, pages, routes, use-case services and data-access services                                    | 2 layers: services and shop adapters                                                                             | 1 layer, the adapters, plus the gate's host list (`src/lib/services/shop-gate.ts:12-17`) | the routes and the middleware, as a framework is | the components             |
| its objects or types rebuilt by hand                    | **yes**: row shapes in 3 modules, its answers read 3 ways, the client imitated 12 times in 9 test-side files (Step 3)            | no                                                                                                               | no: each adapter maps only its own shop                                                  | no                                               | no                         |
| its types in domain signatures or wire contracts        | **yes**: `SupabaseClient` in 20 exported functions and one input type, `User` in `App.Locals`, `AuthError` in the mappers' input | weak: three `z.infer` form types (`src/lib/services/auth.ts:44`, `:136`; `src/lib/services/price-targets.ts:35`) | no: candidates and offers are `src/types.ts`'s                                           | `APIRoute` in the routes, by design              | props only                 |
| one SDK on both sides of the client and server boundary | no: lint refuses it in the island modules, and there is no browser client                                                        | no: refused there too                                                                                            | no                                                                                       | not applicable                                   | not applicable             |

### Every file that knows the Supabase client SDK

There are 25 app files, 12 test-side files and 8 tooling files.

**Request context (3)**

- `src/lib/supabase.ts:1-3`, `:9-29`: imports `@supabase/ssr`, reads `SUPABASE_URL` and `SUPABASE_KEY`, and builds the client with its cookie bridge and cache headers.
- `src/env.d.ts:3`, `:5`: puts the SDK's `User` and `SupabaseClient` in `App.Locals`.
- `src/middleware.ts:5`, `:12-16`, `:18-25`: builds the client, stores it and calls `auth.getUser()`. Its comment names `@supabase/ssr` (`:12`).

**Pages (5)**

- `src/pages/watchlist.astro:30`, `:42-47`, `:69`
- `src/pages/watchlist/[id].astro:44`, `:55-66`, `:92-105`, `:115-116`, `:186`
- `src/pages/auth/set-password.astro:13`, `:21`
- `src/pages/auth/signin.astro:15` and `src/pages/index.astro:4`, which check only whether the SDK's `User` is there

**Routes (9)**

- `src/pages/api/watchlist.ts:16-19`, `:32`
- `src/pages/api/watchlist/matches.ts:24-27`, `:33`
- `src/pages/api/watchlist/prices.ts:54-57`, `:61`, `:71`
- `src/pages/api/watchlist/refresh.ts:48-51`, `:55`, `:59`
- `src/pages/api/watchlist/remove.ts:25-28`, `:30`
- `src/pages/api/auth/signin.ts:22-25`, `:31-34`: `auth.signInWithPassword`
- `src/pages/api/auth/signout.ts:10-15`: `auth.signOut({ scope: "local" })`
- `src/pages/api/auth/confirm.ts:21-24`, `:30-35`: `auth.verifyOtp`
- `src/pages/api/auth/set-password.ts:12-16`, `:32-35`: `auth.updateUser`

**Use-case services, which only pass the client on (3)**

- `src/lib/services/price-targets.ts:1`, `:43-50`, `:59-71`, `:80-101`, `:124-138`, `:150-170`
- `src/lib/services/price-refresh.ts:1`, `:65-82`, `:85-92`
- `src/lib/services/shop-matching.ts:1`, `:249-251`, `:385`, `:392`

**Data-access services (5)**

- `src/lib/services/watchlist.ts:1`, `:27`, `:116-298`, `:349-352`: four queries on `watchlist_items` (`:124`, `:176`, `:237`, `:282`) and code 23505 (`:143`)
- `src/lib/services/matches.ts:1`, `:26-27`, `:221-624`: four queries on `watchlist_matches` (`:304`, `:321`, `:452`, `:521`) and codes 23503 and 23505 (`:311`, `:315`)
- `src/lib/services/prices.ts:1`, `:23-276`, `:312-414`: one insert into `price_observations` (`:92`) and one read of either view (`:347`)
- `src/lib/services/shop-gate.ts:1`, `:26`, `:167-207`: the two RPCs (`:183`, `:193`)
- `src/lib/services/auth.ts:1`, `:57-79`, `:165-177`, `:258-273`, `:276-295`: `AuthError`'s code and status, and `auth.getClaims()` (`:262`)

That makes 19 SDK call sites in 11 files: `createServerClient` (`src/lib/supabase.ts:13`), 10 queries, 2 RPCs and 6 Auth calls. 20 exported service functions take the client as a parameter: 2 in `auth.ts`, 4 in `matches.ts`, 1 in `price-refresh.ts`, 4 in `price-targets.ts`, 4 in `prices.ts`, 1 in `shop-gate.ts` and 4 in `watchlist.ts`. `runMatchSteps` takes it as a field (`src/lib/services/shop-matching.ts:251`).

**Tests (12)**, all under `src/lib/services/`

- `src/lib/services/testing/stub-supabase.ts:1-228`: an imitation of the query builder and its answers, PostgREST's `PGRST116` included (`:175`), cast to `SupabaseClient` (`:227`)
- Hand-built clients cast to `SupabaseClient`: `auth.test.ts:572`, `matches.test.ts:169`, `price-refresh.test.ts:299`, `price-targets.test.ts:166`, `prices.test.ts:106`, `shop-gate.test.ts:49`, `shop-matching.test.ts:1103` and `watchlist.test.ts:363`, `:433`, `:513`, `:593`
- `auth.test.ts:1-7` (the SDK's Auth error classes), `matches.db.test.ts:1`, `:69` (a real client against the local stack), `price-routes.test.ts:1`, `:4`, `:204-208` (`locals: { supabase, user: null }`) and `price-pages.test.ts:9` (the stub)
- Postgres and PostgREST codes appear 22 times in 8 of these files.

**Tooling, by design (8)**

- `scripts/check-watchlist-db.mjs:6`, `scripts/check-matches-db.mjs:7`, `scripts/check-prices-db.mjs:18`, `scripts/check-shop-gate-db.mjs:9` and `scripts/check-two-users.mjs:16` prove RLS and grants on the database itself.
- `scripts/owner-link.mjs:23` is the owner's own call to Auth's `generateLink`, with a secret key that never reaches the app (`CLAUDE.md:17`).
- `tests/e2e/auth.setup.ts:8` and `tests/e2e/support/watchlist-data.ts:10` sign up the e2e run's user and seed its data.

## Step 2: Classification, and the leak chosen

The three axes: (a) how many layers and files know the dependency, (b) the risk and cost of replacing or upgrading it today, (c) whether the documents declare it replaceable, and whether the code keeps that.

| dependency                 | (a) layers and files                                                                                                                               | (b) risk and cost of a replacement today                                                                                                                                               | (c) the documents                                                                                                                                                               | verdict                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Supabase client SDK        | **high**: 5 layers, 25 app files, 12 test-side files, 19 call sites in 11 files                                                                    | **high**: a change in the SDK reaches every data-access and use-case signature, 9 routes, 5 pages and 12 imitations of it. `@supabase/ssr` is pre-1.0, but it already sits in one file | **partial**: no document calls it replaceable. They ask for this very seam for the gate (kept for the core only) and for shared helpers defined once (not kept for its answers) | **chosen**                 |
| zod                        | medium: 2 layers, 12 modules                                                                                                                       | low: its inferred types are plain shapes, and its errors never leave a module (`safeParse`)                                                                                            | prescribed, and kept                                                                                                                                                            | no gap                     |
| the shops' APIs            | low: one directory, plus the gate's hosts and Rossmann's direct search for its caption and spelling hint (`src/lib/services/product-search.ts:12`) | medium per change, and contained: one adapter file                                                                                                                                     | declared, and kept                                                                                                                                                              | the precedent this follows |
| Astro                      | the routes and the middleware, by design                                                                                                           | the framework itself                                                                                                                                                                   | the chosen stack                                                                                                                                                                | not an ACL case            |
| React and the UI libraries | the components only                                                                                                                                | contained                                                                                                                                                                              | the chosen stack                                                                                                                                                                | not an ACL case            |

**Chosen: the Supabase client SDK** (`@supabase/supabase-js` with `@supabase/ssr`).

- It is the only dependency whose objects travel. One client, built in the middleware, passes through pages, routes and three use-case services that never query, and reaches five modules that do.
- Its answers are read in five places, in three ways, against two written rules and an open audit finding (Step 3).
- Its tests imitate it: 12 hand-made clients in 9 test-side files, each cast to `SupabaseClient`. They rebuild its call chains, so they lock in the order of its calls, not what a service asks the database.
- M-2's core, the decisions' write, sits directly on it, and each M-2 slice adds to it (Step 3).
- The gap between intent and code: the documents designed this seam once, for the gate, for a reason that applies to every data-access module, and the code kept it only there.

**What is not chosen, and why.** The platform stays: Postgres, RLS on `auth.uid()`, PostgREST and Auth are the privacy model the rules require ("Enforce this with RLS policies", `CLAUDE.md:18`). What leaks is the client: its query builder, its `{ data, error }` answers, its error codes, its Auth client and its types. zod and the shop adapters already match their documents.

## Step 3: Diagnosis

### One client, five layers

```text
@supabase/ssr  createServerClient           src/lib/supabase.ts:13
middleware     builds it and keeps it        src/middleware.ts:15-16, typed by src/env.d.ts:5
pages, routes  take it from locals           src/pages/watchlist/[id].astro:44; src/pages/api/watchlist/refresh.ts:48
use cases      pass it on, never query       src/lib/services/price-targets.ts:124-138; price-refresh.ts:65-92; shop-matching.ts:251
data access    query it                      src/lib/services/watchlist.ts:122-298; matches.ts:296-553; prices.ts:81-376;
                                             shop-gate.ts:180-206; auth.ts:258-264
```

Two routes hand the same client over twice, once raw and once inside the gate: `refreshPrices(shopGateFor(supabase), supabase, …)` (`src/pages/api/watchlist/prices.ts:71`, `src/pages/api/watchlist/refresh.ts:59`). Seven of the 20 exported functions that take the client only pass it on (`refreshPrices`, `shopItemFor`, `priceTargetFor`, `listTargets`, `productTargets`, `productPricesOf`, `setPasswordRedirectOf`), and so does `runMatchSteps`.

### The same knowledge, rebuilt by hand

| knowledge                                           | copies                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| the 2 s time limit on a database call               | `src/lib/services/watchlist.ts:27`, `src/lib/services/matches.ts:26` and `src/lib/services/prices.ts:27` (`DATABASE_TIMEOUT_MS`); `src/lib/services/shop-gate.ts:26` (`COUNTER_TIMEOUT_MS`)                                                      |
| how a failed query is logged                        | three helpers under two rules: the message (`watchlist.ts:146`, `:181`, `:246`, `:288`; `matches.ts:316`, `:333`, `:457`, `:525`), the code only (`prices.ts:94`, `:352`, its rule at `:403-409`), a thrown message (`shop-gate.ts:186`, `:201`) |
| what a Postgres code means                          | 23505 at `watchlist.ts:143` and `matches.ts:315`; 23503 at `matches.ts:311`                                                                                                                                                                      |
| "the answer isn't a list", then each row on its own | `watchlist.ts:184-203`, `matches.ts:574-593`, `prices.ts:355-375`                                                                                                                                                                                |
| a size in its two columns                           | written: `watchlist.ts:132-133`, `matches.ts:246-247`; read: `watchlist.ts:167-168`, `:207`, `:216` and `matches.ts:357-365`                                                                                                                     |
| a time the page can show                            | `prices.ts:105-106`, `matches.ts:353-354`                                                                                                                                                                                                        |
| the column lists                                    | `watchlist.ts:177`, `:239-240`; `matches.ts:345-347`, `:522`; `prices.ts:101-103`, `:177`                                                                                                                                                        |
| the client, in tests                                | the shared stub (`src/lib/services/testing/stub-supabase.ts:43-197`) and 11 hand-built clients in 8 test files: 9 of the builder, 1 of the RPC call, 1 of Auth                                                                                   |

Two of the three log helpers log the message. The third forbids that, and gives its reason:

```ts
// src/lib/services/prices.ts:403-409
/**
 * A database error's code, never its message: a message can quote a row or a filter, and a shop item id names the
 * product. A failure that never reached the database has no code.
 */
function codeOf(error: { code?: unknown }): string {
  return typeof error.code === "string" && error.code !== "" ? error.code : "no code";
}
```

The decision write logs the message anyway:

```ts
// src/lib/services/matches.ts:314-318
// Anything but the one-decision-per-shop key is a failure.
if (inserted.error.code !== "23505") {
  logFailure("insert failed", inserted.error.message);
  return "failed";
}
```

The hand-built clients rebuild the builder's call chain, so they lock in the order of its calls, not what the service asks the database. In `matches.test.ts`, every query must end at `abortSignal`:

```ts
// src/lib/services/matches.test.ts:127-133
interface QueryStub {
  insert: (row: unknown) => QueryStub;
  update: (fields: unknown) => QueryStub;
  select: (columns: string) => QueryStub;
  eq: (column: string, value: unknown) => QueryStub;
  abortSignal: (signal: AbortSignal) => Promise<{ data: unknown; error: Answer["error"] | null }>;
}
```

### Library types in domain signatures and in the request context

- `SupabaseClient` appears in 20 exported service signatures. One example is `refreshPrices(gate: ShopGate, supabase: SupabaseClient, targets: PriceKey[], …)` (`src/lib/services/price-refresh.ts:65-70`), a use case that makes no query of its own.
- `App.Locals.user` is the SDK's `User` (`src/env.d.ts:3`). That type carries `app_metadata`, `user_metadata`, `aud`, invite and recovery times and more (`node_modules/@supabase/auth-js/src/lib/types.ts:506-518`). The pages need only whether there is one (`src/pages/index.astro:4`, `src/pages/auth/signin.astro:15`) and its email (`src/pages/watchlist.astro:69`, `src/pages/watchlist/[id].astro:186`, `src/pages/auth/set-password.astro:21`).
- The Auth mappers take the SDK's type: `AuthErrorFacts = Partial<Pick<AuthError, "code" | "status">>` (`src/lib/services/auth.ts:57`).
- No wire contract carries an SDK type. `/api/watchlist/prices` answers with `PriceRefreshAnswer` (`src/types.ts:272-275`).

### Library defaults kept at call sites

- **Sign-out scope.** `signOut` signs out every device unless told otherwise (`scope: 'global'`, `node_modules/@supabase/auth-js/src/GoTrueClient.ts:4067`). The app wants this device only, and one route passes that (`src/pages/api/auth/signout.ts:14`).
- **One client per request.** `@supabase/ssr` hands its cache headers to `setAll` once per client: "A new server client must be created for each request" (`node_modules/@supabase/ssr/src/types.ts:40-42`). That is why `CLAUDE.md:53` forbids a second client, and 12 pages and routes keep the rule by convention.
- **Cookie flags.** `@supabase/ssr` writes its cookies with `httpOnly: false` unless told otherwise (`node_modules/@supabase/ssr/src/utils/constants.ts:3-10`). The parked hardening change wants them `httpOnly` (`context/foundation/roadmap.md:153-155`).

### The client and server boundary holds

- `islandConfig` refuses `@supabase/*`, `astro/zod` and `@/lib/supabase` in the 30 modules the islands load (`eslint.config.js:94-159`, patterns at `:135-146`). Type-only imports stay allowed (`:148`).
- grep confirms that none of those 30 modules imports the SDK, or a service that imports it, at runtime. `createBrowserClient` appears nowhere in `src/`.
- The vendor's name reaches the browser only as text: "Supabase nie jest skonfigurowany." (`src/lib/notices.ts:146`). Two services define the same text again (`src/lib/services/watchlist.ts:94`, `src/lib/services/matches.ts:183`).

So nothing leaks into the bundle. The dangerous crossings are two others. The SDK's error text goes to the logs from two modules, against the third module's stated reason. The security-relevant defaults above are each held by one call site.

### Intent against code

- **The gate's seam.** The polite-shop-access plan injected the gate's dependencies so the database and `astro:env` stay out of unit tests (`context/archive/2026-09-26-polite-shop-access/plan.md:49`, `:69`). The core keeps that. Its binding lives in the same module, so the gate's module still imports the SDK (`src/lib/services/shop-gate.ts:1`, `:172-207`).
- **No seam elsewhere.** No other data-access module got that seam. The test plan compensates with an imitation of the SDK: "Use it for a row the database would refuse, such as an odd price row, which only a stub can serve." (`context/foundation/test-plan.md:125`).
- **Shared helpers once.** The lesson "Define each shared constant or helper in one module" (`context/foundation/lessons.md:44`) isn't kept for the SDK's answers: four time limits, three log helpers, three row loops.
- **The audit's helper.** The audit's "One shared error-to-log helper" (`context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:133`) still doesn't exist at HEAD.

### M-2 adds to it

All line numbers in the first two bullets are the S-01 branch's.

- **On the S-01 branch**, `loadWatchedProduct(supabase: SupabaseClient, itemId)` (S-01 branch: `src/lib/services/matches.ts:479-488`) combines two reads with the pure `watchedProductOf`, and takes the SDK client only to pass it on. The route still holds `locals.supabase` (S-01 branch: `src/pages/api/watchlist/matches.ts:43-46`, `:55`, `:69`).
- **Two new test helpers** on that branch are typed with the client: `src/lib/services/testing/route-context.ts:1`, `:11`, `:15` and `src/lib/services/match-routes.test.ts:1`, `:116`, both new files there.
- **S-02** would add `rpc("record_decision", …)` to `matches.ts` (`context/domain/02-invariant-aggregate-refactor.md:210-223`).

## Step 4: The anti-corruption layer

### Layout

```text
src/lib/services/backend.ts    the port: Backend and its five narrow parts. Types only.
src/types.ts                   + SignedInUser
src/lib/supabase/              the ACL: the only directory that names @supabase/*
  client.ts                    openBackend: the request's one client. With config-status.ts, the only reader of the two env values.
  adapter.ts                   backendOf(client): Backend. No astro:env, so a test can build one over the stub.
  database.ts                  Watchlist, Decisions, PriceObservations and RequestCounter over the builder and the two RPCs;
                               DatabaseAnswer, the one time limit, the one log line
  session.ts                   Session over Auth; SignedInUser from the SDK's User; Auth's codes as the app's
  records.ts                   the stored records: tables, views and columns; rows to and from domain types. No SDK import.
  testing/stub-supabase.ts     moved from src/lib/services/testing/
```

### The stored records: the value objects that know the shape

For a database client, the dependency's shape is twofold: the rows (tables, views, columns) and the SDK's answers. Each stored aggregate gets one value object in `records.ts`. It is the only place that maps that aggregate's rows to and from the domain's types, and it keeps the rules that are stated over stored rows. The domain keeps its own types (`ShopMatch`, `WatchlistProduct`, `LatestPrice`) and never sees a row. `StoredDecision` is shown in full, since decisions are M-2's aggregate. Its siblings follow the same pattern.

```ts
// src/lib/supabase/records.ts: the only module that names a table, a view or a column.
// It imports zod and the domain's types, never @supabase/*: a row is `unknown` until it is read here.

/** watchlist_matches, and the columns each read names. Nowhere else in the app. */
export const DECISIONS = {
  table: "watchlist_matches",
  read:
    "watchlist_item_id, shop_id, state, decided_by, shop_item_id, name, brand, size_text, size_value, size_unit, " +
    "eans, product_url, image_url, checked_at",
  states: "watchlist_item_id, shop_id, state, shop_item_id, brand, size_value, size_unit, decided_by",
} as const;

/** One stored row: the decision it holds, or an odd row with what it still says of whose decision it is. */
export type StoredDecision =
  { kind: "decision"; decision: ShopMatch } | { kind: "odd"; product: string | null; shop: string | null };

/** What a write stores: the lookup's outcome or the user's decision. */
export type DecisionTo =
  | { state: "matched"; decidedBy: "auto" | "user"; item: MatchedItem }
  | { state: "unmatched" } // only the user declines
  | { state: "not_found" }; // only the lookup finds nothing

// From persistence
export function storedDecisionOf(raw: unknown): StoredDecision;
export function matchesReadOf(rows: readonly unknown[], shops: readonly MatchableShop[]): MatchesRead;
export function matchStatesReadOf(rows: readonly unknown[], shops: readonly MatchableShop[]): MatchStatesRead;

// To persistence
export function decisionColumnsOf(to: DecisionTo): DecisionColumns;
export function replacedColumnsOf(replaces: ExpectedDecision | null): Partial<DecisionColumns>;
```

```ts
storedDecisionOf(raw) {                                    // today's rowSchema and toMatch, matches.ts:367-381, :595-619
  const row = decisionRowSchema.safeParse(raw);
  if (row.success) return { kind: "decision", decision: shopMatchOf(row.data) };
  return { kind: "odd", product: textField(raw, "watchlist_item_id"), shop: textField(raw, "shop_id") };
}

matchesReadOf(rows, shops) {                               // the four rules, today's matches.ts:383-429, :460-467
  const read = rows.map(storedDecisionOf);
  const matches = read.flatMap((r) => (r.kind === "decision" && shops.includes(r.decision.shop) ? [r.decision] : []));
  const decided = new Set(matches.map((m) => m.shop));
  // An odd row of a shop outside `shops` holds nothing the pages use. Otherwise it costs its own shop's decision,
  // or every listed shop's when its shop can't be read: unreadable, never undecided.
  const hidden = new Set(read.flatMap((r) => (r.kind === "odd" ? shopsAnOddRowHides(r.shop, shops) : [])));
  return { matches, unreadable: shops.filter((s) => hidden.has(s) && !decided.has(s)) };
}

decisionColumnsOf(to) {                                    // today's itemColumns and NO_ITEM, matches.ts:227-252
  if (to.state === "matched") return { state: "matched", decided_by: to.decidedBy, ...shopItemColumnsOf(to.item) };
  return { state: to.state, decided_by: to.state === "unmatched" ? "user" : "auto", ...NO_SHOP_ITEM };
}

replacedColumnsOf(replaces) {                              // the compare-and-swap's condition, matches.ts:325-330
  if (replaces === null) return { state: "not_found" };    // a lookup or a first choice replaces only "not found"
  return replaces.state === "matched" ? { state: "matched", shop_item_id: replaces.shopItemId } : { state: "unmatched" };
}
```

| value object        | table or view                                  | from persistence                                                                                         | to persistence                                                                           | the rule it keeps                                                     | moved from                                                                |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `StoredProduct`     | `watchlist_items`                              | `storedProductOf(raw)`: a `WatchlistItem` or `WatchlistProduct`, or an odd row the list drops and counts | `productColumnsOf(candidate)`                                                            | a size that can't be read makes the row odd, never one without a size | `src/lib/services/watchlist.ts:120`, `:157-171`, `:206-226`, `:272`       |
| `StoredDecision`    | `watchlist_matches`                            | above                                                                                                    | above                                                                                    | above                                                                 | `src/lib/services/matches.ts:227-252`, `:345-429`, `:473-484`, `:555-619` |
| `StoredPriceCheck`  | `price_observations`                           | none: the table is append-only, and its reads go through the views                                       | `observationRowOf(key, check)`: a price, a `missing` row, or nothing for an unread check | a shop that gave no answer stores nothing                             | `src/lib/services/prices.ts:30-74`                                        |
| `StoredLatestPrice` | `latest_price_observations`, `price_summaries` | `latestPriceOf(raw, view)`, `listPricesReadOf(rows)`, `latestPricesReadOf(rows, keys)`                   | none                                                                                     | a history that can't be read keeps its price (`history: null`)        | `src/lib/services/prices.ts:100-190`, `:210-276`, `:355-401`              |
| shared              | none                                           | `rowsOf(answer, parse)`, the one loop; `sizeOf`; one `timestamp` schema                                  | `sizeColumnsOf(size)`                                                                    | each row on its own (`context/foundation/lessons.md:19-24`)           | the copies in Step 3                                                      |

### The answers: conversions from the SDK's types

```ts
// src/lib/supabase/database.ts (excerpt): the only module that reads the SDK's { data, error }.
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

/** Every database call gives up after 2 s, the request counter's included. One signal bounds a read and its retries. */
const DATABASE_TIMEOUT_MS = 2000;

/** What the database said to one call, in the app's words. */
type DatabaseAnswer =
  | { kind: "rows"; rows: readonly unknown[] } // a read, or a write that asked for its rows back
  | { kind: "row"; row: unknown } // a read of at most one row: null for none
  | { kind: "written" } // a write that asked for nothing back
  | { kind: "duplicate" } // 23505: a unique key holds a row already
  | { kind: "no-parent" } // 23503: the row a key points to isn't there for this user
  | { kind: "unread"; code: string; status: number; hint: string }; // anything else, an answer of another shape included

function answerOf(
  response: { data: unknown; error: PostgrestError | null; status: number },
  expect: "rows" | "row" | "nothing",
): DatabaseAnswer {
  const { data, error, status } = response;
  if (error !== null) {
    if (error.code === "23505") return { kind: "duplicate" };
    if (error.code === "23503") return { kind: "no-parent" };
    // An empty code is a failure that never reached the database: a timeout or the network (P-3).
    return { kind: "unread", code: error.code === "" ? "no code" : error.code, status, hint: error.hint };
  }
  if (expect === "rows") {
    return Array.isArray(data) ? { kind: "rows", rows: data } : { kind: "unread", code: "shape", status, hint: "" };
  }
  return expect === "row" ? { kind: "row", row: data } : { kind: "written" };
}

/** The one log line of a database failure: the operation, the code, the HTTP status and the hint, never the message. */
function logUnread(operation: string, answer: Extract<DatabaseAnswer, { kind: "unread" }>): void;
```

```ts
// src/types.ts
/** The signed-in user, as the pages read them: that there is one, and the email the header shows. */
export interface SignedInUser {
  email: string | null;
}

// src/lib/supabase/session.ts (excerpt)
import type { AuthError, SupabaseClient, User } from "@supabase/supabase-js";

export function signedInUserOf(user: User): SignedInUser {
  return { email: user.email ?? null };
}
// Moved whole from src/lib/services/auth.ts:57-79, :165-177, :276-295: Auth's code and status as the app's codes.
function authErrorCodeOf(error: Pick<AuthError, "code" | "status">): AuthErrorCode;
function confirmErrorCodeOf(error: Pick<AuthError, "code" | "status">): ConfirmAuthErrorCode;
function passwordErrorCodeOf(error: Pick<AuthError, "code" | "status">): PasswordAuthErrorCode;
```

### The narrow port

The signatures below are short method forms. The code writes each operation as a function property, as `ShopAdapter` does (`src/lib/services/shops/registry.ts:35-55`), and the adapter returns object literals of closures, as `createShopGate` does (`src/lib/services/shop-gate.ts:71-165`). There are no classes.

```ts
// src/lib/services/backend.ts: the port. Types only: no @supabase/*, no astro:*. A caller takes
// `Pick<Backend, …>` of the parts it uses. Reads and writes keep today's outcomes; only the client parameter goes.

/** The user's watched products (watchlist_items), through the user's own session, so RLS keeps them theirs. */
export interface Watchlist {
  add(candidate: ProductCandidate): Promise<AddResult>;
  list(): Promise<WatchlistItem[] | null>; // null: unread
  product(itemId: string): Promise<WatchlistProduct | null | "failed">; // null: not on the user's list
  remove(itemId: string): Promise<RemoveResult>;
}

/** The user's decisions (watchlist_matches): one per watched product and shop. */
export interface Decisions {
  ofProduct(itemId: string, shops?: readonly MatchableShop[]): Promise<MatchesRead | null>;
  states(shops?: readonly MatchableShop[]): Promise<MatchStatesRead | null>;
  recordLookup(
    itemId: string,
    shop: ShopId,
    outcome: Extract<ShopLookup, { kind: "accepted" | "not-found" }>,
  ): Promise<RecordResult>;
  recordDecision(
    itemId: string,
    shop: ShopId,
    decision: MatchDecision,
    replaces: ExpectedDecision | null,
  ): Promise<RecordResult>;
}

/** The price observations of the shop items the user watches, shared with their other watchers. */
export interface PriceObservations {
  add(checks: readonly { key: PriceKey; check: PriceCheck }[]): Promise<PriceRecordResult>;
  latest(): Promise<ListPricesRead | null>; // the list's view, without history
  latestOf(keys: readonly PriceKey[]): Promise<LatestPricesRead | null>; // the product page's view, with history
}

/** The request cap's counter, as the shop gate asks it. It never throws: the gate reads `unreachable` as skipped. */
export interface RequestCounter {
  reserve(shop: ShopId): Promise<{ kind: "answered"; reservation: unknown } | { kind: "unreachable"; note: string }>;
  reportBlock(
    shop: ShopId,
    kind: ShopBlockKind,
    retryAfterSeconds?: number,
    detail?: string,
  ): Promise<{ kind: "recorded" } | { kind: "unreachable"; note: string }>;
}

/** Auth, for one request: who is signed in, and what the auth routes ask. Every refusal is the app's own code. */
export interface Session {
  user(): Promise<SignedInUser | null>;
  signIn(email: string, password: string): Promise<{ kind: "signed-in" } | { kind: "refused"; code: AuthErrorCode }>;
  signOut(): Promise<{ kind: "signed-out" } | { kind: "failed" }>; // this device only
  openLink(link: ConfirmFields): Promise<{ kind: "signed-in" } | { kind: "refused"; code: ConfirmAuthErrorCode }>;
  claims(): Promise<SessionClaims | null>;
  setPassword(password: string): Promise<{ kind: "saved" } | { kind: "refused"; code: PasswordAuthErrorCode }>;
}

/** What one request may ask of the database and Auth, over the request's only client. Null without configuration. */
export interface Backend {
  watchlist: Watchlist;
  decisions: Decisions;
  priceObservations: PriceObservations;
  counter: RequestCounter;
  session: Session;
}
```

Each caller takes only the parts it uses:

| caller                                                                              | takes                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/middleware.ts`                                                                 | `openBackend`, the factory, and `session.user`                                                                                                                                                                   |
| the four auth routes; `src/pages/auth/set-password.astro` (`setPasswordRedirectOf`) | `session`                                                                                                                                                                                                        |
| `src/pages/api/watchlist.ts` („Dodaj”)                                              | `watchlist.add`                                                                                                                                                                                                  |
| `src/pages/api/watchlist/remove.ts`                                                 | `watchlist.remove`                                                                                                                                                                                               |
| `src/pages/api/watchlist/matches.ts`                                                | `decisions.recordDecision`; on the S-01 branch also `watchlist.product` and `decisions.ofProduct`, through `loadWatchedProduct`                                                                                  |
| `src/pages/api/watchlist/prices.ts`, `refresh.ts`                                   | through `priceTargetFor`, `listTargets`, `productTargets` and `refreshPrices`: the three parts' reads and `priceObservations.add`; `counter` for the gate                                                        |
| `src/pages/watchlist.astro`                                                         | `watchlist.list`, `decisions.states`, `priceObservations.latest`; `counter` for the search's gate                                                                                                                |
| `src/pages/watchlist/[id].astro`                                                    | the same three, `watchlist.product` and `decisions.ofProduct`; through `runMatchSteps`, `decisions.recordLookup` and `priceObservations.add`; through `productPricesOf`, `priceObservations.latestOf`; `counter` |
| `shopGateFor`                                                                       | `counter`                                                                                                                                                                                                        |

### The adapter

```ts
// src/lib/supabase/client.ts: the only module that imports @supabase/ssr. With src/lib/config-status.ts, the only
// reader of SUPABASE_URL and SUPABASE_KEY (astro:env/server). Only the middleware calls it, once per request.
export function openBackend(requestHeaders: Headers, cookies: AstroCookies, responseHeaders: Headers): Backend | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null; // the null-client contract (CLAUDE.md:54)
  const client = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: { getAll, setAll }, // today's bridge and cache headers, src/lib/supabase.ts:14-27
    // cookieOptions: { httpOnly: true },         // P-1, if the owner takes it: here and nowhere else
  });
  return backendOf(client);
}

// src/lib/supabase/adapter.ts: no astro:env, so a test builds a Backend over the stub
// (context/archive/2026-09-26-polite-shop-access/plan.md:49).
export function backendOf(client: SupabaseClient): Backend {
  return { ...databaseOf(client), session: sessionOf(client) };
}
```

```ts
// src/lib/supabase/database.ts (excerpt): the decision write, today's record (matches.ts:296-342).
async function record(client, itemId, shop, to: DecisionTo, replaces: ExpectedDecision | null): Promise<RecordResult> {
  const inserted = answerOf(
    await client
      .from(DECISIONS.table)
      .insert({ watchlist_item_id: itemId, shop_id: shop, ...decisionColumnsOf(to) })
      .abortSignal(timeout()),
    "nothing",
  );
  switch (inserted.kind) {
    case "written":
      return "saved";
    case "no-parent":
      return "gone"; // the user's own product isn't there (watchlist_matches_own_product)
    case "duplicate":
      break; // a decision is stored: replace it only while it is the expected one
    default:
      logUnread("decision insert", inserted);
      return "failed";
  }
  const updated = answerOf(
    await client
      .from(DECISIONS.table)
      .update({ ...decisionColumnsOf(to), checked_at: new Date().toISOString() })
      .eq("watchlist_item_id", itemId)
      .eq("shop_id", shop)
      .match(replacedColumnsOf(replaces))
      .select("id")
      .abortSignal(timeout()),
    "rows",
  );
  if (updated.kind !== "rows") {
    logUnread("decision update", updated);
    return "failed";
  }
  return updated.rows.length > 0 ? "saved" : "decided";
}
// Under S-02 this body becomes one client.rpc("record_decision", …) call. The port's contract doesn't change.
```

```ts
// src/lib/supabase/session.ts (excerpt): today's route bodies, src/pages/api/auth/*.ts.
export function sessionOf(client: SupabaseClient): Session {
  return {
    async user() {
      const { data } = await client.auth.getUser(); // P-2: getClaims() only if the owner decides
      return data.user === null ? null : signedInUserOf(data.user);
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return error === null ? { kind: "signed-in" } : { kind: "refused", code: authErrorCodeOf(error) };
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: "local" }); // the SDK's default is every device
      return error === null ? { kind: "signed-out" } : { kind: "failed" };
    },
    async openLink({ token_hash, type }) {
      const { data, error } = await client.auth.verifyOtp({ token_hash, type });
      if (error !== null) return { kind: "refused", code: confirmErrorCodeOf(error) };
      // An answer without a session signed no one in (today's src/pages/api/auth/confirm.ts:34-35).
      return data.session !== null ? { kind: "signed-in" } : { kind: "refused", code: "failed" };
    },
    // claims() and setPassword() follow the same pattern.
  };
}
```

### The contracts it keeps

| contract                                | where it is stated                                              | how the ACL keeps it                                                                                                                                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the null-client contract                | `CLAUDE.md:54`                                                  | `openBackend` returns null without the env, so `locals.backend` is null exactly when `locals.supabase` is today. Every place that checks one checks the other, with the same `config` codes. `shopGateFor(null)` and `isLinkSession(null)` keep their meaning. |
| one client per request                  | `CLAUDE.md:53`; `node_modules/@supabase/ssr/src/types.ts:40-42` | Only the middleware calls `openBackend`, once. Every part of the `Backend` closes over that one client. In Phase 5, lint refuses `@/lib/supabase/client` anywhere else.                                                                                        |
| every shop request through `gate.fetch` | `CLAUDE.md:21`                                                  | Unchanged. The ACL makes no shop request, the gate takes the `counter` part, and `serverFetchConfig` still covers `src/lib/supabase/**` (`eslint.config.js:210-226`).                                                                                          |
| no secret key in the app                | `CLAUDE.md:17`, `:23`                                           | `client.ts` reads the two values through `astro:env/server`, as today. No secret-key client exists anywhere in `src/`. The owner's script stays outside.                                                                                                       |
| `islandConfig`                          | `CLAUDE.md:58`; `eslint.config.js:94-159`                       | No island imports the port or the adapter. The `@/lib/supabase` pattern widens to the directory in Phase 1.                                                                                                                                                    |
| no thrown errors                        | the guardian's idiom (S-01 branch)                              | Every expected outcome is a union. A programming error still throws, as the gate's host check does (`src/lib/services/shop-gate.ts:92-95`).                                                                                                                    |
| an unreadable answer is never "missing" | `context/foundation/lessons.md:19-24`                           | The per-row rules move whole into `records.ts`. A read that can't be read stays null, never empty.                                                                                                                                                             |
| M-2's guardian                          | `context/domain/02-invariant-aggregate-refactor.md`             | Its rules don't change, and `watched-product.ts` stays free of I/O. `loadWatchedProduct` takes `Pick<Backend, "watchlist" \| "decisions">`.                                                                                                                    |

## Step 5: Proof of isolation

### What replacing the SDK touches

| change                                                                                          | files that change                                                                                                                                                                                       | what stays                                                                         |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| a supabase-js release that changes the builder, its answers or its error codes                  | `src/lib/supabase/database.ts`, its tests and the stub                                                                                                                                                  | the tables, routes, pages, islands and services                                    |
| `@supabase/ssr` 0.13 or later (pre-1.0, so a minor release may break), or our own cookie bridge | `src/lib/supabase/client.ts`                                                                                                                                                                            | the middleware's one call and everything after it                                  |
| plain PostgREST calls through `fetch` instead of the builder                                    | `database.ts`, plus `src/lib/supabase/**` in `serverFetchConfig`'s ignores (`eslint.config.js:218`), since that rule exists for shop hosts                                                              | the tables (same API, same RLS), the port and its callers                          |
| another client for the same Auth server                                                         | `src/lib/supabase/session.ts`                                                                                                                                                                           | the four auth routes, the set-password page, the middleware's call, `SignedInUser` |
| another platform than Supabase                                                                  | **not isolated**: the RLS policies read `auth.uid()` 16 times in 4 migrations, grants name `authenticated` and `anon`, and the tooling calls Supabase directly. The adapter would be rewritten as well. | the port and its callers                                                           |

After Phase 4:

- **The tables:** no migration changes in any of the first four rows.
- **The API:** the routes import neither `@supabase/*` nor `@/lib/supabase/*`, and read `context.locals.backend`. Their codes, redirects, statuses and JSON answers stay the same.
- **The UI:** the pages read `Astro.locals.backend` and a `SignedInUser`, and the islands import nothing new.

### Before and after, for each duplicated place

| place                                  | before                                                                         | after                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| the database time limit                | four constants (Step 3)                                                        | one, in `database.ts`                                                                                  |
| a failed query's log line              | three helpers under two rules, and a thrown message in the gate's binding      | `logUnread`: the operation, the code, the HTTP status and the hint                                     |
| 23505 and 23503                        | `src/lib/services/watchlist.ts:143`; `src/lib/services/matches.ts:311`, `:315` | `answerOf`'s `duplicate` and `no-parent`, which the two writes switch on                               |
| "not a list", then each row on its own | three loops                                                                    | `rowsOf` in `records.ts`                                                                               |
| a size and a time in columns           | four copies                                                                    | `sizeOf`, `sizeColumnsOf` and one `timestamp` in `records.ts`                                          |
| the column lists                       | six strings in three services                                                  | `records.ts` only                                                                                      |
| Auth's codes                           | read in `src/lib/services/auth.ts`, applied by the four auth routes            | read in `session.ts`; a route gets `{ kind: "refused"; code }`                                         |
| the client in signatures               | 20 exported functions and `MatchStepsInput`                                    | the port's parts                                                                                       |
| the client in tests                    | the stub and 11 hand-built clients                                             | domain tests use an in-memory `Backend`; the adapter's tests keep the stub, inside `src/lib/supabase/` |

One example, the "Dodaj" write. Before:

```ts
// src/lib/services/watchlist.ts:141-148
if (error) {
  // The unique constraint on (user_id, source, source_item_id).
  if (error.code === "23505") {
    return "exists";
  }
  logFailure("insert failed", error.message);
  return "failed";
}
```

After, in the adapter (a sketch):

```ts
const answer = answerOf(
  await client.from(PRODUCTS.table).insert(productColumnsOf(candidate)).select("id").abortSignal(timeout()).single(),
  "row",
);
switch (answer.kind) {
  case "row":
    return addedOf(answer.row); // records.ts: { kind: "added"; id }, or "failed" for a row it can't read
  case "duplicate":
    return "exists"; // one product per user, shop and shop item
  default:
    logUnread("watchlist insert", answer);
    return "failed";
}
```

A domain test, before: it builds the builder's chain and casts it (`src/lib/services/price-refresh.test.ts:299`). After: it hands `refreshPrices` an in-memory `PriceObservations` that records what `add` received. No table, no builder.

### The UI gets domain data

Before (`src/env.d.ts:1-7`), the request context holds two of the SDK's objects:

```ts
declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    /** The request's only Supabase client, built by the middleware; null when the env is missing. */
    supabase: import("@supabase/supabase-js").SupabaseClient | null;
  }
}
```

After, it holds the domain's types:

```ts
declare namespace App {
  interface Locals {
    /** The signed-in user, as the pages read them; null for a visitor or without configuration. */
    user: import("@/types").SignedInUser | null;
    /** What this request may ask of the database and Auth, over its only client; null without configuration. */
    backend: import("@/lib/services/backend").Backend | null;
  }
}
```

A page, before (`src/pages/watchlist.astro:30`, `:42-47`):

```ts
const { user, supabase } = Astro.locals;
// …
  supabase ? listWatchlist(supabase) : null,
  supabase ? listMatchStates(supabase) : null,
  supabase ? listLatestPrices(supabase) : null,
```

After:

```ts
const { user, backend } = Astro.locals;
// …
  backend ? backend.watchlist.list() : null,
  backend ? backend.decisions.states() : null,
  backend ? backend.priceObservations.latest() : null,
```

The page keeps `email={user?.email ?? null}` (`:69`), now read from a `SignedInUser`. The islands don't change. They already get domain types: `PriceComparisonShop[]` from the page, and `PriceRefreshAnswer` from their own route (`src/types.ts:272-275`).

### Open points that depend on the SDK's contract

| point                                                   | raised in                                                                                                                                  | what the SDK says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | resolution                                                                                                                                                                                             | encoded in                                                      | owner                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------ |
| P-1 `httpOnly` session cookies                          | the parked hardening (`context/foundation/roadmap.md:153-155`; `context/archive/2026-10-04-invite-only-access/reviews/impl-review.md:157`) | `@supabase/ssr` 0.12.7 defaults to `httpOnly: false` (`node_modules/@supabase/ssr/src/utils/constants.ts:3-10`). It spreads the client's `cookieOptions` over those defaults for every cookie it sets or clears (`node_modules/@supabase/ssr/src/cookies.ts:300-310`, `:615-624`). Only a browser client needs to read the cookie, and this app has none.                                                                                                                                                                                                                  | resolved: `cookieOptions: { httpOnly: true }` is supported                                                                                                                                             | `client.ts` only; no route, page or middleware line             | user, when the hardening change runs |
| P-2 the middleware's Auth call on every request         | `context/foundation/infrastructure.md:102`                                                                                                 | `getClaims()` verifies the token locally only when the project signs with asymmetric keys, which it fetches and caches. With a shared secret, or without WebCrypto, it calls the Auth server, as `getUser()` does (`node_modules/@supabase/auth-js/src/GoTrueClient.ts:6643`, `:6646`, `:6745-6760`). A locally verified token stays valid until it expires (inference from the JWT model).                                                                                                                                                                                | open: it depends on production's signing keys, which aren't in the repository, and on how soon a removed account must lose access (the domain map's Q-02, `context/domain/domain-distillation.md:320`) | `Session.user()` in `session.ts`; the middleware doesn't change | user                                 |
| P-3 what a failed query looks like, and what is retried | `src/lib/services/prices.ts:403-406`; the four time limits                                                                                 | postgrest-js returns a timeout or a network failure as an error with an empty `code` (`node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:292-358`). It retries GET, HEAD and OPTIONS up to 3 times on a network failure or a 503 or 520, but never an aborted request or a write (`node_modules/@supabase/postgrest-js/src/fetchWithRetry.ts:66-76`, `:103-120`; `node_modules/@supabase/postgrest-js/src/types/common/common.ts:8`, `:25`, `:30`). Its backoff ends when the signal aborts (`node_modules/@supabase/postgrest-js/src/fetchWithRetry.ts:13-29`). | resolved: one 2 s signal bounds a read with its retries. A write that times out is neither retried nor known to have failed; the decision write's compare-and-swap already makes it safe to repeat.    | `answerOf` and the one time limit in `database.ts`              | none                                 |
| P-4 which 23503 means `gone`                            | the audit's W5 (`context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:125`)                                     | PostgREST passes Postgres's SQLSTATE in `code` (`node_modules/@supabase/postgrest-js/src/PostgrestError.ts:17-18`). The constraint's name is only inside `message`, by Postgres's message format (not checked against a live answer).                                                                                                                                                                                                                                                                                                                                      | open; by default any 23503 stays `gone`, as today                                                                                                                                                      | `answerOf` in `database.ts`                                     | user                                 |

## Step 6: Verification and plan

### Success criterion

A grep for the package's name in `src/` returns only files under `src/lib/supabase/`.

```sh
# 1. The package's name, anywhere in src/. Today: 22 files. After: only src/lib/supabase/**.
git grep -lE "@supabase/(supabase-js|ssr)" -- src

# 2. The client handle and the SDK's types outside the ACL. Today: 33 files. After: none.
git grep -lE "locals\.supabase|supabase \} = Astro\.locals|SupabaseClient|PostgrestError" -- src ':!src/lib/supabase'

# 3. The SDK's calls, structurally (ast-grep reads .ts only).
#    Today: 14 queries in 4 files (matches.db.test.ts among them). After: database.ts and its database test.
npx --yes -p @ast-grep/cli ast-grep scan --inline-rules '{ id: sdk-query, language: TypeScript, rule: { pattern: "$C.from($T)" }, constraints: { C: { not: { regex: "^(Array|Buffer|Uint8Array|Object)$" } } } }' src
#    Today: 2 RPCs in shop-gate.ts. After: database.ts.
npx --yes -p @ast-grep/cli ast-grep run -p '$C.rpc($$$A)' -l ts src
#    Today: 6 Auth calls in 6 app files, plus matches.db.test.ts:74. After: session.ts and the database test.
npx --yes -p @ast-grep/cli ast-grep run -p '$C.auth.$M($$$A)' -l ts src

# 4. Confirm every zero with grep, for the .astro and .tsx files that ast-grep doesn't read. Today and after: nothing.
git grep -nE "\.rpc\(|\.auth\.[a-zA-Z]+\(|\.from\(\"" -- 'src/**/*.astro' 'src/**/*.tsx'
```

The tooling outside `src/` keeps the SDK on purpose: 5 check scripts, `scripts/owner-link.mjs` and the 2 e2e files. So do `package.json` and `package-lock.json`. Phase 5's lint rule makes the criterion permanent.

### Who knows the SDK, today and after

| group                    | today                                                                      | after                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| request context (3)      | `src/lib/supabase.ts`, `src/env.d.ts` and `src/middleware.ts` know the SDK | the client is built in `src/lib/supabase/client.ts`; `src/env.d.ts` names `Backend` and `SignedInUser`; the middleware calls `openBackend` and `session.user()` |
| pages (5)                | hold the client or read the SDK's `User`                                   | hold `Backend` and `SignedInUser`                                                                                                                               |
| routes (9)               | hold the client, and four call Auth                                        | hold `Backend` and call its parts                                                                                                                               |
| use-case services (3)    | pass the client on                                                         | take `Pick<Backend, …>`                                                                                                                                         |
| data-access services (5) | query, call RPCs, call Auth and read the SDK's errors                      | forms, redirects, texts and composition only; `shop-gate.ts` takes the `counter`, `auth.ts` the `session`                                                       |
| tests (12)               | imitate or type the client                                                 | domain tests use the in-memory `Backend`; the stub, the persistence tests and the database test live under `src/lib/supabase/`                                  |
| tooling (8)              | use the SDK directly                                                       | unchanged, by design                                                                                                                                            |
| the ACL                  | none                                                                       | `src/lib/supabase/`: `client.ts`, `adapter.ts`, `database.ts`, `session.ts`, `records.ts`, the stub and their tests; about eight of its files name the SDK      |

In numbers: 25 app files outside the ACL know the SDK or its objects today, and none will. 22 files in `src/` name the package today, and after Phase 4 only files under `src/lib/supabase/` will.

The phases below follow the format of the plans in `context/archive/*/plan.md`: an overview, the changes required, automated and manual success criteria, and a Progress section at the end. Each phase leaves `main` green and can merge on its own.

## Phase 1: The port, and an adapter that serves it

### Overview

Add the port and the ACL's first modules, and move no consumer yet. The middleware puts `locals.backend` beside `locals.supabase`. Both are views of the one client it builds, so no second client exists. No outcome, and nothing a user sees, changes.

### Changes Required:

#### 1. The port

**File**: `src/lib/services/backend.ts` (new), `src/types.ts`

**Intent**: The interfaces of Step 4 and `SignedInUser`.

**Contract**:

- Types only. It imports from `@/types` and the services' own types, never `@supabase/*` or `astro:*`.
- Each read and write keeps today's function's outcome, without the client parameter.

#### 2. The client factory moves into the ACL

**File**: `src/lib/supabase.ts` → `src/lib/supabase/client.ts`; `eslint.config.js`

**Intent**: Today's `createClient`, unchanged, plus `openBackend`. `islandConfig` refuses `@/lib/supabase/*` as well as `@/lib/supabase` (`eslint.config.js:141`).

**Contract**: `openBackend(requestHeaders, cookies, responseHeaders): Backend | null` returns null without the env, as `createClient` does today.

#### 3. The adapter, delegating

**File**: `src/lib/supabase/adapter.ts`, `database.ts`, `session.ts` (new)

**Intent**:

- `backendOf(client)` answers each data operation through today's function, for example `list: () => listWatchlist(client)`.
- `counterOf(client)` makes today's two RPC calls (`src/lib/services/shop-gate.ts:180-206`) and answers with unions.
- `sessionOf(client)` makes the six Auth calls that the four auth routes, the middleware and `auth.ts` make today, through today's mappers in `auth.ts`.

**Contract**: No expected outcome is thrown, and each operation answers what today's function answers.

#### 4. The request context

**File**: `src/middleware.ts`, `src/env.d.ts`

**Intent**: Build the client once, keep `locals.supabase`, and add `locals.backend`.

**Contract**: One client per request, and `locals.backend` is null exactly when `locals.supabase` is.

#### 5. Tests

**File**: `src/lib/supabase/adapter.test.ts` (new), `src/lib/services/testing/memory-backend.ts` (new)

**Intent**:

- Over `stubSupabase`, each data operation sends the same queries as today's function (`queries` equal) and answers the same.
- The counter's and the session's unions are covered for an answer, an error and no answer.
- An in-memory `Backend` is ready for the next phases' domain tests.

**Contract**: A deliberate break, such as a wrong table name in one delegate, turns a case red.

### Success Criteria:

#### Automated Verification:

- The ACL's tests pass: `npx vitest run src/lib/supabase`
- The port names no SDK: `git grep -n "@supabase" -- src/lib/services/backend.ts` finds nothing
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

---

## Phase 2: Sign-in through the Session port

### Overview

The middleware, the four auth routes and the set-password page ask `backend.session`. `locals.user` becomes a `SignedInUser`. Auth's answers turn into the app's codes inside the ACL. Every route keeps its codes and redirects.

### Changes Required:

#### 1. The routes and the page

**File**: `src/pages/api/auth/signin.ts`, `signout.ts`, `confirm.ts`, `set-password.ts`; `src/pages/auth/set-password.astro`

**Intent**: Call `session.signIn`, `signOut`, `openLink` and `setPassword`. The set-password page calls `setPasswordRedirectOf(backend?.session ?? null, now)`.

**Contract**: Each answer leads to the same redirect as today, through `signInErrorHref`, `signOutBackTo`, `confirmBackTo` and `setPasswordBackTo`.

#### 2. The mappers move into the ACL

**File**: `src/lib/services/auth.ts` → `src/lib/supabase/session.ts`; their cases move from `auth.test.ts` to `src/lib/supabase/session.test.ts`

**Intent**:

- `AuthErrorFacts`, `tooManyRequests`, `authErrorCodeOf`, `confirmErrorCodeOf` and `passwordErrorCodeOf` move (`src/lib/services/auth.ts:57-79`, `:165-177`, `:276-295`).
- `isLinkSession(session: Session | null, now)` stays in `auth.ts`, over `session.claims()`.

**Contract**: `auth.ts` imports nothing from `@supabase/*`. The code types (`AuthErrorCode` and the rest) stay in `auth.ts` and `src/lib/notices.ts`, where the port names them.

#### 3. The signed-in user

**File**: `src/middleware.ts`, `src/env.d.ts`

**Intent**: `locals.user = backend === null ? null : await backend.session.user()`, typed as `SignedInUser`. The middleware's comment on `@supabase/ssr`'s cache headers (`src/middleware.ts:12-13`) moves to `client.ts`.

**Contract**: `user()` makes the same `getUser()` call as today (P-2 stays open). The pages keep `user?.email ?? null`.

### Success Criteria:

#### Automated Verification:

- The session's tests pass with the mappers' cases moved whole: `npx vitest run src/lib/supabase`
- Smoke passes against the preview and pins the auth routes' codes, redirects and origin refusals: `npm run build`, `npm run preview`, `npm run smoke`
- The e2e suite passes, and its run user signs in through the Polish form: `npx playwright test`
- No auth route, page, `auth.ts` or the middleware names the SDK or calls Auth: `git grep -nE "@supabase|\.auth\." -- src/pages src/middleware.ts src/lib/services/auth.ts` finds nothing
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

#### Manual Verification:

- The owner signs in and out on the local preview, and sets a password from a local recovery link made with `scripts/owner-link.mjs`

---

## Phase 3: Pages, routes and services ask the port

### Overview

Every reader and writer of the database outside the ACL takes the port instead of the client, and `locals.supabase` goes. The data-access services still hold their queries, and `database.ts` still delegates to them.

### Changes Required:

#### 1. The use cases

**File**: `src/lib/services/price-targets.ts`, `price-refresh.ts`, `shop-matching.ts`, `prices.ts` (`productPricesOf`), and `matches.ts`'s `loadWatchedProduct` once S-01 is merged

**Intent**: Each takes `Pick<Backend, …>` of the parts Step 4's table names.

**Contract**: Same results. For example, `refreshPrices(gate, priceObservations, targets, shops)`.

#### 2. The gate

**File**: `src/lib/services/shop-gate.ts`, `shop-gate.test.ts`

**Intent**:

- `shopGateFor(counter: RequestCounter | null)` bridges the port's unions to the gate's own `ShopGateDeps`.
- The Supabase binding (`:172-207`) and the SDK import go.

**Contract**:

- Without a counter, every call is skipped as `unavailable`, as today.
- The binding's cases (`shop-gate.test.ts:359-412`) move to the ACL's tests.

#### 3. The pages and the data routes

**File**: `src/pages/watchlist.astro`, `src/pages/watchlist/[id].astro`, `src/pages/api/watchlist.ts`, `src/pages/api/watchlist/matches.ts`, `prices.ts`, `refresh.ts`, `remove.ts`

**Intent**: Read `backend` from the locals. A null `backend` keeps its `config` codes and empty reads.

**Contract**: The same codes, redirects, statuses and JSON answers as today.

#### 4. The request context

**File**: `src/middleware.ts`, `src/env.d.ts`

**Intent**: `locals.supabase` goes.

**Contract**: `App.Locals` names no SDK type.

#### 5. The tests

**File**: `src/lib/services/price-targets.test.ts`, `price-refresh.test.ts`, `shop-matching.test.ts`, `price-routes.test.ts`, `price-pages.test.ts`, and `match-routes.test.ts` with `src/lib/services/testing/route-context.ts` once S-01 is merged

**Intent**:

- The domain tests that serve domain values move to the in-memory `Backend`.
- The route tests and the seam table build `backendOf(stubSupabase(…).client)`, so the real reading rules still meet canned rows.

**Contract**: No assertion is removed or loosened. The reservations and served URLs that the route tests count stay as they are.

### Success Criteria:

#### Automated Verification:

- The route tests and the seam table pass with their expectations unchanged: `npx vitest run src/lib/services/price-routes.test.ts src/lib/services/price-pages.test.ts`
- `locals.supabase` is gone: `git grep -n "locals.supabase" -- src` finds nothing
- Outside `src/lib/supabase/`, only the three data-access services, their tests and the stub name `SupabaseClient`: `git grep -l SupabaseClient -- src ':!src/lib/supabase'`
- The two-user check passes against the preview: `node scripts/check-two-users.mjs`
- Lint, type check, the whole unit suite and the e2e suite pass: `npm run lint`, `npx astro check`, `npm run test`, `npx playwright test`

---

## Phase 4: The database code moves behind the port

### Overview

The persistence halves of `watchlist.ts`, `matches.ts` and `prices.ts` move into the ACL, and `database.ts` stops delegating. One `DatabaseAnswer`, one time limit, one log line and one row loop replace the copies. The services keep their forms, redirects, texts and composition.

### Changes Required:

#### 1. The stored records

**File**: `src/lib/supabase/records.ts` (new), from the line ranges in Step 4's records table

**Intent**: The row schemas, column lists, mappers and odd-row rules.

**Contract**:

- No SDK import.
- Every case of today's row tests passes against it.
- A row that can't be read stays unread, never missing or undecided (`context/foundation/lessons.md:19-24`).

#### 2. The queries

**File**: `src/lib/supabase/database.ts`

**Intent**: The ten queries and the decision write's compare-and-swap, over `answerOf`.

**Contract**: Same outcomes. The log line keeps the code, the HTTP status and the hint, never the message (Open question 2).

#### 3. The services, without the SDK

**File**: `src/lib/services/watchlist.ts`, `matches.ts`, `prices.ts`

**Intent**: Keep `parseWatchlistForm`, `removalBackTo`, `productFullName`, `parseMatchForm`, `replacesFieldOf`, `decisionBackTo`, `priceShopsOf`, `productPricesOf` and the error texts.

**Contract**: The read models (`MatchesRead`, `MatchStatesRead`, `LatestPricesRead`, `ListPricesRead`) stay where they are, and the ACL imports them. None of the three imports the SDK.

#### 4. The tests

**File**: `src/lib/services/testing/stub-supabase.ts` → `src/lib/supabase/testing/`; the persistence cases of `watchlist.test.ts`, `matches.test.ts` and `prices.test.ts` → `src/lib/supabase/records.test.ts` and `database.test.ts`; `src/lib/services/matches.db.test.ts` → `src/lib/supabase/decisions.db.test.ts`

**Intent**: Move the cases whole.

**Contract**: `npm run test:db` still finds the database test, because `vitest.db.config.ts` includes `src/**/*.db.test.ts`.

### Success Criteria:

#### Automated Verification:

- The ACL's tests pass, with the persistence cases moved whole: `npx vitest run src/lib/supabase`
- The real decision write passes in every outdated-form case against the local stack: `npm run test:db`
- The success criterion holds: commands 1 to 4 above
- Lint, type check, the whole unit suite, smoke, the two-user check and the e2e suite pass

#### Manual Verification:

- With the shops held (`node scripts/e2e-local-db.mjs stop`, then `restore`), the owner opens the list and a product on the local preview and sees the same rows, prices and notices as before

---

## Phase 5: The boundary in lint, and the documents

### Overview

Make the boundary a rule, and record what changed. The glossary doesn't change: the port uses its terms and adds none.

### Changes Required:

#### 1. The boundary rule

**File**: `eslint.config.js`

**Intent**: A `no-restricted-imports` block for `src/**/*.{ts,tsx,astro}` that refuses:

- `@supabase/*` outside `src/lib/supabase/**`;
- `@/lib/supabase/*` outside `src/lib/supabase/**`, `src/middleware.ts` and `**/*.test.ts`.

**Contract**: An SDK import planted in a service, and one planted in a page, each fail lint. Without them, lint passes.

#### 2. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Update the gate's line (`:21`), the request lifecycle (`:53`), the null-client contract (`:54`), the link page's `verifyOtp` (`:56`) and the decision write's home (`:60`).

**Contract**: Project rules only. The 10x course block stays untouched.

#### 3. The test plan

**File**: `context/foundation/test-plan.md` §6.2 (`:124-130`)

**Intent**: Record the stub's new home, the in-memory `Backend` for a decision resting on stored rows, and a route test's `locals.backend`.

**Contract**: §6.2's five patterns stay. Only their helpers' homes and names change.

### Success Criteria:

#### Automated Verification:

- Lint refuses the planted imports, then passes without them: `npm run lint`
- Prettier leaves the edited documents as they are: `npx prettier --check CLAUDE.md context/foundation/test-plan.md`
- CI's `ci`, `smoke` and `e2e` jobs pass on the PR

#### Manual Verification:

- The owner reviews the `CLAUDE.md` and test plan changes

---

## Not doing

- **The platform.** The migrations, RLS and grants stay. So do the database checks, the e2e seeds and `scripts/owner-link.mjs`, which keep talking to Supabase directly. They test or seed the database itself, and the owner's secret key must never reach the app (`CLAUDE.md:17`).
- **New outcomes.** Reads keep null for unread. Writes keep `AddResult`, `RemoveResult`, `RecordResult` and `PriceRecordResult`. Only the client parameter goes. The new types (`DatabaseAnswer`, the counter's and the session's answers) are `kind` unions.
- **The gate's own seam.** `ShopGateDeps` keeps rejecting on an unreachable counter. `readReservation` keeps reading the SQL function's documented answer, not the SDK's shape (`src/lib/services/shop-gate.ts:46-56`, `:209-222`). `shopGateFor` bridges the port's unions to them. Rewriting them would change every test that builds a gate.
- **The guardian, M-2's rules and S-02's migration.**
- **Any user-visible change.** The "no configuration" text names the platform, which stays, and so do its three copies (`src/lib/notices.ts:146`, `src/lib/services/watchlist.ts:94`, `src/lib/services/matches.ts:183`). Merging them is a separate cleanup.
- **Generated database types and the 23503 narrowing (P-4)**, which are Open questions 5 and 6.
- **FR-015's daily refresh.** A cron job has no user session, so no `Backend` built from a session can serve it. Which backend it would get is the owner's policy, bound by "no secret key in the Worker" (`CLAUDE.md:17`). This plan only makes that a question about one adapter.

## Open questions

1. **The order against M-2.** Phases 1 and 2 touch no decision code and can go at any time. Phases 3 and 4 rewrite the same decision reads and writes, the decision route and the product page as S-02 and S-03. Should they run after S-03 merges (the default), or before S-02, so that `record_decision` is written once, inside `database.ts`? — Owner: user.
2. **The log line.** Should every database failure log one line with the operation, the code, the HTTP status and the hint, never the message (`prices.ts`'s rule)? That would replace the message that `watchlist.ts` and `matches.ts` log today and the message the gate's binding throws. The default is yes, which is the audit's X2 without its scrubbed message. — Owner: user.
3. **`httpOnly` session cookies (P-1).** Fold the one-line `cookieOptions` into Phase 2, or leave it with the parked hardening change and its own checks (the default)? — Owner: user.
4. **The middleware's Auth call (P-2).** Keep `getUser()` (the default), or switch to `getClaims()` once production's signing keys are known, which means a removed account keeps access until its token expires? — Owner: user.
5. **Generated database types.** Generate the schema's types into the ACL, so the compiler checks column names against the migrations (`context/map/repo-map.md:113`)? The default is not in this refactor. — Owner: user.
6. **Which 23503 means `gone` (P-4).** Narrow it to `watchlist_matches_own_product`, as the audit's W5 suggests? The default keeps today's mapping. — Owner: user.

## Unknowns

- Production's token signing keys and Auth settings are outside the repository (P-2).
- S-01's final shape is unknown: this plan cites its branch at 3df527b, and it may change before it merges.
- Whether ESLint's `no-restricted-imports` matches a path inside a restricted directory wasn't checked. The plan names both `@/lib/supabase` and `@/lib/supabase/*` instead of relying on it.
- The test move is counted by file (12), not by case.
- The cost of building the `Backend`'s objects on each request wasn't measured. It does no I/O.
- Where Postgres puts a constraint's name (P-4) wasn't checked against a live answer.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The port, and an adapter that serves it

#### Automated

- [ ] 1.1 The ACL's tests pass
- [ ] 1.2 The port names no SDK
- [ ] 1.3 Lint, type check and the whole unit suite pass

### Phase 2: Sign-in through the Session port

#### Automated

- [ ] 2.1 The session's tests pass with the mappers' cases moved whole
- [ ] 2.2 Smoke passes against the preview
- [ ] 2.3 The e2e suite passes
- [ ] 2.4 No auth route, page, `auth.ts` or the middleware names the SDK or calls Auth
- [ ] 2.5 Lint, type check and the whole unit suite pass

#### Manual

- [ ] 2.6 The owner signs in and out, and sets a password from a local recovery link

### Phase 3: Pages, routes and services ask the port

#### Automated

- [ ] 3.1 The route tests and the seam table pass with their expectations unchanged
- [ ] 3.2 `locals.supabase` is gone
- [ ] 3.3 Outside the ACL, only the three data-access services, their tests and the stub name `SupabaseClient`
- [ ] 3.4 The two-user check passes against the preview
- [ ] 3.5 Lint, type check, the whole unit suite and the e2e suite pass

### Phase 4: The database code moves behind the port

#### Automated

- [ ] 4.1 The ACL's tests pass with the persistence cases moved whole
- [ ] 4.2 The database tests pass against the local stack
- [ ] 4.3 The success criterion holds
- [ ] 4.4 Lint, type check, the whole unit suite, smoke, the two-user check and the e2e suite pass

#### Manual

- [ ] 4.5 The owner sees the same list and product page on the local preview, with the shops held

### Phase 5: The boundary in lint, and the documents

#### Automated

- [ ] 5.1 Lint refuses the planted imports, then passes without them
- [ ] 5.2 Prettier leaves the edited documents as they are
- [ ] 5.3 CI's `ci`, `smoke` and `e2e` jobs pass on the PR

#### Manual

- [ ] 5.4 The owner reviews the `CLAUDE.md` and test plan changes
