<!-- PLAN-REVIEW-REPORT -->

# Plan Review: A product's page looks shops up and shows decisions through the guardian (S-03)

- **Plan**: `context/changes/page-lookups-through-guardian/plan.md`
- **Mode**: Deep
- **Date**: 2026-10-10
- **Verdict**: SOUND, both findings fixed in the plan at triage (the owner's calls, 2026-10-10)
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

- 31 of 31 paths the plan names exist, and the two new files (`src/lib/services/product-page.ts` and its test) don't yet.
- 24 of 24 symbols are found, and about 40 line anchors were spot-checked, all right (`[id].astro:53-116`, `:223-238`; `match-step.ts:60-92`; `shop-matching.ts:312-416`; `matches.ts:298-344`, `:385-401`, `:480-489`; `price-targets.ts:80-170`; `match-step.test.ts:58-246`, `:232`, `:331`; `shop-matching.test.ts:1071-1104`, `:1161-1172`, `:1418`, `:1467`; `price-pages.test.ts:184-224`; `CLAUDE.md:58-60`; `prd.md:136`, `:138`; `glossary.md:42`; `test-plan.md:127`).
- Brief and plan agree, and Progress matches the phases: one `## Progress`, no checkbox above it, 39 of 39 rows equal to their success criteria.
- The source equals S-01's head with its review fixes (no change under `src/`, `scripts/` or `tests/` since `c1edc39`). At the base (`bd0f2c6`) the plan's own checks behave as it says: `npm run test` passes (2,897 tests), `npx vitest list` prints 1,320 lines, the `matchedShopsOf(` grep prints the 8 calls, the `eslint.config.js` grep 0, the PRD grep 0, and Prettier passes the three Markdown files.
- The verification sub-agent stopped at a usage limit before it reported, so its five questions were checked by hand, all confirmed:
  - The seam table's 16 cases (odd rows in Hebe and Rossmann, an unreadable `checked_at`, a decision and an odd row in the own shop, a failing `price_summaries`) give the same steps through `watchedProductOf` as through today's `decideMatchStep`.
  - Every `runMatchSteps` call in `shop-matching.test.ts` that passes `shops` names shops other than the product's own, in the priced shops' order, so `matchedShopsIn` runs the same shops in the same order.
  - `productTargets`' existing tests assert no query shapes and at most one unread shop, and none pins a product not on the list whose decisions can't be read.
  - No production caller, kitchen sink or island depends on the changed signatures beyond the files the phases list.
  - The route harness's move is F2.
- Owner's calls taken as decided, not reviewed: the test proof, decisions unread as a whole keeping each reader's answer, the loaded product's shape, the merge order with S-02, the D-01 wording, `itemInRows` keeping its reads, and price keys by `productPriceKeys` from the steps' items. The PRD note's wording matches the code's rule (`watchlist-rows.ts:186-216`, `:241-243`).

## Findings

### F1 — The title check can't see a table test's case go

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach, "The shared checks" (`title-diff`); Key Discoveries; every phase's "No existing assertion or test title moved"
- **Detail**:
  - `npx vitest list` prints a table test (`it.each`, `describe.each`) once, as its template (`… > $why`, `… (own navigation: %s)`), not once per row. At the base it prints 1,320 lines while `npm run test` runs 2,897 tests: `match-step.test.ts` lists 31 titles for 81 tests, `shop-matching.test.ts` 63 for 104, the seam table (`price-pages.test.ts`) 4 for 16, `match-routes.test.ts` 11 for 27 and `price-targets.test.ts` 42 for 71.
  - So a row dropped, merged or renamed in a table, a whole case gone, passes `title-diff`, such as a row of the `shop-matching.test.ts:1418` table, whose input type Phase 3 changes. The row's expected values (`views:`, `step:`, `location:` on the row's own lines) pass `assertion-diff` too: its grep sees a removed table only by the `])(` line of its title, never a removed row.
  - Key Discoveries' "a sorted comparison shows any title that changed or went" holds for plain `it(...)` titles only. Phases 1 and 2 add tests to five suites under "No existing line changes" with no manual read of their diff, so there these two checks are the whole proof the roadmap names: assertions unchanged, so nothing the user sees moved.
- **Fix**: Record the base's expanded names from a run instead of a listing (`npx vitest run --reporter=json --outputFile=…`, one sorted line per test with its file and `fullName`), compare each phase's run with `comm -23` as `title-diff` does so that a lost or renamed row shows, and correct the Key Discoveries sentence to match.
- **Decision**: FIXED in plan — `title-diff` now compares each test's file and full name from `npx vitest run --reporter=json` (`test_names`, recorded before Phase 1 and compared with `comm -23` in every phase), and Key Discoveries says why `vitest list` can't serve.

### F2 — Two edits in Phase 3's tests are left implicit

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, #5 Tests (`product-page.test.ts`, `price-pages.test.ts`)
- **Detail**:
  - The route harness: `product-page.test.ts` may move `world`, `served` and `reservations` from `price-routes.test.ts` into `src/lib/services/testing/`. `served()` and `bodiesSentTo()` take no argument: they read the module-level stubbed fetch that `world` sets, and they stand inside 16 and 2 expect lines. A move that hands that fetch over explicitly, the usual shape of a shared helper, rewrites those 18 lines, which `assertion-diff` then flags, and `price-routes.test.ts` isn't among Phase 3's files. `reservations(queries)`, in 15 expect lines, takes its input and moves unchanged.
  - The seam table's header (`price-pages.test.ts:15-18`) calls `productPricesOf` "the page's own call", which stops being true once the seam table runs `openProductPage`. Phase 4 corrects the same sentence only in the test plan (§6.2, `:127`).
- **Fix**: In Phase 3, list `price-routes.test.ts` among the files with the rule that a moved `served()` and `bodiesSentTo()` keep their calls byte for byte (the shared module keeps the stubbed fetch `world` sets), and name the seam table's header among the comments the phase rewrites.
- **Decision**: FIXED in plan — Phase 3's tests list `price-routes.test.ts` (only if its harness moves) with the rule that `served()` and `bodiesSentTo()` keep their argument-free calls, and the seam table's header and `productPage`'s doc comment are among the comments it rewrites.
