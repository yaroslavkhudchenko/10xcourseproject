import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  decisionBackTo,
  listMatches,
  listMatchStates,
  MATCH_ERRORS,
  matchErrorMessage,
  parseMatchForm,
  recordDecision,
  recordLookup,
  replacesFieldOf,
  type DecisionOutcome,
} from "@/lib/services/matches";
import type { MatchableShop } from "@/lib/services/price-comparison";
import { createShopGate } from "@/lib/services/shop-gate";
import hebeEanOnline from "@/lib/services/shops/fixtures/hebe-ean-online.json";
import hebeNameSearch from "@/lib/services/shops/fixtures/hebe-name-search.json";
import eanHit from "@/lib/services/shops/fixtures/natura-ean-hit.json";
import eanMiss from "@/lib/services/shops/fixtures/natura-ean-miss.json";
import nameSearch from "@/lib/services/shops/fixtures/natura-name-search.json";
import unknownTracker from "@/lib/services/shops/fixtures/natura-unknown-tracker.json";
import rossmannNiveaSoft from "@/lib/services/shops/fixtures/rossmann-search-nivea-soft.json";
import superPharmNameSearch from "@/lib/services/shops/fixtures/super-pharm-name-search.json";
import { searchHebe } from "@/lib/services/shops/hebe";
import { searchNatura } from "@/lib/services/shops/natura";
import { searchRossmannItems } from "@/lib/services/shops/rossmann";
import { searchSuperPharm } from "@/lib/services/shops/super-pharm";
import { createReplayFetch } from "@/lib/services/testing/replay-fetch";
import type { ListFilter } from "@/lib/services/watchlist-rows";
import type { MatchedItem, RepinnableMatch, ShopCandidate, ShopSearch } from "@/types";

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

// The update of the product's decision for Natura, narrowed by `expected` to the decision the write expects to
// replace, asking for the changed rows back.
const updateOver = (fields: Record<string, unknown>, expected: Call[]): Call[] => [
  ["from", "watchlist_matches"],
  ["update", { ...fields, checked_at: NOW }],
  ["eq", "watchlist_item_id", ITEM_ID],
  ["eq", "shop_id", "natura"],
  ...expected,
  ["select", "id"],
  ["abortSignal", true],
];

// The update that changes only a lookup that found nothing, as a lookup's and a first choice's do.
const updateNotFound = (fields: Record<string, unknown>): Call[] => updateOver(fields, [["eq", "state", "not_found"]]);

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
      replaces: null,
    });
  });

  it("accepts the decline form, which carries no candidate", () => {
    expect(parseMatchForm(formOf(declineFields))).toEqual({
      itemId: ITEM_ID,
      shop: "natura",
      decision: { action: "decline" },
      replaces: null,
    });
  });

  it.each<{ form: string; fields: Record<string, string | string[]> }>([
    { form: "a confirm", fields: confirmFields(soft) },
    { form: "a decline", fields: declineFields },
  ])("reads what $form from a re-pin's choice replaces: a match to one item, or the user's decline", ({ fields }) => {
    // The list's filter is the route's, which reads it on its own: the decision ignores it.
    const repinned = (replaces: string) => parseMatchForm(formOf({ ...fields, replaces, f: "check" }));

    expect(repinned("matched:NV81063")).toMatchObject({ replaces: { state: "matched", shopItemId: "NV81063" } });
    expect(repinned("unmatched")).toMatchObject({ replaces: { state: "unmatched" } });
  });

  it.each([
    "",
    "matched",
    "matched:",
    "matched:NV81063/../koszyk",
    `matched:${"N".repeat(41)}`,
    "MATCHED:NV81063",
    " unmatched",
    "declined",
    "not_found",
  ])("rejects a re-pin's form whose replaces is %j, which names no decision a choice replaces", (replaces) => {
    expect(parseMatchForm(formOf({ ...confirmFields(soft), replaces }))).toBeNull();
    expect(parseMatchForm(formOf({ ...declineFields, replaces }))).toBeNull();
  });

  it("reads back the replaces the page posts for each decision it can change", () => {
    const decision = { watchlistItemId: ITEM_ID, shop: "natura", decidedBy: "user", checkedAt: NOW } as const;
    const matched: RepinnableMatch = {
      ...decision,
      state: "matched",
      item: { ...itemOf(soft), shopItemId: "NV81063" },
    };
    const declined: RepinnableMatch = { ...decision, state: "unmatched", item: null };

    expect(replacesFieldOf(matched)).toBe("matched:NV81063");
    expect(replacesFieldOf(declined)).toBe("unmatched");
    expect(parseMatchForm(formOf({ ...declineFields, replaces: replacesFieldOf(matched) }))?.replaces).toEqual({
      state: "matched",
      shopItemId: "NV81063",
    });
    expect(parseMatchForm(formOf({ ...confirmFields(soft), replaces: replacesFieldOf(declined) }))?.replaces).toEqual({
      state: "unmatched",
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
    { field: "a shop the app doesn't know", overrides: { shop: "dm" } },
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
        replaces: null,
      });
    }
  });
});

describe("parseMatchForm: each shop's decision, checked by that shop's own adapter", () => {
  const hebeSearchUrl = (query: string, size: number) =>
    `https://live.luigisbox.com/search?tracker_id=421168-505233&q=${encodeURIComponent(query)}&size=${size}`;

  /** The candidates Hebe's adapter makes of a recorded answer, served through the real gate for the request it makes. */
  async function hebeCandidates(query: string, size: number, recording: object): Promise<ShopCandidate[]> {
    const url = hebeSearchUrl(query, size);
    const fetchMock = vi.fn(createReplayFetch([{ url, status: 200, body: JSON.stringify(recording) }]));
    const gate = createShopGate({
      reserve: () => Promise.resolve({ outcome: "allowed" }),
      reportBlock: () => Promise.resolve(),
      fetch: fetchMock,
      log: () => undefined,
    });
    const search: ShopSearch = await searchHebe(gate, query, size);
    expect(requestedUrls(fetchMock)).toEqual([url]);
    return search.kind === "results" ? search.candidates : [];
  }

  /** The "To ten produkt" form for a candidate, posted as a decision in `shop`. */
  const confirmIn = (shop: string, candidate: ShopCandidate) => formOf({ ...confirmFields(candidate), shop });

  it("accepts every Hebe candidate the adapter makes from the recordings as Hebe's decision, and none as Natura's", async () => {
    // Hebe is a matched shop, so the route's own parse takes its decisions.
    const candidates = [
      ...(await hebeCandidates("4005900008299", 5, hebeEanOnline)),
      ...(await hebeCandidates("nivea soft", 10, hebeNameSearch)),
    ];

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual([
      "000000000000218807",
      "000000000000218807",
      "000000000000255134",
      "000000000000742817",
      "000000000000218607",
    ]);
    for (const candidate of candidates) {
      expect(parseMatchForm(confirmIn("hebe", candidate)), candidate.shopItemId).toEqual({
        itemId: ITEM_ID,
        shop: "hebe",
        decision: { action: "confirm", item: itemOf(candidate) },
        replaces: null,
      });
      // Its page and its image are on Hebe's host, which Natura's adapter doesn't accept.
      expect(parseMatchForm(confirmIn("natura", candidate)), candidate.shopItemId).toBeNull();
    }
  });

  it("refuses Natura's candidate as Hebe's decision, whose links Hebe's adapter doesn't accept", () => {
    expect(parseMatchForm(confirmIn("natura", soft))).toMatchObject({ shop: "natura" });
    expect(parseMatchForm(confirmIn("hebe", soft))).toBeNull();
  });

  it.each<{ link: string; fields: Record<string, string> }>([
    { link: "a product page on Natura's site", fields: { productUrl: soft.productUrl ?? "" } },
    { link: "an image on Natura's image host", fields: { imageUrl: soft.imageUrl ?? "" } },
  ])("refuses a Hebe decision with $link, beside Hebe's own other link", async ({ fields }) => {
    const [hebeSoft] = await hebeCandidates("4005900008299", 5, hebeEanOnline);

    expect(parseMatchForm(confirmIn("hebe", hebeSoft))).not.toBeNull();
    expect(parseMatchForm(formOf({ ...confirmFields(hebeSoft), shop: "hebe", ...fields }))).toBeNull();
  });

  it("refuses a Hebe decision that pins an id Hebe's items can't have, such as a Natura SKU", async () => {
    const [hebeSoft] = await hebeCandidates("4005900008299", 5, hebeEanOnline);

    expect(parseMatchForm(confirmIn("hebe", hebeSoft))).not.toBeNull();
    expect(parseMatchForm(formOf({ ...confirmFields(hebeSoft), shop: "hebe", shopItemId: "NV89063" }))).toBeNull();
  });

  it("refuses a Natura decision that pins a SKU without a letter or digit, which Natura's adapter never sends", () => {
    expect(parseMatchForm(formOf({ ...confirmFields(soft), shopItemId: ".." }))).toBeNull();
  });

  it.each([
    { shop: "hebe", replaces: "matched:NV89063" },
    { shop: "natura", replaces: "matched:.." },
  ])("refuses a re-pin in $shop whose replaced match is $replaces, an id the shop's items can't have", (fields) => {
    expect(parseMatchForm(formOf({ ...declineFields, ...fields }))).toBeNull();
  });

  it("accepts a re-pin in Hebe that replaces a match to one of Hebe's items", () => {
    expect(
      parseMatchForm(formOf({ ...declineFields, shop: "hebe", replaces: "matched:000000000000218807" })),
    ).toMatchObject({ shop: "hebe", replaces: { state: "matched", shopItemId: "000000000000218807" } });
  });

  it("accepts a decline in any matched shop, Hebe included, and a re-pin's in it", () => {
    expect(parseMatchForm(formOf({ ...declineFields, shop: "hebe", replaces: "unmatched" }))).toEqual({
      itemId: ITEM_ID,
      shop: "hebe",
      decision: { action: "decline" },
      replaces: { state: "unmatched" },
    });
  });

  it.each(["dm", "", "Rossmann"])("refuses a decision in %j, which no priced shop is", (shop) => {
    expect(parseMatchForm(formOf({ ...declineFields, shop }))).toBeNull();
    expect(parseMatchForm(formOf({ ...confirmFields(soft), shop }))).toBeNull();
  });

  it("accepts every Rossmann candidate the adapter makes from a recording as Rossmann's decision, and none as another shop's", async () => {
    // Rossmann is a matched shop of every product picked in another shop, such as one picked in Natura, and the form
    // doesn't say which shop the product was picked in. The item search Rossmann's lookups send, for "nivea soft", as
    // recorded with 10 items a page (rossmann.test.ts).
    const url = "https://www.rossmann.pl/products/v4/api/Products?search=nivea%20soft&page=1&pageSize=10";
    const fetchMock = vi.fn(createReplayFetch([{ url, status: 200, body: JSON.stringify(rossmannNiveaSoft) }]));
    const gate = createShopGate({
      reserve: () => Promise.resolve({ outcome: "allowed" }),
      reportBlock: () => Promise.resolve(),
      fetch: fetchMock,
      log: () => undefined,
    });
    const search = await searchRossmannItems(gate, "nivea soft", 10);
    expect(requestedUrls(fetchMock)).toEqual([url]);
    const candidates = search.kind === "results" ? search.candidates : [];

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual([
      "26900",
      "2126586",
      "2103263",
      "11790",
      "2079205",
    ]);
    for (const candidate of candidates) {
      expect(parseMatchForm(confirmIn("rossmann", candidate)), candidate.shopItemId).toEqual({
        itemId: ITEM_ID,
        shop: "rossmann",
        decision: { action: "confirm", item: itemOf(candidate) },
        replaces: null,
      });
      // Its page and its image are on Rossmann's hosts, which no other shop's adapter accepts.
      for (const other of ["natura", "hebe", "super-pharm"]) {
        expect(parseMatchForm(confirmIn(other, candidate)), `${candidate.shopItemId} as ${other}'s`).toBeNull();
      }
    }
  });

  it("refuses Natura's candidate as Rossmann's decision, whose id and links Rossmann's adapter doesn't accept", () => {
    expect(parseMatchForm(confirmIn("rossmann", soft))).toBeNull();
    // Natura's links alone fail too, beside a Rossmann id.
    expect(parseMatchForm(formOf({ ...confirmFields(soft), shop: "rossmann", shopItemId: "26900" }))).toBeNull();
  });

  it("accepts Rossmann's decline, and a re-pin's that replaces a match to one of its products, never a Natura SKU", () => {
    expect(parseMatchForm(formOf({ ...declineFields, shop: "rossmann", replaces: "matched:26900" }))).toEqual({
      itemId: ITEM_ID,
      shop: "rossmann",
      decision: { action: "decline" },
      replaces: { state: "matched", shopItemId: "26900" },
    });
    // Rossmann's product ids are digits only.
    expect(parseMatchForm(formOf({ ...declineFields, shop: "rossmann", replaces: "matched:NV89063" }))).toBeNull();
  });

  it("accepts every Super-Pharm candidate the adapter makes from a recording as Super-Pharm's decision, and none as another shop's", async () => {
    // Super-Pharm is a matched shop, and its matches are always the user's pick, posted with this form. Its search is a
    // POST to one URL, served for the exact body the recording answers (super-pharm.test.ts).
    const url = "https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query";
    const requestBody =
      '{"params":"query=NIVEA+krem&hitsPerPage=10&analytics=false' +
      "&attributesToRetrieve=name%2Cbrand%2Ccapacity%2Curl%2Cthumbnail_url%2Cprice%2Cin_stock%2CinStoreOnly" +
      '&attributesToHighlight=%5B%5D"}';
    const fetchMock = vi.fn(
      createReplayFetch([{ url, requestBody, status: 200, body: JSON.stringify(superPharmNameSearch) }]),
    );
    const gate = createShopGate({
      reserve: () => Promise.resolve({ outcome: "allowed" }),
      reportBlock: () => Promise.resolve(),
      fetch: fetchMock,
      log: () => undefined,
    });
    const search = await searchSuperPharm(gate, "NIVEA krem", 10);
    expect(requestedUrls(fetchMock)).toEqual([url]);
    const candidates = search.kind === "results" ? search.candidates : [];

    // Each comes without an EAN, which Super-Pharm's index doesn't hold.
    expect(candidates.map((candidate) => [candidate.shopItemId, candidate.eans])).toEqual([
      ["96276", []],
      ["96278", []],
      ["10132", []],
      ["58823", []],
      ["47977", []],
    ]);
    for (const candidate of candidates) {
      expect(parseMatchForm(confirmIn("super-pharm", candidate)), candidate.shopItemId).toEqual({
        itemId: ITEM_ID,
        shop: "super-pharm",
        decision: { action: "confirm", item: itemOf(candidate) },
        replaces: null,
      });
      // Its page and its image are on Super-Pharm's hosts, which neither Natura's adapter nor Hebe's accepts.
      expect(parseMatchForm(confirmIn("natura", candidate)), candidate.shopItemId).toBeNull();
      expect(parseMatchForm(confirmIn("hebe", candidate)), candidate.shopItemId).toBeNull();
    }
  });

  it("accepts Super-Pharm's decline and a re-pin's that replaces a match to one of its items, never a Natura SKU", () => {
    expect(parseMatchForm(formOf({ ...declineFields, shop: "super-pharm", replaces: "matched:10132" }))).toEqual({
      itemId: ITEM_ID,
      shop: "super-pharm",
      decision: { action: "decline" },
      replaces: { state: "matched", shopItemId: "10132" },
    });
    // Super-Pharm's ids are digits only.
    expect(parseMatchForm(formOf({ ...declineFields, shop: "super-pharm", replaces: "matched:NV89063" }))).toBeNull();
  });

  it("refuses a decision in a matched shop that a test's list leaves out", () => {
    expect(parseMatchForm(formOf({ ...declineFields, shop: "hebe" }), ["natura"])).toBeNull();
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
    // A first choice's update changes only a lookup that found nothing, so a decided row isn't changed: none comes back.
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

describe("recordDecision: a re-pin replaces only the decision its form was shown with", () => {
  const changed = { data: [{ id: "c0ffee00-0000-4000-8000-000000000001" }] };
  const confirmed = { state: "matched", decided_by: "user", ...SOFT_COLUMNS };
  const declined = { state: "unmatched", decided_by: "user", ...NO_ITEM_COLUMNS };
  // The narrowing of the update to the match the form was shown with: its state and its item.
  const overMatch: Call[] = [
    ["eq", "state", "matched"],
    ["eq", "shop_item_id", "NV81063"],
  ];

  it("re-pins a match to another item only while the match is still the one shown", async () => {
    const { client, queries } = stubClient(duplicate, changed);

    const result = await recordDecision(
      client,
      ITEM_ID,
      "natura",
      { action: "confirm", item: itemOf(soft) },
      { state: "matched", shopItemId: "NV81063" },
    );

    expect(result).toBe("saved");
    expect(queries).toEqual([
      insertInto({ watchlist_item_id: ITEM_ID, shop_id: "natura", ...confirmed }),
      updateOver(confirmed, overMatch),
    ]);
  });

  it("declines a match only while the match is still the one shown", async () => {
    const { client, queries } = stubClient(duplicate, changed);

    const result = await recordDecision(
      client,
      ITEM_ID,
      "natura",
      { action: "decline" },
      { state: "matched", shopItemId: "NV81063" },
    );

    expect(result).toBe("saved");
    expect(queries).toEqual([
      insertInto({ watchlist_item_id: ITEM_ID, shop_id: "natura", ...declined }),
      updateOver(declined, overMatch),
    ]);
  });

  it("makes an automatic match the user's own when they confirm its item, only while it's still the one shown", async () => {
    // The re-pin's choice offers the item the rule matched on its own: confirming it stores the same item as matched,
    // decided by the user, over that very match.
    const { client, queries } = stubClient(duplicate, changed);

    const result = await recordDecision(
      client,
      ITEM_ID,
      "natura",
      { action: "confirm", item: itemOf(soft) },
      { state: "matched", shopItemId: "NV89063" },
    );

    expect(result).toBe("saved");
    expect(queries).toEqual([
      insertInto({ watchlist_item_id: ITEM_ID, shop_id: "natura", ...confirmed }),
      updateOver(confirmed, [
        ["eq", "state", "matched"],
        ["eq", "shop_item_id", "NV89063"],
      ]),
    ]);
  });

  it("turns the user's decline into a match only while the decline still stands", async () => {
    const { client, queries } = stubClient(duplicate, changed);

    const result = await recordDecision(
      client,
      ITEM_ID,
      "natura",
      { action: "confirm", item: itemOf(soft) },
      { state: "unmatched" },
    );

    expect(result).toBe("saved");
    expect(queries).toEqual([
      insertInto({ watchlist_item_id: ITEM_ID, shop_id: "natura", ...confirmed }),
      updateOver(confirmed, [["eq", "state", "unmatched"]]),
    ]);
  });

  it("reports a decision changed meanwhile, as from a stale tab, as decided, and changes nothing", async () => {
    // Another tab re-pinned the match: the update narrowed to the one this form was shown with changes no row.
    const { client, queries } = stubClient(duplicate, { data: [] });

    const result = await recordDecision(
      client,
      ITEM_ID,
      "natura",
      { action: "confirm", item: itemOf(soft) },
      { state: "matched", shopItemId: "NV81063" },
    );

    expect(result).toBe("decided");
    expect(queries).toEqual([
      insertInto({ watchlist_item_id: ITEM_ID, shop_id: "natura", ...confirmed }),
      updateOver(confirmed, overMatch),
    ]);
  });

  it("reports a product removed meanwhile as gone, without an update", async () => {
    const { client, queries } = stubClient({
      error: { code: "23503", message: 'violates foreign key constraint "watchlist_matches_own_product"' },
    });

    expect(await recordDecision(client, ITEM_ID, "natura", { action: "decline" }, { state: "unmatched" })).toBe("gone");
    expect(queries).toEqual([insertInto({ watchlist_item_id: ITEM_ID, shop_id: "natura", ...declined })]);
  });
});

describe("decisionBackTo", () => {
  it.each<{ outcome: DecisionOutcome; filter: ListFilter; to: string }>([
    { outcome: "matched", filter: "check", to: `/watchlist/${ITEM_ID}?f=check&shop=natura&matched=1` },
    { outcome: "declined", filter: "check", to: `/watchlist/${ITEM_ID}?f=check&shop=natura&declined=1` },
    { outcome: "decided", filter: "check", to: `/watchlist/${ITEM_ID}?f=check&shop=natura&decided=1` },
    { outcome: { error: "failed" }, filter: "check", to: `/watchlist/${ITEM_ID}?f=check&shop=natura&error=failed` },
    { outcome: { error: "gone" }, filter: "promo", to: `/watchlist/${ITEM_ID}?f=promo&shop=natura&error=gone` },
    { outcome: "matched", filter: "all", to: `/watchlist/${ITEM_ID}?shop=natura&matched=1` },
    { outcome: { error: "invalid" }, filter: "all", to: `/watchlist/${ITEM_ID}?shop=natura&error=invalid` },
  ])("goes back to the product's page with $to", ({ outcome, filter, to }) => {
    expect(decisionBackTo(ITEM_ID, "natura", outcome, filter)).toBe(to);
  });

  it("names the shop the decision was for, whichever it is", () => {
    expect(decisionBackTo(ITEM_ID, "hebe", "declined", "all")).toBe(`/watchlist/${ITEM_ID}?shop=hebe&declined=1`);
    expect(decisionBackTo(ITEM_ID, "hebe", { error: "failed" }, "promo")).toBe(
      `/watchlist/${ITEM_ID}?f=promo&shop=hebe&error=failed`,
    );
  });

  it("goes back to the product's page without a shop for a post whose shop can't be read", () => {
    expect(decisionBackTo(ITEM_ID, null, { error: "invalid" }, "check")).toBe(
      `/watchlist/${ITEM_ID}?f=check&error=invalid`,
    );
  });

  it("goes back to the list, keeping its filter, with no code for a post without a product's id", () => {
    expect(decisionBackTo(null, "natura", { error: "invalid" }, "check")).toBe("/watchlist?f=check");
    expect(decisionBackTo(null, null, "matched", "all")).toBe("/watchlist");
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
  // The product's decisions as rows: matched in Natura on its own, or declined there by the user.
  const matchedRow = {
    watchlist_item_id: ITEM_ID,
    shop_id: "natura",
    state: "matched",
    decided_by: "auto",
    ...SOFT_COLUMNS,
    checked_at: CHECKED_AT,
  };
  const declinedRow = {
    watchlist_item_id: ITEM_ID,
    shop_id: "natura",
    state: "unmatched",
    decided_by: "user",
    ...NO_ITEM_COLUMNS,
    checked_at: CHECKED_AT,
  };
  // The same decline in Hebe, and a Hebe row in a state a later migration might add before the code knows it; and the
  // same two in Super-Pharm, the third matched shop, which a test leaves out of its list as if it were switched off.
  const hebeDeclinedRow = { ...declinedRow, shop_id: "hebe" };
  const hebeOddRow = { ...declinedRow, shop_id: "hebe", state: "repinned" };
  const superPharmDeclinedRow = { ...declinedRow, shop_id: "super-pharm" };
  const superPharmOddRow = { ...declinedRow, shop_id: "super-pharm", state: "repinned" };
  const matched = {
    watchlistItemId: ITEM_ID,
    shop: "natura",
    decidedBy: "auto",
    checkedAt: CHECKED_AT,
    state: "matched",
    item: itemOf(soft),
  };
  const hebeDeclined = {
    watchlistItemId: ITEM_ID,
    shop: "hebe",
    decidedBy: "user",
    checkedAt: CHECKED_AT,
    state: "unmatched",
    item: null,
  };

  it("reads one product's decisions, within a time limit", async () => {
    const { client, queries } = stubClient({ data: [matchedRow] });

    expect(await listMatches(client, ITEM_ID)).toEqual({ matches: [matched], unreadable: [] });
    expect(queries).toHaveLength(1);
    const [calls] = queries;
    expect(calls.map(([method]) => method)).toEqual(["from", "select", "eq", "abortSignal"]);
    expect(calls).toContainEqual(["from", "watchlist_matches"]);
    expect(calls).toContainEqual(["eq", "watchlist_item_id", ITEM_ID]);
    expect(calls).toContainEqual(["abortSignal", true]);
  });

  it("reads each matched shop's decision of the product, Hebe's and Super-Pharm's too", async () => {
    const { client } = stubClient({ data: [matchedRow, hebeDeclinedRow, superPharmDeclinedRow] });

    expect(await listMatches(client, ITEM_ID)).toEqual({
      matches: [matched, hebeDeclined, { ...hebeDeclined, shop: "super-pharm" }],
      unreadable: [],
    });
  });

  it("reads a Rossmann decision too, as a product picked in another shop has, every priced shop being read", async () => {
    // The read can't know which shop the product was picked in: its page reads the product at the same time, and
    // leaves out the decision of the product's own shop (runMatchSteps).
    const rossmannRow = {
      ...matchedRow,
      shop_id: "rossmann",
      shop_item_id: "26900",
      product_url: null,
      image_url: null,
    };
    const { client } = stubClient({ data: [rossmannRow, hebeDeclinedRow] });

    expect(await listMatches(client, ITEM_ID)).toEqual({
      matches: [
        {
          ...matched,
          shop: "rossmann",
          item: { ...itemOf(soft), shopItemId: "26900", productUrl: null, imageUrl: null },
        },
        hebeDeclined,
      ],
      unreadable: [],
    });
  });

  it.each<{ why: string; row: Record<string, unknown> }>([
    { why: "a state a later migration might add before the code knows it", row: { ...matchedRow, state: "repinned" } },
    { why: "a match without its item", row: { ...matchedRow, shop_item_id: null } },
    { why: "a time the page can't show", row: { ...declinedRow, checked_at: "wczoraj" } },
  ])("says the decision of a row with $why couldn't be read, never that there's none, and logs it", async ({ row }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ data: [row] });

    // The page then says Natura's decision couldn't be read, and doesn't look the product up there again.
    expect(await listMatches(client, ITEM_ID)).toEqual({ matches: [], unreadable: ["natura"] });
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toMatchObject({ reason: "unexpected rows dropped", detail: "1" });
  });

  it("leaves out every row of a shop outside the list, known or not, readable or odd", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The test's list leaves Super-Pharm out, as a shop switched off again would be: decisions stored in it are no
    // page's.
    const listed = ["natura", "hebe"] as const;
    const outside = [
      superPharmDeclinedRow,
      superPharmOddRow,
      { ...declinedRow, shop_id: "dm" },
      { ...matchedRow, shop_id: "dm", shop_item_id: null },
    ];
    const { client } = stubClient({ data: outside }, { data: [...outside, matchedRow] });

    // Neither listed shop has a decision, and none of those rows makes one unreadable: its page looks the product up.
    expect(await listMatches(client, ITEM_ID, listed)).toEqual({ matches: [], unreadable: [] });
    expect(await listMatches(client, ITEM_ID, listed)).toEqual({ matches: [matched], unreadable: [] });
    // The odd rows are logged, the dm ones too, since the app doesn't know dm; a readable Super-Pharm row is no odd
    // row.
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toMatchObject({ reason: "unexpected rows dropped", detail: "3" });
  });

  it("leaves Natura's decision readable beside an odd Hebe row, and Hebe's beside an odd Natura row", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hebeOdd = stubClient({ data: [matchedRow, hebeOddRow] });
    const naturaOdd = stubClient({ data: [{ ...matchedRow, shop_item_id: null }, hebeDeclinedRow] });

    expect(await listMatches(hebeOdd.client, ITEM_ID)).toEqual({
      matches: [matched],
      unreadable: ["hebe"],
    });
    expect(await listMatches(naturaOdd.client, ITEM_ID)).toEqual({
      matches: [hebeDeclined],
      unreadable: ["natura"],
    });
  });

  it("leaves Natura undecided, never unreadable, beside an odd Hebe row when Natura has no decision", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ data: [hebeOddRow] });

    expect(await listMatches(client, ITEM_ID)).toEqual({ matches: [], unreadable: ["hebe"] });
  });

  it.each<{ why: string; shop: unknown }>([
    { why: "names no shop", shop: null },
    { why: "has a shop that isn't text", shop: 7 },
  ])("says every priced shop without a decision read may be an odd row's that $why", async ({ shop }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const alone = stubClient({ data: [{ ...declinedRow, shop_id: shop }] });
    const besideNatura = stubClient({ data: [matchedRow, { ...declinedRow, shop_id: shop }] });

    // Rossmann too: it's a matched shop of a product picked in another shop, and the page leaves out the product's own.
    expect(await listMatches(alone.client, ITEM_ID)).toEqual({
      matches: [],
      unreadable: ["rossmann", "natura", "hebe", "super-pharm"],
    });
    // A product has one decision per shop, so a row whose shop can't be read isn't Natura's beside Natura's own.
    expect(await listMatches(besideNatura.client, ITEM_ID)).toEqual({
      matches: [matched],
      unreadable: ["rossmann", "hebe", "super-pharm"],
    });
  });

  it("takes an odd row whose product can't be read for the product's own, since the query asked for its rows", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ofHebe = stubClient({ data: [matchedRow, { ...hebeDeclinedRow, watchlist_item_id: null }] });
    const ofNoShop = stubClient({ data: [{ ...declinedRow, watchlist_item_id: 42, shop_id: null }] });

    expect(await listMatches(ofHebe.client, ITEM_ID)).toEqual({ matches: [matched], unreadable: ["hebe"] });
    expect(await listMatches(ofNoShop.client, ITEM_ID)).toEqual({
      matches: [],
      unreadable: ["rossmann", "natura", "hebe", "super-pharm"],
    });
  });

  it.each<{ answer: string; result: Answer }>([
    { answer: "a failed query", result: { error: { code: "42501", message: "permission denied" } } },
    { answer: "an answer that isn't a list", result: { data: { rows: [] } } },
  ])("gives null for $answer", async ({ result }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient(result);

    expect(await listMatches(client, ITEM_ID)).toBeNull();
  });
});

describe("listMatchStates", () => {
  /**
   * A decision's row as the list reads it: its product, its shop, its state, and a match's item id, brand and size,
   * with who decided it. By default the lookup's own match to Natura's Nivea Soft.
   */
  const stateRow = (fields: Record<string, unknown> = {}) => ({
    watchlist_item_id: ITEM_ID,
    shop_id: "natura",
    state: "matched",
    shop_item_id: "NV89063",
    brand: "NIVEA",
    size_value: 300,
    size_unit: "ml",
    decided_by: "auto",
    ...fields,
  });
  /** The row of a decision without an item: by default, the user's decline of another product. */
  const noItemRow = (fields: Record<string, unknown> = {}) =>
    stateRow({
      watchlist_item_id: OTHER_ITEM_ID,
      state: "unmatched",
      shop_item_id: null,
      brand: null,
      size_value: null,
      size_unit: null,
      decided_by: "user",
      ...fields,
    });
  const declined = { watchlistItemId: OTHER_ITEM_ID, shop: "natura", state: "unmatched", shopItemId: null };
  /** The decision of a product in one shop that couldn't be read, by default the product's Natura decision. */
  const unreadIn = (shop: MatchableShop, watchlistItemId = ITEM_ID) => ({ watchlistItemId, shop });

  it("reads only the list's columns, with a match's SKU, brand, size and decider, in one query within a time limit", async () => {
    const { client, queries } = stubClient({
      data: [
        stateRow(),
        // A match the user confirmed, to an item without a brand or a size.
        stateRow({
          watchlist_item_id: THIRD_ITEM_ID,
          brand: null,
          size_value: null,
          size_unit: null,
          decided_by: "user",
        }),
        noItemRow({ state: "not_found", decided_by: "auto" }),
      ],
    });

    expect(await listMatchStates(client)).toEqual({
      states: [
        {
          watchlistItemId: ITEM_ID,
          shop: "natura",
          state: "matched",
          shopItemId: "NV89063",
          brand: "NIVEA",
          size: { value: 300, unit: "ml" },
          decidedBy: "auto",
        },
        {
          watchlistItemId: THIRD_ITEM_ID,
          shop: "natura",
          state: "matched",
          shopItemId: "NV89063",
          brand: null,
          size: null,
          decidedBy: "user",
        },
        { watchlistItemId: OTHER_ITEM_ID, shop: "natura", state: "not_found", shopItemId: null },
      ],
      unread: [],
      unattributed: [],
    });
    expect(queries).toEqual([
      [
        ["from", "watchlist_matches"],
        ["select", "watchlist_item_id, shop_id, state, shop_item_id, brand, size_value, size_unit, decided_by"],
        ["abortSignal", true],
      ],
    ]);
  });

  it("reports the products whose rows it couldn't read, keeps the rest, and logs how many it dropped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      data: [
        // A state a later migration might add before the code knows it.
        noItemRow({ watchlist_item_id: ITEM_ID, state: "repinned" }),
        // A match without its item: the list couldn't find its prices.
        stateRow({ watchlist_item_id: THIRD_ITEM_ID, shop_item_id: null }),
        noItemRow(),
      ],
    });

    // The list then says those products' matches couldn't be read, never that they're still to be matched.
    expect(await listMatchStates(client)).toEqual({
      states: [declined],
      unread: [unreadIn("natura"), unreadIn("natura", THIRD_ITEM_ID)],
      unattributed: [],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toMatchObject({ reason: "unexpected rows dropped", detail: "2" });
  });

  it.each<{ why: string; fields: Record<string, unknown> }>([
    { why: "a unit the app doesn't know", fields: { size_unit: "l" } },
    { why: "a size that isn't a number", fields: { size_value: "300" } },
    { why: "a size of nothing", fields: { size_value: 0 } },
    { why: "a brand that isn't text", fields: { brand: 7 } },
    { why: "no brand column", fields: { brand: undefined } },
    { why: "a decider the app doesn't know", fields: { decided_by: "robot" } },
    { why: "no decider", fields: { decided_by: null } },
  ])("reports a match with $why as unread, never as one that agrees with its product", async ({ fields }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({ data: [stateRow(fields), noItemRow()] });

    // The list then says the product's match couldn't be read, and counts it in "Do sprawdzenia".
    expect(await listMatchStates(client)).toEqual({
      states: [declined],
      unread: [unreadIn("natura")],
      unattributed: [],
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("names a product's decision in a shop once, however many of its rows there couldn't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      data: [
        noItemRow({ watchlist_item_id: ITEM_ID, state: "repinned" }),
        stateRow({ shop_item_id: null }),
        noItemRow({ watchlist_item_id: ITEM_ID, shop_id: "hebe", state: "repinned" }),
      ],
    });

    // Natura's two odd rows name its decision once, and Hebe's odd row names Hebe's.
    expect(await listMatchStates(client)).toEqual({
      states: [],
      unread: [unreadIn("natura"), unreadIn("hebe")],
      unattributed: [],
    });
  });

  it("names the product of an odd row whose shop can't be read in every listed shop, since it may be any one's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const answer = { data: [stateRow({ shop_id: null })] };
    const { client } = stubClient(answer, answer);

    expect(await listMatchStates(client, ["natura"])).toEqual({
      states: [],
      unread: [unreadIn("natura")],
      unattributed: [],
    });
    // Every priced shop by default, Rossmann too: the list leaves out each product's own shop (matchStatesOf).
    expect(await listMatchStates(client)).toEqual({
      states: [],
      unread: [unreadIn("rossmann"), unreadIn("natura"), unreadIn("hebe"), unreadIn("super-pharm")],
      unattributed: [],
    });
  });

  it.each<{ why: string; row: unknown; shops: MatchableShop[] }>([
    { why: "names no product", row: stateRow({ watchlist_item_id: null }), shops: ["natura"] },
    { why: "has a product id that isn't text", row: noItemRow({ watchlist_item_id: 42 }), shops: ["natura"] },
    // Its shop can't be read either, so it may be any priced shop's.
    { why: "isn't a row at all", row: "natura", shops: ["rossmann", "natura", "hebe", "super-pharm"] },
  ])(
    "names the shops an odd row that $why may be a decision of, any product's there, and keeps the rest",
    async ({ row, shops }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { client } = stubClient({ data: [row, noItemRow()] });

      // One such row never empties the list: the list marks only the products it has no readable row for in its shops.
      expect(await listMatchStates(client)).toEqual({ states: [declined], unread: [], unattributed: shops });
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it("names only the shop of an odd row that names no product, or every priced shop when its shop can't be read either", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ofHebe = stubClient({ data: [noItemRow({ watchlist_item_id: null, shop_id: "hebe" }), noItemRow()] });
    const ofNoShop = stubClient({ data: [noItemRow({ watchlist_item_id: null, shop_id: null }), noItemRow()] });

    expect(await listMatchStates(ofHebe.client)).toEqual({
      states: [declined],
      unread: [],
      unattributed: ["hebe"],
    });
    expect(await listMatchStates(ofNoShop.client)).toEqual({
      states: [declined],
      unread: [],
      unattributed: ["rossmann", "natura", "hebe", "super-pharm"],
    });
  });

  it("reads a Rossmann decision and a Rossmann row that couldn't be read, as a product picked in another shop has", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      data: [
        stateRow({ shop_id: "rossmann", shop_item_id: "26900" }),
        noItemRow({ watchlist_item_id: THIRD_ITEM_ID, shop_id: "rossmann", state: "repinned" }),
        noItemRow(),
      ],
    });

    // Every priced shop's, whichever shop each product was picked in: the list's rows leave out each product's own.
    expect(await listMatchStates(client)).toEqual({
      states: [
        {
          watchlistItemId: ITEM_ID,
          shop: "rossmann",
          state: "matched",
          shopItemId: "26900",
          brand: "NIVEA",
          size: { value: 300, unit: "ml" },
          decidedBy: "auto",
        },
        declined,
      ],
      unread: [unreadIn("rossmann", THIRD_ITEM_ID)],
      unattributed: [],
    });
  });

  it("leaves out an odd row of a shop the app doesn't know, whatever its product, and logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      data: [
        stateRow({ shop_id: "dm", shop_item_id: null }),
        stateRow({ watchlist_item_id: null, shop_id: "dm" }),
        noItemRow(),
      ],
    });

    expect(await listMatchStates(client)).toEqual({ states: [declined], unread: [], unattributed: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toMatchObject({ reason: "unexpected rows dropped", detail: "2" });
  });

  it("leaves out every row of a known shop outside the list, readable or odd, whatever its product", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The test's list leaves Super-Pharm out, as a shop switched off again would be: decisions stored in it are no
    // page's.
    const superPharmRows = [
      stateRow({ shop_id: "super-pharm" }),
      noItemRow({ watchlist_item_id: ITEM_ID, shop_id: "super-pharm", state: "repinned" }),
      noItemRow({ watchlist_item_id: null, shop_id: "super-pharm" }),
    ];
    const { client } = stubClient({ data: [...superPharmRows, noItemRow()] });

    expect(await listMatchStates(client, ["natura", "hebe"])).toEqual({
      states: [declined],
      unread: [],
      unattributed: [],
    });
  });

  it("keeps a product's Natura decision readable beside its odd Hebe row", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = stubClient({
      data: [stateRow(), noItemRow({ watchlist_item_id: ITEM_ID, shop_id: "hebe", state: "repinned" })],
    });

    expect(await listMatchStates(client)).toEqual({
      states: [
        {
          watchlistItemId: ITEM_ID,
          shop: "natura",
          state: "matched",
          shopItemId: "NV89063",
          brand: "NIVEA",
          size: { value: 300, unit: "ml" },
          decidedBy: "auto",
        },
      ],
      unread: [unreadIn("hebe")],
      unattributed: [],
    });
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
