# Super-Pharm in the Comparison (S-06) Implementation Plan

## Overview

Super-Pharm joins the price comparison as the fourth shop, beside Rossmann, Drogerie Natura and Hebe (roadmap S-06; PRD US-02, FR-006, FR-011, FR-013).

- **Its search is Algolia, not Luigi's Box.** Super-Pharm's index carries no EAN, so a Super-Pharm match is always the user's choice, and its candidates are found by name.
- **It plugs into S-05's per-shop seams:** the adapter registry, the shop lists, the labels and the per-shop page, island and list. It is built switched off and switched on last, so every phase before the switch leaves the app unchanged for users.

The owner's decisions (2026-10-05, all the recommended options):

- **The search key is a constant, and the gate doesn't change.** A rejected key stops Super-Pharm like any 403, and a runbook tells the owner how to copy the new key, deploy and re-enable the shop.
- **An undecided Super-Pharm is looked up only when the user taps its card's button.** A plain product view never searches it.
- **"Do sprawdzenia" keeps its rule:** an undecided Super-Pharm counts.
- **Candidate order:** candidates with the product's size and an agreeing brand come first, for every shop, still 3.
- **A sale without a regular price shows as a plain price** with its 30-day low. No migration.
- **Colour:** lavender `oklch(0.87 0.07 300)` (#DBCAFC).
- **Budget:** at most 3 new recordings in Phase 2 and at most 10 live requests in Phase 4, each sent with the owner's OK at that point.

## Current State Analysis

Code anchors are `main` at `8758136`. The research (`context/changes/super-pharm-in-comparison/research.md`) cites an older revision.

- **Already in place for Super-Pharm:**
  - `SHOP_IDS` includes `super-pharm` (`src/types.ts:2`).
  - The gate lists `www.superpharm.pl` and `ep43qpdx9q-dsn.algolia.net` (`src/lib/services/shop-gate.ts:9-14`).
  - `public.shops` has its row, enabled, with the default cap of 30 (`supabase/migrations/20260926112205_polite_shop_access.sql:9-10`, `:43`).
  - The matches and prices tables take any shop item id that passes the id check; `"10132"` passes every check. No migration is needed.
- **The switch.**
  - `MATCHABLE_SHOPS` names every shop the code can match. Today that is `["natura", "hebe"]` (`src/lib/services/price-comparison.ts:29`), and it keys `SHOP_LABELS` (`:73-77`) and `SHOP_ADAPTERS` (`src/lib/services/shops/registry.ts:35-50`).
  - `MATCHED_SHOPS` (`price-comparison.ts:39`) is the only switch. It feeds `PRICED_SHOPS` (`:45`) and, through it, `SHOP_FILLS`, which the compiler then asks for (`src/components/watchlist/shop-fills.ts:7-11`).
- **Lookups.**
  - `lookupInShop` searches by EAN first and by name only when the EAN search finds nothing; `lookupChoicesInShop` runs both (`src/lib/services/shop-matching.ts:57-85`, `:96-138`). Both compute the EAN at one line each (`:59`, `:102`).
  - The name query is brand, name and size through `toShopQuery` (`:146-148`; `src/lib/services/search-query.ts:39-45`).
  - `pickMatch` accepts only a candidate that shares an EAN (`src/lib/services/matching.ts:74-94`). When none qualifies, it offers the shop's first 3.
- **Steps.**
  - `decideMatchStep` (`src/lib/services/match-step.ts:56-74`) looks an undecided shop up on any own-navigation view. On a page opened to re-pin or retry another shop, it gives the undecided shop a `prompt`.
  - `?retry=<shop>` on an undecided shop already runs that shop's first lookup alone (`src/lib/services/match-step.test.ts:108-112`). The page doesn't forget `?retry=` after rendering, as it does `?repin=` (`src/lib/notices.ts:272-280`), so a reload searches again.
  - The prompt's card says "Produkt nie jest jeszcze dopasowany w X." and offers the button "Dopasuj w X" (`src/components/watchlist/match-card.ts:169-176`). Its link names the shop only when retrying (`src/lib/services/match-view.ts:372-374`).
- **Pinned prices.**
  - `refreshPrices` asks every priced shop at once, each through its fetcher one request at a time (`src/lib/services/price-refresh.ts:35-82`).
  - The batching, the stop after a refusal and the missing-versus-failed rule sit inside the Luigi's Box client (`src/lib/services/shops/luigis-box.ts:137-168`, `:187-237`).
- **Tests.**
  - The test replay matches recordings by URL alone (`src/lib/services/testing/replay-fetch.ts:14-17`). Every POST search goes to the same `/query` URL, so the replay can't tell two Algolia searches apart.
  - About 15 unit tests use Super-Pharm as "a shop that isn't switched on" (§ Phase 4).
- **Prices.**
  - Only `ShopCard` shows a promotion: a crossed-out regular price when `regularPrice` is set, and "promocja do …" when `promoEndsOn` is set (`src/components/watchlist/ShopCard.tsx:96-108`).
  - `storableOffer` keeps a regular price only above the price (`src/lib/services/shops/shop-offer.ts:19-37`), and passes `promoEndsOn` through unchecked.
  - No helper parses Polish price text such as "33,99 zł". The Luigi's Box `amountOf` reads numbers and "17.990000" only (`luigis-box.ts:364-372`).

## Desired End State

- **On a product's page,** Super-Pharm has its own card after Hebe's.
  - Undecided, the card shows "Produkt nie jest jeszcze dopasowany w Super-Pharmie." and the button "Dopasuj w Super-Pharmie", and no request reaches Super-Pharm.
  - Tapping the button searches Super-Pharm alone, by name, and opens its choice of up to 3 candidates. Those with the product's size and an agreeing brand come first, and the choice is never accepted on its own.
  - Once matched, the card shows the item's price and age, its 30-day low, and "Zobacz w sklepie". The regular price and "promocja do …" appear only when Super-Pharm's record carries them.
  - "Zmień", "Dopasuj ponownie", "Szukaj ponownie" and "Żaden z nich" work as for Natura and Hebe.
  - For a product with one known price, the hero's line and the track's hint name Super-Pharm as waiting until the user taps (plan review F5). `undecided()` counts a prompt (`src/components/watchlist/match-card.ts:16-18`; `src/components/watchlist/price-comparison-state.ts:400-405`, `:447`, `:607-610`).
- **On the watchlist,**
  - rows name the cheapest of four shops;
  - the row's screen-reader line names Super-Pharm's state;
  - an undecided Super-Pharm counts in "Do sprawdzenia";
  - the list's refresh includes Super-Pharm's pinned items;
  - the footer names superpharm.pl.
- **Requests:** nothing asks Super-Pharm beyond the costs in the table under Performance Considerations.
  - A changed or unreadable Super-Pharm answer is a visible gap.
  - A rejected key stops the shop, as any 403 does, and the runbook says what to do.
- **Verification:**
  - the unit suite, the e2e suite with a new four-shop phone spec, and CI are green;
  - a local live check within the owner's budget;
  - the owner's phone check on production.

### Key Discoveries:

- `?retry=<shop>` already does most of the tap: on an undecided shop it is that shop's first lookup, and every other undecided shop gets a `prompt` (`src/lib/services/match-step.ts:66-73`). Missing are a rule that keeps an on-request shop at its prompt on a plain view, a link that always names the shop, the address after the lookup, and one text.
- **Skipping the EAN search is one line per lookup.** Both lookups compute `lookupEan(product)` once (`src/lib/services/shop-matching.ts:59`, `:102`), and gating it sends both straight to the name search.
- **The new candidate order changes no existing assertion.** In every Natura and Hebe case the non-qualifying candidates are either all one size and brand or all another size (`src/lib/services/matching.test.ts:165-178`, `:197-209`; `src/lib/services/shop-matching.test.ts:155-171`; `src/lib/services/shops/hebe.test.ts:494-507`). The re-pin choice doesn't use `pickMatch`.
- **The helpers can move without editing Natura's or Hebe's tests.** Both test files import only `natura.ts` and `hebe.ts` exports (`src/lib/services/shops/natura.test.ts:3`, `src/lib/services/shops/hebe.test.ts:4`), and they compare log objects with `toEqual`. So the move must keep every log object, count, URL, the 50 ids per request and the 4 s limit.
- **The replay can match request bodies with no edit elsewhere.** Every recorded request today is a GET without a body (`luigis-box.ts:96-99`, `:174-177`; `rossmann.ts:64-67`, `:101-104`), and the gate forwards `init.body` untouched (`shop-gate.ts:124-130`).
- **Super-Pharm's probed answers (research § Probe results):**
  - "NIVEA Soft 300 ml" found exactly the 300 ml item, its "300 ml" matching the searchable `capacity`.
  - An EAN query finds nothing.
  - `filters=objectID:10132 OR objectID:999999999` returns the known item and leaves out the unknown one.
  - The key is the public search-only key every superpharm.pl page carries. It was unchanged after 18 days and has no `validUntil`, so a plugin upgrade on Super-Pharm's side leaves it valid.
  - Hit fields: `objectID` "10132", `capacity` "300 ml", `url` on `www.superpharm.pl`, `thumbnail_url` on `media.superpharm.eu`, `in_stock` 1, `inStoreOnly` 0.
  - Price fields: `price.PLN.default` 19.49 and `default_historical_min_price_formated` "33,99 zł", but no `default_original_formated` during a sale, and `special_to_date` false.
- **Price-refresh tests break when `MATCHABLE_SHOPS` grows.** `shopOf` in `src/lib/services/price-refresh.test.ts:115-129` throws on an Algolia URL, and the `most` literal at `:162` becomes a type error. Phase 2 fixes both.
- **The e2e helpers enumerate shops.** `FRESH_IDS: Record<MatchedShop, …>` (`tests/e2e/support/watchlist-data.ts:91-92`) and `ShopName` (`tests/e2e/support/pages.ts:12`) need Super-Pharm. `matchShop` always seeds `decided_by: "auto"` (`watchlist-data.ts:142-156`), which Super-Pharm can never produce. `tests/e2e/auth.setup.ts:44-50` already loops over `PRICED_SHOPS`.
- **No contrast check measures a shop token.** `scripts/check-token-contrast.mjs` lists no shop token in its pairs. A new one only needs an `oklch()` value in both `:root` and `.dark`.

## What We're NOT Doing

- **A gate exception for a rejected key, or reading the key from Super-Pharm's page.** The gate stays as it is; that's the owner's call. Probe P10 isn't sent.
- **Automatic Super-Pharm matches**, by name similarity or by EANs from product pages (research §4, options b and c). FR-006 stays as written.
- **A lookup of an undecided Super-Pharm on a plain view,** or once after "Dodaj".
- **Leaving an undecided Super-Pharm out of "Do sprawdzenia".**
- **Marking a Super-Pharm sale that has no regular price as a promotion** (a new stored field and a migration).
- **Club or customer-group prices.** The record carries only the guest price (`priceGroup` null).
- **A migration.** Production's `super-pharm` row already exists.
- **The observability audit's fixes** (`context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md`), including its P1 rule on empty answers. The shared helpers move as they are.
- **dm**, and any proxy for it.
- **Contract tests for Rossmann's and Natura's recordings** (test-plan rollout Phase 3), and any live shop in an automated test.

## Implementation Approach

The work follows S-05's shape.

- **First, groundwork** that changes nothing users see:
  - the shop-neutral parts of the pinned-price path move to one module;
  - the replay learns request bodies;
  - a strict parser reads Polish price text.
- **Second, the Algolia adapter** joins `MATCHABLE_SHOPS` and the registry, but not `MATCHED_SHOPS`, so it is unit-tested end to end while users never see it.
- **Third, the matching rules:**
  - A browser-safe per-shop matching mode, beside `SHOP_LABELS`, marks Super-Pharm `on-request`. That one fact skips the EAN search, keeps an undecided Super-Pharm at its prompt on a plain view, makes the prompt's link name the shop, and picks the unsaved text.
  - `pickMatch` learns the new candidate order.
- **Fourth, `MATCHED_SHOPS` gains Super-Pharm,** with its colour, kitchen-sink states, flipped tests, e2e helpers, a four-shop phone spec and a budgeted live check.
- **Last, the docs and the rollout.**

The tap reuses `?retry=<shop>`, which already runs a single-shop first lookup for an undecided shop. So no new address parameter is needed, and the island, the decision form and the notices stay as they are.

## Critical Implementation Details

- **Keys and text in requests.**
  - The search key goes only in the `X-Algolia-API-Key` header, never in a URL, a log line or a test name.
  - The search text travels in the POST body's `params`, built with `URLSearchParams` from the `toShopQuery` result, so a query can never add a parameter of its own.
  - Every Super-Pharm id is digits only before it goes into a `filters` expression.
- **Request shape.** Each pinned request filters at most 20 `objectID`s: Algolia limits a parameter value to 512 bytes, and `objectID:1234567 OR ` takes 20. Every request sends `analytics=false` and `attributesToHighlight=[]`, and it retrieves only the attributes the adapter maps.
- **Shop order.** Super-Pharm goes last in `MATCHABLE_SHOPS` and `MATCHED_SHOPS`. The e2e row patterns ending in "Hebe: do dopasowania\." aren't anchored, so they keep matching with Super-Pharm's line after Hebe's (`tests/e2e/phone-decline-match.spec.ts:76-79`, `tests/e2e/price-honesty.spec.ts:71-74`).
- **A plain view must never search an on-request shop,** even on the user's own navigation. That is the cost guarantee behind "0 requests per view", and Phase 3's break-check pins it.

## Phase 1: Groundwork, no behaviour change

### Overview

This phase makes the pieces S-06 shares with the existing shops. Nothing a user sees changes, and Natura's, Hebe's and Rossmann's adapter tests pass unedited.

### Changes Required:

#### 1. Shared pinned-price helpers

**File**: `src/lib/services/shops/pinned-prices.ts` (new); `src/lib/services/shops/luigis-box.ts`

**Intent**: The Algolia adapter needs the same pinned-price rules as the Luigi's Box client, so the shop-neutral parts move into one module both use. They must keep exactly their current behaviour (`context/foundation/lessons.md`, "Define shared constants and helpers once"; "Never read an unreadable answer as missing").

**Contract**: The new module owns the parts of the Luigi's Box price path that name no Luigi's Box field:

- deduping the ids, starting every id as `failed`, and checking each id with the shop's `isItemId`, with the "invalid <id>s" log line (`luigis-box.ts:137-151`);
- batching ids per request with the batch size passed in, one request at a time, and no further request after a refusal (`:152-168`);
- reading one answer: counting dropped and not-asked hits with their log lines, the "answer incomplete" line, and the `clear` rule. An id without a hit is `missing` only when the answer is complete, nothing was dropped and every hit was asked for; otherwise it is `failed` (`:187-237`);
- `logOddAvailability` (`:334-340`), which runs between the dropped and not-asked lines (`:212`) and in the search (`:122-127`) (plan review F3);
- `failed()` and the `{event, reason, detail}` log helper (`:342-350`);
- the value helpers `httpsHost`, `within` and `textOf` (`:357-394`), which Super-Pharm's adapter uses too. Rossmann's own copies stay, out of scope (plan review F4).

The client passes in:

- its batch size (50 for Luigi's Box) and its request;
- its completeness reading (`next_page` and `total_hits` for Luigi's Box);
- the item hits, already filtered by its own hit check (`isItemHit`, `:188`), since each count reads "N of the item hits";
- a reader from a hit to its id and offer (Luigi's Box reads the id from `url`, `:195-196`);
- its odd-availability check, if it has one;
- its log names, the event and the id word, such as "natura-prices" and "SKUs".

`readHits` (`:308-328`) and the tracker's 404 line (`:285-295`) stay in the client. Natura's and Hebe's log objects, log counts and the order of their lines stay byte for byte, as do the URLs, the 50 ids per request and the 4 s limits.

#### 2. Request bodies in the test replay

**File**: `src/lib/services/testing/replay-fetch.ts`; `src/lib/services/testing/replay-fetch.test.ts` (new)

**Intent**: Algolia searches are POSTs to one URL, so a recording has to name the request body it answers, and tests have to be able to spell each body out (test-plan §6.4).

**Contract**:

- An entry gains an optional `requestBody: string`. An entry with it matches only a request whose `init.body` is exactly that string; an entry without it matches only a request with no body.
- A request with a body that isn't a string rejects.
- The "replay-fetch: no recorded response for …" rejection keeps its prefix (`src/lib/services/shop-gate.test.ts:358-365`).
- The 8 test files that use the replay pass unedited.

#### 3. Polish price text

**File**: `src/lib/services/shops/price-text.ts` (new), with its test

**Intent**: Super-Pharm writes its 30-day low and its regular price as text ("33,99 zł"), and a misread must never become a price (`context/foundation/lessons.md`, "Never read an unreadable answer as missing").

**Contract**: `parsePolishPrice(value: unknown): number | null` accepts only:

- digits, optionally grouped in threes by a space, a no-break space or a narrow no-break space;
- a comma and exactly two digits;
- a space or a no-break space, then "zł".

Anything else gives null: a dot as the decimal mark, one decimal digit, no "zł", `false`, an empty string, or a non-string.

### Success Criteria:

#### Automated Verification:

- `natura.test.ts` and `hebe.test.ts` pass unedited after the move: `npx vitest run src/lib/services/shops/natura.test.ts src/lib/services/shops/hebe.test.ts`, and `git diff` shows no change to either file
- The replay's new tests pass, and the 8 files that use the replay pass unedited
- The price-text tests pass, covering "33,99 zł", "1 234,56 zł" with each kind of space, and the refusals listed in the contract
- All unit tests, lint and types pass: `npm run test`, `npm run lint`, `npx astro check`
- Break-checks turn named tests red: calling every id without a hit `missing`, and matching replay entries by URL alone

**Implementation Note**: After completing this phase and all automated verification passes, pause for the owner's confirmation before Phase 2. Phase blocks use plain bullets; their checkboxes live in `## Progress`.

---

## Phase 2: Super-Pharm's adapter, switched off

### Overview

The Algolia adapter, its recordings and its tests. Super-Pharm joins `MATCHABLE_SHOPS`, the labels and the registry, but not `MATCHED_SHOPS`, so no page, route or list uses it yet.

### Changes Required:

#### 1. Recordings

**File**: `src/lib/services/shops/fixtures/super-pharm-*.json` (new); `context/changes/super-pharm-in-comparison/probes/` (deleted after the cut)

**Intent**: The adapter's tests need real answers. Today's probes give a one-hit search, an empty search and a one-item pinned batch. The choice and the batch rules need answers with several hits.

**Contract**:

- The fixtures are cut from `probes/` under test-plan §6.4's rules, with every number kept as written:
  - `super-pharm-name-search-one.json` (P3);
  - `super-pharm-search-empty.json` (P5, a real "nothing found");
  - `super-pharm-pinned-one.json` (P6).
- At most 3 new recordings, each with the owner's OK at that point, from this machine, at least 2.5 s apart, with the gate's User-Agent and the probes' headers:
  1. a name search with several hits, such as "Nivea krem" with `hitsPerPage=5`;
  2. a pinned batch of 2–3 known `objectID`s from it, plus one unknown id;
  3. a spare, used only if (1) has no hit with `default_original_formated`: a search that finds one.
- The headers of new recordings stay out of the repository.
- The `probes/` folder, including the homepage's config cut, is deleted in this phase's commit, as its README says.

#### 2. The adapter

**File**: `src/lib/services/shops/super-pharm.ts` (new)

**Intent**: Search Super-Pharm by name and fetch pinned prices by `objectID`, through the gate. Every hit is parsed on its own, and an answer that can't be read is a failure, never "nothing found" or `missing`.

**Contract**:

- **Constants:**
  - the app id `EP43QPDX9Q`;
  - the search-only key, as the research recorded it;
  - the URL `https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query`.

  The key is the public key every superpharm.pl page carries, not a secret, and it travels only in the `X-Algolia-API-Key` header, beside `X-Algolia-Application-Id`, `Content-Type: application/json` and `Accept: application/json`.

- **Search:** `search(gate, query, size)` sends a POST whose body is `{"params": "<URLSearchParams>"}` with:
  - `query`;
  - `hitsPerPage` = size;
  - `analytics=false`;
  - `attributesToRetrieve` naming only the mapped attributes;
  - `attributesToHighlight=[]`.

  Each hit becomes a `ShopCandidate`:

  | Candidate field | From                                |
  | --------------- | ----------------------------------- |
  | `shopItemId`    | `objectID`                          |
  | `name`          | `name`                              |
  | `brand`         | `brand`                             |
  | `sizeText`      | `capacity`, never `farmax_capacity` |
  | `eans`          | always `[]`                         |
  | `productUrl`    | `url`                               |
  | `imageUrl`      | `thumbnail_url`                     |
  | `offer`         | as below                            |

  Odd hits are dropped and counted. An answer whose hits all fail is `unavailable/failed`, and `hits: []` is "nothing found".

- **Offer:**
  - `price` is `price.PLN.default`.
  - `regularPrice` is `parsePolishPrice(price.PLN.default_original_formated)`, only when that field is present.
  - `lowestPrice30d` is `parsePolishPrice(price.PLN.default_historical_min_price_formated)`. `false` is null; unreadable text is null and counted in a log line.
  - `promoEndsOn` is `price.PLN.special_to_date` when it is a positive whole number of seconds, written as its date in Poland (`YYYY-MM-DD`), else null.
  - `available` is true when `in_stock` is 1 and `inStoreOnly` is 0 or missing (plan review F2). A missing `inStoreOnly` is how the Magento extension usually writes an unset attribute.
  - Any other value of `inStoreOnly`, and an odd or missing `in_stock`, reads as not orderable and is counted in a log line, as Hebe's odd online flag is.
  - The multi-hit recording shows whether `inStoreOnly` is on every hit, and the tests pin both cases.
- **Pinned prices:** `fetchPrices(gate, ids)` goes through the shared helpers with a batch size of 20.
  - Each request's body filters `objectID:<id> OR …`, with `hitsPerPage` equal to the batch's length, retrieving only `objectID`, `price`, `in_stock` and `inStoreOnly`.
  - An answer is complete when `nbHits` equals the number of hits returned, and `page` is 0 with `nbPages` at most 1.
- **Checks:**
  - `isItemId`: digits only, 1–12 characters;
  - `isProductUrl`: https on `www.superpharm.pl`;
  - `isImage`: https on `media.superpharm.eu`.
- **Time limit:** each Super-Pharm request has its own 4 s limit, as Luigi's Box requests do. A tap's render waits for its search, and the gate's 8 s stays the ceiling (plan review F8).
- **Logs:** events `super-pharm-search` and `super-pharm-prices`, giving counts and reasons only, never the key, a query, a name or an id.
- **The gate is unchanged:** a 403 stops the shop, and a 400 or another status is a failure.

#### 3. Shop lists, label and registry

**File**: `src/lib/services/price-comparison.ts`; `src/lib/services/shops/registry.ts`; `src/lib/services/price-refresh.test.ts`

**Intent**: Make Super-Pharm a shop the code knows, while it stays switched off.

**Contract**:

- `MATCHABLE_SHOPS` becomes `["natura", "hebe", "super-pharm"]`, and `MATCHED_SHOPS` stays `["natura", "hebe"]`.
- `SHOP_LABELS["super-pharm"]` is `{ name: "Super-Pharm", in: "w Super-Pharmie", of: "Super-Pharmu", title: "Super-Pharm", site: "superpharm.pl" }`.
- `SHOP_ADAPTERS["super-pharm"]` is the new adapter.
- `price-refresh.test.ts`'s `shopOf` learns Algolia's host, and its `most` literal its type, the two places that break as soon as `MATCHABLE_SHOPS` grows.

#### 4. Test plan

**File**: `context/foundation/test-plan.md` §6.4

**Intent**: The adapter cookbook now has a second search provider.

**Contract**: §6.4 gains Algolia's points:

- POST bodies are spelled out in tests and matched by the replay's `requestBody`;
- the key and app id headers are asserted on every request;
- the fixture names;
- `super-pharm.test.ts` is a reference beside `hebe.test.ts`.

#### 5. The adapter's tests

**File**: `src/lib/services/shops/super-pharm.test.ts` (new)

**Intent**: Cover test-plan §6.4's cases for Super-Pharm on real recordings and on broken copies of them.

**Contract**:

- **Mapping:** every candidate and offer field on the recordings; each `capacity` read back by `parseSize` as the same size.
- **Matching:** `pickMatch` on the real candidates always gives a choice, never an acceptance, with their size and brand flags.
- **Pinned batches:**
  - an unknown id is `missing`;
  - a hit nobody asked for leaves the batch `failed`;
  - 21 ids make 2 requests;
  - a refusal stops the rest;
  - an id that isn't digits is never sent.
- **Broken copies:**
  - a field removed;
  - a string where a number belongs;
  - HTML instead of JSON;
  - no `hits` list;
  - `nbHits` above the hits returned;
  - an unreadable 30-day-low text;
  - odd `in_stock` or `inStoreOnly` values;
  - a 400.

  Each gives `unavailable/failed` or drops only its field, with one log line. A 403 stops the shop. A hit without `inStoreOnly` stays orderable, with no log line.

- **Binding:**
  - every `gate.fetch` names `super-pharm`;
  - every URL and request body is spelled out;
  - every request carries the app id and the key;
  - no log line contains the key.

### Success Criteria:

#### Automated Verification:

- `super-pharm.test.ts` passes, covering mapping, matching, pinned batches, broken copies and the binding: `npx vitest run src/lib/services/shops/super-pharm.test.ts`
- `natura.test.ts`, `hebe.test.ts` and `rossmann.test.ts` pass unedited
- All unit tests, lint and types pass: `npm run test`, `npm run lint`, `npx astro check`
- Break-checks turn named tests red: reading the size from `farmax_capacity`, counting an `inStoreOnly` item as orderable, and taking a regular price that the record doesn't carry
- No test reaches a live shop: every request in `super-pharm.test.ts` is served by the replay and spelled out

#### Manual Verification:

- The owner approved each new recording (at most 3), sent under test-plan §6.4's rules, and `probes/` is gone in this phase's commit

**Implementation Note**: After completing this phase and all automated verification passes, pause for the owner's confirmation before Phase 3.

---

## Phase 3: Matching rules

### Overview

A per-shop matching mode makes Super-Pharm an on-request shop: it is searched by name only, and only when the page names it. `pickMatch` learns the new candidate order. Super-Pharm is still switched off, so the tests pass it through the rules' shop lists.

### Changes Required:

#### 1. Matching modes

**File**: `src/lib/services/price-comparison.ts`

**Intent**: One browser-safe fact per shop decides how its products get matched. The server's lookups and steps and the island's card all read it, so it lives beside `SHOP_LABELS` (`context/foundation/lessons.md`, "Define shared constants and helpers once").

**Contract**: `MatchMode = "on-view" | "on-request"` and `MATCH_MODES: Record<MatchableShop, MatchMode>`, with Natura and Hebe `on-view` and Super-Pharm `on-request`. `on-request` means:

- the shop's search can't find an EAN;
- it is searched by name only, and only when the user asks;
- it can never match automatically.

#### 2. Lookups without an EAN search

**File**: `src/lib/services/shop-matching.ts`

**Intent**: Super-Pharm's index has no EAN, so an EAN search there costs a request to learn nothing.

**Contract**:

- For an `on-request` shop, `lookupInShop` and `lookupChoicesInShop` skip the EAN search, so both go straight to the name search.
- The lookup's log line reports `searchedByEan: false`.
- Natura's and Hebe's lookups are unchanged.

#### 3. The step rule and the prompt's link

**File**: `src/lib/services/match-step.ts`; `src/lib/services/match-view.ts`. Both read `MATCH_MODES` themselves; `match-step.ts` already imports `price-comparison.ts` (`:3`), so `runStep` passes nothing new (plan review F4).

**Intent**: An undecided Super-Pharm costs nothing on a view. Tapping its button looks up Super-Pharm alone.

**Contract**:

- `decideMatchStep`, for an `on-request` shop with no decision, returns `prompt`, unless the page's `?retry=<shop>` names that shop on the user's own navigation, which returns its first lookup.
- Stored decisions, re-pins and retries over a stored "not found" are unchanged, and so is every rule for `on-view` shops.
- `promptView` always gives an `on-request` shop a link that names it (`?retry=<shop>`), with the list's filter kept.

#### 4. The address after a tap

**File**: `src/lib/notices.ts`

**Intent**: A reload of a tapped page, or a Back to it, must not search Super-Pharm again. A tap usually opens a choice, which stores nothing, so a server-side redirect after a stored outcome wouldn't cover it (plan review F1).

**Contract**:

- `RETRY_PARAM` joins the parameters the product page forgets once it has rendered (`NOTICE_PARAMS`, `src/lib/notices.ts:272-280`), as `REPIN_PARAM` already does (`:279`). A reload or Back then shows the stored card or the prompt and searches nothing.
- `retried` and the server's redirect after a retry (`[id].astro:112-115`) are unchanged.
- Natura and Hebe change too: a retry's open choice is forgotten the same way. Today a reload of it searches again.
- Without JavaScript the address keeps the parameter, as it does with `?repin=`.

#### 5. The unsaved text

**File**: `src/components/watchlist/match-card.ts`

**Intent**: The unsaved alert says the shop "zostanie sprawdzony ponownie" on the next open (`:104-106`), which is false for a shop looked up only on request.

**Contract**: For an `on-request` shop, the alert points to the card's button instead of promising a lookup. The other shops' text is unchanged.

#### 6. Candidate order

**File**: `src/lib/services/matching.ts`

**Intent**: With no EAN, no Super-Pharm candidate ever qualifies, so the first choice should show the likeliest items first.

**Contract**:

- In `pickMatch`, qualifying candidates still come first. Among the rest, those with the product's size and a brand that doesn't differ come before the others, each group in the shop's order. The limit stays 3.
- The re-pin choice (`lookupChoicesInShop`) keeps its order.
- The kitchen sink's Hebe choice reorders: `…0003` (300 ml, the same brand, another EAN) moves ahead of `…0002` (200 ml, the same EAN) in `src/dev/fixtures.ts` (`HEBE_CHOICE`). That change is expected, not drift (plan review F5).

#### 7. Tests

**File**: `src/lib/services/match-step.test.ts`, `src/lib/services/match-view.test.ts`, `src/lib/services/shop-matching.test.ts`, `src/lib/services/matching.test.ts`, `src/components/watchlist/match-card.test.ts`, and `src/lib/notices.test.ts` for the forgotten parameter

**Intent**: Pin each rule at its boundaries, with Super-Pharm passed in through the rules' shop lists.

**Contract**: New cases:

- **On a plain view,** an undecided on-request shop gets `prompt`, on the user's own navigation too. Named by `?retry=`, it gets a first lookup, and the other undecided shops get `prompt`. Stored decisions and re-pins are unchanged.
- **`?repin=super-pharm` with no decision** gives `prompt`, where Natura's gives a lookup today (`src/lib/services/match-step.test.ts:218-228`) (plan review F7).
- **The prompt's link** names an on-request shop and keeps the filter.
- **An on-request lookup** sends exactly one name search, its URL and body spelled out, and returns a choice, never an acceptance.
- **`RETRY_PARAM` is among the forgotten parameters,** and `withoutNotices` drops it while keeping the list's filter.
- **The unsaved text** of an on-request shop.
- **The order:** same size and agreeing brand first, stable, qualifying candidates still first, limit 3.

### Success Criteria:

#### Automated Verification:

- The new unit tests pass: the step rule, the prompt's link, the lookups without an EAN search, the forgotten retry parameter, the unsaved text and the candidate order
- All unit tests, lint and types pass: `npm run test`, `npm run lint`, `npx astro check`
- The e2e suite passes unedited: `npx playwright test` (Super-Pharm is still switched off)
- Break-checks turn named tests red: looking an on-request shop up on a plain view, and ordering candidates by the shop's order alone

**Implementation Note**: After completing this phase and all automated verification passes, pause for the owner's confirmation before Phase 4.

---

## Phase 4: Super-Pharm switched on

### Overview

`MATCHED_SHOPS` gains Super-Pharm. The phase also adds its colour, four-shop kitchen-sink states, the flipped tests, the e2e helpers with a four-shop phone spec, and a live check within the owner's budget.

### Changes Required:

#### 1. The switch and the colour

**File**: `src/lib/services/price-comparison.ts`; `src/styles/global.css`; `src/components/watchlist/shop-fills.ts`

**Intent**: Switch Super-Pharm on and give it the owner's lavender.

**Contract**:

- `MATCHED_SHOPS = ["natura", "hebe", "super-pharm"]`.
- `--shop-super-pharm: oklch(0.87 0.07 300); /* #DBCAFC */` in `:root` and `.dark`, with `--color-shop-super-pharm` in `@theme inline`.
- `SHOP_FILLS["super-pharm"]` is its fill, which the compiler asks for.

#### 2. Tests whose example shop is switched on now

**File**: the tests that use Super-Pharm as "a shop that isn't switched on":

- `src/lib/services/match-step.test.ts:306`
- `src/lib/services/match-view.test.ts:539`, `:573`
- `src/lib/services/matches.test.ts:317`, `:466`, `:793-866`, `:1148-1160`
- `src/lib/services/price-comparison.test.ts:697`, `:719-726`, `:759-784`
- `src/lib/services/price-refresh.test.ts:412-437`
- `src/lib/services/price-targets.test.ts:165`, `:346-358`
- `src/lib/services/prices.test.ts:352-355`

Plus the tests that assert the default shop list, such as `matches.test.ts:904`, `:921`, `:1128` and `watchlist-rows.test.ts:856-858`, `:1149`.

**Intent**: Keep each test's premise true. A test about a shop that isn't switched on needs another example now.

**Contract**:

- Each such test passes a narrower shop list, as `price-comparison.test.ts:723-726` and `matches.test.ts:471-473` do, or uses `dm`, which isn't in `SHOP_IDS`. Its title states the premise it now uses.
- Tests that assert the default list expect four shops.
- Each changed test is named in the plan's Implementation Notes.

#### 3. Kitchen sinks

**File**: `src/dev/fixtures.ts`, `src/dev/product-page.astro`, `src/dev/watchlist-fixtures.ts`, `src/dev/watchlist.astro`

**Intent**: Show every Super-Pharm state on both pages, in light and dark.

**Contract**:

- **Product page:**
  - Super-Pharm's prompt;
  - its choice found by name, with a different size or brand flagged and no "Ten sam EAN";
  - matched with a plain sale price and its 30-day low;
  - matched with a promotion that carries a regular price and an end date;
  - not found;
  - declined;
  - stopped;
  - four shops with Super-Pharm cheapest;
  - four shops at the same price (the price track's shared label);
  - a product with one known price whose hero line and track hint name Super-Pharm as waiting.
- **List:** a row naming Super-Pharm as cheapest, a row whose screen-reader line says "Super-Pharm: do dopasowania", and the footer naming superpharm.pl.

#### 4. e2e

**File**: `tests/e2e/support/watchlist-data.ts`, `tests/e2e/support/pages.ts`, `tests/e2e/phone-four-shops.spec.ts` (new); existing specs only where they enumerate cards or shops

**Intent**: Prove the four-shop page and list on a phone, with every shop held stopped, as the suite always does (test-plan §6.3).

**Contract**:

- **Helpers:**
  - `FRESH_IDS` gains a Super-Pharm id generator (digits);
  - `matchShop` takes who decided, so Super-Pharm is seeded as the user's choice;
  - `ShopName` gains "Super-Pharm".
- **The spec:**
  - A product with Natura and Hebe matched and Super-Pharm undecided shows Super-Pharm's prompt card, not a stopped notice.
  - Its row's screen-reader line names "Super-Pharm: do dopasowania", and "Do sprawdzenia" counts it.
  - Tapping "Dopasuj w Super-Pharmie" opens `?retry=super-pharm`, shows Super-Pharm's stopped notice, and reserves no shop request (plan review F7):
    - the spec takes `requestLogMark()` before and after the tap and expects it unchanged, since the teardown's check covers only the whole run;
    - the seeded product's name gives a non-null `toShopQuery` (the run's token does), or the tap would store "not found" without asking the gate.
  - A product with a seeded Super-Pharm match and fresh price shows that price on its card, with its age and "Zobacz w sklepie".
- **Existing specs** change only where they list every card or shop, each change named in Implementation Notes. `auth.setup.ts` already proves every priced shop stopped.

#### 5. The live check

**File**: none (a local check)

**Intent**: Prove the Algolia path on workerd, which CI can't reach, within the owner's budget.

**Contract**:

- With the owner's OK, on the local production preview, at most 10 Super-Pharm requests:
  - a tap's name search;
  - the user's pick;
  - the island's first refetch;
  - a list refresh;
  - a re-pin's search.
- The count is proven from the `shop_requests` ids before and after, and it matches the cost table.

### Success Criteria:

#### Automated Verification:

- All unit tests, lint, types and the token contrast check pass: `npm run test`, `npm run lint`, `npx astro check`, `node scripts/check-token-contrast.mjs`
- The build passes, fonts included: `npm run build`
- The e2e suite passes with the new four-shop spec: `npx playwright test`
- Smoke and the database checks pass against the local stack
- Break-checks turn the four-shop spec red: switching Super-Pharm off again in `MATCHED_SHOPS`, and looking it up on a plain view
- CI (`ci`, `smoke`, `e2e`) is green on the phase's commit

#### Manual Verification:

- The kitchen sinks show Super-Pharm's states, in light and dark at 390 px and 1280 px
- The live check stays within 10 Super-Pharm requests, with the count proven from the `shop_requests` ids and matching the cost table

**Implementation Note**: After completing this phase and all automated verification passes, pause for the owner's confirmation before Phase 5.

---

## Phase 5: Docs and rollout

### Overview

This phase brings the project's documents up to date with Super-Pharm, adds a runbook for a rejected key, and covers the rollout.

### Changes Required:

#### 1. The rules file

**File**: `CLAUDE.md`, or the `context/` document that holds "Shops and matching" if the Module 4, Lesson 1 slimming has moved it

**Intent**: Future agents must know how Super-Pharm differs from the other shops.

**Contract**:

- **"Shops and matching":**
  - Super-Pharm on Algolia: POST with a constant key in a header, `objectID` pins in batches of 20.
  - The `on-request` mode: no EAN search, lookups only through the prompt's `?retry=<shop>`, never automatic.
  - Availability from `in_stock` and `inStoreOnly`.
  - A plain price when the record has no regular price.
  - The shared pinned-price helpers.
- **The non-negotiable on shop requests:** "before it goes into a shop URL" becomes "into a shop request".
- **The replay's request bodies.**
- **A pointer to the runbook.**
- **The course block stays byte-identical.**

#### 2. Runbook

**File**: `context/deployment/deploy-plan.md`

**Intent**: A rejected key stops Super-Pharm, which the owner chose over a gate exception, so the owner needs the steps.

**Contract**: A section "Super-Pharm stopped with HTTP 403", opening with how a stop shows (plan review F6):

- Super-Pharm's cards read "… sklep zablokował zapytania …".
- Production's `public.shops` row for `super-pharm` has `enabled = false` and `disabled_reason` 'HTTP 403'.
- Nothing alerts the owner until the observability audit's alert fix lands (`context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md`, §6 step 2).

Then the steps:

1. Open `https://www.superpharm.pl/` and find `algoliaConfig`'s `apiKey` in the page's source.
2. If the key differs from the constant, update the constant and the tests that pin it, merge, and set production's `super-pharm` row back to `enabled = true`.
3. If it's the same, treat the stop as a real block and leave the shop off.

#### 3. Requirements, research and roadmap

**File**: `context/foundation/prd.md`; `docs/research/polish-drugstore-price-apis.md`; `context/foundation/roadmap.md`; `context/foundation/test-plan.md` §6.6

**Intent**: Record what S-06 decided and corrected.

**Contract**:

- **PRD, dated notes:**
  - FR-006: Super-Pharm never matches automatically, and is looked up only when the user taps its button.
  - FR-013: Super-Pharm is added, and dm stays out.
  - FR-011: a Super-Pharm sale without a regular price shows as a plain price with its 30-day low.
- **Research note:**
  - §1's Super-Pharm row;
  - §2.3: POST as the route; the record's fields (`inStoreOnly`, `algoliaLastUpdateAtCET`, images on `media.superpharm.eu`); a promotion without its regular price; the key stable with no `validUntil`, not "rotates with deployments"; pins by `objectID`;
  - §5: robots.txt now disallows `/catalogsearch/`;
  - §6 step 4;
  - §7.
- **Roadmap:** S-06's "Built" note, and its risk line answered.
- **Test plan:** an S-06 note in §6.6.

#### 4. Rollout

**File**: none

**Intent**: Ship it the way S-05 shipped.

**Contract**:

- The PR is opened, and the owner merges it.
- Before the merge, the owner confirms that production's `super-pharm` row is enabled with no disabled reason.
- After the merge, the owner checks it on a phone on production.
- The plan gets a "Production rollout" note at archive time.
- **The way back:** set production's `super-pharm` row to `enabled = false`. The gate then skips every Super-Pharm request at once, without a deploy. The full rollback is a revert PR. Stored Super-Pharm decisions stay, and the reads ignore a shop that isn't switched on.

### Success Criteria:

#### Automated Verification:

- Prettier passes on every changed Markdown file, and `npm run lint` is clean
- CLAUDE.md's course block is byte-identical (sha256 before and after)
- CI (`ci`, `smoke`, `e2e`) is green on the final commit

#### Manual Verification:

- The owner confirms that production's `super-pharm` row is enabled with no disabled reason before the merge
- After the merge, the owner's phone check on production passes: Super-Pharm's prompt, a tap and a pick, its price on the card and on the list

---

## Testing Strategy

### Unit Tests:

- **Shared helpers:** Natura's and Hebe's adapter tests, unedited, guard the move.
- **Replay:** body matching and refusals.
- **Price text:** the accepted forms and every refusal.
- **Super-Pharm's adapter:** test-plan §6.4's cases on real recordings and on broken copies.
- **Matching rules:** the on-request step, the prompt's link, lookups without an EAN search, the forgotten retry parameter, the unsaved text and the candidate order.
- **The switch-on:** every flipped test keeps its premise true with a narrower shop list or `dm`.

### Integration Tests:

- **`phone-four-shops.spec.ts`:** the prompt card of an undecided Super-Pharm, the tap that reserves no request while the shops are stopped, the row's line and "Do sprawdzenia", and a matched Super-Pharm price.
- **The existing suite** stays green, with any edits named.
- **No automated test reaches a live shop:** the e2e run holds every shop stopped, and unit tests use the replay.

### Manual Testing Steps:

1. In the kitchen sinks, check each Super-Pharm state in light and dark, at 390 px and 1280 px.
2. On the local preview, within the owner's budget of 10:
   1. Tap "Dopasuj w Super-Pharmie": one search, and a choice with at most 3 candidates.
   2. Pick one; the card then shows the item.
   3. Reload: the island refetches once.
   4. Refresh the list: one batch.
   5. "Zmień": one search, and up to 6 candidates.
3. Confirm the request count from the `shop_requests` ids against the cost table.
4. After the merge, on a phone on production: the prompt, a tap and a pick, the price on the card and on the list.

## Performance Considerations

What each page view and action costs Super-Pharm (`context/foundation/lessons.md`, "Bound what each page view and action costs every shop"):

| Action                                                               | Super-Pharm                                                | The other shops                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Product view, any navigation, Super-Pharm undecided                  | 0 (its prompt)                                             | unchanged                                                                                      |
| Product view, own navigation, Super-Pharm matched and stale          | ≤ 1 (the island's refetch)                                 | unchanged                                                                                      |
| Tap "Dopasuj w Super-Pharmie" (`?retry=super-pharm`, own navigation) | 1 name search (no EAN search)                              | 0 for an undecided Natura or Hebe (their prompt); stale stored prices refetched as on any view |
| A reload of a tapped page, or a Back to it                           | 0: the page forgot `?retry=` (1 search without JavaScript) | unchanged                                                                                      |
| `?retry=super-pharm` over a stored "not found"                       | 1 name search                                              | as above                                                                                       |
| `?repin=super-pharm`                                                 | 1 name search, up to 6 candidates                          | 0 searches (their prompt or stored card)                                                       |
| The first view after the user's pick                                 | ≤ 1 (the pick stores no price)                             | unchanged                                                                                      |
| The product's "Odśwież ceny"                                         | 1 if matched                                               | unchanged                                                                                      |
| The list's "Odśwież ceny"                                            | ⌈distinct stale Super-Pharm ids ÷ 20⌉, one at a time       | unchanged                                                                                      |
| Another site's link, a prefetch, a decision post                     | 0                                                          | 0                                                                                              |
| A rejected key (403)                                                 | the first 403 stops Super-Pharm (the gate is unchanged)    | unaffected                                                                                     |

- **Render time.** Super-Pharm is never searched during a plain view's render, so a first open still runs at most Natura's and Hebe's lookups, one request at a time each.
- **The cap.** Super-Pharm's cap stays 30 a minute. `scripts/check-shop-gate-db.mjs:52-60`, which reserves Super-Pharm to test the cap, is unchanged.

## Migration Notes

- **No migration.** Production's `super-pharm` row already exists, enabled, with a cap of 30.
- **Stored rows from earlier changes.** Super-Pharm decisions or prices stored while the shop is switched off are ignored by the reads (S-05's per-row rules), and so are any left after a switch-off.
- **Rollback.** Set production's `super-pharm` row to `enabled = false`, or revert the PR. Neither touches stored rows.

## Implementation Notes

### Phase 1

- **The value helpers have a module of their own** (§1's module list).
  - `httpsHost`, `within` and `textOf` live in `src/lib/services/shops/shop-values.ts`, not in `pinned-prices.ts`. They read an answer's values rather than pinned prices, and the name follows `shop-offer.ts` and `shop-outcome.ts`.
  - `valuesOf` moved with them, because `textOf` uses it. `hebe.ts` and `luigis-box.ts` import it from there, while `amountOf` and `eansOf` stay in `luigis-box.ts`.
  - `natura.ts` and `hebe.ts` changed in their imports only.
- **The helpers' interface** (§1's "The client passes in"). The shared entry point is `fetchPinnedPrices(shop: PinnedPriceShop, gate, ids)`.
  - The client's `request(gate, ids)` returns a `PinnedAnswer`: either the item hits, already told apart from anything else in the answer, together with the completeness reading, or the `ShopUnavailable` that every id of the batch gets.
  - So the completeness and the filtered hits come back with each answer rather than as separate inputs. `readHit` maps a hit to its id and offer.
- **The replay** (§2) also rejects a `Request` that carries its own body (a stream), so it can't match an entry without one. Its no-match rejection keeps the "replay-fetch: no recorded response for <href>" prefix and adds " with body <body>" when the request had one.
- **`parsePolishPrice`** (§3) also gives null when the digits don't make a finite number, such as 400 digits.
- **Break-checks:** the plan's two went red:
  - every id without a hit `missing`: 17 Natura and Hebe tests;
  - replay entries matched by URL alone: 7 replay tests.

  A third was added and went red too: a dot accepted as the decimal mark ("reads nothing from a dot as the decimal mark").

- **Heads-up for Phase 2:** write a no-break space in code as the `\u00A0` escape. A literal one fails ESLint's `no-irregular-whitespace`, and a file write once turned the escapes into literal characters.

### Phase 2

- **The recordings** (§1): two of the three allowed, each approved by the owner on 2026-10-05 and sent at 18:51 UTC with the adapter's own bodies. The spare was skipped on the owner's call: no recorded hit carries `default_original_formated`, so a test adds it to a copy of a real hit.
  - The fixtures are the plan's three (P3, P5 and P6), `super-pharm-name-search.json` (the name search, cut to its first 5 of 10 hits) and `super-pharm-pinned.json` (the pinned batch, whole). Each equals its raw answer, every number as written.
  - In the 21-id test, P5's real empty answer answers the second request, as no empty price answer was recorded.
- **The attributes a request retrieves** (§2): the price request's are `price,in_stock,inStoreOnly`, as the approved recording was sent, without `objectID`, which Algolia returns on every hit anyway. The search's list leaves it out the same way.
- **A promotion's end** (§2, the owner's call, 2026-10-05): `special_to_date` counts only beside a regular price the offer keeps.
  - That is how the search extension's own frontend reads it (`view/frontend/web/internals/common.js:151-159` in version 3.9.1, the one Super-Pharm's page declares).
  - Magento keeps a sale's dates on the record after the sale (P3's hit still has a `special_from_date` from 2016), and a past end would make the current price stale on every check, so it could never be named cheapest.
  - No recorded hit has a date, so the tests pin the rule on copies.
- **`polishDate`** is now exported from `price-comparison.ts`, so the adapter writes a promotion's end on the calendar the comparison reads it with.
- **The 30-day low** (§2): `false`, a missing field and `null` mean none, with no log line. Any other value that doesn't read as a price is counted as "30-day low unread". On the price path the adapter's request function writes that line, since the shared helpers have no hook for a second odd field, so it comes before theirs.
- **`inStoreOnly` 1** (§2) is a clear "sold only in the shops": not orderable and not counted, like `in_stock` 0 and Hebe's `[false]`. Only a value other than 0, 1 or missing is counted, which is what "as Hebe's odd online flag is" meant.
- **`price-refresh.test.ts`** (§3): besides `shopOf` and the `most` literal, the one assertion on the whole `most` record gained `"super-pharm": 0`, which also shows the switched-off shop is asked nothing.
- **Test plan §6.4** (§4): "Another search provider" and "Asserting POST bodies" are new, and the cases, the broken copies and "Done means" gained Algolia's points.
- **Break-checks:** the plan's three went red:
  - the size from `farmax_capacity`: 1 test;
  - an `inStoreOnly` item orderable: 2 tests;
  - the 30-day low as the regular price: 42 tests.

  A fourth, for the owner's rule, went red too: a promotion's end without a regular price beside it, 6 tests.

- **Heads-up for Phase 3:** a file write turned the no-break space's escape into the literal character again, inside a string in `super-pharm.test.ts`, where ESLint doesn't look; a script that scans the touched files is the check. In Git Bash, `node -e` drops one backslash of each doubled one, so byte-level edits go through a script file.

## References

- Research, with probe results: `context/changes/super-pharm-in-comparison/research.md`
- Roadmap S-06: `context/foundation/roadmap.md:173-191`
- Requirements: `context/foundation/prd.md` (US-02, FR-006, FR-011, FR-013)
- Lessons: `context/foundation/lessons.md`
- Test plan: `context/foundation/test-plan.md` (§6.3 e2e cookbook, §6.4 adapter tests)
- The shop before it: `context/archive/2026-10-02-hebe-in-comparison/plan.md` and `plan-brief.md`
- Code: `src/lib/services/shops/registry.ts:19-50`, `src/lib/services/shop-matching.ts:57-148`, `src/lib/services/match-step.ts:56-74`, `src/lib/services/match-view.ts:372-374`, `src/components/watchlist/match-card.ts:104-106`, `:169-176`, `src/lib/services/matching.ts:74-94`, `src/lib/services/shops/luigis-box.ts:137-237`, `src/lib/services/testing/replay-fetch.ts:4-26`, `src/lib/services/shops/shop-offer.ts:19-37`, `src/components/watchlist/ShopCard.tsx:96-108`
- The observability audit, whose fixes are out of scope: `context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Groundwork, no behaviour change

#### Automated

- [x] 1.1 `natura.test.ts` and `hebe.test.ts` pass unedited after the move — ed12ad7
- [x] 1.2 The replay's new tests pass, and the 8 files that use the replay pass unedited — ed12ad7
- [x] 1.3 The price-text tests pass, covering the accepted forms and the refusals — ed12ad7
- [x] 1.4 All unit tests, lint and types pass — ed12ad7
- [x] 1.5 Break-checks turn named tests red: every id without a hit `missing`, and replay entries matched by URL alone — ed12ad7

### Phase 2: Super-Pharm's adapter, switched off

#### Automated

- [x] 2.1 `super-pharm.test.ts` passes, covering mapping, matching, pinned batches, broken copies and the binding
- [x] 2.2 `natura.test.ts`, `hebe.test.ts` and `rossmann.test.ts` pass unedited
- [x] 2.3 All unit tests, lint and types pass
- [x] 2.4 Break-checks turn named tests red: the size from `farmax_capacity`, an `inStoreOnly` item orderable, a regular price the record doesn't carry
- [x] 2.5 No test reaches a live shop: every Super-Pharm request is served by the replay and spelled out

#### Manual

- [x] 2.6 The owner approved each new recording (at most 3), sent under test-plan §6.4's rules, and `probes/` is gone in this phase's commit

### Phase 3: Matching rules

#### Automated

- [ ] 3.1 The new unit tests pass: step rule, prompt link, lookups without an EAN search, forgotten retry parameter, unsaved text, candidate order
- [ ] 3.2 All unit tests, lint and types pass
- [ ] 3.3 The e2e suite passes unedited
- [ ] 3.4 Break-checks turn named tests red: an on-request shop looked up on a plain view, and candidates in the shop's order alone

### Phase 4: Super-Pharm switched on

#### Automated

- [ ] 4.1 All unit tests, lint, types and the token contrast check pass
- [ ] 4.2 The build passes, fonts included
- [ ] 4.3 The e2e suite passes with the new four-shop spec
- [ ] 4.4 Smoke and the database checks pass against the local stack
- [ ] 4.5 Break-checks turn the four-shop spec red: Super-Pharm switched off again, and looked up on a plain view
- [ ] 4.6 CI (`ci`, `smoke`, `e2e`) is green on the phase's commit

#### Manual

- [ ] 4.7 The kitchen sinks show Super-Pharm's states, in light and dark at 390 px and 1280 px
- [ ] 4.8 The live check stays within 10 Super-Pharm requests, with the count proven and matching the cost table

### Phase 5: Docs and rollout

#### Automated

- [ ] 5.1 Prettier passes on every changed Markdown file, and `npm run lint` is clean
- [ ] 5.2 CLAUDE.md's course block is byte-identical (sha256 before and after)
- [ ] 5.3 CI (`ci`, `smoke`, `e2e`) is green on the final commit

#### Manual

- [ ] 5.4 The owner confirms production's `super-pharm` row is enabled with no disabled reason before the merge
- [ ] 5.5 After the merge, the owner's phone check on production passes
