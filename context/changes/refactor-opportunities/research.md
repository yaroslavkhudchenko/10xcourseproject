---
date: 2026-10-10T13:42:47+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 2fbd621afebdff1cf6696f460aba5e450b70b691
verified_at_commit: cfbb65170810a153cc618f9c35af5a16fab74770
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
    verified,
  ]
status: complete
last_updated: 2026-10-10T14:25:45+02:00
last_updated_by: Claude (claude-opus-5-5)
last_updated_note: "Claim verification (ast-grep) added at cfbb651: 56 structural claims the ranking stands on (50 confirmed, 6 refined, 0 refuted) and 4 repository facts checked with git (1 refuted: S-01 had already merged); two counts corrected in place, marked (report: …); two results left to decide at the planning stage."
---

# Research: refactor opportunities in the refresh flow (refactor-opportunities)

**Date**: 2026-10-10T13:42:47+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 2fbd621afebdff1cf6696f460aba5e450b70b691 (this change's `change.md` is committed there; this document isn't)
**Verified at Commit**: cfbb65170810a153cc618f9c35af5a16fab74770 (this document as committed; "Claim verification (ast-grep)")
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
- **Verified after writing.** At `cfbb651`, the commit that holds this document, every structural claim the ranking stands on was checked with ast-grep, every zero confirmed with grep ("Claim verification (ast-grep)"). Two counts are corrected in place, marked "(report: …)".

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
  - Each of the 10 (report: 7) tests that get `timeout` from a gate sets the gate's limit to 20 ms, below the adapter's: the opposite of production's order (`src/lib/services/shop-gate.test.ts:217`; `hebe.test.ts:926`; `natura.test.ts:780`, `:1281`; `rossmann.test.ts:580`, `:1100`; `super-pharm.test.ts:254`; and, asserting only the failed check, `price-refresh.test.ts:582`, `:704`, `:778`). `shop-outcome.test.ts` builds the outcome without a gate.
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
  - Of the form routes' 10 (report: 8) code sets, 7 live in `notices.ts` (`:13`, `:54`, `:72`, `:127`, `:153`, `:194`, `:226`); 3 (report: only `PRICE_REFRESH_CODES`) live in a service: `PRICE_REFRESH_CODES` (`price-refresh.ts:125`), and the add and decision routes' error codes with their texts, `WatchlistError` (`src/lib/services/watchlist.ts:88`) and `MatchError` (`matches.ts:177`).
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

## Claim verification (ast-grep)

The structural claims the ranking stands on, in "Refactor opportunities (ranked)" and in the candidate sections, intentionality verdicts and rejection reasons it relies on, checked on 2026-10-10 against the code at `cfbb651`, the commit that holds this document, whose code is 5eefce2's (row 57).

- **How:** ast-grep 0.50.0, as `npx --yes -p @ast-grep/cli ast-grep run -p '<pattern>' -l ts|tsx|js --json=compact <paths>`, counting the JSON entries, or `ast-grep scan -r <rule.yml>` for the rules a row describes (`kind`, `has`, `inside`, `regex`). Tests and `src/lib/services/testing/` are left out unless the claim is about them. ast-grep doesn't parse `.astro` or `.sql`, so those were checked with grep, as were YAML, `package.json` and plain text; history and branches with git, read-only, with no fetch.
- **Zeros:** every zero was confirmed with grep. Where a row names a control, the same pattern or rule was also run on a known match.
- **Three bad patterns:** `function logFailure($$$P) { $$$B }` found 0 where grep found 5 definitions: it leaves out the `: void` return type, and a `kind: function_declaration` rule finds the 5 (row 45). A bare `PriceRequest` matches only identifiers in expressions, so it found 0 even in `price-targets.ts`; a rule over `type_identifier` and `identifier` finds its 4 uses there and none in `src/components` (row 14). A bare `SupabaseClient<$$$T>` matches no type annotation (`Promise<$$$T>` finds 0 in `prices.ts`, which has 5); a `kind: generic_type` rule finds those 5 and no generic `SupabaseClient` in `src/` (row 1).
- **The ranked section and the intentionality verdicts stay as written.** Rows 25, 32 and 33 refine three of the ranked section's statements; their corrections stand here only. Corrected in place, marked "(report: …)": TD-08's count of tests (row 43) and TD-14's code sets (row 50).
- **Tally:** 56 structural claims: 50 confirmed, 6 refined, 0 refuted. Beside them, 4 repository facts the sequencing uses, checked with git: 3 confirmed, 1 refuted (row 60).

|   # | Claim                                                                                                                                                                                                                | Verdict   | Evidence (file:line)                                                                                                                                                                                                                                                                                                                                                                                                                                   | Method (pattern or rule)                                                                                                                                                                                                                                                                                                       |
| --: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | Opportunity 1 (TD-03): the client is untyped; the factory passes no schema type, and `App.Locals.supabase` is the bare `SupabaseClient`                                                                              | confirmed | `src/lib/supabase.ts:13-28`; `src/env.d.ts:5`; no typed `createServerClient` call and no generic `SupabaseClient` in `src/`                                                                                                                                                                                                                                                                                                                            | `createServerClient($$$A)` (1); zero for `createServerClient<$$$T>($$$A)` (control: `vi.fn<$$$T>($$$A)` matches `price-comparison-state.test.ts:704`); rule `kind: generic_type` naming `SupabaseClient` (0; control: 5 `Promise<…>` in `prices.ts`); grep; rule `kind: property_signature` named `supabase` on `env.d.ts` (1) |
|   2 | TD-03: 20 exported service functions in 7 files take that client                                                                                                                                                     | confirmed | `watchlist.ts:122`, `:174`, `:232`, `:280`; `matches.ts:258`, `:275`, `:446`, `:516`; `price-targets.ts:43`, `:59`, `:124`, `:150`; `prices.ts:81`, `:222`, `:255`, `:312`; `auth.ts:258`, `:271`; `price-refresh.ts:65`; `shop-gate.ts:172`. 4 unexported ones besides: `prices.ts:341`, `price-targets.ts:80`, `price-refresh.ts:85`, `matches.ts:296`                                                                                               | rule `kind: function_declaration`, `inside: export_statement`, with a `required_parameter` whose type matches `SupabaseClient` (20); without `inside` (24)                                                                                                                                                                     |
|   3 | Opportunity 1: 10 queries and 2 RPC calls in 4 data-access modules, the ranking's "12 calls" and "the client in 6 files today"                                                                                       | confirmed | `.from(`: `watchlist.ts:123`, `:175`, `:236`, `:281`; `matches.ts:303`, `:320`, `:451`, `:520`; `prices.ts:92`, `:347`. `.rpc(`: `shop-gate.ts:182-183`, `:192-198`. None in a `.astro` file                                                                                                                                                                                                                                                           | `$C.from($$$A)` (10) and `$C.rpc($$$A)` (2), tests left out; the one `.tsx` hit is `Array.from` (`Sticker.tsx:19`); grep for `.from(` and `.rpc(` over `.astro` (0)                                                                                                                                                            |
|   4 | Opportunity 1: the database checks insert hand copies of the row, never the app's write                                                                                                                              | confirmed | `scripts/check-prices-db.mjs:122-132` (`priceRow`), `:133-142` (`missingRow`); its only imports are `@supabase/supabase-js` and `./e2e-local-db.mjs` (`:18-19`)                                                                                                                                                                                                                                                                                        | `-l js`: `const priceRow = ($$$P) => ($$$B)` (1), `import $$$ from "$M"` (2); zero for `recordPriceChecks($$$A)` in `scripts/` (control: row 34), grep                                                                                                                                                                         |
|   5 | Opportunity 1: the unit stub accepts an insert whatever its columns                                                                                                                                                  | confirmed | `stub-supabase.ts:148-151` answers with the values it was given                                                                                                                                                                                                                                                                                                                                                                                        | `if (this.operation === "insert") { $$$B }` (1)                                                                                                                                                                                                                                                                                |
|   6 | Opportunity 1: the catalogue check stops at names                                                                                                                                                                    | confirmed | `check-catalog-db.mjs:27-41`: 7 relations and 3 functions; its one column-level probe asks whether `anon` holds a column privilege (`:65`); no column's name or type is compared                                                                                                                                                                                                                                                                       | grep for `column`, `attname` and `information_schema` (3 hits, all privileges), read at the hits                                                                                                                                                                                                                               |
|   7 | Mirrored pair: the insert's row ↔ the 8-column insert grant                                                                                                                                                          | confirmed | `ObservationRow`'s 8 properties (`prices.ts:35-42`) are, by name, the 8 columns of `grant insert (…)` (`price_observations.sql:137-138`)                                                                                                                                                                                                                                                                                                               | rule `kind: property_signature` inside `interface ObservationRow` (8); grep on the `.sql`                                                                                                                                                                                                                                      |
|   8 | TD-03: one database-backed unit test, of decisions; a new `src/**/*.db.test.ts` joins `npm run test:db` with no workflow edit                                                                                        | confirmed | `matches.db.test.ts` is the only one; `vitest.db.config.ts:12`; the default run leaves them out (`vitest.config.ts:14`); `package.json:14`; `ci.yml:69-72`                                                                                                                                                                                                                                                                                             | `git ls-files 'src/**/*.db.test.ts'` (1); rule `kind: pair` with key `include` (`vitest.db.config.ts:12`, `vitest.config.ts:11`); grep on the workflow                                                                                                                                                                         |
|   9 | Opportunity 1: the database test casts an untyped `createClient` to `SupabaseClient`, and hand-built clients sit in 8 test files beside the stub's cast                                                              | confirmed | `matches.db.test.ts:68-71`; 11 casts in 8 test files (`auth`, `matches`, `price-refresh`, `price-targets`, `prices`, `shop-gate`, `shop-matching`, and `watchlist` with 4); the stub's at `stub-supabase.ts:227`                                                                                                                                                                                                                                       | `$X as unknown as SupabaseClient` (12); `$X as SupabaseClient` (13: those and the database test's); grep                                                                                                                                                                                                                       |
|  10 | TD-03: `LatestView.name` is a `string`, so a typed `.from()` would need the two view names                                                                                                                           | confirmed | `prices.ts:155` (interface `:154-158`); the two values at `:163`, `:176`                                                                                                                                                                                                                                                                                                                                                                               | rule `kind: property_signature` inside `interface LatestView` (3); `const $V: LatestView = { name: $N, $$$R }` (2)                                                                                                                                                                                                             |
|  11 | Nothing in `src/` sets `throwOnError`, and postgrest-js 2.116.0 answers a failed or aborted request with `{ error }`, `status: 0` and an empty code (Open Question 1; TD-01; TD-10)                                  | confirmed | none in `src/`, `scripts/` or `tests/`; `node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:292-358`, an abort's `code = ''` at `:324-326`                                                                                                                                                                                                                                                                                                    | zero for `$X.throwOnError($$$A)` (control: it matches `PostgrestFilterBuilder.ts:124`), grep; the library read at the cited lines                                                                                                                                                                                              |
|  12 | TD-03: nothing outside `context/` and `docs/` runs `supabase gen types`; CI's smoke job starts the stack without `postgres-meta`                                                                                     | confirmed | no match; `ci.yml:42`                                                                                                                                                                                                                                                                                                                                                                                                                                  | grep (scripts, workflows and `package.json`)                                                                                                                                                                                                                                                                                   |
|  13 | Opportunity 2 (TD-12): the answer's type is shared and checked at both ends                                                                                                                                          | confirmed | `types.ts:272-275`; the route `api/watchlist/prices.ts:6`, `:11`, `:16`; the island `price-comparison-state.ts:27`, `:50`, `:890`                                                                                                                                                                                                                                                                                                                      | rule over `type_identifier` and `identifier` matching `^PriceRefreshAnswer$` (7)                                                                                                                                                                                                                                               |
|  14 | Opportunity 2: the request body is written by hand; `PriceRequest` types only the server's side                                                                                                                      | confirmed | `price-comparison-state.ts:837`; `PriceRequest` at `price-targets.ts:35`, used at `:61` and in `price-targets.test.ts:10`, `:213`; none in `src/components`                                                                                                                                                                                                                                                                                            | `JSON.stringify({ itemId, shop, shopItemId })` (1); rule over `type_identifier` and `identifier` matching `^PriceRequest$` (4 in `price-targets.ts` and its test; 0 in `src/components`, ts and tsx), grep                                                                                                                     |
|  15 | Opportunity 2: the route's 7 codes are a route-local type, against the island's literal `"changed"`                                                                                                                  | confirmed | `api/watchlist/prices.ts:9` (7 members, unexported, used at `:11`); `price-comparison-state.ts:879`                                                                                                                                                                                                                                                                                                                                                    | `type PriceRouteError = $T` (1); zero for `export type PriceRouteError = $T` (control: `export type PriceRefreshCode = $T` matches `price-refresh.ts:132`), grep; `$B.error === "changed"` (1)                                                                                                                                 |
|  16 | Mirrored pair: `REASONS` ↔ `SearchUnavailableReason`, which a subset would also satisfy                                                                                                                              | confirmed | `price-comparison-state.ts:886` (4 literals) ↔ `types.ts:141` (4 members)                                                                                                                                                                                                                                                                                                                                                                              | `const REASONS: readonly SearchUnavailableReason[] = $V` (1); `export type SearchUnavailableReason = $T` (1)                                                                                                                                                                                                                   |
|  17 | Opportunity 2: `saved` is parsed, and no other island code reads it                                                                                                                                                  | confirmed | the only `saved` identifiers in `src/components` are the parser's (`price-comparison-state.ts:901-909`)                                                                                                                                                                                                                                                                                                                                                | zero for `$X.saved` in ts and tsx (control: it finds `refresh.saved`, `api/watchlist/prices.ts:74`); rule for `saved` identifiers (4, all in the parser); grep (the other hits are prose)                                                                                                                                      |
|  18 | Opportunity 2: the parser's round trips cover 2 of the 4 reasons                                                                                                                                                     | confirmed | `busy` and `paused`, `price-comparison-state.test.ts:646-647`; the block's only other `reason` is the failure the parser returns (`:679`)                                                                                                                                                                                                                                                                                                              | rule `kind: pair` with key `reason`, inside the `describe("readRefreshResponse", …)` call (3)                                                                                                                                                                                                                                  |
|  19 | TD-12: the route's tests assert `saved: true`                                                                                                                                                                        | confirmed | `price-routes.test.ts:310`, `:395`                                                                                                                                                                                                                                                                                                                                                                                                                     | rule `kind: pair`, key `saved`, value `true` (2)                                                                                                                                                                                                                                                                               |
|  20 | Opportunity 2: no test joins the two sides; the route's handler is imported only by `price-routes.test.ts`, the parser only by its own test and `PriceComparison.tsx`                                                | refined   | True of the unit tests (`price-routes.test.ts:6`; `PriceComparison.tsx:8`; `price-comparison-state.test.ts:13-18`). The e2e suite does send the island's refetch through the real route on workerd, but with every shop stopped only the `stopped` answer reaches the parser (`tests/e2e/phone-refresh.spec.ts:6`, `:113`), as TD-19 says; every other answer kind stays unjoined                                                                      | `import $$$ from "$M"` over `src` and `tests`; grep for the parser's exports and the route's path                                                                                                                                                                                                                              |
|  21 | Opportunity 2: TD-24's holes on this route, no `missing` answer and no `checkedAt` in its tests                                                                                                                      | confirmed | none in `price-routes.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                         | rule over `kind` pairs whose value is `missing` and over `checkedAt` keys and properties (0; control: 36 in `price-comparison-state.test.ts`), grep                                                                                                                                                                            |
|  22 | Opportunity 2: 11 non-test modules name `SearchUnavailableReason` or `ShopUnavailable`, `src/types.ts` among them; also the classification's "a new reason fans out through 11 modules"                              | confirmed | `types.ts`, `shop-messages.ts`, `product-search.ts`, `match-view.ts`, `shop-matching.ts`, `price-comparison-state.ts`, `shop-outcome.ts`, `pinned-prices.ts`, `luigis-box.ts`, `rossmann.ts`, `super-pharm.ts`; no `.tsx` or `.astro` file                                                                                                                                                                                                             | rule over `type_identifier` and `identifier` matching either name (11 files; 0 in tsx); `git grep -lw` (the same 11)                                                                                                                                                                                                           |
|  23 | Opportunity 2: `islandConfig` allows type imports and lists `shop-messages.ts`, not `src/types.ts`                                                                                                                   | confirmed | `eslint.config.js:148`; `:99`; no `src/types.ts` among its files                                                                                                                                                                                                                                                                                                                                                                                       | `-l js`: rule `kind: pair` with key `allowTypeImports` (`:148`, `:153`); rule `kind: string` naming either file inside the `islandConfig` declarator (1); grep for `"src/types.ts"` (0)                                                                                                                                        |
|  24 | Opportunity 3 (TD-06): two stop-asking loops                                                                                                                                                                         | confirmed | `fetchPinnedPrices`, `pinned-prices.ts:72-122`; `fetchRossmannPrices`, `rossmann.ts:199-229`                                                                                                                                                                                                                                                                                                                                                           | the rules of row 25, anchored on each `function_declaration`                                                                                                                                                                                                                                                                   |
|  25 | Opportunity 3: they share the constant and three helpers, `failuresAfter`, `logRequestsStopped` and `isRefusal`, not the loop                                                                                        | refined   | Four helpers: both loops also call `failed()` (`rossmann.ts:212`; `pinned-prices.ts:81`), beside `FAILED_REQUESTS_BEFORE_STOP` (`:211`; `:104`), `isRefusal` (`:217`; `:113`), `failuresAfter` (`:221`; `:110`) and `logRequestsStopped` (`:226`; `:119`). `isRefusal` reaches both from `shop-outcome.ts` (`rossmann.ts:12`; `pinned-prices.ts:2`). The ranked section's "three helpers" stays as written                                             | rule `kind: identifier` for the shared names, `inside` each `function_declaration` (5 and 7 hits); `import { $$$ } from "$M"`                                                                                                                                                                                                  |
|  26 | Opportunity 3: what counts toward the stop differs; Rossmann counts only requests with no response, the batch loop every request without a readable answer                                                           | confirmed | `rossmann.ts:221`; `pinned-prices.ts:110`, the rule at `:132-137`                                                                                                                                                                                                                                                                                                                                                                                      | the `failuresAfter` hits of row 25's rule                                                                                                                                                                                                                                                                                      |
|  27 | TD-06: the incidental differences; only the batch loop takes each id once, unsendable ids get one count line against one line each, and the stop lines count different totals                                        | confirmed | `pinned-prices.ts:80` against `rossmann.ts:204`; `pinned-prices.ts:86-91` against `rossmann.ts:254-257`; `checks.size` (`pinned-prices.ts:119`) against `ids.length` (`rossmann.ts:226`)                                                                                                                                                                                                                                                               | `for (const $I of new Set($S)) { $$$B }` (1, the batch loop); `for (const id of ids) { $$$B }` (Rossmann's); `logRequestsStopped($$$A)`                                                                                                                                                                                        |
|  28 | TD-06: the stop counters are local to one call and one shop                                                                                                                                                          | confirmed | `let failures = 0` at `pinned-prices.ts:94` and `rossmann.ts:202`, inside the two functions                                                                                                                                                                                                                                                                                                                                                            | `let failures = 0` (2)                                                                                                                                                                                                                                                                                                         |
|  29 | Opportunity 3: the rule is restated in the doc comments of 7 production files, 4 of which write "two"                                                                                                                | confirmed | `pinned-prices.ts` (6 comments), `rossmann.ts:187-198`, `price-refresh.ts:27-33`, `:46-64`, `natura.ts:74-82`, `hebe.ts:85-93`, `luigis-box.ts:100-108`, `super-pharm.ts:168-176`; "two" at `hebe.ts:88`, `luigis-box.ts:103`, `natura.ts:77`, `super-pharm.ts:171`                                                                                                                                                                                    | rule `kind: comment` with regex `in a row` (13 comments in 7 files); the same with `two of its requests in a row` (4); grep                                                                                                                                                                                                    |
|  30 | TD-06: `fetchRossmannPrices` is wired only as the registry's value                                                                                                                                                   | confirmed | `registry.ts:61`, imported at `:12`; never called directly                                                                                                                                                                                                                                                                                                                                                                                             | rule `kind: identifier` matching `^fetchRossmannPrices$` (3: the import, the value, the declaration); zero for `fetchRossmannPrices($$$A)` (control: `fetchRossmannPrice($$$A)`, row 31), grep                                                                                                                                 |
|  31 | Opportunity 3 (TD-17's Rossmann half): `fetchRossmannPrice` wraps the private `requestRossmannPrice`, and its 13 calls are all in `rossmann.test.ts`                                                                 | confirmed | `rossmann.ts:238-240`; 13 calls in `rossmann.test.ts`, 0 in production                                                                                                                                                                                                                                                                                                                                                                                 | `fetchRossmannPrice($$$A)` (13, one file); grep                                                                                                                                                                                                                                                                                |
|  32 | Opportunity 3: the proof is `price-refresh.test.ts`, Rossmann at `:571-839` (Fix A at `:644`), Natura at `:840-920`                                                                                                  | refined   | The blocks are `:571-836` (report: `:571-839`) and `:840-919` (report: `:840-920`); `:837-839` are a blank line and Natura's comment. Fix A's test is `:644-675`. The ranked section stays as written                                                                                                                                                                                                                                                  | `describe($N, $F)` (12 blocks); rule for `it` calls inside the two `describe` calls (Rossmann's tests `:572-835`, Natura's `:848-918`)                                                                                                                                                                                         |
|  33 | Opportunity 3: Rossmann on the batch loop's lines "would change asserted lines (`price-refresh.test.ts:605-638`)"                                                                                                    | refined   | Both loops word their stop line through the same `logRequestsStopped`, so the stop lines asserted at `:603-609` and `:636-640` read the same unless the variant renames Rossmann's event or word. The line the batch loop words differently is an unsendable id's: one count line (`pinned-prices.ts:90`) against Rossmann's line per id, asserted at `price-refresh.test.ts:794`. The ranked path keeps each shop's lines, so its plan doesn't change | `logRequestsStopped($$$A)` and the `logFailure` calls in both loops; the tests read at the cited lines                                                                                                                                                                                                                         |
|  34 | TD-01: one write, two callers; the lookup's call drops its result, inside the step's `try`                                                                                                                           | confirmed | callers `price-refresh.ts:91` and `shop-matching.ts:392`, the only bare `await` statement of the two; `runStep`'s `try` (`:321-327`) → `outcomeOf` (`:322`) → `lookupOutcome` (`:346`) → `:392`                                                                                                                                                                                                                                                        | `recordPriceChecks($$$A)` (2 outside tests); rule: an `expression_statement` holding an `await_expression` of a `recordPriceChecks` call (1); rule `try_statement` inside `runStep` (1); `outcomeOf($$$A)`, `lookupOutcome($$$A)`                                                                                              |
|  35 | TD-01: the lookup's tests make only `watchlist_matches` fail                                                                                                                                                         | confirmed | the two answering stubs, `shop-matching.test.ts:1296` (a throw) and `:1318-1323` (23505), both name `watchlist_matches`; `price_observations` appears only in expectations                                                                                                                                                                                                                                                                             | `stubClient($F)` (2); rule `kind: string` matching `price_observations` inside a `stubClient` call (0; control: the same rule with `watchlist_matches`, 2), grep                                                                                                                                                               |
|  36 | TD-01: the island asks again by construction                                                                                                                                                                         | confirmed | `needsRefetch(null)` is true (`price-comparison.ts:122-124`); a view that looks up has no re-pin (`match-step.ts:73-77`), so `autoRefreshOf` lets the island refetch (`:90-92`; `PriceComparison.tsx:106-111`)                                                                                                                                                                                                                                         | `needsRefetch($$$A)` (the island's call at `PriceComparison.tsx:108`); the functions read at the cited lines                                                                                                                                                                                                                   |
|  37 | TD-04: only the list refresh puts more than one row of a shop into one insert                                                                                                                                        | confirmed | `refreshPrices` has 2 callers, `api/watchlist/prices.ts:71` (`[key]`) and `refresh.ts:59` (`targets.keys`); the product's form takes at most one key per shop (`price-comparison.ts:603-608`); the lookup inserts one row (`shop-matching.ts:392`); `listTargets` hands over every due item (`price-targets.ts:124-138`)                                                                                                                               | `refreshPrices($$$A)` (2); `productPriceKeys($$$A)` (row 39)                                                                                                                                                                                                                                                                   |
|  38 | TD-04, TD-05: the watcher rule is one predicate in both policies and two TypeScript derivations, both leaving out a decision in the product's own shop                                                               | confirmed | `price_observations.sql:89-107`, `:109-127` (the same predicate); `productPriceKeys` (`price-comparison.ts:593-611`, the own shop dropped by `matchedShopsOf`, `:62-64`); `itemInRows` (`price-targets.ts:80-101`, the own shop at `:92-94`)                                                                                                                                                                                                           | grep on the `.sql`; the two functions, found by rows 2 and 39, read at the cited lines                                                                                                                                                                                                                                         |
|  39 | TD-05: `productPriceKeys` has 3 production callers, `itemInRows` serves the island's route, and `onListOf` builds the set a fourth time                                                                              | confirmed | `prices.ts:318`, `price-targets.ts:167`, `price-comparison.ts:638`; `itemInRows` called at `price-targets.ts:48` (`shopItemFor`) and `:63` (`priceTargetFor`); `product-search.ts:233-251`                                                                                                                                                                                                                                                             | `productPriceKeys($$$A)` (3; 0 in tsx), grep on `.astro` (0); `itemInRows($$$A)` (2)                                                                                                                                                                                                                                           |
|  40 | TD-07: the gate's 9 outcomes besides `ok` fold into 4 reasons, a refusal is any reason but `failed`, and neither refresh route, `price-targets.ts` nor `price-refresh.ts` has a `console` call                       | confirmed | `types.ts:21-26` (4 skips, a rate limit, a block, 3 failures); `types.ts:141`; `shop-outcome.ts:33-52`, the counter's skip as `failed` at `:42`; `:10-12`; no `console` call in the four files                                                                                                                                                                                                                                                         | `export type GateOutcome = $T`, `export type SearchUnavailableReason = $T`; zero for `console.$M($$$A)` on the four files (control: `prices.ts:413`), grep                                                                                                                                                                     |
|  41 | TD-08: 12 time-limit constants in 8 files, 4 of them the 2 s database and counter limits; `DEFAULT_TIMEOUT_MS` isn't exported                                                                                        | confirmed | `rossmann.ts:36-37`; `luigis-box.ts:26-27`; `super-pharm.ts:42-43`; `shop-gate.ts:21`, `:26`; `prices.ts:27`; `matches.ts:26`; `watchlist.ts:27`; `price-comparison-state.ts:43`                                                                                                                                                                                                                                                                       | rule `kind: variable_declarator` whose name matches `TIMEOUT` (12; 0 in tsx); zero for `export const DEFAULT_TIMEOUT_MS = $V`, grep                                                                                                                                                                                            |
|  42 | TD-08: every adapter's timer starts in `gate.fetch`'s arguments, before the reservation; the gate's own timer starts after it and alone gives `timeout`                                                              | confirmed | 6 of 6 calls: `rossmann.ts:144-147`, `:259-262`; `luigis-box.ts:130-133`, `:192-195`; `super-pharm.ts:119`, `:260` (the signal from `post`, `:203-214`). The gate reserves at `shop-gate.ts:104`, starts its timer at `:122` and labels at `:136`                                                                                                                                                                                                      | `gate.fetch($S, $U, { $$$A, signal: AbortSignal.timeout($T) })` (4), `gate.fetch($S, $U, post($P, $T))` (2), `gate.fetch($$$A)` (6); `await deps.reserve($S)`; `const timeout = AbortSignal.timeout($T)`; `timeout.aborted ? "timeout" : "network"`                                                                            |
|  43 | TD-08: each of the 7 tests that get `timeout` from a gate sets its limit to 20 ms                                                                                                                                    | refined   | 10 (report: 7): `price-refresh.test.ts:582`, `:704` and `:778` also pass 20 ms and get the gate's `timeout`, asserting only the failed check; `:618` and `:655` let the same limit cut a body off; `super-pharm.test.ts:254` feeds two tests (`:1454`, `:2047`). No test lets the caller's timer fire first, so the point stands. Corrected in place                                                                                                   | rule `kind: pair` with key `timeoutMs` in tests (7); `setup($A, $B, 20)` (3), `gateOver($A, $B, 20)` (2); grep for `reason: "timeout"`; zero for `createShopGate($$$A)` in `shop-outcome.test.ts`, grep                                                                                                                        |
|  44 | TD-08: the middleware's `getUser` has no time limit, and one refetch's bounded part is about 11 s                                                                                                                    | confirmed | `middleware.ts:19-21`; auth-js 2.116.0 asks `/user` with no signal (`GoTrueClient.ts:3245-3270`). 2 + 2 s of reads (`price-targets.ts:85`, `:95`), the request inside the adapter's 4–5 s (row 42), then one 2 s write: a refused request stores no row (`prices.ts:85-91`)                                                                                                                                                                            | `$S.auth.getUser($$$A)` (1); `AbortSignal.timeout($A)` (18 calls, none for `getUser`); the library read                                                                                                                                                                                                                        |
|  45 | TD-09: 5 `logFailure` helpers; 8 sites in `matches.ts` and `watchlist.ts` log an error's message, 2 of them in `record`; 3 loops of "not a list, then each row"                                                      | confirmed | `prices.ts:411`, `watchlist.ts:349`, `matches.ts:621`, `pinned-prices.ts:235`, `rossmann.ts:508`; `watchlist.ts:146`, `:181`, `:246`, `:288`, `matches.ts:316`, `:333`, `:457`, `:525`, with `:316` and `:333` in `record`; `watchlist.ts:184-203`, `matches.ts:574-593`, `prices.ts:355-375`                                                                                                                                                          | rule `kind: function_declaration` named `logFailure` (5); `logFailure($R, $E.message)` (8); rule for `logFailure` calls inside `record` (3, 2 with a message); `if (!Array.isArray($R)) { $$$B }` (5: the 3 loops, `matches.ts:337` on an update's rows, `auth.ts:236` on a claim). See "Three bad patterns"                   |
|  46 | TD-11: one definition and two callers; the button, the product's form and the JSON route don't call it; the request names no tap or automatic refetch                                                                | confirmed | `price-comparison.ts:9`, `:121`; callers `price-comparison.ts:651`, `PriceComparison.tsx:108`; the button `PriceComparison.tsx:129-133`; `priceRequestSchema`'s 3 fields (`price-targets.ts:28-32`)                                                                                                                                                                                                                                                    | rule `kind: identifier` for `REFETCH_AFTER_MS` and `needsRefetch` (ts 4, tsx 2); `needsRefetch($$$A)`; `15 * 60 * 1000` (1); grep on `.astro` (0)                                                                                                                                                                              |
|  47 | TD-13: every offer goes through `storableOffer`, which passes `promoEndsOn` unchecked; Rossmann and Super-Pharm check their dates, Natura and Hebe send none; 3 of the 4 shops' price requests name their attributes | confirmed | `shop-offer.ts:34`; the callers `natura.ts:140`, `hebe.ts:153`, `rossmann.ts:383`, `super-pharm.ts:361`; `rossmann.ts:387` (`dateOf`), `super-pharm.ts:365` (`promoEndOf`); `natura.ts:144`, `hebe.ts:157`; `luigis-box.ts:238` (Natura, Hebe), `super-pharm.ts:248`                                                                                                                                                                                   | `storableOffer($$$A)` (4); rule `kind: pair` with key `promoEndsOn` (6); `params.append("hit_fields", $V)` (1), `["attributesToRetrieve", $V]` (2)                                                                                                                                                                             |
|  48 | TD-13: the offer's mirrored pairs, `ShopOffer`'s 5 fields ↔ the island's `parseOffer` ↔ the row's offer columns; no field added since `dab5b2d`                                                                      | confirmed | `types.ts:218-226`; `price-comparison-state.ts:917`; `prices.ts:38-42`; `git log -L` on `ShopOffer` names `dab5b2d` (2026-09-28) alone                                                                                                                                                                                                                                                                                                                 | rule `kind: property_signature` inside `interface ShopOffer` (5); `const { $$$F } = value` (1); `git log -L`                                                                                                                                                                                                                   |
|  49 | TD-14: `price-refresh.ts`' imports at `:2`, `:7` and `:8` serve only the ways back, and the cycle with `notices.ts` is type-only                                                                                     | confirmed | the 6 names are used only at `:164`-`:198`; `notices.ts:2` is `import type`; `price-refresh.ts:2` imports two parameter names                                                                                                                                                                                                                                                                                                                          | rule over `identifier` and `type_identifier` for the 6 names (14: 6 in the imports, 8 at `:164`-`:198`); `import $$$ from "$M"`                                                                                                                                                                                                |
|  50 | TD-14: of the form routes' 8 code sets, 7 live in `notices.ts` and only `PRICE_REFRESH_CODES` in a service                                                                                                           | refined   | 10 (report: 8): beside the 7 arrays (`notices.ts:13`, `:54`, `:72`, `:127`, `:153`, `:194`, `:226`) and `PRICE_REFRESH_CODES` (`price-refresh.ts:125`), the add route's `WatchlistError` (`watchlist.ts:88`, texts `:91-95`, parser `:102-104`) and the decision route's `MatchError` (`matches.ts:177`, texts `:180-185`, parser `:192-194`) live in services: 3 (report: 1). Corrected in place; see "To decide at the planning stage"               | rule `kind: variable_declarator` whose name ends in `_CODES` (8); `export const $N = [$$$A] as const` (15; the other 7 aren't code sets); grep for exported `…Error` and `…Code` types                                                                                                                                         |
|  51 | TD-14: all 7 way-back builders live in services; both pages import `parsePriceRefreshCode` alone from the service; a page importing a parser from a service is the usual shape                                       | confirmed | `auth.ts:105`, `:187`, `:305`; `matches.ts:206`; `watchlist.ts:309`; `price-refresh.ts:189`, `:197`; `[id].astro:27`, `watchlist.astro:22`; the same pages import `matchErrorMessage`, `removalErrorMessage`, `removalGoneNotice`, `watchlistErrorMessage` and `removedNotice` from services (`[id].astro:19-25`, `:32-39`; `watchlist.astro:28`)                                                                                                      | rule `kind: function_declaration` whose name ends in `BackTo` (7); grep on the `.astro` imports                                                                                                                                                                                                                                |
|  52 | TD-14: `Record<PriceRefreshCode, …>` names every text; the route-path pair                                                                                                                                           | confirmed | `notices.ts:336`, `:348`; the literal at `ListHead.astro:63`, beside `REFRESH_FORM_ROUTE` (`price-comparison-state.ts:40`), under the middleware's prefix (`middleware.ts:9`)                                                                                                                                                                                                                                                                          | `const $N: Record<PriceRefreshCode, $T> = $V` (2); grep on the `.astro`                                                                                                                                                                                                                                                        |
|  53 | TD-15: the list, the list beside every product view and a list refresh read the latest view with no filter but RLS; the view runs `DISTINCT ON` over the whole table, and `price_summaries` is built on it           | confirmed | `listLatestPrices` at `watchlist.astro:46`, `[id].astro:65`, `price-targets.ts:131`; `prices.ts:347-349`; `price_observations.sql:159-161`; `price_history.sql:54`                                                                                                                                                                                                                                                                                     | `listLatestPrices($$$A)` (1 in ts); grep on `.astro` (2) and `.sql`                                                                                                                                                                                                                                                            |
|  54 | TD-16: one TypeScript home per mirrored constant, with copies in SQL, texts, a comment and harnesses                                                                                                                 | confirmed | `price-comparison.ts:9`, `:16`; `product-limits.ts:18-20`; `shop-gate.ts:23-24`, each declared once; copies at `notices.ts:339`, `src/dev/product-page.astro:841`, `price-comparison-state.ts:694-696`, `price-refresh.ts:38-39`, `check-prices-db.mjs:355-371`, `e2e-local-db.mjs:22-23`; the e2e rule equals `watchlist_matches.sql:10`, `:32`, not `price_observations.sql:39`                                                                      | rule `kind: variable_declarator` for the names (one each; `IDS_PER_REQUEST` is a per-client value, 50 and 20); grep on the texts, `.sql`, `.astro` and `.mjs`                                                                                                                                                                  |
|  55 | TD-17: `shopItemFor`'s 11 calls are all in `price-targets.test.ts`, the route calls `priceTargetFor`, and 4 production comments still name it                                                                        | confirmed | 11 in one file; `api/watchlist/prices.ts:61`; `matches.ts:396`, `price-targets.ts:53`, `:75`, `:147`                                                                                                                                                                                                                                                                                                                                                   | `shopItemFor($$$A)` (11); `priceTargetFor($$$A)` (1); rule `kind: comment` matching `shopItemFor` (4)                                                                                                                                                                                                                          |
|  56 | TD-10: nothing catches a fetcher that throws, while the match steps catch per shop                                                                                                                                   | confirmed | no `try` or `.catch` in `price-refresh.ts`; `shop-matching.ts:321-327`; the throw at `shop-gate.ts:92-95`                                                                                                                                                                                                                                                                                                                                              | zeros for `try { $$$A } catch ($E) { $$$B }`, `try { $$$A } catch { $$$B }` and `$P.catch($$$A)` (control: the first finds `shop-matching.ts:321`), grep                                                                                                                                                                       |

### Repository facts the sequencing uses (git, not ast-grep)

|   # | Claim                                                                                                                                        | Verdict   | Evidence                                                                                                                                                                                                                                                                                  | Method                                                                                                                 |
| --: | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
|  57 | The code under `src/`, `supabase/`, `scripts/` and `tests/` is 5eefce2's                                                                     | confirmed | `git diff --stat 5eefce2 cfbb651` over those paths is empty                                                                                                                                                                                                                               | git                                                                                                                    |
|  58 | The route and the island's state module changed together in all 3 of the route's commits; the two loops' files in 4 of `pinned-prices.ts`' 5 | confirmed | `61d1e5b`, `0de341b`, `f630b9e`; `4eb3a95`, `2c4bdde`, `0f9ebc5`, `cc4fdd4` (2026-10-07 and 2026-10-08), not `ed12ad7`                                                                                                                                                                    | `git log -- <file>`, `git show --name-only`                                                                            |
|  59 | M-2 touches no shop adapter                                                                                                                  | confirmed | S-01's, S-02's and S-03's branches change no file under `src/lib/services/shops/` against 5eefce2                                                                                                                                                                                         | `git diff --name-only 5eefce2...<branch>`                                                                              |
|  60 | S-01 is 6 commits ahead of `origin/main` and not merged                                                                                      | refuted   | 6 commits ahead of 5eefce2, the local `origin/main` while this report was written; but pull request #47 merged the branch into `main` as `79ee4e4` at 13:26 +0200 on 2026-10-10, before this report's 13:42, and the local ref caught up at 13:53. Its files are as the report lists them | `git rev-list --count`, `git merge-base --is-ancestor`, `git log origin/main`, `git reflog show origin/main`; no fetch |

### To decide at the planning stage

1. **S-01 is already merged (row 60).** The ranking starts opportunity 2 "once S-01 merges", and so does the Summary's sequencing. That held before this report was written, so the contract test can start now, from `main`, where `src/lib/services/testing/route-context.ts` and `stored-rows.ts` exist. S-01 also changed `matches.ts`, `price-routes.test.ts` and the decision route (`git diff --stat 5eefce2 origin/main`), so this report's anchors in those files hold at `cfbb651`, not on `main`: a plan re-reads them there.
2. **TD-14's outlier (row 50).** "Its codes are the outlier" holds among the `as const` code arrays only. The add and decision routes keep their error codes, texts and parsers in their services (`watchlist.ts:88-104`, `matches.ts:177-194`), so one home for every form route's codes would move three sets, not one, and TD-14's "about 9 files" would grow with them. Its rejection doesn't change.
