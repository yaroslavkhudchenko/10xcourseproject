---
date: 2026-10-04T16:07:45+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 50fb7c6a9825ab74f55914b0349f86e3e7bdeb22
branch: feat/hebe-in-comparison
repository: yaroslavkhudchenko/10xcourseproject
topic: "S-06 super-pharm-in-comparison: what it takes to add Super-Pharm as a fourth shop on S-05's per-shop code, with an Algolia index that carries no EAN and a search key embedded in the shop's own pages"
tags:
  [
    research,
    codebase,
    super-pharm,
    algolia,
    search-key,
    shop-gate,
    matching,
    price-refresh,
    workers-cache,
    request-costs,
    tests,
  ]
status: complete
last_updated: 2026-10-05
last_updated_by: Claude (claude-opus-5-5)
---

# Research: Adding Super-Pharm as a fourth shop (roadmap S-06)

**Date**: 2026-10-04T16:07:45+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 50fb7c6a9825ab74f55914b0349f86e3e7bdeb22 (S-05 `feat/hebe-in-comparison`, Phases 1–4), read from the commit itself; `main` is 1a74a2a
**Branch**: feat/hebe-in-comparison (the code inspected); this file was written in the worktree branch `worktree-agent-a336724323140dd59`, which sits on `main` 1a74a2a
**Repository**: yaroslavkhudchenko/10xcourseproject

> **Citations.** `path:line` is the same on `main` and on the S-05 branch. **S-05 @ 50fb7c6: `path:line`** marks a file that exists only on the S-05 branch, or whose lines differ there; those lines will move as S-05's Phases 5–7 land.
>
> **Probes, 2026-10-05.** The draft of 2026-10-04 sent no request to superpharm.pl, to Algolia's hosts or to any shop, and stayed `partial` until Super-Pharm's live answers could settle what the code and the documentation can't. On 2026-10-05 the owner approved the five baseline probes (P1, P2, P3, P5 and P6). They ran from the developer machine and answered every question they were for (§ Probe results). The conditional probes (P4, P7–P11) wait for the decisions that would need them. The one still likely is P10, the answer to a rejected key, if the plan takes the gate exception (Open Question 2).
>
> **Code citations** are still those of 2026-10-04: `main` 1a74a2a and S-05 @ 50fb7c6. S-05 has since merged (`0b5e53c`) and S-07 is in review, so `/10x-plan` re-reads the code on `main`.

## Research Question

Roadmap S-06 (`context/foundation/roadmap.md:173-185`): the user can match their products in Super-Pharm and see its prices in the comparison, "even though Super-Pharm's search index carries no EAN". Concretely:

1. How would the adapter search Super-Pharm, and what does a candidate map to?
2. How is the search-only key obtained at runtime? What does that cost, where can it be cached on Workers, and what happens when it rotates, given that one 403 stops a shop for everyone?
3. How can a shop without EANs be matched under the project's rule?
4. How are pinned prices fetched in batches, how does a vanished item read, and what does each view and action cost?
5. What counts as orderable online, as the price and as the Omnibus low?
6. What does S-06 need from S-05, what could be built before S-05 merges, and what are the ordering risks?
7. Which tests does the test plan call for?
8. Which risks and unknowns remain, and how is each retired?

**Method**

- Read in the main session:
  - the roadmap's S-06 block, the PRD's requirements and guardrails, the six lessons, the test plan (risks #3, #5, #6, §6.3, §6.4) and CLAUDE.md's non-negotiables;
  - the research note's §1, §2.3, §5–§7 and §9;
  - S-05's plan, with its Implementation Notes for Phases 1–4, and its research;
  - S-05's code at 50fb7c6, exported read-only with `git archive` (never the main checkout's working tree, which holds uncommitted Phase 5 edits).
- Four read-only workers: earlier decisions across `context/`; the per-shop extension points in S-05's code; Algolia's public documentation and the Magento extension's source; Cloudflare's Workers documentation on caching and limits. Their decisive anchors were re-checked in the main session.
- One local computation: base64-decoding the search key the research note quotes (`docs/research/polish-drugstore-price-apis.md:118`).

## Summary

**Update 2026-10-05, after the probes** (§ Probe results). Where a point below calls a fact unrecorded or inferred, the probes settle it:

- **The key is unchanged** since 2026-09-17, 18 days later, on the same extension v3.9.1, and still carries no `validUntil` (point 4).
- **robots.txt refuses no AI crawler** and allows the homepage and the product pages. It now disallows `/catalogsearch/`, the site's own search page, which the app never reads (point 5).
- **The size words help the search.** "NIVEA Soft 300 ml" found exactly the 300 ml item, whose "300 ml" matched the searchable `capacity` (§2).
- **The EAN query finds nothing**: a real empty answer, so the adapter can skip the EAN search (§2).
- **The pinned filter works with the secured key**: `objectID:10132 OR objectID:999999999` returned the known item and left out the unknown one, in a 700-byte answer (point 7).
- **A promotion's regular price can be missing from the record.** The 300 ml item is on promotion (19,49 zł, shown in red, a "Promocja" badge, Omnibus low 33,99 zł) yet has no `default_original_formated`, and its promotion dates are a 2016 start and no end (point 8, §7).
- **No customer-group prices**: the page's `priceGroup` is null, and the record carries only the guest price (point 8).
- **Images come from another host**, `media.superpharm.eu` (§2).

1. **The platform already knows Super-Pharm. On S-05's code it needs an adapter, a label, a colour and its switch.**
   - `SHOP_IDS` has `super-pharm` (S-05 @ 50fb7c6: `src/types.ts:2`).
   - The gate lists `www.superpharm.pl` and `ep43qpdx9q-dsn.algolia.net` (`src/lib/services/shop-gate.ts:13`).
   - `public.shops` has its row, enabled, with the default cap of 30 a minute (`supabase/migrations/20260926112205_polite_shop_access.sql:9, :43`).
   - A match without EANs can be stored (`supabase/migrations/20260927184936_watchlist_matches.sql:39`). Matching and prices need no migration.
   - S-05 was planned so that "its arrival [is] a matter of an adapter plus labels" (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:81`): `MATCHABLE_SHOPS`, `SHOP_LABELS` and `SHOP_ADAPTERS` are keyed by the known shops, `PRICE_FETCHERS` derives from the registry, and `MATCHED_SHOPS` is the only switch (S-05 @ 50fb7c6: `src/lib/services/price-comparison.ts:29-77`, `src/lib/services/shops/registry.ts:13-40`, `src/lib/services/price-refresh.ts:41-49`).
2. **Four things about Super-Pharm fall outside S-05's contracts.**
   - **No EAN search.** The index has no EAN (research note `:130`), but both lookups run an EAN search first whenever the product has an EAN (S-05 @ 50fb7c6: `src/lib/services/shop-matching.ts:57-69, :101-111`). Unless an adapter can say it has no EAN search, each lookup and each re-pin spends one request to learn nothing.
   - **A key read from the shop's page.** No adapter so far needs one.
   - **Algolia, not Luigi's Box.** The batching, the stop after a refusal, the missing-versus-failed rule and the value helpers live in the Luigi's Box client (S-05 @ 50fb7c6: `src/lib/services/shops/luigis-box.ts:119-210, :300-342`). Super-Pharm either shares them through a shop-neutral module or copies them, and the lessons ask for the first (`context/foundation/lessons.md:40-45`).
   - **Formatted prices.** The Omnibus low is text such as "36,99 zł", or `false` (research note `:129, :142`). During a promotion, the regular price exists only as formatted text (§7).
3. **Under today's gate, a rejected key stops Super-Pharm for everyone.**
   - Algolia answers a deleted, regenerated or wrong key with 403 "Invalid Application-ID or API key" (§3.4).
   - The gate reports every 403 as a block and discards the body, so the adapter never learns why (`src/lib/services/shop-gate.ts:136-143`).
   - The shop stays stopped until the owner re-enables it (`CLAUDE.md:21`), with `disabled_reason` "HTTP 403" and no host (`supabase/migrations/20260926112205_polite_shop_access.sql:108-114`).
   - Users would read "…bo sklep zablokował zapytania" (`src/lib/shop-messages.ts:26-27, :54-55`), which is false for a rotated key.
   - A key past its `validUntil` answers 400 instead, which the gate treats as a plain failure (§3.4).
   - Whether the gate learns one narrow exception for the 403 is the plan's main decision (Open Question 2).
4. **The recorded key has no expiry of its own, but an extension upgrade would give it one.**
   - The key the research note quotes (`:118`) decodes locally to a 64-character hex HMAC followed by `tagFilters=` and nothing else: an Algolia secured key with an empty restriction and no `validUntil` (§3.1).
   - The extension version the note saw (v3.9.1) builds that key the same way on every page, so it changes only when Super-Pharm changes the parent key or the restriction.
   - From v3.14.0 the extension adds a 24-hour `validUntil` (§3.4). If Super-Pharm upgrades, its key changes daily.
   - The note's "it rotates with deployments" (`:118`) rests on no second recorded key, and the extension's source doesn't support it. Probe P2 gives one data point, 17 days after the first.
5. **Reading the key at runtime costs one capped request and a 1.8 MB page.**
   - The homepage answered 200 to a Worker, with `algoliaConfig` in it (research note `:297`; `context/deployment/deploy-plan.md:246-254`).
   - Each read is a `super-pharm` request under the same cap as its searches, and the gate's 8 s limit covers reading the whole body (`src/lib/services/shop-gate.ts:57-59, :119`).
   - The project is on Workers Paid (`context/deployment/deploy-plan.md:21`): CPU 30 s by default, 128 MB per isolate (§3.2).
   - Five places could hold the key: a constant (Natura's precedent), module memory per isolate, the database, the Cache API or KV. Their trade-offs are in §3.3.
6. **With no rule change, Super-Pharm is never matched automatically.**
   - `pickMatch` accepts only a candidate that shares an EAN (`src/lib/services/matching.ts:78-94`), and Super-Pharm's candidates carry none. That is what test-plan risk #6 asks for ("a shop without EANs can't auto-accept", `context/foundation/test-plan.md:48`), and FR-006 stays as written (`context/foundation/prd.md:101`).
   - The cost: every product needs one user choice in Super-Pharm.
   - A pending choice isn't stored, so each own-navigation view of an undecided product repeats the search (S-05 @ 50fb7c6: `src/lib/services/match-step.ts:56-74` and `context/changes/hebe-in-comparison/research.md:268`).
   - "Do sprawdzenia" holds every product until its Super-Pharm decision is made (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:645`).
7. **Pinned prices have a documented route, but no recorded request.**
   - The research note documents only text queries (`:121-127`).
   - Algolia documents `objectID`, which the extension sets to the Magento product id, as always filterable. A `sku:` filter would most likely answer with no hits, which would store every pinned item as `missing` (§3.4, §5). So a pin stores the `objectID`.
   - A search's filter value is limited to 512 bytes, which allows about 20 ids per request (§5).
   - getObjects is not documented for secured keys. The note records a 403 from this Algolia app for an operation outside the key's rights (`:148`), and under today's gate such a 403 stops the shop.
   - So the pinned-item request (§5) has to be proven from the developer machine before it ships (probe P6).
8. **What counts as the price is mostly unrecorded.**
   - The one recorded hit has `price.PLN.default` 36.99, `default_formated` "36,99 zł", `default_historical_min_price_formated` false and `in_stock` 1 (`:133-145`).
   - Per the extension's source, `default` is the lower of the regular and the promotional price when the record was indexed. The regular price appears only as text while a promotion runs. The promotion's dates are Unix seconds. A record keeps an ended promotion until the next reindex (§3.4, §7).
   - The Omnibus field is Super-Pharm's own addition, not the extension's.
   - Super-Pharm has club prices (`:272`), and a member-only price is not a public online price.
9. **Request costs** (§6).
   - Super-Pharm adds at most one key read per action, and only when no usable key is at hand.
   - It has one name search where the other shops have one or two searches.
   - A product stays undecided until the user picks. Under today's flow, every own-navigation view of an undecided product costs that search and waits for it during the render.
10. **Ordering.**
    - S-06 needs S-05's still-open Phases 5–6: the list per shop, Hebe's colour as the pattern, the e2e helpers and the proof that every priced shop is stopped (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:628-814, :1116-1140`).
    - Three things can come before S-05 merges: the owner's decisions, the probes and recordings, and a gate change (S-05 changed neither `shop-gate.ts` nor any migration).
    - S-07 changes `tests/e2e/auth.setup.ts` (`context/foundation/roadmap.md:204-206`), which S-06's e2e work also touches.
11. **Tests.**
    - Recorded fixtures from approved probes, and test-plan §6.4's pattern applied to Algolia.
    - A key reader under test, and gate tests if the 403 rule changes.
    - A four-shop e2e spec over seeded decisions, since choosing a candidate isn't reachable in the browser layer (`context/archive/2026-10-02-testing-critical-browser-flows/plan.md:66-68`).
    - CI never calls a shop (`context/foundation/test-plan.md:163`), so the key read can't run on workerd there. A budgeted manual check on the preview build covers it (`context/foundation/infrastructure.md:100`).

## Detailed Findings

### 1. What S-05 provides, and what Super-Pharm already has

| Piece                        | State for Super-Pharm                                                                                                                             | Anchor                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shop id                      | `super-pharm` is in `SHOP_IDS`                                                                                                                    | S-05 @ 50fb7c6: `src/types.ts:2`                                                                                                                                                                                                             |
| Gate hosts                   | `www.superpharm.pl` and `ep43qpdx9q-dsn.algolia.net` only, with no `*.algolianet.com` fallback; any other host throws before a reservation        | `src/lib/services/shop-gate.ts:13, :86-92`                                                                                                                                                                                                   |
| Shop row                     | seeded, enabled, cap 30 (check 1–60); no column for a key or any config                                                                           | `supabase/migrations/20260926112205_polite_shop_access.sql:5-15, :43`                                                                                                                                                                        |
| Stored ids                   | `^[A-Za-z0-9._-]{1,40}$`, and a letter or digit in observations; "39477" passes                                                                   | `supabase/migrations/20260927184936_watchlist_matches.sql:32`; `supabase/migrations/20260928011450_price_observations.sql:39`                                                                                                                |
| Matches without EANs         | `eans text[] not null default '{}'`                                                                                                               | `supabase/migrations/20260927184936_watchlist_matches.sql:39`                                                                                                                                                                                |
| Shop lists                   | `MATCHABLE_SHOPS` (`natura`, `hebe`), `MATCHED_SHOPS` (`natura`), `PRICED_SHOPS`, `KnownShop`, `parseMatchedShop`                                 | S-05 @ 50fb7c6: `src/lib/services/price-comparison.ts:29-59`                                                                                                                                                                                 |
| Labels                       | `ShopLabel` `{ name, in, of, title, site }`, `Record<KnownShop, ShopLabel>`                                                                       | S-05 @ 50fb7c6: `src/lib/services/price-comparison.ts:65-77`                                                                                                                                                                                 |
| Adapter registry             | `ShopAdapter` `{ search, fetchPrices, isProductUrl, isImage }`, `Record<MatchableShop, ShopAdapter>`                                              | S-05 @ 50fb7c6: `src/lib/services/shops/registry.ts:13-40`                                                                                                                                                                                   |
| Price fetchers               | derived from the registry; every listed shop's fetcher is called, even with no ids                                                                | S-05 @ 50fb7c6: `src/lib/services/price-refresh.ts:41-49, :74-78`                                                                                                                                                                            |
| Decision form                | a confirmed candidate's links are checked by its own shop's adapter                                                                               | S-05 @ 50fb7c6: `src/lib/services/matches.ts:86-93, :118`                                                                                                                                                                                    |
| Product page                 | one step per matched shop, all shops at once, each shop's requests one at a time                                                                  | S-05 @ 50fb7c6: `src/lib/services/shop-matching.ts:246-260`                                                                                                                                                                                  |
| "Najtaniej" while unread     | withheld while any matched shop's decision is unreadable, which closes the roadmap's S-06 carry-over (`context/foundation/roadmap.md:184`)        | S-05 @ 50fb7c6: `src/components/watchlist/price-comparison-state.ts:295-301`                                                                                                                                                                 |
| Stored rows of an off shop   | ignored, so Super-Pharm decisions stored before a revert stay harmless                                                                            | S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:332`                                                                                                                                                                             |
| Still Natura-only at 50fb7c6 | the list's states, alert and footer (Phase 5); shop colours and fills, kitchen sinks, e2e helpers, `auth.setup.ts`'s stopped-shop proof (Phase 6) | S-05 @ 50fb7c6: `src/lib/services/watchlist-rows.ts:347-357`; unchanged by S-05: `src/components/watchlist/shop-fills.ts:7-10`, `tests/e2e/support/watchlist-data.ts:117-138`, `tests/e2e/support/pages.ts:22`, `tests/e2e/auth.setup.ts:45` |
| Images and links             | a plain `<img>` straight from the shop's host; no Content-Security-Policy anywhere; links open with `rel="noopener noreferrer"`                   | `src/components/watchlist/ProductThumb.tsx:37-47`; `src/middleware.ts` (sets only Cache-Control)                                                                                                                                             |

### 2. Searching Super-Pharm and mapping a candidate (Q1)

**What is recorded** (research note §2.3, `:116-148`)

- Magento 2 with the Algolia extension v3.9.1. Every page embeds `algoliaConfig` with `applicationId` "EP43QPDX9Q", `indexName` "spprod_drugstore_pl_simple" and a search-only `apiKey` (`:118`).
- Products are in `spprod_drugstore_pl_simple_products`. A separate `spprod_pharmacy_pl` index serves the pharmacy site (`:119`).
- The documented request is `POST …/1/indexes/spprod_drugstore_pl_simple_products/query`, with `X-Algolia-Application-Id`, `X-Algolia-API-Key` and a `params` body (`:121-127`).
- Hit fields (`:129`): `name, sku, url, brand, capacity, farmax_capacity, price.PLN.{default, default_formated, default_historical_min_price_formated, special_from_date, special_to_date}, in_stock, showRedPrice, …, thumbnail_url, …, isProductRx, pharmaceuticalFlag, objectID`. There is no EAN; the product page's JSON-LD has `gtin13` (`:130`).
- Dead ends: the base index name doesn't exist, another index is empty, and listing indices with the search key answers 403 (`:148`).

**The request: POST, as Algolia documents it**

- Algolia's current API documents a search of one index as `POST /1/indexes/{indexName}/query`. A GET search on `/1/indexes/{indexName}` comes from its legacy docs, which call it discouraged (§3.4).
- Both earlier probes used POST: the research note's (`:121-127`) and the Worker's on 2026-09-23 (`:298`).
- **The test helper needs a change.** `createReplayFetch` finds a recording by the request's URL alone (`src/lib/services/testing/replay-fetch.ts:14-17`), and every POST search goes to the same `/query` URL. So the replay can't tell two searches apart, and test-plan §6.4 asks tests to spell out every request the replay served (S-05 @ 50fb7c6: `context/foundation/test-plan.md:161`). The replay has to match the body too, with the tests spelling out URL and body.
- **The gate needs no change for it.** It passes the method, body and headers through and sets only the User-Agent (`src/lib/services/shop-gate.ts:120-130`). It logs the host and path, never a query string or a body (`:28-31, :94`).
- The key and app id travel as the `X-Algolia-Application-Id` and `X-Algolia-API-Key` headers.
- Each search sends `analytics=false`, so the app's lookups don't count in Super-Pharm's own search statistics (Algolia counts them by default, §3.4). It also asks only for the attributes the adapter maps.

**No EAN search**

- `lookupInShop` searches by EAN first whenever the product has one, then by name only when the EAN search found nothing. `lookupChoicesInShop` runs both (S-05 @ 50fb7c6: `src/lib/services/shop-matching.ts:57-85, :96-138`).
- Against an index without EANs, the EAN search costs one request per lookup and per re-pin. It can find the product only if some other attribute happens to hold those digits (inferred). Probe P5 records what it returns.
- S-06 needs a way for an adapter to say it has no EAN search, such as a field on `ShopAdapter` (S-05 @ 50fb7c6: `src/lib/services/shops/registry.ts:13-25`), so both lookups go straight to the name search.

**The name query**

- `nameQuery` joins the product's brand, name and size text through `toShopQuery`, which keeps 2–80 allowed characters (S-05 @ 50fb7c6: `src/lib/services/shop-matching.ts:145-148`; `src/lib/services/search-query.ts:5-8, :39-45`). For Nivea Soft that's "NIVEA Soft 300 ml".
- Algolia's search is generally understood to need every query word in a record unless the query relaxes that (its `removeWordsIfNoResults` and `optionalWords` parameters). This research didn't verify that default or whether Super-Pharm's index overrides it. If it holds and `capacity` isn't a searchable attribute, the words "300 ml" could empty a search that would otherwise find the item.
- An empty answer is stored as "not found" (S-05 @ 50fb7c6: `src/lib/services/shop-matching.ts:83-84, :328-353`), which a retry can fix but the user has to notice first.
- Probes P3 and P4 compare the query with and without its size. The options are Open Question 6.

**A candidate, field by field** (each needs probe P3's recording)

| Candidate field | From                      | Notes                                                                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shopItemId`    | `objectID`                | The extension sets `objectID` to the Magento product id, and `sku` separately (§3.4). The sample's `sku` is "39477" (`:136`); the `objectID` format isn't recorded. Only `objectID` is sure to work in the pinned filter (§5). It must pass `shopItemIdSchema` (S-05 @ 50fb7c6: `src/lib/services/matches.ts:34-37`). |
| `name`          | `name`                    | "Nivea Soft Krem nawilżający (Pudełko)" (`:135`).                                                                                                                                                                                                                                                                     |
| `brand`         | `brand`                   | "Nivea" agrees with Rossmann's "NIVEA" under `brandsAgree` (`src/lib/services/matching.ts:51-58`).                                                                                                                                                                                                                    |
| `sizeText`      | `capacity`                | "300 ml" (`:138`) parses as 300 ml (S-05 @ 50fb7c6: `src/lib/services/size.ts:22-34`), and so would "300ml". A multipack such as "2 x 50 ml" gives no size, which shows as "Rozmiar nieznany" (S-05 @ 50fb7c6: `src/lib/services/match-view.ts:266-270`).                                                             |
| (no size)       | `farmax_capacity`         | 300 without a unit (`:139`): not a size on its own. S-05 refused Hebe's unit-less `Pojemność` even as a cross-check (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:82`).                                                                                                                                |
| `eans`          | none                      | Always empty. The confirm form accepts an empty list (S-05 @ 50fb7c6: `src/lib/services/matches.ts:113`).                                                                                                                                                                                                             |
| `productUrl`    | `url`                     | Absolute https on `www.superpharm.pl` in the sample (`:144`), and absolute per the extension's source (§3.4). `isProductUrl` checks that host.                                                                                                                                                                        |
| `imageUrl`      | `thumbnail_url`           | Absolute per the extension's source (§3.4), but its host isn't recorded, so `isImage`'s host is open until probe P3.                                                                                                                                                                                                  |
| `offer`         | `price.PLN.*`, `in_stock` | See §7.                                                                                                                                                                                                                                                                                                               |

- **Per-hit parsing** (`context/foundation/lessons.md:19-24`): each hit is checked on its own, and an answer whose hits all fail their check is `failed`, never "found nothing", as the Luigi's Box client does (S-05 @ 50fb7c6: `src/lib/services/shops/luigis-box.ts:101-116`).
- **The choice's wording**: a Super-Pharm candidate never gets "Ten sam EAN" (S-05 @ 50fb7c6: `src/lib/services/match-view.ts:263-265`). The intro reads "Znalezione w Super-Pharmie po nazwie" (`:285, :300`).

### 3. The search key (Q2)

#### 3.1 What the key is

- Every Super-Pharm page embeds `algoliaConfig` with the app id, the base index name and the search-only key (research note `:118`).
- On 2026-09-23 a Worker on the project's account read it from `https://www.superpharm.pl/` and searched with it, both answering 200 (`:297-298`; `context/deployment/deploy-plan.md:246-254`).
- The key quoted on 2026-09-17 (`:118`), 100 characters of base64, decodes locally to `64fba8d6…88efc8tagFilters=`: a 64-character hex HMAC, then the query string `tagFilters=` with an empty value. That's the documented shape of an Algolia secured key (§3.4).
  - With no `validUntil` in it, it doesn't expire on its own.
  - The empty `tagFilters` restricts nothing. The v3.9.1 extension adds it when no tag filter is set, "to handle a difference between API client v1 and v2" (§3.4).
  - It changes only if Super-Pharm regenerates the parent key or changes the extension's restrictions. v3.9.1 computes it on every page, but it comes out the same each time.
  - From v3.14.0 the extension adds a 24-hour `validUntil`, so after such an upgrade the key would change daily and expire with a 400 (§3.4).
- **The key carries its own expiry.** Since a secured key is base64 of the HMAC plus its parameters, a reader can decode `validUntil` when one is present. It can then fetch a fresh key before the old one ends, without first spending a rejected request.
- The note's "it rotates with deployments, so read it from the page at runtime" (`:118`) cites no second key. **Verdict: unsupported.** Nothing recorded shows it, and the v3.9.1 source makes the key stable between configuration changes. It would become true in effect after an upgrade to v3.14.0 or later. Probe P2 compares today's key with the 2026-09-17 one.

#### 3.2 Reading it at runtime

- **Through the gate:** a GET of `https://www.superpharm.pl/`, whose host the gate already lists (`src/lib/services/shop-gate.ts:13`).
  - It is charged to `super-pharm`: one reservation under the cap of 30 a minute that the shop's searches share.
  - No redirect is followed (`:127-128`). The homepage answered 200 directly (research note `:297`), but a page that starts redirecting would turn every key read into a failure until the URL changes.
- **Time:** the gate's 8 s timeout covers reading the body (`src/lib/services/shop-gate.ts:57-59, :119`). The 2026-09-23 read from Warsaw recorded 41 ms (research note `:297`), without saying whether that covered the whole body.
- **CPU and memory** (Cloudflare docs, read by a worker on 2026-10-04, https://developers.cloudflare.com/workers/platform/limits/):
  - Workers Paid allows 30 s of CPU by default; waiting on the network doesn't count. Memory is 128 MB per isolate.
  - Decoding and scanning about 2 MB should take a few milliseconds, but that is inferred, not documented.
  - The read already ran on the Free plan's 10 ms "with no CPU-limit errors" (research note `:306`).
- **workerd versus Node:**
  - The risk register asks for `fetch`, regex or `HTMLRewriter` and a run through workerd (`context/foundation/infrastructure.md:100`).
  - HTMLRewriter isn't available in Node, so Vitest couldn't run it (Cloudflare docs, https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/).
  - `response.text()` plus a string search runs in both. Stopping the read early with `reader.cancel()` saves work only if `algoliaConfig` sits early in the page, which probe P2 measures.
- **Robots:**
  - The research note calls superpharm.pl's robots.txt "Magento defaults" (`:252`), without saying whether it refuses AI crawlers.
  - Test-plan §6.4 never records a page whose robots.txt refuses them (S-05 @ 50fb7c6: `context/foundation/test-plan.md:149`), and CLAUDE.md stops for a shop that "asks" (`CLAUDE.md:20`).
  - Probe P1 reads robots.txt before anything else.
- **What the reader must check** before the key goes into a header (`context/foundation/lessons.md:19-24`):
  - the app id equals the constant;
  - the index name is the expected base;
  - the key has a secured key's shape.

  A page without a readable config is `failed` and logged, never "not found".

#### 3.3 Where the key could be kept

| Option                                                                                                             | Shared by                       | Page reads                                                                | Needs                                                                                                                                                 | What a signed-in user could do with a direct call                                                                                                                 | On rotation                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. A constant, as `NATURA_TRACKER_ID`                                                                              | every request                   | none                                                                      | a code change per rotation                                                                                                                            | nothing                                                                                                                                                           | every Super-Pharm request fails until a deploy. Under today's gate the first 403 stops the shop (§3.4). After an extension upgrade the constant would expire within a day |
| B. A constant, re-read from the page when Algolia rejects it or its `validUntil` nears, then kept in module memory | each isolate, after a change    | none while the constant works; then one per isolate that meets the change | a page reader. An expired key (400) heals without a gate change; a rotated parent key (403) needs the gate exception (Open Question 2)                | nothing                                                                                                                                                           | heals itself per isolate; a log line tells the owner to update the constant                                                                                               |
| C. Read at runtime, kept in module memory (one read in flight)                                                     | each isolate                    | one per isolate that has none yet, and one per expiry after an upgrade    | a page reader; the gate exception to heal after a rotated parent key                                                                                  | nothing                                                                                                                                                           | heals per isolate                                                                                                                                                         |
| D. The database: a column on `public.shops` or a table, through `security definer` functions                       | every request                   | one per rotation                                                          | a migration and the owner's `db push` before the merge; two functions with explicit grants; a case in a database check script                         | any signed-in user could write a wrong key (`context/foundation/lessons.md:33-38`): one 403, then a re-read with the exception, or a stop for everyone without it | heals for everyone after one re-read                                                                                                                                      |
| E. The Cache API                                                                                                   | one data center                 | one per data center and expiry                                            | no binding; `put()` resolves whether or not it stored anything                                                                                        | nothing                                                                                                                                                           | needs the exception too                                                                                                                                                   |
| F. Workers KV                                                                                                      | every request, after up to 60 s | one per rotation                                                          | a new binding and namespace, which the deploy plan says to turn on deliberately (`context/deployment/deploy-plan.md:68`); not importable under Vitest | nothing (no API role reaches KV)                                                                                                                                  | heals for everyone                                                                                                                                                        |

Facts behind the table:

- **The Natura precedent.** S-02 kept Natura's tracker id as a constant to avoid reading "a 3.3 MB page that redirects" (`context/archive/2026-09-27-shop-matching-first-two-shops/plan-brief.md:33, :54`), and S-05 did the same for Hebe (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:90`). CLAUDE.md tells the owner to update the constant when Luigi's Box rejects it (`CLAUDE.md:52`).
- **Module memory.** Cloudflare: "Workers reuse isolates across requests. A variable set during one request is still present during the next", but "isolates are not necessarily long-lived", and there is "no guarantee that any two user requests will be routed to the same or a different instance" (https://developers.cloudflare.com/workers/best-practices/workers-best-practices/, https://developers.cloudflare.com/workers/reference/how-workers-works/). For a handful of users, many requests will meet a fresh isolate (inferred).
- **The Cache API.**
  - Its contents "do not replicate outside of the originating data center".
  - The docs' sentence that operations on `*.workers.dev` "will have no impact" was removed on 2025-03-05 (cloudflare-docs commit 935b0366c6, "Remove workers.dev Cache API restriction"), but no page says outright that it works there.
  - Miniflare keeps it in memory (https://developers.cloudflare.com/workers/runtime-apis/cache/).
- **KV.**
  - A `kv_namespaces` binding.
  - Changes "may take up to 60 seconds or more" to reach other locations, and one write per second per key.
  - Read in Astro 6+ through `import { env } from "cloudflare:workers"`, which Vitest under Node can't import, so the service would take the namespace as a parameter (https://developers.cloudflare.com/kv/concepts/how-kv-works/, https://docs.astro.build/en/guides/integrations-guide/cloudflare/).
- **Today's Worker.** It has only the `ASSETS` binding and `session: false` (`wrangler.jsonc`; `astro.config.mjs:32-34`), and the env schema holds only the two Supabase secrets (`astro.config.mjs:64-69`).
- **Fetch caching doesn't help.** A cached copy of the page still hands the Worker 1.8 MB to scan, and whether `cacheTtl` works for a workers.dev Worker isn't documented (Cloudflare docs, read by the worker). Only caching the extracted key saves the work.

#### 3.4 When the key is rejected, and what Algolia documents

A worker read these on 2026-10-04 from Algolia's documentation, its API specification (`algolia/api-clients-automation`), its JavaScript client and the Magento extension's source (`algolia/algoliasearch-magento-2`). "Secondary" marks evidence from third-party issue threads or support-article titles; "inferred" marks a conclusion no source states.

**Secured keys**

- **The format.** "Compute a SHA-256 HMAC with: Secret: the parent API key; Message: a URL-encoded list of query parameters … Concatenate the SHA-256 HMAC with the list of query parameters … Encode the resulting string in base64" (https://www.algolia.com/doc/libraries/sdk/methods/search/generate-secured-api-key). The decoded 2026-09-17 key has exactly that shape.
- **Expiry.** `validUntil` is the "Timestamp when the API key expires". Without it, a secured key lives as long as its parent: "To revoke a secured API key, revoke the base API key", and "Deleting a main API key also deletes all derived secured API keys" (https://www.algolia.com/doc/guides/security/api-keys/).
- **How the extension builds it.**
  - v3.9.1 builds the frontend key from the search-only key and the customer group's restrictions (`Block/Configuration.php`).
  - It sets `tagFilters` to an empty string when absent (`Helper/AlgoliaHelper.php`, lines 184–191 of that version), and it adds no `validUntil`.
  - From v3.14.0 it adds `validUntil = time() + 24 h` (`ALGOLIA_API_SECURED_KEY_TIMEOUT_SECONDS = 60 * 60 * 24`). Algolia's support notes that such a key "remains in cache during the cache lifetime of the page" (support article 35335250877329), so a cached page can hand out a key close to its end.

**Error answers**

| Situation                                       | Status | Body                                                                                                                                     | Evidence                                           |
| ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| A deleted, regenerated or wrong key             | 403    | `{"message":"Invalid Application-ID or API key","status":403}`; the API spec's own example spells it "Invalid Application-Id or API-Key" | secondary (issue threads); spec example            |
| A secured key past its `validUntil`             | 400    | "validUntil parameter expired (less than current date)"                                                                                  | secondary (support article 35335250877329's title) |
| An operation the key's rights don't cover       | 403    | "Method not allowed with this API key."                                                                                                  | documented (the spec's 403 response)               |
| An index that doesn't exist                     | 404    | "Index not found."                                                                                                                       | documented (spec)                                  |
| An IP over a per-IP limit set on the parent key | 429    | none recorded; the default limit is none                                                                                                 | documented                                         |

- Error bodies are JSON with a `message`, but Algolia's own client falls back to raw text when the body doesn't parse, so a non-JSON error can't be ruled out (inferred).
- The research note's 403 for listing indices with this key (`:148`) fits the "Method not allowed" row.

**Requests**

- The current API documents a search of one index as `POST /1/indexes/{indexName}/query`. The legacy REST docs allowed a GET on `/1/indexes/{indexName}` but called it discouraged, and the old JavaScript client used GET only as a fallback.
- **Credentials:** the `X-Algolia-Application-Id` and `X-Algolia-API-Key` headers.
- **Sizes:**
  - `hitsPerPage` goes up to 1000.
  - "Query strings can be up to 512 bytes long", and the spec adds: "Each parameter value, including the `query` must not be larger than 512 bytes."
  - Another page sets a limit of 1,000 combined filters. The two limits disagree, so the stricter one is the safe reading (inferred).
- **Smaller, neutral answers:**
  - `attributesToRetrieve` keeps only the listed attributes, with `objectID` always included.
  - `attributesToHighlight=[]` turns highlighting off, and `responseFields` trims the answer.
  - `analytics` defaults to true, so a search counts in the shop's search analytics unless it sends `analytics=false`.
- **Filtering:**
  - "`_tags` and `objectID` are always available" as filters, without being declared.
  - A string attribute must be declared for faceting to be filterable, and a filter on an undeclared one returns no hits rather than an error (secondary).
  - v3.9.1 declares only the configured facets plus `categories` and `categoryIds`, so a `sku:` filter would most likely answer with nothing (inferred).
- **getObjects** (`POST /1/indexes/*/objects`) needs the `search` right and answers a missing id with `null`. Whether a secured key may call it isn't documented.
- **Hosts:** the `-dsn` host alone serves reads; the `algolianet.com` hosts are a client's failover.

**The product record** (v3.9.1 source)

- `objectID` is the Magento product id; `sku` is a separate attribute.
- `url` and `thumbnail_url` are absolute.
- `price.<currency>.default` is a rounded number: the lower of the regular price and the special or catalog-rule price when the record was indexed. `default_formated` is its text.
- `default_original_formated`, the regular price as text, is present only while a promotion runs.
- `special_from_date` and `special_to_date` are Unix seconds, or `''` when unset.
- Customer-group prices (`group_<id>`, `group_<id>_formated`, …) appear only when customer groups are enabled.
- The record keeps an ended promotion until the next reindex. The extension's own frontend swaps it out once `algoliaConfig.now > special_to_date + 1` (`common.js`).
- `in_stock` is computed from a boolean, yet the sample shows `1`.
- With Magento's `show_out_of_stock` off, an out-of-stock product is deleted from the index.
- `default_historical_min_price_formated` appears nowhere in the extension's source or changelog, so it's Super-Pharm's own addition (inferred).

**What these answers do under today's gate**

| Algolia's answer                        | The gate today (`src/lib/services/shop-gate.ts`)                                                          | What the adapter gets |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------- |
| 403, key deleted, regenerated or wrong  | discards the body, reports a block, and the shop stays stopped until the owner re-enables it (`:136-143`) | `blocked`, no body    |
| 403, a request outside the key's rights | the same                                                                                                  | `blocked`, no body    |
| 400, a key past its `validUntil`        | discards the body, no report (`:151-155`)                                                                 | `failed`, status 400  |
| 404, an index renamed                   | the same                                                                                                  | `failed`, status 404  |
| 429                                     | pauses the shop (`:144-150`)                                                                              | `rate-limited`        |

- A rotated parent key is therefore a stop.
  - Every user who then looks Super-Pharm up reads "Wyszukiwanie w sklepie Super-Pharm jest wyłączone, bo sklep zablokował zapytania. Właściciel musi je ponownie włączyć." (`src/lib/shop-messages.ts:26-27`).
  - The stored reason is "HTTP 403" without the host (`supabase/migrations/20260926112205_polite_shop_access.sql:108-114`). Only the gate's log line names the host (`src/lib/services/shop-gate.ts:94`), so the owner needs Workers Logs to tell a key problem from a firewall.
- An expired key and a renamed index are failures, not stops. Without the body, the adapter can't tell a 400 for an expired key from a 400 for a malformed request. Reading `validUntil` from the key (§3.1) avoids relying on the 400 at all.

**Options for the gate** (Open Question 2)

- **G1, a narrow exception.**
  - On Super-Pharm's Algolia host only, a 403 whose JSON `message` reads as the invalid-key message becomes `failed` with a note, and no block is reported. The match is loose, given the two spellings, and the body is read only in that case and only up to a small bound.
  - The adapter then reads the key from the page once and repeats the request once. If the fresh key is rejected too, the block is reported as today.
  - Every other 403 keeps today's rule, a "Method not allowed" one included. So does every challenge and every 429.
- **G2, no change.** A rotated parent key is a stop, which the owner handles: update the key if it's a constant, then re-enable the row. Users see the "zablokował" text meanwhile.
- **Politeness** (`CLAUDE.md:20`). An invalid-key answer says the app's copy of a public credential is out of date. It isn't the shop asking the app to stop, and reading the key from the page is what every browser visit to the shop does. G1 retries nothing that refused: one extra page read and one repeat per action at most, and a second rejection stops the shop as today.
- **The exception should stay inside the gate.** The gate keeps the politeness rules in one place (`src/lib/services/shop-gate.ts:4-6`). A rule there, keyed by host and body, keeps them auditable. A hook passed in by an adapter would let any adapter weaken the stop.

### 4. Matching without an EAN (Q3)

**The rule as it stands**

- `pickMatch` accepts exactly one candidate that shares an EAN and the size and whose brand doesn't differ. Otherwise the user chooses from up to `limit` candidates (3 by default), qualifying ones first, then the rest in the shop's order (`src/lib/services/matching.ts:74-94`).
- With no EAN on any Super-Pharm candidate, none qualifies. A first lookup with hits always gives a choice of Algolia's first 3, and a re-pin offers up to 6 (S-05 @ 50fb7c6: `src/lib/services/shop-matching.ts:43-44`).
- What the project already says:
  - FR-006 accepts automatically only on an exact EAN and size (`context/foundation/prd.md:101-104`).
  - Test-plan risk #6 asks that "a shop without EANs can't auto-accept" (`context/foundation/test-plan.md:48`).
  - The S-08 plan review named "S-05/S-06 may auto-accept on name and size" as a blind spot (`context/archive/2026-10-01-fix-matches-and-watchlist/reviews/plan-review.md:47`).
  - CLAUDE.md: "Super-Pharm's search index has none" (`CLAUDE.md:22`).

**The options**

| Option                                        | Automatic matches                                             | Extra requests on a first lookup                                             | Fits                                                | Costs and risks                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (a) Never automatic: always the user's choice | none                                                          | 0                                                                            | FR-006, test-plan #6, the rule unchanged            | One choice per product. Until it's made, each own-navigation view repeats the name search, because a pending choice isn't stored (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/research.md:268`).                                                                                                                                               |
| (b) Read `gtin13` from candidates' pages      | when exactly one candidate's page EAN, size and brand qualify | 1 page per candidate checked: up to 3 on a first lookup, up to 6 on a re-pin | FR-006 literally (an EAN from the shop)             | Product-page size isn't recorded (the homepage is 1.8 MB). A moved product URL redirects and fails. The gate logs a failed request's path whole except all-digit segments (`src/lib/services/shop-gate.ts:94, :238-244`), and a product slug names what a user looked at. More fixtures and parsers. Only the 2026-09-17 note shows `gtin13` (`:130`). |
| (c) Brand, size and name similarity           | when similarity passes a threshold                            | 0                                                                            | contradicts FR-006's EAN condition and test-plan #6 | Needs a PRD update. The research note offers this only as a fallback "when EAN data is missing or wrong" (`:264`).                                                                                                                                                                                                                                     |

**What option (a) brings with it**

- **The first lookup's order.** Since no candidate qualifies, the 3 shown are Algolia's first 3 (`src/lib/services/matching.ts:86-88`). A candidate with the same size and an agreeing brand could sit fourth. Ordering a no-EAN shop's candidates by their verdict (same size and agreeing brand first) is a change to `pickMatch`'s order, which reaches every shop (Open Question 8).
- **"Do sprawdzenia".** Under S-05's rule, a product with any matched shop undecided counts (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:645`). With no automatic Super-Pharm matches, every product sits there until the user decides (Open Question 12).
- **Repeated views.** Each view of an undecided product costs a search until the user decides (§6). The option of a button instead is Open Question 5.

### 5. Pinned prices: batches, missing and failed (Q4)

**What a fetcher must do** (S-05's contracts)

- `(gate, ids) => Promise<Map<string, PriceCheck>>`: a check for every id, one request at a time within the shop, and no further request once the shop refuses (S-05 @ 50fb7c6: `src/lib/services/price-refresh.ts:35-39`; `src/lib/services/shops/luigis-box.ts:119-153`).
- An id is `missing` only when every hit was read and was one asked for; otherwise `failed` (S-05 @ 50fb7c6: `src/lib/services/shops/luigis-box.ts:197-209`).
- No request at all for no ids, since `refreshPrices` calls every listed shop's fetcher (S-05 @ 50fb7c6: `src/lib/services/price-refresh.ts:74-78`). For Super-Pharm, no key read either.
- `missing` keeps the last price, marked out of date, and never un-pins the match (`context/foundation/prd.md:76`).
- **A stored id is user input** (`CLAUDE.md:52`; `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:655`). Hebe accepts only digits before an id goes into a filter (S-05 @ 50fb7c6: `src/lib/services/shops/hebe.ts:162-165`). Super-Pharm needs the same strict check, so a crafted id can't change the filter expression.

**The candidate requests** (Algolia's documented behaviour in §3.4)

| Request                                                                                                                                                        | Requests for n stale items | Replay                   | Open points                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (i) A search, `POST …/query`, with an empty query, `filters` of `objectID:<id>` joined by OR, `hitsPerPage` n, only the price attributes and `analytics=false` | ⌈n / batch⌉, batch ≤ ~20   | needs body matching (§2) | none from the docs: `objectID` is always filterable and search is what the key is for. Probe P6 still records the real answer, a known and an unknown id together |
| (ii) getObjects, `POST /1/indexes/*/objects`                                                                                                                   | ⌈n / batch⌉, up to 1000    | needs body matching      | not documented for secured keys; if refused, the 403 stops the shop under today's gate. Probe P7 first, from the developer machine                                |
| (iii) one `GET /1/indexes/<index>/<objectID>` per item                                                                                                         | n                          | works as today           | the same permission question as (ii); n requests where (i) needs ⌈n / 20⌉                                                                                         |

- **Store the `objectID`.** The extension sets it to the Magento product id and keeps `sku` apart. A `sku:` filter would most likely answer with no hits (§3.4), which would store every pinned item as `missing` and mark its price out of date for everyone who watches it. That is the quiet wrong state the lessons warn about (`context/foundation/lessons.md:19-24`).
- **Batch size.** Luigi's Box asks for 50 ids per request (S-05 @ 50fb7c6: `src/lib/services/shops/luigis-box.ts:16-17`). Algolia limits a parameter value to 512 bytes (§3.4). `objectID:1234567 OR ` is 20 bytes, so one filter holds 25 seven-digit ids, and a batch of 20 leaves room. The id length is inferred: entity ids aren't recorded. Probe P11 can test a longer filter if the plan wants bigger batches.
- **Missing versus failed.** An asked-for id absent from an answer is `missing` only when every hit was read and was one asked for, and when `nbHits` doesn't exceed the hits returned. Otherwise every id of the batch is `failed`, as in the Luigi's Box client (S-05 @ 50fb7c6: `src/lib/services/shops/luigis-box.ts:197-209`).
- **Vanished versus out of stock.**
  - An item Super-Pharm removes from the index reads as `missing`. The match stays, and the last price is shown as out of date (`context/foundation/prd.md:76`).
  - With Magento's `show_out_of_stock` off, an out-of-stock item leaves the index too, so it would read as `missing`, not as "not orderable online" (§3.4). Probe P3 shows whether `in_stock` 0 items exist in the index.

### 6. What each page view and action costs Super-Pharm (Q4)

`context/foundation/lessons.md:12-17` requires this table. The Natura and Hebe column is S-05's table (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:111-123`).

- **K** is one read of the page that carries the key. It's 0 when a usable key is at hand, which is always under option A of §3.3, under B until the key changes, and under C after the isolate's first read. Otherwise it's 1.
- **R** is the cost of a key Algolia refuses: one more page read and one repeat of the request, at most once per action.
  - For an expired key (400), R applies whatever the gate does. Reading `validUntil` from the key avoids even that.
  - For a rotated parent key (403), R applies only with the gate exception. Without it, the first 403 stops the shop.

| Action                                                       | Rossmann                                 | Natura, Hebe (each)                                                                   | Super-Pharm                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product view, own navigation, decision stored                | ≤ 1, if stale                            | ≤ 1, if matched and stale                                                             | ≤ 1 + K, if matched and stale                                                                                                                                                                                                                                     |
| Product view, own navigation, no decision                    | ≤ 1                                      | 1–2 searches in the render, then ≤ 1 (0 after an automatic match with a stored offer) | Today's flow: 1 name search + K in the render (2 searches if the EAN search isn't skipped), repeated on every such view until the user decides, since nothing is matched automatically. With a button instead (Open Question 5): 0, and 1 name search + K per tap |
| The first view after the user's pick                         | ≤ 1, if stale                            | ≤ 1 for the picked shop                                                               | ≤ 1 + K: the pick stores no price                                                                                                                                                                                                                                 |
| `?repin=super-pharm`, own navigation                         | 0                                        | 0 for the others                                                                      | 1 name search + K (2 if the EAN search isn't skipped)                                                                                                                                                                                                             |
| `?retry=super-pharm` over a stored "not found"               | ≤ 1                                      | ≤ 1 each, if matched and stale                                                        | 1 name search + K                                                                                                                                                                                                                                                 |
| Another site's link, a prefetch, the prompt, a decision post | 0                                        | 0                                                                                     | 0                                                                                                                                                                                                                                                                 |
| The product's "Odśwież ceny"                                 | 1                                        | 1 if matched                                                                          | 1 + K if matched                                                                                                                                                                                                                                                  |
| The list's "Odśwież ceny"                                    | 1 per distinct stale item, one at a time | ⌈distinct stale ids / 50⌉, one at a time                                              | ⌈distinct stale ids / batch⌉ + K, one at a time, with a batch of about 20 (§5); nothing, not even K, without a stale Super-Pharm item                                                                                                                             |
| Any of the above with a refused key                          | –                                        | –                                                                                     | + R                                                                                                                                                                                                                                                               |

- **The cap.** Page reads count against Super-Pharm's 30 a minute like its searches (`supabase/migrations/20260926112205_polite_shop_access.sql:9`). Super-Pharm's two hosts share that one cap, unlike Natura and Hebe, which share a host but each have their own (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:946`).
- **Subrequests.** A first open with Natura, Hebe and Super-Pharm undecided runs three lookups at once, each shop's requests one at a time, so at most three shop requests are open at once. Workers Paid allows 10,000 subrequests a request, and only connections still waiting for headers count towards its 6 (https://developers.cloudflare.com/workers/platform/limits/). Under options B and C, one key read adds a reservation and a page request to Super-Pharm's chain.
- **The wait.** Each search waits at most 4 s in the Luigi's Box client (S-05 @ 50fb7c6: `src/lib/services/shops/luigis-box.ts:12-15`). With a key read in front, Super-Pharm's first search can wait for the page first, and the gate allows up to 8 s for it (`src/lib/services/shop-gate.ts:18`), so the page read needs its own shorter timeout to keep a first open near today's 8 s worst case.

### 7. Orderable online, the price and the Omnibus low (Q5)

**Recorded** (one hit, 2026-09-17, research note `:133-145`)

- `price.PLN.default` 36.99 (a number); `default_formated` "36,99 zł"; `default_historical_min_price_formated` false; `in_stock` 1.
- Listed but without recorded values (`:129`): `special_from_date`, `special_to_date`, `showRedPrice`, `isProductRx`, `pharmaceuticalFlag`.

**The mapping and its open points** (the v3.9.1 record's documented shape is in §3.4)

| Offer field      | Source                                                                                              | Open point (probe)                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `price`          | `price.PLN.default`, the lower of the regular and the promotional price when the record was indexed | what it holds once a promotion has ended but the record hasn't been reindexed (P9)                                                                                                                                                                                                           |
| `regularPrice`   | `price.PLN.default_original_formated`, text present only while a promotion runs                     | its exact format (P9). `storableOffer` keeps it only above the price (`src/lib/services/shops/shop-offer.ts:24-37`)                                                                                                                                                                          |
| `lowestPrice30d` | `default_historical_min_price_formated`, Super-Pharm's own field                                    | text such as "36,99 zł", or `false`, which gives null. An unreadable text costs only this field, as `storableOffer` drops an odd 30-day low (`:19-23`). What it reports without a promotion is unrecorded                                                                                    |
| `promoEndsOn`    | `price.PLN.special_to_date`, Unix seconds or `''`, as a date in Poland                              | which day a midnight timestamp names (P9). Without it, an ended promotion could stay cheapest: the S-03 rule needs the end date (S-05 @ 50fb7c6: `src/lib/services/price-comparison.ts:116-140`). Hebe sends none and lives with null (S-05 @ 50fb7c6: `src/lib/services/shops/hebe.ts:157`) |
| `available`      | `in_stock`, 1 or `true`                                                                             | what an out-of-stock item looks like if it stays in the index, and whether `isProductRx` items appear in the drugstore index (P3)                                                                                                                                                            |

- **An ended promotion still in the record.**
  - The record keeps a promotion's price until the next reindex, while Super-Pharm's own frontend already shows the regular price once `special_to_date` has passed (§3.4).
  - The adapter can mirror the frontend: after the end, price at the regular price parsed from `default_original_formated`, with no promotion.
  - Or it can store `default` with its end date and let the S-03 rule show it as out of date, never cheapest (S-05 @ 50fb7c6: `src/lib/services/price-comparison.ts:116-133`).
  - Open Question 11.
- **Club prices.** "Super-Pharm has club prices" (research note `:272`), and the record carries customer-group prices (`group_<id>…`) beside `default` when customer groups are enabled (§3.4). The comparison names the cheapest price anyone can order online, labelled as online (`context/foundation/prd.md:51`), so only the guest price `default` counts. The other shops' app and loyalty prices are left out the same way (research note `:272`). Open Question 11.
- **Polish formatted prices** can carry a space or a no-break space as the thousands separator (inferred). A strict parser that returns null for anything else keeps a misread from becoming a price (`context/foundation/lessons.md:19-24`).

### 8. What S-06 needs from S-05, what can come earlier, and the ordering risks (Q6)

**From S-05** (S-05 @ 50fb7c6 unless marked)

- `MATCHABLE_SHOPS` gains `super-pharm`, with its label in `SHOP_LABELS` and its adapter in `SHOP_ADAPTERS`. `PRICE_FETCHERS` follows from the registry. `MATCHED_SHOPS` gains it last, as the switch (`src/lib/services/price-comparison.ts:29-77`; `src/lib/services/shops/registry.ts:27-40`; `src/lib/services/price-refresh.ts:41-49`).
- **The label.** S-05's label forms (`context/changes/hebe-in-comparison/plan.md:131-146`) in Polish:

  | `name`      | `in`            | `of`         | `title`     | `site`        |
  | ----------- | --------------- | ------------ | ----------- | ------------- |
  | Super-Pharm | w Super-Pharmie | Super-Pharmu | Super-Pharm | superpharm.pl |

  Sentences then read "Tylko w Super-Pharmie", "Zapisano: brak w Super-Pharmie.", "sklep Super-Pharm zostanie sprawdzony", "Natura, Hebe i Super-Pharm czekają na dopasowanie", and the footer "rossmann.pl, drogerienatura.pl, hebe.pl i superpharm.pl".

- **A colour.** `--shop-super-pharm` in `:root` and `.dark`, `--color-shop-super-pharm` and a `SHOP_FILLS` entry, as S-05 Phase 6 does for Hebe (`context/changes/hebe-in-comparison/plan.md:726-736`). The shop colours are blue at hue 259 and mint at 158 (`src/styles/global.css:57-58`, the same on `main`), with Hebe's pink at 350 planned. `scripts/check-token-contrast.mjs` requires oklch in both blocks. The owner picks the hue (Open Question 13).
- **What S-05 Phases 5–6 still have to build** (`context/changes/hebe-in-comparison/plan.md:628-814`): the list per shop, the footer join, the e2e helpers (`matchShop` and a `cardOf` for any label), `auth.setup.ts` proving every priced shop stopped, and the three-shop kitchen sinks. S-06 adds a fourth shop to each.
- **Tests that name Super-Pharm as "not switched on" and will flip:**
  - `src/lib/services/matches.test.ts:443` (`it.each(["rossmann", "super-pharm", "dm", ""])`).
  - S-05 Phase 6 makes Super-Pharm the "not fetched" example (`context/changes/hebe-in-comparison/plan.md:742`). After S-06 no `ShopId` is left outside `PRICED_SHOPS` (`src/types.ts:2`), so those tests must pass a narrower shop list, which `refreshPrices` and the other rules take (`src/lib/services/price-refresh.ts:65-70`).
  - `src/components/watchlist/price-comparison-state.test.ts:118-122` types a `Record<PricedShop, …>`.
  - `src/lib/services/price-refresh.test.ts:115-129` maps a request to its shop by host and tracker, and throws for Algolia's host.
- **The adapter interface** may gain a "no EAN search" field (§2), and a per-adapter name query if Open Question 6 goes that way.

**Before S-05 merges**

- **No code dependency:**
  - the owner's decisions;
  - the probes and recordings (§ Proposed probes);
  - the gate exception, if chosen. S-05 changed neither `src/lib/services/shop-gate.ts` nor any migration (`git diff 1a74a2a 50fb7c6`), so it could be its own small change on `main`.
- **The adapter in isolation**, with fixtures and contract tests as S-05 Phase 1 did for Hebe, needs S-05's `registry.ts` and the value helpers in `luigis-box.ts`. On `main` it would duplicate them, against `context/foundation/lessons.md:40-45`. Branching from the unmerged S-05 branch would mean rebasing on whatever its review changes.

**Ordering risks**

- S-05 Phases 5–7 can still change the contracts S-06 extends: the list's per-shop states (uncommitted Phase 5 edits exist in the main checkout), the label texts and the e2e helpers.
- S-07 replaces the starter's sign-up and changes `tests/e2e/auth.setup.ts` (`context/foundation/roadmap.md:204-206`). That's the e2e setup S-06's specs run on, and the owner's order puts S-07 before S-06 (`context/changes/super-pharm-in-comparison/change.md`).
- Conflicts are likely in `src/styles/global.css`, the kitchen sinks, CLAUDE.md's "Shops and matching" bullet and the research note's §2.3, which S-05 Phase 7 also edits (`context/changes/hebe-in-comparison/plan.md:818-894`).

### 9. Tests (Q7)

- **Fixtures** (`src/lib/services/shops/fixtures/super-pharm-<case>.json`), real answers recorded only with the owner's OK, under §6.4's rules (S-05 @ 50fb7c6: `context/foundation/test-plan.md:147-151`):
  - the key page: a cut copy that keeps the real `algoliaConfig` script, with the cut stated in the test header;
  - a name search, cut to its first 5 hits;
  - an EAN query with no hits, if probe P5 shows that;
  - a pinned batch with a known and an unknown id;
  - the answer to a rejected key, if probe P10 is approved; otherwise its shape comes from Algolia's documentation and is labelled so.
- **`super-pharm.test.ts`** (§6.4's cases, S-05 @ 50fb7c6: `context/foundation/test-plan.md:152-162`):
  - the mapping on the recordings, each size read back by `parseSize`;
  - `pickMatch` on the real candidates: always a choice, never accepted, with size and brand flags;
  - pinned batches: an unknown id is `missing`, a hit nobody asked for leaves the batch `failed`, 51 ids make 2 requests, and a refusal stops the rest;
  - broken copies: a field removed, a string for a number, HTML instead of JSON, no hits list, `nbHits` above the hits returned, a price text that doesn't parse, a page without `algoliaConfig`, a malformed key, a 403 with Algolia's rejected-key body, a 403 "Method not allowed", and a 400;
  - the binding: every `gate.fetch` names `super-pharm`, and every served URL is spelled out.
- **The replay helper** (`src/lib/services/testing/replay-fetch.ts`): matching an entry's body as well as its URL, with a test of its own, so POST searches can be told apart (§2). The existing Rossmann, Natura and Hebe tests pass unedited.
- **The key reader:**
  - a cached key reads no page; a first use reads one;
  - two concurrent first uses read one;
  - a key whose `validUntil` is near is read again before use;
  - a 400 and, with the gate exception, an invalid-key 403 each read the page once and repeat the request once;
  - a second rejection gives up: a block reported for the 403, a failure for the 400;
  - no ids means no read.
- **The gate**, if the exception is chosen (`src/lib/services/shop-gate.test.ts`):
  - Algolia's invalid-key 403 on Super-Pharm's Algolia host becomes `failed` with no block reported, in both spellings.
  - Every other 403 still stops the shop: another host, "Method not allowed", another body, no body, a body over the bound. So does every challenge.
- **The database**, only with option D of §3.3: what a direct call to the new functions allows, proven in a check script (`context/foundation/lessons.md:33-38`).
- **e2e** (`context/foundation/test-plan.md:118-142`):
  - extend S-05's three-shop phone spec to four shops, or add a sibling;
  - seed Super-Pharm decisions and prices directly, because choosing a candidate needs the shop's answer and stays out of the browser layer (`context/archive/2026-10-02-testing-critical-browser-flows/plan.md:66-68`);
  - assert that the request log doesn't move.
- **Manual, on the preview build:** CI never calls a shop (`context/foundation/test-plan.md:163`), and its e2e job holds every shop stopped, so neither a search nor a key read can run on workerd there. A local check against live Super-Pharm, within a request budget the owner approves, covers the workerd path (`context/foundation/infrastructure.md:100`; the "Illegal invocation" precedent in `context/foundation/test-plan.md:30`).

### 10. Risks and unknowns, and how to retire each (Q8)

| #   | Risk or unknown                                                                                                     | Evidence                                                                                            | How to retire it                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A rotated parent key (403) stops Super-Pharm for everyone and tells users the shop blocked them                     | `src/lib/services/shop-gate.ts:136-143`; `src/lib/shop-messages.ts:26-27`; §3.4                     | decision (Open Question 2); gate tests; probe P10 for this app's exact answer, since the documented spellings differ                              |
| 2   | How often the key changes                                                                                           | research note `:118` (claim without a second key)                                                   | probe P2 against the 2026-09-17 key; **2026-10-05: unchanged after 18 days**                                                                      |
| 3   | robots.txt refuses the page the key is read from                                                                    | research note `:252` (silent on AI crawlers); S-05 @ 50fb7c6: `context/foundation/test-plan.md:149` | probe P1, first; **retired 2026-10-05: no AI crawler refused, the homepage allowed**                                                              |
| 4   | The size words in the query empty a search, storing a false "not found"                                             | §2                                                                                                  | probes P3 and P4; decision (Open Question 6); **retired 2026-10-05 for the probed product: the size matched `capacity`**                          |
| 5   | The pinned request is refused (403, a stop) or its filter doesn't apply (every item "missing")                      | research note `:148`; §3.4; §5                                                                      | pin the `objectID`, never `sku`; probe P6 before any code relies on it (P7 too if getObjects is wanted); **retired 2026-10-05: the filter works** |
| 6   | Promotion fields: the price during a sale, the regular price, the end date                                          | research note `:129`, one hit without a promotion                                                   | probes P3 or P9; a mapping table on the recordings; **2026-10-05: P3 shows a promotion without its regular price or dates (Open Question 11)**    |
| 7   | A wrong user choice goes unnoticed, since under option (a) of §4 every match is the user's                          | `src/lib/services/matching.ts:101-109` flags size and brand only                                    | the flags shown while choosing; "Zmień"; option (b) of §4 if the owner wants a second check                                                       |
| 8   | The key read breaks only on workerd                                                                                 | `context/foundation/infrastructure.md:100`; `context/foundation/test-plan.md:30`                    | `response.text()` and a string search rather than HTMLRewriter; the manual check on the preview build                                             |
| 9   | Undecided products cost a search on every own-navigation view under today's flow                                    | §6                                                                                                  | decision (Open Question 5); the cost table in the plan                                                                                            |
| 10  | S-05 or S-07 change the contracts S-06 extends                                                                      | §8                                                                                                  | plan S-06 against `main` after both merge                                                                                                         |
| 11  | `scripts/check-shop-gate-db.mjs` expects exactly 30 of 40 reservations for `super-pharm`                            | `scripts/check-shop-gate-db.mjs:52-60`                                                              | keep the cap at 30, or move that check to another shop if the plan changes Super-Pharm's cap                                                      |
| 12  | A crafted stored id changes an Algolia filter                                                                       | `CLAUDE.md:52`; §5                                                                                  | digits-only (or the recorded format only) id check before a filter, with a unit case                                                              |
| 13  | Super-Pharm upgrades its extension to v3.14.0 or later, so the key expires daily and a constant breaks within a day | §3.4                                                                                                | read `validUntil` from the key; treat a 400 as a reason to read the page once; option B or C of §3.3 rather than A                                |
| 14  | A promotion that has ended stays in the record until a reindex, at its old price                                    | §3.4                                                                                                | decision (Open Question 11); a unit case with `special_to_date` in the past                                                                       |
| 15  | A 512-byte filter limit cuts a batch, or a long batch answers 400                                                   | §3.4; §5                                                                                            | a batch of about 20; probe P11 if the plan wants more                                                                                             |

## Proposed probes (need the owner's OK)

**Rules for every probe** (S-05 @ 50fb7c6: `context/foundation/test-plan.md:147-151`; `CLAUDE.md:21`)

- From the developer machine, never from CI, with `curl` and no `-L`, so no redirect is followed.
- The gate's User-Agent: `DrogeriaRadar/0.1 (+https://github.com/yaroslavkhudchenko/10xcourseproject)`.
- One request at a time, at least 2 s apart, no retries. Bodies and headers go to the session scratchpad; fixtures are cut from them later with numbers kept as written.
- Stop at the first 403, 429 or challenge, and report it to the owner instead of going on. The one planned exception is P10, whose purpose is a refusal.
- **Headers.**
  - The page probes send `Accept: text/html`, and P1 `Accept: text/plain`.
  - The Algolia probes send `X-Algolia-Application-Id: EP43QPDX9Q`, `X-Algolia-API-Key: <the key P2 reads>`, `Content-Type: application/json` and `Accept: application/json`.
- **The search URL.** The Algolia search probes P3–P6, P9 and P11 are `POST https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query`, the request the research note used (`:121-127`). Each sends the body given in the table, with `params` URL-encoded as there.

| #   | Request                                                                                                                                                                                                                                                                                                                                  | What it settles                                                                                                                                                                                                        | When                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| P1  | `GET https://www.superpharm.pl/robots.txt`                                                                                                                                                                                                                                                                                               | whether the homepage and product pages may be read, and whether AI crawlers are refused                                                                                                                                | first; if it refuses, skip P2 and P8 and bring it to the owner |
| P2  | `GET https://www.superpharm.pl/`                                                                                                                                                                                                                                                                                                         | today's `algoliaConfig` (app id, index, key, and `validUntil` if any) against the 2026-09-17 key; the page's size and where the config sits in it; a 200 without a redirect; the key reader's fixture                  | always                                                         |
| P3  | search, body `{"params":"query=NIVEA%20Soft%20300%20ml&hitsPerPage=10&analytics=false"}`                                                                                                                                                                                                                                                 | the answer's shape (`hits`, `nbHits`); every hit field and its type (`objectID`, `sku`, `capacity`, `price.PLN.*`, `special_*`, `in_stock`, `isProductRx`, `thumbnail_url`'s host); what the size words do to a search | always                                                         |
| P4  | search, body `{"params":"query=NIVEA%20Soft&hitsPerPage=10&analytics=false"}`                                                                                                                                                                                                                                                            | whether a query without the size finds what P3 missed                                                                                                                                                                  | only if P3 lacks the 300 ml item                               |
| P5  | search, body `{"params":"query=4005900009319&hitsPerPage=5&analytics=false"}`                                                                                                                                                                                                                                                            | whether an EAN query finds anything; a real empty answer for the fixtures                                                                                                                                              | always                                                         |
| P6  | search, body `{"params":"query=&filters=objectID%3A<the 300 ml item's objectID from P3>%20OR%20objectID%3A999999999&hitsPerPage=2&attributesToRetrieve=objectID%2Cprice%2Cin_stock&attributesToHighlight=%5B%5D&analytics=false"}`                                                                                                       | that the pinned filter returns the known item and simply leaves out the unknown one; the size of a trimmed answer; the pinned-batch fixture                                                                            | always                                                         |
| P7  | `POST https://ep43qpdx9q-dsn.algolia.net/1/indexes/*/objects`, body `{"requests":[{"indexName":"spprod_drugstore_pl_simple_products","objectID":"<P3's objectID>","attributesToRetrieve":["price","in_stock"]},{"indexName":"spprod_drugstore_pl_simple_products","objectID":"999999999","attributesToRetrieve":["price","in_stock"]}]}` | whether the secured search key may call getObjects (a refusal here costs nothing; in production it would stop the shop), and that a missing id reads `null`                                                            | only if the plan prefers getObjects                            |
| P8  | `GET` the `url` P3 returns for the 300 ml item (the note's was `https://www.superpharm.pl/nivea-soft-krem-nawilzajacy-pudelko-39477`)                                                                                                                                                                                                    | the product page's size, whether its JSON-LD has `gtin13`, and whether it answers without a redirect                                                                                                                   | only if the owner considers option (b) of §4                   |
| P9  | search, body `{"params":"query=nivea&hitsPerPage=20&analytics=false"}`                                                                                                                                                                                                                                                                   | a hit on promotion: `default` during a sale, `default_original_formated`, `special_to_date`'s value, `showRedPrice`, and the Omnibus text                                                                              | only if P3 has no hit on promotion                             |
| P10 | P5's request with `X-Algolia-API-Key: drogeria-radar-invalid-key-probe`                                                                                                                                                                                                                                                                  | this app's exact status, headers and body for a refused key, since the documented spellings differ: the input for the gate exception and its fixture                                                                   | only with the owner's explicit OK                              |
| P11 | search, body as P6 but with P3's objectID and 39 made-up 9-digit ids, a filter of about 870 bytes                                                                                                                                                                                                                                        | whether a filter over 512 bytes is refused (400) or served, which sets the batch size                                                                                                                                  | only if the plan wants batches over 20                         |

**Count.**

- 5 always: P1, P2, P3, P5 and P6.
- Up to 6 more on their conditions: P4, P7, P8, P9, P10 and P11.
- At most 11 requests: at most 3 to `www.superpharm.pl` (P1, P2, P8) and at most 8 to Algolia's host.
- At 2 s apart, all 11 take about half a minute. Super-Pharm's cap of 30 a minute applies to the deployment, not to the developer machine, but the probes stay well under it anyway.

## Probe results (2026-10-05)

The owner approved P1, then P2, P3, P5 and P6, on 2026-10-05. They were sent from the developer machine with `curl` (no `-L`, with `--compressed`), the gate's User-Agent and the headers named above, one at a time and at least 2.5 s apart. None was refused, redirected or challenged, so no stop rule fired. That makes 5 requests: 2 to `www.superpharm.pl` and 3 to Algolia's host.

The answers of P3, P5 and P6, and P2's config script, are kept in `probes/` for the adapter's fixtures, which the adapter's phase cuts from them before deleting the folder. Headers stay out of the repository, because Cloudflare's cookies are in them.

| #   | Sent (UTC)               | Answer                                                                              | Time   |
| --- | ------------------------ | ----------------------------------------------------------------------------------- | ------ |
| P1  | 2026-10-05T13:57:14Z     | 200 `text/plain`, 2,746 bytes                                                       | 0.21 s |
| P2  | 2026-10-05T13:58:07.857Z | 200 `text/html`, no redirect, 1,666,231 bytes decoded (263,808 gzipped on the wire) | 0.25 s |
| P3  | 2026-10-05T13:58:10.654Z | 200 JSON, 5,769 bytes, `nbHits` 1                                                   | 0.45 s |
| P5  | 2026-10-05T13:58:13.656Z | 200 JSON, 373 bytes, `nbHits` 0                                                     | 0.14 s |
| P6  | 2026-10-05T13:58:16.343Z | 200 JSON, 700 bytes, `nbHits` 1                                                     | 0.22 s |

**P1, robots.txt**

- One group, `User-agent: *`, with no rule for an AI crawler or any other named agent.
- `/` and the product pages' clean URLs are allowed. Magento's system paths are disallowed (`/catalog/…`, `/checkout/`, `/customer/` and others), and now so are `/catalogsearch/` and `/catalogsearch/result/`, which the research note recorded as allowed (`docs/research/polish-drugstore-price-apis.md:273`). The app reads neither.
- The site answers through Cloudflare (`Server: cloudflare`) and sets `__cf_bm` and `_cfuvid`, its bot-management cookies, on both page answers. Neither page was challenged. Algolia's host answers from its own servers (`Server: nginx`) and sends no rate-limit header.
- Risk #3 is retired: the page that carries the key may be read.

**P2, the homepage and its key**

- The config is a plain script constant, `const algoliaConfig = {…};`, not a `window` property. It's the first of 13 mentions of the name, at character 1,332,448 of 1,665,789 (80 % into the page), and later scripts assign to it (`algoliaConfig.resultURL = …`). Its object is 33,151 bytes of JSON, and the key appears once in the page.
- Its values: `applicationId` "EP43QPDX9Q", `indexName` "spprod_drugstore_pl_simple", `extensionVersion` "3.9.1", `priceKey` ".PLN.default", `priceGroup` null, `customerIsLoggedIn` false, `areOutOfStockOptionsDisplayed` false, `origFormatedVar` "price.PLN.default_original_formated" and `now` 1791158400 (2026-10-05T00:00:00Z, the page's day).
- **The key is the 2026-09-17 one, byte for byte** (`docs/research/polish-drugstore-price-apis.md:138`): 100 characters that decode to a 64-character hex HMAC followed by `tagFilters=`, with no `validUntil`. On risk #2: unchanged for 18 days on the same extension version, so "it rotates with deployments" stays unsupported.
- Stopping the read early would save at most a fifth of the page, so `response.text()` and a string search (§3.2) lose little. The theme is Hyvä (`x-built-with: Hyva Themes`), and the config's script is the theme's own markup, which a theme update can change.

**P3, a name search with the size**

- "NIVEA Soft 300 ml" returned exactly one hit, the 300 ml Soft, with `exhaustiveNbHits` true. Its highlights show "300" and "ml" matched `capacity`, so the size words narrowed the search instead of emptying it. That retires risk #4 for this product, and P4 wasn't needed. Algolia's prefix matching also lit "ml" in "mleczka" in a category name, which did no harm.
- The answer's keys are `hits, nbHits, page, nbPages, hitsPerPage, exhaustiveNbHits, exhaustiveTypo, exhaustive, query, params, processingTimeMS, processingTimingsMS, serverTimeMS`. Its echoed `params` add `tagFilters=`, the key's restriction.

The hit, field by field:

| Field                                | Value                                                                                                                                                       | Note                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `objectID`                           | "10132"                                                                                                                                                     | 5 digits, not the `sku`                                                                                   |
| `sku`                                | "39477"                                                                                                                                                     | also the end of the URL's slug                                                                            |
| `name`                               | "Nivea Soft Krem nawilżający (Pudełko)"                                                                                                                     |                                                                                                           |
| `brand`                              | "Nivea"                                                                                                                                                     | agrees with Rossmann's "NIVEA"                                                                            |
| `capacity` / `farmax_capacity`       | "300 ml" / 300                                                                                                                                              |                                                                                                           |
| `url`                                | `https://www.superpharm.pl/nivea-soft-krem-nawilzajacy-pudelko-39477`                                                                                       | absolute, on the shop's host                                                                              |
| `thumbnail_url`                      | `https://media.superpharm.eu/media/catalog/product/cache/c67a6870c5ebea7eb5ebe1ca04d0c8c1/n/i/nivea-soft-krem-do-twarzy-i-ciala-200ml-1_2.jpg`              | another host, `media.superpharm.eu`; the file name says 200 ml, so an image's name is no evidence of size |
| `in_stock` / `inStoreOnly`           | 1 / 0                                                                                                                                                       | `inStoreOnly` wasn't in the note's field list                                                             |
| `isProductRx` / `pharmaceuticalFlag` | false / 0                                                                                                                                                   |                                                                                                           |
| `showRedPrice` / `badges`            | 1 / ["Peeling cukrowy Pina Colada za 12,99 zł", "Promocja"]                                                                                                 | the shop shows the price as a promotion                                                                   |
| `price.PLN`                          | `default` 19.49, `default_formated` "19,49 zł", `default_historical_min_price_formated` "33,99 zł", `special_from_date` 1480001487, `special_to_date` false | no other key                                                                                              |
| `algoliaLastUpdateAtCET`             | "2026-10-05 11:16:30"                                                                                                                                       | when Super-Pharm last indexed the record, in Polish time                                                  |

- **A promotion without its regular price.** The price fell from 36,99 zł on 2026-09-17 to 19,49 zł, `showRedPrice` is 1 and a badge reads "Promocja", yet the record has no `default_original_formated`, the field the page's config names for the crossed-out price. So the shop's own search tile has no regular price to show either.
  - The extension writes that field only for a Magento special price below the regular price (§3.4), so this promotion most likely comes from elsewhere, such as a campaign (`campaignIds` lists four). That is inferred.
  - `special_from_date` is 2016-11-24 and `special_to_date` is `false`, not `''`: the dates say nothing about this promotion.
  - From such a record the adapter can take the price and the Omnibus low, but no regular price and no end date. Risk #6 is settled as far as the record goes, and Open Question 11 changes.
- **The Omnibus text** is present during the promotion and above the price, as it should be. On 2026-09-17, without a promotion, it was `false`.

**P5, an EAN query**

- "4005900009319" answered 0 hits, with `nbHits` 0 and `exhaustiveNbHits` true. That's a real empty answer, and the fixture for "nothing found". The index can't find a product by its EAN, so the adapter can skip that search (Open Question 7).

**P6, the pinned filter**

- `filters=objectID:10132 OR objectID:999999999` with an empty `query` returned 10132 alone, with `nbHits` 1: the known id answered and the unknown one was simply left out. `attributesToRetrieve=objectID,price,in_stock` trimmed the hit to those three attributes, and the whole answer to 700 bytes.
- So route (i) of §5 works with the secured key, and P7 isn't needed. An answer is complete when `nbHits` equals the number of hits returned and `nbPages` is at most 1. Risk #5 is retired.
- A pinned request should also retrieve `inStoreOnly` if the plan uses it for "orderable online".
- A 5-digit `objectID:10132 OR ` takes 18 bytes, so 20 ids fit the 512-byte limit with room for longer ids. P11 isn't needed for a batch of 20.

**Not sent**

- P4, because P3 found the item with its size; P7, because P6's filter works; P8, needed only for option (b) of §4; P9, because P3's hit was on promotion; P11, because a batch of 20 fits.
- P10, the answer to a rejected key, is the one still useful. If the plan takes the gate exception (Open Question 2), it needs this app's exact status and body, and it needs the owner's own OK.

## Code References

- `src/lib/services/shop-gate.ts:9-14` - `SHOP_HOSTS`, Super-Pharm's two hosts at `:13`
- `src/lib/services/shop-gate.ts:57-59, :119-134` - the 8 s limit covers the body; headers kept, User-Agent set, redirects not followed
- `src/lib/services/shop-gate.ts:136-143` - any 403 or challenge: body discarded, block reported, shop stopped
- `src/lib/services/shop-gate.ts:28-31, :94, :238-244` - what the gate logs: no query string, all-digit path segments masked
- `src/lib/services/testing/replay-fetch.ts:13-26` - recordings matched by URL only
- `src/lib/services/matching.ts:74-94, :101-109` - `pickMatch` and `matchDifferences`
- `src/lib/services/search-query.ts:5-8, :39-45` - allowed characters, `toShopQuery`
- `src/lib/services/shops/shop-offer.ts:11-37` - `storableOffer`
- `src/lib/services/shops/shop-outcome.ts:10-34` - `isRefusal`, `gateUnavailable`
- `src/lib/services/shops/rossmann.ts:95-125` - a fetcher with one request per item, 404 read as `missing`
- `src/lib/shop-messages.ts:15-31, :39-59` - the texts users see for busy, paused, stopped and failed
- `supabase/migrations/20260926112205_polite_shop_access.sql:5-15, :43, :48-123` - `public.shops`, the seed, `reserve_shop_request`, `report_shop_block`
- `supabase/migrations/20260927184936_watchlist_matches.sql:32, :39` - id check, `eans` default
- `scripts/check-shop-gate-db.mjs:52-60` - the cap check that reserves `super-pharm`
- `astro.config.mjs:32-34, :64-69`; `wrangler.jsonc` - no sessions, no KV, two secrets
- S-05 @ 50fb7c6: `src/types.ts:2, :156-171, :214-230` - `SHOP_IDS`, `ShopCandidate`, `ShopOffer`, `PriceCheck`
- S-05 @ 50fb7c6: `src/lib/services/price-comparison.ts:29-77` - shop lists and labels
- S-05 @ 50fb7c6: `src/lib/services/shops/registry.ts:13-40` - `ShopAdapter`, `SHOP_ADAPTERS`
- S-05 @ 50fb7c6: `src/lib/services/shops/luigis-box.ts:84-153, :155-210, :300-342` - search, batches, missing versus failed, value helpers
- S-05 @ 50fb7c6: `src/lib/services/shops/hebe.ts:26, :65-76, :151-165` - a constant tracker, the client binding, the offer, the id check
- S-05 @ 50fb7c6: `src/lib/services/shop-matching.ts:38-44, :57-148, :246-361` - hit counts, both lookups, the name query, `runMatchSteps`
- S-05 @ 50fb7c6: `src/lib/services/match-step.ts:56-74, :86-88` - when a view may look a shop up
- S-05 @ 50fb7c6: `src/lib/services/matches.ts:34-37, :86-120` - the id schema and the decision form
- S-05 @ 50fb7c6: `src/lib/services/price-refresh.ts:35-82` - fetchers and `refreshPrices`
- S-05 @ 50fb7c6: `src/lib/services/size.ts:22-34` - `parseSize`
- S-05 @ 50fb7c6: `src/lib/services/match-view.ts:256-303` - a candidate's flags and the choice's intro
- S-05 @ 50fb7c6: `src/components/watchlist/price-comparison-state.ts:295-301` - "Najtaniej" withheld while a decision is unreadable

## Architecture Insights

- **Super-Pharm is the first shop with two hosts behind one cap, and the first whose adapter needs a credential.** Rossmann, Natura and Hebe each need one host and a constant. The key turns "an adapter plus labels" (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:81`) into an adapter, a key reader and possibly a rule change in the gate, the one module where the politeness rules live (`src/lib/services/shop-gate.ts:4-6`).
- **The gate's 403 rule is shop-blind by design.** It knows hosts, not APIs. A narrow exception keyed by Super-Pharm's Algolia host and Algolia's invalid-key message keeps that design legible. An exception the adapter passes in would let any adapter weaken the stop.
- **S-05's registry is the right seam.** Natura's and Hebe's behavioural differences sit in their adapters (`search`, `fetchPrices`, links, images), and their names and colours sit in the label and fill tables. Super-Pharm adds two more per-shop facts, "has no EAN search" and possibly "builds its own name query". They belong on the same adapter, not in `shop-matching.ts` as `if (shop === "super-pharm")`.
- **The batch, refusal and missing-versus-failed rules are shop-neutral but sit in `luigis-box.ts`.** A third client is the point where the lesson on shared helpers (`context/foundation/lessons.md:40-45`) asks for a shop-neutral module, proven the way S-05 Phase 1 proved its split: the existing adapter tests pass unedited.
- **The no-EAN path has always been designed in, never used.** The rule never auto-accepts without an EAN, and the choice UI only shows "Ten sam EAN" when there is one. Super-Pharm exercises that path as its normal case, so its cost (a choice per product, repeated views until decided) is the new thing to plan for, not the rule.

## Historical Context (from prior changes)

- `context/archive/2026-09-26-polite-shop-access/` - F-01 seeded `super-pharm` and listed its two hosts; the gate's stop on 403 is F-01's.
- `context/archive/2026-09-27-shop-matching-first-two-shops/plan-brief.md:33, :54` - a tracker id as a constant rather than reading a 3.3 MB page; reading Natura's page was out of scope.
- `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:655` - stored ids are user input before they go into a shop URL.
- `context/archive/2026-09-28-cheapest-shop-today/plan.md:911` - "S-05 and S-06 add their shops to `PRICED_SHOPS` and `SHOP_LABELS`…": partly contradicted by S-05's research (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/research.md:62`); S-05 then built the per-shop seams.
- `context/archive/2026-09-28-cheapest-shop-today/follow-ups/review-fixes.md:22-26` - stop asking a shop after two failed requests in a row; it applies to Super-Pharm's batches too.
- `context/archive/2026-10-01-fix-matches-and-watchlist/reviews/plan-review.md:47` - "S-05/S-06 may auto-accept on name and size".
- `context/archive/2026-10-01-fix-matches-and-watchlist/follow-ups/review-fixes.md:5-13` - re-pinning, the reload alert and the suspicious count per shop, for S-05 and S-06; S-05 builds them per shop.
- `context/archive/2026-10-02-testing-critical-browser-flows/plan.md:66-68` - no recorded answers or choices in the browser layer.
- `context/deployment/deploy-plan.md:246-254` - the 2026-09-23 egress check read Super-Pharm's page and searched its Algolia from a Worker.
- S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:81, :84, :90, :332, :742, :870` - Super-Pharm left for S-06 as an adapter plus labels; no "never automatic" for Hebe; tracker constants; off shops' rows ignored; Super-Pharm as the "not fetched" example; the S-06 carry-over S-05 Phase 7 will write into the roadmap.

**Verdicts on historical claims**

- Research note `:118`, "it rotates with deployments": **unsupported**. No second key was recorded, the key has no expiry of its own, and the v3.9.1 source makes it stable between configuration changes. An upgrade to v3.14.0 or later would make it change daily (§3.1, §3.4).
- Research note `:269`, "read dynamic values (Algolia key, Luigi's Box tracker) from the live page": **not followed for trackers** (constants since S-02), **open for the key**.
- Research note `:262`, "filter by brand + `farmax_capacity`, confirm via product page `gtin13` when ambiguous": **partial**. Filtering by capacity is untested; the `gtin13` check is option (b) of §4.
- Roadmap `:184`, the "Najtaniej" carry-over for S-06: **built** by S-05 Phase 4 for every matched shop (S-05 @ 50fb7c6: `src/components/watchlist/price-comparison-state.ts:295-301`). The roadmap still lists it. S-05 Phase 7 edits the S-06 block (S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/plan.md:863-872`) but doesn't say it removes this line.
- Roadmap `:183`, "a search key that must be read from the shop's own page": **partial**. It must come from the page once; whether the app reads it at runtime is Open Question 3.

## Related Research

- S-05 @ 50fb7c6: `context/changes/hebe-in-comparison/research.md` - the per-shop seams and Hebe's live answers
- `context/archive/2026-09-27-shop-matching-first-two-shops/research.md` - Natura's matching and the tracker constant
- `context/archive/2026-09-28-cheapest-shop-today/research.md` - the price path and per-shop costs
- `context/archive/2026-10-01-fix-matches-and-watchlist/research.md` - re-pinning, the brand rule, the suspicious count
- `docs/research/polish-drugstore-price-apis.md` §2.3, §5–§7, §9 - Super-Pharm's original notes

## Open Questions for /10x-plan

Each is the owner's call unless marked as a planning detail. The recommendation is this research's.

1. **Does the owner buy at Super-Pharm?** This is the roadmap's unknown (`context/foundation/roadmap.md:182`) and PRD Open Question 2 (`context/foundation/prd.md:189`).
   - Options: yes, go ahead; or no, park S-06, although FR-013 lists Super-Pharm among the MVP's four shops (`context/foundation/prd.md:133-136`).
   - **Recommendation:** confirm yes. The owner already placed S-06 in the slice order.
2. **The gate and a refused key** (§3.4).
   - G1: a narrow exception. An invalid-key 403 on Super-Pharm's Algolia host becomes a failure, the key is read once and the request repeated once, and a second refusal stops the shop as today.
   - G2: no change. A rotated parent key stops the shop until the owner re-enables it.
   - **Recommendation:** G1. A rotated key isn't a block, the stop text would tell users something false, and every rotation would need the owner.
   - It changes a non-negotiable as CLAUDE.md words it (`CLAUDE.md:21`), so the plan updates that sentence and pins the exception with gate tests.
   - An expired key (400) needs no gate change either way.
3. **Where the key comes from and is kept** (§3.3). The options:
   - A: a constant;
   - B: a constant, read again from the page on a refusal or when its `validUntil` nears, kept in module memory;
   - C: read from the page at runtime, kept in module memory;
   - D: the database;
   - E: the Cache API;
   - F: KV.

   **Recommendation:** B if probe P2 shows the key unchanged since 2026-09-17, C if it changed.
   - Neither needs a migration or a binding. B reads no page while the key holds; C reads one per isolate.
   - Both heal after a change, each isolate on its own: on a refusal, or before a `validUntil` the key carries.
   - Not D: it needs a migration, and any invited user could write the key directly (`context/foundation/lessons.md:33-38`), all for a value that rarely changes.
   - Not E: it holds the key per data center only, and its behaviour on workers.dev is undocumented.
   - Not F: a new binding (`context/deployment/deploy-plan.md:68`) for one short string.
   - Not A alone: an extension upgrade would break it within a day, and under G2 each rotation stops the shop.
   - **Probe result (P2):** the key is unchanged since 2026-09-17, so the recommendation is **B**.

4. **Automatic matching without an EAN** (§4).
   - Options: (a) never automatic; (b) `gtin13` from candidates' pages; (c) brand, size and name similarity.
   - **Recommendation:** (a). It keeps FR-006 and test-plan risk #6 as written, costs no request and changes no rule.
   - (b) can follow if choosing proves tedious. (c) needs a PRD change.
5. **An undecided Super-Pharm on each product view** (§6). The options:
   - (i) today's flow: a lookup on every own-navigation view until the user decides, 1 search + K each, and the render waits for it;
   - (ii) a button on Super-Pharm's card that runs the lookup when tapped: nothing per view, and 1 search + K per tap;
   - (iii) a lookup on the first view after "Dodaj", and a button afterwards.

   **Recommendation:** (ii).
   - Super-Pharm never decides on its own, so its lookup is always the user's errand.
   - A view at the shelf then waits for no Super-Pharm search, and the cap isn't spent re-showing a choice the user skipped.
   - It needs a step rule for a shop that never matches automatically, and a parameter naming the shop beside `?retry=` (S-05 @ 50fb7c6: `src/lib/services/match-step.ts:56-74`).

6. **The name query** (§2).
   - Options: (a) brand, name and size, as for the other shops; (b) brand and name only, through a per-adapter query; (c) (a) plus Algolia's `removeWordsIfNoResults`.
   - **Recommendation:** settle it on probes P3 and P4, with (b) as the default. The size is compared in the verdict anyway, so leaving it out of the query costs no safety.
   - **Probe result (P3):** the query with the size found exactly the item, its "300 ml" matching `capacity`. So the recommendation becomes **(a)**, the other shops' query, with no per-adapter query.
7. **Skipping the EAN search for Super-Pharm** (planning detail, §2).
   - **Recommendation:** skip it through a `ShopAdapter` field, unless probe P5 shows an EAN query finds the product. That saves one request per lookup and per re-pin.
   - **Probe result (P5):** the EAN query found nothing, so skip it.
8. **The order and number of a no-EAN shop's candidates** (§4).
   - Options: (a) Algolia's first 3, as today; (b) same size and agreeing brand first, then the shop's order, for every shop (it reorders only the candidates that don't qualify); (c) more than 3.
   - **Recommendation:** (b), with the limit unchanged and a unit case on recorded candidates.
9. **The pinned request** (planning detail, §5).
   - Options: (i) a filtered search; (ii) getObjects; (iii) one request per item.
   - **Recommendation:** (i), `POST …/query` with `objectID` filters, batches of about 20 and `analytics=false`, storing the `objectID` as the shop item id. (ii) only after probe P7.
   - **Probe result (P6):** (i) works with the secured key, and an unknown id is simply left out.
10. **POST and the replay** (planning detail, §2).
    - Options: `POST …/query`, documented and proven twice, with the replay matching bodies; or the legacy GET with today's replay.
    - **Recommendation:** POST.
11. **What counts as Super-Pharm's price** (§7).
    - (a) Only the guest price `default`, never a customer-group or club price. **Recommendation:** yes.
    - (b) After `special_to_date`, either mirror the shop's frontend (the regular price parsed from `default_original_formated`, no promotion), or store `default` with its end date and let the S-03 rule show it out of date. **Recommendation:** mirror the frontend when the regular price parses, else the S-03 rule.
    - (c) The Omnibus text parsed strictly, `false` as null. **Recommendation:** yes.
    - (d) `available` from `in_stock` alone. **Recommendation:** yes, unless probe P3 shows prescription items in the drugstore index.
    - **Probe result (P3) for (b):** a promotion can come without the regular price and with meaningless dates (§ Probe results). The 300 ml item is shown red with a "Promocja" badge, yet has no `default_original_formated`, `special_from_date` 2016-11-24 and `special_to_date` false. So the options become:
      - (b1) the price and the Omnibus low only, with no regular price and no end date when the record has none; a regular price only from `default_original_formated`, and only when it parses above the price;
      - (b2) mark such a price as a promotion from `showRedPrice` or the "Promocja" badge, still without a regular price.
      - **Recommendation:** (b1). The app states only what the record says, the shop's own tile shows no regular price either, and the Omnibus low still gives the 30-day context.
    - **Probe result (P3) for (d):** `in_stock` 1 comes with an `inStoreOnly` flag, 0 here. **Recommendation:** `available` when `in_stock` is 1 and `inStoreOnly` is 0. One hit can't show whether prescription items appear in the index.
12. **"Do sprawdzenia" and undecided Super-Pharm products** (§4).
    - Options: keep S-05's rule, where an undecided matched shop counts, so every product counts until decided; or leave out an undecided shop that never matches automatically.
    - **Recommendation:** keep the rule. The chip is where the user finds the products that still need a decision, and with question 5's button it's the way to them.
13. **Super-Pharm's colour** (§8).
    - The design handoff has none. The other shops are blue (hue 259), mint (158) and Hebe's planned pink (350).
    - **Recommendation:** a hue far from those three at their lightness and chroma, for example an apricot around hue 70, checked by `scripts/check-token-contrast.mjs` and by eye on the kitchen sinks in both themes.
14. **The probes** (§ Proposed probes).
    - Test-plan §6.4 foresees recordings of API answers only (S-05 @ 50fb7c6: `context/foundation/test-plan.md:149`). P2 records a page, so the owner decides whether a cut copy of it may become a fixture.
    - **Recommendation:**
      - approve P1 first, then P2, P3, P5 and P6 if robots.txt allows reading the homepage: at most 5 requests;
      - P4, P7–P9 and P11 when the plan needs them;
      - P10 on its own.
    - **Done on 2026-10-05:** P1, P2, P3, P5 and P6, with the owner's OK. P10 still needs its own OK, and only if the plan takes G1.
15. **Sequencing** (§8).
    - Options: (a) plan S-06 against `main` once S-05 and S-07 have merged; (b) branch from S-05 now; (c) land the gate exception as its own change on `main` first.
    - **Recommendation:** (a), with the decisions and probes done now. The gate exception fits as S-06's first phase: S-05 doesn't touch the gate, and a separate change would need the same tests and review.
16. **Shared helpers** (planning detail, §5).
    - Options: move the batch loop, the refusal stop, the missing-versus-failed rule and the value helpers out of `luigis-box.ts` into a shop-neutral module, or copy them into Super-Pharm's adapter.
    - **Recommendation:** move them (`context/foundation/lessons.md:40-45`). The proof is that Natura's and Hebe's tests pass unedited, as S-05 Phase 1 proved its split.
17. **Docs to correct** (planning detail). The places:
    - the research note's §1 row and §2.3: the rotation claim, POST as the route, the record's fields (`inStoreOnly`, `algoliaLastUpdateAtCET`, the image host `media.superpharm.eu`, a promotion without its regular price), and pins by `objectID`;
    - the research note's §5: robots.txt now disallows `/catalogsearch/` and `/catalogsearch/result/`;
    - CLAUDE.md's gate sentence (with G1) and its "Shops and matching" bullet;
    - dated PRD notes on FR-006 and FR-013;
    - the roadmap's S-06 risk and unknown.

    **Recommendation:** one docs phase at the end, as S-05's Phase 7 does.
