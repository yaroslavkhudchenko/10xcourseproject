// Local superuser access for the e2e tests (tests/e2e): what no user token may do. It holds every shop for a run, under
// the run's own name, and switches only that run's shops back on afterwards; it reads the shop request log's sequence,
// and it moves a seeded check back in time. Every statement runs as the local postgres superuser through `docker exec`
// on the local stack's database container, so it can never reach a hosted project, and nothing runs unless .env and
// .dev.vars point at the local stack.
// Between runs, before exploring the app with playwright-cli: `node scripts/e2e-local-db.mjs stop`, then `restore`.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
