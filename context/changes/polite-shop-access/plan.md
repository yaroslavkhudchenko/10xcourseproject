# Polite Shop Access Implementation Plan

## Overview

Build the single gate that every request from the deployment to a drugstore shop must pass through. The gate enforces:

- a strict rolling cap of **30 requests per shop in any 60 seconds**, across the whole deployment
- an automatic pause when a shop answers 429
- a hard stop when a shop answers 403 or a bot challenge
- fail-closed behaviour when the counter can't be reached

This is roadmap item **F-01** (Change ID `polite-shop-access`). It unlocks S-01, S-02, S-03, S-05 and S-06, and the verification path "recorded-response checks for every shop lookup".

## Current State Analysis

- **No data layer.** There is no `supabase/migrations/` and there are no tables. The production Supabase project (Frankfurt) was created with "Automatically expose new tables" off and "Enable automatic RLS" on.
- **Local and production grants differ.** The local CLI stack (2.117) still auto-exposes new tables and functions, because `[api].auto_expose_new_tables` is unset in `supabase/config.toml`. A migration that forgets a `GRANT` would pass locally and in CI, then fail in production.
- **The Supabase client already exists.** `src/lib/supabase.ts:5-20` builds a per-request client from the signed-in user's cookies, so it runs as role `authenticated`. It returns `null` when the env is missing; that's the null-client contract in CLAUDE.md.
- **The standard homes don't exist yet.** CLAUDE.md names `src/lib/services/` (business logic) and `src/types.ts` (shared types); neither exists.
- **No test runner.** In `.github/workflows/ci.yml`, the `ci` job runs `npm ci` → `astro sync` → lint → `astro check` → build. The `smoke` job starts a local Supabase (`supabase start -x …`), builds, and runs `scripts/smoke.mjs`.
- **Lint applies to everything.** ESLint's `strictTypeChecked` config covers every TS file, so future `*.test.ts` files too. `.claude/` is ignored by ESLint and excluded from `tsconfig.json`.
- **Shop egress is verified.** Research note §9: Rossmann, Hebe, Super-Pharm and Drogerie Natura answer traffic from the Worker; dm refuses it and is out of the MVP.
- **Politeness guidance.** Research note §7 asks for at most 1 request per second per host, a descriptive User-Agent, and backing off on 429 and 5xx.

## Desired End State

- **One additive migration** creates `public.shops` (four seeded rows) and `public.shop_requests`.
  - RLS is enabled on both, and no API role gets any table grant.
  - Two `security definer` functions can be executed only by `authenticated`: `reserve_shop_request` and `report_shop_block`.
- **Local config mirrors production.** `supabase/config.toml` sets `auto_expose_new_tables = false`, so a missing grant fails in CI, not in production.
- **The gate exists.** `src/lib/services/shop-gate.ts` exports the gate, and every shop request in later slices goes through it.
- **Verification runs in CI.** `npm run test` (Vitest) runs in the `ci` job. The `smoke` job runs `scripts/check-shop-gate-db.mjs` against the local Supabase, covering SQL, RLS and grants.
- **Production has the migration,** applied by the owner with `npx supabase db push`.

How to verify: CI is green on the PR (lint, check, test, build, and smoke with the DB check). After `db push`, the Supabase dashboard shows the two tables, four shop rows and both functions, and the Security Advisor shows no errors.

### Key Discoveries:

- `src/lib/supabase.ts:6-8`: `createClient` returns `null` without `SUPABASE_URL`/`SUPABASE_KEY`, so the gate must treat `null` as "unavailable" and make no shop call.
- `src/middleware.ts:7-16`: the client carries the user's session, so RPC calls run as `authenticated`. That's the only role the functions are granted to.
- **Hosted "auto-expose off"** revokes the default table, sequence and function privileges from `anon`, `authenticated` and `service_role` (Supabase changelog 45329; supabase/cli PR #5239, which mirrors cloud creation). So:
  - tables reached only through `security definer` functions need no grants
  - each function needs an explicit `grant execute … to authenticated`
- **Postgres grants `EXECUTE` to `PUBLIC` on every new function,** so each function also needs `revoke execute … from public, anon`.
- **CLI 2.117** reads `[api].auto_expose_new_tables`; unset means auto-expose (supabase/cli `packages/config/src/api.ts`, PR #6337). Setting it to `false` mirrors production.
- **`supabase start` / `db reset`** apply `supabase/migrations/*.sql`. `supabase db push` applies migrations only and never `config.toml`; CLAUDE.md forbids `config push`.
- **Vitest 5.0.2** peers `vite ^8` (installed: 8.3.0) and supports Node 24.
- **`@cloudflare/vitest-pool-workers` 0.22.0** needs `vitest ^4.1` and pins wrangler 4.124.0, so it isn't used.
- **`astro:env/server` doesn't resolve in plain Vitest,** so the gate's core must not import `@/lib/supabase`; its dependencies are injected.
- **Lint and test-discovery gotchas:**
  - `@typescript-eslint/unbound-method` (strictTypeChecked) false-positives on `expect(mock.fn)` assertions, so it's turned off for test files.
  - Vitest's default include would also run the 10x CLI's `.claude/skills/*/scripts/*.test.mjs`, so the include is limited to `src/**/*.test.ts`.

## What We're NOT Doing

- **No shop lookups yet:** no lookups, adapters, parsers or real recorded shop responses. Each shop's slice (S-01, S-02, S-05, S-06) adds its lookup and records its own fixtures.
- **No UI:** no shop status page (FR-014 is parked), and no "paused" or "stopped" indicators. S-03 decides how gaps are shown.
- **No admin screen:** the owner re-enables a stopped shop by editing its `shops` row in the Supabase dashboard (flat roles).
- **No waiting or retries:** requests don't queue at the cap, and failed shop requests aren't retried automatically.
- **No per-user quotas** and no fairness between users.
- **No Cloudflare rate limiting:** no Rate Limiting binding, KV or Durable Objects (`context/foundation/infrastructure.md`).
- **No in-runtime tests or scheduling:** no workerd test pool (incompatible today) and no scheduled refresh (FR-015 is parked).
- **Redirects aren't counted separately:** the gate counts one reservation per call.

## Implementation Approach

**Database first.** The request log and shop state live in Postgres, so every Worker instance, data centre and user shares one view. That's the only place a deployment-wide rolling limit can be exact.

**The gate is a small module with injected dependencies:** `fetch`, `reserve`, `reportBlock` and a logger. A thin binding wires those to a Supabase client, which keeps `astro:env` and the network out of unit tests.

**CI checks both halves.** Vitest covers the gate's logic. A Node script against the local Supabase covers SQL, RLS and grants, after local grants are made to match production.

## Critical Implementation Details

- **Timing & lifecycle:**
  - `reserve_shop_request` must take the shop's row lock (`select … for update`) before it prunes, counts and inserts. Without the lock, two concurrent callers can both count 29 and both insert, which breaks "never more than 30 in any 60 seconds".
  - The gate reserves before it touches the network. A refused or failed reservation returns without any shop call.
- **State sequencing:** the gate classifies the shop's answer first and reports a block second. It returns the classified outcome even when the report fails (log that failure), and it never retries the shop call within the same gate call.

## Phase 1: Database contract

### Overview

Create the shop state and the rolling request log with their two functions, make local grants match production, and prove the contract in CI against the local Supabase.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_polite_shop_access.sql`

**Intent**: Add the shared, deployment-wide state the gate needs: which shops exist, their caps and pause or stop state, plus the recent requests per shop. Reach it only through two functions.

**Contract**:

- **`public.shops`:**
  - `id text primary key`
  - `name text not null`
  - `cap_per_minute integer not null default 30`, with a check that it's between 1 and 60 (60 is the research note's 1-request-per-second upper bound)
  - `enabled boolean not null default true`
  - `paused_until timestamptz`
  - `disabled_reason text`
  - `disabled_at timestamptz`
  - `updated_at timestamptz not null default now()`
  - Seeded rows: `rossmann` (Rossmann), `hebe` (Hebe), `super-pharm` (Super-Pharm), `natura` (Drogerie Natura). No dm row.
- **`public.shop_requests`:** `id bigint generated always as identity primary key`, `shop_id text not null references public.shops(id)`, `requested_at timestamptz not null default now()`, and an index on `(shop_id, requested_at)`.
- **Access:** both tables get `enable row level security`, with no policies and no grants to `anon`/`authenticated`. Add a table comment saying that access goes through the functions only.
- **`public.reserve_shop_request(p_shop_id text) returns jsonb`** runs `security definer` with `set search_path = ''` and uses fully-qualified names. In this order:
  1. Lock the shop row.
  2. Return an outcome if the shop can't be used: missing → `{"outcome":"unknown_shop"}`; `enabled = false` → `{"outcome":"stopped"}`; `paused_until > now()` → `{"outcome":"paused","until":<paused_until>}`.
  3. Delete this shop's `shop_requests` rows older than 60 seconds.
  4. If the remaining count is `>= cap_per_minute`, return `{"outcome":"capped"}`.
  5. Otherwise insert one row and return `{"outcome":"allowed"}`.
- **`public.report_shop_block(p_shop_id text, p_kind text, p_retry_after_seconds integer default null, p_detail text default null) returns void`** also runs `security definer` with `set search_path = ''`:
  - `rate_limited` sets `paused_until` to the later of the current value and `now()` plus the retry delay. The delay defaults to 900 seconds and is clamped to 1–86400.
  - `blocked` sets `enabled = false`, `disabled_reason = coalesce(p_detail, 'blocked')` and `disabled_at = now()`.
  - Both bump `updated_at`.
  - Any other `p_kind`, or an unknown shop, raises an exception.
- **Privileges:** for both functions, `revoke all on function … from public, anon;` then `grant execute on function … to authenticated;`. No table grants to any API role.

#### 2. Local grant parity

**File**: `supabase/config.toml`

**Intent**: Make the local and CI database stop auto-granting new tables and functions, exactly like the production project, so a missing grant fails before production.

**Contract**: In the `[api]` section, add `auto_expose_new_tables = false` with a one-line comment that it mirrors the hosted project's setting.

#### 3. Database contract check

**File**: `scripts/check-shop-gate-db.mjs`

**Intent**: Prove the migration's behaviour, including grants and RLS, against a running Supabase. It follows the PASS/FAIL style of `scripts/smoke.mjs`.

**Contract**:

- **Setup:** reads `SUPABASE_URL` and `SUPABASE_KEY`, uses `@supabase/supabase-js` (already a dependency), and signs up a throwaway user, since local sign-up is enabled.
- **Assertions:**
  1. Thirty `reserve_shop_request('rossmann')` calls return `allowed`, and the 31st returns `capped`.
  2. The same call without a session fails, because `anon` has no execute grant.
  3. A direct select on `shops` and on `shop_requests` as the signed-in user fails with a permission error.
  4. After `report_shop_block('natura','rate_limited',120)`, reserving `natura` returns `paused` with `until` about 120 seconds ahead.
  5. After `report_shop_block('hebe','blocked',null,'HTTP 403')`, reserving `hebe` returns `stopped`.
  6. Reserving `dm` returns `unknown_shop`.
- **Result:** the script exits 1 on any failure. Rerunning it locally needs `npx supabase db reset` first, because the rows it creates persist.

#### 4. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Run the database contract check on every push and PR against the fresh local Supabase that the `smoke` job already starts.

**Contract**: add a step named "Check shop gate database contract" to the `smoke` job, after "Configure secrets for build and preview". It sources `supabase.env` and runs `node scripts/check-shop-gate-db.mjs` with `SUPABASE_URL=$API_URL` and `SUPABASE_KEY=$ANON_KEY`.

### Success Criteria:

#### Automated Verification:

- CI smoke job applies the migration on a fresh local Supabase and the "Check shop gate database contract" step passes
- With Docker running: `npx supabase db reset` then `node scripts/check-shop-gate-db.mjs` prints only PASS lines
- `npm run lint` passes

#### Manual Verification:

- Migration review: no table grants to API roles; both functions `security definer` with `search_path = ''`; execute revoked from `public`/`anon`, granted to `authenticated` only

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Gate and tests

### Overview

Add the gate module, which every later shop lookup must use, the project's first unit-test runner, and tests that pin every gate outcome using synthetic shop responses.

### Changes Required:

#### 1. Shared shop types

**File**: `src/types.ts`

**Intent**: Give shop ids and gate outcomes one shared definition, so later slices and the database seed agree.

**Contract**:

- `ShopId = "rossmann" | "hebe" | "super-pharm" | "natura"`, matching the `public.shops` seed ids.
- `GateOutcome`, a discriminated union on `kind`:
  - `{ kind: "ok"; response: Response }`
  - `{ kind: "skipped"; reason: "capped" | "paused" | "stopped" | "unavailable"; until?: string }`
  - `{ kind: "rate-limited"; retryAfterSeconds: number }`
  - `{ kind: "blocked"; status: number }`
  - `{ kind: "failed"; reason: "timeout" | "network" | "http"; status?: number }`

#### 2. The gate

**File**: `src/lib/services/shop-gate.ts`

**Intent**: Every outbound shop request goes through `gate.fetch`, which reserves a slot, calls the shop with an honest User-Agent and a timeout, classifies the answer, and reports blocks. This is the one place the politeness rules live.

**Contract**:

- **`SHOP_HOSTS`** (`Record<ShopId, readonly string[]>`, lowercase hostnames):
  - `rossmann` → `www.rossmann.pl`
  - `hebe` → `www.hebe.pl`, `live.luigisbox.com`, `scripts.luigisbox.com`
  - `natura` → `www.drogerienatura.pl`, `live.luigisbox.com`
  - `super-pharm` → `www.superpharm.pl`, `ep43qpdx9q-dsn.algolia.net`
- **`createShopGate(deps)`** takes `deps = { reserve(shopId), reportBlock(shopId, kind, retryAfterSeconds?, detail?), fetch, timeoutMs?, log? }` and returns `{ fetch(shopId, url, init?): Promise<GateOutcome> }`. `timeoutMs` defaults to 8000; `log` defaults to one JSON line via `console.warn`.
- **`shopGateFor(supabase: SupabaseClient | null)`** binds `reserve`/`reportBlock` to `supabase.rpc("reserve_shop_request" | "report_shop_block", …)` and `fetch` to `globalThis.fetch`, looked up at call time so tests can stub it. With `null`, it returns a gate whose every call yields `skipped/unavailable` without touching the network.
- **Rules, in order:**
  1. A URL whose hostname isn't in `SHOP_HOSTS[shopId]` throws a `TypeError` before anything else. This is a programming error, and the gate must never act as an open proxy or count against the wrong shop.
  2. `reserve` rejects or returns an RPC error → `skipped/unavailable` (fail closed). An outcome other than `allowed` → `skipped` with that reason, plus `until` for `paused`. `unknown_shop` → `skipped/unavailable` and logged.
  3. Call `fetch` with the caller's `init`, but always set the header `User-Agent: DrogeriaRadar/0.1 (+https://github.com/yaroslavkhudchenko/10xcourseproject)` and a timeout signal (combined with the caller's signal if one is given).
  4. Classify the answer:
     - `429` → call `reportBlock("rate_limited", seconds)` → `rate-limited`. The seconds come from `Retry-After`, as delta-seconds or an HTTP date, default 900, clamped to 1–86400.
     - `403`, or any response with the header `cf-mitigated: challenge` → call `reportBlock("blocked", undefined, "HTTP <status>" | "challenge")` → `blocked`.
     - `2xx` → `ok`.
     - Any other status → `failed/http` with the status.
     - A timeout → `failed/timeout`; any other thrown error → `failed/network`.
  5. A failing `reportBlock` is logged and does not change the returned outcome.
  6. Every outcome other than `ok` is logged once.

#### 3. Replay helper for recorded responses

**File**: `src/lib/services/testing/replay-fetch.ts`

**Intent**: Provide the mechanism later slices use to test shop lookups against recorded shop responses, never live shops. Here it's used with synthetic responses only.

**Contract**:

- `createReplayFetch(entries)` takes `{ url, status, headers?, body? }` records and returns a `fetch`-compatible function that answers each recorded URL with the matching `Response`.
- It throws on any unrecorded URL, so a test can never reach the network.
- A recorded entry can simulate a timeout or network error with `{ url, error: "timeout" | "network" }`.

#### 4. Test runner

**Files**: `package.json`, `vitest.config.ts`, `eslint.config.js`, `.github/workflows/ci.yml`

**Intent**: Add the project's first unit-test runner, scoped to project code, and gate CI on it.

**Contract**:

- `package.json`: devDependency `vitest` `^5.0.2`, and the script `"test": "vitest run"`.
- `vitest.config.ts`: `test.include: ["src/**/*.test.ts"]` and `environment: "node"`, with `resolve.alias` mapping `@` to `./src`.
- `eslint.config.js`: a block for `**/*.test.ts` that turns off `@typescript-eslint/unbound-method`.
- `ci.yml`: in the `ci` job, a step `npm run test` after `npx astro check`.

#### 5. Gate tests

**File**: `src/lib/services/shop-gate.test.ts`

**Intent**: Pin every gate rule with synthetic responses served by the replay helper, so a regression in politeness fails CI.

**Contract**: one test per rule:

- **Reservation:**
  - `allowed` + 200 → `ok`, and the request carried the descriptive User-Agent.
  - `capped`, `paused` (with `until`) or `stopped` → `skipped`, with no fetch.
  - `reserve` throws → `unavailable`, with no fetch.
  - `shopGateFor(null)` → `unavailable`.
- **Rate limits:** a 429 with `Retry-After: 120` → `rate-limited` 120, with `reportBlock` called. A 429 with an HTTP-date `Retry-After` gives the computed seconds; a 429 without the header gives 900.
- **Blocks:** a 403 → `blocked`, with `reportBlock("blocked")`. A 503 carrying `cf-mitigated: challenge` → `blocked`.
- **Failures:** a 500 → `failed/http` with no report. A timeout → `failed/timeout`; a network error → `failed/network`.
- **Guards:** a foreign host throws before `reserve` is called. A rejecting `reportBlock` leaves the outcome unchanged.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, covering every gate outcome
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes
- CI `ci` job runs `npm run test` and is green on the PR

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Docs and production rollout

### Overview

Make the gate the documented way to reach a shop, document the new commands and the migration workflow, and put the migration on the production database.

### Changes Required:

#### 1. Project rules

**File**: `CLAUDE.md` (project section only, above the 10x-cli block)

**Intent**: Future sessions must reach shops only through the gate and know how to test it and ship migrations.

**Contract**:

- **Commands:** replace the "Tests: no unit or e2e runner is installed" bullet with:
  - `npm run test` (Vitest over `src/**/*.test.ts`); a single test runs with `npx vitest run <file> -t "<name>"`
  - `node scripts/check-shop-gate-db.mjs`, which needs `npx supabase start`; run `npx supabase db reset` before a rerun
- **Non-negotiables,** shop-fetch bullet: add "every shop request goes through `src/lib/services/shop-gate.ts`; never call `fetch` on a shop host directly".
- **Data** bullet:
  - migrations reach production only through the owner-run `npx supabase link` then `npx supabase db push`, never `config push`
  - local `config.toml` mirrors production grants (`auto_expose_new_tables = false`)

#### 2. Production migration (owner)

**Where**: the owner's terminal, from an up-to-date `main` after the PR merges.

**Intent**: Apply the migration to the production database. Production migrations are human-run (`context/foundation/infrastructure.md`, Approval).

**Contract**:

1. `npx supabase login`
2. `npx supabase link --project-ref <ref>`
3. `npx supabase db push`, which prompts for the database password

The deployed code may land before this, because no route calls the gate yet. S-01 must not ship before it.

### Success Criteria:

#### Automated Verification:

- CI `ci` and `smoke` jobs are green on the PR after the documentation changes

#### Manual Verification:

- Owner applied the migration to production with `npx supabase db push` and it reported success
- Supabase dashboard shows 4 `shops` rows (cap 30, enabled) and both functions; Security Advisor shows no errors
- CLAUDE.md updates reviewed: gate rule, test commands, migration workflow

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- **The gate:** every outcome listed in Phase 2, change 5, driven by the replay helper with synthetic responses.
- **Key edge cases:**
  - `Retry-After` given as seconds, as an HTTP date, or missing
  - a challenge header on a non-403 status
  - a failed block report
  - a foreign host
  - an unreachable counter (fail closed)

### Integration Tests:

- **`scripts/check-shop-gate-db.mjs`** in the CI `smoke` job, against a fresh local Supabase whose grants match production. It covers:
  - the strict cap of 30 then refusal
  - `anon` being denied
  - the tables being unreachable directly
  - pause, stop and unknown shop

### Manual Testing Steps:

1. Read the migration and check the grants and `search_path` against the Phase 1 manual criterion.
2. After `db push`, open the Supabase dashboard: Table Editor → `shops` should have 4 rows (cap 30, enabled). Database → Functions should list both functions.
3. Open Advisors → Security in the dashboard. Expect no errors: a warning that `authenticated` can execute `security definer` functions is intended, and so is the info that the tables have RLS enabled without policies.

## Performance Considerations

- **Each gated call adds one database round trip** from the Worker to Frankfurt, about tens of milliseconds. S-03 reserves for its shops in parallel.
- **The row lock is per shop,** so it serialises reservations for the same shop only.
- **Pruning keeps `shop_requests` small,** at roughly the cap's worth of rows per shop.
- **CPU cost is small:** a JSON parse of the RPC result and no body parsing in the gate.

## Migration Notes

- **First, additive migration.** It only creates new objects and there's no existing data. Rolling back means dropping the two functions and two tables.
- **Order in production:** the code can merge before `db push`, because nothing calls the gate yet. `db push` must happen before S-01 ships.
- **Never `supabase config push`:** it would push `enable_signup = true` to production (CLAUDE.md).

## References

- Roadmap item: `context/foundation/roadmap.md` (F-01 `polite-shop-access`)
- PRD non-functional requirement "Polite to the shops" and Open Question 6: `context/foundation/prd.md`
- Politeness guidance and egress results: `docs/research/polish-drugstore-price-apis.md` §7, §9
- Counter placement decision: `context/foundation/infrastructure.md` (Risk Register, "Rate Limiting binding never enforces the deployment-wide per-shop cap")
- Null-client contract: `src/lib/supabase.ts:5-20`; per-request client: `src/middleware.ts:7-16`
- CI jobs: `.github/workflows/ci.yml`
- Supabase: changelog 45329 (tables no longer exposed automatically); supabase/cli PR #5239 and #6337 (`auto_expose_new_tables`); database linter rules 0011, 0028, 0029
- PostgreSQL `INSERT` / `SELECT … FOR UPDATE` locking semantics (postgresql.org docs)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database contract

#### Automated

- [ ] 1.1 CI smoke job applies the migration on a fresh local Supabase and the "Check shop gate database contract" step passes
- [x] 1.2 With Docker running: `npx supabase db reset` then `node scripts/check-shop-gate-db.mjs` prints only PASS lines
- [x] 1.3 `npm run lint` passes

#### Manual

- [x] 1.4 Migration review: no table grants to API roles; both functions `security definer` with `search_path = ''`; execute revoked from `public`/`anon`, granted to `authenticated` only

### Phase 2: Gate and tests

#### Automated

- [ ] 2.1 `npm run test` passes, covering every gate outcome
- [ ] 2.2 `npx astro sync && npx astro check` reports 0 errors
- [ ] 2.3 `npm run lint` passes
- [ ] 2.4 `npm run build` passes
- [ ] 2.5 CI `ci` job runs `npm run test` and is green on the PR

### Phase 3: Docs and production rollout

#### Automated

- [ ] 3.1 CI `ci` and `smoke` jobs are green on the PR after the documentation changes

#### Manual

- [ ] 3.2 Owner applied the migration to production with `npx supabase db push` and it reported success
- [ ] 3.3 Supabase dashboard shows 4 `shops` rows (cap 30, enabled) and both functions; Security Advisor shows no errors
- [ ] 3.4 CLAUDE.md updates reviewed: gate rule, test commands, migration workflow
