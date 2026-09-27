// Database contract check: proves that watchlist rows stay private to their owner against a running Supabase.
// Run: SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<anon key> node scripts/check-watchlist-db.mjs
// Each run signs up two fresh users, so it can run again without resetting the database.

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log("FAIL  SUPABASE_URL and SUPABASE_KEY must be set");
  process.exit(1);
}
// The checks sign up users and write rows, so they only ever run against the local stack.
const { hostname } = new URL(SUPABASE_URL);
if (hostname !== "127.0.0.1" && hostname !== "localhost") {
  console.log(`FAIL  refusing to run against ${hostname}: point SUPABASE_URL at the local Supabase`);
  process.exit(1);
}

// Every client talks only to SUPABASE_URL: `anon` never signs in, each user holds a throwaway signed-in session.
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const anon = createClient(SUPABASE_URL, SUPABASE_KEY, clientOptions);

let failed = 0;
function check(name, ok, actual) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual}`);
  if (!ok) failed++;
}

function show({ data, error }) {
  if (error) return `error ${error.code} ${error.message}`;
  return data === null ? "ok" : JSON.stringify(data);
}

// Local sign-up is enabled with email confirmation off, so signing up returns a session.
async function signUpUser(label) {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, clientOptions);
  const email = `watchlist-${label}-${Date.now()}@example.com`;
  const { data, error } = await client.auth.signUp({ email, password: "Watchlist-Passw0rd!" });
  const id = data.session ? data.user?.id : undefined;
  check(`sign up throwaway user ${label}`, Boolean(id), error?.message ?? (id ? email : "no session returned"));
  return { client, id };
}

const a = await signUpUser("a");
const b = await signUpUser("b");
if (!a.id || !b.id) process.exit(1);

const rossmannItem = (sourceItemId) => ({
  source: "rossmann",
  source_item_id: sourceItemId,
  brand: "NIVEA",
  name: "Soft",
  caption: "krem uniwersalny, nawilżający",
  size_text: "300 ml",
  size_value: 300,
  size_unit: "ml",
  eans: ["4005900009319"],
});

// 1. The owner adds a row and reads back exactly that row.
const added = await a.client.from("watchlist_items").insert(rossmannItem("26900")).select("id, user_id").single();
const aRowId = added.data?.id;
check("user A adds a Rossmann product", !added.error && added.data?.user_id === a.id, show(added));
const aRows = await a.client.from("watchlist_items").select("id");
check("user A reads back exactly their one row", aRows.data?.length === 1 && aRows.data[0].id === aRowId, show(aRows));

// 2. The same product can't be added twice.
const duplicate = await a.client.from("watchlist_items").insert(rossmannItem("26900"));
check("user A can't add the same product twice", duplicate.error?.code === "23505", show(duplicate));

// 3. Another user sees none of it, not even when asking for the row by its id.
const bAll = await b.client.from("watchlist_items").select("id");
check("user B sees none of user A's rows", bAll.data?.length === 0, show(bAll));
const bById = await b.client.from("watchlist_items").select("id").eq("id", aRowId);
check("user B can't read user A's row by id", bById.data?.length === 0, show(bById));

// 4. No one can add to another user's list.
const forged = await b.client.from("watchlist_items").insert({ ...rossmannItem("11790"), user_id: a.id });
check("user B can't add a row for user A", forged.error?.code === "42501", show(forged));

// 5. B's own row stays B's.
const bAdded = await b.client.from("watchlist_items").insert(rossmannItem("26900"));
const aAfter = await a.client.from("watchlist_items").select("id");
check(
  "user B adds their own row, and user A still reads only theirs",
  !bAdded.error && aAfter.data?.length === 1,
  `insert ${show(bAdded)}, user A reads ${show(aAfter)}`,
);

// 6. S-01 has no way to change or delete a row.
const updated = await a.client.from("watchlist_items").update({ name: "Changed" }).eq("id", aRowId);
check("user A can't update their row", updated.error?.code === "42501", show(updated));
const deleted = await a.client.from("watchlist_items").delete().eq("id", aRowId);
check("user A can't delete their row", deleted.error?.code === "42501", show(deleted));

// 7. Without a session, nothing is readable or writable.
const anonRead = await anon.from("watchlist_items").select("id");
check("anon can't read watchlists", anonRead.error?.code === "42501", show(anonRead));
const anonWrite = await anon.from("watchlist_items").insert(rossmannItem("26900"));
check("anon can't add to a watchlist", anonWrite.error?.code === "42501", show(anonWrite));

// 8. The source has to be a known shop.
const unknownShop = await a.client.from("watchlist_items").insert({ ...rossmannItem("1"), source: "dm" });
check("a product from an unknown shop is refused", unknownShop.error?.code === "23503", show(unknownShop));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll watchlist database checks passed");
process.exit(failed ? 1 : 0);
