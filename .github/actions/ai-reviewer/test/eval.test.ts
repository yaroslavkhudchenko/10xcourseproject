// The eval's planted diffs (eval/fixtures/): the cases in eval/promptfooconfig.yaml send each of them once, the reviewer
// sends each to the model whole, neither leaving a file out nor deciding it without a model, and a pull request that
// adds them leaves them out of its own review, though each holds a diff of its own.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { filterDiff, skipOf } from "../src/diff.ts";

interface EvalConfig {
  tests: { description: string; vars: Record<string, unknown> }[];
}

const EVAL = join(import.meta.dirname, "../eval");
// Where the fixtures are in the repository, as a pull request's diff names them.
const FIXTURES_PATH = ".github/actions/ai-reviewer/eval/fixtures";

const config = parse(readFileSync(join(EVAL, "promptfooconfig.yaml"), "utf8")) as EvalConfig;
const fixtures = readdirSync(join(EVAL, "fixtures"))
  .filter((name) => name.endsWith(".diff"))
  .sort();
const fixture = (name: string) => readFileSync(join(EVAL, "fixtures", name), "utf8");

/** A new file's section, as `git diff` writes it: every line of the file after a "+". */
function added(path: string, content: string): string {
  const lines = (content.endsWith("\n") ? content.slice(0, -1) : content).split("\n");
  return (
    `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${path}\n` +
    `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}\n`).join("")}`
  );
}

describe("the eval's planted diffs", () => {
  it("are sent by the cases, each by one", () => {
    assert.ok(fixtures.length > 0, "no fixture found");
    assert.deepEqual(
      config.tests.map(({ vars }) => vars.diff).sort(),
      fixtures.map((name) => `file://fixtures/${name}`),
    );
  });

  for (const name of fixtures) {
    it(`sends ${name} to the model whole, leaving no file out`, () => {
      const diff = fixture(name);
      const filtered = filterDiff(diff);
      assert.deepEqual(filtered.excluded, []);
      assert.equal(filtered.kept, diff);
      // Neither nothing to review nor too large, so the model reviews it.
      assert.equal(skipOf(filtered), null);
    });
  }

  it("stay out of the review of a pull request that adds them, though each holds a diff of its own", () => {
    const provider = added(".github/actions/ai-reviewer/eval/reviewer-provider.mjs", "export default class {}\n");
    const planted = fixtures.map((name) => {
      const path = `${FIXTURES_PATH}/${name}`;
      return { path, section: added(path, fixture(name)) };
    });
    const result = filterDiff(provider + planted.map(({ section }) => section).join(""));
    assert.equal(result.kept, provider);
    assert.deepEqual(
      result.excluded,
      planted.map(({ path, section }) => ({ path, bytes: Buffer.byteLength(section) })),
    );
  });
});
