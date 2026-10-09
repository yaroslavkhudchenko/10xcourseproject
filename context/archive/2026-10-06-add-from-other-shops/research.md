---
date: 2026-10-06T12:00:43+02:00
researcher: Claude (claude-opus-5-5)
git_commit: ded1b6d603357d5fc030fd72e8383d76b407aa00
branch: feat/add-from-other-shops
repository: yaroslavkhudchenko/10xcourseproject
topic: "add-from-other-shops: a product search that asks Rossmann, Natura, Hebe and Super-Pharm and shows, for each product found, which shops have it: what the code has today, what the shops' searches can and can't tell, and what adding a product from a shop other than Rossmann touches"
tags: [research, codebase, search, shop-adapters, matching, product-identity, watchlist, shop-gate, request-costs]
status: complete
last_updated: 2026-10-06
last_updated_by: Claude (claude-opus-5-5)
---

# Research: a product search across all four shops (add-from-other-shops)

**Date**: 2026-10-06T12:00:43+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: ded1b6d603357d5fc030fd72e8383d76b407aa00 (`main` at PR #30's merge; this change's folder isn't committed yet)
**Branch**: feat/add-from-other-shops
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

The owner's words (2026-10-06): "I need the search to return results from all shops so like if nivea smth is only in superfarm it returns it and the rest of the shops shows that it is missing there or if like 2 of them there like hebe and rossmann it gives both or like if none its none".

Read as four requirements:

1. One search asks Rossmann, Natura, Hebe and Super-Pharm.
2. A product found in one shop is shown, and the other shops are shown as not having it.
3. A product found in two shops (the example: Hebe and Rossmann) is shown with both.
4. A search that finds nothing anywhere shows nothing.

The change's purpose (`change.md`) adds a fifth: a product found only outside Rossmann can be added to the watchlist and compared like any other.

This research covers:

- what the search and "Dodaj" do today;
- what each shop's existing search returns and costs;
- what a search can and can't say about a shop not having a product;
- what the existing rules can conclude about two shops' hits being the same product;
- what the database and the app allow for a product from a shop other than Rossmann;
- the earlier decisions this change reverses.

It chooses no design: the choices are listed under Open Questions.

**Method.** Four read-only investigations ran in parallel:

1. the search pipeline and the shop adapters;
2. the database and the add route;
3. the places that take Rossmann as the product's shop;
4. earlier decisions and evidence for telling products apart.

The decisive lines were then read directly. No shop request, build or test ran for this research. The five live Super-Pharm searches cited below ran earlier the same day, with the owner's approval, while diagnosing the phone check; `change.md` records them.

## Summary

1. **Today one search is one Rossmann request.** `src/pages/watchlist.astro:46` calls `searchRossmann` and no other shop search. The page awaits it in one `Promise.all` with the list's three database reads before it renders (`:45-50`). "Dodaj" accepts a Rossmann product and refuses any other (`src/lib/services/watchlist.ts:44-54`).

2. **Natura, Hebe and Super-Pharm already have a name search the list could call.** It's `search(gate, query, size)` in `SHOP_ADAPTERS` (`src/lib/services/shops/registry.ts:26-64`):
   - one gate request per call, first page only;
   - it returns `ShopCandidate`s, each with an offer: price, regular price, 30-day low and whether it's orderable online (`src/types.ts:156-171`);
   - the list's validated `q` is valid input for it.

   Calling each shop's search once costs 4 shop requests per search: one slot of each shop's own cap (30 a minute by default), where today's search costs 1.

3. **A search result can't establish that a shop doesn't sell a product.** On the code and recordings inspected:
   - **A name search returns a slice of a shop's hits.** Hebe's recorded „nivea soft” reports 58 hits in total (`fixtures/hebe-name-search.json`). Super-Pharm's „NIVEA krem” reports 134 over 14 pages (`fixtures/super-pharm-name-search.json`). The matching code asks for 10 per name search (`src/lib/services/shop-matching.ts:46`).
   - **Super-Pharm's search seldom answers with nothing.** It drops words it can't match: „NIVEA Derma Control Clinical 150 ml” returned 1,811 hits in the earlier live search (`change.md`).
   - **Hebe's adapter leaves out items Hebe doesn't sell online** (`src/lib/services/shops/hebe.ts:41-56`). That "not found" means "not orderable online at Hebe".
   - **An unreadable answer must read as "couldn't ask"** (`context/foundation/lessons.md:19-24`). Rossmann's search breaks this today: it returns an empty result, with no log line, when every item in its answer fails its checks (`src/lib/services/shops/rossmann.ts:77-87`). Natura, Hebe and Super-Pharm return `unavailable/failed` in that case (`src/lib/services/shops/luigis-box.ts:146-150`, `src/lib/services/shops/super-pharm.ts:142-144`).

   On this evidence, a search can truthfully say one of three things per shop: "found in this search", "not found in this search" or "couldn't ask". In the inspected code, a stronger check exists only on the product page. There a Natura or Hebe lookup searches by the product's EAN (when it has one), then by its name. It stores "not found" only when those searches answered and found nothing (`shop-matching.ts:63-91`). Rossmann's and Super-Pharm's searches can't find an EAN at all (research note §2.1; `fixtures/super-pharm-search-empty.json`).

4. **No existing rule groups hits from different shops into one product.** The only same-product rule compares one watched product with one shop's candidates (`src/lib/services/matching.ts:64-98`). It accepts a candidate only when the candidate:
   - shares an EAN with the product;
   - has the same size (same unit, within 0.1 %);
   - has a brand that doesn't differ.

   No inspected module compares two shops' hits with each other: `matching.ts` and `shop-matching.ts` compare one product with one shop's list. Applied pairwise across shops, the same rule would:
   - put together Rossmann, Natura and Hebe hits that meet it. Recorded case: Nivea Soft 300 ml, EAN 4005900009319, at Rossmann and Natura; Hebe lists that product but doesn't sell it online;
   - keep apart a shared EAN with another size. Recorded case: Hebe's 5,5 ml lip balm and Rossmann's 4,8 g one;
   - keep apart every Super-Pharm hit, since the Super-Pharm adapter sets `eans: []` on every candidate (`super-pharm.ts:321`). A product sold at Super-Pharm and elsewhere would show once per source.

   The owner declined name comparison for Hebe (`context/archive/2026-10-02-hebe-in-comparison/plan.md:84`). They also declined automatic Super-Pharm matches by name similarity or by EANs read from its product pages (`context/changes/super-pharm-in-comparison/plan.md:94`). Grouping Super-Pharm hits automatically would reverse those calls.

5. **The database already accepts a product from any of the four shops; the app doesn't.**
   - **Database:** `watchlist_items.source` references `public.shops (id)` with no other check. Item ids and links are checked by one pattern for every shop. The price watchers' RLS reads a product's own item in any shop (§6).
   - **What refuses such a product:** "Dodaj"'s schema.
   - **What gives it no own price or link:** the eight places in §7 that take the product's own shop to be Rossmann.
   - **What matches it like a Rossmann product:** the places in §8 that give every product the same matched shops (`MATCHED_SHOPS` = Natura, Hebe, Super-Pharm). So a product picked at Natura would:
     - be looked up in Natura itself and never in Rossmann (`shop-matching.ts:272-277`);
     - stay in „Do sprawdzenia” with „Natura: do dopasowania” on its row (`src/lib/services/watchlist-rows.ts:155-207`).
   - **Rossmann can't be a matched shop today (§9):**
     - it has no `SHOP_ADAPTERS` entry;
     - its id check isn't exported;
     - its search returns `ProductCandidate`s without an offer and takes no size;
     - it has no EAN search;
     - neither match mode fits it.
   - **Already generic:** the comparison, the refresh, the price storage, the matching rule, the cards and the row tags work for any shop (§8, last list).

6. **A product picked at Super-Pharm would carry no EAN.** No shop could then be matched to it automatically, and the other shops' lookups would search by its name only (`shop-matching.ts:152-162`). US-02's "Given … a product (EAN fixed)" (`context/foundation/prd.md:68`) wouldn't hold for it.

7. **The same product added from two shops would be two list entries.** The unique key is `(user_id, source, source_item_id)` (`supabase/migrations/20260927145051_watchlist_items.sql:22`). The results' „Na liście” is decided per shop item (`src/components/watchlist/SearchResults.astro:30`).

8. **Earlier decisions this change reverses.**
   - S-01 put "No other search source: no Natura or other shop, no fallback and no merged results" out of scope (`context/archive/2026-09-27-watchlist-add-by-search/plan.md:70`).
   - It chose Rossmann as "the research note's name-and-size resolver, with no key read from a shop page" (`…/plan-brief.md:26`). The second half no longer applies: the Natura and Hebe trackers and Super-Pharm's key are constants in the code (S-02, S-05, S-06).
   - It accepted "Search is down whenever Rossmann is paused, stopped or capped" (`…/plan-brief.md:89`). A four-shop search would soften that.
   - The inspected documents show no evaluation of Natura, Hebe or Super-Pharm as a search source on its merits.

## Detailed Findings

### 1. The search today

- **Input.** `q` comes from the address (`src/pages/watchlist.astro:33-34`). `searchQuerySchema` (`src/lib/services/search-query.ts:29-32`) trims it and collapses spaces, then requires 2-80 characters from a fixed set: letters, digits, spaces and `. , % & ' + / ( ) -`. An invalid query shows an alert and asks no shop (`watchlist.astro:100-106`).
- **Own navigation only.** `isOwnNavigation` (`search-query.ts:19`) refuses a prefetch (`Sec-Purpose` or `Purpose`) and a `Sec-Fetch-Site` other than `same-origin` or `none`. Then the page asks „Naciśnij „Szukaj”…” and no shop is asked (`watchlist.astro:41,107-111`).
- **Call and render.** `searchRossmann(shopGateFor(supabase), query)` runs inside one `Promise.all` with `listWatchlist`, `listMatchStates` and `listLatestPrices` (`watchlist.astro:45-50`), so the page renders once all four have settled. Its outcomes:
  - `unavailable`: a warning from `shopUnavailableText(SHOP_LABELS.rossmann.name, …)` (`:52-53,112-116`).
  - `results`: rendered by `SearchResults` (`:117-125`).
- **Results view** (`SearchResults.astro` on `main`):
  - **Rows.** Each result is drawn by `rowProductOf` (`watchlist-rows.ts:138`): a thumbnail, a „brand · size” line, then the name and caption. A row shows no price, no EAN and no shop name.
  - **Action.** A result already on the list shows „Na liście”, keyed `source:sourceItemId` (`:30-31`). Any other result has a POST form to `/api/watchlist` with hidden `source`, `sourceItemId`, `name`, `brand`, `caption`, `sizeText`, `productUrl`, `imageUrl`, and one `eans` field per EAN.
  - **Footer.** It names rossmann.pl.
  - PR #31 (`fix/search-names-rossmann`, not on this branch) renames the heading to „Wyniki z Rossmanna”, makes the field's placeholder „Szukaj w Rossmannie”, and makes the empty result name Rossmann.
- **Add route** (`src/pages/api/watchlist.ts:15-41`). It reads the form behind a guard and calls `parseWatchlistForm`, then `addToWatchlist`. Outcomes:
  - `exists` goes to `/watchlist?exists=1`;
  - an invalid form, a failure or a missing Supabase goes back with `?error=…`;
  - success opens `/watchlist/<id>`.

  The route asks no shop.

- **The add schema** (`watchlistAddSchema`, `watchlist.ts:44-54`):
  - `source: z.literal("rossmann")`;
  - `sourceItemId` must be 1-12 digits;
  - the product URL and image must pass `isRossmannProductUrl` and `isRossmannImage` (`rossmann.ts:128-145`).

  The insert is at `:109-142`, and a 23505 on the unique key reads as `exists` (`:130-132`).

- **Reload.** Every signed-in response is `private, no-store` (`src/middleware.ts:39-41`), so reloading `/watchlist?q=…` searches again.

### 2. What each shop's search returns

| Shop        | Search                                                                                   | Request per call                                                                                | Hits per call                | Own timeout               | Finds by EAN                                                                     | Returns                                                              | Price per candidate                                   | Answer whose hits all fail their checks           |
| ----------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Rossmann    | `searchRossmann(gate, query)` (`rossmann.ts:62-87`)                                      | 1 GET `www.rossmann.pl/products/v4/api/Products?search=…&page=1&pageSize=24`                    | 24, fixed (`rossmann.ts:17`) | 5 s (`rossmann.ts:19`)    | no: an EAN query returns 0 items (research note §2.1)                            | `ProductCandidate` (`types.ts:38-52`), plus Rossmann's spelling hint | no: `itemSchema` reads no price (`rossmann.ts:27-38`) | `results` with `[]`, no log (`rossmann.ts:77-87`) |
| Natura      | `searchNatura(gate, query, size)` (`natura.ts:63-65`, client in `luigis-box.ts:112-152`) | 1 GET `live.luigisbox.com/search?tracker_id=703598-939363&q=…&size=…`                           | `size`                       | 4 s (`luigis-box.ts:24`)  | yes, through the same call (research note §2.5)                                  | `ShopCandidate`                                                      | yes                                                   | `unavailable/failed` (`luigis-box.ts:146-150`)    |
| Hebe        | `searchHebe(gate, query, size)` (`hebe.ts:78-80`, same client)                           | 1 GET, same host, tracker `421168-505233`                                                       | `size`                       | 4 s                       | yes (research note §2.2)                                                         | `ShopCandidate`                                                      | yes: the sale price while one runs                    | `unavailable/failed` (same client)                |
| Super-Pharm | `searchSuperPharm(gate, query, size)` (`super-pharm.ts:114-146`)                         | 1 POST to Algolia's query URL for `spprod_drugstore_pl_simple_products`, parameters in the body | `hitsPerPage` = `size`       | 4 s (`super-pharm.ts:39`) | no: the index has no EAN, and the adapter sets `eans: []` (`super-pharm.ts:321`) | `ShopCandidate`                                                      | yes                                                   | `unavailable/failed` (`super-pharm.ts:142-144`)   |

- **What each search keeps:**
  - **Natura:** `type: "product"` hits with a SKU, a positive price and a title (`natura.ts:26-41,90-100`).
  - **Hebe:** `type: "item"` hits whose `searchable` is `[true]`. An item with `searchable: [false]`, listed but not sold online, is left out, and any other value makes the hit unreadable (`hebe.ts:41-56`).
  - **Super-Pharm:** readable hits. Its searches send no `enableRules=false`, so Super-Pharm's query rules apply to them (`super-pharm.ts:182-208`). Only its price requests turn the rules off (research note §2.3).
- **Spelling hint.** Of the four adapters, only Rossmann's returns one (`rossmann.ts:82-86`). Luigi's Box answers carry `corrected_query`, which `luigis-box.ts` doesn't read; it's null in the recordings (`fixtures/natura-ean-hit.json:4`).
- **Two result shapes.**
  - `ShopCandidate` has `shop`, `shopItemId` and `offer`, and no `caption`.
  - `ProductCandidate` has `source`, `sourceItemId` and `caption`, and no offer (`types.ts:38-52,156-171`).
  - The results view and "Dodaj" take `ProductCandidate` only (`SearchResults.astro:17`).
- **Recorded answer sizes.** These are fixture files as stored, which may have been cut, not measured live:
  - Natura's 3-hit name search: 81,142 bytes;
  - Hebe's name search, 5 hits, one of them a query suggestion: 41,193 bytes. Luigi's Box searches send no `hit_fields`, so every hit comes whole;
  - Super-Pharm's 5-hit name search: 4,061 bytes. The adapter retrieves only the attributes it maps;
  - Rossmann's 5-item search: 46,285 bytes.
- **How the product page calls these searches today:**
  - EAN searches ask for 5 hits and name searches for 10 (`shop-matching.ts:45-46`).
  - `lookupInShop` runs the name search only when the EAN search finds nothing (`shop-matching.ts:63-91`).
  - The name query is the product's brand, name and size text, cut to 80 characters at a word (`nameQuery` at `shop-matching.ts:160-162`, `toShopQuery` at `search-query.ts:39-45`).

### 3. The gate, and what a four-shop search costs

- **Outcomes.** `gate.fetch(shop, url, init)` returns one of (`types.ts:18-23`):
  - `ok`;
  - `skipped`, when capped, paused, stopped or unavailable;
  - `rate-limited`;
  - `blocked`;
  - `failed`.
- **Other gate rules:**
  - it throws, before reserving anything, for a URL whose host isn't in `SHOP_HOSTS[shop]` (`src/lib/services/shop-gate.ts:9-14,86-92`);
  - it never follows a redirect (`:127`);
  - its 8 s timeout covers the body too (`:18`);
  - a reservation is an RPC on the signed-in user's client, with a 2 s timeout (`:23`). Without that client, every call is skipped as `unavailable`.
- **Cap.** `reserve_shop_request` counts the shop's requests in the last 60 s against `cap_per_minute`: 30 by default, within 1-60 (`supabase/migrations/20260926112205_polite_shop_access.sql:9,48-84`). The count is per shop id, so Natura and Hebe each have their own cap although both use `live.luigisbox.com`.
- **Refusals.**
  - A 403 or a bot challenge stops the shop for every user until the owner switches it back on.
  - A 429, or a 503 with Retry-After, pauses it (`shop-gate.ts:136-150,217-231`).

  A four-shop search sends the user's text to four shops instead of one, under the same `searchQuerySchema` (`search-query.ts:3-8`).

- **Cost per search, as the code stands:**
  - today: 1 Rossmann request and 1 reservation RPC, plus 1 report RPC after a refusal;
  - with each shop's existing search called once: 4 shop requests (Rossmann GET, Natura GET, Hebe GET, Super-Pharm POST) and 4 reservation RPCs, one slot of each shop's cap.

  A reload repeats it, since the page isn't cached.

- **Concurrency and waiting.** On the Workers Paid plan, 6 connections may wait for headers at once and a seventh queues (Cloudflare's limits page, quoted in `context/archive/2026-09-28-cheapest-shop-today/research.md:247-252`). Today the page runs 3 database reads beside the search (`watchlist.astro:45-50`). With four shops, each making a reservation then its search, a server-rendered page waits for the slowest shop. Each adapter's own timer, 4 s for Natura, Hebe and Super-Pharm and 5 s for Rossmann, starts when it calls the gate, before the reservation. The gate joins that timer to its own 8 s one for the request (`shop-gate.ts:98-128`). So one shop holds the page up for at most about its own 4-5 s.
- **After "Dodaj", unchanged.** The product page's lookups keep their own costs:
  - Natura and Hebe: up to 2 requests each, on the user's own navigation (`context/archive/2026-10-02-hebe-in-comparison/plan.md:111-124`);
  - Super-Pharm: 1 per tap of its button (`context/changes/super-pharm-in-comparison/plan.md:721-733`).
- **The plan must state these costs.** `lessons.md:12-17` asks the plan to state each view's and action's cost per shop, to send one request at a time per shop, and to stop asking a shop once it refuses.

### 4. What "not there" can mean for each shop

- **"Couldn't ask."** A shop that is busy, paused, stopped or failing answers `unavailable` with its reason (`src/lib/services/shops/shop-outcome.ts:15-34`). The list must show that as a gap, never as "not there" (`lessons.md:19-24`).
- **Rossmann's unreadable answer.** It reads today as "found nothing" (`rossmann.ts:77-87`). The three other searches treat it as a failure, each with the comment that a format change must not read as "not found" (`luigis-box.ts:146-150`, `super-pharm.ts:140-144`).
- **"Not found in this search."** A name search answers with the first `size` hits of a shop's ranking. On the recorded queries:
  - **Hebe:** „nivea soft” has 58 hits (`fixtures/hebe-name-search.json`).
  - **Super-Pharm:** „NIVEA krem” has 134 (`fixtures/super-pharm-name-search.json`).
  - **Natura:** „nivea soft 300 ml” returned a YOPE shampoo of 300 ml and Nivea MEN 500 ml beside the Nivea Soft item (`fixtures/natura-name-search.json:752-830,1316-1391`).

  So a product another shop found may sit lower in this shop's ranking, or under other words, and still be sold there. The text a shop's search was given also decides what it finds: the owner's pasted Super-Pharm name found nothing at Rossmann (`change.md`).

- **Hebe's "not found" is narrower.** It covers items Hebe doesn't sell online, which its adapter leaves out by design (`hebe.ts:41-56`, research note §2.2), consistent with the app's online-only scope.
- **The strongest check in the inspected code** is the product page's lookup in Natura or Hebe. It searches by the product's first EAN, when the product has one, then by name. It stores `not_found` only when those searches answered and found nothing (`shop-matching.ts:63-91,152-162`). Neither Rossmann nor Super-Pharm can be searched by EAN.

### 5. Telling two shops' hits apart as one product

- **Identifiers per shop.**
  - **Rossmann:** `eanNumber[]` becomes `eans`, 8-14 digits each, at most 10 (`rossmann.ts:217-219`). Several per product are common: 26900 has 3 and 11790 has 4 (`fixtures/rossmann-search-results.json:420,773`).
  - **Natura:** `ean[]` (`src/lib/services/shops/natura.ts:110`), one per hit in every recording.
  - **Hebe:** `EAN[]` (`hebe.ts:126`), one per hit in every recording.
  - **Super-Pharm:** no EAN in any of the 5 recordings, including a hit recorded with all its attributes (`fixtures/super-pharm-name-search-one.json`). Its `gtin13` exists only on product pages (research note §2.3), which the app doesn't read.
- **Sizes per shop.**
  - Rossmann: `unit`.
  - Natura: `size` plus `size_unit`.
  - Hebe: the size its legal name ends with, never `Pojemność` (`hebe.ts:111-116,178-183`).
  - Super-Pharm: `capacity`.

  All are parsed by `parseSize` (`src/lib/services/size.ts`). A multipack such as „4x57 szt.” parses to no size (`src/lib/services/size.test.ts:21`).

- **The rule** (`matching.ts`):
  - **Signals.** `judge` (`:64`) gives three: shares an EAN; size equal, different or unknown, where only the same unit within 0.1 % is equal (`:25-27`); and brand agrees, differs or unknown, decided by `brandsAgree` (`:51`).
  - **Acceptance.** `pickMatch` (`:80-98`) accepts a candidate only when exactly one shares an EAN with an equal size and a brand that doesn't differ. Otherwise it offers up to 3, in this order: those sharing an EAN, then same-size look-alikes, then the rest.
  - **No "different product".** `matchDifferences` (`:113`) flags a definite size or brand difference, and the candidate is still offered. In `matching.ts`, the rule either accepts a candidate as the same product or leaves the choice to the user. It has no "different product" outcome.
- **Recorded cases across shops.** All the search recordings are Nivea queries, and they hold two cross-shop cases.
  - **Nivea Soft 300 ml:**
    - Rossmann 26900: EANs 4005900009319, 4005808890637 and 5900017001234, "300 ml" (`fixtures/rossmann-search-results.json:410-422`).
    - Natura NV89063: EAN 4005900009319, 300 ml (`fixtures/natura-ean-hit.json:61,99`).
    - Hebe 251798: EAN 4005900009319, its legal name ending in 300 ml, not sold online, so its search leaves it out (`fixtures/hebe-ean-offline.json`; `src/lib/services/shops/hebe.test.ts:487-491`).
    - Super-Pharm 10132: "300 ml", no EAN (`fixtures/super-pharm-name-search-one.json`).

    Rossmann's and Natura's items meet the rule. The Super-Pharm item gets `choose`, with no shared EAN, an equal size and an agreeing brand (`src/lib/services/shops/super-pharm.test.ts:730-737`).

  - **Lip balm:** Hebe 742817 (EAN 9005800362939, "5,5 ml") and Rossmann 11790 ("4,8 g", the same EAN among its 4). The units differ, so the candidate is flagged and offered, never accepted (`hebe.test.ts:493-507`).
- **Across four shops' lists, under the existing rule:**
  - **Grouped:** Rossmann, Natura and Hebe hits that share an EAN, have an equal size and don't differ in brand.
  - **Kept apart:** every Super-Pharm hit, every hit without a parsed size, and hits whose sizes have different units.
- **Grouping across four lists is new logic.** `pickMatch` compares one product with one shop's list. A shared secondary EAN already counts as shared for `judge` (`src/lib/services/matching.test.ts:133-137`). The product page's lookup, though, searches by the product's first EAN only (`shop-matching.ts:152-157`).

### 6. A product from another shop: the database

Migrations: M1 `20260926112205_polite_shop_access`, M2 `20260927145051_watchlist_items`, M3 `20260927184936_watchlist_matches`, M4 `20260927204417_watchlist_items_product_url`, M5 `20260928011450_price_observations`, M6 `20261001182905_watchlist_removal_and_repin`.

- **`shops`:** seeded with `rossmann`, `hebe`, `super-pharm` and `natura` (M1:40-44).
- **`watchlist_items`:**
  - **`source`** is `text not null references public.shops (id)` (M2:8), with no other check. M2's comment calls it "the shop whose search the product came from" (M2:7).
  - **Value checks**, the same for every source:
    - `source_item_id ~ '^[A-Za-z0-9._-]{1,40}$'` (M3:10);
    - product and image URLs must be `https://` and at most 500 characters, on any host (M3:14, M4:6);
    - at most 10 EANs of 8-14 digits (M5:12-15).
  - **Unique** on `(user_id, source, source_item_id)` (M2:22).
  - **Access:** the owner may select, insert and delete their own rows (M2:31-42, M6:9-13). There's no update policy or grant, so `source` can't change after an insert.
- **`watchlist_matches`:** `shop_id references public.shops (id)` (M3:26), with no check. Nothing ties `shop_id` to the product's `source`, so a decision in Rossmann, or in the product's own shop, fits the schema (M3:20-68).
- **`price_observations`.** The select and insert policies use the same watcher test (M5:89-127). A user watches a shop item when either holds, for any shop id:
  - a `watchlist_items` row of theirs has that item as its own (`source = shop_id and source_item_id = shop_item_id`);
  - a `matched` decision of theirs names it.

  The view `latest_price_observations` is `security_invoker` and keyed by `(shop_id, shop_item_id)` (M5:144-171).

- **What follows:**
  - neither a product from another shop nor a Rossmann decision needs a migration;
  - a rule against a decision in the product's own shop would be a new invariant, if wanted;
  - this research didn't check whether production has all six migrations applied.

### 7. A product from another shop: the places that take Rossmann as the product's shop

1. **`src/lib/services/price-comparison.ts:29,39,45,51`.** `MATCHABLE_SHOPS` and `MATCHED_SHOPS` leave Rossmann out. `PRICED_SHOPS` is `["rossmann", ...MATCHED_SHOPS]` and `KnownShop` is `"rossmann" | MatchableShop`. At the type level, Rossmann can't be matched and no other shop can be the product's own.
2. **`productPriceKeys`** (`price-comparison.ts:470-487`) adds the product's own item only when `product.source === "rossmann"` (`:476`). A product picked at another shop gets no price row of its own. `price-comparison.test.ts:698-701` pins this. The keys feed `listPricedItems` (`:496`), so they reach the list's rows, the list's refresh, the product page and its refresh.
3. **`itemInRows`** (`src/lib/services/price-targets.ts:77-101`) gives a Rossmann item only when `source === "rossmann"` (`:82-91`). For any other shop it looks only at the user's matches (`:92-99`), never at the product's own item. So the island's refetch through `/api/watchlist/prices` would answer `changed` (409) for a product's own item at another shop. `price-targets.test.ts:305` pins this.
4. **`PRICE_FETCHERS`** (`src/lib/services/price-refresh.ts:49`) is `{ rossmann: fetchRossmannPrices, ...MATCHABLE_FETCHERS }`, with Rossmann's fetcher private to that file (`:90-105`). The dispatch itself is per shop.
5. **`src/pages/watchlist/[id].astro:140`** sends „Zobacz w sklepie” to the product's own URL only for Rossmann. Every other shop uses its match's URL, from `matchedItems: Map<MatchedShop, …>` (`:124-126`).
6. **`src/pages/watchlist.astro:27,46,52-53`.** The only search is `searchRossmann`, and the unavailable text names Rossmann.
7. **`src/components/watchlist/SearchResults.astro:17`** types its candidates as `ProductCandidate[]`, Rossmann's result shape. Its footer names rossmann.pl.
8. **`watchlistAddSchema`** (`watchlist.ts:44-54`) takes Rossmann only. `watchlist.test.ts:117-118` pins the refusal of `source: "hebe"`.

### 8. A product from another shop: one fixed set of matched shops for every product

- **`runMatchSteps`** (`shop-matching.ts:272-277`) defaults to `MATCHED_SHOPS`, and the product page passes no list (`[id].astro:99-111`). A product picked at Natura would be looked up in Natura, and never in Rossmann.
- **`listMatches` and `listMatchStates`** (`src/lib/services/matches.ts:453,523`) default to `MATCHED_SHOPS` and drop the rows of shops outside it (`listedShop`, `:408`). A Rossmann decision would be read and then ignored.
- **The decision form.**
  - `parseMatchForm` (`matches.ts:154`, through `decisionFieldsFor` at `:71`) and `parseMatchedShop` (`price-comparison.ts:57`) accept any shop in `MATCHED_SHOPS`, for any product.
  - `/api/watchlist/matches` never reads the product, so it couldn't refuse a decision in the product's own shop. It refuses `rossmann`, as `matches.test.ts:297` and `:468-471` pin.
- **Shop parameters.**
  - `repinShopOf` and `retryShopOf` (`src/lib/services/match-step.ts:22,31`) go through `parseMatchedShop`, so `?repin=rossmann` and `?retry=rossmann` are ignored.
  - `decisionNotice` and `decisionError` (`src/lib/services/match-view.ts:392-410`) read the shop the same way.
- **Price targets.** `productPriceKeys`' loop and `listTargets`/`productTargets` (`price-targets.ts:122-162`) default to `MATCHED_SHOPS`.
- **List rows** (`watchlist-rows.ts`):
  - `ListMatchStates` (`:69`) needs a state for every matched shop;
  - `matchStatesOf` (`:428`) and `listRowsOf` (`:473`) use `MATCHED_SHOPS`;
  - `shopStatesOf` (`:155-161`) walks `MATCHABLE_SHOPS`;
  - a shop without a decision puts the product in „Do sprawdzenia” (`needsCheck`, `:196-207`) and adds „<shop>: do dopasowania” to its row (`statusText`, `:178-189`);
  - `matchesFailedText` (`:491`) names the matched shops.
- **Types that rule Rossmann out as a matched shop.** The logic behind them is generic:
  - `MatchedShopView` and the match card (`src/components/watchlist/match-card.ts:36-42,87-99`);
  - the island's state, in `price-comparison-state.ts`, its unread and undecided shops;
  - `MatchChoice.astro`'s `shop`;
  - `DECISION_NOTICES.declined` (`src/lib/notices.ts:22-26`);
  - `MatchesRead` and `decisionBackTo` in `matches.ts`;
  - `MatchStepResult` in `shop-matching.ts`.
- **Already generic: these work for whatever shops they're given.**
  - `needsRefetch`, `priceState`, `compareShops` and `verdictOf` (`price-comparison.ts`).
  - `refreshPrices`, which asks each shop for its own ids and removes duplicate shops (`price-refresh.ts:66-83`).
  - `recordPriceChecks` and `readLatestPrices` (`src/lib/services/prices.ts`).
  - `priceRequestSchema`, which accepts any shop in `PRICED_SHOPS` (`price-targets.ts:28-32`).
  - `decideMatchStep` and `autoRefreshOf` (`match-step.ts:62,94`).
  - `lookupInShop` and `lookupChoicesInShop`, through `SHOP_ADAPTERS` (`shop-matching.ts:63,103`).
  - The matching rule (`matching.ts`).
  - `recordLookup`, `recordDecision` and `record`, which take any `ShopId` (`matches.ts:272-356`).
  - The island's `ShopGrid`, which draws a priced row without a match card as a plain `ShopCard` (`src/components/watchlist/PriceComparisonView.tsx:153-183`). So the product's own card is whichever priced row has no match card, not Rossmann's by name.
  - `SHOP_LABELS`, `SHOP_FILLS` and `SHOP_HOSTS`, which already include Rossmann.

### 9. Rossmann as a matched shop

- **The shop lists.** Adding Rossmann to `MATCHABLE_SHOPS` collapses `KnownShop` into `MatchableShop` and repeats Rossmann in `PRICED_SHOPS` (`price-comparison.ts:29-51`). "Priced shops" would become "all four", with the product's own shop coming from `product.source`.
- **An adapter entry against `ShopAdapter`** (`registry.ts:26-40`):
  - **`search(gate, query, size)`.** `searchRossmann(gate, query)` takes no size, since its page size is fixed at 24 (`rossmann.ts:17,62`). It returns `ProductCandidate`s, not `ShopCandidate`s. Its `itemSchema` reads none of the price fields Rossmann's search items carry (`rossmann.ts:27-38`; research note §2.1), so an automatically accepted Rossmann candidate would bring no first price for the lookup to store (`shop-matching.ts:352-356`). An EAN query there returns nothing (research note §2.1).
  - **`fetchPrices`** exists as the private `fetchRossmannPrices` (`price-refresh.ts:90-105`).
  - **`isItemId`** is missing. The id pattern is private (`rossmann.ts:22`) and repeated in `watchlist.ts:46`.
  - **`isProductUrl` and `isImage`** exist as `isRossmannProductUrl` and `isRossmannImage` (`rossmann.ts:128-145`).
- **A match mode** (`MATCH_MODES`, `price-comparison.ts:101-105`). Neither existing mode fits:
  - `on-view` searches by EAN first (`lookupEan`, `shop-matching.ts:152-157`), which spends a request at Rossmann to learn nothing;
  - `on-request` skips the EAN search but also keeps the shop out of automatic lookups (`match-step.ts`, `match-view.ts`, `match-card.ts`);
  - yet Rossmann's name-search candidates carry EANs (`rossmann.ts:217-219`), so `pickMatch` could accept one.

### 10. A product from another shop: lookups built from its fields

- **The name query.** It's the product's brand, then its name, then its size text (`shop-matching.ts:160-162`). That suits Rossmann, whose `name` holds neither brand nor size („Soft ”, `fixtures/rossmann-search-results.json:410-422`). The other shops' names repeat those words:
  - Natura's title holds both brand and size: „NIVEA SOFT krem intensywnie nawilżający 300 ml”;
  - Hebe's legal name ends with the size;
  - Super-Pharm's name starts with the brand: „Nivea Soft Krem nawilżający (Pudełko)”.

  So the query would repeat words, and its cut at 80 characters (`search-query.ts:39-45`) could drop the size. This is an inference from the recordings; no such lookup ran.

- **No EAN, no automatic match.** `lookupEan` uses the product's first EAN (`shop-matching.ts:152-157`). A product from Super-Pharm has none, so Natura and Hebe would be searched by name only, and no shop could be accepted automatically (`matching.ts:65`).

### 11. Duplicates across shops

The unique key includes `source` (M2:22), and „Na liście” is decided per shop item (`SearchResults.astro:30`). So the same product added once from Rossmann and once from Natura makes two list entries, each matched and priced on its own. A grouped search result could check each of its shop items against the list.

### 12. Showing each shop's results as it answers

- **Today the search renders server-side.** There's no search island and no search JSON route (`watchlist.astro:45-50`). The app's islands are `PriceComparison` (`client:load`) and the selected row's `RowTag` (`client:media`).
- **The pattern to reuse is on the product page.**
  - The island posts once per shop to `/api/watchlist/prices` and updates each card as its shop answers (`src/components/watchlist/PriceComparison.tsx:72-80,97-109`; `price-comparison-state.ts:750-810`).
  - The route refuses other sites with `refuseJsonRequest` (`src/lib/json-request.ts:17`).
  - It takes the item to fetch from the user's own rows, never from the request (`priceTargetFor`, `price-targets.ts:59`).
- **What a per-shop search route would need:**
  - `refuseJsonRequest` and `searchQuerySchema`;
  - a rule tying its requests to the user's own submit, since `isOwnNavigation` is applied today to page loads (`watchlist.astro:41` and the product page);
  - islands may import only browser-safe modules, and the ESLint island config admits three services: `matching`, `price-comparison` and `watchlist-rows` (`CLAUDE.md`, "UI"). Grouping logic placed in `matching.ts` could run there.

### 13. Tests, checks and fixtures that pin today's behaviour

- **Unit tests:**
  - `watchlist.test.ts:117-118` refuses `source: "hebe"`;
  - `price-comparison.test.ts:698-701` leaves out the product's own item unless it's Rossmann's;
  - `price-targets.test.ts:305` gives no Rossmann item for a product picked elsewhere;
  - `matches.test.ts:297` and `:468-471` refuse a decision in Rossmann.
- **Database checks:**
  - `scripts/check-matches-db.mjs:343-354` and `scripts/check-prices-db.mjs:254-266` use `shop_id: "rossmann"` as "a shop the product has no decision for", which holds for their Rossmann products;
  - `scripts/check-watchlist-db.mjs` inserts only Rossmann products (`:48-58`) and refuses `dm` (`:124-126`);
  - no script inserts a valid product from another shop or a valid Rossmann decision.
- **E2e:** products are seeded as Rossmann's only (`tests/e2e/support/watchlist-data.ts:123-138`).
- **Kitchen sinks:** Rossmann is the product's own shop in `src/dev/fixtures.ts` and `src/dev/watchlist-fixtures.ts`.
- **Recordings:** the recorded searches that found products all ask for Nivea, by name or by EAN. The others are an unknown EAN (`natura-ean-miss.json`) and the nonsense query „zzqqxxjj” (`rossmann-search-empty.json`, served for it at `rossmann.test.ts:125`). A new recording needs the owner's approval (`context/foundation/test-plan.md` §6.4).

## Code References

- `src/pages/watchlist.astro:33-53,100-125`: the search's input, guard, call and render.
- `src/lib/services/search-query.ts:3-8,19,29-45`: allowed characters, own navigation, the schema, `toShopQuery`.
- `src/components/watchlist/SearchResults.astro:17,30-31`: Rossmann's result shape, „Na liście” per shop item, the "Dodaj" form.
- `src/pages/api/watchlist.ts:15-41` and `src/lib/services/watchlist.ts:44-54,109-142`: the add route and the Rossmann-only schema.
- `src/lib/services/shops/rossmann.ts:9-38,62-87,128-145,196-222`: Rossmann's search, its item schema without a price, unreadable items read as nothing found, URL checks.
- `src/lib/services/shops/registry.ts:26-64`: `ShopAdapter` and `SHOP_ADAPTERS` for Natura, Hebe, Super-Pharm.
- `src/lib/services/shops/luigis-box.ts:24,112-152`: Natura's and Hebe's search client, 4 s, all-unreadable means failed.
- `src/lib/services/shops/hebe.ts:41-56,78-80`: only `searchable: [true]` items.
- `src/lib/services/shops/super-pharm.ts:39,114-146,321`: Super-Pharm's search, no EAN.
- `src/lib/services/shop-matching.ts:45-46,63-91,152-162,272-277`: hit counts, lookups, first EAN, name query, the matched shops' steps.
- `src/lib/services/matching.ts:25-27,51,64,80-98,113`: the same-product rule.
- `src/lib/services/shop-gate.ts:9-23,86-150,165-231`: hosts, timeouts, refusals, reservations.
- `src/lib/services/price-comparison.ts:29-59,101-105,470-519`: shop lists, match modes, price keys.
- `src/lib/services/price-targets.ts:28-32,59-101,122-162`: price requests, the product's item per shop.
- `src/lib/services/price-refresh.ts:44-49,66-105`: the price fetchers and the refresh.
- `src/lib/services/matches.ts:71-77,154,272-356,398-475,523-560`: decision form, writes, the four read rules, reads.
- `src/lib/services/match-step.ts:22-33,62-96`: shop parameters, the step rule.
- `src/lib/services/watchlist-rows.ts:69-71,138,155-207,428-493`: a row's matched shops and „Do sprawdzenia”.
- `src/pages/watchlist/[id].astro:70-140`: the product page's reads, steps and links.
- `src/components/watchlist/PriceComparisonView.tsx:153-183`: the product's own card is the priced row without a match card.
- `supabase/migrations/20260927145051_watchlist_items.sql:7-42`, `20260927184936_watchlist_matches.sql:7-94`, `20260928011450_price_observations.sql:10-178`: the schema, generic over shops.

## Architecture Insights

- **The schema was written for any source shop; the app narrowed it to Rossmann.** The identity model is "a product is one shop's item, and the other shops are matched to it" (FR-004, FR-006). Since S-01, M2's comment has described `watchlist_items.source` as "the shop whose search the product came from" (M2:7). The narrowing sits in the add schema, the price keys and the fixed shop lists.
- **Two roles per shop.** Today they're constants: `PRICED_SHOPS` (Rossmann plus the matched shops) and `MATCHED_SHOPS`. A product from another shop needs them per product: its own shop is `product.source`, and its matched shops are the priced shops without it. Most rules already take a list of shops and work for whatever they're given (§8, last list). The defaults and the types are what fix the set.
- **Search and matching are separate steps.** The search fixes a product, and the product page's lookups fix its other shops. A four-shop search asks the same shops the lookups ask. The plan has to decide whether search results may stand in for a lookup. If they do:
  - under FR-006 as it stands, only the existing rule (shared EAN, same size, agreeing brand) could accept an item automatically;
  - the server must re-check every shop item that comes back through a form, as `parseMatchForm` does for decisions (`matches.ts:90-104`), since hidden form fields are user input.
- **The honesty rules carry over:**
  - an unreadable answer is a gap, not "not there";
  - a shop that couldn't be asked says so;
  - prices are online prices;
  - a shop that refuses is stopped for everyone, so the user's text is checked before it reaches any shop.

## Historical Context (from prior changes)

- `context/archive/2026-09-27-watchlist-add-by-search/plan-brief.md`:
  - `:26`: "Search source | Rossmann only, with a clear "unavailable" message | It's the research note's name-and-size resolver, with no key read from a shop page".
  - `:50-52`: out of scope, "other shops' search, search as you type, pagination and a size filter".
  - `:89`: accepted, "Search is down whenever Rossmann is paused, stopped or capped".
- `context/archive/2026-09-27-watchlist-add-by-search/plan.md:70`: "No other search source: no Natura or other shop, no fallback and no merged results". S-01 has no research.md or frame, so this cell and the research note's §6 step 1, which names Rossmann "or dm" as the resolver, are the whole recorded rationale.
- `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:71`: "Rossmann stays the only search source". Its plan-brief makes Natura's tracker a constant to avoid reading a 3.3 MB page.
- `context/foundation/prd.md`:
  - FR-003 asks only for a search "by name and size" (`:92`);
  - FR-004 makes the picked product the identity, with the EAN a helper (`:95-98`);
  - US-02's Given assumes "(EAN fixed)" (`:68`);
  - FR-006's updates keep the automatic rule at EAN, size and brand for every shop and make Super-Pharm a user's pick (`:103-117`).
- `context/archive/2026-10-02-hebe-in-comparison/plan.md:84`: no name comparison, the owner's call.
- `context/changes/super-pharm-in-comparison/plan.md`, three rejections:
  - `:94`: automatic Super-Pharm matches, by name similarity or by product-page EANs;
  - `:95`: a lookup of an undecided Super-Pharm on a plain view, "or once after "Dodaj"";
  - `:129`: "A plain view must never search an on-request shop".
- `context/foundation/test-plan.md:48`: risk 6, "a shop without EANs can't auto-accept".
- `context/foundation/lessons.md:12-24`: bound each view's and action's cost per shop; never read an unreadable answer as missing.
- `context/archive/2026-09-28-cheapest-shop-today/research.md:247-252`: the Workers limits quoted in §3.
- `context/changes/add-from-other-shops/change.md`: the phone check, the earlier live Super-Pharm searches, and PR #31.

## Related Research

- `context/changes/super-pharm-in-comparison/research.md`: Super-Pharm's search, probes and request costs.
- `context/archive/2026-10-02-hebe-in-comparison/research.md`: Hebe's search and `searchable`.
- `context/archive/2026-10-01-fix-matches-and-watchlist/research.md`: the brand rule and its evidence.
- `context/archive/2026-09-28-cheapest-shop-today/research.md`: price storage, watchers and Workers limits.
- `docs/research/polish-drugstore-price-apis.md`: every shop's endpoints, fields and quirks.

## Live evidence (2026-10-06, after the owner's calls)

**Method.** The owner approved 8 requests (`change.md`, „Live evidence”). They went from the developer machine at 10:37:35–10:38:00 UTC, one at a time and 3 s apart, with the gate's User-Agent and `Accept: application/json`, following no redirect. Each was its adapter's own search request for 10 hits, with Rossmann's `pageSize` at 10, the owner's call (9):

- Rossmann: GET `https://www.rossmann.pl/products/v4/api/Products?search=<q>&page=1&pageSize=10`;
- Natura: GET `https://live.luigisbox.com/search?tracker_id=703598-939363&q=<q>&size=10`;
- Hebe: the same with `tracker_id=421168-505233`;
- Super-Pharm: POST to `https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query` with the app id and key headers and the body `{"params":"query=nivea+soft&hitsPerPage=10&analytics=false&attributesToRetrieve=name%2Cbrand%2Ccapacity%2Curl%2Cthumbnail_url%2Cprice%2Cin_stock%2CinStoreOnly&attributesToHighlight=%5B%5D"}`, with only its `query` changed for the second text.

`<q>` is `encodeURIComponent` of „nivea soft” or of „AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający”, the owner's phone search. Every answer was a 200 JSON. They're kept whole in `recordings/<shop>-search-<nivea-soft|aa-laab>.json`, pretty-printed with every number as sent, for the plan to turn into fixtures. One value differs from the answer: in `natura-search-aa-laab.json`, a person's e-mail address in the GPSR fields (`producent_gpsr1`, `dostawca_gpsr`), which the app never reads, reads `[email removed]`, since the repository is public (2026-10-08). The app's own adapters and `judge` read them in a temporary test, deleted after its run.

| Query        | Rossmann          | Natura  | Hebe     | Super-Pharm | Entries                            |
| ------------ | ----------------- | ------- | -------- | ----------- | ---------------------------------- |
| „nivea soft” | 5 candidates of 5 | 9 of 15 | 3 of 58  | 10 of 13    | 25 from 27 items, 2 of them joined |
| AA LAAB      | 2 of 2            | 4 of 4  | 10 of 12 | 1 of 1      | 12 from 17 items, 5 of them joined |

"X of Y" is the candidates the adapter kept, of the hits the shop reported in total. An entry is joined when it holds items of two shops under the owner's rule: a shared EAN, an equal size and a brand that doesn't differ (`judge`, `matching.ts:64`), with the shops in the owner's order.

**Findings.**

1. **Joins.**
   - „nivea soft”: Rossmann 26900 with Natura NV89063 (Nivea Soft 300 ml), and Natura NV890500 with Hebe 218807 (Nivea Soft 200 ml).
   - AA LAAB: Rossmann 419343 with Hebe 450251 (the face wash, 150 ml), and four Natura items with their Hebe twins: the night cream, the SPF 50 cream and the day cream, all 40 ml, and the 15 ml eye cream.
   - No entry held three shops. Every join shared its first item's first EAN, so the recordings show no secondary EAN in use (open question 11).
2. **Kept apart, though they share an EAN.**
   - Rossmann's 4,8 g lip balm 11790 and Hebe's 5,5 ml 742817: the sizes differ (§5).
   - Rossmann's baby wipes 2079205 („4x57 szt.”, no size parsed) and Natura's NV74420 („228 szt”): the size is unknown on one side, so this multipack shows twice.
3. **Super-Pharm repeats products, as the owner accepted.**
   - Its 10132 is Nivea Soft 300 ml, which Rossmann and Natura join. Its 105870, brand „AA Cosmetics”, is the AA LAAB face wash 150 ml, which Rossmann and Hebe join.
   - Size and brand alone would join wrongly: by them, 105870 also fits Hebe's 150 ml make-up removal balm 450257, and its 500 ml shower gel 20461 fits three Natura items.
   - 7 of its 10 „nivea soft” candidates have no size (`capacity` missing), some with one only in the name („SPF15, 200ml”).
4. **Hebe's 10 hits can hold few items.** For „nivea soft”, 7 of its 10 hits were query suggestions (`type: "query"`), which the adapter drops, so it showed 3 items of the 58 it reported. Natura's 10 held one suggestion. Whether a search request can leave suggestions out, such as with `f[]=type:item` beside `q`, is untested.
5. **The long name.** Rossmann found the face wash in its two sizes, 75 and 150 ml. Hebe found it first, then nine other AA LAAB items, and Super-Pharm found exactly it. Natura's 4 hits were other AA LAAB items, without the face wash. No shop returned another brand.
6. **The phone check's „Brak wyników”.**
   - The owner's production search at 08:11 UTC, from the Worker log they pasted in the morning's session, sent the same text: own navigation (`Sec-Fetch-Site: same-origin`), a 200 in 481 ms, and no log line.
   - At 10:37 UTC Rossmann answered the same request, with `pageSize` 10 instead of 24, with both face washes, and the adapter reads both. Nothing in them is near its checks (an all-digit id and a name), so the morning's empty list most likely came from Rossmann's answer itself.
   - These recordings can't tell a passing gap in Rossmann's search from Rossmann answering the Worker's traffic differently. Repeating the search on the phone would, for 1 Rossmann request through the gate. Rossmann's answers can be cached for an hour (finding 7), so a cached empty answer from 08:11 would have expired by 09:11. The recordings asked with `pageSize` 10, a different address, so they don't decide what the phone's request gets.
   - So the change's example is sold at Rossmann. The other shops still add items that Rossmann's answer to that text didn't hold.
   - Settled later that day: the same search through the app, from the owner's desktop browser, found the face wash and the owner added it (`change.md`). The morning's empty answer was a passing gap in Rossmann's answers, not the Worker being answered differently.
7. **Each shop's caching, from the recordings' response headers.**
   - Rossmann answers through Cloudflare with `Cache-Control: public, max-age=3600` and `cf-cache-status: MISS`, so the same search address can be answered from its cache for up to an hour.
   - Luigi's Box answers Natura's and Hebe's searches with `Cache-Control: public, max-age=300`.
   - Algolia answers Super-Pharm's with `Cache-Control: no-store`.
   - This bears on question 10: a reload within those times may be answered from a shop's cache, yet it still spends a slot of the gate's cap.

## Open Questions

On 2026-10-06 the owner answered questions 1-9, each with its recommended option, and approved question 11's recordings, whose evidence is above; the calls are in `change.md`. Questions 10 (the cost statement and any caching) and 12 (the documents) are left to the plan. As they were put:

1. **The result's shape.** Three options:
   - one entry per product, with a mark for each shop. This needs the grouping in §5, which keeps Super-Pharm hits apart under today's rule;
   - one section per shop, with no grouping;
   - a mix of the two.

   The owner's examples ("gives both", "the rest of the shops shows that it is missing") point to the first.

2. **What a shop's mark may claim.** Options:
   - "not found in this search": honest, but weak (§4);
   - a stronger check per result, such as an EAN search in Natura and Hebe for each grouped product, which costs requests per result and isn't possible at Rossmann or Super-Pharm.

   Either way, a shop that couldn't be asked shows that. Rossmann's unreadable answer must stop reading as "nothing found" (`rossmann.ts:77-87`).

3. **Which item becomes the product** when several shops have it. The item whose "Dodaj" the user taps, or a rule such as "the item with an EAN first".
4. **What "Dodaj" stores for the other shops.** Options:
   - nothing, with the product page looking them up as today;
   - the items the search grouped, as automatic matches under the existing rule, which saves those lookups.

   Storing "not found" for shops the search didn't find would claim more than a lookup does (§4).

5. **Super-Pharm in a grouped result.** Keep it apart, under FR-006 and the S-05 and S-06 calls, or accept a "looks like the same product" grouping by size and brand, which reverses those calls.
6. **Rossmann as a matched shop for a product from another shop.** Its mode: looked up on view by name, accepting by EAN, size and brand, or only on request. Plus the request each lookup costs (§9).
7. **Duplicates.** Allow the same product from two shops as two entries, or refuse or merge by EAN at add time (§11).
8. **Progressive display.** One server-rendered page that waits for the slowest shop (up to about 5 s, §3), or an island that shows each shop's results as they arrive (§12).
9. **Hits per shop, and trimming.** Rossmann's 24 are fixed. The others take a size, so 10 per shop like the name lookups, or another number. Luigi's Box searches could name `hit_fields` (§2).
10. **The cost statement.** 4 shop requests per search, repeated on reload, and the lookups after "Dodaj". Whether any of it should be cached.
11. **Live evidence not yet gathered.** It would take a few recordings, with the owner's approval and at least 2 s apart:
    - how often the same product shows in two or more shops' results for real queries, the owner's „AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający” among them;
    - whether Natura and Hebe list Rossmann's secondary EANs;
    - how Natura's and Hebe's searches treat a long name copied from Super-Pharm.
12. **Documents.**
    - PRD: FR-003, FR-004 (the identity of a product from another shop), US-02's "(EAN fixed)" and FR-006 for a product without an EAN.
    - The roadmap: a slice id for this change.
    - PR #31's Rossmann wording, once the search covers four shops.
