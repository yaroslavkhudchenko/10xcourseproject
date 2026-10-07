// Two-user route check: against a running server bound to the local stack, user B gets for user A's product exactly
// what a product no one has gets, through every route that takes a product's id, and changes nothing of A's (test plan
// risk #4). The database scripts prove the rules row by row; this proves that the pages, the forms and the island's
// JSON route add no way around them, behind the middleware, Astro's checkOrigin and the cache headers. As A, the same
// comparison must differ: a harness that saw nothing would pass the check above, never this one.
// Run against the production preview or the dev server, bound to the local stack:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_KEY=<anon key> BASE_URL=http://localhost:4321 node scripts/check-two-users.mjs
// It holds every enabled shop for its whole run, as the local superuser (scripts/e2e-local-db.mjs), and switches back
// on only the shops it held, also when it fails or is stopped, so a route that reached the gate would still ask no
// shop. It refuses to start while an e2e run or a manual `stop` holds the shops, whose release mid-run would switch them
// back on under it, and it needs .env and .dev.vars pointing at the local stack, as that helper does. Each run signs up
// two fresh users and uses shop item ids of its own, so it can run again without resetting the database and no real
// product gets a test price.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cookieJar } from "./cookie-jar.mjs";
import {
  assertLocalSupabase,
  e2eHolds,
  enabledShops,
  requestLogMark,
  restoreShops,
  stopShops,
} from "./e2e-local-db.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const { SUPABASE_URL, SUPABASE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log("FAIL  SUPABASE_URL and SUPABASE_KEY must be set");
  process.exit(1);
}
// The check signs up users and holds the shops of the deployment it talks to, so it only ever runs against the local
// stack, which the superuser's helper also requires of .env and .dev.vars before anything is written.
const { hostname } = new URL(SUPABASE_URL);
if (hostname !== "127.0.0.1" && hostname !== "localhost") {
  console.log(`FAIL  refusing to run against ${hostname}: point SUPABASE_URL at the local Supabase`);
  process.exit(1);
}
try {
  assertLocalSupabase();
} catch (error) {
  console.log(`FAIL  the check holds the shops as the local superuser, whose helper says: ${error.message}`);
  process.exit(1);
}

let failed = 0;
function check(name, ok, actual) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual}`);
  if (!ok) failed++;
}

function show({ data, error }) {
  if (error) return `error ${error.code} ${error.message}`;
  return data === null ? "ok" : JSON.stringify(data);
}

// Every Supabase client talks only to SUPABASE_URL and holds a throwaway signed-in session.
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const password = "Two-Users-Passw0rd!";
const run = Date.now();

// Local sign-up is enabled with email confirmation off, so signing up returns a session.
async function signUpUser(label) {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, clientOptions);
  const email = `two-users-${label}-${run}@example.com`;
  const { data, error } = await client.auth.signUp({ email, password });
  const id = data.session ? data.user?.id : undefined;
  check(`sign up throwaway user ${label}`, Boolean(id), error?.message ?? (id ? email : "no session returned"));
  return { client, email, id };
}

// One browser's worth of cookies: each user signs in through the app's own form and keeps its session cookies. Every
// request comes from the app's own origin and follows no redirect, and none of them says it's a prefetch or comes from
// another site, so a page treats each as the user's own navigation, the one that may ask a shop.
function browser() {
  const jar = cookieJar();
  return async (path, { method = "GET", form, json } = {}) => {
    const response = await fetch(BASE_URL + path, {
      method,
      redirect: "manual",
      headers: {
        Cookie: jar.header(),
        Origin: BASE_URL,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : undefined,
    });
    jar.store(response);
    return {
      status: response.status,
      location: response.headers.get("location") ?? "",
      cacheControl: response.headers.get("cache-control") ?? "",
      body: await response.text(),
    };
  };
}

// The rows A's product is seeded with: a Rossmann product whose name no page shows anyone else, a decision in each
// matched shop, so no page looks the product up anywhere, and a stored price for its Rossmann item and its Natura match.
// Natura's SKUs look like "NV89063" and Rossmann's ids are short numbers, so this run's ids are no real product's; the
// Rossmann id still has the 12 digits at most the app reads one by, so a refresh takes it to the gate.
const marker = `Prywatny${run}`;
const rossmannId = `${String(run).slice(-11)}9`;
const sku = `CHECK-${run}-TU`;
const product = {
  source: "rossmann",
  source_item_id: rossmannId,
  brand: "NIVEA",
  name: marker,
  caption: "krem uniwersalny, nawilżający",
  size_text: "300 ml",
  size_value: 300,
  size_unit: "ml",
  eans: ["4005900009319"],
};
const decisionsOf = (itemId) => [
  {
    watchlist_item_id: itemId,
    shop_id: "natura",
    state: "matched",
    decided_by: "auto",
    shop_item_id: sku,
    name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
  },
  { watchlist_item_id: itemId, shop_id: "hebe", state: "unmatched", decided_by: "user" },
  { watchlist_item_id: itemId, shop_id: "super-pharm", state: "not_found", decided_by: "auto" },
];
const priceOf = (shopId, shopItemId) => ({
  shop_id: shopId,
  shop_item_id: shopItemId,
  status: "price",
  price: 26.99,
  regular_price: null,
  lowest_price_30d: 24.99,
  promo_ends_on: null,
  available: true,
});
const PRODUCT_COLUMNS = "id, source, source_item_id, brand, name, caption, size_text, size_value, size_unit, eans";
const DECISION_COLUMNS = "shop_id, state, decided_by, shop_item_id, name, checked_at";

// What A's rows hold, read as A: the product, its decisions and the observations of its two items, each read's rows or
// its error, so a read that failed both times can't pass for rows that didn't change.
async function rowsOf(client, itemId) {
  const reads = await Promise.all([
    client.from("watchlist_items").select(PRODUCT_COLUMNS).eq("id", itemId),
    client.from("watchlist_matches").select(DECISION_COLUMNS).eq("watchlist_item_id", itemId).order("shop_id"),
    client
      .from("price_observations")
      .select("id, shop_id, shop_item_id, status, price")
      .in("shop_item_id", [rossmannId, sku])
      .order("id"),
  ]);
  const [item, decisions, prices] = reads.map(({ data, error }) =>
    error ? { error: `${error.code} ${error.message}` } : { rows: data },
  );
  return { item, decisions, prices };
}

// Whether the shops are all held: no shop may be enabled while either user's requests could reach the gate.
function noShopEnabled() {
  const enabled = enabledShops();
  check("every shop is held", enabled.length === 0, enabled.length ? `enabled: ${enabled.join(", ")}` : "none enabled");
  return enabled.length === 0;
}

const NOT_FOUND = "Nie znaleziono produktu.";
const isPrivate = (answer) => answer.cacheControl.includes("private") && answer.cacheControl.includes("no-store");
// An answer with the product's id in its Location written as <id>, so A's id and the missing one compare equal.
const located = (answer, id) => answer.location.replaceAll(id, "<id>");
// What a form or the JSON route answered: its status and its Location or body.
const summary = (answer) => `${answer.status} ${answer.location || answer.body} (${answer.cacheControl})`;
// What a page answered: its status, whether it says the product wasn't found, and whether it shows A's product.
const pageSummary = (answer) =>
  `${answer.status}, ${answer.body.includes(NOT_FOUND) ? "not found" : "no not-found heading"}, ` +
  `${answer.body.includes(marker) ? "shows A's product" : "nothing of A's product"} (${answer.cacheControl})`;

async function main() {
  const a = await signUpUser("a");
  const b = await signUpUser("b");
  if (!a.id || !b.id) return;

  // 1. A's product, its decisions and its prices, through A's own session.
  const added = await a.client.from("watchlist_items").insert(product).select("id").single();
  const aId = added.data?.id;
  const decided = aId ? await a.client.from("watchlist_matches").insert(decisionsOf(aId)) : { data: null, error: null };
  const priced = await a.client
    .from("price_observations")
    .insert([priceOf("rossmann", rossmannId), priceOf("natura", sku)]);
  check(
    "user A adds a product, a decision in each matched shop and two stored prices",
    Boolean(aId) && !decided.error && !priced.error,
    `product ${show(added)}, decisions ${show(decided)}, prices ${show(priced)}`,
  );
  if (!aId) return;
  const before = await rowsOf(a.client, aId);
  const seeded =
    before.item.rows?.length === 1 && before.decisions.rows?.length === 3 && before.prices.rows?.length === 2;
  check("user A reads back the product, its 3 decisions and its 2 prices", seeded, JSON.stringify(before));
  if (!seeded) return;

  // 2. Both sign in through the app's own Polish form, each in a browser of their own.
  const asA = browser();
  const asB = browser();
  for (const [label, user, as] of [
    ["A", a, asA],
    ["B", b, asB],
  ]) {
    const signedIn = await as("/api/auth/signin", { method: "POST", form: { email: user.email, password } });
    check(
      `user ${label} signs in through the app's form`,
      signedIn.status === 302 && signedIn.location === "/watchlist",
      summary(signedIn),
    );
  }
  // No reservation is made from here on: every shop is held, so a stopped shop's reservation inserts nothing, and a
  // product no page can see costs none.
  if (!noShopEnabled()) return;
  const mark = requestLogMark();

  // 3. As B, every route answers A's product as it answers one no one has: the same status, the same body or the same
  // Location once the id is swapped, nothing of A's product, and no cache may keep it.
  const missingId = randomUUID();
  for (const query of ["", "?repin=natura", "?retry=super-pharm"]) {
    const theirs = await asB(`/watchlist/${aId}${query}`);
    const none = await asB(`/watchlist/${missingId}${query}`);
    check(
      `as B, the product page${query} answers A's product as one no one has`,
      theirs.status === 404 &&
        none.status === 404 &&
        theirs.body.includes(NOT_FOUND) &&
        none.body.includes(NOT_FOUND) &&
        !theirs.body.includes(marker) &&
        isPrivate(theirs) &&
        isPrivate(none),
      `A's ${pageSummary(theirs)}, missing ${pageSummary(none)}`,
    );
  }

  const priceRequest = (itemId) => ({ itemId, shop: "natura", shopItemId: sku });
  const theirPrice = await asB("/api/watchlist/prices", { method: "POST", json: priceRequest(aId) });
  const noPrice = await asB("/api/watchlist/prices", { method: "POST", json: priceRequest(missingId) });
  check(
    "as B, the price route answers A's product as one no one has",
    theirPrice.status === 404 &&
      theirPrice.status === noPrice.status &&
      theirPrice.body === noPrice.body &&
      isPrivate(theirPrice) &&
      isPrivate(noPrice),
    `A's ${summary(theirPrice)}, missing ${summary(noPrice)}`,
  );

  // The forms: the product's refresh, a re-pin's decline of A's match, and the removal.
  const forms = [
    ["the product's price refresh", "/api/watchlist/refresh", (itemId) => ({ itemId })],
    [
      "a re-pin's decline of A's Natura match",
      "/api/watchlist/matches",
      (itemId) => ({ itemId, shop: "natura", action: "decline", replaces: `matched:${sku}` }),
    ],
    ["the removal", "/api/watchlist/remove", (itemId) => ({ itemId })],
  ];
  for (const [what, path, formOf] of forms) {
    const theirs = await asB(path, { method: "POST", form: formOf(aId) });
    const none = await asB(path, { method: "POST", form: formOf(missingId) });
    // Both stay on the list's pages: two redirects to sign-in, after a lost session, would compare equal too.
    check(
      `as B, ${what} answers A's product as one no one has`,
      theirs.status === 302 &&
        none.status === 302 &&
        theirs.location.startsWith("/watchlist") &&
        located(theirs, aId) === located(none, missingId) &&
        isPrivate(theirs) &&
        isPrivate(none),
      `A's ${summary(theirs)}, missing ${summary(none)}`,
    );
  }

  const bList = await asB("/watchlist");
  check(
    "as B, the list shows nothing of A's product",
    bList.status === 200 && !bList.body.includes(marker) && isPrivate(bList),
    pageSummary(bList),
  );

  // 4. The negative control: as A, the same comparison differs, so the check above could see a product it was shown.
  // A's own requests reach the gate, so the shops must still be held.
  if (!noShopEnabled()) return;
  const ownPage = await asA(`/watchlist/${aId}`);
  const ownMissing = await asA(`/watchlist/${missingId}`);
  check(
    "as A, the product page shows A's product, unlike one no one has",
    ownPage.status === 200 && ownPage.body.includes(marker) && ownMissing.status === 404 && isPrivate(ownPage),
    `A's ${pageSummary(ownPage)}, missing ${pageSummary(ownMissing)}`,
  );
  // Natura is held, so A's own request reaches the gate and asks no shop.
  const ownPrice = await asA("/api/watchlist/prices", { method: "POST", json: priceRequest(aId) });
  const ownNoPrice = await asA("/api/watchlist/prices", { method: "POST", json: priceRequest(missingId) });
  check(
    "as A, the price route finds A's product, unlike one no one has",
    ownPrice.status !== ownNoPrice.status && ownNoPrice.status === 404 && isPrivate(ownPrice),
    `A's ${summary(ownPrice)}, missing ${summary(ownNoPrice)}`,
  );
  // The product's refresh as A asks its two items' shops, both held, so none answers: `failed`, where a product no one
  // has refreshes nothing: `none`. Nothing is stored, since no shop answered. The decision and the removal have no such
  // control: as A, they would change A's rows.
  const ownRefresh = await asA("/api/watchlist/refresh", { method: "POST", form: { itemId: aId } });
  const ownNoRefresh = await asA("/api/watchlist/refresh", { method: "POST", form: { itemId: missingId } });
  check(
    "as A, the product's refresh asks A's shops, unlike one no one has",
    ownRefresh.location === `/watchlist/${aId}?prices=failed` &&
      ownNoRefresh.location === `/watchlist/${missingId}?prices=none` &&
      isPrivate(ownRefresh),
    `A's ${summary(ownRefresh)}, missing ${summary(ownNoRefresh)}`,
  );
  const aList = await asA("/watchlist");
  check("as A, the list shows A's product", aList.status === 200 && aList.body.includes(marker), pageSummary(aList));

  // 5. Nothing of A's changed, nothing was added for B, and the hold lasted the whole run.
  const after = await rowsOf(a.client, aId);
  check(
    "user A's product, decisions and prices are as they were",
    JSON.stringify(after) === JSON.stringify(before),
    `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`,
  );
  const bItems = await b.client.from("watchlist_items").select("id");
  const bDecisions = await b.client.from("watchlist_matches").select("id");
  check(
    "user B's own list and decisions are still empty",
    bItems.data?.length === 0 && bDecisions.data?.length === 0,
    `list ${show(bItems)}, decisions ${show(bDecisions)}`,
  );
  // A reservation for a stopped shop inserts nothing, so this shows the shops stayed held, and that no shop request was
  // reserved: what B was answered shows B's requests never reached the gate.
  const markAfter = requestLogMark();
  check("the shops stayed held: no shop request was reserved", markAfter === mark, `${mark} -> ${markAfter}`);
}

// Every enabled shop is held under this check's name for its whole run, and only those are switched back on, also when
// it fails, is interrupted or is stopped. It refuses while another holder has the shops: that holder could switch them
// back on mid-run, and a run of its own name would release this one's hold.
const HOLDER = "two-users";
let held;
try {
  const holds = e2eHolds();
  if (holds.length) {
    check(
      "no other run holds the shops",
      false,
      `held: ${holds.join(", ")}; wait for that run, or run \`node scripts/e2e-local-db.mjs restore\` if none is going`,
    );
    process.exit(1);
  }
  held = stopShops(HOLDER);
} catch (error) {
  check("hold every enabled shop as the local superuser", false, error.message);
  process.exit(1);
}
console.log(`held for the run: ${held.length ? held.join(", ") : "no shop was enabled"}`);
const letGo = () => {
  const restored = restoreShops(HOLDER);
  console.log(`switched back on: ${restored.length ? restored.join(", ") : "none"}`);
};
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, () => {
    letGo();
    process.exit(code);
  });
}
try {
  await main();
} finally {
  letGo();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll two-user route checks passed");
process.exit(failed ? 1 : 0);
