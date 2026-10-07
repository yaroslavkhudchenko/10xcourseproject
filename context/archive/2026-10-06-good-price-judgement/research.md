---
date: 2026-10-06T23:45:00+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 4c49096e6111bfffdb95cc0fe1234b3285a3a7de
branch: feat/good-price-judgement
repository: yaroslavkhudchenko/10xcourseproject
topic: "S-04 good-price-judgement (FR-012): what data a judgement of today's cheapest price can stand on (the stored price history and each shop's declared 30-day low), what the design draws for it, where it plugs into the product page, and what earlier changes left for it"
tags: [research, codebase, s-04, fr-012, price-observations, lowest-price-30d, sticker, price-track, verdict]
status: complete
last_updated: 2026-10-06
last_updated_by: Claude (claude-opus-5-5)
---

# Research: whether today's price is a good one (S-04, FR-012)

**Date**: 2026-10-06T23:45:00+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 4c49096 (`main` after PR #34)
**Branch**: feat/good-price-judgement
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

FR-012 asks: the user can see whether today's cheapest price is a good one. The PRD says how the judgement works:

- It is made against the product's own price history once enough exists, and against the shop's declared 30-day low until then.
- It is labelled with which comparison was made.
- How much history counts as enough, and which threshold separates a good price from an ordinary one, are open (PRD "Business Logic", `context/foundation/prd.md:163-167`; Open Question 4, `:203`).

This research covers four things:

- what the app stores that a judgement can use;
- what each shop's 30-day low means;
- what the design draws;
- where the judgement plugs in.

Two read-only workers gathered the evidence: the data and rules, and the design and past decisions. This document is their synthesis.

## Summary

1. **History is stored but never read, and it is young and uneven.**
   - `price_observations` keeps every answered check of every shop item: the price (a promotion's included), the regular price during a promotion, the shop's declared 30-day low, whether it's orderable online, and when it was seen (`supabase/migrations/20260928011450_price_observations.sql:33-66`). It is append-only, with no retention.
   - No code reads more than each item's last check (`src/lib/services/prices.ts:85-87`, `:228-233`). Watchers may already read every row (`:89-107`).
   - Rows exist only since S-03 reached production on 2026-09-29: Hebe items since 2026-10-04, Super-Pharm items since 2026-10-06.
   - Rows come only from people opening or refreshing a product. That is at most one automatic check per item per 15 minutes, plus the buttons. There is no daily refresh (FR-015 is unbuilt), so a product nobody opens gathers nothing.
2. **The shops' 30-day lows differ in presence and in meaning.**
   - **Rossmann** sends one only while an item is reduced (`docs/research/polish-drugstore-price-apis.md:53-55`).
   - **Natura** sends one on every recorded hit (12 of 12).
   - **Hebe** sends one on every item it sells online (16 of 16).
   - **Super-Pharm** sends one on only 16 of 47 recorded lookup hits, and `false` on the rest.
   - Recorded data suggests a pattern, inferred and unconfirmed by the shops:
     - while a reduction runs, the declared low is the pre-reduction low, above today's price;
     - with no reduction, it is the rolling 30-day minimum and often well below today's price. Hebe's 10 AA LAAB hits all sit about 30 % above their low.
3. **The design draws two judgements, both against the cheapest shop's declared low** (`context/archive/2026-09-30-etykiety-redesign/handoff/`):
   - **"Dobra / cena!"** (mint fill, `#B5EDCB`, the same colour as `--shop-natura`) for a price below that low, with "Poniżej najniższej ceny z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu."
   - **"Zwykła / cena"** (white) for a price equal to it, with "Równa najniższej cenie z 30 dni wg sklepu."
   - The sticker is decorative (`aria-hidden`). The judgement is repeated as text in the price-track card, or in a plain card when there is no track (README `:110-120`).
   - The design leaves several things undrawn:
     - a price above the low;
     - a judgement against the product's own history;
     - any threshold or history length;
     - any mark on a list row.
4. **The pieces wait for the rule.**
   - The hero's sticker is chosen in `heroOf`, which knows only `one-shop` and `stale` (`src/components/watchlist/price-comparison-state.ts:407-419`, `:427-480`; `Sticker.tsx:3-7`, `:24-27`).
   - The price track's sentence slot is `trackHint`, which now speaks only to undecided shops and stale prices (`:658-670`; `PriceTrack.tsx:56-79`).
   - The track already draws the verdict's shops' lowest declared low as a tick (`trackOf`, `:499-559`).
   - Every one of these was left "facts only until FR-012" by the owner's 2026-09-29 decision (`context/archive/2026-09-30-etykiety-redesign/change.md:19`).
   - `heroOf`'s tests compare the whole `Hero` with `toEqual` (`price-comparison-state.test.ts:727-815`), so a new field there is a deliberate test change.
5. **Two follow-ups wait for S-04's migration** (`context/archive/2026-09-28-cheapest-shop-today/follow-ups/review-fixes.md:5-20`):
   - **F4:** drive `latest_price_observations` from the caller's watched items instead of scanning the table. It comes with a partial index on priced rows and a `shop_id` filter on the product page's read.
   - **F6:** bound `regular_price` and `lowest_price_30d` below 100000.

   A history read must also respect the product page's connection budget: the page already makes about 5 simultaneous subrequests against Workers' 6 (`etykiety-redesign/follow-ups/review-fixes.md:25`; `infrastructure.md:72`'s pre-mortem). So history is best summarised in the read the page already makes, not fetched beside it.

6. **One more carry-over:** the list's screen-reader line for a row with two or more shops and no current price says only "Ceny nieaktualne. Odśwież ceny lub otwórz produkt.", while its visible tag shows the shop, the price and the age (`src/lib/services/price-comparison.ts:606-608`, pinned by `price-comparison.test.ts:1030-1034`; roadmap `:156`).

## Detailed Findings

### What one observation holds, and who reads it

- **What a row is:** one answered check of one item.
  - Either the offer: `price` (the current price, a promotion's included), `regular_price` (only during a promotion), `lowest_price_30d`, `promo_ends_on` and `available`.
  - Or `missing`.
  - A check that got no answer stores nothing (`prices.ts:39-58`).
- **Products and windows:** there is no product-level row. A product's history is the union of its items' rows (`productPriceKeys`, `price-comparison.ts:449-466`).
- **Reading access:** RLS lets a user read an item's rows while they watch it, through their product's own item or a `matched` decision (`price_observations_select_watched`, migration `:89-107`). So a product's history across its shops is readable by its owner already.
- **The view and the index:**
  - `latest_price_observations` returns each item's last check and its last priced row (`:144-171`).
  - The only index is `(shop_id, shop_item_id, observed_at desc)` (`:72-73`).

### When rows are written

- **Automatic:** the island refetches a shop whose last check is more than 15 minutes old, on the user's own navigation (`PriceComparison.tsx:94-109`; `needsRefetch`, `price-comparison.ts:104-121`).
- **On request:** the product's "Odśwież ceny" refetches every shop. The list's refetches only items checked more than 15 minutes ago (`price-targets.ts:122-162`).
- **At a first automatic match:** the shop's price as the lookup found it (`shop-matching.ts:338-379`).
- **Never:** on a view with fresh prices, on "Dodaj", or on a refused or failed answer.
- **Density:** inferred from the code, not measured in production, which this research didn't read.

### The 30-day low per shop

| Shop        | Field                                                 | Present                                                                                | Stored as          |
| ----------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------ |
| Rossmann    | `lastLowestPrice` (number only)                       | only while the item is reduced; every recorded search has as many as it has `oldPrice` | `lowest_price_30d` |
| Natura      | `lowest_price`                                        | on all 12 recorded hits, a reduction or not                                            | same               |
| Hebe        | `price_omnibus_amount`                                | on all 16 recorded hits of items sold online                                           | same               |
| Super-Pharm | `default_historical_min_price_formated` (Polish text) | on 16 of 47 lookup hits; `false` on the rest                                           | same               |

- **Every adapter** rounds the low and drops it unless it is above 0 and at most 99999.99 (`shops/shop-offer.ts:11-37`).
- **The same item over time** (recordings):
  - Natura NV89063: 22,99 with a low of 23,99 (2026-09-17); 16,99 with a low of 17,99 while reduced (2026-09-28); 22,99 with a low of 16,99 after the reduction (2026-10-06).
  - Hebe 218807: a sale of 10,89 with a low of 10,99 (2026-09-17); 15,99 and no sale, with a low of 10,89 (2026-10-02).
  - This fits "the low before a reduction while it runs, and a rolling minimum, the reduction included, afterwards". The research note calls Natura's meaning unconfirmed (`polish-drugstore-price-apis.md:250`).

### The design's judgement

- **The stickers** (`handoff/README.md:107-112`) reuse today's sticker build, placement and stamp animation:
  - "Dobra / cena!", fill `#B5EDCB`;
  - "Zwykła / cena", fill `#FFFFFF`.
- **The texts** (`Drogeria Radar Redesign.dc.html:816`, `:824`):
  - good: "Poniżej najniższej ceny z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.";
  - ordinary: "Równa najniższej cenie z 30 dni wg sklepu."
  - The superseded first proposal's wording (`:744`, `:754`) isn't in scope (`README.md:7`).
- **Where the sentence goes:** below the price track's title (14 px muted), or alone in a plain card when the track has fewer than 2 values (`README.md:114`, `:120`). That is the slot `trackHint` fills today.
- **No row mark:** the list's tag keeps its three tones and no judgement (`README.md:85-92`).
- **The tokens:** `--sticker-info` and `--sticker-plain` exist (`global.css:61-62`, `:126-127`). A "good" fill would be a new token, or a reuse of `--shop-natura`'s value, checked by `scripts/check-token-contrast.mjs`'s label pairs (`:189-203`, `:252`).

### Where the judgement plugs in

- **The verdict:** `verdictOf` (`price-comparison.ts:252-282`) gives `cheapest` (the shops, price, savings and age), `only`, `unavailable`, `stale`, `unread` or `none`, and carries no low and no history. A judgement needs the cheapest shops' declared lows, which the rows already carry (`ShopOffer.lowestPrice30d`), and, for history, a summary the rows don't carry yet.
- **The island's inputs:** they come from `[id].astro:117-143` through `PriceComparisonShop.latest`. A history summary would be one more field per row or per product, from the same read.
- **The browser-safe rule:** `price-comparison.ts` is one of the three services `islandConfig` admits (`eslint.config.js:143-145`), so the judgement's rule can live there and run in the island.
- **The kitchen sink and fixtures:**
  - The product page shows the hero and the track inside "Obszar produktu" (`src/dev/product-page.astro:269-341`) and the stickers in their own section (`:650-666`).
  - No fixture has a price equal to its low, and the handoff's Isana sample isn't drawn.
  - The list's fixtures carry no low at all (`watchlist-fixtures.ts:60-70`).
- **Accessibility:** the hero has no live region, and the island announces shops' answers only (`PriceComparisonView.tsx:122-125`). The judgement, as text in the track card, would be read in place.

## Code References

- `supabase/migrations/20260928011450_price_observations.sql:33-73`, `:89-127`, `:144-171`: the table, its policies and the latest-check view
- `src/lib/services/prices.ts:39-87`, `:159-233`: what is stored and the only reads
- `src/lib/services/price-comparison.ts:9-11`, `:104-147`, `:252-282`, `:449-466`, `:571-616`: the refetch age, freshness, the verdict, a product's keys and the list's screen-reader line
- `src/components/watchlist/price-comparison-state.ts:407-480`, `:499-559`, `:646-670`: the hero, the track and its hint
- `src/components/watchlist/Sticker.tsx:3-62`, `VerdictHero.tsx:13-72`, `PriceTrack.tsx:12-136`: the stickers, the hero and the track
- `src/lib/services/shops/{rossmann,natura,hebe,super-pharm}.ts`: each shop's low (`rossmann.ts:179-187`, `natura.ts:128-136`, `hebe.ts:145-154`, `super-pharm.ts:340-391`)
- `context/archive/2026-09-30-etykiety-redesign/handoff/README.md:107-120` and `Drogeria Radar Redesign.dc.html:804-845`: the design

## Architecture Insights

- **The judgement can live with the verdict.** It is a browser-safe rule over what the island already holds, the cheapest shops' declared lows, plus one summary of the product's history.
- **The history summary belongs in SQL.** It can be computed in the read the page already makes: the lowest price over a window, how many days carried a price, and since when. That avoids a new query beside the page's five, and it fits F4's rework of the same view.
- **The design's two outcomes compare with the cheapest shop's own low.** The PRD's history judgement is across shops: "the prices previously observed for that product across shops" (`prd.md:165`).

## Historical Context (from prior changes)

- `context/archive/2026-09-30-etykiety-redesign/change.md:19`: the owner's "facts only until FR-012" (2026-09-29).
- `context/archive/2026-09-28-cheapest-shop-today/plan-brief.md:38`, `plan.md:62-66`, `:906-910`: history kept from day one for S-04, with no retention; F4 and F6 left for S-04's migration.
- `context/foundation/shape-notes.md:36-41`: the day-one behaviour is judged against the shop's 30-day low, labelled; the regular-versus-promotion comparison is not part of the rule.
- `context/archive/2026-10-02-testing-critical-browser-flows/plan.md:662`: the list's screen-reader line, recorded for S-04.

## Related Research

- `context/archive/2026-09-28-cheapest-shop-today/research.md`: the history table's design and the 30-day low's first reading.
- `docs/research/polish-drugstore-price-apis.md` §2.1-§2.5: each shop's fields.

## Open Questions

These are the owner's calls for `/10x-plan` (PRD Open Question 4, and what the design leaves open):

1. What today's cheapest price is compared with: the cheapest shop's declared low, the lowest declared low among the product's shops, or the product's own observed history.
2. How much history counts as enough before the product's own history replaces the shop's low.
3. Which threshold makes a price good, and what a price above the baseline is called.
4. What shows when there is nothing to compare with: no declared low and too little history.
