---
project: drogeria-radar
planned_at: 2026-09-23
platform: Cloudflare Workers (Worker with static assets, not Pages)
worker_name: drogeria-radar
production_branch: main
auto_deploy: Cloudflare Workers Builds; GitHub Actions stays CI-only
status: in-progress # planned → in-progress → deployed
inputs: [context/foundation/infrastructure.md, context/foundation/tech-stack.md]
---

# Drogeria Radar: first deployment plan (Cloudflare Workers)

Approved on 2026-09-23. Checkboxes track execution; the Deployment record at the end says what is live.

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

- [ ] 0.1 ⛔ [you] **The Cloudflare account uses a mailbox you control,** and My Profile shows "(verified)". Workers deploys fail with API error 10034 on unverified accounts.
  - If the address wrangler shows (`npx wrangler whoami`) is mistyped, **don't click resend.** The link, and any password reset, would go to whoever receives mail for that domain.
  - Instead, create an account on your real address, then run `npx wrangler logout` and `npx wrangler login`, and redo 0.3–0.4.
- [ ] 0.2 ⛔ [you] **2FA** on the Cloudflare and Supabase accounts, because they own production.
- [x] 0.3 [agent] `npx wrangler whoami` shows one account with Workers write scopes (passed on 2026-09-23). If the OAuth login breaks on the corporate network:
  - `npx wrangler login --device` uses a device code, with no `localhost:8976` callback.
  - `--browser=false` prints the link instead of opening a browser.
  - Behind a proxy, set `HTTPS_PROXY`; under TLS inspection, also set `NODE_EXTRA_CA_CERTS` to the corporate root CA.
  - Last resort: create an API token from the "Edit Cloudflare Workers" template and set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as user-level environment variables, never in the repo.
- [ ] 0.4 ⛔ [you] **workers.dev subdomain exists.** Dashboard → Workers & Pages should show `<subdomain>.workers.dev`; register one if asked.
  - Without one, a non-interactive `wrangler deploy` uploads the Worker and then stops with "You need to register a workers.dev subdomain…" plus an onboarding link.
  - DNS for a new subdomain "may take a few minutes".
- [ ] 0.5 [you, optional] `gh auth login`, so the agent can follow CI with `gh run watch`. Otherwise you watch the Actions tab.
- [ ] 0.6 [you, optional] Your work email is on the public commit history. To keep it off new commits, run `git config user.email <id>+<user>@users.noreply.github.com` in this repo before 2.7.
- [ ] 0.7 [you, later] Supabase CLI: `npx supabase login` and `npx supabase link --project-ref <ref>` are needed from the first migration on. Never run `supabase config push` to production (see decision 5).

## Phase 1: Production Supabase project [you]

- [ ] 1.1 Create project `drogeria-radar` on the Free plan in region **Central EU (Frankfurt)**, `eu-central-1`. Pick it by name, not the generic "Europe". Save the database password in your password manager.
- [ ] 1.2 ⛔ Authentication → Sign In / Providers → set **Allow new users to sign up** to off. Keep the Email provider enabled, because password sign-in needs it.
- [ ] 1.3 Authentication → URL Configuration → set Site URL to `https://drogeria-radar.<subdomain>.workers.dev`. No emails are sent, but it replaces the `localhost:3000` default.
- [ ] 1.4 Authentication → Users → Add user → Create new user with your email and a strong password, and tick **Auto Confirm User**. Without it, sign-in fails with "Email not confirmed".
- [ ] 1.5 Save the Project URL and the **publishable** key (`sb_publishable_…`) in your password manager for Phase 4. Both are in the Connect dialog; the key is also under Settings → API Keys.
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
- [ ] 2.8 The first CI run on `main` is green (both jobs). Any failure gets fixed before Phase 3.
  - **First run failed:** both jobs stopped at `npm ci` with `Missing: @emnapi/runtime@1.11.3` and `@emnapi/core@1.11.3 from lock file`.
    - Cause: the lockfile, since the initial commit, is written by npm 11 (local Node 24). npm 10 (Node 22 in CI, and `.nvmrc` 22.14.0 for Workers Builds) rejects it.
    - Reproduced locally with `npm@10.9.2 ci`; `npm@11.6.2 ci` installs it cleanly.
  - **Fix:** `.nvmrc` moves to 24.18.0 (the Workers Builds default), and both CI jobs use `node-version-file: .nvmrc`. Local dev, CI and Workers Builds now share npm 11. Regenerating the lock with npm 10 instead would break on the next local `npm install`.

## Phase 3: First production deploy [agent]

- [ ] 3.1 Run `npm run build && npx wrangler deploy --tag "$(git rev-parse --short HEAD)" --message "first deploy: starter skeleton"`. It prints `https://drogeria-radar.<subdomain>.workers.dev` and the version ID.
- [ ] 3.2 `curl /` must return 200 **with** the "Supabase nie jest skonfigurowany" banner. There are no secrets yet, so this proves the null-client contract works in production.
- **Support:**
  - Error 10034: back to 0.1.
  - Subdomain registration error: back to 0.4.
  - TLS error or 404 on a brand-new subdomain: wait a few minutes and retry.
  - Error 1101 or 1102: check `npx wrangler tail drogeria-radar --format pretty` and Workers Logs.

## Phase 4: Secrets [you, own terminal]

The values never pass through the agent.

- [ ] 4.1 `npx wrangler secret put SUPABASE_URL --name drogeria-radar`, then paste `https://<ref>.supabase.co` with no quotes and no trailing slash.
- [ ] 4.2 `npx wrangler secret put SUPABASE_KEY --name drogeria-radar`, then paste the publishable key.
- [ ] 4.3 [agent] `npx wrangler secret list --name drogeria-radar` shows both names.
- **Notes:**
  - Each `secret put` creates and deploys a new version immediately.
  - To fix a wrong value, run `secret put` again. To rotate, create a new key in Supabase, then run `secret put`.

## Phase 5: Verify production

- [ ] 5.1 [agent] With `npx wrangler tail drogeria-radar --format pretty` running in the background (no exceptions expected), run `curl` without `-L`. POSTs send `Origin: https://drogeria-radar.<subdomain>.workers.dev` exactly, because Astro's origin check returns 403 otherwise.
  - `GET /` returns 200 and the page no longer contains "nie jest skonfigurowany".
  - `GET /dashboard` without cookies returns 302 to `/auth/signin`.
  - `POST /api/auth/signup` with a throwaway `@example.com` address returns 302 to a location starting `/auth/signup?error=Signups%20not%20allowed%20for%20this%20instance`.
    - This proves Supabase enforces invite-only, not just the UI.
    - Anything else means sign-up is still open: stop, redo 1.2, and delete any user it created.
  - `POST /api/auth/signin` with a wrong password returns 302 to `/auth/signin?error=Invalid%20login%20credentials`. This tells a working key apart from "Invalid API key" or a missing config.
- [ ] 5.2 [you] On your phone, sign in with the account from 1.4: you land on `/`, `/dashboard` renders, and sign-out returns you to `/`.
- [ ] 5.3 [agent] Record the version IDs from `npx wrangler deployments list --name drogeria-radar`. In Workers Logs, note the CPU time of an SSR request against the Free plan's 10 ms cap.

## Phase 6: Egress probe on a throwaway Worker

This replaces step 5 of Getting Started in `infrastructure.md`.

- [ ] 6.1 [agent] **The probe Worker:** write it in the session scratchpad, outside the repo, so wrangler can't pick up the app's redirected config. It is a module Worker of about 40 lines named `drogeria-radar-egress-probe`, with its own `wrangler.jsonc`:
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

- [ ] 6.2 [agent] Deploy it from that folder with the repo's wrangler. Call each target once, at least 1 second apart.
- [ ] 6.3 [agent] Add a section "Egress from Cloudflare Workers (2026-09-xx)" to `docs/research/polish-drugstore-price-apis.md`, with status and colo per target and the User-Agent used.
- [ ] 6.4 A shop that answers 403, 429 or a challenge gets no retries.
  - One control request from your machine with the same User-Agent tells an IP block from a User-Agent block. Never switch to a browser User-Agent to get past it.
  - The fallback (a Fly.io machine with a fixed egress IP behind the adapter interface) becomes a milestone item outside this plan.
- [ ] 6.5 ⛔ [you] Delete the probe in the dashboard: Workers & Pages → `drogeria-radar-egress-probe` → Settings → Delete. Or run `npx wrangler delete drogeria-radar-egress-probe`; the name is positional.
  - Check the name twice: `drogeria-radar` is production.

## Phase 7: Auto-deploy `main` with Workers Builds

- [ ] 7.1 [agent] Commit the research note and this file's progress; don't push yet.
- [ ] 7.2 [you] Dashboard → Workers & Pages → `drogeria-radar` → Settings → Builds → Connect → GitHub. Install the "Cloudflare Workers and Pages" app for this repository only, then set:
  - production branch: `main`
  - build command: `npm run build` (the default is empty)
  - deploy command: `npx wrangler deploy` (the default)
  - root directory: empty
  - build variables: none
  - Branch control → **Enable Preview Builds: unchecked.** Branch builds would otherwise run `npx wrangler preview` (Worker Previews, launched 2026-09-22), which is public by default.

  Cloudflare creates the build API token itself; don't delete it. Connecting doesn't start a build.

- [ ] 7.3 [agent] Push the 7.1 commit, which runs the first Workers Build. Check that:
  - the build log shows `npm clean-install`, Node 24.18.0 from `.nvmrc` and a successful `npx wrangler deploy`
  - GitHub shows the Workers Builds check on the commit
  - `npx wrangler deployments list --name drogeria-radar` has the new version
  - `/` still returns 200 without the banner, so the secrets survived

## Phase 8: Record and hand-off

- [ ] 8.1 [agent] Fill in the Deployment record and set `status: deployed`. Commit and push; it's docs-only, so Workers Builds redeploys identical code.
- [ ] 8.2 [agent] Update the project memory, including the full production URL (local only).
- [ ] 8.3 [you, optional] Turn on branch protection for `main`, requiring the CI checks. Workers Builds deploys every push to `main` whether or not GitHub Actions passed, so from here on merge through PRs with green CI.

## Operations after this plan

- **Deploy:** merge to `main`. A manual `wrangler deploy` is for emergencies only, and only from a clean, up-to-date `main`: `git status` clean, then `npm ci`, `npm run build`, `npx wrangler deploy`.
- **Rollback [you]:** run `npx wrangler versions list --name drogeria-radar`, then `npx wrangler rollback <version-id> --message "<why>"`.
  - Then revert the bad commit on `main`, or the next push redeploys it.
  - A version carries its secret set, and wrangler asks you to confirm when the sets differ. So never roll back to the Phase 3 version (no secrets) or the 4.1 version (URL only), and never past a key rotation.
  - Supabase migrations don't roll back with the code.
- **Secrets:** `secret put` fails with API error 10215 while an undeployed version is the latest. Deploy first, or use `npx wrangler versions secret put`.
- **Logs:** `npx wrangler tail drogeria-radar --format json --status error`, or Workers Logs in the dashboard (Free plan: 3 days, 200k events a day).

## Deferred, with the trigger that brings each back

- **Workers Paid:** before the first shop adapter merges.
- **Anti-caching headers:** `@supabase/ssr` passes them as the second argument of `setAll`; apply them to the response in `src/lib/supabase.ts` and the middleware.
  - Trigger: before the first page with user data, and before any custom domain or cache sits in front of the Worker.
  - Cloudflare doesn't cache Worker responses today.
- **Sign-up page:** replace the starter's `/auth/signup` with the owner-invite path (FR-001). Product work; Supabase already refuses sign-ups.
- **Sessions and images:** turn on Astro sessions or Cloudflare Images when a feature needs them. The adapter then adds the `SESSION` KV or `IMAGES` binding.
- **Preview deploys:** Worker Previews or version URLs, only behind Cloudflare Access and with a Supabase project that isn't production. Branch builds currently hit workers-sdk #15682, a false name mismatch with the Vite plugin's generated config.
- **Local dev:** `npx supabase start` (Docker) with local values in `.env` and `.dev.vars`, never the production key.
- **Other:** custom domain, the per-shop cap counter in Supabase, and the FR-015 cron entrypoint.

## Deployment record (filled in during execution)

| Item                          | Value                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| Deployed on                   |                                                                                      |
| Worker / URL                  | `drogeria-radar` / `https://drogeria-radar.<subdomain>.workers.dev`                  |
| Bindings                      | `ASSETS` only                                                                        |
| First version (Phase 3)       |                                                                                      |
| Workers Builds version/commit |                                                                                      |
| Secrets (names only)          | `SUPABASE_URL`, `SUPABASE_KEY`                                                       |
| Supabase                      | project `drogeria-radar`, Central EU (Frankfurt), sign-up off, owner account created |
| Workers Builds                | branch `main`, `npm run build`, `npx wrangler deploy`, preview builds off            |
| Preview URLs                  | off (`preview_urls: false`)                                                          |
| Workers plan                  | Free                                                                                 |
| Egress probe                  |                                                                                      |

## Verification (end to end)

The plan is done when all of these hold:

- CI is green on `main`.
- `wrangler deployments list` shows a Workers Builds version from the latest `main` commit.
- The production URL renders without the config banner.
- `/dashboard` redirects when signed out and renders when signed in on a phone.
- Supabase refuses sign-up with `signup_disabled`.
- The egress probe results are in the research note, and the probe Worker is deleted.
- The Deployment record is filled in.
