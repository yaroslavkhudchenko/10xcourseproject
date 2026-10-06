import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RUNBOOK } from "./deploy-checked.mjs";
import {
  buildRunOf,
  checkRunsOf,
  commitShaOf,
  deployVerdict,
  GIVE_UP_AFTER_MS,
  headShaOf,
  readCheckRuns,
  readMainHead,
  readWaitEnv,
  SUPERSEDED_AFTER_MS,
  waitForDeployCheck,
} from "./wait-for-deploy-check.mjs";

// The Deploy check's rules. A check that took an answer it can't read for a commit without a build would pass a red
// deploy as superseded, so each such answer is a failure to read, tried again until the check gives up and fails. What
// it prints lands in the workflow's public logs, so no line holds anything of GitHub's answers but a run's name, status
// and conclusion. No test sends a request: the ones that need GitHub stub fetch, and the loop's time is a fake clock.

// The merge of PR #32, whose check runs these runs mirror, and a newer commit on main.
const SHA = "2c6adc558f346e3c63078f0d021965485f0b0281";
const NEWER_SHA = "0123456789abcdef0123456789abcdef01234567";
const REPO = "owner-made-up/repo-made-up";
const SETTINGS = { repo: REPO, sha: SHA };
const MINUTE = 60_000;

/**
 * The Workers Builds run of a commit, as GitHub's answer for 2c6adc5 listed it (2026-10-06): completed with success
 * while CI's three runs were still in progress. It has only the fields the check reads and a made-up id, so no URL and
 * no account id.
 * @param {object} [overrides]
 */
function buildRun(overrides = {}) {
  return {
    id: 30,
    app: { slug: "cloudflare-workers-and-pages" },
    name: "Workers Builds: drogeria-radar",
    status: "completed",
    conclusion: "success",
    started_at: "2026-10-06T17:02:52Z",
    ...overrides,
  };
}

/**
 * One of CI's runs on the same commit, posted by GitHub Actions.
 * @param {string} name
 * @param {number} id
 */
function ciRun(name, id) {
  return {
    id,
    app: { slug: "github-actions" },
    name,
    status: "in_progress",
    conclusion: null,
    started_at: "2026-10-06T17:02:50Z",
  };
}

const CI_RUNS = [ciRun("ci", 11), ciRun("smoke", 12), ciRun("e2e", 13)];

/**
 * GitHub's answer listing every one of `runs`.
 * @param {object[]} runs
 */
function runsAnswer(runs) {
  return { status: 200, body: JSON.stringify({ total_count: runs.length, check_runs: runs }) };
}

/**
 * GitHub's answer naming main's head.
 * @param {string} sha
 */
function headAnswer(sha) {
  return { status: 200, body: JSON.stringify({ sha, commit: { message: "Merge pull request" } }) };
}

// A request that got no answer, as fetch rejects with it.
const NO_ANSWER = new TypeError("fetch failed", {
  cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
});

describe("commitShaOf, a commit's full SHA", () => {
  it("takes 40 hex characters, in lower case and without the whitespace around them", () => {
    expect(commitShaOf(SHA)).toBe(SHA);
    expect(commitShaOf(` ${SHA.toUpperCase()}\n`)).toBe(SHA);
  });

  it.each([
    { why: "an abbreviated SHA", value: "2c6adc5" },
    { why: "41 characters", value: `${SHA}0` },
    { why: "a character that isn't hex", value: `${SHA.slice(0, 39)}g` },
    { why: "a branch", value: "main" },
    { why: "an empty text", value: "" },
    { why: "no text", value: undefined },
    { why: "a number", value: 2 },
  ])("refuses $why", ({ value }) => {
    expect(commitShaOf(value)).toBeNull();
  });
});

describe("readWaitEnv, the check's settings", () => {
  it("reads the repository, the commit from DEPLOY_CHECK_SHA before GITHUB_SHA, and the token", () => {
    expect(
      readWaitEnv({
        GITHUB_REPOSITORY: ` ${REPO} `,
        DEPLOY_CHECK_SHA: SHA.toUpperCase(),
        GITHUB_SHA: NEWER_SHA,
        GITHUB_TOKEN: "made-up-token",
      }),
    ).toEqual({ repo: REPO, sha: SHA, token: "made-up-token" });
  });

  it("takes GITHUB_SHA when DEPLOY_CHECK_SHA is unset or blank, and asks without a token when none is set", () => {
    expect(readWaitEnv({ GITHUB_REPOSITORY: REPO, GITHUB_SHA: SHA })).toEqual({ repo: REPO, sha: SHA });
    expect(readWaitEnv({ GITHUB_REPOSITORY: REPO, DEPLOY_CHECK_SHA: " ", GITHUB_SHA: SHA, GITHUB_TOKEN: "" })).toEqual({
      repo: REPO,
      sha: SHA,
    });
  });

  it.each([
    { why: "no repository", env: { GITHUB_SHA: SHA }, variable: "GITHUB_REPOSITORY", value: "" },
    {
      why: "a repository without an owner",
      env: { GITHUB_REPOSITORY: "repo-made-up", GITHUB_SHA: SHA },
      variable: "GITHUB_REPOSITORY",
      value: "repo-made-up",
    },
    {
      why: "a repository with a path",
      env: { GITHUB_REPOSITORY: `${REPO}/issues`, GITHUB_SHA: SHA },
      variable: "GITHUB_REPOSITORY",
      value: `${REPO}/issues`,
    },
    {
      why: "a repository that leaves its path",
      env: { GITHUB_REPOSITORY: "../..", GITHUB_SHA: SHA },
      variable: "GITHUB_REPOSITORY",
      value: "../..",
    },
    {
      why: "a repository with another character",
      env: { GITHUB_REPOSITORY: "owner-made-up/repo?x=1", GITHUB_SHA: SHA },
      variable: "GITHUB_REPOSITORY",
      value: "repo?x=1",
    },
    { why: "no commit", env: { GITHUB_REPOSITORY: REPO }, variable: "DEPLOY_CHECK_SHA", value: "" },
    {
      why: "an abbreviated commit in DEPLOY_CHECK_SHA",
      env: { GITHUB_REPOSITORY: REPO, DEPLOY_CHECK_SHA: "2c6adc5", GITHUB_SHA: SHA },
      variable: "DEPLOY_CHECK_SHA",
      value: "2c6adc5",
    },
    {
      why: "a commit in GITHUB_SHA that isn't one",
      env: { GITHUB_REPOSITORY: REPO, GITHUB_SHA: "made-up-token" },
      variable: "GITHUB_SHA",
      value: "made-up-token",
    },
  ])("refuses $why, naming the variable and never its value", ({ env, variable, value }) => {
    const result = readWaitEnv(env);
    expect(result).toEqual({ refusal: expect.stringContaining(variable) });
    if (value !== "") expect(result.refusal).not.toContain(value);
  });
});

describe("checkRunsOf, what an answer says", () => {
  it("reads every run of a 200 that lists them all, and a commit without any", () => {
    expect(checkRunsOf(200, runsAnswer([...CI_RUNS, buildRun()]).body)).toEqual({ runs: [...CI_RUNS, buildRun()] });
    expect(checkRunsOf(200, runsAnswer([]).body)).toEqual({ runs: [] });
  });

  it.each([
    { why: "not JSON", body: "<html>Unicorn!</html>" },
    { why: "empty", body: "" },
    { why: "JSON null", body: "null" },
    { why: "a JSON list", body: JSON.stringify(CI_RUNS) },
    { why: "without its list", body: JSON.stringify({ total_count: 0 }) },
    { why: "without its count", body: JSON.stringify({ check_runs: [] }) },
    { why: "with a count that isn't one", body: JSON.stringify({ total_count: "3", check_runs: CI_RUNS }) },
  ])("fails a 200 whose body is $why, never reading it as a commit without runs", ({ body }) => {
    expect(checkRunsOf(200, body)).toEqual({ failure: "GitHub answered 200 without the commit's list of check runs" });
  });

  it("fails an answer that holds only part of the commit's runs, since the build's could be among the rest", () => {
    expect(checkRunsOf(200, JSON.stringify({ total_count: 104, check_runs: CI_RUNS }))).toEqual({
      failure: "GitHub's answer holds 3 of the commit's 104 check runs",
    });
  });

  it.each([
    { why: "a rate limit", status: 403, body: JSON.stringify({ message: "API rate limit exceeded" }) },
    { why: "a commit GitHub doesn't know", status: 422, body: JSON.stringify({ message: "No commit found" }) },
    { why: "a redirect", status: 301, body: "" },
    { why: "a server error", status: 502, body: "<html>Bad gateway</html>" },
  ])("fails $why, showing only the status", ({ status, body }) => {
    expect(checkRunsOf(status, body)).toEqual({ failure: `GitHub answered HTTP ${String(status)}` });
  });
});

describe("buildRunOf, the run of the commit's build", () => {
  it("keeps the Workers Builds run among CI's", () => {
    expect(buildRunOf([...CI_RUNS, buildRun()])).toEqual(buildRun());
  });

  it("finds none on a commit without one", () => {
    expect(buildRunOf(CI_RUNS)).toBeNull();
    expect(buildRunOf([])).toBeNull();
  });

  it.each([
    { why: "another app's run under a Workers Builds name", run: buildRun({ app: { slug: "github-actions" } }) },
    { why: "Cloudflare's run under another name", run: buildRun({ name: "Cloudflare Pages" }) },
    { why: "a run whose name only holds the prefix", run: buildRun({ name: "Not Workers Builds: drogeria-radar" }) },
    { why: "a run without an app", run: buildRun({ app: undefined }) },
    { why: "a run without a name", run: buildRun({ name: undefined }) },
    { why: "a run that isn't an object", run: "Workers Builds: drogeria-radar" },
    { why: "no run at all", run: null },
  ])("ignores $why", ({ run }) => {
    expect(buildRunOf([...CI_RUNS, run])).toBeNull();
  });

  it("keeps the run that started last when a build ran again", () => {
    const first = buildRun({ id: 30, conclusion: "failure" });
    const retried = buildRun({ id: 29, started_at: "2026-10-06T17:20:00Z" });
    expect(buildRunOf([retried, first])).toBe(retried);
    expect(buildRunOf([first, retried])).toBe(retried);
  });

  it("keeps the one with the highest id between runs that started at the same time", () => {
    const lower = buildRun({ id: 30, conclusion: "failure" });
    const higher = buildRun({ id: 31 });
    expect(buildRunOf([higher, lower])).toBe(higher);
    expect(buildRunOf([lower, higher])).toBe(higher);
  });

  it("takes a run with a start for a later one than a run without", () => {
    const started = buildRun({ id: 30 });
    const unstarted = buildRun({ id: 31, status: "queued", conclusion: null, started_at: null });
    expect(buildRunOf([unstarted, started])).toBe(started);
    expect(buildRunOf([buildRun({ id: 30, started_at: "not a time" }), unstarted])).toBe(unstarted);
  });
});

describe("headShaOf, main's head", () => {
  it("reads the commit's SHA", () => {
    expect(headShaOf(200, headAnswer(NEWER_SHA).body)).toEqual({ sha: NEWER_SHA });
  });

  it.each([
    { why: "an answer that isn't a 200", status: 404, body: JSON.stringify({ sha: NEWER_SHA }) },
    { why: "a body that isn't JSON", status: 200, body: "<html></html>" },
    { why: "a body without a SHA", status: 200, body: JSON.stringify({ commit: {} }) },
    { why: "a SHA that isn't a full one", status: 200, body: JSON.stringify({ sha: "0123456" }) },
  ])("fails $why", ({ status, body }) => {
    expect(headShaOf(status, body)).toEqual({ failure: expect.any(String) });
  });
});

describe("deployVerdict, what a poll concludes", () => {
  it("waits for 2 minutes before a commit without a run can be superseded, and 20 before it gives up", () => {
    expect(SUPERSEDED_AFTER_MS).toBe(2 * MINUTE);
    expect(GIVE_UP_AFTER_MS).toBe(20 * MINUTE);
  });

  it("passes a run that completed with success, at once", () => {
    expect(deployVerdict({ run: buildRun(), isHead: null, waitedMs: 0 })).toBe("pass");
  });

  it.each(["failure", "cancelled", "skipped", "timed_out", "neutral", "action_required", null])(
    "fails a run that completed with %s",
    (conclusion) => {
      expect(deployVerdict({ run: buildRun({ conclusion }), isHead: null, waitedMs: 0 })).toBe("fail");
    },
  );

  it.each(["queued", "in_progress"])("waits on a run %s until 20 minutes, then fails", (status) => {
    const run = buildRun({ status, conclusion: null });
    expect(deployVerdict({ run, isHead: null, waitedMs: GIVE_UP_AFTER_MS - 1 })).toBe("wait");
    expect(deployVerdict({ run, isHead: null, waitedMs: GIVE_UP_AFTER_MS })).toBe("fail");
  });

  it("waits on a run that hasn't completed even when main has moved past the commit", () => {
    const run = buildRun({ status: "in_progress", conclusion: null });
    expect(deployVerdict({ run, isHead: false, waitedMs: SUPERSEDED_AFTER_MS })).toBe("wait");
  });

  it("calls a commit without a run superseded at 2 minutes once main has moved past it, not a moment before", () => {
    expect(deployVerdict({ run: null, isHead: false, waitedMs: SUPERSEDED_AFTER_MS - 1 })).toBe("wait");
    expect(deployVerdict({ run: null, isHead: false, waitedMs: SUPERSEDED_AFTER_MS })).toBe("superseded");
    expect(deployVerdict({ run: null, isHead: false, waitedMs: GIVE_UP_AFTER_MS })).toBe("superseded");
  });

  it.each([
    { why: "still main's head", isHead: true },
    { why: "on a main whose head is unknown", isHead: null },
  ])("waits on a commit without a run $why until 20 minutes, then fails", ({ isHead }) => {
    expect(deployVerdict({ run: null, isHead, waitedMs: 0 })).toBe("wait");
    expect(deployVerdict({ run: null, isHead, waitedMs: SUPERSEDED_AFTER_MS })).toBe("wait");
    expect(deployVerdict({ run: null, isHead, waitedMs: GIVE_UP_AFTER_MS - 1 })).toBe("wait");
    expect(deployVerdict({ run: null, isHead, waitedMs: GIVE_UP_AFTER_MS })).toBe("fail");
  });
});

describe("readCheckRuns and readMainHead, the check's requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Stubs fetch with one answer, and gives the stub.
   * @param {{ status: number, body: string }} answer
   */
  function answering({ status, body }) {
    const fetchMock = vi.fn(() => Promise.resolve({ status, text: () => Promise.resolve(body) }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("asks for the commit's latest check runs with GitHub's headers and the token as a bearer, following no redirect", async () => {
    const fetchMock = answering(runsAnswer([buildRun()]));
    await expect(readCheckRuns({ ...SETTINGS, token: "made-up-token" })).resolves.toEqual({ runs: [buildRun()] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.github.com/repos/${REPO}/commits/${SHA}/check-runs?filter=latest&per_page=100`);
    expect(init.headers).toEqual({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "drogeria-radar-deploy-check",
      Authorization: "Bearer made-up-token",
    });
    expect(init).toMatchObject({ redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("asks without an Authorization header when no token is set", async () => {
    const fetchMock = answering(headAnswer(NEWER_SHA));
    await expect(readMainHead(SETTINGS)).resolves.toEqual({ sha: NEWER_SHA });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.github.com/repos/${REPO}/commits/main`);
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("fails when no answer comes, naming neither the URL nor the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(NO_ANSWER)),
    );
    await expect(readCheckRuns({ ...SETTINGS, token: "made-up-token" })).resolves.toEqual({
      failure: "no answer (ECONNRESET)",
    });
  });
});

describe("waitForDeployCheck, the polls", () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** A clock that moves only while the check sleeps between polls. */
  function fakeClock() {
    let time = 0;
    return {
      now: () => time,
      sleep: (ms) => {
        time += ms;
        return Promise.resolve();
      },
    };
  }

  /**
   * Stubs fetch with GitHub: `checkRuns(poll)` answers the check runs' request of each poll, counted from 0, and
   * `head()` the request for main's commit. An answer is `{ status, body }`, or an error the request rejects with.
   * Gives the stub.
   * @param {{ checkRuns: (poll: number) => object, head?: () => object }} answers
   */
  function github({ checkRuns, head = () => headAnswer(SHA) }) {
    let polls = 0;
    const fetchMock = vi.fn((url) => {
      const answer = String(url).includes("/check-runs?") ? checkRuns(polls++) : head();
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve({ status: answer.status, text: () => Promise.resolve(answer.body) });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /**
   * How many times the check asked for main's head.
   * @param {ReturnType<typeof vi.fn>} fetchMock
   */
  const headRequests = (fetchMock) =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commits/main")).length;

  /** Every line the check printed, stdout's then stderr's. */
  const lines = () => [...logSpy.mock.calls, ...errorSpy.mock.calls].flat();

  it("passes once the build's run completes with success, printing only its name, status and conclusion", async () => {
    const fetchMock = github({
      checkRuns: (poll) =>
        runsAnswer([...CI_RUNS, poll === 0 ? buildRun({ status: "in_progress", conclusion: null }) : buildRun()]),
    });
    await expect(waitForDeployCheck(SETTINGS, fakeClock())).resolves.toBe("pass");
    expect(lines()).toEqual([
      `Waiting for the Workers Builds check of ${SHA} in ${REPO}, without a token`,
      "[0:00]  Workers Builds: drogeria-radar in_progress  -> wait",
      "[0:15]  Workers Builds: drogeria-radar completed success  -> pass",
      "Deploy check: pass. The commit's Workers Builds check succeeded.",
    ]);
    expect(headRequests(fetchMock)).toBe(0);
  });

  it("fails when the build's run completes with failure, pointing at the runbook without a URL", async () => {
    github({ checkRuns: () => runsAnswer([...CI_RUNS, buildRun({ conclusion: "failure" })]) });
    await expect(waitForDeployCheck(SETTINGS, fakeClock())).resolves.toBe("fail");
    expect(logSpy).toHaveBeenCalledWith("[0:00]  Workers Builds: drogeria-radar completed failure  -> fail");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`Deploy check: fail.`));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(RUNBOOK));
    expect(lines().join("\n")).not.toMatch(/https?:/);
  });

  it("calls a commit without a run superseded at 2 minutes once main has moved past it, asking for main's head only then", async () => {
    const fetchMock = github({ checkRuns: () => runsAnswer(CI_RUNS), head: () => headAnswer(NEWER_SHA) });
    await expect(waitForDeployCheck(SETTINGS, fakeClock())).resolves.toBe("superseded");
    expect(logSpy).toHaveBeenCalledWith("[1:45]  no Workers Builds run yet  -> wait");
    expect(logSpy).toHaveBeenCalledWith(
      "[2:00]  no Workers Builds run yet; main has moved past the commit  -> superseded",
    );
    expect(headRequests(fetchMock)).toBe(1);
  });

  it("fails a commit that's still main's head and gets no run in 20 minutes", async () => {
    github({ checkRuns: () => runsAnswer(CI_RUNS), head: () => headAnswer(SHA) });
    await expect(waitForDeployCheck(SETTINGS, fakeClock())).resolves.toBe("fail");
    expect(logSpy).toHaveBeenCalledWith("[19:45]  no Workers Builds run yet; the commit is still main's head  -> wait");
    expect(logSpy).toHaveBeenCalledWith("[20:00]  no Workers Builds run yet; the commit is still main's head  -> fail");
  });

  it.each([
    { why: "no answer", answer: NO_ANSWER, shown: "no answer (ECONNRESET)" },
    {
      why: "a rate limit",
      answer: { status: 403, body: JSON.stringify({ message: "API rate limit exceeded" }) },
      shown: "GitHub answered HTTP 403",
    },
    {
      why: "a body that isn't JSON",
      answer: { status: 200, body: "<html>Unicorn!</html>" },
      shown: "GitHub answered 200 without the commit's list of check runs",
    },
    {
      why: "a part of the runs",
      answer: { status: 200, body: JSON.stringify({ total_count: 104, check_runs: CI_RUNS }) },
      shown: "GitHub's answer holds 3 of the commit's 104 check runs",
    },
  ])(
    "never takes $why for a commit without a run: it tries again, never asks for main's head, and fails at 20 minutes",
    async ({ answer, shown }) => {
      const fetchMock = github({ checkRuns: () => answer, head: () => headAnswer(NEWER_SHA) });
      await expect(waitForDeployCheck(SETTINGS, fakeClock())).resolves.toBe("fail");
      expect(logSpy).toHaveBeenCalledWith(`[2:00]  couldn't read the commit's check runs (${shown})  -> wait`);
      expect(logSpy).toHaveBeenCalledWith(`[20:00]  couldn't read the commit's check runs (${shown})  -> fail`);
      expect(headRequests(fetchMock)).toBe(0);
    },
  );

  it("never takes a main whose head it can't read for one that moved past the commit", async () => {
    github({ checkRuns: () => runsAnswer(CI_RUNS), head: () => ({ status: 502, body: "<html>Bad gateway</html>" }) });
    await expect(waitForDeployCheck(SETTINGS, fakeClock())).resolves.toBe("fail");
    expect(logSpy).toHaveBeenCalledWith(
      "[2:00]  no Workers Builds run yet; couldn't read main's head (GitHub answered HTTP 502)  -> wait",
    );
  });

  it("tries a poll it couldn't read again at the next one", async () => {
    github({ checkRuns: (poll) => (poll === 0 ? NO_ANSWER : runsAnswer([...CI_RUNS, buildRun()])) });
    await expect(waitForDeployCheck(SETTINGS, fakeClock())).resolves.toBe("pass");
    expect(logSpy).toHaveBeenCalledWith(
      "[0:00]  couldn't read the commit's check runs (no answer (ECONNRESET))  -> wait",
    );
  });

  it("shows no name, status or conclusion that could carry a URL, a newline or a workflow command", async () => {
    github({
      checkRuns: () => runsAnswer([buildRun({ name: "Workers Builds: x\n::error::made-up", conclusion: "fail/ure" })]),
    });
    await expect(waitForDeployCheck(SETTINGS, fakeClock())).resolves.toBe("fail");
    expect(logSpy).toHaveBeenCalledWith("[0:00]  (unreadable) completed (unreadable)  -> fail");
  });

  it("prints no token", async () => {
    github({ checkRuns: () => runsAnswer([buildRun()]) });
    await expect(waitForDeployCheck({ ...SETTINGS, token: "made-up-token" }, fakeClock())).resolves.toBe("pass");
    expect(lines()[0]).toBe(`Waiting for the Workers Builds check of ${SHA} in ${REPO}, with GitHub's token`);
    expect(lines().join("\n")).not.toContain("made-up-token");
  });
});
