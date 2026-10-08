---
date: 2026-10-07T20:00:28Z
researcher: Claude (claude-opus-5-5)
git_commit: 7836e983d960c10ea25cecfee7733db8d627184c
branch: feat/testing-shop-answer-contracts
repository: yaroslavkhudchenko/10xcourseproject
topic: "Rollout Phase 3 of context/foundation/test-plan.md, shop answer contracts: how a changed or refused shop answer reaches the user and the database, adapter by adapter and request kind by request kind, what the tests already pin, and the cheapest test for each gap"
tags:
  [
    research,
    codebase,
    testing,
    rollout-phase-3,
    risk-5,
    risk-3,
    shop-adapters,
    shop-gate,
    luigis-box,
    algolia,
    rossmann,
  ]
status: complete
last_updated: 2026-10-07
last_updated_by: Claude (claude-opus-5-5)
---

# Research: shop answer contracts (rollout Phase 3)

**Date**: 2026-10-07T20:00:28Z
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 7836e983d960c10ea25cecfee7733db8d627184c
**Branch**: feat/testing-shop-answer-contracts
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md`, "Shop answer contracts", for two risks:

- **Risk #5:** a changed shop answer must become a visible gap or a failed check. It must never become a price, "not found" or "missing", and must never be stored as a price. The changes in scope are a missing field, a string for a number, HTML instead of JSON, a moved route, empty hits and an unexpected shape.
- **Risk #3:** a refused answer must stop or pause that shop, with nothing more asked of it, on every path a shop answer can come back through. The refusals in scope are a 403, a challenge, a 429 and a 503 with Retry-After.

The task is to verify, not accept, the test plan's guidance and three follow-ups (§6.6):

1. broken copies for Rossmann's and Natura's recordings;
2. a Luigi's Box hit with neither a `type` nor attributes reads as a query suggestion;
3. Super-Pharm's 403 is pinned only by the gate's rule, and live price batches are untested beyond four ids.

For each adapter and request kind, the research maps which cases are pinned, what each outcome stores, and the cheapest test for each gap.

## Summary

- **No refusal is stored, and every inspected path stops asking a shop that refused.**
  - The gate maps each refusal to `unavailable` (`src/lib/services/shops/shop-outcome.ts:15-34`). A lookup stores nothing for it (`src/lib/services/shop-matching.ts:375-377`), and a refresh adds no row (`src/lib/services/prices.ts:57-75`).
  - On the four paths that reach a shop, a refusal ends that shop's requests (§3): the list search, the product page's lookups, the re-pin choice, and the two price routes with their refresh. Many refusal kinds are pinned only at the gate, not on each path.
- **Five latent defects store or show a wrong fact when a shop changes its answer** (§2). Each comes from reading the code at the cited lines. D2, D3 and D4's Luigi's Box half were also confirmed by a worker's throwaway probes against the real gate and replay. D1, D5 and D4's Super-Pharm half were not probed:
  - **D1, Rossmann price:** every 404 reads as `missing` (`src/lib/services/shops/rossmann.ts:105-107`). The gate has discarded the body and content type (`src/lib/services/shop-gate.ts:157-158`). So a moved or retired detail route would add a `missing` row for every Rossmann item a refresh asks, and the refresh would report `done`.
  - **D2, Natura and Hebe search:** a hit whose `type` isn't the shop's item type is treated as a query suggestion and skipped silently (`src/lib/services/shops/luigis-box.ts:128`, `:202-217`). That covers a renamed `type`, even with its attributes intact, and a hit that lost both. An answer of only such hits reads as "found nothing", and a lookup stores `not_found`.
  - **D3, Natura and Hebe prices:** the same skip comes before anything counts dropped hits (`luigis-box.ts:170`; `src/lib/services/shops/pinned-prices.ts:93-141`). So such an answer reads as complete, and every asked id is stored as `missing`.
  - **D4, search counts:** Super-Pharm's search never compares `hits: []` with Algolia's own count (`src/lib/services/shops/super-pharm.ts:118-150`), and the Luigi's Box search ignores its `total_hits`. An empty hit list that says there were hits reads as "found nothing", which a lookup stores as `not_found`.
  - **D5, Rossmann search:** if every item fails its check, the search returns zero candidates and the page says „Brak wyników” (`rossmann.ts:78-86`). The other three adapters return `failed` in that case.
- **Silent value changes** store a plausible but wrong value without a log line (§2.6):
  - Hebe's sale price renamed: the regular price is stored as the current one.
  - Rossmann's `availability` renamed, or Natura's `availability` other than the number 1: stored as "not orderable".
  - Super-Pharm's price in another unit: no cross-check.
- **Tests already pin a lot:**
  - Hebe's and Super-Pharm's broken copies follow §6.4.
  - Natura pins the Luigi's Box client's batch rules.
  - Rossmann pins its non-JSON and wrong-shape bodies.
  - The re-pin choice has the strongest refusal coverage.
- **Tests miss a lot:**
  - Natura has no broken-copies block.
  - Hebe's search has no refusal or HTTP-error test.
  - Rossmann's broken copies change values but never remove a field.
  - No path pins a 429, a challenge or a 503 with Retry-After mid-path.
  - The first lookup's name search refused after an EAN miss is not pinned.
- **Cheapest layer:**
  - **D1–D5 need small production fixes, then broken-copy tests.** Each test is a copy of a recording with one plausible change, run through the real gate and the replay at adapter level, plus one test per path showing that nothing wrong is stored.
  - **D1 also needs the gate to keep a 404's content type** for the adapter, and needs an owner's call on what a moved route's 404 looks like, which was never recorded.
  - **Two cases no answer-shape check can catch:** an index that is still there but empty or re-keyed, and a renamed `type` on Luigi's Box's filtered price request. Both need a canary (research note §7), which belongs to monitoring.

## Detailed Findings

### 1. How an answer becomes an outcome, and what each outcome stores

- **The gate** (`src/lib/services/shop-gate.ts`):
  - It reserves before it sends (`:101-120`, then `:126-133`) and never follows a redirect (`:131`).
  - A 403 or a challenge is `blocked` and reported (`:139-146`). A 429, or a 503 with Retry-After, is `rate-limited` and reported (`:147-153`).
  - Any other non-2xx is `failed/http` with only its status: the body is discarded (`:157-158`).
- **The adapters' shared mapping** (`src/lib/services/shops/shop-outcome.ts`):
  - `gateUnavailable` (`:15-34`) maps:
    - capped → `busy`;
    - paused → `paused`;
    - stopped and `blocked` → `stopped`;
    - `rate-limited` → `paused` until Retry-After;
    - the counter unreachable (`skipped/unavailable`) and `failed` → `failed`.
  - `isRefusal` (`:10-12`) is true for every `unavailable` reason but `failed`.
- **What is stored, by path:**
  - **The list search** stores nothing.
    - `unavailable` shows a warning (`src/pages/watchlist.astro:50-51`, `:110-114`).
    - Zero candidates shows „Brak wyników dla „…” w Rossmannie”, per the Rossmann worker's reading of `SearchResults.astro:65-68`.
  - **A first lookup** (`lookupInShop`, `src/lib/services/shop-matching.ts:62-90`) returns at once on `unavailable` after either search (`:67-69`, `:79-81`). It returns `not-found` when both searches found no acceptable candidate (`:88-89`).
    - `lookupOutcome` stores `accepted` or `not-found` through `recordLookup` (`:346-348` → `src/lib/services/matches.ts:272-283`). An accepted candidate's offer becomes its first price row (`:349-357`).
    - It stores nothing for `choose` or `unavailable` (`:373-377`).
    - So `not_found` is written exactly when the searches return candidate lists with no acceptable one, empty lists included.
  - **The re-pin choice** (`lookupChoicesInShop`, `shop-matching.ts:103-149`) never stores anything.
  - **A price refresh** (`refreshPrices`, `src/lib/services/price-refresh.ts`) stores a `price` row for a price and a `missing` row for `missing` (`src/lib/services/prices.ts:57-75`), and no row for `unavailable`.
    - Rossmann is asked one product at a time and stops after a refusal (`price-refresh.ts:86-105`).
    - The other shops are asked in batches (`pinned-prices.ts`).
    - `refreshCodeOf` counts `missing` as answered (`price-refresh.ts:162-172`).

### 2. Risk #5, adapter by adapter

#### 2.1 Rossmann search (`searchRossmann`, `rossmann.ts:62-87`)

- **Pinned** in `src/lib/services/shops/rossmann.test.ts`:
  - recordings (`:72`, `:98`, `:113`);
  - one item's odd field, which costs that item or value (`:153-244`);
  - HTML with 200 (`:305`);
  - another JSON shape (`:308`);
  - an unreadable body (`:319`);
  - `items: []` (`:124`);
  - 500 and network failures (`:296`);
  - capped, paused, stopped and an unreadable counter (`:257-274`);
  - 403 (`:276`) and 429 (`:282`).
- **D5:** when every item fails its check, the search still returns `results` with no candidates (`:78-86`). It has no guard and writes no log line. The Luigi's Box client (`luigis-box.ts:146-150`) and Super-Pharm (`super-pharm.ts:144-149`) return `failed` in that case. Not pinned.
- **Not pinned:**
  - `totalCount > 0` with `items: []`, which reads as no results;
  - a 404 or a 502;
  - a 503 without Retry-After;
  - a challenge, a 503 with Retry-After or a timeout at adapter level (gate tests only, on a Hebe URL: `shop-gate.test.ts:148`, `:197`, `:216`).
- **Brittle, failing safe:** `spellCheckHint` is a required key (`rossmann.ts:40`). If Rossmann drops it, every search is `unavailable/failed`.
- **The broken copies** (`editable()`, `rossmann.test.ts:63-65`) are `structuredClone`s of `rossmann-search-results.json`. Every one adds or overrides a value; none removes a field.

#### 2.2 Rossmann price (`fetchRossmannPrice`, `rossmann.ts:95-125`)

- **Pinned:**
  - the reduced and regular recordings (`rossmann.test.ts:354`, `:361`; `price-refresh.test.ts:291`, `:444`);
  - an id that isn't 1–12 digits (`:403`);
  - a missing, text, zero or over-limit price (`:450`, `:496`);
  - an answer about another product (`:461`);
  - odd optional values (`:420-448`);
  - HTML with 200, and another shape (`:494-495`; `price-refresh.test.ts:426`);
  - 500 (`:483`; `price-refresh.test.ts:423`);
  - capped, paused and stopped (`:470`; `price-refresh.test.ts:368`);
  - 403 (`:483`; `price-refresh.test.ts:403`; `price-routes.test.ts:374`);
  - the recorded problem+json 404, as `missing` (`:371`; `price-refresh.test.ts:343`, `:444`).
- **D1:** `outcome.kind === "failed" && outcome.status === 404` gives `{ kind: "missing" }` (`rossmann.ts:105-107`). That holds for any 404, because the gate has discarded the body and its content type (`shop-gate.ts:157-158`).
  - So if Rossmann moved or retired `v2/api/Products/{id}`, every due Rossmann item would get a `missing` row (`prices.ts:71-72`). The row is shared by every watcher of the item.
  - The page would say the shop no longer sells the product, and the product could never be named cheapest. The refresh would report `done` (`price-refresh.ts:162-172`).
  - The research note's Appendix C lists unknown Rossmann routes that answer 404. Their body and type were never recorded.
  - The only recorded 404 (`rossmann-detail-unknown.json`) is `application/problem+json; charset=utf-8` with an RFC 9110 problem body. Since the code never reads the type, the existing tests can't tell the two 404s apart.
  - The other shops read a 404 as `failed` (`luigis-box.ts:232-235`, `super-pharm.ts:272-277`).
- **Not pinned:**
  - a missing `id`;
  - a 502, 410 or 3xx;
  - a timeout or a body that can't be read;
  - a challenge, a 429 or a 503 with Retry-After on the price path;
  - removed `oldPrice`, `lastLowestPrice` or `promotionTo`, which read as a regular price, by design;
  - a renamed or other `availability` (§2.6).
- **The detail fixtures are trimmed** to the fields the adapter reads (`rossmann-detail-reduced.json` is 182 bytes, `-regular.json` 89 bytes). So no test proves that a full real detail answer still parses.

#### 2.3 Natura and Hebe on the Luigi's Box client (`luigis-box.ts`, `natura.ts`, `hebe.ts`)

- **Shared shape:**
  - The name search and the EAN search are one function (`luigis-box.ts:112-152`).
  - Pinned prices go through `requestPrices` (`:159-171`) and the shared `checksOf` (`pinned-prices.ts:93-141`).
  - Natura's item type is `"product"` (`natura.ts:46`), Hebe's `"item"` (`hebe.ts:61`).
- **What counts as an item** (`isItemHit`, `luigis-box.ts:202-217`): an object whose `type` equals the shop's item type, or one whose `type` is missing or null and whose `attributes` is a non-empty object.
  - Everything else is skipped as a query suggestion: other `type` values, non-objects, and a hit with no `type` and no or empty attributes.
  - The only suggestion recorded is Hebe's `type: "query"` hit in `hebe-name-search.json`. Natura's suggestion `{url, attributes: {}}` in `natura.test.ts:241`, `:272` is made up.
- **D2 (search):** `itemHits` is filtered at `:128`, so the guard at `:146-150` only fires when at least one item hit failed its check.
  - An answer whose hits all read as suggestions returns `results: []` with no log line. That covers a renamed `type` with its attributes intact, and hits that lost both.
  - A lookup then asks the name search too and returns `not-found`, which is stored (`shop-matching.ts:88-89`, `:348`).
  - `natura.test.ts:269` pins this reading as intended ("finds nothing, and logs no drop, when the only hit is a query suggestion").
  - The worker's probes confirmed it for both shops: P1, P2 and P10, the last after two requests.
- **D3 (prices):** `requestPrices` drops non-item hits at `:170`, but computes `complete` from the raw hits and `total_hits` (`readHits`, `:259-267`).
  - `checksOf` counts only the item hits it was given as read or dropped (`pinned-prices.ts:101-113`). So an answer of N non-item hits with `total_hits` N reads as clear, and every asked id is stored as `missing` (`:131-141` → `prices.ts:71-72`), with no log line. Probes P4–P6 and P11 confirmed it; in P5 one good price came back and the other id was `missing`.
  - On the price path the request also filters by type (`f[]=type:…`, `luigis-box.ts:189`). So a catalog whose type was renamed would most likely answer 0 hits with `total_hits` 0. That can't be told apart from unknown ids by the answer's shape.
- **D4 (search counts):** the search ignores `complete` and `total_hits`. `hits: []` with `total_hits` 15 reads as "found nothing" (probe P7), and a lookup stores `not_found`. The price path does check its counts (`pinned-prices.ts:116-125`).
- **Pinned for both shops:**
  - a shop's own attributes on the recordings;
  - one odd hit;
  - all hits unreadable (search failed);
  - a string for a number;
  - an unreadable body and another JSON shape;
  - a 404 for an unknown tracker (`"tracker id rejected"`; Natura `:407`, `:827`; Hebe `:613`, `:905`);
  - a hit nobody asked for;
  - an incomplete answer;
  - an id left out of a clean answer, read as `missing`.

  Hebe also pins: the legal-name size, `searchable: [false]` items left out, odd `online_flag` values, and its `type: undefined` copy (`hebe.test.ts:580`).

- **Not pinned:**
  - **Natura has no broken-copies block.** Missing: a removed field on every hit, a removed `type` or attributes, a link where the SKU should be, an HTML page or an empty body, and every adapter-level refusal but 403, capped and stopped.
  - **Hebe's search has no refusal or HTTP-error test** at all.
  - No all-suggestion case for Hebe, no `next_page` key removed (probe P12: failed), and no adapter-level 429, 503 with Retry-After or challenge for either shop.
- **Mislabelled log:** every 404, a moved route's included, is logged as "tracker id rejected" (`luigis-box.ts:232-234`). The outcome, `failed`, is right.

#### 2.4 Super-Pharm on Algolia (`super-pharm.ts`)

- **Pinned** by broken copies, following §6.4 (`src/lib/services/shops/super-pharm.test.ts`):
  - every hit dropped (search failed: `:1281`) and some dropped (`:933`);
  - text for a number;
  - an unreadable regular price, 30-day low or promotion end, each with a log line;
  - availability flags other than 0/1;
  - HTML or an empty body, and no hits;
  - 400 (`:1328`, `:1728`), 403 (`:1360`, `:1675`) and 404 as "index rejected" (`:1342`, `:1746`);
  - capped, paused and stopped (`:1371`, `:1675`);
  - an incomplete price answer (`:1645`) and a hit nobody asked for (`:1632`);
  - 21 ids as requests of 20 and 1 (`:1435`).
- **D4 (search counts):** the search reads `answer.hits` and never `nbHits`, `page` or `nbPages` (`:118-150`).
  - So `hits: []` with `nbHits > 0`, a page other than 0, or no counts reads as "found nothing", and a lookup stores `not_found` (`shop-matching.ts:88-89`, `:348`).
  - The price path does check its counts (`:256-257`).
  - The real empty answer (`super-pharm-search-empty.json`) has `nbHits` 0 and `page` 0.
- **The 403** is pinned by the gate's own rule only, with a made-up empty body: any 403 is `blocked` (`shop-gate.ts:141`). Algolia's answer to a rejected key was never recorded.
  - A test can still pin both request kinds against Algolia's documented error body, labelled as documented rather than recorded.
  - It can also pin a lookup and a refresh that store nothing after a Super-Pharm 403.
- **Batches:** unit tests cover more than 20 ids (`:1435`, `:1675`, `:1713`, `:1790`). But every answer they read has at most 3 hits, and no test checks the 512-byte limit on `filters`. The test plan's "live batches untested beyond four ids" means live verification. Only an owner-approved recording of a 20-id request can close that.
- **Not pinned:**
  - a removed `objectID` on the price path;
  - an empty body or hits as an object on the price path;
  - `nbHits` below the hits held;
  - adapter-level 429, 503 with Retry-After, challenge, a `stopped` reservation on the price path, the counter unreachable, and a timeout.
- **Design questions, not defects:**
  - A search with some hits dropped still goes to `pickMatch`. So a dropped rival can turn a choice into an automatic match by name (`super-pharm.ts:130-149`, `shop-matching.ts:348-355`). Prices are stricter: after any dropped hit, every unanswered id is `unavailable` (`pinned-prices.ts:131-141`).
  - A `default` price sent in another unit, such as grosze, passes the positive-number check and the cap. `default_formated` ("28,99 zł") could cross-check it, and nothing does.

#### 2.5 What a changed answer stores today, summed up

| Adapter, request                 | Changed answer that stores a wrong fact                                               | Stored                                     | Defect               |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------- |
| Rossmann price                   | a 404 from a moved route                                                              | `missing` row per due item, refresh `done` | D1                   |
| Natura, Hebe search              | every hit with another `type` (attributes intact or lost)                             | `not_found` after a lookup                 | D2                   |
| Natura, Hebe prices              | every hit with another `type`, `total_hits` equal to the hits                         | `missing` row per asked id                 | D3                   |
| Natura, Hebe, Super-Pharm search | `hits: []` beside a count above 0 (`total_hits`, `nbHits`), or Algolia without counts | `not_found` after a lookup                 | D4                   |
| Rossmann search                  | every item fails its check                                                            | nothing stored; „Brak wyników” shown       | D5                   |
| any shop                         | an index or catalog that still answers but is empty or re-keyed                       | `not_found` and `missing`                  | none: needs a canary |

Every other changed answer that the workers traced becomes `unavailable/failed` or costs only the one value.

#### 2.6 Silent value changes

These store a plausible but wrong value, with no log line:

- **Hebe's sale price:** if `price_sale_amount` is renamed or removed, the item reads as not on sale, and its regular price is stored as the current one (`hebe.ts:146-149`; probe P9 gave 27.49 instead of 18.89). The search could cross-check the `price_sale` text. The price request can't, because its `hit_fields` doesn't ask for it.
- **Availability:**
  - Rossmann reads `availability === "available"` (`rossmann.ts:185`), so a renamed field stores every price as not orderable.
  - Natura reads `availability` other than the number 1 as not orderable, with no `hasOddAvailability` (probe P8). Hebe and Super-Pharm log odd flags.
- **Unreadable optional prices:** Natura's `price_old_amount` and `lowest_price`, and Hebe's `price_omnibus_amount`, are dropped without a log line. Super-Pharm logs them.

### 3. Risk #3: refusals on every path

| Path                                                          | After a refusal                                                                                                          | Pinned through the real gate                                                                                                                                                                                                                | Not pinned                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| List search (`watchlist.astro:43-48` → `searchRossmann`)      | one call, `unavailable`, nothing stored                                                                                  | adapter level: capped, paused, stopped, a null counter, 403, 429 (`rossmann.test.ts:257-330`); the page's decision (`search-query.test.ts`, Phase 2)                                                                                        | challenge, 503 with Retry-After, timeout at adapter level                                                                       |
| First lookup (`lookupInShop`, `runMatchSteps`), and `?retry=` | either search's `unavailable` returns at once (`shop-matching.ts:67-69`, `:79-81`); nothing stored (`:375-377`)          | Natura EAN 403 and 500, one request (`shop-matching.test.ts:125-133`); unreadable hits (`:135-146`); Super-Pharm 500 (`:696-704`); one shop failing beside others (`:902-977`, `:979-1031`)                                                 | **a refused or failed name search after an EAN miss** (Natura, Hebe); 429, capped, paused, stopped in a lookup; a refused retry |
| Re-pin choice (`lookupChoicesInShop`)                         | EAN `unavailable` returns; a refused name search marks the EAN candidates incomplete, or returns `unavailable`           | the strongest: EAN 403, 429, 500, network, one request (`:311-322`); capped, no request (`:324-331`); name 403 or 500 (`:333-372`)                                                                                                          | challenge, 503 with Retry-After                                                                                                 |
| Island → `/api/watchlist/prices`                              | one request; `unavailable`; nothing stored                                                                               | stopped and 403 with counts (`price-routes.test.ts:282-302`, Phase 2)                                                                                                                                                                       | 429, capped, paused                                                                                                             |
| Refresh form and list (`refreshPrices`)                       | later items get the refusal with no reservation (`price-refresh.ts:86-105`; `pinned-prices.ts:71-86`); other shops go on | Rossmann capped, paused, 403 (`price-refresh.test.ts:368-421`); Hebe 403 stops only Hebe (`:682-705`); Natura capped (`:707-726`); per-adapter batch refusals (Natura, Hebe, Super-Pharm); the route's 403 (`price-routes.test.ts:374-393`) | 429, a challenge or a 503 with Retry-After mid-loop; a `stopped` reservation mid-Rossmann-loop                                  |

- **Request counting** (verifies the challenge "a request counted is a request sent"):
  - A request is never sent uncounted. The one send follows an `allowed` reservation in the same call (`shop-gate.ts:101-133`), redirects aren't followed, and ESLint's `serverFetchConfig` refuses a direct `fetch` in server code.
  - Over-counting is the safe direction, and happens in two cases:
    - a reservation committed after the gate's 2 s counter timeout, which the gate reads as `skipped/unavailable`;
    - a send that fails before anything leaves.
- **Lint gaps:** the rule doesn't cover `src/components/**/*.tsx`. Islands render on the server too, though their only fetch runs in the browser. An alias such as `const g = globalThis; g.fetch(…)` evades it.
- **Plain failures don't stop a loop:**
  - `isRefusal` is false for `failed` (`shop-outcome.ts:10-12`), so a 5xx or a timeout makes a refresh ask every due item, up to the cap. A hanging Rossmann could cost about 30 requests of up to 5 s each in one list refresh. The research note §7 says to back off on 5xx.
  - The counter unreachable is `failed` too, so the loops call the reservation RPC again for each remaining item, with no shop request sent.
- **What `scripts/check-shop-gate-db.mjs` proves:**
  - the cap, sequentially and with 40 at once;
  - anon's refusals;
  - the shop tables refusing a user's direct writes;
  - a `rate_limited` report pausing about 120 s;
  - a `blocked` report stopping;
  - an unknown shop.
- **What it doesn't prove:** that a refused reservation inserts no row; the 900 s default and the 1–86400 s clamp; that a longer pause is never shortened; that a pause expires.

### 4. Fixtures and their provenance

- **Rossmann:**
  - search: `rossmann-search-results.json`, `-misspelled`, `-empty` (2026-09-27);
  - the five 2026-10-06 searches, used as watched products in other shops' tests;
  - detail: `rossmann-detail-reduced.json`, `-regular`, `-unknown` (2026-09-28; trimmed).
  - `rossmann.test.ts`'s header names no request or date per fixture, as §6.4 asks.
- **Natura:**
  - `natura-ean-hit.json`, `-ean-miss`, `-name-search`, `-unknown-tracker` (2026-09-27);
  - `natura-sku.json`, `-skus`, `-sku-unknown` (2026-09-28);
  - `natura-search-nivea-soft.json` (2026-10-06, cut to 5 hits).
  - Its header dates only one of its eight fixtures.
- **Hebe:**
  - `hebe-ean-offline.json`, `-name-search`, `-ids`, `-id-unknown` (2026-10-02);
  - `hebe-ean-online.json` (2026-10-04);
  - `hebe-search-aa-laab.json` (2026-10-06, kept whole).
- **Super-Pharm:**
  - 2026-10-05:
    - `super-pharm-name-search.json`;
    - the price recordings `-pinned.json` (query rules on) and `-pinned-rules-off.json`, the only one sent with the current body;
    - the probes `-name-search-one`, `-search-empty` and `-pinned-one`.
  - 2026-10-06: the seven `super-pharm-lookup-*.json`, kept whole.
- **"The recording is the shop's contract"** (the test plan's challenge) holds partly. The recordings are real and dated, and §6.4's broken copies change one thing each. But a recording shows one day's answer, and two of them already contradicted the research note:
  - `fallbackName`, and the unknown tracker's 404 text/plain (`context/archive/2026-09-27-watchlist-add-by-search/plan.md:544-549`);
  - Super-Pharm's sale without its regular price (research note §2.3).

### 5. The test plan's guidance, verified

- **"A 404 means gone"** (risk #5 challenge): confirmed as a live defect for Rossmann's price (D1). The Luigi's Box client and Super-Pharm read every 404 as `failed`.
- **"An empty answer means nothing found"**:
  - Confirmed for D4, where the counts say otherwise and are ignored.
  - Confirmed for D2 and D3, where the hits aren't empty but are all read as suggestions.
  - Partly inherent for an index or a type filter that answers a clean 0. No answer-shape check can tell that from a real empty result.
- **"The recording is the shop's contract"**: see §4.
- **Follow-up (S-05), the query-suggestion reading:** confirmed, and wider than the follow-up says. A renamed `type` with attributes intact triggers it, not only a hit that lost both. It reaches the price path too, where it stores `missing` (D3), not only the search (D2).
- **Follow-up (S-06), Super-Pharm's 403 and live batches:** confirmed as stated (§2.4). A test can pin the 403's outcome and storage with a documented, labelled body. A recording needs the owner's approval for a live request.
- **Follow-up (S-05), broken copies for Rossmann and Natura:** confirmed missing for Natura. Rossmann has copies that change values but none that removes a field.
- **Risk #3, "every shop call goes through the gate"**: holds for server code (§3), with the two lint gaps named there.
- **Risk #3, "a request counted is a request sent"**: holds in the safe direction.
- **Cheapest layer for risk #5**: "contract tests on deliberately broken copies of the recordings" is confirmed as the test layer. But D1–D5 need production fixes first, since a test written against today's code would pin the defects. D1 also needs the gate to carry a 404's content type.
- **Cheapest layer for risk #3**: "integration through the real gate, counting the URLs the replay served" is confirmed. What remains is per-path refusal kinds beyond 403 and capped, each a short test in an existing file.

## Code References

- `src/lib/services/shop-gate.ts:101-158` — reservation, send, refusal classes, the discarded body of a non-2xx
- `src/lib/services/shops/shop-outcome.ts:10-34` — `isRefusal` and `gateUnavailable`
- `src/lib/services/shops/rossmann.ts:39-41`, `:62-87`, `:95-125`, `:185` — the search schema, search, price (404 → missing at `:105-107`), availability
- `src/lib/services/shops/luigis-box.ts:112-152`, `:159-171`, `:202-217`, `:232-235`, `:255-268` — search, price request, `isItemHit`, 404 handling, `readHits` and `complete`
- `src/lib/services/shops/pinned-prices.ts:71-86`, `:93-141` — the stop after a refusal, and when an id is `missing`
- `src/lib/services/shops/super-pharm.ts:118-150`, `:242-259`, `:272-277` — search, price request with its counts, 404 as "index rejected"
- `src/lib/services/shops/natura.ts:46`, `src/lib/services/shops/hebe.ts:61`, `:146-149`, `:160-163` — item types, Hebe's sale price and odd availability
- `src/lib/services/shop-matching.ts:62-90`, `:103-149`, `:338-379` — lookup, re-pin choice, what a lookup stores
- `src/lib/services/matches.ts:272-283` — `recordLookup`
- `src/lib/services/price-refresh.ts:86-105`, `:162-172` — Rossmann's loop and the refresh code
- `src/lib/services/prices.ts:57-75` — which checks become rows

## Architecture Insights

- **One translation layer, two adapter styles.** Every adapter maps the gate's outcome through `gateUnavailable`. Each adapter, though, decides on its own what an unreadable or empty answer means: the Luigi's Box client and Super-Pharm share `pinned-prices.ts` for prices, but their search guards are separate copies. D4 and D5 are where those copies diverge.
- **"Missing" and "not found" are stored facts, shared or durable.** A `missing` observation is shared by every watcher of the item, and a `not_found` decision stays until a retry. So the lesson "Never read an unreadable answer as missing" applies to every branch that produces them: an empty search, a clean but empty price answer, and Rossmann's 404.
- **The gate discards a non-2xx answer's body by design**, so the log can't echo a search. An adapter that needs to tell two answers with the same status apart, as D1 does, has no way to do so today.
- **The price path is stricter than the search path.** Prices need a complete answer with every hit read before any id is `missing`. Searches accept partial or empty answers as results. Most of D2–D5 are that asymmetry.

## Historical Context (from prior changes)

- `context/archive/2026-09-27-shop-matching-first-two-shops/reviews/impl-review.md` F2: "A Luigi's Box format change would be stored as 'not found'". Fixed then by counting dropped hits and failing when hits came back but none survived; "Pseudo-hits don't count". D2 is the case that fix left open.
- `context/archive/2026-09-27-watchlist-add-by-search/plan.md:544-549`: what the recordings showed against the research note (`fallbackName`; an unknown tracker answers 404 text/plain, not an empty result).
- `context/archive/2026-10-02-hebe-in-comparison/`: the broken-copies pattern (§6.4). Rossmann's and Natura's copies were left to this phase, as the test plan's §6.6 records.
- `context/archive/2026-10-04-super-pharm-in-comparison/`: Algolia's rejected-key 403 never recorded; the 400 for an expired secured key is the test's claim, never recorded.
- `context/archive/2026-09-26-polite-shop-access/reviews/impl-review.md` F2: the accepted direct-call stop. Any signed-in user can reserve or report a block through the RPCs.
- `context/archive/2026-10-07-testing-route-and-database-seams/`:
  - the price routes through the real gate;
  - `SHOP_HOSTS` narrowed;
  - the fetch lint rule;
  - the request log's mark can't show an attempt on a stopped shop.

## Related Research

- `context/archive/2026-10-07-testing-route-and-database-seams/research.md` — risk #3's routes and pages (Phase 2).
- `docs/research/polish-drugstore-price-apis.md` — §2.1, §2.2, §2.3, §2.5, §7 and Appendix C (dead ends that answer 404).

## Corrections to the test plan's §2 (backport candidates)

- **Risk #5, "Must challenge":** "a 404 means gone" is a live defect for one shop, not only an assumption to challenge.
- **Risk #5, likely cheapest layer:** broken copies stay the test. But the phase also needs small production guards, and a gate change for D1, before the copies can pass for the right reason. One case belongs to monitoring, not tests: a catalog or index that still answers but empty.
- **§6.6 follow-up (S-05):** a renamed `type` triggers the suggestion reading too, and so does the price path.

## Open Questions

These are the owner's to decide. Each one changes what the tests should expect.

1. **D1, Rossmann's 404:** when is a 404 "the product is gone"?
   - Options:
     - only an RFC 9110 problem+json 404, which needs the gate to keep a 404's content type;
     - also check the problem body's `status`;
     - accept the risk.
   - A live request to an unknown route, with the owner's OK, would show what a moved route's 404 looks like. It was never recorded.
2. **D2 and D3, what counts as a query suggestion:** only `type: "query"`, the one recorded? Then any other non-item hit counts as dropped: a search with no item fails, and a price answer with one isn't clear. Or keep today's wider reading?
3. **D4, an empty search beside a count above 0:** fail it (as the price path does), or accept it?
4. **D5:** make Rossmann's search fail when every item fails its check, like the other adapters, and check `totalCount` against `items`?
5. **Silent values (§2.6):** add log lines for Natura's and Rossmann's availability and the unreadable optional prices, and cross-check Hebe's sale price on the search? Or record them as accepted?
6. **Super-Pharm design questions:**
   - auto-accepting by name after a dropped rival;
   - cross-checking the price against `default_formated`.
7. **Recordings needing live requests:**
   - Algolia's rejected-key 403;
   - a 20-id Super-Pharm price batch;
   - a Rossmann unknown-route 404.

   Record them with the owner's OK, or pin the 403 with Algolia's documented body?

8. **Risk #3 scope:**
   - add per-path tests for 429, challenge and 503 with Retry-After;
   - a lookup whose name search is refused after an EAN miss;
   - Hebe's search refusals.

   Should plain failures (5xx, timeout) and an unreachable counter stop a loop, as research note §7 suggests, or keep going as now?

9. **Out of this phase's tests:** a canary for an empty-but-answering index and a renamed type on the filtered price request (monitoring), and the database check's unproven gate rules (§3).
