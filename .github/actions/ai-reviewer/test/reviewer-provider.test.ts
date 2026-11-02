// The eval's provider (eval/reviewer-provider.mjs), with no network: a stub fetch stands in for OpenRouter, and each
// test starts with a key of its own, so one exported in the shell never reaches it. The provider reviews a case as the
// command line reviews a pull request, and a case that gets no review comes back as promptfoo's `error`, never as an
// output an assertion could pass.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import ReviewerProvider from "../eval/reviewer-provider.mjs";
import { buildPrompt } from "../src/prompt.ts";
import type { Review } from "../src/review-schema.ts";
import { DEFAULT_MODEL, usageText } from "../src/reviewer.ts";

const REVIEW: Review = {
  implementationCorrectness: 3,
  idiomaticity: 6,
  complexity: 7,
  testRiskCoverage: 5,
  documentation: 6,
  securitySafety: 2,
  verdict: "fail",
  summary: "The query is built from the request's text. Bind its values as parameters.",
};

const DIFF =
  "diff --git a/src/app.ts b/src/app.ts\nindex 1111111..2222222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n" +
  "@@ -1 +1 @@\n-old\n+new\n";
const CASE = { title: "Add a thing", body: "Why it's needed.", diff: DIFF };

/** OpenRouter's answer, with `content` as the model's message, and its usage with its cost. */
function completion(content: string) {
  return {
    id: "gen-test",
    object: "chat.completion",
    created: 1760000000,
    model: "test/model",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290, cost: 0.00321 },
  };
}

const realFetch = globalThis.fetch;
const realKey = process.env.OPENROUTER_API_KEY;
/** What each request asked OpenRouter for: its model, and its last message, the review's. */
let requests: { model: unknown; message: unknown }[] = [];
let answer = () => Response.json(completion(JSON.stringify(REVIEW)));

beforeEach(() => {
  requests = [];
  answer = () => Response.json(completion(JSON.stringify(REVIEW)));
  process.env.OPENROUTER_API_KEY = "sk-or-v1-a-test-key";
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model: unknown; messages: { content: unknown }[] };
    requests.push({ model: body.model, message: body.messages.at(-1)?.content });
    return answer();
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = realKey;
});

/** The provider as promptfoo makes it for a provider entry whose `config.model` is `model`. */
const providerFor = (model: unknown) => new ReviewerProvider({ config: { basePath: "eval", model } });

describe("the eval's provider", () => {
  it("reviews the case as the command line does, giving the review's JSON, its tokens and its cost", async () => {
    const logged: string[] = [];
    const result = await providerFor("test/model").callApi("promptfoo's prompt, unread", {
      vars: CASE,
      logger: { info: (line) => logged.push(line) },
    });
    assert.deepEqual(result, {
      output: JSON.stringify(REVIEW),
      tokenUsage: { prompt: 1234, completion: 56, total: 1290 },
      cost: 0.00321,
    });
    assert.deepEqual(requests, [{ model: "test/model", message: buildPrompt({ ...CASE, excluded: [] }) }]);
    const usage = usageText({ inputTokens: 1234, outputTokens: 56, cost: 0.00321 });
    assert.deepEqual(logged, [`ai-reviewer: "Add a thing" reviewed with test/model: ${usage}`]);
  });

  it("leaves out a cost OpenRouter doesn't tell, never giving it as 0", async () => {
    answer = () => {
      const { cost: _, ...usage } = completion("").usage;
      return Response.json({ ...completion(JSON.stringify(REVIEW)), usage });
    };
    assert.deepEqual(await providerFor("test/model").callApi("", { vars: CASE }), {
      output: JSON.stringify(REVIEW),
      tokenUsage: { prompt: 1234, completion: 56, total: 1290 },
    });
  });

  it("names its model in its id, and reviews with the reviewer's DEFAULT_MODEL when its config names none", () => {
    assert.equal(providerFor("test/model").id(), "ai-reviewer:test/model");
    assert.equal(providerFor(undefined).id(), `ai-reviewer:${DEFAULT_MODEL}`);
    assert.equal(new ReviewerProvider().id(), `ai-reviewer:${DEFAULT_MODEL}`);
  });

  it("refuses a model that isn't an id, so no case runs with it", () => {
    for (const model of ["", " ", 7, ["test/model"]]) {
      assert.throws(() => providerFor(model), /config\.model must be an OpenRouter model id/);
    }
  });

  for (const [why, diff] of [
    ["a diff of only left-out paths", DIFF.replaceAll("src/app.ts", "context/notes.md")],
    ["an empty diff", ""],
  ] as const) {
    it(`gives an error, and asks no model, for ${why}, which the command line decides without one`, async () => {
      const result = await providerFor("test/model").callApi("", { vars: { ...CASE, diff } });
      assert.ok("error" in result, "a verdict without a model is no review of the model's");
      assert.match(result.error, /^ai-reviewer: the case's diff gets no model review: Nothing to review/);
      assert.deepEqual(requests, []);
    });
  }

  it("gives an error, and asks no model, without a key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    assert.deepEqual(await providerFor("test/model").callApi("", { vars: CASE }), {
      error: "ai-reviewer: OPENROUTER_API_KEY is empty: export OPENROUTER_API_KEY=<your key> first",
    });
    assert.deepEqual(requests, []);
  });

  it("gives an error, and asks no model, for vars it can't read", async () => {
    for (const context of [{ vars: { title: "No diff" } }, { vars: { ...CASE, title: 7 } }, {}, undefined]) {
      assert.deepEqual(await providerFor("test/model").callApi("", context), {
        error: "ai-reviewer: the case's vars need a diff, and any title and body, as text",
      });
    }
    assert.deepEqual(requests, []);
  });

  it("gives an error, never an output, when the model's answers are no review", async () => {
    answer = () => Response.json(completion("Looks good!"));
    const result = await providerFor("test/model").callApi("", { vars: CASE });
    assert.ok("error" in result);
    assert.match(result.error, /^ai-reviewer: test\/model gave no valid review in 2 attempts: /);
    assert.equal(requests.length, 2);
  });

  it("gives an error, never an output, when the call fails", async () => {
    answer = () =>
      Response.json({ error: { message: "No endpoints found matching your data policy", code: 404 } }, { status: 404 });
    const result = await providerFor("test/model").callApi("", { vars: CASE });
    assert.ok("error" in result);
    assert.match(result.error, /^ai-reviewer: the call to test\/model failed: /);
    assert.equal(requests.length, 1);
  });
});
