<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Invite-only Front Door (S-07)

- **Plan**: context/changes/invite-only-access/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

Phase 4's code and docs are committed (`34647a3`). Its three open rows, 4.5–4.7, are the owner's production steps around the merge, so they're acknowledged as pending.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

**Plan drift.** Every contract bullet of Phases 1–3 is implemented. Every adaptation is recorded in the plan's Implementation Notes, in the commit of its phase. Nothing from "What We're NOT Doing" appears:

- no secret key in `src`, `tests`, CI or the env files;
- no email API;
- no change-password page;
- no return path for `q`, `repin` or `retry`.

The Phase 4 docs agree with the code, except the sentences in F1 and F5. The CLAUDE.md course block is identical at `main`, HEAD and on disk (sha256 `bb541ab6…`).

**Safety.** These hold:

- The return path: absolute and protocol-relative URLs, `/\`, tabs, `%2F`, `..`, hashes, other parameters and non-UUID ids all fall back to `/watchlist`.
- `PROTECTED_ROUTES` matching can only over-match.
- CSRF: `checkOrigin` refuses `Origin: null` and a missing Origin too. `strict-origin` is the right policy for the confirm page.
- Who can set a password: `getClaims` verifies the token, the `amr` must hold a fresh `otp`, and the check runs before the form is read.
- No token or password goes into a redirect, the app's logs or a cache.
- The owner script never prints the key.
- No XSS: only constants and zod-checked values are rendered.
- No Auth message reaches a page, and no response tells an existing email from a missing one.
- Every `formData()` is guarded, and the null-client contract holds.
- No path asks a shop.

**Accepted, not findings:**

- The anonymous confirm route spends Auth's per-IP `/verify` budget, which every user shares through the Worker's address. The plan's Performance Considerations already accepts the shared per-IP buckets.
- "The link keeps working after its key is deleted" is stated from the design. The app verifies the link with its publishable key, and the token lives in Auth. The Phase 4 notes record that it wasn't run.

**Success criteria, re-run on HEAD (2026-10-05):**

| Check                                  | Result                                   |
| -------------------------------------- | ---------------------------------------- |
| `npm run test`                         | 1709 passed (the 4 scoped files: 428)    |
| Lint (untracked design folder ignored) | clean                                    |
| `astro check`                          | 0 errors                                 |
| Contrast                               | pass                                     |
| Build                                  | 6 fonts                                  |
| Phase 1 grep                           | empty                                    |
| Database checks                        | 17 / 40 / 36 PASS                        |
| Smoke                                  | 44 of 44                                 |
| e2e                                    | 9 passed, no shop asked                  |
| Owner-script refusals                  | 14 refused, 2 controls reach the request |
| Prettier on the Phase 4 docs           | pass                                     |
| CI on `92eb2ce`                        | `ci`, `smoke` and `e2e` green            |

Manual rows 1.8, 2.8–2.9 and 3.8–3.11 were agent-run at the owner's standing request, with evidence in the Implementation Notes. Rows 4.5–4.7 are pending owner steps.

## Findings

### F1 — Deploy plan: wrong moment for `email_exists`, and characters for bytes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/deployment/deploy-plan.md:334 (and :326)
- **Detail**:
  - `:334` says "Only once the person has set a password does an invite answer `email_exists`". In fact Auth confirms an invited account when the link is verified, i.e. when "Ustaw hasło" is pressed, and gives it a temporary password no one knows.
  - Checked on the local stack on 2026-10-05: after the invite the account was unconfirmed with no password; after the button, confirmed with a password; a second invite answered `email_exists`.
  - So someone who pressed the button but never saved a password can't sign in, and another invite fails. The owner needs a recovery link, which the how-to doesn't say.
  - `:326` says "8 to 72 characters", while the route counts UTF-8 bytes, so a Polish letter counts twice (CLAUDE.md says bytes).
- **Fix**: Reword `:334`. Once the person has pressed "Ustaw hasło", Auth counts the account as confirmed (with a temporary password no one knows), so another invite answers `email_exists`. Make a recovery link instead; it's also the way back for someone who pressed the button but never saved a password. At `:326`, note that the length is counted in bytes, so a Polish letter counts twice.
- **Decision**: FIXED — the how-to says Auth confirms the account at the button press (checked locally), names the recovery link for someone who never saved a password, and counts the length in bytes

### F2 — Workers Logs can keep an opened link's token

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: wrangler.jsonc:13-15; src/pages/api/auth/confirm.ts:8 (comment)
- **Detail**:
  - `observability.enabled: true` stores Workers Logs, whose invocation logs record each request's URL with its query; `wrangler tail` shows them live too.
  - So `GET /auth/confirm?token_hash=…&type=…` for a link that was opened but not yet used stays in the account's logs while the link is still valid: until the button is pressed, or 24 hours.
  - Only Cloudflare account members can read them. Today that's the owner, who makes the links anyway.
  - The confirm route's comment says the token goes into "no address and no log", which is true only of the app's own code. The plan's hygiene section didn't consider the platform's logs.
- **Fix A ⭐ Recommended**: Record it as an accepted risk in the deploy plan's "Accounts and links (S-07)", and narrow the code comment to "no log the app writes".
  - Strength: No operational change; the logs stay useful for errors and the shop gate's events, and only the owner can read them.
  - Tradeoff: An opened, unused link's token stays readable to account members for its lifetime.
  - Confidence: MED — from Cloudflare's documented invocation-log fields, not checked in this account's dashboard.
  - Blind spot: A future log export (Logpush) would carry the URLs elsewhere.
- **Fix B**: Turn stored invocation logs off (`observability.logs.invocation_logs: false`), keeping the app's own console logs.
  - Strength: No token in stored logs at all.
  - Tradeoff: Loses the per-request records (URLs, statuses) that help diagnose a deploy. A production config change the plan didn't include, deployed by the merge.
  - Confidence: MED — the option is in wrangler's current schema, by the reviewer's reading; untested here.
  - Blind spot: Whether any deploy-plan log step relies on invocation logs.
- **Decision**: FIXED via Fix A — accepted risk recorded in the deploy plan; the confirm route comment narrowed to logs the app writes

### F3 — The set-password page doesn't name the account

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/auth/SetPasswordView.astro:34-46; src/pages/auth/set-password.astro:13-21
- **Detail**:
  - Whoever presses a link's button is signed in as the link's account. A link forwarded, or sent to the wrong person, lets them set that account's password, and nothing on the page says whose account it is. Products they then add land on the other person's list. With a handful of users who know each other, the risk is low.
  - The same gap affects password managers: the form has a new-password field but no username. A saved password may then be stored without the email, and autofill on sign-in misses it.
- **Fix**: Show the account's email (`Astro.locals.user.email`) on the set-password page, as a read-only field labelled "E-mail" with `autocomplete="username"`, above the new password. The sink passes an example address.
- **Decision**: FIXED — a read-only "E-mail" field (autocomplete username, not posted) on the set-password page; sink updated

### F4 — The owner's secret key can land in shell history, or travel over plain http

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/deployment/deploy-plan.md:315-316; CLAUDE.md:43; scripts/owner-link.mjs:6-7, :105
- **Detail**:
  - The how-to, CLAUDE.md and the script's header write the key inline (`SUPABASE_SECRET_KEY=<…> node …`), so bash saves it in its history file. Step 4 (delete the key) makes that copy useless only if the owner does it.
  - The script also accepts an `http:` `SUPABASE_URL` for any host. A typo like `http://<ref>.supabase.co` would send the key in clear before any redirect.
- **Fix**: In the how-to, CLAUDE.md and the script's header, read the key without echo or history (`read -rs SUPABASE_SECRET_KEY && export SUPABASE_SECRET_KEY`, then `unset SUPABASE_SECRET_KEY` after). Make the script accept `http:` only for `localhost` and `127.0.0.1`.
- **Decision**: FIXED — `read -rs` in the how-to, CLAUDE.md and the script header; http only for localhost and 127.0.0.1 (SUPABASE_URL and APP_URL)

### F5 — Smoke doesn't pin two removed pages its docs say it pins

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: scripts/smoke.mjs:128, :190-195; CLAUDE.md:35; README.md:175; plan.md:741
- **Detail**:
  - The Desired End State says smoke pins every refusal it lists, and CLAUDE.md and README say smoke pins the removed pages' 404s. But smoke checks only `/dashboard` and `POST /api/auth/signup`, not `GET /auth/signup` or `GET /auth/confirm-email`; Phase 1 §3's step list didn't name them.
  - Deleting the files guarantees the 404s today, but nothing would catch one of those pages coming back.
  - Separately, the Phase 1 note says smoke's failed sign-up prints Auth's status with its code. Without a code it prints Auth's message instead (`smoke.mjs:38-43`). That's harmless: no key, no token.
- **Fix**: Add two smoke steps: `GET /auth/signup` and `GET /auth/confirm-email` answer 404. Amend the Phase 1 note's sentence.
- **Decision**: FIXED — two smoke 404 steps; the Phase 1 note corrected

### F6 — No anti-framing header, and session cookies readable by scripts (older than S-07)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:37-43; src/lib/supabase.ts:13-27
- **Detail**:
  - No response sets `X-Frame-Options` or `frame-ancestors`, so another site can frame the new sign-in, confirm and set-password forms (clickjacking).
  - The session cookies keep @supabase/ssr's default `httpOnly: false`, though the app never reads them in the browser (it has no browser client).
  - SameSite=Lax, and no XSS found, keep both low.
  - Both are app-wide and predate this change.
- **Fix A ⭐ Recommended**: Record both as a follow-up for an app-wide hardening change, with its own smoke and e2e checks.
  - Strength: Keeps S-07's merge scoped. The cookie flag affects every session and deserves its own test pass.
  - Tradeoff: The new forms stay frameable until then.
  - Confidence: HIGH — both are pre-existing and app-wide.
  - Blind spot: None significant.
- **Fix B**: Add `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` to every response in the middleware now, pinned by a smoke step. Leave the cookie flag to the follow-up.
  - Strength: Closes framing on the new forms before they go live.
  - Tradeoff: A late, app-wide header change in an auth PR, which needs the full gate run again.
  - Confidence: HIGH — one header set in the middleware's existing `responseHeaders` path.
  - Blind spot: Whether anything (the dev toolbar, a future embed) needs framing.
- **Decision**: FIXED via Fix A — follow-up recorded on the roadmap S-07 block and in follow-ups/review-fixes.md
