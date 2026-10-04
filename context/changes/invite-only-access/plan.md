# Invite-only Front Door (S-07) Implementation Plan

## Overview

Make the app's front door invite-only and Polish (roadmap S-07, PRD FR-001 and FR-002):

- Nobody can register. Every sign-up page, route, form and link goes.
- The owner hands out access in two ways: an account made in the Supabase dashboard, or an invite or recovery link the owner makes with a small script. No email is sent.
- A Polish sign-in page on the app's design tokens returns the user to the list or the product they were opening.
- The starter's landing, demo and dark-pinned pages are gone.

Local tests keep creating their users through local sign-up.

## Current State Analysis

From `context/changes/invite-only-access/research.md` (2026-10-04, commit `b20ed7d`), checked against the code:

- **Sign-up still exists in the app**, though production refuses it (`context/deployment/deploy-plan.md:219`):
  - the page `src/pages/auth/signup.astro`, the route `src/pages/api/auth/signup.ts` and the island `src/components/auth/SignUpForm.tsx`;
  - the "check your email" page `src/pages/auth/confirm-email.astro`, which claims an email was sent, against FR-001;
  - links to sign-up at `src/pages/auth/signin.astro:17`, `src/components/Topbar.astro:27` and `src/components/Welcome.astro:36-39`.
- **The sign-in page is the starter's.**
  - It is English and pinned dark (`theme="dark"`, `bg-cosmic`), built from React islands with literal colours (`src/components/auth/*.tsx`).
  - Its route casts form fields, doesn't guard `formData()`, and passes Supabase's message through `?error=` (`src/pages/api/auth/signin.ts:4-6`, `:16`), so a crafted link can put words on the page.
- **Nothing keeps a return path.**
  - The middleware redirects to `/auth/signin` with none (`src/middleware.ts:25`).
  - Sign-in always lands on `/watchlist` (`signin.ts:19`).
  - The island's "Zaloguj się ponownie" link carries none (`src/components/watchlist/PriceComparisonView.tsx:80`).
- **The starter's pages remain.**
  - `/` is the "10x Astro Starter" landing (`src/pages/index.astro`, `Welcome.astro`, `Topbar.astro`).
  - `/dashboard` is a demo page that nothing links to (`src/pages/dashboard.astro`; `PROTECTED_ROUTES` at `src/middleware.ts:5`).
  - Sign-out lands on `/` (`src/pages/api/auth/signout.ts:9`).
  - Five pages are pinned dark with `bg-cosmic` (`src/styles/global.css:397-407`) and pad no safe-area insets.
- **Every test user comes from public sign-up.**
  - 5 direct supabase-js `auth.signUp` call sites: `tests/e2e/auth.setup.ts:39` and the four `scripts/check-*-db.mjs`.
  - Smoke posts to the app's own sign-up route (`scripts/smoke.mjs:77-81`).
  - Local `[auth] enable_signup = true` (`supabase/config.toml:171`) allows all of them.
- **No admin key or admin API exists in the repo.** Production's account was made in the dashboard with "Auto Confirm User" (`deploy-plan.md:126`).

## Desired End State

- **No way to register:**
  - `/auth/signup`, `/auth/confirm-email`, `/dashboard` and `POST /api/auth/signup` answer 404.
  - No page links to sign-up.
  - Production's sign-up stays refused, and a read-only check proves it.
- **The front door redirects:**
  - `/` sends a signed-in user to `/watchlist` and a visitor to `/auth/signin`.
  - Sign-out lands on `/auth/signin` with "Wylogowano.".
  - A signed-in user opening sign-in goes on to their target.
- **Sign-in is Polish and on the app's tokens:**
  - The paper, the logo, a card, fields like the search field, the primary button and the base focus ring, with safe-area padding.
  - It works without JavaScript.
  - Errors come as codes the page maps to its own text.
- **The return path:**
  - A gated page's redirect carries `next` when the page is `/watchlist` or `/watchlist/<id>`, keeping only the list filter `f`.
  - Sign-in accepts only those two forms, and anything else lands on `/watchlist`.
  - The island's session link carries its product.
- **Invite and recovery links:**
  - `node scripts/owner-link.mjs invite|recovery <email>`, run by the owner with a secret key on their own machine, prints an app link.
  - The link opens `/auth/confirm`, which checks the token only when the button is pressed, then `/auth/set-password`, then the list with "Hasło zapisane.".
  - Links live 24 hours, with a 10-digit code, set in production's dashboard and in local `config.toml`.
- **Tests:**
  - The e2e setup and the database checks still create users through local sign-up.
  - Smoke signs up through Supabase's own endpoint and pins every redirect, code and refusal above.
- **Verification:** `npm run test`, `npm run lint`, `npx astro check`, `npm run build`, `npm run smoke`, the four database checks and `npx playwright test` pass. The `/dev/auth` kitchen sink shows every auth state in both themes.

### Key Discoveries:

- `isOwnNavigation` (`src/lib/services/search-query.ts:19-26`) counts a same-origin redirect as the user's own navigation. So a return path carrying `repin` or `retry` would trigger a shop lookup after sign-in, and `next` must never carry them.
- `filterHref(path, filter, params)` (`src/lib/services/watchlist-rows.ts:366`) and `parseListFilter` (`:41`) build and read the list's links. `listRefreshBackOf` (`src/lib/services/price-refresh.ts`) is the model for a validated redirect target.
- Notices and error texts are parameter constants and code-to-text maps in `src/lib/notices.ts`. Pages forget them from the address bar with `withoutNotices` (`src/pages/watchlist.astro:129-136`). A code the app didn't send shows nothing (`matchErrorMessage` in `src/lib/services/matches.ts`).
- Progressive enhancement is an Astro `<script>`: `src/components/SubmitOnce.astro`, and `src/components/shell/ThemeToggle.astro`, which stays hidden without JavaScript.
- Verifying a handed-over link must use `locals.supabase.auth.verifyOtp({ token_hash, type })` on a POST. The cookies are written through `setAll` (`src/lib/supabase.ts:18-26`).
  - Supabase's own `action_link` uses the implicit flow, which the server can't read.
  - Link previews can use up a link opened by GET (research §1).
- `[auth] enable_signup` is the only local sign-up switch. `[auth.email] enable_signup` is the whole email provider, and turning it off would refuse password sign-in too (research §3).
- CI writes the local stack's `.env` before smoke runs (`.github/workflows/ci.yml:44-48`), so `node --env-file-if-exists=.env` gives smoke its Supabase values locally and in CI. Node 24.18 has the flag.
- `tokenConfig` (`eslint.config.js:173-182`) lists every cleaned view, and the auth files join it. `islandConfig` (`:89-155`) admits only browser-safe modules.

## What We're NOT Doing

- No change-password page for a signed-in user (the owner's call, 2026-10-04). A new password comes from a recovery link, and `/auth/set-password` accepts only a session from a checked link, under an hour old (plan review F1).
- No email of any kind: no SMTP, no Supabase invite or "send magic link" emails, no password-changed notifications.
- No secret key in the app, the Worker, `.env`, `.dev.vars`, CI or any committed test. Only the owner's script uses one, from the owner's own environment.
- No change to local sign-up: `[auth] enable_signup` stays `true` locally (the owner's call). No local test proves production's refusal; the read-only production check does.
- No "Before User Created" hook, no invite-code table, no owner or admin screen in the app (flat roles, PRD Access Control).
- No e2e spec for the invite or recovery flow. It would need a secret key in tests, so an agent-run local check covers it.
- No automated production check in CI. The read-only check is a deploy-plan step until test-plan rollout Phase 4 automates it.
- No landing page, and no return path for the search (`q`), re-pin (`repin`) or retry (`retry`) views.
- No forwarding of users' IPs to Supabase (`Sb-Forwarded-For` needs a secret key on the server).
- No account deletion, session-length or "remember me" changes.
- No password rule beyond the app's 8 to 72 UTF-8 bytes, Auth's own unit. Production's own policy applies on top.

## Implementation Approach

The work goes in four phases, each shippable on its own:

1. Remove the registration surface and the starter pages.
2. Rebuild sign-in as plain Astro forms on the app's tokens, with its rules in tested services (return path, form schemas, Supabase error codes).
3. Add the link flow on the same page shell and services.
4. Update the docs and roll out the owner's production steps.

Decision logic lives in `src/lib/services/` with unit tests (`context/foundation/lessons.md:26-31`). Pages and routes only read, call and map, and every route redirects with codes (`CLAUDE.md`, API routes). The owner's script is self-contained Node, because scripts can't resolve the `@/` alias. Its link format is the confirm page's contract, named in both files' comments.

## Critical Implementation Details

### What each page view and action costs the shops

`context/foundation/lessons.md:12-17` requires this:

- Sign-in, confirm and set-password pages and routes, `/`, and sign-out ask no shop (0 requests).
- The landing after sign-in costs what its target costs as the user's own navigation:
  - `/watchlist` asks no shop.
  - `/watchlist/<id>` costs the product view's own-navigation rows of S-05's cost table (`context/archive/2026-10-02-hebe-in-comparison/plan.md`, "What each page view and action may cost the shops").
- The return path never carries `repin`, `retry` or `q`, so a crafted link can't add a re-pin, retry or search request.

### Token and key hygiene

- **The handed-over link.** `token_hash` and passwords are never logged or put in a redirect. The confirm page answers with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. GET `/auth/confirm` only renders the button, so a link preview can't use the link up.
- **The secret key.** The owner's script reads it from the process environment only. It must never go into `.env` or `.dev.vars`, because the build copies `.dev.vars` into `dist/server/` (`CLAUDE.md`, Commands). The deploy plan tells the owner to create a dedicated `sb_secret_…` key per use and delete it afterwards.
- **Local config.** Changing `[auth.email] otp_length` / `otp_expiry` in `supabase/config.toml` needs `npx supabase stop && npx supabase start`. That keeps local data; ask the owner first. CI starts a fresh stack, so it picks the values up by itself. Never `supabase config push`.
- **Auth versions.** CI runs Auth v2.196.0, the CLI's default image. The local stack runs v2.197.0 only because of the gitignored `supabase/.temp/gotrue-version`. This plan's code paths (`verify`, `user`, `token`, password checks, OTP settings) are the same at both versions (plan review F6).

## Phase 1: No self-registration, no starter pages

### Overview

Delete every way to register and the starter's landing and demo pages. Send `/` to the list or to sign-in, and move smoke's user creation to Supabase's own sign-up endpoint. The sign-in page stays the starter's for now, minus its "Sign up" link.

### Changes Required:

#### 1. The sign-up surface

**Files**: `src/pages/auth/signup.astro`, `src/pages/api/auth/signup.ts`, `src/pages/auth/confirm-email.astro`, `src/components/auth/SignUpForm.tsx` (deleted); `src/pages/auth/signin.astro`

**Intent**: Remove the app's sign-up page, route, form and "check your email" page. The registration path stays closed on production, and the page claiming an email was sent goes.

**Contract**: These answer 404:

- `GET /auth/signup`
- `GET /auth/confirm-email`
- `POST /api/auth/signup`

The sign-in page loses its "Don't have an account? Sign up" paragraph (`signin.astro:15-20`). No file under `src/` links to `/auth/signup` or `/auth/confirm-email`.

#### 2. The starter's landing and demo

**Files**: `src/pages/index.astro`, `src/pages/dashboard.astro` (deleted), `src/components/Welcome.astro` (deleted), `src/components/Topbar.astro` (deleted), `src/middleware.ts`, `tests/e2e/seed.spec.ts` and `playwright.config.ts` (comments only)

**Intent**: `/` becomes a redirect, signed-in to `/watchlist` and visitor to `/auth/signin`, read from `Astro.locals.user`. `/dashboard` goes, with its entry in `PROTECTED_ROUTES`.

**Contract**:

- `GET /` answers 302: to `/watchlist` with a user, to `/auth/signin` without.
- `GET /dashboard` answers 404.
- `PROTECTED_ROUTES` is `["/watchlist", "/api/watchlist"]`.
- Sign-out keeps redirecting to `/`, which now forwards to sign-in. Phase 2 changes its landing.
- The comments that say `/` answers 200 (`tests/e2e/seed.spec.ts:3-4`, `playwright.config.ts:54-55`) say it now redirects (plan review F5). The readiness checks still work: `curl -sf` (`.github/workflows/ci.yml:69`) and Playwright's `webServer.url` both accept a redirect.

#### 3. Smoke creates its user through Auth

**Files**: `scripts/smoke.mjs`, `package.json`

**Intent**: Smoke can no longer post to the removed route.

- It signs its user up with a plain `fetch` to `${SUPABASE_URL}/auth/v1/signup`, using the publishable key, before its steps. Local sign-up stays on, and confirmations are off (`supabase/config.toml:211`).
- Like the database checks (`scripts/check-watchlist-db.mjs:12-17`), it refuses a `SUPABASE_URL` that isn't local.
- The npm script loads `.env` when present, which CI writes before smoke runs.

**Contract**:

- `"smoke": "node --env-file-if-exists=.env scripts/smoke.mjs"`. Smoke needs `SUPABASE_URL` and `SUPABASE_KEY` (local only) besides `BASE_URL`.
- Steps changed:
  - "home renders" becomes "`/` sends a visitor to sign-in" (302, location exactly `/auth/signin`).
  - The three `/dashboard` steps become `/dashboard` 404, and, after sign-out, the list redirecting again.
  - The sign-up step becomes `POST /api/auth/signup` 404.
- Step added: signed in, `/` answers 302 to exactly `/watchlist`.
- Smoke stays dependency-free.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Lint and types pass: `npm run lint` (the untracked "Drogeria Radar redesign" folder ignored) and `npx astro check`
- The build passes, fonts included: `npm run build`
- Smoke passes against the local production preview: `npx astro preview --port 4321` with `npm run smoke`
- The database checks pass unchanged:
  - `node scripts/check-watchlist-db.mjs`, `check-matches-db.mjs` and `check-prices-db.mjs` locally;
  - `check-shop-gate-db.mjs` in CI's smoke job, since a local rerun needs a reset that deletes local users.
- The e2e suite passes: `npx playwright test`
- No reference to the removed pages remains outside smoke's 404 steps: `grep -rn "auth/signup\|confirm-email\|/dashboard\|Welcome\|Topbar" src tests scripts --exclude=smoke.mjs` finds none, and `scripts/smoke.mjs` names `/dashboard` and `/api/auth/signup` only in its 404 steps (plan review F2)

#### Manual Verification:

- In a browser at 390 px, agent-run on the local preview:
  - signed out, `/` lands on sign-in, which shows no "Sign up" link;
  - signed in, `/` lands on the list;
  - sign-out ends on sign-in.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Polish sign-in with a return path

### Overview

Rebuild sign-in as a plain Astro form on the app's tokens, in Polish. Its rules move into tested services:

- the return path;
- the form schema;
- Supabase error codes.

Then:

- the middleware and the island's session link carry the return path;
- sign-out lands on sign-in with a notice;
- the dark pin, `bg-cosmic` and the starter's React form pieces go;
- the auth files join the token lint;
- a kitchen sink shows every sign-in state.

### Changes Required:

#### 1. The return path

**Files**: `src/lib/services/return-path.ts` (new), `src/lib/services/return-path.test.ts` (new), `src/lib/services/watchlist-rows.ts`, `src/lib/services/watchlist-rows.test.ts`

**Intent**: Decide in one tested place which targets a sign-in may return to. The list's link helpers gain the sign-in link that the island, the middleware and the pages share.

**Contract**:

- **`watchlist-rows.ts`** (browser-safe, already admitted by `islandConfig`) gains:
  - `NEXT_PARAM = "next"`;
  - `signInHref(next?: string): string`, giving `/auth/signin`, or `/auth/signin?next=<encoded>`.
- **`return-path.ts`** (server) exports `returnPathOf(raw: FormDataEntryValue | string | null): string`. It gives the canonical target, or `/watchlist` for anything else:
  - the target must be same-origin;
  - its path must be exactly `/watchlist` or `/watchlist/<uuid>` (`parseWatchlistItemId`);
  - the only query allowed is `f` with a filter a chip links to;
  - there must be no hash.
- **`return-path.ts`** also exports `returnPathFor(url: URL): string | null`, which the middleware uses:
  - for `/watchlist` or `/watchlist/<uuid>` it gives that path with only its `f` kept (`filterHref`);
  - for any other path, the API routes included, it gives null.
- **Unit cases:**
  - Accepted:
    - `/watchlist`
    - `/watchlist?f=check`
    - `/watchlist/<uuid>?f=promo`
  - Rejected, each to `/watchlist`:
    - absolute and protocol-relative URLs, `/\\` paths, an encoded `//`
    - another path
    - a non-UUID id
    - an unknown `f`
    - `repin`, `retry`, `q` or a notice parameter
    - a hash
    - a non-text field
  - `returnPathFor` drops every parameter but `f`, and gives null for `/api/watchlist/prices` and `/watchlist/refresh`.

#### 2. Sign-in rules and texts

**Files**: `src/lib/services/auth.ts` (new), `src/lib/services/auth.test.ts` (new), `src/lib/notices.ts`, `src/lib/notices.test.ts` (or the existing notices tests)

**Intent**: Validate the sign-in form with zod, and turn Supabase's answers into the app's own codes. The texts each code shows live beside the other notices, so a code the app didn't send shows nothing.

**Contract**:

- **`auth.ts`** exports:
  - `signInFormSchema`: email trimmed and an email; password 1–72 characters; `next` optional.
  - `authErrorCodeOf(error)`. It reads only `error.code` and `error.status`, never the message:
    - `invalid_credentials` → `invalid`
    - 429 or `over_request_rate_limit` → `busy`
    - anything else → `failed`
- **`notices.ts`** gains:
  - `SIGN_IN_ERRORS` (`invalid`, `busy`, `failed`, `config`) with Polish texts:
    - "Nieprawidłowy e-mail lub hasło."
    - "Zbyt wiele prób. Spróbuj za kilka minut."
    - "Nie udało się zalogować. Spróbuj ponownie."
    - "Supabase nie jest skonfigurowany."
  - their parser, which gives null for anything else;
  - `SIGNED_OUT_PARAM` and its text "Wylogowano.";
  - a list notice for a failed sign-out, "Nie udało się wylogować. Spróbuj ponownie.", in `LIST_NOTICE_PARAMS` (plan review F4);
  - `SIGN_IN_NOTICE_PARAMS` for the address-bar script. `next` stays.
  - The plan proposes these texts; the owner may reword them, as in `context/archive/2026-09-30-etykiety-redesign/plan-brief.md:107`.

#### 3. The auth shell and its pieces

**Files**: `src/layouts/AuthShell.astro` (new), `src/components/ui/input.tsx` (new), `src/components/auth/PasswordInput.astro` (new), `src/components/auth/SignInView.astro` (new); deleted: `src/components/auth/{SignInForm,FormField,PasswordToggle,ServerError,SubmitButton}.tsx`

**Intent**: Give the auth pages one shell on the handoff's tokens (`context/archive/2026-09-30-etykiety-redesign/handoff/README.md:31-37`, `:144`), replacing the starter's dark React form.

**Contract**:

- **`AuthShell.astro`** wraps `Layout` with `lang="pl"` and the default `theme="user"`, so there's no pin. It has:
  - the dotted paper (`bg-paper`);
  - safe-area padding like `src/layouts/WatchlistShell.astro:61`;
  - `LogoMark`;
  - a centred column with a `Card`;
  - the title `<page> · Drogeria Radar`.
- **`input.tsx`** is copied from `https://ui.shadcn.com/r/styles/new-york-v4/input.json`, with the header comment of `src/components/ui/alert.tsx:1-7` (URL, date, changes). It is sized like the search field (`h-13`, `rounded-search`, `border-2 border-input`, `bg-card`; `src/components/shell/SearchForm.astro`). It has no focus ring of its own, so the base layer's `--ring` shows (`CLAUDE.md`, UI).
- **`PasswordInput.astro`** is an `Input` with `type="password"` plus a show/hide button.
  - The button stays hidden until its `<script>` runs, as `ThemeToggle.astro` does, with `aria-pressed`, "Pokaż hasło", and a 44 px target (`hit-area`).
- **`SignInView.astro`** holds the form, which posts to `/api/auth/signin` with `data-submit-once`:
  - plain `<label>`s "E-mail" and "Hasło";
  - `autocomplete` `email` and `current-password`;
  - a hidden `next`;
  - the primary button "Zaloguj się".

  Above the form, an error or notice, in `Alert`'s destructive variant or as a status. It renders from props (error text, notice text, next), so the page and the kitchen sink share it.

#### 4. Sign-in page, route, middleware, sign-out, island link

**Files**: `src/pages/auth/signin.astro`, `src/pages/api/auth/signin.ts`, `src/middleware.ts`, `src/pages/api/auth/signout.ts`, `src/components/watchlist/PriceComparisonView.tsx`, `src/dev/fixtures.ts` (the session-ended fixture, if it builds the link)

**Intent**: Wire the services in. A failed sign-in keeps the return path. A signed-in visitor isn't shown the form.

**Contract**:

- **The page:**
  - With `locals.user` it answers 302 to `returnPathOf(?next)`.
  - Otherwise it renders `AuthShell` and `SignInView` with:
    - the validated `next`;
    - the text for a known `?error=` code;
    - "Wylogowano." for `?SIGNED_OUT_PARAM`.
  - An inline script forgets the notice parameters (`withoutNotices`).
- **The route:**
  - It guards `formData()` (a non-form body is `invalid`) and parses `signInFormSchema`. With no client configured it answers `config`.
  - It calls `signInWithPassword`.
  - On error it answers 302 to `/auth/signin?error=<code>&next=<validated>`, where `next` appears only when it isn't `/watchlist`.
  - On success it answers 302 to `returnPathOf(next)`.
- **The middleware:** a protected request without a user is redirected to `signInHref(returnPathFor(url) ?? undefined)`. API routes keep the plain `/auth/signin`, which the island's ended-session detection reads (`src/components/watchlist/price-comparison-state.ts:711`, `:727-737`).
- **Sign-out** calls `signOut({ scope: "local" })`, signing out this device only (plan review F4).
  - On success it answers 302 to `/auth/signin?<SIGNED_OUT_PARAM>`.
  - On a returned error it answers 302 to `/watchlist` with the failed-sign-out notice, never "Wylogowano.". `signOut()` can keep the session in one case, an expiring token whose refresh fails retryably (`node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:3426-3428`).
- **The island's link** becomes `signInHref(filterHref(`/watchlist/${itemId}`, listFilter))`.

#### 5. The dark pin's leftovers, lint and the kitchen sink

**Files**: `src/styles/global.css`, `src/layouts/Layout.astro`, `eslint.config.js`, `astro.config.mjs`, `src/dev/auth.astro` (new)

**Intent**: Remove `bg-cosmic`, which nothing uses any more. Hold the auth views to the token lint. Show every sign-in state for review.

**Contract**:

- `bg-cosmic` and its comment (`global.css:397-407`) go.
- `Layout.astro` (plan review F5):
  - Its `"dark"` pin goes, since nothing passes it after this phase; `"user"` and `"light"` stay.
  - Its defaults become `lang="pl"` and the title "Drogeria Radar", replacing "10x Astro Starter" and `en`.
  - Its doc comment (`:11-19`) follows.
- `tokenConfig.files` gains:
  - `src/pages/index.astro`
  - `src/pages/auth/**/*.astro`
  - `src/layouts/AuthShell.astro`
  - `src/components/auth/**/*.astro`
- `astro.config.mjs`'s dev integration injects `/dev/auth` (`src/dev/auth.astro`), pinned to light, with each section again in a `.dark` wrapper and its widths as inline styles, like `src/dev/watchlist.astro`. Its sign-in states:
  - plain;
  - with `next`;
  - "Wylogowano.";
  - each error code.

#### 6. Tests that pin the sign-in page

**Files**: `scripts/smoke.mjs`, `tests/e2e/auth.setup.ts`

**Intent**: Pin the new redirects and codes over HTTP. Move the e2e setup to the Polish form, which no longer needs hydration.

**Contract**:

- **New smoke steps:**
  - A visitor's product page redirects to exactly `/auth/signin?next=%2Fwatchlist%2F<id>`.
  - `/watchlist?f=check&q=x` redirects to exactly `/auth/signin?next=%2Fwatchlist%3Ff%3Dcheck`.
  - An API route redirects to exactly `/auth/signin`.
  - A wrong password answers exactly `/auth/signin?error=invalid`.
  - A foreign-`Origin` POST to `/api/auth/signin` answers 403.
  - Sign-in with `next=/watchlist/<missing id>?f=check` lands on exactly that target.
  - Sign-in with `next` set to an absolute URL, `//host` or `/watchlist/<id>?repin=natura` lands on exactly `/watchlist`.
  - Signed in, `/auth/signin` answers 302 to `/watchlist`.
  - Sign-out lands on exactly `/auth/signin?<SIGNED_OUT_PARAM>`.
- **The setup:**
  - It fills `getByLabel("E-mail")` and `getByLabel("Hasło", { exact: true })` and clicks "Zaloguj się", with no `waitForIsland`.
  - It still expects 302 to exactly `/watchlist`.
  - Its comment about the hydration wait goes.

### Success Criteria:

#### Automated Verification:

- The new unit tests pass: `npx vitest run src/lib/services/return-path.test.ts src/lib/services/auth.test.ts src/lib/services/watchlist-rows.test.ts`, plus the notices tests
- All unit tests, lint and types pass: `npm run test`, `npm run lint`, `npx astro check`
- The token contrast check passes: `node scripts/check-token-contrast.mjs`
- The build passes: `npm run build`
- Smoke passes with the return-path, code, origin and sign-out steps: `npm run smoke` against the local preview
- The e2e suite passes, its setup signing in through the Polish form: `npx playwright test`
- Break-checks:
  - `returnPathOf` accepting `repin` turns its unit test red, and smoke's crafted-`next` step;
  - the route passing Supabase's message turns smoke's exact error step red.

#### Manual Verification:

- `/dev/auth` sign-in states in light and dark at 390 px and 1280 px:
  - tokens, the base focus ring, 44 px targets, the show/hide button hidden without JavaScript;
  - no palette colours;
  - agent-run, screenshots read back.
- In a browser at 390 px on the local preview, agent-run:
  - a visitor's `/watchlist/<id>?f=check&repin=natura` goes to sign-in, then back to `/watchlist/<id>?f=check` without `repin`;
  - an ended session's "Zaloguj się ponownie" returns to its product;
  - a wrong password shows the Polish error;
  - sign-out shows "Wylogowano.";
  - the form posts with JavaScript off.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Invite and recovery links

### Overview

Add the owner's link flow:

- a script the owner runs with a secret key, which prints an app link;
- `/auth/confirm`, which checks the token on POST;
- `/auth/set-password`, which ends on the list with "Hasło zapisane.".

Local links live 24 hours with a 10-digit code, as production's will.

### Changes Required:

#### 1. Confirm and password rules and texts

**Files**: `src/lib/services/auth.ts`, `src/lib/services/auth.test.ts`, `src/lib/notices.ts`

**Intent**: Extend the auth service and the notices to the two new forms.

**Contract**:

- **`auth.ts`** gains:
  - `confirmFormSchema`: `token_hash` 56 lowercase hex (SHA-224); `type` `invite` or `recovery`.
  - `passwordFormSchema`: a password of 8 to 72 UTF-8 bytes, counted with `TextEncoder` as Auth counts them (plan review F3). A password of Polish letters then gets the app's length text, not "failed".
  - `linkSessionOf(claims, now)` (plan review F1):
    - It is true only when the verified `amr` holds `"otp"` with a timestamp no more than 60 minutes before `now`.
    - Every other session is false: a password sign-in, an older link session, a missing or odd `amr`.
    - After `verifyOtp`, Auth marks the session `[{ method: "otp", timestamp }]`, and the mark never changes ([verify.go#L285](https://github.com/supabase/auth/blob/v2.197.0/internal/api/verify.go#L285)). A password sign-in gives `"password"`.
  - The mapping to codes:
    - `otp_expired` → `expired`
    - `weak_password` → `weak`
    - `same_password` → `same`
    - `validation_failed` (over 72 bytes) → `invalid`, the length text
    - with `invalid`, `busy`, `failed`, `config` as before.
- **`notices.ts`** gains:
  - `CONFIRM_ERRORS`: "Link wygasł albo został już użyty. Poproś o nowy.", plus `invalid`, `busy`, `failed`, `config`.
  - `PASSWORD_ERRORS`: "Hasło musi mieć od 8 do 72 znaków.", "Hasło jest za słabe.", "To hasło jest już ustawione.", plus `busy`, `failed`, `config`.
  - A list notice parameter whose text is "Hasło zapisane.", added to `LIST_NOTICE_PARAMS`.

#### 2. `/auth/confirm`

**Files**: `src/components/auth/ConfirmView.astro` (new), `src/pages/auth/confirm.astro` (new), `src/pages/api/auth/confirm.ts` (new)

**Intent**: A handed-over link opens a page with one button. Only pressing it uses the link, which signs the person in for the set-password page.

**Contract**:

- **The page**, under `AuthShell`, renders a form when `token_hash` and `type` parse. The form posts both as hidden fields to `/api/auth/confirm`, and its button reads "Ustaw hasło". Without them, or with `?error=<code>`, it shows the code's text.
- **Its headers:** `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- **The route:**
  - It guards `formData()` and parses `confirmFormSchema` (otherwise `invalid`).
  - It calls `locals.supabase.auth.verifyOtp({ token_hash, type })`.
  - On error it answers 302 to `/auth/confirm?error=<code>`.
  - On success it answers 302 to `/auth/set-password`.
  - It never logs the token.

#### 3. `/auth/set-password`

**Files**: `src/components/auth/SetPasswordView.astro` (new), `src/pages/auth/set-password.astro` (new), `src/pages/api/auth/set-password.ts` (new), `src/middleware.ts`

**Intent**: The person just signed in by the link chooses their password, and lands on their list. No other session may use the page, so it never becomes a change-password page (plan review F1).

**Contract**:

- `PROTECTED_ROUTES` gains `/auth/set-password` and `/api/auth/set-password`.
- **Only a link session:**
  - The page and the route read verified claims with `locals.supabase.auth.getClaims()` and require `linkSessionOf`.
  - Any other session answers 302 to `/watchlist` before any Auth update, a password sign-in included.
  - With HS256 tokens, as the local stack has, `getClaims()` verifies through one `/user` call.
- **The page** has one `PasswordInput` with `autocomplete="new-password"`, `minlength` 8 and `maxlength` 72, and the button "Zapisz hasło".
- **The route:**
  - It parses `passwordFormSchema`.
  - It calls `locals.supabase.auth.updateUser({ password })`.
  - On error it answers 302 to `/auth/set-password?error=<code>`.
  - On success it answers 302 to `/watchlist?<password notice>`.
  - Both pages and routes ask no shop.

#### 4. The owner's script

**File**: `scripts/owner-link.mjs` (new)

**Intent**: Let the owner make an invite or recovery link from their own machine, with no email sent and no key in the app.

**Contract**:

- **Usage:** `node scripts/owner-link.mjs <invite|recovery> <email>`, with `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `APP_URL` from the environment. `APP_URL` is the app's origin, for example `http://localhost:4321` or the production URL.
- **It refuses, before any request:**
  - a missing argument or variable;
  - a type other than those two;
  - an email that isn't one;
  - a publishable or anon key (an `sb_publishable_` prefix, or a JWT whose `role` isn't `service_role`);
  - an `APP_URL` that isn't an http(s) origin.
- **It calls** `auth.admin.generateLink({ type, email })` through supabase-js with `autoRefreshToken` and `persistSession` off.
- **It prints** only `${APP_URL}/auth/confirm?token_hash=<hashed_token>&type=<verification_type>`, with the reminder that the link is single use and valid for 24 hours.
- **On error** it prints Auth's error code with a hint:
  - `email_exists` → use `recovery`;
  - `user_not_found` → use `invite`.
- It never prints the key and writes no file.
- The link format is the confirm page's contract, named in both files' comments.

#### 5. Local link lifetime

**File**: `supabase/config.toml`

**Intent**: Locally, links behave as production's will.

**Contract**: `[auth.email] otp_length = 10` and `otp_expiry = 86400`, with their comments updated. `[auth] enable_signup` and `[auth.email] enable_signup` stay `true`. The running stack picks the change up after the owner-approved `npx supabase stop && npx supabase start`.

#### 6. Kitchen sink and smoke

**Files**: `src/dev/auth.astro`, `scripts/smoke.mjs`

**Intent**: Show and pin the new pages' states and contracts without a secret key.

**Contract**:

- **The sink** adds:
  - confirm: ready, each error, no token;
  - set-password: plain, each error.
- **Smoke adds:**
  - A visitor's `/auth/set-password` and `POST /api/auth/set-password` redirect to `/auth/signin`.
  - `GET /auth/confirm` answers 200 with `no-store`.
  - `POST /api/auth/confirm` with a malformed token answers exactly `/auth/confirm?error=invalid`.
  - With 56 zero hex digits, it answers exactly `/auth/confirm?error=expired`. That is one `/verify` call on the local stack.
  - A foreign-`Origin` POST to `/api/auth/confirm` answers 403.
  - Signed in by password, `GET /auth/set-password` and `POST /api/auth/set-password` answer 302 to exactly `/watchlist`, and the original password still signs in afterwards (plan review F1). The length check lives in the unit tests, since only a link session reaches it.

### Success Criteria:

#### Automated Verification:

- The auth service and notices unit tests pass: `npx vitest run src/lib/services/auth.test.ts`, plus the notices tests
- All unit tests, lint, types and contrast pass: `npm run test`, `npm run lint`, `npx astro check`, `node scripts/check-token-contrast.mjs`
- The build passes: `npm run build`
- Smoke passes with the confirm and set-password steps: `npm run smoke` against the local preview
- The e2e suite passes: `npx playwright test`
- The owner script refuses each bad input without a request, its key-shape check included. Run with a publishable key, a bad type, a bad email, no `APP_URL`
- Break-checks:
  - a confirm route that calls `verifyOtp` on a malformed token turns smoke's exact `?error=invalid` step red;
  - a set-password route that skips `linkSessionOf` turns smoke's password-session step red.

#### Manual Verification:

- After the owner-approved local restart, the local auth container shows `GOTRUE_MAILER_OTP_EXP=86400` and `GOTRUE_MAILER_OTP_LENGTH=10`, read with `docker exec … env`.
- The local invite flow, agent-run at 390 px:
  - The local secret key from `npx supabase status -o env` goes only into that one command's environment.
  - `owner-link.mjs invite` for a throwaway address prints a link.
  - The link's page opens twice by GET without using it up.
  - "Ustaw hasło", a new password, the list with "Hasło zapisane."
  - Sign out, then sign in with the new password.
- The local recovery flow for the same user works the same way. A used link and an unknown one show the Polish error. A password session opening `/auth/set-password` lands on the list.
- `/dev/auth` confirm and set-password states in light and dark at 390 px and 1280 px, agent-run.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Docs and rollout

### Overview

Bring every document in line with the new front door. Give the owner a how-to for accounts and links, the two production settings, and the read-only check that sign-up stays refused. After the merge the owner checks production.

### Changes Required:

#### 1. CLAUDE.md (project sections only)

**File**: `CLAUDE.md`

**Intent**: The rules and commands describe the app as it now is. The 10x CLI's course block stays byte-identical.

**Contract**:

- **Non-negotiables:**
  - No sign-up page.
  - Local `enable_signup = true` is for tests.
  - Accounts come from the dashboard or the owner's links, with no email.
  - Never put a secret key into the app, `.env`, `.dev.vars` or tests.
- **Commands:**
  - `npm run smoke` reads `.env`.
  - `owner-link.mjs` usage.
  - After `db reset`, recreate the local account with local Studio's "Add user" or an invite link, not `/auth/signup`.
  - The e2e setup's form labels.
- **Architecture:**
  - The auth pages are on tokens, with no dark pin, `bg-cosmic` or `FormField` ring.
  - The return path, `returnPathOf`, `signInHref`.
  - The auth routes use codes and zod.
  - The confirm and set-password flow; set-password accepts only a link session.
  - Sign-out signs out this device only.
  - The list of routes that tolerate a missing Supabase gains `/api/auth/confirm` and `/api/auth/set-password` (plan review F5).
  - `tokenConfig` covers the auth files.

#### 2. Owner's how-to and production steps

**File**: `context/deployment/deploy-plan.md`

**Intent**: Write down how the owner adds a person, sets the link lifetime, and proves sign-up is refused, without secrets in the repo or the chat.

**Contract**: A new "Accounts and links (S-07)" section:

- an account from the dashboard (Add user, Auto Confirm);
- a link:
  - create a dedicated `sb_secret_…` key (Settings → API Keys);
  - run `owner-link.mjs` with it in the shell's environment;
  - hand the link over;
  - delete the key;
- the production settings, under Authentication → Sign In / Providers → Email: "Email OTP expiration" 86400 seconds and "Email OTP length" 10 digits. Those are the fields' maximums (0–86400 s and 6–10 digits in Studio's source; plan review F6). Never `config push`;
- the read-only check, run after this merge and after each later deploy until rollout Phase 4: `curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $SUPABASE_PUBLISHABLE_KEY"`, expecting `disable_signup` true and the email provider on.

The "Deferred" item "Sign-up page" is marked done. The end-to-end verification items at `:337-338`, "`/dashboard` renders" and the sign-up refusal through the app's route, follow the new pages (plan review F5). Historical records stay as written.

#### 3. Foundation docs

**Files**: `context/foundation/prd.md`, `context/foundation/roadmap.md`, `context/foundation/test-plan.md`, `context/foundation/test-stack.md`, `README.md`

**Intent**: Record the decisions where readers look for them.

**Contract**:

- **`prd.md`:**
  - Open Question 1 answered with a dated update note: sign-in redirect with a return path to the list or product.
  - An FR-001 update note on the mechanism: dashboard accounts, owner-made invite and recovery links, no email, 24 hours.
- **`roadmap.md`:** the S-07 block's notes on what was built.
- **`test-plan.md`:**
  - Risk #4's evidence is the read-only check.
  - §6.3: the setup signs in through the Polish form.
- **`test-stack.md`:** the setup lines.
- **`README.md`:** the auth routes table and smoke's variables.

### Success Criteria:

#### Automated Verification:

- Prettier passes on every changed Markdown file, and `npm run lint` is clean
- CLAUDE.md's course block is byte-identical (sha256 before and after)
- CI (`ci`, `smoke`, `e2e`) is green on the final commit
- No current doc still describes `/auth/signup`, `/auth/confirm-email` or `/dashboard` as live, outside archives and dated history: grep over `CLAUDE.md`, `README.md`, `context/foundation/` and `context/deployment/`

#### Manual Verification:

- Before handing out the first link, the owner sets production's Email OTP Expiration (86400) and Email OTP Length (10) in the dashboard
- After the merge, the owner's read-only check on production shows `disable_signup` true and the email provider on
- After the merge, the owner's phone check on production:
  - Polish sign-in;
  - a return to a product after signing in;
  - "Wylogowano." after sign-out;
  - optionally, one invite or recovery link end to end with a short-lived secret key

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- **`returnPathOf` and `returnPathFor`:**
  - every accepted form;
  - every rejection: other origins, protocol-relative and backslash paths, encoded slashes, other paths, non-UUID ids, unknown filters, `repin`/`retry`/`q`/notice parameters, hashes, non-text fields.
- **`signInHref`:** with and without `next`, and the encoding.
- **`authErrorCodeOf`:** each Supabase code and status, `validation_failed` among them, unknown errors, and errors without a code, judged by code and status only.
- **`linkSessionOf`:**
  - an `otp` entry just made, and one exactly 60 minutes old;
  - one 61 minutes old;
  - a `password` session;
  - a missing, empty or odd `amr`;
  - several entries.
- **The three form schemas at their boundaries:**
  - email trimming;
  - the sign-in password: 72 characters against 73;
  - the set-password password, counted in UTF-8 bytes: 8 against 7, and 72 against 73, with 36 "ą" (72 bytes) passing and 37 failing (plan review F3);
  - 56 hex against 55 or 57, and uppercase;
  - each `type`.
- **The notice parsers:** every known code, and null for an unknown one, `toString` and `__proto__`.

### Integration Tests:

- **Smoke over HTTP on the workerd preview:**
  - the redirects of `/`, gated pages and API routes;
  - the return path, accepted and refused;
  - the codes;
  - the origin refusals;
  - sign-out;
  - the removed pages' 404s;
  - the confirm and set-password contracts.

  None of these uses a secret key or asks a shop.

- **The e2e setup** signs in through the Polish form on a phone viewport on every run. Every spec depends on it.
- **The four database checks** run unchanged on local sign-up.

### Manual Testing Steps:

1. `/dev/auth` in both themes at 390 px and 1280 px: every sign-in, confirm and set-password state.
2. The return path in a browser: a visitor's product with `?f=check&repin=natura` lands back on the product with `f` only.
3. The local invite and recovery flows with the owner script and the local secret key in the command's environment only.
4. Production, by the owner: the two dashboard settings, the read-only check, and the phone check.

## Performance Considerations

- `/` adds one redirect for a direct visit.
- Signing in from a product page adds one redirect hop back to it.
- The middleware's `getUser()` per request is unchanged.
- The confirm route makes one Auth call (`/verify`) per button press.
- The set-password page and route each check the session with `getClaims()`, which costs one `/user` call with HS256 tokens. The route then makes one update (`/user`).
- Requests from the Worker share Supabase's per-IP buckets (research §6); with a handful of users that is accepted.

## Migration Notes

- No database migration. Existing sessions and accounts are unaffected.
- **Production:** the owner changes two dashboard settings (Email OTP Expiration, Email OTP Length) before the first link is handed out. They affect only email OTPs, and the app sends none.
- **Local:** `config.toml`'s OTP settings need one stack restart (`npx supabase stop && npx supabase start`, keeping data, with the owner's OK). CI starts fresh.
- Bookmarks of `/auth/signup` or `/dashboard` get the 404 page.
- **Rollback:** reverting the merge restores the starter pages. Production sign-up stays refused regardless, because that's a dashboard setting.

## Implementation Notes

### Phase 1

- **The `bg-cosmic` comment (§1, criterion 1.7).** `src/styles/global.css` isn't in the phase's files, but the comment above `bg-cosmic` named `/` and `/dashboard`, which criterion 1.7's grep would have found under `src`. That comment now names only the sign-in page. The utility itself stays until Phase 2 removes it.
- **Playwright's readiness probe (§2).** Playwright's `webServer.url` check follows redirects, so it judges readiness on `/auth/signin`, which answers even without Supabase. It doesn't take the 302 itself, as the contract put it. The new comment in `playwright.config.ts` says so. CI's `curl -sf` (no `-L`) does accept the 302. No behaviour changed.
- **Smoke's steps (§3):**
  - The `/dashboard` 404 step replaced the anonymous redirect step, which also proves `/dashboard` left `PROTECTED_ROUTES`: a gated path would answer 302.
  - The signed-in "dashboard renders" step was dropped, not turned into a second 404.
  - After sign-out, `/watchlist` redirecting to sign-in replaces the old dashboard step.
  - The `POST /api/auth/signup` 404 step posts the smoke user's own email and password, as the old step did.
- **Smoke's Auth sign-up (§3).** It runs after the local-only guard, before any step, and prints one PASS/FAIL line. On a failure it prints Auth's status with its error code, never the key or a token, and exits 1.
- **Follow-up, not this change:** smoke's local-only guard means `npm run smoke` can't target a hosted project. So test-plan rollout Phase 4's signed-out production smoke will need its own entry point or flag. The deploy plan (`context/deployment/deploy-plan.md:56`) already says smoke can't run against production.
- **Roadmap.** S-07 went to `in-progress` on entry, and `/10x-plan`'s earlier `planning` flip lands in the same commit.
- **1.8 was agent-run, at the owner's standing request** (headless Chromium at 390 × 844 with touch, on the local production preview, with a throwaway local user):
  - signed out, `/` landed on `/auth/signin`, which has no sign-up link or text;
  - after the form sign-in, a signed-in `/` landed on `/watchlist`;
  - the phone account menu's "Wyloguj" ended on `/auth/signin`, after which `/watchlist` redirected to sign-in;
  - screenshots were read back.

## References

- Research: `context/changes/invite-only-access/research.md`
- Roadmap S-07 and its carry-overs: `context/foundation/roadmap.md:193-213`
- PRD FR-001, FR-002, Access Control, Open Question 1: `context/foundation/prd.md`
- Validated redirect target pattern: `listRefreshBackOf` in `src/lib/services/price-refresh.ts`
- Code-to-text notices pattern: `src/lib/notices.ts`, `matchErrorMessage` in `src/lib/services/matches.ts`
- Progressive enhancement pattern: `src/components/SubmitOnce.astro`, `src/components/shell/ThemeToggle.astro`
- Kitchen sink pattern: `src/dev/watchlist.astro`, `astro.config.mjs:8-22`
- Shop cost table: `context/archive/2026-10-02-hebe-in-comparison/plan.md`
- Supabase sources: research §1 (Auth v2.197.0 `admin.go`, `mail.go`, `verify.go`, `user.go`; docs on email templates, passwords, users, rate limits)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: No self-registration, no starter pages

#### Automated

- [x] 1.1 Unit tests pass: `npm run test`
- [x] 1.2 Lint and types pass: `npm run lint` and `npx astro check`
- [x] 1.3 The build passes, fonts included: `npm run build`
- [x] 1.4 Smoke passes against the local production preview
- [x] 1.5 The database checks pass unchanged (three locally, the shop-gate check in CI)
- [x] 1.6 The e2e suite passes: `npx playwright test`
- [x] 1.7 No reference to the removed pages remains in src, tests or scripts, smoke's 404 steps aside

#### Manual

- [x] 1.8 In a browser at 390 px, `/` lands on sign-in without a "Sign up" link when signed out, on the list when signed in, and sign-out ends on sign-in

### Phase 2: Polish sign-in with a return path

#### Automated

- [ ] 2.1 The new unit tests pass (return path, auth service, sign-in link, notices)
- [ ] 2.2 All unit tests, lint and types pass
- [ ] 2.3 The token contrast check passes
- [ ] 2.4 The build passes
- [ ] 2.5 Smoke passes with the return-path, code, origin and sign-out steps
- [ ] 2.6 The e2e suite passes, its setup signing in through the Polish form
- [ ] 2.7 Break-checks turn the return-path and exact-error steps red

#### Manual

- [ ] 2.8 `/dev/auth` sign-in states in light and dark at 390 px and 1280 px
- [ ] 2.9 In a browser at 390 px, the return path, the session link, the Polish error, "Wylogowano." and the form without JavaScript

### Phase 3: Invite and recovery links

#### Automated

- [ ] 3.1 The auth service and notices unit tests pass
- [ ] 3.2 All unit tests, lint, types and contrast pass
- [ ] 3.3 The build passes
- [ ] 3.4 Smoke passes with the confirm and set-password steps
- [ ] 3.5 The e2e suite passes
- [ ] 3.6 The owner script refuses each bad input without a request
- [ ] 3.7 Break-checks: verifying a malformed token, and skipping the link-session check, turn their smoke steps red

#### Manual

- [ ] 3.8 After the local restart, the auth container shows the 24-hour, 10-digit OTP settings
- [ ] 3.9 The local invite flow end to end at 390 px, the link surviving GETs
- [ ] 3.10 The local recovery flow, the Polish error for a used or unknown link, and a password session kept off set-password
- [ ] 3.11 `/dev/auth` confirm and set-password states in light and dark at 390 px and 1280 px

### Phase 4: Docs and rollout

#### Automated

- [ ] 4.1 Prettier passes on every changed Markdown file, and `npm run lint` is clean
- [ ] 4.2 CLAUDE.md's course block is byte-identical (sha256 before and after)
- [ ] 4.3 CI (`ci`, `smoke`, `e2e`) is green on the final commit
- [ ] 4.4 No current doc still describes `/auth/signup`, `/auth/confirm-email` or `/dashboard` as live

#### Manual

- [ ] 4.5 The owner sets production's Email OTP Expiration and Email OTP Length before the first link
- [ ] 4.6 After the merge, the owner's read-only check shows sign-up refused and the email provider on
- [ ] 4.7 After the merge, the owner's phone check on production
