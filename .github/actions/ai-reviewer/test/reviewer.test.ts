// The reviewer's calls, with no network: AI SDK's mock model shows what the agent sends and how it treats each kind of
// answer, and a stub fetch shows what reaches OpenRouter. The SDK asks only once for an answer that is no review, so
// the reviewer asks again once itself, and never after any other error.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { InvalidReviewError, SCORE_KEYS, SYSTEM_PROMPT } from "../src/review-schema.ts";
import type { Review } from "../src/review-schema.ts";
import { createReviewer, DEFAULT_MODEL, ReviewFailedError, usageText } from "../src/reviewer.ts";

const REVIEW: Review = {
  implementationCorrectness: 8,
  idiomaticity: 7,
  complexity: 9,
  testRiskCoverage: 6,
  documentation: 7,
  securitySafety: 10,
  verdict: "pass",
  summary: "Solid change. Add a test for the empty diff.",
};

interface AnswerOptions {
  finish?: "stop" | "length";
  inputTokens?: number;
  outputTokens?: number;
  /** OpenRouter's cost, as its provider metadata carries it. */
  cost?: number;
  /** OpenRouter's cost, as its raw usage carries it. */
  rawCost?: number;
}

/** One answer of the mock model: its text, or none, with its finish reason, its usage and OpenRouter's cost. */
function answer(text: string | null, options: AnswerOptions = {}) {
  const { finish = "stop", inputTokens = 1200, outputTokens = 80, cost, rawCost } = options;
  return {
    content: text === null ? [] : [{ type: "text" as const, text }],
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
      ...(rawCost === undefined ? {} : { raw: { cost: rawCost } }),
    },
    ...(cost === undefined ? {} : { providerMetadata: { openrouter: { usage: { cost } } } }),
    warnings: [],
  };
}

const reviewerOf = (languageModel: MockLanguageModelV4) =>
  createReviewer({ apiKey: "unused", model: "test/model", languageModel });

// Each kind of answer the SDK can't read as the review's object: what it throws, and the answer.
const INVALID_ANSWERS = [
  {
    kind: "JSON that breaks the schema",
    thrown: NoObjectGeneratedError,
    answer: (options: AnswerOptions) => answer(JSON.stringify({ ...REVIEW, verdict: "maybe" }), options),
  },
  {
    kind: "no JSON",
    thrown: NoObjectGeneratedError,
    answer: (options: AnswerOptions) => answer("Looks good!", options),
  },
  {
    kind: "an empty answer",
    thrown: NoObjectGeneratedError,
    answer: (options: AnswerOptions) => answer(null, options),
  },
  {
    kind: "an empty answer cut at the token cap",
    thrown: NoOutputGeneratedError,
    answer: (options: AnswerOptions) => answer(null, { ...options, finish: "length" }),
  },
];

describe("createReviewer, with the mock model", () => {
  it("sends the system prompt as instructions, the message, the review's schema and the 8,000-token cap", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer(JSON.stringify(REVIEW))] });
    await reviewerOf(model).review("Review this.");
    const [call] = model.doGenerateCalls;
    assert.ok(call);
    assert.deepEqual(call.prompt[0], { role: "system", content: SYSTEM_PROMPT });
    assert.equal(call.prompt[1]?.role, "user");
    assert.deepEqual(call.prompt[1].content, [{ type: "text", text: "Review this." }]);
    assert.equal(call.maxOutputTokens, 8000);
    assert.ok(call.responseFormat?.type === "json");
    const schema = call.responseFormat.schema as {
      properties: Record<string, { type?: string; enum?: string[] }>;
      required: string[];
      additionalProperties: boolean;
    };
    const fields = [...SCORE_KEYS, "verdict", "summary"].sort();
    assert.deepEqual(Object.keys(schema.properties).sort(), fields);
    assert.deepEqual([...schema.required].sort(), fields);
    assert.equal(schema.additionalProperties, false);
    for (const key of SCORE_KEYS) assert.equal(schema.properties[key]?.type, "number");
    assert.deepEqual(schema.properties.verdict?.enum, ["pass", "fail"]);
  });

  it("gives the review, its model, and the usage with the cost OpenRouter's metadata carries", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer(JSON.stringify(REVIEW), { cost: 0.0042 })] });
    assert.deepEqual(await reviewerOf(model).review("x"), {
      review: REVIEW,
      usage: { inputTokens: 1200, outputTokens: 80, cost: 0.0042 },
      model: "test/model",
    });
  });

  it("leaves the cost out, never 0, when the metadata carries none", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer(JSON.stringify(REVIEW))] });
    assert.deepEqual((await reviewerOf(model).review("x")).usage, { inputTokens: 1200, outputTokens: 80 });
  });

  for (const invalid of INVALID_ANSWERS) {
    it(`asks once more after ${invalid.kind}, and counts both calls' tokens and cost`, async () => {
      const model = new MockLanguageModelV4({
        doGenerate: [
          invalid.answer({ inputTokens: 1000, outputTokens: 50, cost: 0.25, rawCost: 0.25 }),
          answer(JSON.stringify(REVIEW), { cost: 0.5 }),
        ],
      });
      const run = await reviewerOf(model).review("x");
      assert.equal(model.doGenerateCalls.length, 2);
      assert.deepEqual(run, {
        review: REVIEW,
        usage: { inputTokens: 2200, outputTokens: 130, cost: 0.75 },
        model: "test/model",
      });
    });

    it(`gives up after a second answer with ${invalid.kind}, asking no third time`, async () => {
      const model = new MockLanguageModelV4({
        doGenerate: [invalid.answer({}), invalid.answer({}), answer(JSON.stringify(REVIEW))],
      });
      await assert.rejects(
        reviewerOf(model).review("x"),
        (error) =>
          error instanceof ReviewFailedError &&
          invalid.thrown.isInstance(error.cause) &&
          error.message.startsWith("test/model gave no valid review in 2 attempts: "),
      );
      assert.equal(model.doGenerateCalls.length, 2);
    });
  }

  it("leaves the run's cost out when a call before the review told none", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [answer("Looks good!"), answer(JSON.stringify(REVIEW), { cost: 0.5 })],
    });
    assert.deepEqual((await reviewerOf(model).review("x")).usage, { inputTokens: 2400, outputTokens: 160 });
  });

  it("doesn't ask again after any other error", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("the provider refused");
      },
    });
    await assert.rejects(
      reviewerOf(model).review("x"),
      (error) =>
        error instanceof ReviewFailedError && error.message === "the call to test/model failed: the provider refused",
    );
    assert.equal(model.doGenerateCalls.length, 1);
  });

  it("asks again once after a score parseReview refuses", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [answer(JSON.stringify({ ...REVIEW, complexity: 11 })), answer(JSON.stringify(REVIEW))],
    });
    assert.deepEqual((await reviewerOf(model).review("x")).review, REVIEW);
    assert.equal(model.doGenerateCalls.length, 2);
  });

  it("gives no review after two answers with a score parseReview refuses", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        answer(JSON.stringify({ ...REVIEW, complexity: 11 })),
        answer(JSON.stringify({ ...REVIEW, complexity: 7.5 })),
      ],
    });
    await assert.rejects(
      reviewerOf(model).review("x"),
      (error) =>
        error instanceof ReviewFailedError &&
        error.cause instanceof InvalidReviewError &&
        error.message ===
          "test/model gave no valid review in 2 attempts: complexity is 7.5, not an integer from 1 to 10",
    );
    assert.equal(model.doGenerateCalls.length, 2);
  });
});

describe("createReviewer on OpenRouter, with a stub fetch", () => {
  // Only endpoints that take every parameter, the structured output included, and don't collect prompts may answer.
  it("sends the data policy, the structured output and the token cap, and reads back the cost", async () => {
    const requests: { url: string; method: string | undefined; authorization: string | null; body: unknown }[] = [];
    const stub: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return Response.json({
        id: "gen-test",
        object: "chat.completion",
        created: 1760000000,
        model: DEFAULT_MODEL,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(REVIEW) } }],
        usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290, cost: 0.00321 },
      });
    };

    const run = await createReviewer({ apiKey: "sk-or-test", model: DEFAULT_MODEL, fetch: stub }).review("Review it.");

    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.ok(request);
    assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(request.method, "POST");
    assert.equal(request.authorization, "Bearer sk-or-test");
    const body = request.body as Record<string, unknown>;
    assert.equal(body.model, DEFAULT_MODEL);
    assert.deepEqual(body.provider, { require_parameters: true, data_collection: "deny" });
    assert.equal((body.response_format as { type?: unknown }).type, "json_schema");
    assert.equal(body.max_tokens, 8000);
    assert.deepEqual(run, {
      review: REVIEW,
      usage: { inputTokens: 1234, outputTokens: 56, cost: 0.00321 },
      model: DEFAULT_MODEL,
    });
  });
});

describe("usageText, a review's usage on one line", () => {
  it("names the tokens and the cost", () => {
    assert.equal(
      usageText({ inputTokens: 1234, outputTokens: 56, cost: 0.00321 }),
      "1234 input and 56 output tokens, cost $0.003210",
    );
  });

  it("says unknown for what no call told", () => {
    assert.equal(
      usageText({ inputTokens: undefined, outputTokens: undefined }),
      "unknown input and unknown output tokens, cost unknown",
    );
  });
});
