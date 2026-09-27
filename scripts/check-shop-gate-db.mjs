// Database contract check: proves the shop gate's functions, RLS and grants against a running Supabase.
// Run: SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<anon key> node scripts/check-shop-gate-db.mjs
// The rows it creates persist, so run `npx supabase db reset` before running it again locally.

import { createClient } from "@supabase/supabase-js";

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

// Local sign-up is enabled with email confirmation off, so signing up returns a session.
const email = `shop-gate-${Date.now()}@example.com`;
const signUp = await user.auth.signUp({ email, password: "Shop-Gate-Passw0rd!" });
const signedIn = Boolean(signUp.data.session);
check("sign up a throwaway user", signedIn, signUp.error?.message ?? (signedIn ? email : "no session returned"));
if (!signedIn) process.exit(1);

// 1. The cap: 30 reservations in a row are allowed, and the 31st inside the same 60 seconds is refused.
const first30 = [];
for (let i = 0; i < 30; i++) first30.push(await reserve(user, "rossmann"));
const refused = first30.find((result) => result.error || result.data?.outcome !== "allowed");
check("30 reservations for rossmann are allowed", !refused, refused ? show(refused) : "30 x allowed");
const thirtyFirst = await reserve(user, "rossmann");
check("the 31st reservation for rossmann is capped", thirtyFirst.data?.outcome === "capped", show(thirtyFirst));

// The row lock keeps the cap strict under concurrency: of 40 parallel reservations, exactly 30 are allowed.
const burst = await Promise.all(Array.from({ length: 40 }, () => reserve(user, "super-pharm")));
const allowed = burst.filter((result) => result.data?.outcome === "allowed").length;
const capped = burst.filter((result) => result.data?.outcome === "capped").length;
check(
  "40 parallel reservations for super-pharm allow exactly 30",
  allowed === 30 && capped === 10,
  `${allowed} allowed, ${capped} capped`,
);

// 2. Without a session the caller is anon, which has no execute grant.
const anonCall = await reserve(anon, "rossmann");
check("anon cannot execute reserve_shop_request", anonCall.error?.code === "42501", show(anonCall));

// 3. RLS is on and no API role has a table grant, so the tables are reachable only through the functions.
for (const table of ["shops", "shop_requests"]) {
  const direct = await user.from(table).select("*").limit(1);
  check(`signed-in user cannot select from ${table}`, direct.error?.code === "42501", show(direct));
}

// 4. A rate-limit report pauses the shop for the given delay.
const pauseReport = await user.rpc("report_shop_block", {
  p_shop_id: "natura",
  p_kind: "rate_limited",
  p_retry_after_seconds: 120,
});
const paused = await reserve(user, "natura");
const secondsAhead = Math.round((Date.parse(paused.data?.until) - Date.now()) / 1000);
check(
  "a rate_limited report pauses natura for about 120 seconds",
  !pauseReport.error && paused.data?.outcome === "paused" && Math.abs(secondsAhead - 120) <= 30,
  `report ${show(pauseReport)}, reserve ${show(paused)} (${secondsAhead}s ahead)`,
);

// 5. A block report stops the shop.
const stopReport = await user.rpc("report_shop_block", {
  p_shop_id: "hebe",
  p_kind: "blocked",
  p_retry_after_seconds: null,
  p_detail: "HTTP 403",
});
const stopped = await reserve(user, "hebe");
check(
  "a blocked report stops hebe",
  !stopReport.error && stopped.data?.outcome === "stopped",
  `report ${show(stopReport)}, reserve ${show(stopped)}`,
);

// 6. dm has no shops row.
const unknown = await reserve(user, "dm");
check("dm is an unknown shop", unknown.data?.outcome === "unknown_shop", show(unknown));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll shop gate database checks passed");
process.exit(failed ? 1 : 0);
