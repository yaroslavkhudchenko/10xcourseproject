// The one message a review sends: each part in its tag, the description cut to MAX_BODY_CHARS, and the left-out paths
// listed up to MAX_LISTED_PATHS, so the model knows what it doesn't see.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrompt, MAX_BODY_CHARS, MAX_LISTED_PATHS } from "../src/prompt.ts";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n";

/** The text between `<tag>` and `</tag>` lines. */
function tagged(prompt: string, tag: string): string {
  const match = new RegExp(`\\n<${tag}>\\n([\\s\\S]*?)\\n</${tag}>\\n`).exec(prompt);
  assert.ok(match, `the prompt has no <${tag}> part`);
  return match[1] ?? "";
}

const excludedPaths = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ path: `context/${i}.md`, bytes: i }));

describe("buildPrompt, the message a review sends", () => {
  it("puts the title, the description, the left-out paths and the kept diff each in its own tag", () => {
    const prompt = buildPrompt({
      title: "Add the AI review",
      body: "Why:\n- cheaper reviews",
      diff: DIFF,
      excluded: [{ path: "context/plan.md", bytes: 1234 }],
    });
    assert.equal(tagged(prompt, "title"), "Add the AI review");
    assert.equal(tagged(prompt, "description"), "Why:\n- cheaper reviews");
    assert.match(tagged(prompt, "left-out-paths"), /\n- context\/plan\.md \(1234 bytes\)$/);
    assert.equal(`${tagged(prompt, "diff")}\n`, DIFF);
  });

  it("says when there's no title, no description or nothing left out", () => {
    const prompt = buildPrompt({ title: " ", body: "", diff: DIFF, excluded: [] });
    assert.equal(tagged(prompt, "title"), "(no title)");
    assert.equal(tagged(prompt, "description"), "(no description)");
    assert.match(tagged(prompt, "left-out-paths"), /^None/);
  });

  it(`sends a description of ${MAX_BODY_CHARS} characters whole`, () => {
    const body = "a".repeat(MAX_BODY_CHARS);
    assert.equal(tagged(buildPrompt({ title: "t", body, diff: DIFF, excluded: [] }), "description"), body);
  });

  it(`cuts a longer description at ${MAX_BODY_CHARS} characters, and says so`, () => {
    const body = `${"a".repeat(MAX_BODY_CHARS)}TAIL`;
    const description = tagged(buildPrompt({ title: "t", body, diff: DIFF, excluded: [] }), "description");
    assert.equal(
      description,
      `${"a".repeat(MAX_BODY_CHARS)}\n[The description is cut here, at ${MAX_BODY_CHARS} characters.]`,
    );
  });

  it("cuts before a surrogate pair rather than through it", () => {
    const body = `${"a".repeat(MAX_BODY_CHARS - 1)}😀 and more`;
    const description = tagged(buildPrompt({ title: "t", body, diff: DIFF, excluded: [] }), "description");
    assert.ok(description.startsWith(`${"a".repeat(MAX_BODY_CHARS - 1)}\n[The description is cut here`));
  });

  it(`lists ${MAX_LISTED_PATHS} left-out paths by name`, () => {
    const excluded = excludedPaths(MAX_LISTED_PATHS);
    const listed = tagged(buildPrompt({ title: "t", body: "", diff: DIFF, excluded }), "left-out-paths");
    assert.equal(listed.split("\n").filter((line) => line.startsWith("- context/")).length, MAX_LISTED_PATHS);
    assert.doesNotMatch(listed, /more$/);
  });

  it(`lists the first ${MAX_LISTED_PATHS} left-out paths of more, then how many more there are`, () => {
    const excluded = excludedPaths(MAX_LISTED_PATHS + 3);
    const listed = tagged(buildPrompt({ title: "t", body: "", diff: DIFF, excluded }), "left-out-paths");
    const lines = listed.split("\n");
    assert.equal(lines.filter((line) => line.startsWith("- context/")).length, MAX_LISTED_PATHS);
    assert.ok(lines.includes(`- context/${MAX_LISTED_PATHS - 1}.md (${MAX_LISTED_PATHS - 1} bytes)`));
    assert.ok(!listed.includes(`context/${MAX_LISTED_PATHS}.md`));
    assert.equal(lines.at(-1), "- and 3 more");
  });

  it("shows a path holding a line break on one line", () => {
    const listed = tagged(
      buildPrompt({ title: "t", body: "", diff: DIFF, excluded: [{ path: "context/a\nb.md", bytes: 1 }] }),
      "left-out-paths",
    );
    assert.match(listed, /\n- "context\/a\\nb\.md" \(1 bytes\)$/);
  });
});
