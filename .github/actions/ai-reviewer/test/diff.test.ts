// What the reviewer reads of a diff: the paths it leaves out, the forms git writes a path in, and the byte limit. The
// sections below are in the forms git 2's `git diff` writes, as a scratch repository showed: a name with a space ends
// its `---`/`+++` line with a tab, a name with other special characters is quoted C-style, and a binary, mode-only or
// unchanged-content move has no `---`/`+++` lines at all. Each excluded form is checked under context/, so a path read
// wrongly would show as a kept section.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import { filterDiff, MAX_REVIEW_BYTES, skipOf } from "../src/diff.ts";

/** A modified file's section, as `git diff` writes it for a path without special characters. */
function modified(path: string, hunk = "@@ -1 +1 @@\n-old\n+new\n"): string {
  return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n${hunk}`;
}

/** A new file's section of exactly `bytes` bytes, all ASCII. */
function addedOfBytes(path: string, bytes: number): string {
  const head =
    `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..1111111\n` +
    `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+`;
  return `${head}${"x".repeat(bytes - head.length - 1)}\n`;
}

const kept = (diff: string) => filterDiff(diff).kept;
const excludedPaths = (diff: string) => filterDiff(diff).excluded.map(({ path }) => path);

describe("filterDiff, the paths the review leaves out", () => {
  for (const path of [
    ".claude/skills/10x-plan/SKILL.md",
    "context/changes/ci-cd-code-review/plan.md",
    "src/lib/services/shops/fixtures/hebe-search.json",
    ".github/actions/ai-reviewer/eval/fixtures/sql-injection.diff",
    "package-lock.json",
    ".github/actions/ai-reviewer/package-lock.json",
  ]) {
    it(`leaves out ${path}, with its section's bytes`, () => {
      const section = modified(path);
      assert.deepEqual(filterDiff(section), {
        kept: "",
        excluded: [{ path, bytes: Buffer.byteLength(section) }],
        keptBytes: 0,
      });
    });
  }

  it("keeps every other file byte for byte, in the diff's order, beside the files it leaves out", () => {
    const app = modified("src/lib/app.ts");
    const readme = modified("README.md", "@@ -1,2 +1,2 @@\n # Title\n-old\n+new — é\n");
    const diff = app + modified("context/notes.md") + readme + modified("package-lock.json");
    const result = filterDiff(diff);
    assert.equal(result.kept, app + readme);
    assert.equal(result.keptBytes, Buffer.byteLength(app + readme));
    assert.deepEqual(
      result.excluded.map(({ path }) => path),
      ["context/notes.md", "package-lock.json"],
    );
  });

  it("keeps paths that only look like the left-out ones", () => {
    const paths = [
      "src/context/notes.ts",
      "contexts/notes.md",
      "src/lib/services/shops/fixtures.ts",
      ".github/actions/ai-reviewer/src/diff.ts",
      "my-package-lock.json",
      "package-lock.json.md",
    ];
    const diff = paths.map((path) => modified(path)).join("");
    assert.equal(kept(diff), diff);
    assert.deepEqual(excludedPaths(diff), []);
  });

  it("counts a rename into context/ by its new path", () => {
    const rename =
      "diff --git a/src/lib/old.ts b/context/archive/old.ts\nsimilarity index 100%\n" +
      "rename from src/lib/old.ts\nrename to context/archive/old.ts\n";
    assert.deepEqual(excludedPaths(rename), ["context/archive/old.ts"]);
    assert.equal(kept(rename), "");
  });

  it("keeps a rename out of context/, changes and all", () => {
    const rename =
      "diff --git a/context/draft.ts b/src/lib/draft.ts\nsimilarity index 85%\nrename from context/draft.ts\n" +
      "rename to src/lib/draft.ts\nindex 1111111..2222222 100644\n--- a/context/draft.ts\n+++ b/src/lib/draft.ts\n" +
      "@@ -1 +1 @@\n-old\n+new\n";
    assert.equal(kept(rename), rename);
    assert.deepEqual(excludedPaths(rename), []);
  });

  it("counts a deletion by its old path", () => {
    const deletion = (path: string) =>
      `diff --git a/${path} b/${path}\ndeleted file mode 100644\nindex 1111111..0000000\n` +
      `--- a/${path}\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n`;
    assert.deepEqual(excludedPaths(deletion("context/gone.md")), ["context/gone.md"]);
    assert.equal(kept(deletion("src/gone.ts")), deletion("src/gone.ts"));
  });

  it("reads a binary or mode-only section's path from its header, a name with spaces included", () => {
    const binary =
      "diff --git a/context/shots/before after.png b/context/shots/before after.png\nnew file mode 100644\n" +
      "index 0000000..badc806\nBinary files /dev/null and b/context/shots/before after.png differ\n";
    const modeOnly = "diff --git a/context/run.sh b/context/run.sh\nold mode 100644\nnew mode 100755\n";
    assert.deepEqual(excludedPaths(binary + modeOnly), ["context/shots/before after.png", "context/run.sh"]);
  });

  it("drops the tab git ends an unquoted name holding a space with", () => {
    const spaced =
      "diff --git a/context/my notes.md b/context/my notes.md\nindex 1111111..2222222 100644\n" +
      "--- a/context/my notes.md\t\n+++ b/context/my notes.md\t\n@@ -1 +1 @@\n-old\n+new\n";
    assert.deepEqual(excludedPaths(spaced), ["context/my notes.md"]);
  });

  it("unquotes a quoted path before matching it, its octal bytes and C escapes included", () => {
    const quoted =
      'diff --git "a/context/caf\\303\\251.md" "b/context/caf\\303\\251.md"\nindex 1111111..2222222 100644\n' +
      '--- "a/context/caf\\303\\251.md"\n+++ "b/context/caf\\303\\251.md"\n@@ -1 +1 @@\n-old\n+new\n';
    const escaped =
      'diff --git "a/context/a\\"b\\\\c\\td.md" "b/context/a\\"b\\\\c\\td.md"\nnew file mode 100644\n' +
      'index 0000000..1111111\n--- /dev/null\n+++ "b/context/a\\"b\\\\c\\td.md"\n@@ -0,0 +1 @@\n+new\n';
    const binary =
      'diff --git "a/context/caf\\303\\251.png" "b/context/caf\\303\\251.png"\nindex 1111111..2222222 100644\n' +
      'Binary files "a/context/caf\\303\\251.png" and "b/context/caf\\303\\251.png" differ\n';
    assert.deepEqual(excludedPaths(quoted + escaped + binary), [
      "context/café.md",
      'context/a"b\\c\td.md',
      "context/café.png",
    ]);
  });

  it("keeps a section whose path it can't read, never dropping it", () => {
    const odd = "diff --git a/context/x.md\nindex 1111111..2222222 100644\n@@ -1 +1 @@\n-old\n+new\n";
    const badQuote = 'diff --git "a/context/x\\q.md" "b/context/x\\q.md"\nold mode 100644\nnew mode 100755\n';
    assert.equal(kept(odd + badQuote), odd + badQuote);
  });

  it("reads a section's path from its header lines only, never from a hunk line that looks like one", () => {
    const tricky = modified("src/lib/app.ts", "@@ -1,2 +1,2 @@\n--- a/context/x.md\n+++ b/context/x.md\n");
    assert.equal(kept(tricky), tricky);
  });

  it("reads a diff with CRLF line ends", () => {
    const crlf = modified("package-lock.json").replaceAll("\n", "\r\n");
    assert.deepEqual(excludedPaths(crlf), ["package-lock.json"]);
  });

  it("keeps text before the first section, which git diff doesn't write", () => {
    const diff = `notes\n${modified("context/notes.md")}`;
    assert.equal(kept(diff), "notes\n");
  });

  it("gives nothing for an empty diff", () => {
    assert.deepEqual(filterDiff(""), { kept: "", excluded: [], keptBytes: 0 });
  });
});

describe("skipOf, the verdict a diff gives without a model", () => {
  it("passes an empty diff, saying it's empty", () => {
    assert.deepEqual(skipOf(filterDiff("")), {
      verdict: "pass",
      summary: "Nothing to review: the diff is empty.",
      skipped: "nothing-to-review",
    });
    assert.equal(skipOf(filterDiff("\n \n"))?.skipped, "nothing-to-review");
  });

  it("passes a diff that changes only left-out paths, naming them", () => {
    const skip = skipOf(filterDiff(modified("context/notes.md") + modified(".claude/x.md")));
    assert.ok(skip !== null);
    assert.equal(skip.verdict, "pass");
    assert.equal(skip.skipped, "nothing-to-review");
    assert.match(skip.summary, /^Nothing to review: .*`context\/`.*`package-lock\.json`/);
  });

  it(`sends a kept diff of exactly ${MAX_REVIEW_BYTES} bytes to the model`, () => {
    const diff = addedOfBytes("src/big.ts", MAX_REVIEW_BYTES);
    assert.equal(filterDiff(diff).keptBytes, MAX_REVIEW_BYTES);
    assert.equal(skipOf(filterDiff(diff)), null);
  });

  it("fails a kept diff one byte over the limit, unreviewed, saying to split it or review it by hand", () => {
    const skip = skipOf(filterDiff(addedOfBytes("src/big.ts", MAX_REVIEW_BYTES + 1)));
    assert.ok(skip !== null);
    assert.equal(skip.verdict, "fail");
    assert.equal(skip.skipped, "too-large");
    assert.match(skip.summary, /^Not reviewed: the diff left to review is 1,000,001 bytes, over .* 1,000,000 bytes\./);
    assert.match(skip.summary, /Split the pull request, or review it by hand\./);
  });

  it("counts the limit in UTF-8 bytes, not characters", () => {
    // "é" is one character in two bytes, so each diff below is one byte longer than it has characters.
    const atLimit = addedOfBytes("src/big.ts", MAX_REVIEW_BYTES - 1).replace("+x", "+é");
    const overLimit = addedOfBytes("src/big.ts", MAX_REVIEW_BYTES).replace("+x", "+é");
    assert.equal(filterDiff(atLimit).keptBytes, MAX_REVIEW_BYTES);
    assert.equal(skipOf(filterDiff(atLimit)), null);
    assert.equal(overLimit.length, MAX_REVIEW_BYTES);
    assert.equal(skipOf(filterDiff(overLimit))?.skipped, "too-large");
  });

  it("doesn't count the left-out files toward the limit", () => {
    const diff = addedOfBytes("context/huge.md", 2 * MAX_REVIEW_BYTES) + modified("src/lib/app.ts");
    assert.equal(skipOf(filterDiff(diff)), null);
  });
});
