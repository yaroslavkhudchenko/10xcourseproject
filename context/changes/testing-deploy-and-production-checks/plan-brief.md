# Deploy and production checks — Plan Brief

> Full plan: `context/changes/testing-deploy-and-production-checks/plan.md`
> Research: `context/changes/testing-deploy-and-production-checks/research.md`

## What & Why

Rollout Phase 4 of the test plan covers two risks:

- **Risk #2:** a deploy breaks production for everyone.
- **Risk #4:** a stranger can sign up.

Today nothing stops code from shipping ahead of its migration, except the owner remembering `db push`, which failed once (S-01, PGRST205). Nothing checks production after a deploy except a curl the owner runs by hand, and nothing reports a failure. This plan makes every deploy refuse code whose migration production lacks, check production signed out right after it ships, and email the owner when either goes red.

## Starting Point

- **What CI covers:** CI's `smoke` and `e2e` jobs already run the production build on workerd, so Workers-only breakage on the rendered and auth paths fails a PR.
- **What it can't do:**
  - Workers Builds deploys each merge on its own, without waiting for GitHub's checks.
  - GitHub holds no secrets, so it can't see production's migrations.
  - Today's smoke can't be pointed at production: it signs a user up and refuses any non-local Supabase.

## Desired End State

Workers Builds deploys with `npm run deploy:checked`, which runs these steps in order:

1. It refuses unless its three Cloudflare build variables are set and safe.
2. It refuses unless production's `applied_migrations()` lists every repository migration.
3. It deploys.
4. It runs a signed-out check of production: redirects, refused routes, the Polish sign-in page with no configuration banner, one sign-in probe and Auth's `disable_signup`.

A `Deploy check` workflow on `main` fails when that build is red, so GitHub emails the owner. The same checks run in CI on every PR, against the local stack and the workerd preview.

## Key Decisions Made

| Decision                         | Choice                                                                                                      | Why (1 sentence)                                                                                      | Source          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------- |
| Where the migration gate sits    | At the deploy, in Workers Builds, before `wrangler deploy`                                                  | A gate in GitHub can't read production without a secret there, and the deploy doesn't wait for GitHub | Research / Plan |
| How it reads production          | A read-only function, `applied_migrations()`, that only `anon` may execute, called with the publishable key | No new token, testable in CI on the local stack; it reveals only versions already public in the repo  | Plan            |
| Where the post-deploy check runs | Workers Builds' deploy command, right after `wrangler deploy`; also by hand with `npm run check:production` | Runs after every deploy without anyone remembering, with its variables and logs in Cloudflare         | Plan            |
| One Auth call                    | Yes: one sign-in for `production-check@example.com`, expecting `?error=invalid`                             | The only signed-out way to catch a wrong or retired Worker key, which shows no banner                 | Plan            |
| On a failed check                | Red build; the owner decides, and the runbook names `wrangler rollback`                                     | No automatic action on a false alarm, and migrations never roll back                                  | Plan            |
| Missing build variables          | Refuse to deploy (fail closed)                                                                              | The gate can never be silently off; emergencies use the manual `npx wrangler deploy`                  | Plan            |
| Alert                            | A `Deploy check` workflow on `main` that fails when the commit's `Workers Builds` check is red              | GitHub emails the owner about a failed run; it reads only check runs, with no secret                  | Plan            |
| Between deploys                  | No scheduled checks                                                                                         | No new infrastructure; drift shows at the next deploy or a manual run                                 | Plan            |
| Manual runs against production   | None; the first run is Workers Builds' build after the merge, and no file holds production's values         | The owner's call: nothing about production stored on a machine                                        | Plan            |
| Test plan §2                     | Backport risk #2's correction now                                                                           | §2 and §5 agree in the same PR that moves the gate                                                    | Plan            |

## Scope

**In scope:**

- `scripts/check-production.mjs` (groups `pages`, `sign-in`, `settings`).
- `scripts/check-migrations-applied.mjs`, `scripts/deploy-checked.mjs` and `scripts/wait-for-deploy-check.mjs`.
- `scripts/hosted-env.mjs`, the URL and key helpers moved from `owner-link.mjs`.
- The `applied_migrations()` migration.
- Unit tests for the scripts' pure parts.
- CI runs, positive and negative, in the `smoke` job, and the `Deploy check` workflow.
- The deploy plan's runbook, `CLAUDE.md`, the test plan (§2, §4, §5, §6.5, §6.6), the README and `infrastructure.md`.
- The owner's one-time Cloudflare setup and its verification.

**Out of scope:**

- A pre-merge gate in GitHub, and any secret in GitHub.
- An automatic rollback, scheduled checks and a version marker.
- Any request that writes to production or reaches a shop.
- Two-user route tests (rollout Phase 2).
- Supabase's GitHub integration.

## Architecture / Approach

The checks live in dependency-free Node scripts that can reach a hosted project and refuse unsafe input before any request. Their pure parts are unit-tested, and their requests run in CI against the local stack and the workerd preview. `deploy-checked.mjs` chains the gate, `npx wrangler deploy`, a 10 s wait and the check, and Workers Builds runs it as its deploy command. Its variables are Cloudflare build secrets. A red build reaches GitHub as a red `Workers Builds` check, which the `Deploy check` workflow turns into a failed run, and GitHub then emails the owner.

## Phases at a Glance

| Phase                               | What it delivers                                                                               | Key risk                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1. The production check             | The signed-out check, its shared helpers, its CI runs (positive, and negative on open sign-up) | Expected values drift from the app's contracts; its steps are taken from smoke's, which CI keeps current |
| 2. The migration gate               | `applied_migrations()`, the gate's check, its CI runs                                          | `anon` gains one function: read-only, returning only public versions                                     |
| 3. The checked deploy and its alert | `npm run deploy:checked`, the `Deploy check` workflow                                          | A superseded build must pass, not alarm                                                                  |
| 4. Docs and rollout                 | The runbook and rules; the owner switches Workers Builds and verifies pass and fail            | Two Workers Builds behaviours are undocumented until this phase's checks                                 |

**Prerequisites:**

- The owner pushes this change's migration before the merge.
- After the merge, the owner sets the build variables and the deploy command.

**Estimated effort:** ~3 sessions across 4 phases, plus the owner's 15-minute Cloudflare setup.

## Open Risks & Assumptions

- **No run against production before the switch:** a step whose expected answer differs on production first shows as a red build, after which the owner can switch the deploy command back.
- **Undocumented in Workers Builds:** whether build variables reach the deploy command, and whether a failure after `wrangler deploy` turns the build red. Phase 4 verifies both, and the fail-closed refusal would show the first at once.
- **The check can't tell which version answered,** and runs 10 s after the deploy, so in that window it could meet the old version.
- **GitHub's email for a failed run** depends on the owner's notification settings for Actions.
- **The shop path on workerd** stays covered only by a Node unit test.

## Success Criteria (Summary)

- A merge whose migration isn't on production doesn't deploy, and the owner gets an email saying so.
- After every deploy, production is checked signed out: pages protected, sign-in working, sign-up refused. A failure turns red and emails.
- The same checks run in CI on every PR, so they're proven before they meet production.
