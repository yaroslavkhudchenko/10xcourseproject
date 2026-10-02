// Local superuser access for the e2e tests (tests/e2e): what no user token may do. It stops every shop for a run and
// switches those shops back on afterwards, reads the shop request log's sequence, and moves a seeded check back in time.
// Every statement runs as the local postgres superuser through `docker exec` on the local stack's database container,
// so it can never reach a hosted project, and nothing runs unless .env and .dev.vars point at the local stack.
// Between runs, before exploring the app with playwright-cli: `node scripts/e2e-local-db.mjs stop`, then `restore`.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The reason a run stops a shop with, so its teardown switches back on only those, never a shop a real block stopped.
const E2E_REASON = "e2e";
// A shop id goes into a statement only once it has this shape and names a row of public.shops.
const SHOP_ID = /^[a-z-]{1,40}$/;
// The database's rule for a shop item id (watchlist_items, watchlist_matches, price_observations).
const SHOP_ITEM_ID = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * The hosts of every SUPABASE_URL line in a dotenv-style file, since Node's loadEnvFile and wrangler take the last one:
 * each is judged. Empty when the file or the line is missing.
 * @param {string} file
 * @returns {(string | null)[]}
 */
function supabaseHostsIn(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((entry) => entry.startsWith("SUPABASE_URL="))
    .map((entry) => hostOf(entry.slice("SUPABASE_URL=".length).trim()));
}

/**
 * @param {string | undefined} url
 * @returns {string | null}
 */
function hostOf(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Refuses to go on unless both the tests' Supabase (SUPABASE_URL, from the environment or .env) and the preview's
 * (.dev.vars, which the build copies into dist/server) are the local stack. A run stops shops for the whole deployment
 * it talks to, so a hosted project must never be one.
 */
export function assertLocalSupabase() {
  const fromEnvironment = process.env.SUPABASE_URL;
  if (fromEnvironment === undefined) refuseUnlessLocal(".env", supabaseHostsIn(".env"));
  else refuseUnlessLocal("SUPABASE_URL in the environment", [hostOf(fromEnvironment)]);
  refuseUnlessLocal(".dev.vars", supabaseHostsIn(".dev.vars"));
}

/**
 * @param {string} source
 * @param {(string | null)[]} hosts
 */
function refuseUnlessLocal(source, hosts) {
  const notLocal = hosts.length === 0 ? [null] : hosts.filter((host) => host !== "127.0.0.1" && host !== "localhost");
  if (notLocal.length > 0) {
    throw new Error(
      `refusing to run e2e tests: ${source} points at ${notLocal.map((host) => host ?? "nothing").join(", ")}, not the local Supabase (127.0.0.1 or localhost)`,
    );
  }
}

/** The local stack's database container: the Supabase CLI names it after supabase/config.toml's project_id. */
function databaseContainer() {
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
  if (!projectId) throw new Error("supabase/config.toml names no project_id");
  return `supabase_db_${projectId}`;
}

/**
 * Runs one statement as the local superuser and returns its rows, one line each, columns joined by "|".
 * Every value in a statement comes from a constant or passed one of the id rules above.
 * @param {string} statement
 * @returns {string[]}
 */
function sql(statement) {
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
 * Stops every enabled shop for the run, marked as the e2e run's, and returns their ids.
 * @returns {string[]}
 */
export function stopShops() {
  return sql(
    `update public.shops set enabled = false, disabled_reason = '${E2E_REASON}', disabled_at = now(), updated_at = now() where enabled returning id`,
  );
}

/**
 * Switches back on the shops an e2e run stopped, and only those, and returns their ids.
 * @returns {string[]}
 */
export function restoreShops() {
  return sql(
    `update public.shops set enabled = true, disabled_reason = null, disabled_at = null, updated_at = now() where not enabled and disabled_reason = '${E2E_REASON}' returning id`,
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
 * The shop request log's sequence. Every reservation moves it and a stopped shop never does, so an unchanged mark proves
 * that no shop request was reserved in between.
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

// `node scripts/e2e-local-db.mjs stop|restore`: hold the shops while exploring the app between runs.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === "stop") {
    const stopped = stopShops();
    console.log(stopped.length ? `stopped: ${stopped.join(", ")}` : "no enabled shop to stop");
  } else if (command === "restore") {
    const restored = restoreShops();
    console.log(restored.length ? `switched back on: ${restored.join(", ")}` : "no shop stopped by an e2e run");
  } else {
    console.log("usage: node scripts/e2e-local-db.mjs stop|restore");
    process.exit(1);
  }
}
