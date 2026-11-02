---
date: 2026-10-16T21:29:36+02:00
researcher: Claude (claude-opus-5-5)
git_commit: a319de6f40afbf1ecab26f6a551248405963e2b8
branch: feat/ci-cd-code-review
repository: yaroslavkhudchenko/10xcourseproject
topic: "ci-cd-code-review: an AI code review on every pull request to main, from Module 5's reviewer and CI templates: where the reviewer lives in this repo, how its action runs, how a review check fits the CI, the ruleset and the no-secrets rule, what this repo's diffs cost to review, what forks and the public repository change, how the lesson's reviewer and /10x-impl-review-ci compare here, and what promptfoo needs"
tags: [research, ci, github-actions, code-review, ai-sdk, openrouter, promptfoo, secrets, ruleset, tooling]
status: complete
last_updated: 2026-10-16
last_updated_by: Claude (claude-opus-5-5)
---

# Research: an AI code review on every pull request (ci-cd-code-review)

**Date**: 2026-10-16T21:29:36+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: a319de6f40afbf1ecab26f6a551248405963e2b8 (PR #57's head, the Module 5 fetch, on top of `main` at 79f1890)
**Branch**: feat/ci-cd-code-review
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

The change's requirements (`requirements.md`, the course's `m5l3-requirements`) ask for:

- a GitHub Actions workflow on every new pull request to `main`, with the review in a composite action;
- a reviewer that reads the pull request's title, description and diff and scores six criteria from 1 to 10;
- a binding `pass`/`fail` verdict that the merge gate reads, and a Markdown summary posted as a comment;
- the labels `ai-cr:passed` / `ai-cr:failed`, and a retry when `ai-cr:review` is added.

The templates to start from are:

- `.claude/config-templates/m5l2-review-schema.ts.template`;
- `m5l3-review.yml.template`, `m5l3-action.yml.template` and `m5l3-promptfooconfig.yaml.template`;
- the prompts `m5l2-agent`, `m5l3-cicd` and `m5l3-promptfoo`.

The alternative is the `/10x-impl-review-ci` skill.

The questions:

1. Where can the reviewer package (AI SDK 7, `@openrouter/ai-sdk-provider` 3, zod, Node 24) live without this repo's TypeScript, ESLint, Vitest, Prettier, lint-staged, the Claude Code hooks, the build or Workers Builds picking it up wrongly? How does the composite action get its `dist/review.js`?
2. How does a review workflow fit `ci.yml`, `deploy-check.yml`, the `preventFailedDeploy` ruleset and the rule that CI needs no repository secrets?
3. What does a pull request's diff look like here, and what does that mean for cost and for what the reviewer should see?
4. How do the public repository, fork pull requests and secrets interact?
5. What do the two paths (the lesson's reviewer through OpenRouter, or `/10x-impl-review-ci` with Claude Code Action) cost and break here?
6. What does promptfoo need?

The research chooses no design. The owner's choices are under Open Questions.

**Method.** Four read-only investigations ran in parallel:

1. tooling scope, with a scratch replica of the repo's configs;
2. the GitHub side, with GET-only API calls;
3. the diff profile and cost;
4. the libraries, promptfoo and the alternative skill.

Packages were installed only in a scratch folder. The decisive lines were then re-read directly. Nothing in the repository or its GitHub settings was changed, and no model was called.

## Summary

1. **Today CI has no secrets, labels or actions of its own.**
   - `.github/` holds two workflows: `ci.yml` (jobs `ci`, `smoke`, `e2e`) and `deploy-check.yml`.
   - The repository has 0 secrets, 0 variables, 0 environments, no `.github/actions/`, and none of the `ai-cr:*` labels (GitHub API, 2026-10-16).
   - The ruleset `preventFailedDeploy` (id 23934903) requires `ci`, `smoke` and `e2e` from GitHub Actions (app 15368). It asks for 0 approvals, has the strict up-to-date policy off, and has no bypass actors; the API answers `current_user_can_bypass: "never"` for the owner.
   - Every one of the 58 pull requests so far (#1–#58) was opened by the owner from this repository: 0 forks, 0 bot PRs.
2. **The lesson's workflow fits as one more job on `pull_request` to `main`, after four adaptations:**
   - it targets `master` (`m5l3-review.yml.template:10`);
   - it reads `secrets.LLM_PROVIDER_API_KEY` (`:44`), while the OpenRouter provider's default variable is `OPENROUTER_API_KEY`;
   - it creates only the `ai-cr:passed` / `ai-cr:failed` labels (`:57-58`), so `ai-cr:review` has to exist before anyone can add it;
   - it sets no timeout, so a hung model call holds the check for GitHub's default 360 minutes.
3. **Required or advisory is the gate's real decision.**
   - **Made required in the ruleset** (an admin-only edit): every merge waits for the key and the provider, and every merge is a production deploy. Nobody can bypass the ruleset. A job skipped by `if:` reports success, so an unrelated label event can produce a green `review` on a head whose review failed (inference from GitHub's docs, untested).
   - **Left advisory:** the ruleset stays as it is, and the comment and the label inform.
4. **`.github/actions/ai-reviewer/` is the in-repo location that needs the fewest config changes.**
   - TypeScript's `**/*` doesn't match a dot folder, so `astro check` skips it, and Vitest's include doesn't reach it.
   - ESLint 10 lints dot folders, so it needs one `globalIgnores` entry (`eslint.config.js:238`). Otherwise `npm run lint`, lint-staged's `eslint --fix` and the per-edit hook fail on its `.ts` files.
   - Tailwind scans the whole project root, so `src/styles/global.css:4-8` should get one more `@source not` line.
   - `tools/` and `scripts/` would each need a tsconfig exclude too, and `scripts/` also a Vitest exclude.
5. **The action's `dist/review.js` is git-ignored here** (`.gitignore:2` `dist/` matches `.github/actions/ai-reviewer/dist/review.js`). The options:
   - commit an esbuild bundle (1.43 MB, needing a `createRequire` banner) with a `.gitignore` negation;
   - build it in the workflow;
   - run the TypeScript directly with Node 24's type stripping (`node src/review.ts`).

   The last two need an `npm ci` inside the action folder on each run, measured at 6.7 s cold and 11 s warm locally.

6. **Diffs here are mostly documents.** Across the 56 merged PRs, the full diff is 131 KB at the median (about 33k tokens), 668 KB at p90 and 1.51 MB at the max (#44, about 430k tokens).
   - Leaving out `.claude/`, `context/`, the shop fixtures and recordings, and the lockfile, it is 27 KB at the median (about 7k tokens), 315 KB at p90 and 724 KB at the max.
   - CLAUDE.md's long lines make each of its 33 touches weigh 84–91 KB of diff.
   - 24 of the 56 PRs change no code.
   - No diff exceeds the 1M-token context of any model priced below.
7. **One review costs fractions of a cent to a few cents on OpenRouter's cheap models.** At about 76 PRs a month, reviewing every push stays under $5 a month on DeepSeek V4.1 Flash, GPT-5.6 Luna and GLM-5.3 at their cheapest endpoints. GLM-5.3 at Z.AI's own endpoint comes to $26.
   - Claude Sonnet 5.5 costs about $0.12 per median review, and Claude Opus 5.5 about $0.23.
   - `/10x-impl-review-ci`, an agentic Opus run of up to 60 turns with three subagents, was estimated at $2.6 to $20.6 per run with prompt caching. This is a model, not a measurement.
8. **`/10x-impl-review-ci` breaks here as shipped:**
   - it commits its report with `[skip ci]`, so `ci`, `smoke` and `e2e` never report on the PR's new head and the ruleset blocks the merge;
   - its pinned Claude Code Action needs `id-token: write`, which the template doesn't grant;
   - it sets up pnpm, while this repo uses npm;
   - it copies the skill from `origin/main`, where the skill isn't yet;
   - it writes `reviews/impl-review.md`, the path and verdict line of the local `/10x-impl-review`;
   - this repo's plans list commands that need Docker and a local Supabase, which it would score as failing.
9. **The libraries agree with the templates, with a few API changes:**
   - versions: `ai` 7.0.142 (Node ≥22, ESM only), `@openrouter/ai-sdk-provider` 3.1.0 (peers `ai ^7`, `zod ^3.25.76 || ^4.1.8`), zod 4.6.7. The repo has zod 4.6.2 as a transitive dependency (Astro's among others), and its code imports it as `astro/zod`.
   - structured output is `generateText` with `Output.object`; `generateObject` is deprecated.
   - `instructions` replaces `system`.
   - a schema violation throws and isn't retried.
   - the cost of a call comes in OpenRouter's provider metadata.
10. **promptfoo 0.124.1 is a local tool here.**
    - It needs Node ≥22.22 and `OPENROUTER_API_KEY`. It installs 690 packages (242 MB) with 7 high `npm audit` findings, and sends telemetry by default.
    - One run of the template's config costs about $0.04 to $0.25. The template evaluates a copy of the prompt, not the reviewer itself.
11. **A secret changes five documents.** `CLAUDE.md:68`, `README.md:106`, `deploy-plan.md:310` and `infrastructure.md:85` state that CI needs or holds no secrets, and `test-plan.md:193` says so of the `e2e` job.

## Detailed Findings

### 1. The repository's CI and GitHub settings today

**Workflows.**

- `ci.yml`:
  - runs on `push` to `main` and on `pull_request` to `main` with the default types (`.github/workflows/ci.yml:3-7`);
  - has jobs `ci` (`:10`), `smoke` (`:27`) and `e2e` (`:119`);
  - has no `permissions:` block, so the repository default `read` applies, and no `concurrency` or `timeout-minutes`;
  - reads no `secrets.*`; it writes the local Supabase stack's URL and anon key into `.env`/`.dev.vars`;
  - pins its actions by tag (`checkout@v4`, `setup-node@v4`, `supabase/setup-cli@v1`, `upload-artifact@v4`), not by commit SHA.
- `deploy-check.yml`:
  - runs on `push` to `main` and `workflow_dispatch`, with `checks: read` and `contents: read`, and job `deploy-check` with `timeout-minutes: 25`;
  - reads only Cloudflare's `Workers Builds: *` check runs (`scripts/wait-for-deploy-check.mjs:50-51`, `:208`), so a new PR check doesn't change it.
- No other workflow, no `.github/actions/`, no Dependabot or Renovate config and no CODEOWNERS (`GET /repos/{o}/{r}/actions/workflows` lists two).

**Ruleset.** `GET /repos/yaroslavkhudchenko/10xcourseproject/rulesets` returns one, `preventFailedDeploy`, id 23934903:

- **Scope:** target `~DEFAULT_BRANCH`, enforcement active.
- **Rules:** `deletion`, `non_fast_forward`, `pull_request` and `required_status_checks`.
- **`pull_request` rule:**
  - 0 required approvals, no required reviewers;
  - `require_extra_approval_for_unattributed_changes: true`, which GitHub documents as having no effect at 0 approvals;
  - merge, squash and rebase are all allowed.
- **Required checks:** `ci`, `smoke` and `e2e`, each with `integration_id: 15368` (GitHub Actions); `strict_required_status_checks_policy: false`.
- **Bypass:** `bypass_actors: []`, and `current_user_can_bypass: "never"`.

`GET .../branches/main/protection` answers 404, so there is no classic branch protection. Only an admin can add a required check: the owner is the only collaborator, as admin. The precedent is `e2e`, added through the API on 2026-10-02 eight minutes before its PR merged (`context/archive/2026-10-02-testing-critical-browser-flows/plan.md:815`). All 56 merges on `main`'s first-parent history are merge commits.

**Actions settings.**

- `default_workflow_permissions: read`, `can_approve_pull_request_reviews: false`, `allowed_actions: all`, `sha_pinning_required: false`.
- Fork PR approval is required for `first_time_contributors`.
- Secrets, Dependabot secrets, variables and environments: 0 each.
- Labels: 10, the 9 GitHub defaults plus `accessibility`. No PR has ever carried one.
- The repository is public, owned by a user account, `allow_forking: true`, `forks_count: 0`.

**Who opens PRs.** `gh pr list --state all --limit 60` returns PRs #1–#58 (56 merged, #57 and #58 open), all against `main`. All 58 were authored by the owner with `isCrossRepository: false`.

**Workers Builds** (app id 85455) posts its `Workers Builds: drogeria-radar` check on `main` commits. On PR #58's head its check suite stays queued with 0 runs. It "deploys every push to `main` whether or not GitHub Actions passed" (`context/deployment/deploy-plan.md:295`), so a required check guards the merge, and through it the deploy, but not a push the ruleset would refuse anyway.

### 2. The lesson's workflow in this repository, and the required-check question

**The template's shape** (`m5l3-review.yml.template`):

- **Trigger:** `pull_request` with `branches: [master]` (`:10`) and types opened, synchronize, reopened and labeled.
- **Permissions:** `contents: read`, `pull-requests: write`, `issues: write` (`:13-16`).
- **Concurrency:** a workflow-level group per PR with `cancel-in-progress` (`:18-20`).
- **The job:**
  - runs on any event but `labeled`, or on the label `ai-cr:review` (`:24`);
  - writes `git diff "origin/$BASE_REF...HEAD"` into a file (`:37`);
  - calls `./.github/actions/ai-reviewer` with `secrets.LLM_PROVIDER_API_KEY` (`:44`);
  - comments the summary and creates the passed and failed labels with `--force` (`:57-58`);
  - swaps the labels and removes `ai-cr:review`;
  - then fails unless the verdict is `pass`.

**Fitting it here:**

- **Branch:** `branches: [master]` never matches; every PR here targets `main`. As written, the workflow never runs, and a required `review` check would wait forever.
- **Secret:** the repository has none. The action passes the key as `LLM_PROVIDER_API_KEY` (`m5l3-action.yml.template:48`). The OpenRouter provider falls back to `OPENROUTER_API_KEY` (provider `dist/index.js:6228`), and promptfoo's template uses that name too. So the code has to read `LLM_PROVIDER_API_KEY` explicitly, or the names have to be aligned.
- **Retry label:** `ai-cr:review` is never created by the template, so it must exist before anyone adds it.
- **Timeout:** none is set, so GitHub's default of 360 minutes applies to a hung provider call.
- **Token:** with these permissions it can comment and label. It can't push or merge, and can't approve (`can_approve_pull_request_reviews: false`).
- **No loop:** labels added with `GITHUB_TOKEN` create no runs, so the template's own labelling doesn't trigger it again (GitHub, "GITHUB_TOKEN" concepts page).

**If `review` became a required check** (only the owner can add it):

- **Missing secret:** an action input marked `required: true` doesn't error when it's empty. The reviewer then fails with no verdict, the comment and gate steps are skipped (`:50`), and the job fails. Every PR is blocked until the secret exists or the ruleset is edited.
- **Provider down, rate-limited or slow:** the same; a retry is a re-run or the `ai-cr:review` label.
- **No way around it:** the ruleset has no bypass actors and every merge is the deploy path, so a hotfix waits too. CLAUDE.md allows a manual `wrangler deploy` only "from a clean `main`".
- **A skipped job counts as success.** GitHub: "A job that is skipped will report its status as 'Success'. It will not prevent a pull request from merging, even if it is a required check" (docs: control jobs with conditions).
  - With the workflow-level `cancel-in-progress` group, an unrelated label can cancel a running review and leave a skipped, green `review` on the same head SHA.
  - Which of two same-named check runs the ruleset then reads isn't documented; the Checks API defaults to the latest.
  - This is an inference, untested here.
- **Open PRs:** they wait for the status until a new event runs the workflow on them. The archive warns of this: "A required check that other open PRs never run would block them" (`context/archive/2026-10-02-testing-critical-browser-flows/plan.md:325`).
- **Stale base:** the strict policy is off, so a review of an older base stays valid after `main` moves.

**If `review` stays advisory**, the ruleset is unchanged. A red `review`, the `ai-cr:failed` label and the comment inform the owner, who merges (`CLAUDE.md:72`).

### 3. Where the reviewer package can live

These were tested on a scratch replica holding the repo's own config files and a sample package (the template's `review-schema.ts` and a `review.ts`), placed in each candidate location.

| Tool                               | (a) `.github/actions/ai-reviewer/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | (b) `tools/ai-reviewer/` + an action-only folder                                                                                                                                                                                    | (c) `scripts/ai-reviewer/`                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| TypeScript / `astro check`         | **Skipped.** TypeScript's wildcards don't match names starting with `.` (`node_modules/typescript/lib/typescript.js:22397-22401`, `:22469-22476`). In the replica, `tsc --listFilesOnly` and `astro check --noSync` listed no `.github` file.                                                                                                                                                                                                                                                                                                                                      | **Checked.** `**/*` (`tsconfig.json:3`) pulls it in, and `exclude: ["dist"]` is root-only (`:4`). Without the package's own install, `astro check` fails with TS2307 on `ai` and the provider. Needs an entry in `tsconfig.json:4`. | Same as (b).                                                                                                            |
| ESLint (`eslint .`)                | **Linted.** ESLint 10.10.0's only default ignores are `**/node_modules/` and `.git/` (`node_modules/eslint/lib/config/default-config.js:68`). Each `.ts` there gets the typed config and "was not found by the project service" (`eslint.config.js:20`). Needs an entry in `globalIgnores` (`:238`). This happened before: commit 5e23df6 added `.claude/` there after CI lint failed on the CLI's `.mjs` files.                                                                                                                                                                   | Linted with type information. Without the nested install, `no-unsafe-*` errors. Needs `:238` too.                                                                                                                                   | `.ts` files are linted as in (b); `.mjs` files fall under `scriptsConfig` (`:79`). Needs `:238`.                        |
| Vitest                             | Not picked up: the include is `src/**/*.test.ts` and `scripts/**/*.test.mjs` (`vitest.config.ts:11`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Not picked up.                                                                                                                                                                                                                      | **Picked up:** `scripts/ai-reviewer/**/*.test.mjs` would run in `npm run test`, CI and the Stop hook. Needs an exclude. |
| Prettier                           | `prettier --write .` formats `action.yml`, `package.json`, `tsconfig.json` and YAML there. Harmless, since CI runs no Prettier check. `dist/` is skipped through `.gitignore`.                                                                                                                                                                                                                                                                                                                                                                                                     | Same                                                                                                                                                                                                                                | Same                                                                                                                    |
| lint-staged (`package.json:63-70`) | A staged `.ts` gets `eslint --fix` and fails the commit, unless ESLint ignores the folder; for an ignored file ESLint warns and exits 0. `package.json` and the lockfile get `prettier --write`.                                                                                                                                                                                                                                                                                                                                                                                   | `no-unsafe-*` unless the deps are installed locally.                                                                                                                                                                                | Same as (b).                                                                                                            |
| Claude Code hooks                  | The per-edit hook lints an edited `.ts` there and reports the parse error unless ESLint ignores it. At end of turn, new untracked files under `.github/` don't count (`UNTRACKED_ROOTS`), tracked changes do.                                                                                                                                                                                                                                                                                                                                                                      | The end-of-turn `astro check` fails with TS2307 unless it's excluded or installed.                                                                                                                                                  | `scripts/` is in `UNTRACKED_ROOTS`, so new files trigger the checks at once.                                            |
| Build and Workers Builds           | Nothing from the folder is bundled or deployed: the Worker is Astro's server entry plus the build's `dist/` (`wrangler.jsonc:4`, `:8-12`). There are no npm `workspaces`, so the root `npm ci` and Workers Builds' install ignore a nested `package.json`. **Tailwind's Vite plugin scans the whole root**: in the replica, a fixture's `bg-red-500` became a class candidate. So add `@source not "../../.github/actions/ai-reviewer";` beside `src/styles/global.css:4-8`. Cloudflare's build watch paths default to `*`, so a reviewer-only merge still rebuilds and redeploys. | Same, with its own `@source not` line.                                                                                                                                                                                              | Same.                                                                                                                   |
| CI (`ci.yml`)                      | `npm run lint` (`:20`) fails until ESLint ignores the folder. `astro check` (`:23`), `npm run test` (`:24`) and the contrast check are unaffected.                                                                                                                                                                                                                                                                                                                                                                                                                                 | Lint and `astro check` fail unless the folder is excluded or installed first.                                                                                                                                                       | Lint, `astro check` and test fail likewise.                                                                             |

- **A separate repository (d)** changes no tooling here. The lesson describes it as the way "one agent can guard many repos", pinned to a SHA.
- **`$GITHUB_ACTION_PATH`** is the action's own folder. So the template's `node "$GITHUB_ACTION_PATH/dist/review.js"` (`m5l3-action.yml.template:55`) works only when the reviewer sits inside `.github/actions/ai-reviewer/`; (b) and (c) need a cross-folder build or another run line.
- **`.claude/` is no option**, although TypeScript, ESLint, Prettier and Tailwind already skip it (`tsconfig.json:4`, `eslint.config.js:238`, `.prettierignore:3`, `global.css:8`): the 10x CLI owns that folder and rewrites it.

### 4. How the action gets a runnable reviewer

`.gitignore:2` (`dist/`) matches `.github/actions/ai-reviewer/dist/review.js`, and `.gitignore:8` (`node_modules/`) matches a nested install (`git check-ignore -v --no-index`). The four options were measured with `ai@7.0.142`, `@openrouter/ai-sdk-provider@3.1.0` and `zod@4.6.7` in scratch:

- **(i) Commit a bundle.**
  - The template stays unchanged (no install step, `m5l3-action.yml.template:36-58`), as in GitHub's JavaScript-action tutorial.
  - esbuild (`--bundle --platform=node --format=esm --target=node24`) produced 1,432,945 bytes (799,540 minified) in 0.65 s.
  - A plain ESM bundle crashes with `Dynamic require of "path" is not supported`, from `@vercel/oidc` through `@ai-sdk/gateway`. A `createRequire` banner fixes it.
  - Committing the bundle needs `!/.github/actions/ai-reviewer/dist/` in `.gitignore` or a one-time `git add -f`. The negation also makes ESLint and Prettier see the bundle.
  - Costs:
    - source and bundle can drift, so a rebuild-and-compare check would bring an install back into CI;
    - a rebuilt bundle lands in the very diff the reviewer reads, unless it's filtered out or marked `-diff linguist-generated` in `.gitattributes`.
- **(ii) Build in the workflow:** `npm ci --prefix "$GITHUB_ACTION_PATH"` and a bundle step before "Run agent".
  - 14 packages; 6.7 s cold and 11 s warm locally, with the bundle under 1 s.
  - The template's `setup-node` step has no cache.
  - The nested lockfile had no `@emnapi`/`@napi-rs` entries, the cause of the root lockfile's `npm ci` incident (`context/deployment/deploy-plan.md:170-176`).
- **(iii) Node 24 type stripping:** `node src/review.ts`.
  - It's on by default since Node 23.6 and stable since 24.12 (https://nodejs.org/docs/latest-v24.x/api/typescript.html). The template's schema with the `ai` and provider imports ran with no flag on 24.21.0.
  - Refused on 24.21.0:
    - `enum`, parameter properties, runtime `namespace` and `import x = require()`;
    - relative imports without `.ts`, and `@/` aliases;
    - a type imported without `type`;
    - `.tsx` files, and `.ts` under `node_modules`.
  - It still needs `npm ci --omit=dev` (6.7 s cold, 26 MB). The package's own tsconfig would need `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions` with `noEmit`, and `"types": ["node"]`.
- **(iv) `npx tsx src/review.ts`:** runs the syntax and the `@/` paths that type stripping refuses, but needs the same install, and downloads tsx each run unless it's a dev dependency (6.0 s cold locally).

In all four, the root lockfile and Workers Builds stay untouched, as long as the reviewer is neither an npm workspace nor a root dependency.

### 5. What a pull request's diff looks like here

Each of the 56 merged PRs' diffs was measured as `git diff <merge>^1 <merge>`, which matched `git diff <merge>^1...<PR head>` byte for byte for all 56, with git's default rename detection.

| View                                                                                                | min     | median    | p90       | max               | PRs with 0 bytes |
| --------------------------------------------------------------------------------------------------- | ------- | --------- | --------- | ----------------- | ---------------- |
| (a) full diff                                                                                       | 1,803 B | 130,646 B | 667,804 B | 1,509,737 B (#44) | 0                |
| (b) without `.claude/`, `context/`, fixtures and recordings, lockfile                               | 0       | 27,096 B  | 315,396 B | 723,597 B (#23)   | 16               |
| (c) code only (`src/` without fixtures, `scripts/`, `tests/`, `supabase/`, `.github/`, root config) | 0       | 13,637 B  | 271,067 B | 660,399 B (#23)   | 24               |

**Where the bytes are** (14.71 MB over the 56 PRs):

| Path                           | Share | Notes                                            |
| ------------------------------ | ----- | ------------------------------------------------ |
| `context/` outside the archive | 33.4% |                                                  |
| `src/` without fixtures        | 28.7% | 1.93 MB of it test files                         |
| fixtures and recordings        | 12.2% | in 9 PRs                                         |
| `.claude/`                     | 10.0% | almost all in the three `chore/10x-module-*` PRs |
| root docs                      | 9.8%  | CLAUDE.md alone is 1.34 MB                       |
| `scripts/`                     | 2.7%  |                                                  |
| `package-lock.json`            | 13 KB | in 2 PRs                                         |

**What makes diffs large:**

- **CLAUDE.md** is 99 lines in 78 KB, with a longest line of 21.3 KB. Each of its 33 touches costs 84–91 KB of diff, because the three context lines around a hunk carry whole paragraphs.
- **Recorded shop answers** reach 208 KB per file. #44 committed the same recordings under `context/changes/…/recordings` and `src/…/fixtures`.
- **Binary files:** 32, all PNG screenshots under `context/changes` (#13, #15), each a 300-byte stanza.

**Which filter moves the numbers most:**

- **Leaving out `context/` outside the archive** brings the full median from 130.6k to 58.4k and p90 from 668k to 421k.
- **Leaving out CLAUDE.md** brings the (b) median from 27.1k to 16.2k.
- **Leaving out test files** brings (c) to a 7.4k median.
- **Turning rename detection off** would multiply the 17 archive and close PRs ×9.5. That's not a path filter, but the review workflow should keep git's default.

**Kinds of PR:**

- 17 `feat/`, at a 436 KB median (a);
- 17 `chore/archive-`/`close-`, at a 15 KB median, 11 of them without code;
- 7 `docs/`, with 97.5% `context/`;
- 3 `chore/10x-module-*`, with 97.8% `.claude/`.

31 of the 56 are mostly docs or context. 24 change no code.

**Tokens**, measured on all 14.7 MB (o200k_base through gpt-tokenizer; DeepSeek's and GLM's own `tokenizer.json`):

- the full diff: a 33.4k median, 158k at p90 and 429k at the max;
- (b): 7.1k, 86.5k and 200k;
- (c): 3.6k, 75.6k and 185k.

For Claude 5.5 the counts are estimates at about ×1.35 the legacy tokenizer (Anthropic says "about 30% more"), so 48.7k, 234k and 674k on (a), to ±25%. The content is 99.7% ASCII. A PR's title and body average 482 tokens (median), with a maximum of about 1.2k. **No diff exceeds the 1M-token context** of any model in the table below.

**Volume and pushes:**

- 58 PRs were opened in 23 days (about 76 a month) and 56 merged in 18 active days. That's the course-phase rate: the last week had 2.
- `pull_request` CI runs were 142 for the 56 PRs: a median of 1, a mean of 2.54 and a maximum of 8.
- The 21 PRs opened as drafts averaged 4.81 runs, the others 1.17.
- Skipping pushes while a PR is a draft leaves 63 runs, 1.13 per PR. Reviewing every push instead would multiply the full-diff bytes reviewed ×3.29.

### 6. Cost

**Prices.** These are from OpenRouter's `/api/v1/models`, fetched 2026-10-16, in USD per million tokens. OpenRouter adds no inference markup but charges 5.5% on card top-ups (https://openrouter.ai/docs/faq).

| Model id                                             | Context   | Input / output | Note                                                                                                                                                                      |
| ---------------------------------------------------- | --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `z-ai/glm-5.3` (the template's default)              | 1,048,576 | 0.079 / 4.80   | This headline is the cheapest of 46 endpoints (fp4). Z.AI's own endpoint charges 1.40 / 4.40.                                                                             |
| `deepseek/deepseek-v4.1-flash`                       | 1,048,576 | 0.036 / 0.6435 | DeepSeek's own endpoint: 0.15 / 0.60.                                                                                                                                     |
| `openai/gpt-5.6-luna`                                | 1,050,000 | 0.20 / 1.20    | 0.40 / 1.80 from 272k prompt tokens up. Its parameters list no `temperature`.                                                                                             |
| `anthropic/claude-sonnet-5.5` (the promptfoo grader) | 1,000,000 | 2 / 10         |                                                                                                                                                                           |
| `anthropic/claude-opus-5.5`                          | 1,000,000 | 4 / 20         | Anthropic's API names it `claude-opus-5-5`, as the impl-review template does. Its direct price is the same, per https://platform.claude.com/docs/en/about-claude/pricing. |

**One review**, assuming a 1.5k-token system prompt, the median PR body, the diff and 1.5k output tokens; brackets give the price at the provider's own endpoint:

| Model               | (a) median / p90 / max                              | (b) median / p90 / max      |
| ------------------- | --------------------------------------------------- | --------------------------- |
| GLM-5.3             | $0.010 / $0.020 / $0.042 [$0.057 / $0.232 / $0.627] | $0.0079 / $0.014 / $0.023   |
| DeepSeek V4.1 Flash | $0.0023 / $0.0069 / $0.017                          | $0.0013 / $0.0043 / $0.0085 |
| GPT-5.6 Luna        | $0.0089 / $0.034 / $0.175                           | $0.0036 / $0.019 / $0.042   |
| Claude Sonnet 5.5   | $0.117 / $0.488 / $1.37                             | $0.041 / $0.280 / $0.622    |
| Claude Opus 5.5     | $0.234 / $0.977 / $2.73                             | $0.082 / $0.561 / $1.24     |

**Per month** at 76 PRs, (a), reviewing every push:

| Model               | Monthly                |
| ------------------- | ---------------------- |
| GLM-5.3             | $2.79 ($26.23 at Z.AI) |
| DeepSeek V4.1 Flash | $0.84                  |
| GPT-5.6 Luna        | $4.41                  |
| Claude Sonnet 5.5   | $55.77                 |
| Claude Opus 5.5     | $111.54                |

Reviewing each PR once costs about a third of that. Reasoning tokens are billed as output and aren't in these figures. For the cheap models, the output is most of the cost: each extra 1k output tokens adds $0.0048 on GLM-5.3 and $0.00064 on DeepSeek.

**`/10x-impl-review-ci`** runs Claude Code Action with `--model claude-opus-5-5 --max-turns 60` (`workflow-template.yml:141-142`) and three subagents. Each turn re-sends the context, mostly as cache reads at $0.20 per million. The estimate is not measured: one real run's usage would settle it.

| Scenario               | Per run, with caching | Per run, without caching |
| ---------------------- | --------------------- | ------------------------ |
| Low                    | about $2.6            | about $12                |
| Central                | about $7.1            | about $47                |
| Heavy, at the turn cap | about $20.6           | about $160               |

Labelled on implementation PRs only, with draft pushes skipped (about 38 runs a month), that's about $100, $270 or $790 a month.

### 7. The public repository, fork pull requests and secrets

**Fork PRs.**

- On `pull_request` from a fork: "With the exception of GITHUB_TOKEN, secrets are not passed to the runner", and "The GITHUB_TOKEN has read-only permissions in pull requests from forked repositories". Dependabot PRs are treated as from a fork (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).
- An unset secret reads as an empty string.
- A first-time contributor's run waits for the owner's approval. The fork-secret policy offers no option for public repositories (`fork-pr-workflows-private-repos` answers 422).
- So a fork PR's review would fail for lack of a key, and its comment and label calls would be refused. There are 0 forks today.

**Same-repository PRs** run their own copy of the workflow and of a local action. A PR can therefore change the reviewer, or the job, that judges it, and read the key. Only accounts with write access can open such PRs: the owner, and agents using the owner's token. "Any user with write access to your repository has read access to all secrets configured in your repository" (https://docs.github.com/en/actions/reference/security/secure-use).

**`pull_request_target`** runs with the base's secrets and a write token. Checking out and building the PR head there allows code execution by the PR's author: the "pwn request" (https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/). The documented safe split is a `pull_request` workflow producing artifacts plus a privileged `workflow_run` workflow. It can't serve as a merge gate, though, since `workflow_run` checks aren't evaluated for required status checks (GitHub's troubleshooting page for required status checks).

**What goes to the provider:** the diff (public anyway), the PR title and body, and the system prompt.

- OpenRouter "does not store your prompts or responses, unless you opt in" (https://openrouter.ai/docs/guides/privacy/data-collection.md). Upstream providers keep their own policies.
- Per request, `provider.data_collection` defaults to `"allow"`; `"deny"` and `zdr: true` restrict routing (https://openrouter.ai/docs/guides/features/zdr.md).
- A secret value in a diff would reach the provider, but this public repository already rules committing one out (`CLAUDE.md:73`).

### 8. The two paths compared

**The lesson's reviewer** (M5L2 + M5L3):

- It reads only the title, the body and the diff, and returns the schema's six scores, `verdict` and `summary` (`m5l2-review-schema.ts.template:16-61`).
- The gate reads only `verdict` (`requirements.md`, "Verdict").
- It needs one OpenRouter key, the four adaptations of §2, a place to live (§3) and a way to run (§4).
- At the cheap models' prices in §6, its running cost is cents a month.

**`/10x-impl-review-ci`** reviews a PR against its `context/changes/<id>/plan.md`:

- **How it works:**
  - It runs Claude Code Action at SHA 1d6de8cb (v1.0.248) with `ANTHROPIC_API_KEY`.
  - Its token has `contents`, `pull-requests` and `statuses` write (`workflow-template.yml:52-57`).
  - It runs only on PRs labelled `impl-review` from this repository (`:47`).
  - It grades seven dimensions and derives APPROVED / NEEDS ATTENTION / REJECTED (`.claude/skills/10x-impl-review-ci/references/impl-review-instructions.md:99-115`).
  - Only REJECTED fails, unless the PR has `impl-review-override` (`workflow-template.yml:270-300`).
  - Without a plan in the PR's diff, or a `Plan:` line in the body, it comments "no plan" and passes (`SKILL.md:75-84`).
  - No mapping between its verdicts and the lesson's pass/fail is defined.
- **What breaks here:**
  - **The `[skip ci]` commit blocks merges.** It commits `chore(review): impl-review for <id> [skip ci]` as `claude[bot]` and refuses to push without the marker (`SKILL.md:248-265`). That commit becomes the PR's head. "Skip instructions only apply to the push and pull_request events", and a skipped required workflow's checks stay "Pending", so the "pull request … will be blocked from merging" (https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs). `ci`, `smoke` and `e2e` are required on the latest SHA. The next human push clears it, but while the label stays on, the review runs again and commits again.
  - **The action can't authenticate.** The pinned action authenticates through the Claude GitHub App with OIDC and needs `id-token: write`, which the template doesn't grant. It would fail with "Could not fetch an OIDC token" (claude-code-action `src/github/token.ts:56-66`, `docs/setup.md`). Whether the App is installed couldn't be read with the available token.
  - **Wrong package manager:** pnpm setup and `pnpm install --frozen-lockfile` (`workflow-template.yml:70-78`); this repo uses `npm ci` with `node-version-file: .nvmrc` (`ci.yml:14-18`).
  - **The skill isn't on `main`:** it's copied from `origin/<base>:.claude/skills/10x-impl-review-ci` (`:119-122`), which exists only on PR #57's branch so far.
  - **The token reaches production:** `contents: write` sits in Claude's environment with Bash allowed (`:129`, `:143`). It can push to PR branches and merge any PR whose three checks are green (0 approvals), which is a production deploy. A merge made with `GITHUB_TOKEN` starts no workflow run, so the Deploy check wouldn't run for it (inference).
  - **Path collision:** it writes `<plan dir>/reviews/impl-review.md` starting with `<!-- IMPL-REVIEW-REPORT -->` and stamps `change.md` `impl_reviewed` (`SKILL.md:170-176`). That's the local `/10x-impl-review`'s path, marker and status (`.claude/skills/10x-impl-review/SKILL.md:270`); 20 archived local reviews use it.
  - **Plans don't fit its shape:**
    - It expects ``- [ ] `cmd` `` checkboxes under Success Criteria (`impl-review-instructions.md:20-22`). This repo's plans use prose bullets under `#### Automated Verification:` and keep checkboxes in `## Progress` (e.g. `context/archive/2026-10-10-decision-store-backstop/plan.md:285-297`).
    - Their commands include `npm run test:db` and CI-only smoke and e2e items, which need Docker and a local Supabase. The skill would record them as failing tests, which leads to REJECTED (`impl-review-instructions.md:87, 108, 115`).
  - **Its own assumptions:** it expects "oxfmt --check" in CI (`SKILL.md:172`) and date-prefixed change slugs (`:62`); this repo's slugs aren't dated.

### 9. The libraries

**Versions** (npm registry, 2026-10-16):

| Package                       | Version        | Requirements and notes                                                                                               |
| ----------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ai`                          | 7.0.142        | Node ≥22, ESM only. Dist-tags `ai-v6` and `ai-v5` cover the older lines.                                             |
| `@openrouter/ai-sdk-provider` | 3.1.0          | Peers `ai ^7.0.0` and `zod ^3.25.76 \|\| ^4.1.8`. The 2.x line pairs with `ai@6`; a separate `6.0.0-alpha.1` exists. |
| `zod`                         | 4.6.7          | `z.toJSONSchema(schema, { target: "draft-07" })` exists (`zod/v4/core/to-json-schema.d.ts:25-29`).                   |
| `promptfoo`                   | 0.124.1        | Node ≥22.22.0.                                                                                                       |
| `tsx`                         | 4.23.15        |                                                                                                                      |
| `esbuild`                     | 0.28.2         |                                                                                                                      |
| `typescript`                  | 7.0.2 (latest) | The repo pins `^6.0.3`, so an unpinned install in a nested package would bring 7.x.                                  |

The repo's own zod is 4.6.2. It isn't in `package.json`; it comes with `astro@7.3.2` (`node_modules/astro/package.json:155`), `@astrojs/sitemap` and `eslint-plugin-react-hooks`. Across `src/`, `scripts/`, `tests/` and the config files, the code imports it only as `astro/zod`, which re-exports `zod/v4` (13 files, e.g. `src/lib/services/auth.ts:2`). The template imports `from "zod"` (`m5l2-review-schema.ts.template:5`).

**The AI SDK 7 API** (`ai@7.0.142/dist/index.d.ts`, https://ai-sdk.dev):

- **Structured output:** `generateText({ model, instructions, prompt, output: Output.object({ schema }) })`, reading the typed `result.output` (`:4107-4119`, `:5074-5080`). `generateObject`/`streamObject` are `@deprecated` (`:8570`, `:8993`). `system` is a deprecated fallback for `instructions` (v7 migration guide).
- **What a mock-model probe showed:**
  - The SDK converts the zod schema itself and sends a JSON-Schema `response_format`; the template's `REVIEW_JSON_SCHEMA` isn't used on this path.
  - A schema violation rejects with `AI_NoObjectGeneratedError` and is not retried: one model call, even with `maxRetries: 2`.
- **`ToolLoopAgent`:** `new ToolLoopAgent({ model, instructions, tools?, stopWhen?, output?, maxOutputTokens?, timeout?, … })` and `agent.generate({ prompt })`. Its default stop is `isStepCount(20)` (`:5549-5807`, `:5581`); `stepCountIs` is a kept alias. The `m5l2-agent` prompt plans the reviewer as a `ToolLoopAgent`.
- **Usage and cost:**
  - `result.usage` holds token counts and no cost (`:343-391`).
  - The OpenRouter provider adds `providerMetadata.openrouter.usage.cost` when OpenRouter's answer carries it (provider `dist/index.js:4518-4540`), read from `result.finalStep.providerMetadata` in v7.
  - OpenRouter now includes usage in every response (https://openrouter.ai/docs/cookbook/administration/usage-accounting.md).
- **Limits and failures:** `timeout` takes milliseconds or per-step limits (`:762-768`); `maxOutputTokens` maps to `max_tokens`. When retries run out, `maxRetries` (default 2) throws `RetryError`.
- **Gotcha:** a bare string model id resolves through the Vercel AI Gateway, not OpenRouter (`:107-115`).

**The OpenRouter provider 3:**

- **Construction:** `createOpenRouter({ apiKey?, … })`, falling back to `OPENROUTER_API_KEY`. `Output.object` becomes `response_format: {type: "json_schema", strict: true}` (`dist/index.js:4299-4310`).
- **Structured-output support differs per endpoint:**

  | Model                          | Endpoints that support it | Exceptions              |
  | ------------------------------ | ------------------------- | ----------------------- |
  | `z-ai/glm-5.3`                 | 35 of 46                  | Z.AI's own fp8 endpoint |
  | `deepseek/deepseek-v4.1-flash` | 27 of 35                  | DeepSeek's own endpoint |
  | `openai/gpt-5.6-luna`          | 7 of 7                    |                         |
  | `anthropic/claude-sonnet-5.5`  | 6 of 8                    |                         |

- **Routing:** `provider.require_parameters: true` is the documented way to route only to endpoints that support it. Its default, false, lets endpoints ignore unknown parameters (https://openrouter.ai/docs/guides/routing/provider-selection.md).

**The `m5l2-agent` prompt's setup** `npx skills add vercel/ai --skill ai-sdk`:

- It writes `.agents/skills/ai-sdk/SKILL.md`, a `.claude/skills/ai-sdk` link (a junction on Windows) and `skills-lock.json` at the root, and sends telemetry to skills.sh unless `DO_NOT_TRACK` is set.
- The prompt says only that it "lands in `.claude/skills/ai-sdk/SKILL.md`".
- That skill recommends the Vercel AI Gateway as "the fastest way to start", against the lesson's OpenRouter provider. It also points the agent to the docs shipped in `node_modules/ai/docs/`, which exist in 7.0.142.

### 10. promptfoo

- **A run needs:**
  - Node ≥22.22.0 and `OPENROUTER_API_KEY` (https://www.promptfoo.dev/docs/providers/openrouter/);
  - the template's `promptfooconfig.yaml` with `prompts/review.txt` and `fixtures/react19-migration.diff` / `fixtures/sql-injection.diff`, none of which exist yet;
  - the `llm-rubric` grader, which the template sets to `openrouter:anthropic/claude-sonnet-5.5`, a listed id.
- **Where results go:**
  - history in `~/.promptfoo/promptfoo.db`;
  - a disk cache in `~/.promptfoo/cache`, on by default for 14 days;
  - `eval` exits 100 on a failing test (https://www.promptfoo.dev/docs/usage/command-line/).
- **Telemetry** is on by default, to PostHog and promptfoo's own endpoint. `PROMPTFOO_DISABLE_TELEMETRY=1` turns PostHog off, though 0.124.1 still sends one "telemetry disabled" event (`telemetry-Cfhv1-So.js:105-150`).
- **Install:** 690 packages and 242 MB, with 7 high and 0 critical `npm audit` findings (basic-ftp, node-forge). It nests its own `ai@6` next to `ai@7`.
- **Cost of one uncached run:** 6 review calls (3 models × 2 tests) plus about 6 grader calls, $0.04 to $0.25 depending on reasoning tokens and routing (assumed token counts). A cached re-run costs about nothing.
- **Local, not CI:** the course material places it there. The template says "Run: OPENROUTER_API_KEY=... npx promptfoo eval" (`m5l3-promptfooconfig.yaml.template:2`), and neither `m5l3-promptfoo` nor the requirements mention CI. promptfoo does support CI.
- **What it doesn't test:** the template sends a copy of the prompt through raw `openrouter:` providers, so it doesn't exercise the reviewer's own `Output.object` path. The `m5l2-agent` prompt asks for a reviewer exported "so that we can run promptfoo evals on it".
- **A risk, inferred from source and untested:** promptfoo's OpenRouter provider prefixes `Thinking: …` when a model returns reasoning (`providers-Bn5yoNPJ.js:18063-18065`). That would fail `is-json` and the template's `JSON.parse(output)` assertion, unless a `response_format` is configured.

## Code References

- `.github/workflows/ci.yml:3-7`, `:10`, `:27`, `:119`: triggers and the three required jobs. `:14-18`: npm with `.nvmrc`.
- `.github/workflows/deploy-check.yml:11-29`: push and dispatch triggers, read-only checks.
- `.claude/config-templates/m5l3-review.yml.template:10`, `:13-20`, `:24`, `:37`, `:44`, `:57-58`: branch, permissions, concurrency, retry rule, diff, secret, labels.
- `.claude/config-templates/m5l3-action.yml.template:9-35`, `:48`, `:55`: inputs, the key's variable name, `dist/review.js`.
- `.claude/config-templates/m5l2-review-schema.ts.template:5`, `:16-61`: the zod import and the contract.
- `.claude/config-templates/m5l3-promptfooconfig.yaml.template:2-3`, `:9-11`, `:17-19`: run line, models, grader.
- `.claude/skills/10x-impl-review-ci/references/workflow-template.yml:47`, `:52-57`, `:70-78`, `:119-122`, `:141-143`, `:228-300`.
- `.claude/skills/10x-impl-review-ci/SKILL.md:62`, `:75-84`, `:170-176`, `:248-265`.
- `tsconfig.json:3-4`, `eslint.config.js:20`, `:79`, `:235`, `:238`, `vitest.config.ts:11`, `package.json:63-70`, `.gitignore:2`, `:8`, `src/styles/global.css:4-8`.
- `.claude/hooks/end-of-turn.mjs:24`, `:27` (`RELEVANT`, `UNTRACKED_ROOTS`). PR #58 rewrites the hooks and keeps both constants.
- `CLAUDE.md:68`, `:72`, `:73`, `README.md:106`, `context/deployment/deploy-plan.md:295`, `:310`, `context/foundation/infrastructure.md:85`, `context/foundation/test-plan.md:193`: the rules a secret and a new check touch.

## Architecture Insights

- **CI here is secret-free by design.** Production's secrets live in Cloudflare (Worker secrets and Workers Builds' build secrets), and GitHub reads only check runs (`infrastructure.md:85`, `deploy-plan.md:310`). A review key would be the first repository secret.
- **The merge is the deploy.** Every merge to `main` deploys through Workers Builds, and the ruleset is the only gate in front of it, with no bypass. So any new required check sits on the production path. The repo has added a required check once before, `e2e`, after its PR proved it (`context/archive/2026-10-02-testing-critical-browser-flows/plan.md:325`, `:815`).
- **Tooling scope is set by excludes.** Generated or foreign code is kept out of the app's tools one line at a time: `.claude/` in `tsconfig.json:4`, `eslint.config.js:238` and `global.css:8` (commit 5e23df6), `context/**/handoff` likewise. A reviewer under `.github/actions/` would join that pattern in ESLint and Tailwind only.
- **Scripts are Node `.mjs` with root dependencies.** Six of the 22 import `@supabase/supabase-js` and five `vitest`, with no nested `package.json` anywhere today (`git ls-files '**/package.json'`). A reviewer with its own `package.json` and lockfile would be the repo's first nested package.

## Historical Context (from prior changes)

- `context/archive/2026-10-02-testing-critical-browser-flows/plan.md:325` and `:815`: don't add a required check while open PRs never run it; `e2e` was added to the ruleset after its merge, through the API.
- `context/archive/2026-10-06-testing-deploy-and-production-checks/research.md:48`, `:95`, `:114`: no secrets, variables or environments; the checks are pinned to GitHub Actions' app id 15368; the ruleset "protects the merge, not the deploy".
  - Its `plan.md:50` calls 23934903 the Actions id. That's the ruleset's id; the app id is 15368, as its `research.md:95` and the API say.
- `context/deployment/deploy-plan.md:295`, `:310`, and its step 2.3: the starter once needed Supabase secrets in CI (`context/changes/bootstrap-verification/verification.md:158`), and the deploy plan removed them.
- Commit 5e23df6 (`chore/10x-module-2`): CI lint failed on `.mjs` files the 10x CLI put under `.claude/`, which led to the `.claude/` ignores. A reviewer under `.github/` would hit the same ESLint behaviour.
- 20 local implementation reviews are archived under `context/archive/*/reviews/impl-review.md` (5 APPROVED, 15 NEEDS ATTENTION), from `/10x-impl-review`, whose path `/10x-impl-review-ci` shares.
- Outside this change's folder, `context/`, CLAUDE.md and README.md mention no OpenRouter, Anthropic API key, Claude Code Action or AI review.

## Related Research

- `context/archive/2026-10-06-testing-deploy-and-production-checks/research.md`: the deploy gate, the ruleset and the no-secrets CI.
- `context/archive/2026-10-02-testing-critical-browser-flows/plan.md`: how `e2e` became a required check.

## Open Questions

These are the owner's decisions, each with what it depends on:

1. **Which path?**
   - The lesson's reviewer through OpenRouter (§8) is the course's main path for M5L2–M5L3.
   - `/10x-impl-review-ci` needs the fixes in §8 before it can run here: the `[skip ci]` commit, OIDC, npm, and the skill on `main`.
   - Or both, one after the other.
2. **The key:**
   - The provider and account; whether the owner creates a dedicated OpenRouter key with a credit limit, which OpenRouter keys support.
   - The variable's name (`LLM_PROVIDER_API_KEY` or `OPENROUTER_API_KEY`).
   - That this ends "CI needs no repository secrets" in five documents (Summary 11).
3. **Required or advisory?**
   - Required makes every merge, and so every deploy, wait for the key and the provider, with no bypass.
   - Advisory leaves the ruleset as it is.
   - Or advisory first, then required after a trial, as `e2e` was.
4. **What the reviewer sees:**
   - The full diff, or a filtered one (without `.claude/`, `context/`, fixtures and recordings, the lockfile, CLAUDE.md?).
   - Whether the PR body goes too ("?? cost tradeoff" in the requirements).
   - What happens to a diff over a size cap.
5. **The model and data policy:**
   - The template's `z-ai/glm-5.3`, DeepSeek V4.1 Flash, GPT-5.6 Luna or a Claude model.
   - Pinned endpoints or `require_parameters: true`.
   - `data_collection: "deny"` or `zdr: true`.
6. **When it runs:** every push; skipping drafts (ready-for-review and later pushes); or only on `ai-cr:review`. This multiplies the cost ×3.29 or ×1.11 (§5).
7. **Where it lives and how it runs:**
   - `.github/actions/ai-reviewer/` (§3, the fewest config changes) or a separate repository pinned by SHA.
   - A committed bundle, a build per run, or Node's type stripping (§4).
8. **promptfoo:**
   - Local only, or also in CI.
   - Telemetry off.
   - The template's React and SQL-injection fixtures, or diffs that match this repo's risks (a missing RLS policy or grant, a shop request outside the gate).
9. **The language** of the system prompt and the PR comment. The template's prompt is Polish; the app's UI is Polish and the repo's documents are English.
10. **Cost tracking per run** (the M5L2 rule "Track cost per run … set a hard budget cap before the agent runs unattended"): where the cost goes (the job summary, the comment) and what the cap is.
