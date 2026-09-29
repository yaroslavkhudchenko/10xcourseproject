<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: See Which Shop Is Cheapest Today

- **Plan**: context/changes/cheapest-shop-today/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-09-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations

Re-run for this review on 715b097:

- 510 unit tests pass.
- `astro check` reports 0 errors, 0 warnings and 0 hints; lint and build pass.
- `check-prices-db.mjs` (33 of 33), `check-matches-db.mjs` (32 of 32) and `check-watchlist-db.mjs` (14 of 14) pass.
- CI `ci` and `smoke` are green on 715b097.
- `migration list --linked` shows `20260928011450` with a remote version.

All 12 manual rows are ticked. The walk-throughs behind them are recorded in the plan's Implementation Notes.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — A promotion's price stays cheapest after the promotion ends

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/price-comparison.ts:61
- **Detail**:
  - `priceState` judges a price only by its age and the last check's status. `promoEndsOn` is shown ("promocja do DD.MM") but never counts.
  - A Rossmann promo price fetched on the promotion's last day stays fresh, eligible and "Najtaniej" for up to 24 hours after the promotion ends. That happens on the list, which never refetches, and on the product page until a refetch answers.
  - The guardrail says never a wrong number presented as current.
- **Fix**: In `priceState`, count a price whose `promoEndsOn` is before today's date in Europe/Warsaw as `stale`. Add tests for the boundary: the end day itself is fresh, the day after is stale.
  - Strength: the page, the island and the list all get the rule from the one module they share, so they can't disagree. The date is already stored, as `promo_ends_on`.
  - Tradeoff: a browser-imported module needs "today in Poland" (`Intl.DateTimeFormat` with `timeZone`, no new dependency). A promotion Rossmann extends reads stale until the next check.
  - Confidence: HIGH — the field is parsed, stored and returned by the view already.
  - Blind spot: whether Rossmann's `promotionTo` ("…T00:00:00") names the last day or the day after. Keeping the date itself fresh is the lenient reading.
- **Decision**: FIXED: an ended promotion's price counts as stale (the end day stays fresh), and one checked before the end is fetched again at once

### F2 — Screen readers hear "Odświeżam…" but never the result

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/watchlist/PriceComparison.tsx:152
- **Detail**:
  - Phase 3's contract asks for "'Odświeżam…' in an aria-live region while its request runs, then the answer". The only live region is each row's span, which empties when the answer arrives.
  - The new price, the new order and mark, and the busy, stopped, failed and missing texts render outside any live region, as plain `<p>` without a role. A failed refresh sounds the same as a successful one.
  - The span also sits in a keyed `<li>` that React moves when the rows re-sort.
  - No note records the choice.
- **Fix**: Add one visually hidden `aria-live="polite"` region outside the sorted list. The reducer fills it on each answer: "Natura: 16,99 zł, najtaniej", or the `priceUnavailableText` / `priceMissingText`. Pin those texts in the reducer tests.
- **Decision**: FIXED: one hidden live region announces each shop's answer; the ended session stays with the page's alert

### F3 — Rossmann detail requests go out five at once, and a refused shop keeps reserving

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/price-refresh.ts:12
- **Detail**:
  - `ROSSMANN_AT_ONCE = 5`, the plan's number, sends detail requests in parallel with no spacing. The owner's list refresh sent five Rossmann requests within 25 ms (the gate's rows 36-41 at 13:52:14.347-.371).
  - The research note (§7) asks for about 1 request per second per host. A 403 stops Rossmann for everyone, while up to four more requests are already on their way.
  - After a busy, paused or stopped answer, every remaining target still reserves a slot that can only be refused.
  - Five Rossmann tasks plus Natura's batch fill a Worker's six simultaneous connections.
- **Fix**: Fetch Rossmann one at a time. Once a shop answers busy, paused or stopped, give its remaining targets that reason without reserving.
  - Strength: it follows the research note's politeness rule, and no further request can go out after a block. The change is local to `refreshPrices` and its tests.
  - Tradeoff: a large list refresh takes longer, about 0.15-0.25 s per Rossmann product (the research timings), so 20 products take about 3-5 s.
  - Confidence: HIGH — the burst is observed, and the timings are measured.
  - Blind spot: it changes the plan's "at most 5 at a time" contract, which needs a note.
- **Decision**: FIXED: Rossmann one at a time; after busy, paused or stopped the rest of that shop's targets get the same answer with no request, Natura's batches too

### F4 — latest_price_observations reads the whole deployment's history on every list view

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260928011450_price_observations.sql:144
- **Detail**:
  - Without keys, as on the list page and in the list refresh, the view scans every observation and applies RLS as a filter. `EXPLAIN ANALYZE` as `authenticated` read all 62 local rows for a user with 5 items.
  - Every check is kept, with no retention, so the main screen's read grows with everyone's history. The last-price lateral also walks the newer `missing` rows.
  - The plan's Performance note ("scans the rows the caller can see") is wrong.
  - It takes 0.7 ms today. Past the 2 s limit, the list would show "Nie udało się wczytać cen" and its refresh would stop.
- **Fix A ⭐ Recommended**: Defer it to S-04, which reads history anyway. Record a follow-up and correct the plan's Performance note now. S-04's migration drives the view from the caller's watched keys with `LIMIT 1` laterals and adds a partial index on price rows.
  - Strength: the S-03 migration is on production and frozen, so any change is a new migration, and S-04 has to design its history reads anyway.
  - Tradeoff: the main screen's read keeps growing until S-04 lands.
  - Confidence: MEDIUM — at a handful of users the growth is slow, but it's unmeasured past 62 rows.
  - Blind spot: if S-04 slips past the deadline, the view stays as it is.
- **Fix B**: A follow-up migration now, before the merge.
  - Strength: fixed while the design is fresh.
  - Tradeoff: another production push and review before the merge, for no gain a user sees today.
  - Confidence: MEDIUM — a view rewrite also needs the price check script extended.
  - Blind spot: how it fits S-04's history design.
- **Decision**: FIXED via Fix A: deferred to S-04, follow-up in follow-ups/review-fixes.md, plan performance note corrected

### F5 — The PRD note claims more privacy than the accepted risk allows

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/prd.md:164
- **Detail**:
  - The note says "no one can infer another user's watchlist from them".
  - Accepted risk 2 lets co-watchers see each other's check times, which can reveal that someone else watches the item.
  - CLAUDE.md's "no one can list what others watch" is accurate.
- **Fix**: Reword the note to CLAUDE.md's claim and name the accepted risk.
- **Decision**: FIXED: PRD note reworded to "no one can list what others watch", accepted risk named

### F6 — Accepted risk 1 reaches further than its wording

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260928011450_price_observations.sql:109
- **Detail**:
  - Watching is self-service: any Rossmann result through "Dodaj", or a `matched` `watchlist_matches` row with any SKU. So a fake price can go on any item.
  - A fake row also becomes the item's last check. For 15 minutes that stops co-watchers' automatic refresh and makes their list refresh skip the item. Only the product page's button corrects it.
  - The table bounds `price` below 100000, but not `regular_price` or `lowest_price_30d`.
- **Fix**: Add both points to the accepted-risk note for the revisit, and bound the two amounts in the next migration.
- **Decision**: FIXED: risk note widened in the plan and CLAUDE.md; the amount bounds queued in follow-ups/review-fixes.md

### F7 — A refresh stores its answers in one insert at the end

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/price-refresh.ts:46
- **Detail**:
  - `refreshPrices` records every check once the last shop answers. The client can disconnect first: a second tap on the list's plain form, or leaving mid-refresh.
  - If the invocation is then cancelled, answers already paid for from the shared cap may never be stored, and the second post refetches the same items.
  - Concurrent refreshes otherwise only duplicate rows.
- **Fix**: Store the checks through `waitUntil` (or per batch), and disable the list's button on submit.
- **Decision**: FIXED: each shop's checks stored as soon as that shop is done; the list's button is disabled on submit

### F8 — The routes' authorization has no automated test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/watchlist/prices.ts:28
- **Detail**:
  - The key property, that the shop item comes from the user's rows and never from the request, is untested.
  - Smoke covers the refusals and an unknown product. It doesn't cover a Natura refresh without a match (404), a `shopItemId` in the body being ignored, or a failed read (503 or `failed`).
  - No route in the repo has unit tests.
- **Fix**: Unit-test `shopItemFor` and `productTargets` with the stub client that `prices.test.ts` already has.
- **Decision**: FIXED: target logic moved to src/lib/services/price-targets.ts and unit-tested; the routes keep their behaviour

### F9 — The island's no-server-imports rule is enforced only by comments

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/price-comparison.ts:321
- **Detail**:
  - `price-comparison.ts` keeps a private copy of `prices.ts`'s `keyText` (`itemText`), because importing it would pull zod into the page. A well-meant dedupe would break the bundle, and nothing would catch it.
  - Two smaller duplications: `prices.ts` repeats `matches.ts`'s per-row parsing loop, and both pages carry identical `PRICE_NOTICES` texts.
- **Fix**: Move `keyText` into `price-comparison.ts` and import it from `prices.ts`. Add an ESLint `no-restricted-imports` override for the island's four modules.
- **Decision**: FIXED: one keyText in price-comparison.ts; ESLint refuses server-only and relative imports in the island's modules

### F10 — The session-ended rule was refined without a note

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/watchlist/price-comparison-state.ts:191
- **Detail**:
  - The contract says "a redirected or non-JSON answer means the session ended".
  - The island treats a non-JSON answer with an error status, such as a gateway's 5xx page, as a failed refetch instead. That's the better behaviour, but nothing records it.
- **Fix**: Add one line under "Phase 3, the island" in the Implementation Notes.
- **Decision**: FIXED: note added under "Phase 3, the island"
