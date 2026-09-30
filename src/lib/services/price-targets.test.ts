import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PricedShop } from "@/lib/services/price-comparison";
import { listTargets, priceRequestSchema, productTargets, shopItemFor } from "@/lib/services/price-targets";
import type { PriceKey } from "@/types";

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
  it("reads which product and which shop, and drops a shop item the body names", () => {
    expect(priceRequestSchema.parse({ itemId: SOFT_ID, shop: "natura", shopItemId: "999" })).toStrictEqual({
      itemId: SOFT_ID,
      shop: "natura",
    });
  });

  it.each([
    { why: "a product id that isn't a UUID", body: { itemId: "26900", shop: "rossmann" } },
    { why: "a shop whose prices aren't fetched", body: { itemId: SOFT_ID, shop: "hebe" } },
    { why: "no shop", body: { itemId: SOFT_ID } },
  ])("refuses $why", ({ body }) => {
    expect(priceRequestSchema.safeParse(body).success).toBe(false);
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

  it("gives none for Rossmann when the product was picked in another shop", async () => {
    const { client } = stubClient({
      watchlist_items: { data: { ...softRow, source: "hebe", source_item_id: "000000000000218807" } },
    });

    expect(await shopItemFor(client, SOFT_ID, "rossmann")).toBeNull();
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
  ])("gives failed in $shop when $why can't be read", async ({ shop, answers }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient(answers);

    expect(await shopItemFor(client, SOFT_ID, shop)).toBe("failed");
  });
});

describe("productTargets", () => {
  it("gives the product's Rossmann item and its Natura match", async () => {
    const { client } = stubClient({ watchlist_items: { data: softRow }, watchlist_matches: { data: [matchedRow] } });

    expect(await productTargets(client, SOFT_ID)).toEqual([
      { shop: "rossmann", shopItemId: "26900" },
      { shop: "natura", shopItemId: "NV89063" },
    ]);
  });

  it("gives only the Rossmann item when the product has no match in Natura", async () => {
    const { client } = stubClient({
      watchlist_items: { data: softRow },
      watchlist_matches: { data: [undecidedRow("not_found")] },
    });

    expect(await productTargets(client, SOFT_ID)).toEqual([{ shop: "rossmann", shopItemId: "26900" }]);
  });

  it("gives nothing for a product that isn't on the user's list", async () => {
    const { client } = stubClient({ watchlist_items: { data: null }, watchlist_matches: { data: [] } });

    expect(await productTargets(client, SOFT_ID)).toEqual([]);
  });

  it.each([
    { why: "the product", answers: { watchlist_items: readFailure, watchlist_matches: { data: [] } } },
    { why: "its decisions", answers: { watchlist_items: { data: softRow }, watchlist_matches: readFailure } },
  ])("gives failed when $why can't be read", async ({ answers }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient(answers);

    expect(await productTargets(client, SOFT_ID)).toBe("failed");
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
      data: [{ watchlist_item_id: SOFT_ID, shop_id: "natura", state: "matched", shop_item_id: "NV89063" }],
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

    expect(await listTargets(client)).toEqual<PriceKey[]>([
      { shop: "rossmann", shopItemId: "11790" },
      { shop: "natura", shopItemId: "NV89063" },
      { shop: "rossmann", shopItemId: "26900" },
    ]);
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

    expect(await listTargets(client)).toEqual<PriceKey[]>([
      { shop: "rossmann", shopItemId: "131225" },
      { shop: "rossmann", shopItemId: "11790" },
      { shop: "natura", shopItemId: "NV89063" },
      { shop: "rossmann", shopItemId: "26900" },
    ]);
  });

  it("doesn't refetch the Natura item of a product whose match row couldn't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      ...listAnswers,
      watchlist_matches: {
        data: [{ watchlist_item_id: SOFT_ID, shop_id: "natura", state: "repinned", shop_item_id: "NV89063" }],
      },
    });

    expect(await listTargets(client)).toEqual<PriceKey[]>([
      { shop: "rossmann", shopItemId: "11790" },
      { shop: "rossmann", shopItemId: "26900" },
    ]);
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

    expect(await listTargets(client)).toEqual<PriceKey[]>([
      { shop: "rossmann", shopItemId: "131225" },
      { shop: "rossmann", shopItemId: "11790" },
      { shop: "natura", shopItemId: "NV89063" },
      { shop: "rossmann", shopItemId: "26900" },
    ]);
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
    expect(await listTargets(client)).toEqual<PriceKey[]>([
      { shop: "rossmann", shopItemId: "11790" },
      { shop: "natura", shopItemId: "NV89063" },
      { shop: "rossmann", shopItemId: "26900" },
    ]);
  });
});
