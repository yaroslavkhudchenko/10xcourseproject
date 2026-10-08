# Add products from other shops Implementation Plan

## Overview

The list's search asks Rossmann, Natura, Hebe and Super-Pharm, and shows one entry per product, naming the shops that have it, with a line saying what each shop's search came to. "Dodaj" can add a product Rossmann doesn't sell. Such a product is compared like any other: its own shop prices it, and the other three shops, Rossmann included, are matched to it.

The owner's calls of 2026-10-06 (`change.md`) settle the product questions. The plan's interview of 2026-10-08 settled the three that remained:

- **The name rule for a product without a caption:** every word of its name is required.
- **Rossmann as a matched shop:** it follows the same rule as the other shops.
- **Live evidence:** three Rossmann lookups are recorded during implementation.

## Current State Analysis

The research (`research.md`, 2026-10-06) was re-checked on 2026-10-08 against `main` at 77d294c, after `match-by-name`, S-04 and test rollouts 2 and 3 merged.

- **One shop is searched.**
  - The list page awaits `searchRossmann` beside its three database reads in one `Promise.all` (`src/pages/watchlist.astro:43-48`), behind `searchStepOf`'s own-navigation guard (`src/lib/services/search-query.ts:44-53`).
  - PR #31's texts name Rossmann:
    - the heading „Wyniki z Rossmanna”, the empty result and its hint, and the footer (`src/components/watchlist/SearchResults.astro:34-37,51,68,102`);
    - the field's placeholder and label (`src/components/shell/SearchForm.astro:32-33`);
    - the unavailable alert (`watchlist.astro:50-51`).
- **"Dodaj" takes Rossmann only.**
  - `watchlistAddSchema` holds `source: z.literal("rossmann")`, a 1–12 digit id and Rossmann's URL checks (`src/lib/services/watchlist.ts:44-54`).
  - The add route and the database take any shop:
    - `watchlist_items.source` references `public.shops`;
    - the watcher policies match any shop;
    - `price_summaries` is shop-agnostic.

  No migration is needed.

- **Each shop has a fixed role.**
  - `MATCHABLE_SHOPS` and `MATCHED_SHOPS` leave Rossmann out, and `PRICED_SHOPS` is Rossmann plus `MATCHED_SHOPS` (`src/lib/services/price-comparison.ts:36,46,52,58`). About twelve rules default to `MATCHED_SHOPS`.
  - The product's own item is priced, refetched and linked only for Rossmann:
    - `productPriceKeys` (`price-comparison.ts:592`);
    - `itemInRows` (`src/lib/services/price-targets.ts:82-91`);
    - `productPricesOf`'s link (`src/lib/services/prices.ts:323`).
- **Rossmann has no adapter entry.**
  - Its search takes no size (24 fixed) and returns `ProductCandidate`s without an offer: `itemSchema` reads no price, though Rossmann's search items carry the detail's price fields (`src/lib/services/shops/rossmann.ts:18,28-42,68-111`).
  - Its price fetcher is private to `src/lib/services/price-refresh.ts:110-140`.
  - `isRossmannProductId` is exported (`rossmann.ts:186`).
- **The adapters answer honestly** since rollout Phase 3. Each says "nothing found" only when its own count says 0, and is `unavailable/failed` when every item fails its check. So each shop's line can tell "brak wyników" from "nie odpowiada".
- **The name check leans on Rossmann's caption.**
  - The words that tell a product apart are its caption's marked words: a capital letter or a digit (`markedWordsOf`, `src/lib/services/matching.ts`).
  - A product without a caption keeps only "a word of its name, nothing extra, two shared". On the recordings, 4 of 10 name acceptances for products added from Natura, Hebe or Super-Pharm were wrong, all silent. Two examples:
    - a refill matched to the bottle;
    - SPF15 matched to the plain cream.
- **Lookup queries repeat words.** `nameQuery` (`src/lib/services/shop-matching.ts:164-166`) joins brand, name and size text. Natura's, Hebe's and Super-Pharm's names already carry the brand (36 of 37 recorded items) and often the size (27). `toShopQuery`'s 80-character cut (`search-query.ts:60-66`) can drop the size.
- **Hebe reads a set's size from one item:** item 764646, "zestaw … 33 ml" (`src/lib/services/shops/hebe.ts` `readSize`). Super-Pharm's adapter has a set rule (`super-pharm.ts:61,498-503`).

## Desired End State

**The search:**

- A search on the user's own navigation asks the four shops at once, 10 hits each: 4 requests.
- It shows one entry per product. Items join when they share an EAN, the size and a brand that doesn't differ; Super-Pharm's items join by the name rule.
- Each entry names the shops that have it.
- A line above the entries says what each shop's search came to: its count, „brak wyników” or „nie odpowiada”.
- An entry shows „Na liście” when any of its items is already on the list, as a product or as one of a product's matches. Otherwise it shows "Dodaj", which adds its item from the first shop in the order Rossmann, Natura, Hebe, Super-Pharm.

**A product added from Natura, Hebe or Super-Pharm:**

- Its page shows its own shop's price, with its age and its own link, and refetches it.
- Rossmann and the other two shops are looked up on the user's own navigation and matched by the same rule as for any product: a shared EAN first, then the name check.
- For a product without a caption, the name check needs every word of its name.
- The list shows its row, its tag and „Do sprawdzenia” as for any product.

**Verification:**

- unit tests at every rule's boundaries, on the 8 search recordings and on 3 new Rossmann lookup recordings;
- an e2e spec for a product from another shop;
- the database checks;
- the owner's phone check in production.

### Key Discoveries:

- The three own-item rules must change together: `productPriceKeys`, `itemInRows` and `productPricesOf`'s link. With only one changed, the island's refetch answers `changed` (409) for the product's own item or for a Rossmann match (`price-targets.ts:77-101`).
- `fetchRossmannPrices` has to move into `rossmann.ts`, because the registry can't import `price-refresh.ts`, which imports the registry.
- `pickMatch` judges one product against one shop's list, and the name rule compares candidates with each other (`matching.ts:126-140,261-272`). So the search's grouping:
  - calls `pickMatch(entry's product, one shop's items)`, entry by entry;
  - tells an EAN join apart with `sharesAnEan`;
  - can't see a Super-Pharm item accepted by two entries, so that rule sits outside it.
- On the 8 recordings, the evaluation of 2026-10-08 (scratchpad `afos-eval`) found:
  - **no wrong join;**
  - **„nivea soft”:** Nivea Soft 300 ml joins Rossmann 26900, Natura NV89063 and Super-Pharm 10132;
  - **AA LAAB:** the face wash 150 ml joins Rossmann 419343, Hebe 450251 and Super-Pharm 105870, and four Natura items join their Hebe twins.
- **Rossmann's candidates without a caption** make the name rule unsafe. Every 7,2 ml Sky High shade shares one Rossmann name. With the caption joined to the name, the Maybelline cases accept the right shade and no wrong one.
- **`listMatchStates` reads the whole list in one query** (`src/lib/services/matches.ts:523-560`). It must read every priced shop, with each row narrowed to its product's matched shops.

## What We're NOT Doing

- **No caching of search answers.** A search costs 4 shop requests, and a reload repeats it. Each is the user's own navigation, the same footing as today's 1.
- **No prices in the search's entries,** as today. The product page compares prices.
- **No progressive search island.** The page waits for the four shops on the server (call 8). One shop holds it up for at most about its own time limit (4–5 s).
- **No claim that a shop lacks a product** (call 2). "Not found in this search" is all a search can say.
- **No matches saved from the search** (call 4). "Dodaj" saves the product, and its page looks the other shops up as today.
- **No merging of the same product added from two shops** (call 7). „Na liście” covers each entry's items and matches; anything else can be added.
- **No EAN search at Rossmann or Super-Pharm,** whose indexes can't find one (`searchesByEan` false).
- **No `f[]=type:item` beside `q` on Luigi's Box searches.** It's untested, and Hebe's query suggestions may still use up some of its 10 hits.
- **No migration, and no invariant against a decision in a product's own shop.** Reads per product ignore such a row, and no page offers it.
- **No change to how a Rossmann product is matched:** Natura, Hebe and Super-Pharm, as today.
- **No roadmap slice.** Like `match-by-name`, this change sits outside the roadmap's slices.
- **No live shop request** beyond the three approved Rossmann lookups.

## Implementation Approach

Five phases, each shippable on its own and behind the next.

- **Phase 1 gives Rossmann what a matched shop needs.** Rossmann products are matched in the same three shops, so nothing changes for users.
- **Phase 2 turns each shop's fixed role into a per-product one.** That's the widest change, so it comes before any user can reach it. An e2e spec reaches it through seeded data.
- **Phase 3 fixes the name rule and the lookup queries** for products without a caption, on real recordings. The four-shop search in Phase 4 then groups with the corrected rule.
- **Phase 5 updates the documents** and closes with the owner's phone check.

Expected values come from the owner's calls, the PRD and the recordings, never from the code under test. Every shop answer in a test is a recording served through the real gate (`createReplayFetch`), with the URLs and POST bodies served asserted.

## Critical Implementation Details

- **A product's own shop is its `source`, and its matched shops are the priced shops without it,** in the fixed order Rossmann, Natura, Hebe, Super-Pharm. Every per-product rule takes that set:
  - the price keys, the targets and the refresh's targets;
  - the match steps, the repin and retry parameters, and the decision notices;
  - the list row's states.

  A decision stored in the product's own shop is ignored, never read as one of its matches. A URL naming that shop is ignored, like a shop outside the list.

- **The grouping's conflict rule.** A Super-Pharm item that the name rule accepts for two entries joins neither, and becomes its own entry. Entries come in the order of their first item: shops in the fixed order, and each shop's items in its own ranking.
- **The recording step (Phase 3) runs by hand, in the main session,** after the lookup-query rule lands, so each recording answers the exact query the app sends. It's three requests to Rossmann:
  - one at a time, 3 s apart;
  - from the developer machine;
  - with the gate's User-Agent and `Accept: application/json`;
  - following no redirect.

  The owner approved it on 2026-10-08.

## Phase 1: Rossmann as a shop like the others

### Overview

Rossmann gets what any matched shop has: a search that takes a size and returns candidates with offers, an adapter entry, and its price fetcher beside its other code. Rossmann joins the matchable shops, first in order. Rossmann products are still matched in Natura, Hebe and Super-Pharm, so nothing changes for users.

### Changes Required:

#### 1. Rossmann's searches and fetcher

**File**: `src/lib/services/shops/rossmann.ts`, `src/lib/services/price-refresh.ts`

**Intent**: Read the price fields Rossmann's search items already carry, so an automatic Rossmann match brings its first price. Offer Rossmann's items to lookups in the shape every matched shop uses.

**Contract**:

- **The parse.** One answer parser serves both searches. The item schema gains the detail's price fields (`price`, `oldPrice`, `lastLowestPrice`, `promotionTo`, `availability`), read by the same rules as the detail's offer (`toOffer`, `dateOf`, the "availability unread" line), defined once.
- **`searchRossmann(gate, query, size)`** returns `ProductSearch`, as today, with `pageSize=size`. The list passes 24 until Phase 4.
- **A new `searchRossmannItems(gate, query, size)`** returns `ShopSearch`. Each `ShopCandidate` has:
  - `shop: "rossmann"`;
  - `shopItemId`, the product id;
  - `name`, the name and the caption joined as a list row joins them (`rowProductOf`), within `PRODUCT_LIMITS.name`;
  - its brand, size and EANs (up to 10), product URL and image;
  - `offer`, from the item's price fields, or null when its price can't be stored.

  The empty-answer and dropped-item rules are the same as the list's search.

- **`fetchRossmannPrices`** moves from `price-refresh.ts` into `rossmann.ts`, exported and unchanged. `price-refresh.ts` imports it.

#### 2. The adapter entry and the shop lists

**File**: `src/lib/services/shops/registry.ts`, `src/lib/services/price-comparison.ts`, `src/lib/services/price-refresh.ts`

**Intent**: Make Rossmann a matchable shop, first in the fixed order, while the switched-on matched shops stay as today.

**Contract**:

- **`SHOP_ADAPTERS.rossmann`:**
  - `search` is `searchRossmannItems`;
  - `fetchPrices` is `fetchRossmannPrices`;
  - `isItemId` is `isRossmannProductId`;
  - `isProductUrl` and `isImage` are Rossmann's checks;
  - `searchesByEan` is false, since Rossmann's search can't find an EAN.
- **`MATCHABLE_SHOPS`** is `["rossmann", "natura", "hebe", "super-pharm"]`, and `KnownShop` becomes `MatchableShop`.
- **`PRICED_SHOPS`** lists the four shops, written out.
- **`MATCHED_SHOPS`** is unchanged in this phase.
- **`PRICE_FETCHERS`** comes from the registry for all four shops.

#### 3. Tests

**File**: `src/lib/services/shops/rossmann.test.ts`, `src/lib/services/price-refresh.test.ts`, `src/lib/services/price-comparison.test.ts`

**Intent**: Pin the new reads on the recordings, through the real gate.

**Contract**:

- **Searches on the recorded answers** (`rossmann-search-nivea-soft.json`, `rossmann-search-aa-laab.json`):
  - each item's offer: price, regular price, 30-day low, promotion end and availability, as the detail's tests read them;
  - `searchRossmannItems`' joined name, EANs and size;
  - the requested `pageSize`.
- **Broken copies:**
  - an item whose price is text or missing keeps its candidate with a null offer;
  - an availability that isn't text is counted.
- **Moves:**
  - the registry entry's fields;
  - `PRICE_FETCHERS.rossmann` is the moved fetcher, and the refresh's tests pass unchanged.

### Success Criteria:

#### Automated Verification:

- Rossmann's, the refresh's and the comparison's tests pass: `npx vitest run src/lib/services/shops/rossmann.test.ts src/lib/services/price-refresh.test.ts src/lib/services/price-comparison.test.ts`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

---

## Phase 2: Each product's own shop

### Overview

A product's own shop is its `source`, and its matched shops are every priced shop but that one. A product added from Natura, Hebe or Super-Pharm gets its own price, link and refetch, and is matched in the other three, Rossmann included. "Dodaj" accepts any priced shop's item. Until Phase 4's search, only the database and the e2e seeds can create such a product.

### Changes Required:

#### 1. The shop roles

**File**: `src/lib/services/price-comparison.ts`

**Intent**: One browser-safe rule for a product's matched shops, which every per-product rule takes in place of a fixed set.

**Contract**:

- **`matchedShopsOf(source)`** returns the priced shops in the fixed order without `source`.
- **`MATCHED_SHOPS` is replaced:**
  - every list-wide read and schema takes every priced shop;
  - every per-product rule takes the product's set.
- **`MatchedShop` widens to `PricedShop`** wherever it names a shop a decision or a card can be in.
- **`productPriceKeys`:**
  - the product's own item comes first, for any priced source;
  - then its matches, in its matched shops only;
  - a decision in its own shop is ignored.
- **`listPricedItems`** takes each product's own set.
- **`parseMatchedShop`** parses any priced shop; callers narrow it per product.

#### 2. Prices, targets and the product page

**File**: `src/lib/services/price-targets.ts`, `src/lib/services/prices.ts`, `src/lib/services/shop-matching.ts`, `src/lib/services/match-step.ts`, `src/lib/services/match-view.ts`, `src/pages/watchlist/[id].astro`

**Intent**: The product's own item is priced, refetched and linked from any shop, and its matched shops are looked up, re-pinned and refreshed per product.

**Contract**:

- **`itemInRows`:**
  - returns the own item when the shop is the product's `source`;
  - returns the match when the shop is one of its matched shops.
- **`listTargets` and `productTargets`** read every priced shop's decisions, then narrow them to each product's matched shops. An odd row in the product's own shop doesn't count as unread.
- **`productPricesOf`** links the own shop's card to `product.productUrl`, whatever the shop, and takes the product's matched shops.
- **`runMatchSteps`** takes the product's matched shops; the page passes `matchedShopsOf(product.source)`.
- **The URL and notice parameters** (`repinShopOf`, `retryShopOf`, `decisionNotice`, `decisionError`) parse any priced shop. The page ignores the product's own shop.
- **The page's comments** stop saying the own shop is Rossmann.

#### 3. Decisions and the list

**File**: `src/lib/services/matches.ts`, `src/lib/services/watchlist-rows.ts`, the list's and the island's components (`ListRows.astro`, `match-card.ts`, `MatchCard.tsx`, `MatchChoice.astro`, `PriceComparison.tsx`, `price-comparison-state.ts`)

**Intent**: Decisions are read for every priced shop and judged per product. The list's rows and the island take each product's own set.

**Contract**:

- **`parseMatchForm`** defaults to every priced shop; its id, link and image checks already go through `SHOP_ADAPTERS`.
- **`listMatches` and `listMatchStates`** read every priced shop. The four read rules apply per product, so a product's own-shop row is left out like a shop outside its set.
- **`ListMatchStates`** is partial over the priced shops.
- **`matchStatesOf` and `listRowsOf`** take each item's `source`.
- **`matchesFailedText`** names the shops whose decisions couldn't be read.
- **The island's and cards' shop types** widen to `PricedShop`. Their texts already read right for Rossmann, for example „Dopasuj w Rossmannie”.

#### 4. "Dodaj" from any shop

**File**: `src/lib/services/watchlist.ts`

**Intent**: The add form accepts a priced shop's item, checked by that shop's own rules.

**Contract**:

- **`source`** is any priced shop.
- **The id, product URL and image** pass `SHOP_ADAPTERS[source]`'s `isItemId`, `isProductUrl` and `isImage`, as `parseMatchForm` checks a decision's item.
- **The caption** stays optional for every shop.
- **The add route** is unchanged.

#### 5. Tests, seeds and checks

**File**:

- `src/lib/services/*.test.ts`: the comparison, targets, watchlist, matches, rows, price pages and price routes;
- `tests/e2e/support/watchlist-data.ts`, and a new `tests/e2e/product-from-another-shop.spec.ts`;
- `src/dev/fixtures.ts`, `src/dev/watchlist-fixtures.ts`;
- `scripts/check-watchlist-db.mjs`, `scripts/check-prices-db.mjs`.

**Intent**: Pin the per-product roles at their boundaries, and show them in a real browser and in the database.

**Contract**:

- **The unit pins of today's Rossmann-only reads change to the new truth:**
  - `price-comparison.test.ts:905-909`;
  - `price-targets.test.ts:305-311`;
  - `watchlist.test.ts:117-118`, now a Hebe item accepted and an item failing Hebe's checks refused;
  - `matches.test.ts:297,468-471`, now a Rossmann decision for a product from Natura accepted.
- **New cases:**
  - the own key for each source;
  - a decision in the own shop ignored, and a URL naming it ignored;
  - the island's refetch of the own item and of a Rossmann match;
  - a product from Super-Pharm with every shop undecided, which costs one lookup per matched shop.
- **The seam tables** gain a product from Natura (`price-pages.test.ts`, `price-routes.test.ts`).
- **e2e:**
  - `addProduct({ source })` seeds a product with a fresh id in its shop's shape, and `matchShop` accepts Rossmann.
  - A spec seeds a product from Natura with a priced Rossmann match. Its page shows Natura's own card with „Zobacz w sklepie” to Natura's page, Rossmann's match card and the cheapest marked. Its list row shows its tag, and no shop is asked (`recordPriceCalls`).
- **The kitchen sinks** draw a product from another shop, with Rossmann's card in every state and Rossmann's choice.
- **The database checks:**
  - a product from Natura is inserted and read by its owner only;
  - its own item's prices and a Rossmann match's item's prices are read and added by its watcher only.

### Success Criteria:

#### Automated Verification:

- The services' tests pass: `npx vitest run src/lib/services/price-comparison.test.ts src/lib/services/price-targets.test.ts src/lib/services/watchlist.test.ts src/lib/services/matches.test.ts src/lib/services/watchlist-rows.test.ts src/lib/services/price-pages.test.ts src/lib/services/price-routes.test.ts`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`
- The database checks and the new spec pass in CI's `smoke` and `e2e` jobs on the PR

---

## Phase 3: Matching a product without a caption

### Overview

The name check requires every word of a captionless product's name. The lookup queries stop repeating brand and size, and keep the size when cut. Hebe's sets get no size. Three approved Rossmann lookups are recorded, so the new lookups are tested on Rossmann's real answers.

### Changes Required:

#### 1. The name rule

**File**: `src/lib/services/matching.ts`

**Intent**: A product without a caption has no marked words, so its name's words take their place (the owner's call of 2026-10-08). This prevents a plainer sibling being accepted silently, such as a bottle for a refill, or a plain cream for an SPF15 one.

**Contract**:

- For a product whose caption is missing or blank, every word of its name is a word that tells it apart, as `wordsOf` reads words: the lists' set-aside words, both brands' words and sizes left out.
- A candidate lacks one for each such word it doesn't have.
- A product with a caption keeps today's rule.
- The module's header says so.

#### 2. The lookup queries

**File**: `src/lib/services/shop-matching.ts`, `src/lib/services/search-query.ts`

**Intent**: A lookup sends each word once and never loses the product's size to the 80-character cut.

**Contract**:

- `nameQuery` puts the brand first, only when the name doesn't already start with it.
- It puts the size text last, only when the name doesn't already end with it. Words are compared folded, as the name check folds them.
- When the query is longer than 80 characters, the name is cut at a word, and the brand and size stay.
- A Rossmann product's query is unchanged, since its name holds neither.

#### 3. Hebe's sets

**File**: `src/lib/services/shops/hebe.ts`, `src/lib/services/shops/super-pharm.ts`, `src/lib/services/size.ts`

**Intent**: A set's name ends with one item's size, never the set's, so it gives no size, as Super-Pharm's rule says.

**Contract**:

- The set rule (`SET_NAME`: "zestaw" in any case, or items joined with "+") moves to `size.ts`, defined once.
- Hebe's `readSize` and Super-Pharm's both use it.

#### 4. The recordings

**File**: `src/lib/services/shops/fixtures/rossmann-lookup-<product>.json` (3 files)

**Intent**: Real answers for the new path: Rossmann looked up for a product added from another shop.

**Contract**:

- Three Rossmann name searches, each with the exact query the new `nameQuery` builds, 10 hits:
  - for Natura's Nivea Soft 300 ml (NV89063);
  - for Hebe's AA LAAB face wash 150 ml (450251);
  - for a Super-Pharm Maybelline Lash Sensational Sky High shade.
- Recorded in the main session after the query rule lands, as Critical Implementation Details says, and kept whole.
- The test's header names each one's query and time.

#### 5. Tests

**File**: `src/lib/services/matching.test.ts`, `src/lib/services/shop-matching.test.ts`, `src/lib/services/shops/hebe.test.ts`, `src/lib/services/shops/super-pharm.test.ts`, `src/lib/services/search-query.test.ts`

**Intent**: Pin the rule at its boundaries, and the lookups on the recordings.

**Contract**:

- **The rule:** for a product without a caption:
  - the refill and SPF15 cases from the recordings are left to the user;
  - a candidate with every word of the name is accepted;
  - a product with a caption keeps today's outcomes, and every existing `matching.test.ts` case passes.
- **The queries:** `nameQuery` for items from each shop, the repeated brand, the repeated size, and a cut that keeps the size.
- **The lookups,** through the real gate, with requests counted:
  - Rossmann for the three recorded products: accepted by a shared EAN, accepted by name, or offered with the right item first, as each recording shows;
  - Natura, Hebe and Super-Pharm for a product added from another shop, on the recordings that exist.
- **Hebe's set** gives no size. Super-Pharm's set tests pass unchanged.

### Success Criteria:

#### Automated Verification:

- The rule's, the lookups' and the adapters' tests pass: `npx vitest run src/lib/services/matching.test.ts src/lib/services/shop-matching.test.ts src/lib/services/shops/hebe.test.ts src/lib/services/shops/super-pharm.test.ts src/lib/services/search-query.test.ts`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

---

## Phase 4: The four-shop search

### Overview

The list's search asks the four shops at once and shows one entry per product, naming its shops, with each shop's count line, „Na liście” and "Dodaj". The texts stop naming Rossmann alone.

### Changes Required:

#### 1. The search and its entries

**File**: `src/lib/services/product-search.ts` (new)

**Intent**: Keep the search's decisions in a tested service (lesson "Keep decision logic in tested services"): what to ask, how items join, what each shop's line says, and what "Dodaj" adds.

**Contract**:

- **`searchShops(gate, query)`** asks the four shops at once, each one request of 10 hits:
  - Rossmann through `searchRossmann`, keeping its caption and spelling hint;
  - the others through their adapters.

  It resolves to each shop's outcome: items, or `unavailable` with its reason.

- **`searchEntriesOf(outcomes)`** is pure:
  - **Order:** shops in the fixed order, and items in each shop's own ranking.
  - **The entry's product** is its first item:
    - a Rossmann item keeps its name and caption;
    - any other's caption is null.
  - **Joins:** each later shop's items are judged with `pickMatch(entry's product, that shop's items)`:
    - a Rossmann, Natura or Hebe item joins only when accepted with a shared EAN (`sharesAnEan`);
    - a Super-Pharm item joins when accepted by the name rule.
  - **Conflicts:** an item accepted for two entries joins neither, and every item not joined becomes its own entry.
- **An entry** carries:
  - its product, as "Dodaj" posts it;
  - its shops, in the fixed order;
  - each item's shop and id.
- **`shopLinesOf(outcomes)`** gives each shop's line: its item count, „brak wyników” for none, or „nie odpowiada” for `unavailable`.
- **`onListOf`** marks an entry when any of its items is a listed product's own item, or the item of a listed product's match. It reads the list's existing reads, with no new query.

#### 2. The page and its texts

**File**: `src/pages/watchlist.astro`, `src/components/watchlist/SearchResults.astro`, `src/components/shell/SearchForm.astro`, `src/lib/shop-messages.ts` (if a text moves there)

**Intent**: Draw the entries server-side, as today, in words that name all four shops.

**Contract**:

- **The page** awaits `searchShops` in place of `searchRossmann`, in the same `Promise.all` and behind the same `searchStepOf` guard.
- **The results:**
  - Each entry is one row, with its shops' names under its name, such as „Rossmann · Natura · Super-Pharm”.
  - Each row has "Dodaj" or „Na liście”, described as today.
  - The shops' line sits above the entries.
  - Rossmann's spelling hint stays.
- **New Polish texts:**
  - a heading „Wyniki”;
  - a placeholder and label naming the shops;
  - an empty result for all four shops, with a hint to try a shorter name;
  - a footer naming the shops' searches.

  The owner reviews them in Phase 5's check.

- **No unavailable alert.** A shop that couldn't be asked shows in its line. When none answered, the line says so for each.

#### 3. Rossmann's page size

**File**: `src/lib/services/shops/rossmann.test.ts`, `src/lib/services/shops/super-pharm.test.ts`, `src/lib/services/watchlist.test.ts`

**Intent**: Call 9: 10 hits per shop, so Rossmann's search goes from 24 to 10.

**Contract**: the list's search asks for 10. The three tests that pin `pageSize=24` (`rossmann.test.ts:41`, `super-pharm.test.ts:159`, `watchlist.test.ts:140`) pin 10, served from the 10-hit recordings.

#### 4. Fixtures and tests

**File**:

- `src/lib/services/shops/fixtures/`: the four recordings not yet kept become fixtures: `hebe-search-nivea-soft.json`, `natura-search-aa-laab.json`, `super-pharm-search-nivea-soft.json` and `super-pharm-search-aa-laab.json`;
- `src/lib/services/product-search.test.ts` (new);
- `src/dev/watchlist.astro` with `src/dev/watchlist-fixtures.ts`.

**Intent**: Pin the search on the owner's eight recorded answers.

**Contract**:

- **Through the real gate,** with the four requests and Super-Pharm's POST body asserted:
  - **„nivea soft”:** Rossmann 26900 with Natura NV89063 and Super-Pharm 10132; Natura NV890500 with Hebe 218807.
  - **AA LAAB:** Rossmann 419343 with Hebe 450251 and Super-Pharm 105870; four Natura items with their Hebe twins.
  - No wrong join, and the conflict rule.
  - Each shop's line, the order of the entries, and „Na liście” for an item listed as a product or as a match.
  - The first shop's item as "Dodaj"'s product.
- **A shop that refuses or fails** shows „nie odpowiada”, and the others' entries still show.
- **The kitchen sink** draws:
  - an entry from four shops;
  - one from a single shop;
  - a shop not answering;
  - „Na liście”;
  - the empty result.

### Success Criteria:

#### Automated Verification:

- The search's and the adapters' tests pass: `npx vitest run src/lib/services/product-search.test.ts src/lib/services/shops/rossmann.test.ts src/lib/services/shops/super-pharm.test.ts src/lib/services/watchlist.test.ts`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

---

## Phase 5: Docs and rollout

### Overview

Record what changed for the shopper and the code, and check the four-shop search and a product from another shop on the owner's phone.

### Changes Required:

#### 1. The PRD and the research note

**File**: `context/foundation/prd.md`, `docs/research/polish-drugstore-price-apis.md`

**Intent**: The requirements say what shipped, in dated update notes, as earlier slices wrote them.

**Contract**:

- **FR-003:** the search asks four shops, with one entry per product, its shops named and each shop's line.
- **FR-004:** a product's identity can come from any of the four shops, with the EAN a helper. A Super-Pharm item carries none.
- **US-02:** "(EAN fixed)" holds when the product has one.
- **FR-006:**
  - every word of a captionless product's name is required;
  - Rossmann is matched by the same rule for a product from another shop.
- **The research note's §6** says how the search joins items, and the captionless rule.

#### 2. CLAUDE.md and the test plan

**File**: `CLAUDE.md`, `context/foundation/test-plan.md`

**Intent**: The project rules and the test guide name the new reads.

**Contract**:

- **CLAUDE.md:**
  - "Shops and matching": Rossmann's adapter entry, the per-product shops, the search and its grouping, the captionless rule, and the lookup queries;
  - "UI": the search's entries and line;
  - the switch, which is now `PRICED_SHOPS`, with `matchedShopsOf`.
- **The test plan:**
  - §6.4: Rossmann's entry, and the search's tests on recordings;
  - §6.6: this change's entry;
  - §7: any accepted edge.

### Success Criteria:

#### Automated Verification:

- Prettier leaves the edited documents as they are: `npx prettier --check context/foundation/prd.md context/foundation/test-plan.md docs/research/polish-drugstore-price-apis.md context/changes/add-from-other-shops/plan.md`
- Lint and the whole unit suite pass: `npm run lint`, `npm run test`
- CI's `ci`, `smoke` and `e2e` pass on the PR

#### Manual Verification:

- The owner checks in production after the merge, on the phone:
  - a search for „nivea soft” and for AA LAAB shows the entries, their shops and each shop's line;
  - a product only another shop sells can be added;
  - its page shows its own price and its link, and looks Rossmann and the others up.

---

## Testing Strategy

### Unit Tests:

- Rossmann's two searches and its offers, on its recordings (Phase 1).
- Each per-product rule at its boundaries: the own key, the own-shop decision, the refetch and the narrowing (Phase 2).
- The captionless name rule, the lookup queries and Hebe's sets; the lookups on the three new Rossmann recordings (Phase 3).
- The search's entries, lines and „Na liście” on the eight recordings, through the real gate (Phase 4).

### Integration Tests:

- The seam tables with a product from Natura; the database checks for its rows and its Rossmann match (Phase 2).
- The e2e spec for a product from another shop (Phase 2).

### Manual Testing Steps:

1. In production, search „nivea soft” on the phone: the Nivea Soft 300 ml entry names Rossmann, Natura and Super-Pharm, and the line gives each shop's count.
2. Search the AA LAAB face wash: its entry names Rossmann, Hebe and Super-Pharm.
3. Add a product that only Natura, Hebe or Super-Pharm sells, then open it: its own shop's price, age and link show, and Rossmann and the other shops are looked up.

## Performance Considerations

What each view and action costs every shop (lesson "Bound what each page view and action costs every shop"):

| View or action                                                            | Shop requests                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A search, on the user's own navigation                                    | 4: one per shop, 10 hits each, at once. A reload repeats it. A link from another site or a prefetch costs 0, as today.                                                                              |
| "Dodaj"                                                                   | 0                                                                                                                                                                                                   |
| Opening a product added from Natura or Hebe, every matched shop undecided | At most 5: Rossmann 1, the other Luigi's Box shop up to 2 (EAN, then name), Super-Pharm 1, its own item 1 when its last check is over 15 minutes old. A Rossmann product costs at most 6, as today. |
| Opening a product added from Super-Pharm                                  | At most 4: one name search each in Rossmann, Natura and Hebe, plus its own item.                                                                                                                    |
| A shop left at a choice                                                   | It's asked again on each such view, as today.                                                                                                                                                       |
| An automatic Rossmann match                                               | It brings its first price from the search's offer, so no extra request.                                                                                                                             |
| A list refresh                                                            | Rossmann: one request per stale Rossmann item, now including Rossmann matches. The batched shops as before. The two-failure stop and the refusal stop hold.                                         |

## Migration Notes

No migration. The schema and the access rules already take any shop. Existing products are Rossmann's, and their matched shops stay Natura, Hebe and Super-Pharm.

## Implementation Notes

One line per adaptation, added in the phase's commit (`context/foundation/lessons.md`, "Record every adaptation in the plan in the same commit").

### Phase 1

- **`price-refresh.ts` takes `fetchRossmannPrices` from the registry,** not by importing it: `PRICE_FETCHERS` is built from `SHOP_ADAPTERS` for all four shops, so a direct import would go unused. The moved function is unchanged but for `export`.
- **`KnownShop` is gone,** each use renamed to `MatchableShop`, now the same union. That's a type-only change in `price-comparison-state.ts`, `watchlist-rows.ts` and `price-refresh.test.ts` too. `staleTargets` and `byOldestCheck` take `PricedItem` without a type argument, since `PricedItem<MatchableShop>` now equals its default, which lint refuses to spell out.
- **`searchRossmann`'s `size` is required.** The list page passes `SEARCH_SIZE = 24`, and `super-pharm.test.ts` (`rossmannProduct`) and `watchlist.test.ts` pass 24, keeping their `pageSize=24` URLs for Phase 4 to change.
- **`shop-matching.test.ts`'s `slowGate` and `trackerShop` take `MatchedShop`,** since their `Record<"all" | MatchableShop, number>` would now need a Rossmann key. No assertion changed.
- **"availability unread" is one rule, `hasUnreadAvailability`.** The price check keeps its line with the value's kind. The item search counts it through the shared `logOddValues` („N of M product hits”), among the items with an offer, as the batched shops count theirs.
- **The offer's fields are one schema, `offerSchema`,** which `itemSchema` and `detailSchema` extend. `toOffer` gives null for a price that isn't a number, and the detail still requires a numeric price, so the price check reads as before.
- **A candidate's joined name is cut to `PRODUCT_LIMITS.name`** (300 characters), not dropped.
- **Where the moves are pinned:** the registry entry in `rossmann.test.ts`, since the registry has no test file of its own; the three lists in `price-comparison.test.ts`; `PRICE_FETCHERS` for all four shops in `price-refresh.test.ts`.
- **`recordings/natura-search-aa-laab.json` reads `[email removed]`** where Natura's answer carried a person's e-mail address, in the GPSR fields `producent_gpsr1` and `dostawca_gpsr`, which the app never reads: the repository is public (CLAUDE.md). `research.md` says so beside the recordings.
- **Cases beyond the plan's list:** the item search keeps the list search's gaps (every item dropped, an empty answer whose count isn't 0, a 403); a joined name over the limit; an item without an offer counts no availability.
- **Left for Phase 5:** CLAUDE.md's "Shops and matching" still names `KnownShop` and says only the shops on Luigi's Box and Algolia count odd values through `logOddValues`, and the test plan's §6.4 describes Rossmann's adapter without its registry entry or its search's offers.

### Phase 2

- **`MATCHED_SHOPS` and `MatchedShop` are gone, not aliased.** The type parameters that only let a test pass shops outside `MATCHED_SHOPS` went with them, so `PricedKey`, `PricedItem`, `productPriceKeys`, `listPricedItems`, `matchStatesOf`, `runMatchSteps` (`MatchStepsInput`, `MatchStepResult`), `MatchedShopView`, `MatchCard`, `undecidedShopsOf`, `unreadableShopsOf` and `matchCardOf` name `PricedShop`.
- **Every rule that takes a list of shops takes the priced shops and narrows per product inside** (`matchedShopsOf(source, shops)`): `productPriceKeys`, `listPricedItems`, `matchStatesOf`, `listTargets` and `productTargets`. `productPriceKeys` finds the own shop in `PRICED_SHOPS` itself, so a test's list without the product's shop still gives its own item.
- **The page narrows its address and notices through the services:** `repinShopOf`, `retryShopOf`, `decisionNotice` and `decisionError` take an optional `shops`, and the page passes them `matchedShopsOf(product.source)`, as it does `runMatchSteps`, whose default is the same set.
- **`itemInRows` reads the product first, then its decisions only for a matched shop,** one after the other. So a refetch of the own item stays one query and a match's costs one more round trip, and a product no longer on the list reads as `gone` even when its decisions couldn't be read (before: `failed`).
- **No `matchesIn` helper:** `listMatches` and `listMatchStates` read every priced shop, and each reader narrows per product (`runMatchSteps`, `shopItemFor`, `productTargets`, `matchStatesOf`, `listPricedItems`), as `matches.ts`' comment on the four read rules says.
- **`matchesFailedText(shops)` requires its shops,** which a new `listMatchedShops(products)` gives: the shops some listed product is matched in. So `ListRow` and `ListedProduct` carry `source`, and a list of Rossmann products keeps today's alert.
- **`linksOfShop` and `LinkedFields` moved from `matches.ts` to `form-fields.ts`,** so "Dodaj" and a decision check an item's links by one rule, and `optionalUrl`, then unused, is gone. "Dodaj"'s schema checks `sourceItemId` and the links through `SHOP_ADAPTERS[source]` in one refinement.
- **`SearchResults.astro`'s empty-result hint** takes `matchedShopsOf("rossmann")`; its text is unchanged until Phase 4.
- **Existing tests whose expectations followed the new defaults:** `listMatches` and `listMatchStates` now read Rossmann's rows; `?repin=rossmann` and `?shop=rossmann` are read; `shop-matching.test.ts`' `trackerShop` and `slowGate` know Rossmann again, undoing Phase 1's narrowing; and `watchlist.test.ts`' "a shop other than Rossmann" became dm, no shop, and a Rossmann id posted as Hebe's.
- **The lookup cost cases name the product "nivea soft",** with no brand or size, so each shop's search hits an existing recording. A product from Natura costs 4 requests (Rossmann 1, Hebe 2, Super-Pharm 1) and stores Rossmann's automatic match with its search offer's price; one from Super-Pharm costs 3, one per matched shop.
- **A decision posted for a product's own shop is still stored,** since the form doesn't say which shop is the product's own; every read leaves it out, as the plan's "Critical Implementation Details" accept.
- **The e2e seeds:** `addProduct({ source, name, productUrl })` replaces `addRossmannProduct`, with a fresh id in its shop's shape from `FRESH_IDS`, now keyed by `PricedShop`. `addMatchedProduct`, its only caller, adds a product from Rossmann through it, and `matchShop` takes any priced shop.
- **The spec gives every matched shop a stored match with a fresh price,** so its page compares four shops and looks nothing up: Natura's own 15,49 zł is the cheapest, then Rossmann's 16,99 zł. It also checks that Natura's own card has no „Zmień” and no lookup notice, and that the shop request log doesn't move, as the other specs do.
- **The product kitchen sink** has a group for the product picked in Natura (6 states) and a "Rossmann" section with Rossmann's card in 18 kinds and its `MatchChoice`. Two of Natura's kinds have no Rossmann version: a re-pin marked incomplete, since Rossmann's re-pin runs only its name search, and "matched + brand", a state from before the brand rule. `leftToUser` takes the product as an optional second argument.
- **The list kitchen sink** has two rows of products picked in Natura, and a rows state whose alert names Rossmann too.
- **The watchlist check also proves** that a user can't add a product from Natura to another user's list (42501).
- **The prices check's Rossmann match** uses the script's own 14-digit `rossmannId`, as its other Rossmann ids do: the database takes it, though the app's rule is 1 to 12 digits. Its reads are checked on the table and on both views.
- **Left for Phase 5:** the test plan's §6.3 and CLAUDE.md describe `addMatchedProduct` and `matchShop` without `addProduct` or a Rossmann match, and CLAUDE.md's entries for the two database checks don't mention a product from Natura.

## References

- Research: `context/changes/add-from-other-shops/research.md`, re-checked on 2026-10-08. The owner's calls are in `change.md`.
- The evaluation of the grouping on the recordings (2026-10-08): the scratchpad's `afos-eval`, whose tables Phase 4's tests pin.
- The matching rule and its history: `src/lib/services/matching.ts`, `context/archive/2026-10-06-match-by-name/`.
- The adapters: `src/lib/services/shops/`. The shop gate: `src/lib/services/shop-gate.ts`.
- The test guide: `context/foundation/test-plan.md` §6.2–§6.4.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rossmann as a shop like the others

#### Automated

- [x] 1.1 Rossmann's, the refresh's and the comparison's tests pass — cc4fdd4
- [x] 1.2 Lint, type check and the whole unit suite pass — cc4fdd4

### Phase 2: Each product's own shop

#### Automated

- [x] 2.1 The services' tests pass
- [x] 2.2 Lint, type check and the whole unit suite pass
- [ ] 2.3 The database checks and the new spec pass in CI's `smoke` and `e2e` jobs on the PR

### Phase 3: Matching a product without a caption

#### Automated

- [ ] 3.1 The rule's, the lookups' and the adapters' tests pass
- [ ] 3.2 Lint, type check and the whole unit suite pass

### Phase 4: The four-shop search

#### Automated

- [ ] 4.1 The search's and the adapters' tests pass
- [ ] 4.2 Lint, type check and the whole unit suite pass

### Phase 5: Docs and rollout

#### Automated

- [ ] 5.1 Prettier leaves the edited documents as they are
- [ ] 5.2 Lint and the whole unit suite pass
- [ ] 5.3 CI's `ci`, `smoke` and `e2e` pass on the PR

#### Manual

- [ ] 5.4 The owner checks in production after the merge, on the phone
