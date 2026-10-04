---
date: 2026-10-02T22:40:58+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 1a74a2acecf50b5f8d97ab60463b5503852acbd8
branch: feat/hebe-in-comparison
repository: yaroslavkhudchenko/10xcourseproject
topic: "S-05 hebe-in-comparison: what it takes to add Hebe as a third shop, matched per product with its prices on the product page and the watchlist, and what Hebe's search answers today"
tags:
  [
    research,
    codebase,
    live-probes,
    hebe,
    luigis-box,
    shop-gate,
    matching,
    price-refresh,
    price-comparison,
    watchlist-rows,
    product-page,
    tests,
  ]
status: complete
last_updated: 2026-10-02
last_updated_by: Claude (claude-opus-5-5)
---

# Research: Adding Hebe as a third shop (roadmap S-05)

**Date**: 2026-10-02T22:40:58+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 1a74a2acecf50b5f8d97ab60463b5503852acbd8 (main after PR #22)
**Branch**: feat/hebe-in-comparison
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

What does it take to add Hebe (roadmap S-05) as a third shop: matched per product the way Drogerie Natura is, with Hebe's prices in the comparison on the product page and on the watchlist, and a Hebe candidate whose size doesn't match flagged rather than trusted on its EAN? Concretely:

- Which parts of the shop gate, the database, the matching, the price path and the two pages already work for a third shop, and which are hard-wired to Rossmann and Natura?
- What does Hebe's Luigi's Box search return today? In particular: can a pinned item be fetched by its id, as Natura's `f[]=sku:` can?
- Which earlier decisions, follow-ups and test assets apply?
- Which choices does `/10x-plan` have to put to the owner?

Scope: the change folder's `change.md`, four parallel read-only codebase workers (gate and database; matching and Natura's UI; the price path for N shops; prior decisions and test assets), the decisive lines re-checked in the main session, and 7 live requests to Luigi's Box, made with the owner's approval on 2026-10-02.

## Summary

1. **The infrastructure already takes Hebe; no migration is needed.**
   - `SHOP_HOSTS.hebe` lists `www.hebe.pl`, `live.luigisbox.com` and `scripts.luigisbox.com` (`src/lib/services/shop-gate.ts:11`).
   - `public.shops` was seeded with a `hebe` row (cap 30, enabled; `supabase/migrations/20260926112205_polite_shop_access.sql:40-44`).
   - `watchlist_matches.shop_id` and `price_observations.shop_id` are plain foreign keys to `public.shops(id)`, with no per-shop check, and the watcher predicate in their RLS names no shop (`20260928011450_price_observations.sql:89-127`).
   - `SHOP_IDS` already includes `hebe` (`src/types.ts:2`).
2. **The service and UI layers were built for one matched shop, Natura.** `PRICED_SHOPS = ["rossmann", "natura"]` (`price-comparison.ts:26`) and the Natura-only code paths are listed in §3–§6:
   - the refresh, the price keys and the targets;
   - the decision form's `shop: z.literal("natura")` and its Natura URL checks;
   - the lookups and the page's single matching step;
   - the page-wide `?repin=1` and `?retry=1`;
   - the island's single `natura` prop and the Natura card;
   - the list's Natura state and mismatch.

   The archived S-03 note (`context/archive/2026-09-28-cheapest-shop-today/plan.md:911`) says S-05 and S-06 add their shops to `PRICED_SHOPS` and `SHOP_LABELS`, a price lookup and `refreshPrices`, and that "The comparison rules, the island and the list take them without other changes." That is **partly contradicted**. The comparison rules do take N shops, but the island and the list don't: etykiety-redesign and S-08 added Natura-specific code after that note was written.

3. **Hebe's pinned prices can be fetched by id, in batches, except for items Hebe doesn't sell online.**
   - `f[]=type:item&f[]=ID:<id>` returns the asked-for item, and `hit_fields` trims a hit to about 750 bytes (probe 4). The batch was tried with 2 ids only; larger batches are untested.
   - On the three requests without `q` (probes 4–6), Hebe's tracker added `searchable:true` to the filters. An explicit `f[]=searchable:false` was dropped (probe 5).
   - So an item with `searchable: [false]` returns 0 hits on the pinned path, exactly like an unknown id (probes 4–6). The two requests with `q` (probes 2–3) had no implicit filter, and probe 2 returned such an item.
4. **Hebe's size attribute is unreliable, and the research note's "wrong EAN" reading doesn't hold for its one example.**
   - For EAN 4005900009319, Luigi's Box returned one hit: `Pojemność ["0.237"]`. Its legal name ("…300 ml"), its `ShortDescription` ("…, 300 ml") and its product URL ("…-300ml-…") all say 300 ml (probe 2).
   - In the 5 item hits inspected, `Pojemność` is litres with 3 decimals and no unit: the 100 g soap reads `0.100` and the 5,5 ml lip balm `0.005`.
   - The legal name and the description end in the size with its unit in all 5.
5. **Hebe marks "orderable online" with `online_flag` and `invAllocation`, not `availability`.** The 300 ml item has `availability: 1` with `online_flag: [false]` and `invAllocation: [0]`. The 4 orderable items have `online_flag: [true]` and stock in `invAllocation` (probe 2–3).
6. **The matching rule is shop-generic. What it decides for Hebe depends on where the candidate's size comes from.**
   - The rule (`matching.ts`) accepts exactly one candidate that shares an EAN and the size, with a brand that doesn't differ.
   - With `Pojemność`, the 300 ml EAN hit is flagged "Inny rozmiar" and left to the user. With the text size, it would be accepted automatically, yet it isn't sold online and can't be refreshed by id (point 3).
   - The rule never compares names, so a wrong EAN on another product of the same size and brand would be accepted. The S-08 plan review recorded this blind spot (`context/archive/2026-10-01-fix-matches-and-watchlist/reviews/plan-review.md:47`).
7. **Adding Hebe the same way as Natura doubles the first-open cost and, if done serially, the wait.**
   - A product with no decision costs 1–2 Luigi's Box requests per matched shop during the render. With both shops undecided, that's 2–4 requests to `live.luigisbox.com`.
   - Each search waits at most 4 s (`natura.ts:19-20`), so serial lookups for two shops could hold the render for up to 16 s. Running the shops concurrently is within the lesson's rule of one request at a time per shop (`context/foundation/lessons.md:16`).
   - The list refresh adds ⌈H/50⌉ Hebe requests for H stale Hebe items, if Hebe's id batches get the same 50-id cap as Natura's.
8. **Carry-overs.**
   - Withholding "Najtaniej" when a decision can't be read can't trigger on the product page today: its decisions are read all or nothing, and a lone Rossmann row is never marked cheapest.
   - The concrete three-shop gap is on the list. An odd Hebe decision row would drop Hebe silently while Natura reads fine, so the list could name a cheapest shop without Hebe's price.
   - The S-08 follow-ups for S-05 (re-pinning per shop, a reload alert that names the shop, the suspicious count per shop) all apply (§7).
9. **Tests start from good patterns, but every Hebe asset is missing.**
   - Available: the replay fetch, the Natura adapter's URL-pinning tests, the DB checks (which already use Hebe rows) and the e2e harness.
   - Missing: a Hebe adapter, fixture, unit test, e2e seed and kitchen-sink state.
   - Several unit tests pin Hebe as "not fetched yet" and will have to change (§8).
   - The 6 probe bodies were recorded the way CLAUDE.md asks fixtures to be recorded (curl, the gate's User-Agent, at least 2 s apart, not from CI), so they can become the fixtures if the owner agrees.

## Detailed Findings

### 1. Hebe's search answers today (live probes, 2026-10-02)

**Method**

- 7 requests between 20:32:18 and 20:34:11 UTC from the developer machine, approved by the owner in this session.
- Each request:
  - one at a time, at least 2.5 s apart;
  - with the gate's User-Agent `DrogeriaRadar/0.1 (+https://github.com/yaroslavkhudchenko/10xcourseproject)` (`shop-gate.ts:17`) and `Accept: application/json`;
  - no redirects followed, no retries.
- None went to `www.hebe.pl`, whose robots.txt disallows AI crawlers (research note §5).
- Bodies and headers are in the session scratchpad `probes/hebe/` (not committed).

| #   | Request                                                                                   | Answer                 | What it showed                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `scripts.luigisbox.com/LBX-505233.js`                                                     | 200, 24 299 B          | `trackerId:"421168-505233"`, unchanged since research §2.2                                                                                                                                               |
| 2   | `search?tracker_id=421168-505233&q=4005900009319&size=5`                                  | 200, 2 538 B, 1 hit    | item `000000000000251798` "Nivea Soft", EAN 4005900009319, `Pojemność ["0.237"]`, legal name and description "300 ml", `searchable [false]`, `online_flag [false]`, `invAllocation [0]`, `price "24.99"` |
| 3   | `…&q=nivea%20soft&size=10`                                                                | 200, 29 559 B, 10 hits | 4 `type: "item"` hits and 6 `type: "query"` suggestion pseudo-hits interleaved; `total_hits` 58; the 300 ml item was not among the 10 returned                                                           |
| 4   | `…&f[]=type:item&f[]=ID:000000000000218807&f[]=ID:000000000000251798&size=2&hit_fields=…` | 200, 756 B, 1 hit      | only `218807` came back; the echoed `filters` ended with `searchable:true`, which the request didn't send                                                                                                |
| 5   | as 4 plus `f[]=searchable:false`                                                          | 200, 776 B, 1 hit      | the explicit filter was dropped: echoed filters still `[…, "searchable:true"]`                                                                                                                           |
| 6   | `…&f[]=type:item&f[]=ID:000000000000999999&size=1&hit_fields=…`                           | 200, 304 B, 0 hits     | an unknown id gives an empty 200 JSON answer                                                                                                                                                             |

The probes 2–6 answers were also checked for headers and fields.

**Headers:** `cache-control: public, max-age=300` on probe 2's answer (`2-ean-search.headers`). Luigi's Box allows caching these answers for 5 minutes.

**Hit shape** (top-level keys of a probe 3 item: `url, identity_hash, attributes, nested, type, highlight, exact, alternative, updated_at`)

- **Real items** have `type: "item"`. Their id is the hit `url` (18 digits, such as `000000000000218807`), which equals `attributes.ID[0]` and `attributes.original_url`. `ShortProductID` holds the short form (`["218807"]`).
- **Suggestion pseudo-hits** have `type: "query"` and no `attributes.price` (probe 3). The research note's rule, keep hits with `attributes.price` (§2.2), and a `type === "item"` check both separate them in the 10 inspected hits.

**Price fields** (5 item hits in probes 2–3)

- `price` is a string (`"15.99"`) and `price_amount` a number.
- `price_sale` / `price_sale_amount` are present only on the 3 hits on sale (255134, 742817, 218607): a string and a number.
- `price_omnibus` / `price_omnibus_amount` are present on 4 of the 5 hits, including 218807, which is not on sale. Like Natura's `lowest_price`, the Omnibus low is reported without a reduction (research §2.5).
- `currency` is `["PLN"]`.
- No field carries a promotion end date. `CurrentProductPromotions` lists campaign codes, not dates.

**Orderability and links**

- `availability` is `1` on all 5 hits, including the offline-only 251798.
- `online_flag` (array of bool) and `invAllocation` (array of int) separate them: 251798 has `[false]`/`[0]`; the other 4 have `[true]` and a positive stock.
- `web_url` (array) and `image_link` point at `www.hebe.pl` on all 5 hits.

**Sizes** (5 item hits)

| item   | `Pojemność` | legal name / description |
| ------ | ----------- | ------------------------ |
| 251798 | `0.237`     | 300 ml                   |
| 218807 | `0.200`     | 200 ml                   |
| 255134 | `0.750`     | 750 ml                   |
| 742817 | `0.005`     | 5,5 ml                   |
| 218607 | `0.100`     | 100 g                    |

`size.ts` parses only a whole string such as "300 ml" (`src/lib/services/size.ts:4-12, 18-30`), so a trailing size would have to be cut out of the legal name or description first.

**Verdicts on the research note** (`docs/research/polish-drugstore-price-apis.md`)

- §1 row and proof table (`:13`, `:33`: "EAN query returned an item with `Pojemność: 0.237` (237 ml) → Hebe's EAN mapping is not clean"): **partial**. The observation holds: the EAN hit still has `0.237`. The conclusion is contradicted for this example: by legal name, description and URL, the hit is the 300 ml product, and the EAN is the one Rossmann lists for it. The sentences that rest on this example are CLAUDE.md:22 ("Hebe returns wrong EANs"), PRD FR-004's note (`prd.md:95`), the roadmap's S-05 risk (`roadmap.md:169`) and test-plan risk #6 (`test-plan.md:34`). Whether Hebe has wrong EANs elsewhere is unknown.
- §2.2 sample hit (`:96-111`, `price_sale "10.89"`): no longer current for 218807, which on 2026-10-02 has `price "15.99"`, no sale and `price_omnibus "10.89"`. Prices changed; the field roles stand.
- §2.2 "Prices are strings": **supported** for `price`, `price_sale` and `price_omnibus`. Each also has a numeric `*_amount` twin, which the note lists without types.
- No pinned-by-id request for Hebe was documented (§2.2 lists no `sku`-like filter). Probes 4–6 fill that gap: the filter field is `ID`, and the implicit `searchable:true` limits it.

### 2. Shop access and the database: ready for Hebe

**The gate**

- It charges each request to the explicit `shopId` argument, not to the host. `gate.fetch(shopId, url, init)` only checks that the URL is plain https to a host in `SHOP_HOSTS[shopId]` (`shop-gate.ts:85-92`).
- The reservation, report and log are keyed by the shop id in SQL (`20260926112205_polite_shop_access.sql:60, :72-81, :99-114`). Caps, pauses and stops of `hebe` and `natura` don't mix: `shop-gate.test.ts:304-334` sends a Hebe 403 and a Natura 429 on the same host and gets two per-shop reports.
- **The shared host has three consequences:**
  - Both shops' caps (30 a minute each by default) can together send 60 a minute to `live.luigisbox.com`. That's the bound the migration names ("60 is the research note's upper bound of one request per second per host", `:8`), and it was accepted in F-01 (`context/archive/2026-09-26-polite-shop-access/plan-brief.md:97`).
  - A refusal on one tracker pauses or stops only that shop.
  - The gate doesn't check the `tracker_id`, so a Hebe URL sent as `gate.fetch("natura", …)` (or the reverse) passes and is charged to the wrong shop.
  - Unknown: whether Luigi's Box limits per tracker or per client IP.

**The database** (all six migrations are on production and frozen; S-08 recorded the sixth beside the earlier five, `context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:986`)

- `public.shops` has the `hebe` row: cap 30, enabled, no reason (`:40-44`). No API role can write it; the owner re-enables a shop by SQL.
- `watchlist_matches` is generic:
  - `shop_id` references `public.shops(id)` with no CHECK on its values;
  - `shop_item_id ~ '^[A-Za-z0-9._-]{1,40}$'`;
  - unique `(watchlist_item_id, user_id, shop_id)`;
  - the update grant covers the decision columns only (`20260927184936_watchlist_matches.sql:20-94`; `20261001182905_watchlist_removal_and_repin.sql:24-32`).
- `price_observations` is generic too:
  - the same id check, plus "a letter or digit";
  - the watcher predicate for select and insert is "the product's own item, or a `matched` match to the item", with no shop named (`20260928011450_price_observations.sql:33-138`).
- `latest_price_observations` (`:144-178`) needs nothing.
- **Ordering rule kept from Natura:** the `matched` row must exist before the first Hebe price insert, as `src/pages/watchlist/[id].astro:141-148` does for Natura.
- **Ids:** Hebe's 18-digit hit `url` passes `PRODUCT_LIMITS.shopItemId` (40, `product-limits.ts:4-13`) and all three database checks. `shopItemIdSchema` (`matches.ts:33-36`) lacks the database's "a letter or digit" rule. That is harmless for digits, but `..` passes the schema and then fails the insert.

**Local and CI state**

- On 2026-10-02 at 22:41 CEST, the four local shops were enabled at cap 30, read through `docker exec … psql`.
- `scripts/check-shop-gate-db.mjs:86-98` stops the local `hebe` row ("HTTP 403") to prove a block report, and no script turns it back on.
- `scripts/e2e-local-db.mjs restore` releases only `e2e%` reasons (`:172-176`). A `supabase db reset --local`, or the owner's SQL update of `public.shops`, does.
- In CI the check runs first in the `smoke` job (`ci.yml:49-52`), so Hebe stays stopped for the rest of that job. That job's stack is separate from the `e2e` job's.

### 3. Matching: a generic rule inside Natura's flow

**The rule** (`src/lib/services/matching.ts`)

- **Accept:** `pickMatch` accepts exactly one qualifying candidate, which must share an EAN, have an `equal` size and a brand that isn't `differs` (`:34-58, :78-89`).
- **Otherwise:** it returns `choose` (qualifying first, at most 3 on a first lookup), or `none` only for zero candidates (`:79-81`).
- **Sizes:** `sizesEqual` needs the same unit within 0.1 %. Rossmann's `unit` goes straight into `parseSize`; Natura's `size` + `size_unit` are rebuilt as "300 ml" first (`natura.ts:336-348`).
- **Brands:** `brandsAgree` normalises both and lets a prefix agree (`:101-109`). `matchDifferences` warns only on known, differing sizes or brands (`:92-94`).
- **What a candidate must provide** (`types.ts:156-187`):
  - the rule reads `eans`, `size` and `brand`;
  - the chain also needs `shop`, `shopItemId`, `name`, `sizeText` (which must parse back to the same `size`, because the confirm form posts the text and the server parses it again, `matches.ts:137`), `productUrl`, `imageUrl` and an `offer`.

**Hebe's EAN example under the rule**

- The rule refuses a same-EAN candidate whose size differs. Tests pin that (`matching.test.ts:180-191`; `shop-matching.test.ts:72-85`).
- With `Pojemność` as the size, probe 2's hit is "Inny rozmiar: 237 ml zamiast 300 ml".
- With the legal name's trailing size, it qualifies (EAN, 300 ml, brand Nivea/NIVEA) and would be accepted automatically. It is offline-only and invisible to the pinned price path (§1).

**The flow is Natura's:**

- `lookupInNatura` and `lookupChoicesInNatura` call `searchNatura` and log `natura-lookup` (`shop-matching.ts:4, 26-53, 64-143, 147`).
- `decisionFields.shop` is `z.literal("natura")`, so a `shop=hebe` post is `invalid`, and the confirm form checks URLs with `isNaturaProductUrl` and `isNaturaImage` (`matches.ts:66-72, 89-90`).
- `DECISION_NOTICES.declined` reads "Zapisano: brak w Naturze.", and the notice codes carry no shop (`src/lib/notices.ts:10-20`).
- `decideMatchStep` takes any shop (`match-step.ts:36-52`), but `retrying` and `repinning` are page-wide booleans from `?retry=1` and `?repin=1` (`:20-23`), and `autoRefreshOf` takes one step (`:64-66`).
- `record`, `recordLookup`, `recordDecision`, `listMatches` and `listMatchStates` are generic (`matches.ts:220-304, 350-438`).

**First lookup on a non-qualifying EAN hit**

- An EAN search that returns candidates ends the first lookup. The name search runs only when the EAN search finds nothing (`shop-matching.ts:33-36`).
- So a Hebe EAN hit that doesn't qualify becomes a one-item choice, and the right item, if the name search would find it, shows up only after "Żaden z nich" and "Dopasuj ponownie".
- Running the name search after a non-qualifying EAN result would cost one more request.
- For "nivea soft" the name search didn't return the 300 ml item in its first 10 hits (probe 3).

### 4. The price path: fetch → store → read → compare → display

**What a shared Luigi's Box module could take from `natura.ts`** (parameterised by shop id, tracker, id field, hit fields and mapper)

- `SEARCH_URL` (`:11`), the response schema and `readHits` (`:51, :306-324`), `isProductHit` (`:139-154`) and the search loop (`:59-91`).
- The dedupe, batch and refusal loop (`:100-133`), and the "missing only if every hit was read and was asked for, else failed" rule (`:256-265`).
- The skeleton of `priceUrl` (`:273-283`), `isSku` (`:289-291`), the 404 "tracker id rejected" log, and the small helpers (`:351-390`).
- **Natura-only:** the tracker, the `sku` filter field, `PRICE_FIELDS` (`:25`), the attribute schema (`:35-50`), `toCandidate` (`:168-195`), `toOffer` (`:202-210`) and the host checks (`:157-165`).
- `fetchPriceBatch` matches hits by `hit.url` (`:239`), and that works for Hebe, whose `url` is the id.
- The shareable helpers (`readHits`, `isProductHit`, the value helpers) are module-private today. The module exports only `NATURA_TRACKER_ID`, `searchNatura`, `fetchNaturaPrices`, `isNaturaProductUrl` and `isNaturaImage`. The pieces already shared across adapters are `shop-outcome.ts`, `shop-offer.ts`, `size.ts` and `product-limits.ts`.
- **Hebe's mapping from the probes** (to be decided in the plan):
  - price = `price_sale_amount` when present, else `price_amount`;
  - regular price = `price_amount` when a sale is present (`storableOffer` keeps it only when above the price, `shop-offer.ts:24-37`);
  - `lowestPrice30d` = `price_omnibus_amount`; promotion end = null;
  - orderable from `online_flag`/`invAllocation`;
  - the filter field `ID`, batched like Natura's;
  - host checks for `www.hebe.pl`.

**The refresh and targets are hard-wired**

- `refreshPrices` runs `Promise.all([Rossmann, Natura])`, and every other shop's key gets `notFetched()`, which is `unavailable/failed` (`price-refresh.ts:40-57, 109-112`).
- `productPriceKeys(product, naturaSku)` (`price-comparison.ts:389-401`), `listPricedItems` (only `match.shop === "natura"`, `:409-428`) and `productTargets` (`price-targets.ts:104-114`) are Natura-only. So are the page's own priced items (`[id].astro:182-188`), which re-implement `productPriceKeys` (a product-page-ui follow-up).
- The routes, `priceTargetFor` with its 409 `changed` (`price-targets.ts:65-77`), the non-Rossmann branch of `shopItemFor` (`:39-57`), `staleTargets`, `recordPriceChecks` and the latest-price reads are generic. The list read's shop filter follows `PRICED_SHOPS` (`prices.ts:150`).

**The comparison and display take N shops, but the names and colours are typed for two**

- `compareShops`, `verdictOf` and `namesOf` handle any number of rows ("Rossmann, Hebe i Natura" is the docstring example, `price-comparison.ts:571`). So do `heroOf`, `trackOf`, `ShopCard`, `ShopLink` and the `PRICES_EVENT` payload.
- `SHOP_LABELS` (`price-comparison.ts:38-41`) and `SHOP_FILLS` (`shop-fills.ts:7-10`) are `Record<PricedShop, …>`, so adding `hebe` to `PRICED_SHOPS` makes the compiler ask for both.
- Hebe needs:
  - a label (for example `{ name: "Hebe", in: "w Hebe", site: "hebe.pl" }`);
  - a `--shop-hebe` colour in `:root` and `.dark` with a `--color-shop-hebe` entry (`global.css:57-58, 120-121, 186-187`). The design handoff defines only Rossmann's and Natura's colours, so the owner picks one, and `scripts/check-token-contrast.mjs` requires oklch.
- `ListFooter.astro:6` joins the sites with " i ", which would read "a i b i c" with three shops.

**Request costs** (today, from the inspected paths; own navigation, JavaScript on)

| Action                         | Rossmann                  | Natura                                                                           | Hebe added the same way                    |
| ------------------------------ | ------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| Product view, decision stored  | ≤ 1, if stale             | ≤ 1, if matched and stale                                                        | + ≤ 1                                      |
| Product view, no decision      | ≤ 1                       | 1–2 searches in the render, then ≤ 1 (0 after an auto match with a stored offer) | + 1–2 searches, + ≤ 1                      |
| Product view with `?repin=1`   | 0 (auto-refresh off)      | 2 searches                                                                       | today's page-wide flag would run both: + 2 |
| Foreign link, prefetch, prompt | 0                         | 0                                                                                | 0                                          |
| Product "Odśwież ceny"         | 1                         | 1 if matched                                                                     | + 1 if matched                             |
| List "Odśwież ceny"            | 1 per distinct stale item | ⌈stale SKUs / 50⌉                                                                | + ⌈stale Hebe ids / 50⌉                    |

- Sources: `shop-matching.ts:26-53`, `match-step.ts:59-66`, `PriceComparison.tsx:96-128`, `price-refresh.ts:64-79`, `natura.ts:117-131`, and the S-08 cost table (`context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:761-772`).
- A pending `choose` is never stored, so every reload repeats its 1–2 searches.

### 5. The product page and the island assume one matched shop

- **The page:** it runs one `decideMatchStep({ shop: "natura" })` (`[id].astro:119`) and holds one `natura` view, `repin`, `naturaItem` and `step`. `choice = repin ?? choose` renders at most one `NaturaSection` (`:118-175, :321-341`).
- **The island:**
  - It takes one `natura` prop (`PriceComparison.tsx:37`).
  - `ShopGrid` special-cases `row.shop === "natura"` and appends Natura's card without a price (`PriceComparisonView.tsx:145-174`).
  - `naturaUndecided` and `naturaUnreadable` are single values, and `heroOf` and `trackHint` say "Natura czeka na dopasowanie" (`price-comparison-state.ts:398, 559-567`).
  - `rowShopsOfIsland` adds a synthetic unread Natura row (`:327-333`).
  - `match-changed` is one boolean, with "Dopasowanie w Naturze się zmieniło." (`PriceComparisonView.tsx:86-101`).
- **The section and card:** `NaturaSection.astro` has the heading "Drogerie Natura", a hidden `shop=natura` field, `idPrefix` "natura" and the submit-once group "natura-decision". Every text in `natura-card.ts` and `natura-view.ts` names Natura.
- **Notices:** `decisionNotice` ignores the shop, and the page hands the notice to Natura's card (`[id].astro:214, 221`).
- **Parameters:** a page-wide `?repin=1` with two matchable shops would run both shops' choices (up to 4 Luigi's Box requests), and a page-wide `?retry=1` would retry the other shop's "not found" too.
- **Subrequests:** each product view makes 5 database subrequests at once, against Workers' 6 simultaneous connections per request. The redesign's review accepted that and said to revisit it "before a change adds another read to the product page" (`context/archive/2026-09-30-etykiety-redesign/follow-ups/review-fixes.md:25`). Every gate call also reserves through Supabase. The total with a second shop's lookup wasn't traced.

### 6. The list: Natura's state and mismatch

- `naturaStateOf`, `naturaMismatchOf`, `NATURA_STATUS` and `mismatchText` are Natura's (`watchlist-rows.ts:120-138, 335-347`). So are `listRowOf`'s single Natura parameter and the ListRows alert "Nie udało się wczytać dopasowań w Naturze." (`ListRows.astro:40`).
- **"Do sprawdzenia"** (`check`) holds a row whose automatic match differs, whose Natura is `none`, `not_found` or `unreadable`, or which has a stale or unread price (`watchlist-rows.ts:175-180`). Hebe under the same rule would put every product added before S-05 into the chip, as Hebe `none`, until it is opened. Each opening costs 1–2 Hebe searches.
- **All-or-nothing reads:**
  - `listMatches` fails the whole product read on any odd row (`matches.ts:350-364`), so an odd Hebe row would make Natura's step `read-failed` too.
  - `listMatchStates.unread` holds product ids, not product and shop (`:395, :430-435`).
  - Both are harmless while the app writes only Natura rows.

### 7. Carry-overs and earlier decisions

- **"Najtaniej" while a decision can't be read** (`roadmap.md:170`; `context/archive/2026-09-30-etykiety-redesign/plan.md:1169`)
  - The cards' mark comes from `row.cheapest` (`ShopCard.tsx:75-82`), from `compareRows` (`price-comparison-state.ts:270-279`), which withholds it only when a row has `readFailed` (`:272`). The live region's ", najtaniej" is in `announcement` (`:190-207`).
  - On the product page, an unreadable decision read gives no matched shop a price row, and a lone Rossmann row is never marked cheapest (`price-comparison.ts:167`). That holds with Hebe as long as Hebe's decision comes from the same read.
  - Withholding both is cheap: pass the flag into `compareRows` and the reducer's state. The list is where the gap is real (§6).
- **S-08 follow-ups for S-05** (`context/archive/2026-10-01-fix-matches-and-watchlist/follow-ups/review-fixes.md:5-13`):
  - re-pinning is Natura's only, so a new matched shop needs its own choice lookup plus "Zmień" and "Dopasuj ponownie" on its card;
  - the island's `match-changed` should carry its shop, and the alert should name that shop;
  - the brand rule and the suspicious count read Natura's match only, so Hebe's matches need the same count in "Do sprawdzenia".
  - Accepted risks to revisit are in the same file at `:15-21`.
- **Other follow-ups that touch a new shop:**
  - "Najtaniej" beside a shop still loading (`etykiety-redesign/follow-ups/review-fixes.md:20`);
  - stop asking a shop after two failed requests in a row, Natura's batches included (`context/archive/2026-09-28-cheapest-shop-today/follow-ups/review-fixes.md:22-26`);
  - bound `regular_price` and `lowest_price_30d` in the next price migration (`:17-20`);
  - S-02's rule that a stored id is user input: require a letter or digit, reject dot segments and encode it before it goes into a shop URL (`context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:650-657`).
- **The tracker id is a constant, not read from the page:** `NATURA_TRACKER_ID`, chosen to avoid a 3.3 MB page (`shop-matching-first-two-shops/plan-brief.md:33`; CLAUDE.md:52). Hebe's script `LBX-505233.js` is 24 KB (probe 1), though `SHOP_HOSTS.hebe` lists `scripts.luigisbox.com` too.
- **Recordings have contradicted the research note before:**
  - Rossmann's `fallbackName` (`context/archive/2026-09-27-watchlist-add-by-search/plan.md:546`);
  - Natura's unknown tracker answering 404 text/plain, `web_url` as a one-element list, and a different price (`shop-matching-first-two-shops/plan.md:604-612`).
  - Test-plan risk #5 rests on these (`test-plan.md:33, 47`).
- **Test-plan guidance for this slice** (`context/foundation/test-plan.md`):
  - risk #3 names the host Hebe and Natura share, and asks for integration through the real gate that counts the URLs the replay served (`:45`);
  - risk #5 asks for contract tests on deliberately broken copies of the recordings (`:47`);
  - risk #6 asks for unit tables on real recorded candidates, wrong-EAN cases included, warns against "candidates invented to pass" (`:48`), and treats "A shared EAN means the same product" as an assumption to challenge;
  - rollout Phase 3 "Shop answer contracts" is meant as "the pattern the Hebe and Super-Pharm adapters reuse" (`:59`), and §6.4 is still TBD (`:144-146`).

### 8. Test assets and patterns

- **Replay fetch:**
  - `createReplayFetch` (`src/lib/services/testing/replay-fetch.ts:13-26`) matches the normalised `href` exactly, so the recorded URLs must use the adapter's parameter order and encoding, such as `f%5B%5D` (`natura.test.ts:20-23`).
  - A miss rejects, which the gate reports as `failed/network` (`shop-gate.ts:131-133`). That's why every adapter test asserts `requestedUrls(fetchMock)` (`natura.test.ts:64-67` and others).
- **Fixtures:** `src/lib/services/shops/fixtures/` holds 13 JSON files named `<shop>-<case>.json`, none for Hebe. Natura has six bodies (EAN hit and miss, name search, one SKU, two SKUs, unknown SKU) plus the 404 wrapper `natura-unknown-tracker.json`. Provenance is in the test headers and plans only. The S-02 plan sets the recording rule (`plan.md:203-208`): curl from the developer machine, at least 2 s apart, the gate's User-Agent, at most 5 hits, no personal data.
- **Natura's tests:** `natura.test.ts` (753 lines, 7 describe blocks) pins its tracker in the expected URLs and covers:
  - pseudo-hits (the comment at `:217` names Hebe's);
  - one odd hit;
  - a format change giving `unavailable`, never empty;
  - an unknown tracker;
  - 403/500;
  - batches of 50 (51 SKUs make 2 requests);
  - the stop after a refusal.

  `shop-matching.test.ts` is test-plan §6.1's reference test. Hebe's tracker already appears in `shop-gate.test.ts:10` (`HEBE_SEARCH`).

- **Tests that pin Hebe as "not fetched yet" and will change:**
  - `price-targets.test.ts:144` and `:250-255`;
  - `price-refresh.test.ts:377-396`;
  - `prices.test.ts:352`;
  - `price-comparison.test.ts:618-622` and `:644-653`;
  - `matches.test.ts:313`;
  - `match-step.test.ts:108-117`;
  - `watchlist-rows.test.ts:548-554` and `:609-629`.
- **DB checks:**
  - `check-matches-db.mjs` already writes Hebe rows with id `000000000000218807` (`:81-82, :137-224`).
  - `check-prices-db.mjs` proves a watcher through a match with Natura only (`:69-77, :205-221`). The policy names no shop, so a Hebe case is optional.
- **e2e:**
  - `matchNatura` hard-codes Natura (`tests/e2e/support/watchlist-data.ts:124-138`). `recordPrice`, `recordMissing` and `backdateChecks` take any `ShopId` (`:145-182`).
  - `cardOf` is typed `"Rossmann" | "Natura"` (`support/pages.ts:22-27`).
  - `auth.setup.ts:44-49` proves that only `["rossmann","natura"]` answer `stopped`.
  - `stopShops` holds every enabled row, Hebe included (`scripts/e2e-local-db.mjs:140-144`).
  - The cookbook is test-plan §6.3 (`:118-142`). Choosing a candidate isn't reachable in e2e because it needs the shop's answer (`testing-critical-browser-flows/plan.md:67-69`).
- **Kitchen sinks:**
  - `src/dev/fixtures.ts` carries a single `natura: NaturaCardInput` per fixture, with Natura decision fixtures and 18 Natura states (`:146-178, :194-204, :493-629`).
  - `src/dev/watchlist-fixtures.ts` builds rows with one `NaturaListState` (`:99-129`).
  - Both pages follow the island's single-Natura contract (`src/dev/product-page.astro:310-370`).

## Code References

- `src/lib/services/shop-gate.ts:9-14` - `SHOP_HOSTS`, Hebe's three hosts included
- `src/lib/services/shop-gate.ts:85-92` - host check; the shop is the explicit argument
- `supabase/migrations/20260926112205_polite_shop_access.sql:8, 40-44` - the per-host bound comment; the seeded `hebe` row
- `supabase/migrations/20260928011450_price_observations.sql:89-127` - the shop-agnostic watcher predicate
- `src/types.ts:2` - `SHOP_IDS` with `hebe`; `:156-187` the candidate shape; `:208-211` `NaturaChoices`
- `src/lib/services/price-comparison.ts:26-41` - `PRICED_SHOPS`, `SHOP_LABELS`; `:389-428` `productPriceKeys`, `listPricedItems`
- `src/lib/services/price-refresh.ts:40-57, 109-112` - `refreshPrices`, `notFetched`
- `src/lib/services/price-targets.ts:39-57, 65-77, 104-114` - `shopItemFor`, `priceTargetFor`, `productTargets`
- `src/lib/services/matches.ts:66-72, 89-90` - the Natura-only decision field and URL checks; `:350-438` the reads
- `src/lib/services/shop-matching.ts:26-53, 64-143` - the Natura lookups
- `src/lib/services/match-step.ts:20-23, 36-66` - page-wide retry/re-pin, `decideMatchStep`, `autoRefreshOf`
- `src/lib/services/matching.ts:34-109` - the rule; `src/lib/services/size.ts:4-30` - `parseSize`
- `src/lib/services/shops/natura.ts:11-390` - the Luigi's Box client and Natura's mapping
- `src/pages/watchlist/[id].astro:118-188, 214-252, 321-341` - the single Natura step, priced items, notices, choice
- `src/components/watchlist/PriceComparisonView.tsx:86-174` - the alert and `ShopGrid`'s Natura branch
- `src/components/watchlist/price-comparison-state.ts:190-207, 270-301, 327-333, 398, 559-567` - announcement, `compareRows`, verdict, the synthetic Natura row, Natura texts
- `src/lib/services/watchlist-rows.ts:120-182, 335-347` - Natura's list state, status lines and "Do sprawdzenia"
- `src/components/watchlist/shop-fills.ts:7-10`, `src/styles/global.css:57-58, 120-121, 186-187` - shop colours
- `scripts/check-shop-gate-db.mjs:86-98` - stops the local `hebe` row
- `tests/e2e/auth.setup.ts:44-49`, `tests/e2e/support/watchlist-data.ts:124-138`, `tests/e2e/support/pages.ts:22-27` - Natura-only e2e helpers

## Architecture Insights

- **The data layer is shop-generic by design**: F-01 seeded all four shops and `SHOP_HOSTS` with their hosts; S-02 and S-03 keyed matches and observations by a foreign key to `shops`. The Natura coupling sits in services and views, so Hebe is mostly a code change with no migration.
- **Two shapes of "shop" exist**: Rossmann is the product's source (`watchlist_items.source`), while Natura is a matched shop (`watchlist_matches`). Hebe is a second matched shop. Every Natura-only function in §3–§6 is really "the matched shops", with one member. The plan's main structural choice is whether to generalise these to a list of matched shops, or to add Hebe beside Natura as a copy. The lesson "Define shared constants and helpers once" (`lessons.md:40-45`) and the compile-time `Record<PricedShop, …>` favour generalising.
- **Luigi's Box is shared infrastructure for two shops**: one host, two trackers, the same response schema. Everything above the attribute mapping in `natura.ts` is a Luigi's Box client that a third tracker can reuse.
- **The lessons constrain the plan directly**:
  - per-view request costs must be stated (`lessons.md:16`);
  - an unreadable answer is never `missing` or `not_found` (`:22-24`), which matters for Hebe's "0 hits on the pinned path", which can mean either "gone" or "not sold online";
  - decision logic belongs in tested services (`:26-31`);
  - what a direct PostgREST call allows has to be listed (`:33-38`). Nothing new here, since no table or grant changes.

## Historical Context (from prior changes)

- `context/archive/2026-09-26-polite-shop-access/plan-brief.md:97` - Hebe and Natura sharing Luigi's Box at up to 60 a minute was accepted.
- `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:21, 25, 71, 572` - Hebe shares the host; Hebe's pseudo-hit; Hebe out of S-02; the 60 a minute bound.
- `context/archive/2026-09-27-shop-matching-first-two-shops/plan-brief.md:33` - the tracker id as a constant.
- `context/archive/2026-09-28-cheapest-shop-today/plan.md:911` - "S-05 and S-06 add their shops to `PRICED_SHOPS` and `SHOP_LABELS`, a price lookup through the gate, and `refreshPrices`". **Partial today:** true for the comparison rules, contradicted for the island and the list (§4–§6).
- `context/archive/2026-09-30-etykiety-redesign/plan.md:1169` - the "Najtaniej" withholding for a third shop.
- `context/archive/2026-09-30-etykiety-redesign/follow-ups/review-fixes.md:20, 25` - "Najtaniej" beside a loading shop; 5 subrequests per product view.
- `context/archive/2026-10-01-fix-matches-and-watchlist/follow-ups/review-fixes.md:5-13` - the three S-05/S-06 follow-ups.
- `context/archive/2026-10-01-fix-matches-and-watchlist/reviews/plan-review.md:47` - "S-05/S-06 may auto-accept on name and size".
- `context/archive/2026-10-02-testing-critical-browser-flows/plan.md:20, 67-71` - CI leaves Hebe stopped in the smoke job; no recorded answers in the browser layer.

## Related Research

- `context/archive/2026-09-27-shop-matching-first-two-shops/research.md` - Natura's matching research
- `context/archive/2026-09-28-cheapest-shop-today/research.md` - the price path and the per-shop cost questions
- `context/archive/2026-10-01-fix-matches-and-watchlist/research.md` - re-pinning, the brand rule and the suspicious count
- `docs/research/polish-drugstore-price-apis.md` §2.2, §5, §6, §7, §9 - Hebe's original API notes, which §1 updates

## Open Questions

For `/10x-plan`; each is the owner's call unless marked otherwise.

1. **Hebe's size.**
   - Read it from the legal name or description, with its unit, or from `Pojemność`?
   - What happens when the two disagree, as on probe 2's hit? Options: treat the size as unknown (never auto-accepted, flagged "Rozmiar nieznany"), or prefer the text.
2. **Items Hebe doesn't sell online** (`searchable: [false]`, `online_flag: [false]`). The EAN search returns them, but the pinned price path can't fetch them. Options:
   - leave them out of the candidates;
   - allow them, and refresh them through a text search (`q=` with the EAN or id, one request each; the probes didn't test whether `q=<id>` finds an item);
   - allow them and accept that a refresh records them as `missing`, which the lessons and US-02 would show as an out-of-date price, not a gap.
3. **Automatic acceptance for Hebe.** The same rule as Natura (EAN + size + brand), or stricter? Options: never auto-accept a Hebe candidate, or also compare name tokens, as research §6 step 6 suggests. This bears on the roadmap's "not trusted on its EAN" and on the S-08 plan review's blind spot.
4. **First lookup after a non-qualifying EAN hit.** Also run the name search (one more request), so the right item can appear without a re-pin, or keep Natura's behaviour?
5. **Generalise or duplicate.**
   - Make the matched-shop code per shop: lookups, decision form, retry and re-pin parameters per shop (for example `?repin=hebe`), notices carrying the shop, one choice section and card per shop, the island taking a list of matched shops, the list's state and mismatch per shop.
   - Or add Hebe beside Natura as a copy.
   - Planning also decides whether the shared Luigi's Box client becomes its own module.
6. **Existing products in "Do sprawdzenia."** Under today's rule, every product added before S-05 has Hebe `none` and would join the chip until opened, at 1–2 Hebe searches per opening. Is that wanted?
7. **Hebe's colour token** (`--shop-hebe`, light and dark). The design handoff has none.
8. **Lookups across shops in the render.** Run Natura and Hebe concurrently, to keep the worst-case wait near 8 s rather than 16 s? The lesson limits one request at a time per shop only. Planning should also confirm the product page's subrequest count against Workers' 6 simultaneous connections (§5).
9. **A guard against the wrong attribution.** Should the adapter, or the gate, check that a Luigi's Box URL's `tracker_id` belongs to the shop it is charged to? (Planning detail.)
10. **Docs to correct in the slice's docs phase.**
    - The research note: §1 and §2.2's "wrong EAN" reading, §2.2's pinned-by-`ID` request and its `searchable` limit, and the `*_amount` types.
    - CLAUDE.md:22, PRD FR-004's note, the roadmap's S-05 risk and test-plan risk #6, which rest on the same example.
11. **Fixtures.** May the 6 probe bodies (`probes/hebe/2-…` to `6-…`) become the Hebe fixtures, trimmed to at most 5 hits as S-02 did? Or should the plan record new ones? Broken copies for risk #5's contract tests would be derived from them.
12. **Rollout Phase 3 of the test plan** ("shop answer contracts"). Fold its pattern into this slice's adapter tests, or leave it to its own change?
