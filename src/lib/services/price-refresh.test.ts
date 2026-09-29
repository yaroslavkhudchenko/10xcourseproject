import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  parsePriceRefreshCode,
  PRICE_REFRESH_CODES,
  refreshCodeOf,
  refreshPrices,
  type PriceRefresh,
  type PriceRefreshCode,
} from "@/lib/services/price-refresh";
import { createShopGate } from "@/lib/services/shop-gate";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import type { PriceCheck, PriceKey, ShopId, ShopOffer } from "@/types";
import skuUnknown from "@/lib/services/shops/fixtures/natura-sku-unknown.json";
import oneSku from "@/lib/services/shops/fixtures/natura-sku.json";
import twoSkus from "@/lib/services/shops/fixtures/natura-skus.json";
import reduced from "@/lib/services/shops/fixtures/rossmann-detail-reduced.json";
import regular from "@/lib/services/shops/fixtures/rossmann-detail-regular.json";
import unknownProduct from "@/lib/services/shops/fixtures/rossmann-detail-unknown.json";

// Both shops answer with their real recordings, through the real gate; no test reaches a live shop.
const detailUrl = (id: string) => `https://www.rossmann.pl/products/v2/api/Products/${id}?shopNumber=null`;
// Natura's price request, spelled out as the natura-sku*.json recordings were made: one repeated f[] per SKU.
const priceUrl = (skus: string[]) =>
  "https://live.luigisbox.com/search?tracker_id=703598-939363&f%5B%5D=type%3Aproduct" +
  skus.map((sku) => `&f%5B%5D=sku%3A${sku}`).join("") +
  `&size=${skus.length}&hit_fields=sku%2Cprice_amount%2Cprice_old_amount%2Clowest_price%2Cavailability`;

// Rossmann's Felix on promotion, Nivea Soft at its regular price, and an id Rossmann doesn't have; Natura's Nivea Soft
// on promotion, Nivea MEN, and a SKU Natura doesn't have.
const FELIX: PriceKey = { shop: "rossmann", shopItemId: "131225" };
const NIVEA: PriceKey = { shop: "rossmann", shopItemId: "26900" };
const GONE: PriceKey = { shop: "rossmann", shopItemId: "999999999" };
const SOFT: PriceKey = { shop: "natura", shopItemId: "NV89063" };
const MEN: PriceKey = { shop: "natura", shopItemId: "NV81063" };
const UNKNOWN_SKU: PriceKey = { shop: "natura", shopItemId: "ZZ00000000" };

const answers = {
  felix: { url: detailUrl("131225"), status: 200, body: JSON.stringify(reduced) },
  nivea: { url: detailUrl("26900"), status: 200, body: JSON.stringify(regular) },
  gone: {
    url: detailUrl("999999999"),
    status: unknownProduct.status,
    headers: { "Content-Type": unknownProduct.contentType },
    body: unknownProduct.body,
  },
  soft: { url: priceUrl(["NV89063"]), status: 200, body: JSON.stringify(oneSku) },
  softAndMen: { url: priceUrl(["NV89063", "NV81063"]), status: 200, body: JSON.stringify(twoSkus) },
  unknownSku: { url: priceUrl(["ZZ00000000"]), status: 200, body: JSON.stringify(skuUnknown) },
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
const FAILED: PriceCheck = { kind: "unavailable", reason: "failed" };
const BUSY: PriceCheck = { kind: "unavailable", reason: "busy" };

/** A real gate over a fetch that answers only the given recordings; `reserve` answers each reservation. */
function setup(entries: ReplayEntry[], reserve: (shop: ShopId) => unknown = () => ({ outcome: "allowed" })) {
  const fetchMock = vi.fn(createReplayFetch(entries));
  const gate = createShopGate({
    reserve: (shop) => Promise.resolve(reserve(shop)),
    reportBlock: () => Promise.resolve(),
    fetch: fetchMock,
    log: () => undefined,
  });
  return { gate, fetchMock };
}

/** Every URL the fetch was asked for: a miss would look like a network failure, so each test checks its requests. */
function requestedUrls(fetchMock: Mock<typeof fetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : new URL(input).href));
}

/** One builder call a query made, such as `["insert", rows]`. */
type Call = [method: string, ...args: unknown[]];

interface QueryStub {
  insert: (rows: unknown) => QueryStub;
  abortSignal: (signal: AbortSignal) => Promise<{ data: null; error: { code: string; message: string } | null }>;
}

/**
 * A client whose inserts succeed, or fail with `error`. Every builder call is recorded, so a test sees each query's
 * table, rows and time limit: a query ends with `["abortSignal", true]` when it was given an AbortSignal.
 */
function stubClient(error: { code: string; message: string } | null = null) {
  const queries: Call[][] = [];
  const from = (table: string): QueryStub => {
    const calls: Call[] = [["from", table]];
    queries.push(calls);
    const query: QueryStub = {
      insert: (rows) => {
        calls.push(["insert", rows]);
        return query;
      },
      abortSignal: (signal) => {
        calls.push(["abortSignal", signal instanceof AbortSignal]);
        return Promise.resolve({ data: null, error });
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

/** The single insert that stores a refresh's checks, with the given rows. */
const oneInsert = (rows: unknown[]): Call[][] => [
  [
    ["from", "price_observations"],
    ["insert", rows],
    ["abortSignal", true],
  ],
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refreshPrices: fetching", () => {
  it("fetches Rossmann per product and Natura's SKUs in one request, then stores every check at once", async () => {
    const { gate, fetchMock } = setup([answers.felix, answers.nivea, answers.softAndMen]);
    const { client, queries } = stubClient();

    const refresh = await refreshPrices(gate, client, [FELIX, SOFT, NIVEA, MEN]);

    expect(requestedUrls(fetchMock)).toHaveLength(3);
    expect(new Set(requestedUrls(fetchMock))).toEqual(
      new Set([answers.felix.url, answers.nivea.url, answers.softAndMen.url]),
    );
    expect(refresh).toEqual({
      results: [
        { key: FELIX, check: { kind: "price", offer: felixOffer } },
        { key: SOFT, check: { kind: "price", offer: softOffer } },
        { key: NIVEA, check: { kind: "price", offer: niveaOffer } },
        { key: MEN, check: { kind: "price", offer: menOffer } },
      ],
      saved: "saved",
    });
    expect(queries).toEqual(
      oneInsert([
        priceRow(FELIX, felixOffer),
        priceRow(SOFT, softOffer),
        priceRow(NIVEA, niveaOffer),
        priceRow(MEN, menOffer),
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
    expect(queries).toEqual(oneInsert([priceRow(NIVEA, niveaOffer), priceRow(SOFT, softOffer)]));
  });

  it("runs at most 5 Rossmann requests at once, starting them in the order given", async () => {
    // Each request waits until the test answers it.
    const pending: { url: string; answer: (response: Response) => void }[] = [];
    const fetchMock = vi.fn<typeof fetch>(
      (input) =>
        new Promise<Response>((resolve) => {
          pending.push({ url: input instanceof Request ? input.url : new URL(input).href, answer: resolve });
        }),
    );
    const gate = createShopGate({
      reserve: () => Promise.resolve({ outcome: "allowed" }),
      reportBlock: () => Promise.resolve(),
      fetch: fetchMock,
      log: () => undefined,
    });
    const { client } = stubClient();
    const ids = ["1", "2", "3", "4", "5", "6", "7"];
    // Rossmann's recorded answer to an id it doesn't have.
    const gone = () =>
      new Response(unknownProduct.body, {
        status: unknownProduct.status,
        headers: { "Content-Type": unknownProduct.contentType },
      });

    const refresh = refreshPrices(
      gate,
      client,
      ids.map((shopItemId): PriceKey => ({ shop: "rossmann", shopItemId })),
    );

    await vi.waitFor(() => {
      expect(pending).toHaveLength(5);
    });
    // Nothing else starts until one of the five answers.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending.map((request) => request.url)).toEqual(ids.slice(0, 5).map(detailUrl));
    pending[0].answer(gone());
    await vi.waitFor(() => {
      expect(pending).toHaveLength(6);
    });
    expect(pending[5].url).toBe(detailUrl("6"));
    for (const request of pending.slice(1)) {
      request.answer(gone());
    }
    await vi.waitFor(() => {
      expect(pending).toHaveLength(7);
    });
    expect(pending[6].url).toBe(detailUrl("7"));
    pending[6].answer(gone());

    const { results } = await refresh;
    expect(results.map(({ check }) => check)).toEqual(ids.map(() => ({ kind: "missing" })));
  });
});

describe("refreshPrices: storing", () => {
  it("stores only the prices and missing items, with one insert", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([answers.felix, answers.gone, answers.unknownSku]);
    const { client, queries } = stubClient();
    // A stored id that isn't Rossmann's, and a shop whose prices S-03 doesn't fetch.
    const odd: PriceKey = { shop: "rossmann", shopItemId: ".." };
    const hebe: PriceKey = { shop: "hebe", shopItemId: "000000000000218807" };

    const refresh = await refreshPrices(gate, client, [FELIX, odd, GONE, hebe, UNKNOWN_SKU]);

    expect(requestedUrls(fetchMock)).toHaveLength(3);
    expect(new Set(requestedUrls(fetchMock))).toEqual(
      new Set([answers.felix.url, answers.gone.url, answers.unknownSku.url]),
    );
    expect(refresh).toEqual({
      results: [
        { key: FELIX, check: { kind: "price", offer: felixOffer } },
        { key: odd, check: FAILED },
        { key: GONE, check: { kind: "missing" } },
        { key: hebe, check: FAILED },
        { key: UNKNOWN_SKU, check: { kind: "missing" } },
      ],
      saved: "saved",
    });
    expect(queries).toEqual(oneInsert([priceRow(FELIX, felixOffer), missingRow(GONE), missingRow(UNKNOWN_SKU)]));
  });

  it("stores nothing for the Rossmann products past the cap, which keep their last price", async () => {
    // The cap leaves room for two more Rossmann requests.
    let reserved = 0;
    const { gate, fetchMock } = setup([answers.felix, answers.nivea, answers.gone], (shop) => {
      if (shop !== "rossmann") {
        return { outcome: "allowed" };
      }
      reserved += 1;
      return { outcome: reserved <= 2 ? "allowed" : "capped" };
    });
    const { client, queries } = stubClient();
    const other: PriceKey = { shop: "rossmann", shopItemId: "11790" };

    const refresh = await refreshPrices(gate, client, [FELIX, NIVEA, GONE, other]);

    // The first two in the order given are asked; the others never reach Rossmann.
    expect(requestedUrls(fetchMock)).toEqual([answers.felix.url, answers.nivea.url]);
    expect(refresh.results).toEqual([
      { key: FELIX, check: { kind: "price", offer: felixOffer } },
      { key: NIVEA, check: { kind: "price", offer: niveaOffer } },
      { key: GONE, check: BUSY },
      { key: other, check: BUSY },
    ]);
    expect(queries).toEqual(oneInsert([priceRow(FELIX, felixOffer), priceRow(NIVEA, niveaOffer)]));
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
    const { client, queries } = stubClient({ code: "42501", message: "new row violates row-level security policy" });

    expect(await refreshPrices(gate, client, [NIVEA])).toEqual({
      results: [{ key: NIVEA, check: { kind: "price", offer: niveaOffer } }],
      saved: "failed",
    });
    expect(queries).toEqual(oneInsert([priceRow(NIVEA, niveaOffer)]));
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
