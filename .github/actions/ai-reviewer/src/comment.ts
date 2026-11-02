// The pull request's comment: the Markdown the workflow posts, then edits on each later review, made from the review
// file the command line (review.ts) printed. Its first line is COMMENT_MARKER, an HTML comment GitHub doesn't show.
// The workflow finds its earlier comment by the marker it reads from that line, so only this module writes the marker.
//
//   REVIEWED_COMMIT=<sha> node src/comment.ts <review.json>
//
// prints the comment on stdout and exits 0. REVIEWED_COMMIT, optional, is the commit the review read, which the footer
// names, so a comment that a later run without a verdict left in place shows it describes an older commit. A review
// file that can't be read, or that isn't what the command line prints with a verdict, or a REVIEWED_COMMIT that isn't
// a commit SHA, gives one line on stderr, nothing on stdout and exit code 1, never a comment.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ExcludedPath, Skip } from "./diff.ts";
import { cutAt, MAX_LISTED_PATHS, pathOnOneLine } from "./prompt.ts";
import { InvalidReviewError, parseReview, SCORE_KEYS } from "./review-schema.ts";
import type { Review } from "./review-schema.ts";
import { usageText } from "./reviewer.ts";
import type { Usage } from "./reviewer.ts";

/** The comment's first line, by which the workflow finds the comment to edit rather than add another. */
export const COMMENT_MARKER = "<!-- ai-review -->";

/**
 * GitHub's limit on a comment's body, in characters. The comment is measured in UTF-16 code units, as JavaScript counts
 * a string, never fewer than its characters, with its final line break included.
 */
export const MAX_COMMENT_CHARS = 65_536;

/** The most of one left-out path the comment shows, in UTF-16 code units, so 50 long paths leave the summary room. */
export const MAX_PATH_CHARS = 300;

/** What the command line prints with a verdict: the model's review, or a verdict given without a model call. */
export type ReviewOutput =
  (Review & { model: string; usage: Usage; excluded: ExcludedPath[] }) | (Skip & { excluded: ExcludedPath[] });

const SCORE_LABELS = {
  implementationCorrectness: "Implementation correctness",
  idiomaticity: "Idiomaticity",
  complexity: "Complexity",
  testRiskCoverage: "Test / risk coverage",
  documentation: "Documentation",
  securitySafety: "Security and safety",
} as const satisfies Record<(typeof SCORE_KEYS)[number], string>;

const EXCLUDED = z.array(z.object({ path: z.string(), bytes: z.number().int().nonnegative() }));

// A review file's fields besides the model's review, which parseReview checks.
const REVIEW_RUN = z.object({
  model: z.string().min(1),
  usage: z.object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    cost: z.number().optional(),
  }),
  excluded: EXCLUDED,
});

const SKIPPED = z.discriminatedUnion("skipped", [
  z.object({
    verdict: z.literal("pass"),
    summary: z.string(),
    skipped: z.literal("nothing-to-review"),
    excluded: EXCLUDED,
  }),
  z.object({ verdict: z.literal("fail"), summary: z.string(), skipped: z.literal("too-large"), excluded: EXCLUDED }),
]) satisfies z.ZodType<Skip & { excluded: ExcludedPath[] }>;

const SUMMARY_CUT = "\n\n[The summary is cut here, to fit GitHub's limit on a comment's length.]";

/** A commit SHA as GitHub gives a pull request's head: 7 to 40 lowercase hex digits. */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/;

/**
 * The review file's JSON, once it's what the command line prints with a verdict: a review whose scores parseReview
 * accepts, with its model, usage and left-out paths, or a verdict given without a model call. Throws
 * InvalidReviewError, naming the first field at fault, for anything else.
 */
export function parseReviewOutput(value: unknown): ReviewOutput {
  if (typeof value === "object" && value !== null && "skipped" in value) return checked(SKIPPED, value);
  const review = parseReview(value);
  const { model, usage, excluded } = checked(REVIEW_RUN, value);
  const { inputTokens, outputTokens, cost } = usage;
  return {
    ...review,
    model,
    // A cost no call told is left out, as reviewer.ts leaves it out, never read as 0.
    usage: cost === undefined ? { inputTokens, outputTokens } : { inputTokens, outputTokens, cost },
    excluded,
  };
}

/**
 * The comment: the marker, the verdict, the six scores (none for a verdict given without a model), the summary, the
 * left-out paths folded in a <details> and listed up to MAX_LISTED_PATHS, and a footer with the reviewed commit, when
 * given, and the model, tokens and cost. Only the summary gives way to MAX_COMMENT_CHARS, cut with a note that says so.
 * Throws for a commit that isn't a commit SHA, and when the rest alone would break the limit, which no review file the
 * command line prints can do.
 */
export function renderComment(output: ReviewOutput, commit?: string): string {
  if (commit !== undefined && !COMMIT_SHA.test(commit)) {
    throw new Error(`the reviewed commit isn't a commit SHA: ${commit.slice(0, 80)}`);
  }
  const before = [
    `${COMMENT_MARKER}\n## AI code review: ${output.verdict}`,
    ...("skipped" in output ? [] : [scoreTable(output)]),
  ];
  const after = [...leftOutSection(output.excluded), footerOf(output, commit)];
  const compose = (summary: string) => `${[...before, summary, ...after].join("\n\n")}\n`;
  const room = MAX_COMMENT_CHARS - compose("").length;
  const summary = summaryOf(output.summary);
  const comment = compose(
    summary.length <= room ? summary : `${cutAt(summary, Math.max(0, room - SUMMARY_CUT.length))}${SUMMARY_CUT}`,
  );
  if (comment.length > MAX_COMMENT_CHARS) {
    throw new Error(`the comment would be ${comment.length} characters, over GitHub's limit of ${MAX_COMMENT_CHARS}`);
  }
  return comment;
}

function summaryOf(summary: string): string {
  const text = summary.trim();
  return text === "" ? "(The review gave no summary.)" : text;
}

function scoreTable(review: Review): string {
  return [
    "| Criterion | Score |",
    "| :--- | ---: |",
    ...SCORE_KEYS.map((key) => `| ${SCORE_LABELS[key]} | ${review[key]}/10 |`),
  ].join("\n");
}

function leftOutSection(excluded: readonly ExcludedPath[]): string[] {
  if (excluded.length === 0) return [];
  const listed = excluded
    .slice(0, MAX_LISTED_PATHS)
    .map(({ path, bytes }) => `- ${codeSpan(shownPath(path))} (${formatted(bytes)} bytes)`);
  const more = excluded.length - listed.length;
  const files = `${formatted(excluded.length)} ${excluded.length === 1 ? "file" : "files"}`;
  return [
    [
      "<details>",
      `<summary>${files} left out of the review</summary>`,
      "",
      ...listed,
      ...(more > 0 ? [`- and ${formatted(more)} more`] : []),
      "",
      "</details>",
    ].join("\n"),
  ];
}

function footerOf(output: ReviewOutput, commit: string | undefined): string {
  const reviewed = commit === undefined ? "" : `For commit ${codeSpan(commit.slice(0, 7))}. `;
  return "skipped" in output
    ? `<sub>${reviewed}No model was asked, so no tokens and no cost.</sub>`
    : `<sub>${reviewed}Reviewed by ${codeSpan(output.model)}: ${usageText(output.usage)}.</sub>`;
}

/** A left-out path on one line, cut at MAX_PATH_CHARS with an ellipsis. */
function shownPath(path: string): string {
  const line = pathOnOneLine(path);
  return line.length <= MAX_PATH_CHARS ? line : `${cutAt(line, MAX_PATH_CHARS)}…`;
}

/**
 * `text` as a Markdown code span, fenced by one backtick more than its longest run of them, so none of its own can end
 * the span. A text that starts or ends with a backtick or a space is padded with a space on each side, which the
 * renderer strips.
 */
function codeSpan(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), ([run]) => run.length));
  const fence = "`".repeat(longest + 1);
  return /^[` ]|[` ]$/.test(text) ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

function formatted(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

/** `value` as `schema` reads it, else an InvalidReviewError naming the first field at fault. */
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  const field = issue?.path.map(String).join(".") || "the review file";
  throw new InvalidReviewError(`${field}: ${issue?.message ?? "isn't what the command line prints"}`);
}

/** The review file the command line's arguments name, read and checked. */
function reviewFileOf(args: readonly string[]): ReviewOutput {
  const [file] = args;
  if (args.length !== 1 || file === undefined || file === "") {
    throw new Error("usage: node src/comment.ts <review.json>");
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`can't read the review file: ${messageOf(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`the review file ${file} isn't JSON: ${messageOf(error)}`);
  }
  try {
    return parseReviewOutput(value);
  } catch (error) {
    throw new Error(`the review file ${file} isn't a review: ${messageOf(error)}`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Last, so every constant above is set before the command line uses it.
if (import.meta.main) {
  try {
    const commit = process.env.REVIEWED_COMMIT;
    process.stdout.write(renderComment(reviewFileOf(process.argv.slice(2)), commit === "" ? undefined : commit));
  } catch (error) {
    process.stderr.write(`ai-reviewer: ${messageOf(error).replace(/\s+/g, " ").trim()}\n`);
    process.exitCode = 1;
  }
}
