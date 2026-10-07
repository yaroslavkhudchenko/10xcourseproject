import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listLatestPrices, readLatestPrices, recordPriceChecks } from "@/lib/services/prices";
import type { LatestPrice, PriceHistory, PriceKey, ShopOffer } from "@/types";

// Felix at Rossmann during a promotion, and Nivea Soft at Natura, with the offers the 2026-09-28 requests answered
// (research, Follow-up requests 1 and 4), and a second Natura item.
const FELIX: PriceKey = { shop: "rossmann", shopItemId: "131225" };
const SOFT: PriceKey = { shop: "natura", shopItemId: "NV89063" };
const OTHER: PriceKey = { shop: "natura", shopItemId: "NV81063" };

const felixOffer: ShopOffer = {
  price: 5.99,
  regularPrice: 9.99,
  lowestPrice30d: 6.39,
  promoEndsOn: "2026-09-30",
  available: true,
};
const softOffer: ShopOffer = {
  price: 16.99,
  regularPrice: 22.99,
  lowestPrice30d: 17.99,
  promoEndsOn: null,
  available: true,
};

// The rows the inserts carry: what the check found, and nothing the database sets itself.
const FELIX_PRICE_ROW = {
  shop_id: "rossmann",
  shop_item_id: "131225",
  status: "price",
  price: 5.99,
  regular_price: 9.99,
  lowest_price_30d: 6.39,
  promo_ends_on: "2026-09-30",
  available: true,
};
const SOFT_PRICE_ROW = {
  shop_id: "natura",
  shop_item_id: "NV89063",
  status: "price",
  price: 16.99,
  regular_price: 22.99,
  lowest_price_30d: 17.99,
  promo_ends_on: null,
  available: true,
};
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

/** One builder call a query made, such as `["in", "shop_item_id", ["131225"]]`. */
type Call = [method: string, ...args: unknown[]];

interface Answer {
  data?: unknown;
  // An answer that isn't PostgREST's own, such as a gateway's HTML page, comes back without a code.
  error?: { code?: string; message: string };
}

interface QueryStub {
  insert: (rows: unknown) => QueryStub;
  select: (columns: string) => QueryStub;
  in: (column: string, values: unknown[]) => QueryStub;
  abortSignal: (signal: AbortSignal) => Promise<{ data: unknown; error: Answer["error"] | null }>;
}

/**
 * A client whose queries get `answers` in turn. Every builder call is recorded, so a test sees each query's table,
 * rows, filters and time limit: a query ends with `["abortSignal", true]` when it was given an AbortSignal.
 */
function stubClient(...answers: Answer[]) {
  const queries: Call[][] = [];
  const from = (table: string): QueryStub => {
    const answer = answers.at(queries.length) ?? { error: { code: "stub", message: "no answer for this query" } };
    const calls: Call[] = [["from", table]];
    queries.push(calls);
    const query: QueryStub = {
      insert: (rows) => {
        calls.push(["insert", rows]);
        return query;
      },
      select: (columns) => {
        calls.push(["select", columns]);
        return query;
      },
      in: (column, values) => {
        calls.push(["in", column, values]);
        return query;
      },
      abortSignal: (signal) => {
        calls.push(["abortSignal", signal instanceof AbortSignal]);
        return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
      },
    };
    return query;
  };
  return { client: { from } as unknown as SupabaseClient, queries };
}

/** The one log line a test expects, parsed. */
function loggedLine(warn: { mock: { calls: unknown[][] } }): unknown {
  expect(warn.mock.calls).toHaveLength(1);
  return JSON.parse(String(warn.mock.calls[0][0]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordPriceChecks", () => {
  it("stores a price and a missing item with a single insert, within a time limit", async () => {
    const { client, queries } = stubClient({});

    const result = await recordPriceChecks(client, [
      { key: FELIX, check: { kind: "price", offer: felixOffer } },
      { key: SOFT, check: { kind: "missing" } },
    ]);

    expect(result).toBe("saved");
    expect(queries).toEqual([
      [
        ["from", "price_observations"],
        ["insert", [FELIX_PRICE_ROW, missingRow(SOFT)]],
        ["abortSignal", true],
      ],
    ]);
  });

  it("leaves the time, source and recording user to the database, with the same columns in every row", async () => {
    const { client, queries } = stubClient({});

    await recordPriceChecks(client, [
      { key: FELIX, check: { kind: "price", offer: felixOffer } },
      { key: SOFT, check: { kind: "missing" } },
      { key: OTHER, check: { kind: "price", offer: { ...softOffer, regularPrice: null, lowestPrice30d: null } } },
    ]);

    expect(queries).toHaveLength(1);
    const [, [method, rows]] = queries[0];
    expect(method).toBe("insert");
    expect(rows).toHaveLength(3);
    for (const row of rows as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(Object.keys(FELIX_PRICE_ROW).sort());
      for (const column of ["id", "observed_at", "source", "recorded_by"]) {
        expect(row).not.toHaveProperty(column);
      }
    }
  });

  it("serves several checks with one insert, leaving out the shops that gave no answer", async () => {
    const { client, queries } = stubClient({});

    const result = await recordPriceChecks(client, [
      { key: FELIX, check: { kind: "unavailable", reason: "busy" } },
      { key: SOFT, check: { kind: "price", offer: softOffer } },
      { key: OTHER, check: { kind: "missing" } },
    ]);

    expect(result).toBe("saved");
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContainEqual(["insert", [SOFT_PRICE_ROW, missingRow(OTHER)]]);
  });

  it("sends nothing when no shop gave an answer, or there are no checks", async () => {
    const { client, queries } = stubClient();

    const result = await recordPriceChecks(client, [
      { key: FELIX, check: { kind: "unavailable", reason: "stopped" } },
      { key: SOFT, check: { kind: "unavailable", reason: "paused", until: "2026-09-28T02:00:00.000Z" } },
    ]);

    expect(result).toBe("none");
    expect(await recordPriceChecks(client, [])).toBe("none");
    expect(queries).toEqual([]);
  });

  it.each<{ answer: string; error: NonNullable<Answer["error"]>; detail: string }>([
    {
      answer: "a refusal by RLS",
      error: { code: "42501", message: 'new row violates row-level security policy for table "price_observations"' },
      detail: "42501",
    },
    {
      answer: "a check that refuses a row",
      error: {
        code: "23514",
        message: 'new row for relation "price_observations" violates check constraint: (natura, NV89063, price, 0.00)',
      },
      detail: "23514",
    },
    { answer: "a timeout", error: { code: "", message: "AbortError: This operation was aborted" }, detail: "no code" },
    { answer: "an answer without a code", error: { message: "<html>502 Bad Gateway</html>" }, detail: "no code" },
  ])("reports $answer as failed, and logs only its code", async ({ error, detail }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ error });

    const result = await recordPriceChecks(client, [{ key: SOFT, check: { kind: "price", offer: softOffer } }]);

    expect(result).toBe("failed");
    expect(loggedLine(warn)).toEqual({ event: "price-observations", reason: "insert failed", detail });
  });
});

// The view's columns, and its rows for the three items, with the latest states they read as.
const COLUMNS =
  "shop_id, shop_item_id, last_checked_at, last_status, price, regular_price, lowest_price_30d, promo_ends_on, " +
  "available, priced_at";
const CHECKED_AT = "2026-09-28T00:32:10.123456+00:00";
const PRICED_AT = "2026-09-27T20:04:06.654321+00:00";

// Felix, last checked with a price.
const felixRow = {
  shop_id: "rossmann",
  shop_item_id: "131225",
  last_checked_at: CHECKED_AT,
  last_status: "price",
  price: 5.99,
  regular_price: 9.99,
  lowest_price_30d: 6.39,
  promo_ends_on: "2026-09-30",
  available: true,
  priced_at: CHECKED_AT,
};
const felix: LatestPrice = {
  ...FELIX,
  lastCheckedAt: CHECKED_AT,
  lastStatus: "price",
  offer: { ...felixOffer, pricedAt: CHECKED_AT },
  history: null,
};
// Nivea Soft, last checked when Natura answered without it: the price from before stays, with its own time.
const softRow = {
  shop_id: "natura",
  shop_item_id: "NV89063",
  last_checked_at: CHECKED_AT,
  last_status: "missing",
  price: 16.99,
  regular_price: 22.99,
  lowest_price_30d: 17.99,
  promo_ends_on: null,
  available: true,
  priced_at: PRICED_AT,
};
const soft: LatestPrice = {
  ...SOFT,
  lastCheckedAt: CHECKED_AT,
  lastStatus: "missing",
  offer: { ...softOffer, pricedAt: PRICED_AT },
  history: null,
};
// An item no check has found a price for.
const otherRow = {
  shop_id: "natura",
  shop_item_id: "NV81063",
  last_checked_at: CHECKED_AT,
  last_status: "missing",
  price: null,
  regular_price: null,
  lowest_price_30d: null,
  promo_ends_on: null,
  available: null,
  priced_at: null,
};
const other: LatestPrice = { ...OTHER, lastCheckedAt: CHECKED_AT, lastStatus: "missing", offer: null, history: null };

// The product page's view gives the same columns with each item's history of the 30 days before today: Felix's lowest
// orderable price and the days it was seen on, and no low and no day for Nivea Soft, which no check found orderable.
const SUMMARY_COLUMNS = `${COLUMNS}, history_low, history_days`;
const felixSummaryRow = { ...felixRow, history_low: 5.49, history_days: ["2026-09-25", "2026-09-27"] };
const softSummaryRow = { ...softRow, history_low: null, history_days: [] };
const felixHistory: PriceHistory = { low: 5.49, days: ["2026-09-25", "2026-09-27"] };
const felixWithHistory: LatestPrice = { ...felix, history: felixHistory };
// A history the view read and found empty, which is never one that wasn't read (null).
const softWithoutHistory: LatestPrice = { ...soft, history: { low: null, days: [] } };

describe("listLatestPrices", () => {
  it("reads every item the user can see for the list, with one unfiltered query within a time limit", async () => {
    const { client, queries } = stubClient({ data: [felixRow, softRow, otherRow] });

    // The list judges no price, so it reads no history, and its prices say none was read.
    expect(await listLatestPrices(client)).toEqual({ prices: [felix, soft, other], unread: [], unattributed: 0 });
    expect(queries).toEqual([
      [
        ["from", "latest_price_observations"],
        ["select", COLUMNS],
        ["abortSignal", true],
      ],
    ]);
  });

  it.each<{ why: string; row: Record<string, unknown>; key: PriceKey; prices: LatestPrice[] }>([
    {
      why: "a time that doesn't parse",
      row: { ...felixRow, last_checked_at: "wczoraj" },
      key: FELIX,
      prices: [soft, other],
    },
    { why: "a price as text", row: { ...felixRow, price: "5.99" }, key: FELIX, prices: [soft, other] },
    {
      why: "a promotion's end that isn't a date",
      row: { ...felixRow, promo_ends_on: "30.09.2026" },
      key: FELIX,
      prices: [soft, other],
    },
    {
      why: "a last check that found a price, but no price",
      row: { ...otherRow, last_status: "price" },
      key: OTHER,
      prices: [felix, soft],
    },
    {
      why: "a price without the time it was fetched",
      row: { ...softRow, priced_at: null },
      key: SOFT,
      prices: [felix, other],
    },
  ])(
    "reports the item of a row with $why as unread, and still gives the other prices",
    async ({ row, key, prices }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const rows = [felixRow, softRow, otherRow].map((each) => (each.shop_item_id === row.shop_item_id ? row : each));
      const { client } = stubClient({ data: rows });

      // The list then says the item's price couldn't be read, never that the item was never checked.
      expect(await listLatestPrices(client)).toEqual({ prices, unread: [key], unattributed: 0 });
      expect(loggedLine(warn)).toMatchObject({ reason: "unexpected rows dropped", detail: "1" });
    },
  );

  it("reports every item whose row it couldn't read, in the order they came", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ data: [{ ...otherRow, available: false }, felixRow, { ...softRow, price: 0 }] });

    expect(await listLatestPrices(client)).toEqual({ prices: [felix], unread: [OTHER, SOFT], unattributed: 0 });
  });

  it.each<{ why: string; row: unknown }>([
    { why: "names no shop", row: { ...felixRow, shop_id: null } },
    { why: "has a shop that isn't text", row: { ...felixRow, shop_id: 42 } },
    { why: "has an item id that isn't text", row: { ...felixRow, shop_item_id: 131225 } },
    { why: "isn't a row at all", row: "131225" },
  ])("counts an odd row that $why, which could be any item's, and still gives every other price", async ({ row }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ data: [row, softRow, otherRow] });

    // One such row never empties the list: the list marks only the items it has no readable row for.
    expect(await listLatestPrices(client)).toEqual({ prices: [soft, other], unread: [], unattributed: 1 });
    expect(loggedLine(warn)).toMatchObject({ reason: "unexpected rows dropped", detail: "1" });
  });

  // Every shop the app knows is priced, so only a shop it doesn't know, such as dm, is one whose prices the list
  // doesn't compare.
  it.each<{ why: string; row: unknown }>([
    { why: "a shop the app doesn't know", row: { ...felixRow, shop_id: "dm" } },
    {
      why: "a shop the app doesn't know, with an item id that isn't text",
      row: { ...felixRow, shop_id: "dm", shop_item_id: 131225 },
    },
  ])("leaves out an odd row of $why, which can't be any product's price, and logs it", async ({ row }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ data: [row, softRow, otherRow] });

    expect(await listLatestPrices(client)).toEqual({ prices: [soft, other], unread: [], unattributed: 0 });
    expect(loggedLine(warn)).toMatchObject({ reason: "unexpected rows dropped", detail: "1" });
  });

  it.each<{ shop: "hebe" | "super-pharm"; shopItemId: string }>([
    { shop: "hebe", shopItemId: "000000000000218807" },
    { shop: "super-pharm", shopItemId: "10132" },
  ])(
    "reports an odd row of $shop's, whose prices the list compares, as its item's unread price, and logs it",
    async ({ shop, shopItemId }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const shopRow = { ...felixRow, shop_id: shop, shop_item_id: shopItemId, price: "15.99" };
      const { client } = stubClient({ data: [shopRow, softRow, otherRow] });

      // The list then says that item's price couldn't be read, never that it was never checked.
      expect(await listLatestPrices(client)).toEqual({
        prices: [soft, other],
        unread: [{ shop, shopItemId }],
        unattributed: 0,
      });
      expect(loggedLine(warn)).toMatchObject({ reason: "unexpected rows dropped", detail: "1" });
    },
  );

  it.each<{ answer: string; result: Answer; detail: string }>([
    {
      answer: "a failed query",
      result: { error: { code: "PGRST100", message: 'failed to parse select (131225,NV89063"' } },
      detail: "PGRST100",
    },
    { answer: "an answer that isn't a list", result: { data: { rows: [] } }, detail: "object" },
  ])("gives null for $answer, and logs it without the query's items", async ({ result, detail }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient(result);

    expect(await listLatestPrices(client)).toBeNull();
    expect(loggedLine(warn)).toMatchObject({ event: "price-observations", detail });
  });
});

describe("readLatestPrices", () => {
  it("reads a product page's items with their history, in one filtered query within a time limit", async () => {
    const { client, queries } = stubClient({ data: [felixSummaryRow, softSummaryRow] });

    expect(await readLatestPrices(client, [FELIX, SOFT])).toEqual({
      prices: [felixWithHistory, softWithoutHistory],
      unread: [],
    });
    expect(queries).toEqual([
      [
        ["from", "price_summaries"],
        ["select", SUMMARY_COLUMNS],
        ["in", "shop_item_id", ["131225", "NV89063"]],
        ["abortSignal", true],
      ],
    ]);
  });

  it("reports an item whose row it couldn't read, and still gives the other prices", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ data: [{ ...felixSummaryRow, available: "yes" }, softSummaryRow] });

    // The page then says Felix's price couldn't be read, never that Felix was never checked.
    expect(await readLatestPrices(client, [FELIX, SOFT])).toEqual({ prices: [softWithoutHistory], unread: [FELIX] });
    expect(loggedLine(warn)).toMatchObject({ reason: "unexpected rows dropped", detail: "1" });
  });

  it.each<{ why: string; row: Record<string, unknown> }>([
    { why: "no history columns", row: felixRow },
    { why: "a history low as text", row: { ...felixSummaryRow, history_low: "5.49" } },
    { why: "a history low of 0", row: { ...felixSummaryRow, history_low: 0 } },
    { why: "history days that aren't a list", row: { ...felixSummaryRow, history_days: "2026-09-25" } },
    { why: "no list of history days", row: { ...felixSummaryRow, history_days: null } },
    { why: "a history day that isn't a date", row: { ...felixSummaryRow, history_days: ["25.09.2026"] } },
    { why: "a time among its history days", row: { ...felixSummaryRow, history_days: ["2026-09-25T10:00:00+00:00"] } },
    { why: "a history low without a day", row: { ...felixSummaryRow, history_days: [] } },
    { why: "history days without a low", row: { ...felixSummaryRow, history_low: null } },
  ])("keeps an item's price, its history unread, when its row has $why, and logs it", async ({ row }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ data: [row, softSummaryRow] });

    // Felix's price is the one the list shows, so both pages give it the same verdict, and the judgement never speaks
    // of a history the page couldn't read (the owner's call, 2026-10-07).
    expect(await readLatestPrices(client, [FELIX, SOFT])).toEqual({
      prices: [{ ...felixWithHistory, history: null }, softWithoutHistory],
      unread: [],
    });
    expect(loggedLine(warn)).toMatchObject({ reason: "history unread", detail: "rossmann" });
  });

  it("leaves out an odd row of another shop's item with the same id", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      data: [felixSummaryRow, { ...felixSummaryRow, shop_id: "natura", price: "5.99" }],
    });

    expect(await readLatestPrices(client, [FELIX])).toEqual({ prices: [felixWithHistory], unread: [] });
  });

  it.each<{ why: string; row: unknown }>([
    { why: "names no shop", row: { ...felixSummaryRow, shop_id: null } },
    { why: "names a shop the app doesn't know", row: { ...felixSummaryRow, shop_id: "dm" } },
    { why: "has an item id that isn't text", row: { ...felixSummaryRow, shop_item_id: 131225 } },
    { why: "isn't a row at all", row: "131225" },
  ])("gives null for an odd row that $why, since it could be any item's", async ({ row }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ data: [row, softSummaryRow] });

    expect(await readLatestPrices(client, [FELIX, SOFT])).toBeNull();
    expect(loggedLine(warn)).toMatchObject({ reason: "unexpected rows dropped", detail: "1" });
  });

  it("reads nothing for an empty list of items", async () => {
    const { client, queries } = stubClient();

    expect(await readLatestPrices(client, [])).toEqual({ prices: [], unread: [] });
    expect(queries).toEqual([]);
  });

  it("gives null when the query fails, and logs it without the query's items", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ error: { code: "PGRST100", message: 'failed to parse filter (in.(131225"' } });

    expect(await readLatestPrices(client, [FELIX, SOFT])).toBeNull();
    expect(loggedLine(warn)).toMatchObject({ event: "price-observations", detail: "PGRST100" });
  });
});
