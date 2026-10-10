<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: The database refuses an own-shop decision, and every decision saves at once

- **Plan**: context/changes/decision-store-backstop/plan.md
- **Scope**: Phases 1 to 3 of 4 (Phase 4, the ship, is the owner's and still open)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 8 observations

## Verdicts

| Dimension           | Verdict                            |
| ------------------- | ---------------------------------- |
| Plan Adherence      | PASS (2 observations)              |
| Scope Discipline    | PASS                               |
| Safety & Quality    | PASS (3 observations)              |
| Architecture        | PASS                               |
| Pattern Consistency | WARNING (2 observations)           |
| Success Criteria    | WARNING (1 warning, 1 observation) |

## Success Criteria

Run on `chore/close-decision-store-backstop`, which is `main` after the merge of PR #55 (783b214) plus the owner's counts (601123a):

- **Unit suite and static checks:** `npx vitest run`: 2,974 tests pass, and criterion 2.1's five files 348. `npm run lint` is clean, and `npx astro check` reports 0 errors and 0 warnings.
- **Greps and Prettier:** 2.4 prints nothing, 3.2 prints nothing, and 3.3 counts 4, 1 and 3. Prettier passes on 3.1's files.
- **CI:** `ci`, `smoke` and `e2e` passed on each phase's commit (41d9229, 2c09a46, f18182d) and on the merge (783b214).
  - `smoke` ran the new database checks: the own shop refused with 23001, user B answered like an id no one has, `record_decision`'s six steps and refusals, and the catalogue's self-test.
  - `npm run test:db` ran 14 cases, the two held-open removals answering `gone` among them.
- **The deploy:** Workers Builds failed on the merge, and so did the `Deploy check` workflow. #55 merged before the migration was pushed (F1). Production stays on the previous version until a retried build.
- **The deliberate breaks** (2.2, 2.11, 2.3) each turned their tests red, 12, 11 and 8 of them, and the restore was exact.
- **Phase 4:**
  - 4.3 to 4.6 rest on the owner's report: the deploy gate's check printed `All 9 migrations are applied`, and the counts were identical before and after the push.
  - 4.2, 4.7 and 4.8 are open.

Two reviewers traced every planned change against d67bd82.

- **No silent drift:** every adaptation is in the Implementation Notes, accurately.
- **The migration** is byte-identical from Phase 1 to its push. It lets a signed-in user do nothing new with a direct PostgREST call, and the trigger keeps another user's product invisible.
- **Gone, never decided:** "a removal never makes a save answer `decided`" holds under read committed in both cases.

## Findings

### F1 — #55 merged before the migration was pushed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/decision-store-backstop/plan.md (Phase 4, row 4.7); PR #55 (merge 783b214)
- **Detail**: Phase 4's order is push, confirm, then merge. #55 merged at 20:38 UTC on 2026-10-10, at f18182d, before the owner's `db push`.
  - The checked deploy refused, as designed. Workers Builds failed 38 s after the merge and the `Deploy check` workflow failed, so nothing deployed and production stays on the previous version. Phase 1's CI showed that version works against the new schema.
  - The owner then pushed and confirmed, and a retried build is pending.
  - The plan-only commit recording the counts (52f493f) missed the merge and rides in the close-out as 601123a.
  - The pull request was marked ready before the push, which invited the merge.
  - Row 4.7 can't be ticked as written.
- **Fix**: Record the order, the refused build and its retry in Phase 4's notes, and leave 4.7 unticked with that note. From now on, keep a migration's pull request in draft until the owner confirms the push.
- **Decision**: FIXED (Fix now): Phase 4's notes record the merge at f18182d before the push, the refused build and its retry; row 4.7 stays unticked; the runbook (`context/deployment/deploy-plan.md`, "Later migrations") keeps a migration's pull request in draft until the push is confirmed.

### F2 — Two database test titles claim a stale tab is refused

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/matches.db.test.ts:240-251; scripts/check-matches-db.mjs:534
- **Detail**: The tests at `:242` and `:251` are titled "…from a tab shown the automatic match of X, once another tab made X the user's", and their comment says only who decided tells the forms apart. Through the app it isn't so.
  - A form never carries the decider: the guardian adds the one it reads at post time (`replacedDecision`).
  - So a stale tab posting after another tab confirmed X is admitted over the user's match, and its pick of Y lands. Test plan §7 accepts that edge, and Phase 3's notes record it.
  - The tests pass `overMatch(X, "auto")` to the store directly, which proves only a change between the guardian's read and the save (F4). The check script's comment at `:534` has the same tab framing.
- **Fix**: Retitle both cases, and reword their comment and the check's, to "…once another tab makes X the user's between the guardian's read and the save".
- **Decision**: FIXED (Fix now): both cases are titled "…once another tab makes X the user's between the guardian's read and the save", and their comment, the check's (`check-matches-db.mjs`) and the store test's say what they prove.

### F3 — The overlap with no decision stored is proved by reasoning only

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/matches.db.test.ts:276-300
- **Detail**: CLAUDE.md, the migration and the plan say a save answers `gone` when a removal reaches the product while no decision is stored. Both held-removal cases have a decision stored: a re-pin over a match, and a retry over „not found”.
  - With none stored, the composite key's check waits on the deleted product and then refuses with 23503. Both reviewers traced this, but no test runs it.
  - `holdRemoval` sees that wait too, since the key's check blocks on the hold's lock.
- **Fix**: Add a third held case: a lookup's first outcome on a product with no decision answers `gone` while its removal is held, and the hold commits. CI only.
- **Decision**: FIXED (Fix now): `matches.db.test.ts` adds "answers a lookup's first outcome gone while the product's removal, held open, deletes the product", on a product with no decision. CI only.

### F4 — holdRemoval has no time limit of its own

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/e2e-local-db.mjs:171-226
- **Detail**: The 10-second deadline runs only after the delete returns. `execFile` gets no `timeout`, and the session sets no `lock_timeout`.
  - So a delete blocked by a developer's open local transaction would wait forever, and the psql inside the container would hold its locks.
  - Killing the docker client doesn't stop that psql. It can't happen in CI.
- **Fix**: Send `set lock_timeout = '5s'` before `begin`, and give `execFile` a `timeout` of `HOLD_SECONDS` plus 5 seconds.
- **Decision**: FIXED (Fix now): `holdRemoval` sets `lock_timeout = '5s'` before `begin`, and gives `execFile` a timeout of `HOLD_SECONDS` plus 5 seconds; its doc says so.

### F5 — The migration deletes before it creates its guard

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261010190000_decision_store_backstop.sql:12-14, :45-47
- **Detail**: The delete runs before the trigger exists. An own-shop insert committed between the two statements during the push, which only a crafted call could send, would have survived.
  - The owner's count after the push rules that out: 16 decisions and none in an own shop.
  - The file is frozen now.
- **Fix**: Record it in the plan's Migration Notes, and the rule for later migrations: create the guard first, then clean up what it refuses.
- **Decision**: FIXED (Fix now): the plan's Migration Notes record the window, ruled out by the owner's count, and the rule for later migrations.

### F6 — Six test comments say a direct write could store an own-shop decision

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/price-routes.test.ts:105, product-page.test.ts:187, shop-matching.test.ts:1659, price-comparison.test.ts:991, price-targets.test.ts:310, watchlist-rows.test.ts:1494
- **Detail**: Each fixture stores a decision in its product's own shop "as a direct write could store it". The trigger now refuses one for every caller.
  - The fixtures stay useful, since they pin the readers' narrowing, which still leaves out a shop switched off and any row stored before the migration.
  - Only their stated reason is false.
- **Fix**: Say such a row could be stored before S-02's migration, and the readers still leave it out.
- **Decision**: FIXED (Fix now): the six comments say "before S-02's migration".

### F7 — The lookups' test stub keeps a dead update

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/shop-matching.test.ts:1065, :1077, :1100-1103
- **Detail**: The stub's `update` and its doc's "an insert or an update" are left from the store's two statements. No production code calls `.update(` there any more; the insert stays, for the first price check.
- **Fix**: Drop `update` from the stub and its type, and "or an update" from its doc.
- **Decision**: FIXED (Fix now): the stub's `update`, its type and "or an update" are gone.

### F8 — Four document lines say more than the code does

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: CLAUDE.md:60; context/foundation/test-plan.md:407; context/foundation/roadmap.md (S-02's Risk); context/changes/decision-store-backstop/plan.md:144
- **Detail**:
  - **CLAUDE.md** says no API role may execute `refuse_own_shop_decision()`. The migration revokes it from PUBLIC, anon and authenticated, not `service_role`, though a trigger function can't be called directly anyway.
  - **The test plan's S-02 note** says the EAN shapes moved to Super-Pharm, but only the first row did; the other stays in Hebe.
  - **The roadmap's S-02 Risk** still expects about 17 direct inserts and the e2e seed to change. Two inserts moved, and the seed didn't change.
  - **The plan's Critical Implementation Details**, and the migration's frozen comment, say a removal makes the insert "start again". That holds only with a decision stored. With none, the key's check waits and refuses.
- **Fix**: Correct the CLAUDE.md, test plan and roadmap lines. Record the mechanism's correction in the plan's review notes, since the migration's comment stays as pushed.
- **Decision**: FIXED (Fix now): CLAUDE.md, the test plan and the roadmap's Risk are corrected, and the plan's review notes correct the mechanism; the migration's comment stays as pushed.

### F9 — The plan's notes miss two facts

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/decision-store-backstop/plan.md (Implementation Notes, Phases 2 and 4)
- **Detail**:
  - Phase 2 added typed column shapes (`ItemColumns`, `WrittenDecision`) and `saveArguments` in `matches.ts`. They make "all 16 keys, never `undefined`" a compile-time rule, and no note records them.
  - Phase 4's note records the gate's `All 9 migrations are applied`, which reads production's applied migrations. It doesn't say that what `db push` listed and what `migration list --linked` printed weren't reported.
- **Fix**: Add one line for each.
- **Decision**: FIXED (Fix now): Phase 2's and Phase 4's notes gain a line each.
