---
date: 2026-09-28T01:49:49+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 2bb003bc89ea2f77434cd2bee589cc7b3bc21f96
branch: main
repository: yaroslavkhudchenko/10xcourseproject
topic: "S-03 cheapest-shop-today: shop price fields and re-fetching, shared price storage, the per-shop cap, and showing prices shop by shop"
tags:
  [
    research,
    codebase,
    shop-adapters,
    rossmann,
    natura,
    luigis-box,
    price-observations,
    rls,
    shop-gate,
    server-islands,
    streaming,
    cloudflare-workers,
  ]
status: complete
last_updated: 2026-09-28
last_updated_by: Claude (claude-opus-5-5)
last_updated_note: "Six live requests settled Open Questions 1-3 and part of 4; see Follow-up: live requests"
---

# Research: what S-03 needs to know before planning

**Date**: 2026-09-28T01:49:49+02:00
**Researcher**: Claude (claude-opus-5-5), with three read-only research workers
**Git Commit**: 2bb003bc89ea2f77434cd2bee589cc7b3bc21f96 (`main` after PR #8)
**Branch**: main
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

S-03 (`context/changes/cheapest-shop-today/change.md`; roadmap `context/foundation/roadmap.md:123-139`) shows which shop is cheapest today, on the watchlist and on each product's page. It shows regular and promo price, the Omnibus 30-day low, and the source and age of every price. Prices appear shop by shop, and a failed shop shows its last known price or a gap. Before planning, what is true today about:

1. what Rossmann and Natura return for a pinned item's prices, and how S-03 can fetch a pinned item again;
2. where shared price observations can live, who can write them, and what that means for privacy;
3. what the per-shop cap means for refreshing prices, including on the list;
4. how a page can show prices shop by shop as they arrive, on Astro 7.3.2 on Cloudflare Workers.

## Summary

- **Both shops' search answers carry the FR-011 fields, but the adapters read almost none of them.**
  - **Rossmann:** the two reduced items recorded are in `rossmann-search-empty.json`. There, `price` is the promo price, `oldPrice` the price before it, `promotionFrom`/`promotionTo` the promo window and `lastLowestPrice` (type "basic") the 30-day low. `rossmann.ts:20-34` reads none of these fields, and it drops `recommendedProducts`, where both reduced items sit.
  - **Natura:** `price_amount`, `price_old_amount`, `lowest_price` and `availability` are in the hit. `natura.ts` reads only `price_amount` (`natura.ts:29`, `:156`).
  - **The research note is behind on Rossmann.** Its §6 step 7 names only `promotion` (`docs/research/polish-drugstore-price-apis.md:251`). In the recordings that field is a campaign tag, and it also appears on items with no price cut.
- **Fetching a pinned item again** (updated after the live requests; see Follow-up):
  - **Rossmann: one request per product, by id.** The v2 detail endpoint carries `price`, `oldPrice`, `lastLowestPrice` and the promo window when a reduction runs, at about 3–4.5 KB. No batching is known.
  - **Natura: one request for many products.** `f[]=type:product&f[]=sku:<SKU>` without `q` returned exactly the pinned item, and two `sku` filters returned both items in one request. With `hit_fields`, a hit shrinks from about 20 KB to about 350 B.
- **Shared prices: nothing in the repo decides the key, the writer or how long history is kept.**
  - **Key:** the inferred key is (shop, shop item).
  - **Writer:** there is no service-role key (`context/deployment/deploy-plan.md:128`), so the Worker writes with the user's own session and the publishable key, which Supabase treats as public. A signed-in user holding that key can make the same writes directly. A `security definer` function narrows what they can write, but it can't stop a plausible fake price. F-01 accepted a similar risk (`context/archive/2026-09-26-polite-shop-access/plan.md:405`).
- **Privacy tension:** shared prices with their fetch times let a user who watches the same item see when someone else last opened it. That conflicts with "no user can observe or infer another user's watchlist" (`context/foundation/prd.md:144`).
- **Cap:**
  - Each gated request takes one of 30 slots per shop per rolling minute, for the whole deployment (`supabase/migrations/20260926112205_polite_shop_access.sql:58-82`). Searches and matching draw on the same slots.
  - A Rossmann request refreshes one product. A Natura request can refresh several (Follow-up, request 5).
  - Past the cap, the gate answers `capped` without calling the shop (`src/lib/services/shop-gate.ts:108-112`).
  - The Workers Paid limits aren't what constrains this.
- **Shop by shop:**
  - Today both pages await all their data in the frontmatter before sending a byte.
  - Server islands (one per shop), or a client island calling an API route, can show each shop as it answers. Plain streaming shows them only in document order.
  - Server islands need a fixed `ASTRO_KEY` build variable. Without one, a visit that spans a deploy keeps its placeholder, and no error appears.
- **Gaps:**
  - Six live requests on 2026-09-28 settled the Rossmann detail fields and the Natura filter (see Follow-up).
  - A throwaway Worker then confirmed that Rossmann answers the v2 detail path from Cloudflare Workers (Follow-up).
  - Still open:
    - the window of Natura's `lowest_price`, and whether `lowest_price_date` moves daily
    - the runtime checks in Open Questions

## Detailed Findings

### 1. Price fields per shop (recordings of 2026-09-27)

**Rossmann, v4 search item** (files in `src/lib/services/shops/fixtures/`):

| Need                         | Field                                                          | Recorded example                                                                                                       |
| ---------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| current price                | `price` (number)                                               | NIVEA Soft 300 ml: 26.99 (`rossmann-search-results.json:423`)                                                          |
| regular price during a promo | `oldPrice`                                                     | Isana 3.69 (`rossmann-search-empty.json:26`), Felix 9.99 (`:179`)                                                      |
| promo price                  | `price` when `oldPrice` is present                             | 3.19 (`:27`), 5.99 (`:180`)                                                                                            |
| Omnibus 30-day low           | `lastLowestPrice`, equal to `lastLowestPriceV2`, types "basic" | Isana 3.69 (`:78-81`), Felix 6.39 (`:227-230`)                                                                         |
| promo window                 | `promotionFrom` / `promotionTo`, at item level, no UTC offset  | "2026-09-24T00:00:00" to "2026-10-07T00:00:00" (`:59-60`); "2026-09-17T00:00:00" to "2026-09-30T00:00:00" (`:212-213`) |
| availability                 | `availability: "available"`, `isInOut: false`                  | `rossmann-search-empty.json:62`                                                                                        |

- **Where the promo fields occur:** on 2 items, 235164 and 131225, both in `data.recommendedProducts[]` of the empty-search recording. The other two Rossmann recordings have 5 `data.items[]` entries each, and none of those 10 has an `oldPrice`.
- **`promotion{type, redirectUrl}` marks a campaign, not a price cut.** In the three recordings it appears without `oldPrice` on 6 distinct items: 26900 and 2103263 "seasonal", 2126586, 66173 and 17420 "rossmann", and 2079205 "rossne". For example 26900 at `rossmann-search-results.json:484`.
- **`oldPrice` is the regular price, not the 30-day low**, in at least one recorded case: Felix has `oldPrice` 9.99, `lastLowestPrice` 6.39 and `price` 5.99.
- **What the adapter reads today:**
  - `itemSchema` reads id, brand, name, fallbackName, caption, unit, eanNumber, pictures and navigateUrl (`src/lib/services/shops/rossmann.ts:20-31`).
  - `responseSchema` reads `data.items` and `spellCheckHint` (`:32-34`).
  - `ProductCandidate` has no price field (`src/types.ts:38-52`).

**Natura, Luigi's Box hit attributes:**

| Need                         | Field                                                                                                        | Recorded example                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| current price                | `price_amount` (number); `price` is text                                                                     | 16.99 (`natura-ean-hit.json:55`), "16.99 zł" (`:17`)                                                            |
| regular price during a promo | `price_old_amount`                                                                                           | 22.99 (`:98`); absent on the undiscounted NV81063 (`natura-name-search.json:1316`)                              |
| promo price                  | `price_amount` when `price_old_amount` is present; `discount_price_*`                                        | a 26.1 % and 6 zł discount (`natura-ean-hit.json:62`, `:105`)                                                   |
| Omnibus 30-day low           | `lowest_price`, a string in a list                                                                           | ["17.990000"] (`:90`); NV81063 ["10.990000"], below its current 17.99 (`natura-name-search.json:1383`, `:1353`) |
| promo window                 | none in the recorded hits                                                                                    | —                                                                                                               |
| availability                 | `availability`: 1 = orderable, 0 = not ([Luigi's Box feed docs](https://docs.luigisbox.com/indexing/feeds/)) | 1 (`natura-ean-hit.json:92`)                                                                                    |

- **`lowest_price_date` may not be the date of the low.** It is ["2026-09-27 00:00:00"] on all 3 recorded hits, which is the recording day (`natura-ean-hit.json:149`; `natura-name-search.json:149`, `:874`, `:1426`). It may be when the value was computed. Unconfirmed.
- **The recordings don't settle `lowest_price`'s window.** On NV89063 it is above the promo price. On NV81063, which has no promo, it is below the regular price. It could be the 30 days before a reduction, or a rolling 30 days.
- **What the adapter reads today:**
  - It checks that `price_amount` is positive and maps it to `ShopCandidate.price` (`src/lib/services/shops/natura.ts:29`, `:156`). The other fields are dropped.
  - S-02 shows that price only while the user chooses (`src/pages/watchlist/[id].astro:105-122`) and stores no price (`src/types.ts:83`).
- **The fetch time is the only certain age.** Rossmann's recorded items carry no timestamp. Natura's hit-level `updated_at` (`natura-ean-hit.json:749`) isn't in Luigi's Box's Search API docs.

### 2. Fetching a pinned item again

**What identifies the item in each shop:**

- **Rossmann:** `watchlist_items.source_item_id`, Rossmann's product id such as "26900" (`supabase/migrations/20260927145051_watchlist_items.sql:8-9`). Helpers: `eans`, brand, name, size and `product_url`.
- **Natura:** a `watchlist_matches` row with `state = 'matched'`. It is identified by `shop_item_id`, the SKU, which is also Luigi's Box's hit `url` (`supabase/migrations/20260927184936_watchlist_matches.sql:32`). Helpers: the matched item's own `eans` (`:39`), name, brand, size and `product_url`.
- **Both are per-user copies:** "No shared products table" (`context/archive/2026-09-27-watchlist-add-by-search/plan.md:73`).
- **No column records** whether a Natura match came from the EAN search or the name search.

**Rossmann options:**

- **v2 detail by id:** `GET https://www.rossmann.pl/products/v2/api/Products/{id}?shopNumber=null` (research note `:44`, `:303`).
  - Verified from a developer machine on 2026-09-17.
  - Its price, promo and 30-day-low fields aren't recorded. **Superseded:** the live requests show them (Follow-up, requests 1 and 2).
  - The note's §9 tested only the v4 search from Workers, not this endpoint.
- **Re-run the v4 text search and keep the item whose `id` equals `source_item_id`.**
  - In the recording, 26900 is first for "nivea soft" (`rossmann-search-results.json:418`).
  - If the ranking changes, the item can fall off the page of results.
  - An EAN can't be searched (research note `:53`).
- **Batching:** `v2/api/Products?ids=26900&ids=11790` returned HTTP 400 (research note `:53`). No other batch route is known.

**Natura options:**

- **The EAN search returns an item it found in the first place.**
  - `q=4005900009319` returned exactly NV89063 (`natura-ean-hit.json:3`, `:10`).
  - A name-fallback match exists because the product's own EAN found no qualifying candidate (`src/lib/services/shop-matching.ts:25-52`). For those, the query that can bring the item back is the match's own `watchlist_matches.eans`, when it has any.
  - A match the user confirmed may have no EANs at all (`src/lib/services/shops/natura.ts:151-153`).
- **A name search returns look-alikes:** 3 hits for "nivea soft 300 ml" (`natura-name-search.json:10`, `:752`, `:1316`). So it can't reliably re-find one item.
- **Either way,** use the hit whose `url` equals `shop_item_id`. A missing hit is a gap.
- **Luigi's Box's [Search API docs](https://docs.luigisbox.com/search/api/v1/search/) document no parameter that selects a hit by its identity.**
  - `q` is optional when `f[]` filters are given.
  - `f[]` takes `key:value` filters; filters on the same field combine with OR, different fields with AND.
  - `size` goes up to 200.
  - A hit's `url` is its unique identifier.
- **An attribute filter might work instead:** `f[]=type:product&f[]=sku:NV89063`, without `q`. It works only if Natura's catalog makes `sku` filterable, which isn't documented. If it does, several SKUs could come back in one request. **Superseded:** it works, for one SKU and for two in one request (Follow-up, requests 4 and 5).

### 3. Stored ids and shop URLs

**Two places build a shop URL today:**

- `rossmann.ts:42`, from the user's validated search text
- `natura.ts:48`, as `q=${encodeURIComponent(query)}`

**Per stored value:**

- **Stored EANs** reach a URL only through `shop-matching.ts`, which keeps digits-only `^\d{8,14}$` values (`src/lib/services/shop-matching.ts:11`, `:26`). This path already meets S-02's carry-over.
- **`source_item_id`** reaches no shop URL today.
  - The database accepts `^[A-Za-z0-9._-]{1,40}$` (`20260927184936_watchlist_matches.sql:10`), so `.` and `..` pass.
  - The digits-only rule `^\d{1,12}$` exists only in the add form and the adapter (`src/lib/services/watchlist.ts:32`; `rossmann.ts:111`).
  - In a v2 path, `..` would resolve to another path on the same host. The gate would allow that, since it checks only protocol, port and host (`shop-gate.ts:82-88`).
  - `encodeURIComponent` leaves `.` unescaped, so rejecting anything but digits is the guard that works.
- **`shop_item_id`** reaches no shop URL today.
  - It accepts `.` and `..` in the database, the form and the adapter (`20260927184936_watchlist_matches.sql:32`; `src/lib/services/matches.ts:29-32`; `natura.ts:20`, `:27`).
  - If S-03 only compares it with a hit's `url`, it never enters a URL.
  - If it goes into `f[]` or `q`, the carry-over applies: encode it and require a letter or digit.
- **The S-02 carry-overs** are at `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:650-657`.

### 4. Shared price observations: what is decided and what isn't

**Decided:**

- Observations are shared by all users; watchlists are private (`context/foundation/prd.md:144`, `:163`).
- Removing a watchlist entry never deletes observations (`CLAUDE.md`, Non-negotiables).
- Every observation records its source, shop fetch or manual entry (`prd.md:115`). Fetched prices are the MVP's only source (`prd.md:112-114`).
- A price older than an agreed limit is marked stale (`prd.md:142`). The limit is Open Question 5 (`prd.md:188`).
- A refresh that returns nothing for a confirmed match marks the price stale and never un-pins the match (`prd.md:76`).
- At the cap, the page shows the last known price (`context/archive/2026-09-26-polite-shop-access/plan-brief.md:38`).

**Not decided:**

- **The key.** The shaping seed says "one shared price cache per EAN and shop" (`context/foundation/shape-notes.md:69`). The PRD later makes the confirmed per-shop item the anchor and the EAN a helper (`prd.md:94`). There is no shared product entity, so a history shared across users would be keyed by (shop, shop item). This is an inference.
- **History length and retention:** none recorded. S-04 needs history (FR-012) and is blocked on Open Question 4.
- **The write path and trust model** (section 5).

**Related facts:**

- **Cascades:** `watchlist_matches` rows cascade from `watchlist_items`, which cascade from `auth.users` (`20260927184936_watchlist_matches.sql:45-48`; `20260927145051_watchlist_items.sql:6`). An observations table that referenced either would lose rows when a product or a user is deleted, which breaks the rule above. This is an inference.
- **Caching:** the research note asks to cache results, because "prices change at most a few times per day" (research note `:257`). No cache or binding exists (S-01 plan `:72`; the deploy plan has `ASSETS` only), so stored observations would be the cache.

### 5. Security and privacy of shared prices

**Baseline:**

- There is no server-only key (`deploy-plan.md:128`). Every write, the Worker's included, runs with the user's JWT and the publishable key.
- F-01's review: "The app keeps that key server-side, but Supabase treats it as public" (`context/archive/2026-09-26-polite-shop-access/reviews/impl-review.md:80`). The app reads it only through `astro:env/server` (`src/lib/supabase.ts:3`).
- So a signed-in user who obtains the key can make any write the Worker makes, directly through the Data API.

**A plain RLS insert policy (the S-01/S-02 pattern):**

- The policies check the row and the caller (`20260927145051_watchlist_items.sql:35-37`).
- So any user could insert any in-bounds price for any item. Everyone who watches that item would see it, and S-04's history would include it.
- S-01 accepted tampering because "Tampering only affects your own row" (`context/archive/2026-09-27-watchlist-add-by-search/plan-brief.md:33`). Shared rows don't have that property.

**Writes only through a `security definer` function (the F-01 pattern):**

- The table is closed: RLS on, no policies, everything revoked (`20260926112205_polite_shop_access.sql:31-38`).
- The function can:
  - stamp the time and source itself
  - bound the values
  - refuse unknown shops
  - check that the caller has a matched item for that key
- It still runs for any `authenticated` session (`:125-130`), so an invitee can submit a plausible fake price for an item they watch.
- **Precedent:** F-01's accepted risk is that any signed-in user can stop or pause a shop through a direct call, to "revisit it before inviting more people" (`context/archive/2026-09-26-polite-shop-access/plan.md:405`).

**Reads and privacy:**

- A select open to all users would let anyone list which shop items are watched, and when each was refreshed.
- Refresh is on demand, so a refresh time tracks someone opening a product.
- Limiting reads to items the reader has matched still lets a user who adds an item learn when others last opened it.
- `prd.md:144` says no user can observe or infer another user's watchlist. None of the inspected documents (the foundation docs, the three archives and CLAUDE.md) addresses this channel.

### 6. The shop gate and the refresh budget

- **Counting:**
  - One reservation per `gate.fetch` that passes the host check.
  - It is counted in `public.shop_requests`, per shop, over a rolling 60 s, under a row lock.
  - The cap defaults to 30 and can be edited in `public.shops` (`20260926112205_polite_shop_access.sql:9`, `:58-82`).
  - A slot is taken before the shop is called, so failed or timed-out calls count too.
- **Refusals without a shop call:**
  - Capped, paused (with `until`), stopped, or an unreadable reservation answer (`shop-gate.ts:94-112`). Each costs one database round trip.
  - Callers map them through `gateUnavailable` (`src/lib/services/shops/shop-outcome.ts:6-25`).
  - The page texts in `src/lib/shop-messages.ts:10-26` are worded for search ("Wyszukiwarka…"), not for prices.
- **What one gated call costs** (`shop-gate.ts:18`, `:23`, `:170-192`; `rossmann.ts:15`; `natura.ts:17`):
  - one `reserve_shop_request` RPC, with a 2 s limit
  - a `report_shop_block` call after a block or a rate limit
  - the shop fetch: the gate's limit is 8 s including the body; Rossmann's search passes 5 s and Natura's 4 s
- **What a refresh costs:**
  - Refreshing N products matched in both shops takes N Rossmann slots and N Natura slots, from the same 30-per-minute budgets that every user's searches (1 Rossmann slot each) and Natura matching (up to 2 Natura slots) use.
  - Rossmann has no known batching (section 2), so at the default cap of 30 one user can't refresh more than 30 products' Rossmann prices within one minute, even with no other traffic.
  - Natura's SKU filter returned two pinned items in one request (Follow-up, request 5), and Luigi's Box documents `size` up to 200. So one Natura slot can refresh many products; the most per request hasn't been tested.
- **The list today** makes one query for the whole list, never one per product (`src/pages/watchlist.astro:21-28`, and the comment there). Its prices can come from stored observations without spending any slots.
- **Workers Paid limits** ([limits page](https://developers.cloudflare.com/workers/platform/limits/), updated 2026-09-05):
  - 30 s CPU by default
  - 10,000 subrequests per invocation
  - 6 connections waiting for headers at once; a seventh queues
  - no duration limit while the client stays connected
  - A product view makes on the order of 10 subrequests.

### 7. Showing prices shop by shop

**Today:**

- Both pages do all their work in the frontmatter, and Astro awaits the frontmatter before it starts the response (`node_modules/astro/dist/runtime/server/render/astro/render.js:191-204`).
- The product page awaits the Natura lookup (EAN, then name) and its write before rendering (`src/pages/watchlist/[id].astro:147-155`).

**Streaming (on by default in this adapter):**

- Shop calls moved into child components would start in parallel. But a pending component holds back the output of the ones after it: they are buffered and flushed in document order (`node_modules/astro/dist/runtime/server/render/astro/render-template.js:36-68`). So a slow first shop delays the second shop's finished HTML.
- The status code, redirects and cookies are fixed before child components finish. So the 404, the 503 and the retry redirect have to stay in the frontmatter.
- An error mid-stream leaves a cut-off page with status 200 (`render.js:53-73`).

**Server islands (`server:defer`), Astro 7.3.2:**

- **Request:** each island is its own request, `GET /_server-islands/<Name>?e=&p=&s=`, or a POST when the props are long.
  - It is made by an inline script after the document is parsed.
  - A GET also gets a `<link rel="preload">` (`node_modules/astro/dist/runtime/server/render/server-islands.js:25-29`, `:141-176`).
- **Key:** props are encrypted with AES-GCM, using `ASTRO_KEY` at build time or a new random key per build (`node_modules/astro/dist/core/build/index.js:146-147`).
  - On Workers Builds it must be a build variable, because runtime secrets aren't read for this.
  - **Without a fixed key:**
    - A page from one version whose island request reaches the next version gets a 400.
    - The placeholder then stays, with no retry and no error (`server-islands.js:184-200`).
- **Middleware:**
  - It runs for island requests, so each island costs another `getUser()`, has its own cookies and `locals`, and gets `private, no-store`.
  - `/_server-islands` isn't in `PROTECTED_ROUTES`, so the island must handle a signed-out request itself.
- **Placeholder:** the fallback slot is replaced in one step, once the island's whole body arrives.

**A client island calling an API route:**

- Each `fetch('/api/…')` is its own Worker invocation with its own `getUser()`.
- Requests start only after the JavaScript loads and hydrates. The watchlist pages ship no JavaScript today. The React chunks in the existing local build total about 260 KB uncompressed.
- A signed-out request gets a 302, which `fetch()` follows to the sign-in page, so the client has to check for it.

**`isOwnNavigation` and follow-up requests:**

- An island's or API route's request is a same-origin `fetch` (`Sec-Fetch-Site: same-origin`). So `isOwnNavigation` (`src/lib/services/search-query.ts:19-26`) returns true however the page itself was opened. Chrome prerendering is the exception: its requests carry `Sec-Purpose: prefetch;prerender`, which gives false.
- The page has to make the decision, in one of two ways:
  - render the prompt instead of the island
  - pass its own `isOwnNavigation` result in the island's encrypted props
- An encrypted flag can't be tampered with, but it can be replayed until the key changes. Binding it to the user id and a time narrows replay.
- A client island's props are plain JSON in the HTML, with no integrity.

**Which options meet "results appear as each shop answers":**

- server islands, one per shop
- a client island with API routes
- plain streaming only in document order

## Code References

- `src/lib/services/shops/rossmann.ts:20-34` — the item and response schemas: no price fields, and `recommendedProducts` dropped
- `src/lib/services/shops/natura.ts:29`, `:48`, `:90-94`, `:156` — the `price_amount` check, the search URL, hits that all fail to map become `failed`, the candidate price
- `src/lib/services/shop-matching.ts:11`, `:25-52` — digits-only EANs; the EAN search, then the name search
- `src/lib/services/shop-gate.ts:82-88`, `:94-112`, `:170-192` — the host check, refusals without a shop call, the RPCs
- `src/lib/services/shops/shop-outcome.ts:6-25` — gate outcome to unavailable reason
- `src/lib/shop-messages.ts:10-26` — unavailable texts, worded for search
- `src/lib/services/search-query.ts:19-26` — `isOwnNavigation`
- `src/pages/watchlist/[id].astro:21-31`, `:131-155` — the product page's reads, step and lookup, all in the frontmatter
- `src/pages/watchlist.astro:21-28` — the list's reads, one query each
- `src/middleware.ts:10-34` — one client, `getUser()`, redirects, `private, no-store`
- `supabase/migrations/20260926112205_polite_shop_access.sql:31-38`, `:58-82`, `:125-130` — closed tables, the cap, function grants
- `supabase/migrations/20260927145051_watchlist_items.sql:6-9`, `:29-42` — the Rossmann anchor, per-user RLS
- `supabase/migrations/20260927184936_watchlist_matches.sql:10`, `:32`, `:39`, `:45-51` — id formats, the Natura anchor and EANs, the composite key
- `src/lib/services/shops/fixtures/rossmann-search-empty.json:26-27`, `:59-60`, `:78-81`, `:179-180`, `:212-213`, `:227-230` — Rossmann promo and 30-day-low fields
- `src/lib/services/shops/fixtures/natura-ean-hit.json:55`, `:90`, `:92`, `:98`, `:149` — Natura price fields
- `node_modules/astro/dist/runtime/server/render/astro/render-template.js:36-68` — in-order flushing
- `node_modules/astro/dist/runtime/server/render/server-islands.js:184-200` — the island replacer ignores anything but a 200 `text/html` answer
- `node_modules/astro/dist/core/build/index.js:146-147` — `ASTRO_KEY`, or a new key per build

## Architecture Insights

- **Two database patterns exist:** closed tables reached only through `security definer` functions (F-01), and per-user tables with RLS per operation (S-01, S-02). Shared data that users write is new, and neither pattern gives it integrity without a server-only key.
- **A changed shop format becomes a gap.** A response that can't be read is never stored as a fact (`natura.ts:90-94`; S-02 review F2).
- **The per-shop cap is deployment-wide** and counted before each call. A design that refreshes many products per view spends it in proportion to the list's length.
- **What decides a status code or redirect stays in the page frontmatter.** Per-shop progress needs separate requests (islands or API routes), or it has to accept document order.

## Historical Context (from prior changes)

- `context/foundation/shape-notes.md:69` — the seed: "one shared price cache per EAN and shop". On identity, `prd.md:94` supersedes it (the per-shop item is the anchor).
- `context/archive/2026-09-27-watchlist-add-by-search/plan.md:73` — no shared products table; each user has their own copy.
- `context/archive/2026-09-26-polite-shop-access/plan-brief.md:38` — at the cap, the page shows the last known price.
- `context/archive/2026-09-26-polite-shop-access/plan.md:405` — the accepted risk of direct RPC calls by any signed-in user, to revisit before inviting more people.
- `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:650-657` — the carry-overs:
  - tighter EAN checks
  - a column-level update grant
  - stored ids treated as user input
  - both shops' prices
  - the cheapest shop on the list
- `docs/research/polish-drugstore-price-apis.md:251` — §6 step 7 lists `promotion` as Rossmann's promo field. **Verdict: partial.** `promotion` exists, but it marks campaigns too. In the 2026-09-27 recordings, the price cut, its window and the 30-day low are in `oldPrice`, `promotionFrom`/`promotionTo` and `lastLowestPrice`.

## Related Research

- `docs/research/polish-drugstore-price-apis.md` — shop endpoints and quirks (2026-09-17; §9 on 2026-09-23).
- `context/archive/` has no `research.md`.

## Follow-up: live requests (2026-09-28)

Six requests were sent from the developer machine at the owner's request on 2026-09-28 at about 02:32 CEST (00:32 UTC). They carried the gate's User-Agent and `Accept: application/json`, went 2.5 s apart, and didn't follow redirects. The script, `probe-shops.mjs`, is in the session scratchpad, and the bodies were saved next to it, not in the repo. All six answered HTTP 200.

| #   | Request                                                                                                                                        | Result                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rossmann `GET /products/v2/api/Products/131225?shopNumber=null`                                                                                | 2,927 characters, 193 ms. `price` 5.99, `oldPrice` 9.99, `lastLowestPrice` = `lastLowestPriceV2` 6.39 ("basic"), `promotionFrom`/`promotionTo` 2026-09-17 to 2026-09-30, `availability` "available", `differentPricesInShop` true, `promotions` ["mega", "promoAll"] |
| 2   | Rossmann `GET /products/v2/api/Products/26900?shopNumber=null`                                                                                 | 4,466 characters, 97 ms. `price` 26.99. No `oldPrice`, `lastLowestPrice` or promo window; `promotions` 3 × "seasonal"; `differentPricesInShop` true                                                                                                                  |
| 3   | Rossmann `GET /products/v4/api/Products?search=felix%20fantastic&page=1&pageSize=24`                                                           | 9,538 characters, 241 ms. 3 `data.items[]`, all reduced; each carries `oldPrice`, `lastLowestPrice`, `lastLowestPriceV2`, `promotionFrom`, `promotionTo` and `promotion.type` "mega"                                                                                 |
| 4   | Luigi's Box `f[]=type:product&f[]=sku:NV89063&size=5`, no `q`                                                                                  | 20,771 characters, 224 ms. `total_hits` 1: NV89063, with `price_amount` 16.99, `price_old_amount` 22.99, `lowest_price` ["17.990000"], `availability` 1                                                                                                              |
| 5   | The same with `f[]=sku:NV81063` added and `hit_fields=title,sku,ean,price_amount,price_old_amount,lowest_price,lowest_price_date,availability` | 1,001 characters, 117 ms. `total_hits` 2: NV89063 (365 characters) and NV81063 (342 characters), with only the requested attributes                                                                                                                                  |
| 6   | Luigi's Box `q=4005900009319&size=5` (the recorded EAN search, again)                                                                          | 20,756 characters, 127 ms. Same values as request 4; `lowest_price_date` still ["2026-09-27 00:00:00"]; the hit's `updated_at` is now "2026-09-27T20:04:06+00:00" (recorded: 06:05:32 the same day)                                                                  |

**What this settles:**

- **Rossmann's v2 detail by id carries the FR-011 fields** that the search carries, for one product per request (requests 1 and 2).
- **No 30-day low without a reduction.** Neither request 2's unreduced item nor any unreduced item in the recordings (section 1) carries `lastLowestPrice`.
- **Rossmann's `data.items[]` carries the promo fields too**, not only `recommendedProducts` (request 3).
- **Natura's SKU filter selects exactly the pinned item**, with no query (request 4).
- **Several SKUs come back in one request**, and `hit_fields` cuts a hit to about 350 characters (request 5).
- **`differentPricesInShop` is true** for both Rossmann items. So the online price can differ from a shop's shelf, which the online label covers.
- **The six bodies meet the fixture rule:** gate User-Agent, at least 2 s apart, developer machine. They can be trimmed into fixtures instead of re-recorded, as long as the session scratchpad keeps them.

**Still open:**

- **Whether `lowest_price_date` moves daily.** Both the recording and request 6 fall on 2026-09-27 in the index's own clock (its last update was 20:04 UTC on 2026-09-27), so a check after the index's next update is needed.
- **The window of Natura's `lowest_price`.** NV81063 has no reduction, yet its `lowest_price` of 10.99 is below its 17.99 price. So it may be a rolling 30-day low rather than the low before a reduction.
- **Whether Rossmann answers the v2 path from Workers.** §9 verified only the v4 search from Workers. **Answered below.**

**From Cloudflare Workers (2026-09-28, owner-approved during planning):**

- A throwaway Worker on the project's Cloudflare account sent one request: `GET /products/v2/api/Products/26900?shopNumber=null`. It carried the gate's User-Agent and followed no redirects.
- The Worker was deleted right afterwards. Its URL then answered 404, and production still answered 200.
- **Result:** HTTP 200 `application/json`, 4,466 characters, from the WAW data center, with no `cf-mitigated` header and no redirect. `price` was 26.99, `availability` "available", and there was no `oldPrice` or `lastLowestPrice`, matching request 2.
- So Rossmann answers the detail path from Workers, as §9 found for the search.

## Open Questions

**Facts that needed a live request** (see Follow-up: live requests):

1. **Rossmann v2 detail fields:** answered (requests 1 and 2), and Rossmann answers this endpoint from Workers (the throwaway Worker).
2. **Rossmann promo fields in `data.items[]`:** answered (request 3).
3. **Natura identity filter and batching:** answered (requests 4 and 5). The most SKUs per request hasn't been tested.
4. **Meaning of the price fields:**
   - Answered for Rossmann's `oldPrice`: the regular price, going by Felix's values.
   - Still open for Natura's `lowest_price` window and `lowest_price_date`. Compare NV81063's product page in a browser, and repeat the EAN search after the index's next daily update.

**Product decisions for the plan:**

5. The stale limit (PRD Open Question 5).
6. How the list's prices stay fresh within the cap (`context/foundation/roadmap.md:138`): refreshed when a product is opened, on request, or both.
7. The write path and trust model for shared prices (section 5), and whether other users watching the same item may see refresh times.
8. What an observation keeps (current, regular and promo price, 30-day low, promo window, availability), and how long history is kept, given S-04.

**Runtime checks:**

9. Three behaviours to check on the deployed app:
   - whether a preloaded island response is fetched twice, which would double the shop calls
   - whether workers.dev delivers streamed chunks straight away
   - what a visit spanning a deploy shows
10. Parallel island or API requests refreshing an expiring session at once. The local `refresh_token_reuse_interval` is 10 s (`supabase/config.toml:166-169`); production's value wasn't checked.
