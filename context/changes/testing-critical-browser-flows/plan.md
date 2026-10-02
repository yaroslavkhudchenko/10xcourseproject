# Critical Flows in a Real Browser (Test-Plan Phase 1) Implementation Plan

## Overview

This change adds the project's first browser tests: Playwright specs that run on the workerd production preview, against the local Supabase, with every shop stopped for the run. They cover three risks from `context/foundation/test-plan.md`:

- **#7, a browser-only regression in the phone flow.** A shopper at the shelf opens the list and a product, sees each shop's price with its age, refreshes, removes a product and removes a wrong match.
- **#1, a stale or unbuyable price shown as current.** No shop is marked cheapest unless its own price is fresh and orderable online, and every price shows its shop and age, on the list and on the product page alike.
- **#2, breakage that shows only on Workers.** The same flows run on the build that production runs, in CI, before a merge.

The suite is small: a seed and five risk specs, one Chromium phone project, and one CI job.

## Current State Analysis

- **No browser layer exists.** Vitest covers the rules in Node (`vitest.config.ts:10`), and `scripts/smoke.mjs` asserts only status codes, `Location` and `Cache-Control` on the preview (`scripts/smoke.mjs:178-185`). No test renders a page, hydrates an island or reads the DOM (research §8). Playwright isn't installed (`package.json`; no `@playwright` in `node_modules`).
- **Shops can't be faked from the browser.** Every shop request leaves the Worker through `gate.fetch` (`src/lib/services/shop-gate.ts:86-92,98-117`). The build has no variable, binding or option that points shops elsewhere (`astro.config.mjs:64-69`, `wrangler.jsonc:4-15`, `node_modules/@cloudflare/vite-plugin/dist/index.d.mts:69-150`). The browser's only price request is the app's own `POST /api/watchlist/prices` (research §1).
- **The only lever is the deployment's stop switch.** A shop with `enabled = false` makes `reserve_shop_request` answer `stopped` before it counts or inserts anything (`supabase/migrations/20260926112205_polite_shop_access.sql:65-67`). The island then shows "Odświeżanie cen w sklepie {shop} jest wyłączone, bo sklep zablokował zapytania." (`src/lib/shop-messages.ts:55`). No API role can turn a shop back on (`:37-38`); only superuser SQL can.
- **Playwright's navigations count as the user's own** (`src/lib/services/search-query.ts:19-26`; inference about Fetch Metadata, research §2). So a product view refetches each shop last checked more than 15 minutes ago, and runs a Natura lookup when no decision is stored. Stopped shops make every flow cost 0 shop requests (research §2, table).
- **The seeding rules.** A user may insert only 8 columns of an observation; the database stamps `observed_at`, `source` and `recorded_by` (`supabase/migrations/20260928011450_price_observations.sql:51-56,132-138`). RLS admits only the item's watchers (`:89-127`). A price older than 24 hours therefore needs superuser SQL.
- **CI.** CI has two required jobs, `ci` and `smoke` (`context/deployment/deploy-plan.md:26`). `smoke` builds, previews on 4321 and leaves the preview running (`.github/workflows/ci.yml:27-72`). Its shop-gate check pauses Natura and stops Hebe in that job's stack (`scripts/check-shop-gate-db.mjs:73-95`).
- **The setup skill's template doesn't fit this app as it is.** It waits for every island to hydrate, but at phone width the selected row's `RowTag` is `client:media="(min-width: 64rem)"` and never hydrates (`src/components/watchlist/WatchlistRow.astro:88`; `.claude/skills/10x-e2e-setup/references/playwright-setup-templates.md:163-166`). It also assumes a fixed test user stored in `.env`. Separately, `astro preview` backgrounds itself under an agent unless `ASTRO_PREVIEW_BACKGROUND=1` is set (`node_modules/astro/dist/cli/preview/index.js:45-50,87-89`).

## Desired End State

`npx playwright test` builds the app, starts the workerd preview on 4321 and runs the suite at 390 px in Chromium. The setup project signs up a throwaway local user for the run and stops every enabled shop. The teardown switches those shops back on and fails the run if any shop request was reserved. The suite:

- `seed.spec.ts` (#2): the signed-in shopper reaches their own list on the production preview.
- `price-honesty.spec.ts` (#1): four products in mixed price states. "Najtaniej" goes only to a fresh, orderable price, and every price shows its shop and age on both pages.
- `phone-refresh.spec.ts` and `phone-refresh-no-js.spec.ts` (#7, #2): the refresh with stopped shops keeps each last price with its age and says why. The document doesn't scroll sideways, and keyboard focus is visible. The same refresh works without JavaScript.
- `phone-remove-product.spec.ts` and `phone-decline-match.spec.ts` (#7): a product removed through the confirm, and a wrong Natura match removed through "Zmień" → "Żaden z nich".

CI's `e2e` job runs the suite on every push and PR to `main`, with its own local Supabase and no secrets. After the merge, the owner makes `e2e` a required check. Test-plan §6.3 describes how to add the next e2e test.

### Key Discoveries:

- **The stop switch.** It sets `enabled`, `disabled_reason` and `disabled_at` (`polite_shop_access.sql:5-15,108-114`). The request log `shop_requests` has an identity id from `shop_requests_id_seq` (`:20-24,38`). The sequence moves on every reservation and never moves for a stopped shop, so an unchanged sequence proves the run sent nothing.
- **The price rule.** Only `state === "fresh" && offer?.available === true` can win (`src/lib/services/price-comparison.ts:258`), and a lone row is never marked (`:164-177`).
  - **Stale means** older than 24 hours, or a promotion that ended before today in Europe/Warsaw (`:85-111`).
  - **Refetch on load.** The island refetches when the check is more than 15 minutes old, when the shop was never checked, or when the check was made before a promotion ended (`:61-78`).
  - **Ages** are hand-written texts: "przed chwilą", "N min temu", "wczoraj" (`:308-326`).
- **Old prices and ended promotions read the same, except in their data and refetch.** Both become `stale`, so the card shows "Nieaktualna" and the list says "cena nieaktualna". A price older than 24 hours is refetched on load and reads "wczoraj". An ended promotion checked after its end waits 15 minutes and keeps its "promocja do …" pill (agent mapping 2026-10-02; `src/components/watchlist/ShopCard.tsx:70,98-105`; `follow-ups/review-fixes.md:21` in the redesign archive).
- **What the DOM exposes.**
  - The price digits are `aria-hidden`; the readable "19,99 zł" (with U+00A0) is screen-reader text (`src/components/watchlist/Price.tsx:56-70`).
  - The list row's tag and its meta line are `aria-hidden`. The row link's name carries the summary, such as "Najtaniej: Rossmann 19,99 zł · przed chwilą · Natura: niedostępny online." (`price-comparison.ts:511-538`; `src/components/watchlist/WatchlistRow.astro:61-96`).
- **Card and hero texts.**
  - Cards: "Najtaniej", "Nieaktualna", "niedostępny online", "cena online · {age}", "Odświeżam…" (`ShopCard.tsx:39,81,86,106,112`).
  - Gap and hero: "Jeszcze bez ceny", "Najtaniej dziś", "Jedyna znana cena", "Ostatnia znana cena" (`src/components/watchlist/price-comparison-state.ts:255,381,393,414`).
  - A missing item: "Sklep nie zwraca już tego produktu. Cena może być nieaktualna." (`shop-messages.ts:67`).
- **Notices.**
  - Refresh failed: "Nie udało się odświeżyć cen. Spróbuj ponownie za chwilę." (`src/lib/notices.ts:149,172-173`).
  - Removal: "Usunięto produkt z listy." (`:49`).
  - Decline: "Zapisano: brak w Naturze." (`:18`).
  - Natura declined: "Brak w Naturze — Twój wybór." and "Dopasuj ponownie" (`src/components/watchlist/natura-card.ts:89,131`).
  - The re-pin lookup refused: "Wyszukiwanie w sklepie Natura jest wyłączone, bo sklep zablokował zapytania. Właściciel musi je ponownie włączyć." (`shop-messages.ts:27`).
- **Id rules the seeds must pass.** Rossmann ids are 1–12 digits (`src/lib/services/watchlist.ts:46`; `src/lib/services/shops/rossmann.ts:21-22`); a longer id reads as "Nie udało się pobrać…" instead of the stopped notice. Natura SKUs are `^[A-Za-z0-9._-]+$` (`src/lib/services/shops/natura.ts:28`). The database allows up to 40 characters.
- **Sign-in.** The form labels are "Email", "Password" and "Sign in" (`src/components/auth/SignInForm.tsx:47,60,83`). The password toggle is "Show password" (`PasswordToggle.tsx:14`), so "Password" needs an exact match. Success lands on `/watchlist` (`src/pages/api/auth/signin.ts:19`).
  - The session lives only in cookies (`src/lib/supabase.ts:13-28`).
  - Local sign-up returns a session, because confirmations are off (`supabase/config.toml:171,206,211`).
  - Auth allows 30 sign-ins and sign-ups per 5 minutes per IP (`:192`).
  - The phone's account menu names the user: "Konto: {email}" (`src/components/shell/AccountMenu.astro:26`).
- **Lint and type-check reach the new files.** `astro check` and typed ESLint cover `tests/**` and `playwright.config.ts` (`tsconfig.json:3`; `eslint.config.js:16-40`). React-hooks' `rules-of-hooks` and `no-empty-pattern` flag Playwright's fixture form `async ({}, use) =>` (`eslint.config.js:42-58`; agent finding), so plain helper functions avoid both. Vitest never collects `tests/` (`vitest.config.ts:10`). `.gitignore` has no Playwright paths.
- **The local database container is `supabase_db_10x-astro-starter`** (`project_id`, `supabase/config.toml:5`). It is reachable with `docker exec … psql -U postgres` on every machine that runs the local stack, CI included, and never reaches production.
- **S-07 will change the front door.** S-07 (`context/foundation/roadmap.md`, S-07) replaces the starter's sign-in page with a Polish one and removes self-registration. The setup's form labels and its local sign-up must follow, as the database checks' sign-ups must.

## What We're NOT Doing

- **No test-only shop seam, mock host or recorded answers in the browser layer.**
  - Choosing another Natura candidate ("To ten produkt") needs Natura's answer, so it stays with the unit tests (`natura-view`) and the decision route's schema.
  - The island's `POST /api/watchlist/prices` is never answered with canned responses. It may be held and continued only if a later spec needs the timing.
- **No unread (read-failure) states.** They need database faults and belong to rollout Phase 2 (research §3).
- **No assertion about the mark beside a shop that is still loading.** The decided S-03 rule marks a fresh shop then; it's unit-tested and has a deferred follow-up (`context/archive/2026-09-30-etykiety-redesign/follow-ups/review-fixes.md:20`).
- **No list-page "Odśwież ceny" spec.** Its `done` and `partial` codes need shop answers; smoke and the unit tests cover `none` and the route's refusals.
- **No desktop project at 1024 px or wider, and no WebKit.** The selected row's live tag and the two panes stay out of this phase.
- **No pixel snapshots, axe scans or coverage numbers** (test plan §7).
- **No fix to the list's screen-reader line** for a two-shop row with no current price. It is recorded for S-04 (Phase 6) and not asserted.
- **No production checks or migration gate.** They are rollout Phase 4; the three incidents cited for #2 aren't catchable here (research §5).
- **No change to the app's code**, except the deliberate breaks, each reverted before its phase's commit.
- **No change to the `ci` and `smoke` jobs, and no ruleset edit before the merge.**
- **No stored test credentials** in `.env`, `.env.example` or GitHub.

## Implementation Approach

**"No live shops" is an environment state, not a mock.**

- The setup stops every enabled shop in the local `public.shops`, marking each with `disabled_reason = 'e2e'`. It then proves, through the run user's own `reserve_shop_request`, that Rossmann and Natura answer `stopped`.
- The teardown switches back on only the shops carrying that mark. A shop stopped for any other reason, such as a real 403, stays stopped.
- The teardown also compares `shop_requests_id_seq` with the value the setup recorded. Any reservation during the run turns the run red.
- All of this goes through one local-only superuser helper, `docker exec` into the local database container, because no API role may touch `shops`.
- The same helper moves a seeded check back by 25 hours, the one price state a user's token can't create.

**One throwaway user per run.**

- The setup signs the user up with supabase-js, as the database checks do, and signs in once through the real form. It saves the session as Playwright's `storageState` for every spec.
- It writes what the seeding helpers need to act as that user to the gitignored `playwright/.auth/`. Acting as the user costs at most one sign-in per worker.
- Each spec seeds its own products with fresh ids, asserts only inside its own rows, and deletes its products afterwards, checking that the delete succeeded.
- Observations are append-only by design and stay behind under ids nobody else watches. So do the throwaway users, as with the database checks.

**Expected values come from the requirements, never from the comparison code.** The sources are:

- the PRD guardrail ("a stale or failed price … never a wrong number presented as current", `context/foundation/prd.md:49`)
- US-01's criteria (`:63-64`), FR-011 (`:121`) and the age requirement (`:145`)
- the S-03 decision record: only fresh (≤ 24 h), orderable prices can win, and "niedostępny online" can't win (`context/archive/2026-09-28-cheapest-shop-today/plan-brief.md:32-33,39`)
- S-03 review F1: an ended promotion is stale, and its end day itself stays fresh (`plan.md:879-881`)

The literal Polish strings come from the running app, explored with playwright-cli.

**Who drives each phase:**

- **Phase 1:** run `/10x-e2e-setup "#2"` for the parts that skill owns: config, setup project, seed, playwright-cli wiring and `test-stack.md`. This plan's Phase 1 contract overrides its template where they differ. Then `/10x-implement testing-critical-browser-flows phase 1` checks the contract, adds what the skill doesn't own, ticks Progress and commits.
- **Phases 2 and 6:** `/10x-implement`.
- **Phases 3–5:** `/10x-e2e testing-critical-browser-flows phase N`, one reviewed and break-verified spec per facet, at most two per phase.

**CI lands in Phase 2, right after the seed,** so every later spec is also proven on the CI preview in its own phase.

## Critical Implementation Details

**Timing and lifecycle**

- **Order of a run.** The setup runs before any spec and the teardown after all of them, also after failures. The teardown switches the shops back on first and checks the request log second, so a failed check never leaves the shops stopped.
- **Exploring between runs.** The shops are live again after every run. Before exploring a product page with playwright-cli, stop them with `node scripts/e2e-local-db.mjs stop`, and restore them afterwards.
- **Never run with `--no-deps`.** That flag skips both the setup that stops the shops and the teardown. The seeding helpers refuse to write while any shop is enabled, so such a run fails at its first seed instead of reaching a shop.
- **Start from a cold server.**
  - A run must start with nothing listening on 4321. A dev server left there would be reused silently and would test dev, not the build.
  - A dev server started with `ASTRO_DEV_BACKGROUND=1` can keep `::1:4321` while the preview binds `127.0.0.1`. Stop it with `npx astro dev stop`, or set `E2E_PORT`.

**State sequencing**

- **Inserts.** A `missing` check after a price goes in its own insert. Rows from one insert share `now()`, and the view's `distinct on` could then pick either.
- **Backdating.** Moving a check back happens after its insert, on that item's rows only.
- **The hydration race.** On a product page, wait for the `PriceComparison` island before tapping "Odśwież ceny". Before hydration that button posts the no-JavaScript form instead (research §2).

**Debug and observability**

- **The run user's email is the residue token.** Each spec records its product names in `test.info().annotations`, so any leftover is findable.
- **The request-log sequence is the proof** that a run cost 0 shop requests.

## Phase 1: Playwright harness on the production preview, with the seed

### Overview

This phase installs Playwright and the config that runs every spec in a 390 px Chromium project against the built Worker on workerd. It adds a local-only guard, a superuser helper, a setup that signs up the run user and stops the shops, and a teardown that switches them back on. The seed protects #2's facet: a signed-in shopper reaches their own list on the production preview. `/10x-e2e-setup "#2"` does the Playwright-owned parts with the overrides below; `/10x-implement … phase 1` completes and commits the phase.

### Changes Required:

#### 1. Playwright as a dev dependency

**File**: `package.json`, `package-lock.json`

**Intent**: Add `@playwright/test` and install the Chromium browser, the only engine this suite uses.

**Contract**:

- A devDependency installed with npm 11.16, the `.nvmrc` npm, so `npm ci` keeps the `@emnapi/*` entries (`context/deployment/deploy-plan.md:166-173`).
- `npx playwright install chromium` changes no project file.
- If `astro check` can't resolve Node's types for the config, declare `@types/node` (major 24) instead of relying on its transitive copy.

#### 2. The config

**File**: `playwright.config.ts` (new)

**Intent**: Run every spec against the production build on workerd, at phone size, and refuse to run against any Supabase but the local one, because the setup stops shops for the whole deployment.

**Contract**:

- **Environment.**
  - Loads `.env` when present.
  - **The guard**, evaluated when the config loads, before the web server builds: the `SUPABASE_URL` hostname from the environment (after `.env`) and from `.dev.vars` must each be `127.0.0.1` or `localhost`, the database checks' rule (`scripts/check-prices-db.mjs:17-22`). Otherwise it throws. It reads no key values.
- **Server.**
  - `PORT` is `E2E_PORT` or 4321, Astro's preview default, since `astro.config.mjs` sets none. `baseURL` is `http://localhost:${PORT}`.
  - `webServer` runs `npm run build && npm run preview -- --port ${PORT}`, with `env: { ASTRO_PREVIEW_BACKGROUND: "1" }`, `url: baseURL`, `reuseExistingServer: !process.env.CI` and a 180 s timeout.
  - The build copies `.dev.vars` into `dist/server/`, so the preview talks to the stack the guard checked.
  - The readiness check only says the server answers; `/` answers 200 even without Supabase. The setup's sign-in and the seed are the proof.
- **Behaviour.**
  - Trace on first retry, screenshot only on failure.
  - In CI: `forbidOnly`, 2 retries, 1 worker, and a line reporter in the log beside the HTML report.
- **Projects.**
  - `setup` matches `*.setup.ts`, with `teardown: "teardown"`.
  - `teardown` matches `*.teardown.ts`.
  - `phone` is Chromium at 390 × 844 with `isMobile` and `hasTouch`, `storageState: "playwright/.auth/user.json"`, and depends on `setup`.

#### 3. The local superuser helper

**File**: `scripts/e2e-local-db.mjs` (new; plain `.mjs` with JSDoc types, beside the database checks, so ESLint's Node-globals block covers it, `eslint.config.js:76-81`)

**Intent**: The one place the e2e harness acts as the local postgres superuser, for what no user token may do: stop and restore shops, read the request log's sequence, and move a seeded check back in time.

**Contract**:

- **How it runs SQL.**
  - `docker exec supabase_db_<project_id> psql -U postgres -d postgres -v ON_ERROR_STOP=1` with fixed statements and validated arguments.
  - `<project_id>` is read from `supabase/config.toml`. Shop ids must exist in `public.shops`; item ids must match `^[A-Za-z0-9._-]{1,40}$`.
  - It refuses to run unless the guard's local check passes, and it throws on any non-zero exit.
  - No connection string, no service-role key and no API path.
- **Exports.**
  - `stopShops()`: sets `enabled = false`, `disabled_reason = 'e2e'`, `disabled_at = now()` on every enabled shop. Returns their ids.
  - `restoreShops()`: switches back on only the shops whose `disabled_reason = 'e2e'`, clearing the reason.
  - `enabledShops()`: the ids of the shops that are still enabled; empty while a run holds them.
  - `requestLogMark()`: the `shop_requests_id_seq` value.
  - `backdateChecks(shopId, shopItemId, hours)`: moves that item's checks back. It is used from Phase 3.
- **Command line.** `node scripts/e2e-local-db.mjs stop|restore` wraps the first two exports, for exploring between runs.

#### 4. The setup

**File**: `tests/e2e/auth.setup.ts` (new; the setup skill's file name)

**Intent**: Once per run, make the run safe, then sign in once.

**Contract**, in order:

1. Record `requestLogMark()` and call `stopShops()`.
2. Sign up the run user with supabase-js on the local stack: `e2e-<run token>@example.com`, a random password. Sign-up returns a session locally.
3. Prove through the run user's own `reserve_shop_request` that `rossmann` and `natura` answer `stopped`.
4. Sign in through `/auth/signin` with the template's retry for a form typed before hydration, and wait for `/watchlist`.
5. Save `storageState` to `playwright/.auth/user.json`. Save the run user's email, what the Phase 3 helpers need to act as that user, and the request-log mark to a gitignored file in `playwright/.auth/`.

**Overrides of the setup skill's template**:

- No `E2E_USERNAME` or `E2E_PASSWORD`, and no names added to `.env.example`.
- No fixed user to create, locally or in CI.

#### 5. The teardown

**File**: `tests/e2e/shops.teardown.ts` (new)

**Intent**: Leave the developer's stack as the run found it, and fail the run if any shop request was reserved during it.

**Contract**:

- Calls `restoreShops()` first, then asserts that `requestLogMark()` equals the mark the setup recorded.
- It runs as the `setup` project's teardown, after every dependent project, also after failures.

#### 6. The seed

**File**: `tests/e2e/seed.spec.ts` (new)

**Intent**: The exemplar every later spec copies, protecting #2's facet: on the workerd production preview, a signed-in shopper on a phone reaches their own list.

**Contract**:

- Uses the saved session and opens `/watchlist`.
- Asserts the heading "Moja lista", and that the account menu names the run user's email ("Konto: …", `AccountMenu.astro:26`).
- Creates no data, and a comment says so.
- A provenance header names risk #2 and this facet, and the test name names the risk.

**Test contract**:

- **Behaviour asserted:** the preview serves the signed-in list for this run's user, read through the session on workerd.
- **Regression caught:** a preview that isn't bound to the local Supabase, a session not read on workerd, or the middleware not attaching the user (research §5, "What smoke checks"; §6, "Middleware").
- **Research source:** research §5, §6; `deploy-plan.md:179-181`, where `/` answers 200 without secrets.
- **Edge case:** `/` answering 200 without secrets. The web server's readiness passes there, so only the signed-in assertion proves the binding.
- **Anti-pattern avoided:** a readiness check on `/` alone; a status-only assertion; logging in through the UI inside the spec.
- **Deliberate break:** `src/middleware.ts` not setting `locals.user`, so the list redirects to sign-in and the seed turns red on its signed-in assertion.

#### 7. Repository wiring

**Files**: `.gitignore`, `context/foundation/test-stack.md`, the playwright-cli wiring, `eslint.config.js` (only if needed)

**Intent**: Keep sessions, reports and snapshots out of git. Record how the suite runs for `/10x-e2e` and `/10x-tdd`. Let the agent explore the running app.

**Contract**:

- **`.gitignore`** gets the template's lines: `playwright/.auth/`, `test-results/`, `playwright-report/`, `blob-report/`, `playwright/.cache/` and `.playwright-cli/`.
- **`test-stack.md`** gets its `## E2E` section per `.claude/skills/10x-e2e-setup/references/test-stack-e2e-schema.md`:
  - auth setup project: "setup (tests/e2e/auth.setup.ts): signs up a fresh local user each run, stops every enabled shop, signs in once through the form; no stored credentials; teardown tests/e2e/shops.teardown.ts"
  - seed: "tests/e2e/seed.spec.ts — protects #2: a signed-in shopper reaches their own list on the workerd production preview"
- **playwright-cli** per the setup skill's tool wiring for `claude-code`. What it adds under `.claude/skills/playwright-cli/` is committed with the phase; no file the 10x CLI tracks changes.
- **Helpers, not fixtures.** The harness uses plain helper functions, so the base ESLint config applies unchanged. If a spec ever needs a Playwright fixture, add one block for `tests/e2e/**` that turns off `react-hooks/rules-of-hooks` and `no-empty-pattern`, and record it.

### Success Criteria:

#### Automated Verification:

- `@playwright/test` is a devDependency installed with npm 11.16, `npm ci` passes on the new lockfile, and Chromium is installed
- `npm run lint`, `npx astro sync && npx astro check` and `npm run test` pass with the new files
- From a cold server, `npx playwright test tests/e2e/seed.spec.ts` passes: the setup stops every enabled shop and proves Rossmann and Natura `stopped`, and the teardown re-enables only the shops it stopped and finds the request log unmoved
- A shop stopped for another reason before a run is still stopped after it, with its reason unchanged
- The guard stops a run at config load, before the build or any request, when `SUPABASE_URL` in `.env` or in `.dev.vars` names a non-local host (each tried on a temporary edit, restored afterwards)
- Deliberate break: with the middleware not attaching the signed-in user, the seed goes red on its signed-in assertion; reverted
- `context/foundation/test-stack.md` has its `## E2E` section with every required field

#### Manual Verification:

- The owner reviews `tests/e2e/seed.spec.ts` and `playwright.config.ts`, the pattern every later spec copies

**Implementation Note**:

- Phase 1's commit also carries the change folder (`change.md`, `research.md`, this plan and its brief) and `context/foundation/test-plan.md`, which holds the §2 backport and §3 status uncommitted since research.
- The untracked `Drogeria Radar redesign/` folder and its zip stay out. Judge local lint with `--ignore-pattern "Drogeria Radar redesign/**"` while they exist.

---

## Phase 2: The e2e gate in CI

### Overview

This phase adds a separate `e2e` job that runs the suite on every push and PR to `main`. It uses the same workerd production preview the smoke job builds, its own local Supabase and no secrets. The job becomes required after the merge (Phase 6).

### Changes Required:

#### 1. The `e2e` job

**File**: `.github/workflows/ci.yml`

**Intent**: Make "e2e on critical flows" a CI gate (test plan §5) without touching `ci` or `smoke`. Giving the job its own stack means no shop state or sign-ins are left over from the shop-gate check, and no second preview runs beside smoke's.

**Contract**: `runs-on: ubuntu-latest`, with these steps:

1. Checkout; `actions/setup-node` from `.nvmrc` with the npm cache; `supabase/setup-cli@v1` pinned to `2.117.0`, with the smoke job's comment; `npm ci`.
2. "Start local Supabase" with the smoke job's `-x` list and `supabase status -o env` into `supabase.env`; then `.env` and `.dev.vars` written as the smoke job writes them (`ci.yml:40-48`).
3. `npx playwright install --with-deps chromium`.
4. `npx playwright test`. GitHub sets `CI`, so the config builds and starts the preview itself and no separate build or preview step is needed.
5. `actions/upload-artifact` of `playwright-report/` and `test-results/` `if: failure()`.
6. `supabase stop --no-backup` `if: always()`.

Docker is already there for the local stack, so the superuser helper works. There is no `secrets.*` anywhere, and the job deploys nothing.

### Success Criteria:

#### Automated Verification:

- The `e2e` job runs on the phase's push and passes. Its log shows the local stack, the preview built and started by the config, the shop stop, the seed and the unmoved request log
- The job reads no repository secret and writes only the local stack's values into `.env` and `.dev.vars`
- `ci` and `smoke` stay green and unchanged on the same commit

**Implementation Note**: Don't add `e2e` to the ruleset now. A required check that other open PRs never run would block them; Phase 6's after-merge step does it.

---

## Phase 3: Honest prices on both pages (#1)

### Overview

This phase adds seeding helpers that put a spec's own products into exact price states, and one spec with four products. In each product, the cheaper price is the one that may not win. The spec checks that the list and every product page mark "Najtaniej" only on a fresh, orderable price, and show each price's shop and age.

### Changes Required:

#### 1. Seeding helpers

**File**: `tests/e2e/support/watchlist-data.ts` (new)

**Intent**: Let a spec seed its own products and price states as the run user, and remove them afterwards.

**Contract**:

- **Who acts.** It acts as the run user through supabase-js on the local stack, using what the setup saved, with at most one sign-in per worker. It never acts as a superuser except through `backdateChecks`.
- **No seeding while a shop is live.** Before its first write in a worker, it asserts that `enabledShops()` is empty. A spec run without its setup (`--no-deps`, or a session left from an earlier run whose teardown restored the shops) therefore fails before it can open a product page that would ask a shop.
- **`addRossmannProduct({ name })`** inserts a `watchlist_items` row `{ source: "rossmann", source_item_id, name }`.
  - The id is a fresh 12-digit id, never reused across runs (the app's `^\d{1,12}$`). Ids from earlier runs would carry those runs' observations.
  - The name carries the run token. No `image_url` or `product_url`, since a seeded image would load from the shop's host (research §1).
  - Returns the product id and the item id.
- **`matchNatura(productId, { name })`** inserts a `matched` decision with `decided_by: "auto"`, a fresh SKU (`^[A-Za-z0-9._-]+$`, at most 40 characters) and a name (`check-prices-db.mjs:70-77` shows the shape).
- **Observations.**
  - `recordPrice(shopId, shopItemId, { price, regularPrice?, promoEndsOn?, available })` and `recordMissing(shopId, shopItemId)` make one insert per call, never asking for rows back (`price_observations.sql:132-138`).
  - `backdateChecks` moves an item's checks back through `scripts/e2e-local-db.mjs`.
- **`warsawDate(offsetDays)`** gives today ± n days as the Europe/Warsaw date, never the UTC one (`price-comparison.ts:18-23,100-111`).
- **`removeProducts(productIds)`** deletes the spec's products as the run user and asserts the delete succeeded. Decisions go by the cascade; observations stay, by design.

#### 2. The spec

**File**: `tests/e2e/price-honesty.spec.ts` (new)

**Intent**: Prove the PRD guardrail on the rendered pages: a stale, ended-promotion, gone or unorderable price is never presented as today's cheapest, and every price shows its shop and age.

**Contract**: one test, four products, each with its own fresh ids. Natura is matched in all four.

- **P1, fresh but not orderable online.** Rossmann 19,99, fresh and orderable; Natura 12,99, fresh, `available: false`.
- **P2, cheaper but older than 24 hours.** Rossmann 8,99, its check moved back 25 hours; Natura 13,99, fresh.
- **P3, cheaper but its promotion ended yesterday.** Rossmann 9,99, regular 14,99, `promo_ends_on` yesterday in Warsaw, checked now; Natura 14,49, fresh.
- **P4, gone from the shop and never checked.** Rossmann 11,99, then a `missing` check; Natura never checked.

The flow: open `/watchlist` and check the four rows, then open each product and check its page. After each test, `removeProducts`.

**Test contract**:

- **Behaviour asserted on the list, in each row's link name and visible tag:**
  - P1 names Rossmann as cheapest with its price and age, and Natura as not orderable online.
  - P2 and P3 name Natura as cheapest and Rossmann's price as out of date.
  - P4 shows Rossmann's last price as "Nieaktualna" with "Rossmann · {age}", and names no cheapest shop.
- **Behaviour asserted on the product pages:**
  - **P1:** "Najtaniej" only on Rossmann's card; Natura's card says "niedostępny online"; both cards say "cena online · {age}".
  - **P2:** "Najtaniej" only on Natura's card. Rossmann's card keeps 8,99, "Nieaktualna" and "cena online · wczoraj". The island re-asks Rossmann on load, and once refused it adds the stopped notice while the price, badge and age stay.
  - **P3:** "Najtaniej" only on Natura's card, and "Nieaktualna" on Rossmann's.
  - **P4:** no "Najtaniej" anywhere. The hero says "Ostatnia znana cena" for 11,99, and Rossmann's card says "Sklep nie zwraca już tego produktu. Cena może być nieaktualna." Natura's card says "Jeszcze bez ceny", plus the stopped notice after the refused refetch on load.
- **Regression caught:**
  - the wrong shop marked cheapest on a price that is old, ended, gone or unbuyable. An ended promotion that stayed cheapest is S-03 review F1, `context/archive/2026-09-28-cheapest-shop-today/plan.md:879-881`.
  - a price without its shop or age (`2026-09-30-etykiety-redesign` review F1–F2)
  - a refused refetch that blanks a price instead of keeping it with its age (PRD `:49`, US-01 `:63-64`)
- **Research source:** research §3 (the readers), §4 (each state and how to seed it), §2 rows 5–6 (refetch on load); the agent mapping of 2026-10-02 (texts and refetch per combination).
- **Edge and boundary cases:**
  - In P1–P3 the cheaper price is always the ineligible one, so a rule that ignores eligibility picks the wrong shop.
  - P3's promotion ended yesterday in Warsaw; the end day itself would still be fresh.
  - P2's check is past the 24-hour line by an hour.
  - P4 has no eligible shop at all.
- **Anti-pattern avoided:**
  - an all-fresh happy path
  - expected values read off `price-comparison.ts`
  - "yesterday" computed in UTC
  - asserting the deferred mark beside a loading shop
  - fixed waits; the spec waits for the notices and texts instead
  - shared products or reused ids
- **Not asserted:**
  - P4's list screen-reader line, which is recorded for S-04 in Phase 6
  - P3's "promocja do …" pill, a recorded follow-up (`review-fixes.md:21`)
- **Deliberate breaks:**
  - eligibility without the orderable check (`price-comparison.ts:258`) turns P1 red
  - `promotionEnded` returning false turns P3 red

### Success Criteria:

#### Automated Verification:

- `npx playwright test tests/e2e/price-honesty.spec.ts` passes from a cold server with the request log unmoved
- Deliberate break: with eligibility ignoring orderability, the spec goes red on P1's mark; reverted
- Deliberate break: with ended promotions read as fresh, the spec goes red on P3's mark; reverted
- After a green and a red run, none of the spec's products remain on the run user's list
- Lint, `astro check` and unit tests pass, and CI's `e2e` job is green on the phase's commit

#### Manual Verification:

- The owner checks the spec's expected values against the PRD guardrail and the S-03 decision record

**Implementation Note**: Stop the shops before exploring with playwright-cli (`node scripts/e2e-local-db.mjs stop`), and restore them afterwards.

---

## Phase 4: Prices and refresh on a phone (#7)

### Overview

This phase adds a hydration helper for the product page and two specs.

- **The refresh at the shelf, with shops stopped.** Each last price stays with its age, each shop says why it wasn't asked, there's no sideways scroll, and keyboard focus is visible.
- **The same refresh without JavaScript.** It is what a slow phone hits when the button is tapped before the island hydrates, and it posts a form on workerd (#2).

### Changes Required:

#### 1. Hydration helper

**File**: `tests/e2e/support/islands.ts` (new)

**Intent**: Wait until the product page's price island is interactive, the only island a phone hydrates.

**Contract**:

- Resolves once the `PriceComparison` island (`client:load`, `src/pages/watchlist/[id].astro:322`), found by its name in the island's options, has lost its `ssr` attribute. Astro drops `ssr` after hydrating (`node_modules/astro/dist/runtime/server/astro-island.js:187`).
- It never waits for every island: the selected row's `RowTag` stays unhydrated below 1024 px.
- This DOM query is the one allowed hydration signal, kept in this helper as the setup template prescribes.

#### 2. The refresh spec

**File**: `tests/e2e/phone-refresh.spec.ts` (new)

**Intent**: Prove the phone flow at the shelf on the production build: list, product, each shop's price with its age, and a refresh that is refused without losing anything.

**Contract**:

- **Seeding.** One product: Rossmann 19,99 and a matched Natura at 14,49, both checked now, so nothing is refetched on load.
- **The flow:**
  1. On `/watchlist`, the row names Natura as cheapest with its price and age, and the document doesn't scroll sideways.
  2. Tap the row, then wait for the island.
  3. Each card shows its price and "cena online · {age}", and "Najtaniej" is on Natura.
  4. Tap the bottom bar's "Odśwież ceny" (`src/components/watchlist/RefreshBar.tsx`).
  5. Each card shows its stopped notice while its price, age and Natura's "Najtaniej" stay.
  6. The document still doesn't scroll sideways.
  7. Pressing Tab reaches a control with a drawn focus outline (computed style not `none`, width at least 2 px, `src/styles/global.css:415`), and still does with forced colours emulated.
- **Cleanup.** After the test, `removeProducts`.

**Test contract**:

- **Behaviour asserted:** a refused refresh keeps every last price and age, says per shop why, and leaves the cheapest mark on the still-fresh price. The phone layout doesn't overflow, and focus stays visible.
- **Regression caught:**
  - an island that doesn't hydrate in the production build (`2026-09-30-etykiety-redesign/plan.md:1137`)
  - the JSON route failing on workerd, which would show "Nie udało się pobrać ceny ze sklepu …" instead of the stopped notice
  - a refused refresh that blanks a price or its age
  - overflow at 390 px (`etykiety-redesign/plan.md:1186-1197`)
  - focus invisible, including in forced-colours mode (`2026-09-29-product-page-ui/reviews/impl-review.md:68-76`)
- **Research source:** research §2 rows 5 and 7, §7 (phone structures, layout, focus); the agent mapping's table of refetch answers.
- **Edge cases:**
  - The refused path is the only refresh outcome reachable without a shop.
  - The chips row scrolls sideways by design (`src/components/watchlist/FilterChips.astro:35`), so the overflow check is on the document, not on every element.
- **Anti-pattern avoided:**
  - fulfilling `POST /api/watchlist/prices` with canned answers; the request must reach the route on workerd
  - waiting for every island
  - fixed waits
  - pixel snapshots
- **Deliberate breaks:**
  - the prices route answering an error turns the spec red on the stopped notice
  - the base layer's `:focus-visible` outline removed turns it red on the focus check

#### 3. The refresh spec without JavaScript

**File**: `tests/e2e/phone-refresh-no-js.spec.ts` (new)

**Intent**: Prove the product's "Odśwież ceny" works as a plain form on the production build.

**Contract**:

- JavaScript is off for this file (`test.use({ javaScriptEnabled: false })`).
- Seeds the same product shape as the refresh spec.
- The flow:
  1. Open the product page: its server-rendered cards show both prices with "cena online · {age}".
  2. Tap "Odśwież ceny". The form posts to `/api/watchlist/refresh` (`src/components/watchlist/RefreshForm.tsx:54`).
  3. The page comes back with "Nie udało się odświeżyć cen. Spróbuj ponownie za chwilę." (`notices.ts:149,172-173`), and both prices and ages are still shown.
- After the test, `removeProducts`.

**Test contract**:

- **Behaviour asserted:** the no-JavaScript refresh reaches the route and comes back with the notice the user reads, without losing a price or its age.
- **Regression caught:** the form post broken on workerd (the origin check, the route or its redirect code), the notice missing, or prices blanked after the post.
- **Research source:** research §2 row 8; §5's verdict for #2; `src/lib/services/price-refresh.ts:128-137`.
- **Edge case:** a refresh in which no shop answers gives `failed`, not `done` or `none`.
- **Anti-pattern avoided:** asserting the URL's code instead of the notice; fixed waits.
- **Deliberate break:** the refresh route redirecting without its result code turns the spec red on the notice.

### Success Criteria:

#### Automated Verification:

- `phone-refresh.spec.ts` passes from a cold server with the request log unmoved
- `phone-refresh-no-js.spec.ts` passes from a cold server with the request log unmoved
- Deliberate break: with the prices route answering an error, `phone-refresh.spec.ts` goes red on the stopped notice; reverted
- Deliberate break: with the base layer's focus outline removed, `phone-refresh.spec.ts` goes red on the focus check; reverted
- Deliberate break: with the refresh route redirecting without its result code, `phone-refresh-no-js.spec.ts` goes red on the notice; reverted
- After green and red runs, neither spec leaves a product on the run user's list
- Lint, `astro check` and unit tests pass, and CI's `e2e` job is green on the phase's commit

**Implementation Note**: As in Phase 3, stop the shops before exploring and restore them afterwards.

---

## Phase 5: Removals on a phone (#7)

### Overview

This phase adds two specs: removing a product through the confirm, and removing a wrong Natura match through the re-pin choice. Neither asks a shop. With Natura stopped, the choice offers no candidate and still lets the user decline.

### Changes Required:

#### 1. The removal spec

**File**: `tests/e2e/phone-remove-product.spec.ts` (new)

**Intent**: Prove the removal at phone size on the production build: the confirm guards it, and the product is really gone.

**Contract**:

- **Seeding.** One product: Rossmann 19,99 and a matched Natura at 14,49, both fresh, so the page asks no shop.
- **The flow:**
  1. On the product page, tap "Usuń z listy" (the `<details>` summary). The confirm opens and the product is still there.
  2. Tap the confirm's "Usuń z listy" (`src/components/watchlist/RemoveProduct.astro:42-64`).
  3. `/watchlist` says "Usunięto produkt z listy.", and the row is gone. After a reload it is still gone.
- **Cleanup.** After the test, `removeProducts`, whose delete of an already removed product must still succeed.

**Test contract**:

- **Behaviour asserted:** one tap opens the confirm and removes nothing; the confirm removes the product for good.
- **Regression caught:** a removal not persisted, a confirm that is missing or removes on the first tap, or the redirect or notice broken on workerd.
- **Research source:** research §2 row 10 and §7, removal; `context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:936-941`, the no-JavaScript confirm checked by hand.
- **Edge cases:** the opened-but-unconfirmed state; a reload after the removal.
- **Anti-pattern avoided:** asserting only the notice, when the outcome is the row's absence after a reload; a cleanup that ignores its result.
- **Deliberate break:** the removal route redirecting with `done` without deleting turns the spec red on the row's absence.

#### 2. The decline spec

**File**: `tests/e2e/phone-decline-match.spec.ts` (new)

**Intent**: Prove a wrong automatic Natura match can be removed through the re-pin choice on a phone, after which its price is no longer compared.

**Contract**:

- **Seeding.** One product: Rossmann 19,99, fresh, and a `matched` Natura with `decided_by: "auto"` at 14,49, fresh.
- **The flow:**
  1. Natura's card names the matched item and offers "Zmień". Tap it.
  2. The choice (`?repin=1`) shows Natura's stopped search warning, "Żaden z nich" and "Anuluj", and no candidate.
  3. Tap "Anuluj": the page is back without the choice, and Natura is still matched with its price.
  4. Tap "Zmień" again, then "Żaden z nich".
  5. The page says "Zapisano: brak w Naturze.", and Natura's card says "Brak w Naturze — Twój wybór." with "Dopasuj ponownie".
  6. There's no "Najtaniej" on the page, and the hero says "Jedyna znana cena" for 19,99.
  7. On `/watchlist`, the row reads "Tylko w Rossmannie: 19,99 zł · {age}. Natura: brak (Twój wybór)." (`price-comparison.ts:524-534`).
- **Cleanup.** After the test, `removeProducts`.

**Test contract**:

- **Behaviour asserted:** "Anuluj" changes nothing; "Żaden z nich" stores the decline, and the declined shop's old price drops out of the comparison on both pages.
- **Regression caught:**
  - the decline not stored, for example through the `replaces` compare-and-swap
  - the choice failing to render when Natura doesn't answer
  - a declined shop's price still compared (#6's facet)
- **Research source:** research §2 rows 11–12; `src/lib/services/natura-view.ts:292-339`; `src/components/watchlist/NaturaSection.astro:136-153`; S-08's archived plan.
- **Edge and error cases:**
  - Natura refusing the re-pin lookup still offers the decline from a match.
  - "Anuluj" leaves the decision as it was.
  - A lone remaining shop is never marked.
- **Anti-pattern avoided:** seeding the decline in the table instead of driving the choice; asserting only the notice.
- **Deliberate break:** the decline's write narrowed to a state it never matches leaves the card matched, so the spec turns red there.

### Success Criteria:

#### Automated Verification:

- `phone-remove-product.spec.ts` passes from a cold server with the request log unmoved
- `phone-decline-match.spec.ts` passes from a cold server with the request log unmoved
- Deliberate break: with the removal route redirecting `done` without deleting, the removal spec goes red on the row's absence; reverted
- Deliberate break: with the decline's write never matching, the decline spec goes red on Natura's card; reverted
- After green and red runs, neither spec leaves a product on the run user's list
- The whole suite passes in one cold run with the request log unmoved, and CI's `e2e` job is green on the phase's commit

**Implementation Note**: As in Phase 3, stop the shops before exploring and restore them afterwards. Check with a snapshot the role Playwright gives `<summary>`; research left it unverified.

---

## Phase 6: Docs and the cookbook

### Overview

This phase fills test-plan §6.3 and §6.6 with what shipped, documents the commands and the CI job in CLAUDE.md, and records the carry-overs for S-04 and S-07. It also leaves the owner's after-merge step: making `e2e` a required check.

### Changes Required:

#### 1. The cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Make §6.3 the answer to "how do I add an e2e test here". Its placeholder still says "recorded shop answers", which research disproved.

**Contract**:

- **§6.3** replaces the TBD with:
  - **Location and naming.** `tests/e2e/<risk-facet>.spec.ts`, one test per file, named after its risk, with a provenance header.
  - **The run user.** One user per run with the saved session from `auth.setup.ts`.
  - **The seeding helpers.** Fresh ids per the adapters' rules, one insert per call, Warsaw dates, backdating through `scripts/e2e-local-db.mjs`, and a cleanup whose delete is checked.
  - **Shops and exploring.** Shops are stopped by the setup and restored by the teardown, with the request-log check. Before exploring, stop them with `node scripts/e2e-local-db.mjs stop` and restore them after.
  - **Waits and variants.** Wait for the product island, never for every island. A JavaScript-off spec uses `test.use`.
  - **Reference specs.** `seed.spec.ts` and `price-honesty.spec.ts`.
  - **Commands.** `npx playwright test tests/e2e/<name>.spec.ts` and `npx playwright test`.
  - **CI.** The `e2e` job.
- **§6.6** gets a 2–3 line note: no live shops is an environment state (the stop switch), not a mock; recorded answers can't reach the production build; a phone-width page never hydrates every island.
- §1–§5 stay as they are; the §3 status is `/10x-test-plan`'s to reconcile.

#### 2. CLAUDE.md

**File**: `CLAUDE.md` (project section only; the course block stays byte-identical)

**Intent**: Give the next agent the e2e commands, what a run does to the local stack, and the CI job.

**Contract**:

- **Commands** gets a bullet for `npx playwright test`. It needs `npx supabase start`, Docker, and a local `.env` and `.dev.vars`. It builds and previews on 4321, overridable with `E2E_PORT`. A run:
  - signs up a throwaway user, stops every enabled shop and switches back on only those, and fails if a shop request was reserved
  - refuses any non-local Supabase, because stopping a shop stops it for the whole deployment
  - The bullet also names the single-spec form, `node scripts/e2e-local-db.mjs stop|restore` for exploring between runs, and that `--no-deps` is never used, because it skips the shop stop.
- **The Tooling CI bullet** names the `e2e` job.

#### 3. Roadmap carry-overs

**File**: `context/foundation/roadmap.md`

**Intent**: Hand the two findings this change leaves to the slices that will touch them.

**Contract**:

- **S-04.** For a row with two shops and no current price, the list's screen-reader line is "Ceny nieaktualne. Odśwież ceny lub otwórz produkt.", with no shop, price or age (`price-comparison.ts:536-538`, pinned by a unit test), while the visible tag shows them.
- **S-07.**
  - The e2e setup signs in through the starter's English form ("Email", "Password", "Sign in") and signs its run user up with supabase-js on the local stack. So S-07's Polish sign-in page must update `tests/e2e/auth.setup.ts`.
  - Its sign-up removal must keep local sign-up, which the e2e and the database checks need, or move both to another local way of creating users.

### Success Criteria:

#### Automated Verification:

- §6.3 and §6.6 of the test plan describe the shipped pattern, with no "TBD" left in §6.3, and Prettier passes on the changed Markdown
- CLAUDE.md's project section names the e2e commands and the CI job, and its course block is byte-identical
- The roadmap carries the S-04 and S-07 notes
- CI (`ci`, `smoke`, `e2e`) is green on the final commit

#### Manual Verification:

- After the merge, the owner adds `e2e` to the `preventFailedDeploy` ruleset's required checks, and the deploy plan records it
- The owner reads §6.3 and finds it answers how to add an e2e test here

**Implementation Note**: The first manual item is open by design until after the merge. Its deploy-plan record (`context/deployment/deploy-plan.md:26`) rides with the archive PR.

---

## Testing Strategy

### Unit Tests:

- Unchanged. The price, freshness, eligibility, refetch and text rules stay unit-tested in Node (`price-comparison.test.ts`, `watchlist-rows.test.ts`, `price-comparison-state.test.ts`, `natura-view.test.ts`), and the e2e doesn't re-assert their tables.

### Integration Tests:

- Unchanged in this phase. The read-fault seams (unread rows, odd rows) and two-user route tests are rollout Phase 2.

### E2E Tests:

- **Six specs:** `seed` (#2), `price-honesty` (#1), `phone-refresh` and `phone-refresh-no-js` (#7, #2), and `phone-remove-product` and `phone-decline-match` (#7).
- **Each is green from a cold server, and each was seen red** under a deliberate break of the behaviour it protects, aimed at its risk's own assertion, not at a timeout.
- **What every run proves itself:** its local-only guard, its shop stop and restore, and its 0 shop requests.

### Manual Testing Steps:

1. Review the seed and the config before later phases copy them (1.8).
2. Check the #1 spec's expected values against the PRD guardrail and the S-03 decision record (3.6).
3. After the merge, make `e2e` required (6.5) and read §6.3 (6.6).

## Performance Considerations

- **Local run time.** About a minute of build in the web server, plus the specs, roughly 2–4 minutes in all. CI's job runs in parallel with `ci` and `smoke`.
- **The sign-in budget.** A run spends 1 sign-up and 1 form sign-in, plus at most one helper sign-in per worker: 3 in CI, which runs one worker. The local limit is 30 per 5 minutes per IP (`supabase/config.toml:192`).
- **Shop cost.** 0 requests per run, and the teardown proves it from the request log. Each page view and action in these flows costs 0 shop requests while the shops are stopped (research §2, the table's "Shops stopped" column; `lessons.md:15-16`).

## Migration Notes

- No schema change and no production change.
- **What a local run leaves behind:** one throwaway `@example.com` user, and that user's append-only observations under ids no one else watches, as the database checks leave theirs.
- **Shops** end in the state they started in. A run that is killed before its teardown leaves them stopped with the `e2e` mark; `node scripts/e2e-local-db.mjs restore`, or the next run's teardown, switches them back on.

## Implementation Notes

One line per adaptation, naming the contract it changes and why, in the phase's commit (`context/foundation/lessons.md`).

**Phase 1, written by `/10x-e2e-setup "#2"` (2026-10-02):**

- **The setup's mark (§4, steps 1–2).** The setup takes `requestLogMark()` after `stopShops()`, not before. Once every shop is stopped nothing can reserve a request, so another process's reservation between the two can't read as the run's.
- **A stale run file (§4).** The setup deletes an earlier run's `playwright/.auth/run.json` first (`clearRun`), so a setup that fails can't hand the teardown a stale mark. The teardown then restores the shops and fails with "the setup project didn't finish".
- **The run file (§4, step 5).** `playwright/.auth/run.json` holds the run user's email, password and mark. `tests/e2e/support/run.ts` reads and writes it, and its `SESSION_FILE` is the path the config's `phone` project loads.
- **Where the guard lives (§2, §3).** `assertLocalSupabase()` is in `scripts/e2e-local-db.mjs`, and the config imports it, so the config and every superuser statement share one rule. When `SUPABASE_URL` is set in the environment, the guard checks it instead of `.env`'s value, because the environment wins over `.env` for the tests.
- **The phone project (§2).** It is Playwright's `Pixel 7` descriptor (Chromium, mobile, touch) with its viewport set to 390 × 844.
- **`<summary>`'s role (research Open Question 8).** The account menu's `<summary>` is exposed as `generic "Konto: …"` inside a `group`, the `<details>`, not as a button. So the seed asserts the account text inside the group (`toBeAttached`, since it is screen-reader text).
- **Environment.**
  - playwright-cli 0.1.22 is installed globally. Its first `open` crashed once on Windows with a libuv assertion (`UV_HANDLE_CLOSING`), and a retry worked.
  - Installing Chromium 1243 removed another project's unused browser cache (`chromium-1217`) from `%LOCALAPPDATA%\ms-playwright`. That happens outside the repo.

**Phase 1, completed by `/10x-implement` (2026-10-02):**

- **The setup's sign-in (§4, step 4).** The setup waits for the `SignInForm` island to hydrate, then signs in once. The sign-in route's own answer proves it: a 302 whose `location` is `/watchlist`. It no longer waits for `/watchlist`, asserts the list's heading or retries the form. Where the browser lands afterwards is the seed's to judge, so a middleware that doesn't attach the user turns the seed red (1.6), not the setup. A retry would also spend one more sign-in against the local limit of 30 per 5 minutes on every try.
- **The hydration helper arrives in Phase 1, not Phase 4.** `tests/e2e/support/islands.ts` (`waitForIsland(page, component)`) is written now for the sign-in form; Phase 4 uses it for `PriceComparison`.
- **The CI reporter (§2).** It is `list`, one line per test in the job's log. That is what "a line reporter" meant; Playwright's `line` reporter shows only the last test.
- **What the guard reads (§2, §3).** Through the config, `.env` is already loaded, so the guard judges the value the tests use, the file's last line, as Node keeps it. For `.dev.vars`, and for `.env` from the command line, it judges every `SUPABASE_URL` line, since wrangler also keeps a file's last one: a first-line check would let a local line followed by a remote one pass. Review fix F2 made both files strict on every line.
- **The request-log mark (§3)** is `last_value:is_called`, not the sequence's value alone, so the first reservation on an unused sequence, as on CI's fresh stack, moves it too.
- **`backdateChecks` (§3)** also refuses a shop id that isn't a row of `public.shops`, the contract's "Shop ids must exist", at the cost of one extra select per call.
- **Every gate ran again before the commit (1.1–1.7).** The session that wrote the phase ended before committing, so the resumed one re-ran them. It tried the guard (1.5) on crafted `.env` and `.dev.vars` copies in a scratch directory, loaded through the real config, and on a remote `SUPABASE_URL` in the environment, instead of editing the real files. All of them refused, the last before any build.

**Phase 2 (2026-10-02):**

- **The web server's output in CI (Phase 1 §2, "Server").** The config sets `stdout: "pipe"` when `CI` is set. Playwright ignores a web server's stdout by default, so without it the job's log would show neither the build nor the preview's start, which 2.1 asks for, and a build that fails there couldn't be read. Local runs keep it ignored.
- **The failure artifact (§1, step 5)** is kept for 14 days (`retention-days`), instead of the repository's default. It only serves to debug that PR's failed run.

**Phase 3, written by `/10x-e2e` (2026-10-02):**

- **Hydration before a product's assertions (§2, the flow).** Each product page waits for the `PriceComparison` island (`waitForIsland`, from Phase 1) before it asserts. Otherwise the server's HTML could pass where the hydrated island judges differently.
- **Ages of fresh checks (§2).** A check made during the test may read "przed chwilą" or "N min temu", because a slow run crosses the one-minute line. While exploring, the first product page already said "1 min temu".
- **P4 without "Najtaniej" (§2)** is checked inside `main` only. The product page keeps the list beside it in the DOM for wider screens, hidden on a phone, and the other rows' screen-reader lines say "Najtaniej: …".
- **P4's hero (§2)** is checked with an inline ARIA snapshot of `main`: "Ostatnia znana cena", the price and "w Rossmannie", in reading order. The hero has no landmark or group, and Playwright's tree drops unnamed containers, so no locator could scope it without CSS.
- **Fresh ids (§1)** are random rather than time-based: Rossmann ids are 9 followed by 11 digits, and SKUs are `E2E-` followed by 12 hex digits. After each insert the helper asserts that the item has no stored check, so a collision with an earlier run fails instead of bringing that run's prices along.
- **The helpers' shape (§1).** `matchNatura` returns the SKU. `addRossmannProduct` records each product's name and id in the test's `test-data` annotations, so a leftover is findable.

**Phase 4, written by `/10x-e2e` (2026-10-02):**

- **Shared page helpers (Phase 3 §2, Phase 4 §2–§3).** `tests/e2e/support/pages.ts` holds what every spec finds: the list row, a shop's card, its price and age lines, the cheapest marks, the stopped notice, `openFromList` and `sidewaysScroll`. `price-honesty.spec.ts` now uses it too, so the specs define each locator and text once (lessons, "Define shared constants and helpers once").
- **Products are registered as they're added (Phase 3 §1).** `addRossmannProduct` registers each product as soon as its insert succeeds, and `removeSeededProducts`, which every spec's `afterEach` calls, deletes the current test's products, so seeding that fails halfway leaves nothing behind. `addMatchedProduct` moved into `watchlist-data.ts`, and `removeProducts(ids)` stays for Phase 5.
- **Taps, not clicks (§2).** `openFromList` and the bar's "Odśwież ceny" use `tap()`, the phone's own gesture, since the project emulates touch.
- **The row's line with two fresh prices (§2, step 1)** also says how much cheaper the cheapest shop is: "Najtaniej: Natura 14,49 zł, o 5,50 zł taniej niż Rossmann · {age}." The S-03 decision gives the list that savings text. The spec asserts the whole line.
- **The focus check (§2, step 7)** reads the focused control's computed outline after one Tab, then again with forced colours emulated on the same control. A second Tab would depend on where the first one landed.
- **The hydration helper (§1)** already existed from Phase 1, so this phase adds nothing there.

**Phase 5, written by `/10x-e2e` (2026-10-02):**

- **The removal's summary (§1, step 1; the phase's note on `<summary>`).** Playwright gives `<summary>` no role of its own: the `<details>` is a `group` whose text is "Usuń z listy". A closed `<details>` also keeps its confirm button in the DOM, which `getByText` matches too. So the spec taps the visible "Usuń z listy" inside the group (`filter({ visible: true })`), and finds the confirm as the group's button.
- **"Removes nothing" on the first tap (§1, step 1).** The confirm becomes visible, while the product's heading and its page's address stay. A removal posts and leaves the page.
- **The notices' roles (§1, step 3; §2, step 5).** The removal's notice on the list is a `status`. The decline's notice is a `status` inside Natura's card.
- **The choice (§2, steps 2–3).** Its "Anuluj" is the one in the "Drogerie Natura" region, because Natura's card offers its own "Anuluj" while the choice is open. "No candidate" means no "To ten produkt" button in the choice.
- **After the decline (§2, step 6).** The spec waits for the island before asserting that no "Najtaniej" is left. It checks the verdict with an inline ARIA snapshot ("Jedyna znana cena", 19,99 zł, "w Rossmannie"), as Phase 3 does.

**Phase 6 (2026-10-02):**

- **§6.3's extra bullets (§1).** Besides the eight topics, §6.3 says how to explore first (shops stopped, the preview, playwright-cli with the saved session) and what "done" means: green from a cold server, red under a deliberate break, no products left. Every spec in this change followed that method.
- **§6.6 (§1).** Its placeholder line became the first note.
- **CLAUDE.md's ruleset sentence (§2)** still names `ci` and `smoke`. The ruleset changes only after the merge (6.5), so that sentence and the deploy plan's record change together in the archive PR.

**Implementation review fixes (2026-10-02; `reviews/impl-review.md`):**

- **F1, a per-run hold (Phase 1 §3–§5).** The config names each run (`E2E_RUN`, inherited by every worker), and the shops a run stops carry `e2e:<run>`; the command line holds them as `e2e:manual`.
  - The setup refuses while any e2e hold exists, before it touches the run file.
  - The teardown switches back on only its own shops, and fails unless it restored exactly the ones its setup stopped. Otherwise someone released them mid-run.
  - `restore` releases every e2e hold: the way out of a killed run.
  - `run.json` now holds the run's name and the stopped shops, and no password.
- **F2, the guard (Phase 1 §2–§3).**
  - Every line of `.env` and `.dev.vars` that mentions `SUPABASE_URL`, outside a comment, must be exactly `SUPABASE_URL=http://127.0.0.1` or `http://localhost` (any port, quoted or not). Wrangler's dotenv grammar also reads `export`, spaces around `=` and `KEY: value`.
  - Both files are read from the repository's root, which the config loads `.env` from too.
  - `CLOUDFLARE_ENV` must be unset.
- **F3, no reused server (Phase 1 §2).** `reuseExistingServer` is `false`, so a server already on the port fails the run instead of being tested in place of the build.
- **F4, the focus check (Phase 4 §2, step 7)** also requires the outline's colour not to be transparent (alpha > 0), read through a 1 × 1 canvas. A transparent outline has a style and a width, and shows nothing.
  - The check reads the outline only once the control's transitions have finished (`getAnimations()`), because Tailwind's `transition` fades `outline-color` too.
  - Without that wait, its first break run stayed green: the check read the colour mid-fade, still near the ring's.
- **F5, the session handoff (Phase 3 §1).** The setup hands the sign-up's session to the seeding helpers through `run.json`, and the helpers take it over (`setSession`) instead of signing in. A run now costs the local auth limit one sign-up and the form's one sign-in, at any worker count, against the plan's "at most one helper sign-in per worker".
- **F6, a page's cost (Phases 3–4).** `recordPriceCalls` records the island's price requests, each naming its shop and item.
  - phone-refresh asserts none on opening the fresh product, and exactly one per shop, for the page's items, after the tap.
  - price-honesty asserts that the whole flow asked only P2's Rossmann and P4's Natura.
- **F7, a safety net (Phase 1 §5).** A `globalTeardown` switches the run's shops back on after Ctrl+C, which can skip the teardown project. A run killed outright leaves its hold, and the next run refuses until `restore`.
- **F8, the CI pin (Phase 2 §1).** A comment in the e2e job says its CLI pin and left-out services are the smoke job's, to change together. The smoke job stays untouched.
- **F9 (Phase 5 §2, step 3).** The decline spec waits for the island after "Anuluj", once the choice is gone from the new page.
- **F10.** Five texts were corrected:
  - this plan's Phase 1 notes on the guard and the mark;
  - §6.3's provenance rule, which now asks for the values' source only where a spec judges prices;
  - the roadmap's S-04 note;
  - the seeding helpers' comment on what acts as superuser.

## References

- Research: `context/changes/testing-critical-browser-flows/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 risks #1, #2, #7 and their response guidance; §3 Phase 1; §5 gates; §6.3; §7)
- Requirements: `context/foundation/prd.md:49,51,63-64,121,145`
- S-03 decisions: `context/archive/2026-09-28-cheapest-shop-today/plan-brief.md:32-33,39`; `plan.md:879-881` (review F1)
- Deferred rule follow-ups: `context/archive/2026-09-30-etykiety-redesign/follow-ups/review-fixes.md:20-21`
- Browser-only regressions so far: `context/archive/2026-09-30-etykiety-redesign/plan.md:1137,1186-1197`; `context/archive/2026-09-29-product-page-ui/reviews/impl-review.md:68-76`; `context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:935-941`
- Skills: `.claude/skills/10x-e2e-setup/` (templates, seed pattern, `test-stack.md` schema, tool wiring), `.claude/skills/10x-e2e/` (rules, anti-patterns). playwright-cli for exploring the running app: AI-native guidance, checked 2026-10-02.
- Seeding precedent: `scripts/check-prices-db.mjs:17-22,57-101`; `scripts/check-matches-db.mjs:85-103`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Playwright harness on the production preview, with the seed

#### Automated

- [x] 1.1 `@playwright/test` is a devDependency installed with npm 11.16, `npm ci` passes on the new lockfile, and Chromium is installed — 722d904
- [x] 1.2 `npm run lint`, `npx astro sync && npx astro check` and `npm run test` pass with the new files — 722d904
- [x] 1.3 From a cold server, `npx playwright test tests/e2e/seed.spec.ts` passes: the setup stops every enabled shop and proves Rossmann and Natura `stopped`, and the teardown re-enables only the shops it stopped and finds the request log unmoved — 722d904
- [x] 1.4 A shop stopped for another reason before a run is still stopped after it, with its reason unchanged — 722d904
- [x] 1.5 The guard stops a run at config load, before the build or any request, when `SUPABASE_URL` in `.env` or in `.dev.vars` names a non-local host (each tried on a temporary edit, restored afterwards) — 722d904
- [x] 1.6 Deliberate break: with the middleware not attaching the signed-in user, the seed goes red on its signed-in assertion; reverted — 722d904
- [x] 1.7 `context/foundation/test-stack.md` has its `## E2E` section with every required field — 722d904

#### Manual

- [x] 1.8 The owner reviews `tests/e2e/seed.spec.ts` and `playwright.config.ts`, the pattern every later spec copies — 722d904

### Phase 2: The e2e gate in CI

#### Automated

- [x] 2.1 The `e2e` job runs on the phase's push and passes. Its log shows the local stack, the preview built and started by the config, the shop stop, the seed and the unmoved request log — 15c060d
- [x] 2.2 The job reads no repository secret and writes only the local stack's values into `.env` and `.dev.vars` — 15c060d
- [x] 2.3 `ci` and `smoke` stay green and unchanged on the same commit — 15c060d

### Phase 3: Honest prices on both pages (#1)

#### Automated

- [x] 3.1 `npx playwright test tests/e2e/price-honesty.spec.ts` passes from a cold server with the request log unmoved — 040c88f
- [x] 3.2 Deliberate break: with eligibility ignoring orderability, the spec goes red on P1's mark; reverted — 040c88f
- [x] 3.3 Deliberate break: with ended promotions read as fresh, the spec goes red on P3's mark; reverted — 040c88f
- [x] 3.4 After a green and a red run, none of the spec's products remain on the run user's list — 040c88f
- [x] 3.5 Lint, `astro check` and unit tests pass, and CI's `e2e` job is green on the phase's commit — 040c88f

#### Manual

- [x] 3.6 The owner checks the spec's expected values against the PRD guardrail and the S-03 decision record — 040c88f

### Phase 4: Prices and refresh on a phone (#7)

#### Automated

- [x] 4.1 `phone-refresh.spec.ts` passes from a cold server with the request log unmoved — cc2acf0
- [x] 4.2 `phone-refresh-no-js.spec.ts` passes from a cold server with the request log unmoved — cc2acf0
- [x] 4.3 Deliberate break: with the prices route answering an error, `phone-refresh.spec.ts` goes red on the stopped notice; reverted — cc2acf0
- [x] 4.4 Deliberate break: with the base layer's focus outline removed, `phone-refresh.spec.ts` goes red on the focus check; reverted — cc2acf0
- [x] 4.5 Deliberate break: with the refresh route redirecting without its result code, `phone-refresh-no-js.spec.ts` goes red on the notice; reverted — cc2acf0
- [x] 4.6 After green and red runs, neither spec leaves a product on the run user's list — cc2acf0
- [x] 4.7 Lint, `astro check` and unit tests pass, and CI's `e2e` job is green on the phase's commit — cc2acf0

### Phase 5: Removals on a phone (#7)

#### Automated

- [x] 5.1 `phone-remove-product.spec.ts` passes from a cold server with the request log unmoved — c48d74d
- [x] 5.2 `phone-decline-match.spec.ts` passes from a cold server with the request log unmoved — c48d74d
- [x] 5.3 Deliberate break: with the removal route redirecting `done` without deleting, the removal spec goes red on the row's absence; reverted — c48d74d
- [x] 5.4 Deliberate break: with the decline's write never matching, the decline spec goes red on Natura's card; reverted — c48d74d
- [x] 5.5 After green and red runs, neither spec leaves a product on the run user's list — c48d74d
- [x] 5.6 The whole suite passes in one cold run with the request log unmoved, and CI's `e2e` job is green on the phase's commit — c48d74d

### Phase 6: Docs and the cookbook

#### Automated

- [x] 6.1 §6.3 and §6.6 of the test plan describe the shipped pattern, with no "TBD" left in §6.3, and Prettier passes on the changed Markdown — 4f77271
- [x] 6.2 CLAUDE.md's project section names the e2e commands and the CI job, and its course block is byte-identical — 4f77271
- [x] 6.3 The roadmap carries the S-04 and S-07 notes — 4f77271
- [x] 6.4 CI (`ci`, `smoke`, `e2e`) is green on the final commit — 4f77271

#### Manual

- [ ] 6.5 After the merge, the owner adds `e2e` to the `preventFailedDeploy` ruleset's required checks, and the deploy plan records it
- [x] 6.6 The owner reads §6.3 and finds it answers how to add an e2e test here — 4f77271
