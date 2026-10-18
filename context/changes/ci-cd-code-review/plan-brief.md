# An AI code review on every pull request — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Every pull request to `main` that is ready for review gets an AI review:

- six criteria scored 1–10, a binding `pass`/`fail` verdict and a short summary;
- one comment, kept up to date, and an `ai-cr:passed` / `ai-cr:failed` label;
- a `review` check that goes red on `fail`.

It's what Module 5's lessons 2 and 3 build, and the course material for the optional 10xChampion badge (first deadline 2026-11-04).

## Starting Point

- **CI has no secrets, labels or actions of its own.** Five documents say so.
- **The ruleset admits no bypass.** `preventFailedDeploy` requires `ci`, `smoke` and `e2e` with no bypass actors, and every merge deploys to production.
- **The lesson's templates assume another repo:** they target `master`, run a built `dist/review.js` that this repo's `.gitignore` hides, and name no secret it has.

## Desired End State

- A ready PR shows the review in one comment, with the six scores, the summary, the paths left out, the model and the run's cost, and carries one label. Drafts aren't reviewed.
- Adding `ai-cr:review` re-runs the review.
- A PR that changes only plans, research, the 10x CLI's files or recorded shop answers gets "nothing to review" and no model call.
- The owner can review a branch locally (`npm run review`) and compare three models on planted flaws (`npm run eval`).
- The app's tooling, lockfile and deploys are untouched.

## Key Decisions Made

| Decision       | Choice                                                                                                                     | Why (1 sentence)                                                                                                                                               | Source              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Reviewer       | The lesson's agent (AI SDK 7, OpenRouter, zod)                                                                             | The course's main path, fits this repo, costs cents a month; `/10x-impl-review-ci` blocks merges here as shipped.                                              | Plan (research §8)  |
| Gate           | Advisory first: red on `fail`, outside the ruleset                                                                         | The ruleset has no bypass, so a required check would let a missing key or an outage block every deploy; the owner can require it after a trial, as with `e2e`. | Plan (research §2)  |
| When           | Ready PRs and their pushes; drafts skipped; `ai-cr:review` re-runs                                                         | About 1.1 reviews per PR instead of 3.3, since drafts get about 5 pushes each here.                                                                            | Plan (research §5)  |
| What it reads  | Title, description and diff, without `.claude/`, `context/`, recorded shop answers, the eval's planted diffs and lockfiles | The typical diff drops from about 33k to 7k tokens, and plans aren't scored as code.                                                                           | Plan (research §5)  |
| Language       | English prompt, schema descriptions and comment                                                                            | Matches this repo's PRs, commits and documents.                                                                                                                | Plan                |
| Where it lives | `.github/actions/ai-reviewer/`, its own package and lockfile                                                               | Skipped by the app's TypeScript and Vitest; needs one ESLint and one Tailwind line.                                                                            | Research §3         |
| How it runs    | Node 24's type stripping (`node src/review.ts`), no bundle                                                                 | No `dist/` to un-ignore, no source/bundle drift, nothing large in the diff.                                                                                    | Research §4         |
| Secret         | `OPENROUTER_API_KEY`, a dedicated key with a credit limit                                                                  | The provider's own variable, the same in CI, local runs and evals; the limit caps a month's spend.                                                             | Plan                |
| Model          | `z-ai/glm-5.3` (the template's) until the eval decides; `require_parameters` and `data_collection: "deny"`                 | Routes only to endpoints with structured output, and away from providers that may train on PR text.                                                            | Plan (research §9)  |
| Evals          | promptfoo, local only, telemetry off, through the real reviewer                                                            | Tests what CI runs; the lesson keeps evals local.                                                                                                              | Plan (research §10) |

## Scope

**In scope:**

- the reviewer package with tests and type check;
- the composite action and `ai-review.yml`;
- the reviewer's checks in CI's `ci` job;
- the ESLint and Tailwind exclusions;
- the promptfoo evals with four cases;
- the five documents and the deploy plan's runbook.

**Out of scope:**

- making `review` required;
- `/10x-impl-review-ci` and Claude Code Action;
- reviewing plans and research;
- tools or repository context for the agent;
- promptfoo in CI;
- re-pinning `ci.yml`'s actions;
- publishing the reviewer;
- fork PRs.

## Architecture / Approach

1. `ai-review.yml` checks out the PR and writes `git diff origin/main...HEAD` to a file.
2. It calls `.github/actions/ai-reviewer`, which installs its lockfile and runs `node src/review.ts`.
3. The reviewer filters the diff and builds one prompt.
4. A `ToolLoopAgent` with schema-checked output calls the OpenRouter model. The answer is range-checked and printed as JSON with the model, tokens and cost.
5. The workflow edits one comment by its marker, swaps the labels, writes the job summary, and fails unless the verdict is `pass`.

The job token stays out of the reviewer's reach: checkout doesn't persist it, `GH_TOKEN` is set only on the `gh` steps, and `npm ci` runs with `--ignore-scripts`. A re-run waits for a running review; only a new push cancels one.

Every decision lives in a pure, tested module (`diff.ts`, `prompt.ts`, `review-schema.ts`, `comment.ts`). The model sits behind `createReviewer`, which tests replace with AI SDK's mock.

## Phases at a Glance

| Phase                        | What it delivers                                                                                              | Key risk                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. The reviewer, run locally | The package, tests and type check; `git diff \| npm run review`; the app's tooling leaves the folder alone    | Node's type stripping refuses some TypeScript syntax                  |
| 2. The review in CI          | The action and `ai-review.yml`, with the reviewer's checks in CI's `ci` job; the PR reviews itself once ready | The first run waits for the owner's key and secret                    |
| 3. promptfoo evals           | Three models × four planted diffs through the real reviewer; picks the default model                          | promptfoo loading the reviewer's TypeScript (fallback: spawn the CLI) |
| 4. Documents                 | CLAUDE.md, README, deploy plan, infrastructure and test plan name the secret and the advisory check           | —                                                                     |

**Prerequisites:**

- PR #57 (the Module 5 fetch), which this branch builds on;
- the owner's OpenRouter account, for the key, the secret and the eval run.

**Estimated effort:** about 2 sessions across 4 phases, plus the owner's key and eval steps.

## Open Risks & Assumptions

- **Routing:** `data_collection: "deny"` with `require_parameters` may leave a model with no endpoint. The eval or the first run shows it, and loosening the data policy would be the owner's call.
- **Model quality:** the reviews' usefulness is untested until the eval. A score-and-verdict review from the diff alone can't judge business fit or architecture, which the requirements park.
- **Prompt injection:** a PR's description and diff reach the model as data. Only the owner opens PRs today, and the check is advisory.
- **Observed, not documented:** a job skipped by its `if:` doesn't join a job-level concurrency group (seen in public repositories). A re-review leaves the earlier `review` run beside it on the commit, so the label and the comment are the review's record. Both are checked manually in Phase 2. Making `review` required later first moves the label re-run to its own workflow.

## Success Criteria (Summary)

- This PR, once ready, carries the review's comment, label and green or red `review` check, while `ci`, `smoke` and `e2e` stay green and the ruleset is unchanged.
- The eval shows each model's results on the planted flaws, and the default model catches them.
- The documents name the one secret, the advisory check, and how to require it later.
