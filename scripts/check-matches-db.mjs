// Database contract check: proves that shop matches stay private to their owner, attach only to the owner's own
// products and can't change once decided, and that both tables refuse values outside their bounds.
// Run: SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<anon key> node scripts/check-matches-db.mjs
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
  const email = `matches-${label}-${Date.now()}@example.com`;
  const { data, error } = await client.auth.signUp({ email, password: "Matches-Passw0rd!" });
  const id = data.session ? data.user?.id : undefined;
  check(`sign up throwaway user ${label}`, Boolean(id), error?.message ?? (id ? email : "no session returned"));
  return { client, id };
}

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

// Natura's item for the same product, as the research note recorded it (§2.5).
const naturaItem = {
  shop_item_id: "NV89063",
  name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
  brand: "NIVEA",
  size_text: "300 ml",
  size_value: 300,
  size_unit: "ml",
  eans: ["4005900009319"],
};

// Each user adds one product, which their matches then belong to.
async function addProduct(user, label) {
  const product = await user.client.from("watchlist_items").insert(rossmannItem("26900")).select("id").single();
  check(`user ${label} adds a Rossmann product`, !product.error && Boolean(product.data?.id), show(product));
  return product.data?.id;
}

const a = await signUpUser("a");
const b = await signUpUser("b");
if (!a.id || !b.id) process.exit(1);
const aItemId = await addProduct(a, "A");
const bItemId = await addProduct(b, "B");
if (!aItemId || !bItemId) process.exit(1);

// 1. The owner records an automatic Natura match and reads back exactly that row.
const added = await a.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: aItemId, shop_id: "natura", state: "matched", decided_by: "auto", ...naturaItem })
  .select("id, user_id")
  .single();
const aMatchId = added.data?.id;
check("user A adds an automatic Natura match", !added.error && added.data?.user_id === a.id, show(added));
const aRows = await a.client.from("watchlist_matches").select("id, watchlist_item_id");
check(
  "user A reads back exactly that match",
  aRows.data?.length === 1 && aRows.data[0].id === aMatchId && aRows.data[0].watchlist_item_id === aItemId,
  show(aRows),
);

// 2. One decision per product and shop.
const second = await a.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: aItemId, shop_id: "natura", state: "unmatched", decided_by: "user" });
check("user A can't record a second Natura decision for the product", second.error?.code === "23505", show(second));

// 3. Another user sees none of it, not even when asking for the match by its id, and still sees their own.
const bOwn = await b.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: bItemId, shop_id: "natura", state: "unmatched", decided_by: "user" })
  .select("id")
  .single();
const bAll = await b.client.from("watchlist_matches").select("id");
check(
  "user B adds a match for their own product and sees only that one",
  !bOwn.error && bAll.data?.length === 1 && bAll.data[0].id === bOwn.data?.id,
  `insert ${show(bOwn)}, user B reads ${show(bAll)}`,
);
const bById = await b.client.from("watchlist_matches").select("id").eq("id", aMatchId);
check("user B can't read user A's match by id", bById.data?.length === 0, show(bById));

// 4. No one can attach a match to another user's product: in their own name the composite key refuses it, and in the
// owner's name RLS does. The refusal is the same whether or not the product has a decision for that shop, so it tells
// another user nothing about someone else's list.
const viaKey = await b.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: aItemId, user_id: b.id, shop_id: "hebe", state: "not_found", decided_by: "auto" });
check("user B can't attach a match to user A's product", viaKey.error?.code === "23503", show(viaKey));
const probe = await b.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: aItemId, user_id: b.id, shop_id: "natura", state: "not_found", decided_by: "auto" });
check("user B can't tell that user A's product has a Natura decision", probe.error?.code === "23503", show(probe));
const viaOwner = await b.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: aItemId, user_id: a.id, shop_id: "hebe", state: "not_found", decided_by: "auto" });
check("user B can't add a match in user A's name", viaOwner.error?.code === "42501", show(viaOwner));

// 5. A decided match can't change: neither the automatic match nor the user's decline.
const declined = await a.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: aItemId, shop_id: "hebe", state: "unmatched", decided_by: "user" })
  .select("id")
  .single();
const notFound = await a.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: aItemId, shop_id: "super-pharm", state: "not_found", decided_by: "auto" })
  .select("id")
  .single();
check(
  "user A declines Hebe and records a Super-Pharm lookup that found nothing",
  !declined.error && !notFound.error,
  `decline ${show(declined)}, not found ${show(notFound)}`,
);
// An update that RLS filters out doesn't fail: it returns no rows, and the row stays as it was.
const rematched = await a.client
  .from("watchlist_matches")
  .update({ shop_item_id: "NV00001", name: "Inny produkt" })
  .eq("id", aMatchId)
  .select("id");
const matchAfter = await a.client.from("watchlist_matches").select("shop_item_id").eq("id", aMatchId);
check(
  "user A can't change their Natura match",
  !rematched.error && rematched.data?.length === 0 && matchAfter.data?.[0]?.shop_item_id === naturaItem.shop_item_id,
  `update ${show(rematched)}, row ${show(matchAfter)}`,
);
const undeclined = await a.client
  .from("watchlist_matches")
  .update({ state: "matched", decided_by: "user", shop_item_id: "000000000000218807", name: "Nivea Soft" })
  .eq("id", declined.data?.id)
  .select("id");
const declineAfter = await a.client.from("watchlist_matches").select("state").eq("id", declined.data?.id);
check(
  "user A can't change their Hebe decline",
  !undeclined.error && undeclined.data?.length === 0 && declineAfter.data?.[0]?.state === "unmatched",
  `update ${show(undeclined)}, row ${show(declineAfter)}`,
);

// 6. A lookup that found nothing can change, by its owner only: a retry finds the product, or the user decides.
const bRetry = await b.client
  .from("watchlist_matches")
  .update({ state: "unmatched", decided_by: "user" })
  .eq("id", notFound.data?.id)
  .select("id");
check("user B can't change user A's not-found row", !bRetry.error && bRetry.data?.length === 0, show(bRetry));
// Even its owner can't move it off their own product (the composite key) or out of their name (RLS), and a refused
// update leaves the row as it was.
const readNotFound = () =>
  a.client.from("watchlist_matches").select("watchlist_item_id, user_id, state").eq("id", notFound.data?.id);
const stillNotFound = (row) =>
  row.data?.length === 1 &&
  row.data[0].watchlist_item_id === aItemId &&
  row.data[0].user_id === a.id &&
  row.data[0].state === "not_found";
const repointed = await a.client
  .from("watchlist_matches")
  .update({ watchlist_item_id: bItemId })
  .eq("id", notFound.data?.id);
const afterRepoint = await readNotFound();
check(
  "user A can't point their not-found row at user B's product",
  repointed.error?.code === "23503" && stillNotFound(afterRepoint),
  `update ${show(repointed)}, row ${show(afterRepoint)}`,
);
const handedOver = await a.client.from("watchlist_matches").update({ user_id: b.id }).eq("id", notFound.data?.id);
const afterHandover = await readNotFound();
check(
  "user A can't hand their not-found row to user B",
  handedOver.error?.code === "42501" && stillNotFound(afterHandover),
  `update ${show(handedOver)}, row ${show(afterHandover)}`,
);
const retried = await a.client
  .from("watchlist_matches")
  .update({
    state: "matched",
    decided_by: "user",
    shop_item_id: "39477",
    name: "Nivea Soft Krem nawilżający (Pudełko)",
    brand: "Nivea",
    size_text: "300 ml",
    size_value: 300,
    size_unit: "ml",
    product_url: "https://www.superpharm.pl/nivea-soft-krem-nawilzajacy-pudelko-39477",
    checked_at: new Date().toISOString(),
  })
  .eq("id", notFound.data?.id)
  .select("id, state");
check(
  "user A turns their not-found row into a match",
  !retried.error && retried.data?.length === 1 && retried.data[0].state === "matched",
  show(retried),
);

// 7. There is no delete path, and without a session nothing is readable or writable.
const deleted = await a.client.from("watchlist_matches").delete().eq("id", aMatchId);
check("user A can't delete their match", deleted.error?.code === "42501", show(deleted));
const anonRead = await anon.from("watchlist_matches").select("id");
check("anon can't read matches", anonRead.error?.code === "42501", show(anonRead));
const anonWrite = await anon
  .from("watchlist_matches")
  .insert({ watchlist_item_id: aItemId, shop_id: "natura", state: "not_found", decided_by: "auto" });
check("anon can't add a match", anonWrite.error?.code === "42501", show(anonWrite));

// 8. watchlist_items holds the bounds the "Dodaj" form applies. Each row breaks exactly one of them.
const productRefusals = [
  ["an http image URL", { image_url: "http://www.rossmann.pl/image.jpg" }],
  ["an http product page", { product_url: "http://www.rossmann.pl/Produkt/Soft,26900,13049" }],
  ["11 EANs", { eans: Array.from({ length: 11 }, (_, i) => String(4005900009300 + i)) }],
  ["an EAN of 5 digits", { eans: ["12345"] }],
  ["an EAN array holding a null", { eans: [null] }],
  ["a source item id containing a slash", { source_item_id: "26900/1" }],
  ["a 41-character size text", { size_text: "x".repeat(41) }],
];
for (const [index, [what, fields]] of productRefusals.entries()) {
  // A fresh item id for each row, so a missing bound shows up as an added row rather than as a duplicate.
  const result = await a.client.from("watchlist_items").insert({ ...rossmannItem(String(90001 + index)), ...fields });
  check(`watchlist_items refuses ${what}`, result.error?.code === "23514", show(result));
}

// 9. watchlist_matches keeps each state's shape. Rossmann has no decision for the product, so only a check refuses.
const matchRefusals = [
  ["a match without the shop's item id", { state: "matched", decided_by: "auto", name: naturaItem.name }],
  ["a decline decided automatically", { state: "unmatched", decided_by: "auto" }],
  ["a lookup that found nothing but carries an item", { state: "not_found", decided_by: "auto", ...naturaItem }],
];
for (const [what, fields] of matchRefusals) {
  const result = await a.client
    .from("watchlist_matches")
    .insert({ watchlist_item_id: aItemId, shop_id: "rossmann", ...fields });
  check(`watchlist_matches refuses ${what}`, result.error?.code === "23514", show(result));
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll shop matches database checks passed");
process.exit(failed ? 1 : 0);
