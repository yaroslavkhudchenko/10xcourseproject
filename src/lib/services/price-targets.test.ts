import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PricedShop } from "@/lib/services/price-comparison";
import {
  listTargets,
  priceRequestSchema,
  priceTargetFor,
  productTargets,
  shopItemFor,
  type PriceRequest,
  type RefreshTargets,
} from "@/lib/services/price-targets";

// The user's Nivea Soft, picked in Rossmann and matched to Natura's NV89063, and two more products on the list.
const SOFT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const FELIX_ID = "4f1c2a8e-5b7d-4c3e-9a1f-0d2b3c4e5f60";
const MEN_ID = "c0ffee00-0000-4000-8000-000000000001";
// Every time here is measured back from one fixed moment.
const NOW = "2026-09-28T12:00:00.000Z";
const MINUTE = 60 * 1000;

const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

// The product's row, as its page reads it.
const softRow = {
  id: SOFT_ID,
  source: "rossmann",
  source_item_id: "26900",
  brand: "NIVEA",
  name: "Soft",
  caption: "krem uniwersalny, nawilżający",
  size_text: "300 ml",
  size_value: 300,
  size_unit: "ml",
  eans: ["4005900009319"],
  product_url: null,
  image_url: null,
  created_at: "2026-09-27T12:00:00+00:00",
};

// The product's decision in Natura: matched to NV89063, or one without an item.
const matchedRow = {
  watchlist_item_id: SOFT_ID,
  shop_id: "natura",
  state: "matched",
  decided_by: "auto",
  shop_item_id: "NV89063",
  name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
  brand: "NIVEA",
  size_text: "300 ml",
  size_value: 300,
  size_unit: "ml",
  eans: ["4005900009319"],
  product_url: null,
  image_url: null,
  checked_at: "2026-09-27T12:05:00+00:00",
};
const undecidedRow = (state: "unmatched" | "not_found") => ({
  watchlist_item_id: SOFT_ID,
  shop_id: "natura",
  state,
  decided_by: state === "unmatched" ? "user" : "auto",
  checked_at: "2026-09-27T12:05:00+00:00",
});

// The product's decision in Hebe, the other matched shop: matched to Hebe's Nivea Soft 200 ml, by its 18-digit id.
const HEBE_SOFT_ID = "000000000000218807";
const hebeMatchedRow = {
  ...matchedRow,
  shop_id: "hebe",
  shop_item_id: HEBE_SOFT_ID,
  name: "Nivea Soft Lekki Krem Nawilżający, 200 ml",
  brand: "Nivea",
  size_text: "200 ml",
  size_value: 200,
  eans: ["4005900008299"],
};

// The product's decision in Super-Pharm, the third matched shop: the user's pick of Super-Pharm's Nivea Soft 300 ml, by
// its record's objectID, with no EAN, which Super-Pharm's index doesn't hold.
const SUPER_PHARM_SOFT_ID = "10132";
const superPharmMatchedRow = {
  ...matchedRow,
  shop_id: "super-pharm",
  decided_by: "user",
  shop_item_id: SUPER_PHARM_SOFT_ID,
  name: "Nivea Soft Krem nawilżający (Pudełko)",
  brand: "Nivea",
  eans: [],
};

// The same Nivea Soft picked in Natura instead, by its SKU, with Natura's page: Rossmann is one of its matched shops.
const NATURA_PAGE = "https://drogerienatura.pl/produkt/nivea-soft-krem-intensywnie-nawilzajacy-300-ml-4005900009319";
const fromNaturaRow = {
  ...softRow,
  source: "natura",
  source_item_id: "NV89063",
  name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
  caption: null,
  product_url: NATURA_PAGE,
};

// Its decision in Rossmann: matched to Rossmann's Nivea Soft 300 ml, by its product id.
const rossmannMatchedRow = {
  ...matchedRow,
  shop_id: "rossmann",
  shop_item_id: "26900",
  name: "Soft krem uniwersalny, nawilżający",
  product_url:
    "https://www.rossmann.pl/Produkt/Kremy-do-twarzy/NIVEA-Soft-krem-uniwersalny-nawilzajacy-300-ml,26900,13049",
};

/** One builder call a query made, such as `["eq", "id", SOFT_ID]`. */
type Call = [method: string, ...args: unknown[]];

interface Answer {
  data?: unknown;
  error?: { code: string; message: string };
}

interface Result {
  data: unknown;
  error: Answer["error"] | null;
}

interface QueryStub {
  select: (columns: string) => QueryStub;
  eq: (column: string, value: unknown) => QueryStub;
  order: (column: string, options: unknown) => QueryStub;
  abortSignal: (signal: AbortSignal) => Promise<Result> & { maybeSingle: () => Promise<Result> };
}

/**
 * A client whose queries get the answer given for their table, as the user's own rows under RLS. Every builder call is
 * recorded, so a test sees each query's table and filters: a query ends with `["abortSignal", true]` when it was given
 * an AbortSignal.
 */
function stubClient(answers: Record<string, Answer>) {
  const queries: Call[][] = [];
  const from = (table: string): QueryStub => {
    const answer = answers[table] ?? { error: { code: "stub", message: "no answer for this table" } };
    const result: Result = { data: answer.data ?? null, error: answer.error ?? null };
    const calls: Call[] = [["from", table]];
    queries.push(calls);
    const query: QueryStub = {
      select: (columns) => {
        calls.push(["select", columns]);
        return query;
      },
      eq: (column, value) => {
        calls.push(["eq", column, value]);
        return query;
      },
      order: (column, options) => {
        calls.push(["order", column, options]);
        return query;
      },
      // A list ends here; a single row goes on to maybeSingle.
      abortSignal: (signal) => {
        calls.push(["abortSignal", signal instanceof AbortSignal]);
        return Object.assign(Promise.resolve(result), { maybeSingle: () => Promise.resolve(result) });
      },
    };
    return query;
  };
  return { client: { from } as unknown as SupabaseClient, queries };
}

const readFailure = { error: { code: "57014", message: "canceling statement due to statement timeout" } };

beforeEach(() => {
  // Only the clock the list's refresh judges its items on; the queries' time limits keep their real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("priceRequestSchema", () => {
  it("reads which product, which shop and which item the page shows there, and drops any other field", () => {
    expect(
      priceRequestSchema.parse({ itemId: SOFT_ID, shop: "natura", shopItemId: "NV89063", price: 0.01 }),
    ).toStrictEqual({ itemId: SOFT_ID, shop: "natura", shopItemId: "NV89063" });
  });

  it.each([
    { shop: "hebe", shopItemId: HEBE_SOFT_ID },
    { shop: "super-pharm", shopItemId: SUPER_PHARM_SOFT_ID },
  ])("reads a request for $shop's item, whose prices are fetched like every matched shop's", (request) => {
    expect(priceRequestSchema.parse({ itemId: SOFT_ID, ...request })).toStrictEqual({ itemId: SOFT_ID, ...request });
  });

  it.each([
    { why: "a product id that isn't a UUID", body: { itemId: "26900", shop: "rossmann", shopItemId: "26900" } },
    { why: "a shop the app doesn't know", body: { itemId: SOFT_ID, shop: "dm", shopItemId: "39477" } },
    { why: "no shop", body: { itemId: SOFT_ID, shopItemId: "NV89063" } },
    { why: "no shop item", body: { itemId: SOFT_ID, shop: "natura" } },
    {
      why: "a shop item with a path in it",
      body: { itemId: SOFT_ID, shop: "natura", shopItemId: "NV89063/../koszyk" },
    },
    { why: "a shop item over 40 characters", body: { itemId: SOFT_ID, shop: "natura", shopItemId: "N".repeat(41) } },
  ])("refuses $why", ({ body }) => {
    expect(priceRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("priceTargetFor", () => {
  /** The island's request for the product in `shop`, naming the item its page shows there. */
  const request = (shop: PricedShop, shopItemId: string): PriceRequest => ({ itemId: SOFT_ID, shop, shopItemId });

  it.each<{ shop: PricedShop; shopItemId: string }>([
    { shop: "rossmann", shopItemId: "26900" },
    { shop: "natura", shopItemId: "NV89063" },
    { shop: "hebe", shopItemId: HEBE_SOFT_ID },
    { shop: "super-pharm", shopItemId: SUPER_PHARM_SOFT_ID },
  ])("gives the user's own item in $shop when the page shows that item", async ({ shop, shopItemId }) => {
    const { client } = stubClient({
      watchlist_items: { data: softRow },
      watchlist_matches: { data: [matchedRow, hebeMatchedRow, superPharmMatchedRow] },
    });

    expect(await priceTargetFor(client, request(shop, shopItemId))).toEqual({ shop, shopItemId });
  });

  it("gives changed when the Natura match is another item than the page shows, as after a re-pin elsewhere", async () => {
    // The page was rendered with NV81063; the user's decision now names NV89063, whose price the page mustn't show.
    const { client } = stubClient({ watchlist_items: { data: softRow }, watchlist_matches: { data: [matchedRow] } });

    expect(await priceTargetFor(client, request("natura", "NV81063"))).toBe("changed");
  });

  it("gives changed when the page names another Rossmann item than the product's own", async () => {
    const { client } = stubClient({ watchlist_items: { data: softRow } });

    expect(await priceTargetFor(client, request("rossmann", "11790"))).toBe("changed");
  });

  it.each<{ why: string; shop: PricedShop; shopItemId: string; answers: Record<string, Answer> }>([
    {
      why: "the product isn't on the user's list",
      shop: "rossmann",
      shopItemId: "26900",
      answers: { watchlist_items: { data: null } },
    },
    {
      why: "the product isn't on the user's list",
      shop: "natura",
      shopItemId: "NV89063",
      answers: { watchlist_items: { data: null }, watchlist_matches: { data: [matchedRow] } },
    },
  ])("gives gone in $shop when $why", async ({ shop, shopItemId, answers }) => {
    const { client } = stubClient(answers);

    expect(await priceTargetFor(client, request(shop, shopItemId))).toBe("gone");
  });

  it.each<{ shop: PricedShop; shopItemId: string; decision: Record<string, unknown> }>([
    { shop: "natura", shopItemId: "NV89063", decision: undecidedRow("unmatched") },
    { shop: "hebe", shopItemId: HEBE_SOFT_ID, decision: { ...undecidedRow("unmatched"), shop_id: "hebe" } },
  ])(
    "gives changed, never gone, when the product is still listed but its match in $shop was declined elsewhere",
    async ({ shop, shopItemId, decision }) => {
      // A page left open still shows the declined item's price, which mustn't stay eligible: its reload alert shows.
      const { client } = stubClient({ watchlist_items: { data: softRow }, watchlist_matches: { data: [decision] } });

      expect(await priceTargetFor(client, request(shop, shopItemId))).toBe("changed");
    },
  );

  it("gives failed when the rows can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ watchlist_items: { data: softRow }, watchlist_matches: readFailure });

    expect(await priceTargetFor(client, request("natura", "NV89063"))).toBe("failed");
  });

  it("gives failed, never gone, when the product's Natura decision came back odd, since it may be the page's match", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      watchlist_items: { data: softRow },
      watchlist_matches: { data: [{ ...matchedRow, shop_item_id: null }] },
    });

    expect(await priceTargetFor(client, request("natura", "NV89063"))).toBe("failed");
  });

  // The island of a product picked in Natura refetches its own Natura item and its Rossmann match, each the item its
  // page shows: neither may answer `changed` (409), which would ask for a reload instead of the price.
  it.each<{ shop: PricedShop; shopItemId: string }>([
    { shop: "natura", shopItemId: "NV89063" },
    { shop: "rossmann", shopItemId: "26900" },
    { shop: "hebe", shopItemId: HEBE_SOFT_ID },
  ])(
    "gives a product picked in Natura its item in $shop when the page shows that item",
    async ({ shop, shopItemId }) => {
      const { client } = stubClient({
        watchlist_items: { data: fromNaturaRow },
        watchlist_matches: { data: [rossmannMatchedRow, hebeMatchedRow] },
      });

      expect(await priceTargetFor(client, request(shop, shopItemId))).toEqual({ shop, shopItemId });
    },
  );

  it("gives changed for the item of a decision stored in a product's own shop, which its page never shows", async () => {
    // Natura's NV81063 stored as a match of the product picked in Natura's NV89063, as a direct write could: the page
    // shows the product's own item there, so a request naming NV81063 is a stale or crafted one.
    const { client } = stubClient({
      watchlist_items: { data: fromNaturaRow },
      watchlist_matches: { data: [{ ...matchedRow, shop_item_id: "NV81063" }] },
    });

    expect(await priceTargetFor(client, request("natura", "NV81063"))).toBe("changed");
  });
});

describe("shopItemFor", () => {
  it("gives the product's own Rossmann item, from the user's row", async () => {
    const { client, queries } = stubClient({ watchlist_items: { data: softRow } });

    expect(await shopItemFor(client, SOFT_ID, "rossmann")).toEqual({ shop: "rossmann", shopItemId: "26900" });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContainEqual(["from", "watchlist_items"]);
    expect(queries[0]).toContainEqual(["eq", "id", SOFT_ID]);
  });

  it("gives the SKU of the product's matched Natura item, from the user's decision", async () => {
    const { client, queries } = stubClient({
      watchlist_items: { data: softRow },
      watchlist_matches: { data: [matchedRow] },
    });

    expect(await shopItemFor(client, SOFT_ID, "natura")).toEqual({ shop: "natura", shopItemId: "NV89063" });
    expect(queries.map((calls) => calls[0])).toEqual([
      ["from", "watchlist_items"],
      ["from", "watchlist_matches"],
    ]);
    expect(queries[1]).toContainEqual(["eq", "watchlist_item_id", SOFT_ID]);
  });

  it.each([
    { why: "no decision", matches: [] },
    { why: "a decision the user declined", matches: [undecidedRow("unmatched")] },
    { why: "a lookup that found nothing", matches: [undecidedRow("not_found")] },
  ])("gives none for Natura when the product has $why there", async ({ matches }) => {
    const { client } = stubClient({ watchlist_items: { data: softRow }, watchlist_matches: { data: matches } });

    expect(await shopItemFor(client, SOFT_ID, "natura")).toBeNull();
  });

  it("gives the Rossmann match of a product picked in another shop, from the user's decision there", async () => {
    const { client, queries } = stubClient({
      watchlist_items: { data: fromNaturaRow },
      watchlist_matches: { data: [rossmannMatchedRow] },
    });

    expect(await shopItemFor(client, SOFT_ID, "rossmann")).toEqual({ shop: "rossmann", shopItemId: "26900" });
    // The product first, which says Rossmann is one of its matched shops, then its decisions.
    expect(queries.map((calls) => calls[0])).toEqual([
      ["from", "watchlist_items"],
      ["from", "watchlist_matches"],
    ]);
  });

  it.each([
    { why: "no decision", matches: [] },
    { why: "a decision the user declined", matches: [{ ...undecidedRow("unmatched"), shop_id: "rossmann" }] },
    { why: "a lookup that found nothing", matches: [{ ...undecidedRow("not_found"), shop_id: "rossmann" }] },
  ])("gives none for Rossmann when a product picked in another shop has $why there", async ({ matches }) => {
    const { client } = stubClient({ watchlist_items: { data: fromNaturaRow }, watchlist_matches: { data: matches } });

    expect(await shopItemFor(client, SOFT_ID, "rossmann")).toBeNull();
  });

  it.each<{ source: PricedShop; sourceItemId: string }>([
    { source: "natura", sourceItemId: "NV89063" },
    { source: "hebe", sourceItemId: HEBE_SOFT_ID },
    { source: "super-pharm", sourceItemId: SUPER_PHARM_SOFT_ID },
  ])(
    "gives the own item of a product picked in $source, from the user's row alone",
    async ({ source, sourceItemId }) => {
      const { client, queries } = stubClient({
        watchlist_items: { data: { ...softRow, source, source_item_id: sourceItemId } },
      });

      expect(await shopItemFor(client, SOFT_ID, source)).toEqual({ shop: source, shopItemId: sourceItemId });
      expect(queries).toHaveLength(1);
      expect(queries[0]).toContainEqual(["from", "watchlist_items"]);
    },
  );

  it("gives a product's own item in its own shop, never a decision stored there, nor one that couldn't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A match to another Natura item, and an odd Natura row, as direct writes could store them for the product picked
    // in Natura: neither is read, since its own item stands there.
    for (const decision of [
      { ...matchedRow, shop_item_id: "NV81063" },
      { ...matchedRow, state: "repinned" },
    ]) {
      const { client, queries } = stubClient({
        watchlist_items: { data: fromNaturaRow },
        watchlist_matches: { data: [decision] },
      });

      expect(await shopItemFor(client, SOFT_ID, "natura")).toEqual({ shop: "natura", shopItemId: "NV89063" });
      expect(queries).toHaveLength(1);
    }
  });

  it.each(["rossmann", "natura"] as const)(
    "gives none in %s for a product that isn't on the user's list, as RLS answers another user's",
    async (shop) => {
      // Only the product's own row counts, whatever decision comes back with it.
      const { client } = stubClient({ watchlist_items: { data: null }, watchlist_matches: { data: [matchedRow] } });

      expect(await shopItemFor(client, SOFT_ID, shop)).toBeNull();
    },
  );

  it.each<{ why: string; shop: PricedShop; answers: Record<string, Answer> }>([
    { why: "the product", shop: "rossmann", answers: { watchlist_items: readFailure } },
    {
      why: "the product",
      shop: "natura",
      answers: { watchlist_items: readFailure, watchlist_matches: { data: [matchedRow] } },
    },
    {
      why: "its decisions",
      shop: "natura",
      answers: { watchlist_items: { data: softRow }, watchlist_matches: readFailure },
    },
    {
      // A state a later migration might add before the code knows it: the row may hide a match.
      why: "its Natura decision's row",
      shop: "natura",
      answers: {
        watchlist_items: { data: softRow },
        watchlist_matches: { data: [{ ...matchedRow, state: "repinned" }] },
      },
    },
  ])("gives failed in $shop when $why can't be read", async ({ shop, answers }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient(answers);

    expect(await shopItemFor(client, SOFT_ID, shop)).toBe("failed");
  });

  it("gives the id of the product's matched Hebe item, from the user's decision there", async () => {
    const { client } = stubClient({
      watchlist_items: { data: softRow },
      watchlist_matches: { data: [matchedRow, hebeMatchedRow] },
    });

    expect(await shopItemFor(client, SOFT_ID, "hebe")).toEqual({ shop: "hebe", shopItemId: HEBE_SOFT_ID });
  });

  it("gives Natura's matched item beside the rows of a shop the app doesn't know, a decline or a state it can't read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Every shop the app knows is matched, so a shop outside the list the page reads is one it doesn't know, such as dm.
    const unknownShopRows = [
      { ...undecidedRow("unmatched"), shop_id: "dm" },
      { ...matchedRow, shop_id: "dm", state: "repinned" },
    ];
    const { client } = stubClient({
      watchlist_items: { data: softRow },
      watchlist_matches: { data: [...unknownShopRows, matchedRow] },
    });

    expect(await shopItemFor(client, SOFT_ID, "natura")).toEqual({ shop: "natura", shopItemId: "NV89063" });
  });
});

describe("productTargets", () => {
  it("gives the product's Rossmann item and its Natura match", async () => {
    const { client } = stubClient({ watchlist_items: { data: softRow }, watchlist_matches: { data: [matchedRow] } });

    expect(await productTargets(client, SOFT_ID)).toEqual<RefreshTargets>({
      keys: [
        { shop: "rossmann", shopItemId: "26900" },
        { shop: "natura", shopItemId: "NV89063" },
      ],
      unread: [],
    });
  });

  it("gives only the Rossmann item when the product has no match in Natura", async () => {
    const { client } = stubClient({
      watchlist_items: { data: softRow },
      watchlist_matches: { data: [undecidedRow("not_found")] },
    });

    expect(await productTargets(client, SOFT_ID)).toEqual<RefreshTargets>({
      keys: [{ shop: "rossmann", shopItemId: "26900" }],
      unread: [],
    });
  });

  it("gives nothing for a product that isn't on the user's list", async () => {
    const { client } = stubClient({ watchlist_items: { data: null }, watchlist_matches: { data: [] } });

    expect(await productTargets(client, SOFT_ID)).toEqual<RefreshTargets>({ keys: [], unread: [] });
  });

  it("gives nothing for a product that isn't on the user's list, even when its decisions can't be read", async () => {
    // The product's read decides first, as on its page: without the product, its decisions don't count.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ watchlist_items: { data: null }, watchlist_matches: readFailure });

    expect(await productTargets(client, SOFT_ID)).toEqual<RefreshTargets>({ keys: [], unread: [] });
  });

  it.each([
    { why: "the product", answers: { watchlist_items: readFailure, watchlist_matches: { data: [] } } },
    { why: "its decisions", answers: { watchlist_items: { data: softRow }, watchlist_matches: readFailure } },
  ])("gives failed when $why can't be read at all", async ({ answers }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient(answers);

    expect(await productTargets(client, SOFT_ID)).toBe("failed");
  });

  it("gives the product's Rossmann item and its match in each matched shop, Hebe's and Super-Pharm's too, in the shops' order", async () => {
    const { client } = stubClient({
      watchlist_items: { data: softRow },
      watchlist_matches: { data: [superPharmMatchedRow, hebeMatchedRow, matchedRow] },
    });

    expect(await productTargets(client, SOFT_ID)).toEqual<RefreshTargets>({
      keys: [
        { shop: "rossmann", shopItemId: "26900" },
        { shop: "natura", shopItemId: "NV89063" },
        { shop: "hebe", shopItemId: HEBE_SOFT_ID },
        { shop: "super-pharm", shopItemId: SUPER_PHARM_SOFT_ID },
      ],
      unread: [],
    });
  });

  it("leaves out a matched shop the product has no match in, and keeps the other shop's", async () => {
    const { client } = stubClient({
      watchlist_items: { data: softRow },
      watchlist_matches: { data: [undecidedRow("unmatched"), hebeMatchedRow] },
    });

    expect(await productTargets(client, SOFT_ID)).toEqual<RefreshTargets>({
      keys: [
        { shop: "rossmann", shopItemId: "26900" },
        { shop: "hebe", shopItemId: HEBE_SOFT_ID },
      ],
      unread: [],
    });
  });

  it.each<{ why: string; decisions: Record<string, unknown>[]; targets: RefreshTargets }>([
    {
      why: "its Natura decision's row can't be read",
      decisions: [{ ...matchedRow, shop_item_id: 7 }],
      targets: { keys: [{ shop: "rossmann", shopItemId: "26900" }], unread: ["natura"] },
    },
    {
      why: "its Hebe decision can't be read, though its Natura match was",
      decisions: [matchedRow, { ...hebeMatchedRow, state: "repinned" }],
      targets: {
        keys: [
          { shop: "rossmann", shopItemId: "26900" },
          { shop: "natura", shopItemId: "NV89063" },
        ],
        unread: ["hebe"],
      },
    },
  ])("still gives the other shops' items and names the shop unread when $why", async ({ decisions, targets }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ watchlist_items: { data: softRow }, watchlist_matches: { data: decisions } });

    expect(await productTargets(client, SOFT_ID)).toEqual(targets);
  });

  it("gives a product picked in Natura its own Natura item, then its Rossmann match and each other match", async () => {
    const { client } = stubClient({
      watchlist_items: { data: fromNaturaRow },
      watchlist_matches: { data: [superPharmMatchedRow, hebeMatchedRow, rossmannMatchedRow] },
    });

    expect(await productTargets(client, SOFT_ID)).toEqual<RefreshTargets>({
      keys: [
        { shop: "natura", shopItemId: "NV89063" },
        { shop: "rossmann", shopItemId: "26900" },
        { shop: "hebe", shopItemId: HEBE_SOFT_ID },
        { shop: "super-pharm", shopItemId: SUPER_PHARM_SOFT_ID },
      ],
      unread: [],
    });
  });

  it.each<{ why: string; decision: Record<string, unknown> }>([
    { why: "a match stored there", decision: { ...matchedRow, shop_item_id: "NV81063" } },
    { why: "a row there that can't be read", decision: { ...matchedRow, state: "repinned" } },
  ])("leaves out $why for a product picked in Natura, never naming its own shop unread", async ({ decision }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      watchlist_items: { data: fromNaturaRow },
      watchlist_matches: { data: [decision, rossmannMatchedRow] },
    });

    expect(await productTargets(client, SOFT_ID)).toEqual<RefreshTargets>({
      keys: [
        { shop: "natura", shopItemId: "NV89063" },
        { shop: "rossmann", shopItemId: "26900" },
      ],
      unread: [],
    });
  });

  it("names Rossmann unread for a product picked in Natura whose Rossmann decision can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      watchlist_items: { data: fromNaturaRow },
      watchlist_matches: { data: [{ ...rossmannMatchedRow, shop_item_id: null }, hebeMatchedRow] },
    });

    expect(await productTargets(client, SOFT_ID)).toEqual<RefreshTargets>({
      keys: [
        { shop: "natura", shopItemId: "NV89063" },
        { shop: "hebe", shopItemId: HEBE_SOFT_ID },
      ],
      unread: ["rossmann"],
    });
  });
});

describe("listTargets", () => {
  /** A product on the list, as the list reads it. */
  const listRow = (id: string, sourceItemId: string) => ({
    id,
    source: "rossmann",
    source_item_id: sourceItemId,
    brand: "NIVEA",
    name: "Produkt",
    caption: null,
    size_text: null,
    size_value: null,
    size_unit: null,
    image_url: null,
    created_at: "2026-09-27T12:00:00+00:00",
  });

  /** An item's latest check, `checkedAgo` before NOW, with the price it found. */
  const latestRow = (shop: string, shopItemId: string, checkedAgo: number) => ({
    shop_id: shop,
    shop_item_id: shopItemId,
    last_checked_at: ago(checkedAgo),
    last_status: "price",
    price: 16.99,
    regular_price: null,
    lowest_price_30d: null,
    promo_ends_on: null,
    available: true,
    priced_at: ago(checkedAgo),
  });

  // Nivea Soft's Rossmann item was checked 20 minutes ago and its Natura match two days ago; Felix's item 5 minutes
  // ago; Nivea MEN's never.
  const listAnswers = {
    watchlist_items: { data: [listRow(SOFT_ID, "26900"), listRow(FELIX_ID, "131225"), listRow(MEN_ID, "11790")] },
    watchlist_matches: {
      data: [
        {
          watchlist_item_id: SOFT_ID,
          shop_id: "natura",
          state: "matched",
          shop_item_id: "NV89063",
          brand: "NIVEA",
          size_value: 300,
          size_unit: "ml",
          decided_by: "auto",
        },
      ],
    },
    latest_price_observations: {
      data: [
        latestRow("rossmann", "26900", 20 * MINUTE),
        latestRow("natura", "NV89063", 2 * 24 * 60 * MINUTE),
        latestRow("rossmann", "131225", 5 * MINUTE),
      ],
    },
  };

  it("gives the items checked more than 15 minutes ago, those never checked first, then the oldest check first", async () => {
    const { client } = stubClient(listAnswers);

    expect(await listTargets(client)).toEqual<RefreshTargets>({
      keys: [
        { shop: "rossmann", shopItemId: "11790" },
        { shop: "natura", shopItemId: "NV89063" },
        { shop: "rossmann", shopItemId: "26900" },
      ],
      unread: [],
    });
  });

  it("refetches an item whose price row couldn't be read, as one never checked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Felix's item was checked 5 minutes ago, but its row came back odd.
    const { client } = stubClient({
      ...listAnswers,
      latest_price_observations: {
        data: [
          latestRow("rossmann", "26900", 20 * MINUTE),
          latestRow("natura", "NV89063", 2 * 24 * 60 * MINUTE),
          { ...latestRow("rossmann", "131225", 5 * MINUTE), available: "yes" },
        ],
      },
    });

    expect(await listTargets(client)).toEqual<RefreshTargets>({
      keys: [
        { shop: "rossmann", shopItemId: "131225" },
        { shop: "rossmann", shopItemId: "11790" },
        { shop: "natura", shopItemId: "NV89063" },
        { shop: "rossmann", shopItemId: "26900" },
      ],
      unread: [],
    });
  });

  it("doesn't refetch the Natura item of a product whose match row couldn't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      ...listAnswers,
      watchlist_matches: {
        data: [{ watchlist_item_id: SOFT_ID, shop_id: "natura", state: "repinned", shop_item_id: "NV89063" }],
      },
    });

    expect(await listTargets(client)).toEqual<RefreshTargets>({
      keys: [
        { shop: "rossmann", shopItemId: "11790" },
        { shop: "rossmann", shopItemId: "26900" },
      ],
      unread: [],
    });
  });

  it.each(["watchlist_items", "watchlist_matches", "latest_price_observations"] as const)(
    "gives failed when %s can't be read, since it can't tell what's out of date",
    async (table) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { client } = stubClient({ ...listAnswers, [table]: readFailure });

      expect(await listTargets(client)).toBe("failed");
    },
  );

  it("refetches the items without a readable row when a price row can't say whose it is, instead of failing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Felix's item was checked 5 minutes ago, but its row came back without its shop: Felix, like Nivea MEN, which was
    // never checked, has no readable row, so both are fetched, which also repairs Felix's latest row.
    const { client } = stubClient({
      ...listAnswers,
      latest_price_observations: {
        data: [
          latestRow("rossmann", "26900", 20 * MINUTE),
          latestRow("natura", "NV89063", 2 * 24 * 60 * MINUTE),
          { ...latestRow("rossmann", "131225", 5 * MINUTE), shop_id: null },
        ],
      },
    });

    expect(await listTargets(client)).toEqual<RefreshTargets>({
      keys: [
        { shop: "rossmann", shopItemId: "131225" },
        { shop: "rossmann", shopItemId: "11790" },
        { shop: "natura", shopItemId: "NV89063" },
        { shop: "rossmann", shopItemId: "26900" },
      ],
      unread: [],
    });
  });

  it.each<{ why: string; table: "watchlist_matches" | "latest_price_observations"; row: unknown }>([
    {
      why: "a match row can't say whose it is",
      table: "watchlist_matches",
      row: { watchlist_item_id: null, shop_id: "natura", state: "unmatched" },
    },
    {
      why: "a price row is of a shop the list doesn't compare",
      table: "latest_price_observations",
      row: { ...latestRow("rossmann", "131225", 5 * MINUTE), shop_id: "dm" },
    },
  ])("refreshes the items it can read when $why, instead of failing", async ({ table, row }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ ...listAnswers, [table]: { data: [...listAnswers[table].data, row] } });

    // Nivea Soft's Natura match was read, so its SKU is fetched as before.
    expect(await listTargets(client)).toEqual<RefreshTargets>({
      keys: [
        { shop: "rossmann", shopItemId: "11790" },
        { shop: "natura", shopItemId: "NV89063" },
        { shop: "rossmann", shopItemId: "26900" },
      ],
      unread: [],
    });
  });

  /** A product's match in Hebe, as the list reads it. */
  const hebeListRow = (watchlistItemId: string, shopItemId: string) => ({
    watchlist_item_id: watchlistItemId,
    shop_id: "hebe",
    state: "matched",
    shop_item_id: shopItemId,
    brand: "Nivea",
    size_value: 200,
    size_unit: "ml",
    decided_by: "auto",
  });
  // Felix's item in Hebe, made up: Hebe's ids are 18 digits.
  const HEBE_FELIX_ID = "000000000000131225";

  /** A product's match in Super-Pharm, as the list reads it: always the user's pick. */
  const superPharmListRow = (watchlistItemId: string, shopItemId: string) => ({
    ...hebeListRow(watchlistItemId, shopItemId),
    shop_id: "super-pharm",
    size_value: 300,
    decided_by: "user",
  });

  it("gives the stale items of every matched shop, Hebe's and Super-Pharm's too, those never checked first, then the oldest check first", async () => {
    // Nivea Soft's Hebe match was checked 3 hours ago and its Super-Pharm match an hour ago, and Felix's Hebe match
    // never.
    const { client } = stubClient({
      ...listAnswers,
      watchlist_matches: {
        data: [
          ...listAnswers.watchlist_matches.data,
          hebeListRow(SOFT_ID, HEBE_SOFT_ID),
          hebeListRow(FELIX_ID, HEBE_FELIX_ID),
          superPharmListRow(SOFT_ID, SUPER_PHARM_SOFT_ID),
        ],
      },
      latest_price_observations: {
        data: [
          ...listAnswers.latest_price_observations.data,
          latestRow("hebe", HEBE_SOFT_ID, 3 * 60 * MINUTE),
          latestRow("super-pharm", SUPER_PHARM_SOFT_ID, 60 * MINUTE),
        ],
      },
    });

    expect(await listTargets(client)).toEqual<RefreshTargets>({
      keys: [
        { shop: "hebe", shopItemId: HEBE_FELIX_ID },
        { shop: "rossmann", shopItemId: "11790" },
        { shop: "natura", shopItemId: "NV89063" },
        { shop: "hebe", shopItemId: HEBE_SOFT_ID },
        { shop: "super-pharm", shopItemId: SUPER_PHARM_SOFT_ID },
        { shop: "rossmann", shopItemId: "26900" },
      ],
      unread: [],
    });
  });

  it("gives a product picked in Natura its stale own item and Rossmann match, and nothing of a decision in Natura", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Nivea Soft picked in Rossmann, checked 20 minutes ago, beside Felix picked in Natura (NV81063), checked two days
    // ago there, and matched to Rossmann's 131225, never checked. Felix's match in Natura, its own shop, which no page
    // stores, and an odd row there, are no item of its to fetch.
    const { client } = stubClient({
      watchlist_items: { data: [listRow(SOFT_ID, "26900"), { ...listRow(FELIX_ID, "NV81063"), source: "natura" }] },
      watchlist_matches: {
        data: [
          { ...hebeListRow(FELIX_ID, "131225"), shop_id: "rossmann" },
          { ...hebeListRow(FELIX_ID, "NV00009"), shop_id: "natura" },
          { ...hebeListRow(FELIX_ID, "NV00010"), shop_id: "natura", state: "repinned" },
        ],
      },
      latest_price_observations: {
        data: [latestRow("rossmann", "26900", 20 * MINUTE), latestRow("natura", "NV81063", 2 * 24 * 60 * MINUTE)],
      },
    });

    expect(await listTargets(client)).toEqual<RefreshTargets>({
      keys: [
        { shop: "rossmann", shopItemId: "131225" },
        { shop: "natura", shopItemId: "NV81063" },
        { shop: "rossmann", shopItemId: "26900" },
      ],
      unread: [],
    });
  });

  it("leaves out only the item of the matched shop whose decision couldn't be read, and keeps the other shop's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Nivea Soft's Hebe decision came back in a state the code doesn't know; its Natura match was read.
    const { client } = stubClient({
      ...listAnswers,
      watchlist_matches: {
        data: [...listAnswers.watchlist_matches.data, { ...hebeListRow(SOFT_ID, HEBE_SOFT_ID), state: "repinned" }],
      },
    });

    expect(await listTargets(client)).toEqual<RefreshTargets>({
      keys: [
        { shop: "rossmann", shopItemId: "11790" },
        { shop: "natura", shopItemId: "NV89063" },
        { shop: "rossmann", shopItemId: "26900" },
      ],
      unread: [],
    });
  });
});
