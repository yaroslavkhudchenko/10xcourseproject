// Local superuser access for the e2e tests (tests/e2e) and the database tests: what no user token may do. It holds
// every shop for a run, under the run's own name, and switches only that run's shops back on afterwards; it reads the
// shop request log's sequence, it moves a seeded check back in time, and it holds a watched product's removal open while
// a database test saves a decision for it (holdRemoval). Every statement runs as the local postgres superuser through
// `docker exec` on the local stack's database container, so it can never reach a hosted project, and nothing runs
// unless .env and .dev.vars point at the local stack.
// Between runs, before exploring the app with playwright-cli: `node scripts/e2e-local-db.mjs stop`, then `restore`.

import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// The repository's root: the files the guard judges are the ones the build reads, wherever the command runs from.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Every e2e hold's reason starts with this. A run holds the shops as `e2e:<its name>` and the command line as
// `e2e:manual`, so each holder switches back on only its own shops, never another run's or a shop a real block stopped.
const HOLD = "e2e";
// A holder's name, a run's or "manual", goes into a statement only in this shape.
const HOLDER = /^[A-Za-z0-9-]{1,40}$/;
// A shop id goes into a statement only once it has this shape and names a row of public.shops.
const SHOP_ID = /^[a-z-]{1,40}$/;
// The database's rule for a shop item id (watchlist_items, watchlist_matches, price_observations).
const SHOP_ITEM_ID = /^[A-Za-z0-9._-]{1,40}$/;
// A watched product's id, the one value a held removal puts into its statements.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// How long a held removal waits for a save to wait on it, and a test for the removal to be held, before giving up.
const HOLD_SECONDS = 10;
// The only SUPABASE_URL a run accepts: the local stack, over plain http, on any port, quoted or not.
const LOCAL_URL = /^(["']?)http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?\/?\1$/;

/**
 * Refuses to go on unless both the tests' Supabase and the preview's are the local stack. A run stops shops for the whole
 * deployment it talks to, so a hosted project must never be one.
 * - The value the tests use (SUPABASE_URL in the environment, which the config loads from .env) must be local.
 * - Every line of .env and .dev.vars that mentions SUPABASE_URL, outside a comment, must be exactly a local
 *   `SUPABASE_URL=`. Node and wrangler read dotenv's wider grammar (`export`, spaces around `=`, `KEY: value`) and keep a
 *   file's last line, so any other form could set the value the build binds.
 * - .dev.vars must set it, since the build copies that file into dist/server for the preview.
 * - CLOUDFLARE_ENV must be unset: wrangler would read `.dev.vars.<that environment>` instead.
 */
export function assertLocalSupabase() {
  const cloudflareEnv = process.env.CLOUDFLARE_ENV;
  if (cloudflareEnv) refuse(`CLOUDFLARE_ENV is set, so wrangler would read .dev.vars.${cloudflareEnv} instead`);
  const fromEnvironment = process.env.SUPABASE_URL;
  if (fromEnvironment !== undefined && !LOCAL_URL.test(fromEnvironment)) {
    refuse(`SUPABASE_URL in the environment points at ${hostOf(fromEnvironment)}, not the local Supabase`);
  }
  judgeFile(".env", fromEnvironment === undefined);
  judgeFile(".dev.vars", true);
}

/**
 * Refuses a file whose SUPABASE_URL lines aren't all exactly local, or that sets none when it must.
 * @param {string} name
 * @param {boolean} required
 */
function judgeFile(name, required) {
  const file = join(ROOT, name);
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  let found = false;
  lines.forEach((line, index) => {
    if (!line.includes("SUPABASE_URL") || /^\s*#/.test(line)) return;
    found = true;
    const value = line.startsWith("SUPABASE_URL=") ? line.slice("SUPABASE_URL=".length) : null;
    if (value === null || !LOCAL_URL.test(value)) {
      refuse(`${name}, line ${String(index + 1)}, isn't SUPABASE_URL=http://127.0.0.1 or http://localhost (any port)`);
    }
  });
  if (required && !found) refuse(`${name} sets no SUPABASE_URL`);
}

/**
 * @param {string} url
 * @returns {string}
 */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "an address that doesn't parse";
  }
}

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  throw new Error(`refusing to run e2e tests: ${reason}`);
}

/** The local stack's database container: the Supabase CLI names it after supabase/config.toml's project_id. */
function databaseContainer() {
  const config = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!projectId) throw new Error("supabase/config.toml names no project_id");
  return `supabase_db_${projectId}`;
}

/**
 * Runs one statement as the local superuser and returns its rows, one line each, columns joined by "|".
 * Every value in a statement comes from a constant or passed one of the rules above, and a caller outside this file,
 * such as the catalogue check (scripts/check-catalog-db.mjs), keeps to the same rule.
 * @param {string} statement
 * @returns {string[]}
 */
export function sql(statement) {
  assertLocalSupabase();
  const output = execFileSync(
    "docker",
    [
      "exec",
      databaseContainer(),
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
      "-c",
      statement,
    ],
    { encoding: "utf8" },
  );
  return output.split(/\r?\n/).filter((line) => line !== "");
}

// The wait inside a held removal's transaction, after its delete: until the transaction blocks another backend, as a
// save that meets the deleted decision or product does. It reads the lock that backend waits for in pg_locks, which
// every role may read and which is read afresh by each query, unlike pg_stat_activity, whose snapshot a transaction
// keeps and which hides another role's wait from a role without pg_read_all_stats. Past HOLD_SECONDS it raises, which
// rolls the removal back. Its text starts with its own dollar quote, by which a test finds it running (holdRemoval).
const HOLD_WAIT = `do $hold_removal$
declare
  deadline constant timestamptz := clock_timestamp() + interval '${String(HOLD_SECONDS)} seconds';
begin
  loop
    exit when exists (
      select 1
      from pg_locks as l
      where not l.granted and pg_backend_pid() = any (pg_blocking_pids(l.pid))
    );
    if clock_timestamp() > deadline then
      raise exception 'holdRemoval: no save waited on the removal within ${String(HOLD_SECONDS)} seconds';
    end if;
    perform pg_sleep(0.02);
  end loop;
end
$hold_removal$`;

/**
 * Holds a watched product's removal open while a database test saves a decision for it, so the two overlap
 * (src/lib/services/matches.db.test.ts). As the local superuser, in one transaction, it deletes the product, whose key
 * deletes its decisions with it, then waits until its transaction blocks another backend (pg_blocking_pids), as a save
 * that meets the deleted decision or product does, and commits at once, well within the store's 2-second limit. If
 * nothing waits on it within HOLD_SECONDS, it rolls back and fails, so a test can't pass without the overlap. It starts
 * psql without waiting for it, and gives two promises:
 * - `held` resolves once the delete, its cascade included, has returned. psql sends each statement, one `-c` each, as
 *   its own request in one session, so the hold's backend, found by its application_name, runs the wait only after the
 *   delete; one `-c` holding every statement would be a single request, shown whole from the start.
 * - `done` resolves once the removal commits, and rejects when it rolled back or psql failed.
 * It refuses any id but a UUID, and, like sql(), runs nothing unless .env and .dev.vars point at the local stack.
 * @param {string} itemId
 * @returns {{ held: Promise<void>, done: Promise<void> }}
 */
export function holdRemoval(itemId) {
  if (!UUID.test(itemId)) throw new Error(`refusing to hold the removal of ${itemId}`);
  assertLocalSupabase();
  const id = itemId.toLowerCase();
  // The hold's backend, by its name: one product's removal is held at a time.
  const holder = `hold-removal-${id}`;
  const removal = promisify(execFile)("docker", [
    "exec",
    databaseContainer(),
    "psql",
    "-U",
    "postgres",
    "-d",
    `dbname=postgres application_name=${holder}`,
    "-v",
    "ON_ERROR_STOP=1",
    "-qAt",
    "-c",
    "begin",
    "-c",
    `do $remove$ begin delete from public.watchlist_items where id = '${id}'; if not found then raise exception 'holdRemoval: no watched product ${id}'; end if; end $remove$`,
    "-c",
    HOLD_WAIT,
    "-c",
    "commit",
  ]);
  let ended = false;
  const done = removal.then(
    () => {
      ended = true;
    },
    (error) => {
      ended = true;
      throw new Error(`the held removal of ${id} failed: ${failureOf(error)}`);
    },
  );
  const held = (async () => {
    const deadline = Date.now() + HOLD_SECONDS * 1000;
    for (;;) {
      // sql() connects as the hold's own role, to which pg_stat_activity shows the hold's statement.
      const waiting = sql(
        `select pid from pg_stat_activity where application_name = '${holder}' and query like 'do $hold_removal$%'`,
      );
      if (waiting.length > 0) return;
      if (ended) throw new Error(`the removal of ${id} ended before it was held`);
      if (Date.now() > deadline) {
        throw new Error(`the removal of ${id} wasn't held within ${String(HOLD_SECONDS)} seconds`);
      }
      await sleep(50);
    }
  })();
  // Either may reject before a test awaits it, as when the other fails first; the test still sees it when it does.
  held.catch(() => undefined);
  done.catch(() => undefined);
  return { held, done };
}

/**
 * What a failed psql run said: its error output, or else the error's message.
 * @param {unknown} error
 * @returns {string}
 */
function failureOf(error) {
  const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr).trim() : "";
  if (stderr) return stderr;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The reason a holder's shops carry.
 * @param {string} holder
 * @returns {string}
 */
function holdOf(holder) {
  if (!HOLDER.test(holder)) throw new Error(`refusing a hold named ${holder}`);
  return `${HOLD}:${holder}`;
}

/**
 * Stops every enabled shop, held under the holder's name (a run's, or "manual"), and returns their ids.
 * @param {string} holder
 * @returns {string[]}
 */
export function stopShops(holder) {
  return sql(
    `update public.shops set enabled = false, disabled_reason = '${holdOf(holder)}', disabled_at = now(), updated_at = now() where enabled returning id`,
  );
}

/**
 * Switches back on the shops the holder stopped, and only those, and returns their ids.
 * @param {string} holder
 * @returns {string[]}
 */
export function restoreShops(holder) {
  return sql(
    `update public.shops set enabled = true, disabled_reason = null, disabled_at = null, updated_at = now() where not enabled and disabled_reason = '${holdOf(holder)}' returning id`,
  );
}

/**
 * The shops an e2e holder stops, as "<shop>|<reason>": none while no run or manual stop holds them.
 * @returns {string[]}
 */
export function e2eHolds() {
  return sql(
    `select id || '|' || disabled_reason from public.shops where not enabled and disabled_reason like '${HOLD}%' order by id`,
  );
}

/**
 * Switches back on every shop any e2e holder stops: the way out of a hold whose run was killed before its teardown.
 * Only while no run is going, since it releases that run's hold too.
 * @returns {string[]}
 */
export function restoreAllHolds() {
  return sql(
    `update public.shops set enabled = true, disabled_reason = null, disabled_at = null, updated_at = now() where not enabled and disabled_reason like '${HOLD}%' returning id`,
  );
}

/**
 * The shops still enabled: none while a run holds them.
 * @returns {string[]}
 */
export function enabledShops() {
  return sql("select id from public.shops where enabled order by id");
}

/**
 * The shop request log's sequence and whether it was ever used. Every reservation moves it and a stopped shop never
 * does, so an unchanged mark proves that no shop request was reserved in between, the first one on a fresh stack too.
 * @returns {string}
 */
export function requestLogMark() {
  const [mark] = sql("select last_value || ':' || is_called from public.shop_requests_id_seq");
  if (!mark) throw new Error("the shop request log's sequence has no value");
  return mark;
}

/**
 * Moves a shop item's checks back by whole hours, the one price state a user's token can't write (the database stamps
 * observed_at). Returns how many checks moved.
 * @param {string} shopId
 * @param {string} shopItemId
 * @param {number} hours
 * @returns {number}
 */
export function backdateChecks(shopId, shopItemId, hours) {
  if (!SHOP_ID.test(shopId) || !SHOP_ITEM_ID.test(shopItemId) || !Number.isInteger(hours) || hours < 1) {
    throw new Error(`refusing to backdate ${shopId}/${shopItemId} by ${String(hours)} hours`);
  }
  // A shop that doesn't exist would move nothing and read like an item without checks.
  if (!sql("select id from public.shops").includes(shopId)) {
    throw new Error(`refusing to backdate checks for ${shopId}: public.shops has no such shop`);
  }
  return sql(
    `update public.price_observations set observed_at = observed_at - interval '${String(hours)} hours' where shop_id = '${shopId}' and shop_item_id = '${shopItemId}' returning id`,
  ).length;
}

// `node scripts/e2e-local-db.mjs stop|restore`: hold the shops while exploring the app between runs, and let them go.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === "stop") {
    // A run holds them already: a manual hold now would end when that run's teardown switches its shops back on.
    const held = e2eHolds();
    if (held.length) {
      console.log(`already held: ${held.join(", ")}. Wait for that run, or run \`restore\` if none is going.`);
      process.exit(1);
    }
    const stopped = stopShops("manual");
    console.log(stopped.length ? `stopped: ${stopped.join(", ")}` : "no enabled shop to stop");
  } else if (command === "restore") {
    const restored = restoreAllHolds();
    console.log(restored.length ? `switched back on: ${restored.join(", ")}` : "no shop held by an e2e run or a stop");
  } else {
    console.log("usage: node scripts/e2e-local-db.mjs stop|restore");
    process.exit(1);
  }
}
