// Database contract check: proves that shop matches stay private to their owner, attach only to the owner's own
// products, change only through their owner and never to another product, user or shop, and go with their product,
// and that both tables refuse values outside their bounds. Since M-2's S-02 it proves that no caller stores a decision
// in its product's own shop, by a direct insert or by record_decision, and what record_decision allows: it saves as its
// caller in one statement, answers another user's product as one no one has, writes nothing over a decision other than
// the one it expects, and refuses anon, an expectation it can't read and a shop no one knows.
// Run: SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<anon key> node scripts/check-matches-db.mjs
// Each run signs up two fresh users, so it can run again without resetting the database.

import { randomUUID } from "node:crypto";
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

// Another Natura item, as the name search's recording has it (src/lib/services/shops/fixtures/natura-name-search.json),
// which a re-pin points the match at.
const otherNaturaItem = {
  shop_item_id: "NV81063",
  name: "Nivea MEN Fresh Kick 3w1 żel pod prysznic 500 ml",
  brand: "NIVEA MEN",
  size_text: "500 ml",
  size_value: 500,
  size_unit: "ml",
  eans: ["9005800286563"],
};

// Hebe's Nivea Soft, as the research note's sample has it (§2.2), which the user picks in place of a decline.
const hebeItem = { shop_item_id: "000000000000218807", name: "Nivea Soft" };

// The same product picked in Natura instead, by its SKU: Natura is then its own shop, and Rossmann a matched shop.
const { shop_item_id: naturaSku, ...naturaFields } = naturaItem;
const naturaProduct = { source: "natura", source_item_id: naturaSku, ...naturaFields };

// Each user adds one product, which their matches then belong to; user A adds more, each for checks of its own.
async function addProduct(user, label, item = rossmannItem("26900")) {
  const product = await user.client.from("watchlist_items").insert(item).select("id").single();
  check(
    `user ${label} adds ${item.source} product ${item.source_item_id}`,
    !product.error && Boolean(product.data?.id),
    show(product),
  );
  return product.data?.id;
}

// Decisions as both a direct insert and record_decision take them: the user's decline, a lookup's "not found", and
// the user's match of an item.
const userDecline = { state: "unmatched", decided_by: "user" };
const lookupNotFound = { state: "not_found", decided_by: "auto" };
const userMatch = (item) => ({ state: "matched", decided_by: "user", ...item });

// record_decision as the app calls it: a decision's columns and the decision it replaces, none unless `replaces` names
// a state, an item and who decided it. PostgREST finds the function by its arguments' names, so all 16 are sent, each
// as itself or null.
const saveDecision = (client, itemId, shopId, decision, replaces = {}) =>
  client.rpc("record_decision", {
    p_item: itemId,
    p_shop: shopId,
    p_state: decision.state,
    p_decided_by: decision.decided_by,
    p_shop_item_id: decision.shop_item_id ?? null,
    p_name: decision.name ?? null,
    p_brand: decision.brand ?? null,
    p_size_text: decision.size_text ?? null,
    p_size_value: decision.size_value ?? null,
    p_size_unit: decision.size_unit ?? null,
    p_eans: decision.eans ?? [],
    p_product_url: decision.product_url ?? null,
    p_image_url: decision.image_url ?? null,
    p_replaces_state: replaces.state ?? null,
    p_replaces_item: replaces.shopItemId ?? null,
    p_replaces_decided_by: replaces.decidedBy ?? null,
  });

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

// 5. A decision changes through its owner only, in any state, and only into a shape the table's checks accept: the
// owner re-pins their automatic match and turns their decline into a match, and another user changes neither.
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
// Another user's update doesn't fail: RLS filters the row out, so it returns no rows, and the row stays as it was.
const bRepinned = await b.client
  .from("watchlist_matches")
  .update({ state: "matched", decided_by: "user", ...otherNaturaItem })
  .eq("id", aMatchId)
  .select("id");
const afterBRepin = await a.client.from("watchlist_matches").select("shop_item_id").eq("id", aMatchId);
check(
  "user B can't change user A's Natura match",
  !bRepinned.error && bRepinned.data?.length === 0 && afterBRepin.data?.[0]?.shop_item_id === naturaItem.shop_item_id,
  `update ${show(bRepinned)}, row ${show(afterBRepin)}`,
);
const bUndeclined = await b.client
  .from("watchlist_matches")
  .update({ state: "matched", decided_by: "user", ...hebeItem })
  .eq("id", declined.data?.id)
  .select("id");
const afterBUndecline = await a.client.from("watchlist_matches").select("state").eq("id", declined.data?.id);
check(
  "user B can't change user A's Hebe decline",
  !bUndeclined.error && bUndeclined.data?.length === 0 && afterBUndecline.data?.[0]?.state === "unmatched",
  `update ${show(bUndeclined)}, row ${show(afterBUndecline)}`,
);
// The owner's changes still keep each state's shape: a decline carries no item, and only a lookup finds nothing. Each
// update below breaks exactly one of the table's checks, on a row the old not_found-only policy filtered out.
const keptItem = await a.client
  .from("watchlist_matches")
  .update({ state: "unmatched", decided_by: "user" })
  .eq("id", aMatchId);
check("a re-pin to a decline can't keep the item", keptItem.error?.code === "23514", show(keptItem));
const usersNotFound = await a.client
  .from("watchlist_matches")
  .update({ state: "not_found", decided_by: "user" })
  .eq("id", declined.data?.id);
check("a lookup's 'not found' can't be the user's", usersNotFound.error?.code === "23514", show(usersNotFound));
// The owner changes a decision in any state, with what a confirm writes (recordDecision, src/lib/services/matches.ts).
const repinned = await a.client
  .from("watchlist_matches")
  .update({ state: "matched", decided_by: "user", ...otherNaturaItem, checked_at: new Date().toISOString() })
  .eq("id", aMatchId)
  .select("id");
const matchAfter = await a.client.from("watchlist_matches").select("shop_item_id").eq("id", aMatchId);
check(
  "user A re-pins their Natura match",
  !repinned.error && repinned.data?.length === 1 && matchAfter.data?.[0]?.shop_item_id === otherNaturaItem.shop_item_id,
  `update ${show(repinned)}, row ${show(matchAfter)}`,
);
const undeclined = await a.client
  .from("watchlist_matches")
  .update({ state: "matched", decided_by: "user", ...hebeItem, checked_at: new Date().toISOString() })
  .eq("id", declined.data?.id)
  .select("id");
const declineAfter = await a.client.from("watchlist_matches").select("state").eq("id", declined.data?.id);
check(
  "user A turns their Hebe decline into a match",
  !undeclined.error && undeclined.data?.length === 1 && declineAfter.data?.[0]?.state === "matched",
  `update ${show(undeclined)}, row ${show(declineAfter)}`,
);
// Even its owner can't move a match off their product, out of their name or to another shop: the update grant covers
// only the decision's columns (S-03). Rossmann is the one shop the product has no decision for, so nothing but the
// grant refuses that move. A refused update leaves the row as it was.
const readMatch = () =>
  a.client.from("watchlist_matches").select("watchlist_item_id, user_id, shop_id, state").eq("id", aMatchId);
const stillMatch = (row) =>
  row.data?.length === 1 &&
  row.data[0].watchlist_item_id === aItemId &&
  row.data[0].user_id === a.id &&
  row.data[0].shop_id === "natura" &&
  row.data[0].state === "matched";
const matchRepointed = await a.client
  .from("watchlist_matches")
  .update({ watchlist_item_id: bItemId })
  .eq("id", aMatchId);
const afterMatchRepoint = await readMatch();
check(
  "user A can't point their match at user B's product",
  matchRepointed.error?.code === "42501" && stillMatch(afterMatchRepoint),
  `update ${show(matchRepointed)}, row ${show(afterMatchRepoint)}`,
);
const matchHandedOver = await a.client.from("watchlist_matches").update({ user_id: b.id }).eq("id", aMatchId);
const afterMatchHandover = await readMatch();
check(
  "user A can't hand their match to user B",
  matchHandedOver.error?.code === "42501" && stillMatch(afterMatchHandover),
  `update ${show(matchHandedOver)}, row ${show(afterMatchHandover)}`,
);
const matchMoved = await a.client.from("watchlist_matches").update({ shop_id: "rossmann" }).eq("id", aMatchId);
const afterMatchMove = await readMatch();
check(
  "user A can't move their match to another shop",
  matchMoved.error?.code === "42501" && stillMatch(afterMatchMove),
  `update ${show(matchMoved)}, row ${show(afterMatchMove)}`,
);

// 6. So does a lookup that found nothing, by its owner only: a retry finds the product, or the user decides.
const bRetry = await b.client
  .from("watchlist_matches")
  .update({ state: "unmatched", decided_by: "user" })
  .eq("id", notFound.data?.id)
  .select("id");
check("user B can't change user A's not-found row", !bRetry.error && bRetry.data?.length === 0, show(bRetry));
// Even its owner can't move it off their own product or out of their name: since S-03 the update grant, which covers
// only the decision's columns, refuses both. A refused update leaves the row as it was.
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
  repointed.error?.code === "42501" && stillNotFound(afterRepoint),
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

// 7. A decision has no delete path of its own: it goes only with its product (12). Without a session nothing is
// readable or writable.
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

// 9. watchlist_matches keeps each state's shape. User A's fresh product has no decision, and Natura is one of its
// matched shops, so only a check refuses each row, and a missing check shows as an added row. Its own shop, Rossmann,
// would meet the trigger first (10).
const shapesItemId = await addProduct(a, "A", rossmannItem("26901"));
const matchRefusals = [
  ["a match without the shop's item id", { state: "matched", decided_by: "auto", name: naturaItem.name }],
  ["a decline decided automatically", { state: "unmatched", decided_by: "auto" }],
  ["a lookup that found nothing but carries an item", { state: "not_found", decided_by: "auto", ...naturaItem }],
];
for (const [what, fields] of matchRefusals) {
  const result = await a.client
    .from("watchlist_matches")
    .insert({ watchlist_item_id: shapesItemId, shop_id: "natura", ...fields });
  check(`watchlist_matches refuses ${what}`, result.error?.code === "23514", show(result));
}

// 10. A product holds no decision in its own shop, the shop it was picked in: the trigger
// watchlist_matches_not_own_shop refuses one in any state with 23001, by a direct insert and by record_decision alike,
// before the table's checks and keys. It reads the product's own shop and refuses no fixed one, so for a product picked
// in Natura it refuses Natura and lets Rossmann through. It reads the product as its caller, so to user B, user A's
// product is one no one has: B's insert and save in their own name meet the composite key, 23503 and gone, and B's
// insert in A's name meets the insert policy, 42501, as in 4. PostgreSQL checks that policy after a before trigger, so
// only a trigger that reads the product as its caller lets that insert get so far, and the trigger tells B nothing
// about A's product.
const ownShopItemId = await addProduct(a, "A", rossmannItem("26902"));
const ownShopDecisions = [
  ["an automatic match", { state: "matched", decided_by: "auto", shop_item_id: "26902", name: "Soft" }],
  ["the user's decline", userDecline],
  ["a lookup's 'not found'", lookupNotFound],
];
for (const [what, decision] of ownShopDecisions) {
  const inserted = await a.client
    .from("watchlist_matches")
    .insert({ watchlist_item_id: ownShopItemId, shop_id: "rossmann", ...decision });
  const saved = await saveDecision(a.client, ownShopItemId, "rossmann", decision);
  check(
    `user A can't store ${what} in their product's own shop, by an insert or by record_decision`,
    inserted.error?.code === "23001" && saved.error?.code === "23001",
    `insert ${show(inserted)}, record_decision ${show(saved)}`,
  );
}
const ownShopRows = await a.client
  .from("watchlist_matches")
  .select("id")
  .eq("watchlist_item_id", ownShopItemId)
  .eq("shop_id", "rossmann");
check(
  "user A reads no Rossmann decision for their product picked in Rossmann",
  !ownShopRows.error && ownShopRows.data?.length === 0,
  show(ownShopRows),
);
const fromNaturaItemId = await addProduct(a, "A", naturaProduct);
const naturaDecision = await a.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: fromNaturaItemId, shop_id: "natura", ...userDecline });
const rossmannDecision = await a.client
  .from("watchlist_matches")
  .insert({
    watchlist_item_id: fromNaturaItemId,
    shop_id: "rossmann",
    state: "matched",
    decided_by: "auto",
    shop_item_id: "26900",
    name: "Soft krem uniwersalny, nawilżający",
  })
  .select("shop_id")
  .single();
check(
  "for user A's product picked in Natura, a Natura decision is refused and a Rossmann one stored",
  naturaDecision.error?.code === "23001" && !rossmannDecision.error && rossmannDecision.data?.shop_id === "rossmann",
  `Natura ${show(naturaDecision)}, Rossmann ${show(rossmannDecision)}`,
);
const missingItemId = randomUUID();
const bOwnShopInsert = await b.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: ownShopItemId, user_id: b.id, shop_id: "rossmann", ...userDecline });
const bMissingInsert = await b.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: missingItemId, user_id: b.id, shop_id: "rossmann", ...userDecline });
const bOwnShopSave = await saveDecision(b.client, ownShopItemId, "rossmann", userDecline);
const bMissingSave = await saveDecision(b.client, missingItemId, "rossmann", userDecline);
check(
  "user B's insert and save for user A's product in its own shop answer as for an id no one has: 23503 and gone",
  bOwnShopInsert.error?.code === "23503" &&
    bMissingInsert.error?.code === "23503" &&
    bOwnShopSave.data === "gone" &&
    bMissingSave.data === "gone",
  `insert ${show(bOwnShopInsert)}, no one's ${show(bMissingInsert)}; ` +
    `record_decision ${show(bOwnShopSave)}, no one's ${show(bMissingSave)}`,
);
const bInAsName = await b.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: ownShopItemId, user_id: a.id, shop_id: "rossmann", ...userDecline });
check(
  "user B can't add a decision in user A's name in that product's own shop, refused by RLS, not the trigger",
  bInAsName.error?.code === "42501",
  show(bInAsName),
);

// 11. record_decision saves a decision in one statement, as its caller, so RLS, the keys and the update grant bind it
// as they bind a direct write. It inserts, or replaces the stored decision only while it's the one the save expects:
// none, which also stands for a lookup that found nothing, the user's decline, or a match by its item and who decided
// it (F4 in the review of M-2's S-01). It answers saved, decided when another decision stood, and gone when its caller
// has no such product, another user's included. An expectation it can't read, or a shop no one knows, is an error,
// never gone or decided, and changes nothing. User A's fresh product goes through a lookup, a retry, a first choice and
// re-pins in Natura.
const saveItemId = await addProduct(a, "A", rossmannItem("26903"));
// Its decisions: what a save sets, the state, who decided, the item and checked_at, which moves on every write, and
// the columns no save changes.
const readSaved = () =>
  a.client
    .from("watchlist_matches")
    .select("id, watchlist_item_id, user_id, shop_id, state, decided_by, shop_item_id, checked_at, created_at")
    .eq("watchlist_item_id", saveItemId)
    .order("shop_id");
const sameRows = (read, earlier) => !read.error && JSON.stringify(read.data) === JSON.stringify(earlier.data);
const anonSave = await saveDecision(anon, saveItemId, "natura", lookupNotFound);
check("anon can't execute record_decision", anonSave.error?.code === "42501", show(anonSave));
const lookupSaved = await saveDecision(a.client, saveItemId, "natura", lookupNotFound);
const afterLookup = await readSaved();
const lookupRow = afterLookup.data?.[0];
check(
  "user A saves a lookup's 'not found', expecting no decision",
  lookupSaved.data === "saved" && afterLookup.data?.length === 1 && lookupRow?.state === "not_found",
  `record_decision ${show(lookupSaved)}, rows ${show(afterLookup)}`,
);
// The save sends no time, so the database's clock stamps the replaced decision, as it stamped the inserted one.
const retrySaved = await saveDecision(a.client, saveItemId, "natura", lookupNotFound);
const afterRetry = await readSaved();
const retryRow = afterRetry.data?.[0];
check(
  "a retry's save over that 'not found' is saved, and its checked_at moves forward on the database's clock",
  retrySaved.data === "saved" &&
    afterRetry.data?.length === 1 &&
    retryRow.state === "not_found" &&
    Date.parse(retryRow.checked_at) > Date.parse(lookupRow?.checked_at) &&
    retryRow.created_at === lookupRow?.created_at,
  `record_decision ${show(retrySaved)}, checked_at ${lookupRow?.checked_at} -> ${retryRow?.checked_at}`,
);
const confirmSaved = await saveDecision(a.client, saveItemId, "natura", userMatch(naturaItem));
const afterConfirm = await readSaved();
const confirmRow = afterConfirm.data?.[0];
check(
  "a first choice's confirm over it, expecting no decision, is saved as the user's match",
  confirmSaved.data === "saved" &&
    confirmRow?.state === "matched" &&
    confirmRow.decided_by === "user" &&
    confirmRow.shop_item_id === naturaItem.shop_item_id,
  `record_decision ${show(confirmSaved)}, rows ${show(afterConfirm)}`,
);
// F4: a tab shown the rule's match of the item, which another tab has since made the user's, expects the rule's.
const ruleExpected = await saveDecision(a.client, saveItemId, "natura", userMatch(otherNaturaItem), {
  state: "matched",
  shopItemId: naturaItem.shop_item_id,
  decidedBy: "auto",
});
const afterRuleExpected = await readSaved();
check(
  "a save expecting that item matched by the rule, not by the user, is decided and changes nothing",
  ruleExpected.data === "decided" && sameRows(afterRuleExpected, afterConfirm),
  `record_decision ${show(ruleExpected)}, rows ${show(afterRuleExpected)}`,
);
const repinSaved = await saveDecision(a.client, saveItemId, "natura", userMatch(otherNaturaItem), {
  state: "matched",
  shopItemId: naturaItem.shop_item_id,
  decidedBy: "user",
});
const afterRepin = await readSaved();
const repinRow = afterRepin.data?.[0];
check(
  "a re-pin expecting the user's match of that item is saved, to the other item, on the same row",
  repinSaved.data === "saved" &&
    afterRepin.data?.length === 1 &&
    repinRow.shop_item_id === otherNaturaItem.shop_item_id &&
    ["id", "watchlist_item_id", "user_id", "shop_id", "created_at"].every(
      (column) => repinRow[column] === lookupRow?.[column],
    ),
  `record_decision ${show(repinSaved)}, rows ${show(afterRepin)}`,
);
const declineExpected = await saveDecision(a.client, saveItemId, "natura", userDecline, { state: "unmatched" });
const afterDeclineExpected = await readSaved();
check(
  "a save expecting a decline over that match is decided and changes nothing",
  declineExpected.data === "decided" && sameRows(afterDeclineExpected, afterRepin),
  `record_decision ${show(declineExpected)}, rows ${show(afterDeclineExpected)}`,
);
// User B's saves for user A's product: in Natura, where A has a decision, though B expects exactly that one, and in
// Hebe, where A has none.
const bOverDecision = await saveDecision(b.client, saveItemId, "natura", userMatch(naturaItem), {
  state: "matched",
  shopItemId: otherNaturaItem.shop_item_id,
  decidedBy: "user",
});
const bWithoutDecision = await saveDecision(b.client, saveItemId, "hebe", userDecline);
const bMissing = await saveDecision(b.client, missingItemId, "hebe", userDecline);
const afterB = await readSaved();
check(
  "user B's saves for user A's product answer gone, where A has a decision and where A has none, as for no one's",
  bOverDecision.data === "gone" &&
    bWithoutDecision.data === "gone" &&
    bMissing.data === "gone" &&
    sameRows(afterB, afterDeclineExpected),
  `record_decision ${show(bOverDecision)}, ${show(bWithoutDecision)}, no one's ${show(bMissing)}; ` +
    `user A's rows ${show(afterB)}`,
);
// One expectation for each way the save can't read one: each would otherwise reach the conflict's where and answer
// decided.
const unreadableExpectations = [
  ["a match without its decider", { state: "matched", shopItemId: otherNaturaItem.shop_item_id }],
  ["a decline that names an item", { state: "unmatched", shopItemId: otherNaturaItem.shop_item_id }],
  ["no decision, with a decider", { decidedBy: "user" }],
  ["a state it doesn't know", { state: "not_found" }],
];
for (const [what, replaces] of unreadableExpectations) {
  const result = await saveDecision(a.client, saveItemId, "natura", userDecline, replaces);
  check(`record_decision refuses expecting ${what}`, result.error?.code === "22023", show(result));
}
const unknownShop = await saveDecision(a.client, saveItemId, "dm", lookupNotFound);
check(
  "record_decision refuses a shop no one knows through the shop's key, not as gone",
  unknownShop.error?.code === "23503" && unknownShop.error.message.includes("watchlist_matches_shop_id_fkey"),
  show(unknownShop),
);
const afterRefusals = await readSaved();
check(
  "the refused saves change none of user A's decisions",
  sameRows(afterRefusals, afterDeclineExpected),
  show(afterRefusals),
);

// 12. Removing a product removes its owner's decisions with it: the composite key cascades the delete, which needs no
// delete grant on watchlist_matches. User B's product is the same Rossmann item, and B's decision for it stays.
const aDecisions = () => a.client.from("watchlist_matches").select("id").eq("watchlist_item_id", aItemId);
const aBefore = await aDecisions();
const removed = await a.client.from("watchlist_items").delete().eq("id", aItemId).select("id");
const aAfter = await aDecisions();
const bAfter = await b.client.from("watchlist_matches").select("id, state");
check(
  "removing a product removes its owner's decisions with it",
  aBefore.data?.length > 0 &&
    !removed.error &&
    removed.data?.length === 1 &&
    aAfter.data?.length === 0 &&
    bAfter.data?.length === 1 &&
    bAfter.data[0].id === bOwn.data?.id &&
    bAfter.data[0].state === "unmatched",
  `before ${show(aBefore)}, delete ${show(removed)}, after ${show(aAfter)}, user B reads ${show(bAfter)}`,
);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll shop matches database checks passed");
process.exit(failed ? 1 : 0);
