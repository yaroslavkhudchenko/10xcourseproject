// The pull request's comment: the marker on its first line, what it shows of a review and of a verdict given without a
// model, the 50-path cap, and GitHub's length limit, to which only the summary gives way. The command line is spawned
// on the review file the reviewer's own command line writes, and on files that aren't a review, which must never give
// a comment.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMENT_MARKER, MAX_COMMENT_CHARS, MAX_PATH_CHARS, parseReviewOutput, renderComment } from "../src/comment.ts";
import type { ReviewOutput } from "../src/comment.ts";
import { MAX_LISTED_PATHS } from "../src/prompt.ts";
import { InvalidReviewError } from "../src/review-schema.ts";
import type { Review } from "../src/review-schema.ts";
import { usageText } from "../src/reviewer.ts";

const CLI = fileURLToPath(new URL("../src/comment.ts", import.meta.url));
const REVIEW_CLI = fileURLToPath(new URL("../src/review.ts", import.meta.url));
// The reviewer's variables, so none exported in the shell reaches a spawned command.
const VARIABLES = [
  "OPENROUTER_API_KEY",
  "REVIEW_MODEL",
  "PR_TITLE",
  "PR_BODY",
  "DIFF_FILE",
  "GITHUB_STEP_SUMMARY",
  "REVIEWED_COMMIT",
  "NODE_OPTIONS",
  "NODE_TEST_CONTEXT",
];

const REVIEW: Review = {
  implementationCorrectness: 8,
  idiomaticity: 7,
  complexity: 9,
  testRiskCoverage: 6,
  documentation: 7,
  securitySafety: 10,
  verdict: "fail",
  summary: "Solid change, but `filterDiff` misses a case.\n\nAdd a test for it.",
};

/** A review file as the command line prints it after a model's review. */
const REVIEWED = {
  ...REVIEW,
  model: "z-ai/glm-5.3",
  usage: { inputTokens: 1234, outputTokens: 56, cost: 0.00321 },
  excluded: [
    { path: "context/plan.md", bytes: 12345 },
    { path: "package-lock.json", bytes: 678 },
  ],
} satisfies ReviewOutput;

/** A review file as the command line prints it when nothing is left to review. */
const NOTHING_TO_REVIEW = {
  verdict: "pass",
  summary: "Nothing to review: this pull request changes only paths the AI review leaves out.",
  skipped: "nothing-to-review",
  excluded: [{ path: "context/notes.md", bytes: 97 }],
} satisfies ReviewOutput;

const CONTEXT_DIFF =
  "diff --git a/context/notes.md b/context/notes.md\nindex 1111111..2222222 100644\n--- a/context/notes.md\n" +
  "+++ b/context/notes.md\n@@ -1 +1 @@\n-old\n+new\n";

const excludedPaths = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ path: `context/${i}.md`, bytes: i }));

const lines = (comment: string) => comment.split("\n");

/** The comment's left-out paths' lines. */
const listedLines = (comment: string) => lines(comment).filter((line) => line.startsWith("- "));

let dir = "";
before(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-reviewer-comment-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function run(args: string[], input = "", variables: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const name of VARIABLES) delete env[name];
  Object.assign(env, variables);
  const child = spawnSync(process.execPath, args, { env, input, encoding: "utf8", timeout: 60_000 });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

describe("renderComment, the pull request's comment", () => {
  it("starts with the marker, an HTML comment GitHub doesn't show, on a line of its own", () => {
    assert.match(COMMENT_MARKER, /^<!--[^\n]*-->$/);
    for (const output of [REVIEWED, NOTHING_TO_REVIEW]) {
      assert.equal(lines(renderComment(output))[0], COMMENT_MARKER);
    }
  });

  it("shows a review's verdict, its six scores in the requirements' order, its summary, left-out paths and usage", () => {
    const comment = renderComment(REVIEWED);
    assert.equal(lines(comment)[1], "## AI code review: fail");
    assert.deepEqual(
      lines(comment).filter((line) => /^\| .* \| \d+\/10 \|$/.test(line)),
      [
        "| Implementation correctness | 8/10 |",
        "| Idiomaticity | 7/10 |",
        "| Complexity | 9/10 |",
        "| Test / risk coverage | 6/10 |",
        "| Documentation | 7/10 |",
        "| Security and safety | 10/10 |",
      ],
    );
    assert.ok(comment.includes(`\n\n${REVIEW.summary}\n\n`));
    assert.match(comment, /\n<details>\n<summary>2 files left out of the review<\/summary>\n\n/);
    assert.deepEqual(listedLines(comment), ["- `context/plan.md` (12,345 bytes)", "- `package-lock.json` (678 bytes)"]);
    assert.ok(
      comment.endsWith(`\n\n</details>\n\n<sub>Reviewed by \`z-ai/glm-5.3\`: ${usageText(REVIEWED.usage)}.</sub>\n`),
    );
  });

  it("says unknown for the tokens and cost no call told", () => {
    const comment = renderComment({ ...REVIEWED, usage: { inputTokens: undefined, outputTokens: undefined } });
    assert.match(comment, /: unknown input and unknown output tokens, cost unknown\.<\/sub>\n$/);
  });

  it("names the reviewed commit in the footer by its first seven characters, with or without a model", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    assert.ok(
      renderComment(REVIEWED, sha).endsWith(
        `\n\n<sub>For commit \`0123456\`. Reviewed by \`z-ai/glm-5.3\`: ${usageText(REVIEWED.usage)}.</sub>\n`,
      ),
    );
    assert.ok(
      renderComment(NOTHING_TO_REVIEW, sha).endsWith(
        "\n\n<sub>For commit `0123456`. No model was asked, so no tokens and no cost.</sub>\n",
      ),
    );
  });

  it("refuses a reviewed commit that isn't a commit SHA", () => {
    for (const commit of ["main", "012345", "ABCDEF1", "0123456 ", "0".repeat(41)]) {
      assert.throws(() => renderComment(REVIEWED, commit), /^Error: the reviewed commit isn't a commit SHA: /);
    }
  });

  it("leaves the scores out of a verdict given without a model, and says no model was asked", () => {
    const comment = renderComment(NOTHING_TO_REVIEW);
    assert.equal(lines(comment)[1], "## AI code review: pass");
    assert.ok(!comment.includes("| Criterion |"));
    assert.ok(comment.includes(`\n\n${NOTHING_TO_REVIEW.summary}\n\n`));
    assert.deepEqual(listedLines(comment), ["- `context/notes.md` (97 bytes)"]);
    assert.ok(comment.endsWith("\n\n<sub>No model was asked, so no tokens and no cost.</sub>\n"));
  });

  it("shows a too-large diff's fail without scores, and leaves the left-out section out when nothing was left out", () => {
    const comment = renderComment({
      verdict: "fail",
      summary: "Not reviewed: the diff left to review is over the AI review's limit.",
      skipped: "too-large",
      excluded: [],
    });
    assert.equal(lines(comment)[1], "## AI code review: fail");
    assert.ok(!comment.includes("| Criterion |"));
    assert.ok(!comment.includes("<details>"));
    assert.ok(comment.includes("\n\nNot reviewed: the diff left to review is over the AI review's limit.\n\n<sub>"));
  });

  it("says when the review gave no summary", () => {
    assert.ok(renderComment({ ...REVIEWED, summary: " \n" }).includes("\n\n(The review gave no summary.)\n\n"));
  });

  it(`lists ${MAX_LISTED_PATHS} left-out paths by name`, () => {
    const comment = renderComment({ ...REVIEWED, excluded: excludedPaths(MAX_LISTED_PATHS) });
    assert.equal(listedLines(comment).length, MAX_LISTED_PATHS);
    assert.ok(comment.includes(`<summary>${MAX_LISTED_PATHS} files left out of the review</summary>`));
    assert.ok(!comment.includes(" more\n"));
  });

  it(`lists the first ${MAX_LISTED_PATHS} left-out paths of more, then how many more there are`, () => {
    const comment = renderComment({ ...REVIEWED, excluded: excludedPaths(MAX_LISTED_PATHS + 3) });
    const listed = listedLines(comment);
    assert.equal(listed.length, MAX_LISTED_PATHS + 1);
    assert.equal(
      listed[MAX_LISTED_PATHS - 1],
      `- \`context/${MAX_LISTED_PATHS - 1}.md\` (${MAX_LISTED_PATHS - 1} bytes)`,
    );
    assert.ok(!comment.includes(`context/${MAX_LISTED_PATHS}.md`));
    assert.equal(listed.at(-1), "- and 3 more");
    assert.ok(comment.includes(`<summary>${MAX_LISTED_PATHS + 3} files left out of the review</summary>`));
  });

  it("shows each left-out path on one line, in a code span its own backticks can't end", () => {
    const comment = renderComment({
      ...REVIEWED,
      excluded: [
        { path: "context/a\nb.md", bytes: 1 },
        { path: "context/x`y.md", bytes: 2 },
        { path: "`context/z.md", bytes: 3 },
      ],
    });
    assert.deepEqual(listedLines(comment), [
      '- `"context/a\\nb.md"` (1 bytes)',
      "- ``context/x`y.md`` (2 bytes)",
      "- `` `context/z.md `` (3 bytes)",
    ]);
  });

  it(`cuts a left-out path longer than ${MAX_PATH_CHARS} characters, with an ellipsis`, () => {
    const long = `context/${"a".repeat(MAX_PATH_CHARS)}.md`;
    const comment = renderComment({ ...REVIEWED, excluded: [{ path: long, bytes: 1 }] });
    assert.deepEqual(listedLines(comment), [`- \`${long.slice(0, MAX_PATH_CHARS)}…\` (1 bytes)`]);
  });
});

describe("renderComment within GitHub's limit on a comment", () => {
  // The comment's length less its summary's: a one-character summary shows the rest's.
  const rest = (output: ReviewOutput) => renderComment({ ...output, summary: "x" }).length - 1;

  it(`keeps a summary that just fits, at ${MAX_COMMENT_CHARS} characters, whole`, () => {
    const summary = "a".repeat(MAX_COMMENT_CHARS - rest(REVIEWED));
    const comment = renderComment({ ...REVIEWED, summary });
    assert.equal(comment.length, MAX_COMMENT_CHARS);
    assert.ok(comment.includes(`\n\n${summary}\n\n<details>`));
  });

  it("cuts a summary one character longer, says so, and keeps everything after it", () => {
    const comment = renderComment({ ...REVIEWED, summary: "a".repeat(MAX_COMMENT_CHARS - rest(REVIEWED) + 1) });
    assert.equal(comment.length, MAX_COMMENT_CHARS);
    assert.match(
      comment,
      /a\n\n\[The summary is cut here, to fit GitHub's limit on a comment's length\.\]\n\n<details>/,
    );
    assert.ok(comment.endsWith(`${usageText(REVIEWED.usage)}.</sub>\n`));
  });

  it("cuts before a surrogate pair rather than through it", () => {
    for (const extra of [0, 1]) {
      const summary = `${"a".repeat(extra)}${"😀".repeat(MAX_COMMENT_CHARS)}`;
      const comment = renderComment({ ...REVIEWED, summary });
      assert.ok(comment.length <= MAX_COMMENT_CHARS);
      assert.ok(comment.isWellFormed(), "the cut leaves a lone surrogate");
    }
  });

  it("stays within the limit for the most a review file can list: long paths full of backticks, and a long summary", () => {
    const excluded = Array.from({ length: MAX_LISTED_PATHS + 1 }, () => ({
      path: "`".repeat(5 * MAX_PATH_CHARS),
      bytes: Number.MAX_SAFE_INTEGER,
    }));
    const comment = renderComment({ ...REVIEWED, summary: "s".repeat(4 * MAX_COMMENT_CHARS), excluded });
    assert.ok(comment.length <= MAX_COMMENT_CHARS);
    assert.equal(lines(comment)[0], COMMENT_MARKER);
    assert.equal(listedLines(comment).at(-1), "- and 1 more");
    assert.ok(comment.includes("[The summary is cut here"));
  });

  it("refuses, rather than post, a comment whose parts besides the summary break the limit", () => {
    assert.throws(
      () => renderComment({ ...REVIEWED, model: "m".repeat(MAX_COMMENT_CHARS) }),
      /^Error: the comment would be \d+ characters, over GitHub's limit of 65536$/,
    );
  });
});

describe("parseReviewOutput, the review file's check", () => {
  it("reads a review file with a review, and one with a verdict given without a model", () => {
    assert.deepEqual(parseReviewOutput(JSON.parse(JSON.stringify(REVIEWED))), REVIEWED);
    assert.deepEqual(parseReviewOutput(JSON.parse(JSON.stringify(NOTHING_TO_REVIEW))), NOTHING_TO_REVIEW);
  });

  it("reads tokens and a cost the command line left out as unknown, never as 0", () => {
    const output = parseReviewOutput({ ...REVIEW, model: "m", usage: {}, excluded: [] });
    assert.ok(!("skipped" in output));
    assert.deepEqual(output.usage, { inputTokens: undefined, outputTokens: undefined });
  });

  for (const [why, value] of [
    ["a score outside 1 to 10", { ...REVIEWED, complexity: 11 }],
    ["a review without its model", { ...REVIEW, usage: {}, excluded: [] }],
    ["a review without its left-out paths", { ...REVIEW, model: "m", usage: {} }],
    ["a left-out path without its bytes", { ...REVIEWED, excluded: [{ path: "context/a.md" }] }],
    ["a cost that isn't a number", { ...REVIEWED, usage: { inputTokens: 1, outputTokens: 1, cost: "0.1" } }],
    ["a pass given for a diff too large to review", { ...NOTHING_TO_REVIEW, skipped: "too-large" }],
    ["a verdict given without a model for another reason", { ...NOTHING_TO_REVIEW, skipped: "no-key" }],
    ["an answer that isn't an object", "pass"],
    ["nothing", null],
  ] as const) {
    it(`refuses ${why}`, () => {
      assert.throws(() => parseReviewOutput(value), InvalidReviewError);
    });
  }
});

describe("the comment's command line, spawned", () => {
  it("prints the comment for the review file the reviewer's command line writes", () => {
    const review = run([REVIEW_CLI], CONTEXT_DIFF);
    assert.equal(review.status, 0, review.stderr);
    const result = run([CLI, file("nothing.json", review.stdout)]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, renderComment(parseReviewOutput(JSON.parse(review.stdout))));
    assert.ok(result.stdout.startsWith(`${COMMENT_MARKER}\n## AI code review: pass\n`));
    assert.equal(result.stderr, "");
  });

  it("prints the comment for a review file with a model's review", () => {
    const result = run([CLI, file("reviewed.json", JSON.stringify(REVIEWED, null, 2))]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, renderComment(REVIEWED));
  });

  it("names the commit REVIEWED_COMMIT gives, and gives no comment for one that isn't a commit SHA", () => {
    const reviewed = file("reviewed-commit.json", JSON.stringify(REVIEWED));
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const named = run([CLI, reviewed], "", { REVIEWED_COMMIT: sha });
    assert.equal(named.status, 0, named.stderr);
    assert.equal(named.stdout, renderComment(REVIEWED, sha));
    const refused = run([CLI, reviewed], "", { REVIEWED_COMMIT: "main" });
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, "");
    assert.equal(refused.stderr, "ai-reviewer: the reviewed commit isn't a commit SHA: main\n");
  });

  for (const [why, args, stderr] of [
    ["no review file named", [], /^ai-reviewer: usage: node src\/comment\.ts <review\.json>\n$/],
    ["a review file that's missing", ["missing.json"], /^ai-reviewer: can't read the review file: ENOENT/],
    ["a review file that isn't JSON", ["not-json.json"], /^ai-reviewer: the review file .*not-json\.json isn't JSON: /],
    [
      "a review file that isn't a review",
      ["not-a-review.json"],
      /^ai-reviewer: the review file .*not-a-review\.json isn't a review: complexity is 11, not an integer from 1 to 10\n$/,
    ],
  ] as const) {
    it(`fails on ${why}: one line on stderr, nothing on stdout, never a comment`, () => {
      file("not-json.json", "## AI code review: pass\n");
      file("not-a-review.json", JSON.stringify({ ...REVIEWED, complexity: 11 }));
      const result = run([CLI, ...args.map((name) => join(dir, name))]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, stderr);
      assert.equal(result.stderr.split("\n").filter((line) => line !== "").length, 1);
    });
  }
});
