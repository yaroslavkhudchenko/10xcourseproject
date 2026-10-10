<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: A product's page looks shops up and shows decisions through the guardian

- **Plan**: context/changes/page-lookups-through-guardian/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension           | Verdict                  |
| ------------------- | ------------------------ |
| Plan Adherence      | PASS (1 observation)     |
| Scope Discipline    | PASS                     |
| Safety & Quality    | PASS (1 observation)     |
| Architecture        | PASS                     |
| Pattern Consistency | WARNING (2 observations) |
| Success Criteria    | PASS                     |

## Success Criteria

Run on `main` at 37fe649, the merge of PR #52, in the worktree `10xcourseproject-wt3`:

- `npx vitest run`: 380 files, 2,963 tests, all passed.
- `title-diff` against the base's 2,897 names (`node_modules/.cache/s03-base-names.txt`): prints nothing.
- `assertion-diff` over `f22fb02..54bce3e`: prints nothing.
- `npm run lint`: clean. `npx astro sync && npx astro check`: 0 errors, 0 warnings, 0 hints.
- `npm run build`: passes, with the 6 font files.
- 2.3 prints 0; 3.3 prints exactly the 5 planned calls; 3.4 prints 0; 3.5 prints nothing; 4.1 passes; 4.2 prints 1 and no removed line; 4.3 and 4.4 print every name.
- CI on `main` (37fe649): `ci`, `smoke` and `e2e` passed; Workers Builds and the `Deploy check` workflow passed.
- Manual: 2.8, 3.14, 3.15 and 4.9 carry their evidence in the Implementation Notes, and both reviewers re-checked them against the code. 3.16, the owner's phone check after the deploy, and 4.8, the owner's reading of the FR-007 note, are open. Both reviewers and this review read the note against `watchlist-rows.ts:191-202` and `:241-243`: an unread price counts, and a fresh price that can't be ordered online doesn't.

Two reviewers traced every planned change against `f22fb02`:

- Every contract item in Phases 1 to 4 holds.
- Every deviation is recorded in the Implementation Notes.
- The PRD note is byte-identical to the approved wording.
- No path asks a shop more than before, and none can overwrite a match or a decline or write in the product's own shop.
- Another user's product answers like a missing one on the page, through the decision route, the price route and the refresh.

## Findings

### F1 — A refused lookup is silent, after its searches ran

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shop-matching.ts:382-395
- **Detail**: `lookupOutcome` runs the shop's searches (`lookupInShop`, `:382`) and only then asks `admitLookup` (`:387`). A refusal stores nothing and logs nothing.
  - No refusal can happen today. The steps run only the loaded product's matched shops, and `decideMatchStep` looks a shop up only while it's undecided or retrying a „not found”, the rule `admitLookup` checks third. The plan keeps the rule in both places on purpose.
  - If the two ever drift, every view of such a product would spend that shop's requests and store nothing. It would show „Ten produkt ma już zapisaną decyzję.” with nothing in the logs.
- **Fix**: Log a refused lookup as one `shop-lookup` line naming the shop and the refusal, as `logStepFailure` (`:439-448`) logs a step that threw. The order stays, since the guardian judges what the lookup found.
- **Decision**: FIXED (Fix now): `lookupOutcome` logs a refused lookup as one `shop-lookup` line with the shop, `reason: "lookup refused"` and the refusal (`logRefusedLookup`, `shop-matching.ts`). No test reaches a refusal, since none can happen. A deliberate break, the guardian refusing every lookup, turned 14 tests in `shop-matching.test.ts` red and printed the line for Natura, Rossmann and Super-Pharm.

### F2 — The two admissions repeat their first two checks

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/watched-product.ts:141-148, :233-240
- **Detail**: `admitDecision` and `admitLookup` repeat the same eight lines. Each finds the shop among the priced shops, refuses `not-a-matched-shop` when the product has no standing there, and refuses `unreadable` when the standing is unreadable. The guardian is meant to be these rules' one home. A copy inside it can drift: a later change to one admission's matched-shop rule could miss the other.
- **Fix**: One private helper in `watched-product.ts` gives both admissions the shop's readable standing or the refusal. The guardian's tests stay unchanged and pin it.
- **Decision**: FIXED (Fix now): `readableStanding` holds both checks in their order, and both admissions start with it. The guardian's 70 tests pass unchanged. Skipping its unreadable check turned 6 red, and calling a missing standing unreadable turned 13 red.

### F3 — New tests copy the read-timeout fixture

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/matches.test.ts:1070, src/lib/services/product-page.test.ts:50 (beside the older src/lib/services/match-routes.test.ts:62)
- **Detail**: S-03 adds two more copies of `const TIMEOUT: StubRelation = { error: { code: "57014", … } }`, byte for byte the one `match-routes.test.ts:62` already had. That goes against the lesson the plan cited when it moved the gate harness into `testing/gate-world.ts` ("Define shared constants and helpers once"). Other tests write the same error inline with other messages.
- **Fix**: Export one `TIMEOUT` relation from `src/lib/services/testing/stub-supabase.ts` and import it in the three files. The inline ones stay.
- **Decision**: FIXED (Fix now): `TIMEOUT` is exported once from `src/lib/services/testing/stub-supabase.ts`, and `match-routes.test.ts`, `matches.test.ts` and `product-page.test.ts` import it. The inline errors with other messages stay, and the test plan's pattern 1 names it.

### F4 — Two lines of documentation lag the code

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/price-targets.ts:150, context/domain/glossary.md:35
- **Detail**:
  - `productTargets`' doc says the island asks each shop "(shopItemFor)". The island's route calls `priceTargetFor`, and `shopItemFor` has no caller outside the tests. Phase 4 corrected the same name in `matches.ts` and CLAUDE.md, but not here.
  - The glossary's "decision" row says decisions are "guarded by `admitDecision`". A lookup's outcome is now guarded by `admitLookup` too, so an agent reading only that row misses it. The notes left this row outside the contract.
  - The test plan's dated §6.6 note naming `runMatchSteps` with `shops` stays as history, as the plan decided.
- **Fix**: Name `priceTargetFor` at `price-targets.ts:150`. Make the glossary's decision row read "guarded by `admitDecision` and `admitLookup`".
- **Decision**: FIXED (Fix now): `productTargets`' doc names `priceTargetFor`, and the glossary's decision row reads "guarded by `admitDecision` and `admitLookup`".
