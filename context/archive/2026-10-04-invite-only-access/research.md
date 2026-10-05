---
date: 2026-10-04T20:38:11+02:00
researcher: Claude (claude-opus-5-5)
git_commit: b20ed7d14c6ba4cd18dd8e478e36d7b3cd078e47
branch: feat/invite-only-access
repository: yaroslavkhudchenko/10xcourseproject
topic: "S-07 invite-only-access: owner-created accounts or invite links with no email sent, no self-registration, a Polish sign-in page with a return path, the starter pages replaced, and the tests that sign users up"
tags: [research, codebase, auth, supabase, invite-only, sign-in, middleware, return-path, e2e, smoke, design-tokens]
status: complete
last_updated: 2026-10-04
last_updated_by: Claude (claude-opus-5-5)
---

# Research: S-07 invite-only front door

**Date**: 2026-10-04T20:38:11+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: b20ed7d14c6ba4cd18dd8e478e36d7b3cd078e47
**Branch**: feat/invite-only-access
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

Roadmap S-07 `invite-only-access` (PRD FR-001, FR-002; `context/foundation/roadmap.md:193-213`) asks what it takes for a user to sign in with an account the owner created, or with an invite link the owner handed out, with no email sent by the app, while nobody can register themselves.

The question includes the slice's three carry-overs:

- the return path and language of the sign-in page (product-page-ui, charge C5; `roadmap.md:204-206`);
- the pages still pinned to the dark theme (etykiety-redesign; `roadmap.md:207-209`);
- the e2e setup and local sign-up (testing-critical-browser-flows; `roadmap.md:210-212`).

## Summary

- **Owner-created accounts already work, with no app code.**
  - The owner created their own account this way on production, with sign-up off: Authentication → Users → Add user → Create new user, with "Auto Confirm User" ticked (`context/deployment/deploy-plan.md:123-126`).
  - No email is sent on that path. Studio's create modal says "A confirmation email will not be sent when creating a user via this form", and Auth's admin create sends none ([admin.go](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go#L400)).
  - In Auth v2.197.0, the "Signups not allowed" check sits in the public sign-up handler ([signup.go L115-116](https://github.com/supabase/auth/blob/v2.197.0/internal/api/signup.go#L115)) and on the anonymous and OAuth paths, not on the admin paths.
  - Limit: Studio's user update sends only `ban_duration` ([user-update-mutation.ts](https://github.com/supabase/supabase/blob/master/apps/studio/data/auth/user-update-mutation.ts)), so the dashboard can't set a new password for an existing user. That needs the admin API.
- **Invite links are feasible without email and without a server key in the Worker, but no document defines them.**
  - The owner would run the admin `generateLink({ type: "invite" })` from their own machine, with a secret key.
  - The owner hands over an app link built from the returned `hashed_token`: `/auth/confirm?token_hash=…&type=invite`.
  - The app verifies it with `verifyOtp({ token_hash, type })` on a POST. The publishable key is enough for that.
  - The app then asks for a password with `updateUser({ password })`.
  - The same flow with `type: "recovery"` covers a forgotten password with no email.
  - Today no document says how a link is produced, stored or redeemed. `prd.md:82` and `roadmap.md:195` name the link; `deploy-plan.md:308` calls it "the owner-invite path".
  - The project has so far kept every secret key out of its code and tests (`deploy-plan.md:128`; `test-plan.md:46`).
- **Self-registration is refused by production, but the starter's sign-up surface is still in the app.**
  - Production refused a sign-up after the setting was saved (`deploy-plan.md:219`).
  - In code these remain, linked from three places:
    - the page `src/pages/auth/signup.astro`;
    - the route `src/pages/api/auth/signup.ts`;
    - the form `src/components/auth/SignUpForm.tsx`;
    - the "check your email" page `src/pages/auth/confirm-email.astro`.
  - The three links are at `src/pages/auth/signin.astro:17`, `src/components/Topbar.astro:27` and `src/components/Welcome.astro:36-39`.
  - The sign-up route is also how `scripts/smoke.mjs:77-81` creates its user.
- **In the inspected repo, every test and script user comes from public sign-up.**
  - There are 5 direct supabase-js `auth.signUp` call sites:
    - `tests/e2e/auth.setup.ts:39`;
    - `scripts/check-shop-gate-db.mjs:37-41`;
    - `scripts/check-watchlist-db.mjs:35-38`;
    - `scripts/check-matches-db.mjs:37-40`;
    - `scripts/check-prices-db.mjs:40-43`.
  - The 6th path is smoke's post to the app's sign-up route.
  - A grep of ts, tsx, mjs, js, astro, yml, json, toml, md and sql files found no admin API use, no secret key and no SQL into `auth.users`.
  - Refusing sign-up locally would stop all four database checks and the e2e setup. In the CI smoke job it would also stop smoke's signed-in steps.
- **Today's front door is the starter's.**
  - The five pages `/`, `/dashboard` and the three `/auth/*` pages are English and pinned dark with `bg-cosmic`.
  - The sign-in route passes Supabase's English message through `?error=` (`src/pages/api/auth/signin.ts:16`), so a crafted link can put words on the page.
  - Nothing keeps a return path:
    - the middleware redirects to `/auth/signin` with none (`src/middleware.ts:25`);
    - a successful sign-in lands on `/watchlist`, whatever the user was opening (`signin.ts:19`);
    - the island's "Zaloguj się ponownie" link carries none (`src/components/watchlist/PriceComparisonView.tsx:80`).
  - Sign-out lands on the starter's `/` (`src/pages/api/auth/signout.ts:9`).
- **A return path lands as the user's own navigation.**
  - `isOwnNavigation` (`src/lib/services/search-query.ts:19-26`) accepts any non-prefetch request whose `Sec-Fetch-Site` is `same-origin`, `none` or absent.
  - So the redirect after a sign-in form post would count as the user's own navigation. That is an inference from Fetch Metadata: the whole redirect chain is same-origin.
  - It means a crafted `next` such as `/watchlist/<id>?repin=natura` could make the product page look a shop up once, after the user signs in.
  - The plan should limit what `next` may carry and state its cost (`context/foundation/lessons.md:12-17`).

## Detailed Findings

### 1. What Supabase offers for FR-001

All Auth source links are to tag v2.197.0. The local stack runs `public.ecr.aws/supabase/gotrue:v2.197.0` (`docker ps`, 2026-10-04). The hosted project's Auth version is unknown.

**Dashboard accounts (works today):**

- "Add user → Create new user" posts `{email, password, email_confirm}`, with "Auto confirm user?" on by default. Sources: [CreateUserModal.tsx](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Auth/Users/CreateUserModal.tsx), [user-create-mutation.ts](https://github.com/supabase/supabase/blob/master/apps/studio/data/auth/user-create-mutation.ts).
- Without auto-confirm, password sign-in answers `email_not_confirmed` ([token.go L182](https://github.com/supabase/auth/blob/v2.197.0/internal/api/token.go#L182)). `deploy-plan.md:126` records the same.
- Since Auth v2.197.0, admin-created users must pass the project's password policy ([admin.go L451](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go#L451)).
- "Send invitation" in the dashboard sends an email through Auth's `/invite`, so FR-001 rules it out. The built-in SMTP also delivers only to the project's team, at 2 per hour ([auth-smtp](https://supabase.com/docs/guides/auth/auth-smtp)).

**Admin API (needs a secret key; none in the repo):**

- "Any method under the `supabase.auth.admin` namespace requires a `secret` key" ([admin-api](https://supabase.com/docs/reference/javascript/admin-api)).
  - That means the new `sb_secret_…` key or the legacy `service_role` JWT.
  - A secret key refuses browser requests (HTTP 401, judged by User-Agent) ([api-keys](https://supabase.com/docs/guides/getting-started/api-keys)).
- In the v2.197.0 and v2.196.0 sources, neither `createUser` nor `generateLink` checks `DisableSignup` or the email provider setting ([mail.go L52-317](https://github.com/supabase/auth/blob/v2.197.0/internal/api/mail.go#L52)). They weren't exercised against any project in this research.
- `generateLink` sends no email and returns the user plus these `properties`:
  - `action_link`
  - `email_otp`
  - `hashed_token`
  - `verification_type`
  - `redirect_to`

  supabase-js's description is "Generates email links and OTPs to be sent via a custom email provider" ([GoTrueAdminApi.ts](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueAdminApi.ts)).

- Link types ([mail.go](https://github.com/supabase/auth/blob/v2.197.0/internal/api/mail.go)):
  - `invite` creates an unconfirmed user with no password. For an email that's already confirmed it answers 422 `email_exists`.
  - `recovery` answers 404 `user_not_found` for an unknown email.
  - `magiclink` turns into `signup` for an unknown email, so the returned `verification_type` is the one to use.
  - A new link replaces the previous token of its type ([one_time_token.go L135](https://github.com/supabase/auth/blob/v2.197.0/internal/models/one_time_token.go#L135)).
- The owner can run it locally:
  - It's a Node script with `createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } })`, or curl to `/auth/v1/admin/…`.
  - The Supabase CLI has no user or link command, checked against the v2.119.0 command list.
  - The Management API has no auth-user endpoints.

**Verifying a handed-over link on the server:**

- The pattern the docs give for server-side verification:
  - A link `token_hash=…&type=invite` goes to a server endpoint, which calls `verifyOtp({ token_hash, type })` ([email templates, "Redirecting the user to a server-side endpoint"](https://supabase.com/docs/guides/auth/auth-email-templates)).
  - The docs include an Astro `src/pages/auth/confirm.ts` example ([passwords](https://supabase.com/docs/guides/auth/passwords)).
  - With `token_hash`, Auth takes only that and the type ([verify.go L85](https://github.com/supabase/auth/blob/v2.197.0/internal/api/verify.go#L85)).
  - The session comes back in the response body, and @supabase/ssr writes the cookies through the client's `setAll`. In this app that is `src/lib/supabase.ts:18-26`, so the call must use `locals.supabase` (`CLAUDE.md`, Request lifecycle).
- Generating the link sends no email. Prefetches and link previews can consume a link opened by GET: the docs warn about prefetched links being "consumed instantly". So the docs advise a page with a button, which here means verifying on the POST, not the GET (same email-templates page).
- Opening `action_link` directly doesn't fit this app:
  - Admin tokens carry no `pkce_` prefix, so GET `/verify` uses the implicit flow and redirects to `redirect_to#access_token=…` ([verify.go L135](https://github.com/supabase/auth/blob/v2.197.0/internal/api/verify.go#L135); [tokens/service.go L149](https://github.com/supabase/auth/blob/v2.197.0/internal/tokens/service.go#L149)).
  - A server can't read the URL fragment.
  - The app's `@supabase/ssr` 0.12.7 client (`package.json`) defaults to the PKCE flow.
- When an invite is verified, Auth gives the user a random password and expects the app to show a password form ([verify.go L318](https://github.com/supabase/auth/blob/v2.197.0/internal/api/verify.go#L318)).
- `updateUser({ password })` right after verification passes both optional guards ([user.go L150-205](https://github.com/supabase/auth/blob/v2.197.0/internal/api/user.go#L150)):
  - "Require reauthentication when changing password" (CLI `secure_password_change`, `supabase/config.toml:213`, false locally) applies only to sessions older than 24 hours.
  - "Require current password" (Auth v2.187.0+) skips OTP, magic-link and recovery sessions, and `verifyOtp` issues one of those.
- Password rules:
  - The minimum length is `minimum_password_length`: 6 locally (`supabase/config.toml:177`) and 6 in `SignUpForm.tsx:8`. The docs call fewer than 8 characters "not recommended".
  - The maximum is 72.
  - The errors are `weak_password` and `same_password`.
  - A successful change clears the user's other one-time tokens and signs out their other sessions ([models/user.go L435](https://github.com/supabase/auth/blob/v2.197.0/internal/models/user.go#L435)).
- Link lifetime:
  - It is "Email OTP Expiration" (`mailer_otp_exp`; CLI `[auth.email] otp_expiry`, 3600 locally at `supabase/config.toml:219`), counted from generation.
  - The docs give 1 hour as the default ([users](https://supabase.com/docs/guides/auth/users#inviting-users)), a supabase-js note says 24 hours, and Auth falls back to 86400 when unset. The production value is unknown.
  - A link is single use.
  - An expired, used or unknown link answers 403 `otp_expired`, "Email link is invalid or has expired" ([verify.go L665/L693](https://github.com/supabase/auth/blob/v2.197.0/internal/api/verify.go#L665)).
- URL settings:
  - Verifying the app's own link with `verifyOtp` involves neither the Site URL nor the Redirect URLs allow-list.
  - Both apply only to `action_link` and its `redirectTo` ([request.go L75-115](https://github.com/supabase/auth/blob/v2.197.0/internal/utilities/request.go#L75)).
  - Locally `site_url` is `http://127.0.0.1:3000` (`supabase/config.toml:156`) while the app runs on 4321. That would matter only for `action_link`.

**The Before User Created hook (an alternative, not recommended by the evidence):**

- It can reject a sign-up, for example one without a valid invite code ([before-user-created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)).
  - It is on the Free and Pro plans, and works in the CLI through `[auth.hook.before_user_created]`, commented out at `supabase/config.toml:263-266`.
  - It doesn't fire for `admin.createUser`.
- It needs public sign-up switched on, which makes the hook the only gate.
- For an email that already exists, sign-up answers `user_already_exists` before the hook runs ([signup.go L294](https://github.com/supabase/auth/blob/v2.197.0/internal/api/signup.go#L294)), which reveals accounts.
- With confirmations on it sends email.
- Marking a code as used isn't atomic with creating the user ([hooks.go L116](https://github.com/supabase/auth/blob/v2.197.0/internal/api/hooks.go#L116)).
- The dashboard labels hooks "BETA".
- Keeping sign-up off answers `signup_disabled` to every address.

### 2. The front door in code today

- **Pages.** Five pages pass `theme="dark"` to `Layout` and paint `bg-cosmic`, and none passes `lang`, so `<html lang="en">` (`src/layouts/Layout.astro:19`):
  - `src/pages/auth/signin.astro:8-9`
  - `src/pages/auth/signup.astro:8-9`
  - `src/pages/auth/confirm-email.astro:21-22`
  - `src/pages/index.astro:6`, through `src/components/Welcome.astro:5`
  - `src/pages/dashboard.astro:7-8`
- **Sign-in page.** It is English ("Sign in", "Don't have an account? Sign up", `signin.astro:15-20`) and renders `SignInForm` with `client:load` (`:14`). It reads `?error=` and passes it to the form (`:5`, `:14`).
- **"Check your email" page.** `confirm-email.astro:13-18` says a confirmation email was sent outside dev, against FR-001. With production refusing sign-up, it can be reached there only by its URL.
- **Islands and their pieces.** `SignInForm.tsx` and `SignUpForm.tsx` are plain POST forms enhanced by React. Their pieces keep literal colours:
  - `FormField.tsx:6`, `:53`: its own `focus:ring-2`;
  - `PasswordToggle.tsx:14`: aria-labels "Hide password" / "Show password";
  - `ServerError.tsx:11`: literal red, no `role="alert"`;
  - `SubmitButton.tsx:15-20`: a purple button kept "until S-07 restyles them".
- **No Input component.** `src/components/ui/` has only `alert`, `badge`, `button` and `card`.
- **Routes.**
  - `signin.ts` and `signup.ts` cast `form.get(...) as string`, with no zod, and don't guard `formData()` (`signin.ts:4-6`).
  - With no client configured they answer an English literal (`:11`). On failure they pass Supabase's message (`:16`).
  - `CLAUDE.md` (API routes) records that the auth routes predate the rule of redirecting with codes the page maps to its own text. The rule came from S-01's review F7 (`context/archive/2026-09-27-watchlist-add-by-search/reviews/impl-review.md:135-145`).
- **Middleware.**
  - `PROTECTED_ROUTES` is `["/dashboard", "/watchlist", "/api/watchlist"]`, matched by `startsWith` (`src/middleware.ts:5`, `:23`).
  - An unauthenticated request to those paths is redirected to `/auth/signin` with no return path (`:25`).
  - With Supabase configured, `getUser()` runs on every request that reaches the Worker (`:14-21`).
  - A signed-in user opening `/auth/*` or `/` gets the page, with no redirect away.
  - Signed-in responses get `Cache-Control: private, no-store` (`:31-33`). By the code, signed-out responses get no Cache-Control header from the app, unless auth cookies changed in that request; this wasn't observed.
- **Sign-out.**
  - The redesigned UI posts to `/api/auth/signout` from `src/components/shell/AppHeader.astro:50-54` (desktop) and `src/components/shell/AccountMenu.astro:37-41` (phone list).
  - The route lands on `/` (`signout.ts:9`), the starter's English landing.
- **Landing and demo.**
  - `/` shows the "10x Astro Starter" hero, with "Sign In" and "Sign Up" buttons (`Welcome.astro:29-40`) and `Topbar.astro` (English and Polish mixed).
  - `/dashboard` is a demo page that nothing links to.
- **Lint guards.**
  - None of the auth pages or components is in `tokenConfig`'s `files` (`eslint.config.js:173-182`), which refuses palette classes and arbitrary colours. None is in `islandConfig` (`:89-155`) either.
  - A restyled view joins `tokenConfig` (`CLAUDE.md`, UI).

### 3. How tests and scripts create users

| Path                                         | Mechanism                                 | Credential                        | With local sign-up refused                          |
| -------------------------------------------- | ----------------------------------------- | --------------------------------- | --------------------------------------------------- |
| `tests/e2e/auth.setup.ts:31-43`              | `auth.signUp` and its session             | `SUPABASE_KEY` (anon/publishable) | Fails at `:40`, so the `phone` project doesn't run. |
| `scripts/check-shop-gate-db.mjs:37-42`       | `auth.signUp`, 1 user                     | same                              | `process.exit(1)` at `:42`                          |
| `scripts/check-watchlist-db.mjs:35-46`       | `signUpUser`, 2 users                     | same                              | `exit(1)` at `:46`                                  |
| `scripts/check-matches-db.mjs:37-44, 91-93`  | `signUpUser`, 2 users                     | same                              | `exit(1)` at `:93`                                  |
| `scripts/check-prices-db.mjs:40-47, 116-118` | `signUpUser`, 2 users                     | same                              | `exit(1)` at `:118`                                 |
| `scripts/smoke.mjs:77-81`                    | Form post to the app's `/api/auth/signup` | the preview's own config          | Its signed-in steps fail.                           |

- **The e2e setup's dependencies on the sign-in page** (`tests/e2e/auth.setup.ts:60-71`):
  - the URL `/auth/signin`;
  - `waitForIsland(page, "SignInForm")`, which matches the island's component name (`tests/e2e/support/islands.ts:8-15`);
  - `getByLabel("Email")` and `getByLabel("Password", { exact: true })`;
  - the button "Sign in";
  - a 302 whose `Location` is exactly `/watchlist`.

  The setup's tokens go to the seeding helpers through `run.json` and `setSession` (`tests/e2e/support/watchlist-data.ts:60-63`). So any replacement for sign-up must still return a session, for example via `signInWithPassword`.

- **Two lookalike switches.** `[auth] enable_signup` (`supabase/config.toml:171`) becomes `GOTRUE_DISABLE_SIGNUP`. `[auth.email] enable_signup` (`:206`) becomes `GOTRUE_EXTERNAL_EMAIL_ENABLED`, the whole email provider ([CLI v2.117.0 gotrue.service.ts L404/L413](https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/commands/start/services/gotrue.service.ts#L404)). To mirror production, only `:171` goes false. If `:206` goes false too, password sign-in is refused as well. Production keeps the Email provider on for the same reason (`deploy-plan.md:123`).
- **Applying a config change.** It needs `supabase stop && supabase start`, which keeps local data ([getting-started](https://supabase.com/docs/guides/local-development/cli/getting-started)). Only `db reset` deletes the owner's local users (`CLAUDE.md`, Commands).
- **Keys in CI.** CI reads only `API_URL` and `ANON_KEY` from `supabase status -o env` (`.github/workflows/ci.yml:43`, `:91`). The same output also carries `SERVICE_ROLE_KEY` and `SECRET_KEY` in CLI 2.117.0. Those names were checked locally with the values stripped.
- **Local ways to create users without public sign-up**, none of them in the repo today:
  - the admin `createUser({ email, password, email_confirm: true })` with the local secret key, then `signInWithPassword`;
  - SQL through the existing superuser channel `docker exec … psql -U postgres` (`scripts/e2e-local-db.mjs:102-123`). This is untested: it couples to Auth's schema and needs an `auth.identities` row.
  - local Studio, by hand (excluded in CI).
- **Policy that touches a key-based helper.**
  - `test-plan.md:46` lists "a service-role key in tests" as an anti-pattern for risk #4. That row is about privacy assertions made with row-level security bypassed.
  - The archived e2e plan chose "no service-role key and no API path" (`context/archive/2026-10-02-testing-critical-browser-flows/plan.md:193`).
  - So a create-only helper is a separate decision the plan must make explicitly.
- **Keys and the build.** The build copies `.dev.vars` into `dist/server/` (`CLAUDE.md`, Commands), and `astro.config.mjs:64-69` declares only `SUPABASE_URL` and `SUPABASE_KEY`. A secret key must stay out of `.env` and `.dev.vars`.
- **Rate limit.** `sign_in_sign_ups = 30` per 5 minutes per IP locally (`supabase/config.toml:192`). The e2e plan budgeted sign-ins against it (`auth.setup.ts:53-55`).

### 4. A return path after sign-in

- The C5 evidence: a signed-out or expired visit to a product ends on the English form, then on the list (`context/archive/2026-09-29-product-page-ui/research.md:140-151`).
- Three places drop the path:
  - the middleware (`src/middleware.ts:25`);
  - the sign-in route (`signin.ts:19`);
  - the island's link (`PriceComparisonView.tsx:80`). The island detects an ended session from a redirect or a non-JSON answer, not from the sign-in URL (`src/components/watchlist/price-comparison-state.ts:711`, `:727-737`).
- The repo already validates redirect targets this way:
  - `listRefreshBackOf` accepts a `back` that is a product's UUID, and anything else refreshes nothing (`src/lib/services/price-refresh.ts`; `context/archive/2026-09-30-etykiety-redesign/reviews/impl-review.md:132-143`).
  - The lesson "Keep decision logic in tested services" puts such a validator under `src/lib/services/` with unit tests (`context/foundation/lessons.md:26-31`).
- Own navigation:
  - The landing after sign-in passes `isOwnNavigation` (`src/lib/services/search-query.ts:19-26`) whenever `Sec-Fetch-Site` is `same-origin`, `none` or absent.
  - So the target page runs its own-navigation lookups (`decideMatchStep`, `autoRefreshOf` in `src/lib/services/match-step.ts`).
  - A target carrying `repin=<shop>` or `retry=<shop>` would look that shop up.
  - Per `lessons.md:12-17` the plan must state the cost of the landing.
- Existing assertions a return path would touch:
  - `scripts/smoke.mjs:67-76` matches `Location` by prefix, so `/auth/signin?next=…` still passes;
  - `smoke.mjs:87-91` expects `/watchlist` for a sign-in with no `next`;
  - `auth.setup.ts:71` expects exactly `/watchlist`.

### 5. The pages pinned to the dark theme

- **What the carry-over asks** (`roadmap.md:207-209`): restyle on the new tokens, drop the pin, and pad the safe-area insets.
  - `Layout.astro:26` sets `viewport-fit=cover` on every page rendered through `Layout`.
  - Of the layouts, only `src/layouts/WatchlistShell.astro:56`, `:61` pads the insets. The product page's bottom bar pads its own (`src/components/watchlist/RefreshBar.tsx:30`), and the five pinned pages pad none.
- **Pin leftovers:**
  - `bg-cosmic` at `src/styles/global.css:397-407`, with a comment naming S-07;
  - `FormField.tsx`'s own ring (`context/archive/2026-09-30-etykiety-redesign/reviews/impl-review.md:153`);
  - `SubmitButton.tsx:15-20`.
- **Design handoff.** The archived etykiety handoff draws no sign-in screen. Its scope is the header, "Moja lista" and "Produkt" (`context/archive/2026-09-30-etykiety-redesign/handoff/README.md:7`). Its tokens still apply:
  - the paper `bg-paper`;
  - the 2 px `--input` border;
  - the hard-shadow primary button;
  - the 2 px `--ring`;
  - 44 px targets;
  - forms that work without JavaScript (`handoff/README.md:31-37`, `:144`).
- **Nearest drawn field.** The search field: 52 px, radius 16, `border-2 border-input bg-card` (`src/components/shell/SearchForm.astro`).
- **Polish vocabulary already in the app:**
  - "Wyloguj" (`AccountMenu.astro:39`);
  - "Konto: <email>" (`AccountMenu.astro:26`);
  - "Sesja wygasła. … Zaloguj się ponownie" (`PriceComparisonView.tsx:78-81`).

### 6. Security notes

- **CSRF.** Astro's `checkOrigin` is the auth form posts' CSRF defence: `src/pages/api/auth/*.ts` checks no origin itself. It is on by default, and `astro.config.mjs` doesn't override it. No smoke step posts a foreign `Origin` to `/api/auth/*`. The watchlist routes have such steps (`scripts/smoke.mjs:97-107`).
- **Enumeration.** `signInWithPassword` answers the same 400 `invalid_credentials` for an unknown email, a user with no password and a wrong password ([token.go L71](https://github.com/supabase/auth/blob/v2.197.0/internal/api/token.go#L71)). It answers `user_banned` before checking the password (L120).
- **Rate limits.** By default Supabase rate-limits by client IP ([rate-limits](https://supabase.com/docs/guides/auth/rate-limits)). Requests from the deployed app come from the Worker, so every user shares the Worker's buckets.
  - Forwarding the user's IP (`Sb-Forwarded-For`) needs a secret key on the server.
  - With a handful of users, one person hammering the form could get everyone a 429 `over_request_rate_limit`. That is an inference; it hasn't been observed.
- **Invite link strength.** The link carries `hashed_token`, a hex SHA-224 of the email plus a 6-digit OTP ([crypto.go L45](https://github.com/supabase/auth/blob/v2.197.0/internal/crypto/crypto.go#L45)). Against someone who knows the email:
  - the link holds only through its expiry, single use and the per-IP limit on `/verify` (30 per 5 minutes per IP; `supabase/config.toml:194` locally, the hosted default per the docs);
  - `mailer_otp_length` can raise the OTP to 10 digits.
- **Previews.** Preview deploys stay off. For an invite-only app they would need Cloudflare Access and a Supabase project other than production (`context/foundation/infrastructure.md:76`, `:98`; `deploy-plan.md:65-68`, `:310`).

### 7. What the tests and docs pin today

- **`scripts/smoke.mjs` (28 steps)** asserts status, `Location` and `cache-control`. It reads no bodies or labels. Steps that S-07 touches:
  - `/` 200 (`:66`);
  - `/dashboard` redirects and renders (`:67`, `:172`, `:174`);
  - sign-up (`:77-81`);
  - wrong password gives `/auth/signin?error=` (`:82-86`);
  - sign-out lands on `/` (`:173`).
- **Readiness checks** wait on `/`: `ci.yml:69` uses `curl -sf`, which takes a redirect as success, and `playwright.config.ts:56-57`.
- **e2e conventions.**
  - Every spec starts signed in (`context/foundation/test-plan.md:121`).
  - The only browser project loads the stored session (`playwright.config.ts:49`), so a sign-in spec needs a signed-out override.
  - One test per file, titled after its risk (`test-plan.md:120`).
- **Risk #4, "a stranger creates an account"** (`test-plan.md:32`, `:37`, `:46`).
  - In the documents searched, its only proof is the one-off production curl of 2026-09-23 (`deploy-plan.md:204-219`).
  - The test plan asks for a read-only production auth-settings check, due in rollout Phase 4 (`test-plan.md:60`, `:99-100`).
  - Local tests can't catch it, because local sign-up is on (`context/archive/2026-10-02-testing-critical-browser-flows/research.md:227`).
- **Docs that describe the starter's sign-up or demo pages as live:**
  - `CLAUDE.md` (Commands: after `db reset`, "sign up again at `/auth/signup`"; Architecture: the pinned pages);
  - `README.md:131-148`, `:172-179`;
  - `context/foundation/test-plan.md:72`, `:121`;
  - `context/foundation/test-stack.md:14-15`;
  - `deploy-plan.md:56-57`, `:221`, `:337`.

## Code References

- `src/middleware.ts:5` - `PROTECTED_ROUTES`; `:25` - redirect to `/auth/signin` with no return path; `:31-33` - `no-store` for signed-in responses
- `src/pages/api/auth/signin.ts:4-6` - unguarded `formData()` and casts; `:16` - Supabase's message in `?error=`; `:19` - a successful sign-in lands on `/watchlist`
- `src/pages/api/auth/signup.ts:13-19` - public sign-up, then `/auth/confirm-email`
- `src/pages/api/auth/signout.ts:9` - lands on `/`
- `src/pages/auth/signin.astro:5-20` - English page, `?error=` read, "Sign up" link
- `src/pages/auth/confirm-email.astro:13-18` - says a confirmation email was sent
- `src/pages/index.astro`, `src/components/Welcome.astro`, `src/components/Topbar.astro` - starter landing
- `src/pages/dashboard.astro` - starter demo page
- `src/components/auth/{SignInForm,SignUpForm,FormField,PasswordToggle,ServerError,SubmitButton}.tsx` - starter form pieces
- `src/components/watchlist/PriceComparisonView.tsx:74-87` - the "Sesja wygasła" alert and its link
- `src/lib/services/search-query.ts:19-26` - `isOwnNavigation`
- `src/lib/supabase.ts:18-26` - cookies and cache headers written through `setAll`
- `src/layouts/Layout.astro:16-23`, `:26` - `theme` pin and `viewport-fit=cover`
- `src/styles/global.css:397-407` - `bg-cosmic`
- `eslint.config.js:173-182` - `tokenConfig` files; `:89-155` - `islandConfig`
- `supabase/config.toml:156-158`, `:171`, `:177`, `:192-194`, `:206`, `:211`, `:213`, `:219`, `:263-266` - auth settings
- `tests/e2e/auth.setup.ts:31-43`, `:60-71` - run user's sign-up and form sign-in
- `scripts/smoke.mjs:66-91`, `:172-174` - the steps S-07 touches
- `scripts/check-{shop-gate,watchlist,matches,prices}-db.mjs` - sign-ups listed in §3
- `scripts/e2e-local-db.mjs:102-123` - the local superuser channel
- `.github/workflows/ci.yml:42-43`, `:69`, `:90-91` - local Supabase start, keys read, readiness

## Architecture Insights

- **Owner actions stay outside the app.** The flat role model has no owner role (`context/foundation/prd.md`, Access Control; FR-014's note). By that model, creating accounts or links belongs to the dashboard, or to an owner-run script with a secret key on the owner's machine, rather than to an app page.
- **The app needs no secret key.** Verifying a link and setting a password run on the user's own session with the publishable key, so the "no server-only key" stance in `CLAUDE.md` (Data, accepted risks) holds.
- **One client per request.** The new routes (`/auth/confirm`, a set-password page) follow the middleware's single client in `locals.supabase`, so the auth cookies and cache headers reach their responses.
- **Error codes, not messages.** The newer route rule (codes mapped to the page's own text, zod, a guarded `formData()`) has `src/pages/api/watchlist.ts` and `src/lib/notices.ts` as reference patterns. The auth routes would be the last to adopt it.
- **Redirect targets go through a tested validator.** `listRefreshBackOf` is the model, and the lesson in `lessons.md:26-31` asks for unit tests.

## Historical Context (from prior changes)

- `context/archive/2026-09-29-product-page-ui/research.md:140-151`, `plan-brief.md:45` - C5 deferred the sign-in page's language and return path to S-07. Supported: all three places still drop the path (§4).
- `context/archive/2026-09-30-etykiety-redesign/plan.md:228-238`, `:1000`; `follow-ups/review-fixes.md:12-14` - five pages pinned dark until S-07; the purple `SubmitButton` kept; safe-area padding added to S-07. Supported by the current code (§2, §5).
- `context/archive/2026-10-02-testing-critical-browser-flows/plan.md:663-665`; `reviews/impl-review.md:73` - the setup's form sign-in fails against any hosted project only because the run user exists only locally, an "incidental" backstop S-07's changes could remove. The real guard is `assertLocalSupabase` (`playwright.config.ts:15`).
- `context/archive/2026-09-27-watchlist-add-by-search/reviews/impl-review.md:135-145` - F7: free text in `?error=` is content spoofing; codes adopted for new routes, auth routes left as they were.
- `context/deployment/deploy-plan.md:123-126`, `:204-219` - production sign-up off and the owner's dashboard account. Run 1 failed until the setting was saved. Run 2 refused.
- Historical claims checked:
  - `deploy-plan.md:221` and `:337` say sign-in lands on `/`. **Contradicted**: S-01 changed it to `/watchlist` (`signin.ts:19`).
  - `deploy-plan.md:56-57` cites `smoke.mjs:43` for the sign-up. **Partially stale**: the claim holds, but the line moved to `:77-81`.
  - `roadmap.md:203` says the risk is "Low". **Partial**: true for the auth service, which already refuses sign-up. The three carry-overs (`:204-212`) add a return path, a restyle of five pages, an e2e setup update and local user creation.
  - `roadmap.md:67-74` (baseline of 2026-09-25) says no test runner, no tables and smoke-only CI. **Stale**, as Vitest, four database checks and the e2e suite now exist.
  - `context/foundation/test-plan.md:75` says "e2e: none yet". **Contradicted** by `:57` (Phase 1 complete).
  - `roadmap.md:210-212` lists the e2e and the database checks as needing local sign-up. **Partial**: smoke needs it too (`smoke.mjs:77-81`), through the app's own route, which S-07 removes.

## Related Research

- `context/archive/2026-09-29-product-page-ui/research.md` - the session-ended link and C5.
- `context/archive/2026-10-02-testing-critical-browser-flows/research.md` - the e2e setup, the local auth budget, the superuser channel.
- `context/archive/2026-09-27-watchlist-add-by-search/research.md` - the original auth wiring and `no-store`.

## Open Questions

Decisions for `/10x-plan` (the owner's):

1. **Invite links in S-07, or accounts only?** FR-001 reads "create an account … or hand them an invite link".
   - **Accounts only:** the dashboard path, with no app code. A forgotten password then needs a new account or the admin API.
   - **Links:** an owner script with a secret key on the owner's machine, used for `invite` and `recovery`; `/auth/confirm` verifying on POST; a set-password page; and a decided link lifetime ("Email OTP Expiration" on production; its current value is unknown).
2. **Local test users.**
   - Keep local sign-up on, as today. Smoke would then sign up through Auth's own `/auth/v1/signup`, since the app's route goes.
   - Or mirror production (`[auth] enable_signup = false`) and create users with a create-only admin helper using the local secret key, which needs an explicit exception to `test-plan.md:46`.
   - Or create them by SQL through the superuser channel (untested).
3. **PRD Open Question 1.** The roadmap's default is a sign-in redirect (`roadmap.md:202`, `:247`); confirm it, with a return path. Also: which targets `next` may carry (for example only `/watchlist` and `/watchlist/<uuid>` with `f`, never `repin` or `retry`).
4. **Where `/` and sign-out land** once the starter landing and `/dashboard` go. Also whether a signed-in user opening `/auth/signin` is sent on.
5. **Password change for a signed-in user.** Neither the PRD nor the roadmap asks for it. It would need no secret key.
6. **The Polish copy** of the sign-in and set-password pages. Precedent: the plan proposes the text, and the owner rewords it (`context/archive/2026-09-30-etykiety-redesign/plan-brief.md:107`).
7. **A read-only production check** that sign-up is refused: Auth's `GET /auth/v1/settings` answers `disable_signup` (seen locally, not on production). Does S-07 add it to the deploy plan, or leave it to rollout Phase 4?

Facts not verified here:

- Production's Auth version and settings:
  - Email OTP Expiration and length;
  - "Require reauthentication when changing password";
  - "Require current password";
  - the minimum password length;
  - password-changed notifications, which would be a Supabase email.

  The owner can read them in the dashboard.

- That `createUser` and `generateLink` succeed with sign-up off. This comes from the source, not run; the owner's dashboard account is indirect evidence for `createUser`.
- Which bucket password sign-in counts against. The Auth source puts `/token` under the token limit (150 per 5 minutes per IP). The CLI's comment on `sign_in_sign_ups` (`supabase/config.toml:191-192`) says sign-ins share the 30, and the e2e plan budgeted that way.
- Which IP Supabase sees for requests from the Worker.
