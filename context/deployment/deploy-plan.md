---
project: drogeria-radar
planned_at: 2026-09-23
platform: Cloudflare Workers (Worker with static assets, not Pages)
worker_name: drogeria-radar
production_branch: main
auto_deploy: Cloudflare Workers Builds; GitHub Actions stays CI-only
status: deployed # planned → in-progress → deployed
inputs: [context/foundation/infrastructure.md, context/foundation/tech-stack.md]
---

# Drogeria Radar: first deployment plan (Cloudflare Workers)

Approved on 2026-09-23. Checkboxes track execution; the Deployment record at the end says what is live.

**Live since 2026-09-23:**

- The Worker `drogeria-radar` runs on workers.dev and is auto-deployed from `main` by Workers Builds.
- It uses Supabase in Frankfurt with sign-up closed.

**Open items:** none. Workers Paid has been active since 2026-09-27, ahead of S-01, the first feature that calls a shop.

**Decided after the deploy (2026-09-24):**

- dm is dropped from the MVP (PRD FR-013 update, research §9).
- Changes reach `main` only through pull requests. The `preventFailedDeploy` ruleset is active, with `ci` and `smoke` required, and every merge deploys. Since 2026-10-02 it requires `e2e` too, the Playwright suite added by `testing-critical-browser-flows`.
- Since 2026-10-05 (S-07, `invite-only-access`) the app has no sign-up page and sends no email. You add a person as a dashboard account or with an invite or recovery link, and a read-only check after each deploy shows that production still refuses sign-up: see "Accounts and links (S-07)".
- Since S-06 (`super-pharm-in-comparison`, 2026-10-05) Super-Pharm is the fourth shop, priced through its Algolia search with the public key the app keeps in its code. If Super-Pharm changes that key, the old one's 403 stops the shop for everyone until you follow "Super-Pharm stopped with HTTP 403".
- From rollout Phase 4 of the test plan (`testing-deploy-and-production-checks`, 2026-10-06), once you switch its deploy command, Workers Builds deploys with `npm run deploy:checked`. It refuses code whose migration production lacks, checks production signed out after the deploy, and the `Deploy check` workflow emails you about a red build: see "Checked deploys (rollout Phase 4)".

## Context

The skeleton bootstrapped from `10x-astro-starter` (auth pages plus placeholder home and dashboard) has never been deployed. This plan ships it to the platform chosen in `context/foundation/infrastructure.md`: a Cloudflare Worker with static assets, not Pages. It stays inside the stack in `context/foundation/tech-stack.md`: Astro 7 SSR, Supabase auth, GitHub Actions CI and auto-deploy on merge.

Outcome:

- Worker `drogeria-radar` runs on `*.workers.dev` against a production Supabase project with sign-up closed.
- Every push to `main` deploys through Cloudflare Workers Builds.
- This file records what is deployed and which secrets are wired, for milestone planning.

### Starting state (verified 2026-09-23)

- **wrangler:** 4.135.0, logged in via OAuth to one account with Workers scripts write and tail read scopes. The bump from ^4.131.1 is uncommitted in `package.json` and the lock.
- **`wrangler.jsonc`:**
  - name `10x-astro-starter`; `main` is the adapter entrypoint
  - `compatibility_date` 2026-05-08 plus `nodejs_compat`
  - assets `./dist`, observability on, no `preview_urls` key (which defaults to on)
- **Adapter defaults (`@astrojs/cloudflare` 14.3.1):**
  - Unless `session: false` is set, it turns on Astro sessions with a `SESSION` KV binding that has no id, so wrangler would create a KV namespace on deploy.
  - Its default image service adds an `IMAGES` binding.
  - The app uses neither sessions nor `astro:assets`.
- **GitHub:** `yaroslavkhudchenko/10xcourseproject` is **public**, default branch `main`, one commit. `ci.yml` triggers only on `master`, so CI has never run.
- **Env files:** no `.env` or `.dev.vars`. Both Supabase fields are optional secrets read at runtime.
- **Node:** 24.12 locally; `.nvmrc` says 22.14.0 (Astro 7 needs 22.12 or later). Workers Builds honours `.nvmrc`. The lockfile carries the Linux native bindings.
- **Tooling:**
  - Docker 29.2 and Supabase CLI 2.117 (a devDependency)
  - gh 2.101, installed but not logged in
  - husky pre-commit runs lint-staged (eslint on code, prettier on json/css/md)
- **Smoke test:** `scripts/smoke.mjs:43` signs up a fresh user, so it can't run against production once sign-up is closed. It keeps running in CI against a local Supabase.
- **`supabase/config.toml`:** `enable_signup = true`, which the local smoke test needs.

### Decisions this plan makes (clarifying infrastructure.md)

1. **Branch:** the production branch is `main`. `infrastructure.md`, `CLAUDE.md` and the README still say `master`; all get corrected.
2. **Auto-deploy:** Workers Builds deploys `main`. GitHub Actions stays CI-only: lint, check, build, smoke.
   - GitHub holds no Cloudflare token and no Supabase keys.
   - The build step's `env:` block goes, because the build doesn't need the values.
3. **No preview deploys for now:** `preview_urls: false` from the first deploy, and "Enable Preview Builds" unchecked. This is the risk register's "or disable preview builds" option. Two reasons:
   - Versions of the same Worker inherit production secrets.
   - The repo is public.
4. **Only the `ASSETS` binding:** `session: false` and `imageService: "passthrough"`, so the first deploy creates no KV namespace or Images binding that nothing uses. Turn them on deliberately when a feature needs them.
5. **Production Supabase:**
   - A new project in Central EU (Frankfurt) with "Allow new users to sign up" off, and accounts created by the owner.
   - Never run `supabase config push` against production: it would push `enable_signup = true` from `config.toml`.
6. **Egress probe runs on a throwaway Worker outside the repo,** not as a temporary route in the app as `infrastructure.md` suggested.
   - It uses the same account and workers.dev subdomain, so the egress IPs and the `CF-Worker` header are the same.
   - It avoids a public preview of the app carrying production secrets.
   - It avoids the rule that `secret put` fails (API error 10215) while an undeployed version is the latest.
7. **Workers plan:** Free for the skeleton. Switch to Workers Paid ($5/month, budgeted) before the first shop adapter merges.
8. **Approval:** approving this plan is the human go-ahead for exactly these outward actions:
   - the pushes to `main` in 2.7, 7.3 and 8.1; the last two deploy through Workers Builds
   - the manual production deploy in 3.1
   - deploying the probe Worker in 6.2

   Everything else that touches production stays with you: Supabase settings, secrets, deleting the probe Worker, rollbacks.

9. **Public repo:** this file never contains account IDs, emails, the workers.dev subdomain, the Supabase project ref or key values. The full URL goes only into local memory.

Legend: **[agent]** Claude runs it (shell commands in Git Bash) · **[you]** in the dashboard or your own terminal · ⛔ blocking gate

## Phase 0: Prerequisites and CLI setup

- [x] 0.1 ⛔ [you] **The Cloudflare account uses a mailbox you control,** and My Profile shows "(verified)". Workers deploys fail with API error 10034 on unverified accounts.
  - **Done 2026-09-23:** a new account on the correct address; wrangler is re-logged into it (one account). The first deploy confirms verification: 10034 would mean it isn't verified yet.
  - If the address wrangler shows (`npx wrangler whoami`) is mistyped, **don't click resend.** The link, and any password reset, would go to whoever receives mail for that domain.
  - Instead, create an account on your real address, then run `npx wrangler logout` and `npx wrangler login`, and redo 0.3–0.4.
- [x] 0.2 ⛔ [you] **2FA** on the Cloudflare and Supabase accounts, because they own production. You confirmed both on 2026-09-23.
- [x] 0.3 [agent] `npx wrangler whoami` shows one account with Workers write scopes (passed on 2026-09-23). If the OAuth login breaks on the corporate network:
  - `npx wrangler login --device` uses a device code, with no `localhost:8976` callback.
  - `--browser=false` prints the link instead of opening a browser.
  - Behind a proxy, set `HTTPS_PROXY`; under TLS inspection, also set `NODE_EXTRA_CA_CERTS` to the corporate root CA.
  - Last resort: create an API token from the "Edit Cloudflare Workers" template and set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as user-level environment variables, never in the repo.
- [x] 0.4 ⛔ [you] **workers.dev subdomain exists.** The new account already had one, created by Cloudflare at sign-up, so wrangler didn't prompt.
  - Under an AI agent, wrangler 4.135 would instead auto-register the `package.json` name as the account subdomain.
  - The onboarding link that wrangler prints (`/workers/onboarding`) returns 404 today; use Workers & Pages → Change next to "Your subdomain". Dashboard → Workers & Pages should show `<subdomain>.workers.dev`; register one if asked.
  - Without one, a non-interactive `wrangler deploy` uploads the Worker and then stops with "You need to register a workers.dev subdomain…" plus an onboarding link.
  - DNS for a new subdomain "may take a few minutes".
- [ ] 0.5 [you, optional] `gh auth login`, so the agent can follow CI with `gh run watch`. Otherwise you watch the Actions tab.
- [ ] 0.6 [you, optional] Your work email is on the public commit history. To keep it off new commits, run `git config user.email <id>+<user>@users.noreply.github.com` in this repo before 2.7.
- [x] 0.8 [agent] **Cloudflare agent setup** (`developers.cloudflare.com/agent-setup/prompt.md`), done 2026-09-23:
  - `claude plugin marketplace add cloudflare/skills`, then `claude plugin install cloudflare@cloudflare` (user scope)
  - it adds 14 skills (including `wrangler` and `workers-best-practices`) and the remote MCP server `mcp.cloudflare.com/mcp`, which asks for OAuth on first use
  - no hooks or commands
  - run `/reload-plugins` to load it
  - The plan still drives production through wrangler; the MCP server is for live-state queries.
- [x] 0.7 [you] Supabase CLI: `npx supabase login` and `npx supabase link --project-ref <ref>` are needed from the first migration on. Never run `supabase config push` to production (see decision 5).
  - **Done:** your machine is logged in and linked. A new machine needs both commands once; in PowerShell, write `npx.cmd` (see "Checked deploys (rollout Phase 4)").

## Phase 1: Production Supabase project [you]

- [x] 1.1 Create project `drogeria-radar` on the Free plan in region **Central EU (Frankfurt)**, `eu-central-1`. Pick it by name, not the generic "Europe". Save the database password in your password manager.
  - **Creation options chosen 2026-09-23:**
    - Data API on
    - "Automatically expose new tables" **off**: every migration must grant table privileges explicitly
    - automatic RLS on
    - Postgres (not OrioleDB)
- [x] 1.2 ⛔ Authentication → Sign In / Providers → set **Allow new users to sign up** to off. Keep the Email provider enabled, because password sign-in needs it.
  - The first attempt didn't take effect; 5.1 caught it. It works after switching off **and clicking Save**.
- [x] 1.3 Authentication → URL Configuration → set Site URL to `https://drogeria-radar.<subdomain>.workers.dev`. No emails are sent, but it replaces the `localhost:3000` default.
- [x] 1.4 Authentication → Users → Add user → Create new user with your email and a strong password, and tick **Auto Confirm User**. Without it, sign-in fails with "Email not confirmed".
- [x] 1.5 Save the Project URL and the **publishable** key (`sb_publishable_…`) in your password manager for Phase 4. Both are in the Connect dialog; the key is also under Settings → API Keys.
  - Never use the secret key (`sb_secret_…`) or service_role: both bypass RLS.
  - Don't paste either value into this chat.
- **Free-plan behaviour:**
  - The project pauses after 7 days with too little activity; a warning email comes first.
  - While paused, requests fail with HTTP 540 and the app looks broken until you click Resume project.

## Phase 2: Repo preparation [agent], one commit pushed to `main`

- [x] 2.1 **`wrangler.jsonc`:**
  - Rename `10x-astro-starter` to `drogeria-radar`, here and in `package.json` and both top-level `name` fields of `package-lock.json`.
  - Add `"preview_urls": false`.
  - `main`, `assets` and `compatibility_date` stay as they are.
- [x] 2.2 **`astro.config.mjs`:** set `session: false` and `cloudflare({ imageService: "passthrough" })`, with a one-line comment on why.
- [x] 2.3 **`.github/workflows/ci.yml`:** change `branches: [master]` to `[main]` for `push` and `pull_request`, and delete the build step's `env:` block.
- [x] 2.4 **Stale docs:**
  - `CLAUDE.md` project section only, never inside the 10x-cli block:
    - line 36: production deploys are merges to `main`
    - line 52: CI branch; no secrets needed
    - line 55: branch `main`, repo has commits
    - the invite-only bullet: never `supabase config push` to production
  - README CI section: `main`, no secrets needed.
  - `infrastructure.md`: `main` at lines 84, 87 and 114; previews off (line 84); gh installed (line 88).
- [x] 2.5 Write this plan to `context/deployment/deploy-plan.md` with `status: in-progress`.
- [x] 2.6 **Preflight**, all must pass: `npx astro sync` → `npm run lint` → `npx astro check` → `npm run build` → `npx wrangler deploy --dry-run`.
  - The build runs with no `.env` present, which proves CI doesn't need the Supabase values.
  - The dry run must print "Using redirected Wrangler configuration", show the name `drogeria-radar` and **only** the `ASSETS` binding, and report the bundle size. The limit is now 64 MiB uncompressed.
  - **Result, 2026-09-23:**
    - lint clean; `astro check` 0 errors across 29 files; the build succeeded with no `.env`
    - the generated `dist/server/wrangler.json` has name `drogeria-radar`, `preview_urls: false`, no KV or Images binding
    - dry run: bindings `env.ASSETS` only; upload 2,038 KiB (449 KiB gzip), 29 modules
  - **Windows note:** `core.autocrlf=true` had left `astro.config.mjs`, `eslint.config.js` and `scripts/smoke.mjs` with CRLF in the working copy, and Prettier flagged every CR. The committed blobs are LF, so CI isn't affected. Converting the three files back to LF fixed local lint.
- [x] 2.7 **Commit and push:**
  - Commit `chore: prepare first Cloudflare Workers deploy`, including your pending wrangler bump.
  - Check `git show HEAD -- CLAUDE.md`: after the prettier hook it must touch only project-section lines, with the lesson block byte-identical.
  - Push to `origin main`. Workers Builds isn't connected yet, so this only runs CI.
  - **Result:** pushed as `3553b4a`; the CLAUDE.md diff touches only project-section lines.
- [x] 2.8 The first CI run on `main` is green (both jobs). Any failure gets fixed before Phase 3.
  - **Result:** green on `468c9cb`, the third run. Both `ci` and `smoke` passed.
  - **The first two runs failed:** both jobs stopped at `npm ci` with `Missing: @emnapi/runtime@1.11.3` and `@emnapi/core@1.11.3 from lock file`.
    - Cause: since the initial commit, the lockfile was written by the local npm 11.6.2, which leaves these entries out.
    - `npm ci` in npm 10.9.2 (Node 22) and in npm 11.16.0 (Node 24.18.0) both reject it; reproduced locally.
    - The first fix attempt (moving CI to Node 24) rested on a wrong diagnosis.
  - **Fix:**
    - The lockfile was regenerated with `npm@11.16.0 install --package-lock-only`: 8 entries added, no version changes.
    - `npm ci` now passes with npm 10.9.2, 11.6.2 and 11.16.0.
    - `.nvmrc` stays at 24.18.0 (the Workers Builds default, npm 11.16.0), and both CI jobs read it. Dependency changes made with the `.nvmrc` Node therefore produce lockfiles that CI accepts.

## Phase 3: First production deploy [agent]

- [x] 3.1 Run `npm run build && npx wrangler deploy --tag "$(git rev-parse --short HEAD)" --message "first deploy: starter skeleton"`. It prints `https://drogeria-radar.<subdomain>.workers.dev` and the version ID.
  - **Done 2026-09-23 21:27 UTC:** you ran it in your own terminal. Version `d25099a4-4f91-4e32-8f8b-67b63eb0233e`, tag `468c9cb`, source Upload, at 100%.
- [x] 3.2 `curl /` must return 200 **with** the "Supabase nie jest skonfigurowany" banner. There are no secrets yet, so this proves the null-client contract works in production.
  - **Result:**
    - `/` returns 200 (5 KB, 117 ms) with the banner.
    - `/dashboard` returns 302 to `/auth/signin`.
    - `/_astro/*` returns 200 with `public, max-age=31536000, immutable`.
    - The version preview URL returns 404, so `preview_urls: false` holds.
- **Support:**
  - Error 10034: back to 0.1.
  - Subdomain registration error: back to 0.4.
  - TLS error or 404 on a brand-new subdomain: wait a few minutes and retry.
  - Error 1101 or 1102: check `npx wrangler tail drogeria-radar --format pretty` and Workers Logs.

## Phase 4: Secrets [you, own terminal]

The values never pass through the agent.

- [x] 4.1 `npx wrangler secret put SUPABASE_URL --name drogeria-radar`, then paste `https://<ref>.supabase.co` with no quotes and no trailing slash. **Done:** version `b06bf8cc` (21:49 UTC), URL only.
- [x] 4.2 `npx wrangler secret put SUPABASE_KEY --name drogeria-radar`, then paste the publishable key. **Done:** version `32248307` (21:50 UTC) has both secrets and is current.
- [x] 4.3 [agent] `npx wrangler secret list --name drogeria-radar` shows both names. **Done:** `SUPABASE_KEY` and `SUPABASE_URL`.
- **Notes:**
  - Each `secret put` creates and deploys a new version immediately.
  - To fix a wrong value, run `secret put` again. To rotate, create a new key in Supabase, then run `secret put`.

## Phase 5: Verify production

- [x] 5.1 [agent] With `npx wrangler tail drogeria-radar --format pretty` running in the background (no exceptions expected), run `curl` without `-L`. POSTs send `Origin: https://drogeria-radar.<subdomain>.workers.dev` exactly, because Astro's origin check returns 403 otherwise.
  - `GET /` returns 200 and the page no longer contains "nie jest skonfigurowany".
  - `GET /dashboard` without cookies returns 302 to `/auth/signin`.
  - `POST /api/auth/signup` with a throwaway `@example.com` address returns 302 to a location starting `/auth/signup?error=Signups%20not%20allowed%20for%20this%20instance`.
    - This proves Supabase enforces invite-only, not just the UI.
    - Anything else means sign-up is still open: stop, redo 1.2, and delete any user it created.
  - `POST /api/auth/signin` with a wrong password returns 302 to `/auth/signin?error=Invalid%20login%20credentials`. This tells a working key apart from "Invalid API key" or a missing config.
  - **Run 1 (2026-09-23 21:5x UTC):**
    - `/` returns 200 without the banner.
    - `/dashboard` returns 302 to `/auth/signin`.
    - Wrong-password sign-in returns 302 `…?error=Invalid%20login%20credentials`: Supabase is reached with a valid key.
    - A POST without `Origin` returns 403.
    - **Sign-up FAILED the check:** Supabase answered `Email address "…@example.com" is invalid` instead of `Signups not allowed for this instance`. Supabase Auth's `Signup` handler checks `DisableSignup` before it validates the email, so sign-up is still open on the production project.
    - No user was created: Supabase rejects `example.com`.
    - Stop: redo 1.2 (switch off and **Save**), then run the sign-up check again.
  - **Run 2, after Save:** sign-up returns 302 `…?error=Signups%20not%20allowed%20for%20this%20instance`. Supabase now enforces invite-only.
  - **Tail:** 5 events, all `ok`, 0 exceptions.
- [x] 5.2 [you] On your phone, sign in with the account from 1.4: you land on `/`, `/dashboard` renders, and sign-out returns you to `/`. **Done:** you confirmed it on 2026-09-24.
- [x] 5.3 [agent] Record the version IDs from `npx wrangler deployments list --name drogeria-radar`. In Workers Logs, note the CPU time of an SSR request against the Free plan's 10 ms cap.
  - **Versions:**
    - `d25099a4`: code, no secrets
    - `b06bf8cc`: URL only
    - `32248307`: both secrets, current
  - **CPU time from tail:**
    - `GET /` 12 ms, sign-up POST 11 ms, `/dashboard` 6 ms, sign-in 2 ms
    - The skeleton already touches the Free cap of 10 ms. Occasional overruns are tolerated; repeated ones fail with 1102.
    - Consider switching to Workers Paid before the first real feature, not only before the first adapter.

## Phase 6: Egress probe on a throwaway Worker

This replaces step 5 of Getting Started in `infrastructure.md`.

- [x] 6.1 [agent] **The probe Worker:** write it in the session scratchpad, outside the repo, so wrangler can't pick up the app's redirected config. It is a module Worker of about 40 lines named `drogeria-radar-egress-probe`, with its own `wrangler.jsonc`:
  - compatibility date 2026-05-08, `preview_urls: false`, no bindings, no secrets
  - `GET ?target=<name>` makes one outbound request
  - it returns status, time in ms, content type, whether the expected field is present, `request.cf.colo` and any caught error
  - User-Agent: the descriptive one the adapters are meant to send (research §7), `DrogeriaRadar/0.1 (+https://github.com/yaroslavkhudchenko/10xcourseproject)`

  Targets:
  - `rossmann`: `v4/api/Products`, `pageSize=1`
  - `hebe-lbx` and `natura-lbx`: Luigi's Box search
  - `dm`: product-search, following the redirect
  - `superpharm-page`: is `algoliaConfig` present?
  - `superpharm-algolia`: one query with the key read from that page
  - `hebe-page` and `natura-page`: the home pages

- [x] 6.2 [agent] Deploy it from that folder with the repo's wrangler. Call each target once, at least 1 second apart.
  - **Done 2026-09-23:** version `fd7ef3a9`. Each target was called once, 2 s apart, all from WAW.
- [x] 6.3 [agent] Add a section "Egress from Cloudflare Workers (2026-09-xx)" to `docs/research/polish-drugstore-price-apis.md`, with status and colo per target and the User-Agent used.
  - **Done:** §9 of the research note.
  - Rossmann, Hebe, Super-Pharm (page and Algolia) and Natura all return 200 with the expected fields.
  - **dm returns 403** from Workers.
- [x] 6.4 A shop that answers 403, 429 or a challenge gets no retries.
  - **dm:** no retries. One control request from the developer machine with the same User-Agent got the normal 302 to `/pl/search/crawl`, so dm blocks Cloudflare Workers traffic, not the User-Agent.
  - **Decided 2026-09-24:** dm is dropped from the MVP, with no proxy. Proxying around a block aimed at Cloudflare traffic would conflict with "never circumvent bot protection".
  - One control request from your machine with the same User-Agent tells an IP block from a User-Agent block. Never switch to a browser User-Agent to get past it.
  - The fallback (a Fly.io machine with a fixed egress IP behind the adapter interface) becomes a milestone item outside this plan.
- [x] 6.5 ⛔ [you] **Done 2026-09-23:** at your request the agent ran the delete (after a dry run) from the probe's own folder. The Worker now returns code 10007 (doesn't exist), and production is untouched. Delete the probe in the dashboard: Workers & Pages → `drogeria-radar-egress-probe` → Settings → Delete. Or run `npx wrangler delete drogeria-radar-egress-probe`; the name is positional.
  - Check the name twice: `drogeria-radar` is production.

## Phase 7: Auto-deploy `main` with Workers Builds

- [x] 7.1 [agent] Commit the research note and this file's progress; don't push yet. **Done:** `96ee2e2`, local only.
- [x] 7.2 [you] **Done 2026-09-23:** connected with Preview Builds unchecked. Dashboard → Workers & Pages → `drogeria-radar` → Settings → Builds → Connect → GitHub. Install the "Cloudflare Workers and Pages" app for this repository only, then set:
  - production branch: `main`
  - build command: `npm run build` (the default is empty)
  - deploy command: `npx wrangler deploy` (the default)
  - root directory: empty
  - build variables: none
  - Branch control → **Enable Preview Builds: unchecked.** Branch builds would otherwise run `npx wrangler preview` (Worker Previews, launched 2026-09-22), which is public by default.

  Cloudflare creates the build API token itself; don't delete it. Connecting doesn't start a build.

- [x] 7.3 [agent] **Done 2026-09-23 22:11 UTC:** the push of `96ee2e2` ran Workers Builds build `0951c850`, which deployed version `a95a6036` at 100% (source "Unknown (deployment)", trigger `version_upload`).
  - The GitHub check "Workers Builds: drogeria-radar" passed, and `ci` and `smoke` passed.
  - Both secrets are still bound. `/` returns 200 without the banner, sign-in reaches Supabase, and sign-up is refused.
  - The build log itself wasn't read (it's only in the dashboard). The green build shows that `npm clean-install` accepted the lockfile under the Node version from `.nvmrc`.
  - Push the 7.1 commit, which runs the first Workers Build. Check that:
  - the build log shows `npm clean-install`, Node 24.18.0 from `.nvmrc` and a successful `npx wrangler deploy`
  - GitHub shows the Workers Builds check on the commit
  - `npx wrangler deployments list --name drogeria-radar` has the new version
  - `/` still returns 200 without the banner, so the secrets survived

## Phase 8: Record and hand-off

- [x] 8.1 [agent] Fill in the Deployment record and set `status: deployed`. Commit and push; it's docs-only, so Workers Builds redeploys identical code.
- [x] 8.2 [agent] Update the project memory, including the full production URL (local only).
- [x] 8.3 [you, optional] **Done 2026-09-24:** ruleset `preventFailedDeploy`, enforcement **Active**. On `main`: no deletion, no force-push, PR required, and three checks required: `ci` and `smoke`, and `e2e` since 2026-10-02. Turn on branch protection for `main`, requiring the CI checks. Workers Builds deploys every push to `main` whether or not GitHub Actions passed, so from here on merge through PRs with green CI. The `Deploy check` workflow isn't required: it runs after a merge and only reports (see "Checked deploys (rollout Phase 4)").

## Operations after this plan

- **Deploy:** merge a pull request into `main`. The ruleset requires green `ci`, `smoke` and `e2e`, and the merge deploys through Workers Builds with `npm run deploy:checked`. It refuses code whose migration production lacks, deploys, then checks production signed out, the read-only sign-up check included (see "Checked deploys (rollout Phase 4)"). The manual sign-up check in "Accounts and links (S-07)" stays as a fallback. A manual `wrangler deploy` is for emergencies only, and only from a clean, up-to-date `main`: `git status` clean, then `npm ci`, `npm run build`, `npx wrangler deploy`. It skips the gate and the check, so run both by hand around it (the emergency path in "Checked deploys (rollout Phase 4)").
- **Rollback [you]:** run `npx wrangler versions list --name drogeria-radar`, then `npx wrangler rollback <version-id> --message "<why>"`.
  - Then revert the bad commit on `main`, or the next push redeploys it.
  - A version carries its secret set, and wrangler asks you to confirm when the sets differ. So never roll back to the Phase 3 version `d25099a4` (no secrets) or the 4.1 version `b06bf8cc` (URL only), and never past a key rotation.
  - Supabase migrations don't roll back with the code.
- **Non-interactive shells:** wrangler answers its own confirmation prompts with **yes** in non-interactive shells (agents, CI). This applies to `delete` and to rollback's secret-change warning. So destructive commands run only when a human asks, always with an explicit name, and after `--dry-run` where it exists.
- **Secrets:** `secret put` fails with API error 10215 while an undeployed version is the latest. Deploy first, or use `npx wrangler versions secret put`.
- **Logs:** `npx wrangler tail drogeria-radar --format json --status error`, or Workers Logs in the dashboard. Retention and event limits depend on the Workers plan; the Free plan kept 3 days.

## Checked deploys (rollout Phase 4)

From rollout Phase 4 of the test plan (`testing-deploy-and-production-checks`, 2026-10-06), Workers Builds deploys with `npm run deploy:checked` (`scripts/deploy-checked.mjs`) instead of `npx wrangler deploy`, once you switch its deploy command in the sitting below. It refuses code whose migration production lacks, deploys, then checks production signed out, and any failure turns the build red. The `Deploy check` workflow then fails on GitHub, which emails you. Nothing goes into GitHub's secrets, and the checks write nothing to production: their one Auth call is a sign-in for an address no one has, which Auth refuses.

**Windows:** your PC's PowerShell blocks `npx.ps1`, so the commands here are written `npx.cmd`; in Command Prompt or Git Bash, plain `npx` works. The Supabase CLI comes with the project (2.117.0). A new machine needs `npx.cmd supabase login` and `npx.cmd supabase link --project-ref <ref>` once (0.7), and yours has both.

### What a deploy does

`npm run deploy:checked` prints one line per step, and stops at the first that fails:

1. `deploy-checked: 1/5 reading CHECK_APP_URL, CHECK_SUPABASE_URL and CHECK_SUPABASE_KEY`. It refuses when one is missing, when a URL isn't https (plain http only for `localhost` or `127.0.0.1`) or the app's has a path, and when the key is a secret one.
2. `deploy-checked: 2/5 migration gate: every migration in supabase/migrations must be on the database`. It asks production's `applied_migrations()` with the publishable key, then prints `All <n> migrations are applied`, or `Missing on the database: <versions>` and refuses.
3. `deploy-checked: 3/5 npx wrangler deploy`, then wrangler's own lines. The new version takes all traffic at once.
4. `deploy-checked: 4/5 waiting 10 s for the new version to answer`. No answer of the app says which version gave it, so in that window the check could still meet the old one.
5. `deploy-checked: 5/5 production check of <app origin>, every group`: one `PASS` or `FAIL` line per step of `npm run check:production`, then "All production check steps passed" and `deploy-checked: deployed, and production passed its check`.

A refusal at 1/5 or 2/5 deploys nothing. A missing or wrong variable refuses the deploy, so the gate is never silently off (your call: fail closed). No line holds the key or the Supabase URL. The app's origin appears, in a log only the Cloudflare account can read.

Its three build variables, all saved as secrets, so each is hidden once saved:

- `CHECK_APP_URL`: the app's https origin with no path, `https://drogeria-radar.<subdomain>.workers.dev`.
- `CHECK_SUPABASE_URL`: the Project URL, `https://<ref>.supabase.co` (1.5).
- `CHECK_SUPABASE_KEY`: the publishable key, `sb_publishable_…` (1.5), never a secret one: a `sb_secret_…` or `service_role` key is refused.

No file holds them (your call). The scripts read only their environment: Workers Builds' build variables, or values set inline for a run by hand.

### One sitting after the merge

After this change's pull request merges, do these in one sitting, in this order. No check runs against production before step 4: Workers Builds' build there is the first run (your call).

1. [you] `git pull` in your usual checkout, on `main`.
2. [you] `npx.cmd supabase db push`. It lists `20261006183345_applied_migrations.sql`, asks you to confirm, and asks for the database password (1.1). Then `npx.cmd supabase migration list --linked` must show its remote version.
   - This change's own migration goes after its merge, unlike any other. That is safe: only `npm run deploy:checked` calls the function, and you switch to it in step 3, after the push. Every later migration is pushed before its merge, which the gate now enforces ("Later migrations" below).
3. [you] Cloudflare dashboard → Workers & Pages → `drogeria-radar` → Settings → Build:
   - under "Build Variables and Secrets", add the three variables above, each as a secret. They belong there, not under the Worker's own "Variables and Secrets", which the build doesn't see;
   - then change the deploy command from `npx wrangler deploy` to `npm run deploy:checked`. Switch it only after step 2 and with the variables set: before the push the gate refuses every deploy, and without the variables the script does.
4. Start a build of `main`: retry the latest build from the Worker's build history ("View build history" on the Deployments tab). If the dashboard offers no retry, create a Deploy Hook for `main` under the build settings and POST to it once: `curl -X POST <hook URL>`. The hook's URL starts a build for anyone who has it, so keep it private, like a key.
5. Check the build's log: the five step lines, `PASS` on every check step, and "All production check steps passed". On GitHub, the commit's `Workers Builds: drogeria-radar` check must be green. Then run the `Deploy check` workflow by hand (Actions → Deploy check → Run workflow, the commit left empty for `main`'s head), since a retried build has no push to start it. It must pass.
   - A log without `deploy-checked:` lines means the retry kept the old deploy command: start the build with a Deploy Hook instead.
   - A refusal at 1/5, `set CHECK_APP_URL, CHECK_SUPABASE_URL, CHECK_SUPABASE_KEY in this command's environment`, means build variables don't reach the deploy command. Nothing was deployed: switch the command back to `npx wrangler deploy`.
6. The failure path, once: set `CHECK_APP_URL` to `http://127.0.0.1:4321`, an address the script accepts but where nothing listens in the build, and start a build. It redeploys the same version, which is harmless, then the check's steps against the app fail with `no answer (ECONNREFUSED)`, and the build turns red. When it has finished, run `Deploy check` by hand: it fails, and GitHub emails you. Then set `CHECK_APP_URL` back to the app's origin and start a build: green.
   - If the build stays green although its log shows `FAIL` lines, a failure after the deploy doesn't turn a build red: the gate still refuses before a deploy, but a failed check would reach no one.

### What a red build means

The GitHub check says only that the build is red; its log in the dashboard says where it stopped. CI runs the same check against the preview on every pull request, so a step that fails only on production most likely points at production's settings, not at the code.

- **1/5, a variable refused** (`set … in this command's environment`, `CHECK_APP_URL isn't the app's https origin …`, `CHECK_SUPABASE_URL isn't the project's https URL …` or `CHECK_SUPABASE_KEY is a secret key …`): fix it under Build Variables and Secrets, then start a build. Nothing was deployed.
- **2/5, `Missing on the database: <versions>`:** a merged migration isn't on production. Push it with `npx.cmd supabase db push`, confirm it with `npx.cmd supabase migration list --linked`, then start a build of `main`. Nothing was deployed, so production stays on the previous version.
- **2/5, `the database has no applied_migrations() (PGRST202)`:** this change's own migration isn't pushed. Do step 2 of the sitting, then start a build. Nothing was deployed.
- **2/5, any other failure** (`applied_migrations() answered HTTP <status>`, `asking applied_migrations() failed: …`): the gate couldn't read production. Check that the project isn't paused (Phase 1's Free-plan note) and that `CHECK_SUPABASE_URL` and `CHECK_SUPABASE_KEY` name it, then start a build. Nothing was deployed.
- **3/5, `npx wrangler deploy failed (exit <n>)`:** as before this change; wrangler's lines above say why. Nothing was checked.
- **5/5, `<n> production check step(s) failed`:** the new version **is** live, and nothing rolls back on its own (your call). Read each `FAIL` line and the `expected` line under it. If production is broken, roll back as the "Rollback" bullet in "Operations after this plan" says, then revert the commit on `main`. The likely causes:
  - the sign-in page `holding 'funkcje uwierzytelniania są wyłączone'`: the Worker lacks `SUPABASE_URL` or `SUPABASE_KEY`, so put it again (Phase 4: Secrets);
  - the sign-in probe `302 /auth/signin?error=failed`: the Worker's key no longer works, so put the current publishable key (Phase 4: Secrets); `?error=busy` means Auth limited sign-ins, so start a build later;
  - the settings step `disable_signup=false`: sign-up is open, so redo 1.2; `email=false`: the email provider is off, so switch it on (1.2); an HTTP status instead: `CHECK_SUPABASE_URL` or `CHECK_SUPABASE_KEY` is wrong;
  - the steps against the app `no answer (…)` or `timed out after 10 s`: check `CHECK_APP_URL`, then Workers Logs.

### The emergency path

When the checked deploy is in the way, either switch the deploy command back to `npx wrangler deploy` in the dashboard and start a build, or deploy by hand from a clean, up-to-date `main` after `npm run build` (the "Deploy" bullet in "Operations after this plan"). Both skip the gate and the check. So when you can, run them by hand around the deploy, in Git Bash, with the variables inline for that run:

```bash
CHECK_SUPABASE_URL=<project URL> CHECK_SUPABASE_KEY=<publishable key> node scripts/check-migrations-applied.mjs
# deploy, then:
CHECK_APP_URL=<app origin> CHECK_SUPABASE_URL=<project URL> CHECK_SUPABASE_KEY=<publishable key> npm run check:production
```

Switch the deploy command back to `npm run deploy:checked` once the emergency is over.

### The alert

- The `Deploy check` workflow (`.github/workflows/deploy-check.yml`) runs on every push to `main`. It waits up to 20 minutes for the commit's `Workers Builds: drogeria-radar` check, and fails when that build failed or when no build of the commit completed in time; then look in the Worker's build history, and start a build of `main` if none ran. It passes when the build succeeded, and when the commit got no build but `main` moved past it, since a burst of merges can build only the newest commit.
- A failed run makes GitHub email whoever triggered it: for a push, whoever merged, which is you. The email depends on your GitHub notification settings for Actions (Settings → Notifications → Actions), which must email you about failed workflows.
- It holds no secret, only its read-only `GITHUB_TOKEN`. Its log is public, so it names the check and its conclusion, never a link; the `FAIL` lines are in the build's log in Cloudflare.
- A retried build, or one a Deploy Hook started, has no push, so no `Deploy check` runs for it: once the build has finished, run it by hand (Actions → Deploy check → Run workflow), with the commit's SHA, or none for `main`'s head.
- It isn't a required check: it runs after the merge and only reports.
- A failure at runtime, such as a shop stopped by a 403, still alerts no one ("Super-Pharm stopped with HTTP 403").
- There are no scheduled checks between deploys (your call): a setting changed in a dashboard shows at the next deploy, or when you run `npm run check:production` by hand.

### Later migrations

Push each migration with `npx.cmd supabase db push` before its pull request merges, as always (`CLAUDE.md`, "Data"), and confirm it with `npx.cmd supabase migration list --linked`. Push it from a checkout of the pull request's branch. Before the merge the migration file exists only there, so a push from `main` finds nothing new and sends nothing, as S-04's first push did. The list then still shows the new version without a remote time. If you forget, the gate refuses the deploy and the `Deploy check` emails you, while production stays on the previous version: push the migration, then start a build of `main`.

## Accounts and links (S-07)

Since S-07 (`invite-only-access`, 2026-10-05) the app has no sign-up page and sends no email. You give a person access in one of two ways. A secret key never goes into the app, the Worker, the repo, `.env`, `.dev.vars`, CI or this chat.

- **An account [you]:** Authentication → Users → Add user → Create new user, with the person's email and a password, and **Auto Confirm User** ticked, as in 1.4. Hand the password over yourself. When they need a new password later, make them a recovery link.
- **A link [you, own terminal]:** an invite for a new person, who then picks their own password, or a recovery for someone who has an account and needs a new password.
  1. Settings → API Keys: create a secret key (`sb_secret_…`) for this use only, named so you'll recognise it.
  2. Run the owner script in your own terminal. The first line reads the key without showing it or keeping it in the shell's history (paste it, then press Enter), and the last one drops it again:

     ```bash
     read -rs SUPABASE_SECRET_KEY && export SUPABASE_SECRET_KEY
     SUPABASE_URL=<project URL> APP_URL=<app origin> node scripts/owner-link.mjs <invite|recovery> <email>
     unset SUPABASE_SECRET_KEY
     ```

     - `APP_URL` is the app's origin with no path: `https://drogeria-radar.<subdomain>.workers.dev`. Both URLs must be https; the script takes http only for `localhost` and `127.0.0.1`, so a typo can't send the key in clear or print a link that opens over plain http.
     - The script asks Auth's admin API for the link (`generateLink`), which sends no email. It prints only the link on stdout, `<APP_URL>/auth/confirm?token_hash=…&type=…`, and a reminder on stderr.
     - It refuses any bad input before it asks anything, a publishable or anon key included, and never prints the key.
     - `email_exists` means the address already has an account: make a recovery link. `user_not_found` means it has none: make an invite link.

  3. Hand the link over yourself, in a private message: whoever presses its button first sets the account's password.
     - Opening the link uses nothing, so a link preview can't spend it: the page only shows "Ustaw hasło".
     - The button signs the person in and opens a form for their password, 8 to 72 characters counted in bytes (a Polish letter counts twice), with "Zapisz hasło". The form shows the account's email, so the person sees whose password they set. Only a session a link opened in the last 60 minutes can use that form.
     - A saved password lands on their list with "Hasło zapisane.".
  4. Delete the key under Settings → API Keys. The link keeps working without it, since the app checks it with its own publishable key. Make a new key for the next link.

- **How a link behaves:**
  - It works once, for 24 hours from when the script made it (the Email OTP expiration below).
  - A used, expired or unknown link shows "Link wygasł albo został już użyty. Poproś o nowy.": make a new one.
  - A newer link of the same type for the same email makes Auth refuse the older one.
  - A second invite for an address whose first link wasn't used yet is made too, and replaces the first. Once the person has pressed "Ustaw hasło", Auth counts the account as confirmed, with a temporary password no one knows, so an invite answers `email_exists`: make a recovery link. It's also the way back for someone who pressed the button but never saved a password.
  - Workers Logs (`observability` in `wrangler.jsonc`) keep each request's URL, so a link that was opened but not yet used is there, token included, until it's used or expires. Only members of the Cloudflare account can read them, which is accepted (S-07 implementation review, F2). Don't add a log export that keeps URLs.
- **Production settings [you], before the first link:** Authentication → Sign In / Providers → Email.
  - "Email OTP expiration": **86400** seconds, so a link works for 24 hours.
  - "Email OTP length": **10** digits, which keeps a link unguessable for that long.
  - Both are the fields' maximums. They affect only email codes and links, and the app sends none. Local `supabase/config.toml` has the same values.
  - Set them in the dashboard only. Never run `supabase config push` (decision 5).
- **Read-only check that sign-up stays refused:** every checked deploy runs it, as the `settings` group of its production check ("Checked deploys (rollout Phase 4)"). By hand [you], it's the fallback, after a deploy that skipped the check: put the Project URL and the publishable key from your password manager (1.5) into your shell's environment, then run:

  ```bash
  curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $SUPABASE_PUBLISHABLE_KEY"
  ```

  - The answer must hold `"disable_signup":true` and, under `"external"`, `"email":true`: sign-up refused, and the email provider on, which password sign-in needs (1.2).
  - Anything else means sign-up is open or sign-in is off: redo 1.2.
  - It creates nothing and needs no secret key. It replaces the sign-up attempt of 5.1, whose route the app no longer has.

## Super-Pharm stopped with HTTP 403

Since S-06 (`super-pharm-in-comparison`) Super-Pharm's prices come from its Algolia search, with the public search-only key that every superpharm.pl page carries. The app keeps that key in the code as `SUPER_PHARM_SEARCH_KEY` (`src/lib/services/shops/super-pharm.ts`) and never reads it from the page. Algolia answers a key it no longer accepts with 403, and the gate stops a shop after any 403, with no exception for this one (your call, 2026-10-05). So a changed key stops Super-Pharm for everyone until you follow the steps below.

- **How a stop shows:**
  - Super-Pharm's cards say the shop blocked the app. Opening a product with no Super-Pharm decision, which looks Super-Pharm up since `match-by-name` (2026-10-06), or a tap on "Zmień" on its match, reads "Wyszukiwanie w sklepie Super-Pharm jest wyłączone, bo sklep zablokował zapytania. Właściciel musi je ponownie włączyć.", and a matched card whose price is due for a refetch reads "Odświeżanie cen w sklepie Super-Pharm jest wyłączone, bo sklep zablokował zapytania." beside its last price. Since `add-from-other-shops` (2026-10-09) the list's search asks Super-Pharm too, so its line there reads "Super-Pharm: nie odpowiada", while the other shops' results still show. The other shops carry on.
  - Production's `public.shops` row `super-pharm` has `enabled` false and `disabled_reason` 'HTTP 403', with the stop's time in `disabled_at`: Table Editor → `shops`, or in the SQL editor `select id, enabled, disabled_reason, disabled_at from public.shops where id = 'super-pharm';`. Any other reason, such as `challenge`, is a real block: leave the shop off.
  - Nothing tells you of the stop. A red deploy now emails you through the `Deploy check` workflow ("Checked deploys (rollout Phase 4)"), but a failure at runtime, like this stop, alerts no one until the observability audit's alert fix lands (`context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md`, §6 step 2). Until then you learn it from the cards, and Workers Logs keep the gate's line for the 403 (`"event":"shop-gate"`, `"shopId":"super-pharm"`, outcome `blocked` with status 403).
- **The steps:**
  1. [you] Open `https://www.superpharm.pl/` in your browser, view the page's source and find `algoliaConfig`. Its `apiKey` is the key the shop's own search uses today.
  2. If it differs from `SUPER_PHARM_SEARCH_KEY`, the key has changed:
     - [agent] Put the new key in the constant and in `SEARCH_KEY` in `src/lib/services/shops/super-pharm.test.ts`, which pins it, and note the date in the research note's §2.3, which quotes the key. Open a pull request.
     - [you] Merge it once `ci`, `smoke` and `e2e` are green, and wait for Workers Builds to deploy it. Switching the shop back on before then would send the old key, and its 403 would stop Super-Pharm again.
     - [you] Then switch the row back on, in Table Editor or in the SQL editor:

       ```sql
       update public.shops set enabled = true, disabled_reason = null, disabled_at = null, updated_at = now() where id = 'super-pharm';
       ```

  3. If it's the same key, Algolia refused something else: treat the stop as a real block and leave the shop off.
- **Switching Super-Pharm off yourself [you]:** set the same row's `enabled` to false. The gate then skips every Super-Pharm request at once, without a deploy, and its cards show the gap. The full rollback is a revert PR. The stored Super-Pharm decisions stay, and the reads ignore a shop that isn't switched on.

## Deferred, with the trigger that brings each back

- **Workers Paid:** done. Active since 2026-09-27.
- **Anti-caching headers:** done in S-01 (`watchlist-add-by-search`). The middleware applies the headers `@supabase/ssr` passes to `setAll`, and every signed-in response is `Cache-Control: private, no-store`.
- **Sign-up page:** done in S-07 (`invite-only-access`, 2026-10-05). The app has no sign-up page; accounts come from the dashboard or your invite and recovery links, and a read-only check shows that Supabase still refuses sign-ups ("Accounts and links (S-07)").
- **Sessions and images:** turn on Astro sessions or Cloudflare Images when a feature needs them. The adapter then adds the `SESSION` KV or `IMAGES` binding.
- **Preview deploys:** Worker Previews or version URLs, only behind Cloudflare Access and with a Supabase project that isn't production. Branch builds currently hit workers-sdk #15682, a false name mismatch with the Vite plugin's generated config.
- **Local dev:** `npx supabase start` (Docker) with local values in `.env` and `.dev.vars`, never the production key.
- **Other:** custom domain and the FR-015 cron entrypoint. The per-shop cap counter in Supabase shipped in F-01 (`polite-shop-access`).

## Deployment record (filled in during execution)

| Item                          | Value                                                                                                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployed on                   | 2026-09-23 (first deploy 21:27 UTC, manual)                                                                                                                                                                                                                                |
| Worker / URL                  | `drogeria-radar` / `https://drogeria-radar.<subdomain>.workers.dev`                                                                                                                                                                                                        |
| Bindings                      | `ASSETS` only                                                                                                                                                                                                                                                              |
| First version (Phase 3)       | `d25099a4-4f91-4e32-8f8b-67b63eb0233e` (tag `468c9cb`, no secrets)                                                                                                                                                                                                         |
| Workers Builds version/commit | `a95a6036` from `96ee2e2` (build `0951c850`, 2026-09-23 22:11 UTC); later pushes to `main` deploy the same way                                                                                                                                                             |
| Secrets (names only)          | `SUPABASE_URL`, `SUPABASE_KEY`, set 21:49–21:50 UTC (versions `b06bf8cc`, `32248307`)                                                                                                                                                                                      |
| Supabase                      | project `drogeria-radar`, Central EU (Frankfurt), sign-up off (verified `signup_disabled`), owner account created, Data API on, new tables not auto-exposed, automatic RLS on                                                                                              |
| Workers Builds                | branch `main`, `npm run build`, then `npx wrangler deploy` until rollout Phase 4's switch and `npm run deploy:checked` since it (2026-10-06), with three build secrets (`CHECK_APP_URL`, `CHECK_SUPABASE_URL`, `CHECK_SUPABASE_KEY`); preview builds off; checks on GitHub |
| Preview URLs                  | off (`preview_urls: false`; version URL returns 404)                                                                                                                                                                                                                       |
| Workers plan                  | Paid since 2026-09-27; on Free, CPU per request was 2–12 ms against the 10 ms cap                                                                                                                                                                                          |
| Egress probe                  | 2026-09-23 from WAW: Rossmann, Hebe, Super-Pharm, Natura OK; **dm 403** (research §9)                                                                                                                                                                                      |

## Verification (end to end)

The plan is done when all of these hold:

- CI is green on `main`.
- `wrangler deployments list` shows a Workers Builds version from the latest `main` commit.
- A checked deploy works: a build of `main` with `npm run deploy:checked` is green, its log shows the five steps and "All production check steps passed", and its `Deploy check` run is green.
- The production URL renders without the config banner.
- `/watchlist` redirects to the Polish sign-in when signed out, and renders on a phone once signed in.
- The read-only check in "Accounts and links (S-07)" shows `disable_signup` true with the email provider on.
- The egress probe results are in the research note, and the probe Worker is deleted.
- The Deployment record is filled in.
