# Shop answer contracts (test plan rollout Phase 3) — Plan Brief

> Full plan: `context/changes/testing-shop-answer-contracts/plan.md`
> Research: `context/changes/testing-shop-answer-contracts/research.md`

## What & Why

Rollout Phase 3 of the test plan proves two risks at the shop adapters:

- **Risk #5:** a shop that changes its answer must show as a visible gap, never as a wrong price, "not found" or "missing".
- **Risk #3:** a shop that refuses must be stopped or paused, with nothing more asked of it.

The research found five places (D1–D5) where a changed answer is stored or shown as a fact today. Tests written against today's code would pin those defects, so this phase fixes each one first, then proves the fix on broken copies of the real recordings.

## Starting Point

- **Refusals are handled right everywhere.** Many kinds are proven only in the gate's own tests.
- **Changed answers are a different story:**
  - Rossmann reads any 404 as "product gone" (D1).
  - Natura and Hebe read hits of another type as query suggestions, so a format change becomes "not found" or "missing" (D2, D3).
  - Three searches read an empty answer as "found nothing" even when the shop's count says otherwise (D4).
  - Rossmann's search shows „Brak wyników” when no item could be read (D5).
- **Some renamed values change silently,** with no log line.
- **A failing shop can cost a refresh up to its whole cap.**

## Desired End State

- No changed answer the research traced can store a wrong fact. Each one shows as a gap, proven by a broken copy of a real recording served through the real gate.
- The silent value changes now write a log line.
- A refresh stops asking a shop after two failed requests in a row.
- Every path that reaches a shop pins its refusals by counting the requests served.
- The gate's database check proves two more rules.
- The test plan and `CLAUDE.md` say what shipped.

## Key Decisions Made

| Decision                                        | Choice                                                                                                                                   | Why (1 sentence)                                                                                              | Source   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| Rossmann's 404                                  | Only a 404 with `application/problem+json`, as recorded, means the product is gone; any other 404 is a gap                               | A moved route would otherwise mark every watcher's Rossmann item gone, with the refresh reporting `done`      | Plan     |
| Query suggestions                               | Only a hit with `type: "query"`, the one kind ever recorded, is a suggestion; any other hit that isn't the shop's item counts as dropped | A renamed type must fail the search or price request, not read as "nothing found" or "missing"                | Plan     |
| Silent value changes                            | Log lines only; stored values stay as today                                                                                              | They can't be told from normal answers well enough to refuse a price, but a log line makes a change visible   | Plan     |
| Super-Pharm's rejected key and big batches      | Pin the 403 with Algolia's documented error body, labelled as documented; record both gaps as accepted edges                             | No live request is made, and the gate's rule for a 403 doesn't depend on the body                             | Plan     |
| New recordings                                  | None: broken copies of the existing recordings only                                                                                      | Every live shop request needs the owner's approval, and the copies cover what the research traced             | Plan     |
| Repeated failures                               | A refresh stops asking a shop after two failed requests in a row                                                                         | Bounds what a hanging or unreachable shop costs one refresh at two requests instead of its cap                | Plan     |
| Gate SQL proofs                                 | A refused reservation inserts no row; a shorter report never shortens a longer pause                                                     | They guard the shared cap and pause; the gate's Node tests already pin the rest                               | Plan     |
| Test plan corrections                           | Made in this phase's docs (§2, §6.4, §6.6, §7)                                                                                           | The guide should match what's tested now, not wait for a refresh                                              | Plan     |
| Empty search with a count (D4)                  | Fails unless the shop's own count says 0                                                                                                 | The lesson "never read an unreadable answer as missing", and every recorded empty answer carries a zero count | Research |
| Rossmann search with every item unreadable (D5) | Fails, as the other adapters' searches do                                                                                                | The lesson above; „Brak wyników” would hide a changed format                                                  | Research |

## Scope

**In scope:**

- Small production guards for D1–D5, and the gate passing on a failed answer's content type.
- Log lines for odd availability and unreadable optional prices (Rossmann, Natura, Hebe).
- Broken-copy and refusal tests:
  - Rossmann's search and detail;
  - Natura's and Hebe's search, EAN search and prices;
  - Super-Pharm's search and prices.
- The two-failure stop in a refresh.
- Path tests for a lookup, a re-pin choice, the price route and the refresh.
- Two database proofs in `scripts/check-shop-gate-db.mjs`.
- Updates to the test plan and `CLAUDE.md`.

**Out of scope:**

- **Live shop requests and new recordings,** including Super-Pharm's real rejected-key answer and a 20-id batch.
- **Monitoring or canaries** for a shop index that answers empty, or for a renamed type on a filtered price request.
- **Changes to the matching rule,** such as Super-Pharm's dropped-rival case.
- **A price-unit cross-check,** or a check for Hebe's renamed sale price.
- **A new outcome kind** for an unreachable counter.
- **Changes to e2e tests or the per-shop stop.**

## Architecture / Approach

The work goes one shop family per phase, ordered by what a wrong fact costs: Rossmann (with the one gate change), then Natura and Hebe on the shared Luigi's Box client, then Super-Pharm, then the paths and loops, then the docs. Within each phase, the fix comes first and its proof second: each proof is a broken copy that fails on today's code. Every test goes through the real gate over the replay and counts the requests, POST bodies and reservations it served, never only the outcome. Expected values come from the owner's calls, the PRD's guardrail and the lessons, never from the code under test.

## Phases at a Glance

| Phase                                     | What it delivers                                                                                                             | Key risk                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1. Rossmann's answers (D1, D5)            | Content type on failed answers; only a problem+json 404 is gone; a broken search fails; full broken copies and refusal kinds | Changing a shared gate type touches every caller's tests |
| 2. Natura and Hebe on Luigi's Box (D2–D4) | Only `type: "query"` is skipped; empty searches check their count; Natura's broken-copies block; Hebe's search refusals      | Natura's made-up suggestion test changes its expectation |
| 3. Super-Pharm's answers (D4)             | Empty searches check their counts; the 403 and every refusal kind pinned on both request kinds                               | The 403 body is documented, not recorded                 |
| 4. Paths and refresh loops (risk #3)      | The two-failure stop; refusal and changed-answer tests on every path; two gate SQL proofs                                    | The SQL proofs run only in CI (no Docker here)           |
| 5. Docs and rollout                       | Test plan §2, §3, §6.4, §6.6, §7 and `CLAUDE.md` updated; CI green; owner's review                                           | Docs drifting from what shipped                          |

**Prerequisites:** the worktree `10xcourseproject-wt` on `feat/testing-shop-answer-contracts`, with `npm ci` and `astro sync` done; CI for the database proofs.

**Estimated effort:** ~2–3 sessions across 5 phases, one PR.

## Open Risks & Assumptions

- The Super-Pharm 403 body is Algolia's documented one. If the real answer differs, the gate's rule still holds, since it reads only the status.
- The database proofs can't run on this machine, so their first run is CI's `smoke` job.
- **Assumption:** every empty answer a shop sends carries a zero count, as every recording does. A shop that sends an empty answer without a count would now show a gap instead of "nothing found".

## Success Criteria (Summary)

- Every changed answer the research traced shows as a gap or a failed check, never as a stored price, "not found" or "missing".
- A refused or failing shop is asked nothing more than the plan allows, on every path, counted in the tests.
- CI's `ci`, `smoke` and `e2e` jobs pass, and the owner approves the test plan and `CLAUDE.md` updates.
