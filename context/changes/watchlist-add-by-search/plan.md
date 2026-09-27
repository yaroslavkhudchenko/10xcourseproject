# Watchlist: Add a Product by Searching Implementation Plan

## Overview

A signed-in user searches Rossmann's product search from a new Polish-language `/watchlist` page, picks one result, and finds the product on their private watchlist. Picking fixes the product's identity, and its EANs are stored as helpers (FR-004).

This is roadmap item **S-01** (Change ID `watchlist-add-by-search`). It covers FR-003, FR-004 and the add half of FR-005. It's the first slice that calls a shop, through the F-01 gate, and the first that stores personal data.

## Current State Analysis

- **No product pages or tables.**
  - Only the auth pages and the starter's placeholders exist (`src/pages/index.astro`, `src/pages/dashboard.astro`).
  - The only migration is F-01's shop gate (`supabase/migrations/20260926112205_polite_shop_access.sql`), which is already on production.
- **One protected route.**
  - `src/middleware.ts:4` protects only `/dashboard`.
  - The middleware builds a Supabase client per request (`:7`) but keeps only `locals.user` (`:13`).
  - API routes build a second client (`src/pages/api/auth/signin.ts:9`).
- **Sign-in lands on the starter home page.**
  - `src/pages/api/auth/signin.ts:19` redirects to `/`.
  - The smoke test accepts any location that starts with `/` (`scripts/smoke.mjs:54`, `:66`).
- **Cache headers are dropped.**
  - When it writes auth cookies, `@supabase/ssr` 0.12.7 calls `setAll(cookiesToSet, headers)` with `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires` and `Pragma`. `src/lib/supabase.ts:14-18` ignores that second argument.
  - The deploy plan defers these headers until "before the first page with user data" (`context/deployment/deploy-plan.md`, Deferred). That's this slice.
- **The gate is ready.**
  - For `rossmann`, `shopGateFor(supabase)` in `src/lib/services/shop-gate.ts` allows only `www.rossmann.pl`.
  - It sets the descriptive User-Agent, never follows redirects, and fails closed.
  - CLAUDE.md sets three rules for callers: validate search text with zod before it goes into a shop URL, read an `ok` body promptly, and assert replayed URLs in tests.
- **Rossmann search is documented but not recorded** (`docs/research/polish-drugstore-price-apis.md` §2.1).
  - `GET https://www.rossmann.pl/products/v4/api/Products?search=<q>&page=1&pageSize=24` returns `data.{items[], totalCount, spellCheckHint, …}`. Items carry `id, brand, name, caption, unit, eanNumber[], pictures[], …`.
  - Search is text only: an EAN query returns nothing.
  - `name` can end in a trailing space, and one item can list several EANs.
  - No document records the shape of `pictures[]` or `spellCheckHint`.
- **UI conventions.**
  - Pages use `src/layouts/Layout.astro`, which hard-codes `lang="en"` (`:14`), and the starter's glass style.
  - Forms post to `src/pages/api/**` and redirect back with query parameters (`src/pages/auth/signin.astro:5`).
  - zod comes from `astro/zod`, which also loads under plain Node (checked), and JSON imports are enabled (`resolveJsonModule`).

## Desired End State

- **Landing:** signing in lands on `/watchlist`. The page is in Polish and shows a search box and the user's list, newest first.
- **Search:**
  - Submitting a search makes one gate request to Rossmann and shows up to 24 results, each with brand, name, description, size and a thumbnail.
  - A spelling hint from Rossmann appears as "Czy chodziło Ci o: …?" and re-runs the search in one tap.
  - When the gate skips the call or Rossmann fails, the page says search is unavailable.
  - Invalid search text makes no shop call.
- **Adding:** "Dodaj" stores the picked product in `public.watchlist_items`: one private row per user and product, which only its owner can read and insert under RLS. Adding the same product again shows a notice instead of a duplicate.
- **Caching:** every signed-in response is `Cache-Control: private, no-store`.
- **CI:** CI proves the RLS contract with two users, the adapter against recorded Rossmann responses, and the page's auth flow in the smoke test.

How to verify:

- CI is green on the PR.
- The Phase 3 phone-viewport walk-through passes locally.
- After the owner's `db push`, the dashboard shows the table with RLS and two policies.

### Key Discoveries:

- `src/middleware.ts:7` builds the only client a request should have. `@supabase/ssr` sends its cache headers once per client, so a second client in a route loses them.
- `node_modules/@supabase/ssr/dist/main/types.d.ts:35-58`: `setAll(cookiesToSet, headers)` passes the cache headers only when it writes auth cookies. User pages therefore also need their own `private, no-store`.
- `src/lib/services/shop-gate.ts`: `SHOP_HOSTS.rossmann` is `["www.rossmann.pl"]`, so the search URL must use exactly that host, over https.
- `supabase/migrations/20260926112205_polite_shop_access.sql` shows the pattern: an explicit `revoke all … from anon, authenticated, service_role`, then `grant`. It's needed because turning auto-expose off still leaves TRUNCATE, REFERENCES and TRIGGER.
- `scripts/check-shop-gate-db.mjs` shows the database-check pattern: PASS/FAIL lines, a localhost-only guard and throwaway sign-ups, run in the smoke job.
- PostgreSQL applies neither RLS nor the inserting role's privileges to foreign-key checks. `watchlist_items.source` can therefore reference `public.shops (id)`, even though `authenticated` has no grant on `shops`.

## What We're NOT Doing

- **No removing or hiding** watchlist entries (S-08), and no update policy.
- **No per-shop matching** (S-02). The Rossmann item id is stored as the product's source, not as a confirmed match.
- **No prices.** Nothing price-related is shown or stored, and no price observations are written (S-03).
- **No other search source:** no Natura or other shop, no fallback and no merged results.
- **No search as you type**, no pagination beyond the first 24 results, and no size filter or separate size field.
- **No search-result caching** and no new bindings (KV, Durable Objects).
- **No shared products table.** Each user's row carries its own copy of the product.
- **No front-door work** (S-07). `/`, `/dashboard` and `/auth/*` stay, except that sign-in lands on `/watchlist` and the home page's top bar links there. The starter's English pages aren't translated.
- **No image proxying.** Thumbnails load in the browser straight from Rossmann's CDN.

## Implementation Approach

1. **Database first**, as in F-01. The private table and its RLS contract are proven against a local Supabase before any code writes to it.
2. **The Rossmann adapter:** a pure module over an injected gate, tested against recorded responses replayed through the real gate.
3. **The server-rendered page and the form route.** They reuse the middleware's single Supabase client and add the cache headers. The page needs no React island: search is a GET form and "Dodaj" is a POST form, so both work without JavaScript.
4. **Docs and the owner's production steps:** Workers Paid and `db push`, both before the merge.

## Critical Implementation Details

- **Timing & lifecycle:** `/watchlist` queries `watchlist_items` on every render, so the owner runs `npx supabase db push` from the branch before merging. Merging first would deploy a page whose query fails. Once pushed, the migration file is frozen, like F-01's.
- **State sequencing:** the middleware applies the collected `setAll` headers and `Cache-Control: private, no-store` to the response returned by `next()`. Routes and pages must use `locals.supabase`, never a client of their own, or the headers are lost.
- **User experience spec:** thumbnails render only from `https` URLs on a `rossmann.pl` host, lazily, with `referrerpolicy="no-referrer"`. The page's URL carries the search text, so it must never reach the shop.

## Phase 1: Watchlist data contract

### Overview

Create the private watchlist table with per-operation RLS and explicit grants. Then prove against the local Supabase, with two users, that no one can see, add to or change another user's list.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_watchlist_items.sql`

**Intent**: Store each user's watched products as private rows that carry the picked product's identity. Only their owner can read or insert them.

**Contract**:

- **`public.watchlist_items`:**
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null default auth.uid() references auth.users (id) on delete cascade`
  - `source text not null references public.shops (id)`: the shop whose search the product came from (`rossmann` in S-01)
  - `source_item_id text not null`: that shop's own product id (Rossmann's `id`)
  - `brand text`, `name text not null` (1–300 characters), `caption text`
  - `size_text text`, as the shop wrote it
  - `size_value numeric` and `size_unit text` (limited to `ml`, `g` and `pcs`): both set or both null, and `size_value > 0`
  - `eans text[] not null default '{}'`: helpers only (FR-004)
  - `image_url text`
  - `created_at timestamptz not null default now()`
  - `unique (user_id, source, source_item_id)`
  - A table comment: private per user; in S-08, removal hides an entry and never deletes shared data.
- **RLS:** enabled, with one policy per operation for `authenticated`:
  - select: `using ((select auth.uid()) = user_id)`
  - insert: `with check ((select auth.uid()) = user_id)`
  - no update or delete policy
- **Privileges:** `revoke all on table public.watchlist_items from anon, authenticated, service_role;`, then `grant select, insert on table public.watchlist_items to authenticated;`.

#### 2. Database contract check

**File**: `scripts/check-watchlist-db.mjs`

**Intent**: Prove the table's privacy and grants against a running local Supabase, in the style of `scripts/check-shop-gate-db.mjs`.

**Contract**:

- **Setup:**
  - It reads `SUPABASE_URL` and `SUPABASE_KEY`, and refuses any host other than `127.0.0.1` or `localhost`.
  - It signs up two throwaway users, A and B, each with their own client.
- **Assertions:**
  1. A adds a Rossmann row and reads back exactly that one row.
  2. A adding the same Rossmann item again fails with `23505`.
  3. B's select returns none of A's rows, including a select by A's row id.
  4. B inserting a row with A's `user_id` fails the RLS check.
  5. B adds their own row, and A still reads only their own.
  6. A's update and delete of their own row are refused.
  7. Without a session, select and insert both fail with `42501`.
  8. A row whose `source` is `dm` fails the foreign key (`23503`).
- **Result:** it exits 1 on any failure. Each run signs up fresh users, so reruns need no reset.

#### 3. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Run the watchlist contract check on every push and PR.

**Contract**: add a step "Check watchlist database contract" to the `smoke` job, after "Check shop gate database contract". It sources `supabase.env` and runs `node scripts/check-watchlist-db.mjs` with `SUPABASE_URL=$API_URL` and `SUPABASE_KEY=$ANON_KEY`.

### Success Criteria:

#### Automated Verification:

- With Docker running: `npx supabase db reset --local`, then `node scripts/check-watchlist-db.mjs` with the local URL and anon key prints only PASS lines
- `npm run lint` passes
- CI `smoke` job runs "Check watchlist database contract" and is green on the PR

#### Manual Verification:

- Migration review: one policy per operation for `authenticated` only, revoke then grant select and insert, no update or delete path, and no way to read another user's rows

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Rossmann search

### Overview

Add the product search. First record real Rossmann responses once. Then build the adapter that turns a validated query into product candidates through the gate, with size parsing and the spelling hint, tested only against those recordings.

### Changes Required:

#### 1. Recorded Rossmann responses

**Files**: `src/lib/services/shops/fixtures/rossmann-search-results.json`, `src/lib/services/shops/fixtures/rossmann-search-misspelled.json`, `src/lib/services/shops/fixtures/rossmann-search-empty.json`

**Intent**: Capture the real response shape, including the undocumented `pictures[]` and `spellCheckHint`, so the adapter and its tests follow reality and not just the research note.

**Contract**:

- A one-off manual recording from the developer machine, never from CI or app code: three `curl` requests, at least 2 seconds apart, with the gate's User-Agent and `Accept: application/json`:
  - a normal query (`nivea soft`)
  - a misspelled query that returns a spelling hint, for example `niwea soft` (try another if Rossmann gives no hint)
  - a query that finds nothing
- Keep each response body as returned, trimmed to its first 5 items to keep the repository small.

#### 2. Shared product types

**File**: `src/types.ts`

**Intent**: One definition of a search candidate and of the search outcome, shared by the adapter, the page and the add route.

**Contract**:

- `SizeUnit = "ml" | "g" | "pcs"`
- `ProductCandidate`:
  - `source: ShopId`, `sourceItemId: string`
  - `brand: string | null`, `name: string`, `caption: string | null`
  - `sizeText: string | null`, `size: { value: number; unit: SizeUnit } | null`
  - `eans: string[]`, `imageUrl: string | null`
- `ProductSearch`: `{ kind: "results"; candidates: ProductCandidate[]; spellingHint: string | null }` or `{ kind: "unavailable" }`

#### 3. Size parsing

**File**: `src/lib/services/size.ts`

**Intent**: Turn a shop's size text into a comparable value in ml, g or pieces, for S-02's size checks. A size that can't be parsed stays as text only.

**Contract**: `parseSize(text: string | null): { value: number; unit: SizeUnit } | null`.

- It reads a decimal comma or point.
- It converts `l` to ml and `kg` to g.
- It reads `szt`, `szt.` or `sztuk` as pieces.
- Anything else gives `null`, including multipacks such as `2 x 50 ml`.

#### 4. Search text validation

**File**: `src/lib/services/search-query.ts`

**Intent**: The single check for text that goes into a shop URL (the CLAUDE.md gate rule). Odd input then can't provoke a shop's WAF into a 403 that stops the shop for everyone.

**Contract**: `searchQuerySchema` from `astro/zod`. It trims and collapses whitespace, then requires 2–80 characters made of letters (any script), digits, spaces and `. , % & ' + / ( ) -`.

#### 5. Rossmann adapter

**File**: `src/lib/services/shops/rossmann.ts`

**Intent**: Search Rossmann through the gate and return either candidates or a clean "unavailable", never an exception or half-parsed data.

**Contract**:

- `searchRossmann(gate: ShopGate, query: string): Promise<ProductSearch>`. The caller passes text already validated by `searchQuerySchema`.
- It calls `gate.fetch("rossmann", "https://www.rossmann.pl/products/v4/api/Products?search=<encoded>&page=1&pageSize=24", { headers: { Accept: "application/json" } })`.
- **Failures:**
  - Any gate outcome other than `ok` gives `unavailable`; the gate has already logged it.
  - On `ok`, it reads the body right away. A read error, invalid JSON or a missing `data.items` gives `unavailable`, with one log line.
  - It checks each item on its own with zod and drops items that don't fit, so one odd item doesn't blank the search.
- **Mapping:**
  - `sourceItemId`: `String(id)`
  - `name` and `brand`: trimmed
  - `sizeText` from `unit`, and `size` from `parseSize(unit)`
  - `eans` from `eanNumber`, keeping only 8–14-digit values
  - `imageUrl`: the first picture URL that is `https` on a `rossmann.pl` host, with the field name taken from the recorded fixture; otherwise `null`
  - `spellingHint`: `spellCheckHint` when it's a non-empty string, otherwise `null`

#### 6. Tests

**Files**: `src/lib/services/shops/rossmann.test.ts`, `src/lib/services/size.test.ts`, `src/lib/services/search-query.test.ts`

**Intent**: Pin the adapter against the recordings, through the real gate, and pin the size and search-text rules. A change in Rossmann's shape or in the mapping then fails CI.

**Contract**:

- **Adapter tests:** build a real gate with `createShopGate` (a reservation that allows, and a `reportBlock` spy) over `createReplayFetch` serving the fixtures. Assert the requested URL in every case. Cases:
  - results mapped from the normal fixture, with trimmed names, parsed sizes, EANs, and only https Rossmann images
  - the spelling hint surfaced from the misspelled fixture
  - an empty result
  - a skipped reservation gives `unavailable`, with no fetch
  - a body that errors while it's read gives `unavailable`
  - invalid JSON gives `unavailable`
  - one malformed item is dropped and the others are kept
- **`size.test.ts`:** a table covering `300 ml`, `0,5 l`, `1 l`, `50 g`, `1 kg` and `10 szt.`, plus `2 x 50 ml` and an empty value, both giving `null`.
- **`search-query.test.ts`:**
  - accepts Polish text with sizes, such as `żel pod prysznic 0,5 l`
  - rejects text that's too short or too long, `<script>`, and control characters

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the adapter, size and search-text tests
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Fixture review: three real Rossmann responses recorded with the gate's User-Agent at least 2 seconds apart, including a `spellCheckHint` sample and `pictures[]`, with no cookies or personal data

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Watchlist page and add flow

### Overview

Wire the search and the list into a Polish `/watchlist` page, with a form route for adding. Make every signed-in response uncacheable, and point sign-in and the home page's top bar at the new page.

### Changes Required:

#### 1. One Supabase client per request, with its cache headers

**Files**: `src/lib/supabase.ts`, `src/env.d.ts`, `src/middleware.ts`

**Intent**: Build the request's only Supabase client in the middleware and share it through `locals`. No response that carries user data can then be cached.

**Contract**:

- `createClient(requestHeaders, cookies, responseHeaders?: Headers)`: `setAll` also copies the headers it receives into `responseHeaders`. It still returns `null` when the env is missing.
- `App.Locals` gains `supabase: SupabaseClient | null`.
- The middleware:
  - stores the client in `locals.supabase`
  - adds `/watchlist` and `/api/watchlist` to `PROTECTED_ROUTES`
  - after `next()`, applies the collected headers, plus `Cache-Control: private, no-store` whenever a user is signed in

#### 2. Auth routes reuse the shared client

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`, `src/pages/api/auth/signout.ts`

**Intent**: The routes' cookie writes then carry `@supabase/ssr`'s cache headers, and sign-in lands on the new page.

**Contract**: each route uses `context.locals.supabase` instead of calling `createClient`. It keeps its existing redirects and `?error=` handling, except that a successful sign-in now redirects to `/watchlist`.

#### 3. Watchlist service

**File**: `src/lib/services/watchlist.ts`

**Intent**: Keep the page and the route thin. The service validates a posted candidate, adds it and lists the user's items, all through the user's own client, so RLS does the enforcing.

**Contract**:

- `watchlistAddSchema` (`astro/zod`) validates the posted form:
  - `source` must be `rossmann`, and `sourceItemId` is 1–12 digits.
  - `name` is 1–300 characters, `brand` up to 120, `caption` up to 300 and `sizeText` up to 40.
  - `eans` holds up to 10 values of 8–14 digits.
  - `imageUrl` is https on a `rossmann.pl` host, up to 500 characters, or empty.
  - `q` is the search text to return to.
  - The server derives the size again from `sizeText` with `parseSize`. It never takes size numbers from the form.
- `addToWatchlist(supabase, candidate)` returns `added`, `exists` (on `23505`) or `failed`.
- `listWatchlist(supabase)` returns the user's items, newest first.

#### 4. The page

**Files**: `src/pages/watchlist.astro`, `src/layouts/Layout.astro`

**Intent**: The screen the shopper uses at the shelf: search, pick, and see what they watch. It must be readable on a phone and written in Polish.

**Contract**:

- `Layout.astro` gains a `lang` prop, defaulting to `en`. The page passes `pl`.
- **Header:** the title "Moja lista", the user's email, and a sign-out form.
- **Search form:** a GET form to `/watchlist` with an input `q` (label "Szukaj produktu", placeholder "np. nivea soft 300 ml") and a "Szukaj" button.
- **Search result states:**
  - Invalid `q` shows a validation message and makes no shop call.
  - Valid `q` calls `searchRossmann(shopGateFor(Astro.locals.supabase), q)`.
  - `unavailable` shows "Wyszukiwarka Rossmanna jest chwilowo niedostępna. Spróbuj za chwilę."
  - **Results:** each result shows a thumbnail, brand and name, description, and size.
    - Its action is a "Dodaj" POST form with the candidate's fields as hidden inputs, or "Na liście" when the item is already on the user's list.
    - A line "Wyniki z wyszukiwarki rossmann.pl" credits the source.
  - A spelling hint shows "Czy chodziło Ci o: <hint>?", linking to `/watchlist?q=<hint>`.
  - No results shows "Brak wyników dla „<q>”."
- **Notices from redirects:**
  - `added=1`: "Dodano do listy."
  - `exists=1`: "Ten produkt jest już na Twojej liście."
  - `error=<message>`: the message itself
- **The list:**
  - Newest first. Each item shows its thumbnail, brand and name, description, size and "dodano <date>" in `pl-PL`.
  - The empty state reads "Twoja lista jest pusta. Wyszukaj produkt powyżej."
- **Layout:** the starter's glass style in a single mobile-first column, tap targets of at least 44 px, and thumbnails with `loading="lazy"` and `referrerpolicy="no-referrer"`.

#### 5. The add route

**File**: `src/pages/api/watchlist.ts`

**Intent**: Handle "Dodaj" the way the auth routes handle their forms.

**Contract**: `export const POST: APIRoute`.

- It parses the form with `watchlistAddSchema`.
- An invalid form or a missing client redirects to `/watchlist?error=<Polish message>`.
- Otherwise it calls `addToWatchlist` and redirects:
  - `added` → `/watchlist?added=1`
  - `exists` → `/watchlist?exists=1`
  - `failed` → `?error=`
- It makes no shop request.

#### 6. Links and smoke test

**Files**: `src/components/Topbar.astro`, `scripts/smoke.mjs`

**Intent**: Make the page reachable from the home page, and keep the auth smoke test covering the new landing without touching any shop.

**Contract**:

- In the Topbar, the "Dashboard" link becomes "Moja lista" → `/watchlist`.
- New smoke steps:
  - An anonymous `/watchlist` redirects to `/auth/signin`.
  - Sign-in's location starts with `/watchlist`.
  - A signed-in `/watchlist`, without `q` so that no shop is called, returns 200 with a `cache-control` that contains `no-store`.
- The existing dashboard steps stay.

#### 7. Service tests

**File**: `src/lib/services/watchlist.test.ts`

**Intent**: Pin the form validation, since the posted fields end up in the user's row.

**Contract**:

- `watchlistAddSchema` accepts a candidate built from the normal fixture.
- It rejects:
  - a non-Rossmann `source`
  - a non-digit `sourceItemId`
  - an `http` or foreign-host `imageUrl`
  - an oversized `name`
  - more than 10 EANs
- The size is derived from `sizeText`, whatever size numbers are posted.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes
- CI `ci` and `smoke` jobs are green on the PR, including the new `/watchlist` smoke steps

#### Manual Verification:

- Phone-viewport walk-through against `npm run dev` with the local Supabase: sign-in lands on `/watchlist`; `nivea soft` shows results with thumbnails and sizes; a misspelling offers "Czy chodziło Ci o…"; "Dodaj" puts the product at the top of the list; adding it again shows the notice; a second user sees an empty list

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Docs and production rollout

### Overview

Record the new rules in CLAUDE.md, and prepare production before the merge: the paid Workers plan for the first shop-calling feature, and the migration pushed.

### Changes Required:

#### 1. Project rules

**File**: `CLAUDE.md` (project section only, above the 10x-cli block)

**Intent**: Future sessions reuse the request's client, keep user pages uncacheable, and record shop fixtures the agreed way.

**Contract**:

- **Commands:** add `node scripts/check-watchlist-db.mjs`, which needs `npx supabase start` and the local URL and anon key.
- **Architecture:**
  - The middleware owns the request's only Supabase client (`locals.supabase`); routes and pages never create another.
  - Every signed-in response is `private, no-store`.
  - `/watchlist` is the main screen.
  - Product search uses Rossmann's search through `src/lib/services/shops/rossmann.ts`.
  - The app's own text is Polish.
- **Testing:** shop fixtures live in `src/lib/services/shops/fixtures/`. They're recorded once with `curl` using the gate's User-Agent, at least 2 seconds apart, and never from CI.

#### 2. Production (owner)

**Where**: the owner's Cloudflare dashboard and terminal, on `feat/watchlist-add-by-search`, before the merge.

**Intent**: The merge deploys the first shop-calling feature and a page that needs its table, so both must be in place first.

**Contract**:

1. Switch Cloudflare Workers to the Paid plan. This gives CPU headroom over the Free plan's 10 ms and was decided in the deploy plan.
2. Run `npx supabase db push --dry-run`, which should list only the watchlist migration, then `npx supabase db push`. The link from F-01 still applies. After the push, the migration file is frozen.

### Success Criteria:

#### Automated Verification:

- CI `ci` and `smoke` jobs are green on the PR after the documentation changes

#### Manual Verification:

- Workers Paid plan is active on the account
- Owner ran `npx supabase db push` (the dry run listed only the watchlist migration) and it reported success
- Supabase dashboard shows `watchlist_items` with RLS on and its two policies; Security Advisor shows no errors
- CLAUDE.md updates reviewed

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- **Rossmann adapter:** runs over the three recorded responses through the real gate and asserts the requested URLs. It covers:
  - mapping, trimming, sizes and EANs
  - the image host rule
  - the spelling hint and empty results
  - a skipped reservation
  - body read errors and invalid JSON
  - one malformed item
- **Size parsing:** units, decimal commas, `l` and `kg` conversion, pieces, and `null` for multipacks and blanks.
- **Search text:** Polish letters and sizes pass; the length limits, markup and control characters are rejected.
- **Add form:** field limits, the host and scheme rules for images, and the size derived again from the text.

### Integration Tests:

- **`scripts/check-watchlist-db.mjs`** runs in the CI `smoke` job, against a fresh local Supabase with production-like grants. It checks:
  - only the owner can read a row
  - no insert on another user's behalf
  - duplicates are refused
  - no updates or deletes
  - anon is denied
  - the source must be a valid shop
- **`scripts/smoke.mjs`:** `/watchlist` is protected, sign-in lands there, and the signed-in page is `no-store`. CI makes no shop call.

### Manual Testing Steps:

1. Phase 3's phone-viewport walk-through, on the dev server with the local Supabase. It sends a handful of real Rossmann searches through the gate.
2. After the merge and before `/10x-archive`: on your phone, against production, sign in, search, add a product and see it on the list.

## Performance Considerations

- **Shop traffic:** one gate reservation and one Rossmann request per search, and none per add. That's well inside 30 a minute for a handful of users.
- **CPU:** parsing up to 24 items is small against the Paid plan's limit. On the Free plan's 10 ms it would be tight, which is why Workers Paid comes first.
- **The list query** reads only the user's rows, through RLS. At this size, the unique index on `(user_id, source, source_item_id)` covers the filter.

## Migration Notes

- **Additive:** a new table with RLS and grants, and no data changes. Before any other slice depends on it, rolling back means dropping the table.
- **Order:** `db push` from the branch first, then the merge. Once pushed, the migration file is frozen, and any later change goes into a new migration.
- **Never run `supabase config push`**: it would push `enable_signup = true` to production.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-01 `watchlist-add-by-search`)
- PRD: FR-003, FR-004 and FR-005, the non-functional requirement "Watchlists are private", and Open Question 3 (`context/foundation/prd.md`)
- Rossmann search: `docs/research/polish-drugstore-price-apis.md` §2.1, §6, §7 and §9
- The shop gate and its caller rules: `src/lib/services/shop-gate.ts`, the CLAUDE.md Non-negotiables, and the F-01 plan `context/archive/2026-09-26-polite-shop-access/plan.md`
- The anti-caching item: `context/deployment/deploy-plan.md` (Deferred)
- Patterns: `src/middleware.ts:4-24`, `src/pages/api/auth/signin.ts:4-20`, `src/pages/auth/signin.astro:5`, `scripts/check-shop-gate-db.mjs`, `supabase/migrations/20260926112205_polite_shop_access.sql`
- The `@supabase/ssr` 0.12.7 `setAll` contract: `node_modules/@supabase/ssr/dist/main/types.d.ts:35-58`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Watchlist data contract

#### Automated

- [x] 1.1 With Docker running: `npx supabase db reset --local`, then `node scripts/check-watchlist-db.mjs` with the local URL and anon key prints only PASS lines — c2f70a8
- [x] 1.2 `npm run lint` passes — c2f70a8
- [x] 1.3 CI `smoke` job runs "Check watchlist database contract" and is green on the PR — c2f70a8

#### Manual

- [x] 1.4 Migration review: one policy per operation for `authenticated` only, revoke then grant select and insert, no update or delete path, and no way to read another user's rows — c2f70a8

### Phase 2: Rossmann search

#### Automated

- [x] 2.1 `npm run test` passes, including the adapter, size and search-text tests — b91df96
- [x] 2.2 `npx astro sync && npx astro check` reports 0 errors — b91df96
- [x] 2.3 `npm run lint` passes — b91df96
- [x] 2.4 `npm run build` passes — b91df96

#### Manual

- [x] 2.5 Fixture review: three real Rossmann responses recorded with the gate's User-Agent at least 2 seconds apart, including a `spellCheckHint` sample and `pictures[]`, with no cookies or personal data — b91df96

### Phase 3: Watchlist page and add flow

#### Automated

- [x] 3.1 `npm run test` passes — 15c0ffc
- [x] 3.2 `npx astro sync && npx astro check` reports 0 errors — 15c0ffc
- [x] 3.3 `npm run lint` passes — 15c0ffc
- [x] 3.4 `npm run build` passes — 15c0ffc
- [x] 3.5 CI `ci` and `smoke` jobs are green on the PR, including the new `/watchlist` smoke steps — 15c0ffc

#### Manual

- [x] 3.6 Phone-viewport walk-through against `npm run dev` with the local Supabase: sign-in lands on `/watchlist`; `nivea soft` shows results with thumbnails and sizes; a misspelling offers "Czy chodziło Ci o…"; "Dodaj" puts the product at the top of the list; adding it again shows the notice; a second user sees an empty list — 15c0ffc

### Phase 4: Docs and production rollout

#### Automated

- [ ] 4.1 CI `ci` and `smoke` jobs are green on the PR after the documentation changes

#### Manual

- [x] 4.2 Workers Paid plan is active on the account
- [x] 4.3 Owner ran `npx supabase db push` (the dry run listed only the watchlist migration) and it reported success
- [x] 4.4 Supabase dashboard shows `watchlist_items` with RLS on and its two policies; Security Advisor shows no errors
- [x] 4.5 CLAUDE.md updates reviewed
