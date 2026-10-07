<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Know whether today's price is a good one (S-04, FR-012)

- **Plan**: context/changes/good-price-judgement/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

- **Scope:** `a748ec7`, `main` before #36, to `eb110f9`: 5 commits, 30 files, then the docs-only epilogue `e2ef533` (#37). Every changed file is in the plan or in an adaptation its Implementation Notes record, and no planned change is missing.
- **Automated criteria, re-run on 2026-10-07** on `main` at `eea9fcf`:
  - lint and `astro check` (0 errors);
  - 2316 unit tests;
  - the token contrast check;
  - the build with its 6 fonts.

  CI's `ci`, `smoke` and `e2e` passed on `dd21054`, `9946f57`, `eb110f9` and on the merge `822c69c`. `smoke` includes `check-prices-db.mjs`' history and bound cases, and `e2e` ran 11 tests, `good-price.spec.ts` included.

- **Manual criteria:** 2.3, 4.4 and 4.5 have evidence in the plan's Rollout notes:
  - 2.3: the push, confirmed by `migration list --linked` before the merge;
  - 4.4: the review, through the merge;
  - 4.5: the owner's check of a product in production.
- **Checked clean:**
  - **Privacy:** `price_summaries` is a `security_invoker` view over a `security_invoker` view. It reads `price_observations` under the caller's RLS and column grants, and never `recorded_by`. A non-watcher reads nothing, and anon gets 42501, both proved by the database check.
  - **Grants:** revoked from anon, authenticated and `service_role`, then `select` granted to authenticated only.
  - **Bounds:** the adapters already clamp both amounts the new bounds cover, so a refresh's insert can't start failing.
  - **Performance:** one per-item aggregate on the new partial index, for at most 4 items per page.
  - **Verdict gating:** only `cheapest` and `only` are judged.
  - **Parsing:** a strict history parse.
  - **Time zones:** a Warsaw window that is safe across clock changes.
  - **Conventions:** no server-only import in the island, and the migration follows the project's own.

## Findings

### F1 — A history judgement can rest on only some shops' history

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/price-comparison.ts:439
- **Detail**:
  - **How it happens:** `historyBaseline` drops every row whose `history` is `null`, which means "not read". That is a row whose stored check the page couldn't read, which its shop then answered (`historyRead`, price-comparison-state.ts:286). The other rows' 5 days still give the history basis.
  - **What the shopper sees:** „Dobra cena!” with "Najniższa cena w Twoich sklepach od 30 dni.", although one shop's 30 days, possibly lower, were never read.
  - **What it breaks:** the plan says "An unreadable row makes no judgement" (plan.md:76), and the lesson "Never read an unreadable answer as missing" applies.
  - **Tests pin it:** `disagreeing()` in price-comparison.test.ts gives a row the builder's default `history: null`, and price-comparison-state.test.ts:1149 expects the history sentence.
- **Fix**: Make `historyBaseline` return null when any row with a check has an unread history, so the shop basis applies. Move `historyUnread` into `price-comparison.ts` and share it. Change the test builders' default to an empty history (`{ low: null, days: [] }`), and flip the tests that expect a partial basis.
- **Decision**: FIXED — `judgementOf` doesn't judge by a history some row didn't read (`history: "unread"`), with tests

### F2 — A history-based „Dobra cena!” can sit beside the shop's own lower 30-day low

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/price-comparison.ts:423
- **Detail**:
  - **The rule:** once the history is enough, the price is compared with the history low alone, as the owner's rule and the PRD's "Business Logic" say.
  - **The contradiction:** a lower 30-day low the cheapest shop declares is then ignored. The same card's price track still draws that low, labelled "najniższa z 30 dni" (price-comparison-state.ts:555).
  - **Why the history misses it:** the app records a price only when someone opens or refreshes the product, so a sale on a day nobody looked is missing from the history.
  - **The result:** „Dobra cena!” and "Najniższa cena w Twoich sklepach od 30 dni." can contradict the low the shop itself declares. The sample page's `good-history` state shows it (src/dev/fixtures.ts:647).
- **Fix A ⭐ Recommended**: Once the history is enough, compare with the lower of the history low and the cheapest shop's declared low, and let the sentence name whichever was lower.
  - Strength: the sticker never contradicts a number on its own card, and both values are already on the rows.
  - Tradeoff: it changes the owner's rule of 2026-10-06 (the PRD's FR-012 update), and „Dobra cena!” shows less often.
  - Confidence: HIGH — both values are read today.
  - Blind spot: how often a shop's declared low is below the history in practice.
- **Fix B**: Keep the rule, and word it as what the app saw ("Najniższa cena, jaką widzieliśmy w Twoich sklepach od 30 dni."), with the track's tick labelled as the shop's.
  - Strength: the owner's rule stands as decided.
  - Tradeoff: the sticker can still disagree with the shop's declared low.
  - Confidence: MED — the wording helps only if it is read.
  - Blind spot: whether a shopper at the shelf reads the nuance.
- **Decision**: FIXED via Fix A — the lower of the history low and the declared low (the owner's call, 2026-10-07), with tests, the PRD and `CLAUDE.md`

### F3 — „Nie ma z czym porównać…” says the history is too short when none was read

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/watchlist/price-comparison-state.ts:709
- **Detail**:
  - **The gap:** the `none` sentence always ends with "a historia cen jest jeszcze za krótka.", and lacks the `historyUnread` check the shop-basis sentence has.
  - **How it shows:** after a failed price read, such as the page's database timeout, the island refetches and every row's history is unread. A product with months of history whose cheapest shop declares no low, as Rossmann does outside a sale, then claims its history is too short.
  - **What it breaks:** the plan says no sentence makes that claim for an unread history (plan.md:76).
  - **No test covers it:** no test has the `none` case with an unread history.
- **Fix**: When `historyUnread(rows)`, end the sentence after the shops' part ("Nie ma z czym porównać: Rossmann nie podaje najniższej ceny z 30 dni."), and add a reducer test with a failed read and no declared low.
- **Decision**: FIXED — the sentence drops the history clause for an unread history, with a reducer test

### F4 — One forged price now steers every co-watcher's judgement, and the accepted risk doesn't say so

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261006221608_price_history.sql:57
- **Detail**:
  - **The existing risk:** S-03 accepted that any watcher can insert a plausible price for an item through PostgREST.
  - **What S-04 adds, a low price:** a row with price 0.01 becomes the item's `history_low` from the next day for 30 days. The table is append-only, so only the owner can remove it. Every co-watcher whose history counts then sees „Zwykła cena” and "W ostatnich 30 dniach było taniej w Twoich sklepach: 0,01 zł".
  - **What S-04 adds, a high 30-day low:** a latest check with a 30-day low of 99999.99 stamps that shop's cheapest price „Dobra cena!” until the next check.
  - **The stale note:** CLAUDE.md's accepted-risk sentence still names only the delayed refresh. This is the lesson "Check what a direct database call allows".
- **Fix A ⭐ Recommended**: Record the judgement's exposure in CLAUDE.md's accepted risks and in the plan, to revisit with a server-only writer before more people are invited.
  - Strength: honest at no code cost, the way S-03 accepted its part of the risk.
  - Tradeoff: the risk stays.
  - Confidence: HIGH — documentation only.
  - Blind spot: none significant.
- **Fix B**: Also harden the view: count a history low only once two checks or two days show it.
  - Strength: a single forged row can no longer move the comparison.
  - Tradeoff: a new migration and your push before the merge, and a real one-day sale is ignored.
  - Confidence: MED — it interacts with the 5-day rule.
  - Blind spot: a forger can still insert two rows.
- **Decision**: FIXED via Fix A — recorded in `CLAUDE.md`'s accepted risks and the plan's notes

### F5 — "od 30 dni" leaves out today's earlier checks, and the window stays as the page read it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261006221608_price_history.sql:70
- **Detail**:
  - **Today's checks:** the history ends at the start of today, as the plan chose. So a lower price checked earlier today doesn't count, and "Najniższa cena w Twoich sklepach od 30 dni." can be false then.
  - **A page left open:** the island keeps the history it read, while the rule runs at the live time. On a page left open past Warsaw midnight, yesterday's checks don't count and the 30-day age moves on. A reload corrects it.
  - **How likely:** both need a lower price within one day, or a page left open overnight.
- **Fix**: Record both in the plan's notes as accepted edges.
- **Decision**: ACCEPTED — recorded in the plan's notes as accepted edges

### F6 — The history counts checks whose promotion had already ended

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261006221608_price_history.sql:68
- **Detail**:
  - **The page's rule:** a check whose `promo_ends_on` is before its own Warsaw date holds a price the shop no longer gives. The page treats it as out of date (`promotionEnded`, price-comparison.ts:150) and refetches it (`needsRefetch`).
  - **The view's filter:** it keeps only `status = 'price' and available`, so such a check can still become `history_low`.
  - **Who decides freshness:** `CLAUDE.md` says it is decided only in `price-comparison.ts`.
- **Fix**: Add `and (o.promo_ends_on is null or o.promo_ends_on >= (o.observed_at at time zone 'Europe/Warsaw')::date)` to the view in a new migration, which you push before its merge, with a database-check row for it.
- **Decision**: ACCEPTED — recorded in the plan's notes; leaving such checks out needs a new migration

### F7 — Nothing tests where the 30-day window starts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/check-prices-db.mjs:434
- **Detail**: Item H's checks are 1 to 3 days back, and the browser counts only the days the view returns. An off-by-one in `>= (today - 30)`, or the SQL literal drifting from `HISTORY_WINDOW_DAYS`, would pass every check.
- **Fix**: Backdate one check about 30 Warsaw days and one about 31 days, by hours as item H's are, and assert that only the first counts.
- **Decision**: FIXED — `check-prices-db.mjs` case 11

### F8 — The judgement is put together in the view, not in a tested state function

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/components/watchlist/PriceComparisonView.tsx:67
- **Detail**:
  - **Where it's built:** the view calls `judgementOf(verdict, rows, product.addedAt, verdict.at)` itself. The view is meant to only map.
  - **The copy:** the test helper `hintOfState` (price-comparison-state.test.ts:1065) repeats that call.
  - **The risk:** `heroOf` and `trackHint` each take a judgement that must match their verdict and rows.
  - **The lesson:** "Keep decision logic in tested services".
- **Fix**: Add `judgementOfState(state, addedAt)` beside `verdictOfState`, and use it in the view and the tests.
- **Decision**: FIXED — `judgementOfState`, used by the view and the tests

### F9 — The sample page's history default changed without a note

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/dev/fixtures.ts:148
- **Detail**: Phase 1's "Defaults" note says the sample builders set `history: null`. Phase 3 (`dd21054`) made `priced()` derive a history from its check (`historyOfCheck`: an orderable check from before today), and no note records it. It affects only the sample page.
- **Fix**: Add one line to the plan's Phase 3 notes.
- **Decision**: FIXED — a note in the plan's review fixes
