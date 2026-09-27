# Polite Shop Access — Plan Brief

> Full plan: `context/changes/polite-shop-access/plan.md`

## What & Why

Every request the app sends to a drugstore shop must be polite:

- no shop gets more than a small, fixed number of requests from the whole deployment
- fetching stops when a shop blocks or asks us to stop

This change builds that single gate (roadmap F-01) before any slice starts calling shops, so the rule holds from the first request.

## Starting Point

Only auth exists. There are no tables or migrations, no `src/lib/services/`, and no test runner. The production Supabase project doesn't auto-grant new tables or functions, but the local CLI stack still does, so a forgotten grant would currently pass CI and fail in production.

## Desired End State

Every later slice fetches from a shop only through `gate.fetch(shop, url)`. The gate:

- allows at most 30 requests per shop in any 60 seconds across the deployment
- pauses a shop after a 429 until its Retry-After has passed
- stops a shop after a 403 or a bot-challenge page until the owner re-enables it
- refuses everything when the counter is unreachable

CI proves both the gate's logic and the database contract, with local grants matching production.

## Key Decisions Made

| Decision                | Choice                                                                                                       | Why (1 sentence)                                                                                             | Source                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------- |
| Where the counter lives | Supabase Postgres, not Cloudflare's rate limiter or a Durable Object                                         | Only a shared database can enforce one deployment-wide limit, and a Durable Object would switch off previews | infrastructure.md     |
| What "per minute" means | Rolling 60 seconds: never more than N in any 60-second span                                                  | Matches the PRD wording literally, so a shop never sees a 2N burst around a minute boundary                  | Plan                  |
| Cap                     | 30 per shop, stored in the database (editable, 1–60)                                                         | Half of the research note's 1-request-per-second guidance, and far above a handful of users' needs           | Plan                  |
| 429 from a shop         | Pause for its Retry-After (15 min if absent), then resume automatically                                      | Honours a rate hint without manual work                                                                      | Plan                  |
| 403 or challenge page   | Stop the shop until the owner re-enables it in the database                                                  | A deliberate block is never pushed past, per the no-circumvention rule                                       | Plan                  |
| At the cap              | Skip immediately; the page shows the last known price                                                        | Pages never hang and Worker requests stay short                                                              | Plan                  |
| Counter unreachable     | Fail closed: no shop call                                                                                    | The cap is a hard project rule and can't be enforced without the counter                                     | Plan (CLAUDE.md rule) |
| User-Agent              | Descriptive `DrogeriaRadar/0.1 (+repo URL)`, always set by the gate                                          | Honest identification, and it already worked with all four shops in the egress probe                         | Research              |
| Checks                  | Vitest unit tests with synthetic responses, plus a CI check of the SQL, RLS and grants on the local Supabase | Catches logic bugs and missing grants before production                                                      | Plan                  |
| Test runtime            | Vitest 5 in Node; no Cloudflare workerd test pool                                                            | That pool needs Vitest 4 and pins an older wrangler                                                          | Research              |

## Scope

**In scope:**

- the migration: `shops` (four rows), `shop_requests`, and the two functions with RLS and grants
- `auto_expose_new_tables = false` locally
- the gate and the host allowlist per shop
- a replay helper for recorded responses
- Vitest setup with its CI step
- the database check script and its CI step
- CLAUDE.md rules
- the production `db push`, run by you

**Out of scope:**

- shop lookups, parsers and real recorded responses (each shop's slice adds its own)
- any UI or status page
- an admin screen
- waiting or retrying
- per-user quotas
- Cloudflare rate-limiting products
- scheduled refresh

## Architecture / Approach

The flow for each call is `slice → gate.fetch(shop, url)`:

1. **Host check:** the gate verifies the URL belongs to that shop.
2. **Reservation:** `reserve_shop_request` locks the shop's row, prunes entries older than 60 seconds, counts, and inserts or refuses.
3. **Shop call:** it calls `fetch` with the honest User-Agent and a timeout.
4. **Classification:** the answer becomes ok, rate-limited, blocked or failed.
5. **Block report:** blocks are recorded with `report_shop_block`, which pauses or stops the shop in the database.

The gate's dependencies are injected, so tests replay synthetic responses and never touch the network or `astro:env`.

## Phases at a Glance

| Phase                          | What it delivers                              | Key risk                                                                                 |
| ------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Database contract           | Migration, local grant parity, DB check in CI | A grant mistake: caught by the CI check once local grants match production               |
| 2. Gate and tests              | `shop-gate.ts`, replay helper, Vitest in CI   | Lint or type friction from the first test files (handled by a test-file ESLint override) |
| 3. Docs and production rollout | CLAUDE.md rules; you run `supabase db push`   | Forgetting `db push` before S-01 ships                                                   |

**Prerequisites:**

- Docker Desktop, only for running the DB check locally (CI runs it anyway)
- a Supabase access token and the database password for `db push`

**Estimated effort:** about 2 sessions across 3 phases; phase 3 is mostly your manual steps.

## Open Risks & Assumptions

- **A stray 403 stops a shop** until you re-enable it in the dashboard. This is accepted as the price of never pushing past a real block.
- **Hebe and Natura share one search host** (Luigi's Box), so at most 60 requests per minute can reach it. This is accepted.
- **Redirects followed by `fetch`** count as one reservation. The API endpoints in scope don't redirect.
- **Assumption:** every future shop request goes through the gate. CLAUDE.md makes it a rule, and review should enforce it.

## Success Criteria (Summary)

- No code path can reach a shop without a reservation. Tests prove the cap, pause, stop and fail-closed behaviour.
- CI fails if the database functions, RLS or grants are wrong, before anything reaches production.
- Production has the migration, and later slices can call `gate.fetch` without re-deciding any politeness rule.
