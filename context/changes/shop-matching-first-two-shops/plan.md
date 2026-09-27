# Shop Matching in the First Two Shops Implementation Plan

## Overview

Each watched product gets its match in the first two shops, Rossmann and Drogerie Natura, once. Rossmann's match is the item the user picked in the search. Natura's is found by the app:

- A single candidate that shares one of the product's EANs and has the same size is accepted automatically.
- Anything else is shown to the user to pick or reject, with a size mismatch flagged.
- A lookup that finds nothing is shown as not found, with a retry.

Every decision is remembered. The user meets all of this on a new product page, which "Dodaj" now leads to.

This is roadmap item **S-02** (Change ID `shop-matching-first-two-shops`). It covers US-02, FR-006 and FR-013 for the first two shops. It's the first slice with a second shop adapter and the first that stores which shop item stands for a product (FR-004: the confirmed per-shop item is the anchor).

## Current State Analysis

- **Rossmann is the only shop in use.** `src/lib/services/shops/rossmann.ts` searches by text through the gate. `watchlist_items` stores the picked item as the product's source (`source`, `source_item_id`), explicitly "not as a confirmed match" (archived S-01 plan, What We're NOT Doing).
- **The gate already knows Natura.**
  - `SHOP_HOSTS.natura` allows `www.drogerienatura.pl` and `live.luigisbox.com` (`src/lib/services/shop-gate.ts:9-14`).
  - `public.shops` has a `natura` row with the default cap of 30 a minute (`supabase/migrations/20260926112205_polite_shop_access.sql:40-44`).
  - Hebe uses the same Luigi's Box host; F-01 accepted up to 60 requests a minute reaching it.
- **Natura's search is documented, not recorded** (`docs/research/polish-drugstore-price-apis.md` §2.5).
  - `GET https://live.luigisbox.com/search?tracker_id=703598-939363&q=<EAN or text>&size=<n>`: an EAN query works.
  - Each hit's `url` is the SKU (e.g. `NV89063`). `attributes` carry `title`, `brand[]`, `ean[]`, `size[]` ("300.0000"), `size_unit[]` ("ml"), `price_amount`, `price_old_amount`, `lowest_price[]`, `availability`, `web_url` and `image_link`.
  - Hebe's hits can include a query-suggestion pseudo-hit without a price (§2.2); Natura's may too.
- **The tracker id sits in a large page.** Natura's home page is 3.3 MB and redirects once (§9), and the gate never follows redirects (F-01 review). Reading the id at runtime would need the final URL and a cache.
- **Pieces to reuse:**
  - `parseSize` (`src/lib/services/size.ts:18`): ml, l, g, kg and pieces, with a decimal comma or point.
  - `PRODUCT_LIMITS` (`src/lib/services/product-limits.ts:3`), which the adapter and the form share, as the S-01 review (F1) requires.
  - `searchQuerySchema` and `isOwnNavigation` (`src/lib/services/search-query.ts:5-21`).
  - The Rossmann adapter's gate-outcome mapping (`src/lib/services/shops/rossmann.ts:83-102`).
  - `ProductSummary.astro`, the form-route pattern with error codes (`src/pages/api/watchlist.ts`), and the RLS and grant pattern with its two-user database check (`scripts/check-watchlist-db.mjs`).
- **Carry-overs from S-01** (archived plan, Implementation Notes, "For S-02 and later"):
  - `watchlist_items` bounds only `name` in the database. This slice's migration adds length caps, https-only `image_url` and at most 10 EANs.
  - Ids that go into URLs are validated and encoded.
- **Rollout rule:** the owner pushes the migration before the merge, and the agent confirms it with `npx supabase migration list --linked` (CLAUDE.md, Data).

## Desired End State

- **Adding:** "Dodaj" on a search result stores the product and opens its page, `/watchlist/<id>`.
- **The product page:**
  - It shows the Rossmann item as the product's source.
  - For Natura, it shows the stored decision. With none stored, it looks the product up there and then:
    - stores an automatic match and shows it as matched automatically (same EAN and size), or
    - shows up to 3 candidates with name, size, a labelled online price and flags, each with "To ten produkt" and one "Żaden z nich" for all, or
    - stores "not found" and offers "Szukaj ponownie".
  - When Natura can't be asked, it says why, as the search does, and stores nothing.
- **Decisions:** confirming or declining is stored per user and product and never asked again. Re-pinning is S-08.
- **The list:** each entry links to its product page and shows its Natura status.
- **Checks:** the database proves that matches are private and immutable once decided. The Natura adapter, the rule and the lookup are tested against recorded Luigi's Box answers. The smoke test covers the new page's access rules.

How to verify:

- CI is green on the PR.
- The Phase 3 phone-viewport walk-through passes locally.
- After the owner's push, `npx supabase migration list --linked` lists the new migration with a remote version.

### Key Discoveries:

- `src/types.ts:18-24`: a `failed` gate outcome carries the HTTP `status`, so the adapter can say when Luigi's Box rejects the tracker id.
- **Foreign keys don't follow RLS.** PostgreSQL applies neither RLS nor the inserting role's privileges to foreign-key checks (archived S-01 plan). A plain `watchlist_item_id` reference would let a user attach a match to another user's item. A composite foreign key `(watchlist_item_id, user_id) → watchlist_items (id, user_id)` rules that out structurally.
- **Updates that RLS filters out don't fail.** PostgREST reports success with zero rows, so the database check and the service must ask for the updated rows back with `.select()`.
- `npx supabase migration up --local` applies new migrations without wiping local users; `db reset --local` deletes the owner's local accounts. `--linked` would apply to production and is never used.
- **Floats:** `parseSize("0,5 l")` yields 500 exactly, but `0.3 * 1000` is `300.00000000000006` in JavaScript. Size equality therefore needs a tolerance.
- **No prefetch:** `astro.config.mjs` doesn't enable prefetch, so only real navigations reach the product page. Its lookups are still guarded by `isOwnNavigation`, as the search is (S-01 review F5).

## What We're NOT Doing

- **No re-pinning or removing matches, and no removing products** (S-08). Before S-08, only a `not_found` decision can change, by a retry.
- **No stored prices or price observations** (S-03). A candidate's price is shown only while the user decides, labelled as Natura's online price with its fetch time.
- **No other shops:** no Hebe (S-05) and no Super-Pharm (S-06). Rossmann stays the only search source.
- **No brand-mismatch warning.** Suspicious-match warnings beyond the size flag belong to S-08 (FR-007).
- **No refresh of matched items.** Price refresh, and "a refresh that returns nothing never un-pins", belong to S-03.
- **No stored candidate lists, no background or scheduled lookups**, and no reading Natura's page for the tracker id.
- **No shared products or matches table.** Matches are private per user, like the watchlist.
- **No image proxying.** Natura thumbnails load straight from Natura, the tradeoff S-01 accepted for Rossmann (review F2).

## Implementation Approach

1. **Database first**, as in S-01. The matches table, its ownership key and its RLS contract are proven against the local Supabase before any code writes to it.
2. **The Natura adapter and the rule:** pure modules over an injected gate, tested against Luigi's Box answers recorded once. The matching rule is a pure function, so every edge case gets a table test.
3. **The product page and the confirm route** reuse the S-01 patterns: server-rendered forms, error codes, `locals.supabase`, own-navigation lookups. "Dodaj" and the list link to the new page.
4. **Docs and the owner's production push** before the merge, confirmed with `migration list --linked`.

## Critical Implementation Details

- **State sequencing:** the confirm route inserts first. On `23505` it updates the row only if it's still `not_found`, and asks for the updated rows back. No rows back means the product was already decided, as with a double submit or two tabs. The route reports that as "already decided", never as a second decision.
- **Timing & lifecycle:** the page's lookup and its writes run during the GET render, and only on the user's own navigation. `?retry=1` acts only on a stored `not_found`, so a stored decision can't be re-looked-up through the URL.

## Phase 1: Match data contract

### Overview

Create the private matches table with a composite ownership key, per-operation RLS and explicit grants, and add S-01's pending database bounds to `watchlist_items`. Then prove, with two users against the local Supabase, that no one can see another user's matches, attach a match to another user's product, or change a decided match.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_watchlist_matches.sql`

**Intent**: Store, per user and product, what each shop's match is: an item, a declined shop or a failed lookup. The database holds the ownership and immutability rules, and `watchlist_items` gets the bounds S-01 left to the form.

**Contract**:

- **`watchlist_items`, new constraints:**
  - `unique (id, user_id)`, the target of the composite key
  - `source_item_id ~ '^[A-Za-z0-9._-]{1,40}$'`
  - `char_length(brand) <= 120`, `char_length(caption) <= 300` and `char_length(size_text) <= 40`
  - `image_url ~ '^https://'` and `char_length(image_url) <= 500`
  - `cardinality(eans) <= 10`, and every EAN is 8–14 digits: `array_to_string(eans, ',') ~ '^([0-9]{8,14}(,[0-9]{8,14})*)?$'`
  - Existing rows passed the same limits in S-01's route. If one doesn't, the push fails as a whole and applies nothing.
- **`public.watchlist_matches`:**
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null default auth.uid()`
  - `watchlist_item_id uuid not null`
  - `foreign key (watchlist_item_id, user_id) references public.watchlist_items (id, user_id) on delete cascade`
  - `shop_id text not null references public.shops (id)`
  - `state text not null`, one of:
    - `matched`: an item accepted automatically or confirmed
    - `unmatched`: the user chose "Żaden z nich"
    - `not_found`: the lookup found nothing
  - `decided_by text not null`: `auto` or `user`. `unmatched` requires `user`, and `not_found` requires `auto`.
  - The shop's item, all set exactly when the state is `matched`, otherwise null:
    - `shop_item_id text` (`^[A-Za-z0-9._-]{1,40}$`) and `name text` (1–300)
    - `brand text` (≤ 120) and `size_text text` (≤ 40)
    - `size_value numeric` (> 0) and `size_unit text` (`ml`, `g`, `pcs`): both set or both null
    - `eans text[] not null default '{}'`, with the same bounds as above
    - `product_url text` and `image_url text`, each https and ≤ 500
  - `checked_at timestamptz not null default now()`: when the decision or last lookup happened
  - `created_at timestamptz not null default now()`
  - `unique (watchlist_item_id, shop_id)`
  - A table comment: private per user; one decision per product and shop; only `not_found` changes before S-08.
- **RLS:** enabled, with one policy per operation for `authenticated`:
  - select: `using ((select auth.uid()) = user_id)`
  - insert: `with check ((select auth.uid()) = user_id)`
  - update: `using ((select auth.uid()) = user_id and state = 'not_found') with check ((select auth.uid()) = user_id)`
  - no delete policy
- **Privileges:** `revoke all on table public.watchlist_matches from anon, authenticated, service_role;`, then `grant select, insert, update on table public.watchlist_matches to authenticated;`.

#### 2. Database contract check

**File**: `scripts/check-matches-db.mjs`

**Intent**: Prove the matches table's privacy, ownership and immutability, and the new `watchlist_items` bounds, against the local Supabase, in the style of `scripts/check-watchlist-db.mjs`.

**Contract**:

- **Setup:** localhost-only guard; two throwaway users A and B, each with their own client, each adding one watchlist item.
- **Assertions:**
  1. A adds a `matched` (`auto`) Natura match for their item and reads back exactly that row.
  2. A adding a second Natura decision for the same item fails with `23505`.
  3. B's select returns none of A's matches, including a select by A's match id.
  4. B inserting a match for A's item fails: with B's own `user_id` the composite key refuses it (`23503`); with A's `user_id`, RLS refuses it (`42501`).
  5. A's update of the `matched` row changes nothing (no rows returned), and neither does an update of an `unmatched` row.
  6. A's `not_found` row can be updated to `matched` by A (one row returned).
  7. A's delete is refused, and anon select and insert fail with `42501`.
  8. `watchlist_items` refuses (`23514`) an `http` image URL, 11 EANs, an EAN of 5 digits, a `source_item_id` containing `/` and a 41-character size text.
  9. `watchlist_matches` refuses (`23514`) a `matched` row without `shop_item_id`, an `unmatched` row decided by `auto`, and a `not_found` row carrying an item.
- **Result:** it exits 1 on any failure. Fresh users each run, so reruns need no reset.

#### 3. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Run the matches contract check on every push and PR.

**Contract**: a step "Check shop matches database contract" in the `smoke` job after "Check watchlist database contract" (`.github/workflows/ci.yml:51`). Same environment wiring as that step.

### Success Criteria:

#### Automated Verification:

- With Docker running: `npx supabase migration up --local`, then `node scripts/check-matches-db.mjs` with the local URL and anon key prints only PASS lines
- `node scripts/check-watchlist-db.mjs` still prints only PASS lines
- `npm run lint` passes
- CI `smoke` job runs "Check shop matches database contract" and is green on the PR

#### Manual Verification:

- Migration review: one policy per operation for `authenticated` only, updates only on `not_found` rows, no delete path, the composite key ties every match to its owner's product, and the new `watchlist_items` bounds equal the form limits

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Natura lookup and the matching rule

### Overview

Record real Luigi's Box answers for Natura once. Then build the Natura adapter, the pure matching rule and the EAN-then-name lookup, all tested only against those recordings.

### Changes Required:

#### 1. Recorded Natura answers

**Files**: `src/lib/services/shops/fixtures/natura-ean-hit.json`, `natura-ean-miss.json`, `natura-name-search.json`, `natura-unknown-tracker.json`

**Intent**: Capture the real hit shape, including `image_link` hosts, pseudo-hits and how an unknown tracker id is answered, so the adapter follows reality.

**Contract**:

- A one-off manual recording from the developer machine, never from CI or app code. Four `curl` requests, at least 2 seconds apart, with the gate's User-Agent and `Accept: application/json`:
  - `q=4005900009319&size=5`: Nivea Soft 300 ml, the research note's sample
  - `q=` an EAN Natura doesn't list, `size=5`
  - `q=nivea soft 300 ml&size=10`
  - an invalid `tracker_id` with `q=nivea`, keeping its status and body
- Trim each body to at most 5 hits. No cookies or personal data.

#### 2. Shared shop types and limits

**Files**: `src/types.ts`, `src/lib/services/product-limits.ts`

**Intent**: One definition of a shop's candidate item and of a lookup's outcome, shared by the adapter, the rule, the page and the confirm route.

**Contract**:

- `ShopCandidate`: `shop: ShopId`, `shopItemId`, `brand | null`, `name`, `sizeText | null`, `size: Size | null`, `eans: string[]`, `productUrl | null`, `imageUrl | null`, `price: number | null`
- `CandidateVerdict`: `{ sharesEan: boolean; size: "equal" | "differs" | "unknown" }`
- `ShopLookup`: one of
  - `{ kind: "accepted"; candidate }`
  - `{ kind: "choose"; options: { candidate; verdict }[]; via: "ean" | "name" }`
  - `{ kind: "not-found" }`
  - `{ kind: "unavailable"; reason: SearchUnavailableReason; until?: string }`
- `PRODUCT_LIMITS` gains `shopItemId: 40` and `productUrl: 500`.

#### 3. Shared gate-outcome mapping

**Files**: `src/lib/services/shops/shop-outcome.ts`, `src/lib/services/shops/rossmann.ts`

**Intent**: Say why a shop can't be asked in one place, so Rossmann and Natura explain it the same way.

**Contract**: `gateUnavailable(outcome)` returns `{ kind: "unavailable"; reason; until? }`. It is the mapping now at `rossmann.ts:83-102`, moved unchanged. Rossmann calls it, and its tests stay green without edits.

#### 4. Natura adapter

**File**: `src/lib/services/shops/natura.ts`

**Intent**: Ask Natura's Luigi's Box search through the gate, and return candidates or a clean "unavailable", never an exception or half-parsed data.

**Contract**:

- `NATURA_TRACKER_ID = "703598-939363"`, a constant with a comment: the public id from Natura's page (research §2.5); if Luigi's Box rejects it, update it here.
- `searchNatura(gate, query: string, size: number): Promise<ShopSearch>`, where `ShopSearch` is `{ kind: "results"; candidates: ShopCandidate[] }` or the unavailable variant.
  - It calls `https://live.luigisbox.com/search?tracker_id=…&q=<encoded>&size=<n>`.
  - Headers: `Accept: application/json`; `signal: AbortSignal.timeout(4000)`.
  - The query must already be a valid EAN or have passed `searchQuerySchema`.
- **Failures:**
  - A gate outcome other than `ok` becomes `gateUnavailable(outcome)`.
  - An unreadable body or an unexpected shape gives `failed`, with one log line.
  - The recorded unknown-tracker answer gives `failed`, with a log line saying the tracker id may have changed. If the recording shows Luigi's Box answering an unknown id exactly like an empty result, record that in the plan's Implementation Notes. The lookup's both-empty log line (below) then serves as the signal.
- **Mapping, each hit checked on its own:**
  - Keep only hits whose `attributes.price_amount` is a positive number; this drops pseudo-hits.
  - `shopItemId` is the hit's `url`, which must match `^[A-Za-z0-9._-]{1,40}$`; otherwise the hit is dropped.
  - `name` is `title`, trimmed and cut to 300, and the hit is dropped if it's empty. `brand` is `brand[0]`, cut to 120.
  - `size` is `parseSize` of `size[0]` plus `size_unit[0]`. `sizeText` is its display form ("300 ml"), or null when it doesn't parse or exceeds 40.
  - `eans` are the `ean[]` strings of 8–14 digits, at most 10.
  - `productUrl` is `web_url` when it's https on a `drogerienatura.pl` host and within the limit.
  - `imageUrl` is `image_link` when it's https on the host the recorded fixture shows and within the limit.
  - `price` is `price_amount`.

#### 5. Matching rule

**File**: `src/lib/services/matching.ts`

**Intent**: Decide, without I/O, whether a shop's candidates contain the product: exactly one candidate that shares an EAN and the size is accepted, and everything else is for the user.

**Contract**:

- `sizesEqual(a: Size, b: Size)`: same unit, and `|a − b| ≤ 0.001 × max(a, b)`. This absorbs float rounding such as `0.3 × 1000` and nothing else.
- `judge(product: { eans; size }, candidate) → CandidateVerdict`:
  - `sharesEan` when any of the product's EANs is among the candidate's.
  - `size` is `unknown` when either size is null.
- `pickMatch(product, candidates, limit = 3)`:
  - It accepts when exactly one candidate shares an EAN with size `equal`.
  - Otherwise, with any candidates, it returns `choose`: qualifying candidates first, then the rest in the shop's order, cut to `limit`.
  - With no candidates it returns `none`.
  - Two qualifying candidates are ambiguous and go to the user.

#### 6. The lookup

**Files**: `src/lib/services/shop-matching.ts`, `src/lib/services/search-query.ts`

**Intent**: Find a product in Natura with as few requests as possible: its EAN first, then one name search only if the EAN finds nothing.

**Contract**:

- `lookupInNatura(gate, product: { brand; name; sizeText; size; eans }) → ShopLookup`:
  1. With EANs, `searchNatura(product.eans[0], 5)`:
     - unavailable returns unavailable, with no further request
     - candidates go to `pickMatch` and return `accepted`, or `choose` via `ean`
  2. Without EANs, or with no candidates from step 1:
     - `toShopQuery(`${brand} ${name} ${sizeText}`)`, then `searchNatura(query, 10)`, then `pickMatch`
     - this returns `accepted`, `choose` via `name` or `not-found`
     - an unusable query returns `not-found` with no request
  3. When both steps return no candidates, log one line saying Natura found nothing for this EAN or name.
- `toShopQuery(text)` in `search-query.ts`:
  - Replace characters outside `ALLOWED` with spaces and collapse whitespace.
  - Cut to 80 characters at a word boundary.
  - Return the text only if `searchQuerySchema` accepts it, otherwise null.

#### 7. Tests

**Files**: `src/lib/services/shops/natura.test.ts`, `src/lib/services/matching.test.ts`, `src/lib/services/shop-matching.test.ts`, `src/lib/services/shops/shop-outcome.test.ts`, `src/lib/services/search-query.test.ts`

**Intent**: Pin the adapter to the recordings through the real gate, and pin every branch of the rule and the lookup. A change in Luigi's Box's shape or in the rule then fails CI.

**Contract**:

- **Adapter** (real gate over `createReplayFetch`, asserting the requested URLs):
  - the EAN hit mapped to SKU, name, brand, "300 ml", EANs, price and an https product URL
  - the EAN miss and the name search mapped, with pseudo-hits dropped
  - the unknown tracker gives `failed` and its log line
  - the 4 s signal is passed
  - an odd value (a numeric EAN, a foreign `web_url` host, a bad SKU) costs only itself
- **Rule** (table tests):
  - `sizesEqual`: 300 vs 300.0000 ml, 0,3 l vs 300 ml, 200 vs 300 ml, ml vs g
  - `pickMatch`: one qualifier among others; a shared secondary EAN; two qualifiers; a shared EAN with a different size; an unknown product size; no candidates; the limit of 3
- **Lookup:**
  - an EAN hit makes exactly one request
  - an EAN miss is followed by one name search, two requests
  - both empty gives `not-found` and its log line
  - an unavailable EAN step makes no name request
  - a product without EANs goes straight to the name search
  - an unusable name makes no request
- **Shared mapping:** every gate outcome maps to its reason.
- **`toShopQuery`:** Polish text and sizes survive; `;` and `<` are stripped; over-long text is cut at a word boundary.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the Natura adapter, matching rule, lookup and shared outcome tests
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Fixture review: four real Luigi's Box answers for Natura (EAN hit, EAN miss, name search, unknown tracker) recorded with the gate's User-Agent at least 2 seconds apart, trimmed, with no cookies or personal data

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Product page and confirm flow

### Overview

Give each watched product its own page, where the Natura match is shown, found or decided. Make "Dodaj" land there, and link every list entry to it with its Natura status.

### Changes Required:

#### 1. Matches service

**Files**: `src/lib/services/matches.ts`, `src/lib/services/watchlist.ts`

**Intent**: Keep the page and the route thin. The services read the product and its decisions and record the outcomes, all through the user's own client, so RLS does the enforcing.

**Contract**:

- `watchlist.ts`:
  - `getWatchlistProduct(supabase, id)` returns the item with its `eans` and `size`, or `null` when there's no such row, or `"failed"`.
  - `addToWatchlist` now returns `{ kind: "added"; id }`, `"exists"` or `"failed"`, getting the id from `.select("id").single()`.
- `matches.ts`: every call has a 2 s `abortSignal`, and rows are parsed one at a time; odd ones are dropped and logged.
  - `listMatches(supabase, itemId?)` returns `ShopMatch[]`: the state, the item when matched, `decidedBy` and `checkedAt`.
  - `recordLookup(supabase, itemId, shop, outcome)` stores an `accepted` lookup as `matched`/`auto` and a `not-found` as `not_found`/`auto`. It inserts, or updates a `not_found` row.
  - `recordDecision(supabase, itemId, shop, decision)` stores a user decision, a confirmed candidate or a decline. It inserts first. On `23505` it updates the row only if it's `not_found`, with `.select()`. It returns `saved`, `decided` (already decided) or `failed`.
  - `parseMatchForm(form)`:
    - `itemId` must be a UUID, `shop` must be `natura` and `action` is `confirm` or `decline`.
    - For `confirm`, the candidate fields are checked against `PRODUCT_LIMITS` and the Natura URL rules, and the size is parsed again from `sizeText`.
  - `MATCH_ERRORS` holds the codes `invalid`, `failed`, `config` and `gone`, and `matchErrorMessage(code)` gives their Polish text. Anything else gives null.

#### 2. The product page

**Files**: `src/pages/watchlist/[id].astro`, `src/lib/shop-messages.ts`, `src/pages/watchlist.astro`

**Intent**: The screen where a product's shops get settled once, readable on a phone and in Polish.

**Contract**:

- `Astro.params.id` must be a UUID, and the product must exist. Otherwise the page answers 404 with "Nie znaleziono produktu." and a link to the list, and makes no shop call.
- **Header:** "← Moja lista", then the product (`ProductSummary`).
- **Rossmann:** "Produkt wybrany w wyszukiwarce Rossmanna", with no lookup.
- **Natura, by stored decision:**
  - `matched`: the item and "Dopasowano automatycznie: ten sam EAN i rozmiar." or "Potwierdzone przez Ciebie." A size that differs from the product's stays visible as "Inny rozmiar: X zamiast Y".
  - `unmatched`: "Brak w Naturze — Twój wybór."
  - `not_found`: "Nie znaleziono w Naturze (sprawdzono DD.MM, HH:MM).", with a "Szukaj ponownie" link to `?retry=1`.
  - No decision, or `not_found` with `?retry=1`:
    - With `isOwnNavigation`, the page runs `lookupInNatura(shopGateFor(supabase), product)` and records `accepted` or `not-found` with `recordLookup`.
    - Without it, it shows "Otwórz produkt, aby dopasować go w Naturze." with a same-site link.
  - `choose`: up to 3 options, each with:
    - `ProductSummary` and the flags "Ten sam EAN", "Inny rozmiar: X zamiast Y" or "Rozmiar nieznany"
    - the price as "22,99 zł · cena online w drogerienatura.pl, pobrano HH:MM" (pl-PL, Europe/Warsaw)
    - a "Zobacz w sklepie" link to `productUrl`, and a "To ten produkt" POST form with the candidate as hidden inputs

    One "Żaden z nich" POST form follows the options.

  - `unavailable`: `shopUnavailableText("Natura", reason, until)`, with nothing stored.
- **Notices:** `matched=1` "Zapisano dopasowanie.", `declined=1` "Zapisano: brak w Naturze.", `decided=1` "Ten produkt ma już zapisaną decyzję.", and `error=<code>` via `matchErrorMessage`.
- `src/lib/shop-messages.ts`: `shopUnavailableText(shopName, reason, until)` holds the four texts, which the watchlist search then uses too:
  - busy: "Wyszukiwarka sklepu {shop} jest teraz zajęta. Spróbuj za minutę."
  - paused: "Sklep {shop} poprosił o przerwę. Wyszukiwanie wróci około HH:MM." (or "Spróbuj później." without `until`)
  - stopped: "Wyszukiwanie w sklepie {shop} jest wyłączone, bo sklep zablokował zapytania. Właściciel musi je ponownie włączyć."
  - failed: "Wyszukiwarka sklepu {shop} jest chwilowo niedostępna. Spróbuj za chwilę."
- **Layout:** `<Layout lang="pl">` in the glass style, a single mobile-first column, tap targets of at least 44 px, and thumbnails with `loading="lazy"`.

#### 3. The confirm route

**File**: `src/pages/api/watchlist/matches.ts`

**Intent**: Handle "To ten produkt" and "Żaden z nich" the way `/api/watchlist` handles "Dodaj".

**Contract**: `export const POST: APIRoute`.

- A missing client, a body that isn't a form, or an invalid form redirects with `error=config` or `error=invalid`. The target is `/watchlist/<id>` when the id is valid, otherwise `/watchlist`.
- It calls `recordDecision` and redirects:
  - `saved` goes to `/watchlist/<id>?matched=1` or `?declined=1`
  - `decided` goes to `?decided=1`
  - `failed` goes to `?error=failed`
- It makes no shop request.

#### 4. "Dodaj" and the list

**Files**: `src/pages/api/watchlist.ts`, `src/pages/watchlist.astro`

**Intent**: Land on the product page right after adding, and make every product reachable from the list.

**Contract**:

- `added` redirects to `/watchlist/<id>`; `exists` and the error codes stay as they are.
- On the list, each entry becomes a link to `/watchlist/<id>` showing its Natura status, from one `listMatches` call for the page:
  - "Natura: dopasowano"
  - "Natura: do dopasowania" (no decision)
  - "Natura: nie znaleziono"
  - "Natura: brak (Twój wybór)"
- The search's unavailable text comes from `shopUnavailableText("Rossmann", …)`.

#### 5. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Cover the new page's access rules without touching any shop.

**Contract**:

- An anonymous `/watchlist/00000000-0000-4000-8000-000000000000` redirects to `/auth/signin`.
- Signed in, the same URL and `/watchlist/not-a-uuid` both answer 404. There's no such product, so no lookup runs.

#### 6. Service tests

**Files**: `src/lib/services/matches.test.ts`, `src/lib/services/watchlist.test.ts`

**Intent**: Pin the confirm form and the decision writes, since the posted fields end up in the user's rows.

**Contract**:

- `parseMatchForm`:
  - accepts a confirm form built from every recorded Natura candidate the way the page posts it, and a decline form without candidate fields
  - rejects a bad UUID, a shop other than Natura, an unknown action, an http or foreign-host product URL, more than 10 EANs and an over-long name
- `matchErrorMessage`: known codes give their text; null, an unknown code and `toString` give null.
- Stubbed clients, asserting an `AbortSignal` on every call:
  - `recordDecision` covers insert, `23505` then an update of a `not_found` row, and `23505` with no updated row (`decided`)
  - `recordLookup` covers `accepted` and `not-found`
  - `listMatches` drops an odd row and keeps the rest
- `addToWatchlist` returns the new id.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes
- CI `ci` and `smoke` jobs are green on the PR, including the new product-page smoke steps

#### Manual Verification:

- Phone-viewport walk-through against `npm run dev` with the local Supabase: adding Nivea Soft 300 ml lands on its page with Natura matched automatically; a product Natura lists differently shows candidates with the size flag and a labelled price; "To ten produkt" and "Żaden z nich" are remembered on reopening with no new lookup; "Szukaj ponownie" retries a not-found product; the list shows each product's Natura status; a second user sees none of the first user's products or matches

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Docs and production rollout

### Overview

Record the new rules in CLAUDE.md, and put the migration on production before the merge. The agent confirms it through `migration list --linked`, the rule S-01's rollout added.

### Changes Required:

#### 1. Project rules

**File**: `CLAUDE.md` (project section only, above the 10x-cli block)

**Intent**: Future sessions find the product page, the match states, the Natura adapter's tracker constant and the local migration command.

**Contract**:

- **Commands:**
  - `node scripts/check-matches-db.mjs`, with the same needs as the watchlist check.
  - `npx supabase migration up --local` applies new migrations without wiping local users. Prefer it to `db reset`, and never use `--linked`.
- **Architecture:**
  - `/watchlist/<id>` is a product's page.
  - `watchlist_matches` holds one decision per user, product and shop: `matched`, `unmatched` or `not_found`. Only `not_found` changes before S-08.
  - The matching rule lives in `src/lib/services/matching.ts`: exactly one candidate sharing an EAN and the size is accepted automatically.
  - The Natura adapter's tracker id is a constant in `src/lib/services/shops/natura.ts`; update it when Luigi's Box rejects it.

#### 2. Production (owner, then agent)

**Where**: the owner's terminal, on `feat/shop-matching-first-two-shops`, before the merge.

**Intent**: The merge deploys a page that reads the new table, so the table must exist first.

**Contract**:

1. The owner runs `npx supabase db push --dry-run`, which should list only the matches migration, then `npx supabase db push`.
2. The agent runs `npx supabase migration list --linked` (read-only) and confirms the migration has a remote version before the PR is marked ready.

### Success Criteria:

#### Automated Verification:

- CI `ci` and `smoke` jobs are green on the PR after the documentation changes
- `npx supabase migration list --linked` shows the matches migration with a remote version

#### Manual Verification:

- Owner ran `npx supabase db push` (the dry run listed only the matches migration) and it reported success
- Supabase dashboard shows `watchlist_matches` with RLS on and its three policies; Security Advisor shows no errors
- CLAUDE.md updates reviewed

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- **Natura adapter:** runs over the four recordings through the real gate and asserts the requested URLs. It covers:
  - mapping of SKU, name, size, EANs, price and product URL
  - pseudo-hits dropped
  - the unknown tracker
  - the 4 s limit
  - odd values costing only themselves
- **Matching rule:** size equality with the float tolerance, a shared primary or secondary EAN, exactly one qualifier, two qualifiers, a size mismatch, unknown sizes, no candidates, and the limit.
- **Lookup:** the request count per branch (1, 2 or 0), and unavailable stopping early.
- **Confirm form and services:** every recorded candidate can be confirmed as the page posts it; field and host rules; error codes; decision writes against stubbed clients with time limits.

### Integration Tests:

- **`scripts/check-matches-db.mjs`** runs in the CI `smoke` job, against a fresh local Supabase with production-like grants. It checks:
  - only the owner reads a match
  - no match on another user's product, by the key or by RLS
  - one decision per product and shop
  - decided matches can't change, while `not_found` can
  - no deletes, anon denied, and the new bounds on both tables
- **`scripts/smoke.mjs`:** `/watchlist/<id>` is protected, and a missing or malformed id answers 404. CI makes no shop call.

### Manual Testing Steps:

1. Phase 3's phone-viewport walk-through on the dev server with the local Supabase. It sends a handful of real Natura lookups through the gate.
2. After the merge and before `/10x-archive`: on your phone, against production, add a product, see its Natura match or candidates, confirm one, and reopen the product.

## Performance Considerations

- **Shop traffic:**
  - At most two Natura requests per product lookup (the EAN, then a name search only if the EAN finds nothing), made once per product because decisions are stored. `not_found` is retried only on request.
  - An add costs one Rossmann search plus at most two Natura requests, well inside 30 a minute per shop. Luigi's Box, shared with Hebe, stays under the 60 a minute F-01 accepted.
- **Waiting:** the product page renders after its lookup. Each Natura request has a 4 s limit and each database call 2 s, so the worst case is about 8 s when Natura is slow; the usual case is under a second.
- **CPU:** parsing at most 10 hits is small against the Paid plan's limit.
- **Queries:** the list page makes one extra query, for all the user's matches. The product page makes three: the product, its matches and at most one write.

## Migration Notes

- **Additive:** a new table plus new check constraints on `watchlist_items`, with no data changes. Existing rows passed the same limits in S-01's route. If one doesn't, the push fails and applies nothing; fix the row and push again.
- **Order:** `db push` from the branch first, confirmed by the agent with `migration list --linked`, then the merge. Once pushed, the migration file is frozen.
- **Rollback:** before S-03 depends on it, rolling back means dropping `watchlist_matches` and the new `watchlist_items` constraints.
- **Never:** `supabase config push`, or `migration up --linked`.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-02 `shop-matching-first-two-shops`)
- PRD: US-02, FR-004, FR-006, FR-007 and FR-013; Open Question 2 (`context/foundation/prd.md`)
- Natura's Luigi's Box search: `docs/research/polish-drugstore-price-apis.md` §2.5, §6, §7 and §9
- S-01, the watchlist, its adapter pattern and the carry-overs: `context/archive/2026-09-27-watchlist-add-by-search/plan.md` (Implementation Notes)
- F-01, the gate and its review (redirects, the shared Luigi's Box host): `context/archive/2026-09-26-polite-shop-access/`
- Patterns:
  - `src/lib/services/shops/rossmann.ts`, `src/lib/services/watchlist.ts`, `src/pages/watchlist.astro`, `src/pages/api/watchlist.ts`
  - `scripts/check-watchlist-db.mjs`, `supabase/migrations/20260927145051_watchlist_items.sql`

## Implementation Notes

Where the shipped code differs from the phase contracts above, and why. The phase blocks still show the contract as it was planned.

### Adaptations during implementation

- **Phase 1, the unique key includes the owner:** `unique (watchlist_item_id, user_id, shop_id)` instead of `(watchlist_item_id, shop_id)`. Postgres checks a unique key before a foreign key, so with the planned key another user's insert could collide with the real row. That user, if they held the product's UUID, would get `23505` instead of `23503` and learn that the product has a decision for that shop. For real rows the two keys mean the same, because a product has one owner. Decided by the owner during Phase 1; the database check asserts the probe gets `23503`.
- **Phase 1, null EANs:** both EAN checks use `array_to_string(eans, ',', '*')`. The two-argument form skips null elements, so `{NULL}` would have passed the "8–14 digits" rule.
- **Phase 1, extra database checks** beyond the planned nine: B's own match is visible only to B; B can't change A's `not_found` row; each refused update is read back unchanged; the probe above.
- **Phase 2, what the recordings showed** (2026-09-27):
  - An unknown tracker id gets `404 text/plain` ("Catalog for tracker_id … not found."), not an empty result. The adapter therefore tells a rejected id apart from "nothing found" and logs it; the both-empty branch of the plan isn't needed.
  - `web_url` is a one-element list and `image_link` a single string, both https. Product pages are on `drogerienatura.pl` (no `www`) and images on `media.drogerienatura.pl`, the one image host the adapter accepts.
  - No pseudo-hits appeared; the price filter still drops them, as a test shows. Nivea Soft 300 ml cost 16,99 zł (22,99 zł in the research note).
- **Phase 2, the float example in Key Discoveries is wrong:** `0.3 × 1000` is exactly 300 in JavaScript. The 0.1% tolerance stays for other float noise; the tests use `(0.1 + 0.2) × 1000 = 300.00000000000006`.
- **Phase 2, sizes round-trip:** a candidate's `size` is `parseSize(sizeText)` of its display text ("300 ml", "0,5 l"), so the size Phase 3's form re-parses always equals the one shown. A size text over 40 characters gives no size.
- **Phase 2, the lookup's inputs:** it searches by the first well-formed EAN, not blindly by `eans[0]`, and builds the name query only from the fields that exist.
- **Phase 2, shared names:** `ShopUnavailable` and `CandidateOption` in `src/types.ts`; `isNaturaProductUrl` and `isNaturaImage` in `natura.ts`, for Phase 3's confirm form. `ALLOWED` and its complement come from one character list in `search-query.ts`.
- **Phase 2, logs:** no line carries the search text, an EAN or a product name. A parse error logs only its name, a shape error only its issue paths, and the lookup's "nothing found" line only which searches ran.
- **Phase 3, a Rossmann link, added during the walk-through** (the owner's call, 2026-09-27): the product page showed a link and a price for Natura but nothing for Rossmann.
  - A second migration, `20260927204417_watchlist_items_product_url.sql`, adds `watchlist_items.product_url` (https, ≤ 500). The first S-02 migration was already applied locally, so it stays unchanged.
  - The Rossmann adapter maps the search's `navigateUrl` path to `https://www.rossmann.pl…` (`isRossmannProductUrl`: https on `www.rossmann.pl` only). "Dodaj" posts it, the form checks it, and the product page shows "Zobacz w sklepie" for Rossmann. Products added before have no link.
  - Prices for both shops stay in S-03.
- **Phase 3, links keep the app's origin:** "Zobacz w sklepie" uses `rel="noopener"`, not `noreferrer`, for the same reason S-01 dropped `no-referrer` on images (review F2).
- **Phase 3, how the page handles the edges:**
  - `listMatches` returns null when the read fails. The product page then says so and makes no lookup, since a lookup could re-ask what the user already settled.
  - A decision for a product that isn't the user's (`23503`) is `gone` and lands on the 404 view with its message.
  - A failed product read answers 503 with Polish text.
  - A decision stored meanwhile in another tab shows "Ten produkt ma już zapisaną decyzję."
  - The list's "Dodano do listy." notice is gone, because "Dodaj" now lands on the product page.
- **Phase 4, two migrations reached production:** `20260927184936_watchlist_matches.sql` and `20260927204417_watchlist_items_product_url.sql`, pushed by the owner on 2026-09-27 before the merge. `npx supabase migration list --linked` then showed both with a remote version. Progress 4.2 and 4.3 name only "the matches migration" because step titles don't change; they cover both.
- **Phase 4, CLAUDE.md:** besides the planned notes, the adapter facts got their own "Shops and matching" bullet. It also says that a new Natura tracker id means updating the Natura tests' expected URLs, which pin it. The null-client bullet now names the product page and its route, and the Data bullet says the table checks mirror `PRODUCT_LIMITS`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Match data contract

#### Automated

- [x] 1.1 With Docker running: `npx supabase migration up --local`, then `node scripts/check-matches-db.mjs` with the local URL and anon key prints only PASS lines — 3394d3e
- [x] 1.2 `node scripts/check-watchlist-db.mjs` still prints only PASS lines — 3394d3e
- [x] 1.3 `npm run lint` passes — 3394d3e
- [x] 1.4 CI `smoke` job runs "Check shop matches database contract" and is green on the PR — 3394d3e

#### Manual

- [x] 1.5 Migration review: one policy per operation for `authenticated` only, updates only on `not_found` rows, no delete path, the composite key ties every match to its owner's product, and the new `watchlist_items` bounds equal the form limits — 3394d3e

### Phase 2: Natura lookup and the matching rule

#### Automated

- [x] 2.1 `npm run test` passes, including the Natura adapter, matching rule, lookup and shared outcome tests — 887bd45
- [x] 2.2 `npx astro sync && npx astro check` reports 0 errors — 887bd45
- [x] 2.3 `npm run lint` passes — 887bd45
- [x] 2.4 `npm run build` passes — 887bd45

#### Manual

- [x] 2.5 Fixture review: four real Luigi's Box answers for Natura (EAN hit, EAN miss, name search, unknown tracker) recorded with the gate's User-Agent at least 2 seconds apart, trimmed, with no cookies or personal data — 887bd45

### Phase 3: Product page and confirm flow

#### Automated

- [x] 3.1 `npm run test` passes — eee8536
- [x] 3.2 `npx astro sync && npx astro check` reports 0 errors — eee8536
- [x] 3.3 `npm run lint` passes — eee8536
- [x] 3.4 `npm run build` passes — eee8536
- [x] 3.5 CI `ci` and `smoke` jobs are green on the PR, including the new product-page smoke steps — eee8536

#### Manual

- [x] 3.6 Phone-viewport walk-through against `npm run dev` with the local Supabase: adding Nivea Soft 300 ml lands on its page with Natura matched automatically; a product Natura lists differently shows candidates with the size flag and a labelled price; "To ten produkt" and "Żaden z nich" are remembered on reopening with no new lookup; "Szukaj ponownie" retries a not-found product; the list shows each product's Natura status; a second user sees none of the first user's products or matches — eee8536

### Phase 4: Docs and production rollout

#### Automated

- [ ] 4.1 CI `ci` and `smoke` jobs are green on the PR after the documentation changes
- [x] 4.2 `npx supabase migration list --linked` shows the matches migration with a remote version

#### Manual

- [x] 4.3 Owner ran `npx supabase db push` (the dry run listed only the matches migration) and it reported success
- [x] 4.4 Supabase dashboard shows `watchlist_matches` with RLS on and its three policies; Security Advisor shows no errors
- [x] 4.5 CLAUDE.md updates reviewed
