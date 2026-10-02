<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Critical Flows in a Real Browser (Test-Plan Phase 1)

- **Plan**: context/changes/testing-critical-browser-flows/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5, 6
- **Date**: 2026-10-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

Phase 6 is complete except its after-merge row 6.5, the ruleset's `e2e` check, which stays open by design. The automated criteria were re-run on the final tree:

- lint: 0 problems
- `astro check`: 0 errors, 0 warnings
- unit tests: 1171 passed
- the e2e suite from a cold server: 8 passed, 0 products left, the shop request log unmoved
- CI green (`ci`, `smoke`, `e2e`) on every phase's commit and on the epilogue `02304d2`

The owner confirmed the manual rows 1.8, 3.6 and 6.6 in the session.

The plan-drift pass found no drift and nothing missing. The two extra modules, `tests/e2e/support/run.ts` and `pages.ts`, are recorded in Implementation Notes. No file under `src/` changed, and the `ci` and `smoke` jobs and the CLAUDE.md course block are byte-identical.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Overlapping runs release each other's shop hold

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/e2e-local-db.mjs:12,110-124; tests/e2e/auth.setup.ts:14-18; tests/e2e/shops.teardown.ts:8
- **Detail**:
  - Every run and the manual `stop` mark the shops they hold with the same `disabled_reason = 'e2e'`, and the setup goes ahead when the shops are already held.
  - A second run against the same local stack therefore proceeds: another worktree, an agent's single-spec run, or the playwright-cli hold. Then the first run's teardown, or a `restore`, re-enables every `e2e` row while the second run is still going. That run's later page views ask live shops, about 8 requests: the refetches on load, the refresh taps and the re-pin's search.
  - In one checkout, the second setup also overwrites `run.json`, so the first teardown compares against the wrong mark.
  - CLAUDE.md and test-stack.md say the teardown re-enables "only the shops the run stopped", which the code doesn't do.
- **Fix A ⭐ Recommended**: a per-run hold.
  - The config sets a run token (`process.env.E2E_RUN ??= randomUUID()`), which the workers inherit.
  - The setup refuses while any shop carries an e2e hold, pointing to `restore` for a stale one. It then stops the shops with `e2e:<token>` and records the token in `run.json`.
  - The teardown restores only `e2e:<token>` rows, and fails unless `run.json` carries its token.
  - The command line holds with `e2e:manual`, and `restore` stays the escape hatch for every e2e hold. The docs follow.
  - Strength: the stop holds for any number of overlapping runs and holds, and a stale hold becomes a visible error instead of a silent release.
  - Tradeoff: about 40 lines across the helper, setup, teardown and config, plus a re-verification that includes a deliberate overlap.
  - Confidence: MED — it relies on Playwright passing the main process's environment to its workers, which is the standard fork behaviour; the run would confirm it.
  - Blind spot: after an interrupted run, the next run refuses until `restore`. That's intended, but it's one more step for the developer.
- **Fix B**: document "one e2e run per local stack at a time" and accept the risk.
  - Strength: no code.
  - Tradeoff: it relies on discipline, and parallel agents and worktrees can still break the stop.
  - Confidence: HIGH that it's cheap; LOW that it prevents the leak.
  - Blind spot: agents that don't read CLAUDE.md before running a spec.
- **Decision**: FIXED via Fix A — a per-run hold: the config names each run (`E2E_RUN`); the setup refuses while any e2e hold exists, then stops the shops as `e2e:<run>` and records them; the teardown restores only its own and fails unless it restored exactly those; `stop` holds as `e2e:manual` and refuses while held; `restore` releases every e2e hold. Proven: a manual hold made a run refuse and survived it.

### F2 — The local-only guard misses dotenv forms that wrangler accepts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/e2e-local-db.mjs:24-30 (also :52-54, :72)
- **Detail**:
  - `supabaseHostsIn` judges only lines that start with `SUPABASE_URL=`. Wrangler reads `.dev.vars` with dotenv's grammar, where `export SUPABASE_URL=…`, a leading space, `SUPABASE_URL = …` and `SUPABASE_URL: …` all set the variable, and the last one wins.
  - The reviewer reproduced all four: each passed the guard while wrangler bound the remote URL.
  - Today the setup's form sign-in still fails against any hosted project, because the run user exists only locally, so no product page opens. That backstop is incidental, and S-07's changes to the setup could remove it.
  - The guard also reads the files from the working directory rather than the repository's, and doesn't look at `.dev.vars.<CLOUDFLARE_ENV>`.
- **Fix**: refuse any line of `.env` or `.dev.vars` that mentions `SUPABASE_URL` unless it is exactly `SUPABASE_URL=http://127.0.0.1` or `http://localhost` with an optional port. Read both files from the repository root, and refuse when `CLOUDFLARE_ENV` is set.
- **Decision**: FIXED — every SUPABASE_URL line of .env and .dev.vars must be exactly a local `SUPABASE_URL=` (comments skipped, quotes allowed), both read from the repository root; CLOUDFLARE_ENV refused. Proven: the four dotenv forms, a remote line after a local one, both lookalike hosts, a missing URL, CLOUDFLARE_ENV and a remote value in the environment are refused; local, quoted and commented-out cases pass.

### F3 — A server already on the port is reused silently

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: playwright.config.ts:49
- **Detail**:
  - With `reuseExistingServer: !process.env.CI`, Playwright skips the build when anything answers on 4321: a background preview, a dev server (also one on `::1`), or another worktree's build.
  - The run then tests that server's code and its Supabase, not the current build. A deliberate-break run can come back falsely green or red.
  - CLAUDE.md asks for a free port, but nothing enforces it.
- **Fix**: set `reuseExistingServer: false`, so an occupied port fails fast with Playwright's "already used" error. Update the test-stack.md web-server line and the CLAUDE.md bullet to match.
- **Decision**: FIXED — `reuseExistingServer: false`; test-stack.md and CLAUDE.md updated. Proven: with a preview on 4321 the run stopped in 2 s with "already used", before any build.

### F4 — The focus check passes a transparent outline

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/phone-refresh.spec.ts:27-45
- **Detail**:
  - `focusRing` accepts any outline whose style isn't `none` and whose width is at least 2 px.
  - Tailwind's `outline-hidden` (`2px solid transparent`), the pattern product-page-ui's review F2 removed, would leave focus invisible in normal colours and the spec green.
- **Fix**: also require the outline colour's alpha to be above 0 in normal colours, read through a 1 × 1 canvas, which parses every colour syntax.
- **Decision**: FIXED — the outline colour must be opaque (alpha > 0, through a 1×1 canvas), read once the control's transitions have finished. Proven: `outline: 2px solid transparent` turned the spec red (the first attempt stayed green because Tailwind's transition fades outline-color; the check now waits for it).

### F5 — A full local run can trip the auth rate limit

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: playwright.config.ts:21,24; tests/e2e/support/watchlist-data.ts:36-59; supabase/config.toml:192
- **Detail**:
  - Locally each worker signs in once to seed. With six specs in six workers, a run costs about 7 sign-ups and sign-ins, against the local limit of 30 per 5 minutes per IP, which smoke and the database checks share.
  - About four full runs in 5 minutes, such as a break-and-verify loop, make the setup's sign-up fail with a rate-limit error that reads like a product failure.
  - The plan's budget states only CI's case, 3 calls.
- **Fix A ⭐ Recommended**: hand the setup's session to the helpers through `run.json` (`setSession`), so seeding signs in nowhere.
  - Strength: 2 auth calls per run at any worker count.
  - Tradeoff: the tokens sit in the gitignored `run.json` beside the password already there.
  - Confidence: MED — the access token outlives a run (one hour), so no worker needs a refresh.
  - Blind spot: a run left open past the hour would refresh in every worker.
- **Fix B**: cap local workers at 2.
  - Strength: one line.
  - Tradeoff: a full local run takes roughly 15 s longer and still costs 4 calls.
  - Confidence: HIGH.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A — the setup hands the sign-up's session to the helpers through run.json (`setSession`), and run.json no longer stores the password. Proven: the run user's auth log shows one sign-up and two logins (the sign-up's and the form's) for a six-worker run.

### F6 — No spec pins what a page view costs the shops

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/phone-refresh.spec.ts:67-88; tests/e2e/shops.teardown.ts:10
- **Detail**:
  - While the shops are stopped, no reservation inserts a row, so the request-log check proves that the stop held, not that a flow is frugal.
  - If the island refetched fresh prices on every load, spending the shared cap on every view, every spec would stay green; the stopped notice would just appear sooner.
  - The lessons rule "Bound what each page view and action costs every shop" asks for that cost to be pinned, and risk #3 belongs to test-plan rollout Phase 2.
- **Fix A ⭐ Recommended**: count the island's `POST /api/watchlist/prices` requests (`page.on("request")`).
  - Expect 0 on the fresh product before the tap in phone-refresh, and exactly one per stale or unchecked shop on P2 and P4 in price-honesty.
  - Strength: catches a cap-wasting regression here, for a few lines.
  - Tradeoff: it steps into #3's territory ahead of rollout Phase 2.
  - Confidence: HIGH.
  - Blind spot: it counts the route's calls, not the gate's shop requests behind them.
- **Fix B**: leave it to rollout Phase 2 (#3, "every path to a shop is counted") and record it as a follow-up.
  - Strength: keeps this change to its plan.
  - Tradeoff: the regression stays uncaught until then.
  - Confidence: HIGH.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A — `recordPriceCalls` (support/pages.ts): phone-refresh expects none on opening the fresh product and exactly one per shop, for the page's items, after the tap; price-honesty expects the flow to ask only P2's Rossmann and P4's Natura. Proven: with every load refetching, both specs went red on the counts.

### F7 — An interrupted run leaves the local shops stopped without a word

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/shops.teardown.ts:7-11; playwright.config.ts:35-36
- **Detail**:
  - Ctrl+C, or a killed process such as an agent's command hitting its time limit, skips the teardown project. Every local shop then stays stopped until `restore` or the next run's teardown.
  - That's the safe direction, since no shop is asked, but nothing says so, and the local app shows the stopped notice on every refresh.
- **Fix**: add a `globalTeardown` that restores the run's hold as a safety net, with the teardown project keeping the request-log check. Say in CLAUDE.md to give the suite a long timeout or run it in the background.
- **Decision**: FIXED — `globalTeardown` (support/global-teardown.ts) switches the run's hold back on after Ctrl+C; CLAUDE.md asks for a long timeout or a background run. Proven: a setup-only run with `--no-deps` skipped the teardown project and the safety net still released the shops.

### F8 — The Supabase CLI pin and the service list live in two jobs

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/ci.yml:35-38 and 82-85 (the pin), 42 and 89 (the `-x` list)
- **Detail**: the e2e job copies the smoke job's pin, its comment and the `-x` list. A bump, which the comment ties to 2026-10-30, can land in one job only and leave the two on different CLIs.
- **Fix**: add a comment in the e2e job pointing at the smoke job's twin ("bump both"). Moving both to a workflow-level `env` would change the smoke job, which the plan rules out.
- **Decision**: FIXED — a comment in the e2e job says its CLI pin and left-out services are the smoke job's, to change together; the smoke job is untouched.

### F9 — The decline spec checks "Anuluj" before the island hydrates

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/phone-decline-match.spec.ts:44-48
- **Detail**:
  - After "Anuluj" reloads the page, the spec asserts Natura's price and "Najtaniej" without waiting for the island. That goes against §6.3 and the Phase 3 note ("otherwise the server's HTML could pass").
  - It's harmless today, since two fresh prices read the same before and after hydration, but it's the pattern the next spec would copy.
- **Fix**: `await waitForIsland(page, "PriceComparison")` after the "Anuluj" tap.
- **Decision**: FIXED — the decline spec waits for the island after "Anuluj", once the choice is gone from the new page.

### F10 — A few notes and docs overstate details

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md Implementation Notes (Phase 1); tests/e2e/support/watchlist-data.ts:3-4; context/foundation/test-plan.md §6.3; context/foundation/roadmap.md S-04
- **Detail**:
  1. The Phase 1 note "The guard reads every `SUPABASE_URL` line" holds for `.dev.vars`, and for `.env` from the command line. Through the config, `.env` is already loaded, so the guard checks the value the tests use, the last line.
  2. The request-log mark's `last_value:is_called` form isn't recorded.
  3. §6.3 says every provenance header names where its expected values come from; only price-honesty's does.
  4. S-04's note calls P4's list line "unasserted", but the spec asserts that it names no cheapest shop.
  5. watchlist-data.ts says only backdating acts as the superuser; its shops check does too.
- **Fix**: correct the five texts in the plan's notes, §6.3, roadmap S-04 and the helper's comment.
- **Decision**: FIXED — the plan's Phase 1 notes on the guard and the mark, §6.3's provenance rule, the roadmap's S-04 note and the seeding helpers' comment were corrected.

## Triage summary

- **Fixed (2026-10-02):** all ten — F1, F5 and F6 via Fix A; F2, F3, F4, F7, F8, F9 and F10 as proposed. No follow-up is left open, and the plan's Implementation Notes record each fix ("Implementation review fixes").
- **After the fixes:** lint, `astro check` and 1171 unit tests pass, and the e2e suite (8 tests) is green from a cold server, with 0 products left and the shop request log unmoved.
