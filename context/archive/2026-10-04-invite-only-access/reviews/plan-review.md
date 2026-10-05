<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Invite-only Front Door (S-07)

- **Plan**: context/changes/invite-only-access/plan.md
- **Mode**: Deep
- **Date**: 2026-10-04
- **Verdict**: REVISE → SOUND after triage (2026-10-04)
- **Findings**: 0 critical, 2 warnings, 4 observations
- **Triage**: all 6 fixed in the plan: F1 (Fix A), F2, F3, F4, F5, F6. Progress still matches (35 criteria, 35 rows, 4 phases).

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

Grounding: 14/14 paths ✓, 8/8 symbols ✓, brief↔plan ✓. The verification sub-agent read the installed `@supabase/auth-js` 2.116.0, `@supabase/ssr` 0.12.7 and zod 4.6.2, the Auth source at v2.197.0 and v2.196.0, the CLI source at v2.117.0, and Studio's source. No Auth call was run.

## Findings

### F1 — Set-password accepts any signed-in session

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3 (`/auth/set-password`)
- **Detail**:
  - The page and its route are guarded only by "signed in" (`PROTECTED_ROUTES`).
  - So a password session can set a new password without the current one. That is the change-password page the owner ruled out, and a stolen session cookie could use it to lock the owner out.
  - Auth (v2.197.0 and v2.196.0) marks a session from `verifyOtp` as amr `[{ method: "otp", timestamp }]` ([verify.go#L285](https://github.com/supabase/auth/blob/v2.197.0/internal/api/verify.go#L285)), and a password sign-in as `"password"` ([token.go#L195](https://github.com/supabase/auth/blob/v2.197.0/internal/api/token.go#L195)).
  - The amr never changes for the session's life: a refresh adds no claim.
  - The planned smoke step "signed in, 3 characters → `?error=invalid`" uses a password session.
- **Fix A ⭐ Recommended**: Allow both the page and the route only to a session whose verified amr holds `"otp"` with a timestamp under an hour old, read with `getClaims()`. This is a tested service; other sessions go to the list. The smoke step becomes "a password session can't set a password".
  - Strength: Keeps the owner's "no change-password page" decision and closes the stolen-session reset, using data Auth signs.
  - Tradeoff: With HS256 tokens, `getClaims()` makes one more Auth call (`/user`) per set-password request.
  - Confidence: HIGH — from Auth source at both versions; Phase 3's manual flow checks it at runtime.
  - Blind spot: Whether production signs tokens with HS256 or asymmetric keys only changes that cost.
- **Fix B**: Leave the page open to any signed-in user and record it as an unlinked change-password page.
  - Strength: No extra logic.
  - Tradeoff: Reverses the owner's call, and lets a session thief set a password without the current one.
  - Confidence: HIGH.
  - Blind spot: Production's "Require current password" is unknown. If it's on, the page fails confusingly for password sessions.
- **Decision**: FIXED (Fix A). Phase 3 §1 has `linkSessionOf(claims, now)`: amr `"otp"` no older than 60 minutes. Phase 3 §3 lets only such a session use the page and the route, through `getClaims()`, and sends any other to `/watchlist` before an update. Smoke's step became "a password session can't set a password". Criteria 3.7 and 3.10 cover it, and the Testing Strategy has its unit cases. Performance and the brief note the extra `/user` call with HS256.

### F2 — Criterion 1.7's grep can't pass

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, criterion 1.7
- **Detail**: The criterion greps `src`, `tests` and `scripts` for `/dashboard` and `auth/signup`. Phase 1's own smoke steps assert those paths answer 404 (`scripts/smoke.mjs`).
- **Fix**: Leave smoke's 404 steps out of the grep, and say so in the criterion.
- **Decision**: FIXED. Criterion 1.7's grep excludes `smoke.mjs`, and says smoke names the removed paths only in its 404 steps. Progress 1.7 says the same.

### F3 — The 72 limit counts bytes in Auth, characters in the app

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1 (`passwordFormSchema`)
- **Detail**:
  - Auth counts the minimum and the 72 maximum in UTF-8 bytes ([password.go](https://github.com/supabase/auth/blob/v2.197.0/internal/api/password.go#L31)). Over 72 bytes gets 400 `validation_failed`.
  - zod 4.6.2 counts code points.
  - So a Polish password of 72 characters or fewer can pass the app, then be mapped to "failed" instead of the length message.
- **Fix**: Count the 72 in UTF-8 bytes in the schema, map `validation_failed` to the length code, and add a unit case with Polish letters at the boundary.
- **Decision**: FIXED. Phase 3 §1: `passwordFormSchema` counts 8 to 72 UTF-8 bytes, and `validation_failed` maps to the length code. The Testing Strategy has the byte boundary cases (36 "ą" pass, 37 fail), and "What We're NOT Doing" names the unit.

### F4 — Sign-out's scope and failure path aren't decided

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §4 (sign-out)
- **Detail**:
  - `signOut()` defaults to scope `"global"`, which signs the user out on every device (`node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:3409`).
  - In one rare case it keeps the session and returns an error: an access token near expiry whose refresh fails retryably (`:3426-3428`).
  - The route ignores that error, so the page would still say "Wylogowano.".
- **Fix**: Call `signOut({ scope: "local" })` (this device only), and send a returned error to the list with an error notice instead of "Wylogowano.".
- **Decision**: FIXED. Phase 2 §4: sign-out calls `signOut({ scope: "local" })`. A returned error goes to `/watchlist` with a new list notice, "Nie udało się wylogować. Spróbuj ponownie." (Phase 2 §2), never "Wylogowano.". Phase 4's CLAUDE.md contract names the scope.

### F5 — Files the plan doesn't list still describe the starter

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phases 1, 2 and 4
- **Detail**: These go stale:
  - the "`/` answers 200" comments in `tests/e2e/seed.spec.ts:3-4` and `playwright.config.ts:54-55`;
  - `src/layouts/Layout.astro:11-19`: its `"dark"` pin, which nothing uses after Phase 2, and its "10x Astro Starter"/`en` defaults;
  - CLAUDE.md's list of routes that tolerate a missing Supabase, which lacks the new routes;
  - `deploy-plan.md:337-338`, the end-to-end verification items.
- **Fix**:
  - Phase 1: the two comments.
  - Phase 2: `Layout.astro` (drop the unused dark pin; default to Polish and "Drogeria Radar").
  - Phase 4: the route list and the verification items.
- **Decision**: FIXED. Phase 1 §2 updates the "`/` answers 200" comments in `seed.spec.ts` and `playwright.config.ts`. Phase 2 §5 drops `Layout.astro`'s unused dark pin and defaults it to Polish and "Drogeria Radar". Phase 4 adds the new routes to CLAUDE.md's null-client list and updates the deploy plan's end-to-end items.

### F6 — Two recorded unknowns are now settled

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §2; brief, Open Risks
- **Detail**:
  - Studio's source shows "Email OTP expiration" (0–86400 s) and "Email OTP length" (6–10) under Authentication → Sign In / Providers → Email ([AuthProvidersFormValidation.tsx](https://github.com/supabase/supabase/blob/4a5db160be9ef19f1a6569b850107e3e03149dbc/apps/studio/components/interfaces/Auth/AuthProvidersFormValidation.tsx#L80-L111)). The plan's values are the maximums.
  - CI runs Auth v2.196.0, the CLI's default image. Local runs v2.197.0 only through the gitignored `supabase/.temp/gotrue-version`. The plan's code paths are identical in both.
- **Fix**: Record both in the plan and the brief, and drop the "unconfirmed labels" risk.
- **Decision**: FIXED. Phase 4 §2 names the dashboard fields and their ranges. Critical Implementation Details records CI's Auth v2.196.0 against local v2.197.0. The brief drops the "unconfirmed labels" risk and records both facts.
