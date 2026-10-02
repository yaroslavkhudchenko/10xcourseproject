---
date: 2026-10-01T10:19:08+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 583bedb998a2a0efcd5c40a254a7bc0307f1bd8f
branch: feat/fix-matches-and-watchlist
repository: yaroslavkhudchenko/10xcourseproject
topic: "S-08 fix-matches-and-watchlist: re-pinning and resetting a shop match, removing a product without losing shared prices, suspicious-match warnings, and the carry-overs"
tags:
  [
    research,
    codebase,
    external,
    watchlist,
    watchlist-matches,
    price-observations,
    rls,
    soft-delete,
    cascade,
    natura,
    matching,
    destructive-actions,
  ]
status: complete
last_updated: 2026-10-01
last_updated_by: Claude (claude-opus-5-5)
---

# Research: what S-08 needs to know before planning

**Date**: 2026-10-01T10:19:08+02:00
**Researcher**: Claude (claude-opus-5-5), with four read-only research workers (three on the code and the archive, one on external sources) and one rolled-back SQL probe on the local database
**Git Commit**: 583bedb998a2a0efcd5c40a254a7bc0307f1bd8f (`main` after PR #16)
**Branch**: feat/fix-matches-and-watchlist
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

S-08 (`context/changes/fix-matches-and-watchlist/change.md`; roadmap `context/foundation/roadmap.md:205-219`) lets a user re-pin or remove a shop match that turned out wrong, flags suspicious matches (a size or brand mismatch, FR-007, `context/foundation/prd.md:103`), and lets a user remove a product from their watchlist without deleting shared price history (FR-005, `prd.md:97`). It also carries three items from earlier changes: "Zmień" and "Dopasuj ponownie" in Natura's card, the matched item's name in that card, and the list's filter (`?f=`) through the product page's own actions (`roadmap.md:215-218`). Before planning, what is true today about:

1. what refuses changing or resetting a stored match, in the database and in the code, and what a new lookup costs the shops;
2. what removing a product touches under a hard delete and under a soft delete: RLS, cascades, price visibility and re-adding;
3. the data a size or brand warning can use, and where warnings are shown;
4. where the product page's actions drop `?f=`, and what can carry it;
5. how the change is verified and rolled out;
6. what the PostgreSQL, PostgREST and supabase-js documentation and UX guidance say about these choices (the external research of Module 2, Lesson 4).

## Summary

- **A hard delete of the user's own watchlist row deletes no shared data in the schema as built.**
  - `price_observations` references neither a product nor a user (`20260928011450_price_observations.sql:35-36, 55-56`).
  - Deleting a `watchlist_items` row cascades to the same user's `watchlist_matches` rows of that product, through the composite key `(watchlist_item_id, user_id)` (`20260927184936_watchlist_matches.sql:47-48`). No other table references `watchlist_items` in the five migrations.
  - On the local PostgreSQL 17.6, probe P1 showed that a cascaded delete removes child rows even when the user has no DELETE grant or policy on the child table. A direct delete there was refused.
  - The "hide" wording predates S-03's schema: the S-01 table comment (`20260927145051_watchlist_items.sql:25-26`), `CLAUDE.md:18`, and the roadmap's "A wrong delete would silently erase other users' data" (`roadmap.md:214`, written 2026-09-25). Today a delete would erase only the user's own decisions for that product.
- **A soft delete can't be filtered out by the table's SELECT policy.**
  - PostgreSQL applies SELECT policies to the new row of an UPDATE whose WHERE clause reads columns. That is the "Policies Applied by Command Type" table on the CREATE POLICY page (§8.1). A PostgREST filter such as `?id=eq.<id>` is such a WHERE clause.
  - Probe P2 reproduced the resulting error: "new row violates row-level security policy".
  - The filter would therefore go into the reads: `listWatchlist` and `getWatchlistProduct` (`src/lib/services/watchlist.ts:143-173, 201-232`), and both `price_observations` policies (`20260928011450_price_observations.sql:89-127`). Left unchanged, those two policies keep a removed product's shop items readable and writable for its user.
  - Re-adding hits the unique key `(user_id, source, source_item_id)` (`20260927145051_watchlist_items.sql:22`), which `addToWatchlist` reports as already listed (`watchlist.ts:115-118`).
- **One policy predicate refuses re-pinning in the database.**
  - The update policy admits only rows with `state = 'not_found'` (`20260927184936_watchlist_matches.sql:86-89`).
  - The column grant already covers every decision column (`20260928011450_price_observations.sql:27-31`).
  - There is no delete grant or policy (`20260927184936_watchlist_matches.sql:93-94`).
  - In code, `decideMatchStep` only shows a stored matched or declined decision (`src/lib/services/match-step.ts:32-45`), and `record()` updates only `not_found` rows (`src/lib/services/matches.ts:196-213`).
- **Running today's lookup again can't re-pin an automatic match.**
  - `lookupInNatura` returns after the EAN search whenever that search has candidates (`src/lib/services/shop-matching.ts:27-36`).
  - `pickMatch` accepts the candidate when exactly one shares an EAN with an equal size (`src/lib/services/matching.ts:38-49`).
  - So, with Natura's data unchanged, a fresh lookup for an automatic match accepts the same item again (inferred from the code).
  - The S-02 caveat that S-08's re-pin is meant to fix is a Rossmann item listing another product's EAN (`context/archive/2026-09-27-shop-matching-first-two-shops/plan-brief.md:76`). In that case the EAN search succeeds, so the name search never runs.
- **Shop cost (lesson "Bound what each page view and action costs every shop"):**
  - A lookup costs 1 Natura request when the EAN search has candidates, and 2 when that search finds nothing and the name search runs (`shop-matching.ts:8-9, 25-52`).
  - Undecided candidates aren't stored, so every own-navigation render that shows them repeats the lookup (`src/pages/watchlist/[id].astro:132-140`).
  - A decision post costs no request, and a confirm stores no price (`matches.ts:155-166`). Unless the confirmed item was checked in the last 15 minutes, the island then spends 1 Natura request on the user's own navigation.
- **A size warning exists; no brand comparison does.**
  - Size is flagged for candidates (`matching.ts:21-32`, `src/lib/services/natura-view.ts:122-139`) and for a saved match (`natura-view.ts:89-91`).
  - Brand is stored on both sides:
    - Rossmann's `brand` in `watchlist_items.brand` (`src/lib/services/shops/rossmann.ts:212`);
    - the first of Natura's `brand[]` values in `watchlist_matches.brand` (`src/lib/services/shops/natura.ts:184`).
  - The inspected matching, view and lookup code never compares them (`matching.ts:26-32`, `natura-view.ts:122-131`, `shop-matching.ts:38`).
  - The recordings hold one same-product pair, "NIVEA" on both sides, so the evidence for a brand rule is thin.
- **The saved match's item is read and then dropped.**
  - `listMatches` reads its name, brand, size, image and link (`matches.ts:217-219`).
  - `matchedView` keeps none of them for a saved match (`natura-view.ts:92-93`).
  - The card shows an item only while a match isn't saved (`src/components/watchlist/natura-card.ts:88`).
- **The product page's own actions drop `?f=` at five points** (§5).
  - `listRefreshBackTo` already builds a return address that keeps `f` beside another parameter (`src/lib/services/price-refresh.ts:177-184`).
  - The roadmap places the decision posts' redirects in `src/lib/services/matches.ts` (`roadmap.md:218`). They are built in the route, `src/pages/api/watchlist/matches.ts:11-13`.
- **UI facts:**
  - The design handoff draws "Zmień" and "Dopasuj ponownie" (`context/archive/2026-09-30-etykiety-redesign/handoff/README.md:131, 133`). It draws no control for removing a product and no warning on a matched card.
  - The app has no confirm, dialog or undo pattern.
  - No view uses the `destructive` Button variant (`src/components/ui/button.tsx:37`).
  - A list row is one link (`src/components/watchlist/WatchlistRow.astro:42-44`), so a button can't sit inside it.
- **External UX guidance:**
  - NN/g: confirm only serious or irreversible actions, and offer undo wherever possible.
  - WCAG 2.2 success criterion 3.3.4 (AA): a page that deletes user-controllable data must make the deletion reversible, checked or confirmed.
  - Material: a snackbar with an action shouldn't dismiss itself.
  - The sources disagree on whether screen readers announce a notice that is present when the page loads.
- **Verification:**
  - Three groups of database assertions encode what S-08 changes:
    - `scripts/check-watchlist-db.mjs:90-94`: a user can't update or delete their entry;
    - `scripts/check-matches-db.mjs:151-172`: a match or a decline can't change;
    - `check-matches-db.mjs:229-231`: a match can't be deleted.
  - Which of them flip depends on the design. Any delete grant flips a delete assertion. A column-limited UPDATE grant leaves the entry's update assertion, an update of `name`, passing.
  - An assertion added to an existing script needs no CI change. A new script needs a step in the `smoke` job (`.github/workflows/ci.yml:49-64`).
- **Limitations:**
  - The probes ran on the local stack (PostgreSQL 17.6). The production project's PostgreSQL and PostgREST versions weren't checked.
  - The CREATE POLICY table and its footnote read the same in the PostgreSQL 13, 15, 17 and 18 docs, the versions the external worker compared.

## Detailed Findings

Migration files are named by their description below: `watchlist_items.sql` is `supabase/migrations/20260927145051_watchlist_items.sql`, `watchlist_matches.sql` is `…20260927184936_watchlist_matches.sql`, `product_url.sql` is `…20260927204417_watchlist_items_product_url.sql` and `price_observations.sql` is `…20260928011450_price_observations.sql`.

### 1. Removing a product

**What exists**

- `watchlist_items` lets a user select and insert their own rows only. It grants `select, insert` to `authenticated` (`watchlist_items.sql:28-42`), says "There is no update or delete path" (`:28`), and keeps one row per user and shop item (`:22`).
- References to a product row: `watchlist_matches` through `(watchlist_item_id, user_id)` with `on delete cascade` (`watchlist_matches.sql:47-48`). In the five migrations nothing else references `watchlist_items`.
- `price_observations` is keyed by `(shop_id, shop_item_id)`, and its `recorded_by` column holds the recording user's id with no reference (`price_observations.sql:35-39, 55-56`).
- Watching an item is the existence of a row:
  - the price policies admit a user with a `watchlist_items` row naming the shop item, or with a `matched` `watchlist_matches` row naming it (`price_observations.sql:89-127`);
  - the PRD's note of 2026-09-28: "A user reads and adds the observations of an item only while they watch it" (`prd.md:164`).
- The table has three queries in `src/`, all in `watchlist.ts`:
  - `addToWatchlist` (`:95-128`) reads back only the new row's `id`;
  - `listWatchlist` (`:143-173`) feeds the list, the list beside a product and the list's refresh targets (`src/lib/services/price-targets.ts:58-68`);
  - `getWatchlistProduct` (`:201-232`) feeds the product page, `shopItemFor` for the price route and `productTargets` for a product's refresh (`price-targets.ts:30-48, 75-85`).

**A hard delete of the user's own row**

- It needs a DELETE policy for the user's own rows and `grant delete` on `watchlist_items`; neither exists.
- The product's decisions go with it, through the cascade.
  - Probe P1 shows the cascade needs no grant or policy on `watchlist_matches` (§8.3).
- No price row is deleted. The user stops watching the product's shop items unless another of their rows names the same item.
- No read needs a change. The three queries pass through the own-rows policy, so a deleted row is gone from all of them.
- An open tab of a removed product:
  - The page answers 404 (`[id].astro:80-81`).
  - The price route answers 404 `gone` (`src/pages/api/watchlist/prices.ts:59-65`), which the island shows as a failed refetch (`src/components/watchlist/price-comparison-state.ts:672-674`).
  - A decision post gets 23503, mapped to `gone`, "Nie udało się zapisać wyboru: tego produktu nie ma na Twojej liście." (`matches.ts:94, 186-189`).
- Re-adding inserts a new row:
  - a new id, so an old link answers 404;
  - a new `created_at`, so its place on the list and its "dodano" date change (`watchlist.ts:147`);
  - no decision, so the next own navigation looks it up in Natura again, at 1 or 2 requests (`match-step.ts:41-44`);
  - its earlier prices become visible again.
- There is no undo in the database. Re-adding through the search is the only way back.
- Telling "removed" from "nothing removed": a DELETE that RLS hides matches zero rows with no error (§8.2).
  - `.select("id")` returns the removed rows, which is the pattern `record()` uses after its update (`matches.ts:196-213`). The `count: "exact"` option also works.

**A soft delete (a hidden column; the row stays)**

- It needs a column, an UPDATE grant on that column and an UPDATE policy; none exists.
  - The SELECT policy can't filter hidden rows (§8.1, probe P2).
  - A BEFORE UPDATE trigger can set the hiding time on the server. A column grant limits which columns a user names, not the values (§8.5). Probe P3 shows a trigger can set a column the user can't set directly.
- Reads that would need the filter:
  - `listWatchlist` and `getWatchlistProduct`.
  - `listMatchStates` reads all of the user's decisions without a filter (`matches.ts:300-304`). The list matches them to products by id (`src/lib/services/watchlist-rows.ts:291-303`).
  - The tests stub these exact query chains, so an added filter changes them (`watchlist.test.ts:249-256, 330-336`; `price-targets.test.ts:72-113`).
- The price policies, left unchanged, count a hidden product as watched: for its own shop item, and through its `matched` decisions for their items (`price_observations.sql:89-127`). With them, the hidden product's user can still read and add those items' prices.
  - Ending that takes a migration that replaces both policies.
  - S-04's queued follow-up redefines the price view over "their `watchlist_items` plus their `matched` `watchlist_matches`" (`context/archive/2026-09-28-cheapest-shop-today/follow-ups/review-fixes.md:5-15`), so both changes would touch the same definition of "watched".
- The product's decisions stay, so re-adding brings them back. A decision can also still be saved for a hidden product, since the foreign key still passes (`matches.ts:179-189`).
- Re-adding: the hidden row still holds the unique key, so today's insert gets 23505, and the list says "Ten produkt jest już na Twojej liście." (`watchlist.ts:115-118`; `src/pages/watchlist.astro:50`).
  - Re-adding needs a way to un-hide the row.
  - PostgREST's upsert can't target a partial unique index (§8.4).
- Undo is an UPDATE that clears the column. It works only while the SELECT policy keeps hidden rows visible (P2).

### 2. Re-pinning and resetting a decision

**What refuses it**

- **Database:**
  - The update policy `using ((select auth.uid()) = user_id and state = 'not_found')` (`watchlist_matches.sql:86-89`): an update of a matched or declined row matches zero rows with no error.
  - No delete path (`:93-94`).
  - The column grant on `state, decided_by, shop_item_id, name, brand, size_text, size_value, size_unit, eans, product_url, image_url, checked_at` (`price_observations.sql:27-31`). It covers every column a re-pin writes, and it leaves `watchlist_item_id`, `user_id` and `shop_id` unwritable (`check-matches-db.mjs:190-206`; `scripts/check-prices-db.mjs:284-300`).
  - Constraints that a reset must satisfy:
    - `decider_fits_state`: `unmatched` needs `decided_by = 'user'`, and `not_found` needs `'auto'` (`watchlist_matches.sql:53-55`);
    - `item_only_when_matched`: a row that isn't matched carries none of the item's columns (`:57-63`).
- **Code:**
  - `decideMatchStep` returns `stored` for a matched or declined decision, even with `?retry=1` (`match-step.ts:32-40`).
  - `record()` inserts first; on 23505 it updates with `.eq("state", "not_found")` and reads no rows back as `decided` (`matches.ts:173-214`).
  - `matchFormSchema` knows only `confirm` and `decline`, with `shop: z.literal("natura")` (`matches.ts:17, 24-40`).
  - `storedView` gives a matched or declined decision no link (`natura-view.ts:110-119`).
  - The decision forms render only for a choice among candidates (`[id].astro:183-187, 301`; `src/components/watchlist/NaturaSection.astro`).
  - `natura-card.ts:4-7` and `src/components/watchlist/NaturaCard.tsx:35-38` say re-pinning waits for S-08.
- **Tests and checks:**
  - `check-matches-db.mjs:151-172` and `:229-231`;
  - `src/lib/services/match-step.test.ts:32-49`;
  - `src/components/watchlist/natura-card.test.ts:117-129`;
  - `src/lib/services/matches.test.ts:233-236` (an action `"repin"` is refused) and `:368-380` (`decided`).
- **Docs:**
  - `CLAUDE.md:39`, which says the matches check proves matches "never change once matched or declined";
  - `CLAUDE.md:52`, "RLS lets only a `not_found` row change before S-08";
  - the table comments (`watchlist_matches.sql:70-75`; `price_observations.sql:24-26`). Applied migrations are frozen, so a new migration would replace these comments with `comment on`.

**What each kind of change needs** (facts, not a design)

- **A matched decision changed to another candidate:**
  - the update policy widened;
  - `record()` no longer limited to `not_found`;
  - a lookup that offers a choice instead of accepting;
  - the confirm form shown for a matched product.
- **A matched decision changed to declined:**
  - the same policy and `record()` changes;
  - a decline control on the matched card.
  - `recordDecision`'s decline branch already writes `unmatched/user` with no item (`matches.ts:161-165`), which the constraints accept.
- **A matched or declined decision reset, so the lookup runs again:**
  - either a delete, which needs a grant and a policy, or an update to `not_found/auto` with no item, which needs the widened policy;
  - after a delete, the next own navigation looks the product up (`match-step.ts:41-44`);
  - after a reset to `not_found`, only `?retry=1` does (`match-step.ts:37`).
  - Today's lookup would then accept again an automatic match's item, and, once S-08 lets the user decline an automatic match, the item they declined. The second case is inferred from `matching.ts:38-49` and `shop-matching.ts:27-36`.
- **Prices after a re-pin:**
  - The page reads the match's `shop_item_id`, so it shows the new item's prices (`[id].astro:153-155`, `price-targets.ts:42-47, 83-84`).
  - The old item's prices stay in the table, and the user stops watching that item unless another of their rows names it.
- **Old code meeting a new state:**
  - `listMatches` returns null for one product when any of its rows doesn't parse, such as a state the code doesn't know (`matches.test.ts:529-543`, where `"repinned"` stands for such a state).
  - The page then says the decision couldn't be read and looks nothing up (`match-step.ts:33-35`).
  - A migration that adds a state value can be pushed to production before the merge only while nothing writes that state.

**What each path costs Natura** (one reservation through the gate per request; a refused reservation sends nothing, `src/lib/services/shop-gate.ts:99-116`)

| Path                                                 | During the render                                                     | Afterwards                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Stored match                                         | 0                                                                     | 1 from the island, on own navigation only, when the item was last checked over 15 minutes ago or never     |
| Stored decline, stored "not found"                   | 0                                                                     | 0                                                                                                          |
| Undecided product, request that isn't own navigation | 0 (only the "Dopasuj w Naturze" button)                               | 0                                                                                                          |
| Lookup, EAN search has candidates                    | 1                                                                     | 0 when an accepted item's offer was stored with it (`[id].astro:111-116`), otherwise as for a stored match |
| Lookup, EAN search empty                             | 2                                                                     | as above                                                                                                   |
| Lookup without a usable EAN                          | 1 (the name search), or 0 when the query comes out empty              | as above                                                                                                   |
| Undecided candidates or Natura unavailable           | 1–2, repeated on every own-navigation render, since nothing is stored | 0                                                                                                          |
| Decision post                                        | 0                                                                     | as for a stored match: a confirm stores no price (`matches.ts:155-166`)                                    |

Sources: `shop-matching.ts:8-9, 25-52`; `src/lib/services/shops/natura.ts:59-91`; `[id].astro:92-141`; `src/lib/services/price-comparison.ts:9, 61-76`.

### 3. Suspicious-match signals (FR-007)

**Size**

- For candidates: `judge` and `sizesEqual` (same unit, 0.1 % tolerance, `matching.ts:21-32`). They give the badges "Ten sam EAN", "Inny rozmiar: X zamiast Y" and "Rozmiar nieznany" (`natura-view.ts:122-139`), drawn at `NaturaSection.astro:67-77`.
- For a saved match: `matchedView` compares the sizes (`natura-view.ts:89-91`), and the card draws a warning badge (`NaturaCard.tsx:141-145`).
  - A saved match with an unknown size on either side gets no warning, while a candidate gets "Rozmiar nieznany" (`natura-view.ts:89`; `src/lib/services/natura-view.test.ts:107-114`).
  - An automatic match has equal sizes by rule, so the saved warning appears only on a user-confirmed candidate of another size.
- `parseSize` returns null for multipacks such as "4x57 szt." (`src/lib/services/size.ts:18-30`).

**Brand**

- Stored values:
  - Rossmann: `cut(clean(item.brand), 120)` (`rossmann.ts:212`), passed through the "Dodaj" form and stored in `watchlist_items.brand`.
  - Natura: the first `brand[]` value, trimmed (`natura.ts:184, 361-370`). It is stored in `watchlist_matches.brand`, both for an automatic match (`matches.ts:126-138`) and for a confirmed candidate, through the form (`NaturaSection.astro:86`).
  - The adapter's `hitSchema` reads neither Natura's `manufacturer` nor its category paths (`natura.ts:35-50`).
- In the inspected services and components, the brand is used only:
  - in Natura's name query (`shop-matching.ts:38`);
  - in display (`watchlist-rows.ts:95-102`; `productFullName`, `watchlist.ts:85-87`);
  - in the thumbnail tile, the only place it is normalised: trimmed, NFC, lowercased for `pl-PL` (`src/components/watchlist/thumb-tile.ts:12-14, 21-22`).
- Evidence in the recordings (`src/lib/services/shops/fixtures/`):

| Product                     | Rossmann                                                                               | Natura                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nivea Soft 300 ml (one EAN) | `"brand": "NIVEA"` (`rossmann-search-results.json:410-418`)                            | `"brand": ["NIVEA"]` (`natura-ean-hit.json:23`). Its other fields: manufacturer "BEIERSDORF - NIVEA", series "NIVEA SOFT", category "Marki\|Nivea" |
| A Nivea Men item            | none                                                                                   | `"brand": ["NIVEA MEN"]`, category "Marki\|Nivea\|Nivea Men" (`natura-name-search.json:1328, 1702-1714`)                                           |
| A Nivea Baby item           | `"brand": "NIVEA BABY"` with another brand id (`rossmann-search-results.json:867-875`) | none                                                                                                                                               |

This is one same-product pair, and its brands are identical. Sub-brands are separate brand values, and Natura's own fields disagree on case. The "L'Oréal Paris" in `src/dev/watchlist-fixtures.ts:82` is made-up kitchen-sink data, not a recording.

**Where a flag can show**

- On the product page: the candidates' badges and the saved match's warning badge.
- On the list, the reads lack the data:
  - `listMatchStates` reads only `watchlist_item_id, shop_id, state, shop_item_id` (`matches.ts:303`);
  - `listWatchlist` reads `brand` but not `size_value` or `size_unit` (`watchlist.ts:146`).
  - "Do sprawdzenia" counts a product when Natura is undecided, not found or unreadable, or a price isn't fresh. A decline doesn't count (`watchlist-rows.ts:120-122, 140-144`).
- Rossmann: its "match" is the product the user picked, with no decision row (S-02 `plan-brief.md:28`), so FR-007's flag applies to Natura's decisions in this MVP.

### 4. The saved match's item

- `listMatches` selects the item's name, brand, size, EANs, link and image, and `toMatch` maps them (`matches.ts:217-219, 362-387`). The page passes the match to `storedView` and keeps it as `naturaItem` (`[id].astro:97-99`).
- Where the item is dropped:
  - `matchedView` returns only `{kind, note, sizeWarning}` for a saved match (`natura-view.ts:92-93`);
  - `naturaCardOf` sets `item: unsaved ? view.item : null` (`natura-card.ts:88`);
  - the island gets only the item's `shopItemId` and `productUrl` (`[id].astro:153-155, 165-168`).
- What remains visible: Natura's price card, with "Zobacz w sklepie" described by the shop's name, and the size, but only inside a size warning.
- Showing the item needs no migration: the page already reads the data.

### 5. Carrying `?f=` through the product page's actions

**Where it's dropped:**

1. The retry and prompt links: `notFoundView` builds `/watchlist/<id>?retry=1` (`natura-view.ts:105`), and `promptView` builds `/watchlist/<id>` with an optional `?retry=1` (`:165-167`).
2. "Pokaż zapisaną decyzję" links to `/watchlist/${itemId}` (`NaturaCard.tsx:106`).
3. The decision forms carry no `f` field, and the route's `backTo` builds `/watchlist/<id>?<outcome>` (`src/pages/api/watchlist/matches.ts:11-13`).
4. A retry that stored its outcome redirects to `/watchlist/${product.id}` (`[id].astro:118-121`).
5. The product's refresh form posts only `itemId` (`src/components/watchlist/RefreshForm.tsx:61`), and the route goes back to `/watchlist/<id>?prices=<code>` (`src/pages/api/watchlist/refresh.ts:44`).

**What carries it today:**

- `parseListFilter` accepts only the values in `LIST_FILTERS` and turns anything else into "all" (`watchlist-rows.ts:24, 30-32`).
- `filterHref` gives a path with only `f` and can't carry a second parameter (`watchlist-rows.ts:262-265`). It serves the chips, the rows and the phone's back link (`[id].astro:196`).
- The list's refresh posts hidden `f` and `back` fields:
  - `listRefreshBackOf` validates them (`price-refresh.ts:162-171`);
  - `listRefreshBackTo` joins `f`, unless it is "all", with the notice parameter through `URLSearchParams` (`price-refresh.ts:177-184`).
- The page's address-bar script removes only `NOTICE_PARAMS`, so `f` stays (`[id].astro:305-320`; `src/lib/notices.ts:37`).
- Two readings of the filter exist on the product page:
  - the back link reads `parseListFilter(params.get("f"))` directly (`[id].astro:196`);
  - the chips and rows use `listChipsOf`, which falls back to "all" whenever the chips aren't shown (`watchlist-rows.ts:249-256`).

### 6. UI facts for the new controls

- **The handoff:**
  - "Zmień" sits in a matched card's footer as an outline button that "re-pins" (`handoff/README.md:131`). It is 34 px high on desktop and 36 px on a phone (`Drogeria Radar Redesign.dc.html:187-192, 351-356`).
  - A declined card is "dashed ghost card 'Brak w Naturze — Twój wybór.' with the outline button 'Dopasuj ponownie'" (`README.md:133`).
  - Its spec doesn't say what a re-pin shows. It draws no control for removing a product and no warning on a matched card.
  - Its README says "No new server state." (`README.md:150`).
- **What the app has:**
  - No `<dialog>`, `confirm(` or undo in `src/`.
  - The only `<details>` is the account menu (`src/components/shell/AccountMenu.astro:22-43`).
  - `SubmitOnce` disables a form's buttons, or a `data-submit-once` group's, after a submit (`src/components/SubmitOnce.astro`).
- **Notices:**
  - A form route redirects with a code that the page maps to its own text. The decision codes and texts are in `notices.ts:8-19`, and the error texts beside their services (`MATCH_ERRORS`, `matches.ts:90-95`; `WATCHLIST_ERRORS`, `watchlist.ts:62-79`).
  - The list's "exists" text is inline (`watchlist.astro:50`), shown as a success Alert with `role="status"` (`watchlist.astro:66-70`).
- **Buttons:**
  - The variants are default, destructive, outline, secondary, ghost, link and underlined; the sizes are default, sm, lg, icon, compact, touch and inline (`button.tsx:29-66`).
  - No view uses `destructive`.
  - A control drawn under 44 px gets `hit-area` (`src/styles/global.css:354-375`), as the handoff's "Zmień" would.
- **Placement constraints:**
  - A list row is one `<a>` (`WatchlistRow.astro:42-44`).
  - The product's title row is inside the island and has an action column only from lg (`src/components/watchlist/ProductTitle.tsx:28-53`).
  - The phone's back row is server-rendered (`[id].astro:253-264`).
  - Natura's card actions are links. The decision forms are server-rendered below the island (`[id].astro:300-301`).
- **Two side findings:**
  - The "Dodaj" form has no `data-submit-once` (`src/components/watchlist/SearchResults.astro:70-85`), so a double tap sends a second insert, which gets "exists".
  - The header comments of `button.tsx:5`, `alert.tsx:3` and `badge.tsx:4` still cite `context/changes/etykiety-redesign/handoff/`, which is now under `context/archive/2026-09-30-etykiety-redesign/`.

### 7. Verification and rollout

- **Database checks:**
  - Each script signs up throwaway users and calls PostgREST through supabase-js with the anon key. It refuses any host but localhost.
  - Results are asserted as error codes or as empty results: 42501, 23505, 23503 and 23514, plus an empty result for an update or read that RLS filters out (`check-watchlist-db.mjs:12-46`; `check-matches-db.mjs:150-172`).
  - Helpers are copied into each script rather than shared.
  - An assertion added to an existing script needs no CI change. A new script needs a step in the `smoke` job (`ci.yml:49-64`), and `supabase start` applies every migration before the checks run.
  - No assertion covers a cascade, or a user who stops watching an item.
- **Unit tests:**
  - Each file stubs the Supabase client by call order (`matches.test.ts:107-158`; `src/lib/services/prices.test.ts:59-112`). No stub implements `delete`.
  - Shop lookups replay recorded answers through `createReplayFetch` and assert the URLs served (`src/lib/services/testing/replay-fetch.ts`; `src/lib/services/shop-matching.test.ts:10-53`).
- **Rollout:**
  - A migration reaches production only by the owner's `npx supabase db push`, and `npx supabase migration list --linked` must show it before the PR that needs it merges (`CLAUDE.md:52`). This rule came from S-01's incident, PGRST205.
  - The docs that would change: `CLAUDE.md:18` (removal "hides" an entry), `:39` (the matches check), `:52` (only `not_found` changes before S-08), FR-005's note in the PRD (`prd.md:97-99`), the roadmap's S-08 risk line (`roadmap.md:214`) and the table comments.

### 8. External evidence

All quotes come from the external worker's reads of primary sources, at PostgreSQL 17, PostgREST v13/v14 and supabase-js v2.117.2. The project has supabase-js 2.116.0. Probes P1–P3 are this research's own, run on the local stack as `postgres` with `set local role authenticated`, in one transaction that was rolled back (scratchpad `s08-rls-probe.sql`).

**8.1 UPDATE and SELECT policies (soft delete)**

- The PostgreSQL docs table for UPDATE ([CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html), "Policies Applied by Command Type"):
  - SELECT/ALL USING: "Filter existing row [a] & check new row [a]";
  - footnote [a]: "If read access is required to either the existing or new row (for example, a `WHERE` or `RETURNING` clause that refers to columns from the relation)."
  - The same page: "If a newly inserted or updated row does not satisfy the relation's `SELECT` policies, an error will be thrown".
- Supabase's RLS guide: "To perform an `UPDATE` operation, a corresponding `SELECT` policy is required." ([row-level-security](https://supabase.com/docs/guides/database/postgres/row-level-security))
  - Supabase discussions name the soft-delete failure and three workarounds: a filter in queries or a view, a time window in the policy, or a `security definer` function ([#32985](https://github.com/orgs/supabase/discussions/32985), [#35811](https://github.com/orgs/supabase/discussions/35811), [#28774](https://github.com/orgs/supabase/discussions/28774)).
  - A restrictive SELECT policy fails the same way (a [report on the PostgreSQL mailing lists](https://www.postgresql.org/message-id/CAHBb8c5OHwnuJ_dhRi_qVuG-0cWd8Z_Rb4fmnGwAD3hrfQsZZw%40mail.gmail.com), 2022).
  - A view needs `security_invoker = true` to apply the table's RLS. This project's price view already has it (`price_observations.sql:144-145`).
- **Probe P2:**
  - With a SELECT policy `using (hidden_at is null)`, `update … set hidden_at = now() where id = 1` failed with "new row violates row-level security policy for table "items"".
  - With `using (true)`, the same update succeeded.

**8.2 Zero affected rows under RLS**

- PostgreSQL: rows a policy's USING hides "will not be available for modification … Typically, such rows are silently suppressed; no error is reported" ([CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html)). A count of 0 "is not considered an error" ([UPDATE](https://www.postgresql.org/docs/17/sql-update.html)).
- PostgREST maintainers: "This is just how RLS works. There is no error" ([discussion #1844](https://github.com/PostgREST/postgrest/discussions/1844)). Supabase's RLS guide says the same: a `using` clause filtering the row out "raises nothing, matches zero rows".
- supabase-js `update()` and `delete()` send no `Prefer: return` header, and PostgREST's default for writes is `return=minimal` ([preferences](https://docs.postgrest.org/en/v13/references/api/preferences.html)). `.select()` adds `return=representation`, and `{ count: "exact" }` adds `count=exact`; both are from the supabase-js source at v2.117.2.
- RETURNING needs SELECT privilege on the returned columns ([INSERT](https://www.postgresql.org/docs/17/sql-insert.html)). For a DELETE with RETURNING, the SELECT policy filters the existing row silently.

**8.3 Cascades and RLS**

- PostgreSQL: "Referential integrity checks, such as unique or primary key constraints and foreign key references, always bypass row security" ([Row Security Policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)). The page doesn't mention cascades.
- `ri_triggers.c` (REL_17_STABLE) runs the cascade's `DELETE FROM <fktable> …` "as that table's owner", with `SECURITY_NOFORCE_RLS`.
- The 9.5 design notes call this out: "a user can delete from a parent table and affect rows in a child table they don't have the rights to see or update directly" ([pgsql-hackers, 2013](https://postgresql.org/message-id/5268A3B1.4030101%402ndquadrant.com); [RLS wiki](https://wiki.postgresql.org/wiki/RLS)).
- **Probe P1:**
  - The user had `select, delete` on the parent and only `select` on the child, with no delete policy there.
  - Deleting a parent left 0 of its 2 children, and the other parent's child stayed.
  - A direct delete on the child failed with "permission denied for table child".

**8.4 Upsert and a partial unique index**

- PostgREST's `on_conflict` takes column names, and its query builder emits `ON CONFLICT(cols)` with no index predicate (source at v14.5).
- PostgreSQL infers a partial unique index only when the statement repeats a predicate that implies the index's ([INSERT](https://www.postgresql.org/docs/17/sql-insert.html), `index_predicate`). Without it, PostgreSQL raises "there is no unique or exclusion constraint matching the ON CONFLICT specification" (42P10).
- The open issue: [supabase/postgrest-js#403](https://github.com/supabase/postgrest-js/issues/403).

**8.5 Values a user can't forge**

- A column grant limits the columns an UPDATE may name ([UPDATE](https://www.postgresql.org/docs/17/sql-update.html); [GRANT](https://www.postgresql.org/docs/17/sql-grant.html)), not their values.
- A column DEFAULT applies only to inserts ([CREATE TABLE](https://www.postgresql.org/docs/17/sql-createtable.html)).
- A BEFORE ROW UPDATE trigger's returned row "becomes the row that will … replace the row being updated" ([trigger behaviour](https://www.postgresql.org/docs/17/trigger-definition.html)). The executor runs BEFORE ROW triggers before the RLS WITH CHECK (`nodeModifyTable.c`).
- **Probe P3:**
  - The user held `update (state)` only.
  - Their update of `state` succeeded, and a BEFORE UPDATE trigger set `changed_at`.
  - Their direct `set changed_at = now()` failed with "permission denied for table decisions".

**8.6 Confirming or undoing a destructive action**

- **When to confirm or undo:**
  - NN/g: "Use a confirmation dialog before committing to actions with serious consequences … Do not use confirmation dialogs for routine actions." Also: "do go to great lengths to provide undo" ([confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/)). For repetitive actions, "support easy undo" ([contextual swipe](https://www.nngroup.com/articles/contextual-swipe/)).
  - WCAG 2.2 SC 3.3.4 (AA), Error Prevention (Legal, Financial, Data), covers pages that delete "user-controllable data": the deletion must be reversible, checked or confirmed ([Understanding 3.3.4](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html)).
  - GOV.UK reserves the warning button for "actions with serious destructive consequences that cannot be easily undone" ([button](https://design-system.service.gov.uk/components/button/)). The Ministry of Justice's confirm pattern applies when "the action cannot be undone (or not undone easily)" ([confirm an action](https://design-patterns.service.justice.gov.uk/patterns/confirm-an-action/)).
  - Material: "To allow users to amend choices, display an 'Undo' action", and "Snackbars with actions shouldn't auto-dismiss" ([snackbar guidelines](https://m3.material.io/components/snackbar/guidelines)).
- No primary source describes an undo after a redirect without JavaScript. The pieces the sources give:
  - a notice that stays until the user moves on (Material);
  - GOV.UK's success banner, placed before the page's `h1` and removed on the next page ([notification banner](https://design-system.service.gov.uk/components/notification-banner/)).
- **Announcing a notice:**
  - WCAG 4.1.3 gives success messages `role="status"` and errors `role="alert"` ([status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)).
  - For content already present when the page loads, the sources disagree:
    - the ARIA Authoring Practices say screen readers "do not inform users of alerts that are present on the page before page load completes" ([alert pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/));
    - MDN says `role="alert"` content "is announced, even when the region … is present in the initial markup" ([live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)).
  - GOV.UK's banner moves focus to itself with JavaScript on load.

## Code References

- `supabase/migrations/20260927145051_watchlist_items.sql:22, 25-42` - the unique key, the "hides" comment, select and insert only
- `supabase/migrations/20260927184936_watchlist_matches.sql:47-63, 86-94` - the composite cascade key, the state constraints, the `not_found`-only update policy, no delete
- `supabase/migrations/20260928011450_price_observations.sql:27-31, 35-39, 55-56, 89-127, 144-178` - the decision column grant, keys without references, the watcher policies, the `security_invoker` view
- `src/lib/services/watchlist.ts:95-128, 143-173, 201-232` - add (23505 → "exists"), list and product reads
- `src/lib/services/matches.ts:17-84, 126-214, 250-264, 300-328` - the decision form, `recordLookup`, `recordDecision` and `record()`, `listMatches`, `listMatchStates`
- `src/lib/services/match-step.ts:32-45` - stored decisions are shown; only `not_found` is retried
- `src/lib/services/shop-matching.ts:25-52` - EAN search first, name search only when the EAN search finds nothing
- `src/lib/services/matching.ts:21-49` - `judge`, `pickMatch`, the auto-accept rule
- `src/lib/services/natura-view.ts:83-119, 122-139, 165-167` - `matchedView`, `storedView`, candidates' flags, the prompt and retry links
- `src/components/watchlist/natura-card.ts:4-7, 88` and `NaturaCard.tsx:35-38, 106, 127-149` - the card's model, the dropped item, the match footer
- `src/pages/watchlist/[id].astro:56-142, 183-187, 196, 300-320` - the Natura step, the choice, the back link, the forms, the address-bar script
- `src/pages/api/watchlist/matches.ts:5-46` and `src/pages/api/watchlist/refresh.ts:18-58` - the decision route's and the refresh route's redirects
- `src/lib/services/price-refresh.ts:162-184` and `src/lib/services/watchlist-rows.ts:24-32, 120-146, 249-265, 291-303` - the filter helpers, the "Do sprawdzenia" rule, the list's Natura state
- `scripts/check-watchlist-db.mjs:90-94`, `scripts/check-matches-db.mjs:151-172, 190-206, 229-231` - the assertions S-08 changes
- `context/archive/2026-09-30-etykiety-redesign/handoff/README.md:131, 133, 150` - "Zmień", "Dopasuj ponownie", no new server state

## Architecture Insights

- **RLS and column grants are the only enforcement.** There is no server-only key (`context/deployment/deploy-plan.md:128`), so every write runs with the user's own token, and a user can make any write the grants allow directly through PostgREST. That is lesson "Check what a direct database call allows, not only the UI" (`context/foundation/lessons.md:33-38`). Each new grant or policy needs its refusal proven in a check script.
- **Decisions are written insert-first.** A conflict falls back to an update that is narrowed by the policy and asks for its rows back, so zero rows means a decision was already made (`matches.ts:168-214`). A re-pin changes what that narrowing allows.
- **Only the user's own navigation or an explicit action reaches a shop.** `isOwnNavigation` gates the lookup and the island's refetch (`src/lib/services/search-query.ts:19-26`; `[id].astro:58-60`). A flow that shows candidates repeats its requests on every render, because candidates aren't stored.
- **Forms post and redirect with a code** that the page maps to its own text. Routes validate with zod, and a crafted post goes back with no code (`src/pages/api/watchlist/matches.ts:5-46`; `CLAUDE.md:48`).
- **Decision logic lives in tested services** (lesson, `lessons.md:26-31`), and the island imports only browser-safe modules (`islandConfig`, `eslint.config.js:90-153`). The re-pin and removal rules belong in `src/lib/services/`.
- **Odd rows don't empty a read.** `listMatches` returns null for the one product, and the list counts unattributed rows (lesson "Never read an unreadable answer as missing", `lessons.md:19-24`). A new state or column meets this logic first.

## Historical Context (from prior changes)

- `context/foundation/prd.md:97-99` - FR-005: "remove it from that list; shared price observations are never deleted by a removal". Its Socrates note: "removing should hide, not delete, because price observations are shared" (decision). The resolution: "removal affects only the user's own list".
- `context/foundation/prd.md:103-105` - FR-007: "re-pin or remove a shop match that turned out wrong, and the system flags a suspicious match (size or brand mismatch)" (decision).
- `context/foundation/prd.md:70, 76` - US-02: the choice "is never asked again unless the user re-pins". A refresh that returns nothing "never un-pins the match" (decision).
- `context/archive/2026-09-27-watchlist-add-by-search/plan.md:67, 118` - no removing or hiding in S-01. The table comment: "in S-08, removal hides an entry and never deletes shared data" (decision, written before S-03's schema).
- `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:48, 69, 72` - re-pinning is S-08. Before it, only `not_found` changes. "No brand-mismatch warning. Suspicious-match warnings beyond the size flag belong to S-08 (FR-007)." (decisions)
- `context/archive/2026-09-27-shop-matching-first-two-shops/plan-brief.md:28, 76` - Rossmann's match is the picked item, with no row (decision). "Rossmann may list another product's EAN on an item … S-08's re-pin would be the fix" (accepted risk).
- `context/archive/2026-09-27-shop-matching-first-two-shops/reviews/impl-review.md:50-62` - F1: one odd row makes one product's `listMatches` null, "a state a later migration adds before the code knows it (S-08)" (decision).
- `context/archive/2026-09-28-cheapest-shop-today/plan.md:94-99` - accepted risks, to revisit before inviting more people: a watcher can add a plausible fake price for any item they watch, and co-watchers see each other's check times.
- `context/archive/2026-09-28-cheapest-shop-today/follow-ups/review-fixes.md:5-20` - queued for S-04: drive the price view from the caller's watched items, and bound `regular_price` and `lowest_price_30d` (suggestion).
- `context/archive/2026-09-29-product-page-ui/plan.md:654` - the owner's call: a match's size warning is a warning Badge, "so a suspicious match stands out" (decision).
- `context/archive/2026-09-29-product-page-ui/follow-ups/review-fixes.md:32-34` - re-pinning "will likely need the item's name back beside the decision" (suggestion).
- `context/archive/2026-09-30-etykiety-redesign/change.md:17` - "Zmień" and "Dopasuj ponownie" stay out until S-08 (owner's decision, 2026-09-29).
- `context/archive/2026-09-30-etykiety-redesign/reviews/impl-review.md:180-191` and `follow-ups/review-fixes.md:5-10` - F8: the product page's actions drop `?f=`, accepted for S-08 (decision).

## Related Research

- `context/archive/2026-09-28-cheapest-shop-today/research.md` - shared price storage, watchers, the cap and the shops' price fields (S-03).
- `context/archive/2026-09-29-product-page-ui/research.md` - the product page's components and tokens before the redesign.
- `docs/research/polish-drugstore-price-apis.md` §2.5 and §6 - Natura's Luigi's Box fields, including `brand[]` and `manufacturer`, and the matching steps.

## Open Questions

These are the owner's choices for `/10x-plan`. The research lays out what each one touches, not which is right.

1. **How is a product removed?** A hard delete drops the product's decisions, keeps its prices and leaves no undo except re-adding. A soft delete keeps the decisions and allows an undo, but changes two reads and both price policies and needs an un-hide path for re-adding. The PRD's and `CLAUDE.md:18`'s "hides" needs the owner's reading for either design.
2. **Confirm or undo, and where?** WCAG 3.3.4 accepts reversible, checked or confirmed. The handoff draws no remove control, a list row can't hold a button, and the product's title row has an action column only from lg.
3. **What do "Zmień" and "Dopasuj ponownie" show?** A choice among the lookup's candidates that never accepts on its own and marks the current item? Should it also run the name search, which costs a second Natura request and is the only way to find another item when the EAN search succeeds? And can the user search Natura with their own words?
4. **Is "remove a shop match" (FR-007) its own control,** a decline from the matched card, or only "Zmień" followed by "Żaden z nich"?
5. **What is the brand rule?**
   - How are brands normalised (case, diacritics, punctuation)? Is a sub-brand, such as "NIVEA" against "NIVEA MEN", a mismatch?
   - Does a brand mismatch stop an automatic match?
   - Does a suspicious match count toward "Do sprawdzenia" on the list, which needs more columns in the list's reads?
   - More recorded brand pairs would need the owner's OK for live requests (`CLAUDE.md:36`).
6. **Which of the saved item's fields does Natura's card show?** Its name, size, brand or image?
7. **Before the migration ships,** confirm the production project's PostgreSQL version. The probes ran on the local 17.6, and the CREATE POLICY table reads the same in the 13, 15, 17 and 18 docs (§8.1).
