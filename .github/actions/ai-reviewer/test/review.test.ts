// The command line, spawned as the action runs it. Each run starts from this process's environment without the
// reviewer's variables, so an OPENROUTER_API_KEY exported in the shell never reaches it, and Node loads a module first
// that replaces fetch: with NO_NETWORK every request fails and says so on stderr, and the one review below gets a
// canned OpenRouter answer. No run reaches the network.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_REVIEW_BYTES } from "../src/diff.ts";
import type { Review } from "../src/review-schema.ts";
import { DEFAULT_MODEL } from "../src/reviewer.ts";

const CLI = fileURLToPath(new URL("../src/review.ts", import.meta.url));
const KEY = "sk-or-v1-a-test-key-that-is-never-printed";
const NETWORK_CALL = "test: a network call to";
const VARIABLES = [
  "OPENROUTER_API_KEY",
  "REVIEW_MODEL",
  "PR_TITLE",
  "PR_BODY",
  "DIFF_FILE",
  "GITHUB_STEP_SUMMARY",
  "NODE_OPTIONS",
  "NODE_TEST_CONTEXT",
];

/** A module for Node to load before the command, as a data: URL. */
const preload = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;

const NO_NETWORK = preload(
  `globalThis.fetch = async (input) => { console.error(${JSON.stringify(NETWORK_CALL)} + " " + String(input)); ` +
    `throw new Error("the tests reach no network"); };`,
);

const SRC_DIFF =
  "diff --git a/src/app.ts b/src/app.ts\nindex 1111111..2222222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n" +
  "@@ -1 +1 @@\n-old\n+new\n";
const CONTEXT_DIFF = SRC_DIFF.replaceAll("src/app.ts", "context/notes.md");

const REVIEW: Review = {
  implementationCorrectness: 8,
  idiomaticity: 7,
  complexity: 9,
  testRiskCoverage: 6,
  documentation: 7,
  securitySafety: 10,
  verdict: "pass",
  summary: "Solid change.",
};

let dir = "";
before(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-reviewer-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function run(env: Record<string, string>, { input = "", preloaded = NO_NETWORK } = {}) {
  const inherited = { ...process.env };
  for (const name of VARIABLES) delete inherited[name];
  const child = spawnSync(process.execPath, ["--import", preloaded, CLI], {
    env: { ...inherited, ...env },
    input,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

describe("the command line, spawned", () => {
  for (const [why, key] of [
    ["unset", undefined],
    ["empty, as GitHub passes a missing secret", ""],
  ] as const) {
    it(`fails with the key ${why}: one line on stderr, also appended to the job summary, and nothing on stdout`, () => {
      const summary = file(`summary-${key === undefined ? "unset" : "empty"}.md`, "## Earlier step\n");
      const result = run({
        ...(key === undefined ? {} : { OPENROUTER_API_KEY: key }),
        DIFF_FILE: file("app.diff", SRC_DIFF),
        GITHUB_STEP_SUMMARY: summary,
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      const lines = result.stderr.split("\n").filter((line) => line !== "");
      assert.equal(lines.length, 1);
      assert.match(
        lines[0] ?? "",
        /^ai-reviewer: OPENROUTER_API_KEY is empty: .*repository secret OPENROUTER_API_KEY.*export OPENROUTER_API_KEY=/,
      );
      assert.equal(readFileSync(summary, "utf8"), `## Earlier step\n${lines[0]}\n`);
    });
  }

  it("fails on a diff file that's missing, never reading it as nothing to review", () => {
    const result = run({ OPENROUTER_API_KEY: KEY, DIFF_FILE: join(dir, "missing.diff") });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /^ai-reviewer: can't read the diff file DIFF_FILE names, .*missing\.diff \(ENOENT\)\n$/,
    );
  });

  it("fails on a DIFF_FILE that names no file, rather than reading stdin", () => {
    const result = run({ OPENROUTER_API_KEY: KEY, DIFF_FILE: "" }, { input: CONTEXT_DIFF });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^ai-reviewer: DIFF_FILE is set but names no file/);
  });

  it("passes a diff of only context/, read from stdin, as nothing to review, with no key and no model call", () => {
    const result = run({}, { input: CONTEXT_DIFF });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(output.verdict, "pass");
    assert.equal(output.skipped, "nothing-to-review");
    assert.match(String(output.summary), /^Nothing to review: /);
    assert.deepEqual(output.excluded, [{ path: "context/notes.md", bytes: Buffer.byteLength(CONTEXT_DIFF) }]);
    assert.ok(!result.stderr.includes(NETWORK_CALL));
  });

  it("fails a diff over the limit as too large, unreviewed, with no model call", () => {
    const big =
      "diff --git a/src/big.ts b/src/big.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/big.ts\n@@ -0,0 +1 @@\n" +
      `+${"x".repeat(MAX_REVIEW_BYTES)}\n`;
    const result = run({ OPENROUTER_API_KEY: KEY, DIFF_FILE: file("big.diff", big) });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(output.verdict, "fail");
    assert.equal(output.skipped, "too-large");
    assert.match(String(output.summary), /^Not reviewed: .*Split the pull request, or review it by hand\.$/);
    assert.ok(!result.stderr.includes(NETWORK_CALL));
  });

  it("prints a review with its model, usage and left-out paths, and the run's line on stderr, never the key", () => {
    // A summary that echoes the key shows that nothing printed holds it.
    const content = JSON.stringify({ ...REVIEW, summary: `Solid change. ${KEY}` });
    const completion = {
      id: "gen-test",
      object: "chat.completion",
      created: 1760000000,
      model: DEFAULT_MODEL,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290, cost: 0.00321 },
    };
    const openRouter = preload(
      `globalThis.fetch = async (input) => { if (String(input) !== "https://openrouter.ai/api/v1/chat/completions") ` +
        `throw new Error("unexpected request"); return Response.json(${JSON.stringify(completion)}); };`,
    );
    const result = run(
      {
        OPENROUTER_API_KEY: KEY,
        REVIEW_MODEL: "",
        PR_TITLE: "Add a thing",
        PR_BODY: "Why it's needed.",
        DIFF_FILE: file("mixed.diff", SRC_DIFF + CONTEXT_DIFF),
      },
      { preloaded: openRouter },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ...REVIEW,
      summary: "Solid change. [OPENROUTER_API_KEY]",
      model: DEFAULT_MODEL,
      usage: { inputTokens: 1234, outputTokens: 56, cost: 0.00321 },
      excluded: [{ path: "context/notes.md", bytes: Buffer.byteLength(CONTEXT_DIFF) }],
    });
    assert.equal(
      result.stderr,
      `ai-reviewer: reviewed with ${DEFAULT_MODEL}: 1234 input and 56 output tokens, cost $0.003210\n`,
    );
    assert.ok(!result.stdout.includes(KEY) && !result.stderr.includes(KEY));
  });
});
