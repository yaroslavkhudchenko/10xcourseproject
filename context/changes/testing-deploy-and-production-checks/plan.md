# Deploy and production checks Implementation Plan

## Overview

Rollout Phase 4 of `context/foundation/test-plan.md`, covering risks #2 and #4. Every deploy goes through a gate and a check that run inside Cloudflare Workers Builds:

- **The gate:** code whose migration production lacks doesn't deploy. Before `wrangler deploy`, it asks production, through a read-only database function and the publishable key, which migrations are applied, and refuses when any of the repository's migrations is missing.
- **The check:** right after the deploy, a signed-out check of production proves the front door, the refused routes, the sign-in page, one Auth sign-in probe and Auth's sign-up refusal. A failure turns the build red.
- **The alert:** a GitHub workflow on each push to `main` waits for that build's check and fails when it's red, so GitHub emails the owner.

Nothing new goes into GitHub's secrets, and nothing writes to production.

## Current State Analysis

From `context/changes/testing-deploy-and-production-checks/research.md`:

- **What CI covers:**
  - CI's `smoke` and `e2e` jobs already run the production build on the workerd preview (`.github/workflows/ci.yml:65-70`, `:99-101`), and the ruleset requires both. Workers-only breakage on the rendered and auth paths already fails a PR.
  - The shop path isn't exercised on workerd anywhere in CI, and stays a stated limit.
- **How a merge deploys:**
  - Workers Builds deploys every push to `main` with `npm run build` and `npx wrangler deploy`, without waiting for GitHub's checks. On `2c6adc5` it finished while `ci`, `smoke` and `e2e` were still running.
  - GitHub holds no secrets, variables or environments, so no GitHub check can know which migrations production has.
- **The migration rule:** it's a person's step: `db push`, then `migration list --linked`, before the merge (`CLAUDE.md:55`). It failed once (S-01, PGRST205), when Progress rows were ticked before the push had applied the migration.
- **After a deploy:**
  - The owner runs a curl against `/auth/v1/settings` with the publishable key, when they remember (`context/deployment/deploy-plan.md:297`, `:343-351`).
  - Nothing tells the owner about a failure (`deploy-plan.md:360`).
- **Today's smoke can't be pointed at production.** It signs a user up through Auth and refuses any Supabase but the local stack (`scripts/smoke.mjs:12-21`, `:25-48`).
- **What a production check can see:** the app exposes no version marker. With Supabase unconfigured, the sign-in page shows the banner "…funkcje uwierzytelniania są wyłączone." (`src/lib/config-status.ts:15`). A wrong but present key shows only as `?error=failed` from a sign-in.

## Desired End State

- **Deploys:** Workers Builds' deploy command is `npm run deploy:checked`, with three build variables in Cloudflare (`CHECK_APP_URL`, `CHECK_SUPABASE_URL`, `CHECK_SUPABASE_KEY`). Every deploy runs these steps in order:
  1. It refuses before anything when a variable is missing, a URL is insecure or the key is secret.
  2. It refuses to deploy when any `supabase/migrations/*.sql` version isn't in production's `applied_migrations()`.
  3. It runs `npx wrangler deploy`.
  4. It waits 10 s, then runs the production check, and exits non-zero on any failure, which turns the `Workers Builds: drogeria-radar` check red.
- **The alert:** the `Deploy check` workflow runs on every push to `main`. It fails when that commit's `Workers Builds` check fails, and passes when a newer build superseded the commit.
- **Checks by hand and in CI:**
  - `npm run check:production` runs the same check by hand, with the three variables set on the command line. No file holds them.
  - `node scripts/check-migrations-applied.mjs` confirms a pushed migration before a merge.
  - CI's `smoke` job runs both against the local stack and the preview. The `pages` and `sign-in` groups must pass, the `settings` group must fail on local open sign-up, and the gate must refuse a migration the database lacks.
- **The documents:** the deploy plan's runbook, `CLAUDE.md` and the test plan (§2 risk #2, §4, §5, §6.5, §6.6) describe the gate, the check, the alert and the emergency path.
- **Verification:**
  - The first build after the owner switches the deploy command shows the gate passing, `wrangler deploy` running and the check passing, and the Deploy check run is green.
  - A build with a deliberately wrong `CHECK_APP_URL` redeploys the same version and turns red.

### Key Discoveries:

- Workers Builds' deploy command may be an npm script ("For example, `npm run deploy`"). Build variables and secrets are set under Settings › Build › Build Variables and Secrets and are hidden once saved. Whether they reach the deploy command, and whether a failure after `wrangler deploy` turns the build red, are undocumented, so Phase 4 verifies both once (research §6).
- The ruleset requires only `ci`, `smoke` and `e2e`, pinned to GitHub Actions (id 23934903). A new workflow on `main` pushes isn't required and needs no ruleset change.
- Existing security-definer functions revoke `PUBLIC` and grant one role explicitly, with `set search_path = ''` (`supabase/migrations/20260926112205_polite_shop_access.sql:51-52`, `:126-130`).
- `scripts/owner-link.mjs:52-100` holds `isSecureUrl`, `isSecretKey` and `appOriginOf`, which the new scripts need too (lesson "Define shared constants and helpers once").
- Smoke's signed-out steps fix the expected answers: Locations exact or by prefix, origin 403s, removed pages' 404s and the confirm page's headers (`scripts/smoke.mjs:126-192`, `:332`).
- Vitest includes only `src/**/*.test.ts` (`vitest.config.ts:9-11`). ESLint covers `scripts/**/*.mjs` (`eslint.config.js:76-81`).
- CI's smoke step starts the preview in the background and runs smoke in the same `run` block (`ci.yml:66-70`), so the new runs against the preview belong in that block.

## What We're NOT Doing

- **A pre-merge migration gate in GitHub.** It can't read production without a secret there. The deploy gate replaces it (the owner's call).
- **Secrets or variables in GitHub,** and anything that writes to production. The only Auth call is one failed sign-in for an address with no account.
- **An automatic rollback.** A red build is the owner's to act on (the owner's call). The runbook names `wrangler rollback`.
- **Scheduled checks between deploys.** Drift made in a dashboard shows at the next deploy, or when the owner runs `npm run check:production` (the owner's call).
- **A version marker in the app.** The check runs 10 s after `wrangler deploy`, which deploys to 100% of traffic at once. In that window it could still meet the old version.
- **A shop request in any check.** Every request is signed out, so none reaches a shop, and the Workers-only shop path stays covered only by the Node unit test (`shop-gate.test.ts:286-292`).
- **Two-user route tests** for risk #4's other half. Those are rollout Phase 2's.
- **Supabase's GitHub integration**, which applies migrations on merge. Migrations stay the owner's `db push`.

## Implementation Approach

- **Phase order:** the checks come first, each tested in CI against the local stack before anything touches the deploy. Next comes the gate's database function and its check. Last, the deploy script and the alert that chain them, and the documents and the owner's one-time Cloudflare setup.
- **Shared code:** the scripts stay dependency-free Node, like `scripts/smoke.mjs`. Their pure parts are exported and unit-tested through a new `scripts/**/*.test.mjs` include. Each CLI entry is guarded the way `scripts/e2e-local-db.mjs:219` is.

## Critical Implementation Details

- **Ordering of the rollout:**
  1. This change's own migration reaches production in the owner's one sitting after the merge, before the deploy command switches (the owner's call, 2026-10-06). That is safe because the merged code calls the function only from the deploy command, which the owner switches after the push. Every later migration keeps the rule: `db push` before its merge, which the gate now enforces.
  2. The deploy command must switch to `npm run deploy:checked` only after the merge, so the script exists, and after the three build variables are set. The script refuses without them, by the owner's fail-closed call, so switching first fails every build.
- **The origin check:** a same-origin POST must send `Origin` equal to `CHECK_APP_URL`, because Astro's origin check compares it with the Worker's own `https://` origin. Every request uses `redirect: "manual"`.
- **The publishable key** goes only in the `apikey` header, never in `Authorization: Bearer`, both to PostgREST and to Auth.
- **Public logs:** no output may hold `CHECK_SUPABASE_KEY`, the Supabase URL in CI, or a check run's `details_url`, which carries the Cloudflare account id. The repository's Actions logs are public.

## Phase 1: The production check

### Overview

A signed-out, read-only check of any deployment of the app, run against the local preview in CI and after each deploy against production, with the shared URL and key helpers moved into one module.

### Changes Required:

#### 1. The shared helpers

**File**: `scripts/hosted-env.mjs` (new), `scripts/owner-link.mjs`

**Intent**: One module owns the rules every script that may reach a hosted project uses. `owner-link.mjs` imports them unchanged.

**Contract**:

- Exports `LOCAL_HOSTS`, `isSecureUrl`, `isSecretKey` and `appOriginOf`, moved as they are from `owner-link.mjs:52-100` with their doc comments.
- Exports `readCheckEnv(env, needs)`, which returns either `{ appOrigin?, supabaseUrl?, key? }` or `{ refusal: string }`. A refusal names the variable, never its value. It refuses when:
  - a needed `CHECK_*` variable is missing;
  - `CHECK_APP_URL` isn't a bare secure origin;
  - `CHECK_SUPABASE_URL` isn't secure;
  - `CHECK_SUPABASE_KEY` is a secret key.
- `owner-link.mjs` keeps its refusals' order and texts.

#### 2. The check

**File**: `scripts/check-production.mjs` (new)

**Intent**: Proves, signed out, that a deployment answers, protects its pages and routes, has its Supabase configuration, signs in with a working key, and that Auth refuses sign-up. It prints one line per step, as smoke does.

**Contract**:

- **Environment:** reads `CHECK_APP_URL`, `CHECK_SUPABASE_URL` and `CHECK_SUPABASE_KEY` through `readCheckEnv`. `--only=<groups>` and `--skip=<groups>` take `pages`, `sign-in` and `settings`, and an unknown group is refused.
- **Requests:** every request uses `redirect: "manual"` and a 10 s timeout, and is retried once only on a network error. Same-origin POSTs send `Origin: <CHECK_APP_URL>`.
- **Output:** `PASS|FAIL  <step>  -> <observed>` per step, with no key, no body and no Supabase URL. It ends with `process.exit(failed ? 1 : 0)`. A step that throws prints a FAIL line instead of ending the run.
- **The steps** (expected values from `scripts/smoke.mjs` and research §4):

| Group    | Request                                                                                             | Expected                                                                                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pages    | `GET /`                                                                                             | 302, Location exactly `/auth/signin`                                                                                                                                                                                                                                 |
| pages    | `GET /watchlist?f=check`                                                                            | 302, Location exactly `/auth/signin?next=%2Fwatchlist%3Ff%3Dcheck`                                                                                                                                                                                                   |
| pages    | `GET /watchlist/00000000-0000-4000-8000-000000000000`                                               | 302, Location exactly `/auth/signin?next=%2Fwatchlist%2F00000000-0000-4000-8000-000000000000`                                                                                                                                                                        |
| pages    | `GET /auth/set-password`                                                                            | 302, Location exactly `/auth/signin`                                                                                                                                                                                                                                 |
| pages    | `POST /api/watchlist/prices`, JSON, own Origin                                                      | 302, Location exactly `/auth/signin`                                                                                                                                                                                                                                 |
| pages    | `POST /api/watchlist/refresh`, form, `Origin: https://evil.example`                                 | 403                                                                                                                                                                                                                                                                  |
| pages    | `GET /dashboard`, `GET /auth/signup`, `POST /api/auth/signup` (form, own Origin)                    | 404 each                                                                                                                                                                                                                                                             |
| pages    | `GET /auth/signin`                                                                                  | 200; body holds `lang="pl"`, `action="/api/auth/signin"`, "E-mail", "Hasło" and "Zaloguj się"; it doesn't hold "funkcje uwierzytelniania są wyłączone" or `/auth/signup`                                                                                             |
| pages    | the first `/_astro/fonts/…woff2` URL in that body                                                   | 200                                                                                                                                                                                                                                                                  |
| pages    | `GET /auth/confirm?token_hash=<56 zeros>&type=invite`                                               | 200, `Cache-Control` holds `no-store`, `Referrer-Policy` is `strict-origin`, body holds "Ustaw hasło"                                                                                                                                                                |
| pages    | `POST /api/auth/signout`, own Origin, no body                                                       | 302, Location exactly `/auth/signin?signed-out=1`                                                                                                                                                                                                                    |
| sign-in  | `POST /api/auth/signin`, form `email=production-check@example.com` and a fixed password, own Origin | 302, Location exactly `/auth/signin?error=invalid` (a broken key gives `?error=failed`). The form passes `signInFormSchema` (a valid email, a password of 1-72 characters, `src/lib/services/auth.ts`), so `invalid` can only come from Auth's `invalid_credentials` |
| settings | `GET <CHECK_SUPABASE_URL>/auth/v1/settings`, `apikey: <CHECK_SUPABASE_KEY>`                         | 200 JSON with `disable_signup === true` and `external.email === true`; the step prints only those two values                                                                                                                                                         |

#### 3. Running it

**File**: `package.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `scripts/hosted-env.test.mjs` (new)

**Intent**: It runs by hand with its variables set on the command line, its pure rules are unit-tested, and CI runs it against the preview on every PR, the settings group expected to fail.

**Contract**:

- **`package.json`:** `"check:production": "node scripts/check-production.mjs"`, reading only its environment.
- **`vitest.config.ts`:** `include` gains `scripts/**/*.test.mjs`.
- **`hosted-env.test.mjs`:** covers `readCheckEnv`'s refusals and the moved helpers' boundaries:
  - plain http only on `localhost` and `127.0.0.1`;
  - `sb_secret_` and a `service_role` JWT secret, `sb_publishable_` and an `anon` JWT not;
  - an origin with a path refused.
- **CI:** the "Run smoke test against production preview" step, after `npm run smoke`, runs these with `CHECK_APP_URL=http://localhost:4321` and the local stack's URL and anon key:
  - `node scripts/check-production.mjs --skip=settings`, which must pass;
  - `node scripts/check-production.mjs --only=settings`, which must fail, with its output naming `disable_signup`.

### Success Criteria:

#### Automated Verification:

- Lint, type check and the whole unit suite pass, the new script tests included: `npm run lint`, `npx astro check`, `npm run test`
- The check refuses before any request: a missing variable, `CHECK_APP_URL=http://example.com` and a `sb_secret_x` key each exit 1, naming the variable and printing no value
- Against a local production preview with no Supabase configured, `--only=pages` fails on the configuration banner
- CI's `smoke` job passes on the PR, with `pages` and `sign-in` passing against the preview and `settings` failing as expected

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: The migration gate

### Overview

Production tells the publishable key which migrations it has, and a check compares that list with the repository's migration files, in CI against the local stack, by hand against production, and later in the deploy.

### Changes Required:

#### 1. The function

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_applied_migrations.sql` (new, later than `20261001182905`)

**Intent**: A read-only answer to "which migrations does this database have", for a caller holding only the publishable key. It is the observability audit's W4 seam, though no app code calls it yet.

**Contract**:

- `public.applied_migrations()` returns `setof text`: `version` from `supabase_migrations.schema_migrations`, ordered.
- It is `language sql stable security definer set search_path = ''`, and takes no argument.
- Execute is revoked from `public` and `authenticated`, then granted to `anon` only.
- A header comment states:
  - the answer is the versions of the repository's public migration files;
  - `anon` is its only caller, the deploy gate;
  - this deliberately departs from the "grant `authenticated`" convention.

#### 2. The check

**File**: `scripts/check-migrations-applied.mjs` (new), `scripts/check-migrations-applied.test.mjs` (new)

**Intent**: Says whether every migration file in the repository is applied to the database it asks, and refuses otherwise, naming what's missing.

**Contract**:

- **Exports:**
  - `versionOf(fileName)`: the 14-digit prefix of a `YYYYMMDDHHmmss_name.sql`, else null;
  - `missingMigrations(localVersions, appliedVersions)`;
  - `readAppliedMigrations(supabaseUrl, key)`.
- **The request:** `POST <url>/rest/v1/rpc/applied_migrations` with `apikey` only and body `{}`.
- **Fail closed:** it refuses when the answer isn't an array of strings, when the function is missing (PGRST202: "push this change's migration first"), or when a file name has no version. It never reads such an answer as "nothing applied".
- **The CLI:** reads `CHECK_SUPABASE_URL` and `CHECK_SUPABASE_KEY` through `readCheckEnv`, plus `--migrations-dir` (default `supabase/migrations`). It prints the missing versions and exits 1, or prints `All <n> migrations are applied` and exits 0.
- **Tests:** cover `versionOf` (a good name, a bad one) and `missingMigrations`: none missing, one missing, production ahead of the repository, which counts as none missing.

#### 3. CI

**File**: `.github/workflows/ci.yml`

**Intent**: Shows the gate passing on a database that has every migration, and refusing one that lacks a migration.

**Contract**: A new step in the `smoke` job, after the four database checks:

- `node scripts/check-migrations-applied.mjs` against the local stack, which must pass. This also proves `anon` can execute the function.
- The same with `--migrations-dir` pointing at a temporary copy of `supabase/migrations` plus an empty `29991231235959_never_applied.sql`. It must fail, and its output must name `29991231235959`.

### Success Criteria:

#### Automated Verification:

- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`
- The gate refuses before any request on a missing variable or a secret key (exit 1)
- CI's `smoke` job passes on the PR, the gate passing on the local stack and refusing the copy with a version it lacks

#### Manual Verification:

- In the sitting after the merge, the owner runs `npx supabase db push`, and `npx supabase migration list --linked` shows the new migration's remote version

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: The checked deploy and its alert

### Overview

One deploy script chains the gate, `wrangler deploy` and the check for Workers Builds, and a workflow on `main` turns a red build into a failed GitHub run.

### Changes Required:

#### 1. The deploy script

**File**: `scripts/deploy-checked.mjs` (new), `package.json`

**Intent**: The only deploy command Workers Builds needs. It fails closed before anything is deployed, and reports a failed check after the deploy as a non-zero exit.

**Contract**:

- `"deploy:checked": "node scripts/deploy-checked.mjs"`, reading only its environment: Workers Builds' build variables, or values set on the command line.
- Its steps, each printing its own line:
  1. `readCheckEnv` for all three variables, exiting 1 before any request on a refusal.
  2. The gate (`readAppliedMigrations` and `missingMigrations`), exiting 1 on a missing version, with the runbook's pointer.
  3. `npx wrangler deploy` with inherited stdio (`shell` only on Windows), exiting with its code on a failure.
  4. A 10 s wait.
  5. The production check, all groups, exiting 1 on any failure.
- Steps 1-2 never start `wrangler`.

#### 2. The alert

**File**: `.github/workflows/deploy-check.yml` (new), `scripts/wait-for-deploy-check.mjs` (new), `scripts/wait-for-deploy-check.test.mjs` (new)

**Intent**: A red deploy reaches the owner's inbox: the workflow fails, and GitHub emails whoever triggered the push.

**Contract**:

- **The workflow** is named `Deploy check`, with one job `deploy-check`:
  - it runs on `push` to `main`, and on `workflow_dispatch` with an optional `sha` input to re-read a commit after a retried build;
  - `permissions: { checks: read, contents: read }`;
  - it checks out the repository, sets up Node from `.nvmrc`, and runs the script with `GITHUB_TOKEN` and the SHA.
- **The script's polling:**
  - every 15 s, for up to 20 minutes, it reads `GET /repos/{repo}/commits/{sha}/check-runs?filter=latest`;
  - it keeps the run whose app slug is `cloudflare-workers-and-pages` and whose name starts with `Workers Builds:`;
  - it reads `GET /repos/{repo}/commits/main` to tell whether the commit is still `main`'s head.
- **`deployVerdict({ run, isHead, waitedMs })`**, exported and pure, returns `wait`, `pass`, `fail` or `superseded`:
  - a completed run is `pass` when its conclusion is `success`, else `fail`;
  - no run after at least 2 minutes on a commit that is no longer the head is `superseded`, a pass;
  - no run, or a running one, at 20 minutes is `fail`.
- **Output:** the check's name, conclusion and the verdict only, never its `details_url` or summary.
- **Tests:** cover every verdict, from minimal check-run objects with the fields the function reads: `app.slug`, `name`, `status`, `conclusion`. Their shape is that of the endpoint's answer for `2c6adc5` (2026-10-06), with no URL or id.

### Success Criteria:

#### Automated Verification:

- Lint, type check and the whole unit suite pass, the verdict tests included: `npm run lint`, `npx astro check`, `npm run test`
- `npm run deploy:checked` without the variables exits 1 at its first step, and `wrangler` never starts
- `node scripts/wait-for-deploy-check.mjs` for `2c6adc5` in this repository reads its `Workers Builds` check and exits 0 (a read-only public API call)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Docs and rollout

### Overview

The documents describe the gate, the check, the alert and their failures, and the owner switches Workers Builds to the checked deploy and verifies it once, failure included.

### Changes Required:

#### 1. The deploy plan

**File**: `context/deployment/deploy-plan.md`

**Intent**: A runbook the owner follows without this conversation.

**Contract**:

- **A new section, "Checked deploys (rollout Phase 4)":**
  - the one-time setup: the three build variables, all saved as secrets, and the deploy command `npm run deploy:checked`, set after the merge;
  - what each failure means and what to do: a variable refused, a migration missing (push it, then start a new build of `main` from the dashboard or a Deploy Hook), and a check failed (read the build log, then `wrangler rollback` if needed);
  - the emergency path: `npx wrangler deploy` skips both, so run the gate before it and the check after it by hand;
  - the Deploy check email, and that it depends on GitHub's notifications for Actions.
- **Updated lines:**
  - `:297`, the check after each deploy, is now automated, with the curl kept as the manual fallback;
  - `:360`: a red build now emails;
  - `:115` (0.7) is checked;
  - `:293` (8.3) lists the three required checks;
  - `:401-411`, the verification list, gains the checked deploy.

#### 2. CLAUDE.md

**File**: `CLAUDE.md` (project rules above the 10x course block only)

**Intent**: The rules match the new deploy path.

**Contract**:

- The deploy command line (`:44`): Workers Builds runs `npm run build` and `npm run deploy:checked`, which refuses code ahead of its migration, deploys, then checks production signed out.
- The Commands list gains `npm run check:production` and `node scripts/check-migrations-applied.mjs`.
- The "Data" bullet's migration rule (`:55`) names the gate and the confirming check.
- The CI bullet (`:63`) names the `Deploy check` workflow, which still needs no secret.

#### 3. The test plan

**File**: `context/foundation/test-plan.md`

**Intent**: The test plan names where the gate and the check sit. §2's risk #2 change is backported, as the owner chose.

**Contract**:

- **§2, risk #2:** "What would prove protection" and "Likely cheapest layer" name a deploy-time migration gate in Workers Builds instead of a pre-merge one, and why: GitHub can't read production without a secret. No file anchors.
- **§4:** a row for the production checks (scripts in CI and in Workers Builds), and the e2e row no longer says "none yet".
- **§5:** "migration on production before deploy" (Workers Builds, required) and "signed-out production check" (Workers Builds after each deploy, with the Deploy check alert).
- **§6.5, "Adding a production check":**
  - where a step goes, and its group;
  - expected values from the code's contracts, never from production's answer;
  - nothing signed in, nothing that writes, no shop;
  - CI's positive and negative runs;
  - how to try it by hand.
- **§6.6:** this phase's notes. They name the stated limits: no version marker, the shop path on workerd, and drift between deploys.

#### 4. README and infrastructure

**File**: `README.md`, `context/foundation/infrastructure.md`

**Intent**: Remove the stale statements research found.

**Contract**:

- **`README.md`:** the CI section (`:186-191`) lists `ci`, `smoke`, `e2e` and the Deploy check workflow. The Deployment section names Workers Builds and `npm run deploy:checked`.
- **`infrastructure.md:87`:** an agent can't run `npm run smoke` against a non-local stack; `npm run check:production` is the read-only check of a deployment.

### Success Criteria:

#### Automated Verification:

- Prettier leaves the edited documents as they are: `npx prettier --check context/deployment/deploy-plan.md context/foundation/test-plan.md README.md context/foundation/infrastructure.md`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

#### Manual Verification:

- The owner reviews the deploy plan's runbook and the CLAUDE.md and test-plan updates
- After the merge, with the three build variables set and the deploy command switched, a new build of `main` passes the gate, deploys and passes the check in its log, and the `Workers Builds` check and the Deploy check run are green
- With `CHECK_APP_URL` set to a wrong origin, a new build redeploys the same version and turns red, and the Deploy check workflow run by hand for that commit fails; with the variable restored, the next build is green

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `scripts/hosted-env.test.mjs`:
  - `isSecureUrl`, `isSecretKey` and `appOriginOf` at their boundaries;
  - `readCheckEnv`'s refusals, which name the variable and never the value.
- `scripts/check-migrations-applied.test.mjs`:
  - `versionOf` on good and bad names;
  - `missingMigrations`: none, one missing, and production ahead.
- `scripts/wait-for-deploy-check.test.mjs`: every `deployVerdict` outcome. The boundaries are a commit superseded before 2 minutes, which keeps waiting, and a running check at 20 minutes, which fails.

### Integration Tests:

- **CI's `smoke` job:**
  - the production check passes `pages` and `sign-in` against the workerd preview and the local stack;
  - its `settings` group fails on local open sign-up, the check's own negative test;
  - the gate passes on the local stack and refuses a migrations copy with a version the database lacks.
- **Deliberate breaks during implementation:**
  - a `PROTECTED_ROUTES` entry removed: a pages step goes red against the preview in CI, or locally where the preview runs;
  - the gate's comparison inverted: its unit test goes red;
  - the verdict's success test flipped: its unit test goes red.

### Manual Testing Steps:

The owner does steps 1-2 in one sitting after the merge, in their usual checkout:

1. Pull `main`, push the migration with `npx supabase db push`, and confirm its remote version with `npx supabase migration list --linked`. If the CLI says the project isn't linked, run `npx supabase link --project-ref <ref>` first.
2. Set the three build variables (secrets), switch the deploy command to `npm run deploy:checked`, and start a build of `main`. The log shows the gate, the deploy and the check passing, and both GitHub checks are green.
3. Set `CHECK_APP_URL` to a wrong origin and start a build: it turns red after redeploying the same version. Run the Deploy check workflow by hand for that commit: it fails. Restore the variable and start a build: green.

## Performance Considerations

A deploy gains one PostgREST call before `wrangler deploy`, then 10 s and about 15 requests after it. The Deploy check job waits for the build, typically 1-2 minutes, at most 20.

## Migration Notes

`applied_migrations()` is additive and unused by the deployed code, so it is safe in the mixed state where the database is ahead of the code. It reaches production in the owner's sitting after the merge, before the deploy command switches. No deployed code calls it before that switch. The deploy gate starts guarding only when the owner switches the deploy command. Its removal would be one `drop function` migration.

## Implementation Notes

One line per adaptation, added in the phase's commit (`context/foundation/lessons.md`, "Record every adaptation in the plan in the same commit").

### Phase 1

- **Files beyond the plan's list:**
  - `eslint.config.js` adds `AbortSignal` to `scriptsConfig`'s globals, for the requests' 10 s timeout (`AbortSignal.timeout`).
  - `scripts/check-production.test.mjs` unit-tests the check's pure parts (lesson "Keep decision logic in tested services"): `selectGroups`, `needsOf`, `redirectVerdict`, `statusVerdict`, `pageVerdict`, `settingsVerdict`, `fontPathOf` and `failureOf`.
- **A secret key is refused wherever it's set.** `readCheckEnv` refuses a secret `CHECK_SUPABASE_KEY` even when the groups asked for need no key, so a misplaced one is always noticed. This is stricter than the contract, which checked only needed variables. `hosted-env.test.mjs` pins it.
- **CI's negative run greps `disable_signup=false`.** Grepping `disable_signup` alone would also match the `expected … disable_signup=true` line that follows every FAIL, even when no answer came.
- **Output and failures:**
  - Each FAIL is followed by an `expected …` line, as in smoke.
  - The settings step prints `200 disable_signup=<v> email=<v>`, each value being true, false, `missing` or `unreadable`.
  - A step that throws prints `timed out after 10 s`, `no answer (<code>)` or `threw <ErrorName>`, never the error's message, which can hold a URL.
- **Requests:**
  - A timeout is retried once, like a network error, after 1 s; an HTTP answer never is.
  - `POST /api/auth/signup` sends an empty form, so a sign-up route that came back couldn't create an account.
- **Arguments:** `selectGroups` also refuses `--only` with `--skip`, a repeated flag, an empty list and a bare argument. No refusal repeats an argument, which could be a pasted key.
- **For Phase 3:** `runCheck(groups, settings)` is exported, returning the number of failed steps, so the deploy script can run the check in-process.
- **1.3's local run** against a preview with no Supabase also failed the sign-out step: the route then answers a plain `/auth/signin` (`src/pages/api/auth/signout.ts`), a second signal of a missing configuration. Every other `pages` step passed on workerd.
- **1.4 runs only in CI's `smoke` job** (no Docker here), on this branch's draft PR. It passed on `ff8e16e`: every `pages` step and the sign-in probe passed against the workerd preview, and `settings` failed with `disable_signup=false` on local open sign-up.
- **No manual runs against production, and no env file** (the owner's call, 2026-10-06). Checks 1.5 and 2.5 are dropped, and the first run against production is Workers Builds' build after the merge (4.4). `npm run check:production` no longer reads `.env.production`: the scripts read only their environment. The change to Phase 1's files (`package.json`, the check's usage text, a test comment) lands in Phase 2's commit.

### Phase 2

- **Shared with the check:** `scripts/check-production.mjs` (a file beyond the list) exports `TIMEOUT_MS`. The gate reuses it and `failureOf`, so its request has the same 10 s and shows a request with no answer the same way.
- **Exports beyond the contract's three:**
  - `MIGRATIONS_DIR`, `listMigrationVersions`, `appliedVersionsOf(status, body)` (the pure answer handling), and `migrationsDirOf(args)`. `migrationsDirOf` refuses an unknown, repeated or empty argument without repeating it.
  - `checkMigrationsApplied(settings, migrationsDir)`, for Phase 3. It reads the files before any request, prints its own lines, and returns `{ ok: true, count }`, `{ ok: false, missing }` or `{ ok: false, failure }`; it never rejects.
- **Fail closed beyond the contract:**
  - a directory with no `.sql` file is a failure, not "All 0 migrations are applied";
  - a `.SQL` file, which the CLI would skip, is refused, not ignored;
  - subdirectories are skipped.
- **Messages:**
  - A non-200 answer shows only PostgREST's code (`PGRSTnnn` or a SQLSTATE), never the body.
  - The missing-function message and the "Missing on the database" hint name both `npx supabase db push` (production) and `npx supabase migration up --local`, so a local run never points at a push to production.
  - Results go to stdout; refusals and failures go to stderr.
- **CI's negative run greps `Missing on the database: 29991231235959`,** so a run that fails for another reason but prints the file name can't pass. This is Phase 1's `disable_signup=false` precedent.
- **The tests go further than the contract:**
  - `readAppliedMigrations`' request through a stubbed fetch: POST `{}`, exactly `apikey` and `Content-Type`, `redirect: "manual"`, a signal.
  - `checkMigrationsApplied` over temporary directories: no request on a bad file name or an unreadable directory, and no body, URL or key printed.
- **No retry:** a request with no answer fails the gate closed, and a new build of `main` retries it. The check retries once; the gate's refusal is the safer side.
- **No database check of a signed-in caller.** `authenticated` loses execute, but the function guards no data, and anon, its one caller, sees only the repository's public versions.
- **2.4 is the owner's `db push`** of `20261006183345_applied_migrations.sql`, in one sitting after the merge with the Cloudflare setup (the owner's call, 2026-10-06). That's safe for this change: the merged code calls the function only from `npm run deploy:checked`, which the owner switches to after the push.

### Phase 3

- **The gate step calls Phase 2's `checkMigrationsApplied`,** which wraps `readAppliedMigrations` and `missingMigrations`. It refuses with the runbook's pointer when an answer can't be read, not only when a version is missing.
- **Exports for tests:** `deployChecked(env, steps)` takes its gate, deploy, pause and check as injectable steps, with `wranglerDeployCommand`, `deployExitCodeOf`, `PAUSE_MS` and `RUNBOOK`. `scripts/deploy-checked.test.mjs`, a file beyond the list, pins:
  - the order: a refusal or a gate refusal never deploys, a failed deploy returns wrangler's code without checking, a failed check returns 1;
  - that no key or Supabase URL is printed;
  - the commands on Windows and elsewhere.
- **On Windows, wrangler starts as one shell command line,** since Node 24 warns (DEP0190) about an args array with `shell: true`. A wrangler killed by a signal, or never started, exits 1.
- **Both scripts refuse any command-line argument,** so `npm run deploy:checked -- --dry-run` can't deploy for real unnoticed.
- **Shared helpers:** `check-migrations-applied.mjs` (a file beyond the list) exports its `jsonOf` for the wait script, and the wait script imports `RUNBOOK`, so neither is copied.
- **Reading the checks:**
  - `main`'s head is read only when it can decide, that is no run after at least 2 minutes, not on every poll.
  - A poll that can't read the check runs reaches `deployVerdict` as `{ run: null, isHead: null }`, so the 20-minute rule lives in one place. Only a head read as another commit is `superseded`, so an unread poll never is.
  - An answer without `check_runs`, without a whole-number `total_count`, or listing fewer runs than `total_count`, is a failure to read, never "no run".
  - GitHub requests follow no redirect.
- **Output:**
  - A printed name, status or conclusion must match `^[\w .:-]{1,100}$`, else it shows "(unreadable)", so no line can carry a URL, a newline or a workflow command into the public logs.
  - The first line names the repository, the SHA and whether a token is used. On `fail`, the last line goes to stderr with the hint and the runbook, and no URL.
- **Inputs:** `readWaitEnv` trims values, falls back to `GITHUB_SHA` for a blank `DEPLOY_CHECK_SHA`, lower-cases an upper-case SHA, and refuses a repository part that is `.` or `..`. Its refusals name the variable, never the value.
- **The run selection** reads `id` and `started_at`, so the test runs carry made-up ids, though no URL or account id. A run with a readable `started_at` counts as later than one without.
- **Accepted by the contract:**
  - a `cancelled` build reads as `fail`; research saw a superseded commit get no run at all, never a cancelled one;
  - a SHA never on `main`, typed into `workflow_dispatch`, reads as `superseded`.
- **3.3** ran against `2c6adc5`, without a token, with one request: "Workers Builds: drogeria-radar completed success -> pass", exit 0.

## References

- Research: `context/changes/testing-deploy-and-production-checks/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (risks #2, #4), §3 row 4, §5, §6.5
- The incident: `context/archive/2026-09-27-watchlist-add-by-search/plan.md:568-574`
- Similar scripts: `scripts/smoke.mjs` (steps and reporting), `scripts/owner-link.mjs` (refusals before any request), `scripts/e2e-local-db.mjs:219` (guarded CLI entry)
- Similar migration: `supabase/migrations/20260926112205_polite_shop_access.sql:51-52`, `:126-130`
- The audit's W4: `context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:124`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The production check

#### Automated

- [x] 1.1 Lint, type check and the whole unit suite pass, the new script tests included — ff8e16e
- [x] 1.2 The check refuses before any request on a missing variable, an insecure URL and a secret key — ff8e16e
- [x] 1.3 Against a local preview with no Supabase configured, `--only=pages` fails on the configuration banner — ff8e16e
- [x] 1.4 CI's `smoke` job passes, with `pages` and `sign-in` passing against the preview and `settings` failing as expected — ff8e16e

### Phase 2: The migration gate

#### Automated

- [x] 2.1 Lint, type check and the whole unit suite pass — de0103f
- [x] 2.2 The gate refuses before any request on a missing variable or a secret key — de0103f
- [x] 2.3 CI's `smoke` job passes, the gate passing on the local stack and refusing a copy with a version it lacks — de0103f

#### Manual

- [ ] 2.4 The owner's `db push` lands the migration, and `migration list --linked` shows its remote version

### Phase 3: The checked deploy and its alert

#### Automated

- [ ] 3.1 Lint, type check and the whole unit suite pass, the verdict tests included
- [ ] 3.2 `npm run deploy:checked` without the variables exits 1 at its first step, and `wrangler` never starts
- [ ] 3.3 `wait-for-deploy-check` reads `2c6adc5`'s `Workers Builds` check and exits 0

### Phase 4: Docs and rollout

#### Automated

- [ ] 4.1 Prettier leaves the edited documents as they are
- [ ] 4.2 Lint, type check and the whole unit suite pass

#### Manual

- [ ] 4.3 The owner reviews the deploy plan's runbook and the CLAUDE.md and test-plan updates
- [ ] 4.4 After the merge and the switch, a build passes the gate, deploys and passes the check, with both GitHub checks green
- [ ] 4.5 A wrong `CHECK_APP_URL` turns a build red and the Deploy check run red; restored, the next build is green
