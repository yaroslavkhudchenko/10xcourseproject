<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Polite Shop Access

- **Plan**: context/changes/polite-shop-access/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

- **Automated checks,** rerun on `0d89e43`:
  - `npm run test`: 26/26 passed
  - `npx astro check`: 0 errors
  - `npm run lint`: clean
  - `npm run build`: passed
  - `npx supabase db reset --local`, then `node scripts/check-shop-gate-db.mjs`: 9/9 PASS
  - CI `ci` and `smoke`: green
- **Manual checks:**
  - 1.4 (migration review) and 3.4 (CLAUDE.md review) were done in the session.
  - The owner confirmed 3.2 and 3.3 (the production `db push` and the dashboard check). Neither can be seen from the repository.
- **Plan drift:**
  - Nothing is missing, and none of the plan's guardrails is broken.
  - 4 drifts and 6 additions. All are documented and sound except the separate roadmap commit, which wasn't reported as an adaptation.
- **Constraint for any fix:** production has recorded migration `20260926112205`, so that file is frozen. Any SQL change must go into a new migration.

## Findings

### F1 — Redirects escape the host allowlist and skip the reservation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shop-gate.ts:113 (host check at :77-80)
- **Detail**:
  - The gate copies the caller's `init` and never sets `redirect`, so `fetch` follows redirects by default.
  - A 3xx from an allowed host is followed to any host, carrying the gate's User-Agent and the caller's headers, and every extra hop goes out without a reservation. On the repo's workerd, a default fetch followed a 302 to another host.
  - The host check compares only `hostname`, so `http:`, other protocols, a non-default port and userinfo all pass.
  - The plan accepted "one reservation per call" because the endpoints it covers don't redirect. But research §9 recorded a redirect on the Natura page, and later slices will fetch URLs taken from shop data.
  - So the comment at :79, "never proxies to other hosts", isn't true today.
- **Fix A ⭐ Recommended**: Set `redirect: "manual"` after the `...init` spread, return any 3xx as `failed/http` and log the Location host. In the host check, require `https:`, no port and no userinfo.
  - Strength: The gate then checks and reserves every request it sends, which is its whole promise. The change is a few lines plus two tests.
  - Tradeoff: A slice that meets a redirect has to call the gate again with the final URL.
  - Confidence: HIGH. workerd supports `redirect: "manual"`, and it rejects `"error"` (both verified on the repo's workerd).
  - Blind spot: Unknown whether the Natura page's redirect stays on the same host. Until a slice uses the final URL, it gets `failed/http`.
- **Fix B**: Let the gate follow up to 3 redirects itself. It re-checks each Location host against the shop's list and reserves again for every hop.
  - Strength: Callers never have to handle redirects.
  - Tradeoff: More logic and tests in the gate, and every hop spends a reservation.
  - Confidence: MED. Relative Location values and redirect loops need care.
  - Blind spot: We haven't compared how Node and workerd expose a manual-redirect response.
- **Decision**: FIXED (Fix A): the gate uses `redirect: "manual"`, returns any 3xx as `failed/http` with the Location host logged, and accepts only plain https URLs on the default port without credentials.

### F2 — Any signed-in user can stop or pause a shop directly

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260926112205_polite_shop_access.sql:87 (grants at :126-130)
- **Detail**:
  - Any signed-in user can call `report_shop_block` directly through the Data API:
    - `blocked` stops a shop for everyone until the owner edits `public.shops`.
    - `rate_limited` pauses a shop for up to 24 h.
    - `p_detail` accepts text of any length.
    - Nothing records who made the call.
  - `reserve_shop_request` lets one session use up a shop's cap in the same way. The plan accepts this as part of "no per-user quotas".
  - No user data is exposed.
  - The call needs the user's own session token and the publishable key. The app keeps that key server-side, but Supabase treats it as public.
  - Fully preventing this would need a server-only secret key, which the deploy plan ruled out.
- **Fix A ⭐ Recommended**: Accept this for now. Record it in the plan as an accepted risk, and revisit it before you invite more people.
  - Strength: Nothing new is needed before the merge. It matches the flat, invite-only model and the decision to use only the publishable key.
  - Tradeoff: An invitee acting in bad faith could stop a shop. You'd re-enable it by hand and wouldn't know who did it.
  - Confidence: HIGH. It takes a deliberate, hand-built API call from someone you invited.
  - Blind spot: None significant at 1–3 users.
- **Fix B**: Add a follow-up migration that records `auth.uid()` as the reporter and limits `p_detail`, for example with `left(p_detail, 200)`.
  - Strength: Every stop gets an audit trail and the detail text is bounded, with no change to the architecture.
  - Tradeoff: A second migration, and another `db push` for you to run. It records abuse but doesn't prevent it.
  - Confidence: HIGH. It's one added column plus `create or replace function`.
  - Blind spot: The recorded reporter is whoever's request hit the block, usually an innocent user.
- **Decision**: ACCEPTED (Fix A): recorded as an accepted risk in plan.md, Implementation Notes; revisit before inviting more people.

### F3 — The counter calls have no time limit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shop-gate.ts:160-178
- **Detail**:
  - The two `supabase.rpc` calls have no abort signal.
  - If the connection to Supabase stalls, `gate.fetch` waits with no limit on the Worker side. On the database side only the 8 s `statement_timeout` for `authenticated` applies.
  - The 8 s shop timeout starts only after the reservation.
  - `report()` is awaited too, so a hanging report delays a `blocked` or `rate-limited` result.
  - The plan's "counter unreachable → fail closed" means a quick skip, so pages never hang.
- **Fix**: Add `.abortSignal(AbortSignal.timeout(2000))` to both RPC calls, so a hang ends as `skipped/unavailable` or as a logged report failure. Add a test.
- **Decision**: FIXED: both RPC calls use `.abortSignal(AbortSignal.timeout(2000))`; a test checks that every call gets a signal.

### F4 — Passing the global `fetch` straight into `createShopGate` fails on workerd

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shop-gate.ts:113 (type at :42)
- **Detail**:
  - The gate calls `deps.fetch(...)` as a method.
  - On workerd, the global `fetch` throws "TypeError: Illegal invocation" when called with a different `this`. This was reproduced on the repo's workerd; a detached call works.
  - `shopGateFor` is safe, because it wraps `fetch` in an arrow function.
  - But `createShopGate` is exported with `fetch: typeof fetch`. A later caller that passes `fetch` directly, such as a cron entrypoint for FR-015, would get `failed/network` on every production call, each one spending a reservation, while the Node tests stay green.
- **Fix**: Call it detached (`const { fetch: send } = deps;` … `await send(target, …)`), with a comment explaining why.
- **Decision**: FIXED: `fetch` is called detached; a test checks that it gets no `this`.

### F5 — CI's `latest` Supabase CLI will drop a config key the smoke job relies on

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:35 (with supabase/config.toml:20)
- **Detail**:
  - The installed CLI binary (2.117.0) contains this message: "auto_expose_new_tables is deprecated and will be removed on 2026-10-30. Remove the field or set it to false to adopt the new default of revoking Data API privileges on new entities in the public schema".
  - CI installs `version: latest`, so the removal reaches the required `smoke` job without notice, five days before the 2026-11-04 deadline.
  - If that CLI rejects the key, every PR is blocked.
- **Fix**: Pin the CLI in `ci.yml` to 2.117.0, which also ends the rate-limit flake seen with `latest`. Drop the key once you upgrade to a CLI whose default already revokes.
- **Decision**: FIXED: CI pins the Supabase CLI to 2.117.0.

### F6 — Backoff gaps: a malformed Retry-After pauses for 1 s, and a 503 never pauses

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shop-gate.ts:200-210 and :137-141
- **Detail**:
  - `parseRetryAfter` runs `Date.parse` on any value that isn't plain digits. V8 reads "1.5", "0.5" and "-5" as dates in 2000–2001 (checked in Node 24; workerd also uses V8). Such values give a 1 s pause instead of the documented 900 s.
  - Separately, any 5xx, even a 503 with `Retry-After`, only becomes `failed/http`. Research §7 asks for backoff on both 429 and 5xx, so during a shop outage the deployment keeps sending it up to 30 requests a minute.
- **Fix**:
  - Use the date branch only for values that look like an HTTP date, and use 900 otherwise.
  - Treat a 503 with `Retry-After` like a 429.
  - Add "1.5" and a 503 row to the tests.
- **Decision**: FIXED: only date-shaped Retry-After values are parsed as dates, and a 503 with Retry-After pauses the shop like a 429.

### F7 — The database check never exercises the lock, and it runs against any URL

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/check-shop-gate-db.mjs:7-16, :38-44
- **Detail**:
  - The check reserves one call at a time. Removing `for update` (migration :60) would still pass CI, so the lock that keeps the cap strict under concurrency is untested.
  - The script also changes whatever database `SUPABASE_URL` points at: it creates a user, uses up Rossmann's cap, pauses Natura and stops Hebe. Pointed at production, only the closed sign-up stops it, at the first step.
  - Minor: `requested_at` and the prune cutoff use `now()`, the transaction start. A caller that waited for the lock therefore gets a slot that expires a few milliseconds early. `clock_timestamp()` would be exact, but it needs a new migration.
- **Fix**:
  - Add a concurrent burst: 40 parallel reservations for `super-pharm`, expecting exactly 30 allowed.
  - Refuse to run unless the host is `127.0.0.1` or `localhost`.
- **Decision**: FIXED: 40 parallel reservations must allow exactly 30 (with the lock removed the check fails, 36 allowed), and the script refuses non-local URLs.

### F8 — The adaptations and the early `db push` aren't recorded in the plan

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/polite-shop-access/plan.md; CLAUDE.md:21, :47
- **Detail**:
  - The plan records neither of these; they exist only in code comments, commit messages and this session:
    - the benign additions: the revokes on the tables and the sequence, cancelling unused response bodies, the extra tests, the CLAUDE.md extras and the separate roadmap commit
    - the documented drifts: a challenge header wins over a 429, `paused` without `until` becomes `unavailable`, and `db push` ran from the branch before the merge
  - Production has recorded migration `20260926112205`, so the file is frozen and any SQL fix must be a new migration. The plan doesn't say so.
  - CLAUDE.md has two slips:
    - The Data bullet still requires per-operation, per-role policies on every table, but tables reached only through functions have none by design.
    - The gate bullet states 30, while the live value is the editable `cap_per_minute`.
- **Fix**:
  - Add an "Implementation notes" section to plan.md, before Progress, listing the adaptations and the frozen-migration rule.
  - Reword the two CLAUDE.md sentences ("no grants and no policies"; "30 by default").
- **Decision**: FIXED: plan.md has an Implementation Notes section; CLAUDE.md now says "no grants and no policies" and "30 by default".

### F9 — Three traps for the slices that call the gate

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shop-gate.ts:50-54, :124-129; src/lib/services/testing/replay-fetch.ts:18-20
- **Detail**:
  1. The 8 s timeout also covers reading an `ok` response's body, so `response.json()` can throw a TimeoutError outside `GateOutcome`. Lookups must catch it and show a gap.
  2. Inside the gate, a replay miss becomes `failed/network`, so a wrong fixture URL can make a gap test pass for the wrong reason. Today's tests guard against this with `requestedUrl`.
  3. Any 403 stops a shop for everyone. S-01 will put users' search text into shop URLs, so a user could trigger a WAF 403 with unusual input.
- **Fix**: Carry these into S-01's plan:
  - catch errors while reading the body
  - assert the requested URLs in lookup tests
  - validate search text with zod (allowed characters and length) before it reaches a shop URL
- **Decision**: FIXED: the CLAUDE.md gate bullet tells callers to read ok bodies promptly, assert replayed URLs, and validate search text with zod.

## Triage (2026-09-27)

- **Fixed:** F1 (Fix A), F3, F4, F5, F6, F7, F8, F9
- **Accepted:** F2 (Fix A, recorded in plan.md)
- **Verification:** 34/34 unit tests; each new test went red on deliberately broken code; lint, `astro check` and build pass; the local database check passes 10/10, and fails when the row lock is removed.
