---
change_id: testing-deploy-and-production-checks
title: Deploy and production checks (test plan rollout Phase 4)
status: implementing
created: 2026-10-06
updated: 2026-10-06
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "Deploy and production checks".
Risks covered: #2 (a deploy breaks production for everyone: code ships before its migration, a setting drifts, or code that passes in Node fails on Workers), #4 (another user's rows, or a stranger creating an account). Test types planned: smoke + gates.
Risk response intent:

- #2: a build that would break production fails before or at deploy: Workers-only breakage fails the CI preview, a PR whose migration isn't on production can't merge unnoticed, and after a deploy production answers, refuses sign-up and protects its pages. Challenge "a ticked Progress row means the migration is live". Avoid a check that needs production secrets in GitHub or writes to production, and a smoke that asserts only status 200.
- #4: production refuses sign-up, shown by a read-only production auth-settings check (`GET /auth/v1/settings` with the publishable key answers `"disable_signup":true` with the email provider on). Challenge "sign-up is off because the dashboard says so". Avoid a service-role key in tests.

Carried from the test plan (§6.6, S-07): smoke signs its user up through Auth and refuses any Supabase but the local stack, so `npm run smoke` can't be the signed-out production smoke: that check needs its own entry point or flag. Started 2026-10-06 at the owner's request ("Rollout Phase 4 now"), in its own worktree and PR, beside `match-by-name`.
