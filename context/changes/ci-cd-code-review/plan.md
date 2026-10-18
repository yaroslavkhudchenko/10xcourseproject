# An AI code review on every pull request Implementation Plan

## Overview

Add the AI code review that Module 5's lessons 2 and 3 build:

- a small reviewer agent that reads a ready pull request's title, description and diff, and returns six criteria scored 1–10, a binding `pass`/`fail` verdict and a Markdown summary;
- a GitHub Actions job that runs it on every ready pull request to `main`, keeps one comment up to date, labels the pull request `ai-cr:passed` or `ai-cr:failed`, and goes red on `fail`;
- promptfoo evals that compare the reviewer on three models before its prompt or model changes.

The check is advisory: it stays out of the `preventFailedDeploy` ruleset, so a missing key or a provider outage never blocks a merge or a deploy. The owner can make it required after a trial, as they did with `e2e`. The work follows `requirements.md` (the course's `m5l3-requirements`) and the research in `research.md`.

## Current State Analysis

- **CI has no secrets, labels or actions of its own.** `.github/` holds `ci.yml` (jobs `ci`, `smoke`, `e2e`) and `deploy-check.yml`. The repository has 0 secrets, 0 variables and no `ai-cr:*` label (research §1).
- **The ruleset admits no bypass.** `preventFailedDeploy` requires `ci`, `smoke` and `e2e` with 0 approvals and no bypass actors, and every merge deploys to production through Workers Builds (research §1, `CLAUDE.md:72`).
- **Five documents state CI has no secrets:** `CLAUDE.md:68`, `README.md:106`, `context/deployment/deploy-plan.md:310`, `context/foundation/infrastructure.md:85`, and `context/foundation/test-plan.md:193` (for the `e2e` job).
- **The templates need adapting to this repo** (research §2, §4):
  - `m5l3-review.yml.template:10` targets `master`.
  - It reads `secrets.LLM_PROVIDER_API_KEY` and never creates the `ai-cr:review` label.
  - Its action runs `dist/review.js`, which `.gitignore:2` (`dist/`) would hide.
- **`.github/actions/ai-reviewer/` is skipped by the app's TypeScript and Vitest, but not by ESLint 10 or Tailwind's scan** (research §3). It needs one `globalIgnores` entry (`eslint.config.js:238`) and one `@source not` line (`src/styles/global.css:4-8`).
- **Diffs here are mostly documents.** Over the 56 merged PRs, leaving out `.claude/`, `context/`, the recorded shop answers and lockfiles takes the median diff from 131 KB to 27 KB (research §5). One review costs fractions of a cent on the template's models (research §6).
- **The libraries match the plan** (research §9): `ai` 7.0.142 and `@openrouter/ai-sdk-provider` 3.1.0, both needing Node ≥22, ESM only, and zod 4.6.7. Node 24.21 runs `.ts` files and `.test.ts` tests directly, with erasable syntax only (research §4, re-checked 2026-10-16 with `node --test`).

## Desired End State

A pull request to `main` that is marked ready for review gets one comment from the `review` job, with:

- the verdict and the six scores;
- the summary;
- the paths left out of the review;
- the model, and the run's tokens and cost.

It also carries one label, `ai-cr:passed` or `ai-cr:failed`, and the `review` check passes or fails with the verdict. Further pushes update the same comment and label. Adding `ai-cr:review` reviews the PR again and removes the label. A draft PR is not reviewed.

A PR that changes only left-out paths gets a "nothing to review" comment, a `pass` and no model call. When the key is missing, or the model gives no valid answer, the job fails with the reason in its summary, and posts no verdict.

`git diff origin/main...HEAD | npm run review --prefix .github/actions/ai-reviewer` reviews a branch locally with the owner's key. `npm run eval --prefix .github/actions/ai-reviewer` compares three models on four planted diffs.

The app's lint, types, unit tests, build and lockfile are untouched by the reviewer's folder. The documents name the one repository secret and the advisory check.

**Verified by:**

- the reviewer's unit tests (`node --test`), its own type check and the app's unchanged gates;
- this pull request reviewing itself once the owner has added the secret and marked it ready;
- the owner's eval run.

### Key Discoveries:

- A skipped job reports success, and a workflow-level `cancel-in-progress` group lets any label event cancel a running review (research §2). So `concurrency` goes on the job, under the job's `if:`.
- `pull_request` runs the PR's own copy of the workflow and the local action, so this pull request reviews itself once it's ready and the secret exists (research §7).
- For a local action, `github.action_path` is `<workspace>/./.github/actions/<name>`. setup-node's cache glob refuses the `/./` and fails the step, so the cache path is workspace-relative (plan review F1, `@actions/glob` 0.7.0 probed offline).
- `actions/checkout` v7.0.1 persists the job token for later steps by default (since v6, in a `$RUNNER_TEMP` file that `.git/config` includes), and `persist-credentials: false` removes it at the end of the checkout step (plan review F2; checkout's `action.yml:52-54`, `README.md:33`).
- On a fork PR the secret is empty, and the review fails visibly. There are 0 forks today (research §7).
- AI SDK 7's structured output is `Output.object` on `generateText` or `ToolLoopAgent`. A schema violation throws `AI_NoObjectGeneratedError` and isn't retried by `maxRetries`. The cost comes in `finalStep.providerMetadata.openrouter.usage.cost` (research §9).
- OpenRouter supports structured outputs per endpoint. `provider.require_parameters: true` routes only to endpoints that support them, and `provider.data_collection: "deny"` keeps PR text away from providers that may train on it (research §9, §7).
- A bare model string resolves through the Vercel AI Gateway, so the model is always built with `createOpenRouter` (research §9).
- Node's type stripping refuses enums, parameter properties, runtime namespaces, relative imports without `.ts`, `@/` aliases and type imports without `type` (research §4).
- The template's actions are pinned by commit SHA. `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` is v7.0.1 and `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` is v7.1.0, both verified with `gh api repos/actions/<repo>/commits/<sha>` on 2026-10-16.

## What We're NOT Doing

- **Making `review` required** in `preventFailedDeploy`. That stays the owner's later call; Phase 4 documents how.
- **`/10x-impl-review-ci`** and Claude Code Action, which break here as shipped (research §8). A later change can add them.
- **Reviewing `.claude/`, `context/`, the recorded shop answers** (`src/lib/services/shops/fixtures/`), the eval's planted diffs or lockfiles.
- **Repository context or tools for the agent** beyond the PR's title, description and diff. The requirements park business alignment and architectural fit.
- **promptfoo in CI.** Evals run locally, with the owner's key.
- **Re-pinning `ci.yml`'s existing actions** (`checkout@v4`, `setup-node@v4`) to SHAs. Only the new workflow and action follow the lesson's pinning rule.
- **Publishing the reviewer** as its own repository or package (Module 5 lesson 4's territory).
- **Fork PR support:** a fork's run fails visibly for lack of the secret.

## Implementation Approach

The reviewer is a small ESM package inside its composite action, `.github/actions/ai-reviewer/`:

- its own `package.json` and lockfile, so nothing reaches the app's lockfile, `npm ci` or Workers Builds;
- run by Node 24's type stripping (`node src/review.ts`), with no bundle and so no `dist/`;
- its decisions in pure, tested modules: the diff filter, the size limit, the prompt, the answer check and the comment;
- the model call behind one `createReviewer` that tests replace with AI SDK's mock model.

The workflow follows the template with this repo's adaptations:

- `main`, and `ready_for_review` among the types, with drafts skipped;
- the job-level concurrency, a 10-minute timeout and SHA-pinned actions;
- one secret, `OPENROUTER_API_KEY`, the provider's own variable name, used the same way in CI, local runs and evals;
- one comment updated per run, all three labels created by the workflow, the cost in the job summary, and a gate step that fails unless the verdict is `pass`.

The default model is the template's `z-ai/glm-5.3` until the Phase 3 eval confirms or replaces it. It's routed with `require_parameters: true` and `data_collection: "deny"`.

**Cost.** A typical review sends about 7k tokens and costs fractions of a cent. Cost is bounded per run by 8,000 output tokens, a 120 s call timeout with one retry for an invalid answer, and the job's 10-minute limit. The OpenRouter key's own credit limit, which the owner sets, bounds it per month. With drafts skipped, about 1.1 reviews run per PR (research §5, §6).

## Critical Implementation Details

- **Ordering in Phase 1.** The ESLint ignore and the Tailwind exclusion land before the first `.ts` file of the reviewer. Otherwise the commit hook's `eslint --fix` and the per-edit hook fail on its files (research §3).
- **The PR reviews itself.** Phases 1 and 2 go up as a draft pull request, which the job skips. The owner adds the secret first and only then marks the PR ready, so its first run has a key.
- **Diff paths.** A file's path comes from its `+++ b/…` line, or from `--- a/…` for a deletion (`+++ /dev/null`). For a binary or mode-only section, which has neither line, it comes from the `diff --git` header. A rename counts by its new path. A git-quoted path (`"b/…"` with escapes) is unquoted before matching.

## Phase 1: The reviewer, run locally

### Overview

The reviewer as a package that reviews a diff from the command line, with the app's tooling told to leave its folder alone (lesson 2).

### Changes Required:

#### 1. The app's tooling leaves the reviewer's folder alone

**File**: `eslint.config.js`, `src/styles/global.css`

**Intent**: Keep the reviewer's TypeScript, which has its own dependencies and tsconfig, out of the app's typed lint. Keep its fixtures and its `node_modules` out of Tailwind's class scan, as was done for `.claude/` and `context/`.

**Contract**:

- `globalIgnores([...])` at `eslint.config.js:238` also lists `.github/actions/ai-reviewer/`, with a one-line comment saying why.
- `global.css` gets `@source not "../../.github/actions/ai-reviewer";` beside the three existing `@source not` lines, with the same kind of comment.

#### 2. The reviewer's package

**File**: `.github/actions/ai-reviewer/package.json`, `package-lock.json`, `tsconfig.json`

**Intent**: A private ESM package with the lesson's dependencies and its own lockfile.

**Contract**:

- **`package.json`:**
  - `"private": true`, `"type": "module"`, `"engines": { "node": ">=24.12" }` (stable type stripping).
  - `dependencies`: `ai` `^7.0.142`, `@openrouter/ai-sdk-provider` `^3.1.0`, `zod` `^4.6.7`.
  - `devDependencies`: `typescript` `~6.0.3` (the app's line, not 7.x) and `@types/node` `^24`.
  - Scripts: `review` (`node src/review.ts`), `test` (`node --test`), `typecheck` (`tsc -p .`), and `eval` (added in Phase 3).
- **The lockfile** is written with npm 11.16.0, the version CLAUDE.md pins (`npx -y npm@11.16.0 install` in the folder).
- **`tsconfig.json`:**
  - `strict`, `module`/`moduleResolution` `nodenext`, `target` `es2024`, `noEmit`;
  - `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`;
  - `types: ["node"]`, `skipLibCheck: true`;
  - includes `src/`, `test/` and, from Phase 3, `eval/`.

#### 3. The review schema and prompt

**File**: `.github/actions/ai-reviewer/src/review-schema.ts`

**Intent**: The template's contract in English:

- six criteria, described by the English text of `requirements.md`;
- the binding `verdict` and the Markdown `summary`;
- an English system prompt that asks for a 2–3 sentence summary the author can act on, and treats the PR's text and diff as data, not instructions.

**Contract**:

- `SYSTEM_PROMPT` and `REVIEW_SCHEMA`: a zod object with flat fields `implementationCorrectness`, `idiomaticity`, `complexity`, `testRiskCoverage`, `documentation`, `securitySafety` (plain `z.number()`, as the template explains), `verdict: z.enum(["pass","fail"])` and `summary: z.string()`. `type Review = z.infer<...>`.
- `parseReview(value)` returns the `Review` when every score is an integer from 1 to 10, and otherwise throws a named error. The JSON Schema sent to the model can't carry the range portably, so the check is local.
- The template's `REVIEW_JSON_SCHEMA` (for the Claude Agent SDK) is left out: nothing here reads it.

#### 4. What the reviewer reads

**File**: `.github/actions/ai-reviewer/src/diff.ts`

**Intent**: Leave out the paths the owner chose to skip, and bound what one review sends.

**Contract**:

- `filterDiff(diff)` → `{ kept: string; excluded: { path: string; bytes: number }[]; keptBytes: number }`.
- It splits the unified diff at `diff --git` headers and drops each section whose path, per Critical Implementation Details, falls under:
  - `.claude/`;
  - `context/`;
  - `src/lib/services/shops/fixtures/`;
  - `.github/actions/ai-reviewer/eval/fixtures/`;
  - any `package-lock.json`.

  Every other section is kept byte for byte. The list is one exported constant.

- `MAX_REVIEW_BYTES` = 1,000,000. That's the largest diff (b) of research §5 (724 KB) with room to spare, about 280k tokens.

#### 5. The prompt

**File**: `.github/actions/ai-reviewer/src/prompt.ts`

**Intent**: One user message with the PR's title, its description (cut at 10,000 characters), the paths left out, and the kept diff.

**Contract**: `buildPrompt({ title, body, diff, excluded })` → a string. The left-out paths are listed, so the model knows what it doesn't see; the list is cut at 50 paths with an "and N more" line.

#### 6. The agent

**File**: `.github/actions/ai-reviewer/src/reviewer.ts`

**Intent**: The lesson's `ToolLoopAgent` reviewer, exported for the CLI and the evals.

**Contract**:

- `createReviewer({ apiKey, model, languageModel?, fetch? })` → `{ review(prompt): Promise<{ review: Review; usage: { inputTokens; outputTokens; cost? }; model: string }> }`.
- **The model:** `createOpenRouter({ apiKey, compatibility: "strict", fetch }).chat(model, { provider: { require_parameters: true, data_collection: "deny" } })`, or the injected `languageModel`. Tests pass a stub `fetch` to check the real request, and the mock model to drive the agent.
- **The agent:** `new ToolLoopAgent({ model, instructions: SYSTEM_PROMPT, output: Output.object({ schema: REVIEW_SCHEMA }), maxOutputTokens: 8000, timeout: 120_000 })`, with no tools.
- **Failures:** one retry after an invalid answer, and none after any other error. An invalid answer is either of:
  - `NoObjectGeneratedError` from `generate()`: no JSON, or JSON that breaks the schema;
  - `NoOutputGeneratedError` when reading `.output`: an empty answer.

  The SDK itself makes one call for these. The result goes through `parseReview`.

- **Usage and cost:** usage from `result.usage`, and cost from `result.finalStep.providerMetadata?.openrouter?.usage?.cost`.
- `DEFAULT_MODEL` = `"z-ai/glm-5.3"` is exported from this module only.

#### 7. The command line

**File**: `.github/actions/ai-reviewer/src/review.ts`

**Intent**: The entry point the action and local runs use. It prints one JSON object on stdout, or fails with a reason.

**Contract**:

- **Reads:**
  - `OPENROUTER_API_KEY`, `REVIEW_MODEL` (empty means `DEFAULT_MODEL`), `PR_TITLE`, `PR_BODY`;
  - the diff from the file `DIFF_FILE` names, else from stdin. A `DIFF_FILE` that's missing or can't be read is a failure, never "nothing to review" (lessons: never read an unreadable answer as missing).
- **Prints** `{ ...Review, model, usage, excluded }` on success. Or, without a model call:
  - with nothing left after filtering: `{ verdict: "pass", summary, skipped: "nothing-to-review", excluded }`;
  - above `MAX_REVIEW_BYTES`: `{ verdict: "fail", summary, skipped: "too-large", excluded }`, with a summary that says it wasn't reviewed and to split the PR or review it by hand.
- **Exit codes:**
  - 0 whenever a verdict is printed;
  - 1 with one line on stderr and nothing on stdout when no verdict can be given, including a missing `OPENROUTER_API_KEY`. That message names the repository secret and the local `export`. When `GITHUB_STEP_SUMMARY` is set, the same line is appended there, which is how the job summary shows why.
- **The run's line** (model, tokens, cost) goes to stderr. The key is never printed.

#### 8. The tests

**File**: `.github/actions/ai-reviewer/test/*.test.ts`

**Intent**: The reviewer's decisions at their boundaries, with no network.

**Contract**: `node --test` covers:

- **`filterDiff`:** each excluded root, a kept file beside them, a rename into and out of `context/`, a deletion, a binary section, a quoted path, an empty diff, and the byte limit.
- **`buildPrompt`:** the cut description and the cut excluded list.
- **`parseReview`:** a 0, an 11, a 7.5 and a missing field.
- **`createReviewer`,** with AI SDK's mock language model (`MockLanguageModelV4` from `ai/test`): the instructions and output schema sent, the one retry after an answer that breaks the schema and after an empty one, and usage and cost read from provider metadata.
- **The OpenRouter wiring,** with a stub `fetch` passed to `createReviewer`: the request body carries `provider.require_parameters: true`, `provider.data_collection: "deny"`, a `response_format` of type `json_schema` and `max_tokens: 8000`, and the stub's `usage.cost` comes back as the run's cost.
- **The CLI**, spawned:
  - a missing key: exit 1, empty stdout, and the line appended to a temporary `GITHUB_STEP_SUMMARY`;
  - a missing diff file: exit 1, empty stdout;
  - a diff of only `context/`: `nothing-to-review`;
  - a diff over the limit: `too-large`, with no model call.

### Success Criteria:

#### Automated Verification:

- The reviewer installs from its lockfile: `npm ci --prefix .github/actions/ai-reviewer`
- The reviewer's tests pass: `npm test --prefix .github/actions/ai-reviewer`
- The reviewer type-checks: `npm run typecheck --prefix .github/actions/ai-reviewer`
- Making `filterDiff` keep `context/` turns its tests red, and restoring it turns them green again
- Making `parseReview` accept an 11 turns its tests red, and restoring it turns them green again
- ESLint ignores the folder: `npx eslint --print-config .github/actions/ai-reviewer/src/review.ts` reports the file as ignored, and `npm run lint` passes
- The app's unit suite passes: `npm run test`
- Types check and leave the folder out: `npx astro sync && npx astro check` passes, and `npx tsc -p tsconfig.json --listFilesOnly` lists no file under `.github/`
- The build passes: `npm run build`
- The app's dependencies are untouched: `git diff --exit-code origin/main -- package.json package-lock.json`
- Tailwind's scan leaves the folder out: `git grep -nF '@source not "../../.github/actions/ai-reviewer"' -- src/styles/global.css` finds the line

#### Manual Verification:

- With the owner's key exported, `git diff origin/main...HEAD | npm run review --prefix .github/actions/ai-reviewer` prints a JSON review with six integer scores, a verdict and a summary, and a stderr line with the model, tokens and cost

**Implementation Note**: The manual run needs the owner's OpenRouter key, so it can wait for Phase 2's manual steps, where the key is made anyway. Open the pull request as a draft with Phase 1's commit, so CI runs on it.

---

## Phase 2: The review in CI

### Overview

The composite action and the workflow from the lesson's templates, adapted to this repository (lesson 3), with the reviewer's tests added to CI's `ci` job.

### Changes Required:

#### 1. The composite action

**File**: `.github/actions/ai-reviewer/action.yml`

**Intent**: The template's action, running the reviewer's TypeScript directly instead of a built `dist/review.js`.

**Contract**:

- **Inputs:** `api-key` (required), `pr-title` (required), `pr-body` (default `""`), `diff-file` (required) and `model` (default `""`).
- **Outputs:** `verdict` and `review-file`.
- **Steps:**
  1. `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0` with `node-version: 24`, `cache: npm` and `cache-dependency-path: .github/actions/ai-reviewer/package-lock.json`. The path is relative to the workspace: a local action's `github.action_path` holds `/./`, which setup-node's glob refuses, failing the step.
  2. `npm ci --prefix "$GITHUB_ACTION_PATH" --omit=dev --ignore-scripts --no-audit --no-fund`. With `--ignore-scripts`, no package's install script runs in a job that holds a token.
  3. `node "$GITHUB_ACTION_PATH/src/review.ts" > "$review_file"`. The key, title, body, diff path and model reach it through `env`, never interpolated into the script.
  4. The template's verdict extraction.

#### 2. The comment

**File**: `.github/actions/ai-reviewer/src/comment.ts`, `.github/actions/ai-reviewer/test/comment.test.ts`

**Intent**: The PR comment's Markdown, from the review JSON, in a tested module rather than inline in YAML.

**Contract**:

- `node src/comment.ts <review.json>` prints Markdown whose first line is the marker `<!-- ai-review -->`. The module exports the marker, and the workflow reads it from that first line, never from a copy of its own.
- It holds:
  - the verdict;
  - a table of the six scores (left out for a skipped review);
  - the summary;
  - the left-out paths, folded in `<details>` and capped at 50;
  - a footer with the model, the tokens and the cost.
- The output stays under GitHub's 65,536-character comment limit by cutting the summary.

#### 3. The workflow

**File**: `.github/workflows/ai-review.yml`

**Intent**: The template's review job, adapted to `main`, drafts, labels, this repository's single comment and an advisory gate.

**Contract**:

- **Trigger:** `on: pull_request` with `branches: [main]` and `types: [opened, synchronize, reopened, ready_for_review, labeled]`.
- **Permissions:** `contents: read`, `pull-requests: write`, `issues: write`.
- **Job `review`:**
  - `if: github.event.pull_request.draft == false && (github.event.action != 'labeled' || github.event.label.name == 'ai-cr:review')`;
  - job-level `concurrency: { group: ai-review-${{ github.event.pull_request.number }}, cancel-in-progress: ${{ github.event.action == 'synchronize' }} }`. A new push cancels the running review. A re-run (`ai-cr:review`, `reopened`) waits for it instead of leaving a cancelled run behind. A job skipped by its `if:` doesn't join the group, which is observed in public repositories but not documented;
  - `timeout-minutes: 10`, `runs-on: ubuntu-latest`;
  - no job-wide `env` holding a token: `GH_TOKEN: ${{ github.token }}` is set only on the steps that call `gh`.
- **Steps:**
  1. `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` with `fetch-depth: 0` and `persist-credentials: false`. The full fetch happens here, so no later step needs git credentials, and the job token isn't left for npm's packages or the reviewer.
  2. The diff, `git diff "origin/$BASE_REF...HEAD" > "$RUNNER_TEMP/pr.diff"`.
  3. The action, with `api-key: ${{ secrets.OPENROUTER_API_KEY }}`.
  4. Once a verdict exists:
     - **one comment.** The PR's comments are listed page by page (`gh api --paginate --jq`), keeping those by `github-actions[bot]` whose body contains the marker that the rendered comment's first line gives. The first such id is edited with `gh api -X PATCH … -F body=@<file>`, or a comment is created when none is found;
     - `gh label create --force` for `ai-cr:passed` (green), `ai-cr:failed` (red) and `ai-cr:review`;
     - the passed/failed swap, and removing `ai-cr:review`;
     - the comment's Markdown in `$GITHUB_STEP_SUMMARY`.
  5. With no verdict, the job fails at the action's step, and the reviewer's own line in the job summary says why (Phase 1 #7).
  6. The gate, `test "$VERDICT" = pass`.
- **The review's record is the label and the comment.** Each run is its own check suite, so an earlier failed `review` run stays on a commit beside a later one, and the PR's checks can show both. For the advisory check that only affects what's displayed. Phase 4's runbook covers what it means for a required one.

#### 4. The reviewer's checks in CI

**File**: `.github/workflows/ci.yml`

**Intent**: The `ci` job installs, tests and type-checks the reviewer, so a red reviewer test blocks a merge like any other test. The app's `npm run test` doesn't reach the folder.

**Contract**: After the `ci` job's `npm run test` step, it runs:

- `npm ci --prefix .github/actions/ai-reviewer`;
- `npm test --prefix .github/actions/ai-reviewer`;
- `npm run typecheck --prefix .github/actions/ai-reviewer`.

#### 5. The workflow's shape, tested

**File**: `.github/actions/ai-reviewer/test/workflow.test.ts`, `.github/actions/ai-reviewer/package.json` (`devDependencies`)

**Intent**: Pin the workflow's safety-relevant settings with a test rather than a reader, so a later edit can't quietly undo them.

**Contract**:

- A `yaml` devDependency parses `.github/workflows/ai-review.yml`. The test asserts:
  - the trigger's branch and types;
  - the job's `if:`;
  - the job-level concurrency that cancels only on `synchronize`;
  - the 10-minute timeout and the three permissions;
  - checkout's `persist-credentials: false`;
  - no job-wide `GH_TOKEN`;
  - every `uses:`, in the workflow and in `action.yml`, pinned to a 40-character SHA.

### Success Criteria:

#### Automated Verification:

- The comment's tests pass with the reviewer's: `npm test --prefix .github/actions/ai-reviewer`
- Every action the new workflow and action use is pinned by SHA: `git grep -nE "uses: [^ ]+@v[0-9]" -- .github/workflows/ai-review.yml .github/actions/ai-reviewer/action.yml` prints nothing
- The workflow's shape test passes: the trigger, the job's `if:` skipping drafts and other labels, the job-level concurrency that cancels only on `synchronize`, the timeout, permissions, `persist-credentials: false`, no job-wide `GH_TOKEN`, and SHA pins, in `npm test --prefix .github/actions/ai-reviewer`
- The app's gates pass: `npm run lint`, `npm run test`, `npx astro check` and `npm run build`
- CI only: CI's `ci` job runs the reviewer's install, tests and type check, and passes
- CI only: the `review` job is skipped on the draft pull request

#### Manual Verification:

- The owner creates an OpenRouter key with a credit limit (about $5), adds it as the repository secret `OPENROUTER_API_KEY`, and marks the pull request ready. The `review` check then runs, one comment appears with the scores, summary, left-out paths, model and cost, and the PR gets `ai-cr:passed` or `ai-cr:failed`.
- A further push edits the same comment rather than adding one.
- Adding `ai-cr:review` reviews the PR again and removes the label.
- Adding an unrelated label while a review runs leaves that review running.
- `ci`, `smoke` and `e2e` stay green throughout, and the ruleset is unchanged.

**Implementation Note**: The pull request stays a draft until the owner has added the secret. Give the owner the key and secret steps while it's a draft, then mark it ready, so its first review runs with a key.

---

## Phase 3: promptfoo evals

### Overview

The lesson's eval, run locally: the same reviewer on three models and four planted diffs, to choose the default model now and to check any later prompt or model change.

### Changes Required:

#### 1. The eval provider

**File**: `.github/actions/ai-reviewer/eval/reviewer-provider.mjs`

**Intent**: Run the real reviewer for each case, with `filterDiff`, `buildPrompt` and `createReviewer` imported from `src/`, instead of a copy of the prompt. The eval then tests what CI runs.

**Contract**:

- A promptfoo custom provider: `id()`, and `callApi(prompt, context)` reading `context.vars` (`title`, `body`, `diff`) and its `config.model`.
- It returns `{ output: JSON.stringify(review), tokenUsage, cost }`.
- **The eval isn't proof that Node runs the reviewer.** promptfoo 0.124.1 loads the provider with a native `import()`. But it registers tsx's loader for the whole process while it probes for default configs, so the reviewer's `.ts` modules load through tsx, which accepts syntax that plain Node refuses. The proof that Node's type stripping runs the reviewer stays with CI's `npm test` and `typecheck` (Phase 2 #4).

#### 2. The config and fixtures

**File**: `.github/actions/ai-reviewer/eval/promptfooconfig.yaml`, `eval/fixtures/*.diff`

**Intent**: The template's config, with this repo's provider and two more cases.

**Contract**:

- **Providers:** the custom provider three times, with `config.model` set to `z-ai/glm-5.3`, `deepseek/deepseek-v4.1-flash` and `openai/gpt-5.6-luna`.
- **Grader:** `openrouter:anthropic/claude-sonnet-5.5`.
- **Tests:**

  | Case                                                                                                              | Assertions                                                                                       |
  | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
  | `react19-migration.diff`, a React 16 → 19 migration with three planted flaws                                      | `is-json`; an `llm-rubric` that all three flaws are named and explained; `verdict === "fail"`    |
  | `sql-injection.diff`                                                                                              | `is-json`; an `llm-rubric` that names the injection; `verdict === "fail" && securitySafety <= 3` |
  | `shop-gate-bypass.diff`, a service that calls `fetch` on a shop host where the surrounding code uses `gate.fetch` | `is-json`; an `llm-rubric` that it flags the bypass; `verdict === "fail"`                        |
  | `clean-refactor.diff`, a small refactor with its test                                                             | `is-json`; `verdict === "pass"`                                                                  |

#### 3. The eval command

**File**: `.github/actions/ai-reviewer/eval/run.mjs`, `package.json` (`eval` script)

**Intent**: One command that runs the pinned promptfoo with telemetry off, the same way on Windows and elsewhere.

**Contract**:

- `npm run eval` runs `node eval/run.mjs`, which spawns `npx --yes promptfoo@0.124.1 eval -c eval/promptfooconfig.yaml` with `PROMPTFOO_DISABLE_TELEMETRY=1` and `PROMPTFOO_DISABLE_UPDATE=1` set.
- promptfoo isn't a dependency, so its 690 packages stay out of the reviewer's lockfile (research §10).

### Success Criteria:

#### Automated Verification:

- The provider module loads without a model call: `node -e "import('./.github/actions/ai-reviewer/eval/reviewer-provider.mjs').then(() => console.log('ok'))"` prints `ok`
- Each fixture keeps a non-empty diff through `filterDiff`, checked by a test in `npm test --prefix .github/actions/ai-reviewer`
- The config validates with telemetry off: `npx --yes promptfoo@0.124.1 validate -c .github/actions/ai-reviewer/eval/promptfooconfig.yaml` (it checks the config's shape and loads the provider, not the assertion types)
- A reviewed pull request leaves the planted diffs out: a `filterDiff` test shows `eval/fixtures/` among the excluded paths
- The app's gates pass: `npm run lint`, `npm run test`, `npx astro check` and `npm run build`

#### Manual Verification:

- The owner runs `npm run eval --prefix .github/actions/ai-reviewer` with their key. All three models return valid JSON for all four cases, and the run's cost shows in its output.
- The default model passes the React, SQL and gate cases' assertions and the clean case's `pass`. If another model does better, `DEFAULT_MODEL` changes to it, and the Implementation Notes record the results and the choice.

**Implementation Note**: The eval's results decide `DEFAULT_MODEL`. Record each model's pass count and the run's cost in the Implementation Notes.

---

## Phase 4: Documents

### Overview

The repository's documents name the one secret, the advisory check, and how to run, evaluate and later require the review.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Keep the rules true. They are:

- CI's one secret is the review's;
- the `review` job is advisory;
- the reviewer lives in its own package, out of the app's ESLint and Tailwind scan;
- how to test, run and evaluate it.

**Contract**:

- **The CI bullet (`:68`):** the `review` job of `ai-review.yml`, its one secret, `OPENROUTER_API_KEY`, and that Cloudflare tokens and Supabase keys still stay out of GitHub.
- **The ruleset bullet (`:72`):** `review` is advisory and outside the ruleset.
- **Commands:** `npm test` / `npm run typecheck` / `npm run review` / `npm run eval` with `--prefix .github/actions/ai-reviewer`. Note that the app's `npm run test` and the hooks don't reach it, while CI's `ci` job does.
- **Architecture:** the folder's own lockfile, written with the pinned npm, and Node's erasable-only TypeScript.

#### 2. The other documents

**File**: `README.md`, `context/deployment/deploy-plan.md`, `context/foundation/infrastructure.md`, `context/foundation/test-plan.md`

**Intent**: Each statement that CI has no secrets gets its exception, and the runbook says how to manage the key and the check.

**Contract**:

- **`README.md:106`**: the CI section names the `review` job and its secret.
- **`deploy-plan.md`:**
  - a section "AI review (ci-cd-code-review)": the dedicated OpenRouter key and its credit limit, adding and rotating the secret, what a red `review` means, and how to make `review` required through the ruleset API or settings, as for `e2e`. Before it's required, the `ai-cr:review` re-run moves to its own workflow or job name: a failed `review` run stays on its commit beside later runs, and how a ruleset weighs them is undocumented;
  - line `:310` names the exception.
- **`infrastructure.md:85`**: the review key is CI's one secret.
- **`test-plan.md`:** a §4 Stack row for the reviewer and promptfoo, with a `checked:` date, and a §5 Quality Gates row: `AI code review | CI (review job) | advisory | …`.

### Success Criteria:

#### Automated Verification:

- Reviewed, not mechanical: no document still says CI has no secrets without the exception. `git grep -nE "no (repository )?secrets|holds no secrets|Nothing goes into GitHub" -- CLAUDE.md README.md context/foundation context/deployment` lists only lines that also name the review's secret, or lines about the `smoke` or `e2e` job alone
- The documents are formatted: `npx prettier --check README.md context/deployment/deploy-plan.md context/foundation/infrastructure.md context/foundation/test-plan.md`
- The app's gates pass: `npm run lint`, `npm run test`, `npx astro check` and `npm run build`

#### Manual Verification:

- The owner reads the deploy plan's new section and finds the key, secret and ruleset steps clear

**Implementation Note**: After this phase, the pull request carries the whole change. The owner merges it once `ci`, `smoke` and `e2e` are green and the review has run on it.

---

## Testing Strategy

### Unit Tests:

- `filterDiff`: excluded roots, renames, deletions, binary and quoted paths, an empty result and the byte limit.
- `buildPrompt`: the description and excluded-list caps.
- `parseReview`: scores outside 1–10, non-integers, missing fields.
- `createReviewer`, with the mock model: what is sent, the one retry after a schema-breaking or empty answer, usage and cost.
- The OpenRouter wiring, with a stub `fetch`: the data policy, structured output and token cap in the request body, and the cost read back.
- The CLI's no-call paths: missing key (with the job summary line), missing diff file, nothing to review, too large.
- The workflow's shape: triggers, the job's `if:`, push-only cancelling, timeout, permissions, `persist-credentials: false`, no job-wide `GH_TOKEN`, SHA pins.
- `comment.ts`: a full review, a skipped one, the 50-path cap, the length cap.

### Integration Tests:

- This pull request's own `review` runs on the ready push, a later push, and an added `ai-cr:review`.
- CI's `ci` job runs the reviewer's tests and type check.

### Manual Testing Steps:

1. Create the key with a credit limit, add the secret, and mark the PR ready. Check the comment, the label and the job summary's cost.
2. Push a commit and check the same comment is edited.
3. Add `ai-cr:review` and check the re-run and the label's removal.
4. Add an unrelated label during a run and check the review isn't cancelled.
5. Run `npm run eval` and record each model's results.

## Performance Considerations

- **Job time:** about 7–11 s of `npm ci` (cached by `setup-node` after the first run), plus one model call bounded at 120 s. The job's limit is 10 minutes.
- **Diff size:** the filtered diff is 27 KB at the median and 724 KB at the max (research §5), held in memory once.
- **Model time:** a cheap model's call on a median diff is expected to take seconds. It's measured in Phase 2's first run.

## Migration Notes

No data changes. The one new state is the repository secret and three labels.

To roll back:

- delete `.github/workflows/ai-review.yml`, or
- remove the secret, so the job fails visibly without blocking merges, since it isn't required.

## References

- Research: `context/changes/ci-cd-code-review/research.md`
- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Templates: `.claude/config-templates/m5l2-review-schema.ts.template`, `m5l3-review.yml.template`, `m5l3-action.yml.template`, `m5l3-promptfooconfig.yaml.template`
- Prompts: `.claude/prompts/m5l2-agent.md`, `m5l3-cicd.md`, `m5l3-promptfoo.md`
- A check made required after a trial: `context/archive/2026-10-02-testing-critical-browser-flows/plan.md:325`, `:815`

## Implementation Notes

### Phase 1

- **Base:** before Phase 1's commit, the branch moved onto `main` at `cb9d42a`, after PRs #57 and #58 merged. No Progress SHA existed yet.
- **#6, usage:** a retried review counts both calls.
  - The invalid call's tokens come from `NoObjectGeneratedError.usage`, or from the result for `NoOutputGeneratedError`. Its cost comes from OpenRouter's `usage.raw.cost`.
  - If any part is unknown, the total cost is left out, never under-reported.
- **#6, retry:** a score that `parseReview` refuses is an invalid answer as well, so it gets the one retry, and two such answers give no review. The plan's list named only the SDK's two errors.
- **#6, failures:**
  - The SDK's own `maxRetries` (default 2) still retries temporary API errors within one call. "None after any other error" concerns the reviewer's own retry.
  - A failure becomes a named `ReviewFailedError`, with the original as its `cause`. The CLI prints it as one line of at most 1,000 characters.
- **#7, skips:** the skip verdicts and their summaries are a pure `skipOf(filtered)` in `diff.ts` (lessons: decisions in tested services), tested at 1,000,000 and 1,000,001 UTF-8 bytes. The CLI only wires it.
- **#7, the key:** the CLI filters the diff before reading the key. A PR with nothing to review passes without `OPENROUTER_API_KEY`, since a verdict can be given without a model call. So a missing secret shows only on PRs that change reviewed paths.
- **#7, the diff source:**
  - A `DIFF_FILE` that is set but empty fails, instead of falling back to stdin.
  - Stdin on a terminal fails with a usage hint.
  - An existing empty file is an empty diff, so "nothing to review".
- **#7, redaction:** every line the CLI prints replaces the key (8 characters or more) with `[OPENROUTER_API_KEY]`. A test has the stubbed model echo the key to prove it.
- **#4, paths:**
  - A pure rename or copy takes its new path from the `rename to` or `copy to` line.
  - An unquoted `---`/`+++` name drops the TAB that git appends after a name containing a space.
  - CRLF lines are handled.
  - A section whose path can't be read is kept and reviewed, never dropped.
- **#2, the lockfile:** it pins `ai` 7.0.142, the version the plan review verified; `^7.0.142` alone would now resolve 7.0.143, published 2026-10-16. It was written with npm 11.16.0.
- **#8, tests:** two CLI cases beyond the plan: `DIFF_FILE=""` fails, and a full review against a stubbed OpenRouter answer. Every spawned CLI runs with the reviewer's variables stripped and a `data:` URL `--import` preload that replaces `fetch`, so no test reaches the network.
- **Exports for Phase 2:**
  - `review-schema.ts`: `SCORE_KEYS`, `InvalidReviewError`;
  - `diff.ts`: `skipOf` and its types;
  - `prompt.ts`: `MAX_BODY_CHARS`, `MAX_LISTED_PATHS`;
  - `reviewer.ts`: `ReviewFailedError`, `usageText`.

  The comment can then reuse the 50-path cap and the usage line.

### Phase 2

- **The comment's commit:** the comment names the commit it reviewed (`For commit abc1234.` in its footer, from `REVIEWED_COMMIT`, the pull request's head SHA), and a value that isn't a commit SHA fails the step.
  - A run without a verdict leaves the previous comment and label in place, and the plan doesn't clear them. The commit in the comment shows they describe an older commit, beside the red check.
  - Added after Phase 2's implementation reported the gap.
- **`prompt.ts` (Phase 1):** two private helpers are exported for `comment.ts` rather than copied (lessons: define helpers once):
  - `shown` became `pathOnOneLine`;
  - the surrogate-safe cut moved into `cutAt(text, max)`.

  Behaviour is unchanged.

- **The workflow's steps:** the template's "Comment and label" became three steps:
  - "Write the comment" runs `comment.ts`, which loads the reviewer's packages, holds no token, and writes the job summary before any `gh` call.
  - "Post the comment" and "Label the pull request" are the only steps with `GH_TOKEN`.
- **The workflow's conditions:**
  - The comment and label steps run on the default `success()` with `if: steps.review.outputs.verdict != ''`, not the template's `always() && …`, so a run a push cancels posts nothing. The shape test pins that no step uses `always()`.
  - `defaults.run.shell: bash` gives the run steps `pipefail`, and `GH_REPO` lets `gh` work without a git remote.
- **The comment search:**
  - It keeps comments by `github-actions[bot]` whose body starts with the marker (`startswith`, not the plan's "contains"), so a comment that only quotes the marker never matches.
  - The marker enters the jq filter as a JSON string literal, since gh's `--jq` takes no `--arg`.
  - The first id comes from `${ids%%$'\n'*}`, not `head`, which could SIGPIPE `gh` under `pipefail`.
  - An id that isn't digits fails the step (lessons: never read an unreadable answer as missing).
- **Labels:** each has a description. `ai-cr:review` is blue (`1D76DB`), since the plan gave colours only for passed and failed.
- **The comment's length:** cutting the summary alone can't guarantee GitHub's 65,536-character limit, so two things back it up:
  - each listed path shows at most 300 UTF-16 units, then "…";
  - `renderComment` throws when everything but the summary already breaks the limit, so nothing over it is ever posted.
- **Checking the review file:** `comment.ts` checks the review file with zod. A file that's missing, isn't JSON or isn't a review gives one stderr line and exit 1, never a comment.
- **Rendering details:**
  - a path's code span uses a fence longer than any backtick run in it;
  - a skipped review's footer says no model was asked;
  - an empty summary is named as such;
  - there's no `<details>` when nothing was left out.
- **Names:** the action's step id is `review` (the template's is `agent`).
- **The lockfile:** the `yaml` devDependency is `^2.9.1`, written with npm 11.16.0. The lockfile adds only `node_modules/yaml` as dev, and `ai` stays 7.0.142.
- **Unverified until the manual steps:** that `gh pr edit --remove-label` ignores a label the PR doesn't carry, and that gh's gojq takes the filter. Steps 2.7–2.10 exercise both.

### Phase 3

- **`run.mjs`:**
  - It doesn't run `npx` by name. It runs `process.execPath` with npm's own `npx-cli.js` (the one beside `npm_execpath`, else the one bundled with this Node), never through a shell. On Windows Node can't spawn `npx` without a shell, and a shell would re-read the arguments it passes through.
  - The config path is absolute, so the command works from any directory.
  - It sets `PROMPTFOO_DISABLE_TELEMETRY` and `PROMPTFOO_DISABLE_UPDATE`, lets promptfoo handle Ctrl+C, and exits with promptfoo's code.
- **tsconfig (Phase 1 #2):** besides adding `eval` to `include`, as the plan promised, it sets `allowJs` and `checkJs`. Without them `include` does nothing for `.mjs`. With them, `npm run typecheck` checks the provider's and `run.mjs`'s calls into `src/` through JSDoc types.
- **The provider's id** is `ai-reviewer:<model>`, not promptfoo's default `file://reviewer-provider.mjs`. promptfoo groups its token summary by id, so the default would add the three models up as one.
- **The cost line:** the provider logs one line per review through promptfoo's logger, with the model, tokens and cost, since promptfoo's terminal output shows no cost. That makes criterion 3.6's "the run's cost shows in its output" true.
- **How failures come back** (lessons: never read an unreadable answer as missing). Each of these returns promptfoo's `error`, never an output an assertion could grade:
  - a diff that `skipOf` would decide without a model, nothing to review or too large;
  - a missing key, or vars that aren't text;
  - a failed review.

  A `config.model` that isn't an id makes the constructor throw, so `validate` and the eval stop before any case.

- **The config:**
  - It has a placeholder prompt (`raw: "{{title}}"`), since promptfoo refuses a config without one, and the provider ignores it.
  - Each rubric names its flaws concretely, because the grader sees only the review's JSON and the rubric, never the diff.
  - Each case carries a PR's `title` and `body`.
  - The planted flaws are listed in the config's header, never in the diffs.
- **The fixtures:** each is real `git diff` output from a scratch repository.
  - The gate-bypass and clean-refactor diffs are made against the real `rossmann.ts`, `rossmann.test.ts` and `shop-values.ts` at 54557d7.
  - None holds `{{`, `{%` or `{#` (promptfoo renders vars as Nunjucks templates), a CR or a raw no-break space.
- **The React fixture:**
  - It migrates `package.json`, `index.jsx` (`createRoot`), `App.jsx`, `PriceTicker.jsx` and its test (Enzyme to Testing Library), and `setupTests.js`.
  - Its three flaws are all in `PriceTicker`: an effect without cleanup, hooks after an early return, and `defaultProps` on a function component.
  - The app's own use triggers the second and third flaws, and the migrated tests don't fail on any of them.
- **Tests:**
  - Criterion 3.4 was already covered by `test/diff.test.ts:32`.
  - `test/eval.test.ts`:
    - every case's diff is a fixture, and every fixture is used;
    - each fixture keeps all its sections through `filterDiff` (3.2);
    - a PR diff that adds the four fixtures next to the provider leaves the fixtures out whole and keeps the provider.
  - `test/reviewer-provider.test.ts`: 10 tests with a stub global `fetch`, covering the request, the output, tokens, cost and log line, and every `error` path.
- **The type comment in `reviewer.ts` (Phase 1):** `Usage`'s doc now says that OpenRouter's provider reads a missing token count as 0, so through OpenRouter only the cost can be unknown. It used to say no count is ever 0.
- **Known before the owner's run:**
  - **Brevity:** the system prompt asks for a 2–3 sentence summary, so a model could fail the React rubric (all three flaws named and explained) for brevity rather than for missing a flaw. The lesson's rule is to run the eval before changing the prompt, so the owner's results decide.
  - **No cache for the reviews:** promptfoo caches only built-in providers, so each run asks the three models again. That's 12 reviews (up to 24 calls with retries), plus the grader's calls.
  - **Telemetry:** with telemetry off, promptfoo 0.124.1 still sends one "telemetry disabled" event.

### Phase 4

- **CLAUDE.md:** the plan's "Architecture" note became a bullet under "Tooling and repository conventions", after the CI bullet, since the Architecture section describes the app. Two Commands bullets follow `npx playwright test`:
  - the reviewer's install, tests and type check;
  - its local review and eval, with the rule to run the eval before changing the prompt or the model.

  The CI bullet and README's CI section also name the reviewer's tests and type check in the `ci` job, which `ci.yml` runs since Phase 2.

- **The deploy plan's runbook** moves the `ai-cr:review` re-run out of `ai-review.yml` (whose triggers then lose `labeled`) and into a workflow of its own whose job isn't named `review`. The plan said "its own workflow or job name", but either change alone leaves F3's hazard:
  - a new job name inside `ai-review.yml` keeps the `labeled` trigger, so another label still adds a skipped `review` run;
  - a separate workflow whose job is still named `review` adds `review` results to the commit again.
- **One more caveat, from Phase 4's report:** a commit pushed while its pull request was a draft carries a skipped `review` run before the real review runs on the same commit. The runbook names it, and asks for a failing review on a throwaway pull request that was a draft before `review` is added to the ruleset.
- **The runbook, beyond the plan's list:**
  - handling the key for local runs (`read -rs`, then `unset`, as for the owner's links);
  - each no-verdict `ai-reviewer:` line and what to do;
  - a red step after the verdict;
  - taking `ai-cr:review` off before adding it again;
  - switching the review off;
  - what a required check costs (no bypass, hotfixes wait).
- **test-plan.md:** the §4 and §5 rows fit the tables' existing column widths, so Prettier left the rest of the tables alone. Details that didn't fit are in CLAUDE.md's Commands. The §4 Version column holds `ai`'s 7.0.142, with promptfoo 0.124.1 in Notes.
- **Criterion 4.1, read:** the grep's remaining lines are:
  - `CLAUDE.md`'s CI bullet, which names `OPENROUTER_API_KEY` in the same bullet;
  - `test-plan.md`'s line about the `e2e` job;
  - the deploy plan's Phase 2 checklist (2026-09-23) and its lines about Worker versions or the probe Worker, none about CI.
- **The cost figures** in the documents are research §6's estimates, until steps 1.12, 2.7 and 3.6 measure a real run.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The reviewer, run locally

#### Automated

- [x] 1.1 The reviewer installs from its lockfile: `npm ci --prefix .github/actions/ai-reviewer` — dc74e2f
- [x] 1.2 The reviewer's tests pass: `npm test --prefix .github/actions/ai-reviewer` — dc74e2f
- [x] 1.3 The reviewer type-checks: `npm run typecheck --prefix .github/actions/ai-reviewer` — dc74e2f
- [x] 1.4 Making `filterDiff` keep `context/` turns its tests red, and restoring it turns them green again — dc74e2f
- [x] 1.5 Making `parseReview` accept an 11 turns its tests red, and restoring it turns them green again — dc74e2f
- [x] 1.6 ESLint ignores the folder: `npx eslint --print-config .github/actions/ai-reviewer/src/review.ts` reports the file as ignored, and `npm run lint` passes — dc74e2f
- [x] 1.7 The app's unit suite passes: `npm run test` — dc74e2f
- [x] 1.8 Types check and leave the folder out: `npx astro sync && npx astro check` passes, and `npx tsc -p tsconfig.json --listFilesOnly` lists no file under `.github/` — dc74e2f
- [x] 1.9 The build passes: `npm run build` — dc74e2f
- [x] 1.10 The app's dependencies are untouched: `git diff --exit-code origin/main -- package.json package-lock.json` — dc74e2f
- [x] 1.11 Tailwind's scan leaves the folder out: `git grep -nF '@source not "../../.github/actions/ai-reviewer"' -- src/styles/global.css` finds the line — dc74e2f

#### Manual

- [ ] 1.12 With the owner's key exported, `git diff origin/main...HEAD | npm run review --prefix .github/actions/ai-reviewer` prints a JSON review with six integer scores, a verdict and a summary, and a stderr line with the model, tokens and cost

### Phase 2: The review in CI

#### Automated

- [x] 2.1 The comment's tests pass with the reviewer's: `npm test --prefix .github/actions/ai-reviewer` — 54557d7
- [x] 2.2 Every action the new workflow and action use is pinned by SHA: `git grep -nE "uses: [^ ]+@v[0-9]" -- .github/workflows/ai-review.yml .github/actions/ai-reviewer/action.yml` prints nothing — 54557d7
- [x] 2.3 The workflow's shape test passes: the trigger, the job's `if:` skipping drafts and other labels, the job-level concurrency that cancels only on `synchronize`, the timeout, permissions, `persist-credentials: false`, no job-wide `GH_TOKEN`, and SHA pins, in `npm test --prefix .github/actions/ai-reviewer` — 54557d7
- [x] 2.4 The app's gates pass: `npm run lint`, `npm run test`, `npx astro check` and `npm run build` — 54557d7
- [x] 2.5 CI only: CI's `ci` job runs the reviewer's install, tests and type check, and passes — 54557d7
- [x] 2.6 CI only: the `review` job is skipped on the draft pull request — 54557d7

#### Manual

- [ ] 2.7 The owner creates an OpenRouter key with a credit limit (about $5), adds it as the repository secret `OPENROUTER_API_KEY`, and marks the pull request ready. The `review` check then runs, one comment appears with the scores, summary, left-out paths, model and cost, and the PR gets `ai-cr:passed` or `ai-cr:failed`.
- [ ] 2.8 A further push edits the same comment rather than adding one.
- [ ] 2.9 Adding `ai-cr:review` reviews the PR again and removes the label.
- [ ] 2.10 Adding an unrelated label while a review runs leaves that review running.
- [ ] 2.11 `ci`, `smoke` and `e2e` stay green throughout, and the ruleset is unchanged.

### Phase 3: promptfoo evals

#### Automated

- [x] 3.1 The provider module loads without a model call: `node -e "import('./.github/actions/ai-reviewer/eval/reviewer-provider.mjs').then(() => console.log('ok'))"` prints `ok` — 9efb655
- [x] 3.2 Each fixture keeps a non-empty diff through `filterDiff`, checked by a test in `npm test --prefix .github/actions/ai-reviewer` — 9efb655
- [x] 3.3 The config validates with telemetry off: `npx --yes promptfoo@0.124.1 validate -c .github/actions/ai-reviewer/eval/promptfooconfig.yaml` (it checks the config's shape and loads the provider, not the assertion types) — 9efb655
- [x] 3.4 A reviewed pull request leaves the planted diffs out: a `filterDiff` test shows `eval/fixtures/` among the excluded paths — 9efb655
- [x] 3.5 The app's gates pass: `npm run lint`, `npm run test`, `npx astro check` and `npm run build` — 9efb655

#### Manual

- [ ] 3.6 The owner runs `npm run eval --prefix .github/actions/ai-reviewer` with their key. All three models return valid JSON for all four cases, and the run's cost shows in its output.
- [ ] 3.7 The default model passes the React, SQL and gate cases' assertions and the clean case's `pass`. If another model does better, `DEFAULT_MODEL` changes to it, and the Implementation Notes record the results and the choice.

### Phase 4: Documents

#### Automated

- [x] 4.1 Reviewed, not mechanical: no document still says CI has no secrets without the exception. `git grep -nE "no (repository )?secrets|holds no secrets|Nothing goes into GitHub" -- CLAUDE.md README.md context/foundation context/deployment` lists only lines that also name the review's secret, or lines about the `smoke` or `e2e` job alone
- [x] 4.2 The documents are formatted: `npx prettier --check README.md context/deployment/deploy-plan.md context/foundation/infrastructure.md context/foundation/test-plan.md`
- [x] 4.3 The app's gates pass: `npm run lint`, `npm run test`, `npx astro check` and `npm run build`

#### Manual

- [ ] 4.4 The owner reads the deploy plan's new section and finds the key, secret and ruleset steps clear
