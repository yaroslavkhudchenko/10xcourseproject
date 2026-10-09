---
date: 2026-10-09T22:34:00+02:00
researcher: Claude Opus 5.5
git_commit: 86f72e9
branch: refactor/decision-route-guardian
repository: yaroslavkhudchenko/10xcourseproject
topic: "How the decision route, its write and its tests look today, and how a guardian would fit into them (S-01)"
tags: [research, codebase, decisions, watchlist-matches, decision-route, guardian]
status: complete
last_updated: 2026-10-09
last_updated_by: Claude Opus 5.5
---

# Research: the decision route, its write and its tests, for a guardian (S-01)

**Date**: 2026-10-09T22:34:00+02:00
**Researcher**: Claude Opus 5.5
**Git Commit**: 86f72e9, with this change's folder uncommitted
**Branch**: refactor/decision-route-guardian
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

For roadmap M-2's S-01, "decisions posted from a product's page pass one guardian", this research answers six questions:

1. What do these look like today: the decision route, the decision write (`parseMatchForm`, `recordDecision`, `record` in `src/lib/services/matches.ts`), the re-pin choice's buttons, and their tests?
2. Where would a pure guardian live, and how would the route load what it needs (the product and its decisions)?
3. How does the guardian's output map onto today's compare-and-swap store until S-02 replaces it?
4. Which tests pin the route's behaviour?
5. How does a refusal reach the page?
6. What did earlier changes decide that bears on these?

The inputs are `context/domain/02-invariant-aggregate-refactor.md` (the domain plan), `context/domain/domain-distillation.md` and `context/foundation/roadmap.md` (S-01).

## Summary

- **The route writes without loading the product.** `POST /api/watchlist/matches` parses the form, calls `recordDecision` and maps four outcomes to redirects (`src/pages/api/watchlist/matches.ts:11-45`). It checks the posted shop against the four priced shops only, so the product's own shop passes (`:22`).
- **The store checks only the stored state, not the move.** `record` inserts, then on a conflict updates only where the stored decision is the expected one, in a second statement (`src/lib/services/matches.ts:296-342`). It doesn't check that the requested move is legal from that state. A decline posted with `replaces=unmatched` over a decline, and a confirmation of the user's own confirmed item, each update one row and answer `saved` (from reading `:320-341`; no test pins either case). The choice the page renders offers neither move (`src/lib/services/match-view.ts:338`, `:341`).
- **A decision in the product's own shop is stored, then ignored, by an earlier deliberate call.** add-from-other-shops decided "no invariant against a decision in a product's own shop" (`context/archive/2026-10-06-add-from-other-shops/plan.md:100`). Whoever reads a product's decisions narrows them to its matched shops, so each such reader leaves the row out (`src/lib/services/matches.ts:391-398`).
- **The page shows a refusal's text only on a matched shop's card** (`src/pages/watchlist/[id].astro:130-142`; `src/lib/services/match-view.ts:403-432`). An error that names the product's own shop, or no shop, shows nowhere while the product is shown; only the 404 page shows such an error (`src/pages/watchlist/[id].astro:134`, `:225`). So a refusal of an own-shop post can't reach the user through today's page.
- **The guardian can load with the reads the product page already makes:** `getWatchlistProduct` and `listMatches`, side by side (`src/pages/watchlist/[id].astro:52-60`).
  - Another user's product reads as no product under RLS (`src/lib/services/watchlist.ts:232-263`). That keeps the privacy check passing, where another user's product must answer exactly like a missing one (`scripts/check-two-users.mjs:255-278`), provided "not on your list" maps to `gone` as today.
  - Until S-02, the guardian's change maps onto `record`'s existing `replaces` and columns with no change to the store (see "Mapping the guardian's change onto today's store").
- **Two parts of the domain plan's design clash with the codebase's rules:**
  - `matchedShopsOf` must stay in the browser-safe `src/lib/services/price-comparison.ts`, since island modules call it (`src/lib/services/watchlist-rows.ts:432`, `:492`) and the island lint rule admits only three services (`eslint.config.js:135-146`).
  - `src/` has no class and no `Error` subclass outside the test stubs (`src/lib/services/testing/stub-supabase.ts:43`, `:180`). The services read here report failures as result unions or null (`src/lib/services/matches.ts:224`; `src/lib/services/watchlist.ts:232-263`).
- **No unit test imports the decision route** (a search of `src/**/*.test.ts` and `scripts/**/*.test.mjs`). Its branches are reached only over HTTP (`scripts/smoke.mjs:242`, `scripts/check-two-users.mjs:255-278`) and in two browser specs. Both specs post only a re-pin's decline from an automatic match (`tests/e2e/phone-decline-match.spec.ts:57`, `tests/e2e/phone-three-shops.spec.ts:88`). A route-test harness exists for the JSON and refresh routes (`src/lib/services/price-routes.test.ts:203-211`).

## Detailed Findings

### The decision route today

- **What it reads, and how.** It reads `itemId`, `shop` and `f` on their own (`src/pages/api/watchlist/matches.ts:21-23`), so a rejected form still goes back to its product's page and shop. `shop` goes through `parseMatchedShop(form.get("shop"))` with its default list, the four priced shops (`:22`; `src/lib/services/price-comparison.ts:71-76`, `:51`).
- **Its redirects, by outcome (`:17-43`):**
  - a body that isn't a form: the plain list, with no code (`:17`; `src/lib/services/matches.ts:212-214`);
  - no Supabase client: `config` (`:26`);
  - a form that fails parsing: `invalid` (`:30`);
  - then `recordDecision` (`:33`): `saved` becomes `matched` or `declined` by the action (`:37`), and `decided`, `gone` and `failed` pass through (`:39-43`).
- **The route reads no product** (`src/pages/api/watchlist/matches.ts:11-45`). add-from-other-shops recorded this as the reason it couldn't refuse an own-shop decision (`context/archive/2026-10-06-add-from-other-shops/research.md:291`).
  - That line's other claim, "It refuses `rossmann`", held before that change made every priced shop a possible matched shop.
  - At 86f72e9 the route takes all four priced shops (`src/pages/api/watchlist/matches.ts:22`), and `src/lib/services/matches.test.ts:469` pins only that unpriced shops are refused.
- **Its only senders** in `src/` are the two forms of `src/components/watchlist/MatchChoice.astro`: the confirm form at `:116` and the decline form at `:143`.

### The decision write

- **`parseMatchForm`** (`src/lib/services/matches.ts:140-174`) returns a `MatchForm` with `itemId`, `shop`, `decision` and `replaces`, or null. Its schema is built per shop (`matchFormSchemaFor`, `:98-120`) and checks:
  - a confirmed item's id, and a re-pin's replaced id, against that shop's adapter (`itemIdsOfShop`, `:85-90`);
  - the links against that shop's hosts (`linksOfShop`, `:115`).
  - It parses the size again from the posted text (`:168`).
  - `replaces` reads only `matched:<id>` or `unmatched` (`:57-65`), and a first choice's forms post none (`:144-145`).
- **`recordDecision`** (`:275-287`) and **`recordLookup`** (`:258-269`) build the row's columns: `matched`/`user` or `unmatched`/`user`, and `matched`/`auto` or `not_found`/`auto`.
- **`record`** (`:296-342`):
  - It inserts first (`:303-309`). A 23503 is `gone` (`:311-313`), and any error but 23505 is `failed` (`:315-318`).
  - On a 23505 it updates where the stored state is the expected one (`:325-330`):
    - `not_found` without `replaces`;
    - `matched` with the same `shop_item_id` for `matched:<id>`;
    - `unmatched` for `unmatched`.
  - An update with no row back is `decided` (`:341`). Insert and update are two statements.
- **The moves it doesn't check.**
  - **A decline with `replaces=unmatched` over a decline:** the update's condition (`:330`) matches the stored decline, so it answers `saved`.
  - **A confirmation of item X with `replaces=matched:X` over the user's own confirmed X:** `:329` matches, so it answers `saved`.
  - **A confirmation of an automatic match's own item:** also `saved`, and legal. It turns the match into the user's own (`src/lib/services/matches.test.ts:738`; `src/lib/services/matches.db.test.ts:207`).
  - These come from reading `:320-341`. No test or archived review covers the first two as a server-side gap (prior-decisions search, see Historical Context).

### The re-pin choice's buttons

- **The first choice** (no stored decision, or a retried not found) offers every candidate to confirm and „Żaden z nich” (`src/components/watchlist/MatchChoice.astro:51-54`).
- **The re-pin's choice** is built by `repinView` (`src/lib/services/match-view.ts:329-376`):
  - „Żaden z nich” only from a match (`:338`);
  - every candidate to confirm except the item the user already confirmed (`:341`);
  - `replaces` from `replacesFieldOf` (`src/lib/services/matches.ts:52-54`).
- **Tests pin these choices:** `src/lib/services/match-view.test.ts:474` (automatic match: its item offered again, a decline offered), `:490` (the user's confirmed item not offered again) and `:499` (from a decline: no decline, `replaces` is `unmatched`).

### Loading what a guardian needs

- **`getWatchlistProduct(supabase, id)`** (`src/lib/services/watchlist.ts:232-263`) returns a `WatchlistProduct`, null or `"failed"`.
  - It is one select by id with a 2 s limit.
  - A query error, a timeout or a row its schema rejects gives `"failed"`. No row gives null, and RLS makes another user's product read the same way.
  - `WatchlistProduct` is `WatchlistItem` (`src/types.ts:61-74`, with `source` and `sourceItemId`) plus `eans` and `productUrl` (`src/types.ts:77-82`).
- **`listMatches(supabase, itemId, shops = PRICED_SHOPS)`** (`src/lib/services/matches.ts:446-468`) returns a `MatchesRead` of `matches` and `unreadable` (`:435-438`), or null when the decisions couldn't be read at all.
  - It drops rows of shops outside `shops` (`:464`) and reports a listed shop as unreadable when an odd row may be its decision (`:466-467`).
  - It doesn't check that the product exists: an unknown id gives empty lists.
  - It can't know the product's own shop, so whoever reads a product's decisions narrows them to its matched shops (`:391-398`).
- **The product page** reads both at once (`src/pages/watchlist/[id].astro:52-60`). It narrows with `matchedShopsOf(shown.source)` (`:78`), and `decideMatchStep` treats a null read, or a shop in `unreadable`, as `read-failed` (`src/lib/services/match-step.ts:60-62`).
- **Privacy.** `scripts/check-two-users.mjs:255-278` posts a re-pin's decline of user A's Natura match as user B. It requires the same 302 location, with the id swapped, as for a product no one has. Today that answer is `gone` from the insert's 23503 (`src/lib/services/matches.ts:311-313`). A guardian that loads first gets null for both ids under RLS, and keeps the check passing if null maps to `gone`.

### Mapping the guardian's change onto today's store (until S-02)

The domain plan's change says what it expects to replace and what to store (`context/domain/02-invariant-aggregate-refactor.md`, Step 4). It maps onto `record(supabase, itemId, shop, columns, replaces)` (`src/lib/services/matches.ts:296-302`) with no change to `record`.

| the change expects           | `replaces` passed to `record`         | the update's condition (`:325-330`)                    |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------ |
| nothing stored, or not found | `null`                                | the insert, else an update where `state = 'not_found'` |
| a match of item X            | `{ state: "matched", shopItemId: X }` | `state = 'matched'` and `shop_item_id = X`             |
| a decline                    | `{ state: "unmatched" }`              | `state = 'unmatched'`                                  |

The columns are the ones `recordDecision` and `recordLookup` build today (`:264-267`, `:282-285`): a user's match, a user's decline, an automatic match, or not found.

`record`'s four results keep their meaning (`:224`), with one change in what they cover:

- `decided` now covers a decision changed between the guardian's read and the write;
- a form that is stale against the decision just read is caught before any write.

### How a refusal reaches the page

1. **The redirect.** `decisionBackTo(itemId, shop, outcome, filter)` writes `?f=…&shop=<shop>&<matched|declined|decided>=1` or `&error=<code>`. It leaves out `shop` when the shop couldn't be read (`src/lib/services/matches.ts:206-218`). The four error codes are `invalid`, `failed`, `config` and `gone` (`:177-185`).
2. **The page.** It keeps a notice or error only when its shop is one of the product's matched shops (`decisionNotice`, `decisionError`: `src/lib/services/match-view.ts:403-432`; `src/pages/watchlist/[id].astro:132-142`).
   - The `decisionError` comment says an error naming the own shop is one "which only a crafted post comes back with" (`src/lib/services/match-view.ts:425-428`).
   - Tests: `src/lib/services/match-view.test.ts:681-687` (the own shop gives none) and `:689-698` (no shop gives none).
3. **The card.** The page hands each matched shop's notice and error to the island (`src/pages/watchlist/[id].astro:137-143`). `matchCardOf` turns them into alerts at the foot of that shop's card: success for a notice, destructive for an error (`src/components/watchlist/match-card.ts:132-143`).
   - `decided` shows as "Ten produkt ma już zapisaną decyzję." (`src/lib/notices.ts:22-26`).
4. **The 404 branch** shows any of the four error codes whatever the shop (`src/pages/watchlist/[id].astro:134`, `:225`). That is how a `gone` decision post lands.
5. **The address bar.** A script removes every notice parameter but `f` after the render (`src/lib/notices.ts:274-313`; `src/pages/watchlist/[id].astro:267-282`).

For S-01:

- **Reach the user through a card:** a refusal for a matched shop, which covers an illegal move, a stale form and an unreadable decision.
- **Reach no one while the product is shown:** a refusal for the product's own shop, or with no shop.

### The tests that pin the route's behaviour

- **Unit, `src/lib/services/matches.test.ts`, with a local stub that answers each query in turn (`:139`):**
  - `parseMatchForm`: `:207`–`:584`, the per-shop id and link rules included;
  - `recordDecision`'s inserts and its 23505, 23503 and failure paths: `:602`–`:676`;
  - the re-pin's compare-and-swap: `:702`–`:798`, including `:738`, confirming an automatic match's own item;
  - `decisionBackTo`: `:809`–`:834`;
  - `recordLookup`: `:841`–`:871`.
- **Unit, other modules:**
  - `src/lib/services/match-view.test.ts`: `repinView` (`:365`–`:536`), `decisionNotice` (`:586`) and `decisionError` (`:655`);
  - `src/lib/services/shop-matching.test.ts`: the lookup's write (`:1183`, `:1292`, `:1315`) and the re-pin step (`:1359`, `:1392`, `:1939`).
- **The real database**, `src/lib/services/matches.db.test.ts:127`–`:217`, eight cases:
  - first choice over not found; a late lookup; three stale writes; a removed product; two concurrent re-pins; confirming the automatic match;
  - plus one negative control.
  - The plain `npm run test` leaves it out (`vitest.config.ts`). CI's `smoke` job runs it with `npm run test:db` (`.github/workflows/ci.yml:72`).
- **The database checks:**
  - `scripts/check-matches-db.mjs` (CI `.github/workflows/ci.yml:60`): uniqueness (`:117`), ownership (`:140`, `:144`), shape (`:196`, `:201`) and the owner's own updates (`:210`, `:221`, `:311`);
  - `scripts/check-two-users.mjs:255-278` (CI `:102`): the `gone` path's privacy.
- **Smoke:** `scripts/smoke.mjs:242` (CI `:99`) checks that a cross-origin decision post gets 403. Astro's origin check refuses it before the route runs.
- **Browser.**
  - `tests/e2e/phone-decline-match.spec.ts:18`–`:76` and `tests/e2e/phone-three-shops.spec.ts:33`–`:120` each post a re-pin's „Żaden z nich” from an automatic match. They check the card's notice, "Zapisano: brak w …", and the list row afterwards, not the address.
  - None of the 10 specs posts „To ten produkt”, a first choice or a re-pin from a decline.
  - Decisions are seeded straight into the database (`tests/e2e/support/watchlist-data.ts:190`).
- **The gap: no unit test imports `src/pages/api/watchlist/matches.ts`.** Its branches have no unit test:
  - a body that isn't a form;
  - `config`;
  - `saved` becoming `matched` or `declined`;
  - the `decided`, `gone` and `failed` redirects.
- **A harness exists.** `src/lib/services/price-routes.test.ts` imports two other routes' `POST`. It builds the context at `:203-211`, posts forms as `new Request(url, { method: "POST", headers: { Origin, "Sec-Fetch-Site": "same-origin" }, body: new URLSearchParams(fields) })`, and asserts the `Location` header.
- **`stubSupabase`'s limit.** `stubSupabase` (`src/lib/services/testing/stub-supabase.ts`) answers an error per table, not per query. It can't reach `record`'s `decided` path, which needs the insert to fail and the update to answer. That takes a stub that answers each query in turn, like the local one at `src/lib/services/matches.test.ts:139`.

### Where a guardian may live, and in what idiom

- **Placement.** A module `src/lib/services/watched-product.ts` falls under the base type-checked rules and `serverFetchConfig` only (`eslint.config.js:16-40`, `:210-226`). No import rule restricts it from importing `@/types`, `@/lib/services/price-comparison` or types from `@/lib/services/matches`.
- **It can't become the rule's one home.** It isn't in `islandConfig`'s files (`eslint.config.js:95-126`), and the island modules may import a value only from three services (`:135-146`). The list's island module calls `matchedShopsOf` (`src/lib/services/watchlist-rows.ts:432`, `:492`). So the domain plan's `WatchedProduct.matchedShopsFor`, as the one definition the list uses, would fail lint, and the rule's one home stays `matchedShopsOf` in `src/lib/services/price-comparison.ts:62-64`. The lesson "Define shared constants and helpers once" says the same (`context/foundation/lessons.md:40-45`).
- **The idiom.**
  - `src/` has two classes, both in a test helper (`src/lib/services/testing/stub-supabase.ts:43`, `:180`), and no `extends Error` (a search of `src/`, `scripts/` and `tests/`).
  - Services return a result union or null and log a failure once (`src/lib/services/matches.ts:224`, `:140`; `src/lib/services/watchlist.ts:232-263`). The one throw read here is a programming error in the gate (`src/lib/services/shop-gate.ts:93-94`).
  - So the domain plan's `class WatchedProduct` and thrown `DecisionRefused` would each be the first of their kind in `src/`. A class would also meet the strict rules `no-extraneous-class` and `unbound-method`.
- **The lesson "Keep decision logic in tested services"** puts every such rule in a function under `src/lib/services/`, with unit tests at its boundaries, while pages and routes only call it and map its result (`context/foundation/lessons.md:26-31`).

## Code References

- `src/pages/api/watchlist/matches.ts:11-45` — the decision route; `:22` takes any priced shop; `:33` writes.
- `src/lib/services/matches.ts:52-65` — `replaces`, written and read.
- `src/lib/services/matches.ts:67-120` — the per-shop form schema; `:67-72` says why an own-shop decision is stored.
- `src/lib/services/matches.ts:140-174` — `parseMatchForm`.
- `src/lib/services/matches.ts:206-218` — `decisionBackTo`.
- `src/lib/services/matches.ts:224` — `RecordResult`.
- `src/lib/services/matches.ts:258-287` — `recordLookup` and `recordDecision`, the column builders.
- `src/lib/services/matches.ts:296-342` — `record`, the insert and the compare-and-swap update.
- `src/lib/services/matches.ts:383-398`, `:446-468` — the read rules and `listMatches`.
- `src/lib/services/watchlist.ts:232-263` — `getWatchlistProduct`.
- `src/lib/services/price-comparison.ts:51`, `:62-64`, `:71-76` — `PRICED_SHOPS`, `matchedShopsOf`, `parseMatchedShop`.
- `src/lib/services/match-view.ts:329-376`, `:338`, `:341` — `repinView` and its two button rules.
- `src/lib/services/match-view.ts:403-432` — `decisionNotice` and `decisionError`.
- `src/components/watchlist/MatchChoice.astro:51-56`, `:116-130`, `:143-150` — the choice's flags and its two forms.
- `src/pages/watchlist/[id].astro:52-60`, `:78`, `:130-143`, `:225` — the reads, the matched shops, the notices and errors, and the 404 alert.
- `src/components/watchlist/match-card.ts:132-143` — a card's alerts.
- `src/lib/notices.ts:13-39`, `:274-313` — the codes, the texts, and forgetting them.
- `src/lib/services/price-routes.test.ts:203-211` — the route-test context.
- `src/lib/services/matches.test.ts:139` — the per-query stub.
- `scripts/check-two-users.mjs:255-278` — the `gone` path's privacy check.

## Architecture Insights

- **Two guards today.** The decision's lifecycle has two: `record`'s compare-and-swap at write time, and which buttons the UI offers. Since S-08 the database leaves the moves to the app (`supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:19-29`).
- **Narrowing by matched shops is the reader's job.** The reads can't know the product's own shop when they run, so "whoever reads a product's decisions narrows them to its matched shops" (`src/lib/services/matches.ts:391-398`). A route that loads the product can narrow, and so refuse, at write time.
- **A refusal is a redirect with a code, and only a matched shop's card can show it.** That is safe by design for crafted posts: a link can't put words on the page (`src/lib/notices.ts`; `context/archive/2026-10-02-hebe-in-comparison/plan.md:1030`).
- **Failures are results, not exceptions,** across every service read here.

## Historical Context (from prior changes)

- **The codes.** `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:372`, `:400`, `:416-420`, `:620` set the route's codes and the `decided` notice, and `reviews/impl-review.md:45` pinned that a double submit ends as `decided`. Supported at 86f72e9 (`src/lib/services/matches.ts:177-185`; `src/pages/api/watchlist/matches.ts:26-43`).
- **The compare-and-swap.** `context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:81`, `:83`, `:97`, `:354-359` introduced `replaces` and the compare-and-swap, keeping the write insert-first so a removed product reads `gone`. Its `research.md:170`, `:195-196` say why the update policy was widened. Supported (`src/lib/services/matches.ts:296-342`).
- **The buttons.** `context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:383`, `:389` and `reviews/impl-review.md:94` (F3) set the choice's button rules as UI rules. No archived finding treats a decline over a decline, or a second confirmation, as a server-side gap.
- **Per-shop errors.** `context/archive/2026-10-02-hebe-in-comparison/plan.md:1030`: "An `?error=` without a valid `shop=`, which only a crafted post sends, shows on no card." Supported (`src/lib/services/match-view.ts:425-432`). Its `reviews/impl-review.md:108` made a shop's ids its own.
- **The own shop.** `context/archive/2026-10-06-add-from-other-shops/plan.md:100`, `:123`, `:643` decided that a decision in a product's own shop is stored and ignored, with "no invariant against" it.
  - Its `research.md:271` calls such a rule "a new invariant, if wanted".
  - Its `research.md:291` is partly superseded: "never reads the product" still holds, but "It refuses `rossmann`" no longer does (see "The decision route today").
- **The ABA case.** `context/archive/2026-10-07-testing-route-and-database-seams/plan.md:88` and `research.md:358-359` accepted the ABA case, a stale form whose decision came back to the same value, and noted the insert ignores `replaces`, safe only while no decision can be deleted. Also `context/foundation/test-plan.md:415`.
- **The roadmap.** S-01 leaves one point open, a code of its own for an illegal move, with `invalid` as the default (`context/foundation/roadmap.md:91`).

## Related Research

- `context/domain/domain-distillation.md`: R-02, R-05, R-07, R-08 and R-10, and the #1 candidate.
- `context/domain/02-invariant-aggregate-refactor.md`: the domain plan. Its Step 4 needs the two corrections in "Where a guardian may live" for `/10x-plan`.
- `context/archive/2026-10-06-add-from-other-shops/research.md`: the own-shop decision's origin.
- `context/archive/2026-10-07-testing-route-and-database-seams/research.md`: the route and database seams, and the accepted ABA case.

## Open Questions

These are for `/10x-plan` and the owner. Each is settled by a choice, not by more research.

1. **What should a refused own-shop post show?** S-01's roadmap outcome says a refused post "comes back with a code the page shows", but the page has no card for the product's own shop.
   - Keep the HB rule that only a matched shop's card shows a decision's error: an own-shop refusal, which only a crafted post sends, then shows nothing and stores nothing.
   - Or add a page-level alert for a decision error that names no matched shop. That is a change to what the user sees, which the domain plan's "Not doing" excludes.
2. **What code does an illegal move get?** The roadmap's default is `invalid` (`context/foundation/roadmap.md:91`).
3. **How should a refusal be represented?** The domain plan sketches a class and a thrown named error. The codebase's idiom is a named result union with no classes and no thrown errors. Both meet "named, stores nothing"; the plan picks one.
4. **What does a post for a shop whose stored decision couldn't be read get?** Only a stale tab or a crafted post sends one, since that shop's card offers no form. `failed` fits; today such a post reaches `record` and answers `saved` or `decided`.
