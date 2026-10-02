// What the setup project hands the specs and the teardown: where the signed-in session is saved, and the run's name,
// user, session, request-log mark and the shops it stopped. Both files live in playwright/.auth/, which git ignores.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The run's signed-in session, which every spec's browser starts with (storageState). */
export const SESSION_FILE = "playwright/.auth/user.json";
const RUN_FILE = "playwright/.auth/run.json";

export interface Run {
  /** The run's name (runId), which the shops it stops are held under. */
  run: string;
  /** The run's throwaway local user, signed up by the setup. */
  email: string;
  /** The user's session from the sign-up, which the seeding helpers take over instead of signing in again. */
  session: { accessToken: string; refreshToken: string };
  /** The shop request log's sequence once every shop was stopped, for the teardown to compare. */
  mark: string;
  /** The shops the setup stopped, all of which the teardown must switch back on. */
  stopped: string[];
}

/** This run's name, which playwright.config.ts sets once and every worker inherits. */
export function runId(): string {
  const run = process.env.E2E_RUN;
  if (!run) throw new Error("E2E_RUN is unset: run the suite through playwright.config.ts");
  return run;
}

export function writeRun(run: Run): void {
  mkdirSync(dirname(RUN_FILE), { recursive: true });
  writeFileSync(RUN_FILE, JSON.stringify(run));
}

/** Forgets an earlier run, so its user and mark can't be mistaken for this run's. */
export function clearRun(): void {
  rmSync(RUN_FILE, { force: true });
}

export function readRun(): Run {
  if (!existsSync(RUN_FILE)) throw new Error(`no ${RUN_FILE}: the setup project didn't finish`);
  const run: unknown = JSON.parse(readFileSync(RUN_FILE, "utf8"));
  if (!isRun(run)) throw new Error(`${RUN_FILE} isn't a run the setup wrote`);
  return run;
}

function isRun(value: unknown): value is Run {
  if (typeof value !== "object" || value === null) return false;
  const { run, email, session, mark, stopped } = value as Record<string, unknown>;
  if (typeof session !== "object" || session === null) return false;
  const { accessToken, refreshToken } = session as Record<string, unknown>;
  return (
    typeof run === "string" &&
    typeof email === "string" &&
    typeof accessToken === "string" &&
    typeof refreshToken === "string" &&
    typeof mark === "string" &&
    Array.isArray(stopped) &&
    stopped.every((shop) => typeof shop === "string")
  );
}
