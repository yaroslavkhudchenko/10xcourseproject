<!-- PLAN-REVIEW-REPORT -->

# Plan Review: The database refuses an own-shop decision, and every decision saves at once (S-02)

- **Plan**: `context/changes/decision-store-backstop/plan.md`
- **Mode**: Deep
- **Date**: 2026-10-10
- **Verdict**: REVISE → SOUND after triage (all 6 findings fixed in the plan)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

- Read at the branch's head, 907f1b9, on `main` at bd0f2c6 (S-01 merged as PR #47). S-03's plan read from its branch at 602deed.
- 16 of 16 paths the plan changes exist; the migration is new.
- 9 of 10 symbols are found. `admitLookup` is S-03's and appears once S-03 merges, which criterion 1.2 checks.
- The line references hold: `src/lib/services/matches.ts:298-344`, `:47`, `:68-74`; `src/lib/services/match-routes.test.ts:102-108`; `src/lib/services/testing/stub-supabase.ts:180-197`, `:214-225`; `scripts/check-matches-db.mjs:343-354`; `scripts/check-prices-db.mjs:374-377`; `scripts/e2e-local-db.mjs:103-124`; `.github/workflows/ci.yml:44-48`, `:69-72`; `CLAUDE.md:39`, `:42`, `:44`, `:59`, `:60`; `context/foundation/test-plan.md:135-141`, `:150-157`, `:416`, `:417`, `:441`.
- Brief and plan agree. `docs/reference/contract-surfaces.md` doesn't exist, so that check is skipped.
- The unit suite passes at the head: 2897 tests (`npx vitest run`).
- The verification agent stopped early on a usage limit, so its questions were covered inline:
  - `recordDecision` and `recordLookup` each have one production caller, the route (`src/pages/api/watchlist/matches.ts:69`) and `lookupOutcome` (`src/lib/services/shop-matching.ts:385`), and `DecisionChange` is built only in `admitDecision`.
  - The write is seen by the stubs in `matches.test.ts`, `shop-matching.test.ts` and `match-routes.test.ts`, which the plan names. `price-pages.test.ts` and `price-routes.test.ts` store no decision; S-03's `product-page.test.ts` does (F1).
  - Only `record` reads a 23503 as `gone` and stamps `checked_at` with the Worker's clock (`src/lib/services/matches.ts:313`, `:324`), and only the store's tests fake that clock.
  - `scripts/e2e-local-db.mjs` exports only synchronous helpers over `execFileSync`, so `holdRemoval` is its first asynchronous one, and nothing there watches `pg_stat_activity` yet.
- Progress: one `## Progress` after `## References`, 4 phases and 30 rows, each matching its phase's criteria; no checkbox outside it.
- Where S-02 meets S-03, the plans agree: the lookup's write (`admitLookup`, then `recordLookup` with the admitted change's arguments), `DecisionChange` (S-03 leaves it to S-02), the decider (S-02's alone; a lookup replaces only none or a "not found", always `auto`), and `recordLookup` and `recordDecision` (S-03 keeps both). One test file of S-03's is missing from Phase 2 (F1).
- The SQL design holds against the code and PostgreSQL 17:
  - The trigger fires before RLS, the checks and the conflict check, and once per proposed row. WITH CHECK runs after BEFORE triggers, an ON CONFLICT insert checks the INSERT policy for every proposed row, and an existing row that fails UPDATE USING raises (PostgreSQL 17, CREATE POLICY).
  - The `set` list is exactly the 12-column update grant (`supabase/migrations/20260928011450_price_observations.sql:28-31`), a conflict can meet only the caller's own row (`watchlist_matches_one_per_shop` holds `user_id`), and the store sends `eans` as `[]` for a decline or a "not found", never `null` (`NO_ITEM`, `src/lib/services/matches.ts:229-239`).
  - Another user's product fails `watchlist_matches_own_product` exactly like an id no one has, by a direct insert and by `record_decision` alike. A definer `record_decision` would behave the same through the API, so the catalogue's security column is the right guard for it.
  - The concurrency claims hold: the conflict pre-check waits for a removal that is deleting the decision, a decision deleted while the save waits for its lock sends the save back to its insert, and the key's check then fails, so a removal never makes the save answer `decided` (with one wording gap, F4).
  - Every insert of a decision in the check scripts and the e2e seed lands in a matched shop, except the two the plan moves.

## Findings

### F1 — S-03's page tests store a lookup through the stand-in, and Phase 2 doesn't list them

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §5 (the tests); Testing Strategy, Unit Tests, "Unchanged"
- **Detail**:
  - S-03, which merges first, adds `src/lib/services/product-page.test.ts`, which runs `openProductPage` over `stubSupabase` with the real gate and replayed shop answers. Two of its cases store a lookup's outcome: "a retry that stored its outcome (`?retry=natura`, with Natura's recorded EAN hit accepted) comes back `retried`", and "a match the view's lookup has just stored (Natura undecided, its recorded EAN hit accepted) shows among the island's prices at once" (S-03's plan, Testing Strategy, Phase 3).
  - Today `record` inserts into the stand-in's `watchlist_matches` relation, which answers without an error, so both read `saved`. After Phase 2 the write is `rpc("record_decision")`, and `stubSupabase` answers an RPC it has no handler for with an error (`src/lib/services/testing/stub-supabase.ts:217-221`), which the store reads as `failed`. The retry then isn't `retried`, the match stores no first price, and both cases go red at criterion 2.5.
  - Phase 2 names five test files, and the Testing Strategy calls "the rest of the suite" unchanged. If S-03 moves `price-routes.test.ts`' `world` into `src/lib/services/testing/`, as its plan allows, that helper changes too.
- **Fix**: Add `product-page.test.ts`, and the shared `world` if S-03 moved it, to Phase 2 §5: a `record_decision` handler answering `saved`, with the lookup's call pinned as in the lookups' tests; and take it out of "Unchanged".
- **Decision**: FIXED in plan — `product-page.test.ts` joins Phase 2 §5 with a `record_decision` handler answering `saved` and its two storing cases pinning the call; criterion 2.1 runs it, and the Testing Strategy lists it

### F2 — Only the catalogue check proves the trigger reads as its caller

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2, the new section "no decision in a product's own shop" (user B); Desired End State, the direct-call table's second row
- **Detail**:
  - The trigger matches `user_id = new.user_id`. So B's insert in B's own name, like section 4's first insert (`scripts/check-matches-db.mjs:137-140`) and the plan's user-B cases, can never match A's product: it answers 23503 whether the trigger runs as invoker or as definer.
  - The one direct call that tells them apart is B's insert in A's name (`user_id: a.id`, as section 4 does in Hebe, `:145-148`) for A's product in its own shop. PostgreSQL enforces WITH CHECK after BEFORE triggers. An invoker trigger sees no product, and the insert policy answers 42501, as in any shop. A definer trigger finds A's product and raises 23001 first, which tells B the shop A picked the product in.
  - The direct-call table cites "`check-matches-db.mjs`, section 4 and new" for "the trigger sees only the caller's products", but no listed case reaches it, so only the catalogue's `prosecdef` row guards it, statically. The lesson "Check what a direct database call allows" asks for each refusal to be proved in the check script.
- **Fix**: Add to the new section B's insert in A's name for A's product in its own shop, answering 42501 as in Hebe, never 23001.
- **Decision**: FIXED in plan — the new own-shop section adds B's insert in A's name for A's product in its own shop, answering 42501, never 23001, and the direct-call table and the Testing Strategy say so

### F3 — Nothing would show the irreversible delete removing too much

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1, part 1; Phase 4, steps 2 to 4 and criterion 4.6; Migration Notes, "What it deletes"
- **Detail**:
  - CI starts an empty local stack (`.github/workflows/ci.yml:40-43`), so the delete never runs over a row before production, and once the trigger exists no check can store an own-shop decision for it to delete.
  - After the push, the only check is that the own-shop count returns no rows. A delete with a wrong join, up to every decision of every user, passes it too. Deleted decisions can't come back, and each affected product would be looked up again on its next view, spending shop requests.
- **Fix**: Have the owner's read-only count also give the number of all decisions before and after the push, and expect it to drop by exactly the own-shop count, counted when no one else is saving.
- **Decision**: FIXED in plan — Phase 4 also counts all decisions before and after the push and expects them fewer by exactly the own-shop count; criteria 4.3 and 4.6, the Testing Strategy, the Migration Notes and the brief follow

### F4 — A removal reads as gone only once it reaches the decision

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Desired End State (the table's fourth and fifth rows, and the paragraph after it); Critical Implementation Details, "Gone, never decided"; Phase 3 §1 (CLAUDE.md, "Data"); Phase 2 §4 (`held`)
- **Detail**:
  - A removal is one DELETE, whose cascade deletes the product's decisions at the end of that statement. Over a stored decision, the save's conflict path locks only the decision and runs no key check, since the key's columns don't change, so it never waits on the product.
  - So a save that locks the decision after the removal deleted the product, but before its cascade, answers what it would without the removal (`saved`, or `decided` for a decision other than the expected one), and the cascade then deletes the decision. The table says a removal that "reaches the product … first and commits" answers `gone`.
  - The promise that matters holds: a removal never causes `decided`.
  - The same window applies to the test's hold: `held` must resolve only once the delete statement, its cascade included, has finished. With several statements in one `psql -c`, the server takes them as one request (psql's documentation), so pg_stat_activity shows the whole script as the hold's query throughout.
- **Fix**: Say "reaches the decision first (or the product, when no decision is stored)" in the table, in Critical Implementation Details and in the CLAUDE.md sentence, and send the hold's statements as repeated `-c` options, or print a marker after the delete, so `held` resolves after the delete returns.
- **Decision**: FIXED in plan — the end state, Critical Implementation Details, the CLAUDE.md sentence and the brief say the decision first (or the product, when none is stored), and `held` waits for the delete through repeated `-c` options

### F5 — Two criteria can't pass as written

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 criterion 1.1; Phase 2 criterion 2.2 (Progress rows 1.1 and 2.2)
- **Detail**:
  - 1.1 counts the merges whose line names `page-lookups-through-guardian` and expects 1. A closing pull request for S-03 would count too, as `chore/close-add-from-other-shops` (#45) followed its change (#44), and the count would be 2.
  - 2.2 expects dropping the decider from the guardian's admitted change to turn the store's tests red. Those call `recordDecision` with their own `replaces`, so only the guardian's and the route's go red.
  - Progress titles can't change once the plan is reviewed, so both are fixed now or never.
- **Fix**: Match the branch exactly (`grep -c "/refactor/page-lookups-through-guardian$"`), and split 2.2 into two breaks: the guardian drops the decider (the guardian's and the route's tests red), and the store sends `null` for `p_replaces_decided_by` (the store's and the route's tests red).
- **Decision**: FIXED in plan — 1.1 matches `/refactor/page-lookups-through-guardian$`, and 2.2 is split into the guardian's break (2.2) and the store's (new row 2.11)

### F6 — An edit to the migration after Phase 1 isn't proved against the store still deployed

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details, "Timing & lifecycle"; Migration Notes, "The code still deployed"
- **Detail**:
  - Phase 1's commit is "the only commit on which today's `record` runs against the new schema", but the file freezes only at the owner's push in Phase 4.
  - If Phase 2 or 3 changes the trigger or the delete, for example after a CI failure, nothing runs the store still deployed against the final version. Production runs exactly that from the push until the deploy, and after a rollback of the Worker.
- **Fix**: Say that after Phase 1's green CI only `record_decision` may change, and that an edit to the trigger or the delete reruns Phase 1's proof (today's store over the edited migration), recorded in the Implementation Notes.
- **Decision**: FIXED in plan — after Phase 1's green CI only `record_decision` and comments may change; an edit to the trigger or the delete reruns Phase 1's proof through a draft pull request, recorded in the Implementation Notes

## Triage (2026-10-10)

Fixed in plan: F1, F2, F3, F4, F5 and F6 (6). Skipped, accepted or dismissed: none.

Verdict after fixes: SOUND. Progress has 31 rows: criterion 2.2 is split, and its second break takes the next free index, 2.11, placed after 2.2, with no row renumbered; rows 1.1, 2.1, 2.2, 4.3 and 4.6 carry their criteria's new wording.
