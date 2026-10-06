// Checked deploy: Workers Builds' deploy command, `npm run deploy:checked`. It deploys only code whose migrations the
// production database already has, then checks production, and turns the build red when either fails. Its steps, in
// order, each printing its own line:
// 1. The settings: CHECK_APP_URL, CHECK_SUPABASE_URL and CHECK_SUPABASE_KEY (readCheckEnv in scripts/hosted-env.mjs),
//    refused when one is missing, a URL is insecure or the key is a secret one.
// 2. The migration gate (checkMigrationsApplied in scripts/check-migrations-applied.mjs): every migration in
//    supabase/migrations must be applied to the database, which it asks with the publishable key.
// 3. `npx wrangler deploy`, from the repository's root, its output shown as it comes. It deploys the new version to all
//    traffic at once.
// 4. A 10 s pause, so the check meets the new version: no answer of the app says which version gave it.
// 5. The production check (runCheck in scripts/check-production.mjs), every group, signed out and read-only.
//
// It fails closed. A refusal in step 1 or 2 exits 1 before wrangler starts, so nothing is deployed, and a missing
// variable can't switch the gate off. A deploy that fails exits with wrangler's own code. A check that fails exits 1
// with the new version live: that turns the build red, and rolls nothing back. What each failure means and what to do
// is in context/deployment/deploy-plan.md, "Checked deploys". The emergency path, a manual `npx wrangler deploy`, skips
// both the gate and the check, so run `node scripts/check-migrations-applied.mjs` before it and
// `npm run check:production` after it, with the same three variables.
//
//   CHECK_APP_URL=<app origin> CHECK_SUPABASE_URL=<project URL> CHECK_SUPABASE_KEY=<publishable key> \
//     npm run deploy:checked
//
// It reads its environment only, Workers Builds' build variables or values set on its command line, never a file, and
// takes no argument, so one meant for wrangler, such as --dry-run, can't go unnoticed while it deploys for real. No line
// it prints holds the key or the Supabase URL. The app's origin appears, in Workers Builds' build log, which is private
// to the Cloudflare account.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { checkMigrationsApplied } from "./check-migrations-applied.mjs";
import { GROUPS, runCheck } from "./check-production.mjs";
import { readCheckEnv } from "./hosted-env.mjs";

const USAGE =
  "Usage: CHECK_APP_URL=<app origin> CHECK_SUPABASE_URL=<project URL> CHECK_SUPABASE_KEY=<publishable key> npm run deploy:checked";

/** Where the owner reads what a red deploy means and what to do, for this script and the Deploy check's. */
export const RUNBOOK = '"Checked deploys" in context/deployment/deploy-plan.md';

/** How long the deploy waits after `wrangler deploy` before it checks production, for the new version to answer. */
export const PAUSE_MS = 10_000;

// The repository's root, where wrangler reads wrangler.jsonc and the build's dist/, wherever the command runs from.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * @typedef {object} Steps The steps that act, which a test replaces.
 * @property {(settings: { supabaseUrl: string, key: string }) => Promise<{ ok: boolean }>} gate The migration gate.
 * @property {() => Promise<number>} deploy `npx wrangler deploy`, giving the exit code the deploy takes from it.
 * @property {(ms: number) => Promise<unknown>} pause
 * @property {(groups: string[], settings: object) => Promise<number>} check The production check, giving how many of its
 *   steps failed.
 */

/**
 * How the deploy starts wrangler on `platform` (process.platform): `npx wrangler deploy` without a shell, except on
 * Windows, where npx is a .cmd script that only a shell runs. There it is one command line with no separate arguments,
 * since Node warns about arguments given beside a shell (DEP0190).
 * @param {string} platform
 * @returns {{ command: string, args: string[], shell: boolean }}
 */
export function wranglerDeployCommand(platform) {
  return platform === "win32"
    ? { command: "npx wrangler deploy", args: [], shell: true }
    : { command: "npx", args: ["wrangler", "deploy"], shell: false };
}

/**
 * The exit code the deploy takes from a run of wrangler that closed with `code`: 0 for a deploy that succeeded,
 * wrangler's own code for one that failed, and 1 for one that ended without a code of its own, killed by a signal
 * (null) or never started (a negative errno).
 * @param {number | null} code
 * @returns {number}
 */
export function deployExitCodeOf(code) {
  return Number.isInteger(code) && code >= 0 ? code : 1;
}

/**
 * Runs `npx wrangler deploy` from the repository's root, its output shown as it comes, and gives the exit code the
 * deploy takes from it (deployExitCodeOf); a wrangler that couldn't start gives 1.
 * @returns {Promise<number>}
 */
function wranglerDeploy() {
  const { command, args, shell } = wranglerDeployCommand(process.platform);
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit", shell });
    child.once("error", (error) => {
      const code = typeof error.code === "string" ? ` (${error.code})` : "";
      console.error(`deploy-checked: couldn't start ${command}${code}`);
      resolve(1);
    });
    child.once("close", (code) => {
      resolve(deployExitCodeOf(code));
    });
  });
}

/**
 * The checked deploy, step by step (see the header), each step printing its line and a failure going to stderr with
 * where to read on. Gives the exit code: 1 for a refusal of the settings or the gate, neither of which starts wrangler;
 * wrangler's own code for a deploy that failed, after which nothing is checked; 1 for a production check that failed
 * after the deploy; and 0 once production passed its check. `steps` replaces the steps that act, for a test.
 * @param {Record<string, string | undefined>} env
 * @param {Partial<Steps>} [steps]
 * @returns {Promise<number>}
 */
export async function deployChecked(env, steps = {}) {
  const { gate = checkMigrationsApplied, deploy = wranglerDeploy, pause = delay, check = runCheck } = steps;

  console.log("deploy-checked: 1/5 reading CHECK_APP_URL, CHECK_SUPABASE_URL and CHECK_SUPABASE_KEY");
  const settings = readCheckEnv(env);
  if ("refusal" in settings) {
    console.error(`deploy-checked: ${settings.refusal}. Nothing was deployed: see ${RUNBOOK}.\n${USAGE}`);
    return 1;
  }

  console.log("deploy-checked: 2/5 migration gate: every migration in supabase/migrations must be on the database");
  const gated = await gate(settings);
  if (!gated.ok) {
    console.error(`deploy-checked: the migration gate refused, so nothing was deployed: see ${RUNBOOK}.`);
    return 1;
  }

  console.log("deploy-checked: 3/5 npx wrangler deploy");
  const code = await deploy();
  if (code !== 0) {
    console.error(`deploy-checked: npx wrangler deploy failed (exit ${code}), so nothing was checked: see ${RUNBOOK}.`);
    return code;
  }

  console.log(`deploy-checked: 4/5 waiting ${PAUSE_MS / 1000} s for the new version to answer`);
  await pause(PAUSE_MS);

  console.log(`deploy-checked: 5/5 production check of ${settings.appOrigin}, every group`);
  const failed = await check(GROUPS, settings);
  if (failed !== 0) {
    console.error(`deploy-checked: the new version is live, but its production check failed: see ${RUNBOOK}.`);
    return 1;
  }
  console.log("deploy-checked: deployed, and production passed its check");
  return 0;
}

// `npm run deploy:checked`: every refusal comes before any request, and before wrangler starts.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error(`deploy-checked: give no argument: it reads its settings from its environment only\n${USAGE}`);
    process.exit(1);
  }
  process.exit(await deployChecked(process.env));
}
