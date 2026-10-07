# Route and database seams (test plan rollout Phase 2) — Plan Brief

> Full plan: `context/changes/testing-route-and-database-seams/plan.md`
> Research: `context/changes/testing-route-and-database-seams/research.md`

## What & Why

Rollout Phase 2 gives four of the test plan's top risks a test that would catch them breaking where today's tests never look:

- **#1:** the list and the product page could disagree about a stored price.
- **#3:** a route or a page could ask a shop more than it should.
- **#4:** another signed-in user could reach someone's rows through a route.
- **#6:** a stale tab could overwrite a newer decision.

The rules behind each are already well tested. The seams around them are not.

## Starting Point

- **Untested seams:** no unit test reaches a page or a route handler, and part of what the product page and the search page decide sits untested in their `.astro` frontmatter.
- **One user only:** the smoke test signs up one user, and the decision write's protection is proven only through a test stub.
- **A real split:** a price history the product page can't read hides that shop's price there, while the list beside it still shows it.

## Desired End State

- **#1:** a table of mixed and faulty stored states runs through both pages' own code and shows the price verdict the PRD expects on each.
- **#3:** tests call the price routes with a real gate and count every shop request.
- **#4:** in CI, a second real user gets from every route exactly what a missing id gets, and a catalogue check stops any new unprotected table.
- **#6:** the real decision write loses to a newer decision against the real database.

## Key Decisions Made

| Decision                          | Choice                                                                                                                               | Why (1 sentence)                                                                                        | Source   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------- |
| What "the pages agree" means      | The same price verdict on both. An unreadable history only affects the good-price judgement. Four other differences pinned as honest | A shop can't be „Najtaniej” on one page and unread on the other because of data the verdict doesn't use | Plan     |
| Gate hosts                        | Only the hosts the adapters call; a failed block report and odd search text recorded as accepted                                     | A smaller surface at no risk; the other two edges are rare and unproven                                 | Plan     |
| The selected row beside a product | Leave its screen-reader line and chip counts, and record the limit                                                                   | The product's own area is the live source; no UI change in a testing phase                              | Plan     |
| Decision versions, id probe       | Accept both and record them; no migration                                                                                            | Neither shows anyone's data or changes what a shopper sees                                              | Plan     |
| Test plan §2                      | Correct the four risks' cheapest layers now                                                                                          | The plan stays true for the next phases and for `/10x-tdd`                                              | Plan     |
| Where faults for #1 come from     | Stubbed, with no new real-database test                                                                                              | The database refuses odd price rows, so only stubs can produce them                                     | Research |
| Two-user route test               | HTTP on the preview build in CI's `smoke` job, not handler tests                                                                     | Handler tests would skip the middleware, `checkOrigin` and the cache headers                            | Research |
| Proof for the decision write      | Vitest against the local database, through the real `record`                                                                         | The compare-and-swap lives only in the app's query, and a hand copy would drift                         | Research |
| Where database tests run          | Their own Vitest config, one step in the `smoke` job                                                                                 | The end-of-turn hook, CI's `ci` job and this machine have no database                                   | Research |

## Scope

**In scope:**

- **Tests:**
  - a shared stand-in database that answers by table;
  - the two-page table for #1;
  - the price routes' tests, the search decision's and the gate's for #3;
  - the two-user check, the catalogue check and three database-script gaps for #4;
  - the decision write's tests for #6.
- **Guards:** a lint rule against a direct `fetch` in server code.
- **Code:** the history fix and the host narrowing.
- **Docs:** the test plan and `CLAUDE.md`.

**Out of scope:**

- rendering pages in Vitest;
- making the pages agree on decision details, read order, clock or time limits;
- the side list's screen-reader line;
- failing closed after a failed block report;
- stricter search text;
- decision versions;
- an id-grant migration;
- any live shop request, secret key or production run.

## Architecture / Approach

- **Cheapest first:**
  - Phases 1 and 2 use a stubbed database and run everywhere.
  - Phases 3 and 4 use the local stack in CI's `smoke` job only.
- **Negative controls:** every CI-only check has one, so a broken check can't pass by seeing nothing:
  - the catalogue check must first flag a scratch table without RLS;
  - the two-user check must see differences when run as the owner;
  - the decision tests must see one unconditional write overwrite a row.
- **Expected values come from the PRD and the owner's calls,** never from the code under test.

## Phases at a Glance

| Phase                           | What it delivers                                                                                | Key risk                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. Both pages, one stored state | The page's price wiring as functions, the history fix, the two-page table                       | The stand-in's filters must behave like the real queries, or the table proves less |
| 2. Routes ask shops as stated   | Price-route tests with a real gate, the search decision, narrowed hosts, the `fetch` lint guard | Route modules must import cleanly into Vitest (untried here)                       |
| 3. Two users and the catalogue  | The two-user HTTP check, the catalogue check, three script gaps, two CI steps                   | First run only in CI, and must never reach a live shop                             |
| 4. The real decision write      | A database Vitest config, the stale-tab tests, one CI step                                      | First run only in CI                                                               |
| 5. Docs and rollout             | The test plan's §2, §6 and §7, and `CLAUDE.md`                                                  | —                                                                                  |

**Prerequisites:** the merged S-04 and match-by-name review fixes (`main` at `4944e63`). Phases 3 and 4 depend on CI's `smoke` job and its local stack.
**Estimated effort:** about 2 sessions across 5 phases, with phases 3 and 4 proven in CI.

## Open Risks & Assumptions

- **Untried patterns:** calling an Astro route's `POST` from Vitest has never been tried here. If an import fails, the route's body moves into a service, which the test then calls.
- **CI-only proof:** phases 3 and 4 can't run on this machine, which has no Docker, so CI is their first run. Their negative controls are what keep a broken check from passing quietly.

## Success Criteria (Summary)

- A stored price can't read as cheapest on one page and unread on the other, except where the owner chose to let each page answer honestly.
- Every price route and the search page are pinned to the shop requests they're allowed. A second user's request reaches nothing of the first user's, and a new table can't land without its protection.
- A decision from a stale tab is shown to lose against the real database.
