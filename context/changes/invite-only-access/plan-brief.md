# Invite-only Front Door (S-07) — Plan Brief

> Full plan: `context/changes/invite-only-access/plan.md`
> Research: `context/changes/invite-only-access/research.md`

## What & Why

S-07 makes Drogeria Radar's front door match its invite-only rule (PRD FR-001, FR-002):

- Nobody can register.
- The owner hands out access as a dashboard account or a link, with no email sent.
- People sign in on a Polish page that brings them back to what they were opening.

Today the starter's English, dark-pinned pages, its sign-up surface and its demo pages still stand in front of the redesigned app.

## Starting Point

- Production already refuses sign-up. But the app still has a sign-up page, route and form, a "check your email" page, a demo `/dashboard` and the starter's landing.
- Sign-in shows Supabase's raw message, keeps no return path, and is built from React islands with literal colours.
- Local tests create every user through local sign-up, five direct calls plus smoke via the app's route.

## Desired End State

Sign-up and the demo pages answer 404, and `/` forwards to the list or to sign-in.

Sign-in:

- is Polish, on the app's paper and tokens, and works without JavaScript;
- shows its own error texts;
- after a successful sign-in, returns to the list or to the product the person was opening;
- after sign-out, says "Wylogowano.".

The owner either:

- adds an account in the dashboard; or
- runs `scripts/owner-link.mjs` to print a 24-hour invite or recovery link. The person opens it, presses "Ustaw hasło", picks a password and lands on their list.

## Key Decisions Made

| Decision                      | Choice                                                                                      | Why (1 sentence)                                                                                                                 | Source          |
| ----------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| How the owner grants access   | Dashboard accounts plus owner-made invite and recovery links                                | Meets the roadmap's full outcome, people pick their own password, and a forgotten one is recovered without email or a lost list. | Plan            |
| Where the secret key lives    | Only on the owner's machine, while the script runs; a dedicated key, deleted after use      | The app verifies links with the publishable key, so the Worker and the repo never hold a key.                                    | Research + Plan |
| How a link is redeemed        | The app's own `/auth/confirm?token_hash=…&type=…`, checked on POST with `verifyOtp`         | Supabase's `action_link` uses the implicit flow the server can't read, and a GET would let link previews use it up.              | Research        |
| Link lifetime                 | 24 hours, 10-digit code (production dashboard + local `config.toml`)                        | A link sent by message is often opened the next day, and 10 digits keep it unguessable for that long.                            | Plan            |
| Local test users              | Keep local sign-up on; smoke signs up through Supabase's own endpoint                       | Smallest test change and no key in any test, as the archived e2e plan chose.                                                     | Plan            |
| Return path                   | `next` only `/watchlist` or `/watchlist/<id>` with `f`; anything else lands on `/watchlist` | Returns people to their product while a crafted link can't trigger a re-pin, retry or search lookup.                             | Research + Plan |
| `/` and sign-out              | `/` redirects; sign-out lands on sign-in with "Wylogowano."; demo pages deleted             | No extra page to design or keep in two themes.                                                                                   | Plan            |
| Password change               | Not in S-07; a recovery link covers it                                                      | Keeps the slice to the front door, and avoids production settings that would send email.                                         | Plan            |
| Proof that sign-up is refused | A read-only `GET /auth/v1/settings` check in the deploy plan                                | Replaces the one-off sign-up curl with a check that creates nothing, until rollout Phase 4 automates it.                         | Plan            |
| Form technology               | Plain Astro forms, with a script only for show/hide password                                | They work before and without JavaScript, and the e2e setup loses its hydration wait.                                             | Plan            |
| Who may set a password        | Only a session from a checked link (amr "otp"), under an hour old                           | Keeps "no change-password page" true, and a stolen session can't set a password without the old one.                             | Plan review F1  |
| Password length               | 8 to 72 UTF-8 bytes, Auth's own unit                                                        | A password of Polish letters gets the app's length text instead of a generic failure.                                            | Plan review F3  |
| Sign-out                      | This device only (`scope: "local"`); a failed sign-out says so on the list                  | Signing out on a shared computer leaves the phone signed in, and the page never claims a sign-out that didn't happen.            | Plan review F4  |

## Scope

**In scope:**

- Removing sign-up, the confirm-email page, `/dashboard` and the starter landing.
- `/` redirects.
- The Polish sign-in page and auth shell, with an Input copied from the shadcn registry, codes and zod.
- The return path, in the middleware, the sign-in route and the island's session link.
- The sign-out notice.
- The `/auth/confirm` and `/auth/set-password` pages and routes, and the owner script.
- Local OTP settings.
- A `/dev/auth` kitchen sink.
- Smoke and e2e setup updates.
- Docs, and the owner's production steps.

**Out of scope:**

- A change-password page.
- Any email.
- Any key in the app, CI or tests.
- Mirroring production's sign-up refusal locally.
- Auth hooks or invite codes.
- An admin screen.
- An invite e2e spec.
- An automated production check.
- A landing page.
- Returning to search, re-pin or retry views.
- IP forwarding to Supabase.

## Architecture / Approach

The pages read their parameters and the signed-in user, call tested services and render Astro views inside one `AuthShell` on the paper tokens.

The services:

- `return-path.ts` decides where a sign-in may return.
- `auth.ts` holds the zod schemas and maps Supabase's error codes to the app's.
- `notices.ts` holds the Polish texts.

The routes:

- They post to Supabase through the middleware's client only (`signInWithPassword`, `verifyOtp`, `updateUser`).
- They redirect with codes.

The owner's script talks to the Admin API from the owner's machine. Its only output is an app link, so the app never needs more than the publishable key.

## Phases at a Glance

| Phase                                     | What it delivers                                                                           | Key risk                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1. No self-registration, no starter pages | Sign-up and demo pages gone, `/` redirects, smoke signs up through Auth                    | Smoke needs the local Supabase values from `.env`                           |
| 2. Polish sign-in with a return path      | Tokenised Polish sign-in, codes, `next`, sign-out notice, `/dev/auth`, e2e setup moved     | The largest phase: page, route, middleware, restyle and tests together      |
| 3. Invite and recovery links              | `/auth/confirm`, `/auth/set-password`, `owner-link.mjs`, 24 h/10-digit links               | The link flow is checked only by hand, since a test would need a secret key |
| 4. Docs and rollout                       | CLAUDE.md, deploy-plan how-to, PRD/roadmap/test-plan notes; production settings and checks | The production settings and checks are manual steps for the owner           |

**Prerequisites:**

- Branch `feat/invite-only-access` from `main` `b20ed7d`.
- The local Supabase stack running.
- The owner's OK for one local stack restart in Phase 3.
- Dashboard access for Phase 4's two production settings.

**Estimated effort:** about 3–4 sessions across 4 phases. Phase 2 is the largest.

## Open Risks & Assumptions

- **Unknown production settings.** Production's Auth version and its password-change settings are unknown. The flow avoids them, because a fresh OTP session passes both guards (research §1).
- **Dashboard fields confirmed.** Studio's source shows "Email OTP expiration" (0–86400 s) and "Email OTP length" (6–10) under Sign In / Providers → Email. The plan's 86400 and 10 are their maximums (plan review F6).
- **Auth versions differ.** CI runs Auth v2.196.0 and the local stack v2.197.0. The plan's code paths are the same at both versions (plan review F6).
- **Not run against any project.** The admin `generateLink` with sign-up off is verified in Auth's source, not run. Phase 3's local check runs it first.
- **A shared rate-limit bucket.** Requests from the Worker share Supabase's per-IP limits, so heavy sign-in attempts by one person can slow everyone (accepted, with a Polish "Zbyt wiele prób" text).

## Success Criteria (Summary)

- No one can register: no page, link or route offers it, and production's setting is proven by a read-only check.
- The owner can give someone access without email: an account from the dashboard, or a 24-hour link that ends with them on their own list.
- People sign in in Polish on the app's look and land back on the list or product they were opening.
