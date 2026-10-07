# Route and database seams (test plan rollout Phase 2) Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md` gives risks #1, #3, #4 and #6 the cheapest test that would catch each of them breaking at the seams the existing tests never cross:

- **#1:** the list and the product page agree on what a stored state means.
- **#3:** the routes and the pages ask shops only what they should.
- **#4:** a second real user is refused through every route.
- **#6:** a stale decision loses against the real database.

The research (`research.md`) found the rules themselves well proven. What's missing is page wiring nobody tests, route handlers nobody calls in a test, and a decision write proven only through a stub.

The phase also carries three of the owner's calls of 2026-10-07:

- an unreadable price history no longer hides a price;
- the gate accepts only the hosts the shop adapters call;
- four edges are recorded as accepted rather than fixed.

## Current State Analysis

- **No Vitest test reaches a page or a route handler.** The page logic that decides what a shopper sees or what a shop is asked lives partly in `.astro` frontmatter (research §1.2, §2.4).
- **Risk #1:**
  - Both pages call the same rule functions (`compareShops`, `verdictOf`), but feed them differently. The product page's price wiring (`src/pages/watchlist/[id].astro:116-143`) and its selected row's tag (`:197-212`) are untested.
  - A history the product page can't read makes its whole row unread (`src/lib/services/prices.ts`, `PAGE_VIEW`). So the list can mark a shop „Najtaniej” while the product page says its price couldn't be read.
  - The only proof that both pages agree is one e2e spec of four fault-free products (`tests/e2e/price-honesty.spec.ts:39-158`).
  - The database refuses odd price rows, so faults can only be stubbed (research §1.4).
- **Risk #3:**
  - Every service's shop requests are counted through a real gate over recorded answers.
  - The two price routes (`src/pages/api/watchlist/prices.ts`, `refresh.ts`) and the search page's decision (`src/pages/watchlist.astro:36-46`) are not.
  - `SHOP_HOSTS` admits four page hosts that no adapter calls (`src/lib/services/shop-gate.ts:9-14`).
  - Nothing stops a new server file calling `fetch` on a shop directly.
- **Risk #4:**
  - The database scripts prove two-user privacy for the watchlist, the decisions and the prices.
  - Routes scope by RLS alone. Every route answers another user's id as it answers a missing one, by the code, but only the missing-id side is tested, with one user (`scripts/smoke.mjs`).
  - Nothing fails on a new relation without RLS. Gaps G1, G2 and G4 (research §3.2) are untested.
- **Risk #6:**
  - The compare-and-swap lives only in `record`'s query (`src/lib/services/matches.ts:334-356`), since RLS allows any state (`supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:19-29`).
  - It is proven only through a stub's canned empty answer (`src/lib/services/matches.test.ts:724-741`).
- **Infrastructure:**
  - CI's `ci` job, the end-of-turn hook and this machine run Vitest without a database (`vitest.config.ts:11`, `.github/workflows/ci.yml:10-25`, `.claude/hooks/end-of-turn.mjs:70`). This machine has no Docker.
  - The `smoke` job has the local stack and serves the preview (`.github/workflows/ci.yml:27-107`).
  - There is no shared Supabase stub.

## Desired End State

- **#1:** a table of mixed and faulty stored states runs through both pages' own reads and wiring. It shows:
  - the same price verdict on both, wherever the owner's call says they agree;
  - each page's own honest answer where they differ by design;
  - the selected row's tag equal to the list row's tag.

  A history the product page can't read leaves its price, and the verdict, as the list shows them.

- **#3:**
  - Tests call the two price routes' handlers with a real gate, and count the served URLs and reservations: none for every refusal, and exactly the stated cost for every valid call.
  - The search page asks Rossmann only through a tested decision.
  - The gate refuses the four page hosts.
  - Lint refuses a direct `fetch` in server code outside the gate.
- **#4:**
  - In CI's `smoke` job, a second real user gets from every route exactly what a missing id gets, with `private, no-store`, and changes nothing of the first user's.
  - A catalogue check fails on any public relation or function outside the reviewed list, or without its protection.
  - G1, G2 and G4 are proven.
- **#6:** in CI's `smoke` job, the real `recordDecision` and `recordLookup` lose to a newer decision, and exactly one of two simultaneous re-pins wins. A control write shows that the database alone wouldn't stop an overwrite.
- **Docs:**
  - the test plan's §2 corrected, its §6 patterns written, and its §7 holding the accepted edges;
  - `CLAUDE.md` listing the new commands and rules.

Each is verified by the Success Criteria below: the unit suite locally, and the `smoke` job in CI.

### Key Discoveries:

- **The page's price wiring:** `src/pages/watchlist/[id].astro:116-143` builds the island's shops from the read (`latest`, `readFailed`), and `:197-206` judges the selected row's tag from the island's initial rows.
- **The unreadable history:** `src/lib/services/prices.ts`, `PAGE_VIEW.parse`, returns null, which means unread, when only the history columns fail.
- **Route modules import in plain Vitest:** `src/pages/api/watchlist/prices.ts` imports only `astro` types and services, so its `POST` can be called with a fake context. Astro routes every file under `src/pages/`, so tests must live outside it.
- **The gate's network call:** `shopGateFor` reads the global `fetch` on each call (research §2.4), so `vi.stubGlobal("fetch", …)` reaches it.
- **Reusable helpers:**
  - `scripts/e2e-local-db.mjs` exports `assertLocalSupabase`, `stopShops`, `restoreShops`, `requestLogMark` and `sql`, the local superuser's.
  - `scripts/smoke.mjs` has a cookie jar and `request()`.
- **The shop-gate script's leftovers:** `scripts/check-shop-gate-db.mjs` leaves shops stopped, paused or capped on the `smoke` job's stack.
- **The request-log mark's limit:** a reservation for a stopped shop inserts nothing, so the mark can't show an attempt (research §2.4). Comparing answers is the stronger signal.

## What We're NOT Doing

- **Rendering pages in Vitest** through Astro's Container API. The pages' decisions move into services instead.
- **The pages' other four differences:** decision details, read order, the browser's clock and separate time limits stay as each page's honest answer, pinned or recorded (owner's call).
- **The selected row beside a product:** making its screen-reader line and the chip counts follow the island. Recorded as a known limit (owner's call).
- **The gate's edges:** failing closed after a failed block report, and refusing more search text than the schema does. Both recorded as accepted (owner's call).
- **Decision versions and row ids:** a version token in a decision's `replaces` (the ABA edge), and a column-level insert grant against the id probe. Both recorded as accepted (owner's call); no migration.
- **More guards and tests:**
  - a runtime Vitest guard on the global `fetch`;
  - a browser stale-tab e2e;
  - a desktop-width e2e of the selected row;
  - forced database interleavings;
  - new rule cases for #1;
  - a real-database test for #1.
- **Never:** a live shop request, a secret key, or a run against production.

## Implementation Approach

- **Order by cost × signal, risk by risk:**
  - Phases 1 and 2 add tests that stub the database and run everywhere, and move the two pages' remaining decisions into tested services, following the lesson "Keep decision logic in tested services".
  - Phases 3 and 4 add checks against the local stack, which run only in CI's `smoke` job.
- **One shared stub, keyed by relation,** serves both early phases, following the lesson "Define shared constants and helpers once".
- **Every CI-only check carries a negative control,** so a broken harness can't pass by seeing nothing:
  - the catalogue check first flags a scratch table without RLS;
  - the two-user check also runs as the owner, where the answers must differ;
  - the decision test makes one unconditional write over a changed row, which must succeed.
- **Expected values come from the PRD, US-01, S-03 and the owner's calls, never from the code under test.** That avoids the oracle problem the test plan names.

## Critical Implementation Details

- **Where tests live:** Astro builds every file under `src/pages/` as a route. So route tests live under `src/lib/services/` and import the route module.
- **What the default run skips:** a test that needs the local stack must sit outside the default Vitest include, because the end-of-turn hook and CI's `ci` job would run it with no database.
- **Shops in the two-user check:** it holds every enabled shop under its own name for its whole run, and restores only its own hold, also on failure. A privacy regression that reached the gate then meets a stopped shop instead of a live one, and shows up as an answer that differs from the missing id's.

## Phase 1: Both pages over one stored state (risk #1)

### Overview

Move the product page's price wiring into tested functions, so a history the page can't read no longer hides a price. Then prove, with one table of stored states served through a shared stub, that the list and the product page give the price verdicts the PRD expects.

### Changes Required:

#### 1. A shared Supabase stub keyed by relation

**File**: `src/lib/services/testing/stub-supabase.ts` (new)

**Intent**: One test helper that answers the services' queries from canned rows or errors per relation, and from canned results per RPC, recording every query. The seam table and the route tests then share one stand-in. The existing per-file stubs stay.

**Contract**:

- `stubSupabase({ relations, rpc })` returns `{ client, queries }`, where `client` is typed as `SupabaseClient`.
- It supports the builder calls the services use: `select`, `insert`, `update`, `delete`, the filters `eq`, `in`, `is` and `not`, then `single`/`maybeSingle`, `abortSignal` and the `{ count }` option.
- It applies `eq` and `in` to a relation's canned rows, so an id nobody holds reads as no row.
- A relation configured as `{ error }` answers that error, a code such as 57014 included.

#### 2. The product page's price wiring as functions

**File**: `src/lib/services/prices.ts`, `src/components/watchlist/price-comparison-state.ts`, `src/pages/watchlist/[id].astro`

**Intent**: Lift the page's mapping of the price read into the island's shops (`[id].astro:116-143`), and its selected row's first tag (`:197-206`), into exported functions the page calls. The seam table can then run the page's own wiring.

**Contract**:

- `priceShopsOf(keys, read, productUrlOf)` → `{ shops: PriceComparisonShop[]; pricesFailed: boolean }`, beside `readLatestPrices`. `keys` is in `productPriceKeys` order, and `read` is a `LatestPricesRead` or null.
- `selectedRowTagOf(shops, pricesFailed, matched, renderedAt)` → the row tag, beside `rowShopsOfIsland`. It is browser-safe and imports no server module.
- The page's output is unchanged.

#### 3. A history the page can't read affects only the judgement

**File**: `src/lib/services/prices.ts`, `src/lib/services/prices.test.ts`

**Intent**: By the owner's call, `PAGE_VIEW` keeps a row whose latest-check columns parse but whose history columns don't. It becomes a price with `history: null`, counted in a log line, instead of an unread row. The price verdict then matches the list's, and the judgement says nothing of the history (`history: "unread"`, from S-04's review fixes).

**Contract**:

- Such a row is no longer in `LatestPricesRead.unread`, and its `history` is null.
- A row whose latest-check columns are odd stays unread, as today.
- The history-fault tests in `prices.test.ts` move to the new expectation.

#### 4. The seam table

**File**: `src/lib/services/price-pages.test.ts` (new)

**Intent**: Serve one stored state per case, through the stub, to both pages:

- **the list:** `listWatchlist`, `listMatchStates` and `listLatestPrices`, then `listRowsOf`;
- **the product page:** `getWatchlistProduct`, `listMatches` and `readLatestPrices`, then `priceShopsOf`, `initialState`, `verdictOfState` and `selectedRowTagOf`.

Assert each page's price verdict against an expected value written by hand.

**Contract**:

- **Behaviour asserted:**
  - for a state where the owner's call says the pages agree, both give the same verdict kind and cheapest shops;
  - the selected row's tag equals the list row's tag;
  - for the recorded differences, each page gives its own expected answer.
- **Expected values:**
  - from the PRD's guardrail: stale or failed prices are visible, never silent;
  - from US-01: the cheapest shop is marked, and a shop with no current price shows its gap;
  - from S-03's decision: only fresh prices orderable online can win.
  - Never computed with `verdictOf`.
- **Cases, three or four shops each:**
  1. fresh Rossmann beside a lower Natura price older than 24 hours, a lower Hebe price not orderable online, and Super-Pharm never checked: Rossmann is cheapest on both pages;
  2. Rossmann's lower price whose promotion ended, beside a fresh Natura: Natura is cheapest;
  3. Hebe's last check `missing` with an older lower price, beside a fresh Natura: Natura is cheapest;
  4. an odd price row for Natura: neither page names a shop, and the tag says the price couldn't be read;
  5. Hebe's decision unreadable: neither page names a shop;
  6. Natura's history alone odd, beside its fresh lowest price: Natura is cheapest on both, which is the owner's call;
  7. Natura's decision `checked_at` odd: the product page holds Natura's decision unreadable and names no shop, while the list keeps its verdict, pinned as recorded difference (b);
  8. `price_summaries` failing alone: the product page says the prices couldn't be read, while the list prices the shops, pinned as recorded difference (e);
  9. two fresh orderable shops at the same price: both are named.
- **Regression caught:** wiring that drops `readFailed`, a history fault hiding a price again, and the selected row's tag drifting from the list's.
- **Anti-pattern avoided:** expected values copied from the rule under test, and an all-fresh happy path.

### Success Criteria:

#### Automated Verification:

- The seam table passes: `npx vitest run src/lib/services/price-pages.test.ts`
- The price read's and the island's tests pass with the history change: `npx vitest run src/lib/services/prices.test.ts src/components/watchlist/price-comparison-state.test.ts`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

---

## Phase 2: Routes and pages ask shops only as stated (risk #3)

### Overview

Pin what the two price routes ask the shops for every answer they can give, through their real handlers and a real gate. Move the search page's decision into a tested function. Narrow the gate's hosts. Refuse a direct `fetch` in server code.

### Changes Required:

#### 1. The gate's hosts

**File**: `src/lib/services/shop-gate.ts`, `src/lib/services/shop-gate.test.ts`

**Intent**: By the owner's call, `SHOP_HOSTS` lists only the hosts the adapters call. Each shop's page links stay checked by its adapter, as today.

**Contract**:

- `SHOP_HOSTS` becomes `rossmann: ["www.rossmann.pl"]`, `hebe: ["live.luigisbox.com"]`, `natura: ["live.luigisbox.com"]` and `"super-pharm": ["ep43qpdx9q-dsn.algolia.net"]`.
- A gate test shows that a URL on each removed host is refused before any reservation: `www.hebe.pl`, `scripts.luigisbox.com`, `www.drogerienatura.pl` and `www.superpharm.pl`.

#### 2. No direct `fetch` in server code

**File**: `eslint.config.js`

**Intent**: Catch a new adapter or route that calls a shop without the gate. This is the challenge "every shop call goes through the gate".

**Contract**:

- A config block for `src/lib/**`, `src/pages/**` and `src/middleware.ts`, outside the island's files, refuses the global `fetch` (`no-restricted-globals`). Its message points at `gate.fetch`.
- `src/lib/services/shop-gate.ts` is exempt.

#### 3. The search page's decision

**File**: `src/lib/services/search-query.ts`, `src/lib/services/search-query.test.ts`, `src/pages/watchlist.astro`

**Intent**: Lift the decision whether a search asks Rossmann (`watchlist.astro:36-46`) into a tested function the page calls.

**Contract**:

- `searchStepOf(rawQuery, headers)` gives one of: `{ kind: "none" }`, `{ kind: "invalid" }`, `{ kind: "filled"; query }` (another site's link or a prefetch only fills the form in), or `{ kind: "search"; query }`.
- The page calls `searchRossmann` only for `search`.
- **Tests:** valid text on the user's own navigation searches. The same text from another site, or as a prefetch, doesn't. Invalid text and no text don't.

#### 4. The price routes' handlers

**File**: `src/lib/services/price-routes.test.ts` (new)

**Intent**: Call the exported `POST` of `src/pages/api/watchlist/prices.ts` and `refresh.ts` with a fake context:

- `request` and `url`;
- `locals.supabase` from the shared stub, answering both relations and the gate's RPCs;
- `redirect`.

Keep the real `shopGateFor`, and `vi.stubGlobal("fetch", vi.fn(createReplayFetch(…)))` over recorded answers. Assert the served URLs and the `reserve_shop_request` calls.

**Contract**:

- **Behaviour asserted: the price route.**
  - These give no reservation and no served URL:
    - another site's Origin → 403;
    - a body that isn't JSON → 415;
    - malformed JSON or an invalid body → 400;
    - no Supabase → 503;
    - a product the user doesn't have → 404;
    - an item the page no longer shows → 409;
    - a read that fails → 503.
  - A valid call → exactly 1 reservation and 1 served URL, the shop's pinned price request, and the price in the answer.
  - A stopped shop → 0 served, and an `unavailable` answer.
  - A shop answering 403 → 1 served, and its block reported.
- **Behaviour asserted: the refresh route.**
  - A crafted or foreign item id → `?prices=none` and 0 reservations.
  - A product's refresh → 1 request per priced shop.
  - The list's refresh → items checked within 15 minutes are not asked; Rossmann 1 per product; Natura's items in 1 batched request.
  - A shop answering 403 mid-list → none of its later items asked.
- **Expected costs:** the costs stated in `CLAUDE.md` and research §2.1.
- **Regression caught:** a route that asks before its reads or refusals, asks twice, or keeps asking after a refusal.
- **Anti-pattern avoided:** mocking the gate, and asserting the status without the served requests.
- **Not covered here:** Astro's `checkOrigin` on the form route stays smoke's to prove.

### Success Criteria:

#### Automated Verification:

- The route tests pass: `npx vitest run src/lib/services/price-routes.test.ts`
- The gate's and the search decision's tests pass: `npx vitest run src/lib/services/shop-gate.test.ts src/lib/services/search-query.test.ts`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

---

## Phase 3: Two users over HTTP, and the database catalogue (risk #4)

### Overview

In CI's `smoke` job:

- a second real user is refused through every route, against the workerd preview;
- the database's catalogue is held to a reviewed list, so a new relation can't slip in unprotected;
- the existing scripts close gaps G1, G2 and G4.

### Changes Required:

#### 1. The two-user check

**File**: `scripts/check-two-users.mjs` (new)

**Intent**: Against the preview, user B gets for user A's ids exactly what a missing id gets, and changes nothing of A's.

**Contract**:

- **Setup:**
  - It refuses any stack but the local one (`assertLocalSupabase`).
  - It holds every enabled shop under its own name for its whole run (`stopShops`), and restores only its own, also on failure (`restoreShops`).
  - It seeds A through supabase-js after an Auth sign-up: a product (a Rossmann item), a Natura `matched` decision, and a stored price for each.
  - It signs B up through Auth and in through the app's Polish form, keeping B's cookies (as `smoke.mjs` does).
- **For each route, as B, compare A's product id with a random UUID:**
  - `GET /watchlist/<id>`: the status and the not-found heading;
  - `POST /api/watchlist/prices` as JSON: the status and the body;
  - `POST /api/watchlist/refresh` with `itemId`: the `Location`, with the id swapped;
  - `POST /api/watchlist/matches` for that product: the `Location`;
  - `POST /api/watchlist/remove`: the `Location`.

  `GET /watchlist` shows none of A's product. Every signed-in answer carries `Cache-Control: private, no-store`.

- **Negative control:** the same comparison as A must differ at least on the product page and the price route.
- **After the run:**
  - as A, the product, its decision and its prices are unchanged;
  - no observation was added;
  - `requestLogMark()` hasn't moved.
- **Never:** a live shop request, or a secret key.
- **Anti-pattern avoided:** testing as one user, and asserting only that the UI hides data.

#### 2. The catalogue check

**File**: `scripts/check-catalog-db.mjs` (new)

**Intent**: Answer "a new table inherits the rules": fail on any public relation or function outside a reviewed list, or without its protection.

**Contract**:

- As the local superuser (`sql` from `scripts/e2e-local-db.mjs`), over the `public` schema, it fails on:
  - a relation outside the reviewed list: the tables `shops`, `shop_requests`, `watchlist_items`, `watchlist_matches` and `price_observations`, and the views `latest_price_observations` and `price_summaries`;
  - a table without RLS;
  - a view without `security_invoker`;
  - any privilege of `anon` other than EXECUTE on `applied_migrations()`;
  - a function PUBLIC may execute;
  - a function outside the list `reserve_shop_request`, `report_shop_block` and `applied_migrations`.
- **Self-test first:** a scratch table without RLS must be flagged, then it is dropped.

#### 3. The existing scripts' gaps

**File**: `scripts/check-prices-db.mjs`, `scripts/check-shop-gate-db.mjs`

**Intent**: Close research §3.2's G1, G2 and G4.

**Contract**:

- **G1:** before user B watches anything, B's unfiltered reads of `price_observations`, `latest_price_observations` and `price_summaries`, and `count=exact` on each, give 0 while A holds rows.
- **G4:** an item gets an observation before its matcher re-pins away, and afterwards the matcher reads none of it.
- **G2:**
  - anon's call of `report_shop_block` is refused;
  - a signed-in user's direct insert, update and delete on `shops` and `shop_requests` are refused;
  - a signed-in user's call of `applied_migrations()` is refused.

#### 4. CI

**File**: `.github/workflows/ci.yml`

**Intent**: Run both new checks in the `smoke` job.

**Contract**:

- The catalogue check runs after the database scripts.
- The two-user check runs after `npm run smoke`, against the preview already serving.
- Both get the local stack's URL and key the way the database scripts do.

### Success Criteria:

#### Automated Verification:

- Both new scripts pass Node's syntax check: `node --check scripts/check-two-users.mjs scripts/check-catalog-db.mjs`
- Lint passes on the scripts: `npx eslint scripts/check-two-users.mjs scripts/check-catalog-db.mjs scripts/check-prices-db.mjs scripts/check-shop-gate-db.mjs`
- CI's `smoke` job passes with both new checks, their negative controls and the extended scripts (their first run)

---

## Phase 4: The decision write against the real database (risk #6)

### Overview

Prove, against the local stack in CI's `smoke` job, that the real `recordDecision` and `recordLookup` never overwrite a newer decision. Run them from a Vitest config of their own, which the default run skips.

### Changes Required:

#### 1. A Vitest config for the database

**File**: `vitest.db.config.ts` (new), `vitest.config.ts`, `package.json`

**Intent**: Tests that need the local stack get their own include. The default run, used by the end-of-turn hook, CI's `ci` job and this machine, skips them.

**Contract**:

- `vitest.db.config.ts` includes `src/**/*.db.test.ts`, in Node, with the same `@` alias.
- `vitest.config.ts` excludes `src/**/*.db.test.ts`.
- `package.json` gets `test:db`, which runs `vitest run --config vitest.db.config.ts`.

#### 2. The decision write's tests

**File**: `src/lib/services/matches.db.test.ts` (new)

**Intent**: Run the real `recordDecision` and `recordLookup` against Postgres for every stale-tab case, so the compare-and-swap is proven by the database and not by a stub.

**Contract**:

- **Setup:** it refuses any `SUPABASE_URL` but the local stack before any request, and signs up fresh throwaway users through Auth.
- **Behaviour asserted, with expected values from `CLAUDE.md` ("Data") and S-08's decisions:**
  1. A stale `matched:X` posted after a re-pin X→Y gets `decided`, and the row stays Y.
  2. A stale decline over a match that changed gets `decided`.
  3. A lookup's write after the user's pick gets `decided`, and the pick stays.
  4. A first choice over `not_found` gets `saved`.
  5. A decision for a product removed meanwhile gets `gone`.
  6. Two re-pins from X at once give exactly one `saved` and one `decided`.
  7. "To ten produkt" over the current automatic match gets `saved`, with `decided_by` the user. This proves the payload fits the update's column grant.
- **Negative control:** an unconditional update by `id` over a changed row succeeds. So the database alone doesn't protect, and the test can see an overwrite.
- **Anti-pattern avoided:** proof through a stub, and a hand copy of `record`'s query.

#### 3. CI

**File**: `.github/workflows/ci.yml`

**Intent**: Run `npm run test:db` in the `smoke` job after the database scripts, with the local stack's URL and key.

**Contract**: one step, in the shape of the database scripts' steps.

### Success Criteria:

#### Automated Verification:

- The default run excludes the database tests, and the whole unit suite passes: `npm run test`
- Lint and type check pass with the new config and test: `npm run lint`, `npx astro check`
- CI's `smoke` job passes with `npm run test:db`, its negative control included (its first run)

---

## Phase 5: Docs and rollout

### Overview

Record what the phase shipped and decided:

- the test plan's §2 corrections, §6 patterns and §7 accepted edges, with §3's status kept current;
- `CLAUDE.md`'s commands and rules.

### Changes Required:

#### 1. The test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Bring the plan up to date with what this phase found and shipped, with no file anchors in §2.

**Contract**:

- **§2:** the "Likely cheapest layer" cells of risks #1, #3, #4 and #6, as the research corrected them.
- **§6.2:** the integration patterns: the stub keyed by relation and the seam table, the route handlers' tests, the database Vitest config, the two-user HTTP check, and the catalogue check, each with when to use it and its negative control.
- **§6.6:** this phase's entry.
- **§7:** the accepted edges:
  - the selected row's screen-reader line and chip counts;
  - a failed block report;
  - search text the schema admits;
  - the ABA decision;
  - the id probe;
  - the pages' four recorded differences.
- **§3:** Phase 2's status kept current.

#### 2. CLAUDE.md, project rules only

**File**: `CLAUDE.md`

**Intent**: The new commands and rules where future work looks for them.

**Contract**:

- **Commands:** `npm run test:db`, `node scripts/check-two-users.mjs` and `node scripts/check-catalog-db.mjs`, each with what it needs and where CI runs it.
- **Shop requests:** `SHOP_HOSTS` lists only the hosts the adapters call, and lint refuses a direct `fetch` in server code.
- **"Data":** a history the product page can't read leaves its price. The accepted risks gain the id probe and the ABA decision.
- **Shops and matching:** the failed block report and the search text recorded as accepted edges.

### Success Criteria:

#### Automated Verification:

- Prettier leaves the edited documents as they are: `npx prettier --check context/foundation/test-plan.md context/changes/testing-route-and-database-seams/plan.md`
- Lint and the whole unit suite pass: `npm run lint`, `npm run test`
- CI's `ci`, `smoke` and `e2e` pass on the PR

#### Manual Verification:

- The owner reviews the test plan's §2, §6 and §7 updates and the `CLAUDE.md` changes

---

## Testing Strategy

### Unit Tests:

- **The seam table, over one stored state per case:** the price verdict on both pages, the selected row's tag, the owner's history call, and the recorded differences (Phase 1).
- **The price routes' handlers:** what a real gate is asked for every answer (Phase 2).
- **The search decision, the gate's hosts and the lint guard** (Phase 2).

### Integration Tests:

All run in CI's `smoke` job, since this machine has no Docker:

- **Two users through every route,** on the preview, with a negative control as the owner (Phase 3).
- **The catalogue against its reviewed list,** with a self-test, and the extended database scripts (Phase 3).
- **The real decision write against Postgres,** with an unconditional write as its control (Phase 4).

### Manual Testing Steps:

1. Phase 5: the owner reads the test plan's corrected §2, its new §6 patterns and §7 edges, and the `CLAUDE.md` changes.

## Performance Considerations

- The `smoke` job gains three steps, the catalogue check, the decision tests and the two-user check, each about a minute or less.
- The unit suite grows by two test files.

## Migration Notes

None: no migration. The history change alters only how the product page reads a row the database already serves.

## Implementation Notes

One line per adaptation, added in the phase's commit (`context/foundation/lessons.md`, "Record every adaptation in the plan in the same commit").

### Phase 1

- **`selectedRowTagOf` takes the unreadable shops,** not the match views: `selectedRowTagOf(shops, pricesFailed, unreadable, renderedAt)`. The page passes `unreadableShopsOf(matched)`, so the island's state module imports nothing of `match-card.ts`, as `initialState` already takes `unreadable`.
- **The seam table runs the page's own match steps** (`runMatchSteps` on a view that isn't the user's own navigation, so no shop is asked, which the test checks: no RPC call) to get each matched shop's item. It repeats the page's two lines that turn those items into `productPriceKeys`.
- **The tag's meta line** is asserted whole, from `PriceTag`'s documented form ("Natura · 5 min temu"), with a tie's age its older price's.
- **The stand-in** looks up a relation and an RPC with `Object.hasOwn`, so a name it wasn't given answers an error, and its writes change no canned row.
- **A history the page can't read** is logged as `history unread` with its shop only, never its item id, as the file's other log lines do.
- **The stand-in has no `not` filter** (recorded at the review), though the contract lists one: no service calls `.not(`. It has `order` and `limit` instead, which the services do call.
- **Breaks:** an unreadable history hiding the price again turned its case red; the wiring dropping an unread row turned that case red; the selected row ignoring an unreadable decision turned both decision cases red.

### Phase 2

- **The route modules import into plain Vitest:** `price-routes.test.ts` calls the exported `POST` of both routes with a context of `request`, `url`, `locals` (the stand-in client and no user) and `redirect`. The plan's open risk didn't arise.
- **The lint guard also refuses `globalThis.fetch`, `window.fetch` and `self.fetch`** (`no-restricted-properties`), since the gate itself calls the global through `globalThis`. It leaves out the tests and `src/lib/services/testing/**`, whose replay helper names `typeof fetch`. A scratch file with both forms was flagged, then deleted.
- **The search decision's `filled` step** carries the text, so the page's prompt ("Naciśnij „Szukaj”…") reads it from the step; `query` stays for the results.
- **Which shop each refusal case uses:** the price route's 403 case asks Natura, and the list's stop after a 403 uses two Rossmann products, one request each. The product refresh compares the four served URLs sorted, since the shops are asked at once.
- **Recorded at the review:**
  - The lint guard also covers the island's modules under `src/lib`, though the contract said "outside the island's files": none of them may call a shop either.
  - A refresh posted with a crafted, non-UUID id is expected to go back to `/watchlist` with no code, as the route has always done, rather than to `?prices=none`, which the contract gives for both a crafted and a foreign id. A foreign UUID gets `?prices=none`.
- **Breaks:** the price route forgetting another site's refusal, the list refresh asking fresh items, Rossmann asked again after a 403, the gate admitting Hebe's pages, and a search from another site asking Rossmann each turned their tests red.

### Phase 3

- **`sql` wasn't exported** from `scripts/e2e-local-db.mjs`, as Key Discoveries said. It is now, and its comment asks a caller outside the file to keep its rule: a statement holds only constants and checked values.
- **The catalogue's self-test runs in one transaction that is rolled back** (`begin; …; rollback;` in a single `psql` call), so its scratch objects never outlive it. It plants a fault for every rule, not only a table without RLS:
  - a table without RLS that anon may read;
  - a view that runs as its owner;
  - a function PUBLIC may execute.
- **The catalogue check reads two more things:**
  - every reviewed object must exist, so the list can't go stale;
  - anon may not create in `public`.

  Its USAGE stays, since `applied_migrations()` needs it. A sequence is checked for anon's privileges only.

- **The two-user check goes further than the contract:**
  - It also compares `?repin=natura` and `?retry=super-pharm` on the product page.
  - It seeds a decision in each matched shop, so no page looks A's product up.
  - Its decision post is a re-pin's decline naming A's match (`replaces`).
  - A's product carries a name of its own. B's pages and list must not show it, and A's must.
  - B's own list and decisions must stay empty.
- **G1:**
  - The list's read (`readLatestRows`) asks for no count, so the exact count is an extra probe.
  - A's same reads are its control.
- **G4:** B records a price for skuB before re-pinning away. Afterwards B reads none of it from the table and both views, and adds none.
- **G2:** the update and the delete name no real row. Anon's refused report would only have paused Natura for a second.
- **Breaks, offline, since the real runs need the local stack (CI's `smoke` job is their first run, 3.3):**
  - The catalogue rules ran over canned catalogue rows. They passed a clean catalogue, and each of these turned them red: a table with RLS off, a function anon and PUBLIC may execute, and a missing reviewed view.
  - The two-user check ran against a stand-in app and Supabase. It passed when nothing leaked. A leak through the product page, the price route, the forms or the list each turned it red. A removal that went through also broke the negative control and the after-run comparison.
- **3.1's command checks only its first file:** `node --check a b` treats `b` as the script's argument (recorded at the review, and verified). Both scripts were checked one at a time during the phase.
- **The first CI run (3.3) passed every check, the self-tests and negative controls included.** It also showed something new: the self-test's scratch view, which nothing granted to anon, still came with a privilege for anon. So on the local stack, a new view gets anon's privileges by default despite `auto_expose_new_tables = false`.
  - The two views' migrations revoke them explicitly, so nothing is exposed today.
  - The catalogue check's anon rule now fails on a view whose migration forgets to.

### Phase 4

- **One case more than the contract's seven:** a stale re-pin of a decline the user changed meanwhile. So each of `record`'s three narrowings is proven against the database: a lookup that found nothing, a match, and a decline.
- **All the cases run under one throwaway user,** each with a product of its own.
- **`vitest.config.ts` keeps Vitest's default excludes** (`configDefaults.exclude`) beside the new one.
- **The client's type:** `createClient` without a Database type infers a schema type that the services' `SupabaseClient` doesn't take. So the test asserts the type once.
- **The refusal, checked locally:** without `SUPABASE_URL`, or with a hosted one, `npm run test:db` fails before any request.
- **Break:** not run locally, since this machine has no database. The negative control is the suite's own proof that an overwrite would show: an update by id over a changed row goes through.
- **The first CI run (4.3):** all 9 tests passed against the smoke job's stack, the negative control included.

### Phase 5

- **§4 and §5 got the new checks too,** though the contract named only §2, §3, §6 and §7. Their rows still named four database scripts and smoke's old reach.
- **§6.2 is retitled** from "against the local database" to cover all five patterns, since two of them stub the database. It is ordered by what the risk needs: stubbed reads, a route's handler, a database test, two users, the catalogue.
- **§6.6 records the first CI run's finding:** a new view gets anon's privileges on the local stack. `CLAUDE.md`'s "Data" records it too, beside the claim about `auto_expose_new_tables`. (Corrected at the review: this note first said §7 did too.)
- **`CLAUDE.md` goes beyond the contract in two places:**
  - It names `searchStepOf`, `priceShopsOf` and `selectedRowTagOf` where it describes the pages' decisions, so later work finds the services that hold them.
  - The shop-gate and prices checks' entries name G2, G1 and G4.
- **§3 stays `implementing`** until the owner's review (5.4). The epilogue then marks it complete.

### The review's fixes (2026-10-07)

`reviews/impl-review.md` holds the findings and the owner's decisions. Each was fixed:

- **F1:** the two-user check refuses to start while another run or a manual `stop` holds the shops (`e2eHolds`), checks that no shop is enabled before either user's requests (`enabledShops`), and lets go of its hold on SIGTERM as on SIGINT.
- **F2:** the fetch lint rule also covers the frontmatter of `src/components/**/*.astro` and `src/layouts/**/*.astro`, which runs on the server.
- **F3:** the route tests assert each refresh's `done` code, which only every shop answering and being stored gives, so a request the replay doesn't know can no longer pass. They also assert:
  - Super-Pharm's POST body;
  - the valid price call's offer;
  - the 403 cases' reservations;
  - a list refresh with two Rossmann products due, one request each, beside a third, fresh product.
- **F4:** the two-user check fails unless A's product, 3 decisions and 2 prices read back before the requests. The forms must stay on the list's pages. A's refresh is a control too: `failed` with every shop held, against `none` for a product no one has. The request-log check is named for what it shows: the hold lasted. A's Rossmann id has 12 digits, as the app reads one, so that refresh takes it to the gate.
- **F5:** the page's price wiring is one service, `productPricesOf` in `prices.ts`, which the page and the seam table both call, with tests of its own. The page's output is unchanged.
- **F6:** `PriceComparisonShop` moved to `src/lib/services/price-comparison.ts`, not `src/types.ts`:
  - it needs `PricedShop`, which lives there, and `src/types.ts` imports nothing;
  - the browser-safe module is one the server and the island already import;
  - no `src/lib` module imports from `src/components` any more.
- **F7:** smoke and the two-user check share one cookie jar (`scripts/cookie-jar.mjs`).
- **F8:** these notes and `CLAUDE.md`'s two-user entry, which gains its prerequisites.

## References

- Research: `context/changes/testing-route-and-database-seams/research.md`
- The test plan's risks and guidance: `context/foundation/test-plan.md` §2
- The decision write: `src/lib/services/matches.ts:310-356`
- The page wiring: `src/pages/watchlist/[id].astro:116-143,197-212`
- The price route: `src/pages/api/watchlist/prices.ts`
- The helpers: `scripts/e2e-local-db.mjs`, `scripts/smoke.mjs`, `src/lib/services/testing/replay-fetch.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Both pages over one stored state (risk #1)

#### Automated

- [x] 1.1 The seam table passes — 1a18289
- [x] 1.2 The price read's and the island's tests pass with the history change — 1a18289
- [x] 1.3 Lint, type check and the whole unit suite pass — 1a18289

### Phase 2: Routes and pages ask shops only as stated (risk #3)

#### Automated

- [x] 2.1 The route tests pass — 122fbd0
- [x] 2.2 The gate's and the search decision's tests pass — 122fbd0
- [x] 2.3 Lint, type check and the whole unit suite pass — 122fbd0

### Phase 3: Two users over HTTP, and the database catalogue (risk #4)

#### Automated

- [x] 3.1 Both new scripts pass Node's syntax check — 01c60a9
- [x] 3.2 Lint passes on the scripts — 01c60a9
- [x] 3.3 CI's `smoke` job passes with both new checks, their negative controls and the extended scripts — 01c60a9

### Phase 4: The decision write against the real database (risk #6)

#### Automated

- [x] 4.1 The default run excludes the database tests, and the whole unit suite passes — 0280be5
- [x] 4.2 Lint and type check pass with the new config and test — 0280be5
- [x] 4.3 CI's `smoke` job passes with `npm run test:db`, its negative control included — 0280be5

### Phase 5: Docs and rollout

#### Automated

- [x] 5.1 Prettier leaves the edited documents as they are — e9bb31e
- [x] 5.2 Lint and the whole unit suite pass — e9bb31e
- [x] 5.3 CI's `ci`, `smoke` and `e2e` pass on the PR — e9bb31e

#### Manual

- [x] 5.4 The owner reviews the test plan's §2, §6 and §7 updates and the `CLAUDE.md` changes
