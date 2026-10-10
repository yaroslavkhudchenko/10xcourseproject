---
date: 2026-10-10T13:42:47+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 2fbd621afebdff1cf6696f460aba5e450b70b691
branch: docs/m4-course-lessons
repository: yaroslavkhudchenko/10xcourseproject
topic: "Refactor opportunities in the refresh flow: which problems the price-refresh flow analysis records are worth fixing, in what target shape and in what order"
tags:
  [
    research,
    codebase,
    refactor-opportunities,
    technical-debt,
    price-refresh,
    price-observations,
    shop-gate,
    shop-adapters,
    wire-contract,
    database-schema,
    sequencing,
  ]
status: complete
last_updated: 2026-10-10
last_updated_by: Claude (claude-opus-5-5)
---

# Research: refactor opportunities in the refresh flow (refactor-opportunities)

**Date**: 2026-10-10T13:42:47+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 2fbd621afebdff1cf6696f460aba5e450b70b691 (this change's `change.md` is committed there; this document isn't)
**Branch**: docs/m4-course-lessons
**Repository**: yaroslavkhudchenko/10xcourseproject

Method:

- **Inputs.** The flow analysis, `context/changes/price-refresh-flow-analysis/research.md` ("the analysis"), taken as gathered evidence: TD-01 to TD-27, its hand-kept pairs, seams and ripples, and its "Claim verification (ast-grep)". Its priors: `context/map/repo-map.md`, `context/domain/03-anti-corruption-layer.md` ("the ACL plan"), `context/domain/02-invariant-aggregate-refactor.md` ("the M-2 plan") and `context/foundation/roadmap.md`. The research of M-2's S-02 and S-03, read from their branches with `git show`.
- **Six sub-agent reports**, kept outside the repository. Each candidate was examined three times: its current shape, its history and intentionality, and its migration feasibility, in two groups (A: TD-01, 03, 04, 09, 12, 13, 15, 16; B: TD-05, 06, 07, 08, 11, 14, 17). Two of them read the analysis before its claim verification existed; where that section corrects them, it wins.
- **Re-checked here.** Every sub-report claim this document relies on was re-opened at its `file:line` at this commit. What didn't hold is in "Corrections to the sub-reports".
- **The code** under `src/`, `supabase/`, `scripts/` and `tests/` is byte-identical to 5eefce2, the analysis's commit (`git diff --stat 5eefce2 HEAD` over those paths is empty), so the analysis's anchors hold here.
- **Counts** by `git grep` and ast-grep 0.50, every zero confirmed with grep. Library facts come from the installed sources under `node_modules/` (`@supabase/supabase-js` and `@supabase/postgrest-js` 2.116.0), read, never run.
- **Nothing ran:** no shop, no Supabase, no server, no test, no install.
- **Labels:** **E** evidence, read at the cited lines; **I** inference; **U** unknown. Intentionality verdicts: **deliberate constraint** (a load-bearing decision), **accidental complexity**, or **unknown**; a candidate with parts of more than one names each part.
- **Words** follow `context/domain/glossary.md`. Short names follow the analysis: `prices.ts` is the service `src/lib/services/prices.ts`, `api/watchlist/prices.ts` the island's route, and `refresh.ts` the form route `src/pages/api/watchlist/refresh.ts`.

## Research Question

The course's prompt (module 4, lesson 4), adapted: the analysis documents technical debt and structural risk in the refresh flow and deliberately leaves open which of those problems are worth fixing, in what target shape and in what order (`context/changes/refactor-opportunities/change.md:12-16`).

- List every problem the analysis records, whatever its label, and classify it. A **candidate** is a problem whose fix would change the code's structure. A missing test, a gap in the documentation or a defect isn't a candidate; it is an input to the feasibility and cost judgement.
- For each candidate: its current shape with evidence, its intentionality, and its feasibility. Where the real fix is a redesign of business concepts, say so and stop.
- Close with the 2–3 strongest opportunities, ranked, and the candidates considered and rejected. Account for sequencing with M-2's S-02 and S-03 and with the ACL plan, whose Phases 3 and 4 wait for them.
- Nothing is decided here. The ranking is a proposal for a separate planning session.

## Summary

- **Classification (audited, kept).** The analysis numbers 27 problems.
  - 15 are candidates: TD-01, 03, 04, 05, 06, 07, 08, 09, 11, 12, 13, 14, 15, 16 and 17.
  - 12 aren't: 2 defects (TD-02, TD-10), 8 test gaps (TD-18 to TD-25) and 2 test duplications (TD-26, TD-27).
  - The audit keeps the coordinating agent's split, with three notes: TD-08 is half a defect (the `network` label); TD-11 has no structural debt today (its rule has one definition, and its open point is a policy); TD-13's structural fix is blocked by deliberate boundaries. The analysis's unnumbered route-path pair joins TD-14.
- **Stopped at a business concept.** TD-05 (M-2's S-03 plans it as a loaded watched product's price keys), TD-04's TypeScript half (the same derivation), TD-07's user-facing half (telling kinds of unread apart needs terms the glossary lacks and the owner's wording) and TD-11 (a server-side floor for a refresh is a business rule for the request cap).
- **Ranked opportunities:**
  1. **TD-03, starting with TD-18.** First the app's own insert and both reads run against the local database in CI, then a generated schema type checks the client's names. It answers the analysis's highest-risk chain (TD-03, then TD-18, then TD-02). The first step is one test file and can start now; the typing waits for the ACL plan's order.
  2. **TD-12.** One wire contract for `/api/watchlist/prices`: the reasons in one list both sides import, the request typed, a test across the wire. 2–4 files; it starts once S-01 merges.
  3. **TD-06.** One stop-asking loop with the counting rule as a parameter, so the owner's Fix A for Rossmann stays. 2 source files; nothing planned touches them.
- **Considered and rejected for now:** TD-01, 04, 05, 07, 08, 09, 11, 13, 14, 15, 16 and 17, each with its reason at the end. The nearest to promotion is TD-15, whose cost is unknown until a read-only measurement.
- **Sequencing.** TD-03's first step and TD-06 can start now; TD-12 after S-01 merges. TD-03's typing costs fewest files inside ACL Phase 4, and typed before S-02 it would check `record_decision`'s call; the ACL plan's Open questions 1 and 5 hold that order with the owner. TD-01, TD-05 and TD-17's `shopItemFor` ride on S-03; TD-09 is already ACL Phase 4.
- **Corrections.** One island refetch's bounded time is about 11 s, not the 13, 15 or 16 s three sub-reports added up. The analysis's Open Question 1 is answered by the installed SDK: a timeout or network failure comes back as `{ error }`, not as a throw (details in "Corrections to the sub-reports").

## Problems the analysis records, classified

The 27 numbered items (`context/changes/price-refresh-flow-analysis/research.md:431-632`):

| #     | Problem, as the analysis titles it                                                          | Its kind there             | Classification                                | Why                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| TD-01 | one write function, two callers with different failure contracts                            | structure                  | candidate                                     | the fix changes what the lookup's step carries back from the write                                                                            |
| TD-02 | the island drops `saved`, so a check that wasn't stored shows as fresh and stored           | contract, observability    | not a candidate: defect                       | its fix is a behaviour whose wording is the owner's (the analysis's Open Question 5); it sits on TD-12's contract                             |
| TD-03 | the database schema has no compiler                                                         | contract                   | candidate                                     | the fix types the client and every data-access call                                                                                           |
| TD-04 | one insert per shop, so one refused row loses the shop's checks; the watcher rule twice     | contract                   | candidate                                     | the fix changes the write's granularity; its TypeScript half is TD-05's                                                                       |
| TD-05 | the product's item in a shop is derived two ways                                            | duplication                | candidate; stopped at a business concept      | its fix is M-2's loaded watched product (S-03)                                                                                                |
| TD-06 | the stop-asking loop is written twice                                                       | duplication                | candidate                                     | the fix merges two loops                                                                                                                      |
| TD-07 | the reasons flatten layer by layer                                                          | observability              | candidate; its user-facing half stopped       | a new reason fans out through 11 modules, but which causes the user tells apart is a business concept                                         |
| TD-08 | the time limits stack without one budget; a shop that times out is logged as `network`      | observability              | candidate (the budget); the label is a defect | declaring the limits once is structural; the label is a fix inside the gate                                                                   |
| TD-09 | the database plumbing repeats, with diverging log rules                                     | duplication, observability | candidate                                     | the fix is one shared helper and one limit                                                                                                    |
| TD-10 | nothing catches a fetcher that throws                                                       | contract                   | not a candidate: defect                       | the fix is one per-shop catch, as the match steps have (`src/lib/services/shop-matching.ts:318-328`)                                          |
| TD-11 | the 15-minute rule lives only in the callers                                                | contract                   | candidate; stopped at a business rule         | the rule already has one definition; a server floor is a policy for the request cap                                                           |
| TD-12 | the JSON route's wire contract is restated by hand                                          | contract, duplication      | candidate                                     | the fix shares the contract's pieces between the route and the island                                                                         |
| TD-13 | the offer is mapped by hand in five layers                                                  | duplication                | candidate                                     | the fix would merge layers; deliberate boundaries block that (below)                                                                          |
| TD-14 | `price-refresh.ts` also carries the form route's URL contract                               | structure                  | candidate                                     | the fix moves the codes and their parser to another module                                                                                    |
| TD-15 | every list view, product view and list refresh reads the latest view over the whole table   | structure                  | candidate                                     | the fix rewrites a view                                                                                                                       |
| TD-16 | constants mirrored in comments, texts, SQL and a test harness                               | duplication                | candidate                                     | the fix derives the copies from one definition                                                                                                |
| TD-17 | two test-only exports on the path                                                           | structure                  | candidate                                     | the fix removes two public entries                                                                                                            |
| TD-18 | the write never runs against a database                                                     | test gap                   | not a candidate: test gap                     | the first step of TD-03 (ranked 1), and the place to settle TD-04's open question                                                             |
| TD-19 | the browser sees only the `stopped` answer; the row tag and the alerts never render         | test gap                   | not a candidate: test gap                     | no refetch outcome but `stopped` reaches a browser, so TD-07's and TD-08's outcomes, and any island change, have no browser proof             |
| TD-20 | the cap's 60-second window and a pause's end are unproved in SQL                            | test gap                   | not a candidate: test gap                     | bears on the gate's SQL, outside every candidate's target                                                                                     |
| TD-21 | the guards that keep a page view from spending the request cap are proved only as functions | test gap                   | not a candidate: test gap                     | TD-11's ground                                                                                                                                |
| TD-22 | the list's „Odśwież ceny” never runs in a browser                                           | test gap                   | not a candidate: test gap                     | inside TD-14's blast radius (the form's codes)                                                                                                |
| TD-23 | an old tab after a re-pin keeps its marks, and no test pins them                            | test gap; intent unknown   | not a candidate: test gap                     | sits on TD-12's `changed` path                                                                                                                |
| TD-24 | holes in the routes' contract tests                                                         | test gap                   | not a candidate: test gap                     | TD-12's contract test would cover its `missing` answer and `checkedAt`                                                                        |
| TD-25 | a failed page price read refetches every shop, and nothing counts it                        | test gap                   | not a candidate: test gap                     | a cost against the request cap, not a structure                                                                                               |
| TD-26 | shop requests, rows and offers spelled out in many test files                               | duplication (tests)        | not a candidate: test duplication             | the rules require tests to pin URLs and bodies (`CLAUDE.md:21`); it raises the cost of TD-13 and TD-16                                        |
| TD-27 | hand-rolled Supabase stand-ins beside the shared stub                                       | test gap, duplication      | not a candidate: test duplication             | the ACL plan's Phase 3 replaces them with an in-memory backend (`context/domain/03-anti-corruption-layer.md:934-943`); it raises TD-03's cost |

What else the analysis records, and what carries it:

| Recorded at                                  | Problem                                                                                                                                                                    | Carried by                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Hand-kept pairs (`research.md:650-664`)      | `SHOP_IDS` ↔ the shops' seed and foreign key; `GateOutcome` ↔ the RPCs' JSON; the insert grant ↔ `ObservationRow`                                                          | TD-03                                                                                                                        |
|                                              | `ShopOffer`, `PriceCheck`, `LatestPrice`, `PriceHistory` and `LATEST_COLUMNS` ↔ the columns and views                                                                      | TD-13 (TD-03 for the compile-time half)                                                                                      |
|                                              | `PRICE_LIMITS.max`, `shopItemIdSchema` and the time constants ↔ their copies                                                                                               | TD-16                                                                                                                        |
|                                              | `SHOP_HOSTS` ↔ the adapters' URLs                                                                                                                                          | TD-10 (the uncaught `TypeError`)                                                                                             |
|                                              | the watcher rule in TypeScript ↔ the RLS policies                                                                                                                          | TD-04 (its TypeScript half TD-05)                                                                                            |
|                                              | `SearchUnavailableReason` ↔ the island's `REASONS`                                                                                                                         | TD-12                                                                                                                        |
|                                              | `PRICES_ROUTE` and `REFRESH_FORM_ROUTE` ↔ the literal in `ListHead.astro:63` and the middleware's prefix                                                                   | no number; **joins TD-14**, the form route's URL contract (structural, a candidate with TD-14)                               |
| Ripples (`research.md:681-691`)              | 1 the offer's shape; 2 the wire; 3 shop identity; 4 the gate's SQL contract; 5 the history window; 6 route literals; 7 pinned requests in tests; 8 the watcher rule; 9 M-2 | 1 → TD-13, TD-26; 2 → TD-12; 3, 4 → TD-03; 5 → TD-16; 6 → the route-path pair, TD-26; 7 → TD-26; 8 → TD-04; 9 → TD-05, TD-17 |
| Test gaps ranked, item 9 (`research.md:644`) | the gate's shop path never runs on workerd in CI (`context/foundation/test-plan.md:296`)                                                                                   | no number; not a candidate: a test gap                                                                                       |
| Open Questions (`research.md:807-814`)       | six unknowns                                                                                                                                                               | inputs: Question 1 is answered here, Question 2 half (below)                                                                 |

**The audit.** Each classification above follows the course's rule: would the fix change the code's structure?

- **Kept as candidates with a note:**
  - TD-08: its budget half is structural, its label half a defect.
  - TD-11: kept because a server-side floor would move a rule into the route, but the per-candidate judgement finds no structural debt (below).
  - TD-13: a candidate in kind, but its adequate target keeps the layers (below).
- **Kept as non-candidates:**
  - TD-02 and TD-10 are defects.
  - TD-26 and TD-27 are duplications in tests: the first is partly required by rule, and the second is already the ACL plan's Phase 3.
- No item moved between the two groups.

## Detailed Findings

### What every candidate stands next to

- **M-2 (E).**
  - S-01 sits on `refactor/decision-route-guardian`, 6 commits ahead of `origin/main` and not merged (`git rev-list --count`; `git merge-base --is-ancestor`). Its code diff touches `src/lib/services/matches.ts`, the decision route and `src/lib/services/price-routes.test.ts`, whose context helpers move into `src/lib/services/testing/route-context.ts` and `stored-rows.ts`, and it adds `src/lib/services/watched-product.ts` (`git diff --stat origin/main...refactor/decision-route-guardian`).
  - S-02 and S-03 are proposed (`context/foundation/roadmap.md:58-59`), with research only, on their branches.
  - S-02 replaces `record`'s two statements with `rpc("record_decision", …)` (`context/domain/02-invariant-aggregate-refactor.md:208-223`).
  - S-03 moves the page's steps, `lookupOutcome`, `productPricesOf` and the price-key derivations onto one loaded product (`02-invariant-aggregate-refactor.md:259-265`, `:278`).
- **The ACL plan (E).**
  - Its Phases 1 and 2 can go at any time. Phases 3 and 4 rewrite the use cases' signatures and the persistence of `watchlist.ts`, `matches.ts` and `prices.ts`, by default after S-03 merges (Open question 1, `03-anti-corruption-layer.md:1077`).
  - It leaves generated database types out (`:1072`; Open question 5, `:1081`) and asks the owner which database log line to keep (Open question 2, `:1078`).
- **Owner gates (E).** A migration reaches production only by the owner's push before its pull request merges, and the checked deploy refuses code whose migration production lacks (`CLAUDE.md:60`). A new shop recording is a live request recorded once by hand (`CLAUDE.md:38`).
- **CI (E).**
  - A new `src/**/*.db.test.ts` joins `npm run test:db` with no workflow edit (`vitest.db.config.ts:12`; `.github/workflows/ci.yml:69-72`).
  - e2e runs with every shop stopped (`context/foundation/test-plan.md:175`).

### The candidates

#### TD-01: one write function, two callers with different failure contracts

- **Current shape (E):**
  - `recordPriceChecks` maps each check to a row, sends one insert and logs a failure by its code (`src/lib/services/prices.ts:81-98`; the insert `:92`, the log `:94`).
  - Its first caller, the refresh: `stored` calls it once per shop (`src/lib/services/price-refresh.ts:84-92`). Its result reaches the island as `saved` (`src/pages/api/watchlist/prices.ts:74`) and the form as `partial` (`price-refresh.ts:148`).
  - Its second caller, the lookup: once an accepted candidate's decision is saved, it stores the candidate's offer as the shop item's first price observation and drops the result: "A failed insert is logged, and the island then asks." (`src/lib/services/shop-matching.ts:387-393`).
  - That write sits inside the step's `try` (`shop-matching.ts:321-327`). But postgrest-js turns a failed or aborted request into `{ error }` with `status: 0` unless `throwOnError` is set (`node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:292-358`), and nothing in `src/` sets it (grep). So a failure of this write doesn't reach the catch (I).
- **The lookup's fallback holds (I, from E):**
  - A lookup runs only on own navigation, and a page view with a lookup has no re-pin: a page opened to re-pin one shop gives every other undecided shop only its button (`src/lib/services/match-step.ts:60-78`). So `autoRefreshOf` is true on that view (`:90-92`).
  - An unstored first price leaves no row, and `needsRefetch(null)` is true (`src/lib/services/price-comparison.ts:121-124`). The island asks that shop again: one more request under the request cap.
- **Intentionality: deliberate constraint, with an unweighed consequence.**
  - S-03 designed the shared write to save a shop request (`context/archive/2026-09-28-cheapest-shop-today/plan.md:536`). One success criterion was "an automatic Natura match shows its price with no extra Natura request" (`:572`).
  - The failure contract came as a code comment with the call, in 61d1e5b (2026-09-29).
  - Three later changes kept the write: S-05 (`context/archive/2026-10-02-hebe-in-comparison/plan.md:526`), add-from-other-shops (`context/archive/2026-10-06-add-from-other-shops/plan.md:606`) and match-by-name (`context/archive/2026-10-06-match-by-name/plan.md:30`).
  - No archived plan or review, and neither domain plan, weighs the two contracts against each other (the group A history report's search); the domain map and the M-2 plan only record the second write (`domain-distillation.md:274`; `02-invariant-aggregate-refactor.md:92`).
- **Feasibility:**
  - Target shape: every caller of the one write keeps its result and reports a failure the same way, and the lookup's fallback becomes a tested property instead of a comment.
  - First step: a lookup test whose price insert fails after an accepted lookup. Today the lookup tests fail only `watchlist_matches` (`src/lib/services/shop-matching.test.ts:1296`, `:1318-1323`), the analysis's claim 45.
  - Cost: `shop-matching.ts` and its test, 2–3 files. No migration, no recordings.
  - Sequencing: S-03 rewires `lookupOutcome` to `lookUp`, then `saveDecision` (`02-invariant-aggregate-refactor.md:262`), and the M-2 plan names the first price only as today's second write (`:92`). So the contract change belongs in S-03's plan.
  - Storing a decision and its first price as one atomic write would change what a decision carries. The domain map records the two writes as the code's rule (`context/domain/domain-distillation.md:274`), so that variant is the owner's business call and stops here.

#### TD-03: the database schema has no compiler

- **Current shape (E):**
  - The client is built without a schema type (`src/lib/supabase.ts:13`), so the SDK's `Database` parameter defaults to `any` (`node_modules/@supabase/supabase-js/src/SupabaseClient.ts:46-47`). `App.Locals.supabase` is the bare `SupabaseClient` (`src/env.d.ts:5`).
  - 20 exported service functions in 7 files take that client (ast-grep), as the ACL plan counts (`03-anti-corruption-layer.md:127`).
  - Its 10 queries and 2 RPC calls, in `watchlist.ts`, `matches.ts`, `prices.ts` and `shop-gate.ts`, name tables, views, columns and RPC arguments as strings (the analysis's TD-03; `src/lib/services/shop-gate.ts:183`, `:193-197`). Rows come back through hand-kept zod schemas (for example `prices.ts:122-151`).
- **What checks the schema today (E):**
  - CI's catalogue check holds the set of 7 relations and 3 functions, and each one's protection, to a reviewed list, but not their columns (`scripts/check-catalog-db.mjs:27-41`; `.github/workflows/ci.yml:65-68`).
  - The database checks insert their own copy of the app's row (`scripts/check-prices-db.mjs:120-142`).
  - The one database-backed unit test covers decisions (`src/lib/services/matches.db.test.ts`).
  - The unit stub lets an insert into any relation given rows succeed, whatever its columns (`src/lib/services/testing/stub-supabase.ts:148-151`).
- **I:** a renamed column, or a ninth column outside the 8-column insert grant (`supabase/migrations/20260928011450_price_observations.sql:137-138`), first fails in production. Every insert of that shop is refused; that reads as `failed` and `partial`, and the island hides it (TD-02).
- **Intentionality: accidental complexity, inherited.**
  - The starter's client was untyped before the app had a table (`git show b6b09c1:src/lib/supabase.ts`).
  - No archived plan, review or commit weighs generated types. A search of `context/archive` finds one mention, a test's workaround for a client "without a Database type" (`context/archive/2026-10-07-testing-route-and-database-seams/plan.md:597`), and nothing outside `context/` and `docs/` runs `supabase gen types` (`git grep`).
  - The zod row schemas beside it are deliberate (lesson "Never read an unreadable answer as missing", `context/foundation/lessons.md:19-24`), but they guard another drift: a production schema ahead of the deployed code (I).
  - The question is open with the owner since the ACL plan, whose default leaves generated types out of that refactor (`03-anti-corruption-layer.md:1072`, `:1081`).
- **Feasibility:**
  - Target shape: the app's own write and both reads run against the local stack in CI, and a generated schema type, which CI keeps equal to the migrations, types the client, so a name the migrations don't have fails `astro check`.
  - Step 1 (TD-18): a database test beside `matches.db.test.ts` that imports the real `recordPriceChecks`, `readLatestPrices` and `listLatestPrices`. One file, no workflow edit, no production change. The test plan's rule for such tests: "Import the real service function, never a hand copy of its query, which drifts." (`context/foundation/test-plan.md:138`).
  - Step 2: generate the type, then type the factory, `App.Locals` and the 4 data-access modules. After ACL Phase 4, only `src/lib/supabase/` would hold the client (I).
  - U: the typing's churn.
    - A typed `.from()` accepts only the schema's table and view names (`SupabaseClient.ts:433-439`), so `LatestView.name`, a `string` (`prices.ts:153-157`), would need the two view names (I).
    - The database test already casts an untyped `createClient` to the services' `SupabaseClient` (`matches.db.test.ts:68-71`).
    - CI's smoke job starts the stack without `postgres-meta` (`ci.yml:42`); whether `supabase gen types` needs it wasn't checked.
  - Collisions: none for step 1. Step 2 touches the signatures ACL Phase 3 rewrites, and the `record` that S-02 replaces with an RPC whose call no type checks today (S-02's research, `context/changes/decision-store-backstop/research.md:214` on its branch).

#### TD-04: one insert per shop, so one refused row loses the shop's checks; the watcher rule is written twice

- **Current shape (E):**
  - (a) Each shop's checks go into one insert (`price-refresh.ts:84-92`; `prices.ts:92`). postgrest-js sends it as one POST, the rows as its body (`node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts:1122-1138`).
  - Only the list refresh puts more than one row of a shop into one insert:
    - the island's route asks one shop item (`api/watchlist/prices.ts:61-71`);
    - the product's form, one per shop (`src/lib/services/price-targets.ts:150-170`);
    - the lookup stores one row (`shop-matching.ts:392`);
    - `listTargets` hands every due shop item of the list to the refresh (`price-targets.ts:124-138`).
  - (b) The watcher rule has two homes and four copies. The select and insert policies share one predicate (`price_observations.sql:89-107`, `:109-127`). TypeScript derives the items twice: `productPriceKeys` (`price-comparison.ts:593-611`) and `itemInRows` (`price-targets.ts:80-101`).
- **I:**
  - The TypeScript rule is a subset of the SQL one. Both derivations leave out a decision stored in the product's own shop (`price-comparison.ts:603`; `price-targets.ts:92-94`), while the policies admit any `matched` decision of the user.
  - So a refused row comes from a race: a decline, re-pin or removal in another tab between the targets' read and the insert. In a list refresh that window spans all of a shop's requests, and Rossmann's go one product at a time.
  - If PostgREST applies the array as one statement (U, not run here), one refused row costs the shop's whole insert: `failed`, then `partial`, logged by code (`prices.ts:94`).
  - A lost check keeps the last price with its age, so no guardrail breaks.
- **Intentionality: deliberate constraint on both halves; no archived document discusses the race (the group A history report).**
  - S-03 chose one insert: "All `price` and `missing` checks are recorded with one `recordPriceChecks` call." (`…cheapest-shop-today/plan.md:355`). Its review's F7 split it per shop (`…cheapest-shop-today/reviews/impl-review.md:144`), one of the fixes "the owner chose" (`plan.md:878`).
  - `storableOffer`'s header knows that one bad offer fails the insert (`src/lib/services/shops/shop-offer.ts:4-5`). Nothing does the same for a row RLS refuses.
  - The SQL home is a project rule: "Enforce this with RLS policies, not only with query filters" (`CLAUDE.md:18`). The TypeScript home is the trust boundary: the routes fetch only what the user's rows name (`price-targets.ts:18-21`).
- **Feasibility:**
  - (a) Target shape: a shop item the refresh may no longer store costs only its own row, and is reported.
    - App side: `stored` stores row by row or in small groups. 4–5 files, and up to one 2 s call per row on a form post (I).
    - SQL side: a function that stores row by row. A migration, the owner's push, and an entry in the catalogue check's list.
  - First step: a database test case that inserts one watched and one unwatched shop item through the real `recordPriceChecks`. It settles the analysis's Open Question 2 on the local stack, and it fits in TD-03's first test file.
  - (b) The SQL copy stays by rule. The TypeScript half is TD-05's and goes with S-03 (`02-invariant-aggregate-refactor.md:278`); it stops there.
  - Collisions: (a) edits the lines ACL Phases 3 and 4 rewrite (`refreshPrices`' signature, `prices.ts`' persistence).

#### TD-05: the product's item in a shop is derived two ways

- **Current shape (E):**
  - One pure rule, `productPriceKeys` (`price-comparison.ts:593-611`), has 3 production callers, each feeding it decisions of another shape:
    - the page, through `productPricesOf` (`prices.ts:312-325`, the call `:318`);
    - the product's form (`price-targets.ts:167`);
    - the list and its refresh, through `listPricedItems` (`price-comparison.ts:620-643`, the call `:638`).
  - One async per-shop rule, `itemInRows` (`price-targets.ts:80-101`), serves the island's route. It reads the product first and the decisions only for a matched shop (`:85-95`).
  - They differ on reads that fail:
    - With the decisions unreadable, the form fails the whole product (`:159-161`), while the island still refreshes the own item.
    - With one decision odd, the island's request for that shop gets 503, while the form names that shop unread and refreshes the others (`:96-98`, `:165-168`).
  - A fourth copy, outside the refresh: `onListOf` builds the same set by hand for „Na liście” (`src/lib/services/product-search.ts:233-251`).
- **Intentionality: accidental complexity.**
  - The two derivations were born in two phases of S-03 on the same day, and no document chose to keep two (history report).
  - add-from-other-shops paid the coupling instead of removing it: "The three own-item rules must change together" (`…add-from-other-shops/plan.md:77`).
  - The island route's lazy read order is deliberate (`:636`).
- **Stops here: its real fix is a redesign of a business concept, already planned.**
  - M-2's S-03 has a product's matched shops, steps and price keys come "from one loaded product, instead of eight separate derivations" (`context/foundation/roadmap.md:112`).
  - The M-2 plan maps `productPriceKeys`, `itemInRows`' comparison and `productTargets` to the loaded aggregate's `priceKeys()` and `standingIn` (`02-invariant-aggregate-refactor.md:278`).
  - A standalone merge, `itemInRows` taking its item from `productPriceKeys`, is one file, but it edits lines S-03 rewrites.
  - Two points belong to S-03's plan:
    - whether `itemInRows` loads through the shared loader (S-03's research, Open Question 4, on its branch);
    - whether `productPriceKeys` survives for the list, which keeps its bulk read (`02-invariant-aggregate-refactor.md:265`).

#### TD-06: the stop-asking loop is written twice

- **Current shape (E):**
  - `fetchPinnedPrices` (`src/lib/services/shops/pinned-prices.ts:72-122`) serves Natura and Hebe, through the Luigi's Box client, and Super-Pharm.
  - `fetchRossmannPrices` (`src/lib/services/shops/rossmann.ts:199-229`) is its own loop, wired only as the registry's value (`src/lib/services/shops/registry.ts:61`).
  - They share `FAILED_REQUESTS_BEFORE_STOP`, `failuresAfter`, `logRequestsStopped` and `isRefusal` (`rossmann.ts:4-12`), not the loop.
  - The difference that matters: Rossmann counts only requests it got no response to (`rossmann.ts:187-198`, `:217-222`), and the batch loop counts every request without a readable answer (`pinned-prices.ts:110`, `:132-137`).
  - Incidental differences:
    - only the batch loop takes each id once (`:80`);
    - the batch loop logs unsendable ids in one count line, Rossmann one line per id (`rossmann.ts:254-257`);
    - their stop lines count different totals.
  - The rule is restated in the doc comments of 7 production files. 4 of them write the number as the word "two" (`src/lib/services/shops/hebe.ts:88`, `luigis-box.ts:103`, `natura.ts:77`, `super-pharm.ts:171`).
  - The two files changed together in 4 of `pinned-prices.ts`' 5 commits (`git log`).
  - The stop counters are local to one call of `refreshPrices` and one shop (`pinned-prices.ts:93-95`; `rossmann.ts:201-203`). Only the refusal side reads deployment-wide state, the gate's.
- **Intentionality: the counting difference is a deliberate constraint; the second loop is accidental complexity.**
  - The stop is the owner's call (`context/archive/2026-10-07-testing-shop-answer-contracts/plan.md:313`).
  - Rossmann's counting rule is the owner's Fix A (`context/foundation/test-plan.md:359`), with its accepted edge (`:434`).
  - The two loops are path-dependent:
    - Rossmann's came first, from S-03's review;
    - `pinned-prices.ts` was extracted for the batch shops in S-06 with no change in behaviour;
    - the contracts change shared "one counting rule" but not the loop (`…testing-shop-answer-contracts/plan.md:553`).
- **Feasibility:** see the ranking (opportunity 3). In short: 2 source files and 1–2 doc sentences, no migration, no recordings. Neither M-2 nor the ACL plan touches the shop adapters ("The ACL makes no shop request", `03-anti-corruption-layer.md:593`; S-01's diff and the M-2 plan's file list name no adapter).

#### TD-07: the reasons flatten layer by layer

- **Current shape (E):**
  - The gate keeps 9 outcomes besides `ok` (`src/types.ts:21-26`). `gateUnavailable` folds them into the 4 reasons of `SearchUnavailableReason` (`src/lib/services/shops/shop-outcome.ts:33-52`; `src/types.ts:141`), the counter's skip into `failed` (`shop-outcome.ts:42`).
  - The route's 7 error codes (`api/watchlist/prices.ts:9`) reach the island as one failure, `changed` aside (`src/components/watchlist/price-comparison-state.ts:860-882`). That failure is worded as the shop's: „Nie udało się pobrać ceny ze sklepu X.” (`src/lib/shop-messages.ts:56-57`).
  - The reasons also steer the stop rules. A refusal is any reason but `failed` (`shop-outcome.ts:10-12`), and a failure counts only as `failed` (`pinned-prices.ts:132-137`). Rossmann needs the unfolded outcome, so it carries `responded` past the fold (`rossmann.ts:269`).
  - Neither refresh route, `price-targets.ts` nor `price-refresh.ts` has a `console` call (grep). So a refusal the island's route makes itself (403, 415, 400, 404 `gone`, 409 `changed`) leaves no log line; a failed read leaves only the read's own line.
- **Intentionality: mixed.**
  - Deliberate:
    - the 4 reasons (S-01's review, F3);
    - `changed` set apart, "FIXED via Fix A (the owner, 2026-10-02)" (`context/archive/2026-10-01-fix-matches-and-watchlist/reviews/impl-review.md:67`);
    - Fix A over a `gone` state in the island (`…hebe-in-comparison/reviews/impl-review.md:58-68`; "The owner had all eight fixed, F1 through Fix A", `…hebe-in-comparison/plan.md:1114`);
    - the counter's own reason, deferred on purpose (`…testing-shop-answer-contracts/plan.md:79`).
  - Accidental: the island words the route's own failures (404 `gone`, 503, 400, 403, 415) as the shop's. That came from S-03's one `FAILED` constant, and the group B history report found no decision that weighs it.
- **Stops here, for its user-facing half.**
  - Telling the user that the app's counter failed, that the product was removed, or that the shop failed needs kinds of „unread” that the glossary doesn't have (`context/domain/glossary.md:64`), and the owner's wording (the audit's fix-order item 8, `context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:165`).
  - Once decided, a new reason fans out into the type, `gateUnavailable`, the texts, `REASONS` and both loops' stop rules (I).
  - The code-only remainder is observability, not structure: a log line for the routes' refusals, and one summary line per refresh (the audit's P10, `:101`).

#### TD-08: the time limits stack without one budget, and a shop that times out is logged as `network`

- **Current shape (E):**
  - 12 time-limit constants in 8 files:
    - the adapters' 4–5 s (`rossmann.ts:36-37`; `luigis-box.ts:26-27`; `super-pharm.ts:42-43`);
    - the gate's 8 s request limit and 2 s counter limit (`shop-gate.ts:21`, `:26`);
    - three 2 s database limits (`prices.ts:27`; `src/lib/services/matches.ts:26`; `src/lib/services/watchlist.ts:27`);
    - the island's 20 s (`price-comparison-state.ts:43`).
  - They name each other only in prose (`rossmann.ts:35`; `price-comparison-state.ts:41-42`), and `DEFAULT_TIMEOUT_MS` isn't exported.
  - Each adapter creates its timer in `gate.fetch`'s arguments (`rossmann.ts:259-262`; `luigis-box.ts:192-195`; `super-pharm.ts:203-214`, `:260`), before the gate reserves (`shop-gate.ts:101-107`). The gate's own timer starts after the reservation (`:122`), and the gate tags `timeout` only when its own timer fired (`:134-137`).
  - So in production a slow shop is logged as `failed`/`network`, with the TimeoutError only in the note (I; the audit's P9).
  - No behaviour depends on the label: both read as `failed` (`shop-outcome.ts:49-50`) and as no response (`:25-28`).
  - Each of the 7 tests that get `timeout` from a gate sets the gate's limit to 20 ms, below the adapter's: the opposite of production's order (`src/lib/services/shop-gate.test.ts:217`; `hebe.test.ts:926`; `natura.test.ts:780`, `:1281`; `rossmann.test.ts:580`, `:1100`; `super-pharm.test.ts:254`). `shop-outcome.test.ts` builds the outcome without a gate.
  - Two waits are unbounded: the middleware's `getUser` (`src/middleware.ts:18-21`) and the form route as a whole (`refresh.ts:55-60`).
- **I, the island's budget.** One refetch's bounded part is about 11 s:
  - the targets' reads: 2 s, or 4 s for a matched shop (`price-targets.ts:85`, `:95`);
  - the reservation and the request, inside the adapter's 4–5 s timer;
  - then the insert or a block report, 2 s, never both, since a refused request stores nothing (`prices.ts:85-91`).
  - That leaves about 9 s of the island's 20 s for `getUser`.
- **Intentionality: accidental complexity (emergent).**
  - Each limit was a deliberate local choice: the gate's 8 s with the rule "A timeout → `failed/timeout`" (`context/archive/2026-09-26-polite-shop-access/plan.md:219`), and the first caller's 5 s the same day (S-01's review, F6, `context/archive/2026-09-27-watchlist-add-by-search/reviews/impl-review.md:122-133`).
  - No archived plan or review sets a budget across them, and none connects those two decisions (the group B history report's search).
- **Feasibility:**
  - The label is a defect fix inside the gate: classify a rejection by its error's name, whichever signal fired. The first step is a gate test where the caller's signal times out first, which is red today. 2 files (`shop-gate.ts` and its test).
  - "One budget", each limit declared once with a test of their order, is 8–10 files and overlaps TD-09 and the ACL plan's one database limit (`03-anti-corruption-layer.md:622`). A limit the island shares must live in a browser-safe module (`eslint.config.js:94-155`).
  - U: whether workerd's `AbortSignal.any` rejects with a TimeoutError as Node does.

#### TD-09: the database plumbing repeats, with diverging log rules

- **Current shape (E):**
  - Four 2 s limits (`prices.ts:27`; `matches.ts:26`; `watchlist.ts:27`; `shop-gate.ts:26`).
  - Five `logFailure` helpers. The three database ones (`prices.ts:411`; `matches.ts:621`; `watchlist.ts:349`) follow different rules:
    - `prices.ts` logs a code, "never its message: a message can quote a row or a filter" (`prices.ts:403-409`);
    - 8 call sites in `matches.ts` and `watchlist.ts` log the message (`matches.ts:316`, `:333`, `:457`, `:525`; `watchlist.ts:146`, `:181`, `:246`, `:288`);
    - the gate's binding throws the RPC error's message, which the gate logs in its note (`shop-gate.ts:186`, `:201`, `:106`).
  - Three loops of "not a list, then each row on its own" (`watchlist.ts:184-203`; `matches.ts:574-593`; `prices.ts:355-375`).
  - On one refresh, the target reads log the message and the insert the code (the analysis's claim 11). postgrest-js gives a timeout an empty code (`PostgrestBuilder.ts:292-358`), so `prices.ts` logs "no code" for every timeout (I).
- **Intentionality: the 2 s value and `prices.ts`' rule are deliberate constraints; their copies and the divergence are accidental complexity.**
  - Each limit's comment points at the one before ("like the shop gate's", `watchlist.ts:25-27`).
  - `prices.ts` wrote the stricter rule in S-03, after the other two modules, and they still log the message.
  - Noticed three times, not decided yet:
    - S-03's review, F9 (`…cheapest-shop-today/reviews/impl-review.md:166-169`);
    - the audit's X2, high (`…prices-sign-in-watchlist-writes.md:133`);
    - the ACL plan (`03-anti-corruption-layer.md:183-184`).
- **Feasibility:**
  - The ACL plan's Phase 4 designs the whole target: one `DatabaseAnswer`, one limit, one `logUnread` and one row loop (`03-anti-corruption-layer.md:361-391`, `:957-1013`).
  - Which line to log is the owner's ACL Open question 2 (`:1078`; default: the code, the HTTP status and the hint, never the message).
  - 2 of the 8 message sites are in `record`, which S-02 replaces.
  - Standalone it is about 5 production and 3 test files, done a second time once Phase 4 moves the helper.

#### TD-11: the 15-minute rule lives only in the callers

- **Current shape (E):**
  - One definition: `needsRefetch`, with `REFETCH_AFTER_MS` (`price-comparison.ts:9`, `:121-138`).
  - Two callers apply it: the island's automatic refetch (`src/components/watchlist/PriceComparison.tsx:106-111`) and the list's targets (`price-comparison.ts:650-651`).
  - The button, the product's form and the JSON route ignore it (`PriceComparison.tsx:129-133`; `price-targets.ts:140-149`; `api/watchlist/prices.ts:59-74`).
  - The request carries nothing that tells a tap from an automatic refetch (`price-targets.ts:28-32`).
  - The origin check keeps other sites' pages out, but it judges a request without browser headers by its type alone (`src/lib/json-request.ts:15`).
- **Intentionality: deliberate constraint.**
  - The owner's call of 2026-10-09: the page asks a shop again on its own only once the last check is more than 15 minutes old, while „Odśwież ceny” asks whenever pressed (`context/foundation/prd.md:242`).
  - The domain map records the gap: "only the cap binds a direct post" (`context/domain/domain-distillation.md:252`).
- **Stops here.**
  - Structurally the rule has one home, so there is nothing to merge.
  - A server-side floor would be a business rule for the request cap. It would need a flag the client sets, which bounds nothing a direct post can't set too (I).
  - An accepted risk already lets any signed-in user spend a shop's minute through a direct RPC (R-39, `domain-distillation.md:249`).
  - Whether the owner wants a floor is the analysis's open point (`research.md:506`).

#### TD-12: the JSON route's wire contract is restated by hand

- **Current shape (E):**
  - Shared: the answer's type, `PriceRefreshAnswer` (`src/types.ts:272-275`), which both the route (`api/watchlist/prices.ts:6`, `:16`) and the island (`price-comparison-state.ts:27`, `:890`) name. So the compiler checks both ends' answer.
  - By hand:
    - the request body, `JSON.stringify({ itemId, shop, shopItemId })` (`price-comparison-state.ts:837`), beside `PriceRequest` (`price-targets.ts:28-35`), which `islandConfig` would let the island import as a type (`allowTypeImports`, `eslint.config.js:148`);
    - the route's 7 codes, a route-local type (`api/watchlist/prices.ts:9`), against the literal `"changed"` in the island (`price-comparison-state.ts:879`);
    - `REASONS` (`:886`), typed `readonly SearchUnavailableReason[]`, which a subset satisfies.
  - `saved` is required by the parser and passed through (`:901-909`); no code in `src/components` reads it (the analysis's claim 12; TD-02).
  - Each side's tests pin it with their own literals:
    - the parser's round trips cover `busy` and `paused` among the reasons (`src/components/watchlist/price-comparison-state.test.ts:634-653`);
    - the route's tests assert `saved: true` (`src/lib/services/price-routes.test.ts:310`, `:395`).
  - No test sends the route's answer through the island's parser: the route's handler is imported only by `price-routes.test.ts`, the parser only by its own test and `PriceComparison.tsx` (grep).
  - The route and the state module changed together in all 3 of the route's commits, 61d1e5b, 0de341b and f630b9e (`git log`).
- **Intentionality: mixed.**
  - Deliberate: the hand parser, "rather than with zod, which would add the whole library to the page's JavaScript" (`price-comparison-state.ts:884-885`), and the island's lint rule (S-03's review, F9, `…cheapest-shop-today/reviews/impl-review.md:159-169`; the owner chose each fix, `plan.md:878`).
  - Accidental: what the restatement leaves unguarded. S-03's island contract never mentions `saved` (`…cheapest-shop-today/plan.md:501-523`), while the form path was specified to count it (`:863`).
- **Feasibility:** see the ranking (opportunity 2).

#### TD-13: the offer is mapped by hand in five layers

- **Current shape (E):**
  - The offer is stated in 5 layers:
    - the SQL columns and checks (`price_observations.sql:41-65`; `supabase/migrations/20261006221608_price_history.sql:18-20`);
    - `prices.ts`' row mapping (`:34-74`, `:101-143`, `:379-401`);
    - the types (`src/types.ts:217-227`, `:259-265`);
    - each adapter's reader through `storableOffer` (`shop-offer.ts:24-37`);
    - the island's `parseOffer` (`price-comparison-state.ts:913-931`).
  - Each layer judges a valid offer with its own strictness.
  - `promoEndsOn` passes `storableOffer` unchecked (`shop-offer.ts:34`). Rossmann and Super-Pharm check their dates themselves (`rossmann.ts:402-406`; `super-pharm.ts:436-446`), and Natura and Hebe send none (`natura.ts:144`; `hebe.ts:157`).
- **I:** a new required `ShopOffer` field would break every literal that builds an offer, but not `ObservationRow`, `LATEST_COLUMNS`, the SQL or the harnesses' copies, so it could go unstored without a compile error.
- **Intentionality: each layer is a deliberate boundary; the group A history report found no document that weighs the hand mapping between them.**
  - SQL enforces against a direct call (`lessons.md:33-38`).
  - The column lists are forced by the grants.
  - One reader per shop is the adapters' design.
  - The island keeps zod out.
  - `ShopOffer` is unchanged since dab5b2d (2026-09-28; `git log -L`), so no new field has paid the cost yet.
- **Feasibility:**
  - Fewer layers is not an incremental path: each is a boundary a rule requires.
  - The adequate target keeps the layers, with a round-trip test at each: the database's (TD-03's first step) and the wire's (TD-12's).
  - One rule move, `promoEndsOn` checked inside `storableOffer`, is 2 files.
  - A new field would need a migration and new recordings for 3 of the 4 shops, whose price requests name their attributes (`luigis-box.ts:238`; `super-pharm.ts:248`).

#### TD-14: `price-refresh.ts` also carries the form route's URL contract

- **Current shape (E):**
  - `price-refresh.ts` holds three parts: the refresh (`:11-119`), the form's codes and their parser (`:121-157`), and the ways back (`:159-199`). Three of its imports serve only the URL part (`:2`, `:7`, `:8`).
  - Both pages import the service for `parsePriceRefreshCode` alone (`src/pages/watchlist/[id].astro:27`; `src/pages/watchlist.astro:22`).
  - A type-only cycle: `src/lib/notices.ts:2` type-imports `PriceRefreshCode`, while `price-refresh.ts:2` imports two parameter names back.
  - Of the form routes' 8 code sets, 7 live in `notices.ts` (`:13`, `:54`, `:72`, `:127`, `:153`, `:194`, `:226`); only `PRICE_REFRESH_CODES` lives in a service (`price-refresh.ts:125`).
  - All 7 way-back builders live in their services (`src/lib/services/auth.ts:105`, `:187`, `:305`; `matches.ts:206`; `watchlist.ts:309`; `price-refresh.ts:189`, `:197`), so the refresh's ways back follow the norm and its codes are the outlier.
  - The route-path pair: the list's form posts to a literal (`src/components/watchlist/ListHead.astro:63`), beside `REFRESH_FORM_ROUTE` (`price-comparison-state.ts:40`), under the middleware's prefix (`src/middleware.ts:9`).
- **Intentionality: deliberate placement of load-bearing rules, in a path-dependent home.**
  - The decisions:
    - a closed set of codes, so a link can't put words on a page;
    - the tested parser of a crafted `back` (etykiety's review, F5, `context/archive/2026-09-30-etykiety-redesign/reviews/impl-review.md:132-143`);
    - the island importing only a type (F6, `:161-162`).
  - The module is where S-03 first put the codes (`…cheapest-shop-today/plan.md:862`). Nothing in the history requires it as their home (I).
- **Feasibility:**
  - Move the codes and their parser into `notices.ts`, which is browser-safe and holds the other seven sets. The ways back stay, since they use the zod-backed `parseWatchlistItemId` (`price-refresh.ts:7`).
  - About 9 files with the docs: `CLAUDE.md:58` names today's home.
  - `Record<PriceRefreshCode, …>` in `notices.ts` (`:336`, `:348`) makes `astro check` name every text a move would leave behind.
  - Nothing visible changes. It touches lines of `price-refresh.ts` that ACL Phase 3 doesn't.

#### TD-15: every list view, product view and list refresh reads the latest view over the whole table

- **Current shape (E):**
  - `latest_price_observations` takes `DISTINCT ON` over the whole table under the caller's RLS (`price_observations.sql:144-171`), and `price_summaries` is built on it (`price_history.sql:54`).
  - Readers, with no filter but RLS (`prices.ts:347-349`):
    - the list;
    - the list beside every product view, which "a phone, which doesn't show the list, still makes" (`[id].astro:61-66`);
    - a list refresh's targets (`price-targets.ts:128-132`).
  - The product's own read filters by `.in("shop_item_id", …)` alone (`prices.ts:346-349`).
  - Nothing removes old rows (`domain-distillation.md:217`; Q-05 at `:323`).
- **Intentionality: deliberate deferral, twice, on an unmeasured basis.**
  - S-03's review, F4, impact HIGH: `EXPLAIN ANALYZE` read all 62 local rows for a user with 5 items, in 0.7 ms. It was deferred to S-04 by Fix A (`…cheapest-shop-today/reviews/impl-review.md:84-105`; follow-up `…/follow-ups/review-fixes.md:5-15`).
  - S-04 added the partial index and left the rework: "at today's scale the list's single read gains nothing measurable" (`context/archive/2026-10-06-good-price-judgement/plan.md:60`; `price_history.sql:8-11`). The plan records no measurement behind that sentence.
- **Feasibility:**
  - F4's design exists (`review-fixes.md:5-15`):
    - drive the view from the caller's watched items with two `LIMIT 1` laterals;
    - filter the page's read by `shop_id` too;
    - extend `scripts/check-prices-db.mjs`.
  - One `create or replace view` with the same columns would reach both reads (I).
  - Cost: 1 migration, pushed by the owner before the merge, and 2–3 files.
  - First step: measure, read-only: production's row count, and a local plan over a seeded volume.
  - U: production's size; the plan under `security_invoker` RLS; whether the `.in` filter reaches the `DISTINCT ON`; PostgREST past its row cap (`max_rows = 1000` locally, `supabase/config.toml:18`).
  - Retention (Q-05; roadmap Open Question 6, `context/foundation/roadmap.md:140`) is the owner's alternative, a data policy.

#### TD-16: constants mirrored in comments, texts, SQL and a test harness

- **Current shape (E):** the TypeScript side has one home per constant (`price-comparison.ts:9`, `:16`; `src/lib/services/product-limits.ts:18-20`; `shop-gate.ts:22-24`). The copies sit elsewhere:
  - **SQL:**
    - the 30 days (`price_history.sql:70-71`, linked by a comment at `:35`);
    - the retry bounds (`supabase/migrations/20260926112205_polite_shop_access.sql:100-105`);
    - the price bound (`price_observations.sql:43`; `price_history.sql:19-20`);
    - the shop item id rule (`price_observations.sql:39`), which the other two tables keep without its letter-or-digit part (`supabase/migrations/20260927184936_watchlist_matches.sql:10`, `:32`).
  - **Texts:**
    - „w ciągu ostatnich 15 minut.” (`src/lib/notices.ts:339`), with its copy in the kitchen sink (`src/dev/product-page.astro:841`);
    - „30 dni” in the history sentences (`price-comparison-state.ts:694-696`).
  - **Comments:** the batch sizes (`price-refresh.ts:38-39`).
  - **Harnesses:**
    - the database check's literals (`scripts/check-prices-db.mjs:355-371`);
    - the e2e id rule (`scripts/e2e-local-db.mjs:22-23`), which equals two tables' rule but claims all three.
- **Intentionality: mixed.**
  - Deliberate: the SQL mirrors, documented at both ends (`CLAUDE.md:60`; `product-limits.ts:15-17`; `price_history.sql:35`; `shop-gate.ts:22`). A check constraint or a view can't import TypeScript.
  - Accidental: the text, comment and harness copies. One of them, the e2e rule, drifted from birth; it is harmless while looser.
- **Feasibility:**
  - Derive the texts from the constants (a Polish plural would need its forms if the value ever changed, I).
  - A database test that probes each SQL copy at the TypeScript value; the database tests can import `src/` (`vitest.db.config.ts`).
  - Align the e2e rule.
  - 4–6 files, no migration. Low value.

#### TD-17: two test-only exports on the path

- **Current shape (E):**
  - `fetchRossmannPrice` (`rossmann.ts:238-240`) wraps the private `requestRossmannPrice`. Its 13 calls are all in `rossmann.test.ts`, none in production, which asks through `fetchRossmannPrices` (`registry.ts:61`).
  - `shopItemFor` (`price-targets.ts:43-50`) wraps `itemInRows`. Its 11 calls are all in `price-targets.test.ts`, while the route calls `priceTargetFor` (`api/watchlist/prices.ts:61`).
  - Four production comments still name `shopItemFor` as the island's derivation (`matches.ts:396`; `price-targets.ts:53`, `:75`, `:147`).
- **Intentionality: accidental complexity: vestiges kept as test seams.**
  - `fetchRossmannPrice` was S-03's production entry. It became test-only in the contracts change, whose plan says of its fate only that it "keeps its signature" (`…testing-shop-answer-contracts/plan.md:598`; its other mention, `:139`, states a behaviour), a minimal-diff note.
  - `shopItemFor` lost its production caller with the owner's Fix A for S-05's F1 (`…hebe-in-comparison/reviews/impl-review.md:68`); the group B history report found no note about keeping it.
- **Feasibility:**
  - Rossmann's half: route the 13 test calls through a test-local helper over `fetchRossmannPrices`, then drop the export. 2 files; it can ride with TD-06.
  - `shopItemFor`'s half sits inside S-03, which rewrites `itemInRows`.

### What the non-candidates feed into

- **TD-02** (defect): the island ignores `saved`. Its display is the owner's wording (the analysis's Open Question 5; the audit's P6, high, and its fix-order item 8). TD-12's contract test would pin `saved` passing through, whatever the display.
- **TD-10** (defect): a per-shop catch in `refreshPrices`, like the match steps' (`shop-matching.ts:318-328`). The database timers add no throw, since postgrest-js answers `{ error }` (above); the throw the analysis names stays: the gate's `TypeError` for a URL outside a shop's hosts (`shop-gate.ts:92-95`), a programming error.
- **TD-18** is TD-03's first step and TD-04's place to settle Open Question 2.
- **TD-19:** no refetch answer but `stopped` reaches a browser, so any island change, TD-12's included, has unit proof only.
- **TD-21** is TD-11's ground. **TD-22** sits in TD-14's blast radius. **TD-23** and **TD-24** sit on TD-12's contract.
- **TD-20** and **TD-25** bear on the gate's SQL and on the request cap's spending, outside every candidate.
- **TD-26** (tests restate shop requests) raises the cost of TD-13's new field and of any adapter change; part of it is required by rule (`CLAUDE.md:21`).
- **TD-27** (hand-built clients) raises TD-03's typing cost, since each cast may need adjusting. The ACL plan's Phase 3 replaces those clients with an in-memory backend.

## Corrections to the sub-reports

- **One island refetch's bounded time is about 11 s.** Three reports added it differently:
  - the group B shape report: about 13 s, with both the insert and a block report;
  - the group B feasibility report: about 15 s, with the reservation outside the adapter's timer and both writes;
  - the group B history report: about 16 s, with the gate's 8 s in place of the adapter's timer.
  - The code says otherwise: each adapter's timer starts before the reservation (`rossmann.ts:259-262`; `luigis-box.ts:192-195`; `super-pharm.ts:203-214`, `:260`; `shop-gate.ts:101-107`), and a refused request stores nothing, so the insert and a block report never both run (`prices.ts:85-91`). TD-08 above has the sum.
- **Supabase answers, not throws.** The group B feasibility report listed as unknown whether supabase-js answers `{ error }` or throws on an abort. The installed postgrest-js answers `{ error }` with an empty code unless `throwOnError` is set (`PostgrestBuilder.ts:292-358`), and nothing in `src/` sets it. The group A reports had this right.
- **The claim-verification section exists.** The group A feasibility report says the analysis has none. It exists (`research.md:693-748`), and that report's counts agree with it wherever both count.
- **Where the lookup's failure contract was written.** The group A history report says 61d1e5b wrote it "with the call". The words are a code comment in that commit's diff, not its message.
- **A shorthand that names the wrong file.** The group B feasibility report cites "`priceTargetFor` (`prices.ts:61`)". The call is in the route, `src/pages/api/watchlist/prices.ts:61`; `prices.ts` is the service.
- **The domain map's line on old rows.** The group A shape report cites `domain-distillation.md:217` for "nothing removes old rows". That line is R-19, whose gap column says so; Q-05 itself is at `:323`.
- **What the catalogue check compares.** The group A shape report calls the analysis's "nothing compares the schema with the code" too strong, because CI runs `scripts/check-catalog-db.mjs`. That check holds the database to a reviewed list inside the script (`:27-41`), not to the app's code, and it reads no column, so the statement stands for the code (the map's "no check compares them", `repo-map.md:113`).

Refinements to the analysis, from the sub-reports, each re-checked:

- **Open Question 1 is answered:** a timeout or network failure comes back as `{ error }`, so the 2 s timers never throw into a route or a step.
- **Open Question 2 is half answered:** the client sends one POST with the rows as its body and a `columns` parameter (`PostgrestQueryBuilder.ts:1122-1138`). Whether PostgREST applies it as one statement stays unknown.
- **TD-03:** beside the gate, watchlist, matches and prices checks, CI runs a catalogue check that pins the database's relations, functions and their protection to a reviewed list (`scripts/check-catalog-db.mjs:27-41`; `.github/workflows/ci.yml:52-68`). It doesn't involve the app's code or any column.
- **TD-04:** the whole-shop loss applies to the list refresh only.
- **TD-06:** the stop counters are per refresh and per shop; "deployment-wide" fits the refusal side only.
- **TD-11:** the origin check doesn't limit callers to the app's pages: a client without browser headers is judged by its type (`json-request.ts:15`).
- **TD-12:** the answer's type is shared and compiler-checked at both ends. What is written by hand is the request, the error codes and `REASONS`.
- **TD-16:** two more copies, the kitchen sink's 15-minute text and the „30 dni” history sentences. The e2e id rule equals two tables' rule.

## Code References

- `src/lib/services/prices.ts:81-98`, `:153-157`, `:341-376`, `:403-414` - the one write, the views' reader and the code-only log rule
- `src/lib/services/price-refresh.ts:65-101`, `:121-199` - the refresh, the form's codes and the ways back
- `src/lib/services/price-targets.ts:28-35`, `:43-101`, `:124-170` - the request schema, `shopItemFor`, `itemInRows` and the form's targets
- `src/lib/services/shop-matching.ts:318-328`, `:375-404` - the step's catch and the lookup's first price
- `src/lib/services/price-comparison.ts:9-18`, `:121-138`, `:593-663` - the timing constants, `needsRefetch` and the price keys
- `src/pages/api/watchlist/prices.ts:9-26`, `:59-74` - the route's codes, its answer and its one refresh
- `src/pages/api/watchlist/refresh.ts:19-61` - the form route
- `src/components/watchlist/price-comparison-state.ts:38-43`, `:234-265`, `:813-948` - the island's routes, its settle step and its wire code
- `src/types.ts:21-26`, `:141`, `:217-233`, `:267-275` - outcomes, reasons, the offer and the answer
- `src/lib/services/shop-gate.ts:12-26`, `:88-165`, `:172-207` - the hosts, the limits, `gate.fetch` and its Supabase binding
- `src/lib/services/shops/pinned-prices.ts:13-20`, `:72-137` - the batch loop and its stop rule
- `src/lib/services/shops/rossmann.ts:187-278` - Rossmann's loop and its test-only wrapper
- `src/lib/services/shops/shop-outcome.ts:10-52`; `src/lib/services/shops/shop-offer.ts:4-37` - the reasons' fold and the offer's funnel
- `src/lib/notices.ts:1-13`, `:336-353` - the code sets and the refresh's texts
- `src/lib/supabase.ts:9-29`; `src/env.d.ts:1-7` - the untyped client
- `supabase/migrations/20260928011450_price_observations.sql:89-171` - the watcher policies, the grants and the latest view
- `supabase/migrations/20261006221608_price_history.sql:1-30` - the deferred rework, the bounds and the partial index
- `scripts/check-catalog-db.mjs:27-41`; `vitest.db.config.ts:12`; `.github/workflows/ci.yml:42`, `:65-72` - what CI checks of the database
- `node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:292-358`; `node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts:1086-1138`; `node_modules/@supabase/supabase-js/src/SupabaseClient.ts:46-47`, `:433-447` - the SDK's answers, its array insert and its schema typing

## Architecture Insights

- **The duplication is load-bearing at three boundaries.** A check constraint or view can't import TypeScript, the island keeps zod and server modules out (`eslint.config.js:94-155`), and each shop adapter translates its own shop. So for TD-12, TD-13 and TD-16 the adequate target is a check across the boundary, a shared type, a round-trip test or a probe, not fewer copies.
- **Two planned changes already own two debts.** M-2's S-03 owns the price-key derivation (TD-05, TD-04's TypeScript half, `shopItemFor`), and the ACL plan's Phase 4 owns the database plumbing (TD-09). The room for a refactor now is where neither reaches:
  - the wire between the route and the island (TD-12);
  - the shop adapters' loops (TD-06);
  - the schema's compile-time check, which the ACL plan leaves out on purpose (TD-03).
- **Most candidates were shaped by review fixes landing in the nearest module** (the history reports' finding, borne out by TD-06, TD-14 and TD-17). Their homes follow the order of history, not a design. The owner's calls inside them, such as Fix A for Rossmann's counting, the 409 `changed` and the 15 minutes, are the constraints any target shape keeps.
- **The analysis's top risk chain runs through a gap between layers, not inside one.** The insert is well-structured in one function (seam 3), yet nothing checks it against the database before production (TD-03, TD-18), and the island drops the one signal that would show a failure (TD-02).

## Historical Context (from prior changes)

- `context/archive/2026-09-28-cheapest-shop-today/` (S-03) set most of group A in two days:
  - the one write and its lookup caller (`plan.md:536`, `:572`);
  - the single insert (`:355`), split per shop by review F7 (`reviews/impl-review.md:144`);
  - the hand parser and the lint rule (review F9, `:159-169`);
  - the latest view and its deferral (review F4, `:84-105`; `follow-ups/review-fixes.md:5-15`);
  - the refresh codes' home (`plan.md:862`).
- `context/archive/2026-10-07-testing-shop-answer-contracts/` set the stop after two failed requests (`plan.md:313`), the shared counting rule (`:553`), Rossmann's Fix A (`context/foundation/test-plan.md:359`) and the test-only `fetchRossmannPrice` (`plan.md:598`).
- `context/archive/2026-10-01-fix-matches-and-watchlist/` and `context/archive/2026-10-02-hebe-in-comparison/`: the owner's Fix A choices for the 409 `changed` (S-08's review, F1) and for a decline elsewhere (S-05's review, F1), which made `shopItemFor` test-only.
- `context/archive/2026-10-06-good-price-judgement/plan.md:60`: the second deferral of the view's rework.
- `context/archive/2026-09-30-etykiety-redesign/reviews/impl-review.md:132-162`: the way-back parser and the type-only import (TD-14).
- `context/archive/2026-09-26-polite-shop-access/plan.md:219` and `context/archive/2026-09-27-watchlist-add-by-search/reviews/impl-review.md:122-133`: the gate's `timeout` rule and the first adapter timer (TD-08).

## Related Research

- `context/changes/price-refresh-flow-analysis/research.md` - the analysis this change ranks
- `context/changes/decision-store-backstop/research.md` and `context/changes/page-lookups-through-guardian/research.md`, on the branches `refactor/decision-store-backstop` and `refactor/page-lookups-through-guardian` - M-2's S-02 and S-03
- `context/domain/03-anti-corruption-layer.md`, `context/domain/02-invariant-aggregate-refactor.md`, `context/domain/domain-distillation.md`, `context/map/repo-map.md`

## Open Questions

None of these blocks the ranking; each states what is unknown or where it is already recorded.

1. **U:** does PostgREST apply an array insert as one statement (TD-04)? TD-03's first test can settle it on the local stack.
2. **U:** production's `price_observations` size, and the latest view's plan under `security_invoker` RLS (TD-15). A read-only measurement settles it.
3. **U:** the churn of a typed client (TD-03): the services' casts, the view names, and whether `supabase gen types` runs in the smoke job, which starts the stack without `postgres-meta` (`ci.yml:42`).
4. **U:** whether workerd's `AbortSignal.any` rejects with a TimeoutError as Node does (TD-08).
5. **Recorded elsewhere, and bearing on the ranking's sequencing:** the ACL plan's Open questions 1 (its order against M-2), 2 (the database log line) and 5 (generated types); the analysis's Open Question 5 (TD-02's display); S-03's research, Open Question 4 (`itemInRows` through the loader).

## Refactor opportunities (ranked)

Each opportunity is ranked by the cost of its debt against the cost of the change, then by when it can start, given M-2 and the ACL plan.

### 1. TD-03, starting with TD-18: the schema reaches a check before production does

- **Current shape:**
  - The client is untyped (`src/lib/supabase.ts:13`; `SupabaseClient.ts:46-47`), and its 12 calls in 4 data-access modules name tables, views, columns and RPC arguments as strings.
  - The app's own insert and reads never run against a database. The database checks insert hand copies (`scripts/check-prices-db.mjs:120-142`), the stub accepts any columns (`stub-supabase.ts:148-151`), and the catalogue check stops at names (`check-catalog-db.mjs:27-41`).
- **Target shape:** the real `recordPriceChecks`, `readLatestPrices` and `listLatestPrices` run against the local stack in CI's smoke job; a generated schema type, kept equal to the migrations by CI, types the client, so a table, column or RPC argument the migrations lack fails `astro check`.
- **Why it ranks first:**
  - **The debt's cost:** the analysis's highest-risk chain.
    - A drift in the insert, such as a renamed column or a ninth field outside the grant, fails every insert of that shop in production while the unit suite, the database checks and e2e stay green (TD-18).
    - The product page then shows the unstored price as freshly checked (TD-02).
    - The one recorded production incident was of this family, code and schema out of step: a migration not yet pushed made every list and every add fail with PGRST205 (`context/map/evidence/2-discussion.md:92-94`). The deploy gate now covers that case, not this one.
    - S-02 adds an RPC whose call no type checks.
  - **The change's cost:** the first step is one test file, with no production change and no workflow edit. The typing is 1 generated file, 1 CI step and the client in 6 files today (the factory, `App.Locals` and 4 data-access modules), or about 3 after ACL Phase 4 (I).
- **Blast radius:**
  - Step 1: a new `src/lib/services/*.db.test.ts`.
  - The typing: `src/lib/supabase.ts`, `src/env.d.ts`, `watchlist.ts`, `matches.ts`, `prices.ts` (the view names as a union) and `shop-gate.ts`'s binding, plus CI's smoke job. The stub's cast and the hand-built clients in 8 test files may need adjusting (U; TD-27).
  - Nothing a user sees, no migration, no recordings.
- **Incremental path:**
  1. The database test of the real write and both reads, with a mixed watched and unwatched insert (TD-04's open question) and a deliberate break, a renamed column in `observationRow`, that turns it red.
  2. Generate the schema type into a tracked file, and add a smoke-job step that regenerates it and fails on a difference.
  3. Type the factory and `App.Locals`. The services keep their parameters while a type check shows whether the typed client passes to them.
  4. Type the data-access modules one per commit: `prices.ts`, `watchlist.ts`, the gate's binding, then `matches.ts`. Or do steps 3 and 4 inside ACL Phase 4, where the client lives in one directory.
- **First prerequisite step:** step 1. It collides with nothing and starts now.
- **Sequencing:**
  - Steps 2–4 touch the signatures ACL Phase 3 rewrites and the `record` S-02 replaces. Inside ACL Phase 4 they cost the fewest files.
  - If step 2 lands before S-02, S-02's pull request must regenerate the type, and its `record_decision` call is checked.
  - The ACL plan's Open questions 1 and 5 hold that order with the owner; this ranking needs neither answered before step 1.

### 2. TD-12: one wire contract for `/api/watchlist/prices`

- **Current shape:**
  - The answer's type is shared (`src/types.ts:272-275`).
  - The request body is written by hand (`price-comparison-state.ts:837`), while `PriceRequest` (`price-targets.ts:35`) types only the server's side.
  - The route's codes are route-local (`api/watchlist/prices.ts:9`), against a literal in the island (`price-comparison-state.ts:879`).
  - `REASONS` can drift into a subset of its type (`:886`).
  - `saved` is parsed and dropped (TD-02).
  - No test joins the two sides.
- **Target shape:**
  - the reasons as one constant list in a browser-safe module, which the type and the island's parser both derive from;
  - the island's request typed with `PriceRequest`, a type-only import `islandConfig` allows;
  - the route's error codes exported as a type that the island's 409 reading names;
  - one contract test that sends the island's request to the real route, through the existing route-test context and the replay fetch, and reads every answer kind the route builds back through the island's parser: a price, a missing item, each reason, a pause with its end, 409 `changed`, 404 `gone`.
- **Why it ranks second:**
  - **The debt's cost:**
    - The route and the island's state module changed together in all 3 of the route's commits.
    - The flow's one live defect, TD-02, sits on this contract.
    - A new reason or field would read as a failed refetch with no test failing, since the parser's round trips cover 2 of the 4 reasons.
    - It also closes TD-24's holes on this route (its `missing` answer, `checkedAt`) and pins `saved` passing through, whatever the owner decides for its display.
  - **The change's cost:** 2–4 files, no migration, no recordings (the route tests' fixtures exist), nothing a user sees.
- **Blast radius:**
  - `src/components/watchlist/price-comparison-state.ts` and its test, `src/pages/api/watchlist/prices.ts`, and the module that holds the reasons' list: `src/types.ts`, which would then join `islandConfig`'s files, or `src/lib/shop-messages.ts`, already there.
  - One new test file, or a section of `price-routes.test.ts`.
  - The 11 non-test modules that name `SearchUnavailableReason` or `ShopUnavailable`, `src/types.ts` among them (`git grep`), keep the same types.
- **Incremental path:**
  1. The contract test, which pins today's behaviour, green from the start.
  2. The reasons' one list.
  3. The typed request.
  4. The exported codes.
  - TD-02's display stays out: it is the owner's wording (the analysis's Open Question 5; the audit's fix-order item 8).
- **First prerequisite step:** the contract test, once S-01 merges. S-01 moves `price-routes.test.ts`' context helpers into `src/lib/services/testing/route-context.ts` and `stored-rows.ts`, which the test would build on.
- **Sequencing:**
  - S-02 doesn't touch the wire.
  - S-03 rewrites the targets behind the route (`itemInRows`), and its research expects the route's answers to stay as the route tests pin them (I).
  - ACL Phase 3 changes the route's `locals.supabase` to a backend and the test context with it; the contract test then follows that context.

### 3. TD-06: one stop-asking loop, with the counting rule as a parameter

- **Current shape:** two loops, `fetchPinnedPrices` (`pinned-prices.ts:72-122`) and `fetchRossmannPrices` (`rossmann.ts:199-229`). They share the constant and three helpers but not the loop. They differ deliberately in what counts toward the stop (the owner's Fix A), and incidentally in deduplication, logging and totals. The rule is restated in 7 files' comments.
- **Target shape:** one loop in `pinned-prices.ts`, given how many ids a request carries, how a request's answer reads and what counts toward the stop. Every shop's price fetcher calls it, and Rossmann passes "only requests with no response" (Fix A kept).
- **Why it ranks third:**
  - **The debt's cost:**
    - Every change to the stop rule has touched both loops: the two files changed together in 4 of `pinned-prices.ts`' 5 commits, on 2026-10-07 and 2026-10-08 (`git log`).
    - The stop steers on the flattened reasons, so any reason TD-07 ever adds must be classified in both loops.
    - The adapters are the map's risk zone 2: "the only rising capability, and the only one with defects found in merged code" (`context/map/repo-map.md:15`, `:135-145`).
  - **The change's cost:** 2 source files and 1–2 doc sentences (`CLAUDE.md:59`; `price-refresh.ts:27-34`), no migration, no recordings, and neither M-2 nor the ACL plan touches the files. Its value is smaller than the first two opportunities', but it is the cheapest contained change with no collision.
- **Blast radius:**
  - `pinned-prices.ts` and `rossmann.ts`. TD-17's Rossmann half, dropping `fetchRossmannPrice`, can ride along, with `rossmann.test.ts`.
  - The proof is `price-refresh.test.ts`, which pins both stops through refreshes, with reservations, served URLs and log lines: Rossmann at `:571-839` (Fix A at `:644`), Natura at `:840-920`.
- **Incremental path:**
  1. A deliberate break of Fix A, Rossmann counting every unread answer, must turn `price-refresh.test.ts:644` red, proving the guard before anything moves.
  2. Extract the loop's skeleton, that is, the refusal carried to later ids, the failures in a row and the unasked count with its line, and route Rossmann's loop through it with its own reading, counting and log lines, `price-refresh.test.ts` unchanged.
  3. Route the batch loop through it.
  4. Update the doc sentences.
  - Keeping each shop's log lines is what keeps every assertion unchanged. The group B feasibility report's other variant, Rossmann on the batch loop's lines, would change asserted lines (`price-refresh.test.ts:605-638`).
- **First prerequisite step:** the deliberate break of step 1.
- **Sequencing:** none. It can start now, in parallel with M-2.

### Considered and rejected

- **TD-01:** the shared write is deliberate (it saves a shop request), and its failure costs one request the island makes again by construction. The contract change waits for S-03, which rewrites `lookupOutcome`; it belongs in S-03's plan, with its first test (a failing first-price insert).
- **TD-04:** the whole-shop loss needs a list refresh and, while the TypeScript rule stays a subset of the policies, a race with another tab; it loses requests already spent, not a shown price. Its first test fits in opportunity 1's file. Its TypeScript half is TD-05's, and its SQL half is required by `CLAUDE.md:18`.
- **TD-05:** a business-concept redesign that M-2's S-03 already plans. A standalone merge would edit the same lines twice.
- **TD-07:** its user-facing half needs kinds of „unread” the glossary lacks, and the owner's wording. Its code-only remainder, the routes' log lines and a refresh summary, is observability work, not structure.
- **TD-08:** the `network` label is a 2-file defect fix in the gate, which changes no behaviour. "One budget" overlaps TD-09 and the ACL plan, and the bounded part, about 11 s, sits well inside the island's 20 s; the one unbounded wait is `getUser`.
- **TD-09:** ACL Phase 4 designs it in full, its log rule is the owner's recorded Open question 2, and 2 of its 8 message sites sit in the `record` S-02 replaces. Standalone it would be done twice.
- **TD-11:** no structural debt. The rule has one definition, applied where the owner's call of 2026-10-09 puts it; a server floor is a business rule, and under today's accepted risks it would bound little.
- **TD-13:** fewer layers is blocked by deliberate boundaries. Its adequate target, round-trip tests, comes with opportunities 1 and 2, and the `promoEndsOn` rule move is 2 files that can go with any adapter change. No offer field has been added since 2026-09-28.
- **TD-14:** cheap and contained, about 9 files with the docs and nothing visible, but low value. A page importing a service for a parser is the codebase's usual shape, and the cycle is type-only. Worth doing, with the route-path pair, beside the next change to `notices.ts` or the list's form.
- **TD-15:** its cost is unknown until measured. The only recorded query plan read 62 local rows in 0.7 ms (2026-09-29); its first step is a read-only measurement, which could promote it, and its fix needs a migration and the owner's push. Retention (Q-05) is the owner's alternative.
- **TD-16:** low value. The SQL mirrors are deliberate, and the accidental copies (the 15-minute text, the kitchen sink's copy, the batch-size comment, the e2e id rule) are cheap to derive at any time; the one drift is harmless.
- **TD-17:** low value. Its Rossmann half rides with opportunity 3, and its `shopItemFor` half sits inside S-03.
