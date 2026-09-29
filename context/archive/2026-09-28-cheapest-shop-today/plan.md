# See Which Shop Is Cheapest Today Implementation Plan

## Overview

S-03 is the roadmap's north star. Every price the app fetches is stored as a shared observation of a shop item. A product's page shows its matched shops ordered by today's price, with the cheapest marked and each shop updating as it answers. The watchlist shows, for every product, the cheapest shop, its price, how much cheaper it is and the price's age.

Prices come from Rossmann's product detail by id and from Natura's search filtered by SKU, several SKUs per request, always through the shop gate. Only the product's watchers can read or add its observations.

## Current State Analysis

- **No prices are stored.**
  - S-02 shows Natura's candidate price only while the user chooses (`src/pages/watchlist/[id].astro:105-122`) and stores none (`src/types.ts:83`).
  - The Rossmann section has a link and no price (`[id].astro:246-264`).
  - The list shows only S-02's Natura status (`src/pages/watchlist.astro:35-48`, `:219-221`).
- **The adapters read almost none of the price fields the shops send** (research §1):
  - `rossmann.ts:20-34` reads no price field and only `data.items`.
  - `natura.ts:26-38` reads only `price_amount`.
- **Both pages do all their work in the frontmatter** before Astro sends a byte (research §7).
  - The product page awaits the reads (`[id].astro:21-26`) and, for an undecided product, the Natura lookup and its write (`:147-155`).
  - The list reads everything in one `Promise.all` (`watchlist.astro:24-28`).
- **Every database call runs with the user's own client**, and there is no server-only key (`context/deployment/deploy-plan.md:128`).
  - The patterns are the per-user RLS tables (`supabase/migrations/20260927184936_watchlist_matches.sql:76-94`) and the closed F-01 tables.
  - Two-user checks guard both (`scripts/check-matches-db.mjs`).
- **The gate** counts one slot per request, 30 per shop per rolling minute for the whole deployment. It refuses without calling the shop when the cap is reached or the shop is paused or stopped (`src/lib/services/shop-gate.ts:94-112`).
- **React is set up but used only on the sign-in and sign-up forms** (`src/components/auth/SignInForm.tsx`, `client:load` in `src/pages/auth/signin.astro:14`).

## Desired End State

**The product page:**

- It shows its matched shops at once from stored prices, ordered by price. Each row shows the price, the regular price and promo end while a promotion runs, the 30-day low the shop reports, "cena online w <site>", the price's age, and the "Najtaniej" mark on the cheapest eligible shop or shops.
- On the user's own navigation, each shop whose last check is older than 15 minutes is refetched through a JSON API. Its row, the order and the mark update as that shop answers.
- "Odśwież ceny" refetches every matched shop. Without JavaScript, the same button posts a form that refreshes and reloads the page.
- A failed refetch keeps the last price with its age and says why.

**The watchlist:**

- Each product shows one line: the cheapest shop, its price, how much cheaper it is than the other shop, and the price's age. A product matched in one shop only shows that shop's price as "Tylko w Rossmannie".
- "Odśwież ceny" refreshes every product whose last check is older than 15 minutes: Natura's items in one request, Rossmann's one per product, until the cap.

**Shared storage:**

- Every check is stored in `public.price_observations`, which users can only append to: a price, or `missing` when the shop answered without the item.
- A user can read and add observations only of shop items on their own watchlist. The database sets the time, the source and the recording user, and users can't read the recording user.

**Verification:** the unit tests, the new database check and the smoke test pass in CI, and a phone walk-through on the dev server and on production shows the behaviour above.

### Key Discoveries:

- **Rossmann's v2 detail by id** (`GET https://www.rossmann.pl/products/v2/api/Products/{id}?shopNumber=null`) carries `price`, `oldPrice`, `lastLowestPrice`, `promotionFrom`/`promotionTo` and `availability`. It answered from the developer machine and from a Cloudflare Worker in WAW on 2026-09-28 (research, Follow-up).
  - An item without a reduction carries only `price`.
  - `oldPrice` is the regular price, not the 30-day low: Felix has 9.99, `lastLowestPrice` 6.39 and price 5.99.
- **Natura:** `f[]=type:product&f[]=sku:<SKU>` without `q` returns exactly that item. Several `sku` filters return all of them in one request, and `hit_fields` shrinks a hit from about 20 KB to about 350 characters (research, Follow-up requests 4-5).
- **Natura's `lowest_price`** is reported even without a promotion (NV81063: 10.99 below its 17.99 price). So the page labels it as the shop's own 30-day low, not as an Omnibus reduction.
- **Per-shop progress needs separate requests:** Astro flushes components in document order (`node_modules/astro/dist/runtime/server/render/astro/render-template.js:36-68`).
- **Astro's `checkOrigin` refuses cross-site posts of form content types only** (research §7). A JSON route has to refuse other sites itself.
- **Stored ids and the gate:** the database lets `source_item_id` hold `.` and `..` (`20260927184936_watchlist_matches.sql:10`), and the gate checks only protocol, port and host (`shop-gate.ts:82-88`). So the Rossmann id has to be checked again as digits before it becomes a path.

## What We're NOT Doing

- **Other slices:**
  - no good-price judgement, trends or history view (S-04); S-03 only keeps the history
  - no Hebe or Super-Pharm (S-05, S-06)
  - no re-pinning or removing matches or products (S-08)
- **Parked features:** no daily or scheduled refresh (FR-015, parked), no manual price entry (FR-009, parked; the `source` column allows only `fetch` until it lands), and no price per unit (parked).
- **No retention or clean-up of old observations.** At this scale a few rows per item per day is small; S-04 decides what history it needs.
- **No server-only key or service role for writes** (ruled out by the deploy plan), and no per-user quotas beyond the gate's cap.
- **No server islands and no `ASTRO_KEY`:** the product page uses a React island (plan decision).
- **No prices in the "Dodaj" search results**, and no price saved from any posted form value. Prices come only from the server's own shop requests.
- **No shelf or store-level prices.** Rossmann's `differentPricesInShop` isn't shown; the "cena online" label covers it.

## Implementation Approach

- **Data first:**
  - an append-only observations table with watchers-only RLS and column grants
  - a view that gives each shop item's last check and last price
  - S-02's database follow-ups in the same migration
- **Shops next:** two price lookups (Rossmann by id, Natura by SKU in batches) and a refresh service that fetches through the gate and records each check.
- **Then the product page:** a pure comparison module that the page, the API route and the island all use, so the server and client never disagree about which shop is cheapest.
- **Then the list**, its refresh form, and the product page's no-JavaScript fallback. Docs and the production rollout close the change.

**Decisions made in planning** (brief, Key Decisions):

- only fresh, orderable prices can be marked cheapest, and ties are all marked
- a price is refetched after 15 minutes and marked stale after 24 hours
- the list refreshes by a button and whenever a product is opened
- prices are shared among an item's watchers
- a React island plus a JSON API route
- every fetch is kept
- an item that isn't orderable online is shown but can't win
- a Worker probe confirmed Rossmann's detail endpoint (done 2026-09-28)
- each list row shows the cheapest shop and how much cheaper it is

**Accepted risks** (recorded here and in CLAUDE.md, like F-01's):

1. An invited user can write a plausible fake price for an item they watch, because the app has no server-only key. Watching is self-service, through any Rossmann result or a matched decision with any SKU, so this reaches any item. A fake row also counts as the item's last check, so its watchers' automatic refresh waits up to 15 minutes, and only a product page's button fetches it at once. (Widened after the implementation review, F6.)
2. People watching the same item see each other's fetch times.

Revisit both before inviting more people.

## Critical Implementation Details

- **Column grants and PostgREST:**
  - Users may not read `recorded_by`, so inserts must not ask for rows back (supabase-js's default `return=minimal`, no `.select()`), and every read lists its columns.
  - The view selects no `recorded_by`, because a `security_invoker` view checks the caller's column privileges.
- **Code the island imports:** `price-comparison.ts` and `shop-messages.ts` are imported by the React island. They must not import server-only modules (`astro:env/server`, Supabase, the gate).
- **Hydration:** the island's first render uses the server's `now` prop, so its ages match the server HTML. The clock moves to `Date.now()` only after mount.
- **The JSON route and other sites:** it accepts only `Content-Type: application/json`, which a cross-site page can't send without a CORS preflight the route never answers. It also refuses a request whose `Sec-Fetch-Site` is `cross-site` or whose `Origin` isn't the site's own.
- **Natura's batch URL:** each SKU is its own repeated `f[]=sku:<SKU>` parameter (OR on the same field), built with `URLSearchParams.append`, never joined into one value.
- **Rossmann's `promotionTo`** has no UTC offset. Only its date part is stored, as `promo_ends_on`.

## Phase 1: Price data contract

### Overview

The table, the view, their RLS and grants, the TypeScript types and the database service. S-02's database follow-ups ride along in the same migration.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<UTC timestamp>_price_observations.sql` (named when it is created, like S-02's)

**Intent**: Store every price check as a shared, append-only row that only the item's watchers can read or add, with the time, source and recording user set by the database. Give the pages one view for each item's latest state. Apply S-02's review follow-ups (F5).

**Contract**:

**`public.price_observations`:**

- Columns:
  - `id uuid` primary key, default `gen_random_uuid()`
  - `shop_id text` not null, referencing `public.shops (id)`
  - `shop_item_id text` not null: `^[A-Za-z0-9._-]{1,40}$` with at least one letter or digit
  - `status text` not null: `price` or `missing`
  - `price numeric(10,2)`, above 0 and below 100000
  - `regular_price numeric(10,2)`, above `price`
  - `lowest_price_30d numeric(10,2)`, above 0
  - `promo_ends_on date`
  - `available boolean`
  - `source text` not null, default `fetch`, allowing only `fetch`
  - `observed_at timestamptz` not null, default `now()`
  - `recorded_by uuid` not null, default `auth.uid()`, with no foreign key, so deleting a user never deletes observations
- Checks:
  - A `price` row has `price` and `available`.
  - A `missing` row has none of the price columns.
- Index: `(shop_id, shop_item_id, observed_at desc)`.

**RLS**, enabled, with one policy per operation for `authenticated`:

- The select and insert policies allow a row only when the caller watches that shop item. That means one of:
  - a `watchlist_items` row of theirs with `source = shop_id` and `source_item_id = shop_item_id`
  - a `watchlist_matches` row of theirs with `state = 'matched'`, the same `shop_id` and `shop_item_id`
- There is no update or delete policy.
- A partial index on `watchlist_matches (user_id, shop_id, shop_item_id) where state = 'matched'` supports the policy.

**Grants:**

- Revoke all from `anon`, `authenticated` and `service_role`.
- Grant `authenticated`:
  - `select` on every column except `recorded_by`
  - `insert` on `shop_id, shop_item_id, status, price, regular_price, lowest_price_30d, promo_ends_on, available` only

**`public.latest_price_observations`:**

- A view `with (security_invoker = true)`, so the table's RLS and column grants apply to the caller.
- It gives one row per `(shop_id, shop_item_id)` the caller can see:
  - `shop_id, shop_item_id`
  - `last_checked_at, last_status`, from the latest row of either status
  - `price, regular_price, lowest_price_30d, promo_ends_on, available, priced_at`, from the latest `price` row; all null when there is none
- Revoke from `anon`; grant `select` to `authenticated`.

**S-02 follow-ups:**

- Replace `watchlist_items_eans_bounded` and `watchlist_matches_eans_bounded` with the same rule plus "no element contains a comma and the array has one dimension": `strpos(array_to_string(eans, '', '*'), ',') = 0 and coalesce(array_ndims(eans), 1) = 1`.
- Replace `watchlist_matches`' table-wide `update` grant with an `update` grant on the decision columns only: `state, decided_by, shop_item_id, name, brand, size_text, size_value, size_unit, eans, product_url, image_url, checked_at`.

#### 2. Shared types

**File**: `src/types.ts`

**Intent**: Name what a shop offers an item for, what one check of an item came to, and what the view gives back.

**Contract**:

- `ShopOffer`: `{ price: number; regularPrice: number | null; lowestPrice30d: number | null; promoEndsOn: string | null; available: boolean }`. `promoEndsOn` is `YYYY-MM-DD`.
- `PriceCheck`: `{ kind: "price"; offer: ShopOffer } | { kind: "missing" } | ShopUnavailable`
- `PriceKey`: `{ shop: ShopId; shopItemId: string }`
- `LatestPrice`: `PriceKey & { lastCheckedAt: string; lastStatus: "price" | "missing"; offer: (ShopOffer & { pricedAt: string }) | null }`

#### 3. Price limits

**File**: `src/lib/services/product-limits.ts`

**Intent**: One constant for the price bound the table's checks mirror, as the other limits already are.

**Contract**: `PRICE_LIMITS.max = 99999.99`. A comment points at the migration.

#### 4. Price observations service

**File**: `src/lib/services/prices.ts` (new)

**Intent**: Record checks and read the latest state through the user's own client, so RLS enforces who sees what. It follows `matches.ts`: 2 s limits, per-row parsing, and logs that name no product, EAN or search text.

**Contract**:

- `recordPriceChecks(supabase, checks: { key: PriceKey; check: PriceCheck }[]): Promise<"saved" | "failed" | "none">`
  - Inserts one row per `price` or `missing` check in a single insert with no returned rows. `unavailable` checks are skipped; `none` means nothing to insert.
  - A refused insert (RLS `42501`) or any error is `failed`, logged by code only.
- `listLatestPrices(supabase, keys?: PriceKey[]): Promise<LatestPrice[] | null>`
  - Reads `latest_price_observations` with explicit columns.
  - Without `keys` it returns every row RLS lets the user see, which is the list's case. With `keys` it filters to them, which is a product's case.
  - Odd rows are dropped and logged. `null` means the read failed.

#### 5. Service tests

**File**: `src/lib/services/prices.test.ts` (new)

**Intent**: Pin the insert payload and the read mapping with a stubbed client, as `matches.test.ts` does.

**Contract**:

- Price and missing rows carry no `observed_at`, `source` or `recorded_by`, and `unavailable` inserts nothing.
- A single insert serves several checks.
- `42501` becomes `failed`.
- A row without a price maps to `offer: null`, and odd rows are dropped.
- A key filter is applied only when keys are given.

#### 6. Database contract check

**File**: `scripts/check-prices-db.mjs` (new), in the shape of `check-matches-db.mjs`: localhost only, two throwaway users, `PASS`/`FAIL` lines, exit 1 on any failure.

**Intent**: Prove the sharing, privacy and immutability rules in Postgres, not only in code.

**Contract**:

User A adds Rossmann item X; user B adds nothing yet. The check asserts:

- **Writes:**
  - A inserts a `price` row and a `missing` row for X.
  - B can't insert for X (`42501`), and A can't insert for an item A doesn't watch.
  - A can't set `observed_at`, `source` or `recorded_by` (`42501`).
- **Reads:**
  - B reads none of X's rows, and neither does `anon`.
  - Once B also adds X, B reads them.
  - The view gives A exactly one row for X, with `last_status` and `priced_at` right after the missing check.
- **No changes:** A can't update or delete a row (`42501`, or zero rows, read back unchanged).
- **Bounds and shapes** each refused with `23514`:
  - a price of 0
  - a `missing` row carrying a price
  - a `shop_item_id` of `..`
  - a comma inside an EAN on `watchlist_items` and on `watchlist_matches`
- **Matches' column grant:** A can't change the `shop_id` or `watchlist_item_id` of A's own `not_found` match (`42501`).

#### 7. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Run the new check in the `smoke` job like the three existing database checks.

**Contract**: The step "Check price observations database contract" runs `node scripts/check-prices-db.mjs` after "Check shop matches database contract".

### Success Criteria:

#### Automated Verification:

- With Docker running, `npx supabase migration up --local` applies the migration, then `node scripts/check-prices-db.mjs` with the local URL and anon key prints only PASS lines
- `node scripts/check-matches-db.mjs` and `node scripts/check-watchlist-db.mjs` still print only PASS lines
- `npm run test` passes, including the prices service tests
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- CI `smoke` job runs "Check price observations database contract" and is green on the PR

#### Manual Verification:

- Migration review:
  - only watchers can select or insert, with no update or delete path
  - users can't set the time, source or recording user, or read the recording user
  - the view is `security_invoker`
  - the EAN and match-grant follow-ups are in place

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Shop price lookups

### Overview

Fetch the current offer of pinned items: Rossmann one product per request by id, Natura several SKUs per request. A refresh service fetches and records each check. Natura's candidates carry their full offer, so an automatic match can store its first price.

### Changes Required:

#### 1. Candidate offer

**File**: `src/types.ts`, `src/pages/watchlist/[id].astro` (only `optionView`), `src/lib/services/matches.test.ts` and the other tests that build candidates

**Intent**: A candidate carries the whole offer, not just a number, so the price Natura sent for an automatic match can be stored. S-02's candidate label keeps working.

**Contract**:

- `ShopCandidate.price: number | null` becomes `offer: ShopOffer | null`.
- `optionView` shows `offer.price`, and falls back to "Brak ceny online" when `offer` is null.

#### 2. Rossmann price by id

**File**: `src/lib/services/shops/rossmann.ts`

**Intent**: Read one pinned product's offer from the v2 detail endpoint. It never throws, and it checks the stored id again before it becomes a path.

**Contract**:

- `fetchRossmannPrice(gate, sourceItemId: string): Promise<PriceCheck>`
  - An id that isn't `^\d{1,12}$` is `unavailable/failed` without any request.
  - The URL is `https://www.rossmann.pl/products/v2/api/Products/<id>?shopNumber=null`, with a 5 s limit.
  - The answer is `price`, or `missing` when the recording of an unknown id (below) shows Rossmann answered without the product. How that looks, whether a 404 or an empty `data`, follows the recording.
  - Gate refusals map through `gateUnavailable`. An unreadable body or shape is `unavailable/failed`, logged by reason only.
- Offer mapping:
  - `price` must be positive.
  - `oldPrice` counts as `regularPrice` only when above `price`.
  - `lastLowestPrice` becomes `lowestPrice30d` when positive.
  - `promotionTo`'s date part becomes `promoEndsOn`.
  - `availability === "available"` is `available`.

#### 3. Natura prices by SKU

**File**: `src/lib/services/shops/natura.ts`

**Intent**: Read the offers of several pinned SKUs in one request. The candidate mapping gets the same offer fields.

**Contract**:

- `fetchNaturaPrices(gate, skus: string[]): Promise<Map<string, PriceCheck>>`
  - A SKU is used only if it matches `^[A-Za-z0-9._-]{1,40}$` with a letter or digit; any other SKU is `unavailable/failed` without being sent.
  - Up to 50 SKUs per request: `tracker_id`, `f[]=type:product`, one `f[]=sku:<SKU>` per SKU, `size=<count>` and `hit_fields=sku,price_amount,price_old_amount,lowest_price,availability`, with a 4 s limit per request.
  - Each requested SKU gets `price` from the hit whose `url` equals it, or `missing` when no hit has it.
  - A request's gate refusal or unreadable answer makes all of its SKUs `unavailable`. Hits that all fail the check are `unavailable/failed`, as `searchNatura` does.
- Offer mapping, shared with `toCandidate`:
  - `price_amount` must be positive.
  - `price_old_amount` counts as `regularPrice` only when above the price.
  - `lowest_price[0]` is parsed and becomes `lowestPrice30d` when positive.
  - `availability === 1` is `available`.
  - `promoEndsOn` is null.

#### 4. Refresh service

**File**: `src/lib/services/price-refresh.ts` (new)

**Intent**: One place that turns a set of pinned items into shop requests and stored checks, for the product page's API route and for the list's refresh.

**Contract**:

- `refreshPrices(gate, supabase, targets: PriceKey[]): Promise<{ results: { key: PriceKey; check: PriceCheck }[]; saved: "saved" | "failed" | "none" }>`
- Rossmann targets are requested at most 5 at a time, in the given order, so callers pass the oldest first.
- Natura targets go through `fetchNaturaPrices` in batches.
- All `price` and `missing` checks are recorded with one `recordPriceChecks` call.

#### 5. Fixtures

**File**: `src/lib/services/shops/fixtures/` (new files)

**Intent**: Real answers for every path the tests take, recorded once from the developer machine with the gate's User-Agent, at least 2 s apart, and trimmed.

**Contract**:

- `rossmann-detail-reduced.json` (131225) and `rossmann-detail-regular.json` (26900). These come from the 2026-09-28 research requests, whose URLs equal the adapter's.
- New recordings, 4 requests with the owner's approval, as in S-02:
  - `rossmann-detail-unknown.json`: an id Rossmann doesn't have
  - `natura-skus.json`: NV89063 and NV81063, with the adapter's exact parameters
  - `natura-sku-unknown.json`: a SKU Natura doesn't have
  - `natura-sku.json`: NV89063 alone, with the adapter's exact parameters

#### 6. Tests

**File**: `src/lib/services/shops/rossmann.test.ts`, `src/lib/services/shops/natura.test.ts`, `src/lib/services/price-refresh.test.ts` (new)

**Intent**: Each path, asserting which URLs the replay fetch served, because a miss looks like `failed/network`.

**Contract**:

- Rossmann:
  - a reduced offer, a regular offer, an unknown id
  - a non-digit or `..` id sends nothing
  - a 403 is `stopped`
  - an unreadable body is `failed`
- Natura:
  - one SKU and two SKUs in one request, with repeated `f[]` in the URL
  - an unknown SKU is `missing`
  - an invalid SKU is never sent
  - more than 50 SKUs make two requests
  - hits that all fail are `unavailable`
- Refresh:
  - several Rossmann targets and one Natura request for several SKUs
  - one recording call with only the `price` and `missing` checks
  - capped Rossmann targets are not recorded

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the Rossmann and Natura price tests and the refresh service tests
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Fixture review: every new recording used the gate's User-Agent, went at least 2 s apart, is trimmed to the fields the adapters read, and holds no cookies or personal data; the unknown-id and unknown-SKU recordings show what "not found" looks like

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Product page prices

### Overview

The comparison rules as a tested pure module, the JSON route that refreshes one shop of one product, and the React island that shows stored prices at once and updates each shop as it answers.

### Changes Required:

#### 1. Comparison rules

**File**: `src/lib/services/price-comparison.ts` (new; imported by the island, so no server-only imports)

**Intent**: Encode the planning decisions once, for the page, the route and the island.

**Contract**:

- Constants: `REFETCH_AFTER_MS = 15 * 60 * 1000` and `STALE_AFTER_MS = 24 * 60 * 60 * 1000`.
- Shop labels, used in the list and page texts:
  - `rossmann`: `{ name: "Rossmann", in: "w Rossmannie", site: "rossmann.pl" }`
  - `natura`: `{ name: "Natura", in: "w Naturze", site: "drogerienatura.pl" }`
- `needsRefetch(latest: LatestPrice | null, now)`: true when there is no check yet, or `lastCheckedAt` is more than 15 minutes old.
- `priceState(latest, now)`:
  - `none`: no price yet
  - `missing`: the last check found no item, whatever the price's age
  - `stale`: `pricedAt` is more than 24 hours old
  - `fresh`: otherwise
  - An exactly 24-hour-old price is fresh.
- `compareShops(rows: { shop; latest: LatestPrice | null }[], now)`:
  - Eligible rows are fresh and `available`. They come first, by price ascending, then the other rows that have a price, then rows with none.
  - Every eligible row with the lowest price in grosze is `cheapest`.
  - The summary is one of:
    - `{ kind: "cheapest"; shops; price; ageFrom; savings: { amount; than } | null }`, where savings compares against the lowest other eligible shop, when there is one
    - `{ kind: "only"; shop }`, when one row exists
    - `{ kind: "none" }`
- `ageText(iso, now)`: "przed chwilą" under a minute, "N min temu" under an hour, "N godz. temu" under 24 hours, "wczoraj" under 48 hours, then "N dni temu".
- Money is formatted with `Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" })`, and differences are computed in grosze.

#### 2. Comparison tests

**File**: `src/lib/services/price-comparison.test.ts` (new)

**Intent**: Pin every decision at its boundary.

**Contract**:

- Refetch at 15 minutes versus 15 minutes and 1 ms.
- Stale at exactly 24 hours versus 24 hours and 1 ms.
- A `missing` last check hides an otherwise fresh price from winning.
- An unavailable price can't win.
- A tie marks both shops.
- One shop gives `only`, no fresh price gives `none`, and the savings come out in grosze (26.99 − 16.99 = 10,00 zł).
- `ageText` at each step.

#### 3. Price wording

**File**: `src/lib/shop-messages.ts`

**Intent**: A refetch that didn't happen gets wording about prices, since the existing texts are about search.

**Contract**:

- `priceUnavailableText(shopName, reason, until?)`, worded for keeping the last known price:
  - `busy`: "Sklep X jest teraz zajęty. Pokazujemy ostatnią znaną cenę."
  - `paused`: the same, with the pause's end when known
  - `stopped`: "Odświeżanie cen w sklepie X jest wyłączone, bo sklep zablokował zapytania."
  - `failed`: "Nie udało się pobrać ceny ze sklepu X."
- `missing` has its own text: "Sklep nie zwraca już tego produktu. Cena może być nieaktualna."

#### 4. JSON refresh route

**File**: `src/pages/api/watchlist/prices.ts` (new; `/api/watchlist` is already in `PROTECTED_ROUTES`)

**Intent**: Refresh one shop of one of the user's products, from the island. The server looks up the shop item itself from the user's own rows, so the browser can't choose what gets fetched.

**Contract**:

- `POST`, `Content-Type: application/json`, body `{ itemId: <uuid>, shop: "rossmann" | "natura" }`, checked with zod.
- It answers:
  - `415` for another content type, `400 { error: "invalid" }` for a bad body
  - `403` for `Sec-Fetch-Site: cross-site` or a foreign `Origin`
  - `503 { error: "config" }` without Supabase
  - `404 { error: "gone" }` when the product isn't the user's or has no matched item in that shop
  - otherwise `200` with one of:
    - `{ kind: "price", offer, checkedAt, saved }`
    - `{ kind: "missing", checkedAt, saved }`
    - `{ kind: "unavailable", reason, until? }`
- The shop item is `watchlist_items.source_item_id` for Rossmann, or the matched `watchlist_matches.shop_item_id` for Natura.

#### 5. The island and its state

**File**: `src/components/watchlist/PriceComparison.tsx` (new), `src/components/watchlist/price-comparison-state.ts` (new), `src/components/watchlist/price-comparison-state.test.ts` (new)

**Intent**: Show the matched shops' prices, ordered and marked, and update each shop as its refetch answers. The state changes live in a pure reducer that Vitest can test.

**Contract**:

- Props: `{ itemId, shops: { shop; productUrl: string | null; latest: LatestPrice | null }[], autoRefresh: boolean, now: string }`.
- On mount, and only with `autoRefresh`, it posts once for each shop where `needsRefetch`. "Odśwież ceny" posts for every shop.
- Each row shows:
  - "Odświeżam…" in an `aria-live="polite"` region while its request runs
  - then the answer, or `priceUnavailableText` / the missing text next to the last known price
  - the price
  - "zamiast X" crossed out, plus "promocja do DD.MM" when known
  - "najniższa cena z 30 dni wg sklepu: Y" when reported
  - "cena online w <site> · <ageText>"
  - "nieaktualna" when stale, "niedostępny online" when not orderable
  - "Najtaniej" on the cheapest rows
  - "Zobacz w sklepie"
- A redirected or non-JSON answer means the session ended, and the island says to sign in again.
- The reducer handles three actions: `start(shop)`, `done(shop, result, at)` and `tick(now)`. Order and marks always come from `compareShops`.
- Tests: start then done for each shop in either order, the re-sort and re-mark after an answer, an unavailable answer that keeps the last price, and a session-ended answer.

#### 6. Product page

**File**: `src/pages/watchlist/[id].astro`

**Intent**: Read the product's latest prices and render the island above the shop sections. An automatic Natura match stores the price it came with.

**Contract**:

- After the product and its matches are read, `listLatestPrices` runs with the product's keys: Rossmann's `source_item_id`, and Natura's matched `shop_item_id` when there is one.
- A failed read shows "Nie udało się wczytać cen." and the island without stored prices.
- The island gets `autoRefresh = isOwnNavigation(Astro.request.headers)` and `now = new Date().toISOString()`. It is hydrated with `client:load`.
- When the page's Natura lookup auto-accepts a candidate and `recordLookup` answers `saved`, the candidate's offer is recorded with `recordPriceChecks` as the first Natura price.
- The Rossmann and Natura sections stay: the link, and the matching states and forms.

#### 7. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Pin the route's refusals without any shop call.

**Contract**:

- Signed out, a JSON post answers 302.
- Signed in:
  - a form content type answers 415 (or 403 from `checkOrigin`, whichever Astro answers first; the step records which)
  - a bad body answers 400
  - an unknown UUID answers 404
  - a JSON post with `Origin: https://example.org` answers 403

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the comparison, wording and island state tests
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes
- CI `ci` and `smoke` jobs are green on the PR, including the new price route smoke steps

#### Manual Verification:

- Phone-viewport walk-through against `npm run dev` with the local Supabase:
  - opening a matched product shows the stored prices at once, then each shop updating as it answers, ordered, with the cheapest marked
  - reopening within 15 minutes makes no shop request (Workers log or network panel)
  - "Odśwież ceny" refetches both shops
  - a link from another site shows the prices without a refetch and offers the button
  - a price made 25 hours old in the local database shows "nieaktualna" and loses the mark
  - an automatic Natura match shows its price with no extra Natura request

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Watchlist prices and refresh

### Overview

Each list row shows its cheapest shop, the price, how much cheaper it is, and the age. A form refreshes the stale products, and the product page's button falls back to it without JavaScript.

### Changes Required:

#### 1. Match states with their items

**File**: `src/lib/services/matches.ts` (+ its tests)

**Intent**: The list needs each matched product's Natura SKU to find its prices.

**Contract**: `listMatchStates` also returns `shopItemId: string | null`, the SKU for `matched` rows and null otherwise. It is still one query for the whole list.

#### 2. List texts and refresh targets

**File**: `src/lib/services/price-comparison.ts` (+ its tests)

**Intent**: The row texts and the choice of what a list refresh fetches, as pure, tested functions.

**Contract**:

- `listSummaryText(summary, rows, now)` gives exactly these lines:
  - "Najtaniej: Natura 16,99 zł, o 10,00 zł taniej niż Rossmann · 2 godz. temu", or without the difference when no other shop is eligible, followed by "· Rossmann: cena nieaktualna" / "niedostępny online" / "brak ceny" for the other shop
  - "Najtaniej: Rossmann i Natura, 16,99 zł · 5 min temu" for a tie
  - "Tylko w Rossmannie: 26,99 zł · 5 min temu", with "· nieaktualna" when stale
  - "Ceny nieaktualne. Odśwież ceny lub otwórz produkt." when no row is eligible
  - "Jeszcze bez cen. Otwórz produkt, aby je pobrać." when nothing has been fetched
- `staleTargets(entries, now): PriceKey[]`: every watched Rossmann item and matched Natura SKU for which `needsRefetch`, oldest check first, with never-checked items first.

#### 3. Form refresh route

**File**: `src/pages/api/watchlist/refresh.ts` (new)

**Intent**: The list's "Odśwież ceny", and the product page's fallback without JavaScript. It is a plain form post that `checkOrigin` protects.

**Contract**:

- `POST`, with an optional `itemId` field.
  - Without `itemId`, it refreshes `staleTargets` for the whole list.
  - With a valid `itemId` of the user's, it refreshes every matched shop of that product.
- It redirects to `/watchlist?prices=<code>` or `/watchlist/<id>?prices=<code>`:
  - `done`: every target got a price or a missing check, and all were saved
  - `partial`: some were unavailable or unsaved
  - `none`: nothing needed refreshing
  - `failed`: no target got an answer
- An invalid `itemId` goes back to `/watchlist` with no code, as `/api/watchlist/matches` does.

#### 4. Watchlist page

**File**: `src/pages/watchlist.astro`

**Intent**: Show the price line and the refresh button, from stored prices only: viewing the list makes no shop request.

**Contract**:

- `listLatestPrices` joins the existing `Promise.all`.
- **Matched products:** the price line from `listSummaryText` replaces "Natura: dopasowano".
- **Other products:** they keep S-02's Natura status and get the Rossmann line ("Tylko w Rossmannie…").
- **Failed price read:** an alert says so, and the rows show no price lines.
- **Refresh:** "Odśwież ceny" is a form posting to `/api/watchlist/refresh`, shown when the list isn't empty.
- **Notices:** `?prices=` codes map to the page's own texts. Unknown codes show nothing.

#### 5. Fallback without JavaScript

**File**: `src/components/watchlist/PriceComparison.tsx`, `src/pages/watchlist/[id].astro`

**Intent**: Without JavaScript the product page can still refresh.

**Contract**:

- The island's "Odśwież ceny" button sits in a form posting `itemId` to `/api/watchlist/refresh`. With JavaScript, the island intercepts the submit and refreshes per shop instead.
- The page maps `?prices=` to its own notice.

#### 6. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Pin the refresh route's refusals and its empty case without any shop call.

**Contract**:

- Signed out, a post answers 302.
- Signed in with an empty list, it redirects to `/watchlist?prices=none`.
- A post with a foreign `Origin` answers 403.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the list text and refresh target tests
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes
- CI `ci` and `smoke` jobs are green on the PR, including the refresh route smoke steps

#### Manual Verification:

- Phone-viewport walk-through against `npm run dev` with the local Supabase:
  - each matched product's row shows the cheapest shop, its price, the difference and the age
  - a product matched only in Rossmann shows "Tylko w Rossmannie"
  - viewing the list makes no shop request
  - "Odśwież ceny" refreshes only products checked more than 15 minutes ago and shows the result notice
  - the product page's button works with JavaScript off
  - a second user watching the same Rossmann item sees the shared price, and a user who doesn't watch it sees none

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Docs and production rollout

### Overview

Record the new rules and shop facts, get the migration onto production before the merge, and confirm it there.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md` (project section only; never inside the 10x-cli course block)

**Intent**: Make S-03's rules part of the project's guidance.

**Contract**:

- Data:
  - `price_observations` is append-only, readable and insertable only by the item's watchers, and its time, source and recording user are set by the database
  - `missing` rows, and `latest_price_observations`
  - the two accepted risks
- Commands: `check-prices-db.mjs`.
- UI: the product page's island and the two price routes.
- Shops: Rossmann's detail by id, and Natura's SKU filter with `hit_fields`.
- CI: the `smoke` job's four database checks.

#### 2. Research note

**File**: `docs/research/polish-drugstore-price-apis.md`

**Intent**: Keep the canonical shop reference true for S-05 and later.

**Contract**:

- §2.1: Rossmann's promo and 30-day-low fields, and the v2 detail's fields.
- §2.5: the SKU filter, batching and `hit_fields`.
- §6 step 7: Rossmann's fields corrected.
- §9: a row for the v2 detail from Workers, dated 2026-09-28.

#### 3. Production migration

**File**: none (the owner's action, the agent's check)

**Intent**: The product page reads the new view, so production needs the migration before the merge.

**Contract**:

- The owner runs `npx supabase db push` from the branch; its dry run lists only the price migration.
- The agent confirms it with `npx supabase migration list --linked` before the PR is marked ready.

### Success Criteria:

#### Automated Verification:

- CI `ci` and `smoke` jobs are green on the PR after the documentation changes
- `npx supabase migration list --linked` shows the price migration with a remote version

#### Manual Verification:

- Owner ran `npx supabase db push` (the dry run listed only the price migration) and it reported success
- Supabase dashboard shows `price_observations` with RLS on and its two policies, and `latest_price_observations`; Security Advisor shows no errors
- CLAUDE.md and research note updates reviewed

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Comparison rules at each boundary (15 minutes, 24 hours), ties, availability, missing checks, savings in grosze, and the list texts.
- Both price adapters against recordings, asserting the served URLs: Natura's repeated `f[]`, the batch split, and Rossmann's id check before any request.
- The refresh service's batching and recording.
- The prices service's payload and mapping.
- The island's reducer.

### Integration Tests:

- `scripts/check-prices-db.mjs`: sharing among watchers, privacy from others and `anon`, append-only, column grants, the view, and the carried-over EAN and grant rules.
- `scripts/smoke.mjs`: both new routes' refusals and the empty refresh. CI makes no shop call.

### Manual Testing Steps:

1. Phase 3's and Phase 4's phone walk-throughs on the dev server. They send a handful of real requests to Rossmann and Natura through the gate.
2. After the merge and before `/10x-archive`, on a phone against production:
   - open a matched product and watch both prices arrive
   - reopen it within 15 minutes
   - check the list's price lines
   - tap "Odśwież ceny" once

## Performance Considerations

- **Shop traffic:**
  - Opening a product costs at most one Rossmann and one Natura request, and none within 15 minutes of the last check by any watcher.
  - The page's button costs one of each.
  - A list refresh costs one Rossmann request per stale product and one Natura request per 50 stale SKUs. Past the cap, the rest keep their last price with its age.
  - Viewing the list costs none.
- **Waiting:**
  - The product page adds one database read after the product and its matches; the refetches happen after the page is shown.
  - Each JSON refresh is one invocation of about six subrequests: `getUser`, two reads, the gate's reservation, the shop and the insert. Rossmann answered in about 100-250 ms and Natura in about 120-230 ms in the research.
- **Database:** `latest_price_observations` reads every observation in the table and filters it by RLS, not only the rows the caller can see. The implementation review (F4) measured all 62 local rows read for a user with 5 items. The history grows with every fetch and has no retention. At 0.7 ms today the read is far from its 2 s limit. S-04 rewrites the view from the caller's watched items (`follow-ups/review-fixes.md`).
- **Client:** the product page starts loading the React chunks the sign-in page already uses, about 260 KB uncompressed in the current build.

## Migration Notes

- **Additive:** a new table and view, a new partial index, replaced EAN checks on two tables, and a narrower update grant.
  - Existing rows passed the stricter EAN rule already: they came through the digit-only checks. If one doesn't, the push fails and applies nothing; fix the row and push again.
  - The narrower grant covers every column `recordLookup` and `recordDecision` update (`src/lib/services/matches.ts:196-203`).
- **Order:** `db push` from the branch, confirmed with `migration list --linked`, then the merge. Once pushed, the migration file is frozen.
- **Rollback:** before S-04 depends on it, roll back by dropping the view and the table, and restoring the two EAN checks and the table-wide update grant.
- **Never:** `supabase config push`, or `migration up --linked`.

## References

- Research: `context/changes/cheapest-shop-today/research.md`, including the Follow-up live requests and the Worker probe
- Roadmap item: `context/foundation/roadmap.md` (S-03 `cheapest-shop-today`, including the owner's list request of 2026-09-28)
- PRD: US-01, US-02's acceptance criteria, FR-005, FR-008, FR-010, FR-011, the price-age and phone NFRs, Open Questions 5 and 8 (`context/foundation/prd.md`)
- S-02 and its follow-ups: `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:650-657`
- F-01's accepted risk (the precedent): `context/archive/2026-09-26-polite-shop-access/plan.md:405`
- Patterns:
  - `src/lib/services/matches.ts` and `src/lib/services/shops/natura.ts`
  - `supabase/migrations/20260927184936_watchlist_matches.sql` and `scripts/check-matches-db.mjs`
  - `src/components/auth/SignInForm.tsx`

## Implementation Notes

Where the shipped code differs from the phase contracts above, and why. The phase blocks still show the contract as it was planned.

### Adaptations during implementation

- **Phase 1, S-02's re-pointing check:** `scripts/check-matches-db.mjs` now expects `42501` when a not-found match is pointed at another user's product. The narrower update grant refuses the `watchlist_item_id` column before the composite foreign key is checked.
- **Phase 1, the price check's test data:**
  - Every run uses fresh shop item ids: observations are shared and never deleted, so real ids would leave fake prices in those items' local history and break reruns.
  - The `..` case first adds a product with that id, because RLS runs before the table's checks.
- **Phase 1, checks beyond the contract:** two-dimensional EAN arrays, reading the recording user, `anon` on the view, and the policy's match branch.
- **Phase 1, the view's grants** follow the tables' pattern: revoke all from `anon`, `authenticated` and `service_role`, then grant `select` to `authenticated`.
- **Phase 2, price bounds in one place:** `storableOffer` (`src/lib/services/shops/shop-offer.ts`) rounds amounts to grosze and drops what the table would refuse, so one odd value can't fail a whole batch insert.
  - A price outside the bounds makes the check `unavailable/failed`.
  - A regular price or 30-day low that doesn't fit becomes null.
- **Phase 2, Rossmann:** a 404 is `missing`, as recorded. The answer's `data.id` must equal the requested id.
- **Phase 2, Natura:** a SKU without a hit is `missing` only when every hit was readable and asked for; otherwise it's `unavailable`. Batches of 50 run one after another, so a block stops the next request.
- **Phase 2, the refresh service** removes duplicate targets and fetches Rossmann and Natura at the same time.
- **Phase 2, recordings** (2026-09-28, the owner's approval): four new answers.
  - Rossmann, an unknown id: HTTP 404 `application/problem+json`.
  - Natura: one SKU, two SKUs, and an unknown SKU with 0 hits.
  - The two research answers for Rossmann's detail are reused as they were.
- **Phase 3, the price route's answers:**
  - A failed read of the product or its matches answers `503 { error: "failed" }`.
  - The refusals carry `{ error: "forbidden" }` (403) and `{ error: "unsupported" }` (415).
  - The JSON checks live in `src/lib/json-request.ts`, which the island also uses to read answers. An `Origin` of `null` counts as another site.
- **Phase 3, a lone shop is never marked "Najtaniej":** with one row nothing is compared, so its summary is `only` and no row is marked. A tie's age is that of its oldest price.
- **Phase 3, texts with no price to keep:** `priceUnavailableText` and `priceMissingText` take `lastKnown`. When no price is left to show, the busy and paused texts don't promise one ("Spróbuj za minutę.", "Spróbuj później."), and the missing text doesn't mention one. `ageText` reads a time that doesn't parse as "czas nieznany".
- **Phase 3, the island:**
  - It judges the first refetch on the server's render time, as the page does.
  - "Odśwież ceny" is disabled while any shop's refetch runs, and a request gives up after 20 s.
  - The route's answers are checked by hand rather than with zod, which keeps zod out of the page's JavaScript.
  - A non-JSON answer with an error status, such as a gateway's 5xx page, is a failed refetch. Only a redirect, or a non-JSON page that loaded fine, means the session ended (review F10).
- **Phase 3, the gate's log:** every all-digit path segment is logged as `:id`, so Rossmann product ids no longer reach the log (the first accepted risk below).
- **Phase 3, smoke:** Astro's `checkOrigin` lets a same-origin form through, so the route itself answers the form post with 415. The 404 step also checks `no-store`.
- **Phase 3, the walk-through (2026-09-28 and 29):** the owner checked 1-3 on the dev server in a phone viewport. At the owner's request, the agent checked 4-6 from the server side with a throwaway local user, reading the island's props, the rendered rows and the gate's `shop_requests`.
  - The first open of an added NIVEA Soft 300 ml made one Natura request. The automatic match stored its price, so Natura needed no refetch.
  - Opening it from another site made no request and turned `autoRefresh` off.
  - A Natura price moved back 25 hours showed "nieaktualna" and lost the mark to Rossmann.
  - Node's `fetch` sends `Sec-Fetch-Mode: cors` whatever a script sets, and Astro's dev server answers cross-site requests that aren't navigations with 403. The cross-site checks therefore used `node:http`.
- **Phase 4, one choice of items for the list and its refresh:**
  - `productPriceKeys` and `listPricedItems` in `price-comparison.ts` give each product's priced items with their latest checks. The list page and the refresh route both use them. `staleTargets` takes those items and fetches each only once.
  - `listMatchStates` returns `ShopMatchState`, which carries a match's `shopItemId`. It drops a `matched` row without one.
- **Phase 4, the list line's open cases:**
  - A last check that found the item missing counts as out of date: "Rossmann: cena nieaktualna", and "· nieaktualna" for a lone shop (US-02, "marks the price stale").
  - A lone fresh price that can't be ordered online gets "· niedostępny online".
  - A lone row without a price gives "Jeszcze bez cen…".
  - "Ceny nieaktualne…" also covers rows whose prices can't win only because they can't be ordered online.
- **Phase 4, the refresh codes** live in `price-refresh.ts` (`refreshCodeOf`, `parsePriceRefreshCode`), and each page maps them to its own text.
  - `partial` includes answers that couldn't be stored.
  - A list, product or decisions read that fails gives `failed` before any shop request.
  - Another user's product id comes back as `?prices=none` on a page that answers 404.
- **Phase 4, the list page:**
  - It shows no price lines when the Natura decisions can't be read, since "Tylko w Rossmannie" could then be wrong.
  - A footnote, "Ceny online z rossmann.pl i drogerienatura.pl.", labels the prices as online.
  - The refresh button sits next to the list's heading.
- **Phase 4, the walk-through (2026-09-29):**
  - **Checked by the owner:** 1 and 2 on the dev server.
  - **Checked by the agent, at the owner's request, from the server side:** 3-6, using the gate's `shop_requests`, the stored observations and throwaway local users.
  - **Viewing the list:** four list views made no request.
  - **The first list refresh:** nine due items cost six requests, one per Rossmann product plus one Natura request for four SKUs.
  - **A second list refresh within 15 minutes:** it gave `none` with no request.
  - **The product page's form** (in its server-rendered HTML, as a browser without JavaScript gets it) gave `done` for one Rossmann and one Natura request.
  - **A second user** watching NIVEA Soft saw the owner's refreshed line. A user watching nothing saw no row, and the view gave that user `[]`.
- **Implementation review fixes (2026-09-29, `reviews/impl-review.md`; the owner chose each):**
  - **F1, an ended promotion's price counts as stale:**
    - `promoEndsOn` before today's date in Poland makes a price `stale`, so it can't be named cheapest and the list reads it as out of date. The end day itself stays fresh.
    - `needsRefetch` also fetches such a price again at once, but only if its check was made before the promotion ended. A check made after the end already holds the shop's answer and waits the usual 15 minutes, so a shop that keeps sending a passed end date isn't asked on every open.
  - **F2, screen readers hear each shop's answer:** one hidden live region outside the sorted list announces each answer, such as "Natura: 16,99 zł, najtaniej" or the row's unavailable or missing text. The row's "Odświeżam…" is visible only, and an ended session is left to the page's own alert.
  - **F3, one request at a time:** Rossmann's detail requests go out one at a time, replacing phase 2's "at most 5 at a time".
    - Once a shop answers busy, paused or stopped, its remaining targets in that refresh get the same answer with no request or reservation. The Natura batches got this rule too, since they didn't stop before.
    - A failed request doesn't stop the loop. A hanging Rossmann now costs its 5 s timeout per product.
  - **F7, per-shop inserts:** a refresh stores each shop's checks as soon as that shop is done, so at most two inserts, replacing phase 2's single call. The list's "Odśwież ceny" is disabled once its form is sent when JavaScript runs.
  - **F8, targets in a tested service:** which shop items a refresh fetches is decided in `src/lib/services/price-targets.ts` and unit-tested. The routes keep their behaviour.
  - **F9, one `keyText` and an ESLint guard:** `keyText` lives in `price-comparison.ts`. ESLint refuses non-type imports of server-only code in the island's five modules: zod, Supabase, `astro:*`, and every `@/lib/services/*` module except `price-comparison`. It also refuses relative imports in them.
  - **F4, F5, F6 and F10** are notes. The view rewrite and the amount bounds wait in `follow-ups/review-fixes.md`.
- **Phase 5, beyond the docs contract (the owner's calls, 2026-09-29):**
  - CLAUDE.md's non-negotiable now says price observations are shared by the item's watchers and hidden from everyone else. The PRD's access-control line gets a dated update note to match.
  - The `npm run dev` bullet now describes how to start the dev server under an agent: `ASTRO_DEV_BACKGROUND=1 npx astro dev` as a background task, and one more start after the Vite cache race.

### Accepted during implementation (the owner's call, 2026-09-28)

- **Rossmann product ids in the gate's log:** the F-01 gate logs the path of every request that doesn't succeed, and Rossmann's detail path carries the product id. Accepted for now, since only the owner reads the Workers logs. Phase 3 blanks the id out of the gate's log line.
- **Any Rossmann 404 counts as missing:** the gate drops the bodies of error answers, so a 404 from a moved API would look like a product that's gone. Every Rossmann price would then show as stale, never as a wrong current price, and the logs would show the 404s.

### Production rollout

- **Merged on 2026-09-29** as `0e60bea` (PR #9), after the implementation review's fixes (`0de341b`).
  - The price migration was already on production, confirmed with `npx supabase migration list --linked` before the merge.
  - Workers Builds deployed the merge at 14:12 UTC, and `ci` and `smoke` passed on `main`.
- **The owner's phone check on production passed** the same day (Manual Testing Steps, step 2). It covered a matched product's prices arriving, reopening within 15 minutes, the list's price lines, and "Odśwież ceny".

### For S-04 and later

- **The view:** `latest_price_observations` reads the whole table (review F4). S-04's migration drives it from the caller's watched items.
- **The migrations:** the next one that touches `price_observations` bounds `regular_price` and `lowest_price_30d` (review F6). Both are in `follow-ups/review-fixes.md`, with the stop after two failed requests in a row.
- **The accepted risks:** revisit them before inviting more people: fake prices on any item, co-watchers' check times, and F-01's direct RPC.
- **Other shops:** S-05 and S-06 add their shops to `PRICED_SHOPS` and `SHOP_LABELS`, a price lookup through the gate, and `refreshPrices`. The comparison rules, the island and the list take them without other changes.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Price data contract

#### Automated

- [x] 1.1 With Docker running, `npx supabase migration up --local` applies the migration, then `node scripts/check-prices-db.mjs` with the local URL and anon key prints only PASS lines — dab5b2d
- [x] 1.2 `node scripts/check-matches-db.mjs` and `node scripts/check-watchlist-db.mjs` still print only PASS lines — dab5b2d
- [x] 1.3 `npm run test` passes, including the prices service tests — dab5b2d
- [x] 1.4 `npx astro sync && npx astro check` reports 0 errors — dab5b2d
- [x] 1.5 `npm run lint` passes — dab5b2d
- [x] 1.6 CI `smoke` job runs "Check price observations database contract" and is green on the PR — dab5b2d

#### Manual

- [x] 1.7 Migration review: only watchers can select or insert, with no update or delete path; users can't set the time, source or recording user, or read the recording user; the view is `security_invoker`; the EAN and match-grant follow-ups are in place — dab5b2d

### Phase 2: Shop price lookups

#### Automated

- [x] 2.1 `npm run test` passes, including the Rossmann and Natura price tests and the refresh service tests — bffd267
- [x] 2.2 `npx astro sync && npx astro check` reports 0 errors — bffd267
- [x] 2.3 `npm run lint` passes — bffd267
- [x] 2.4 `npm run build` passes — bffd267

#### Manual

- [x] 2.5 Fixture review: every new recording used the gate's User-Agent, went at least 2 s apart, is trimmed to the fields the adapters read, and holds no cookies or personal data; the unknown-id and unknown-SKU recordings show what "not found" looks like — bffd267

### Phase 3: Product page prices

#### Automated

- [x] 3.1 `npm run test` passes, including the comparison, wording and island state tests — 61d1e5b
- [x] 3.2 `npx astro sync && npx astro check` reports 0 errors — 61d1e5b
- [x] 3.3 `npm run lint` passes — 61d1e5b
- [x] 3.4 `npm run build` passes — 61d1e5b
- [x] 3.5 CI `ci` and `smoke` jobs are green on the PR, including the new price route smoke steps — 61d1e5b

#### Manual

- [x] 3.6 Phone-viewport walk-through against `npm run dev` with the local Supabase: opening a matched product shows the stored prices at once, then each shop updating as it answers, ordered, with the cheapest marked; reopening within 15 minutes makes no shop request; "Odśwież ceny" refetches both shops; a link from another site shows the prices without a refetch and offers the button; a price made 25 hours old in the local database shows "nieaktualna" and loses the mark; an automatic Natura match shows its price with no extra Natura request — 61d1e5b

### Phase 4: Watchlist prices and refresh

#### Automated

- [x] 4.1 `npm run test` passes, including the list text and refresh target tests — 5dee998
- [x] 4.2 `npx astro sync && npx astro check` reports 0 errors — 5dee998
- [x] 4.3 `npm run lint` passes — 5dee998
- [x] 4.4 `npm run build` passes — 5dee998
- [x] 4.5 CI `ci` and `smoke` jobs are green on the PR, including the refresh route smoke steps — 5dee998

#### Manual

- [x] 4.6 Phone-viewport walk-through against `npm run dev` with the local Supabase: each matched product's row shows the cheapest shop, its price, the difference and the age; a product matched only in Rossmann shows "Tylko w Rossmannie"; viewing the list makes no shop request; "Odśwież ceny" refreshes only products checked more than 15 minutes ago and shows the result notice; the product page's button works with JavaScript off; a second user watching the same Rossmann item sees the shared price, and a user who doesn't watch it sees none — 5dee998

### Phase 5: Docs and production rollout

#### Automated

- [x] 5.1 CI `ci` and `smoke` jobs are green on the PR after the documentation changes — 28d48c4
- [x] 5.2 `npx supabase migration list --linked` shows the price migration with a remote version — 28d48c4

#### Manual

- [x] 5.3 Owner ran `npx supabase db push` (the dry run listed only the price migration) and it reported success — 28d48c4
- [x] 5.4 Supabase dashboard shows `price_observations` with RLS on and its two policies, and `latest_price_observations`; Security Advisor shows no errors — 28d48c4
- [x] 5.5 CLAUDE.md and research note updates reviewed — 28d48c4
