<!-- PLAN-REVIEW-REPORT -->

# Plan Review: An AI code review on every pull request

- **Plan**: `context/changes/ci-cd-code-review/plan.md`
- **Mode**: Deep
- **Date**: 2026-10-17
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 4 warnings, 3 observations, all fixed in the plan

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | FAIL    |

## Grounding

8 of 8 existing paths the plan modifies are present, and `.github/actions/` is new, as planned. All 7 cited symbols and lines match: `eslint.config.js:238`, `global.css:4-8`, `ci.yml:24`, test plan §4 and §5, `README.md:106`, `CLAUDE.md:68`/`:72`, `deploy-plan.md:310`, `infrastructure.md:85`. Brief↔plan ✓.

## Verification

One worker checked the riskiest claims offline and against public evidence. Its probe files are in the session's scratch folder.

- **Job-level concurrency:** a job skipped by its `if:` doesn't join a job-level group. This was observed in public repositories (track-your-regions #966, ai-rpg-stage #16) and isn't documented.
- **setup-node's cache path:** for a local action, `github.action_path` holds `/./`, which the bundled `@actions/glob` 0.7.0 refuses.
- **checkout v7.0.1** persists the job token by default.
- **AI SDK 7 and the OpenRouter provider 3** behave as the plan says:
  - `MockLanguageModelV4` drives `ToolLoopAgent`;
  - a schema violation throws `NoObjectGeneratedError` after one call, and an empty answer throws `NoOutputGeneratedError` when `.output` is read;
  - a stub `fetch` captured `provider.require_parameters`, `provider.data_collection: "deny"`, a `json_schema` `response_format` and `max_tokens: 8000`;
  - `finalStep.providerMetadata.openrouter.usage.cost` carries the cost.
- **promptfoo 0.124.1** has `validate`. It loads a `.mjs` provider natively, but registers tsx for the whole process.

## Findings

### F1 — The action's npm cache path breaks setup-node

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — 1. The composite action
- **Detail**: `cache-dependency-path: ${{ github.action_path }}/package-lock.json` resolves to `<workspace>/./.github/actions/ai-reviewer/package-lock.json` for a local action. setup-node's glob refuses the `/./` ("Relative pathing '.' and '..' is not allowed") and fails the step, so no review would run.
- **Fix**: `cache-dependency-path: .github/actions/ai-reviewer/package-lock.json`, relative to the workspace.
- **Decision**: FIXED

### F2 — The job token reaches code that doesn't need it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — 1. The composite action, 3. The workflow
- **Detail**: checkout persists the job token (`pull-requests` and `issues` write) for later steps, and the template sets `GH_TOKEN` job-wide. So the `npm ci` of third-party packages, and the reviewer that also holds the OpenRouter key, could read it.
- **Fix**: `persist-credentials: false`, `GH_TOKEN` only on the steps that call `gh`, and `npm ci --ignore-scripts`.
- **Decision**: FIXED

### F3 — A re-review on the same commit leaves the old result showing

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — 3. The workflow; Phase 4 — the deploy plan
- **Detail**:
  - Each `ai-cr:review` or `reopened` run is a new check suite, so an earlier failed or cancelled `review` run stays on the commit, and the PR's rollup can stay red after a passing re-review (observed on cozystack).
  - With `cancel-in-progress: true`, a label re-run that cancels an in-flight review also adds a cancelled run.
- **Fix**:
  - cancel in progress only on `synchronize`;
  - the plan names the label and the comment as the review's record;
  - the runbook moves the label re-run to its own workflow before `review` is made required.
  - Strength: keeps the requirement's label re-run, and no cancelled runs come from labels.
  - Tradeoff: two quick pushes may both run to completion, which costs cents.
  - Confidence: HIGH — the job-level behaviour was observed in three public repositories.
  - Blind spot: how a native ruleset weighs a failed run followed by a passing one is undocumented.
- **Decision**: FIXED

### F4 — The "no verdict" paths are incomplete

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — 6, 7, 8; Phase 2 — 3
- **Detail**:
  - The failure reason existed only on the reviewer's stderr, so the summary step had nothing to read.
  - An empty answer throws `NoOutputGeneratedError` when `.output` is read, which the plan didn't retry.
  - A missing diff file must be an error, never "nothing to review" (lessons: never read an unreadable answer as missing).
- **Fix**:
  - the CLI also appends its failure line to `$GITHUB_STEP_SUMMARY`;
  - both SDK errors count as an invalid answer, with one retry;
  - a missing diff file exits 1;
  - tests cover each.
- **Decision**: FIXED

### F5 — No test proves what reaches OpenRouter

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — 6, 8
- **Detail**: The mock model skips `createOpenRouter`, so nothing checked the data policy, the structured output or the token cap in the request.
- **Fix**: `createReviewer` takes an optional `fetch`. A test with a stub `fetch` asserts the request body's `provider.require_parameters`, `provider.data_collection: "deny"`, `json_schema` `response_format` and `max_tokens: 8000`, and that the stub's `usage.cost` comes back as the cost.
- **Decision**: FIXED

### F6 — The eval runs the reviewer through tsx, not Node

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — 1, criterion 3.3
- **Detail**: promptfoo registers tsx for the whole process while probing default configs. The eval therefore loads syntax that plain Node refuses, which the worker showed with an `enum`.
- **Fix**: Phase 3 says the eval isn't the type-stripping proof; CI's `npm test` and `typecheck` are. Criterion 3.3 notes that `validate` doesn't check assertion types.
- **Decision**: FIXED

### F7 — The comment's marker and author

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — 2, 3
- **Detail**:
  - The marker was defined in `comment.ts` and again in the workflow (lessons: define shared constants once).
  - Any workflow's `GITHUB_TOKEN` comment is by `github-actions[bot]`.
  - `gh api --paginate --jq` filters page by page.
- **Fix**:
  - `comment.ts` owns the marker, and the workflow reads it from the rendered first line;
  - the search keeps the bot's comments that contain the marker, page by page, and takes the first id;
  - the comment is posted with `-F body=@<file>`.
- **Decision**: FIXED

### F8 — Two criteria needed a reader, and the Tailwind line went unchecked

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 criteria, Phase 2 criterion 2.3, Phase 4 criterion 4.1
- **Fix**:
  - a reviewer test parses `ai-review.yml` with a `yaml` devDependency and asserts the trigger, the job's `if:`, push-only cancelling, the timeout, permissions, `persist-credentials: false`, no job-wide `GH_TOKEN` and the SHA pins (Phase 2 #5, criterion 2.3);
  - a `git grep` checks the Tailwind line (criterion 1.11);
  - criterion 4.1 is marked reviewed, not mechanical.
- **Decision**: FIXED

## Triage

- **Fixed:** F1, F2, F3, F4, F5, F6, F7 and F8 (8).
- **Verdict after fixes:** SOUND.
