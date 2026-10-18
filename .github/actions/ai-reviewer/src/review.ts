// The reviewer's command line, which the action runs in CI and the owner runs locally:
//
//   git diff origin/main...HEAD | npm run review --prefix .github/actions/ai-reviewer
//
// It reads OPENROUTER_API_KEY, REVIEW_MODEL (DEFAULT_MODEL when empty), PR_TITLE and PR_BODY from its environment, and
// the diff from the file DIFF_FILE names, else from stdin. Whenever it gives a verdict, it prints one JSON object on
// stdout and exits 0: the review with its model, usage and left-out paths or, with no model call, a pass when nothing
// is left to review and a fail when the diff is over MAX_REVIEW_BYTES (skipOf in diff.ts). When it can't give one, it
// prints nothing on stdout and one line on stderr saying why, also appended to the job summary when GITHUB_STEP_SUMMARY
// is set, and exits 1. A DIFF_FILE that names no file, or a file that's missing or can't be read, is such a failure,
// never an empty diff. The run's line, with the model, tokens and cost, goes to stderr, and nothing it prints holds the
// key.
import { appendFileSync, readFileSync } from "node:fs";
import { text } from "node:stream/consumers";
import { filterDiff, skipOf } from "./diff.ts";
import { buildPrompt } from "./prompt.ts";
import { createReviewer, DEFAULT_MODEL, ReviewFailedError, usageText } from "./reviewer.ts";

const NAME = "ai-reviewer";
const MAX_LINE_CHARS = 1000;

/** Why the command gives no verdict, which its one line on stderr says. */
class NoVerdict extends Error {}

const env = process.env;
const apiKey = (env.OPENROUTER_API_KEY ?? "").trim();

try {
  const filtered = filterDiff(await readDiff());
  const skip = skipOf(filtered);
  if (skip !== null) {
    print({ ...skip, excluded: filtered.excluded });
    note(`${skip.skipped}, so no model call`);
  } else {
    if (apiKey === "") {
      throw new NoVerdict(
        "OPENROUTER_API_KEY is empty: in CI, add the OpenRouter key as the repository secret OPENROUTER_API_KEY; " +
          "for a local run, export OPENROUTER_API_KEY=<your key> first",
      );
    }
    const model = env.REVIEW_MODEL?.trim() || DEFAULT_MODEL;
    const prompt = buildPrompt({
      title: env.PR_TITLE ?? "",
      body: env.PR_BODY ?? "",
      diff: filtered.kept,
      excluded: filtered.excluded,
    });
    const run = await createReviewer({ apiKey, model }).review(prompt);
    print({ ...run.review, model: run.model, usage: run.usage, excluded: filtered.excluded });
    note(`reviewed with ${run.model}: ${usageText(run.usage)}`);
  }
} catch (error) {
  if (error instanceof NoVerdict || error instanceof ReviewFailedError) failWith(error.message);
  else failWith(`unexpected error: ${error instanceof Error ? error.message : String(error)}`);
}

/** The diff from the file DIFF_FILE names, else from stdin. */
async function readDiff(): Promise<string> {
  const file = env.DIFF_FILE;
  if (file !== undefined) {
    if (file.trim() === "") throw new NoVerdict("DIFF_FILE is set but names no file, so there is no diff to review");
    try {
      return readFileSync(file, "utf8");
    } catch (error) {
      throw new NoVerdict(`can't read the diff file DIFF_FILE names, ${file} (${codeOf(error)})`);
    }
  }
  if (process.stdin.isTTY) {
    throw new NoVerdict("no diff: pipe one in, as in git diff origin/main...HEAD | npm run review, or set DIFF_FILE");
  }
  return text(process.stdin);
}

function codeOf(error: unknown): string {
  const code: unknown = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : "unreadable";
}

function print(value: object): void {
  process.stdout.write(`${redacted(JSON.stringify(value, null, 2))}\n`);
}

function note(message: string): void {
  process.stderr.write(`${NAME}: ${redacted(message)}\n`);
}

/** The one line that says why there's no verdict, on stderr and in the job summary, and exit code 1. */
function failWith(reason: string): void {
  const flat = reason.replace(/\s+/g, " ").trim();
  const line = `${NAME}: ${redacted(flat.length > MAX_LINE_CHARS ? `${flat.slice(0, MAX_LINE_CHARS)}…` : flat)}`;
  process.stderr.write(`${line}\n`);
  const summary = env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      appendFileSync(summary, `${line}\n`);
    } catch {
      // The line is on stderr, in the job's log, already.
    }
  }
  process.exitCode = 1;
}

/** `output` without the key, in case anything ever echoes it. A key too short to be one isn't searched for. */
function redacted(output: string): string {
  return apiKey.length < 8 ? output : output.replaceAll(apiKey, "[OPENROUTER_API_KEY]");
}
