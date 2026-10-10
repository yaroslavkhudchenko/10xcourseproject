import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { stubSupabase, type StubRelation } from "@/lib/services/testing/stub-supabase";
import { APP, contextOf, formPost, type FormFields } from "@/lib/services/testing/route-context";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import { matchRow, naturaProductRow, productRow } from "@/lib/services/testing/stored-rows";
import { POST as postPrices } from "@/pages/api/watchlist/prices";
import { POST as postRefresh } from "@/pages/api/watchlist/refresh";
import hebeIds from "@/lib/services/shops/fixtures/hebe-ids.json";
import oneSku from "@/lib/services/shops/fixtures/natura-sku.json";
import twoSkus from "@/lib/services/shops/fixtures/natura-skus.json";
import reduced from "@/lib/services/shops/fixtures/rossmann-detail-reduced.json";
import regular from "@/lib/services/shops/fixtures/rossmann-detail-regular.json";
import superPharmPinnedOne from "@/lib/services/shops/fixtures/super-pharm-pinned-one.json";

// risk: #3 (context/foundation/test-plan.md): a route spends the per-shop cap everyone shares, asks a shop before its
// own refusals, asks again after a shop refused, or reaches a shop around the gate.
// facet: the two routes that reach a shop, called through their exported handlers with the real gate. The stand-in
// database answers their reads and the gate's counter (reserve_shop_request), and every shop answer is a recording
// served by the replay, so each test counts the reservations and the requests the shops were sent.
// expected values: the costs CLAUDE.md states for each route ("one request per shop", a list refresh's items checked
// more than 15 minutes ago, Rossmann one product per request, Natura's items in one batch) and the gate's rules (a
// stopped shop, or one busy under the cap, is asked nothing; a 403 stops the shop and a 429 pauses it until its
// Retry-After, each reported once, and nothing more is asked of it), never read off the routes.

const NOW = "2026-09-28T12:00:00.000Z";
const MINUTE = 60 * 1000;
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

const PRODUCT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const OTHER_ID = "4f1c2a8e-5b7d-4c3e-9a1f-0d2b3c4e5f60";
const FRESH_ID = "7d3e8b1a-2c4f-4e6a-8b9c-1d2e3f4a5b6c";
const NOBODYS_ID = "c0ffee00-0000-4000-8000-000000000001";
const HEBE_SOFT = "000000000000218807";

// The shops' price requests as their adapters send them (price-refresh.test.ts spells out the same).
const detailUrl = (id: string) => `https://www.rossmann.pl/products/v2/api/Products/${id}?shopNumber=null`;
const naturaPriceUrl = (skus: string[]) =>
  "https://live.luigisbox.com/search?tracker_id=703598-939363&f%5B%5D=type%3Aproduct" +
  skus.map((sku) => `&f%5B%5D=sku%3A${sku}`).join("") +
  `&size=${skus.length}&hit_fields=sku%2Cprice_amount%2Cprice_old_amount%2Clowest_price%2Cavailability`;
const hebePriceUrl = (ids: string[]) =>
  "https://live.luigisbox.com/search?tracker_id=421168-505233&f%5B%5D=type%3Aitem" +
  ids.map((id) => `&f%5B%5D=ID%3A${id}`).join("") +
  `&size=${ids.length}&hit_fields=price_amount%2Cprice_sale_amount%2Cprice_omnibus_amount%2Conline_flag`;
const SUPER_PHARM_URL = "https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query";
const superPharmPriceBody = (ids: string[]) =>
  `{"params":"query=&filters=${ids.map((id) => `objectID%3A${id}`).join("+OR+")}&hitsPerPage=${ids.length}` +
  "&analytics=false&attributesToRetrieve=price%2Cin_stock%2CinStoreOnly&attributesToHighlight=%5B%5D" +
  '&enableRules=false"}';

const RECORDINGS = {
  nivea: { url: detailUrl("26900"), status: 200, body: JSON.stringify(regular) },
  felix: { url: detailUrl("131225"), status: 200, body: JSON.stringify(reduced) },
  soft: { url: naturaPriceUrl(["NV89063"]), status: 200, body: JSON.stringify(oneSku) },
  softAndMen: { url: naturaPriceUrl(["NV89063", "NV81063"]), status: 200, body: JSON.stringify(twoSkus) },
  hebeSoft: { url: hebePriceUrl([HEBE_SOFT]), status: 200, body: JSON.stringify(hebeIds) },
  superPharmSoft: {
    url: SUPER_PHARM_URL,
    requestBody: superPharmPriceBody(["10132"]),
    status: 200,
    body: JSON.stringify(superPharmPinnedOne),
  },
} satisfies Record<string, ReplayEntry>;

/** An item's latest check, a price `checkedAgo` before now. */
function latestRow(shop: string, shopItemId: string, checkedAgo: number) {
  return {
    shop_id: shop,
    shop_item_id: shopItemId,
    last_checked_at: ago(checkedAgo),
    last_status: "price",
    price: 9.99,
    regular_price: null,
    lowest_price_30d: null,
    promo_ends_on: null,
    available: true,
    priced_at: ago(checkedAgo),
  };
}

// The product, matched in all three matched shops.
const PRODUCT_RELATIONS: Record<string, StubRelation> = {
  watchlist_items: [productRow(PRODUCT_ID, "26900")],
  watchlist_matches: [
    matchRow(PRODUCT_ID, "natura", "NV89063"),
    matchRow(PRODUCT_ID, "hebe", HEBE_SOFT),
    matchRow(PRODUCT_ID, "super-pharm", "10132"),
  ],
  price_observations: [],
};

// The same items for a product picked in Natura, Nivea Soft by its SKU: its own Natura item, and its matches in
// Rossmann, Hebe and Super-Pharm, the shops a product picked in Natura is matched in.
const NATURA_PRODUCT_RELATIONS: Record<string, StubRelation> = {
  watchlist_items: [naturaProductRow(PRODUCT_ID, "NV89063")],
  watchlist_matches: [
    matchRow(PRODUCT_ID, "rossmann", "26900"),
    matchRow(PRODUCT_ID, "hebe", HEBE_SOFT),
    matchRow(PRODUCT_ID, "super-pharm", "10132"),
  ],
  price_observations: [],
};

/** The product picked in Natura with a match stored in Natura too, its own shop, as a direct write could store it. */
const WITH_OWN_SHOP_MATCH: Record<string, StubRelation> = {
  ...NATURA_PRODUCT_RELATIONS,
  watchlist_matches: [
    matchRow(PRODUCT_ID, "natura", "NV81063"),
    matchRow(PRODUCT_ID, "rossmann", "26900"),
    matchRow(PRODUCT_ID, "hebe", HEBE_SOFT),
    matchRow(PRODUCT_ID, "super-pharm", "10132"),
  ],
};

let fetchMock: Mock<typeof fetch>;

/**
 * The routes' world: the stand-in database with `relations`, the gate's counter answering `outcome` (allowed unless
 * said otherwise), and the shops answering `recordings` through the global fetch the gate calls.
 */
function world(relations: Record<string, StubRelation>, recordings: ReplayEntry[], outcome = "allowed") {
  fetchMock = vi.fn(createReplayFetch(recordings));
  vi.stubGlobal("fetch", fetchMock);
  return stubSupabase({
    relations,
    rpc: {
      reserve_shop_request: () => ({ data: { outcome } }),
      report_shop_block: () => ({ data: null }),
    },
  });
}

/**
 * The URLs the shops were sent, in order, whether or not a recording answered them: a request the replay doesn't know
 * reads as `failed/network`, so a test that needs every shop answered asserts the route's `done` code too.
 */
function served(): string[] {
  return fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)));
}

/** The bodies sent to `url`, in order: one Algolia URL answers every Super-Pharm request, told apart by its body. */
function bodiesSentTo(url: string): unknown[] {
  return fetchMock.mock.calls.flatMap(([input, init]) =>
    (input instanceof Request ? input.url : String(input)) === url ? [init?.body] : [],
  );
}

/** The shops the gate reserved a request for, in order. */
function reservations(queries: unknown[][][]): unknown[] {
  return queries.flatMap(([[kind, name, args]]) => (kind === "rpc" && name === "reserve_shop_request" ? [args] : []));
}

/** The refusals the gate reported, in order, each with its arguments. */
function blockReports(queries: unknown[][][]): unknown[] {
  return queries.flatMap(([[kind, name, args]]) => (kind === "rpc" && name === "report_shop_block" ? [args] : []));
}

/** The island's price request, from the app's own page unless other headers are given. */
function priceRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${APP}/api/watchlist/prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP, "Sec-Fetch-Site": "same-origin", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** "Odśwież ceny" posted as a form, from the app's own page. */
const refreshRequest = (fields: FormFields): Request => formPost("/api/watchlist/refresh", fields);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SOFT_REQUEST = { itemId: PRODUCT_ID, shop: "natura", shopItemId: "NV89063" };

describe("/api/watchlist/prices asks a shop only for the user's own item, once", () => {
  it.each<{ why: string; request: () => Request; status: number }>([
    {
      why: "another site's request",
      request: () => priceRequest(SOFT_REQUEST, { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }),
      status: 403,
    },
    {
      why: "a body that isn't JSON",
      request: () => priceRequest(SOFT_REQUEST, { "Content-Type": "text/plain" }),
      status: 415,
    },
    { why: "malformed JSON", request: () => priceRequest("{"), status: 400 },
    { why: "an invalid request", request: () => priceRequest({ ...SOFT_REQUEST, itemId: "x" }), status: 400 },
    {
      why: "a product the user doesn't have",
      request: () => priceRequest({ ...SOFT_REQUEST, itemId: NOBODYS_ID }),
      status: 404,
    },
    {
      why: "an item the page no longer shows",
      request: () => priceRequest({ ...SOFT_REQUEST, shopItemId: "NV81063" }),
      status: 409,
    },
  ])("asks no shop for $why ($status)", async ({ request, status }) => {
    const { client, queries } = world(PRODUCT_RELATIONS, Object.values(RECORDINGS));

    const response = await postPrices(contextOf(request(), client));

    expect(response.status).toBe(status);
    expect(reservations(queries)).toEqual([]);
    expect(served()).toEqual([]);
  });

  it("asks no shop without a database (503)", async () => {
    world(PRODUCT_RELATIONS, Object.values(RECORDINGS));

    const response = await postPrices(contextOf(priceRequest(SOFT_REQUEST), null));

    expect(response.status).toBe(503);
    expect(served()).toEqual([]);
  });

  it("asks no shop when the product can't be read (503)", async () => {
    const failing = { ...PRODUCT_RELATIONS, watchlist_items: { error: { code: "57014", message: "timeout" } } };
    const { client, queries } = world(failing, Object.values(RECORDINGS));

    const response = await postPrices(contextOf(priceRequest(SOFT_REQUEST), client));

    expect(response.status).toBe(503);
    expect(reservations(queries)).toEqual([]);
    expect(served()).toEqual([]);
  });

  it("asks the shop exactly once for the item the page shows, and answers with its price", async () => {
    const { client, queries } = world(PRODUCT_RELATIONS, Object.values(RECORDINGS));

    const response = await postPrices(contextOf(priceRequest(SOFT_REQUEST), client));

    expect(response.status).toBe(200);
    // The offer natura-sku.json recorded for NV89063: 16,99 zł, regular 22,99 zł, 30-day low 17,99 zł.
    expect(await response.json()).toMatchObject({
      kind: "price",
      offer: { price: 16.99, regularPrice: 22.99, lowestPrice30d: 17.99 },
      saved: true,
    });
    expect(reservations(queries)).toEqual([{ p_shop_id: "natura" }]);
    expect(served()).toEqual([naturaPriceUrl(["NV89063"])]);
  });

  it("asks nothing of a stopped shop, and says so", async () => {
    const { client, queries } = world(PRODUCT_RELATIONS, Object.values(RECORDINGS), "stopped");

    const response = await postPrices(contextOf(priceRequest(SOFT_REQUEST), client));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: "unavailable" });
    expect(reservations(queries)).toEqual([{ p_shop_id: "natura" }]);
    expect(served()).toEqual([]);
  });

  it("asks nothing of a shop busy under the cap, and says so", async () => {
    const { client, queries } = world(PRODUCT_RELATIONS, Object.values(RECORDINGS), "capped");

    const response = await postPrices(contextOf(priceRequest(SOFT_REQUEST), client));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "unavailable", reason: "busy" });
    expect(reservations(queries)).toEqual([{ p_shop_id: "natura" }]);
    expect(served()).toEqual([]);
    expect(blockReports(queries)).toEqual([]);
  });

  it("reports a shop that answers 403, once", async () => {
    const { client, queries } = world(PRODUCT_RELATIONS, [{ ...RECORDINGS.soft, status: 403, body: "Forbidden" }]);

    const response = await postPrices(contextOf(priceRequest(SOFT_REQUEST), client));

    expect(await response.json()).toMatchObject({ kind: "unavailable" });
    expect(reservations(queries)).toEqual([{ p_shop_id: "natura" }]);
    expect(served()).toEqual([naturaPriceUrl(["NV89063"])]);
    expect(queries.filter(([[kind, name]]) => kind === "rpc" && name === "report_shop_block")).toHaveLength(1);
  });

  it("reports a shop that answers 429 once, with its delay, and says it's paused until then", async () => {
    const { client, queries } = world(PRODUCT_RELATIONS, [
      { ...RECORDINGS.soft, status: 429, headers: { "Retry-After": "120" }, body: "Too Many Requests" },
    ]);

    const response = await postPrices(contextOf(priceRequest(SOFT_REQUEST), client));

    expect(response.status).toBe(200);
    // Two minutes from now, the clock standing still.
    expect(await response.json()).toEqual({
      kind: "unavailable",
      reason: "paused",
      until: new Date(Date.parse(NOW) + 2 * MINUTE).toISOString(),
    });
    expect(reservations(queries)).toEqual([{ p_shop_id: "natura" }]);
    expect(served()).toEqual([naturaPriceUrl(["NV89063"])]);
    expect(blockReports(queries)).toEqual([
      { p_shop_id: "natura", p_kind: "rate_limited", p_retry_after_seconds: 120, p_detail: null },
    ]);
  });

  // The island of a product picked in Natura refetches its own Natura item and its Rossmann match, each through its own
  // shop's request: the offer natura-sku.json recorded for NV89063, and the regular 26,99 zł
  // rossmann-detail-regular.json recorded for 26900.
  it.each<{ shop: string; shopItemId: string; url: string; offer: object }>([
    {
      shop: "natura",
      shopItemId: "NV89063",
      url: naturaPriceUrl(["NV89063"]),
      offer: { price: 16.99, regularPrice: 22.99, lowestPrice30d: 17.99 },
    },
    {
      shop: "rossmann",
      shopItemId: "26900",
      url: detailUrl("26900"),
      offer: { price: 26.99, regularPrice: null, lowestPrice30d: null, available: true },
    },
  ])(
    "asks $shop exactly once for the item a product picked in Natura shows there, and answers with its price",
    async ({ shop, shopItemId, url, offer }) => {
      const { client, queries } = world(NATURA_PRODUCT_RELATIONS, Object.values(RECORDINGS));

      const response = await postPrices(contextOf(priceRequest({ itemId: PRODUCT_ID, shop, shopItemId }), client));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ kind: "price", offer, saved: true });
      expect(reservations(queries)).toEqual([{ p_shop_id: shop }]);
      expect(served()).toEqual([url]);
    },
  );

  it("asks no shop for the item of a match stored in the product's own shop, which its page never shows (409)", async () => {
    const { client, queries } = world(WITH_OWN_SHOP_MATCH, Object.values(RECORDINGS));

    const response = await postPrices(
      contextOf(priceRequest({ itemId: PRODUCT_ID, shop: "natura", shopItemId: "NV81063" }), client),
    );

    expect(response.status).toBe(409);
    expect(reservations(queries)).toEqual([]);
    expect(served()).toEqual([]);
  });
});

describe("/api/watchlist/refresh asks each shop only what is due", () => {
  it.each<{ why: string; fields: Record<string, string>; location: string }>([
    { why: "an id that isn't a UUID", fields: { itemId: "26900" }, location: "/watchlist" },
    { why: "a way back that isn't a product", fields: { back: "../admin" }, location: "/watchlist" },
    {
      why: "a product the user doesn't have",
      fields: { itemId: NOBODYS_ID },
      location: `/watchlist/${NOBODYS_ID}?prices=none`,
    },
  ])("asks no shop for $why", async ({ fields, location }) => {
    const { client, queries } = world(PRODUCT_RELATIONS, Object.values(RECORDINGS));

    const response = await postRefresh(contextOf(refreshRequest(fields), client));

    expect(response.headers.get("Location")).toBe(location);
    expect(reservations(queries)).toEqual([]);
    expect(served()).toEqual([]);
  });

  it("asks each of a product's shops once, whatever its prices' age", async () => {
    const { client, queries } = world(PRODUCT_RELATIONS, Object.values(RECORDINGS));

    const response = await postRefresh(contextOf(refreshRequest({ itemId: PRODUCT_ID }), client));

    // `done`: every shop answered from its recording and the answers were stored, so none was a request the replay
    // didn't know, Super-Pharm's body included.
    expect(response.headers.get("Location")).toBe(`/watchlist/${PRODUCT_ID}?prices=done`);
    expect(reservations(queries)).toHaveLength(4);
    expect(served().sort()).toEqual(
      [detailUrl("26900"), naturaPriceUrl(["NV89063"]), hebePriceUrl([HEBE_SOFT]), SUPER_PHARM_URL].sort(),
    );
    expect(bodiesSentTo(SUPER_PHARM_URL)).toEqual([superPharmPriceBody(["10132"])]);
  });

  it("asks only for the list's items checked more than 15 minutes ago, Rossmann's one by one, Natura's in one batch", async () => {
    // Three products: Nivea Soft and Felix, each matched in Natura and checked 20 minutes ago everywhere, and a third
    // checked 5 minutes ago everywhere, which nothing asks about.
    const list: Record<string, StubRelation> = {
      watchlist_items: [
        productRow(PRODUCT_ID, "26900"),
        productRow(OTHER_ID, "131225", "2026-09-26T12:00:00+00:00"),
        productRow(FRESH_ID, "88001", "2026-09-25T12:00:00+00:00"),
      ],
      watchlist_matches: [
        matchRow(PRODUCT_ID, "natura", "NV89063"),
        matchRow(OTHER_ID, "natura", "NV81063"),
        matchRow(FRESH_ID, "natura", "NV00003"),
      ],
      latest_price_observations: [
        latestRow("rossmann", "26900", 20 * MINUTE),
        latestRow("rossmann", "131225", 20 * MINUTE),
        latestRow("rossmann", "88001", 5 * MINUTE),
        latestRow("natura", "NV89063", 20 * MINUTE),
        latestRow("natura", "NV81063", 20 * MINUTE),
        latestRow("natura", "NV00003", 5 * MINUTE),
      ],
      price_observations: [],
    };
    const { client, queries } = world(list, Object.values(RECORDINGS));

    const response = await postRefresh(contextOf(refreshRequest({}), client));

    expect(response.headers.get("Location")).toBe("/watchlist?list-prices=done");
    expect(reservations(queries)).toHaveLength(3);
    expect(served().sort()).toEqual(
      [detailUrl("26900"), detailUrl("131225"), naturaPriceUrl(["NV89063", "NV81063"])].sort(),
    );
  });

  it("asks each shop of a product picked in Natura once: its own item, its Rossmann match and the other two", async () => {
    // A match stored in Natura, its own shop, adds no item: Natura is asked for the product's own item alone.
    const { client, queries } = world(WITH_OWN_SHOP_MATCH, Object.values(RECORDINGS));

    const response = await postRefresh(contextOf(refreshRequest({ itemId: PRODUCT_ID }), client));

    expect(response.headers.get("Location")).toBe(`/watchlist/${PRODUCT_ID}?prices=done`);
    expect(reservations(queries)).toHaveLength(4);
    expect(served().sort()).toEqual(
      [detailUrl("26900"), naturaPriceUrl(["NV89063"]), hebePriceUrl([HEBE_SOFT]), SUPER_PHARM_URL].sort(),
    );
    expect(bodiesSentTo(SUPER_PHARM_URL)).toEqual([superPharmPriceBody(["10132"])]);
  });

  it("asks for a product picked in Natura's stale own item in Natura's batch, and its Rossmann match one by one", async () => {
    // Nivea Soft picked in Rossmann and matched to Natura's NV81063, both checked 20 minutes ago, and Nivea Soft picked
    // in Natura (NV89063), matched to Rossmann's 131225, both checked 30 minutes ago. The latter's match stored in
    // Natura, its own shop, is no item of its.
    const list: Record<string, StubRelation> = {
      watchlist_items: [
        productRow(PRODUCT_ID, "26900"),
        naturaProductRow(OTHER_ID, "NV89063", "2026-09-26T12:00:00+00:00"),
      ],
      watchlist_matches: [
        matchRow(PRODUCT_ID, "natura", "NV81063"),
        matchRow(OTHER_ID, "rossmann", "131225"),
        matchRow(OTHER_ID, "natura", "NV00003"),
      ],
      latest_price_observations: [
        latestRow("rossmann", "26900", 20 * MINUTE),
        latestRow("natura", "NV81063", 20 * MINUTE),
        latestRow("natura", "NV89063", 30 * MINUTE),
        latestRow("rossmann", "131225", 30 * MINUTE),
        latestRow("natura", "NV00003", 30 * MINUTE),
      ],
      price_observations: [],
    };
    const { client, queries } = world(list, Object.values(RECORDINGS));

    const response = await postRefresh(contextOf(refreshRequest({}), client));

    // Natura's two items in one request, the older check first, as natura-skus.json was recorded.
    expect(response.headers.get("Location")).toBe("/watchlist?list-prices=done");
    expect(reservations(queries)).toHaveLength(3);
    expect(served().sort()).toEqual(
      [detailUrl("131225"), detailUrl("26900"), naturaPriceUrl(["NV89063", "NV81063"])].sort(),
    );
  });

  it("asks a shop nothing more once it answered 403", async () => {
    // Both Rossmann prices are due, and Rossmann refuses the first request.
    const list: Record<string, StubRelation> = {
      watchlist_items: [productRow(PRODUCT_ID, "26900"), productRow(OTHER_ID, "131225", "2026-09-26T12:00:00+00:00")],
      watchlist_matches: [],
      latest_price_observations: [
        latestRow("rossmann", "26900", 20 * MINUTE),
        latestRow("rossmann", "131225", 20 * MINUTE),
      ],
      price_observations: [],
    };
    const refused = [RECORDINGS.nivea, RECORDINGS.felix].map((entry) => ({ ...entry, status: 403, body: "Forbidden" }));
    const { client, queries } = world(list, refused);

    await postRefresh(contextOf(refreshRequest({}), client));

    expect(reservations(queries)).toEqual([{ p_shop_id: "rossmann" }]);
    expect(served()).toHaveLength(1);
    expect(queries.filter(([[kind, name]]) => kind === "rpc" && name === "report_shop_block")).toHaveLength(1);
  });
});
