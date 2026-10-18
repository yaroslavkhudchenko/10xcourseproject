// The review workflow's and the composite action's safety-relevant settings, read from the files GitHub reads, so a
// later edit can't quietly undo them: what starts a review and what skips one, the concurrency only a push cancels, the
// timeout and the job token's permissions, a checkout that leaves no token behind, the token only on the steps that
// call gh, untrusted text only through env, and every action pinned to a commit.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  shell?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

interface Workflow {
  on?: unknown;
  permissions?: unknown;
  concurrency?: unknown;
  env?: Record<string, unknown>;
  jobs: Record<string, { [setting: string]: unknown; env?: Record<string, unknown>; steps: Step[] }>;
}

interface Action {
  inputs: Record<string, { required?: boolean; default?: string }>;
  runs: { using: string; steps: Step[] };
}

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const LOCAL_ACTION = "./.github/actions/ai-reviewer";

const workflow = parse(readFileSync(join(import.meta.dirname, "../../../workflows/ai-review.yml"), "utf8")) as Workflow;
const action = parse(readFileSync(join(import.meta.dirname, "../action.yml"), "utf8")) as Action;
const job = workflow.jobs.review;
const steps = job?.steps ?? [];

/** Whether env names the job's token, under its own name or gh's, or as the expression that gives it. */
function holdsToken(env: Record<string, unknown> | undefined): boolean {
  return Object.entries(env ?? {}).some(
    ([name, value]) => /^(GH|GITHUB)_TOKEN$/.test(name) || /github\.token|secrets\.GITHUB_TOKEN/.test(String(value)),
  );
}

const callsGh = (step: Step) => /(^|[\s;&|(])gh (api|label|pr)\b/m.test(step.run ?? "");

const runsReviewer = (step: Step) =>
  step.uses === LOCAL_ACTION || (step.run ?? "").includes(".github/actions/ai-reviewer/");

describe("the review workflow, .github/workflows/ai-review.yml", () => {
  it("runs only on pull requests to main, opened, pushed to, reopened, marked ready or labelled", () => {
    assert.deepEqual(workflow.on, {
      pull_request: { branches: ["main"], types: ["opened", "synchronize", "reopened", "ready_for_review", "labeled"] },
    });
  });

  it("has one job, review, which skips a draft and every label but ai-cr:review", () => {
    assert.deepEqual(Object.keys(workflow.jobs), ["review"]);
    assert.equal(
      job?.if,
      "github.event.pull_request.draft == false && " +
        "(github.event.action != 'labeled' || github.event.label.name == 'ai-cr:review')",
    );
  });

  it("keeps its concurrency on the job, where a skipped run joins no group, and lets only a push cancel a review", () => {
    assert.equal(workflow.concurrency, undefined);
    assert.deepEqual(job?.concurrency, {
      group: "ai-review-${{ github.event.pull_request.number }}",
      "cancel-in-progress": "${{ github.event.action == 'synchronize' }}",
    });
  });

  it("stops after 10 minutes, with only the three permissions it needs", () => {
    assert.equal(job?.["timeout-minutes"], 10);
    assert.deepEqual(workflow.permissions, { contents: "read", "pull-requests": "write", issues: "write" });
    assert.equal(job?.permissions, undefined);
  });

  it("checks out the full history and leaves no token behind for the later steps", () => {
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    assert.ok(checkout, "no checkout step");
    assert.equal(checkout.with?.["fetch-depth"], 0);
    assert.equal(checkout.with?.["persist-credentials"], false);
  });

  it("holds no token workflow- or job-wide, and gives it only to the steps that call gh, none running the reviewer", () => {
    assert.ok(!holdsToken(workflow.env), "the workflow's env holds the token");
    assert.ok(!holdsToken(job?.env), "the job's env holds the token");
    assert.ok(steps.filter(callsGh).length >= 2, "no step calls gh");
    for (const step of steps) {
      assert.equal(holdsToken(step.env), callsGh(step), `step "${step.name ?? step.uses}"`);
      if (runsReviewer(step)) assert.ok(!holdsToken(step.with), `step "${step.name ?? step.uses}" passes the token`);
    }
    assert.ok(steps.filter(runsReviewer).length >= 2, "no step runs the reviewer");
  });

  it("reviews with the repository's OpenRouter key and the pull request's own title, description and diff", () => {
    assert.deepEqual(steps.find((step) => step.uses === LOCAL_ACTION)?.with, {
      "api-key": "${{ secrets.OPENROUTER_API_KEY }}",
      "pr-title": "${{ github.event.pull_request.title }}",
      "pr-body": "${{ github.event.pull_request.body }}",
      "diff-file": "${{ runner.temp }}/pr.diff",
    });
  });

  it("comments and labels only once a verdict exists, never in a cancelled run, and gates on the verdict last", () => {
    const review = steps.findIndex((step) => step.uses === LOCAL_ACTION);
    assert.ok(review > 0, "no review step");
    const later = steps.slice(review + 1, -1);
    assert.ok(later.length >= 3, "no steps between the review and the gate");
    for (const step of later) assert.equal(step.if, "steps.review.outputs.verdict != ''", `step "${step.name}"`);
    for (const step of steps) assert.ok(!/always\(\)/.test(step.if ?? ""), `step "${step.name}" runs when cancelled`);
    assert.match(steps.at(-1)?.run ?? "", /^test "\$VERDICT" = pass /);
  });

  it("names the pull request's head commit in the comment it writes", () => {
    const write = steps.find((step) => step.name === "Write the comment");
    assert.equal(write?.env?.REVIEWED_COMMIT, "${{ github.event.pull_request.head.sha }}");
  });
});

describe("the composite action, .github/actions/ai-reviewer/action.yml", () => {
  const actionSteps = action.runs.steps;

  it("installs only the reviewer's runtime dependencies, running no package's install script", () => {
    assert.equal(action.runs.using, "composite");
    const install = actionSteps.find((step) => step.run?.includes("npm ci"));
    assert.ok(install, "no install step");
    assert.match(install.run ?? "", /--omit=dev/);
    assert.match(install.run ?? "", /--ignore-scripts/);
  });

  it("caches npm by a lockfile path relative to the workspace, which setup-node's glob accepts", () => {
    const setupNode = actionSteps.find((step) => step.uses?.startsWith("actions/setup-node@"));
    assert.ok(setupNode, "no setup-node step");
    assert.equal(setupNode.with?.["node-version"], 24);
    const lockfile = setupNode.with?.["cache-dependency-path"];
    assert.equal(lockfile, ".github/actions/ai-reviewer/package-lock.json");
    assert.ok(existsSync(join(REPO_ROOT, lockfile)), `${lockfile} doesn't exist`);
  });

  it("passes its inputs to the reviewer through env, under the names review.ts reads", () => {
    assert.deepEqual(actionSteps.find((step) => step.id === "review")?.env, {
      OPENROUTER_API_KEY: "${{ inputs.api-key }}",
      PR_TITLE: "${{ inputs.pr-title }}",
      PR_BODY: "${{ inputs.pr-body }}",
      DIFF_FILE: "${{ inputs.diff-file }}",
      REVIEW_MODEL: "${{ inputs.model }}",
    });
    // An empty model leaves the choice to DEFAULT_MODEL in reviewer.ts, defined there only.
    assert.equal(action.inputs.model?.default, "");
  });

  it("gives every script step bash, which a composite action needs", () => {
    for (const step of actionSteps.filter((step) => step.run !== undefined)) {
      assert.equal(step.shell, "bash", `step "${step.name}"`);
    }
  });
});

describe("both files", () => {
  const allSteps = [...steps, ...action.runs.steps];

  it("pass untrusted text, and every other value, to scripts only through env, never into a script", () => {
    for (const step of allSteps) assert.ok(!(step.run ?? "").includes("${{"), `step "${step.name}"`);
  });

  it("pin every action but the local one to a 40-character commit SHA", () => {
    const uses = allSteps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]));
    assert.ok(uses.length >= 3, "too few actions found");
    for (const use of uses.filter((use) => use !== LOCAL_ACTION)) assert.match(use, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });
});
