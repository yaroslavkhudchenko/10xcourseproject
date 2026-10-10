<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Decisions posted from a product's page pass one guardian

- **Plan**: context/changes/decision-route-guardian/plan.md
- **Scope**: Full plan. Phase 2's code is complete; its one open row, 2.10, is the owner's phone check after the deploy.
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**Evidence for the verdicts:**

- **Plan adherence.** Two review agents read every changed file against the plan and its Implementation Notes. Every planned change is a MATCH, and nothing from "What We're NOT Doing" crept in. Both Critical Implementation Details hold:
  - `gone` comes before any write, the same for another user's product and a missing id;
  - `recordDecision` gets the form's own `replaces`.
- **Success criteria.** Re-run on 2026-10-10:
  - the three scoped test files: 92 tests;
  - `npm run test`: 2,897;
  - `npm run lint`, `npx astro check` (0 errors), `npm run build` (6 fonts) and the Prettier check;
  - CI on PR #47 at `74db1eb`: `ci`, `smoke` and `e2e` all pass.

## Findings

### F1 — A page's own re-pin confirm can now answer "invalid"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/watched-product.ts:141-148 (`isLegalMove`), mapped at src/pages/api/watchlist/matches.ts:20
- **Detail**: The re-pin choice over an automatic match of X offers „To ten produkt” on X with `replaces=matched:X` (`src/lib/services/match-view.ts:341`). If the match becomes the user's own between showing that form and posting it, the second post meets the user's own match of X. That happens through a second tab, or a double tap without JavaScript, since `SubmitOnce` needs it. `namesDecision` passes, `isLegalMove` refuses, and the card says "Nie udało się zapisać wyboru: nieprawidłowe dane." Before S-01 the compare-and-swap answered `saved`. The new answer contradicts:
  - the plan's "every post the page's own forms send keeps its outcome";
  - the archived contract that a double submit ends as decided (`context/archive/2026-09-27-shop-matching-first-two-shops/reviews/impl-review.md:45`).

  Nothing wrong is stored. Both review agents found this independently.

- **Fix**: Answer a confirmation of X over the user's own match of X as `outdated-form`, which gives `decided=1` and "Ten produkt ma już zapisaną decyzję.", since a page posts it only from a form shown while X was automatic. Keep `illegal-move` for a decline over a decline, which no page posts, outdated or not. Then add the two-tab case to `watched-product.test.ts` and `match-routes.test.ts`.
- **Decision**: PENDING

### F2 — Shared test helpers still repeated in the route tests

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/match-routes.test.ts:54-62, :96-108
- **Detail**: The lesson "Define shared constants and helpers once" still has two exceptions in the route tests:
  - `NO_ITEM` repeats `NO_ITEM_COLUMNS` in `src/lib/services/matches.test.ts:68-78`;
  - `decisionRequest` repeats `refreshRequest` in `src/lib/services/price-routes.test.ts:168-174` (the same origin headers and form body), and `formOf` in `matches.test.ts:104-112`.
- **Fix**: Put a declined and not-found row builder in `src/lib/services/testing/stored-rows.ts`, and a `formPost(path, fields)` in `route-context.ts`, used by both route test files.
- **Decision**: PENDING

### F3 — The route doesn't pin what it hands the store

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/pages/api/watchlist/matches.ts:66-79; src/lib/services/match-routes.test.ts:12-14
- **Detail**: By reading, `recordDecision` gets the right arguments, the form's own `replaces` included. But no route test reaches `record`'s update, because `stubSupabase` answers per table and its insert never conflicts. So the `replaces` the route passes, and its mapping of the store's `decided`, `gone` and `failed`, are pinned only below the route, in `matches.test.ts` and `matches.db.test.ts`. The plan's Phase 2 notes record this.
- **Fix A ⭐ Recommended**: Accept for S-01, and pin both in S-02, where the write becomes one database function call that `stubSupabase` already records (`rpc`)
  - Strength: S-02 rewrites this write path anyway, so its route tests can assert the call's arguments without changing the stub's insert behaviour.
  - Tradeoff: The gap stays open until S-02 merges.
  - Confidence: HIGH — the stub already records `rpc` calls (src/lib/services/testing/stub-supabase.ts).
  - Blind spot: S-02's plan must carry this as a test case.
- **Fix B**: Give `stubSupabase` per-operation answers now (an insert that answers 23505, an update that answers rows or none), and pin `["eq","shop_item_id",X]` and the store's three outcomes in `match-routes.test.ts`
  - Strength: Closes the gap in S-01.
  - Tradeoff: Changes a shared test helper the price tests use, for a write path S-02 replaces.
  - Confidence: MEDIUM — the stub's chain is shared by two test files.
  - Blind spot: The stub's other callers.
- **Decision**: PENDING

### F4 — A race and direct calls still pass the guardian's rules

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/matches.ts:326-331
- **Detail**: Two paths still reach the store unchecked. Neither affects another user.
  - **A race.** The compare-and-swap checks the state and `shop_item_id`, not `decided_by`. So if an automatic match becomes the user's between the guardian's read and the write, a confirmation of the same item rewrites the user's own row with the same decision.
  - **Direct database calls.** These bypass every guardian rule. S-02 takes the own shop's backstop; the rest is the accepted risk that a direct call "changes only their own list" (`CLAUDE.md:60`).
- **Fix**: None in S-01. S-02's research lists what a direct call allows (the lesson "Check what a direct database call allows") and decides whether its write also checks `decided_by`.
- **Decision**: PENDING

### F5 — One reading rule, three copies and two precedences

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/services/watched-product.ts:75-82; src/lib/services/match-step.ts:61-64; src/lib/services/price-targets.ts:95-99, :159-163
- **Detail**:
  - "An unreadable shop first, then that shop's decision" now exists in three places: `standingFrom`, `decideMatchStep` and `itemInRows`.
  - The product and its decisions are read in three places with two precedences. In `loadWatchedProduct` and on the product page, a missing product wins (`gone`); in `productTargets`, any failed read wins (`failed`).
  - Privacy is unaffected: under RLS, another user's product and a missing id read alike in all three.
- **Fix**: None in S-01. S-03 routes the read side through `watchedProductOf` and `loadWatchedProduct`, with one precedence.
- **Decision**: PENDING

### F6 — A test title promises more than it checks

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/match-routes.test.ts:228-238
- **Detail**: The test says the two reads run "at once", but it checks only the order of the three queries, which sequential reads would give too.
- **Fix**: Retitle it to the order it checks (both reads before the write).
- **Decision**: PENDING

### F7 — Three documentation loose ends

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/roadmap.md:25; context/changes/decision-route-guardian/change.md (Notes); src/lib/services/matches.ts:68-73; plan.md Implementation Notes
- **Detail**:
  - M-2's intent in the roadmap and the change's notes still say "a stale form", where the glossary's term is "outdated form".
  - Phase 3's extras aren't in the Implementation Notes: the glossary's "outdated form" row, and in the roadmap, S-01's fourth refusal (an unreadable decision) and its status.
  - `decisionFieldsFor`'s comment (`matches.ts:68-73`) still says only that an own-shop decision is left out of every read, without naming the guardian that now refuses it.
- **Fix**: Reword both to "outdated form", add one Phase 3 Implementation Note, and point the comment to `admitDecision`.
- **Decision**: PENDING
