// The reviewer: the lesson's ToolLoopAgent, with no tools, asking one model on OpenRouter for the review's structured
// output (review-schema.ts). The command line (review.ts) and the evals use it. The tests drive it with AI SDK's mock
// model or with a stub fetch, so they never reach the network.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { NoObjectGeneratedError, NoOutputGeneratedError, Output, ToolLoopAgent } from "ai";
import type { LanguageModel, LanguageModelUsage } from "ai";
import { InvalidReviewError, parseReview, REVIEW_SCHEMA, SYSTEM_PROMPT } from "./review-schema.ts";
import type { Review } from "./review-schema.ts";

/** The OpenRouter model a review asks when REVIEW_MODEL names none. */
export const DEFAULT_MODEL = "z-ai/glm-5.3";

// Each call may answer with up to 8,000 tokens within 120 s, and an invalid answer is asked again once, so a review
// makes at most two calls.
const MAX_OUTPUT_TOKENS = 8000;
const TIMEOUT_MS = 120_000;
const ATTEMPTS = 2;

/** A review's tokens, and its cost in US dollars, over all its calls. A count no call told is undefined, never 0. */
export interface Usage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cost?: number;
}

export interface ReviewRun {
  review: Review;
  usage: Usage;
  /** The model the review asked for. */
  model: string;
}

export interface ReviewerOptions {
  /** The OpenRouter key; only the OpenRouter model reads it. */
  apiKey: string;
  /** The OpenRouter model id. */
  model: string;
  /** A model to ask instead of OpenRouter's, such as the tests' mock. */
  languageModel?: Exclude<LanguageModel, string>;
  /** The fetch OpenRouter's model sends its request with, such as the tests' stub; the global one by default. */
  fetch?: typeof globalThis.fetch;
}

/** A review that gives no verdict: its call failed, or the model's answers weren't a valid review. */
export class ReviewFailedError extends Error {
  constructor(message: string, options: ErrorOptions) {
    super(message, options);
    this.name = "ReviewFailedError";
  }
}

export function createReviewer({ apiKey, model, languageModel, fetch: customFetch }: ReviewerOptions) {
  const agent = new ToolLoopAgent({
    // A bare model id would go through the Vercel AI Gateway, so OpenRouter's model is built here. Only endpoints that
    // take every parameter sent, the structured output included, and that don't collect prompts may answer.
    model:
      languageModel ??
      createOpenRouter({ apiKey, compatibility: "strict", fetch: customFetch }).chat(model, {
        provider: { require_parameters: true, data_collection: "deny" },
      }),
    instructions: SYSTEM_PROMPT,
    output: Output.object({ schema: REVIEW_SCHEMA }),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    timeout: TIMEOUT_MS,
  });

  return {
    /**
     * The model's review of `prompt` (buildPrompt's message). An invalid answer, one without JSON, with JSON that
     * breaks the schema, empty, or with a score parseReview refuses, is asked again once. Any other error ends the
     * review at once. The usage counts every call that answered. Throws ReviewFailedError, with the error as its cause,
     * when there's no review.
     */
    async review(prompt: string): Promise<ReviewRun> {
      const calls: Usage[] = [];
      for (let attempt = 1; ; attempt += 1) {
        try {
          const result = await agent.generate({ prompt });
          calls.push(usageOf(result.usage, numberIn(result.finalStep.providerMetadata?.openrouter?.usage, "cost")));
          // Reading the output throws NoOutputGeneratedError for an empty answer, and parseReview throws
          // InvalidReviewError for a score outside 1 to 10.
          return { review: parseReview(result.output), usage: totalOf(calls), model };
        } catch (error) {
          // An answer that wasn't an object still cost its tokens; OpenRouter's raw usage tells its cost.
          if (NoObjectGeneratedError.isInstance(error)) {
            calls.push(usageOf(error.usage, numberIn(error.usage?.raw, "cost")));
          }
          if (!isInvalidAnswer(error)) {
            throw new ReviewFailedError(`the call to ${model} failed: ${messageOf(error)}`, { cause: error });
          }
          if (attempt < ATTEMPTS) continue;
          throw new ReviewFailedError(`${model} gave no valid review in ${ATTEMPTS} attempts: ${messageOf(error)}`, {
            cause: error,
          });
        }
      }
    },
  };
}

/** A review's usage on one line, as the command line prints it. */
export function usageText({ inputTokens, outputTokens, cost }: Usage): string {
  const tokens = (count: number | undefined) => (count === undefined ? "unknown" : String(count));
  const price = cost === undefined ? "cost unknown" : `cost $${cost.toFixed(6)}`;
  return `${tokens(inputTokens)} input and ${tokens(outputTokens)} output tokens, ${price}`;
}

/**
 * No JSON, JSON that breaks the schema, an empty answer, which the SDK itself asks for only once, or a score
 * parseReview refuses.
 */
function isInvalidAnswer(error: unknown): boolean {
  return (
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error) ||
    error instanceof InvalidReviewError
  );
}

function usageOf(usage: LanguageModelUsage | undefined, cost: number | undefined): Usage {
  return withCost({ inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens }, cost);
}

/** The calls' usage added up: a count or cost any call left unknown leaves the total unknown, never short. */
function totalOf(calls: readonly Usage[]): Usage {
  const sum = (a: number | undefined, b: number | undefined) =>
    a === undefined || b === undefined ? undefined : a + b;
  return calls.reduce((all, call) =>
    withCost(
      { inputTokens: sum(all.inputTokens, call.inputTokens), outputTokens: sum(all.outputTokens, call.outputTokens) },
      sum(all.cost, call.cost),
    ),
  );
}

/** Tokens with their cost, which is left out when it's unknown. */
function withCost(tokens: Omit<Usage, "cost">, cost: number | undefined): Usage {
  return cost === undefined ? tokens : { ...tokens, cost };
}

/** The finite number at `key` in a JSON object, else undefined. */
function numberIn(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = (value as Record<string, unknown>)[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
