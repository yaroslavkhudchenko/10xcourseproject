// Migration gate: says whether every migration in the repository is applied to the database it asks, and refuses
// otherwise, naming each version the database lacks. It asks public.applied_migrations()
// (supabase/migrations/20261006183345_applied_migrations.sql) through PostgREST with the project's publishable key
// alone, so it needs no password, no token and no session, and it writes nothing. Zero dependencies, like
// scripts/check-production.mjs.
//
//   CHECK_SUPABASE_URL=<project URL> CHECK_SUPABASE_KEY=<publishable key> \
//     node scripts/check-migrations-applied.mjs [--migrations-dir=<dir>]
//
// It compares the versions of the .sql files in the repository's supabase/migrations, wherever the command runs from,
// or in --migrations-dir, with the versions the database answers. A database ahead of the repository passes, since a
// change's migration reaches production before its code merges. It prints `All <n> migrations are applied` and exits
// 0, or `Missing on the database: <versions>` and exits 1.
//
// It reads the two variables from its own environment only, set on its command line or by the build that runs it. It
// refuses, exiting 1 before any request, when a variable is missing or refused (readCheckEnv in scripts/hosted-env.mjs,
// which refuses a secret key) and when a .sql file's name holds no version. It fails, exiting 1, on an answer it can't
// read: none at all, an HTTP error, the function missing (PGRST202) or a body that isn't a list of versions, none of
// which ever reads as nothing applied. Refusals and failures start with `check-migrations-applied:`, and no output holds
// the key, the Supabase URL or an answer's body. CI runs it against the local stack twice: with every migration, which
// must pass, and with a version the database lacks, which must be refused.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { failureOf, TIMEOUT_MS } from "./check-production.mjs";
import { readCheckEnv } from "./hosted-env.mjs";

const USAGE =
  "Usage: CHECK_SUPABASE_URL=<project URL> CHECK_SUPABASE_KEY=<publishable key> node scripts/check-migrations-applied.mjs [--migrations-dir=<dir>]";

/** The repository's migrations, which a run reads without --migrations-dir, wherever the command runs from. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../supabase/migrations", import.meta.url));

// A migration's file name, as CLAUDE.md names it and the Supabase CLI applies it: a 14-digit version (YYYYMMDDHHmmss),
// an underscore, a name and .sql.
const MIGRATION_FILE = /^(\d{14})_.+\.sql$/;

// A file the migrations directory holds as SQL, in any case. Each must be a migration's: one the Supabase CLI skips
// for its name would never reach the database, so the gate refuses it rather than leave it out.
const SQL_FILE = /\.sql$/i;

// PostgREST's error code, shown from an error's body only in this shape: its own PGRST codes and Postgres's SQLSTATEs.
const ERROR_CODE = /^(?:PGRST\d{3}|[0-9A-Z]{5})$/;

// How missing migrations get applied, wherever the gate asked.
const APPLY_HINT =
  "npx supabase db push for production (context/deployment/deploy-plan.md), or npx supabase migration up --local for the local stack";

/**
 * The version of a migration's file name, `YYYYMMDDHHmmss_<name>.sql`: its 14-digit prefix, or null for any other
 * name, such as one without a version, with a version of another length, with no name, or not a .sql file.
 * @param {string} fileName
 * @returns {string | null}
 */
export function versionOf(fileName) {
  return MIGRATION_FILE.exec(fileName)?.[1] ?? null;
}

/**
 * The versions of the migrations a directory holds, from the names of its files, in name order. Every .sql file must
 * be a migration's, so the first that isn't gives `{ failure }`, naming it; so does a directory without a .sql file,
 * which is most likely the wrong one, rather than pass with nothing to check. Other files are left out, as the
 * Supabase CLI leaves them.
 * @param {string[]} fileNames
 * @returns {{ versions: string[] } | { failure: string }}
 */
export function listMigrationVersions(fileNames) {
  const sqlFiles = fileNames.filter((name) => SQL_FILE.test(name)).sort();
  if (sqlFiles.length === 0) return { failure: "no .sql file, so no migration to check" };
  /** @type {string[]} */
  const versions = [];
  for (const name of sqlFiles) {
    const version = versionOf(name);
    if (version === null) {
      return { failure: `${JSON.stringify(name)} has no version: name it <YYYYMMDDHHmmss>_<name>.sql` };
    }
    versions.push(version);
  }
  return { versions };
}

/**
 * The local versions the database lacks, in order and each once. A version only the database has isn't missing:
 * production holds a change's migration before its code merges.
 * @param {string[]} localVersions
 * @param {string[]} appliedVersions
 * @returns {string[]}
 */
export function missingMigrations(localVersions, appliedVersions) {
  const applied = new Set(appliedVersions);
  return [...new Set(localVersions)].filter((version) => !applied.has(version)).sort();
}

/**
 * What an answer of applied_migrations() says: `{ versions }` only for a 200 whose body is a JSON list of strings, an
 * empty one included. Anything else gives `{ failure }`, never an empty list, so an answer the gate can't read never
 * passes for one that names nothing: the function missing (PGRST202) says to push this change's migration first, and
 * any other status shows only itself and PostgREST's error code. No failure holds the body.
 * @param {number} status
 * @param {string} body
 * @returns {{ versions: string[] } | { failure: string }}
 */
export function appliedVersionsOf(status, body) {
  const answer = jsonOf(body);
  if (status !== 200) {
    const code = errorCodeOf(answer);
    if (code === "PGRST202") {
      return {
        failure: `the database has no applied_migrations() (PGRST202): push this change's migration first, with ${APPLY_HINT}`,
      };
    }
    return { failure: `applied_migrations() answered HTTP ${status}${code === null ? "" : ` (${code})`}` };
  }
  if (!Array.isArray(answer) || !answer.every((version) => typeof version === "string")) {
    return { failure: "applied_migrations() answered 200 with something other than a list of versions" };
  }
  return { versions: answer };
}

/**
 * Asks the database at `supabaseUrl` which migrations it has applied: one POST of `{}` to applied_migrations() through
 * PostgREST, with the key in the apikey header only, never as a bearer token, so the caller is the anon role. It
 * follows no redirect, and allows check-production's TIMEOUT_MS for the answer and its body. Gives what
 * appliedVersionsOf reads of the answer, or `{ failure }` when none came, which names neither the URL nor the key.
 * @param {string} supabaseUrl The project's URL without a trailing slash, as readCheckEnv gives it.
 * @param {string} key The project's publishable key.
 * @returns {Promise<{ versions: string[] } | { failure: string }>}
 */
export async function readAppliedMigrations(supabaseUrl, key) {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/applied_migrations`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return appliedVersionsOf(response.status, await response.text());
  } catch (error) {
    return { failure: `asking applied_migrations() failed: ${failureOf(error)}` };
  }
}

/**
 * The migrations directory a run reads, from its arguments: the repository's supabase/migrations without one, else
 * the one `--migrations-dir=<dir>` names. Gives `{ refusal }` instead for any other argument, a second one, and a
 * flag that names no directory. A refusal repeats no argument, which could be a pasted key.
 * @param {string[]} args
 * @returns {{ migrationsDir: string } | { refusal: string }}
 */
export function migrationsDirOf(args) {
  if (args.length === 0) return { migrationsDir: MIGRATIONS_DIR };
  if (args.length > 1) return { refusal: "give --migrations-dir=<dir> once, or no argument" };
  const match = /^--migrations-dir=(.*)$/.exec(args[0]);
  if (match === null) return { refusal: "give --migrations-dir=<dir>, or no argument" };
  return match[1] === "" ? { refusal: "--migrations-dir names no directory" } : { migrationsDir: match[1] };
}

/**
 * The gate, for the command line and for a script that runs it in-process: reads the versions of the migrations in
 * `migrationsDir` before any request, asks the database `settings` names (readCheckEnv) which it has applied, and
 * prints the outcome, a failure on stderr after `check-migrations-applied:`. Gives `{ ok: true, count }` when every
 * one of its `count` migrations is applied, `{ ok: false, missing }` with the versions the database lacks, and
 * `{ ok: false, failure }` when the directory or the answer can't be read.
 * @param {{ supabaseUrl: string, key: string }} settings
 * @param {string} [migrationsDir]
 * @returns {Promise<{ ok: true, count: number } | { ok: false, missing: string[] } | { ok: false, failure: string }>}
 */
export async function checkMigrationsApplied({ supabaseUrl, key }, migrationsDir = MIGRATIONS_DIR) {
  const local = readMigrationVersions(migrationsDir);
  if ("failure" in local) return failedWith(local.failure);
  const applied = await readAppliedMigrations(supabaseUrl, key);
  if ("failure" in applied) return failedWith(applied.failure);
  const missing = missingMigrations(local.versions, applied.versions);
  if (missing.length > 0) {
    console.log(`Missing on the database: ${missing.join(", ")}`);
    console.log(`Apply them before the deploy: ${APPLY_HINT}.`);
    return { ok: false, missing };
  }
  console.log(`All ${local.versions.length} migrations are applied`);
  return { ok: true, count: local.versions.length };
}

/**
 * The versions of the migrations in `dir` (listMigrationVersions), or `{ failure }` when it can't be read, naming it.
 * @param {string} dir
 * @returns {{ versions: string[] } | { failure: string }}
 */
function readMigrationVersions(dir) {
  /** @type {string[]} */
  let fileNames;
  try {
    fileNames = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    const code = error?.code;
    return {
      failure: `can't read the migrations directory ${dir} (${typeof code === "string" ? code : "unreadable"})`,
    };
  }
  const listed = listMigrationVersions(fileNames);
  return "failure" in listed ? { failure: `${listed.failure} (in ${dir})` } : listed;
}

/**
 * @param {string} body
 * @returns {unknown} The body as JSON, or undefined when it isn't JSON.
 */
function jsonOf(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * PostgREST's error code in an error's body, or null when it holds none in a code's shape.
 * @param {unknown} answer
 * @returns {string | null}
 */
function errorCodeOf(answer) {
  const code = typeof answer === "object" && answer !== null ? answer.code : undefined;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : null;
}

/**
 * Prints why the gate fails and gives its outcome.
 * @param {string} failure
 * @returns {{ ok: false, failure: string }}
 */
function failedWith(failure) {
  console.error(`check-migrations-applied: ${failure}`);
  return { ok: false, failure };
}

/**
 * Prints why the gate stops, with the usage, and exits before any request.
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.error(`check-migrations-applied: ${reason}\n${USAGE}`);
  process.exit(1);
}

// `node scripts/check-migrations-applied.mjs [--migrations-dir=<dir>]`: every refusal comes before any request.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = migrationsDirOf(process.argv.slice(2));
  if ("refusal" in options) refuse(options.refusal);
  const settings = readCheckEnv(process.env, { supabase: true });
  if ("refusal" in settings) refuse(settings.refusal);
  const result = await checkMigrationsApplied(settings, options.migrationsDir);
  process.exit(result.ok ? 0 : 1);
}
