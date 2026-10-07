// Database contract check: proves that price observations are shared by the watchers of a shop item and read by no one
// else, that no one can change or delete one or set its time, source or recording user, and that the latest-price view
// keeps to the same rules. It also proves S-03's follow-ups on S-02's tables: stricter EAN checks, and an update grant
// on shop matches that covers only the decision. Since S-08 it proves that removing a product deletes no observation,
// and that a re-pin changes which item a user watches. Since S-04 it proves that the product page's view
// (price_summaries) gives each item's history, its orderable prices of the 30 days in Poland before today, to the
// item's watchers only, and that the regular price and the 30-day low are bounded as the price is. Since test rollout
// Phase 2 it proves that a user who watches nothing reads and counts nothing through the list's unfiltered read, and
// that re-pinning away from an item ends the access to its observations.
// Run: SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<anon key> node scripts/check-prices-db.mjs
// Each run signs up two fresh users and uses shop item ids of its own, so it can run again without resetting the
// database, and it never adds a price to a real product's shared history. The history checks move checks back in time
// as the local superuser, through Docker (scripts/e2e-local-db.mjs), so the run also needs the local stack's database
// container, and .env and .dev.vars pointing at the local stack.

import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase, backdateChecks } from "./e2e-local-db.mjs";

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
// The superuser's helper refuses unless the environment, .env and .dev.vars all name the local stack: checked before
// anything is written, so a refusal leaves nothing behind.
try {
  assertLocalSupabase();
} catch (error) {
  console.log(`FAIL  the history checks act as the local superuser, whose helper says: ${error.message}`);
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
  const email = `prices-${label}-${Date.now()}@example.com`;
  const { data, error } = await client.auth.signUp({ email, password: "Prices-Passw0rd!" });
  const id = data.session ? data.user?.id : undefined;
  check(`sign up throwaway user ${label}`, Boolean(id), error?.message ?? (id ? email : "no session returned"));
  return { client, id };
}

// Observations are shared and never deleted, so this run's shop items get ids that no earlier run and no real product
// has: Rossmann's real ids are short numbers, and Natura's SKUs look like "NV89063".
const run = Date.now();
const rossmannId = (n) => `${run}${n}`;
const itemX = rossmannId(0);
const skuA = `CHECK-${run}-A`;
const skuB = `CHECK-${run}-B`;

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

// A product's match in Natura, which makes the matched SKU watched.
const naturaMatch = (itemId, sku) => ({
  watchlist_item_id: itemId,
  shop_id: "natura",
  state: "matched",
  decided_by: "auto",
  shop_item_id: sku,
  name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
});

// The rows the app inserts for one check (src/lib/services/prices.ts): the same columns in every row, and nothing the
// database sets itself.
const priceRow = (shopId, shopItemId, fields = {}) => ({
  shop_id: shopId,
  shop_item_id: shopItemId,
  status: "price",
  price: 26.99,
  regular_price: 29.99,
  lowest_price_30d: 24.99,
  promo_ends_on: "2026-10-07",
  available: true,
  ...fields,
});
const missingRow = (shopId, shopItemId) => ({
  shop_id: shopId,
  shop_item_id: shopItemId,
  status: "missing",
  price: null,
  regular_price: null,
  lowest_price_30d: null,
  promo_ends_on: null,
  available: null,
});

const table = (client) => client.from("price_observations");
const view = (client) => client.from("latest_price_observations");
// The product page's view: the latest-price view's columns and each item's history (src/lib/services/prices.ts).
const summaries = (client) => client.from("price_summaries");
const LATEST_COLUMNS =
  "shop_id, shop_item_id, last_checked_at, last_status, price, regular_price, lowest_price_30d, promo_ends_on, " +
  "available, priced_at";
const SUMMARY_COLUMNS = `${LATEST_COLUMNS}, history_low, history_days`;

// A product on a user's list makes its Rossmann item watched.
async function addProduct(user, label, sourceItemId) {
  const product = await user.client.from("watchlist_items").insert(rossmannItem(sourceItemId)).select("id").single();
  check(`user ${label} adds Rossmann item ${sourceItemId}`, Boolean(product.data?.id), show(product));
  return product.data?.id;
}

// Moves every check of a Rossmann item back by whole hours as the local superuser (scripts/e2e-local-db.mjs): the
// database stamps each check's time, which no user may set. Gives how many checks moved, and stops the run when the
// superuser can't be reached.
function backdate(shopItemId, hours) {
  try {
    return backdateChecks("rossmann", shopItemId, hours);
  } catch (error) {
    check(`move the checks of ${shopItemId} back ${hours} hours as the local superuser`, false, error.message);
    process.exit(1);
  }
}

// A time's day in Poland, as YYYY-MM-DD, and its hour there: the calendar the product page's view keeps history by.
const polishClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});
function inPoland(time) {
  const parts = Object.fromEntries(polishClock.formatToParts(new Date(time)).map(({ type, value }) => [type, value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// The day a number of whole days after a day, both as YYYY-MM-DD.
function addDays(day, days) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

// What the product page's view gives for an item's checks when read on `today`, by the migration's rule: the checks
// that found the item orderable online in the 30 days in Poland before today, their lowest price, and their days, each
// once and in order; no low and no day without one.
function expectedHistory(checks, today) {
  const counted = checks.filter((row) => {
    const { day } = inPoland(row.observed_at);
    return row.status === "price" && row.available === true && day >= addDays(today, -30) && day < today;
  });
  const prices = counted.map((row) => row.price);
  return {
    low: prices.length === 0 ? null : Math.min(...prices),
    days: [...new Set(counted.map((row) => inPoland(row.observed_at).day))].sort(),
  };
}

const a = await signUpUser("a");
const b = await signUpUser("b");
if (!a.id || !b.id) process.exit(1);
const aItemId = await addProduct(a, "A", itemX);
if (!aItemId) process.exit(1);

// 1. A watcher records a price for X and, later, that Rossmann answered without it. No insert asks for its row back,
// because users can't read who recorded it, and the database sets the time and the source.
const readX = (client) => table(client).select("id, status, price, source, observed_at").eq("shop_item_id", itemX);
const priced = await table(a.client).insert(priceRow("rossmann", itemX));
const afterPrice = await readX(a.client);
const priceObs = afterPrice.data?.find((row) => row.status === "price");
check(
  "user A records a price for X, with its time and source set by the database",
  !priced.error &&
    afterPrice.data?.length === 1 &&
    priceObs?.price === 26.99 &&
    priceObs.source === "fetch" &&
    typeof priceObs.observed_at === "string",
  `insert ${show(priced)}, rows ${show(afterPrice)}`,
);
const missed = await table(a.client).insert(missingRow("rossmann", itemX));
const afterMissing = await readX(a.client);
const missingObs = afterMissing.data?.find((row) => row.status === "missing");
check(
  "user A records that Rossmann answered without X",
  !missed.error && afterMissing.data?.length === 2 && missingObs !== undefined,
  `insert ${show(missed)}, rows ${show(afterMissing)}`,
);

// 2. The view gives one row per item: its last check, which found X missing, and its last price, which stays.
const latest = await view(a.client).select(LATEST_COLUMNS);
const latestX = latest.data?.[0];
check(
  "the view gives user A one row, for X: last checked missing, with the price from before",
  latest.data?.length === 1 &&
    latestX.shop_item_id === itemX &&
    latestX.last_status === "missing" &&
    latestX.last_checked_at === missingObs?.observed_at &&
    latestX.priced_at === priceObs?.observed_at &&
    latestX.price === 26.99 &&
    latestX.available === true,
  show(latest),
);

// 3. Only an item's watchers add to it, and only the columns a check fills.
const bWrite = await table(b.client).insert(priceRow("rossmann", itemX));
check("user B, who doesn't watch X, can't record a price for it", bWrite.error?.code === "42501", show(bWrite));
const unwatched = await table(a.client).insert(priceRow("rossmann", rossmannId(1)));
check("user A can't record a price for an item they don't watch", unwatched.error?.code === "42501", show(unwatched));
// Even the source's only allowed value is refused: the insert grant leaves all three to the database.
const setByDatabase = [
  ["the time", { observed_at: "2020-01-01T00:00:00Z" }],
  ["the source", { source: "fetch" }],
  ["the recording user", { recorded_by: b.id }],
];
for (const [what, fields] of setByDatabase) {
  const result = await table(a.client).insert(priceRow("rossmann", itemX, fields));
  check(`user A can't set ${what} of an observation`, result.error?.code === "42501", show(result));
}

// 4. The recording user stays hidden, and only watchers read an item's observations, from the table or the view.
const recorder = await table(a.client).select("id, recorded_by").eq("shop_item_id", itemX);
check("user A can't read who recorded an observation", recorder.error?.code === "42501", show(recorder));
const bTable = await table(b.client).select("id").eq("shop_item_id", itemX);
const bView = await view(b.client).select("shop_item_id").eq("shop_item_id", itemX);
check(
  "user B, who doesn't watch X, reads none of its observations",
  bTable.data?.length === 0 && bView.data?.length === 0,
  `table ${show(bTable)}, view ${show(bView)}`,
);
const anonTable = await table(anon).select("id");
const anonView = await view(anon).select("shop_item_id");
const anonSummaries = await summaries(anon).select("shop_item_id");
check(
  "anon can't read observations",
  anonTable.error?.code === "42501" && anonView.error?.code === "42501" && anonSummaries.error?.code === "42501",
  `table ${show(anonTable)}, view ${show(anonView)}, product page's view ${show(anonSummaries)}`,
);
const anonWrite = await table(anon).insert(priceRow("rossmann", itemX));
check("anon can't record a price", anonWrite.error?.code === "42501", show(anonWrite));
// The list reads the latest prices of every item a user may see, with no filter (readLatestRows in
// src/lib/services/prices.ts). Before user B watches anything, that read and an exact count of the table and both views
// give B nothing, while user A's same reads give A's rows.
const everything = (client) =>
  Promise.all(
    [table(client), view(client), summaries(client)].map((relation) =>
      relation.select("shop_item_id", { count: "exact" }),
    ),
  );
const [bEverything, aEverything] = await Promise.all([everything(b.client), everything(a.client)]);
check(
  "user B, who watches nothing, reads and counts no row of the table or either view, while user A reads theirs",
  bEverything.every((read) => !read.error && read.data?.length === 0 && read.count === 0) &&
    aEverything.every((read) => !read.error && read.data?.length > 0 && read.count === read.data.length),
  `B ${bEverything.map((read) => `${show(read)} count ${read.count}`).join(", ")}, ` +
    `A ${aEverything.map((read) => `count ${read.count}`).join(", ")}`,
);
const bItemId = await addProduct(b, "B", itemX);
const bRows = await table(b.client).select("id").eq("shop_item_id", itemX);
const bIds = (bRows.data ?? []).map((row) => row.id);
check(
  "once user B watches X too, B reads both of user A's observations",
  bIds.length === 2 && bIds.includes(priceObs?.id) && bIds.includes(missingObs?.id),
  show(bRows),
);

// 5. A match in another shop makes that shop's item watched, by the user who matched it only: user B's own match of a
// different SKU gives B nothing of user A's.
const aMatch = await a.client.from("watchlist_matches").insert(naturaMatch(aItemId, skuA));
const bMatch = await b.client.from("watchlist_matches").insert(naturaMatch(bItemId, skuB));
const aNatura = await table(a.client).insert(priceRow("natura", skuA));
check(
  "user A, who matched X to a Natura SKU, records a price for that SKU",
  !aMatch.error && !bMatch.error && !aNatura.error,
  `matches ${show(aMatch)}, ${show(bMatch)}, insert ${show(aNatura)}`,
);
const bReadsA = await table(b.client).select("id").eq("shop_item_id", skuA);
const bWritesA = await table(b.client).insert(priceRow("natura", skuA));
check(
  "user B, who matched another Natura SKU, can't read or record user A's",
  bReadsA.data?.length === 0 && bWritesA.error?.code === "42501",
  `read ${show(bReadsA)}, insert ${show(bWritesA)}`,
);

// 6. Nothing changes or deletes an observation: there's no update or delete grant, and no policy for either.
const readPrice = () => table(a.client).select("id, price").eq("id", priceObs?.id);
const changed = await table(a.client).update({ price: 1 }).eq("id", priceObs?.id).select("id");
const afterChange = await readPrice();
check(
  "user A can't change an observation",
  (changed.error?.code === "42501" || changed.data?.length === 0) && afterChange.data?.[0]?.price === 26.99,
  `update ${show(changed)}, row ${show(afterChange)}`,
);
const deleted = await table(a.client).delete().eq("id", priceObs?.id).select("id");
const afterDelete = await readPrice();
check(
  "user A can't delete an observation",
  (deleted.error?.code === "42501" || deleted.data?.length === 0) && afterDelete.data?.length === 1,
  `delete ${show(deleted)}, row ${show(afterDelete)}`,
);

// 7. Bounds and shapes, each row breaking exactly one. RLS runs before a table's checks, so every observation is for an
// item user A watches, '..' included: watchlist_items still accepts it as a product's id. Since S-04 (F6) the regular
// price and the 30-day low stay below 100000 as the price does, within PRICE_LIMITS
// (src/lib/services/product-limits.ts).
await addProduct(a, "A", "..");
const observationRefusals = [
  ["a price of 0", priceRow("rossmann", itemX, { price: 0 })],
  ["a regular price of 100000", priceRow("rossmann", itemX, { regular_price: 100000 })],
  ["a 30-day low of 100000", priceRow("rossmann", itemX, { lowest_price_30d: 100000 })],
  ["a missing item that carries a price", { ...missingRow("rossmann", itemX), price: 26.99 }],
  ["a shop item id of '..'", priceRow("rossmann", "..")],
];
for (const [what, row] of observationRefusals) {
  const result = await table(a.client).insert(row);
  check(`price_observations refuses ${what}`, result.error?.code === "23514", show(result));
}
// The highest amounts PRICE_LIMITS allows are still stored, for an item of its own: X's checks are counted in 9.
const itemAtBound = rossmannId(6);
await addProduct(a, "A", itemAtBound);
const atBound = await table(a.client).insert(
  priceRow("rossmann", itemAtBound, { price: 99999.98, regular_price: 99999.99, lowest_price_30d: 99999.99 }),
);
check("price_observations accepts a regular price and a 30-day low of 99999.99", !atBound.error, show(atBound));
// S-02's EAN rule joined the elements with commas, so it read an element holding a comma, or a two-dimensional array
// (written as the literal Postgres reads it from), as a list of EANs.
const eanShapes = [
  { what: "an EAN holding a comma", eans: ["40059000,40059001"], shop: "rossmann" },
  { what: "a two-dimensional EAN array", eans: "{{40059000},{40059001}}", shop: "hebe" },
];
for (const [index, { what, eans, shop }] of eanShapes.entries()) {
  // A fresh product id, and a shop the product has no decision for, so a missing check shows up as an added row.
  const product = await a.client.from("watchlist_items").insert({ ...rossmannItem(rossmannId(3 + index)), eans });
  check(`watchlist_items refuses ${what}`, product.error?.code === "23514", show(product));
  const match = await a.client
    .from("watchlist_matches")
    .insert({ ...naturaMatch(aItemId, "EAN-CHECK"), shop_id: shop, eans });
  check(`watchlist_matches refuses ${what}`, match.error?.code === "23514", show(match));
}

// 8. A lookup that found nothing changes only as a decision: the update grant covers the decision's columns, never
// which shop or product the row belongs to. The old table-wide grant let both changes below through, because the
// product has no Hebe decision and the other product is user A's own.
const aOtherItemId = await addProduct(a, "A", rossmannId(2));
const notFound = await a.client
  .from("watchlist_matches")
  .insert({ watchlist_item_id: aItemId, shop_id: "super-pharm", state: "not_found", decided_by: "auto" })
  .select("id")
  .single();
check("user A records a Super-Pharm lookup that found nothing for X", Boolean(notFound.data?.id), show(notFound));
const readNotFound = () =>
  a.client.from("watchlist_matches").select("watchlist_item_id, shop_id, state").eq("id", notFound.data?.id);
const unchanged = (row) =>
  row.data?.length === 1 &&
  row.data[0].watchlist_item_id === aItemId &&
  row.data[0].shop_id === "super-pharm" &&
  row.data[0].state === "not_found";
const moved = await a.client.from("watchlist_matches").update({ shop_id: "hebe" }).eq("id", notFound.data?.id);
const afterMove = await readNotFound();
check(
  "user A can't move their not-found row to another shop",
  moved.error?.code === "42501" && unchanged(afterMove),
  `update ${show(moved)}, row ${show(afterMove)}`,
);
const repointed = await a.client
  .from("watchlist_matches")
  .update({ watchlist_item_id: aOtherItemId })
  .eq("id", notFound.data?.id);
const afterRepoint = await readNotFound();
check(
  "user A can't point their not-found row at their other product",
  repointed.error?.code === "42501" && unchanged(afterRepoint),
  `update ${show(repointed)}, row ${show(afterRepoint)}`,
);

// 9. A re-pin changes which item a user watches, and removing a product deletes no observation (FR-005). User B
// records a price for skuB, then re-pins their Natura match from skuB to skuA, narrowing the update to the match it
// replaces, and so reads user A's price for skuA and no longer skuB's, which no one else watches. Then user A removes X:
// B, who still watches X and now skuA, keeps every observation of both, while A, who watched them only through that
// product and its match, reads and adds none.
const bSkuBWrite = await table(b.client).insert(priceRow("natura", skuB));
const bSkuBBefore = await table(b.client).select("id").eq("shop_item_id", skuB);
check(
  "user B records a price for skuB, the Natura SKU they matched",
  !bSkuBWrite.error && bSkuBBefore.data?.length === 1,
  `insert ${show(bSkuBWrite)}, read ${show(bSkuBBefore)}`,
);
const bRepin = await b.client
  .from("watchlist_matches")
  .update({ state: "matched", decided_by: "user", shop_item_id: skuA, checked_at: new Date().toISOString() })
  .eq("watchlist_item_id", bItemId)
  .eq("shop_id", "natura")
  .eq("state", "matched")
  .eq("shop_item_id", skuB)
  .select("id");
const bSkuA = await table(b.client).select("id, observed_at").eq("shop_item_id", skuA);
const skuAObs = bSkuA.data?.[0];
check(
  "user B re-pins their Natura match to skuA and reads its observation",
  !bRepin.error && bRepin.data?.length === 1 && bSkuA.data?.length === 1,
  `update ${show(bRepin)}, read ${show(bSkuA)}`,
);
const bSkuBTable = await table(b.client).select("id").eq("shop_item_id", skuB);
const bSkuBView = await view(b.client).select("shop_item_id").eq("shop_item_id", skuB);
const bSkuBSummary = await summaries(b.client).select("shop_item_id").eq("shop_item_id", skuB);
const bSkuBAfter = await table(b.client).insert(priceRow("natura", skuB));
check(
  "once user B re-pins away from skuB, B reads none of its observations and adds none",
  bSkuBTable.data?.length === 0 &&
    bSkuBView.data?.length === 0 &&
    bSkuBSummary.data?.length === 0 &&
    bSkuBAfter.error?.code === "42501",
  `table ${show(bSkuBTable)}, view ${show(bSkuBView)}, product page's view ${show(bSkuBSummary)}, ` +
    `insert ${show(bSkuBAfter)}`,
);
const removed = await a.client.from("watchlist_items").delete().eq("id", aItemId).select("id");
const bTableAfter = await table(b.client).select("id").in("shop_item_id", [itemX, skuA]);
const bTableIds = (bTableAfter.data ?? []).map((row) => row.id);
const bViewAfter = await view(b.client)
  .select("shop_item_id, last_checked_at, priced_at")
  .in("shop_item_id", [itemX, skuA]);
const bLatest = (itemId) => bViewAfter.data?.find((row) => row.shop_item_id === itemId);
check(
  "removing a product deletes no observation",
  !removed.error &&
    removed.data?.length === 1 &&
    bTableIds.length === 3 &&
    bTableIds.includes(priceObs?.id) &&
    bTableIds.includes(missingObs?.id) &&
    bTableIds.includes(skuAObs?.id) &&
    bViewAfter.data?.length === 2 &&
    bLatest(itemX)?.last_checked_at === missingObs?.observed_at &&
    bLatest(itemX)?.priced_at === priceObs?.observed_at &&
    bLatest(skuA)?.priced_at === skuAObs?.observed_at,
  `delete ${show(removed)}, table ${show(bTableAfter)}, view ${show(bViewAfter)}`,
);
const aTableAfter = await table(a.client).select("id").in("shop_item_id", [itemX, skuA]);
const aViewAfter = await view(a.client).select("shop_item_id").in("shop_item_id", [itemX, skuA]);
const aWriteAfter = await table(a.client).insert(priceRow("rossmann", itemX));
check(
  "a user who removed their product no longer reads or adds its prices",
  aTableAfter.data?.length === 0 && aViewAfter.data?.length === 0 && aWriteAfter.error?.code === "42501",
  `table ${show(aTableAfter)}, view ${show(aViewAfter)}, insert ${show(aWriteAfter)}`,
);

// 10. The product page's view (S-04) gives each item's latest check, as latest_price_observations does, with its
// history: the lowest price a check found the item orderable online at in the 30 days in Poland before today, and the
// days of those checks, each once. No user can set a check's time, so the checks of a fresh item H are moved back as
// the local superuser, and a move shifts every check of the item. So they're added oldest first: three days ago a
// missing item and an unorderable 5,99 zł, two days ago 23,99 and 21,99 zł, yesterday 22,99 zł, and today 9,99 zł,
// below them all. The last move lands yesterday's check at about noon in Poland, whatever the hour, and the older ones
// whole days before it, so none lands near a midnight, even across a change of clocks.
const itemH = rossmannId(5);
await addProduct(a, "A", itemH);
const hInserts = [];
const recordH = async (row) => hInserts.push(await table(a.client).insert(row));
const hMoves = [];
const moveH = (hours) => hMoves.push(backdate(itemH, hours));
await recordH(missingRow("rossmann", itemH));
await recordH(priceRow("rossmann", itemH, { price: 5.99, available: false }));
moveH(24);
await recordH(priceRow("rossmann", itemH, { price: 23.99 }));
await recordH(priceRow("rossmann", itemH, { price: 21.99 }));
moveH(24);
await recordH(priceRow("rossmann", itemH, { price: 22.99 }));
// From any hour of today in Poland, that hour and 12 more back is about noon yesterday.
moveH(inPoland(Date.now()).hour + 12);
await recordH(priceRow("rossmann", itemH, { price: 9.99 }));
check(
  "user A records six checks of H, all but today's moved back to the days before",
  hInserts.length === 6 && hInserts.every((result) => !result.error) && hMoves.join() === "2,4,5",
  `inserts ${hInserts.map(show).join(", ")}, moved ${hMoves.join(", ")}`,
);

// The view takes today by the database's clock when it's read. The expected history is worked out by the same rule
// from where each check landed, for the day the newest check was stamped on and for the day just after the read, which
// differ only when the read came after a midnight in Poland, so the check holds at any hour.
const hSummary = await summaries(a.client).select(SUMMARY_COLUMNS).eq("shop_item_id", itemH);
const readOn = inPoland(Date.now()).day;
const hLatest = await view(a.client).select(LATEST_COLUMNS).eq("shop_item_id", itemH);
const hChecks = await table(a.client).select("status, price, available, observed_at").eq("shop_item_id", itemH);
const summaryH = hSummary.data?.[0];
const latestH = hLatest.data?.[0];
check(
  "the product page's view gives user A one row for H, with the latest check latest_price_observations gives",
  hSummary.data?.length === 1 &&
    hLatest.data?.length === 1 &&
    LATEST_COLUMNS.split(", ").every((column) => summaryH[column] === latestH[column]) &&
    summaryH.price === 9.99,
  `price_summaries ${show(hSummary)}, latest_price_observations ${show(hLatest)}`,
);
const checksH = hChecks.data ?? [];
const stamps = checksH.map((row) => Date.parse(row.observed_at));
const stampedOn = stamps.length === 0 ? [] : [inPoland(Math.max(...stamps)).day];
const expected = [...new Set([...stampedOn, readOn])].map((today) => expectedHistory(checksH, today));
const historyH = { low: summaryH?.history_low, days: summaryH?.history_days };
check(
  "its history counts H's orderable prices before today only, not today's, the missing item's or the unorderable one's",
  checksH.length === 6 && expected.some((each) => JSON.stringify(each) === JSON.stringify(historyH)),
  `history ${JSON.stringify(historyH)}, expected ${JSON.stringify(expected)}, checks ${show(hChecks)}`,
);
// The two orderable checks of two days ago.
const pairDays = new Set(
  checksH.filter((row) => row.price === 23.99 || row.price === 21.99).map((row) => inPoland(row.observed_at).day),
);
const [pairDay] = pairDays;
check(
  "two checks on one past day count as one date",
  pairDays.size === 1 && summaryH?.history_days?.filter((day) => day === pairDay).length === 1,
  `checks on ${[...pairDays].join(", ")}, history days ${JSON.stringify(summaryH?.history_days)}`,
);
const bSummaryH = await summaries(b.client).select("shop_item_id, history_low, history_days").eq("shop_item_id", itemH);
check(
  "user B, who doesn't watch H, reads no row of the product page's view for it",
  bSummaryH.data?.length === 0,
  show(bSummaryH),
);

// 11. Where the history's 30 days start: a check on the 30th day in Poland before today counts, and one on the 31st
// doesn't. Item W gets a 7,77 zł check, moved back a day, then an 8,88 zł one, and the last move lands the newer check at
// about noon 30 days before today, from any hour of today, and the older one a day before it.
const itemW = rossmannId(7);
await addProduct(a, "A", itemW);
const wInserts = [await table(a.client).insert(priceRow("rossmann", itemW, { price: 7.77 }))];
const wMoves = [backdate(itemW, 24)];
wInserts.push(await table(a.client).insert(priceRow("rossmann", itemW, { price: 8.88 })));
wMoves.push(backdate(itemW, inPoland(Date.now()).hour + 12 + 29 * 24));
check(
  "user A records two checks of W, moved back to 30 and 31 days before today",
  wInserts.every((result) => !result.error) && wMoves.join() === "1,2",
  `inserts ${wInserts.map(show).join(", ")}, moved ${wMoves.join(", ")}`,
);
const wSummary = await summaries(a.client).select("history_low, history_days").eq("shop_item_id", itemW);
const wChecks = await table(a.client).select("status, price, available, observed_at").eq("shop_item_id", itemW);
const checksW = wChecks.data ?? [];
const historyW = { low: wSummary.data?.[0]?.history_low, days: wSummary.data?.[0]?.history_days };
// As for H, the day the newer check was stamped on and the day of the read differ only after a midnight in Poland.
const stampedW = checksW.filter((row) => row.price === 8.88).map((row) => inPoland(row.observed_at).day);
const todaysW = [...new Set([...stampedW.map((day) => addDays(day, 30)), inPoland(Date.now()).day])];
const expectedW = todaysW.map((today) => expectedHistory(checksW, today));
check(
  "its history counts the check of 30 days before today, 8,88 zł, and not the one of 31 days before",
  checksW.length === 2 &&
    expectedW.some((each) => JSON.stringify(each) === JSON.stringify(historyW)) &&
    (historyW.low === 8.88 || todaysW.length > 1),
  `history ${JSON.stringify(historyW)}, expected ${JSON.stringify(expectedW)}, checks ${show(wChecks)}`,
);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll price observations database checks passed");
process.exit(failed ? 1 : 0);
