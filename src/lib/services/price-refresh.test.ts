import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { LIST_PRICES_PARAM, NOTICE_PARAMS, PRICES_PARAM } from "@/lib/notices";
import { keyText, type KnownShop } from "@/lib/services/price-comparison";
import {
  listRefreshBackOf,
  listRefreshBackTo,
  parsePriceRefreshCode,
  PRICE_REFRESH_CODES,
  productRefreshBackTo,
  refreshCodeOf,
  refreshPrices,
  type ListRefreshBack,
  type PriceRefresh,
  type PriceRefreshCode,
} from "@/lib/services/price-refresh";
import { createShopGate } from "@/lib/services/shop-gate";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import type { ListFilter } from "@/lib/services/watchlist-rows";
import type { PriceCheck, PriceKey, ShopId, ShopOffer } from "@/types";
import hebeIdUnknown from "@/lib/services/shops/fixtures/hebe-id-unknown.json";
import hebeIds from "@/lib/services/shops/fixtures/hebe-ids.json";
import skuUnknown from "@/lib/services/shops/fixtures/natura-sku-unknown.json";
import oneSku from "@/lib/services/shops/fixtures/natura-sku.json";
import twoSkus from "@/lib/services/shops/fixtures/natura-skus.json";
import reduced from "@/lib/services/shops/fixtures/rossmann-detail-reduced.json";
import regular from "@/lib/services/shops/fixtures/rossmann-detail-regular.json";
import unknownProduct from "@/lib/services/shops/fixtures/rossmann-detail-unknown.json";

// The shops answer with their real recordings, through the real gate; no test reaches a live shop.
const detailUrl = (id: string) => `https://www.rossmann.pl/products/v2/api/Products/${id}?shopNumber=null`;
// Natura's price request, spelled out as the natura-sku*.json recordings were made: one repeated f[] per SKU.
const naturaPriceUrl = (skus: string[]) =>
  "https://live.luigisbox.com/search?tracker_id=703598-939363&f%5B%5D=type%3Aproduct" +
  skus.map((sku) => `&f%5B%5D=sku%3A${sku}`).join("") +
  `&size=${skus.length}&hit_fields=sku%2Cprice_amount%2Cprice_old_amount%2Clowest_price%2Cavailability`;
// Hebe's price request, spelled out as its adapter sends it: items only, one repeated f[] per id, and only the price
// attributes. hebe-ids.json was recorded with a longer hit_fields list (hebe.test.ts), which only adds attributes.
const hebePriceUrl = (ids: string[]) =>
  "https://live.luigisbox.com/search?tracker_id=421168-505233&f%5B%5D=type%3Aitem" +
  ids.map((id) => `&f%5B%5D=ID%3A${id}`).join("") +
  `&size=${ids.length}&hit_fields=price_amount%2Cprice_sale_amount%2Cprice_omnibus_amount%2Conline_flag`;

// Rossmann's Felix on promotion, Nivea Soft at its regular price, and an id Rossmann doesn't have; Natura's Nivea Soft
// on promotion, Nivea MEN, and a SKU Natura doesn't have; and Hebe's Nivea Soft 200 ml.
const FELIX: PriceKey = { shop: "rossmann", shopItemId: "131225" };
const NIVEA: PriceKey = { shop: "rossmann", shopItemId: "26900" };
const GONE: PriceKey = { shop: "rossmann", shopItemId: "999999999" };
const SOFT: PriceKey = { shop: "natura", shopItemId: "NV89063" };
const MEN: PriceKey = { shop: "natura", shopItemId: "NV81063" };
const UNKNOWN_SKU: PriceKey = { shop: "natura", shopItemId: "ZZ00000000" };
const HEBE_SOFT: PriceKey = { shop: "hebe", shopItemId: "000000000000218807" };

const answers = {
  felix: { url: detailUrl("131225"), status: 200, body: JSON.stringify(reduced) },
  nivea: { url: detailUrl("26900"), status: 200, body: JSON.stringify(regular) },
  gone: {
    url: detailUrl("999999999"),
    status: unknownProduct.status,
    headers: { "Content-Type": unknownProduct.contentType },
    body: unknownProduct.body,
  },
  soft: { url: naturaPriceUrl(["NV89063"]), status: 200, body: JSON.stringify(oneSku) },
  softAndMen: { url: naturaPriceUrl(["NV89063", "NV81063"]), status: 200, body: JSON.stringify(twoSkus) },
  unknownSku: { url: naturaPriceUrl(["ZZ00000000"]), status: 200, body: JSON.stringify(skuUnknown) },
  hebeSoft: { url: hebePriceUrl([HEBE_SOFT.shopItemId]), status: 200, body: JSON.stringify(hebeIds) },
} satisfies Record<string, ReplayEntry>;

// The offers the recordings carry.
const felixOffer: ShopOffer = {
  price: 5.99,
  regularPrice: 9.99,
  lowestPrice30d: 6.39,
  promoEndsOn: "2026-09-30",
  available: true,
};
const niveaOffer: ShopOffer = {
  price: 26.99,
  regularPrice: null,
  lowestPrice30d: null,
  promoEndsOn: null,
  available: true,
};
const softOffer: ShopOffer = {
  price: 16.99,
  regularPrice: 22.99,
  lowestPrice30d: 17.99,
  promoEndsOn: null,
  available: true,
};
const menOffer: ShopOffer = {
  price: 17.99,
  regularPrice: null,
  lowestPrice30d: 10.99,
  promoEndsOn: null,
  available: true,
};
const hebeSoftOffer: ShopOffer = {
  price: 15.99,
  regularPrice: null,
  lowestPrice30d: 10.89,
  promoEndsOn: null,
  available: true,
};
const FAILED: PriceCheck = { kind: "unavailable", reason: "failed" };
const BUSY: PriceCheck = { kind: "unavailable", reason: "busy" };
const STOPPED: PriceCheck = { kind: "unavailable", reason: "stopped" };
const PAUSE_END = "2026-09-28T12:15:00.000Z";

/** The URL a fetch was asked for. */
function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : new URL(input).href;
}

// Natura and Hebe share Luigi's Box's host, so a request says which of them it asks by its tracker.
const TRACKER_SHOPS = new Map<string, KnownShop>([
  ["703598-939363", "natura"],
  ["421168-505233", "hebe"],
]);

/** The shop a request asks: Rossmann by its host, and Natura or Hebe by their trackers. */
function shopOf(url: string): KnownShop {
  const { host, searchParams } = new URL(url);
  const shop = host === "www.rossmann.pl" ? "rossmann" : TRACKER_SHOPS.get(searchParams.get("tracker_id") ?? "");
  if (shop === undefined) {
    throw new Error(`No shop asked by ${url}`);
  }
  return shop;
}

/**
 * A real gate over `fetchMock`; `reserve` answers each reservation. Every reservation is recorded by shop, so a test
 * sees which shops' slots were asked for.
 */
function gateOver(fetchMock: typeof fetch, reserve: (shop: ShopId) => unknown = () => ({ outcome: "allowed" })) {
  const reservations: ShopId[] = [];
  const gate = createShopGate({
    reserve: (shop) => {
      reservations.push(shop);
      return Promise.resolve(reserve(shop));
    },
    reportBlock: () => Promise.resolve(),
    fetch: fetchMock,
    log: () => undefined,
  });
  return { gate, reservations };
}

/** A real gate over a fetch that answers only the given recordings; `reserve` answers each reservation. */
function setup(entries: ReplayEntry[], reserve?: (shop: ShopId) => unknown) {
  const fetchMock = vi.fn(createReplayFetch(entries));
  return { ...gateOver(fetchMock, reserve), fetchMock };
}

/**
 * A fetch that serves the given recordings a moment after each request, so requests sent together would overlap, and
 * keeps the most requests in flight at once, in all and to each shop.
 */
function slowReplay(entries: ReplayEntry[]) {
  const replay = createReplayFetch(entries);
  const inFlight: KnownShop[] = [];
  const most: Record<"all" | KnownShop, number> = { all: 0, rossmann: 0, natura: 0, hebe: 0 };
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const shop = shopOf(urlOf(input));
    inFlight.push(shop);
    most.all = Math.max(most.all, inFlight.length);
    most[shop] = Math.max(most[shop], inFlight.filter((entry) => entry === shop).length);
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return await replay(input, init);
    } finally {
      inFlight.splice(inFlight.indexOf(shop), 1);
    }
  });
  return { fetchMock, most };
}

/** Every URL the fetch was asked for: a miss would look like a network failure, so each test checks its requests. */
function requestedUrls(fetchMock: Mock<typeof fetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => urlOf(input));
}

/** The URLs one shop was asked for, in the order it was asked. */
function urlsTo(fetchMock: Mock<typeof fetch>, shop: KnownShop): string[] {
  return requestedUrls(fetchMock).filter((url) => shopOf(url) === shop);
}

/** One builder call a query made, such as `["insert", rows]`. */
type Call = [method: string, ...args: unknown[]];

interface QueryStub {
  insert: (rows: unknown) => QueryStub;
  abortSignal: (signal: AbortSignal) => Promise<{ data: null; error: { code: string; message: string } | null }>;
}

const RLS_REFUSAL = { code: "42501", message: "new row violates row-level security policy" };

/**
 * A client whose inserts succeed, except those carrying rows of the `failing` shops, which RLS refuses. Every builder
 * call is recorded, so a test sees each query's table, rows and time limit: a query ends with `["abortSignal", true]`
 * when it was given an AbortSignal.
 */
function stubClient(failing: ShopId[] = []) {
  const queries: Call[][] = [];
  const from = (table: string): QueryStub => {
    const calls: Call[] = [["from", table]];
    queries.push(calls);
    let refused = false;
    const query: QueryStub = {
      insert: (rows) => {
        calls.push(["insert", rows]);
        refused = (rows as { shop_id: ShopId }[]).some((row) => failing.includes(row.shop_id));
        return query;
      },
      abortSignal: (signal) => {
        calls.push(["abortSignal", signal instanceof AbortSignal]);
        return Promise.resolve({ data: null, error: refused ? RLS_REFUSAL : null });
      },
    };
    return query;
  };
  return { client: { from } as unknown as SupabaseClient, queries };
}

/** The row a price adds: what the check found, and nothing the database sets itself. */
const priceRow = ({ shop, shopItemId }: PriceKey, offer: ShopOffer) => ({
  shop_id: shop,
  shop_item_id: shopItemId,
  status: "price",
  price: offer.price,
  regular_price: offer.regularPrice,
  lowest_price_30d: offer.lowestPrice30d,
  promo_ends_on: offer.promoEndsOn,
  available: offer.available,
});
const missingRow = ({ shop, shopItemId }: PriceKey) => ({
  shop_id: shop,
  shop_item_id: shopItemId,
  status: "missing",
  price: null,
  regular_price: null,
  lowest_price_30d: null,
  promo_ends_on: null,
  available: null,
});

/** The insert that stores one shop's checks, with the given rows. */
const insertOf = (rows: unknown[]): Call[] => [
  ["from", "price_observations"],
  ["insert", rows],
  ["abortSignal", true],
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refreshPrices: fetching", () => {
  it("fetches Rossmann per product and Natura's SKUs in one request, and stores each shop's checks on its own", async () => {
    const { gate, fetchMock } = setup([answers.felix, answers.nivea, answers.softAndMen]);
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, [FELIX, SOFT, NIVEA, MEN]);

    expect(requestedUrls(fetchMock)).toHaveLength(3);
    expect(new Set(requestedUrls(fetchMock))).toEqual(
      new Set([answers.felix.url, answers.nivea.url, answers.softAndMen.url]),
    );
    // Rossmann's products are asked for in the order given.
    expect(requestedUrls(fetchMock).filter((url) => url.startsWith("https://www.rossmann.pl/"))).toEqual([
      answers.felix.url,
      answers.nivea.url,
    ]);
    expect(refresh).toEqual({
      results: [
        { key: FELIX, check: { kind: "price", offer: felixOffer } },
        { key: SOFT, check: { kind: "price", offer: softOffer } },
        { key: NIVEA, check: { kind: "price", offer: niveaOffer } },
        { key: MEN, check: { kind: "price", offer: menOffer } },
      ],
      saved: "saved",
    });
    // One insert per shop, whichever shop is done first.
    expect(queries).toHaveLength(2);
    expect(queries).toEqual(
      expect.arrayContaining([
        insertOf([priceRow(FELIX, felixOffer), priceRow(NIVEA, niveaOffer)]),
        insertOf([priceRow(SOFT, softOffer), priceRow(MEN, menOffer)]),
      ]),
    );
  });

  it("checks each item once, however often it's given", async () => {
    const { gate, fetchMock } = setup([answers.nivea, answers.soft]);
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, [NIVEA, SOFT, NIVEA, SOFT]);

    expect(requestedUrls(fetchMock)).toHaveLength(2);
    expect(new Set(requestedUrls(fetchMock))).toEqual(new Set([answers.nivea.url, answers.soft.url]));
    expect(refresh.results).toEqual([
      { key: NIVEA, check: { kind: "price", offer: niveaOffer } },
      { key: SOFT, check: { kind: "price", offer: softOffer } },
    ]);
    expect(queries).toHaveLength(2);
    expect(queries).toEqual(
      expect.arrayContaining([insertOf([priceRow(NIVEA, niveaOffer)]), insertOf([priceRow(SOFT, softOffer)])]),
    );
  });

  it("asks Rossmann one product at a time in the order given, with Natura's request alongside", async () => {
    const { fetchMock, most } = slowReplay([answers.gone, answers.felix, answers.nivea, answers.soft]);
    const { gate } = gateOver(fetchMock);
    const { client } = stubClient();

    const refresh = await refreshPrices(gate, client, [GONE, FELIX, SOFT, NIVEA]);

    expect(requestedUrls(fetchMock).filter((url) => url.startsWith("https://www.rossmann.pl/"))).toEqual([
      answers.gone.url,
      answers.felix.url,
      answers.nivea.url,
    ]);
    expect(requestedUrls(fetchMock)).toContain(answers.soft.url);
    expect(most.rossmann).toBe(1);
    expect(most.all).toBe(2);
    expect(refresh.results.map(({ key, check }) => [key.shopItemId, check.kind])).toEqual([
      ["999999999", "missing"],
      ["131225", "price"],
      ["NV89063", "price"],
      ["26900", "price"],
    ]);
  });
});

describe("refreshPrices: when Rossmann refuses", () => {
  it.each<{ refusal: string; reservation: unknown; check: PriceCheck }>([
    { refusal: "busy under the cap", reservation: { outcome: "capped" }, check: BUSY },
    {
      refusal: "paused",
      reservation: { outcome: "paused", until: PAUSE_END },
      check: { kind: "unavailable", reason: "paused", until: PAUSE_END },
    },
  ])(
    "stops once Rossmann is $refusal: the products after it get the same answer, unasked",
    async ({ reservation, check }) => {
      // The cap leaves room for two more Rossmann requests; the third reservation is refused.
      let allowed = 2;
      const { gate, fetchMock, reservations } = setup([answers.felix, answers.nivea, answers.gone], () => {
        allowed -= 1;
        return allowed >= 0 ? { outcome: "allowed" } : reservation;
      });
      const { client, queries } = stubClient();
      const other: PriceKey = { shop: "rossmann", shopItemId: "11790" };

      const refresh = await refreshPrices(gate, client, [FELIX, NIVEA, GONE, other]);

      // The fourth product is neither reserved nor asked for.
      expect(reservations).toEqual(["rossmann", "rossmann", "rossmann"]);
      expect(requestedUrls(fetchMock)).toEqual([answers.felix.url, answers.nivea.url]);
      expect(refresh.results).toEqual([
        { key: FELIX, check: { kind: "price", offer: felixOffer } },
        { key: NIVEA, check: { kind: "price", offer: niveaOffer } },
        { key: GONE, check },
        { key: other, check },
      ]);
      // The products Rossmann didn't answer for store nothing, so they keep their last price.
      expect(queries).toEqual([insertOf([priceRow(FELIX, felixOffer), priceRow(NIVEA, niveaOffer)])]);
    },
  );

  it("stops once Rossmann answers 403: the products after it are stopped too, unasked and unreserved", async () => {
    const { gate, fetchMock, reservations } = setup([
      answers.felix,
      { url: answers.nivea.url, status: 403 },
      answers.gone,
    ]);
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, [FELIX, NIVEA, GONE]);

    expect(reservations).toEqual(["rossmann", "rossmann"]);
    expect(requestedUrls(fetchMock)).toEqual([answers.felix.url, answers.nivea.url]);
    expect(refresh.results).toEqual([
      { key: FELIX, check: { kind: "price", offer: felixOffer } },
      { key: NIVEA, check: STOPPED },
      { key: GONE, check: STOPPED },
    ]);
    expect(queries).toEqual([insertOf([priceRow(FELIX, felixOffer)])]);
  });

  it.each<{ failure: string; answer: ReplayEntry }>([
    { failure: "an error status", answer: { url: answers.nivea.url, status: 500 } },
    { failure: "a network error", answer: { url: answers.nivea.url, error: "network" } },
    { failure: "an answer it can't read", answer: { url: answers.nivea.url, status: 200, body: "Przerwa techniczna" } },
  ])("goes on to the next product after $failure", async ({ answer }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([answer, answers.felix]);
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, [NIVEA, FELIX]);

    expect(requestedUrls(fetchMock)).toEqual([answers.nivea.url, answers.felix.url]);
    expect(refresh.results).toEqual([
      { key: NIVEA, check: FAILED },
      { key: FELIX, check: { kind: "price", offer: felixOffer } },
    ]);
    expect(queries).toEqual([insertOf([priceRow(FELIX, felixOffer)])]);
  });
});

describe("refreshPrices: storing", () => {
  it("stores only the prices and missing items, each shop's with an insert of its own", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([answers.felix, answers.gone, answers.unknownSku]);
    const { client, queries } = stubClient();
    // A stored id that isn't Rossmann's, and a shop whose prices aren't fetched.
    const odd: PriceKey = { shop: "rossmann", shopItemId: ".." };
    const superPharm: PriceKey = { shop: "super-pharm", shopItemId: "39477" };

    const refresh = await refreshPrices(gate, client, [FELIX, odd, GONE, superPharm, UNKNOWN_SKU]);

    expect(requestedUrls(fetchMock)).toHaveLength(3);
    expect(new Set(requestedUrls(fetchMock))).toEqual(
      new Set([answers.felix.url, answers.gone.url, answers.unknownSku.url]),
    );
    expect(refresh).toEqual({
      results: [
        { key: FELIX, check: { kind: "price", offer: felixOffer } },
        { key: odd, check: FAILED },
        { key: GONE, check: { kind: "missing" } },
        { key: superPharm, check: FAILED },
        { key: UNKNOWN_SKU, check: { kind: "missing" } },
      ],
      saved: "saved",
    });
    expect(queries).toHaveLength(2);
    expect(queries).toEqual(
      expect.arrayContaining([
        insertOf([priceRow(FELIX, felixOffer), missingRow(GONE)]),
        insertOf([missingRow(UNKNOWN_SKU)]),
      ]),
    );
  });

  it("stores Rossmann's checks as soon as Rossmann is done, while Natura is still answering", async () => {
    // Natura's request waits until the test answers it.
    const replay = createReplayFetch([answers.felix]);
    const pending: ((response: Response) => void)[] = [];
    const fetchMock = vi.fn<typeof fetch>((input, init) =>
      urlOf(input) === answers.soft.url
        ? new Promise<Response>((resolve) => {
            pending.push(resolve);
          })
        : replay(input, init),
    );
    const { gate } = gateOver(fetchMock);
    const { client, queries } = stubClient();

    const refresh = refreshPrices(gate, client, [FELIX, SOFT]);

    await vi.waitFor(() => {
      expect(pending).toHaveLength(1);
      expect(queries).toEqual([insertOf([priceRow(FELIX, felixOffer)])]);
    });
    pending[0](new Response(JSON.stringify(oneSku), { status: 200 }));

    expect((await refresh).saved).toBe("saved");
    expect(queries).toEqual([insertOf([priceRow(FELIX, felixOffer)]), insertOf([priceRow(SOFT, softOffer)])]);
  });

  it("sends no insert when no shop answered", async () => {
    const { gate, fetchMock } = setup([answers.nivea, answers.soft], () => ({ outcome: "capped" }));
    const { client, queries } = stubClient();

    expect(await refreshPrices(gate, client, [NIVEA, SOFT])).toEqual({
      results: [
        { key: NIVEA, check: BUSY },
        { key: SOFT, check: BUSY },
      ],
      saved: "none",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it("asks no shop and stores nothing for no items", async () => {
    const { gate, fetchMock } = setup([]);
    const { client, queries } = stubClient();

    expect(await refreshPrices(gate, client, [])).toEqual({ results: [], saved: "none" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it("says when the insert failed, and still gives every check", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate } = setup([answers.nivea]);
    const { client, queries } = stubClient(["rossmann"]);

    expect(await refreshPrices(gate, client, [NIVEA])).toEqual({
      results: [{ key: NIVEA, check: { kind: "price", offer: niveaOffer } }],
      saved: "failed",
    });
    expect(queries).toEqual([insertOf([priceRow(NIVEA, niveaOffer)])]);
  });

  it("says storing failed when one shop's insert failed, though the other shop's was stored", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate } = setup([answers.felix, answers.soft]);
    const { client, queries } = stubClient(["natura"]);

    expect(await refreshPrices(gate, client, [FELIX, SOFT])).toEqual({
      results: [
        { key: FELIX, check: { kind: "price", offer: felixOffer } },
        { key: SOFT, check: { kind: "price", offer: softOffer } },
      ],
      saved: "failed",
    });
    expect(queries).toHaveLength(2);
    expect(queries).toEqual(
      expect.arrayContaining([insertOf([priceRow(FELIX, felixOffer)]), insertOf([priceRow(SOFT, softOffer)])]),
    );
  });

  it("says saved when one shop's checks were stored and the other shop had none to store", async () => {
    const { gate } = setup([answers.soft], (shop) => ({ outcome: shop === "rossmann" ? "capped" : "allowed" }));
    const { client, queries } = stubClient();

    expect(await refreshPrices(gate, client, [NIVEA, SOFT])).toEqual({
      results: [
        { key: NIVEA, check: BUSY },
        { key: SOFT, check: { kind: "price", offer: softOffer } },
      ],
      saved: "saved",
    });
    expect(queries).toEqual([insertOf([priceRow(SOFT, softOffer)])]);
  });
});

describe("refreshPrices: every priced shop, Hebe's too", () => {
  // Two requests' worth in each matched shop: Nivea Soft, which each shop's first recorded answer holds, then 50 ids the
  // shop answers without.
  const naturaSkus = [SOFT.shopItemId, ...Array.from({ length: 50 }, (_, i) => `ZZ${String(i).padStart(8, "0")}`)];
  const hebeItemIds = [
    HEBE_SOFT.shopItemId,
    ...Array.from({ length: 50 }, (_, i) => `99${String(i).padStart(16, "0")}`),
  ];
  const naturaBatches = [naturaSkus.slice(0, 50), naturaSkus.slice(50)].map(naturaPriceUrl);
  const hebeBatches = [hebeItemIds.slice(0, 50), hebeItemIds.slice(50)].map(hebePriceUrl);
  // Each request's recorded answer: Nivea Soft alone in each shop's first, nothing in its second.
  const naturaAnswers: ReplayEntry[] = [
    { url: naturaBatches[0], status: 200, body: JSON.stringify(oneSku) },
    { url: naturaBatches[1], status: 200, body: JSON.stringify(skuUnknown) },
  ];
  const hebeAnswers: ReplayEntry[] = [
    { url: hebeBatches[0], status: 200, body: JSON.stringify(hebeIds) },
    { url: hebeBatches[1], status: 200, body: JSON.stringify(hebeIdUnknown) },
  ];
  const keysIn = (shop: ShopId, ids: string[]): PriceKey[] => ids.map((shopItemId) => ({ shop, shopItemId }));
  const naturaKeys = keysIn("natura", naturaSkus);
  const hebeKeys = keysIn("hebe", hebeItemIds);
  // Rossmann's two products, then every Natura and Hebe item.
  const targets = [FELIX, NIVEA, ...naturaKeys, ...hebeKeys];
  // The offers the recordings carry; every other item is one its shop answered without.
  const offers = new Map([
    [keyText(FELIX), felixOffer],
    [keyText(NIVEA), niveaOffer],
    [keyText(SOFT), softOffer],
    [keyText(HEBE_SOFT), hebeSoftOffer],
  ]);
  /** An item's check once its shop has answered: its recorded offer, or missing. */
  const answered = (key: PriceKey): PriceCheck => {
    const offer = offers.get(keyText(key));
    return offer === undefined ? { kind: "missing" } : { kind: "price", offer };
  };
  /** The rows one shop's insert stores for its items, once the shop has answered. */
  const rowsOf = (keys: PriceKey[]) =>
    keys.map((key) => {
      const offer = offers.get(keyText(key));
      return offer === undefined ? missingRow(key) : priceRow(key, offer);
    });

  it("asks Rossmann, Natura and Hebe at once, and stores each shop's checks with an insert of its own", async () => {
    const { fetchMock, most } = slowReplay([answers.felix, answers.soft, answers.hebeSoft]);
    const { gate } = gateOver(fetchMock);
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, [FELIX, SOFT, HEBE_SOFT]);

    expect(requestedUrls(fetchMock)).toHaveLength(3);
    expect(new Set(requestedUrls(fetchMock))).toEqual(
      new Set([answers.felix.url, answers.soft.url, answers.hebeSoft.url]),
    );
    // The three shops' requests were in flight together.
    expect(most.all).toBe(3);
    expect(refresh).toEqual({
      results: [
        { key: FELIX, check: { kind: "price", offer: felixOffer } },
        { key: SOFT, check: { kind: "price", offer: softOffer } },
        { key: HEBE_SOFT, check: { kind: "price", offer: hebeSoftOffer } },
      ],
      saved: "saved",
    });
    expect(queries).toHaveLength(3);
    expect(queries).toEqual(
      expect.arrayContaining([
        insertOf([priceRow(FELIX, felixOffer)]),
        insertOf([priceRow(SOFT, softOffer)]),
        insertOf([priceRow(HEBE_SOFT, hebeSoftOffer)]),
      ]),
    );
  });

  it("asks each shop one request at a time, in the order given, while the shops' requests overlap", async () => {
    const { fetchMock, most } = slowReplay([answers.felix, answers.nivea, ...naturaAnswers, ...hebeAnswers]);
    const { gate } = gateOver(fetchMock);
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, targets);

    expect(urlsTo(fetchMock, "rossmann")).toEqual([answers.felix.url, answers.nivea.url]);
    expect(urlsTo(fetchMock, "natura")).toEqual(naturaBatches);
    expect(urlsTo(fetchMock, "hebe")).toEqual(hebeBatches);
    // Never two requests to one shop at once, and the three shops' requests in flight together.
    expect(most).toEqual({ all: 3, rossmann: 1, natura: 1, hebe: 1 });
    expect(refresh).toEqual({ results: targets.map((key) => ({ key, check: answered(key) })), saved: "saved" });
    expect(queries).toHaveLength(3);
    expect(queries).toEqual(
      expect.arrayContaining([
        insertOf(rowsOf([FELIX, NIVEA])),
        insertOf(rowsOf(naturaKeys)),
        insertOf(rowsOf(hebeKeys)),
      ]),
    );
  });

  it("stops only Hebe once it answers 403: its later ids are neither reserved nor asked, and the other shops go on", async () => {
    const { gate, fetchMock, reservations } = setup([
      answers.felix,
      answers.nivea,
      ...naturaAnswers,
      // Served before the recorded answer for the same request.
      { url: hebeBatches[0], status: 403 },
      ...hebeAnswers,
    ]);
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, targets);

    expect(urlsTo(fetchMock, "hebe")).toEqual([hebeBatches[0]]);
    expect(reservations.filter((shop) => shop === "hebe")).toHaveLength(1);
    expect(urlsTo(fetchMock, "rossmann")).toEqual([answers.felix.url, answers.nivea.url]);
    expect(urlsTo(fetchMock, "natura")).toEqual(naturaBatches);
    expect(refresh.results).toEqual(
      targets.map((key) => ({ key, check: key.shop === "hebe" ? STOPPED : answered(key) })),
    );
    // Hebe's items store nothing, so they keep their last prices.
    expect(queries).toHaveLength(2);
    expect(queries).toEqual(expect.arrayContaining([insertOf(rowsOf([FELIX, NIVEA])), insertOf(rowsOf(naturaKeys))]));
  });

  it("stops only Natura while it's busy under the cap: Rossmann and Hebe are asked as usual", async () => {
    const { gate, fetchMock, reservations } = setup(
      [answers.felix, answers.nivea, ...naturaAnswers, ...hebeAnswers],
      (shop) => ({ outcome: shop === "natura" ? "capped" : "allowed" }),
    );
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, targets);

    // Natura's second request isn't even reserved.
    expect(urlsTo(fetchMock, "natura")).toEqual([]);
    expect(reservations.filter((shop) => shop === "natura")).toHaveLength(1);
    expect(urlsTo(fetchMock, "rossmann")).toEqual([answers.felix.url, answers.nivea.url]);
    expect(urlsTo(fetchMock, "hebe")).toEqual(hebeBatches);
    expect(refresh.results).toEqual(
      targets.map((key) => ({ key, check: key.shop === "natura" ? BUSY : answered(key) })),
    );
    expect(queries).toHaveLength(2);
    expect(queries).toEqual(expect.arrayContaining([insertOf(rowsOf([FELIX, NIVEA])), insertOf(rowsOf(hebeKeys))]));
  });

  it("leaves the items of a shop outside the list unavailable, and asks that shop nothing", async () => {
    const { gate, fetchMock, reservations } = setup([answers.felix, answers.soft, answers.hebeSoft]);
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, [FELIX, SOFT, HEBE_SOFT], ["rossmann", "hebe"]);

    expect(reservations).not.toContain("natura");
    expect(urlsTo(fetchMock, "natura")).toEqual([]);
    expect(refresh).toEqual({
      results: [
        { key: FELIX, check: { kind: "price", offer: felixOffer } },
        { key: SOFT, check: FAILED },
        { key: HEBE_SOFT, check: { kind: "price", offer: hebeSoftOffer } },
      ],
      saved: "saved",
    });
    expect(queries).toHaveLength(2);
  });

  it("asks a shop listed twice once", async () => {
    const { gate, fetchMock } = setup([answers.soft]);
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, [SOFT], ["natura", "natura"]);

    expect(requestedUrls(fetchMock)).toEqual([answers.soft.url]);
    expect(refresh.results).toEqual([{ key: SOFT, check: { kind: "price", offer: softOffer } }]);
    expect(queries).toEqual([insertOf([priceRow(SOFT, softOffer)])]);
  });
});

describe("refreshCodeOf", () => {
  const felixPrice = { key: FELIX, check: { kind: "price", offer: felixOffer } } as const;

  it.each<{ why: string; refresh: PriceRefresh; code: PriceRefreshCode }>([
    { why: "no item needed refreshing", refresh: { results: [], saved: "none" }, code: "none" },
    {
      why: "every item got a price or a missing check, all stored",
      refresh: { results: [felixPrice, { key: GONE, check: { kind: "missing" } }], saved: "saved" },
      code: "done",
    },
    {
      why: "an item got no answer",
      refresh: { results: [felixPrice, { key: NIVEA, check: BUSY }], saved: "saved" },
      code: "partial",
    },
    {
      why: "the answers couldn't be stored",
      refresh: { results: [felixPrice, { key: GONE, check: { kind: "missing" } }], saved: "failed" },
      code: "partial",
    },
    {
      why: "no item got an answer",
      refresh: {
        results: [
          { key: NIVEA, check: BUSY },
          { key: SOFT, check: FAILED },
        ],
        saved: "none",
      },
      code: "failed",
    },
  ])("gives $code when $why", ({ refresh, code }) => {
    expect(refreshCodeOf(refresh)).toBe(code);
  });

  it("gives partial for the Rossmann products past the cap", async () => {
    let reserved = 0;
    const { gate } = setup([answers.felix], () => {
      reserved += 1;
      return { outcome: reserved <= 1 ? "allowed" : "capped" };
    });
    const { client } = stubClient();

    expect(refreshCodeOf(await refreshPrices(gate, client, [FELIX, NIVEA]))).toBe("partial");
  });

  it("gives partial when one shop's checks couldn't be stored", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate } = setup([answers.felix, answers.soft]);
    const { client } = stubClient(["rossmann"]);

    expect(refreshCodeOf(await refreshPrices(gate, client, [FELIX, SOFT]))).toBe("partial");
  });
});

describe("parsePriceRefreshCode", () => {
  it("reads every code the route sends", () => {
    for (const code of PRICE_REFRESH_CODES) {
      expect(parsePriceRefreshCode(code)).toBe(code);
    }
  });

  it.each([null, "", "DONE", "done ", "Kliknij tutaj, by odebrać nagrodę", "toString", "__proto__"])(
    "reads nothing from %j, which the route never sends",
    (value) => {
      expect(parsePriceRefreshCode(value)).toBeNull();
    },
  );
});

describe("listRefreshBackOf, the list refresh's way back", () => {
  const PRODUCT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";

  it.each<{ why: string; back: FormDataEntryValue | null; f: FormDataEntryValue | null; read: ListRefreshBack }>([
    { why: "the list, with its filter", back: null, f: "promo", read: { back: null, f: "promo" } },
    { why: "the list, without a filter", back: null, f: null, read: { back: null, f: "all" } },
    { why: "the product it was posted from", back: PRODUCT_ID, f: "check", read: { back: PRODUCT_ID, f: "check" } },
    {
      why: "a filter no chip links to, as every product's",
      back: null,
      f: "najtańsze",
      read: { back: null, f: "all" },
    },
    {
      why: "a filter that isn't text, as every product's",
      back: PRODUCT_ID,
      f: new File(["promo"], "f.txt"),
      read: { back: PRODUCT_ID, f: "all" },
    },
  ])("reads $why", ({ back, f, read }) => {
    expect(listRefreshBackOf(back, f)).toEqual(read);
  });

  it.each<{ why: string; back: FormDataEntryValue }>([
    { why: "an id that isn't a UUID", back: "26900" },
    { why: "an empty id", back: "" },
    { why: "a path", back: `${PRODUCT_ID}/../../auth/signout` },
    { why: "an id with its own query", back: `${PRODUCT_ID}?list-prices=done` },
    { why: "a file", back: new File([PRODUCT_ID], "back.txt") },
  ])("refuses $why, which only a crafted post sends, whatever the filter", ({ back }) => {
    expect(listRefreshBackOf(back, "promo")).toBeNull();
    expect(listRefreshBackOf(back, null)).toBeNull();
  });
});

describe("listRefreshBackTo", () => {
  const PRODUCT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";

  it("has a notice parameter of its own, which the product page's address bar forgets", () => {
    expect(LIST_PRICES_PARAM).not.toBe(PRICES_PARAM);
    expect(NOTICE_PARAMS).toContain(LIST_PRICES_PARAM);
  });

  it.each<{ why: string; back: ListRefreshBack; to: string }>([
    {
      why: "to the product it was posted from, with its filter",
      back: { back: PRODUCT_ID, f: "promo" },
      to: `/watchlist/${PRODUCT_ID}?f=promo&${LIST_PRICES_PARAM}=done`,
    },
    {
      why: "to the product, without the filter of every product",
      back: { back: PRODUCT_ID, f: "all" },
      to: `/watchlist/${PRODUCT_ID}?${LIST_PRICES_PARAM}=done`,
    },
    {
      why: "to the list, with its filter",
      back: { back: null, f: "check" },
      to: `/watchlist?f=check&${LIST_PRICES_PARAM}=done`,
    },
    { why: "to the list without a filter", back: { back: null, f: "all" }, to: `/watchlist?${LIST_PRICES_PARAM}=done` },
  ])("goes back $why", ({ back, to }) => {
    expect(listRefreshBackTo(back, "done")).toBe(to);
  });

  it("goes back where the form's fields say, as listRefreshBackOf reads them", () => {
    const read = listRefreshBackOf(PRODUCT_ID, "najtańsze");

    expect(read).not.toBeNull();
    expect(listRefreshBackTo(read ?? { back: null, f: "promo" }, "partial")).toBe(
      `/watchlist/${PRODUCT_ID}?${LIST_PRICES_PARAM}=partial`,
    );
  });

  it("carries each code the refresh can come to", () => {
    for (const code of PRICE_REFRESH_CODES) {
      expect(listRefreshBackTo({ back: null, f: "all" }, code)).toBe(`/watchlist?${LIST_PRICES_PARAM}=${code}`);
    }
  });
});

describe("productRefreshBackTo", () => {
  const PRODUCT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";

  it.each<{ why: string; filter: ListFilter; to: string }>([
    { why: "keeping the list's filter", filter: "check", to: `/watchlist/${PRODUCT_ID}?f=check&prices=done` },
    { why: "without the filter of every product", filter: "all", to: `/watchlist/${PRODUCT_ID}?prices=done` },
  ])("goes back to the product's page $why", ({ filter, to }) => {
    expect(productRefreshBackTo(PRODUCT_ID, filter, "done")).toBe(to);
  });

  it("carries each code the refresh can come to, in the product's own parameter, which its address bar forgets", () => {
    expect(NOTICE_PARAMS).toContain(PRICES_PARAM);
    for (const code of PRICE_REFRESH_CODES) {
      expect(productRefreshBackTo(PRODUCT_ID, "promo", code)).toBe(
        `/watchlist/${PRODUCT_ID}?f=promo&${PRICES_PARAM}=${code}`,
      );
    }
  });
});
