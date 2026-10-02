# Critical Flows in a Real Browser (Test-Plan Phase 1) — Plan Brief

> Full plan: `context/changes/testing-critical-browser-flows/plan.md`
> Research: `context/changes/testing-critical-browser-flows/research.md`

## What & Why

These are the project's first browser tests. Playwright runs them on the workerd production preview, against the local Supabase, with every shop stopped. They protect three test-plan risks:

- **#7:** a phone-flow regression that shows only in a browser.
- **#1:** a stale, ended-promotion, gone or unbuyable price shown as today's cheapest.
- **#2:** code that works in Node but fails on Workers.

The rules are unit-tested in Node, but nothing has yet rendered a page, hydrated an island or posted a form on the production build.

## Starting Point

There is no Playwright, and smoke asserts only status codes. The app calls shops only from the server, through the gate, so the browser can't fake them. The deployment's own stop switch (`public.shops.enabled`) is the one lever, and seeded data supplies every price state.

## Desired End State

`npx playwright test` builds the app, previews it on 4321 and runs six specs at 390 px in Chromium, for a throwaway local user:

- the signed-in list (the seed)
- honest "Najtaniej" marks for four mixed-state products, on both pages
- the refresh with shops stopped, with and without JavaScript
- removing a product, and removing a wrong Natura match

Every run proves it sent no shop request and leaves the shops as it found them. CI's `e2e` job runs the suite on every PR and becomes a required check after the merge.

## Key Decisions Made

| Decision                   | Choice                                                                                                                                                           | Why (1 sentence)                                                                                          | Source                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Keeping shops out          | Stop every enabled shop for the run, marked `e2e`; restore only those; fail on any reserved request                                                              | Recorded answers can't reach the production build, and the stop switch is the deployment's own lever      | Research + Plan               |
| Test users                 | One fresh local user per run, signed in once through the form, with the saved session in every spec; each spec seeds and deletes its own products with fresh ids | Playwright's saved-session pattern, no stored credentials anywhere, about 3 sign-ins per run              | Plan (owner)                  |
| Superuser access           | Local only, `docker exec` on the local database container: stop and restore shops, move a check back 25 h                                                        | The list's most common stale price and the refused refetch on load need it, and it can't reach production | Plan (owner)                  |
| CI                         | A separate `e2e` job; the owner makes it required after the merge                                                                                                | Its own stack, port and sign-in budget, and a red `e2e` says what failed                                  | Plan (owner)                  |
| Browser                    | Chromium only, 390 px with touch                                                                                                                                 | One install and fast runs; the browser-only bugs so far weren't engine-specific                           | Plan (owner)                  |
| No JavaScript              | One spec: the product's refresh as a plain form                                                                                                                  | What a slow phone hits before hydration, and a form post on workerd                                       | Plan (owner)                  |
| Screen-reader gap          | The list's line for a two-shop row with no current price is recorded for S-04, not asserted                                                                      | No product change in a test phase; never assert behaviour that isn't built                                | Plan (owner)                  |
| Re-pin coverage            | "Zmień", then "Anuluj", then "Żaden z nich"; no test-only shop                                                                                                   | Choosing a candidate needs Natura's answer, and a seam would touch the host allow-list                    | Research (test-plan backport) |
| Mark beside a loading shop | Keep the S-03 rule and leave it unasserted                                                                                                                       | Decided and unit-tested, with an open follow-up                                                           | Research (test-plan backport) |
| Seed                       | #2: the signed-in shopper reaches their own list on the preview                                                                                                  | The quickest green, and it proves the binding that `/` answering 200 doesn't                              | Plan                          |
| Expected values            | From the PRD guardrail, US-01, FR-011 and the S-03 decisions                                                                                                     | Values copied from the rule can't catch the rule's bug                                                    | Research                      |

## Scope

**In scope:**

- Playwright with Chromium, the config, the local-only guard and the superuser helper
- the per-run setup, and the teardown that restores the shops
- six specs and their seeding helpers, and the CI `e2e` job
- test-plan §6.3 and §6.6, the CLAUDE.md commands, and the roadmap notes for S-04 and S-07

**Out of scope:**

- choosing another Natura candidate, and unread states (rollout Phase 2)
- the list's "Odśwież ceny"
- a desktop or WebKit project
- pixel snapshots and axe scans
- the screen-reader fix
- production checks (rollout Phase 4)
- app code changes, beyond deliberate breaks that are reverted

## Architecture / Approach

How a run goes:

1. **Setup.** It records the request-log sequence and stops every enabled shop through `scripts/e2e-local-db.mjs`. It signs up the run user, proves Rossmann and Natura answer `stopped`, signs in once through the form, and saves the session.
2. **Specs.** Each spec seeds its own products as that user, refusing to while any shop is enabled. It drives the real pages and waits only for the product's `PriceComparison` island.
3. **Teardown.** It switches back on only the shops it stopped, then checks that the sequence didn't move.

Phase 1 runs `/10x-e2e-setup "#2"` with the plan's overrides, then `/10x-implement`. Phases 3–5 run `/10x-e2e`, and each spec is seen red under a deliberate break.

## Phases at a Glance

| Phase                       | What it delivers                                                                                       | Key risk                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 1. Harness and seed         | Playwright, config, guard, superuser helper, setup and teardown, seed (#2)                             | The setup skill's template (fixed user, every-island wait) overriding the plan |
| 2. CI gate                  | A separate `e2e` job on every PR                                                                       | Making it required before the merge would block other PRs                      |
| 3. Honest prices (#1)       | Seeding helpers; four mixed-state products on the list and product pages                               | Expected values copied from the rule; "yesterday" in UTC                       |
| 4. Refresh on a phone (#7)  | The refused refresh with prices and ages kept, no overflow, visible focus; the same without JavaScript | Tapping before hydration posts the form instead                                |
| 5. Removals on a phone (#7) | Product removal through the confirm; a wrong match declined via the re-pin choice                      | `<summary>`'s role and the double "Usuń z listy" label                         |
| 6. Docs and cookbook        | §6.3 and §6.6, CLAUDE.md, roadmap notes; the after-merge ruleset edit                                  | A cookbook that describes intent instead of what shipped                       |

**Prerequisites:**

- Docker and the local Supabase, with local values in `.env` and `.dev.vars`
- network for the build's fonts
- port 4321 free
- the owner's ruleset edit after the merge

**Estimated effort:** about five sessions: one each for Phases 1, 3, 4 and 5, and half a session each for Phases 2 and 6.

## Open Risks & Assumptions

- **Runtime details checked while exploring:**
  - that Playwright's navigations count as the user's own
  - `<summary>`'s role
  - matching across U+00A0
  - `aria-disabled` actionability
- **Docker coupling.** The superuser helper depends on Docker and the CLI's container name (`supabase_db_<project_id>`).
- **S-07** changes the sign-in form and sign-up. The setup must follow, as the database checks must; this is recorded on the roadmap.
- **Local residue.** Each run leaves a throwaway user and its append-only observations. A killed run leaves the shops stopped until `node scripts/e2e-local-db.mjs restore` or the next teardown.
- **Sign-ins.** About 3 per run, against the local limit of 30 per 5 minutes.

## Success Criteria (Summary)

- A broken phone flow, a dishonest "Najtaniej" or a Workers-only failure turns the PR red before the merge.
- Every run proves it touched only the local stack and reached no shop.
- The next contributor adds an e2e test by following §6.3.
