---
date: 2026-10-06T19:08:45+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 2c6adc558f346e3c63078f0d021965485f0b0281
branch: feat/testing-deploy-and-production-checks
repository: yaroslavkhudchenko/10xcourseproject
topic: "Rollout Phase 4 (deploy and production checks): how a merge reaches production today, what can keep code from shipping ahead of its migration, and what a signed-out, read-only check of production can prove after each deploy without secrets in GitHub"
tags: [research, testing, deploy, workers-builds, migrations, smoke, production-checks, auth-settings, ci, rulesets]
status: complete
last_updated: 2026-10-06
last_updated_by: Claude (claude-opus-5-5)
---

# Research: deploy and production checks (rollout Phase 4)

**Date**: 2026-10-06T19:08:45+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 2c6adc5 (`main` after PR #32)
**Branch**: feat/testing-deploy-and-production-checks
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

Ground rollout Phase 4 of `context/foundation/test-plan.md`, "Deploy and production checks" (§3 row 4): prove that a merge can't ship ahead of its migration, and that production still answers, refuses sign-up and protects its pages after each deploy. It covers two risks.

- **Risk #2** (`test-plan.md:30`, `:44`): a deploy breaks production for everyone. Code ships before its migration, a setting drifts, or code that passes in Node fails on Workers.
  - Must challenge: "Green Node tests mean it works on Workers" and "a ticked Progress row means the migration is live".
  - Avoid: a check that needs production secrets in GitHub or writes to production, and a smoke that asserts only status 200.
- **Risk #4** (`test-plan.md:32`, `:46`): production refuses sign-up, by a read-only auth-settings check.
  - Must challenge: "sign-up is off because the dashboard says so".
  - Avoid: a service-role key in tests.

Three read-only workers gathered the evidence, and this document is the synthesis:

- **The repository:** CI, rulesets and history, read at `2e60a09` and re-anchored at `2c6adc5`.
- **The smoke and the app's signed-out surface.**
- **Primary documentation** for Cloudflare Workers Builds, GitHub Actions and rulesets, and Supabase, checked 2026-10-06.

No request went to production, to Supabase, to Cloudflare's API or to a shop. The GitHub calls were all read-only.

## Summary

1. **Workers-only breakage already fails CI, except on the shop path.**
   - CI's `smoke` and `e2e` jobs run the production build on the workerd preview (`.github/workflows/ci.yml:65-70`, `:99-101`; `playwright.config.ts:54-57`), and the only ruleset requires both, with `ci` (ruleset `preventFailedDeploy`, id 23934903).
   - Neither job reaches a shop (`scripts/smoke.mjs:120-124`; `test-plan.md:127-131`). So the cited Workers-only incident, F4's "Illegal invocation" on the shop gate's `fetch`, is pinned only by a Node unit test (`src/lib/services/shop-gate.test.ts:286-292`).
   - Phase 4 can't close that gap without a live shop, which CI never calls. It stays a stated limit.
2. **Nothing in GitHub can see which migrations production has, and the deploy doesn't wait for GitHub.**
   - GitHub holds no secrets, variables or environments (`gh api …/actions/secrets`, `/actions/variables`, `/environments`: total_count 0 each).
   - Workers Builds deploys every push to `main` without waiting for the push run's checks. For the merge of PR #32 (`2c6adc5`, 17:02:46Z), its check had completed with `success` while `ci`, `smoke` and `e2e` were still running. Over the seven earlier `main` commits that carry it, it completed 41 to 99 s after the merge commit.
   - So a pre-merge gate in GitHub can only check a claim someone commits or sets: a committed record, or a label. A gate that reads production's migrations needs a credential where it runs.
   - The only place that runs at every deploy and can hold such a credential outside GitHub is Workers Builds itself.
3. **Production's migrations can be read in four ways, and only one needs neither a password nor a token:**
   - the database itself, which needs the password;
   - the Management API's migration history, which needs a personal access token;
   - the owner's CLI, which needs the password or a login;
   - something the database exposes to the publishable key, which today is nothing.
   - The observability audit already proposed the last one as `app_schema_version()` (W4).
4. **A signed-out, read-only check of production can assert far more than status codes.**
   - Today's smoke can't be pointed at production: it signs a user up through Auth and refuses any Supabase but the local one (`scripts/smoke.mjs:12-21`, `:25-48`).
   - Of its 45 steps, 10 are signed-out GETs, and 12 are refusals that write nothing and send a visitor's request (`scripts/smoke.mjs:126-332`).
   - Beyond those, a production check can assert the Polish sign-in form, the absence of the missing-configuration banner, the confirm page's headers, and Auth's settings (§4).
   - It can't tell which deployment answered, since the app exposes no version marker.
5. **Workers Builds can run a check right after the deploy, with its variables kept in Cloudflare, but two behaviours are undocumented.**
   - Documented: the deploy command can be an npm script, and build variables and secrets live in Cloudflare.
   - Undocumented: whether those variables reach the deploy command, and whether a non-zero exit after a successful `wrangler deploy` marks the build failed. The plan must verify both once.
6. **Risk #4's sign-up refusal is observable read-only.**
   - `GET <SUPABASE_URL>/auth/v1/settings` with the publishable key in `apikey` returns `disable_signup` and `external.email` (Auth `internal/api/settings.go`; `context/deployment/deploy-plan.md:343-351`).
   - Locally the same request answers `disable_signup: false`, since local sign-up stays on for the tests (`supabase/config.toml:171`). So a local run of the check must go red there, which doubles as its negative test.
   - The rest of risk #4, two users and the routes, is rollout Phase 2's (`test-plan.md:58`).

### Response guidance, verified

| Guidance (`test-plan.md:44`, `:46`)                                                                                   | Verdict                                                                                                                                                                                                        | Evidence   |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| "Green Node tests mean it works on Workers" (must challenge)                                                          | Holds as a challenge. CI already runs workerd for the rendered and auth paths; the shop path isn't exercised on workerd anywhere in CI                                                                         | §1         |
| "A ticked Progress row means the migration is live" (must challenge)                                                  | It was S-01's failure mode: the rows were ticked by people, and the push hadn't applied the migration. Protection has to read production's state, not a person's tick                                          | §3         |
| Cheapest layer: "smoke on the workerd preview (exists) + a pre-merge migration gate + a signed-out post-deploy smoke" | **Corrected in part.** A pre-merge gate in GitHub can't read production without a secret there. A deploy-time gate in Workers Builds can. A pre-merge gate stays possible only on a committed claim or a label | §2, §6, §7 |
| Anti-pattern: "a check that needs production secrets in GitHub"                                                       | Holds. It rules out a GitHub workflow that calls Supabase with a key (`CLAUDE.md:63`), though Supabase calls the publishable key safe for GitHub Actions                                                       | §6         |
| Anti-pattern: "a smoke that asserts only status 200"                                                                  | Holds. The production answers have exact Locations, headers and page markers to assert                                                                                                                         | §4         |
| #4: "read-only production auth-settings check"                                                                        | Holds. One GET with the publishable key, no sign-up attempt                                                                                                                                                    | §8         |

## Detailed Findings

### 1. What CI proves today

- **Events and jobs:**
  - `ci.yml:3-7` runs on `push` to `main` and on PRs into `main`, with no `workflow_dispatch` or `schedule`.
  - The three jobs `ci`, `smoke` and `e2e` run in parallel and are named by their ids (`:10`, `:27`, `:74`).
- **The `ci` job** (`:10-25`): lint, the contrast check, `astro check`, Vitest and the build. It runs no server.
- **The `smoke` job** (`:27-72`):
  - It starts the local Supabase with CLI 2.117.0 (`:35-43`) and runs the four database contract checks (`:49-64`).
  - It then builds and runs `npm run smoke` against `npm run preview`, the workerd preview (`:65-70`).
- **The `e2e` job** (`:74-111`) runs Playwright, whose config builds and serves the same preview (`playwright.config.ts:54-60`).
- **The ruleset:** `preventFailedDeploy` (id 23934903) requires `ci`, `smoke` and `e2e`.
  - Each check is pinned to integration 15368 (GitHub Actions), with no bypass actors and `strict_required_status_checks_policy: false`.
  - Its other rules are deletion, non-fast-forward and pull request (0 approvals).
  - There's no classic branch protection (`gh api …/branches/main/protection` answers 404).
- **The Workers-only incident:**
  - F4 (`context/archive/2026-09-26-polite-shop-access/reviews/impl-review.md:109-121`) was found by the implementation review, reproduced on workerd, not by CI. It had no live caller (`context/archive/2026-10-02-testing-critical-browser-flows/research.md:56`).
  - Its fix is `src/lib/services/shop-gate.ts:71-72`, pinned in Node by `shop-gate.test.ts:286-292`.
  - Phase 1's research already left that incident to this phase (`…/testing-critical-browser-flows/research.md:225`, `:230`).
  - No CI job sends a shop request on workerd. The only workerd run of a shop path was a manual one, made with the owner's OK (`test-plan.md:191`).

### 2. How a merge deploys, and when

- **The documented settings** (`context/deployment/deploy-plan.md:269-275`, `:396`):
  - production branch `main`;
  - build command `npm run build`;
  - deploy command `npx wrangler deploy`;
  - no build variables;
  - preview builds off.
  - `CLAUDE.md:44` agrees. These live in the Cloudflare dashboard and can't be read from the repository.
- **The deploy doesn't wait for CI:**
  - "Workers Builds deploys every push to `main` whether or not GitHub Actions passed" (`deploy-plan.md:293`). The ruleset therefore protects the merge, not the deploy.
  - Observed on `2c6adc5`: the `Workers Builds: drogeria-radar` check completed with `success` while the push run's `ci`, `smoke` and `e2e` were `in_progress`.
  - On the seven earlier `main` commits that carry the check, it completed 41 to 99 s after the merge commit.
- **What Cloudflare posts on GitHub:**
  - App `cloudflare-workers-and-pages` (id 85455) posts one check run per production build, named `Workers Builds: drogeria-radar`, on `main` commits only.
  - On the 31 merged PR heads it posts none: their Cloudflare check suites stay `queued` with 0 runs, since preview builds are off.
  - It posts no commit statuses and no GitHub Deployments.
  - Its `details_url` and summary carry the Cloudflare account id. That is a public-repo exposure Cloudflare creates, not one this phase adds.
- **History:**
  - 31 of the 33 first-parent `main` commits from `96ee2e2`, when Workers Builds was connected, to `2e60a09` carry a Cloudflare check, all `success`.
  - Two merges of a 38-second burst on 2026-10-05 (`ce27d2c`, `bd6970a`) got none. The cause isn't visible from GitHub.
- **Manual deploy and rollback:**
  - `npx wrangler deploy` is for emergencies only (`CLAUDE.md:44`).
  - Rollback is `npx wrangler versions list` then `npx wrangler rollback <version-id>` (`deploy-plan.md:298-301`).
  - "Supabase migrations don't roll back with the code" (`:301`).
  - Nothing alerts the owner to a failure (`deploy-plan.md:360`). Cloudflare offers no notification type for Workers Builds; its builds publish events to Queues only.

### 3. How migrations reach production, and the S-01 incident

- **The rule** (`CLAUDE.md:55`): the owner runs `npx supabase db push`, then `npx supabase migration list --linked`. "The new migration must show a remote version before the PR that needs it merges; a dashboard check isn't enough on its own."
- **The incident** (`context/archive/2026-09-27-watchlist-add-by-search/plan.md:568-574`):
  - Progress rows 4.3 and 4.4 were ticked before the merge, but the push hadn't applied `20260927145051`.
  - After the merge, every list and add failed with PGRST205 until the owner pushed it.
  - The plan doesn't say how the failure was noticed. The test plan says "nothing notices before the owner's phone check" (`test-plan.md:30`).
- **How often migrations land:**
  - 6 migration files arrived in 5 of the 32 merged PRs: #3, #5, #7 (two), #9 and #17.
  - The last was merged on 2026-10-01, and PRs #18 to #32 carry none.
  - Only S-01's lagged. Every other was confirmed remote before its merge (S-02 `plan.md:624`, S-03, S-08).
- **The mixed state is expected:** production's database is briefly ahead of production's code, so a migration must tolerate the deployed code (`context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:98`).
- **What runtime knows:** nothing at runtime knows which migration production has.
  - The observability audit names it as W4 and proposes "a granted `app_schema_version()` the Worker compares once per isolate" (`context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:124`).
  - It also notes that an unpushed S-08 migration would have turned every re-pin into a silent `decided` (W1, `:122`). So probing tables for existence (PGRST205) would miss policy-only migrations.

### 4. What production can be asked without a session or a secret

Every answer below is derived from the code at `2c6adc5`. There's no recorded production answer after S-07.

- **The front door** (`src/middleware.ts:9`, `:27-34`; `src/pages/index.astro:4`):
  - `GET /` → 302 `Location: /auth/signin`.
  - `GET /watchlist` → 302 `/auth/signin?next=%2Fwatchlist`, and with `?f=check` → `…next=%2Fwatchlist%3Ff%3Dcheck`, `q` dropped.
  - `GET /watchlist/<uuid>` → 302 `…next=%2Fwatchlist%2F<uuid>`.
  - `GET /auth/set-password` → 302 plain `/auth/signin`.
  - With no cookie the middleware makes no Auth call: auth-js returns a missing session without a request.
- **The routes:**
  - Any request to `/api/watchlist…` → 302 `/auth/signin`, before its route runs. A JSON POST passes Astro's origin check, and the middleware answers.
  - A form POST with a foreign `Origin` → 403 `Cross-site POST form submissions are forbidden`, before the middleware (astro `core/app/origin-check.js:7-26`; `core/middleware/load.js:12-14`).
  - `POST /api/auth/signout` as a visitor → 302 `/auth/signin?signed-out=1`, with no Auth call.
- **The removed pages:** `GET /dashboard`, `GET /auth/signup`, `GET /auth/confirm-email` and `POST /api/auth/signup` → 404, Astro's default page. They were deleted in `4b92983`.
- **The sign-in page:** `GET /auth/signin` → 200 `text/html` with:
  - `<html lang="pl">`;
  - `<title>Logowanie · Drogeria Radar</title>`;
  - a form posting to `/api/auth/signin` with a hidden `next` of `/watchlist`;
  - the labels "E-mail" and "Hasło", and the button "Zaloguj się";
  - no `<a>` at all while Supabase is configured, so no sign-up link (`src/components/auth/SignInView.astro:33-61`; the banner below is the only link the layout can add).
- **The missing-configuration signal:**
  - With `SUPABASE_URL` or `SUPABASE_KEY` missing on the Worker, the sign-in and confirm pages carry the banner "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone." (`src/lib/config-status.ts:15`; `src/layouts/Layout.astro:70-83`). The redirects stay the same.
  - "funkcje uwierzytelniania są wyłączone" appears only in the banner. The `?error=config` alert shares only its first half (`src/lib/notices.ts:147`).
  - A wrong but present key shows no banner and changes no cookie-less GET. Only a POST that reaches Auth reveals it: a well-formed sign-in maps to `?error=failed` instead of `?error=invalid` (`src/lib/services/auth.ts:74-79`).
- **The confirm page:** `GET /auth/confirm?token_hash=<56 hex>&type=invite` → 200 with `Cache-Control: no-store` and `Referrer-Policy: strict-origin`, and the form "Ustaw hasło".
  - It never calls Auth (`src/pages/auth/confirm.astro:16-18`; `auth.ts:130-133`, `:155-162`).
  - The URL, token included, lands in Workers Logs (`wrangler.jsonc:13-15`, `deploy-plan.md:337`). A check should send a token that was never issued.
- **Fonts:**
  - The sign-in page's `@font-face` rules point at `/_astro/fonts/<hash>.woff2` on the same origin.
  - `/_astro/*` is served with `Cache-Control: public, max-age=31536000, immutable` (observed in the starter era, `deploy-plan.md:185`).
  - A check must take the URLs from the HTML.
- **Production versus the local preview:**
  - No `src` code branches on the environment.
  - The origin check compares `Origin` with the Worker's own `https://` origin, so a check's base URL must be that exact origin.
  - Cookies and security headers are the same in both places, since the app sets no HSTS or CSP.
- **No version marker:** the app has no health or version route and sends no build-id header. A response can't be tied to a deployment, though Workers' version metadata binding could expose one if ever wanted.

### 5. What `scripts/smoke.mjs` does today, and what carries over

- **Guards:**
  - It needs `SUPABASE_URL` and `SUPABASE_KEY`, and refuses any Supabase host but `127.0.0.1` or `localhost` (`:12-21`).
  - It checks no part of `BASE_URL` (`:5`).
  - It first signs a throwaway user up through `<SUPABASE_URL>/auth/v1/signup` (`:25-48`).
- **Its 45 steps** (`:126-332`), by what they need:
  - 10 signed-out GETs: steps 1-7, 11, 13 and 45.
  - 8 signed-out refusals as written:
    - the middleware's 302 for steps 8, 9, 10 and 12;
    - the route's own guard for step 14, which needs a configured client;
    - the origin check's 403 for steps 16 and 18;
    - no route for step 17.
  - 3 origin refusals it sends with a session, which a visitor gets too (steps 30, 40, 41).
  - 1 sign-out (step 44), whose answer a visitor gets without any Auth call.
  - The rest need the throwaway user, Auth or a session.
  - Step 15 makes one Auth `/verify` call for an unknown token.
- **Reporting:**
  - Each step prints `PASS|FAIL  <name>  -> …`, and the run ends with `process.exit(failed ? 1 : 0)` (`:335-354`).
  - No step is wrapped in a try/catch, so a network error ends the run with no FAIL line.
- **Conventions for a script that may reach a hosted project** (`scripts/owner-link.mjs`):
  - It refuses every bad input before any request (`:102-123`).
  - Plain http is allowed only on `localhost` or `127.0.0.1` (`isSecureUrl`, `:61-68`).
  - It tells a secret key from a publishable one (`isSecretKey`, `:77-87`), which a production check would use to refuse a secret key.
  - It never echoes a key and prints only Auth's error code (`:129-135`).
- **Tests:** no script is unit-tested.
  - Vitest includes only `src/**/*.test.ts` (`vitest.config.ts:9-11`).
  - ESLint covers `scripts/**/*.mjs`, with the globals `console`, `process`, `fetch`, `URL` and `URLSearchParams` (`eslint.config.js:76-81`).
  - Scripts are exercised by running them in CI (`ci.yml:21-22`, `:49-70`).

### 6. Where a check after each deploy can run

- **In Workers Builds' deploy command** (Cloudflare `workers/ci-cd/builds/configuration`, checked 2026-10-06):
  - "Your deploy command will default to `npx wrangler deploy` but you may customize this command"; "If you have added a Wrangler deploy command as a script in your `package.json`, then you can run it by setting it as your deploy command. For example, `npm run deploy`."
  - Build variables and secrets are set under Settings › Build › Build Variables and Secrets, "accessible only to your build". A secret is hidden after it's saved and listed as `null`.
  - The build also gets `CI=true`, `WORKERS_CI=1` and `WORKERS_CI_COMMIT_SHA`.
  - `wrangler deploy` "creates a new version and immediately deploys it to 100% of traffic".
  - A failing deploy command logs "Failed: error occurred while running deploy command", observed in a public build log where `wrangler deploy` itself failed.
  - The logs are only in the dashboard. GitHub sees only the check's conclusion.
  - **Undocumented,** so the plan must verify each once after the merge:
    - whether build variables reach the deploy command;
    - whether a non-zero exit after a successful `wrangler deploy` marks the build failed.
  - Cloudflare documents no automatic rollback.
  - An exit before `wrangler deploy` deploys nothing.
- **By the owner by hand:** the status quo, now a curl from the password manager after each deploy (`deploy-plan.md:297`, `:343-351`). It needs no platform change and can be forgotten.
- **In GitHub Actions after Cloudflare's check:**
  - `check_run` and `check_suite` workflows run from the default branch.
  - They don't fire for a check suite "whose head SHA is associated with GitHub Actions". Every `main` commit here also runs Actions on push, so whether Cloudflare's check would fire such a workflow is undocumented.
  - It would also need the app's URL and, for the sign-up check, the publishable key in GitHub.
  - Supabase calls the publishable key "Safe to expose online: … GitHub actions". `CLAUDE.md:63` keeps Supabase keys out of GitHub, and the repository's logs are public.
- **Event Subscriptions:** Workers Builds publishes `build.succeeded` to a Queue that a consumer Worker could act on. That is new infrastructure for one check.
- **Health Checks:** these need a zone on a Pro plan or above. The app runs on its workers.dev address, on the Workers Free plan (`deploy-plan.md:224`, `:304`).

### 7. Ways to know production's migrations

| Way                                                                                                                                                                | Credential                                                                                 | Where it can run                                                | Note                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `supabase migration list --linked` (`--output-format json` gives `{"migrations":[{local,remote,time}]}`) or `db push --dry-run` ("Remote database is up to date.") | database password (`SUPABASE_DB_PASSWORD`), else a login that mints a temporary login role | owner's machine                                                 | read-only `SELECT version FROM supabase_migrations.schema_migrations`; the role path creates a role (experimental endpoint) |
| Management API `GET /v1/projects/{ref}/database/migrations`                                                                                                        | personal access token, scope `database:read`; a scoped token with only Migrations: Read    | anywhere the token can be held, e.g. Cloudflare build secrets   | no migration; a token tied to the owner's account, which can expire                                                         |
| A security-definer function returning the applied versions, granted to `anon`                                                                                      | the publishable key                                                                        | Workers Builds, the owner's machine, CI against the local stack | needs a migration; anon learns only which of the repository's public migration versions are applied; matches the audit's W4 |
| Probing each table through PostgREST (PGRST205 versus 42501)                                                                                                       | the publishable key                                                                        | anywhere                                                        | no migration, but blind to policy-only and function-only migrations such as S-08's                                          |

- Locally, `supabase start` applies `supabase/migrations/` (`supabase/config.toml:55-57`, `[db.migrations] enabled = true`), and the CLI records applied versions in `supabase_migrations.schema_migrations` on both sides.
- That a fresh local stack fills the table is expected from the CLI, not observed here, since this machine has no Docker. CI's `smoke` job can show it.

### 8. Risk #4: sign-up refusal

- **The endpoint:** `GET /auth/v1/settings` is public apart from the `apikey` header (Auth `api.go`: `r.Get("/settings", api.Settings)` with no authentication; `openapi.yaml`, scheme `apikey` in header).
  - It returns `disable_signup`, `mailer_autoconfirm` and `external.{email, …}`.
  - The owner's runbook sends the publishable key there (`deploy-plan.md:346`), and the owner's run on production passed on 2026-10-05 (`context/archive/2026-10-04-invite-only-access/plan.md:917`). Its body isn't recorded.
  - No Supabase page says the publishable key works for `/settings` on hosted. Supabase's key guide (send it in `apikey`) and the self-hosted gateway's config (the `anon` consumer holds it for `/auth/v1/`) only point that way.
- **Expected answer:** `"disable_signup":true` and `"external":{"email":true,…}`, sign-up refused with the email provider on (`deploy-plan.md:349`). Local answers `disable_signup: false` (`supabase/config.toml:171`, `:206`).
- **No local test can show the refusal** (`test-plan.md:184`). A local run of the production check therefore proves that the check goes red on open sign-up.
- **Timing:** Supabase is retiring the legacy `anon` and `service_role` keys by the end of 2026. Which kind the Worker's `SUPABASE_KEY` holds isn't in the repository.
  - A key that stops working shows no banner; it shows only as failed sign-ins (§4).
  - A check after each deploy catches it only at a deploy.

## Code References

- `.github/workflows/ci.yml:3-7`, `:27-72`, `:74-111`: events; the `smoke` job (local Supabase, database checks, preview plus smoke); the `e2e` job
- `playwright.config.ts:54-60`: the e2e suite builds and serves the workerd preview itself
- `scripts/smoke.mjs:5`, `:12-21`, `:25-48`, `:65-84`, `:120-124`, `:126-332`, `:335-354`: base URL, local-only guard, sign-up, request helper, "never calls a shop", the 45 steps, reporting
- `scripts/owner-link.mjs:52-68`, `:77-87`, `:102-135`: secure-URL and secret-key checks, refusals before any request, Auth error codes only
- `src/middleware.ts:9`, `:15-41`: `PROTECTED_ROUTES`, the signed-out redirect, `private, no-store` for signed-in answers
- `src/lib/config-status.ts:11-21`; `src/layouts/Layout.astro:70-83`: the missing-configuration banner
- `src/components/auth/SignInView.astro:33-61`: the sign-in page's heading, form, labels and button
- `src/pages/auth/confirm.astro:16-18`; `src/lib/services/auth.ts:130-133`, `:155-162`: the confirm page parses its link and calls no one
- `src/lib/services/shop-gate.ts:71-72`; `shop-gate.test.ts:286-292`: the F4 fix and its Node pin
- `context/deployment/deploy-plan.md:269-275`, `:293`, `:297-301`, `:343-351`, `:360`: Workers Builds settings, deploys without waiting for CI, rollback, the read-only sign-up check, no alerts
- `CLAUDE.md:44`, `:55`, `:63`, `:68`: deploy path, the migration rule, no secrets in GitHub, nothing private committed
- `supabase/config.toml:55-57`, `:171`, `:206`: local migrations, local sign-up on

## Architecture Insights

- **The deploy is decoupled from CI.** The ruleset guards the merge, and Workers Builds deploys the merged commit on its own clock. The only code that runs at every deploy, after the merge and before or after the new version goes live, is Workers Builds' build and deploy commands. A check placed there is the only automated one that can stop a deploy.
- **The secrets stay where they already are.** The Worker's runtime secrets live in Cloudflare (`npx wrangler secret put`, `CLAUDE.md:44`). Build secrets in the same account keep the publishable key and the app's URL out of GitHub and out of public logs.
- **One script, two places.** Every assertion in §4 holds on the local workerd preview too, the banner's absence included, since CI writes `.dev.vars`. A production check can therefore run in CI's `smoke` job against the preview on every PR, so the check itself is tested before it ever meets production. Its sign-up assertion is the one exception: it goes red locally by design.
- **The migration question is about reading production, not about files.** Any gate keyed only on the PR's files can say "this PR has a migration", never "production has it". A mechanical answer comes from the database, the Management API, or a function the database exposes.

## Historical Context (from prior changes)

- `context/archive/2026-09-27-watchlist-add-by-search/plan.md:568-574`: the merge ahead of its migration (PGRST205), and the rule it produced.
- `context/archive/2026-09-26-polite-shop-access/reviews/impl-review.md:109-121`: F4, the Workers-only "Illegal invocation", found by review on workerd.
- `context/archive/2026-10-02-testing-critical-browser-flows/research.md:219-230`: preview versus production differences. That research left the migration gate and the signed-out production smoke to this phase.
- `context/archive/2026-10-04-invite-only-access/plan.md:912-917`: the first read-only `/auth/v1/settings` check on production (passed, body not recorded). The signed-out requests after S-07's merge answered `/` with a redirect and `/auth/signup` with 404.
- `context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:83`, `:122`, `:124`, `:132`: no canary, no runtime version check, W4's `app_schema_version()`, and X1, where nothing reaches a person.
- `test-plan.md:184-186`: the S-07 notes that hand the automated sign-up check and the smoke's own entry point to this phase.

## Related Research

- `context/archive/2026-10-02-testing-critical-browser-flows/research.md`: Phase 1's research on the preview, the shops' stop switch and the e2e layer.
- `context/archive/2026-10-04-invite-only-access/research.md`: Auth's answers and the local-only sign-up decision.

## Open Questions

These are the owner's calls for `/10x-plan`. Each is a choice between grounded options above, not a gap in the evidence.

1. **Where the migration gate sits, and how it reads production:**
   - at the deploy in Workers Builds, before `wrangler deploy`, through a function exposed to the publishable key or the Management API with a scoped read token;
   - at the merge in GitHub, through a committed record the owner's CLI writes or a label the owner sets;
   - or both.
2. **Where the check after each deploy runs:** in Workers Builds' deploy command, which needs the app URL, the Supabase URL and the publishable key as Cloudflare build variables, or by the owner by hand.
3. **Whether the check may make one Auth call.** A well-formed sign-in for an address that has no account is the only way to prove the Worker's key works. It answers `?error=invalid` with a working key and `?error=failed` with a broken one. It isn't strictly read-only, and it spends one of Auth's sign-in attempts per deploy.
4. **Verifying the two undocumented behaviours of Workers Builds once after the merge:** whether build variables reach the deploy command, and whether a failure after `wrangler deploy` turns the build red. Either way, a redeploy of the same commit is harmless.
5. **Documents that are already stale, for whichever phase touches them:**
   - `README.md:186-191` says CI has two jobs.
   - `deploy-plan.md:293` (8.3) lists two required checks.
   - `deploy-plan.md:115` (0.7) is unchecked though the link exists.
   - `context/foundation/infrastructure.md:87` says an agent may run `npm run smoke` against a preview URL.
   - `test-plan.md:75` says e2e is "none yet".
