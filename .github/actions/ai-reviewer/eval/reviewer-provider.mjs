// The eval's provider, which promptfooconfig.yaml names once for each model. promptfoo calls it once for each case and
// model, and it reviews the case as the command line (src/review.ts) reviews a pull request, with the reviewer's own
// filterDiff, buildPrompt and createReviewer, so the eval tests the prompt, the schema and the model call CI runs, never
// a copy of them. The case's vars carry the pull request's title, description and diff, and promptfoo's own rendered
// prompt is ignored. A case that gets no review comes back as promptfoo's `error`, which no assertion grades and the
// run counts as an error, never as an output an assertion could pass: a diff the command line would decide without a
// model, a missing key, or a review that failed.
//
// promptfoo 0.124.1 loads this module with a native import(), but it has registered tsx's loader for the whole process
// by then, so the reviewer's .ts modules load through tsx here. That Node's own type stripping runs them is shown by the
// reviewer's `npm test` and `npm run typecheck`, never by the eval.
import { filterDiff, skipOf } from "../src/diff.ts";
import { buildPrompt } from "../src/prompt.ts";
import { createReviewer, DEFAULT_MODEL, usageText } from "../src/reviewer.ts";

/** @import { Usage } from "../src/reviewer.ts" */

/**
 * The part of promptfoo's options the provider reads: the provider entry's `config`, to which promptfoo adds its own
 * `basePath`, and of which the provider reads only `model`.
 * @typedef {{ config?: Record<string, unknown> }} ProviderOptions
 */

/**
 * The part of promptfoo's call context the provider reads: the case's vars, each `file://` one already read into its
 * text, and promptfoo's logger, whose lines keep clear of its progress bar.
 * @typedef {{ vars?: Record<string, unknown>, logger?: { info(message: string): void } }} CallContext
 */

/**
 * A review's tokens as promptfoo counts them.
 * @typedef {{ prompt?: number, completion?: number, total?: number }} TokenUsage
 */

/**
 * What promptfoo reads back: the review as JSON, with its tokens and, when OpenRouter told it, its cost in US dollars;
 * or why there's no review.
 * @typedef {{ output: string, tokenUsage: TokenUsage, cost?: number } | { error: string }} ProviderResponse
 */

export default class ReviewerProvider {
  /**
   * Reviews with the model the provider entry's `config.model` names, else with the reviewer's DEFAULT_MODEL. Throws
   * for a model that isn't an id, so `promptfoo validate` and the eval stop on it before any case runs.
   * @param {ProviderOptions} [options]
   */
  constructor(options = {}) {
    const model = options.config?.model ?? DEFAULT_MODEL;
    if (typeof model !== "string" || model.trim() === "") {
      throw new TypeError(`ai-reviewer: config.model must be an OpenRouter model id, such as ${DEFAULT_MODEL}`);
    }
    /** The OpenRouter model id this provider reviews with. */
    this.model = model.trim();
  }

  /** The provider's id, which names its model, so promptfoo's results and token counts tell the models apart. */
  id() {
    return `ai-reviewer:${this.model}`;
  }

  /**
   * Reviews the case's pull request with this provider's model. Never throws.
   * @param {string} _prompt promptfoo's rendered prompt, which the review doesn't read
   * @param {CallContext} [context]
   * @returns {Promise<ProviderResponse>}
   */
  async callApi(_prompt, context) {
    const { title = "", body = "", diff } = context?.vars ?? {};
    if (typeof title !== "string" || typeof body !== "string" || typeof diff !== "string") {
      return { error: "ai-reviewer: the case's vars need a diff, and any title and body, as text" };
    }
    const filtered = filterDiff(diff);
    const skip = skipOf(filtered);
    if (skip !== null) {
      // The command line gives this verdict without asking a model, so the case would test no model.
      return { error: `ai-reviewer: the case's diff gets no model review: ${skip.summary}` };
    }
    const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
    if (apiKey === "") {
      return { error: "ai-reviewer: OPENROUTER_API_KEY is empty: export OPENROUTER_API_KEY=<your key> first" };
    }
    const prompt = buildPrompt({ title, body, diff: filtered.kept, excluded: filtered.excluded });
    try {
      const { review, usage, model } = await createReviewer({ apiKey, model: this.model }).review(prompt);
      // promptfoo's own summary counts tokens but no cost, so each review says its cost, as the command line does.
      context?.logger?.info(`ai-reviewer: "${title}" reviewed with ${model}: ${usageText(usage)}`);
      return {
        output: JSON.stringify(review),
        tokenUsage: tokenUsageOf(usage),
        ...(usage.cost === undefined ? {} : { cost: usage.cost }),
      };
    } catch (error) {
      // A ReviewFailedError names the model and why it gave no review.
      return { error: `ai-reviewer: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

/**
 * A review's tokens as promptfoo counts them. A count the reviewer wasn't told is left out, never 0, and so is the
 * total unless both are known.
 * @param {Usage} usage
 * @returns {TokenUsage}
 */
function tokenUsageOf({ inputTokens, outputTokens }) {
  return {
    ...(inputTokens === undefined ? {} : { prompt: inputTokens }),
    ...(outputTokens === undefined ? {} : { completion: outputTokens }),
    ...(inputTokens === undefined || outputTokens === undefined ? {} : { total: inputTokens + outputTokens }),
  };
}
