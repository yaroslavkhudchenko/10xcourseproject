# The database refuses an own-shop decision, and every decision saves at once — Plan Brief

> Full plan: `context/changes/decision-store-backstop/plan.md`
> Research: `context/changes/decision-store-backstop/research.md`

## What & Why

Roadmap M-2's S-02. S-01's guardian refuses a decision in a watched product's own shop, but only on the decision route: a signed-in user's direct database call can still store one. And a decision is saved in two statements, so a product removed between them answers "decided" instead of "gone". This change gives the guardian a database backstop and makes every save, a lookup's and the user's, one atomic statement. It also closes the two findings S-01's review carried here, F3 and F4.

## Starting Point

`record` in `src/lib/services/matches.ts` inserts and, on a conflict, runs a second update narrowed to the expected decision's state and item, not to who decided it. Nothing in the database compares a decision's shop with its product's own shop; it holds three functions, all `security definer`, and no trigger. S-03 merges first and adds `admitLookup` before the lookup's write, so this branch rebases onto `main` with S-01 and S-03 merged.

## Desired End State

A `before insert` trigger refuses a decision in its product's own shop for every caller, and the migration deletes any stored before. Every decision goes through one `security invoker` function, `record_decision`, which replaces the stored decision only while it is the expected one, who decided a match included, and answers `saved`, `decided` or `gone`. A removal never makes a save answer `decided`: the save answers `gone` when the removal's delete comes first, and otherwise what it would answer without the removal. Users see no change, and no shop request is added.

## Key Decisions Made

| Decision                | Choice                                                                                                                          | Why (1 sentence)                                                                                                                       | Source                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Backstop                | A `before insert` trigger, the project's first, reading the product as its caller                                               | No writer changes, so the code still deployed keeps saving from the push to the deploy, and another user's product still answers 23503 | Plan: the owner's call  |
| Save                    | One PL/pgSQL `security invoker` function, `record_decision`: one `insert … values … on conflict … do update … where <expected>` | RLS and the update grant still bind it, and it tells `gone` (only the product's key) from `decided` itself                             | Plan: the owner's call  |
| Old own-shop decisions  | The owner counts them, read-only and grouped by state, before the push; the migration deletes them before adding the trigger    | "A product holds no decision in its own shop" then holds for every row, and no old match keeps an item watched                         | Plan: the owner's call  |
| "Removed during a save" | Either order is accepted, `gone` or `saved`; a save never answers `decided` for a removed product                               | It is what one statement with the user's own rights can promise                                                                        | Plan: the owner's call  |
| Merge order             | S-03 first; S-02 rebases and moves both writers to the one call                                                                 | S-03 has no migration, and the save then takes both admitted writes                                                                    | Plan: the owner's call  |
| Decider (F4)            | The save also expects who decided a match; the guardian's admitted change carries the decider it read                           | A race over an automatic match that became the user's answers `decided`, as the same post without the race does                        | Plan: the owner's call  |
| Race test               | A database test holds the removal open as the local superuser, saves meanwhile and expects `gone`                               | It proves the overlap against the real database, deterministically, in CI                                                              | Plan: the owner's call  |
| Clock                   | The database's `now()` stamps both the insert and the update                                                                    | One clock for every decision                                                                                                           | Plan: the owner's call  |
| The trigger's error     | SQLSTATE 23001 (`restrict_violation`), naming `watchlist_matches_not_own_shop`                                                  | Apart from the shape checks' 23514 and the 23503 read as `gone`, and nothing else raises it on this table                              | Plan                    |
| The decider's place     | On the change's `replaces`, beside the form's own state and item                                                                | The compiler then requires it for every expected match, and it can only narrow the write                                               | Plan                    |
| The catalogue check     | It records each function's security, so `record_decision` stays invoker                                                         | Behaviour alone can't tell an invoker save from a definer one                                                                          | Plan                    |
| F3                      | The route tests pin the call's arguments and the store's outcomes, and `decisionWrites` counts the call                         | The route's hand-off to the store is pinned at last                                                                                    | Research: S-01's review |

## Scope

**In scope:**

- one migration (the delete, the trigger, `record_decision`), the database checks' new refusals and each function's security in the catalogue check;
- `record` as the one call, the decider on the guardian's change, and every writer's tests on the call;
- the database test with a held-open removal, and its helper beside `sql()`;
- the documents, and the owner's count, push, merge and phone check.

**Out of scope:** a database guard for the moves between decisions (parked); a `product_source` column or a `security definer` write path; the first price check in the same statement; a re-read after a save; a generated `Database` type; I-11 and the id probe; the PRD; any change the user sees.

## Architecture / Approach

Schema first, then code. Phase 1 ships the migration and the checks with the store untouched, so CI runs today's two-statement write against the new schema: the proof that production keeps working from the owner's push until the deploy, and after any rollback. Phase 2 turns `record` into one `rpc("record_decision", …)` call with all 16 named arguments. The trigger reads the product as its caller, so another user's product stays invisible and still fails the composite key like an id no one has. A removal whose delete comes first makes the save wait, then start its insert again, which fails that key: `gone`. PostgreSQL's own sources and isolation tests confirm both mechanics, and CI proves them on this schema.

## Phases at a Glance

| Phase                                                                   | What it delivers                                                                                    | Key risk                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. The database refuses an own-shop decision and saves in one statement | The migration and the checks' refusals; CI proves the deployed store against the new schema         | The SQL's locking, RLS and trigger order are provable only in CI        |
| 2. The store saves through one call                                     | `record` as one call, the decider (F4), the call pinned in every writer's tests (F3), the race test | The 2-second limit in the held-open test; S-03's reshaped callers       |
| 3. Documents                                                            | CLAUDE.md, the test plan, the glossary and the roadmap describe the backstop and the save           | A stale sentence left about an own-shop decision                        |
| 4. Ship                                                                 | The owner's count, push from the branch, confirmation, merge and phone check                        | The delete can't be undone; a schema cache that misses the new function |

**Prerequisites:** S-01 merged (it is, PR #47) and S-03 merged into `main`; CI for every database proof, since the coordinator's machine has no Docker; the owner's dashboard access and linked Supabase CLI for the push.
**Estimated effort:** about 3 sessions across Phases 1 to 3, plus the owner's sitting for Phase 4.

## Open Risks & Assumptions

- **S-03's callers.** Phase 2 assumes S-03 keeps `recordLookup` and `recordDecision` as the two writers. If it reshaped them, Phase 2 moves whatever writers it left to the one call and records that; Phase 1's first two criteria check it.
- **Proof only in CI.** The database's behaviour, the overlap's wait and retry, RLS on the upsert and the trigger before the checks, is proven only in CI's `smoke` job.
- **Production's own-shop count is unknown until the owner runs it.** None is expected, and the delete can't be undone.
- **The schema cache.** Supabase reloads it after DDL; if a save fails with PGRST202 after the deploy, the owner reloads it by hand.
- **Timeouts.** A save the store gave up on after 2 s may still commit; as today, the page then says it failed, and a second post reads `decided`.

## Success Criteria (Summary)

- No path, neither a crafted post nor a direct database call, stores a decision in a product's own shop, and the owner's count returns no rows after the push.
- A removal never makes a save answer decided: it reads as gone, or as saved when the save came first, proved in CI with the removal held open.
- The user sees nothing change: the e2e specs pass unchanged, and the phone check saves a decline and a confirmation.
