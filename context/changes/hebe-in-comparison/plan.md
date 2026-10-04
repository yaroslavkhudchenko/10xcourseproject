# Hebe in the Comparison (S-05) Implementation Plan

## Overview

Hebe becomes the second matched shop beside Drogerie Natura. Each watched product is matched in Hebe once: automatically when the matching rule allows, otherwise by the user. Hebe's prices are then fetched through the shop gate, stored with the other shops' prices, and compared on the product page and on the watchlist.

The plan first turns Natura's one-shop matching, pricing, page and list code into code for a list of matched shops, while Natura is still the only member. Natura's behaviour and texts stay identical through that rewrite, so the six existing e2e specs act as its safety net. Then Hebe is switched on with its own adapter, built on a shared Luigi's Box client.

## Current State Analysis

From `context/changes/hebe-in-comparison/research.md`; anchors re-checked on 2026-10-02.

- **The infrastructure is ready, and no migration is needed.**
  - `SHOP_HOSTS.hebe` lists `live.luigisbox.com` (`src/lib/services/shop-gate.ts:11`).
  - `public.shops` has a seeded `hebe` row with cap 30 (`supabase/migrations/20260926112205_polite_shop_access.sql:40-44`).
  - `watchlist_matches` and `price_observations` key the shop by a foreign key with no per-shop check, and their RLS names no shop (`20260928011450_price_observations.sql:89-127`).
  - `SHOP_IDS` includes `hebe` (`src/types.ts:2`).
- **Natura is hard-wired as the only matched shop in the services and views:**
  - `PRICED_SHOPS = ["rossmann", "natura"]` (`price-comparison.ts:26`), `productPriceKeys`, `listPricedItems`, `productTargets` and `refreshPrices` (`price-refresh.ts:40-57`);
  - the decision form's `shop: z.literal("natura")` and its Natura URL checks (`matches.ts:66-72, 89-90`);
  - `lookupInNatura` and `lookupChoicesInNatura` (`shop-matching.ts:26, 64`);
  - the page-wide `?repin=1` and `?retry=1` (`match-step.ts:20-23`; `notices.ts:98`);
  - decision notices without a shop (`notices.ts:10-20`);
  - one `natura` view, step and choice on the page (`[id].astro:118-188`);
  - the island's single `natura` prop and `ShopGrid`'s Natura branch (`PriceComparisonView.tsx:44, 145-174`);
  - a boolean `match-changed` whose alert names Natura;
  - the list's `naturaStateOf`, `naturaMismatchOf` and `NATURA_STATUS` (`watchlist-rows.ts:120-182, 335-347`).
- **About 30 user-visible texts name Natura**, in four forms: "Natura", "w Naturze", "Natury" and "Drogerie Natura". About a third read `SHOP_LABELS`; the rest are literals. A few would break with two matched shops: "czeka", "wyborem w Naturze", "zostanie sprawdzona", and the footer's " i ".
- **Hebe's Luigi's Box, from 7 owner-approved probes on 2026-10-02:**
  - Items are `type: "item"`, and the hit `url` is the 18-digit id, equal to `attributes.ID`.
  - Pinned prices come back from `f[]=type:item&f[]=ID:<id>`, OR-batched and trimmed by `hit_fields`.
  - Without `q`, the tracker forces `searchable:true`, so an item Hebe doesn't sell online returns 0 hits.
  - `price` is a string, beside numeric `price_amount`, `price_sale_amount` and `price_omnibus_amount`.
  - Orderable means `online_flag: [true]`, while `availability` is 1 even offline.
  - `Pojemność` is unreliable, but the legal name `Nazwa wymagana przez prawo` ends with the right size and unit in all 5 inspected items.
- **Request budget:** a product render's peak is the 5 database reads (`[id].astro:97`). Concurrent lookups for two shops add at most 2 at once, and the heaviest render traced is 19 subrequests. Workers allow 6 simultaneous connections and 10 000 subrequests (`context/archive/2026-09-28-cheapest-shop-today/research.md:247-250`).

## Desired End State

**Product page**

- A watched product shows one card per shop: Rossmann, Natura and Hebe.
- Each matched shop's card says where its matching stands and offers its own "Zmień", "Dopasuj ponownie" or "Szukaj ponownie".
- A choice section appears for each shop that has candidates waiting.
- The cheapest fresh, orderable price among all three is marked, and nothing is marked while any shop's decision can't be read.

**Watchlist**

- Rows name the cheapest of the three shops.
- The screen-reader line states each matched shop's matching.
- "Do sprawdzenia" holds a product while any matched shop is undecided, not found, unreadable, or automatically matched with a differing size or brand.
- The list's "Odśwież ceny" refreshes Hebe too.

**Requests**

- Nothing asks Hebe except the user's own navigation or an explicit action.
- One request at a time per shop, and a shop that refuses is asked no more.
- Every Hebe answer that can't be read becomes a visible gap, never a price, "not found" or "missing".

**Verified by**

- the unit suite, with Hebe's recorded answers and broken copies of them;
- the six existing e2e specs, updated for the third shop, plus a new three-shop phone spec;
- the dev kitchen sinks showing every Hebe state;
- a local check against live Hebe on a budget the owner approves;
- the owner's phone check on production.

### Key Discoveries:

- **Natura's client is reusable.** Above its attribute mapping, Natura's adapter is a generic Luigi's Box client: search, the response schema, `readHits`, the product-hit filter, batching, stop-after-refusal, and the missing-versus-failed rule (`natura.ts:11-133, 213-324`). `fetchPriceBatch` matches hits by `hit.url` (`:239`), which is Hebe's id too.
- **The matching rule needs no change.** `pickMatch` only reads a candidate's `eans`, `size` and `brand` (`matching.ts:34-58`). The confirm form re-parses the posted `sizeText`, so a Hebe candidate's `sizeText` must parse back to the same `size` (`matches.ts:137`; `types.ts:162`).
- **`decideMatchStep` already takes a shop** (`match-step.ts:36`); only its inputs `retrying` and `repinning` are page-wide. `record`, `recordLookup`, `recordDecision` and `listMatchStates` are shop-generic (`matches.ts:220-304, 370-438`).
- **The comparison and the cards take N shops.** `compareShops`, `verdictOf`, `namesOf`, `heroOf`, `trackOf`, `ShopCard` and `ShopLink` all do. `SHOP_LABELS` and `SHOP_FILLS` are `Record<PricedShop, …>`, so the compiler asks for Hebe's entries (`price-comparison.ts:38-41`; `shop-fills.ts:7-10`).
- **One product read is all or nothing:** any odd row fails it (`matches.ts:350-364`). The lessons ask for per-row parsing (`context/foundation/lessons.md:20-24`).
- **e2e is close to ready.** It holds every enabled shop, Hebe included (`scripts/e2e-local-db.mjs:140-144`). But `auth.setup.ts:44-49` proves only Rossmann and Natura stopped, `matchNatura` is hard-coded (`tests/e2e/support/watchlist-data.ts:124-138`), and `cardOf` is typed `"Rossmann" | "Natura"` (`tests/e2e/support/pages.ts:22-27`).
- **The local Hebe row can be left stopped.** `scripts/check-shop-gate-db.mjs:86-98` stops it ("HTTP 403") and no script turns it back on. Before a manual check against live Hebe, confirm `public.shops` has `hebe` enabled locally.

## What We're NOT Doing

- **No migration or grant change.** The schema already takes Hebe, and the DB check scripts get no new cases. `check-matches-db.mjs` already writes Hebe rows, and the price policy names no shop.
- **No Super-Pharm (S-06).** Its adapter, its missing EANs and its search key come later. This plan only makes its arrival a matter of an adapter plus labels.
- **Pojemność isn't used, even as a cross-check** (owner, 2026-10-02).
- **No Hebe items that Hebe doesn't sell online** (`searchable` false). They are never offered, and a refresh by id can't see them (owner).
- **No new matching rule for Hebe:** no name comparison and no "never automatic" (owner). The S-08 review's blind spot stays: a wrong EAN on a same-size, same-brand item is accepted. "Zmień" and the suspicious count remain the remedy.
- **No name search after an EAN answer** (owner). The first lookup keeps Natura's flow; the re-pin choice runs both searches.
- **No backward compatibility for `?repin=1` or `?retry=1`.** An old value is ignored, and the page renders as a plain view. The address bar forgets `repin` once the choice has rendered, and a successful retry redirects to the plain address. A failed retry keeps `?retry=1` in the address, since it isn't in `NOTICE_PARAMS`. Reopened after the deploy, that address shows the stored "not found" and asks no shop.
- **No change to the test plan's §1–§2.** The correction to risk #6's evidence (the "wrong EAN" was a wrong size field) is left for `/10x-test-plan --refresh` as a follow-up.
- **No contract tests for Rossmann's or Natura's recordings.** The broken-copy pattern is built for Hebe and documented in test-plan §6.4. Rolling it out to the other shops is test-plan rollout Phase 3.
- **No live Hebe in any automated test or in CI.** Recorded answers only.
- **No reading of Hebe's tracker id at runtime.** It is a constant, as Natura's is.

## Implementation Approach

1. **Phase 1 builds Hebe's adapter in isolation.**
   - Natura's adapter is split into a shared Luigi's Box client plus Natura's mapping. `natura.test.ts` must pass unchanged, which proves the split.
   - `hebe.ts` maps Hebe's attributes onto the same client: the legal-name size, online-only candidates, sale/Omnibus/`online_flag` prices, and pinned batches by `ID`.
   - Fixtures come from the 2026-10-02 probes. Broken copies of them prove that a changed answer becomes a gap.
2. **Phases 2–5 rewrite the matching services, prices, the product page and island, and the list for a list of matched shops, with `MATCHED_SHOPS = ["natura"]`.**
   - The shops the code knows and the shops that are switched on are kept apart (plan review F1). `MATCHABLE_SHOPS = ["natura", "hebe"]` keys the per-shop tables from Phase 2: the labels, the adapter registry (Hebe's Phase 1 adapter included) and the price fetchers. `MATCHED_SHOPS = ["natura"]` is the only switch for what the pages, routes, schemas and the list use.
   - Every function that loops over matched shops takes the list as a parameter, typed by the known shops and defaulting to `MATCHED_SHOPS`. Unit tests can then run Natura and Hebe together, on Hebe's real label and adapter, before Hebe is switched on.
   - Natura's rendered texts stay byte-identical, except two that Phase 4 rewrites so they read right for any shop (its Overview names them). The six e2e specs assert neither, so they stay green without edits. That is each phase's regression gate.
3. **Phase 6 switches Hebe on** by adding it to `MATCHED_SHOPS`, and updates everything that observes a third shop: the colour token, the sinks, the tests that pinned Hebe as unfetched, the e2e helpers and specs, plus a new three-shop spec.
4. **Phase 7 corrects the docs** that rest on the old "wrong EAN" reading, and rolls out. There is no migration, so the release is an ordinary merge.

## Critical Implementation Details

### What each page view and action may cost the shops

The lesson requires this table (`context/foundation/lessons.md:12-17`). The plan holds these numbers; the island's request recorder and the gate's request log prove them in tests.

| Action                                                       | Rossmann                                 | Each matched shop (Natura, Hebe)                                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product view, own navigation, decision stored                | ≤ 1, if stale                            | ≤ 1, if matched and stale                                                                                                                                                  |
| Product view, own navigation, no decision                    | ≤ 1                                      | 1–2 searches in the render (the name search only when the EAN search found nothing, after Hebe's online filter), then ≤ 1 (0 after an automatic match with a stored offer) |
| `?repin=<shop>`, own navigation                              | 0 (the island's refetch is off)          | 2 searches for that shop; 0 for the others (an undecided one shows its button, plan review F2)                                                                             |
| `?retry=<shop>` over a stored "not found"                    | ≤ 1                                      | 1–2 searches for that shop; no lookup for the others (an undecided one shows its button), and ≤ 1 for each other shop if matched and stale                                 |
| Another site's link, a prefetch, the prompt, a decision post | 0                                        | 0                                                                                                                                                                          |
| The product's "Odśwież ceny"                                 | 1                                        | 1 if matched                                                                                                                                                               |
| The list's "Odśwież ceny"                                    | 1 per distinct stale item, one at a time | ⌈distinct stale ids / 50⌉ batches, one at a time                                                                                                                           |

- **Across shops:** lookups and refreshes run concurrently; within a shop they run one at a time.
- **Worst case on a first open with both shops undecided:** 2–4 Luigi's Box requests, with a wait of at most about 8 s, since each search waits at most 4 s.
- **Subrequests:** each render peaks at the 5 database reads, then runs at most 2 lookup subrequests at once. The heaviest render is 19.

### Hebe's online filter and the pinned path

- Requests with `q` (the searches) have no implicit filter, so they return items Hebe doesn't sell online. The adapter drops a hit whose `searchable` isn't `[true]`.
- An EAN search whose only hits are dropped therefore counts as "found nothing", and the first lookup goes on to the name search, as Natura's flow does.
- A pinned refresh returns 0 hits for an item that has gone offline since it was matched. That is `missing` (US-02: the price is marked stale; the match is never un-pinned), not `failed`.

### Label forms

`ShopLabel` gains `of` (genitive) and `title` (the choice section's heading and region name):

| Shop     | `name`   | `in`         | `of`      | `title`         | `site`            |
| -------- | -------- | ------------ | --------- | --------------- | ----------------- |
| Rossmann | Rossmann | w Rossmannie | Rossmanna | Rossmann        | rossmann.pl       |
| Natura   | Natura   | w Naturze    | Natury    | Drogerie Natura | drogerienatura.pl |
| Hebe     | Hebe     | w Hebe       | Hebe      | Hebe            | hebe.pl           |

Sentences that hold one shop's name in a gendered or singular form are rephrased so they read right for any shop and any count:

- "…Natura zostanie sprawdzona…" becomes "…sklep {name} zostanie sprawdzony…".
- The hero's waiting line agrees in number: "Natura czeka na dopasowanie" and "Natura i Hebe czekają na dopasowanie".
- The removal confirm drops the shop.
- The footer joins the sites as "a, b i c".

## Phase 1: Hebe's adapter on a shared Luigi's Box client

### Overview

Split Natura's adapter into a shared Luigi's Box client plus Natura's attribute mapping, with no behaviour change. Add Hebe's adapter on the same client, with fixtures from the 2026-10-02 probes and contract tests on broken copies of them. Fill test-plan §6.4. Nothing in the app calls Hebe yet.

### Changes Required:

#### 1. The shared Luigi's Box client

**File**: `src/lib/services/shops/luigis-box.ts` (new)

**Intent**: Hold everything of `natura.ts` that isn't Natura's own:

- the search and the price batches;
- the response schema and `readHits`;
- dropping query pseudo-hits;
- dedupe and batches of 50, one at a time;
- a copy of the refusal for the remaining batches;
- the "missing only if every hit was read and asked for, else failed" rule;
- the 404 "tracker id rejected" log;
- the value helpers.

Binding each client to one shop makes it impossible to charge one tracker's request to another shop.

**Contract**:

- A factory takes a shop config and returns `search(gate, q, size): Promise<ShopSearch>` and `fetchPrices(gate, ids): Promise<Map<string, PriceCheck>>`.
- The config fields are `shop` (`ShopId`), `trackerId`, `itemType` (`"product"` for Natura, `"item"` for Hebe), `idField` (`"sku"` or `"ID"`), `priceFields` (the `hit_fields` list), `toCandidate(hit)`, `toOffer(hit)` and `isItemId(id)`.
- The config also names the shop's log events (`natura-search` and `natura-prices`, `hebe-search` and `hebe-prices`) and the word its log details use for an id (`SKU`, `ID`) (plan review F5).
- The URLs keep the parameter order, the encoding and the `hit_fields` order that `natura.test.ts` pins. A search keeps its 4 s `AbortSignal.timeout`, passed unwrapped as `init.signal`.
- Every `gate.fetch` call uses the bound `shop`.

#### 2. Natura on the client

**File**: `src/lib/services/shops/natura.ts`

**Intent**: Keep only Natura's tracker, attribute schema, `toCandidate`, `toOffer`, `readSize` and host checks, and build `searchNatura` and `fetchNaturaPrices` on the client.

**Contract**: The exports and their behaviour are unchanged: `NATURA_TRACKER_ID`, `searchNatura`, `fetchNaturaPrices`, `isNaturaProductUrl`, `isNaturaImage`. `natura.test.ts` passes with no edit.

#### 3. Hebe's adapter

**File**: `src/lib/services/shops/hebe.ts` (new)

**Intent**: Map Hebe's attributes, following the owner's decisions of 2026-10-02.

**Contract**:

- **Exports:** `HEBE_TRACKER_ID = "421168-505233"`, `searchHebe`, `fetchHebePrices`, `isHebeProductUrl` (https on `www.hebe.pl`) and `isHebeImage` (https on `www.hebe.pl`).
- **Candidate:** a hit is offered only when it has `type: "item"`, a price and `searchable` equal to `[true]`.
  - `shopItemId` is the hit `url`, checked against `^\d{1,40}$` on the hit and again before it goes into a filter.
  - `name` is the legal name `Nazwa wymagana przez prawo[0]`, else `title`. `brand` is `brand[0]`.
  - `eans` are `EAN[]`, keeping 8–14 digit values.
  - The size is the trailing `<number>[,.<dec>] <unit>` of the legal name, else of `ShortDescription[0]`. `Pojemność` is never read, and no readable size means an unknown size.
  - `productUrl` is `web_url[0]`, `imageUrl` is `image_link`, and `offer` is built from the hit.
- **Offer:**
  - `price` is `price_sale_amount` when present, else `price_amount`.
  - `regularPrice` is `price_amount` when a sale price is present (`storableOffer` keeps it only when it is above the price).
  - `lowestPrice30d` is `price_omnibus_amount`. `promoEndsOn` is null, since Hebe sends no end date.
  - `available` is `online_flag[0] === true`.
- **Pinned prices:** `f[]=type:item&f[]=ID:<id>…`, with `hit_fields` naming `price_amount`, `price_sale_amount`, `price_omnibus_amount` and `online_flag`.

#### 4. Reading a trailing size

**File**: `src/lib/services/size.ts`

**Intent**: Add a helper that cuts the trailing size out of a product text, so that `parseSize` reads it and the confirm form's round trip holds.

**Contract**:

- `trailingSizeText(text: string): string | null`. For example, "…pomadka do ust 5,5 ml" gives "5,5 ml", "…W Kostce Creme Soft 100 g" gives "100 g", and a text without a trailing size gives null.
- Its result always parses with `parseSize` into the same size.

#### 5. Hebe's fixtures

**Files**: `src/lib/services/shops/fixtures/hebe-*.json` (new)

**Intent**: Real Hebe answers, never invented ones:

- `hebe-ean-offline.json`, probe 2: the EAN search whose one hit isn't sold online;
- `hebe-name-search.json`, probe 3 trimmed to at most 5 hits, keeping at least one `type: "query"` pseudo-hit;
- `hebe-ids.json`, probe 4: the two-id batch with `hit_fields`;
- `hebe-id-unknown.json`, probe 6: 0 hits.

The bodies are in `context/changes/hebe-in-comparison/probes/`: `2-ean-search.body`, `3-name-search.body`, `4-pinned-by-ID.body` and `6-pinned-unknown.body`. They were copied on 2026-10-04 from session f95837fd's scratchpad `probes/hebe/` (plan review F7). Phase 1 deletes that folder before its commit, once the fixtures are trimmed from it, so no raw body is committed. At most 2 more answers are recorded, only with the owner's OK at that time: an EAN search for an item Hebe sells online (for example 4005900008299, Nivea Soft 200 ml), and one more if a test needs it. They follow the same rules: curl from the developer machine, the gate's User-Agent, at least 2 s apart, never from CI.

**Contract**: The provenance is stated in `hebe.test.ts`'s header, as `natura.test.ts:15` does for Natura.

#### 6. Hebe's adapter tests

**File**: `src/lib/services/shops/hebe.test.ts` (new)

**Intent**: Prove Hebe's mapping on its own recordings, and that a changed answer becomes a gap (test-plan risk #5).

**Contract**: Every case builds a real gate over `createReplayFetch` and asserts the requested URLs, with Hebe's tracker pinned in them. The cases:

- **Mapping tables:** the offline 300 ml item is dropped; the online items map their sizes (300 ml, 200 ml, 750 ml, 5,5 ml, 100 g) and EANs; pseudo-hits are dropped; sale, regular and Omnibus prices map; `online_flag` gives `available`.
- **Through `pickMatch`:** the real candidates give the outcomes FR-006 defines. The EAN search with only an offline hit reads as finding nothing.
- **Pinned batches:** asked-for ids give prices; an unknown id gives `missing`; a hit not asked for gives `failed`; 51 ids give 2 requests; the refusal stop works.
- **Broken copies** (a missing field, a string where a number belongs, HTML instead of JSON, empty hits on a search, a 404 text/plain tracker answer) give `unavailable/failed`, never a price, "not found" or `missing`.
- **Binding:** every `gate.fetch` call names `"hebe"`.

#### 7. The cookbook for adapter tests

**File**: `context/foundation/test-plan.md`

**Intent**: Replace §6.4's TBD with the pattern this phase built, so Super-Pharm's adapter (S-06) and rollout Phase 3 reuse it.

**Contract**: §6.4 covers location and naming, recording a fixture (who, how and how far apart), broken copies, asserting the replay's URLs, and the run command. §1–§2 are untouched.

### Success Criteria:

#### Automated Verification:

- Natura's adapter passes `natura.test.ts` unchanged on the shared client (the test file has no diff)
- `hebe.test.ts` passes with the mapping, the `pickMatch` outcomes, the batches, the broken copies and the shop binding
- `npm run test`, `npm run lint` and `npx astro sync && npx astro check` are clean
- Break-checks turn `hebe.test.ts` red: offering a `searchable: [false]` hit, pricing from `price_amount` while a sale price exists, and reading the size from `Pojemność`
- Test-plan §6.4 has no "TBD" left and Prettier passes on it

#### Manual Verification:

- The owner approves any new Hebe recording before it is made, or no new recording was needed

**Implementation Note**: After this phase's automated checks pass, pause for the owner's confirmation before Phase 2.

---

## Phase 2: Matching services for every matched shop (Natura only)

### Overview

Make the matching services work for a list of matched shops: the shop registry and labels, the lookups, the decision form, the re-pin and retry parameters, the decision notices, and the decisions read per row and per shop. `MATCHED_SHOPS = ["natura"]`, so nothing visible changes.

### Changes Required:

#### 1. Matched shops and their labels

**File**: `src/lib/services/price-comparison.ts`

**Intent**: Define once, browser-safe, beside the priced shops, which shops the code knows and which are switched on, and give the labels the two forms the texts need.

**Contract**:

- `MATCHABLE_SHOPS = ["natura", "hebe"] as const` and `MatchableShop`: every shop the code can match, each with a label and an adapter from this phase on.
- `MATCHED_SHOPS = ["natura"] as const satisfies readonly MatchableShop[]` and `MatchedShop`: the shops switched on. This is the only switch. The pages, routes, the decision and price-request schemas, the list and the island read it.
- `PRICED_SHOPS = ["rossmann", ...MATCHED_SHOPS]`.
- The per-shop tables are keyed by the known shops, `"rossmann" | MatchableShop`. That covers `SHOP_LABELS`, which gets Hebe's label now (values in Critical Implementation Details), the adapter registry (§2) and the price fetchers (Phase 3). The rules' shop-list parameters, per-shop maps and price keys take known shops and default to `MATCHED_SHOPS`, so a test can pass `["natura", "hebe"]`.
- `SHOP_FILLS` and everything rendered stay keyed by `PricedShop` until Phase 6 adds Hebe's colour.
- `ShopLabel` gains `of` and `title`.

#### 2. The adapter registry

**File**: `src/lib/services/shops/registry.ts` (new; server-only)

**Intent**: One place that maps each known shop to its adapter.

**Contract**: `SHOP_ADAPTERS: Record<MatchableShop, { search, fetchPrices, isProductUrl, isImage }>`, holding Natura's adapter and Hebe's from Phase 1. Nothing reaches Hebe's entry while `MATCHED_SHOPS` leaves Hebe out.

#### 3. Lookups for any matched shop

**File**: `src/lib/services/shop-matching.ts`

**Intent**: Replace `lookupInNatura` and `lookupChoicesInNatura` with lookups that take the shop and use its adapter, keeping Natura's flow. The first lookup searches by EAN and runs the name search only when the EAN search found nothing. The re-pin choice runs both searches, at most 6 items, accepting none on its own.

**Contract**:

- `lookupInShop(shop, gate, product): Promise<ShopLookup>` and `lookupChoicesInShop(shop, gate, product): Promise<ShopChoices>`.
- `NaturaChoices` is renamed `ShopChoices` (`src/types.ts:208-211`).
- The log event becomes `shop-lookup`, with the shop.

#### 4. Decisions per shop

**File**: `src/lib/services/matches.ts`

**Intent**: Accept a decision for any matched shop, check its URLs with that shop's checks, and read a product's decisions one row at a time, so an odd row fails only its own shop.

**Contract**:

- The decision schema is built from a shop list (`decisionFieldsFor(shops = MATCHED_SHOPS)`), so the route refuses `hebe` until Phase 6 while a test passes `["natura", "hebe"]`. `productUrl` and `imageUrl` are checked by `SHOP_ADAPTERS[shop]`.
- `listMatches(itemId, shops = MATCHED_SHOPS)` returns each listed shop's decision and an `unreadable` set of shops.
- `listMatchStates`' `unread` is keyed by product and shop.
- Both read each row on its own, by four rules (plan review F3), each with a unit case:
  1. A row of a shop outside the list is ignored, whether the shop is known or unknown and the row readable or odd. This keeps stored Hebe decisions harmless after a revert, and Super-Pharm's in S-06.
  2. An odd row of a listed shop makes only that shop unreadable.
  3. A row whose shop field can't be read makes every listed shop of its product unreadable.
  4. A row whose product can't be read (today's `unattributed`) makes every product without a readable decision for its shop unreadable for that shop. If its shop can't be read either, that applies to every listed shop.
- `decisionBackTo` adds `shop=<shop>` to every decision redirect, codes and errors alike.

#### 5. Matching steps per shop

**File**: `src/lib/services/match-step.ts`

**Intent**: Read re-pin and retry per shop, and switch the island's refetch off while any shop's re-pin choice is open.

**Contract**:

- `repinShopOf(params)` and `retryShopOf(params)` return a `MatchedShop` or null; any other value is ignored.
- The `decideMatchStep` input's `retrying` and `repinning` become `retryShop` and `repinShop`; each step compares them with its own shop.
- On a view opened with `repin=<shop>` or `retry=<shop>`, any other shop that has no stored decision gets `prompt`, not `lookup`, so that view asks only the named shop (plan review F2; the cost table). The named shop keeps today's rules.
- `autoRefreshOf(steps, ownNavigation)` takes every shop's step.

#### 6. Notices that name their shop

**File**: `src/lib/notices.ts`

**Intent**: Let a decision's notice and error name the shop they belong to, and build the decline text from the label.

**Contract**:

- `REPIN_PARAM` and the new `RETRY_PARAM` carry a shop id.
- A new `SHOP_PARAM` joins `NOTICE_PARAMS`.
- `DECISION_NOTICES.declined` becomes a function of the shop: "Zapisano: brak {in}.", which for Natura reads exactly "Zapisano: brak w Naturze.".

#### 7. The view model for any shop

**File**: `src/lib/services/natura-view.ts` → `src/lib/services/match-view.ts`

**Intent**: Rename the module and its types: `NaturaView` → `MatchView`, `NaturaOption` → `MatchOption`, `NaturaRepin` → `MatchRepin`, `NaturaProduct` → `MatchProduct`. Every function takes the shop, and its texts come from the shop's label, with no change to Natura's rendered texts.

**Contract**:

- Each of `notFoundView`, `optionView`, `chooseView`, `repinView`, `promptView` and `decidedView` takes `shop: MatchedShop`.
- `decisionNotice(params)` returns `{ shop, text } | null`; a code without a valid matched shop gives null.
- The links carry `retry=<shop>` and `repin=<shop>`.

#### 8. The callers, adapted mechanically

**Files**: `src/pages/api/watchlist/matches.ts`, `src/pages/watchlist/[id].astro` and `src/pages/watchlist.astro`, plus the modules that the renames and the new shapes break (plan review F4):

- `src/components/watchlist/natura-card.ts`, `NaturaCard.tsx` and `NaturaSection.astro`, for the renamed view module and its types; their own renames stay in Phase 4;
- `src/lib/services/price-targets.ts`, for the new `listMatches` shape;
- `src/lib/services/watchlist-rows.ts`, for the per-shop `unread`;
- the kitchen sinks' `src/dev/fixtures.ts`, `src/dev/product-page.astro` and `src/dev/watchlist-fixtures.ts`.

**Intent**: Call the renamed services with `"natura"`, so the pages and the kitchen sinks still render exactly as before. Phase 4 builds the per-shop page.

**Contract**: No visible change; the e2e specs pass unedited.

#### 9. Tests

**Files**: `matches.test.ts`, `match-step.test.ts`, `shop-matching.test.ts`, `natura-view.test.ts` → `match-view.test.ts`, the notices' tests, and the tests of §8's modules (`natura-card.test.ts`, `price-targets.test.ts`, `watchlist-rows.test.ts`)

**Intent**: Reshape the tests to the new contracts. Natura's text assertions move without edits.

**Contract**:

- New cases run two shops through the list parameter:
  - an odd Hebe row leaves Natura's decision readable;
  - the four row rules of §4;
  - `repin=hebe` re-pins only Hebe;
  - `retry=natura` retries only Natura;
  - on `repin=natura` and on `retry=natura`, an undecided Hebe gets `prompt`;
  - a decision for `hebe` is accepted only with Hebe's URL checks.
- `match-step.test.ts:108-117` ("ignores another shop's decision") stays valid.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with Natura's text assertions unchanged and the new two-shop cases green
- `npm run lint` and `npx astro check` are clean
- `npx playwright test` passes all six existing specs unedited from a cold server
- `npm run smoke` passes against the production preview
- Break-checks turn a unit test red: failing every shop on one odd row, counting a row of a shop outside the list, re-pinning every shop on `repin=hebe`, looking up an undecided other shop on a `repin=` view, and accepting a Hebe decision with a Natura URL

#### Manual Verification:

- `/dev/product-page` and `/dev/watchlist` render every section as before, in both themes

**Implementation Note**: After this phase's automated checks pass, pause for the owner's confirmation before Phase 3.

---

## Phase 3: Prices for every matched shop (Natura only)

### Overview

Make the price keys, the refresh targets and `refreshPrices` work for every matched shop: one handler per shop, all shops in parallel, one request at a time within a shop. The page's own copy of the price keys goes away. Natura is still the only matched shop.

### Changes Required:

#### 1. Price keys and priced items

**File**: `src/lib/services/price-comparison.ts`

**Intent**: Derive the keys and the list's priced items from every matched shop's `matched` decision, not from Natura's alone.

**Contract**:

- `productPriceKeys(product, decisions)` gives Rossmann's own item plus each matched shop's matched item.
- `listPricedItems` takes matches of every matched shop.

#### 2. Refresh targets

**File**: `src/lib/services/price-targets.ts`

**Intent**: Let `productTargets` and `listTargets` cover every matched shop.

**Contract**: `productTargets(...)` drops its Natura literal (`:112-113`). `priceRequestSchema` already follows `PRICED_SHOPS`.

#### 3. One fetcher per shop

**File**: `src/lib/services/price-refresh.ts`

**Intent**: Replace the hard-coded `Promise.all([Rossmann, Natura])` with a table of fetchers. Rossmann fetches by id, one at a time; each matched shop uses its adapter's `fetchPrices`. All shops run in parallel, and each stores its checks as soon as it finishes. Each shop's stop-after-refusal is kept.

**Contract**:

- `PRICE_FETCHERS: Record<"rossmann" | MatchableShop, (gate, ids) => Promise<Map<string, PriceCheck>>>`: Rossmann's fetcher plus each registry adapter's `fetchPrices`, derived from `SHOP_ADAPTERS` rather than written out a second time.
- `refreshPrices` takes the shop list, defaulting to `PRICED_SHOPS`, so a test refreshes Natura and Hebe together.
- `notFetched()` stays only for a key whose shop isn't in that list.

#### 4. The page uses the shared keys

**File**: `src/pages/watchlist/[id].astro`

**Intent**: Replace the page's own priced-items list (`:182-188`) with `productPriceKeys`, which closes the product-page-ui follow-up.

**Contract**: No visible change.

#### 5. Tests

**Files**: `price-comparison.test.ts`, `price-targets.test.ts`, `price-refresh.test.ts`, `prices.test.ts`

**Intent**: Reshape the tests to the new signatures. New cases run two matched shops through the list parameter.

**Contract**:

- Two matched shops are refreshed in parallel and each one at a time.
- A refusal from one stops only that shop.
- The tests that pin Hebe as unfetched stay as they are until Phase 6.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with the new two-shop refresh cases green
- `npm run lint` and `npx astro check` are clean
- `npx playwright test` passes the six existing specs unedited, with their exact price-call pins
- `npm run smoke` passes
- Break-checks turn a unit test red: refreshing the shops one after the other, letting a refusal from one shop stop the other, and dropping a matched shop's key

The price-call pins are at `phone-refresh.spec.ts:102, 117-123` and `price-honesty.spec.ts:143-146`.

**Implementation Note**: After this phase's automated checks pass, pause for the owner's confirmation before Phase 4.

---

## Phase 4: The product page and the island for every matched shop (Natura only)

### Overview

Build the product page and its price island around the list of matched shops:

- one matching step per shop, with the lookups running concurrently;
- one card and one choice section per shop;
- a reload alert that names its shop;
- "Najtaniej" withheld while any decision can't be read;
- texts that read right for any count of shops.

With Natura alone, every rendered text stays as it is, except two that are rewritten on purpose so they read right for any shop (plan review F9):

- "…Natura zostanie sprawdzona ponownie." becomes "…sklep Natura zostanie sprawdzony ponownie.";
- the removal confirm becomes "…razem z Twoimi wyborami w sklepach.".

### Changes Required:

#### 1. Steps per shop

**File**: `src/pages/watchlist/[id].astro`

**Intent**:

- Decide one step per matched shop from that shop's decision and the page's `repin`/`retry` shop.
- After the reads, run the shops' lookups concurrently; each shop's own searches stay one at a time. Each shop's work settles on its own: a shop whose lookup, recording or first price throws is logged and shown as unavailable, and the other shops render as usual (plan review F6).
- Record each shop's automatic outcome and store its first price.
- Route each decision notice and error to its shop's card, and render one choice section for each shop that has a choice.

**Contract**:

- The steps, lookups, recordings and first prices of all shops run in one service, for example `runMatchSteps` in `src/lib/services/shop-matching.ts`, which the page only calls (lesson "Keep decision logic in tested services").
- The page builds `MatchedShopView[]` in `MATCHED_SHOPS` order and passes it to the island.
- A successful `retry=<shop>` redirects to the plain address, as today.

#### 2. The card for any matched shop

**Files**: `src/components/watchlist/natura-card.ts` → `match-card.ts`, `NaturaCard.tsx` → `MatchCard.tsx`

**Intent**: Rename the module and its types (`naturaCardOf` → `matchCardOf`, `naturaUndecided` → `undecided`, `naturaUnreadable` → `unreadable`), and take the shop from the input. The texts come from the labels.

**Contract**:

- `ShopHeader` takes the card's shop.
- "…Natura zostanie sprawdzona ponownie." becomes "…sklep {name} zostanie sprawdzony ponownie.".
- Every other Natura text renders unchanged.

#### 3. The choice section for any matched shop

**File**: `src/components/watchlist/NaturaSection.astro` → `MatchChoice.astro`

**Intent**: Take the shop: the heading and the region's name from `title`, a hidden `shop` field, and an `idPrefix` and a submit-once group per shop.

**Contract**: For Natura the heading and region are still "Drogerie Natura", and `phone-decline-match.spec.ts:26` finds them.

#### 4. The island

**Files**: `src/components/watchlist/PriceComparison.tsx`, `PriceComparisonView.tsx`, `price-comparison-state.ts`

**Intent**:

- Take a list of matched shops' cards instead of one `natura` prop.
- `ShopGrid` appends a price-less card for each matched shop without a price row.
- `match-changed` carries its shop, so the alert names it ("Dopasowanie {in} się zmieniło.").
- `compareRows` and `announcement` withhold "Najtaniej" and ", najtaniej" whenever any matched shop's decision is unreadable.
- `heroOf` and `trackHint` name every undecided shop and agree in number.

**Contract**:

- Props: `matched: MatchedShopView[]`.
- `NaturaRead`/`NaturaContext` become per-shop maps.
- `rowShopsOfIsland` adds a synthetic unread row for each matched shop whose decision can't be read.

#### 5. Texts that work with several shops

**File**: `src/components/watchlist/RemoveProduct.astro`

**Intent**: The removal confirm no longer names one shop.

**Contract**: "Produkt zniknie z Twojej listy razem z Twoimi wyborami w sklepach." (the rest of the sentence unchanged).

#### 6. The island guard

**File**: `eslint.config.js`

**Intent**: List the renamed modules in `islandConfig.files`.

**Contract**: `match-card.ts` and `MatchCard.tsx` replace `natura-card.ts` and `NaturaCard.tsx` (`:104, :108`).

#### 7. The product kitchen sink

**Files**: `src/dev/product-page.astro`, `src/dev/fixtures.ts`

**Intent**: Feed the new props, with the same Natura states, so the sink renders as before.

**Contract**: Every section of `/dev/product-page` keeps its states.

#### 8. Tests

**Files**: `price-comparison-state.test.ts`, `natura-card.test.ts` → `match-card.test.ts`, `shop-matching.test.ts`

**Intent**: Reshape the tests to the new props, and add two-shop cases.

**Contract**: With two matched shops:

- an unreadable Hebe decision withholds "Najtaniej" and ", najtaniej";
- the hero names "Natura i Hebe" as waiting;
- `match-changed` for Hebe names Hebe;
- a shop whose lookup throws comes back unavailable, and the other shop's result is kept.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with the new two-shop island cases green
- `npm run lint`, `npx astro check` and `node scripts/check-token-contrast.mjs` are clean
- `npm run build` ships its fonts
- `npx playwright test` passes the six existing specs unedited
- `npm run smoke` passes
- Break-checks turn a unit test red: ignoring an unreadable decision in `compareRows`, a `match-changed` without its shop, and letting one shop's throw reject the others

#### Manual Verification:

- `/dev/product-page` shows every state as before, apart from the two rewritten texts, in light and dark, at 390 px and at 1280 px

**Implementation Note**: After this phase's automated checks pass, pause for the owner's confirmation before Phase 5.

---

## Phase 5: The list for every matched shop (Natura only)

### Overview

Build the watchlist's rules around the list of matched shops: per-shop states and suspicious counts, per-shop status lines on the screen-reader line, "Do sprawdzenia" over every matched shop, the list's alert, and the footer's "a, b i c". With Natura alone, the rows render as they do today.

### Changes Required:

#### 1. The list's rules per shop

**File**: `src/lib/services/watchlist-rows.ts`

**Intent**:

- Replace `naturaStateOf`, `naturaMismatchOf`, `NATURA_STATUS` and `mismatchText` with per-shop versions whose texts come from the labels.
- `listRowOf` takes every matched shop's state.
- A row is unread while any matched shop's decision is unreadable.
- "Do sprawdzenia" holds a row when any matched shop is `none`, `not_found` or `unreadable`, or has an automatic match that differs (owner, 2026-10-02: an undecided Hebe counts), or when any price is stale or unread.

**Contract**:

- `ListMatchState` per shop, and `matchStatesOf(item, states): Record<MatchedShop, ListMatchState>`.
- `listRowOf(item, shops, matchStates, now)`.
- Status lines: "{name}: do dopasowania", "{name}: nie znaleziono", "{name}: brak (Twój wybór)", "{name}: nie udało się wczytać dopasowania", and "{name}: sprawdź dopasowanie, …".

#### 2. The list's alert and footer

**Files**: `src/components/watchlist/ListRows.astro`, `src/components/watchlist/ListFooter.astro`, and a list-join helper next to `namesOf` (`price-comparison.ts:574`)

**Intent**: The alert names the shops whose decisions failed, and the footer joins the sites as "a, b i c".

**Contract**:

- "Nie udało się wczytać dopasowań {in-list}. Odśwież stronę.", which for Natura reads exactly "…dopasowań w Naturze…".
- The footer: "Ceny online z rossmann.pl i drogerienatura.pl" today; with three shops, "Ceny online z rossmann.pl, drogerienatura.pl i hebe.pl".

#### 3. The list kitchen sink

**Files**: `src/dev/watchlist.astro`, `src/dev/watchlist-fixtures.ts`

**Intent**: Feed the per-shop states, keeping today's rows.

**Contract**: `/dev/watchlist` keeps its rows and states.

#### 4. Tests

**File**: `src/lib/services/watchlist-rows.test.ts`

**Intent**: Reshape the tests to the new contracts, and add two-shop cases.

**Contract**: With two matched shops:

- an odd Hebe decision row doesn't hide Natura's state;
- a row with Hebe unreadable names no cheapest shop;
- an undecided Hebe puts a row in "Do sprawdzenia";
- an automatic Hebe match with another size counts and says why on the screen-reader line;
- a Hebe match the user confirmed doesn't count.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with the new two-shop list cases green
- `npm run lint` and `npx astro check` are clean
- `npx playwright test` passes the six existing specs unedited
- `npm run smoke` passes
- Break-checks turn a unit test red: one shop's unreadable decision hiding another's state, and an undecided second shop left out of "Do sprawdzenia"

#### Manual Verification:

- `/dev/watchlist` shows every row and state as before, in light and dark, at 390 px and at 1280 px

**Implementation Note**: After this phase's automated checks pass, pause for the owner's confirmation before Phase 6.

---

## Phase 6: Hebe switched on

### Overview

Add Hebe to the matched shops and update everything that observes a third shop:

- its label and colour;
- the kitchen sinks;
- the unit tests that pinned Hebe as unfetched;
- the e2e helpers and specs, plus a new three-shop phone spec;
- a local check against live Hebe on an owner-approved budget.

### Changes Required:

#### 1. Hebe joins

**File**: `src/lib/services/price-comparison.ts`

**Intent**: Add `hebe` to `MATCHED_SHOPS`. Its label (`{ name: "Hebe", in: "w Hebe", of: "Hebe", title: "Hebe", site: "hebe.pl" }`) and its registry entry have been in place since Phase 2.

**Contract**: `MATCHED_SHOPS = ["natura", "hebe"]`.

#### 2. Hebe's colour

**Files**: `src/styles/global.css`, `src/components/watchlist/shop-fills.ts`

**Intent**: Give Hebe its pink, at the same lightness and strength as the other two shops (owner, 2026-10-02).

**Contract**:

- `--shop-hebe: oklch(0.885 0.07 350); /* #FEC7E0 */` in `:root` and in `.dark`, plus `--color-shop-hebe: var(--shop-hebe)` in `@theme inline`.
- `SHOP_FILLS.hebe = "bg-shop-hebe"`.
- `scripts/check-token-contrast.mjs` accepts the new property.

#### 3. The tests that pinned Hebe as unfetched

**Files**: `price-targets.test.ts:144, 250-255`, `price-refresh.test.ts:377-396`, `prices.test.ts:352`, `price-comparison.test.ts:618-622, 644-653`, `matches.test.ts:313`, `watchlist-rows.test.ts:548-554, 609-629`, and `price-comparison-state.test.ts:119`, whose `Record<PricedShop, RefreshResult>` needs Hebe's key (plan review F4). The line numbers are from 2026-10-02, and Phases 2–5 move them.

**Intent**: Flip them to Hebe's real behaviour. A shop outside `PRICED_SHOPS` (such as `super-pharm`) takes over as the "not fetched" example.

**Contract**: Every flipped case states what Hebe now does.

#### 4. The kitchen sinks with three shops

**Files**: `src/dev/fixtures.ts`, `src/dev/product-page.astro`, `src/dev/watchlist-fixtures.ts`, `src/dev/watchlist.astro`

**Intent**: Show Hebe's states:

- on the product page: the cheapest among three; Hebe undecided, choosing, matched, declined, not found and unreadable beside a priced Natura; Hebe's button beside Natura's open re-pin choice (plan review F2); and two choice sections open at once;
- on the list: rows with Hebe's status lines, a suspicious Hebe match, and an unreadable Hebe decision.

**Contract**: The fixtures go through the real rules (`pickMatch`, `matchCardOf`, `listRowsOf`), as the sinks do today.

#### 5. e2e helpers and the existing specs

**Files**: `tests/e2e/support/watchlist-data.ts`, `tests/e2e/support/pages.ts`, `tests/e2e/auth.setup.ts`, and the six specs

**Intent**: Seed and find any matched shop, and prove that every priced shop is stopped. Update the specs' expected texts for a third shop, for example a Hebe status on the screen-reader line or Hebe's card while Hebe's search is stopped. Where a spec's story needs a settled Hebe, seed a Hebe decision.

**Contract**:

- `matchShop(shop, productId, …)` replaces `matchNatura`, with fresh ids per shop: Natura `E2E-<hex>`, Hebe 18 digits.
- `cardOf(page, label)` takes any shop's label.
- `auth.setup.ts` checks `PRICED_SHOPS`.
- The specs' price-call pins are updated to what each story now asks.

#### 6. The three-shop phone spec

**File**: `tests/e2e/phone-three-shops.spec.ts` (new)

**Intent**: Prove risks #7 and #1 with three shops on a phone, on the production build, with no live shop. The expected values come from the requirements (FR-011 and the S-03 rule that only fresh, orderable prices can win), not from the code.

**Contract**:

- **Seed:** a Rossmann product with prices from three shops: Rossmann 19,99 zł, Natura 17,49 zł and Hebe 16,99 zł, all fresh and orderable.
- **Product page:** Hebe's card alone carries "Najtaniej"; its price shows its age and "hebe.pl"; the hero says "w Hebe".
- **List:** the row's line names Hebe as cheapest.
- **After "Zmień" and "Żaden z nich" on Hebe's card, with Hebe's search stopped:**
  - the card says "Brak w Hebe — Twój wybór.";
  - Natura becomes the cheapest;
  - the list's line follows;
  - Natura's match is untouched.
- The island asks no shop on opening, and the gate's request log doesn't move.

#### 7. The smoke test

**File**: `scripts/smoke.mjs`

**Intent**: No change: it opens product pages only for ids that answer 404, so it triggers no lookup.

**Contract**: Re-checked, not edited.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes with Hebe matched and priced, and the flipped tests state Hebe's behaviour
- `npm run lint`, `npx astro check` and `node scripts/check-token-contrast.mjs` are clean, and `npm run build` ships its fonts
- `npx playwright test` passes the updated six specs and the new three-shop spec from a cold server, with no products left and the request log unmoved
- `npm run smoke` passes
- Break-checks turn something red: dropping Hebe from `listPricedItems` (the new spec or a unit test), and marking a stale Hebe price cheapest (a unit test)
- CI (`ci`, `smoke`, `e2e`) is green on the phase's commit

#### Manual Verification:

- A local check against live Hebe, within a budget the owner approves first (at most 10 Hebe requests), matches the cost table
- `/dev/product-page` and `/dev/watchlist` show every Hebe state, in light and dark, at 390 px and at 1280 px, and Hebe's pink reads apart from blue and mint

The local check: add a product that Hebe sells, open it and see Hebe's card settle, open "Zmień" on Hebe, and run the list's refresh. Hebe's requests in the gate log must match the cost table in Critical Implementation Details.

**Implementation Note**: After this phase's automated checks pass, pause for the owner's confirmation before Phase 7.

---

## Phase 7: Docs and rollout

### Overview

Correct the documents that rest on the old "Hebe returns wrong EANs" reading, describe the per-shop matching and Hebe's adapter where the project's rules live, and roll out. There is no migration, so the release is a PR and an ordinary merge.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md` (the project section only; the course block stays byte-identical)

**Intent**: Bring the rules up to date:

- **The confirmed-item bullet (`:22`):** the EAN is still only a helper. Hebe's size field is unreliable, and the one documented "wrong EAN" was a wrong size field. Super-Pharm's index has no EAN.
- **The "Shops and matching" bullet:** Hebe's adapter and tracker constant, the shared Luigi's Box client, the online-only filter, the matched shops and the registry.
- **The UI bullet:** one card and one choice section per matched shop, plus `?repin=<shop>` and `?retry=<shop>`.

**Contract**: Only these sentences change.

#### 2. PRD notes

**File**: `context/foundation/prd.md`

**Intent**: Add dated notes:

- FR-004's note: the example was a wrong size field.
- FR-006 and FR-007: Hebe matches like Natura.
- FR-013: Hebe added, with its online-only rule.

**Contract**: Dated "Update 2026-10-xx" notes, as earlier slices wrote them.

#### 3. The research note

**File**: `docs/research/polish-drugstore-price-apis.md`

**Intent**: Record what the probes found:

- §1 and §2.2: the corrected reading of the EAN example;
- the pinned-by-`ID` request and its `searchable` limit;
- the `*_amount` types and `online_flag`;
- the legal name as the size source.

**Contract**: The sections are updated in place, citing 2026-10-02.

#### 4. The roadmap

**File**: `context/foundation/roadmap.md`

**Intent**:

- Correct S-05's risk line, and answer its unknown (Hebe first, owner).
- Leave S-06 a carry-over: Super-Pharm joins through the registry and labels, with its own candidate rules for a missing EAN.

**Contract**: S-05 and S-06 blocks only.

#### 5. The test plan's notes

**File**: `context/foundation/test-plan.md`

**Intent**:

- Add a §6.6 note: this slice's adapter pattern and the new three-shop spec.
- Record the risk #6 evidence correction as a follow-up for `/10x-test-plan --refresh`.

**Contract**: §6 only.

#### 6. Production rollout

**Intent**:

- Before the merge, the owner confirms that production's `public.shops` row `hebe` is enabled with no disabled reason (dashboard or SQL editor).
- The PR is opened and the owner merges it.
- The owner checks it on a phone on production: a product's Hebe card, the list's Hebe line, and a list refresh.
- **The way back (plan review F8).** If Hebe misbehaves after the merge, the owner sets production's `hebe` row to `enabled = false`. The gate then skips every Hebe request at once, without a deploy, and Hebe's cards show the gap. The full rollback is a revert PR, which needs green `ci`, `smoke` and `e2e`. The stored Hebe decisions stay, and the reads ignore them (Phase 2 §4, rule 1).

**Contract**: The plan gets a "Production rollout" note at archive time.

### Success Criteria:

#### Automated Verification:

- Prettier passes on every changed Markdown file, and `npm run lint` is clean
- CLAUDE.md's course block is byte-identical (sha256 before and after)
- CI (`ci`, `smoke`, `e2e`) is green on the final commit

#### Manual Verification:

- The owner confirms that production's `hebe` shop row is enabled before the merge
- After the merge, the owner's phone check on production passes: a Hebe card, the list's Hebe line and a list refresh

---

## Testing Strategy

### Unit Tests:

- **Hebe's adapter (Phase 1):**
  - mapping tables on the recorded candidates: the offline 300 ml item, sizes in ml and g including "5,5 ml", sale, regular and Omnibus prices, `online_flag`, pseudo-hits;
  - the `pickMatch` outcomes on real candidates;
  - pinned batches (missing versus failed, the 51-id split, the refusal stop);
  - broken copies that become `unavailable/failed`;
  - the shop binding.
- **Matching, prices, island and list (Phases 2–5):** each reshaped suite keeps Natura's cases unchanged in substance. New two-shop cases run through each function's shop-list parameter: per-row decisions, per-shop re-pin and retry, parallel refreshes stopped per shop, the withheld "Najtaniej", the per-shop status lines and "Do sprawdzenia".
- **Phase 6:** the tests that pinned Hebe as unfetched now state Hebe's behaviour.

### Integration Tests:

- **Through the real gate:** every adapter test goes through the real gate over the replay fetch, asserting the URLs served (test-plan risk #3).
- **The database:** the existing DB checks run unchanged in CI's `smoke` job. The schema doesn't change.

### E2E Tests:

- **The six existing specs:** they stay green unedited through Phases 2–5, which is the rewrite's regression gate, and are updated for the third shop in Phase 6.
- **`phone-three-shops.spec.ts`:** the cheapest among three, then a Hebe decline, on a phone, on the production build, with every shop stopped and the request log unmoved.

### Manual Testing Steps:

1. After Phases 2, 4 and 5: the kitchen sinks look as before, apart from Phase 4's two rewritten texts, in both themes and at both widths.
2. After Phase 6, against live Hebe within the owner's budget:
   - add a product that Hebe sells, open it, and see Hebe's card match or offer a choice;
   - "Zmień" on Hebe offers Hebe's candidates;
   - the list's refresh includes Hebe;
   - the gate log matches the cost table.
3. After the merge: the owner's phone check on production.

## Performance Considerations

- **The shared host:** Natura's and Hebe's caps are separate, 30 a minute each, so at most 60 a minute reach `live.luigisbox.com`. That is the bound F-01 accepted (`context/archive/2026-09-26-polite-shop-access/plan-brief.md:97`).
- **The render's wait:** the matched shops' lookups run concurrently, so a first open with both shops undecided waits about as long as the slower shop (≤ 8 s), not the sum.
- **Subrequests:** a render peaks at the 5 reads and makes at most 19 subrequests. The list's refresh adds 2⌈H/50⌉ + 1 for H stale Hebe ids, with a peak of 3 during its shop requests.

## Migration Notes

- No schema change and no `db push`.
- Production needs its `hebe` row enabled (Phase 7). `scripts/check-shop-gate-db.mjs` stops only the local and CI rows, never production's.
- After `check-shop-gate-db.mjs` has run locally, re-enable the local `hebe` row before a manual check against live Hebe, with `npx supabase db reset --local` or a superuser SQL update. A reset deletes local users, so say so first.

## Implementation Notes

Each adaptation made during implementation gets one line here, naming the contract it changes and why, in the same commit as the change (`context/foundation/lessons.md:5-10`).

### Phase 1

- §5 (1.6): the owner approved one new recording. It is the EAN search for 4005900008299 (`search?tracker_id=421168-505233&q=4005900008299&size=5`, 2026-10-04T09:51:17Z), sent from the developer machine with the gate's User-Agent, exactly 1 request. It answered with one online hit, item 218807, "Nivea Soft Lekki Krem Nawilżający, 200 ml". It became a fifth fixture, `hebe-ean-online.json`, which drives the full candidate mapping and the `pickMatch` "accepted" outcome on the path the first lookup takes.
- §5: the fixtures keep each number's source text exactly (`JSON.rawJSON`, since `identity_hash` exceeds 2^53). Each equals its probe, except the name search, which keeps its first 5 hits (4 items, 1 query suggestion). The raw bodies were moved out of the change folder before the commit, to the session scratchpad.
- §1: the config's log names are one `log: { search, prices, id, tracker }` object. `tracker` names the constant in the 404 detail, so Natura's stays "NATURA_TRACKER_ID may have changed" and Hebe's reads "HEBE_TRACKER_ID may have changed".
- §1: an optional `isNotSoldOnline(hit)` hook leaves Hebe's `searchable: [false]` hits out of a search, the way query suggestions are, without counting them. So an EAN search whose only item isn't sold online finds nothing rather than failing.
- §3 narrows Critical Implementation Details' "drops a hit whose `searchable` isn't `[true]`", following the lesson "Never read an unreadable answer as missing". Only `searchable: [false]` means not sold online. A missing or odd `searchable` (absent, a bare `true`, `["true"]`, `[]`) is an unreadable hit: dropped and logged, so a search whose hits all read that way fails instead of finding nothing.
- §3: Hebe's candidates also require `type: "item"`. An untyped hit, which the shared filter still reads for Natura, is dropped and counted.
- §3: a `price_sale_amount` that is present but unreadable costs the hit in a search and fails the id in a price request. The regular price never stands in for it.
- §3: `available` reads `online_flag` through the shared `valuesOf`, as `valuesOf(online_flag)[0] === true`, so a list or a single value both read.
- §3: Hebe's id check is the shared `PRODUCT_LIMITS.shopItemId` with `/^\d+$/`, the same rule as `^\d{1,40}$`.
- §3: Hebe's `hit_fields` are exactly the plan's four, with no id field (Natura's list starts with `sku`). `hebe-ids.json` was recorded with a longer list, as the test's header says.
- §1–§2: the value helpers `valuesOf`, `textOf`, `amountOf`, `within`, `httpsHost` and a new `eansOf` are exported from `luigis-box.ts`. Natura's attribute-level `toOffer` is now `offerOf`, wrapped by the hit-level `toOffer` that the config takes.
- §1: a price hit's id is read from `hit.url` only after the shop's `toOffer` accepts the hit, which keeps Natura's "hits dropped" and "hits not asked for" counts as they were.
- §1: the shared log details keep "N of M product hits" for both shops. Only the events and the id word differ per shop ("invalid IDs", "N of M IDs not sent").
- §4: `trailingSizeText` returns only text that `parseSize` reads, normalised to "<amount> <unit>" ("0,5l" becomes "0,5 l"). It returns null for a multipack's trailing amount ("2 x 50 ml"), matching `parseSize`'s multipack rule. `size.test.ts` covers it.
- §6: Hebe's 404 broken copy reuses `natura-unknown-tracker.json`, Luigi's Box's answer to an unknown tracker, which names no shop. Renaming it would have edited `natura.test.ts`.
- §6: the "empty hits on a search" broken copy is an answer without a hits list, which fails. A real `hits: []` stays Luigi's Box's recorded "nothing found", and `total_hits` isn't cross-checked, since that would change Natura's behaviour.
- For Phase 7 (risk #6): Hebe's lip balm 742817 "5,5 ml" carries EAN 9005800362939, the same EAN as Rossmann's 11790 "4,8 g". That is a real shared EAN with a different size, and `hebe.test.ts` shows it is flagged and never accepted automatically.
- Open, pre-existing for both shops and pinned by `natura.test.ts`: a hit with neither `type` nor attributes counts as a query suggestion, so an answer that lost both would read as "found nothing". It is a candidate for test-plan rollout Phase 3.

## References

- Research: `context/changes/hebe-in-comparison/research.md`
- Test plan: `context/foundation/test-plan.md` (risks #3, #5, #6, #7; §6.3 e2e cookbook; §6.4)
- Requirements: `context/foundation/prd.md` (US-02, FR-004, FR-006, FR-007, FR-011, FR-013)
- Follow-ups this plan closes:
  - `context/archive/2026-10-01-fix-matches-and-watchlist/follow-ups/review-fixes.md:5-13`
  - `context/archive/2026-09-30-etykiety-redesign/plan.md:1169`
  - `context/archive/2026-09-29-product-page-ui/follow-ups/review-fixes.md:12-14`
- Patterns:
  - `src/lib/services/shops/natura.ts`, `src/lib/services/shops/natura.test.ts`
  - `src/lib/services/shop-matching.test.ts` (test-plan §6.1's reference)
  - `tests/e2e/price-honesty.spec.ts`, `tests/e2e/phone-decline-match.spec.ts`
- Lessons: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Hebe's adapter on a shared Luigi's Box client

#### Automated

- [x] 1.1 Natura's adapter passes `natura.test.ts` unchanged on the shared client (the test file has no diff)
- [x] 1.2 `hebe.test.ts` passes with the mapping, the `pickMatch` outcomes, the batches, the broken copies and the shop binding
- [x] 1.3 `npm run test`, `npm run lint` and `npx astro sync && npx astro check` are clean
- [x] 1.4 Break-checks turn `hebe.test.ts` red: offering a `searchable: [false]` hit, pricing from `price_amount` while a sale price exists, and reading the size from `Pojemność`
- [x] 1.5 Test-plan §6.4 has no "TBD" left and Prettier passes on it

#### Manual

- [x] 1.6 The owner approves any new Hebe recording before it is made, or no new recording was needed

### Phase 2: Matching services for every matched shop (Natura only)

#### Automated

- [ ] 2.1 `npm run test` passes, with Natura's text assertions unchanged and the new two-shop cases green
- [ ] 2.2 `npm run lint` and `npx astro check` are clean
- [ ] 2.3 `npx playwright test` passes all six existing specs unedited from a cold server
- [ ] 2.4 `npm run smoke` passes against the production preview
- [ ] 2.5 Break-checks turn a unit test red: failing every shop on one odd row, counting a row of a shop outside the list, re-pinning every shop on `repin=hebe`, looking up an undecided other shop on a `repin=` view, and accepting a Hebe decision with a Natura URL

#### Manual

- [ ] 2.6 `/dev/product-page` and `/dev/watchlist` render every section as before, in both themes

### Phase 3: Prices for every matched shop (Natura only)

#### Automated

- [ ] 3.1 `npm run test` passes, with the new two-shop refresh cases green
- [ ] 3.2 `npm run lint` and `npx astro check` are clean
- [ ] 3.3 `npx playwright test` passes the six existing specs unedited, with their exact price-call pins
- [ ] 3.4 `npm run smoke` passes
- [ ] 3.5 Break-checks turn a unit test red: refreshing the shops one after the other, letting a refusal from one shop stop the other, and dropping a matched shop's key

### Phase 4: The product page and the island for every matched shop (Natura only)

#### Automated

- [ ] 4.1 `npm run test` passes, with the new two-shop island cases green
- [ ] 4.2 `npm run lint`, `npx astro check` and `node scripts/check-token-contrast.mjs` are clean
- [ ] 4.3 `npm run build` ships its fonts
- [ ] 4.4 `npx playwright test` passes the six existing specs unedited
- [ ] 4.5 `npm run smoke` passes
- [ ] 4.6 Break-checks turn a unit test red: ignoring an unreadable decision in `compareRows`, a `match-changed` without its shop, and letting one shop's throw reject the others

#### Manual

- [ ] 4.7 `/dev/product-page` shows every state as before, apart from the two rewritten texts, in light and dark, at 390 px and at 1280 px

### Phase 5: The list for every matched shop (Natura only)

#### Automated

- [ ] 5.1 `npm run test` passes, with the new two-shop list cases green
- [ ] 5.2 `npm run lint` and `npx astro check` are clean
- [ ] 5.3 `npx playwright test` passes the six existing specs unedited
- [ ] 5.4 `npm run smoke` passes
- [ ] 5.5 Break-checks turn a unit test red: one shop's unreadable decision hiding another's state, and an undecided second shop left out of "Do sprawdzenia"

#### Manual

- [ ] 5.6 `/dev/watchlist` shows every row and state as before, in light and dark, at 390 px and at 1280 px

### Phase 6: Hebe switched on

#### Automated

- [ ] 6.1 `npm run test` passes with Hebe matched and priced, and the flipped tests state Hebe's behaviour
- [ ] 6.2 `npm run lint`, `npx astro check` and `node scripts/check-token-contrast.mjs` are clean, and `npm run build` ships its fonts
- [ ] 6.3 `npx playwright test` passes the updated six specs and the new three-shop spec from a cold server, with no products left and the request log unmoved
- [ ] 6.4 `npm run smoke` passes
- [ ] 6.5 Break-checks turn something red: dropping Hebe from `listPricedItems` (the new spec or a unit test), and marking a stale Hebe price cheapest (a unit test)
- [ ] 6.6 CI (`ci`, `smoke`, `e2e`) is green on the phase's commit

#### Manual

- [ ] 6.7 A local check against live Hebe, within a budget the owner approves first (at most 10 Hebe requests), matches the cost table
- [ ] 6.8 `/dev/product-page` and `/dev/watchlist` show every Hebe state, in light and dark, at 390 px and at 1280 px, and Hebe's pink reads apart from blue and mint

### Phase 7: Docs and rollout

#### Automated

- [ ] 7.1 Prettier passes on every changed Markdown file, and `npm run lint` is clean
- [ ] 7.2 CLAUDE.md's course block is byte-identical (sha256 before and after)
- [ ] 7.3 CI (`ci`, `smoke`, `e2e`) is green on the final commit

#### Manual

- [ ] 7.4 The owner confirms that production's `hebe` shop row is enabled before the merge
- [ ] 7.5 After the merge, the owner's phone check on production passes: a Hebe card, the list's Hebe line and a list refresh
