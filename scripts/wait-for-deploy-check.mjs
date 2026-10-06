// Deploy check: waits for the build Workers Builds runs for a commit of main, and fails when that build failed. Each
// push to main deploys through Workers Builds, whose deploy command (npm run deploy:checked, scripts/deploy-checked.mjs)
// refuses code ahead of its migrations and checks production after the deploy. Cloudflare reports each build to GitHub
// as a check run, "Workers Builds: drogeria-radar", and tells no one when it fails. The Deploy check workflow
// (.github/workflows/deploy-check.yml) runs this script on the same push, so a red build fails that workflow too, and
// GitHub emails whoever pushed. Zero dependencies, like the other scripts.
//
//   GITHUB_REPOSITORY=<owner>/<repo> DEPLOY_CHECK_SHA=<the commit's 40-character SHA> [GITHUB_TOKEN=<token>] \
//     node scripts/wait-for-deploy-check.mjs
//
// The commit is DEPLOY_CHECK_SHA's, else GITHUB_SHA's, which GitHub sets in a workflow. With GITHUB_TOKEN it asks
// GitHub's API as the workflow's job; without one it asks as anyone may for a public repository, within GitHub's 60
// requests an hour. Every 15 s it reads the commit's check runs and keeps the newest one that Cloudflare's GitHub app
// (cloudflare-workers-and-pages) posted under a name starting with "Workers Builds:" (buildRunOf). Each poll then comes
// to one verdict (deployVerdict):
// - pass: the run completed with success;
// - fail: it completed with any other conclusion, or 20 minutes passed without a completed run;
// - superseded, which passes: after 2 minutes the commit still has no run and is no longer main's head, as when a burst
//   of merges gets one build, for its newest commit, whose own build and Deploy check cover this commit's code;
// - wait: anything else, until the next poll.
// A poll that can't read the check runs, because no answer came, GitHub answered an error or the answer isn't the whole
// list it should be, is logged and tried again at the next one. It never counts as a commit without a run, so it can't
// pass as superseded, and polls that fail for 20 minutes fail. Main's head is read only when it can decide: once a
// commit without a run has had 2 minutes to get one.
//
// Each poll prints one line: the time waited, the run's name, status and conclusion, and the verdict. Nothing else of
// GitHub's answers is printed, no URL and no body: a check run's details_url, html_url and output carry the Cloudflare
// account id, and the workflow's logs are public. It exits 0 for pass and superseded, and 1 for fail and for a refusal,
// which comes before any request.

import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { jsonOf } from "./check-migrations-applied.mjs";
import { failureOf, TIMEOUT_MS } from "./check-production.mjs";
import { RUNBOOK } from "./deploy-checked.mjs";

const USAGE =
  "Usage: GITHUB_REPOSITORY=<owner>/<repo> DEPLOY_CHECK_SHA=<the commit's 40-character SHA> [GITHUB_TOKEN=<token>] node scripts/wait-for-deploy-check.mjs";

/** How long a commit may go without a run of its build before one that's no longer main's head counts as superseded. */
export const SUPERSEDED_AFTER_MS = 2 * 60_000;

/** How long the check waits for the build's run to complete before it fails. */
export const GIVE_UP_AFTER_MS = 20 * 60_000;

// How long the check waits between two polls.
const POLL_INTERVAL_MS = 15_000;

// A build's run: posted by Cloudflare's GitHub app, and named after the Worker ("Workers Builds: drogeria-radar").
const BUILD_APP = "cloudflare-workers-and-pages";
const BUILD_NAME_PREFIX = "Workers Builds:";

// GitHub's REST API, the version this script reads, and the User-Agent GitHub requires of every request.
const API = "https://api.github.com";
const API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "drogeria-radar-deploy-check",
};

// A repository as GitHub names it, `<owner>/<repo>`, and a commit's full SHA.
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

// A value of GitHub's answer is printed only in this shape, the one a check's name ("Workers Builds: drogeria-radar"),
// status and conclusion have, so no line can carry a URL, a newline or a workflow command.
const SHOWN = /^[\w .:-]{1,100}$/;

/**
 * @typedef {object} CheckRun A check run as GitHub's answer lists it, with the fields this script reads; any may be
 *   missing or of another type, so each is checked where it's read.
 * @property {unknown} [id]
 * @property {{ slug?: unknown }} [app]
 * @property {unknown} [name]
 * @property {unknown} [status]
 * @property {unknown} [conclusion]
 * @property {unknown} [started_at]
 */

/**
 * @typedef {object} Settings
 * @property {string} repo `<owner>/<repo>`.
 * @property {string} sha The commit's full SHA, in lower case.
 * @property {string} [token] GitHub's token, when one is set.
 */

/** @typedef {"wait" | "pass" | "fail" | "superseded"} Verdict */

/**
 * A commit's full SHA, from `value` without the whitespace around it: its 40 hex characters in lower case, as GitHub's
 * answers write it, or null for anything else, an abbreviated SHA included.
 * @param {unknown} value
 * @returns {string | null}
 */
export function commitShaOf(value) {
  if (typeof value !== "string") return null;
  const sha = value.trim();
  return COMMIT_SHA.test(sha) ? sha.toLowerCase() : null;
}

/**
 * The check's settings, from `env` (process.env): the repository (`repo`) from GITHUB_REPOSITORY, the commit (`sha`)
 * from DEPLOY_CHECK_SHA, else GITHUB_SHA (commitShaOf), and GitHub's token (`token`) from GITHUB_TOKEN, only when set.
 * Each value is read without the whitespace around it, and a blank one counts as unset. Gives `{ refusal }` instead,
 * naming the variable and never its value, for a repository or a commit that is missing or isn't in its shape. Neither
 * part of a repository may be `.` or `..`, which would take a request to another path of the API.
 * @param {Record<string, string | undefined>} env
 * @returns {Settings | { refusal: string }}
 */
export function readWaitEnv(env) {
  const repo = env.GITHUB_REPOSITORY?.trim() ?? "";
  if (repo === "") return { refusal: "set GITHUB_REPOSITORY to <owner>/<repo> in this command's environment" };
  if (!REPOSITORY.test(repo) || repo.split("/").some((part) => part === "." || part === "..")) {
    return { refusal: "GITHUB_REPOSITORY isn't <owner>/<repo>" };
  }
  const variable = (env.DEPLOY_CHECK_SHA?.trim() ?? "") === "" ? "GITHUB_SHA" : "DEPLOY_CHECK_SHA";
  const value = env[variable]?.trim() ?? "";
  if (value === "") {
    return { refusal: "set DEPLOY_CHECK_SHA, or GITHUB_SHA, to the commit's SHA in this command's environment" };
  }
  const sha = commitShaOf(value);
  if (sha === null) return { refusal: `${variable} isn't a commit's full SHA (40 hex characters)` };
  const token = env.GITHUB_TOKEN?.trim() ?? "";
  return token === "" ? { repo, sha } : { repo, sha, token };
}

/**
 * What an answer to the check runs' request says: `{ runs }` only for a 200 whose body is a JSON object with a
 * `check_runs` list and a `total_count` no larger than that list, so it holds every run of the commit, none at all
 * included. Anything else gives `{ failure }`, never an empty list: an answer the check can't read, or one that holds
 * only part of the runs, never counts as a commit without a build. No failure holds the body.
 * @param {number} status
 * @param {string} body
 * @returns {{ runs: unknown[] } | { failure: string }}
 */
export function checkRunsOf(status, body) {
  if (status !== 200) return { failure: `GitHub answered HTTP ${status}` };
  const answer = jsonOf(body);
  const isObject = typeof answer === "object" && answer !== null;
  const runs = isObject ? answer.check_runs : undefined;
  const total = isObject ? answer.total_count : undefined;
  if (!Array.isArray(runs) || !Number.isSafeInteger(total) || total < 0) {
    return { failure: "GitHub answered 200 without the commit's list of check runs" };
  }
  if (total > runs.length) {
    return { failure: `GitHub's answer holds ${runs.length} of the commit's ${total} check runs` };
  }
  return { runs };
}

/**
 * The run of the commit's build among `runs`: of those Cloudflare's app (cloudflare-workers-and-pages) posted under a
 * name starting with "Workers Builds:", the one that started last, a run with a readable `started_at` being later than
 * one without, and between runs that started at the same time the one with the highest id. Null when there's none. A
 * run that isn't an object, or lacks that app or that name, isn't the build's.
 * @param {unknown[]} runs
 * @returns {CheckRun | null}
 */
export function buildRunOf(runs) {
  /** @type {CheckRun | null} */
  let latest = null;
  for (const run of runs) {
    if (!isBuildRun(run)) continue;
    if (latest === null || isLater(run, latest)) latest = run;
  }
  return latest;
}

/**
 * Main's head, from an answer to the request for main's commit: `{ sha }` for a 200 whose body is a JSON object with a
 * full SHA (commitShaOf), else `{ failure }`, which never holds the body.
 * @param {number} status
 * @param {string} body
 * @returns {{ sha: string } | { failure: string }}
 */
export function headShaOf(status, body) {
  if (status !== 200) return { failure: `GitHub answered HTTP ${status}` };
  const answer = jsonOf(body);
  const sha = commitShaOf(typeof answer === "object" && answer !== null ? answer.sha : undefined);
  return sha === null ? { failure: "GitHub answered 200 without main's commit SHA" } : { sha };
}

/**
 * What a poll concludes (see the header):
 * - `pass` for a run that completed with success, and `fail` for one that completed with any other conclusion;
 * - `superseded` for no run once SUPERSEDED_AFTER_MS have passed, on a commit that is no longer main's head;
 * - `fail` for no run, or a run that hasn't completed, once GIVE_UP_AFTER_MS have passed;
 * - `wait` for anything else.
 * `run` is the build's run (buildRunOf), or null when the commit has none or the poll couldn't read its runs. `isHead`
 * says whether the commit is still main's head, and is null when that wasn't read or couldn't be: only a head read as
 * another commit makes a commit without a run superseded.
 * @param {{ run: CheckRun | null, isHead: boolean | null, waitedMs: number }} poll
 * @returns {Verdict}
 */
export function deployVerdict({ run, isHead, waitedMs }) {
  if (run?.status === "completed") return run.conclusion === "success" ? "pass" : "fail";
  if (!run && isHead === false && waitedMs >= SUPERSEDED_AFTER_MS) return "superseded";
  return waitedMs >= GIVE_UP_AFTER_MS ? "fail" : "wait";
}

/**
 * Reads the commit's check runs, the latest of each, in one page of up to 100: the runs (checkRunsOf), or
 * `{ failure }` when there's no answer to read.
 * @param {Settings} settings
 * @returns {Promise<{ runs: unknown[] } | { failure: string }>}
 */
export async function readCheckRuns({ repo, sha, token }) {
  const answer = await askGitHub(`/repos/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100`, token);
  return "failure" in answer ? answer : checkRunsOf(answer.status, answer.body);
}

/**
 * Reads main's head (headShaOf), or gives `{ failure }` when there's no answer to read.
 * @param {Settings} settings
 * @returns {Promise<{ sha: string } | { failure: string }>}
 */
export async function readMainHead({ repo, token }) {
  const answer = await askGitHub(`/repos/${repo}/commits/main`, token);
  return "failure" in answer ? answer : headShaOf(answer.status, answer.body);
}

/**
 * Polls the commit's build every POLL_INTERVAL_MS until a verdict other than `wait`, printing one line per poll, then
 * the verdict, a failure's on stderr with where to look. `clock` replaces the time, for a test. Gives the verdict.
 * @param {Settings} settings
 * @param {{ now?: () => number, sleep?: (ms: number) => Promise<unknown> }} [clock]
 * @returns {Promise<Verdict>}
 */
export async function waitForDeployCheck(settings, { now = Date.now, sleep = delay } = {}) {
  const asking = settings.token === undefined ? "without a token" : "with GitHub's token";
  console.log(`Waiting for the Workers Builds check of ${settings.sha} in ${settings.repo}, ${asking}`);
  const startedAt = now();
  for (;;) {
    const verdict = await poll(settings, now() - startedAt);
    if (verdict !== "wait") {
      report(verdict);
      return verdict;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * One poll: reads the commit's check runs, and main's head when it can decide, prints one line, and gives the verdict.
 * @param {Settings} settings
 * @param {number} waitedMs
 * @returns {Promise<Verdict>}
 */
async function poll(settings, waitedMs) {
  const at = `[${elapsedOf(waitedMs)}]`;
  const read = await readCheckRuns(settings);
  if ("failure" in read) {
    // Unread, the poll knows neither the build's run nor main's head, so deployVerdict waits, then fails, and never
    // takes it for a commit without a build.
    const verdict = deployVerdict({ run: null, isHead: null, waitedMs });
    console.log(`${at}  couldn't read the commit's check runs (${read.failure})  -> ${verdict}`);
    return verdict;
  }
  const run = buildRunOf(read.runs);
  if (run !== null) {
    const verdict = deployVerdict({ run, isHead: null, waitedMs });
    console.log(`${at}  ${runLineOf(run)}  -> ${verdict}`);
    return verdict;
  }
  const { isHead, note } = waitedMs >= SUPERSEDED_AFTER_MS ? await headOf(settings) : { isHead: null, note: "" };
  const verdict = deployVerdict({ run: null, isHead, waitedMs });
  console.log(`${at}  no Workers Builds run yet${note}  -> ${verdict}`);
  return verdict;
}

/**
 * Whether the commit is still main's head, null when main's head can't be read, and how a poll's line says it.
 * @param {Settings} settings
 * @returns {Promise<{ isHead: boolean | null, note: string }>}
 */
async function headOf(settings) {
  const head = await readMainHead(settings);
  if ("failure" in head) return { isHead: null, note: `; couldn't read main's head (${head.failure})` };
  return head.sha === settings.sha
    ? { isHead: true, note: "; the commit is still main's head" }
    : { isHead: false, note: "; main has moved past the commit" };
}

/**
 * Prints the verdict, a failure's on stderr with where to look, never with a URL.
 * @param {Verdict} verdict
 */
function report(verdict) {
  if (verdict === "pass") {
    console.log("Deploy check: pass. The commit's Workers Builds check succeeded.");
  } else if (verdict === "superseded") {
    console.log(
      "Deploy check: superseded. The commit has no Workers Builds run and main has moved past it, so the newer commit's build and Deploy check cover its code.",
    );
  } else {
    console.error(
      `Deploy check: fail. Open this commit's checks in GitHub and its build's log in the Cloudflare dashboard, then see ${RUNBOOK}.`,
    );
  }
}

/**
 * A run as a poll's line shows it: its name and status, and its conclusion once it has completed.
 * @param {CheckRun} run
 * @returns {string}
 */
function runLineOf(run) {
  const state = run.status === "completed" ? `completed ${shown(run.conclusion)}` : shown(run.status);
  return `${shown(run.name)} ${state}`;
}

/**
 * A value of GitHub's answer as a line shows it: as it is when it has SHOWN's shape, else "(unreadable)".
 * @param {unknown} value
 * @returns {string}
 */
function shown(value) {
  return typeof value === "string" && SHOWN.test(value) ? value : "(unreadable)";
}

/**
 * The time waited as minutes and seconds, such as 2:15.
 * @param {number} ms
 * @returns {string}
 */
function elapsedOf(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * @param {unknown} run
 * @returns {run is CheckRun} Whether `run` is a build's run: Cloudflare's app's, under a Workers Builds name.
 */
function isBuildRun(run) {
  return (
    typeof run === "object" &&
    run !== null &&
    run.app?.slug === BUILD_APP &&
    typeof run.name === "string" &&
    run.name.startsWith(BUILD_NAME_PREFIX)
  );
}

/**
 * Whether `run` started after `other`, or, when both started at the same time or neither has a readable start, has the
 * higher id.
 * @param {CheckRun} run
 * @param {CheckRun} other
 * @returns {boolean}
 */
function isLater(run, other) {
  const started = startOf(run);
  const otherStarted = startOf(other);
  return started === otherStarted ? idOf(run) > idOf(other) : started > otherStarted;
}

/**
 * @param {CheckRun} run
 * @returns {number} When the run started, in ms since the epoch, or -Infinity when its `started_at` can't be read.
 */
function startOf(run) {
  const time = typeof run.started_at === "string" ? Date.parse(run.started_at) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * @param {CheckRun} run
 * @returns {number} The run's id, or -Infinity when it has none.
 */
function idOf(run) {
  return Number.isSafeInteger(run.id) ? run.id : Number.NEGATIVE_INFINITY;
}

/**
 * One GET of GitHub's API, with its headers and the token as a bearer only when one is set, following no redirect and
 * with check-production's TIMEOUT_MS for the answer and its body. Gives the answer's status and body, or `{ failure }`
 * when none came (failureOf), which holds neither the URL nor the token.
 * @param {string} path
 * @param {string | undefined} token
 * @returns {Promise<{ status: number, body: string } | { failure: string }>}
 */
async function askGitHub(path, token) {
  try {
    const response = await fetch(`${API}${path}`, {
      headers: { ...API_HEADERS, ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { failure: failureOf(error) };
  }
}

/**
 * Prints why the check stops, with the usage, and exits before any request.
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.error(`wait-for-deploy-check: ${reason}\n${USAGE}`);
  process.exit(1);
}

// `node scripts/wait-for-deploy-check.mjs`, run by the Deploy check workflow: every refusal comes before any request.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) refuse("give no argument: set the commit in DEPLOY_CHECK_SHA");
  const settings = readWaitEnv(process.env);
  if ("refusal" in settings) refuse(settings.refusal);
  const verdict = await waitForDeployCheck(settings);
  process.exit(verdict === "pass" || verdict === "superseded" ? 0 : 1);
}
