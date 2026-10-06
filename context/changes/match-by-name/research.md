---
date: 2026-10-06T13:56:04+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 2e60a09ec79ffe9794093460bd063ccfc19cfc51
branch: feat/match-by-name
repository: yaroslavkhudchenko/10xcourseproject
topic: "match-by-name: accepting a shop's item automatically by size, brand and a name check where EANs can't decide, starting with Super-Pharm looked up when the product opens. What decides a match today, what the tap-only Super-Pharm lookup touches, what recorded answers say about a name check, and how a match accepted by name can be recorded"
tags: [research, codebase, matching, super-pharm, match-modes, watchlist-matches, names, shop-recordings]
status: complete
last_updated: 2026-10-06
last_updated_by: Claude (claude-opus-5-5)
---

# Research: automatic matches by name, Super-Pharm first (match-by-name)

**Date**: 2026-10-06T13:56:04+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 2e60a09ec79ffe9794093460bd063ccfc19cfc51 (`main` at PR #31's merge; this change's folder isn't committed yet)
**Branch**: feat/match-by-name
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

From `change.md`: the owner wants Super-Pharm matched with no tap. When the product first opens, Super-Pharm is looked up by name and its best fit is accepted automatically. The card shows „Dopasowano automatycznie po nazwie” with „Zmień”. The owner's calls (2026-10-06) set the rule: among candidates of the product's size whose brand doesn't differ, the one whose name shares the most words with the product's is accepted when it's clearly ahead of the next. The same rule applies wherever EANs can't decide, and this change ships before add-from-other-shops.

`change.md` leaves four questions for research:

1. What "EANs can't decide" covers.
2. How names are compared and what "clearly ahead" means, with a wrong scent or shade of the same size and brand as the case to beat.
3. How a stored match records that it was accepted by name.
4. What the Super-Pharm button, the `on-request` mode and their tests become.

**Method.**

- Three read-only investigations ran in parallel:
  - where the tap-only Super-Pharm lookup reaches into code, tests and documents;
  - how an automatic match is stored, read, shown and counted;
  - what name text each side carries, the text helpers, and earlier decisions about comparing names.
- Their decisive anchors were then read directly.
- The owner approved 10 live requests, recorded at 11:48:17–11:49:43 UTC:
  - 3 Rossmann searches, for products sold in several scents or shades;
  - 7 Super-Pharm lookups, each the app's own request.
- The app's adapters and `judge` read the recordings, and four prototype rules were scored on them, in temporary tests deleted after each run. No build ran, and no test of the project's suite was changed.

## Summary

1. **One function decides every automatic match.**
   - **The rule.** `pickMatch` accepts a candidate only when it's the one candidate that shares an EAN with the product, has an equal size and has a brand that doesn't differ (`src/lib/services/matching.ts:80-98`, `qualifies` at :96-98).
   - **No guard keyed on the shop.** Super-Pharm's candidates fail the rule solely because they carry `eans: []` (`src/lib/services/shops/super-pharm.ts:319-321`).
   - **So no shop branch is needed.** A name rule added in `matching.ts` reaches Super-Pharm without one, and `matching.ts` may run in the browser (`eslint.config.js:92`, :139-141).
   - **Storage already allows it.** Neither the database nor RLS refuses an automatic Super-Pharm match: `decided_by` is `'auto'` or `'user'` for any shop (`supabase/migrations/20260927184936_watchlist_matches.sql:30,53-55`).

2. **"On request" is read in exactly four places, each as `=== "on-request"`** (a search of `src/` outside tests):
   - `shop-matching.ts:153` skips the EAN search, which stays true for Super-Pharm;
   - `match-step.ts:77` lets only the button's `?retry=` page look it up;
   - `match-view.ts:375` puts the shop in the button's link;
   - `match-card.ts:108` makes an unsaved decision's text point at the button.

   Looking Super-Pharm up on view drops the last three for it and keeps the first. One value carries both facts today. A third value would be read as "on view" by the last three with no edit, but the first would then quietly run an EAN search. No exhaustive switch or test would flag it. add-from-other-shops needs the same split for Rossmann, which also can't search by EAN.

3. **What a view costs.**
   - **The added request.** With no stored Super-Pharm decision and the user's own navigation, the page's step becomes a lookup: 1 Super-Pharm request for 10 hits (`shop-matching.ts:46`, :63-91).
   - **A first view's total.** It can then spend up to 5 shop requests, at most 2 each at Natura and Hebe and 1 at Super-Pharm, with the shops asked at once (`runMatchSteps`, `shop-matching.ts:272-290`).
   - **After „Dodaj”.** „Dodaj” redirects to the product page (`src/pages/api/watchlist.ts:40`), so a product's first view after it spends the Super-Pharm request.
   - **A stored „nie znaleziono”** is looked up again only on `?retry=` (`match-step.ts:69-72`). So "matched on the next view" holds for products with no stored Super-Pharm decision, not for ones whose earlier tap found nothing.

4. **The recorded answers, all 15 cases, from 7 Super-Pharm lookups and one existing fixture.** The table is in §5.
   - **Super-Pharm's first fit is wrong in 8 of 15 cases.** That's the first candidate of the product's size and brand, the one the choice lists first today, and it's 9 with sizes read from names.
   - **None of the three name-based prototypes accepted a wrong item.** The strictest accepts a candidate only when every word of its name is the product's. It got 9 of the 13 right items, or 10 with sizes read from names. In every other case it accepts nothing and the user picks, as today.
   - **The shade or scent is in Rossmann's caption.** The lookup's type, query and rule don't read the caption today (`shop-matching.ts:53-56`, :160-162).
   - **Plain word overlap picks another shade.** Counted over all words, overlap ranks another shade first for 4 of the 9 mascaras, because „tusz do rzęs” versus „Mascara” outweighs the shade's name. So brand and product-type words must be set aside.
   - **27 of the 47 Super-Pharm candidates have no `capacity`.** The size often ends the name, as with the Head & Shoulders shampoo, which a size read from the name recovers.
   - **Limits of the sample:** 3 product lines, 5 judgements made on naming alone, and a list of product-type words fitted on these same answers.

5. **How a match accepted by name can be recorded.** `watchlist_matches` stores `decided_by` and no reason (migration :30). Every automatic match the app's lookups have written shares an EAN between the product's stored EANs and the match's, since the rule has required a shared EAN since FR-006 (`prd.md:103`; `matching.ts:65,96-98`; `matches.ts:254-266`).
   - **(B) Derive it at read time.** No EAN in common means "by name". No migration is needed, and it's right for every automatic row the app's lookups have written. It's wrong only when the name step chooses among candidates that share an EAN, for rows the rule didn't write (direct calls, e2e seeds without EANs), or if stored EAN lists ever change.
   - **(A1) Store it as a new `decided_by` value.** That needs a migration and a parser change. Code that doesn't know the value reads the row as unreadable (`matches.ts:366`, pinned at `matches.test.ts:1103-1104`), which a Worker rollback would expose.
   - **(A2) Store it in a new column.** That needs an explicit update grant and a rebuilt check constraint.

6. **"EANs can't decide" has three readings:**
   - (a) the candidate has no EAN: every Super-Pharm candidate;
   - (b) the product has none;
   - (c) both have EANs that don't overlap.

   (c) is a live path today. Natura's and Hebe's name search runs when the EAN search finds nothing, to find items listed "under another barcode" (`context/archive/2026-09-27-shop-matching-first-two-shops/plan-brief.md:32`), and tests pin its outcome as the user's choice (`src/lib/services/shop-matching.test.ts:158-174`, :176-186). The owner's call names (b) explicitly: "a product without an EAN". (c) is not decided.

7. **What changes and what doesn't.**
   - **Changes:** `matching.ts`; the mode's three "on request" readers; the card's automatic-match note (`match-view.ts:212`) and an unsaved decision's text (`match-card.ts:101-111`); `LookupProduct`, to carry the caption; and the Super-Pharm adapter, if sizes are read from names.
   - **Tests and documents that pin today's behaviour (§8):**
     - the unit-test cases listed in §8, in 5 test files, and 2 more files whose cases depend on the rule's design;
     - one e2e spec's steps 3-4;
     - the kitchen sink's guard at `src/dev/fixtures.ts:1060`, which throws if the rule accepts the 300 ml candidate;
     - CLAUDE.md, PRD FR-006 and FR-007, test-plan risk #6, the research note's §6, the roadmap and the deploy plan.
   - **Unchanged:** grants, RLS and the list's „Do sprawdzenia” logic, which has no mode branch (`watchlist-rows.ts:196-207`).

8. **Earlier decisions this reverses:**
   - S-06's "no automatic Super-Pharm matches" and "no lookup on a plain view" (`context/changes/super-pharm-in-comparison/plan.md:94-95`, :129);
   - FR-006's 2026-10-05 update (`context/foundation/prd.md:108`);
   - test-plan risk #6, "a shop without EANs can't auto-accept" (`context/foundation/test-plan.md:48`).

   S-05's "no name comparison" for Hebe (`context/archive/2026-10-02-hebe-in-comparison/plan.md:84`) was about using names to guard an EAN match. It stands unless a name check is made to veto an EAN match.

## Detailed Findings

### 1. Where a match is decided today

- **The rule** (`src/lib/services/matching.ts`):
  - `judge` (:64-72) gives three signals:
    - `sharesEan`: any product EAN in the candidate's list (:65);
    - size equal, differing or unknown, equal meaning the same unit within 0.1 % (`sizesEqual`, :25-27);
    - brand agrees, differs or unknown (`brandsAgree`, :51-58: both normalised by `brandKey`, :34-44, then one starts with the other).
  - `pickMatch` (:80-93) accepts when exactly one candidate `qualifies` (:96-98). Otherwise it offers up to 3: those that qualify, then look-alikes (equal size, brand not differing, `looksAlike` :104-106), then the rest, each group in the shop's order.
  - `MatchProduct` (:11-15) is brand, EANs and size, with no name.
- **The lookup** (`src/lib/services/shop-matching.ts`):
  - `lookupInShop` (:63-91) searches by the product's first EAN, then, if that finds nothing, by name (`nameQuery`, :160-162: brand, name and size text through `toShopQuery`, `search-query.ts:39-45`, cut to 80 characters at a word). Each search's candidates go through `pickMatch`.
  - For an `on-request` shop, `lookupEan` returns null (:152-157), so Super-Pharm gets one name search for 10 hits (`NAME_HITS`, :46).
  - `lookupChoicesInShop` (:103-145), the re-pin's choice, never accepts: it offers each candidate once, the EAN search's first, at most 6, each with `judge`'s verdict, and doesn't call `pickMatch`.
- **After an accepted lookup** (`lookupOutcome`, :338-380):
  - `recordLookup` stores `decided_by: 'auto'` with a copy of the item, its EANs included (`src/lib/services/matches.ts:254-283`);
  - the candidate's offer becomes the first price observation (:350-357). Super-Pharm candidates carry an offer, so an automatic Super-Pharm match is priced at once.
- **No overwrite of a match or a decline.** `record` narrows an automatic lookup's update to a `not_found` row, since it replaces nothing (`matches.ts:334-345`). So a lookup can replace a stored „nie znaleziono” on a retry, never a match or the user's decline.

### 2. The `on-request` mode, and Super-Pharm looked up on view

- **The mode.** `MatchMode` is `"on-view" | "on-request"`, with Super-Pharm `on-request` (`src/lib/services/price-comparison.ts:95-105`).
- **The four readers, all outside tests:**

| Reader                                 | What it does for an `on-request` shop                                                          | Super-Pharm on view, by name only                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `shop-matching.ts:153` (`lookupEan`)   | No EAN search                                                                                  | Unchanged: its index has no EAN                                                    |
| `match-step.ts:77` (`decideMatchStep`) | `notAsked`: with no decision, only a page its button opened (`?retry=super-pharm`) looks it up | Removed for it: a plain view on own navigation gets `lookup {retry: false}`        |
| `match-view.ts:375` (`promptView`)     | The button's link always names the shop                                                        | The prompt shows only on another site's link or another shop's page, as for Natura |
| `match-card.ts:108` (`unsavedText`)    | An unsaved decision says to use the button above („gdy użyjesz przycisku powyżej”)             | Wrong without a button; an unsaved automatic match can now exist too               |

- **What stays.** `decideMatchStep` (`match-step.ts:62-82`) still gives the prompt to a request that isn't the user's own navigation, and to a page opened to re-pin or retry another shop (:75). `?retry=super-pharm` stays valid for a stored `not_found` and for old links (`retryShopOf`, :31-33).
- **No mode branch.** `PriceComparison.tsx`, `PriceComparisonView.tsx`, `MatchCard.tsx`, `MatchChoice.astro`, `price-comparison-state.ts` and `[id].astro` have none, and `MatchChoice.astro:114-115` already lets the user confirm an automatic match ("To ten produkt").
- **A third mode value, such as "on view, by name only":**
  - `match-step.ts:77`, `match-view.ts:375` and `match-card.ts:108` would read it as "on view" with no edit.
  - `shop-matching.ts:153` would read it as "may search by EAN", and send an EAN query that finds nothing at Super-Pharm (research note §2.3) and at Rossmann (§2.1).
  - The compiler wouldn't flag either: there's no exhaustive switch over `MatchMode`, and no test imports `MATCH_MODES` (one comment names it, `shop-matching.test.ts:485`).
  - Once Super-Pharm moves, no shop is `on-request`, and the three branches are unreached. Whether to keep them is open.

### 3. What a product view costs

- **Steps run once per shop.** `runMatchSteps` runs the shops' steps at once, each shop's searches one after the other (`shop-matching.ts:272-290`). A step looks a shop up only with no stored decision, or on `?retry=` over a stored `not_found` (`match-step.ts:62-82`).
- **A first view with no stored decisions, on own navigation, after the change:**
  - Natura: 1 or 2 requests (EAN, then a name search when the EAN search finds nothing);
  - Hebe: 1 or 2, the same way;
  - Super-Pharm: 1 (name only).

  That's 3 to 5 shop requests, each with a reservation RPC, against 2 to 4 today. Later views ask no shop for matching; the island's price refetch is unchanged (`autoRefreshOf`, :94-96).

- **„Dodaj”** redirects to `/watchlist/<id>` (`src/pages/api/watchlist.ts:40`), so the first view after it is own navigation and spends these requests.
- **Not assessed:** the Workers connection budget for three shops at once. Six connections can wait for headers at once (quoted in `context/archive/2026-09-28-cheapest-shop-today/research.md:247-252`). The plan should state the cost per view (`context/foundation/lessons.md:12-17`).

### 4. Names: what each side carries

- **Rossmann.** The product is a Rossmann `ProductCandidate`, kept in `watchlist_items` (`src/lib/services/shops/rossmann.ts:196-222`):
  - `name` is `clean(name) ?? clean(fallbackName)` and holds neither brand nor size;
  - `caption` (≤300 characters) often holds the kind and the variant: „tusz do rzęs, wydłużający, Cosmic Black”, „balsam do ust, Soft Rose”, „antyperspirant w sprayu, dla kobiet, 100h, Ultra Soft” (`recordings/rossmann-search-maybelline-lash-sensational.json`, `context/changes/add-from-other-shops/recordings/rossmann-search-nivea-soft.json`).
  - A stored caption is the one Rossmann sent when the product was added. Item 26900's caption changed between the fixture (`src/lib/services/shops/fixtures/rossmann-search-results.json:412`) and the 2026-10-06 recording.
- **Natura's `title`** puts the brand first and the size last in the recorded examples (`natura.ts:96-107`; `fixtures/natura-ean-hit.json:95`).
- **Hebe's name** is its legal name, else its title (`hebe.ts:110-123`).
- **Super-Pharm's `name`** (`super-pharm.ts:305-316`) starts with the brand's first word in all 47 recorded lookup candidates, and 14 of them end with a size: „Head & Shoulders Szampon do włosów Classic Clean, 400 ml”. The adapter takes the size from `capacity` alone (:309, :480-484).
- **What reaches the lookup:**
  - The page passes the whole `WatchlistProduct`, caption included, to `runMatchSteps` (`src/pages/watchlist/[id].astro:99-111`).
  - `LookupProduct` (`shop-matching.ts:53-56`) types brand, EANs, size, name and size text, so the caption is present at runtime but read by nothing: not by `nameQuery`, `judge` or `pickMatch`.
  - The stored match (`watchlist_matches`) keeps the item's name, brand, size and EANs, with no caption.
- **Same query for different products.** Products differing only in their caption get the same Super-Pharm query: 6 Sky High mascaras give „Maybelline New York Lash Sensational Sky High 7,2 ml” and 3 Full Fan Effect ones „…Full Fan Effect 9,5 ml” (the app's own `toShopQuery` over the Rossmann recording).
- **Helpers.**
  - Nothing in `src/` splits names into words, drops small words or scores similarity.
  - The nearest helper is `brandKey`: NFKD, marks stripped, Polish lower case, letters and digits only, so „ż” becomes „z” while „ł” stays (`matching.ts:30-44`, PRD `prd.md:106`).
  - `trailingSizeText` (`src/lib/services/size.ts:41-48`) reads the size a text ends with. Hebe uses it, Super-Pharm doesn't.
  - Only `matching.ts`, `price-comparison.ts` and `watchlist-rows.ts` among the services may run in the browser (`eslint.config.js:88-96`, :136-143). `size.ts` and `search-query.ts` aren't admitted, and the latter imports `astro/zod`.

### 5. Live evidence and four prototype rules

**Requests** (owner-approved, `change.md`; one at a time, 3 s apart, with the gate's User-Agent and `Accept: application/json`, following no redirect; every answer a 200 JSON):

- 3 Rossmann searches, the adapter's request with `pageSize=24`: „nivea creme soft żel pod prysznic”, „head & shoulders classic clean” and „maybelline lash sensational”.
- 7 Super-Pharm lookups, each `searchParams(query, 10)` from `super-pharm.ts` to the index's query URL. Each query is the one `nameQuery` gives the chosen Rossmann product:
  - „AA LAAB Skin Barrier Protection 150 ml”
  - „NIVEA Balsam do ust 4,8 g”
  - „NIVEA Derma Control Clinical 150 ml”
  - „NIVEA Creme Care 500 ml”
  - „Head & Shoulders Classic Clean 400 ml”
  - „Maybelline New York Lash Sensational Sky High 7,2 ml”
  - „Maybelline New York Lash Sensational Full Fan Effect 9,5 ml”
- The answers are kept whole in `recordings/` (`rossmann-search-<query>.json`, `super-pharm-lookup-<product>.json`), pretty-printed with every number as sent, for the plan to turn into fixtures. The 15th case uses the fixture `super-pharm-name-search-one.json`, the lookup for Nivea Soft 300 ml.

**What Super-Pharm returned** (all 7 lookups, as the adapter read them):

- **Where the right item ranked.** In the 13 cases where Super-Pharm has the product, it was among the 10 hits:
  - first in 6 cases: the AA LAAB face wash, Creme Care, Head & Shoulders, Nivea Soft, Sky High Black and Full Fan Effect Burgundy Brown;
  - 2nd to 6th in the other 7, all mascaras.
- **Large answers.** Algolia drops words it can't match: 1,969 hits for the AA LAAB query and 1,044 for Sky High.
- **No `capacity`** for 27 of 47 candidates: 7 of 10 for AA LAAB, 5 of 5 for the lip balm, 9 of 10 for Derma Control, 1 of 1 for Head & Shoulders, 2 of 10 and 3 of 10 for the mascaras.
- **Not orderable online.** The Creme Care and Head & Shoulders items, the right ones, aren't orderable online (`in_stock` or `inStoreOnly`); a match to them shows a price that can't win.

**The rules compared** (prototypes, not designs). Each looks only at candidates of the product's size whose brand doesn't differ.

- **First fit:** the first such candidate in Super-Pharm's order.
- **Overlap:**
  - word overlap (Jaccard) between the product's name and caption and the candidate's name;
  - the brand words, sizes, small words and a short list of product-type words (mascara, maskara, tusz, rzęs, deo) set aside;
  - the best accepted if at least 0.5 and at least 0.1 ahead.
- **Strict:**
  - accept a candidate only if every remaining word of its name is the product's, numbers of up to 3 digits aside;
  - of those, the one whose shared words include every other's.
- **Sibling veto:**
  - a word the product lacks bars a candidate only if another candidate's name has it too;
  - the candidate must hold half of the product's words, and the same tie-break applies.

The right item was judged by reading the names. „likely” marks a judgement on naming alone: Super-Pharm's „Lash Sensational” is the Full Fan Effect line, and „Burgundy Haze” and „Tinted Primer” are Rossmann's „Burgundy” and „baza”. Outcomes with sizes read from the end of Super-Pharm's names where `capacity` is missing:

| Rossmann product                                  | Right Super-Pharm item | First fit | Overlap | Strict | Sibling veto |
| ------------------------------------------------- | ---------------------- | --------- | ------- | ------ | ------------ |
| 419343 AA LAAB żel do mycia twarzy 150 ml         | 105870                 | right     | right   | right  | right        |
| 11790 Balsam do ust, Soft Rose 4,8 g              | none in the answer     | wrong     | safe    | safe   | safe         |
| 2126586 Derma Control Clinical, dla kobiet 150 ml | none in the answer     | wrong     | safe    | safe   | safe         |
| 196779 Creme Care 500 ml                          | 20369                  | right     | right   | right  | right        |
| 46632 Head & Shoulders Classic Clean 400 ml       | 150930                 | right     | right   | right  | right        |
| 366692 Sky High Black 7,2 ml                      | 67655                  | right     | right   | right  | missed       |
| 390594 Sky High Cosmic Black                      | 84422                  | wrong     | right   | right  | right        |
| 415613 Sky High Brown                             | 99681                  | wrong     | right   | right  | right        |
| 2079826 Sky High Burgundy                         | 134305 (likely)        | wrong     | right   | missed | right        |
| 2075152 Sky High Blue Mist                        | 122681                 | wrong     | right   | right  | right        |
| 415614 Sky High baza                              | 99683 (likely)         | wrong     | right   | missed | right        |
| 218841 Full Fan Effect Black 9,5 ml               | 30050 (likely)         | wrong     | missed  | right  | missed       |
| 233593 Full Fan Effect Intense Black              | 30469 (likely)         | wrong     | missed  | right  | missed       |
| 342570 Full Fan Effect Burgundy Brown             | 62293 (likely)         | right     | missed  | right  | missed       |
| 26900 Soft 300 ml                                 | 10132                  | right     | missed  | missed | right        |

- **Tally, with sizes read from names:**
  - first fit: 6 right, 9 wrong;
  - overlap: 9 right, 2 safe, 4 missed;
  - strict: 10 right, 2 safe, 3 missed;
  - sibling veto: 9 right, 2 safe, 4 missed.
- **Without sizes from names:** first fit 5 right, 1 safe, 1 missed, 8 wrong; overlap 8/2/5/0; strict 9/2/4/0; sibling veto 8/2/5/0. Reading sizes from names gains each name rule the Head & Shoulders match and adds no wrong accept. For first fit it turns its one safe case into a wrong one (a Disney lip balm), and it swaps its wrong pick for the women's deodorant from a face-cleansing gel to a Sensitive spray.
- **Why plain overlap fails.** The first scoring pass counted all words, brand and product-type words included, and ranked the best look-alike without a threshold. It put another shade first for 4 of the 9 mascaras (Cosmic Black, Brown, Burgundy and Full Fan Effect Black, all losing to Black or to Burgundy Brown) and tied for Blue Mist. „Tusz do rzęs” in Rossmann's caption matches the Black item's name, while the right shade's says „Mascara”.
- **Why a minimum is needed.** The only same-size candidate for the women's Derma Control spray is a face-cleansing gel (99381); the only look-alike is not enough.
- **What the misses show:**
  - **The strict rule** misses packaging words („(Pudełko)” on Nivea Soft 300 ml) and words Rossmann shortens („Burgundy Haze”, „Tinted Primer”).
  - **Overlap** misses when Rossmann's name and caption carry words Super-Pharm's names lack. Its 0.5 floor rejects the right item for Nivea Soft at 0.43 (3 words shared of 7). On the Full Fan Effect line the right item scores highest but stays under the floor, at 0.38 to 0.44, since „Full Fan Effect” and „efekt wachlarza” aren't in Super-Pharm's names.
- **Read sizes from names with care.** A set's name ends with another item's size: „…Pomadka 4,8 g + Płyn mic. 200 ml”, and „… + SG 250 ml” in the add-from-other-shops recording.
- **Sample limits.** 15 cases from 3 product lines (AA, Nivea, Maybelline) plus Head & Shoulders. The product-type list was fitted on these answers. The tie-breaks are untested beyond them.

### 6. Recording and showing "accepted by name"

- **The table today** (`supabase/migrations/20260927184936_watchlist_matches.sql`):
  - `decided_by text not null check (decided_by in ('auto','user'))` (:30);
  - `watchlist_matches_decider_fits_state`: a match may be either, a decline only `user`, a `not_found` only `auto` (:53-55);
  - an item copy with `eans` (:32-41);
  - no column for why a match was accepted.
  - The update grant covers `decided_by` and the item columns (`20260928011450_price_observations.sql:27-31`), and the update policy lets the owner change a decision in any state (`20261001182905_watchlist_removal_and_repin.sql:24-29`). A signed-in user can already insert or set an automatic match on their own rows; only their own card, list count and re-pin offer change, and price RLS keys on `state = 'matched'`, not on `decided_by` (`price_observations.sql:99-106,119-126`).
- **Where `decided_by` is read:**
  - the card's note, `"auto"` giving „Dopasowano automatycznie: ten sam EAN i rozmiar.” and `"user"` „Potwierdzone przez Ciebie.” (`src/lib/services/match-view.ts:212`);
  - `matchStateIn`, where only an automatic match counts a size or brand difference toward „Do sprawdzenia” (`watchlist-rows.ts:461`, :196-207);
  - `repinView`, which lets the user confirm an automatic match (`match-view.ts:326`).

  A match accepted at an equal size with a brand that doesn't differ has no such difference (`matchDifferences`, `matching.ts:113-121`). So Super-Pharm stops holding the product in „Do sprawdzenia”, with no change to the list's code, while another shop's state can still hold it there.

- **The three ways to record "by name":**

| Way                                    | Database                                                                                                      | Code                                                                                                                                                                                                                                | Risk                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (B) Derive: no EAN in common = by name | None                                                                                                          | Pass the product's and the item's EANs to `matchedView` (`match-view.ts:53,199`); the callers hold both (`storedView`, `lookupOutcome`)                                                                                             | Wrong if the name step picks among EAN-sharing candidates, for rows the rule didn't write (e2e seeds have no EANs, `tests/e2e/support/watchlist-data.ts:152-186`), or if stored EANs change |
| (A1) New `decided_by` value            | Re-create the value check; `decider_fits_state` already allows any decider on a match; no grant or RLS change | Both parsers' enum (`matches.ts:366`, :488), types (`types.ts:105,128`), every `=== "auto"` (`watchlist-rows.ts:461` would quietly treat it as user-confirmed), the reason carried through `MatchPick`, `ShopLookup` and `toLookup` | Old code reads the value as unreadable (`matches.test.ts:1103-1104`): a rollback after such rows exist shows read failures until a redeploy                                                 |
| (A2) New column, e.g. `auto_basis`     | Column, its check, a backfill or "null means EAN", `item_only_when_matched` rebuilt, an explicit update grant | Both selects (`matches.ts:359-361`, :529), types, `matchedView`                                                                                                                                                                     | A tie constraint makes old code's user decisions fail with 23514 after a rollback; without one, stale values stay on user rows                                                              |

- **Under (B), the rule and the read compare the same lists.** The adapters cap EAN lists before the rule sees them (`rossmann.ts:217-219`, `luigis-box.ts:282-286`), so the cap can't mislabel.
- **Fixture updates.** `match-view.test.ts:41`'s product has no EANs, so under (B) its expected EAN note (:93) would flip unless EANs are added. The kitchen sink's automatic matches share an EAN and keep the EAN note.

### 7. What "EANs can't decide" covers

| Reading                            | Where it arises                                                                                                                                                   | Tests that pin today's choice                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| (a) The candidate has no EAN       | Every Super-Pharm candidate (`super-pharm.ts:319-321`)                                                                                                            | `super-pharm.test.ts:729-756`, `shop-matching.test.ts:562-598`                   |
| (b) The product has no EAN         | A product added without one; after add-from-other-shops, one added from Super-Pharm                                                                               | `shop-matching.test.ts:158-174`                                                  |
| (c) Both have EANs, none in common | Natura or Hebe listing an item under another barcode, found by the name search after the EAN search finds nothing (`shop-matching.ts:77-87`; S-02 plan-brief :32) | `shop-matching.test.ts:176-186`; `hebe.test.ts:493-518` only if it applies there |

- The owner's call names (b): "also in the other shops for a product without an EAN" (`change.md`). (a) is the change's Super-Pharm case. (c) would make Natura and Hebe accept by name what they offer as a choice today. It's not decided.

### 8. Tests, kitchen sinks and documents that pin today's behaviour

- **Unit tests** (classified by the investigation from reading; none was run):
  - `match-step.test.ts:310-312`, :321-325, :327-333: Super-Pharm only prompts. These become lookups on own navigation.
  - `match-view.test.ts:283-287`, :499-507: the button's link names the shop. The plain case changes.
  - `match-card.test.ts:290-311`: the button text of an unsaved decision.
  - `shop-matching.test.ts`:
    - :562-572, :574-587 and :1085-1118 (Super-Pharm never accepts, likeliest first);
    - :828-885 (no Super-Pharm reservation on a plain view; the helpers `trackerShop` :763 and `slowGate` :769-793 know only Natura and Hebe);
    - :887-912 (requested URLs);
    - :1033-1054 and :1058-1083 ("gives Super-Pharm only its button").
  - `super-pharm.test.ts:729-756`: the rule on Super-Pharm's real candidates. Its `ROSSMANN_SOFT` (:111-115) and other `MatchProduct`s would need a name and caption.
  - Unclear until the rule is designed: `matching.test.ts:211-253` (the choice's order), `shop-matching.test.ts:158-186` and `hebe.test.ts:493-518` (reading (c)).
- **E2e:** `tests/e2e/phone-four-shops.spec.ts`. Its header (:1-15), title (:42), step 3 (:93-104, asserting the button and its `?retry=super-pharm` link) and step 4 (:106-120, tapping it) change. The other specs would now let a product view trigger a Super-Pharm lookup that the e2e hold on every shop refuses; none asserts Super-Pharm's card (inferred, not run).
- **Kitchen sinks:**
  - `src/dev/fixtures.ts:1060` calls `leftToUser(SUPER_PHARM_CANDIDATES)`, which throws at load if the rule accepts the 300 ml candidate;
  - the prompt fixtures and texts at :266-269, :303-304, :1031-1127, :1244-1260 and :1303-1309;
  - `src/dev/product-page.astro:182`, :285-288, :461-470;
  - `src/dev/watchlist-fixtures.ts:270`, :399-405;
  - `src/dev/watchlist.astro:212-219`.

  There's no automatic Super-Pharm state yet.

- **Documents:**
  - `CLAUDE.md`: "Architecture", the UI and "Shops and matching" paragraphs on `on-request`, the button, and "never accepted on their own".
  - `context/foundation/prd.md:103`, :107-108 (FR-006, and the S-05 and S-06 updates).
  - `context/foundation/test-plan.md:48` (risk #6), :123-124, :189-191.
  - `docs/research/polish-drugstore-price-apis.md:310,312` (§6 steps 4 and 6).
  - `context/foundation/roadmap.md:183`, :187, :193, :196.
  - `context/deployment/deploy-plan.md:358`.
  - Comments at `price-comparison.ts:86-105`, `matching.ts:3-8`, `shop-matching.ts:58-61,147-157` and `super-pharm.ts:21-23,319-321`.

## Code References

- `src/lib/services/matching.ts:11-15,25-27,34-58,64-72,80-106,113-121`: the matching rule, the brand key, the product it compares.
- `src/lib/services/shop-matching.ts:46,53-56,63-91,103-145,152-162,272-290,338-380`: hit counts, `LookupProduct`, the lookups, the EAN skip, the name query, the steps, what an accepted lookup stores.
- `src/lib/services/price-comparison.ts:95-105`: `MatchMode` and `MATCH_MODES`.
- `src/lib/services/match-step.ts:22-33,62-82,94-96`: shop parameters, the step rule, the island's refetch.
- `src/lib/services/match-view.ts:53,197-222,326,372-377`: the view's product, the automatic note, the re-pin offer, the button's link.
- `src/components/watchlist/match-card.ts:101-111`: an unsaved decision's text.
- `src/lib/services/matches.ts:254-283,334-345,359-369,529`: what a lookup writes, the narrowed update, the reads.
- `src/lib/services/watchlist-rows.ts:196-207,461`: „Do sprawdzenia” and the automatic mismatch.
- `src/lib/services/shops/super-pharm.ts:305-321,480-484`: name, size from `capacity`, no EANs.
- `src/lib/services/size.ts:41-48`: `trailingSizeText`.
- `src/pages/watchlist/[id].astro:99-111` and `src/pages/api/watchlist.ts:40`: the steps' product, the redirect after „Dodaj”.
- `supabase/migrations/20260927184936_watchlist_matches.sql:20-64`, `20260928011450_price_observations.sql:27-31,99-126`, `20261001182905_watchlist_removal_and_repin.sql:24-29`: the table, the update grant, price RLS, the update policy.
- `eslint.config.js:88-96,136-143`: the island's admitted services.

## Architecture Insights

- **Two facts in one mode.** "Can't search by EAN" is a property of a shop's index. "Looked up only on a tap" was a cost decision. They change separately: Super-Pharm keeps the first and drops the second, and Rossmann in add-from-other-shops needs the same pair.
- **Acceptance is a property of the data, not the shop.** The rule receives no shop. Whether an EAN can decide depends on the product's and the candidate's lists, so a name rule keyed on "no EAN in common" serves Super-Pharm now and products without EANs later, with no per-shop list.
- **The variant lives in the caption.** For Rossmann products the caption carries what tells siblings apart. A name rule that reads the product's name without its caption can't tell Cosmic Black from Black.
- **Safety comes from refusing.** In the 15 recorded cases, every prototype that compared names stayed at zero wrong accepts by declining when unsure, and the user's pick, which exists today, takes the rest. A tighter rule costs taps, not wrong prices.
- **Honesty rules carry over.** An unanswered lookup stays unavailable, never „nie znaleziono” (`lessons.md:19-24`). A match that's wrong but plausible shows the item's real price for another product, so the card naming the item (`match-view.ts:197-222`) and „Zmień” stay the remedy.

## Historical Context (from prior changes)

- `context/changes/super-pharm-in-comparison/plan.md`:
  - :94: "Automatic Super-Pharm matches, by name similarity or by EANs from product pages … FR-006 stays as written."
  - :95: no lookup "on a plain view, or once after „Dodaj”".
  - :129: "A plain view must never search an on-request shop".
  - Its plan-brief.md:30 and :36: a view never waits for Super-Pharm, and no EAN means no automatic match.
  - Its research.md:372 and :748-749 rated "brand, size and name similarity" as contradicting FR-006 and test-plan risk #6, needing a PRD update.
  - Step 5.5, the owner's phone check of the button, is still open (plan.md:979; `context/foundation/roadmap.md:197`, S-06 in progress). This change makes it moot.
- `context/archive/2026-10-02-hebe-in-comparison/plan.md:84`: "No new matching rule for Hebe: no name comparison and no "never automatic" … a wrong EAN on a same-size, same-brand item is accepted". It's about names guarding an EAN match.
- `context/archive/2026-10-01-fix-matches-and-watchlist/reviews/plan-review.md:47` named the blind spot "S-05/S-06 may auto-accept on name and size". Its plan-brief.md:30 and :77 accept few false alarms from the brand rule on thin evidence.
- `context/archive/2026-09-27-shop-matching-first-two-shops/plan-brief.md:32`: the name search exists for items listed under another barcode.
- `docs/research/polish-drugstore-price-apis.md:312` (§6 step 6) proposed "brand + normalised name tokens + size within ±5 %" as a fallback and records that the app matches no shop this way. Its ±5 % is implemented nowhere: `sizesEqual` allows 0.1 %.
- `context/foundation/test-plan.md:48` and :189:
  - risk #6 "a shop without EANs can't auto-accept";
  - "No guard keys "never automatic" on the shop: it holds because no Super-Pharm candidate carries an EAN".
- `context/changes/add-from-other-shops/`:
  - its research's finding 3 and `change.md`, the reversed "keep Super-Pharm apart";
  - its §9, Rossmann as a matched shop without an EAN search.

## Related Research

- `context/changes/add-from-other-shops/research.md`: the four-shop search, its live evidence, and Rossmann's need for a name-only lookup on view.
- `context/changes/super-pharm-in-comparison/research.md`: Super-Pharm's search, costs and the options weighed in S-06.
- `context/archive/2026-10-02-hebe-in-comparison/research.md`: Hebe's names and sizes.
- `context/archive/2026-10-01-fix-matches-and-watchlist/research.md`: the brand rule and its evidence.
- `docs/research/polish-drugstore-price-apis.md` §2.3 and §6: Super-Pharm's fields and the original matching notes.

## Open Questions

For the owner:

1. **What "EANs can't decide" covers (§7).** (a) and (b) follow from the calls. Should (c) let Natura and Hebe accept by name when their EANs don't overlap the product's? It changes what they do today.
2. **Stored „nie znaleziono” at Super-Pharm (§3).** Leave it until the user taps „Szukaj ponownie”, or look such products up once more automatically?

For the plan:

3. **The rule's form (§5).** The strict rule had the most right and no wrong accept here. It still needs:
   - a reviewed list of product-type words;
   - handling of packaging words such as „(Pudełko)”;
   - the threshold and tie-break, fixed with fixtures from `recordings/`.
4. **Sizes from Super-Pharm's names when `capacity` is missing (§5):** an adapter change, guarded against sets („Zestaw”, „+”).
5. **The caption in the rule (§4).** `LookupProduct` gains `caption`, and the tests' products need a name and caption. Whether the Super-Pharm query should carry the caption too is open: the recorded right items were within 10 hits without it, and a longer query loses the size first at the 80-character cut.
6. **The mode split (§2).**
   - two facts per shop, or a new value with an exhaustive switch;
   - what happens to the `on-request` branches once no shop uses them.
7. **Recording "by name" (§6):** derive (B) or store (A1, A2).
8. **The cost statement (§3):** 3 to 5 shop requests on a product's first view, including the first view after „Dodaj”, and a check against the Workers connection budget.
9. **Documents (§8):** PRD FR-006 and FR-007 updates, test-plan risk #6, CLAUDE.md, the research note's §6, the roadmap, and S-06's open step 5.5.
