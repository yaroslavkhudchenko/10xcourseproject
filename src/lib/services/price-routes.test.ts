import type { SupabaseClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { stubSupabase, type StubRelation } from "@/lib/services/testing/stub-supabase";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
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
// stopped shop is asked nothing; a 403 stops the shop and nothing more is asked of it), never read off the routes.

const APP = "https://drogeria.example";
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

/** A watched product of Rossmann's `sourceItemId`, as watchlist_items holds it. */
function productRow(id: string, sourceItemId: string, createdAt = "2026-09-27T12:00:00+00:00") {
  return {
    id,
    source: "rossmann",
    source_item_id: sourceItemId,
    brand: "NIVEA",
    name: `Produkt ${sourceItemId}`,
    caption: null,
    size_text: "300 ml",
    size_value: 300,
    size_unit: "ml",
    eans: [],
    product_url: null,
    image_url: null,
    created_at: createdAt,
  };
}

/** A product's match in a matched shop, as watchlist_matches holds it. */
function matchRow(itemId: string, shop: string, shopItemId: string) {
  return {
    watchlist_item_id: itemId,
    shop_id: shop,
    state: "matched",
    decided_by: "user",
    shop_item_id: shopItemId,
    name: `Produkt ${shopItemId}`,
    brand: "NIVEA",
    size_text: "300 ml",
    size_value: 300,
    size_unit: "ml",
    eans: [],
    product_url: null,
    image_url: null,
    checked_at: "2026-09-27T12:05:00+00:00",
  };
}

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

/** A route's context, as Astro hands it over: the request, its URL, the request's Supabase client and `redirect`. */
function contextOf(request: Request, supabase: SupabaseClient | null): APIContext {
  return {
    request,
    url: new URL(request.url),
    locals: { supabase, user: null },
    redirect: (path: string, status = 302) => new Response(null, { status, headers: { Location: path } }),
  } as unknown as APIContext;
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
function refreshRequest(fields: Record<string, string>): Request {
  return new Request(`${APP}/api/watchlist/refresh`, {
    method: "POST",
    headers: { Origin: APP, "Sec-Fetch-Site": "same-origin" },
    body: new URLSearchParams(fields),
  });
}

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

  it("reports a shop that answers 403, once", async () => {
    const { client, queries } = world(PRODUCT_RELATIONS, [{ ...RECORDINGS.soft, status: 403, body: "Forbidden" }]);

    const response = await postPrices(contextOf(priceRequest(SOFT_REQUEST), client));

    expect(await response.json()).toMatchObject({ kind: "unavailable" });
    expect(reservations(queries)).toEqual([{ p_shop_id: "natura" }]);
    expect(served()).toEqual([naturaPriceUrl(["NV89063"])]);
    expect(queries.filter(([[kind, name]]) => kind === "rpc" && name === "report_shop_block")).toHaveLength(1);
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
