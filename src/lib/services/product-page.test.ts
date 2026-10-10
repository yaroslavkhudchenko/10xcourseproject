import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWatchedProduct } from "@/lib/services/matches";
import { openProductPage, type OpenedProductPage } from "@/lib/services/product-page";
import { shopGateFor } from "@/lib/services/shop-gate";
import { reservations, served, world } from "@/lib/services/testing/gate-world";
import type { ReplayEntry } from "@/lib/services/testing/replay-fetch";
import { declinedRow, matchRow, naturaProductRow, notFoundRow, productRow } from "@/lib/services/testing/stored-rows";
import { TIMEOUT, type StubCall, type StubRelation } from "@/lib/services/testing/stub-supabase";
import eanHit from "@/lib/services/shops/fixtures/natura-ean-hit.json";

// risk: #3 (context/foundation/test-plan.md): a product page view spends the per-shop cap everyone shares, asks a shop
// it shouldn't, such as the product's own shop, one its address names but isn't one of its matched shops, or a stopped
// shop; and #1: a match a view has just stored shows no price, or decisions that couldn't be read read as none.
// facet: the product page's own call (openProductPage), on a product loaded as the page loads it (loadWatchedProduct),
// with the real gate over the stand-in database's counter and the shops' answers replayed from their recordings, so
// each test counts the reservations and the requests the shops were sent, and which rows were read and written.
// expected values: what a view costs the shops, as S-03's plan states it (a lookup in each matched shop with no decision
// on the user's own navigation alone; `?repin=<shop>` that shop's choice alone; `?retry=<shop>` that shop's lookup
// alone), the matched shops CLAUDE.md names (a product picked in Natura is matched in Rossmann, Hebe and Super-Pharm),
// the owner's call that a retry that stored its outcome goes back to the plain address, and Natura's recorded EAN hit
// (natura-ean-hit.json: NV89063, its page in Natura), never read off the service.

const NOW = "2026-10-10T12:00:00.000Z";
const MINUTE = 60 * 1000;
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

const PRODUCT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const HEBE_SOFT = "000000000000218807";
// Natura's EAN search for Nivea Soft 300 ml, as its adapter sends it, which natura-ean-hit.json answers with its one
// item, NV89063, at 16,99 zł.
const NATURA_EAN_SEARCH = "https://live.luigisbox.com/search?tracker_id=703598-939363&q=4005900009319&size=5";
const NATURA_EAN_HIT = { url: NATURA_EAN_SEARCH, status: 200, body: JSON.stringify(eanHit) } satisfies ReplayEntry;
const NATURA_SOFT_PAGE =
  "https://drogerienatura.pl/produkt/nivea-soft-krem-intensywnie-nawilzajacy-300-ml-4005900009319";
const ROSSMANN_SOFT_PAGE = "https://www.rossmann.pl/Produkt/NIVEA-Soft,26900,13049";
/** What a shop's card or choice says while the shop is stopped. */
const stoppedText = (shop: string) =>
  `Wyszukiwanie w sklepie ${shop} jest wyłączone, bo sklep zablokował zapytania. Właściciel musi je ponownie włączyć.`;

// The user's Nivea Soft 300 ml picked in Rossmann (26900), as stored-rows.ts writes its row, with the EAN Natura's
// item carries and its own page: matched in Natura, Hebe and Super-Pharm.
const pickedInRossmann = {
  ...productRow(PRODUCT_ID, "26900"),
  eans: ["4005900009319"],
  product_url: ROSSMANN_SOFT_PAGE,
};
// The same product picked in Natura (NV89063): matched in Rossmann, Hebe and Super-Pharm.
const pickedInNatura = naturaProductRow(PRODUCT_ID, "NV89063");

/** An item's latest check as price_summaries gives it: a price, `checkedAgo` before now, orderable online. */
function summaryRow(shop: string, shopItemId: string, price: number, checkedAgo = 10 * MINUTE) {
  return {
    shop_id: shop,
    shop_item_id: shopItemId,
    last_checked_at: ago(checkedAgo),
    last_status: "price",
    price,
    regular_price: null,
    lowest_price_30d: null,
    promo_ends_on: null,
    available: true,
    priced_at: ago(checkedAgo),
    history_low: null,
    history_days: [],
  };
}

/** The stand-in database's rows: the product, its decisions, its items' latest prices, and the price checks added. */
function relationsOf(
  product: Record<string, unknown>,
  decisions: StubRelation,
  summaries: StubRelation = [],
): Record<string, StubRelation> {
  return {
    watchlist_items: [product],
    watchlist_matches: decisions,
    price_summaries: summaries,
    price_observations: [],
  };
}

/**
 * The product's page as the page opens it, by the user's own navigation unless said otherwise and with the address's
 * `query`: the product loaded as the page loads it (loadWatchedProduct), then the page's own call (openProductPage),
 * with the real gate over the stand-in database's counter.
 */
async function openPage(
  client: SupabaseClient,
  { query = "", ownNavigation = true }: { query?: string; ownNavigation?: boolean } = {},
): Promise<OpenedProductPage> {
  const loaded = await loadWatchedProduct(client, PRODUCT_ID);
  if (loaded === null || loaded === "failed") {
    throw new Error(`expected the product loaded, got ${String(loaded)}`);
  }
  return openProductPage({
    supabase: client,
    gate: shopGateFor(client),
    loaded,
    params: new URLSearchParams(query),
    ownNavigation,
    filter: "all",
  });
}

/** The page to show; a retry that went back to the plain address fails the test. */
function shownPage(opened: OpenedProductPage): Extract<OpenedProductPage, { kind: "shown" }> {
  if (opened.kind !== "shown") {
    throw new Error(`expected the page shown, got ${opened.kind}`);
  }
  return opened;
}

/** Each database query as its relation and its first call, such as `["price_summaries", "select"]`; no RPC. */
function tablesOf(queries: StubCall[][]): unknown[][] {
  return queries.flatMap(([[kind, name], [first]]) => (kind === "from" ? [[name, first]] : []));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  // A read that fails and a reservation the gate is refused are logged; these tests look at what the page does.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("openProductPage: the loaded product's matched shops", () => {
  it("runs a step in each of a product picked in Natura's matched shops, Rossmann, Hebe and Super-Pharm, and asks no shop off the user's own navigation", async () => {
    // No decision anywhere, so the user's own navigation would look every matched shop up.
    const { client, queries } = world(relationsOf(pickedInNatura, [], [summaryRow("natura", "NV89063", 16.99)]), [
      NATURA_EAN_HIT,
    ]);

    const page = shownPage(await openPage(client, { ownNavigation: false }));

    expect(page.matchedShops).toEqual(["rossmann", "hebe", "super-pharm"]);
    expect(page.steps.map(({ shop, step }) => [shop, step])).toEqual([
      ["rossmann", { kind: "prompt" }],
      ["hebe", { kind: "prompt" }],
      ["super-pharm", { kind: "prompt" }],
    ]);
    // The island prices its own item, in Natura, and refetches nothing on its own.
    expect(page.shops.map(({ shop, shopItemId }) => [shop, shopItemId])).toEqual([["natura", "NV89063"]]);
    expect(page.autoRefresh).toBe(false);
    expect(reservations(queries)).toEqual([]);
    expect(served()).toEqual([]);
  });

  it("shows every matched shop's decision as unreadable when its decisions can't be read at all, asks no shop, and still prices its own item", async () => {
    const { client, queries } = world(
      relationsOf(pickedInRossmann, TIMEOUT, [summaryRow("rossmann", "26900", 26.99)]),
      [NATURA_EAN_HIT],
    );

    const page = shownPage(await openPage(client));

    expect(page.matchedShops).toEqual(["natura", "hebe", "super-pharm"]);
    expect(page.steps.map(({ shop, view }) => [shop, view])).toEqual([
      ["natura", { kind: "read-failed" }],
      ["hebe", { kind: "read-failed" }],
      ["super-pharm", { kind: "read-failed" }],
    ]);
    expect(page.shops).toMatchObject([{ shop: "rossmann", shopItemId: "26900", latest: { offer: { price: 26.99 } } }]);
    expect(page.pricesFailed).toBe(false);
    expect(reservations(queries)).toEqual([]);
    expect(served()).toEqual([]);
  });
});

describe("openProductPage: the shop its address names", () => {
  // The product picked in Natura, matched in Rossmann and Hebe and undecided in Super-Pharm, with a match stored in
  // Natura too, its own shop, as a direct write could store it. Every shop is stopped: a search is refused before it's
  // sent, and its reservation still shows.
  const decisions = [
    matchRow(PRODUCT_ID, "natura", "NV81063"),
    matchRow(PRODUCT_ID, "rossmann", "26900"),
    matchRow(PRODUCT_ID, "hebe", HEBE_SOFT),
  ];

  it("opens the plain page for ?repin=natura, the product's own shop: no choice, and a plain view's lookup in Super-Pharm, undecided", async () => {
    const { client, queries } = world(relationsOf(pickedInNatura, decisions), [], "stopped");

    const page = shownPage(await openPage(client, { query: "repin=natura" }));

    expect(page.steps.map(({ shop, step, repin }) => [shop, step.kind, repin])).toEqual([
      ["rossmann", "stored", null],
      ["hebe", "stored", null],
      ["super-pharm", "lookup", null],
    ]);
    expect(page.steps[2].view).toEqual({ kind: "unavailable", message: stoppedText("Super-Pharm") });
    // Its own item first, then its matches: the match stored in its own shop adds nothing.
    expect(page.shops.map(({ shop, shopItemId }) => [shop, shopItemId])).toEqual([
      ["natura", "NV89063"],
      ["rossmann", "26900"],
      ["hebe", HEBE_SOFT],
    ]);
    expect(page.autoRefresh).toBe(true);
    // Super-Pharm's one search, by name, which the stopped shop refused before it was sent.
    expect(reservations(queries)).toEqual([{ p_shop_id: "super-pharm" }]);
    expect(served()).toEqual([]);
  });

  it("opens Hebe's choice for ?repin=hebe, a matched shop, asking the stopped Hebe nothing and Super-Pharm only its button", async () => {
    const { client, queries } = world(relationsOf(pickedInNatura, decisions), [], "stopped");

    const page = shownPage(await openPage(client, { query: "repin=hebe" }));

    expect(page.steps.map(({ shop, step }) => [shop, step.kind])).toEqual([
      ["rossmann", "stored"],
      ["hebe", "repin"],
      ["super-pharm", "prompt"],
    ]);
    // The choice says Hebe's search is stopped, and still offers „Żaden z nich” for the match it replaces.
    expect(page.steps[1].repin).toMatchObject({
      options: [],
      decline: true,
      replaces: `matched:${HEBE_SOFT}`,
      message: { text: stoppedText("Hebe"), warning: true },
    });
    // The choice has cost Hebe its search, so the island refetches nothing on its own.
    expect(page.autoRefresh).toBe(false);
    // Hebe's one reservation, which the stopped shop refused before any request was sent.
    expect(reservations(queries)).toEqual([{ p_shop_id: "hebe" }]);
    expect(served()).toEqual([]);
  });

  it("comes back retried, reading no price, when ?retry=natura stores the item Natura's EAN search accepts", async () => {
    // Natura found nothing before, and its recorded EAN hit now accepts NV89063; Hebe and Super-Pharm have no decision.
    const { client, queries } = world(
      relationsOf(pickedInRossmann, [notFoundRow(PRODUCT_ID, "natura")], [summaryRow("rossmann", "26900", 26.99)]),
      [NATURA_EAN_HIT],
    );

    expect(await openPage(client, { query: "retry=natura" })).toEqual({ kind: "retried" });
    // Natura's EAN search alone: a page opened to retry Natura asks no other shop.
    expect(reservations(queries)).toEqual([{ p_shop_id: "natura" }]);
    expect(served()).toEqual([NATURA_EAN_SEARCH]);
    // The product and its decisions, then the match and the price it came with, and no price read: the plain address
    // the page goes back to reads them.
    expect(tablesOf(queries)).toEqual([
      ["watchlist_items", "select"],
      ["watchlist_matches", "select"],
      ["watchlist_matches", "insert"],
      ["price_observations", "insert"],
    ]);
  });
});

describe("openProductPage: the island's prices", () => {
  it("prices the match a view's lookup has just stored at once, linked to its page in Natura", async () => {
    // Natura has no decision: the user's own navigation looks it up, and its recorded EAN hit is accepted and stored
    // with the price it came with, which the price read then finds. Hebe and Super-Pharm, declined, are only shown.
    const { client, queries } = world(
      relationsOf(
        pickedInRossmann,
        [declinedRow(PRODUCT_ID, "hebe"), declinedRow(PRODUCT_ID, "super-pharm")],
        [summaryRow("rossmann", "26900", 26.99), summaryRow("natura", "NV89063", 16.99, 0)],
      ),
      [NATURA_EAN_HIT],
    );

    const page = shownPage(await openPage(client));

    expect(page.steps.map(({ shop, step, item }) => [shop, step.kind, item?.shopItemId ?? null])).toEqual([
      ["natura", "lookup", "NV89063"],
      ["hebe", "stored", null],
      ["super-pharm", "stored", null],
    ]);
    // The product's own item first, linked to its own page, then Natura's new match, linked to its page in Natura.
    expect(page.shops).toMatchObject([
      { shop: "rossmann", shopItemId: "26900", productUrl: ROSSMANN_SOFT_PAGE, latest: { offer: { price: 26.99 } } },
      { shop: "natura", shopItemId: "NV89063", productUrl: NATURA_SOFT_PAGE, latest: { offer: { price: 16.99 } } },
    ]);
    expect(page.pricesFailed).toBe(false);
    expect(page.autoRefresh).toBe(true);
    // Natura's EAN search, the one request, and one price read after the steps, for both items.
    expect(reservations(queries)).toEqual([{ p_shop_id: "natura" }]);
    expect(served()).toEqual([NATURA_EAN_SEARCH]);
    expect(tablesOf(queries)).toEqual([
      ["watchlist_items", "select"],
      ["watchlist_matches", "select"],
      ["watchlist_matches", "insert"],
      ["price_observations", "insert"],
      ["price_summaries", "select"],
    ]);
    expect(queries.find(([[, name]]) => name === "price_summaries")).toContainEqual([
      "in",
      "shop_item_id",
      ["26900", "NV89063"],
    ]);
  });
});
