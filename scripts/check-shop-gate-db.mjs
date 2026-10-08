// Database contract check: proves the shop gate's functions, RLS and grants against a running Supabase. Since test
// rollout Phase 3 it also proves that a refused reservation, capped, paused or stopped, inserts no request row, and
// that a shorter rate-limit report never shortens a longer pause.
// Run: SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<anon key> node scripts/check-shop-gate-db.mjs
// The rows it creates persist, so run `npx supabase db reset` before running it again locally.
// It reads the shop request log's sequence as the local superuser, through Docker (scripts/e2e-local-db.mjs), so the
// run also needs the local stack's database container, and .env and .dev.vars pointing at the local stack.

import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase, requestLogMark } from "./e2e-local-db.mjs";

const { SUPABASE_URL, SUPABASE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log("FAIL  SUPABASE_URL and SUPABASE_KEY must be set");
  process.exit(1);
}
// The checks create a user and pause or stop shops, so they only ever run against the local stack.
const { hostname } = new URL(SUPABASE_URL);
if (hostname !== "127.0.0.1" && hostname !== "localhost") {
  console.log(`FAIL  refusing to run against ${hostname}: point SUPABASE_URL at the local Supabase`);
  process.exit(1);
}
// The superuser's helper refuses unless the environment, .env and .dev.vars all name the local stack: checked before
// anything is written, so a refusal leaves nothing behind.
try {
  assertLocalSupabase();
} catch (error) {
  console.log(`FAIL  the request log is read as the local superuser, whose helper says: ${error.message}`);
  process.exit(1);
}

// Both clients talk only to SUPABASE_URL: `anon` never signs in, `user` holds a throwaway signed-in session.
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const anon = createClient(SUPABASE_URL, SUPABASE_KEY, clientOptions);
const user = createClient(SUPABASE_URL, SUPABASE_KEY, clientOptions);

let failed = 0;
function check(name, ok, actual) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual}`);
  if (!ok) failed++;
}

function show({ data, error }) {
  if (error) return `error ${error.code} ${error.message}`;
  return data === null ? "ok" : JSON.stringify(data);
}

const reserve = (client, shopId) => client.rpc("reserve_shop_request", { p_shop_id: shopId });

// The shop request log's sequence (requestLogMark), read as the local superuser: every reservation that's allowed
// inserts a request row and moves it, so a refused one must leave it where it was. Stops the run when the superuser
// can't be reached.
function logMark() {
  try {
    return requestLogMark();
  } catch (error) {
    check("read the shop request log's sequence as the local superuser", false, error.message);
    process.exit(1);
  }
}

/** Reserves a slot for the shop as the signed-in user, with the request log's mark before and after. */
async function reserveMarked(shopId) {
  const before = logMark();
  const result = await reserve(user, shopId);
  return { result, before, after: logMark() };
}

/** Checks that a refused reservation inserted no request row: the log's mark didn't move. */
function checkNoRow(refusal, { before, after }) {
  check(`the ${refusal} reservation inserts no request row`, after === before, `log ${before} -> ${after}`);
}

// Local sign-up is enabled with email confirmation off, so signing up returns a session.
const email = `shop-gate-${Date.now()}@example.com`;
const signUp = await user.auth.signUp({ email, password: "Shop-Gate-Passw0rd!" });
const signedIn = Boolean(signUp.data.session);
check("sign up a throwaway user", signedIn, signUp.error?.message ?? (signedIn ? email : "no session returned"));
if (!signedIn) process.exit(1);

// 1. The cap: 30 reservations in a row are allowed, and the 31st inside the same 60 seconds is refused, with no
// request row.
const first30 = [];
for (let i = 0; i < 30; i++) first30.push(await reserve(user, "rossmann"));
const refused = first30.find((result) => result.error || result.data?.outcome !== "allowed");
check("30 reservations for rossmann are allowed", !refused, refused ? show(refused) : "30 x allowed");
const thirtyFirst = await reserveMarked("rossmann");
check(
  "the 31st reservation for rossmann is capped",
  thirtyFirst.result.data?.outcome === "capped",
  show(thirtyFirst.result),
);
checkNoRow("capped", thirtyFirst);

// The row lock keeps the cap strict under concurrency: of 40 parallel reservations, exactly 30 are allowed.
const burst = await Promise.all(Array.from({ length: 40 }, () => reserve(user, "super-pharm")));
const allowed = burst.filter((result) => result.data?.outcome === "allowed").length;
const capped = burst.filter((result) => result.data?.outcome === "capped").length;
check(
  "40 parallel reservations for super-pharm allow exactly 30",
  allowed === 30 && capped === 10,
  `${allowed} allowed, ${capped} capped`,
);

// 2. Without a session the caller is anon, which may execute neither function; were the report let through, it would
// pause natura for a second. A signed-in user, in turn, may not execute applied_migrations(), which only anon may, for
// the deploy gate.
const anonCall = await reserve(anon, "rossmann");
check("anon cannot execute reserve_shop_request", anonCall.error?.code === "42501", show(anonCall));
const anonReport = await anon.rpc("report_shop_block", {
  p_shop_id: "natura",
  p_kind: "rate_limited",
  p_retry_after_seconds: 1,
});
check("anon cannot execute report_shop_block", anonReport.error?.code === "42501", show(anonReport));
const userMigrations = await user.rpc("applied_migrations");
check("signed-in user cannot execute applied_migrations", userMigrations.error?.code === "42501", show(userMigrations));

// 3. RLS is on and no API role has a table grant, so the tables are reachable only through the functions: a signed-in
// user can't read, add, change or delete a row. The update and the delete name no real row.
const directWrites = {
  shops: { row: { id: "check-shop", name: "Check" }, change: { enabled: true }, key: "id" },
  shop_requests: { row: { shop_id: "rossmann" }, change: { shop_id: "rossmann" }, key: "shop_id" },
};
for (const [table, { row, change, key }] of Object.entries(directWrites)) {
  const direct = await user.from(table).select("*").limit(1);
  check(`signed-in user cannot select from ${table}`, direct.error?.code === "42501", show(direct));
  const inserted = await user.from(table).insert(row);
  const updated = await user.from(table).update(change).eq(key, "no-such-shop");
  const deleted = await user.from(table).delete().eq(key, "no-such-shop");
  check(
    `signed-in user cannot insert into, update or delete from ${table}`,
    [inserted, updated, deleted].every((result) => result.error?.code === "42501"),
    `insert ${show(inserted)}, update ${show(updated)}, delete ${show(deleted)}`,
  );
}

// 4. A rate-limit report pauses the shop for the given delay, and the paused reservation inserts no request row.
const pauseReport = await user.rpc("report_shop_block", {
  p_shop_id: "natura",
  p_kind: "rate_limited",
  p_retry_after_seconds: 120,
});
const paused = await reserveMarked("natura");
const secondsAhead = Math.round((Date.parse(paused.result.data?.until) - Date.now()) / 1000);
check(
  "a rate_limited report pauses natura for about 120 seconds",
  !pauseReport.error && paused.result.data?.outcome === "paused" && Math.abs(secondsAhead - 120) <= 30,
  `report ${show(pauseReport)}, reserve ${show(paused.result)} (${secondsAhead}s ahead)`,
);
checkNoRow("paused", paused);

// A shorter rate-limit report never shortens a longer pause: the shop stays paused until the later of the two ends.
const shorterReport = await user.rpc("report_shop_block", {
  p_shop_id: "natura",
  p_kind: "rate_limited",
  p_retry_after_seconds: 10,
});
const stillPaused = await reserve(user, "natura");
const stillAhead = Math.round((Date.parse(stillPaused.data?.until) - Date.now()) / 1000);
check(
  "a shorter rate_limited report leaves natura paused for about 120 seconds, not 10",
  !shorterReport.error && stillPaused.data?.outcome === "paused" && Math.abs(stillAhead - 120) <= 30,
  `report ${show(shorterReport)}, reserve ${show(stillPaused)} (${stillAhead}s ahead)`,
);

// 5. A block report stops the shop, and the stopped reservation inserts no request row.
const stopReport = await user.rpc("report_shop_block", {
  p_shop_id: "hebe",
  p_kind: "blocked",
  p_retry_after_seconds: null,
  p_detail: "HTTP 403",
});
const stopped = await reserveMarked("hebe");
check(
  "a blocked report stops hebe",
  !stopReport.error && stopped.result.data?.outcome === "stopped",
  `report ${show(stopReport)}, reserve ${show(stopped.result)}`,
);
checkNoRow("stopped", stopped);

// 6. dm has no shops row.
const unknown = await reserve(user, "dm");
check("dm is an unknown shop", unknown.data?.outcome === "unknown_shop", show(unknown));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll shop gate database checks passed");
process.exit(failed ? 1 : 0);
