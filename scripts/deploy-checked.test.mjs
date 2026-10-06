import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GROUPS } from "./check-production.mjs";
import { deployChecked, deployExitCodeOf, PAUSE_MS, RUNBOOK, wranglerDeployCommand } from "./deploy-checked.mjs";

// The checked deploy's order, which decides what reaches production: nothing deploys before its settings and the
// migration gate pass, production is checked only after a deploy that succeeded, and every failure exits non-zero,
// which turns Workers Builds' build red. What it prints lands in the build's log, so no line holds the key or the
// Supabase URL. No test starts wrangler or sends a request: each one replaces the steps that act.

const ENV = {
  CHECK_APP_URL: "https://drogeria.example",
  CHECK_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  CHECK_SUPABASE_KEY: "sb_publishable_made-up",
};

// The settings readCheckEnv reads from ENV, which every step that acts is handed.
const SETTINGS = {
  appOrigin: "https://drogeria.example",
  supabaseUrl: "https://abcdefghijklmnop.supabase.co",
  key: "sb_publishable_made-up",
};

/**
 * Steps that act, recording the order they ran in, with the gate's outcome, wrangler's exit code and the number of
 * failed check steps a test gives.
 * @param {{ gate?: object, deploy?: number, failed?: number }} [outcomes]
 */
function fakeSteps({ gate = { ok: true, count: 24 }, deploy = 0, failed = 0 } = {}) {
  /** @type {string[]} */
  const order = [];
  const step = (name, outcome) =>
    vi.fn(() => {
      order.push(name);
      return Promise.resolve(outcome);
    });
  return {
    order,
    steps: {
      gate: step("gate", gate),
      deploy: step("deploy", deploy),
      pause: step("pause", undefined),
      check: step("check", failed),
    },
  };
}

describe("deployChecked, the checked deploy", () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Everything the deploy printed, on stdout and stderr, in one text. */
  const printed = () => [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join("\n");

  it("gates, deploys, waits 10 s and checks every group, printing a line for each step", async () => {
    const { order, steps } = fakeSteps();
    await expect(deployChecked(ENV, steps)).resolves.toBe(0);
    expect(order).toEqual(["gate", "deploy", "pause", "check"]);
    expect(steps.gate).toHaveBeenCalledWith(SETTINGS);
    expect(steps.pause).toHaveBeenCalledWith(10_000);
    expect(PAUSE_MS).toBe(10_000);
    expect(steps.check).toHaveBeenCalledWith(GROUPS, SETTINGS);
    expect(GROUPS).toEqual(["pages", "sign-in", "settings"]);
    expect(logSpy.mock.calls.flat()).toEqual([
      "deploy-checked: 1/5 reading CHECK_APP_URL, CHECK_SUPABASE_URL and CHECK_SUPABASE_KEY",
      "deploy-checked: 2/5 migration gate: every migration in supabase/migrations must be on the database",
      "deploy-checked: 3/5 npx wrangler deploy",
      "deploy-checked: 4/5 waiting 10 s for the new version to answer",
      "deploy-checked: 5/5 production check of https://drogeria.example, every group",
      "deploy-checked: deployed, and production passed its check",
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([
    { why: "a missing variable", env: { CHECK_APP_URL: ENV.CHECK_APP_URL } },
    { why: "an app URL over plain http", env: { ...ENV, CHECK_APP_URL: "http://drogeria.example" } },
    { why: "a secret key", env: { ...ENV, CHECK_SUPABASE_KEY: "sb_secret_made-up" } },
  ])("refuses $why at its first step, before any request and without starting wrangler", async ({ env }) => {
    const { order, steps } = fakeSteps();
    await expect(deployChecked(env, steps)).resolves.toBe(1);
    expect(order).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`Nothing was deployed: see ${RUNBOOK}.`));
    expect(printed()).not.toContain("sb_secret_made-up");
    expect(printed()).not.toContain("2/5");
  });

  it.each([
    { why: "a migration the database lacks", gate: { ok: false, missing: ["29991231235959"] } },
    { why: "an answer it couldn't read", gate: { ok: false, failure: "applied_migrations() answered HTTP 502" } },
  ])("doesn't start wrangler when the gate refuses $why", async ({ gate }) => {
    const { order, steps } = fakeSteps({ gate });
    await expect(deployChecked(ENV, steps)).resolves.toBe(1);
    expect(order).toEqual(["gate"]);
    expect(errorSpy).toHaveBeenCalledWith(
      `deploy-checked: the migration gate refused, so nothing was deployed: see ${RUNBOOK}.`,
    );
  });

  it("exits with wrangler's code when the deploy fails, checking nothing", async () => {
    const { order, steps } = fakeSteps({ deploy: 2 });
    await expect(deployChecked(ENV, steps)).resolves.toBe(2);
    expect(order).toEqual(["gate", "deploy"]);
  });

  it("exits 1 when the check fails after the deploy, which turns the build red", async () => {
    const { order, steps } = fakeSteps({ failed: 3 });
    await expect(deployChecked(ENV, steps)).resolves.toBe(1);
    expect(order).toEqual(["gate", "deploy", "pause", "check"]);
    expect(errorSpy).toHaveBeenCalledWith(
      `deploy-checked: the new version is live, but its production check failed: see ${RUNBOOK}.`,
    );
  });

  it("prints neither the key nor the Supabase URL, whatever the outcome", async () => {
    for (const outcomes of [{}, { gate: { ok: false, missing: ["29991231235959"] } }, { deploy: 1 }, { failed: 1 }]) {
      await deployChecked(ENV, fakeSteps(outcomes).steps);
    }
    expect(printed()).not.toContain(ENV.CHECK_SUPABASE_KEY);
    expect(printed()).not.toContain("supabase.co");
  });
});

describe("wranglerDeployCommand, how wrangler starts", () => {
  it.each(["linux", "darwin"])("runs npx without a shell on %s, as Workers Builds does", (platform) => {
    expect(wranglerDeployCommand(platform)).toEqual({ command: "npx", args: ["wrangler", "deploy"], shell: false });
  });

  it("runs it through a shell only on Windows, as one command line, which Node takes without a warning", () => {
    expect(wranglerDeployCommand("win32")).toEqual({ command: "npx wrangler deploy", args: [], shell: true });
  });
});

describe("deployExitCodeOf, the exit code the deploy takes from wrangler", () => {
  it.each([
    { why: "a deploy that succeeded", code: 0, exit: 0 },
    { why: "a deploy that failed, with wrangler's own code", code: 1, exit: 1 },
    { why: "another code of wrangler's", code: 2, exit: 2 },
    { why: "a wrangler killed by a signal", code: null, exit: 1 },
    { why: "a wrangler that never started (Windows' ENOENT)", code: -4058, exit: 1 },
    { why: "a wrangler that never started (ENOENT)", code: -2, exit: 1 },
  ])("gives $exit for $why", ({ code, exit }) => {
    expect(deployExitCodeOf(code)).toBe(exit);
  });
});
