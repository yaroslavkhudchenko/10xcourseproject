import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  listMatches,
  listMatchStates,
  MATCH_ERRORS,
  matchErrorMessage,
  parseMatchForm,
  recordDecision,
  recordLookup,
} from "@/lib/services/matches";
import { createShopGate } from "@/lib/services/shop-gate";
import eanHit from "@/lib/services/shops/fixtures/natura-ean-hit.json";
import eanMiss from "@/lib/services/shops/fixtures/natura-ean-miss.json";
import nameSearch from "@/lib/services/shops/fixtures/natura-name-search.json";
import unknownTracker from "@/lib/services/shops/fixtures/natura-unknown-tracker.json";
import { searchNatura } from "@/lib/services/shops/natura";
import { createReplayFetch } from "@/lib/services/testing/replay-fetch";
import type { MatchedItem, ShopCandidate } from "@/types";

const ITEM_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const OTHER_ITEM_ID = "4f1c2a8e-5b7d-4c3e-9a1f-0d2b3c4e5f60";
const THIRD_ITEM_ID = "7d3e8b1a-2c4f-4e6a-8b9c-1d2e3f4a5b6c";
const SOFT_EAN = "4005900009319";
// An EAN Natura doesn't list, as natura-ean-miss.json recorded.
const MISSING_EAN = "5901234123457";
const NOW = "2026-09-27T20:00:00.000Z";

// Natura's Nivea Soft 300 ml, as the adapter maps the recorded EAN hit (natura-ean-hit.json).
const soft: ShopCandidate = {
  shop: "natura",
  shopItemId: "NV89063",
  brand: "NIVEA",
  name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
  sizeText: "300 ml",
  size: { value: 300, unit: "ml" },
  eans: [SOFT_EAN],
  productUrl: "https://drogerienatura.pl/produkt/nivea-soft-krem-intensywnie-nawilzajacy-300-ml-4005900009319",
  imageUrl:
    "https://media.drogerienatura.pl/catalog/product/4/0/4005900009319_T1_a685.jpg?store=default&image-type=image",
  offer: { price: 16.99, regularPrice: 22.99, lowestPrice30d: 17.99, promoEndsOn: null, available: true },
};

// The columns of Natura's Nivea Soft in a match row, and of a row that carries no item.
const SOFT_COLUMNS = {
  shop_item_id: "NV89063",
  name: soft.name,
  brand: "NIVEA",
  size_text: "300 ml",
  size_value: 300,
  size_unit: "ml",
  eans: [SOFT_EAN],
  product_url: soft.productUrl,
  image_url: soft.imageUrl,
};
const NO_ITEM_COLUMNS = {
  shop_item_id: null,
  name: null,
  brand: null,
  size_text: null,
  size_value: null,
  size_unit: null,
  eans: [],
  product_url: null,
  image_url: null,
};

/** What a confirmed candidate is stored as: the item the shop showed, without its offer. */
function itemOf({ shop: _shop, offer: _offer, ...item }: ShopCandidate): MatchedItem {
  return item;
}

/** The fields of the "To ten produkt" form `src/pages/watchlist/[id].astro` renders for one candidate. */
function confirmFields(candidate: ShopCandidate): Record<string, string | string[]> {
  return {
    itemId: ITEM_ID,
    shop: "natura",
    action: "confirm",
    shopItemId: candidate.shopItemId,
    name: candidate.name,
    brand: candidate.brand ?? "",
    sizeText: candidate.sizeText ?? "",
    eans: candidate.eans,
    productUrl: candidate.productUrl ?? "",
    imageUrl: candidate.imageUrl ?? "",
  };
}

/** The fields of the page's "Żaden z nich" form. */
const declineFields = { itemId: ITEM_ID, shop: "natura", action: "decline" };

function formOf(fields: Record<string, string | string[]>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      form.append(key, entry);
    }
  }
  return form;
}

/** Every URL the fetch was asked for: a miss would look like a network failure, so the test checks its requests. */
function requestedUrls(fetchMock: Mock<typeof fetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : new URL(input).href));
}

/** One builder call a query made, such as `["eq", "shop_id", "natura"]`. */
type Call = [method: string, ...args: unknown[]];

interface Answer {
  data?: unknown;
  error?: { code: string; message: string };
}

interface QueryStub {
  insert: (row: unknown) => QueryStub;
  update: (fields: unknown) => QueryStub;
  select: (columns: string) => QueryStub;
  eq: (column: string, value: unknown) => QueryStub;
  abortSignal: (signal: AbortSignal) => Promise<{ data: unknown; error: Answer["error"] | null }>;
}

/**
 * A client whose queries get `answers` in turn. Every builder call is recorded, so a test sees each query's table,
 * row, filters and time limit: a query ends with `["abortSignal", true]` when it was given an AbortSignal.
 */
function stubClient(...answers: Answer[]) {
  const queries: Call[][] = [];
  const from = (table: string): QueryStub => {
    const answer = answers.at(queries.length) ?? { error: { code: "stub", message: "no answer for this query" } };
    const calls: Call[] = [["from", table]];
    queries.push(calls);
    const query: QueryStub = {
      insert: (row) => {
        calls.push(["insert", row]);
        return query;
      },
      update: (fields) => {
        calls.push(["update", fields]);
        return query;
      },
      select: (columns) => {
        calls.push(["select", columns]);
        return query;
      },
      eq: (column, value) => {
        calls.push(["eq", column, value]);
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

const insertInto = (row: Record<string, unknown>): Call[] => [
  ["from", "watchlist_matches"],
  ["insert", row],
  ["abortSignal", true],
];

// The update that only a lookup that found nothing lets through, asking for the changed rows back.
const updateNotFound = (fields: Record<string, unknown>): Call[] => [
  ["from", "watchlist_matches"],
  ["update", { ...fields, checked_at: NOW }],
  ["eq", "watchlist_item_id", ITEM_ID],
  ["eq", "shop_id", "natura"],
  ["eq", "state", "not_found"],
  ["select", "id"],
  ["abortSignal", true],
];

const duplicate = { error: { code: "23505", message: "duplicate key value violates unique constraint" } };

beforeEach(() => {
  // Only the clock the update's checked_at is read from; the queries' time limits keep their real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parseMatchForm", () => {
  it("accepts the confirm form the page posts", () => {
    expect(parseMatchForm(formOf(confirmFields(soft)))).toEqual({
      itemId: ITEM_ID,
      shop: "natura",
      decision: { action: "confirm", item: itemOf(soft) },
    });
  });

  it("accepts the decline form, which carries no candidate", () => {
    expect(parseMatchForm(formOf(declineFields))).toEqual({
      itemId: ITEM_ID,
      shop: "natura",
      decision: { action: "decline" },
    });
  });

  it("parses the size again from its text, and turns empty fields into null", () => {
    const form = formOf({
      ...confirmFields(soft),
      sizeText: "0,5 l",
      brand: " ",
      productUrl: "",
      imageUrl: "",
      eans: [],
    });
    // Not a form field: size numbers are never taken from the form.
    form.append("size_value", "999");

    expect(parseMatchForm(form)).toMatchObject({
      decision: {
        item: {
          brand: null,
          sizeText: "0,5 l",
          size: { value: 500, unit: "ml" },
          eans: [],
          productUrl: null,
          imageUrl: null,
        },
      },
    });
  });

  it.each<{ field: string; overrides: Record<string, string | string[]> }>([
    { field: "a product id that isn't a UUID", overrides: { itemId: "not-a-uuid" } },
    { field: "a shop other than Natura", overrides: { shop: "rossmann" } },
    { field: "an unknown action", overrides: { action: "repin" } },
    { field: "a plain-http product link", overrides: { productUrl: "http://drogerienatura.pl/produkt/nivea-soft" } },
    {
      field: "a product link on another host",
      overrides: { productUrl: "https://drogerienatura.pl.example.com/produkt/nivea-soft" },
    },
    { field: "an image off Natura's image host", overrides: { imageUrl: "https://drogerienatura.pl/nivea-soft.jpg" } },
    { field: "a shop item id with a path in it", overrides: { shopItemId: "NV89063/../koszyk" } },
    { field: "an empty name", overrides: { name: "   " } },
    { field: "a name over 300 characters", overrides: { name: "x".repeat(301) } },
    { field: "an EAN that isn't 8-14 digits", overrides: { eans: ["12345"] } },
    {
      field: "more than 10 EANs",
      overrides: { eans: Array.from({ length: 11 }, (_, i) => String(5900000000000 + i)) },
    },
  ])("rejects $field", ({ overrides }) => {
    expect(parseMatchForm(formOf({ ...confirmFields(soft), ...overrides }))).toBeNull();
  });

  it.each<{ field: string; overrides: Record<string, string> }>([
    { field: "a product id that isn't a UUID", overrides: { itemId: "00000000" } },
    { field: "a shop other than Natura", overrides: { shop: "hebe" } },
  ])("rejects a decline with $field", ({ overrides }) => {
    expect(parseMatchForm(formOf({ ...declineFields, ...overrides }))).toBeNull();
  });

  it("accepts every candidate the adapter makes from the recordings, posted the way the page posts it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const searchUrl = (query: string, size: number) =>
      `https://live.luigisbox.com/search?tracker_id=703598-939363&q=${encodeURIComponent(query)}&size=${size}`;
    const recordings = [
      { query: SOFT_EAN, size: 5, status: 200, body: JSON.stringify(eanHit) },
      { query: MISSING_EAN, size: 5, status: 200, body: JSON.stringify(eanMiss) },
      { query: "nivea soft 300 ml", size: 10, status: 200, body: JSON.stringify(nameSearch) },
      // Luigi's Box's answer to a tracker id it doesn't know: no candidates at all.
      {
        query: "nivea",
        size: 5,
        status: unknownTracker.status,
        headers: { "Content-Type": unknownTracker.contentType },
        body: unknownTracker.body,
      },
    ];

    const candidates: ShopCandidate[] = [];
    for (const { query, size, ...answer } of recordings) {
      const url = searchUrl(query, size);
      const fetchMock = vi.fn(createReplayFetch([{ url, ...answer }]));
      const gate = createShopGate({
        reserve: () => Promise.resolve({ outcome: "allowed" }),
        reportBlock: () => Promise.resolve(),
        fetch: fetchMock,
        log: () => undefined,
      });
      const search = await searchNatura(gate, query, size);
      expect(requestedUrls(fetchMock)).toEqual([url]);
      if (search.kind === "results") {
        candidates.push(...search.candidates);
      }
    }

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual(["NV89063", "NV89063", "JM00370", "NV81063"]);
    for (const candidate of candidates) {
      // The stored item is exactly the one the page showed, its size included.
      expect(parseMatchForm(formOf(confirmFields(candidate))), candidate.shopItemId).toEqual({
        itemId: ITEM_ID,
        shop: "natura",
        decision: { action: "confirm", item: itemOf(candidate) },
      });
    }
  });
});

describe("matchErrorMessage", () => {
  it("gives the page's own text for each error code", () => {
    for (const [code, message] of Object.entries(MATCH_ERRORS)) {
      expect(matchErrorMessage(code)).toBe(message);
    }
  });

  it.each([null, "", "Kliknij tutaj, by odebrać nagrodę", "toString", "__proto__"])(
    "shows nothing for %j, which the app never sends",
    (code) => {
      expect(matchErrorMessage(code)).toBeNull();
    },
  );
});

describe("recordDecision", () => {
  it("stores a confirmed candidate as the user's match, within a time limit", async () => {
    const { client, queries } = stubClient({});

    const result = await recordDecision(client, ITEM_ID, "natura", { action: "confirm", item: itemOf(soft) });

    expect(result).toBe("saved");
    expect(queries).toEqual([
      insertInto({
        watchlist_item_id: ITEM_ID,
        shop_id: "natura",
        state: "matched",
        decided_by: "user",
        ...SOFT_COLUMNS,
      }),
    ]);
  });

  it("stores a decline without any item", async () => {
    const { client, queries } = stubClient({});

    expect(await recordDecision(client, ITEM_ID, "natura", { action: "decline" })).toBe("saved");
    expect(queries).toEqual([
      insertInto({
        watchlist_item_id: ITEM_ID,
        shop_id: "natura",
        state: "unmatched",
        decided_by: "user",
        ...NO_ITEM_COLUMNS,
      }),
    ]);
  });

  it("turns a lookup that found nothing into the user's decision", async () => {
    const { client, queries } = stubClient(duplicate, { data: [{ id: "c0ffee00-0000-4000-8000-000000000001" }] });

    expect(await recordDecision(client, ITEM_ID, "natura", { action: "decline" })).toBe("saved");
    const declined = { state: "unmatched", decided_by: "user", ...NO_ITEM_COLUMNS };
    expect(queries).toEqual([
      insertInto({ watchlist_item_id: ITEM_ID, shop_id: "natura", ...declined }),
      updateNotFound(declined),
    ]);
  });

  it("reports a product that was already decided, as after a double submit, and changes nothing", async () => {
    // RLS filters a decided row out of the update without an error: no row comes back.
    const { client, queries } = stubClient(duplicate, { data: [] });

    const result = await recordDecision(client, ITEM_ID, "natura", { action: "confirm", item: itemOf(soft) });

    expect(result).toBe("decided");
    const confirmed = { state: "matched", decided_by: "user", ...SOFT_COLUMNS };
    expect(queries).toEqual([
      insertInto({ watchlist_item_id: ITEM_ID, shop_id: "natura", ...confirmed }),
      updateNotFound(confirmed),
    ]);
  });

  it("reports a product that isn't on the user's list, without an update", async () => {
    const { client, queries } = stubClient({
      error: { code: "23503", message: 'violates foreign key constraint "watchlist_matches_own_product"' },
    });

    expect(await recordDecision(client, ITEM_ID, "natura", { action: "decline" })).toBe("gone");
    expect(queries).toEqual([
      insertInto({
        watchlist_item_id: ITEM_ID,
        shop_id: "natura",
        state: "unmatched",
        decided_by: "user",
        ...NO_ITEM_COLUMNS,
      }),
    ]);
  });

  it.each<{ answer: string; answers: Answer[] }>([
    {
      answer: "a failed insert",
      answers: [{ error: { code: "42501", message: "permission denied for table watchlist_matches" } }],
    },
    { answer: "a failed update", answers: [duplicate, { error: { code: "57014", message: "canceling statement" } }] },
    { answer: "an update answer that isn't a list", answers: [duplicate, { data: { id: ITEM_ID } }] },
  ])("reports $answer, and logs it", async ({ answers }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient(...answers);

    expect(await recordDecision(client, ITEM_ID, "natura", { action: "decline" })).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("recordLookup", () => {
  it("stores an accepted candidate as an automatic match, without its price", async () => {
    const { client, queries } = stubClient({});

    expect(await recordLookup(client, ITEM_ID, "natura", { kind: "accepted", candidate: soft })).toBe("saved");
    expect(queries).toEqual([
      insertInto({
        watchlist_item_id: ITEM_ID,
        shop_id: "natura",
        state: "matched",
        decided_by: "auto",
        ...SOFT_COLUMNS,
      }),
    ]);
  });

  it("stores a lookup that found nothing", async () => {
    const { client, queries } = stubClient({});

    expect(await recordLookup(client, ITEM_ID, "natura", { kind: "not-found" })).toBe("saved");
    expect(queries).toEqual([
      insertInto({
        watchlist_item_id: ITEM_ID,
        shop_id: "natura",
        state: "not_found",
        decided_by: "auto",
        ...NO_ITEM_COLUMNS,
      }),
    ]);
  });

  it("stores a retry's match over the lookup that found nothing, with a new check time", async () => {
    const { client, queries } = stubClient(duplicate, { data: [{ id: "c0ffee00-0000-4000-8000-000000000001" }] });

    expect(await recordLookup(client, ITEM_ID, "natura", { kind: "accepted", candidate: soft })).toBe("saved");
    const matched = { state: "matched", decided_by: "auto", ...SOFT_COLUMNS };
    expect(queries).toEqual([
      insertInto({ watchlist_item_id: ITEM_ID, shop_id: "natura", ...matched }),
      updateNotFound(matched),
    ]);
  });
});

describe("listMatches", () => {
  const CHECKED_AT = "2026-09-27T19:45:12.345678+00:00";
  const matchedRow = {
    watchlist_item_id: ITEM_ID,
    shop_id: "natura",
    state: "matched",
    decided_by: "auto",
    ...SOFT_COLUMNS,
    checked_at: CHECKED_AT,
  };
  const declinedRow = {
    watchlist_item_id: OTHER_ITEM_ID,
    shop_id: "natura",
    state: "unmatched",
    decided_by: "user",
    ...NO_ITEM_COLUMNS,
    checked_at: CHECKED_AT,
  };
  const matched = {
    watchlistItemId: ITEM_ID,
    shop: "natura",
    decidedBy: "auto",
    checkedAt: CHECKED_AT,
    state: "matched",
    item: itemOf(soft),
  };
  const declined = {
    watchlistItemId: OTHER_ITEM_ID,
    shop: "natura",
    decidedBy: "user",
    checkedAt: CHECKED_AT,
    state: "unmatched",
    item: null,
  };

  it("reads one product's decisions, within a time limit", async () => {
    const { client, queries } = stubClient({ data: [matchedRow] });

    expect(await listMatches(client, ITEM_ID)).toEqual([matched]);
    expect(queries).toHaveLength(1);
    const [calls] = queries;
    expect(calls.map(([method]) => method)).toEqual(["from", "select", "eq", "abortSignal"]);
    expect(calls).toContainEqual(["from", "watchlist_matches"]);
    expect(calls).toContainEqual(["eq", "watchlist_item_id", ITEM_ID]);
    expect(calls).toContainEqual(["abortSignal", true]);
  });

  it("reads the whole list's decisions with one query", async () => {
    const { client, queries } = stubClient({ data: [matchedRow, declinedRow] });

    expect(await listMatches(client)).toEqual([matched, declined]);
    expect(queries).toHaveLength(1);
    expect(queries[0].map(([method]) => method)).toEqual(["from", "select", "abortSignal"]);
  });

  it("drops odd rows from the whole list and keeps the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      data: [
        { ...matchedRow, shop_item_id: null },
        { ...declinedRow, shop_id: "dm" },
        { ...declinedRow, checked_at: "wczoraj" },
        matchedRow,
        declinedRow,
      ],
    });

    expect(await listMatches(client)).toEqual([matched, declined]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("gives null for one product when any of its rows is odd, so its page doesn't look the product up again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A state a later migration might add before the code knows it, next to a decision that parses.
    const { client } = stubClient({
      data: [
        { ...matchedRow, state: "repinned" },
        { ...declinedRow, watchlist_item_id: ITEM_ID, shop_id: "hebe" },
      ],
    });

    expect(await listMatches(client, ITEM_ID)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toMatchObject({ reason: "unexpected rows dropped", detail: "1" });
  });

  it.each<{ answer: string; result: Answer }>([
    { answer: "a failed query", result: { error: { code: "42501", message: "permission denied" } } },
    { answer: "an answer that isn't a list", result: { data: { rows: [] } } },
  ])("gives null for $answer", async ({ result }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient(result);

    expect(await listMatches(client)).toBeNull();
  });
});

describe("listMatchStates", () => {
  it("reads only the list's columns for every decision, with a match's SKU, in one query within a time limit", async () => {
    const { client, queries } = stubClient({
      data: [
        { watchlist_item_id: ITEM_ID, shop_id: "natura", state: "matched", shop_item_id: "NV89063" },
        { watchlist_item_id: OTHER_ITEM_ID, shop_id: "natura", state: "not_found", shop_item_id: null },
      ],
    });

    expect(await listMatchStates(client)).toEqual({
      states: [
        { watchlistItemId: ITEM_ID, shop: "natura", state: "matched", shopItemId: "NV89063" },
        { watchlistItemId: OTHER_ITEM_ID, shop: "natura", state: "not_found", shopItemId: null },
      ],
      unread: [],
    });
    expect(queries).toEqual([
      [
        ["from", "watchlist_matches"],
        ["select", "watchlist_item_id, shop_id, state, shop_item_id"],
        ["abortSignal", true],
      ],
    ]);
  });

  it("reports the products whose rows it couldn't read, keeps the rest, and logs how many it dropped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      data: [
        // A state a later migration might add before the code knows it.
        { watchlist_item_id: ITEM_ID, shop_id: "natura", state: "repinned", shop_item_id: null },
        // A match without its item: the list couldn't find its prices.
        { watchlist_item_id: THIRD_ITEM_ID, shop_id: "natura", state: "matched", shop_item_id: null },
        { watchlist_item_id: OTHER_ITEM_ID, shop_id: "natura", state: "unmatched", shop_item_id: null },
      ],
    });

    // The list then says those products' matches couldn't be read, never that they're still to be matched.
    expect(await listMatchStates(client)).toEqual({
      states: [{ watchlistItemId: OTHER_ITEM_ID, shop: "natura", state: "unmatched", shopItemId: null }],
      unread: [ITEM_ID, THIRD_ITEM_ID],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toMatchObject({ reason: "unexpected rows dropped", detail: "2" });
  });

  it("names a product once, however many of its rows couldn't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      data: [
        { watchlist_item_id: ITEM_ID, shop_id: "natura", state: "repinned", shop_item_id: null },
        { watchlist_item_id: ITEM_ID, shop_id: "dm", state: "matched", shop_item_id: "NV89063" },
      ],
    });

    expect(await listMatchStates(client)).toEqual({ states: [], unread: [ITEM_ID] });
  });

  it.each<{ why: string; row: unknown }>([
    { why: "names no product", row: { watchlist_item_id: null, shop_id: "natura", state: "matched" } },
    { why: "has a product id that isn't text", row: { watchlist_item_id: 42, shop_id: "natura", state: "unmatched" } },
    { why: "isn't a row at all", row: "natura" },
  ])("gives null for an odd row that $why, since it could be any product's", async ({ row }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      data: [row, { watchlist_item_id: OTHER_ITEM_ID, shop_id: "natura", state: "unmatched", shop_item_id: null }],
    });

    expect(await listMatchStates(client)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each<{ answer: string; result: Answer }>([
    { answer: "a failed query", result: { error: { code: "42501", message: "permission denied" } } },
    { answer: "an answer that isn't a list", result: { data: { rows: [] } } },
  ])("gives null for $answer, and logs it", async ({ result }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient(result);

    expect(await listMatchStates(client)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
