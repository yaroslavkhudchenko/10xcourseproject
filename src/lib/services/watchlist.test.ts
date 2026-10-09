import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REMOVAL_ANCHOR } from "@/lib/notices";
import { createShopGate } from "@/lib/services/shop-gate";
import hebeNameSearch from "@/lib/services/shops/fixtures/hebe-name-search.json";
import aaLaab from "@/lib/services/shops/fixtures/rossmann-search-aa-laab.json";
import empty from "@/lib/services/shops/fixtures/rossmann-search-empty.json";
import misspelled from "@/lib/services/shops/fixtures/rossmann-search-misspelled.json";
import niveaSoft from "@/lib/services/shops/fixtures/rossmann-search-nivea-soft.json";
import results from "@/lib/services/shops/fixtures/rossmann-search-results.json";
import { searchHebe } from "@/lib/services/shops/hebe";
import { searchRossmann } from "@/lib/services/shops/rossmann";
import { createReplayFetch } from "@/lib/services/testing/replay-fetch";
import {
  addToWatchlist,
  getWatchlistProduct,
  listWatchlist,
  parseWatchlistForm,
  parseWatchlistItemId,
  productFullName,
  removalBackTo,
  removalErrorMessage,
  removalGoneNotice,
  removedNotice,
  removeFromWatchlist,
  watchlistErrorMessage,
  WATCHLIST_ERRORS,
  type RemovalOutcome,
} from "@/lib/services/watchlist";
import type { ListFilter } from "@/lib/services/watchlist-rows";
import type { ProductCandidate, ShopCandidate } from "@/types";

// The "Dodaj" form as the results page posts it, built from the first recorded Rossmann item.
const [soft] = results.data.items;
const softImage = soft.pictures.find((picture) => picture.type === 1)?.medium ?? "";
const SOFT_PAGE =
  "https://www.rossmann.pl/Produkt/Kremy-do-twarzy/NIVEA-Soft-krem-uniwersalny-nawilzajacy-300-ml,26900,13049";

function dodajForm(overrides: Record<string, string | string[]> = {}): FormData {
  const fields: Record<string, string | string[]> = {
    source: "rossmann",
    sourceItemId: String(soft.id),
    name: soft.name,
    brand: soft.brand,
    caption: soft.caption,
    sizeText: soft.unit,
    productUrl: SOFT_PAGE,
    imageUrl: softImage,
    eans: soft.eanNumber,
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      form.append(key, entry);
    }
  }
  return form;
}

/** The hidden inputs `src/pages/watchlist.astro` renders for one search result. */
function pageForm(candidate: ProductCandidate): FormData {
  const form = new FormData();
  form.append("source", candidate.source);
  form.append("sourceItemId", candidate.sourceItemId);
  form.append("name", candidate.name);
  form.append("brand", candidate.brand ?? "");
  form.append("caption", candidate.caption ?? "");
  form.append("sizeText", candidate.sizeText ?? "");
  form.append("productUrl", candidate.productUrl ?? "");
  form.append("imageUrl", candidate.imageUrl ?? "");
  for (const ean of candidate.eans) {
    form.append("eans", ean);
  }
  return form;
}

function softCandidate() {
  const candidate = parseWatchlistForm(dodajForm());
  if (!candidate) {
    throw new Error("the recorded item's form was rejected");
  }
  return candidate;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseWatchlistForm", () => {
  it("accepts the form the results page posts", () => {
    expect(parseWatchlistForm(dodajForm())).toEqual({
      source: "rossmann",
      sourceItemId: "26900",
      name: "Soft",
      brand: "NIVEA",
      caption: "krem uniwersalny, nawilżający",
      sizeText: "300 ml",
      size: { value: 300, unit: "ml" },
      eans: ["4005900009319", "4005808890637", "5900017001234"],
      productUrl: SOFT_PAGE,
      imageUrl: "https://pro-fra-s3-productsassets.rossmann.pl/product_1_medium/26900_360_350_1785530324.webp",
    });
  });

  it("parses the size again from its text, and turns empty fields into null", () => {
    const form = dodajForm({ sizeText: "0,5 l", brand: "", caption: "  ", productUrl: "", imageUrl: "", eans: [] });
    // Not a form field: size numbers are never taken from the form.
    form.append("size_value", "999");

    expect(parseWatchlistForm(form)).toMatchObject({
      brand: null,
      caption: null,
      productUrl: null,
      imageUrl: null,
      eans: [],
      size: { value: 500, unit: "ml" },
    });
  });

  it.each<{ field: string; overrides: Record<string, string | string[]> }>([
    { field: "a shop the app doesn't price", overrides: { source: "dm" } },
    { field: "no shop", overrides: { source: "" } },
    // Rossmann's item posted as Hebe's: its page and its image aren't on Hebe's host.
    { field: "a Rossmann item as Hebe's", overrides: { source: "hebe" } },
    { field: "a product id that isn't digits", overrides: { sourceItemId: "26900; drop" } },
    { field: "a plain-http image", overrides: { imageUrl: "http://pro-fra-s3-productsassets.rossmann.pl/x.webp" } },
    { field: "an image on another host", overrides: { imageUrl: "https://images.example.com/x.webp" } },
    { field: "a plain-http product page", overrides: { productUrl: "http://www.rossmann.pl/Produkt/x,26900,13049" } },
    { field: "a product page on another host", overrides: { productUrl: "https://evil.example/Produkt/x,26900" } },
    { field: "an empty name", overrides: { name: "   " } },
    { field: "a name over 300 characters", overrides: { name: "x".repeat(301) } },
    { field: "an EAN that isn't 8-14 digits", overrides: { eans: ["12345"] } },
    {
      field: "more than 10 EANs",
      overrides: { eans: Array.from({ length: 11 }, (_, i) => String(5900000000000 + i)) },
    },
  ])("rejects $field", ({ overrides }) => {
    expect(parseWatchlistForm(dodajForm(overrides))).toBeNull();
  });

  it("accepts every result of the list's Rossmann search on its recorded answers, posted the way the page posts it", async () => {
    // The list's requests, 10 items a page, which rossmann-search-nivea-soft.json and rossmann-search-aa-laab.json
    // answer: each was sent as it is spelled out here.
    const searches = [
      {
        query: "nivea soft",
        url: "https://www.rossmann.pl/products/v4/api/Products?search=nivea%20soft&page=1&pageSize=10",
        answer: niveaSoft,
      },
      {
        query: "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający",
        url:
          "https://www.rossmann.pl/products/v4/api/Products?search=AA%20LAAB%20100%25%20Centella%20B12%20%C5%BBel%20do" +
          "%20mycia%20twarzy%20nawil%C5%BCaj%C4%85cy&page=1&pageSize=10",
        answer: aaLaab,
      },
    ];
    const fetchMock = vi.fn(
      createReplayFetch(searches.map(({ url, answer }) => ({ url, status: 200, body: JSON.stringify(answer) }))),
    );
    const gate = createShopGate({
      reserve: () => Promise.resolve({ outcome: "allowed" }),
      reportBlock: () => Promise.resolve(),
      fetch: fetchMock,
      log: () => undefined,
    });

    const candidates: ProductCandidate[] = [];
    for (const { query } of searches) {
      // The list's search, as the page asks for it: 10 items a page.
      const search = await searchRossmann(gate, query, 10);
      candidates.push(...(search.kind === "results" ? search.candidates : []));
    }

    expect(fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)))).toEqual(
      searches.map(({ url }) => url),
    );
    expect(candidates.map(({ sourceItemId }) => sourceItemId)).toEqual([
      "26900",
      "2126586",
      "2103263",
      "11790",
      "2079205",
      "2132081",
      "419343",
    ]);
    for (const candidate of candidates) {
      expect(parseWatchlistForm(pageForm(candidate)), candidate.sourceItemId).toEqual(candidate);
    }
  });

  it("accepts every item the earlier recordings hold, the one with 12 EANs among them, posted the way the page posts it", async () => {
    // One answer of every item of the S-01 recordings, their recommended products included, served for the list's own
    // request: more than the 10 items it asks for, which the adapter reads all the same.
    const items: unknown[] = [results, misspelled, empty].flatMap((fixture) => [
      ...fixture.data.items,
      ...fixture.data.recommendedProducts,
    ]);
    const url = "https://www.rossmann.pl/products/v4/api/Products?search=nivea%20soft&page=1&pageSize=10";
    const gate = createShopGate({
      reserve: () => Promise.resolve({ outcome: "allowed" }),
      reportBlock: () => Promise.resolve(),
      fetch: createReplayFetch([{ url, status: 200, body: JSON.stringify({ data: { items, spellCheckHint: "" } }) }]),
      log: () => undefined,
    });

    const search = await searchRossmann(gate, "nivea soft", 10);

    if (search.kind !== "results") {
      throw new Error(`expected results, got ${search.kind}`);
    }
    // Among them the product with 12 EANs, which the form alone would reject.
    expect(search.candidates.some((candidate) => candidate.sourceItemId === "17420")).toBe(true);
    expect(search.candidates.length).toBeGreaterThan(10);
    for (const candidate of search.candidates) {
      expect(parseWatchlistForm(pageForm(candidate)), candidate.sourceItemId).not.toBeNull();
    }
  });
});

// "Dodaj" takes an item of any priced shop, which becomes the product's own shop, checked by that shop's own adapter:
// Hebe's items, as its adapter makes them of its recorded search for "nivea soft" (hebe.test.ts says when it was
// made), posted with Hebe as their shop and without a caption, which only Rossmann writes apart.
describe("parseWatchlistForm: an item of another shop", () => {
  const HEBE_SEARCH = "https://live.luigisbox.com/search?tracker_id=421168-505233&q=nivea%20soft&size=10";

  /** The "Dodaj" form for one of Hebe's items: its own fields, its shop and no caption, with these fields changed. */
  function hebeForm(item: ShopCandidate, overrides: Record<string, string> = {}): FormData {
    const form = pageForm({
      source: "hebe",
      sourceItemId: item.shopItemId,
      brand: item.brand,
      name: item.name,
      caption: null,
      sizeText: item.sizeText,
      size: item.size,
      eans: item.eans,
      productUrl: item.productUrl,
      imageUrl: item.imageUrl,
    });
    for (const [field, value] of Object.entries(overrides)) {
      form.set(field, value);
    }
    return form;
  }

  /** Hebe's items in its recorded answer, through the real gate, which asked Hebe's tracker for exactly them. */
  async function hebeItems(): Promise<ShopCandidate[]> {
    const fetchMock = vi.fn(
      createReplayFetch([{ url: HEBE_SEARCH, status: 200, body: JSON.stringify(hebeNameSearch) }]),
    );
    const gate = createShopGate({
      reserve: () => Promise.resolve({ outcome: "allowed" }),
      reportBlock: () => Promise.resolve(),
      fetch: fetchMock,
      log: () => undefined,
    });
    const search = await searchHebe(gate, "nivea soft", 10);
    expect(fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)))).toEqual([
      HEBE_SEARCH,
    ]);
    if (search.kind !== "results") {
      throw new Error(`expected results, got ${search.kind}`);
    }
    return search.candidates;
  }

  it("accepts every Hebe item the adapter makes from the recording, as a product picked in Hebe", async () => {
    const items = await hebeItems();

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(parseWatchlistForm(hebeForm(item)), item.shopItemId).toEqual({
        source: "hebe",
        sourceItemId: item.shopItemId,
        brand: item.brand,
        name: item.name,
        caption: null,
        sizeText: item.sizeText,
        size: item.size,
        eans: item.eans,
        productUrl: item.productUrl,
        imageUrl: item.imageUrl,
      });
    }
  });

  it.each<{ why: string; overrides: Record<string, string> }>([
    { why: "a Natura SKU, which no Hebe item has", overrides: { sourceItemId: "NV89063" } },
    { why: "an id longer than a shop item's", overrides: { sourceItemId: "1".repeat(41) } },
    {
      why: "a product page on Rossmann's site",
      overrides: { productUrl: "https://www.rossmann.pl/Produkt/Kremy-do-twarzy/NIVEA-Soft,26900,13049" },
    },
    { why: "a plain-http product page", overrides: { productUrl: "http://www.hebe.pl/nivea-soft.html" } },
    {
      why: "an image on Rossmann's image host",
      overrides: { imageUrl: "https://pro-fra-s3-productsassets.rossmann.pl/x.webp" },
    },
  ])("refuses a Hebe item with $why, which fails Hebe's own checks", async ({ overrides }) => {
    const [item] = await hebeItems();

    expect(parseWatchlistForm(hebeForm(item))).not.toBeNull();
    expect(parseWatchlistForm(hebeForm(item, overrides))).toBeNull();
  });

  it("refuses a Hebe item posted as Rossmann's, whose id, page and image Rossmann's adapter doesn't accept", async () => {
    const [item] = await hebeItems();

    expect(parseWatchlistForm(hebeForm(item, { source: "rossmann" }))).toBeNull();
  });
});

describe("watchlistErrorMessage", () => {
  it("gives the page's own text for each error code", () => {
    for (const [code, message] of Object.entries(WATCHLIST_ERRORS)) {
      expect(watchlistErrorMessage(code)).toBe(message);
    }
  });

  it.each([null, "", "Kliknij tutaj, by odebrać nagrodę", "toString", "__proto__"])(
    "shows nothing for %j, which the app never sends",
    (code) => {
      expect(watchlistErrorMessage(code)).toBeNull();
    },
  );
});

describe("productFullName", () => {
  it("reads the brand, then the name, and the name alone without a brand", () => {
    expect(productFullName({ brand: "NIVEA", name: "Soft" })).toBe("NIVEA Soft");
    expect(productFullName({ brand: null, name: "Krem nawilżający" })).toBe("Krem nawilżający");
  });

  // Names in Natura, Hebe and Super-Pharm start with the brand, and "Dodaj" stores them so, with the brand beside them.
  it.each([
    // The night cream picked in Natura on the kitchen sink's list (src/dev/watchlist-fixtures.ts), whose page's title
    // read „SORAYA SORAYA Beauty Sleep krem na noc 50 ml”.
    { why: "in the same case", brand: "SORAYA", name: "SORAYA Beauty Sleep krem na noc 50 ml" },
    { why: "in another case", brand: "Nivea", name: "NIVEA SOFT krem intensywnie nawilżający 300 ml" },
  ])("reads a name that starts with its brand $why alone, so the brand is read once", ({ brand, name }) => {
    expect(productFullName({ brand, name })).toBe(name);
  });

  it("reads the brand before a name that starts with only some of its words", () => {
    // Super-Pharm's AA LAAB face wash (105870): its brand's second word isn't the name's.
    expect(
      productFullName({ brand: "AA Cosmetics", name: "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający" }),
    ).toBe("AA Cosmetics AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający");
  });
});

describe("addToWatchlist", () => {
  const NEW_ID = "4f1c2a8e-5b7d-4c3e-9a1f-0d2b3c4e5f60";

  function insertStub(result: { data: unknown; error: { code: string; message: string } | null }) {
    const single = vi.fn(() => Promise.resolve(result));
    const abortSignal = vi.fn((_signal: AbortSignal) => ({ single }));
    const select = vi.fn((_columns: string) => ({ abortSignal }));
    const insert = vi.fn((_row: Record<string, unknown>) => ({ select }));
    const from = vi.fn((_table: string) => ({ insert }));
    return { client: { from } as unknown as SupabaseClient, from, insert, select, abortSignal };
  }

  it("inserts the candidate into the user's watchlist and returns the new id, within a time limit", async () => {
    const { client, from, insert, select, abortSignal } = insertStub({ data: { id: NEW_ID }, error: null });

    expect(await addToWatchlist(client, softCandidate())).toEqual({ kind: "added", id: NEW_ID });
    expect(from).toHaveBeenCalledWith("watchlist_items");
    expect(select).toHaveBeenCalledWith("id");
    expect(insert).toHaveBeenCalledWith({
      source: "rossmann",
      source_item_id: "26900",
      brand: "NIVEA",
      name: "Soft",
      caption: "krem uniwersalny, nawilżający",
      size_text: "300 ml",
      size_value: 300,
      size_unit: "ml",
      eans: ["4005900009319", "4005808890637", "5900017001234"],
      product_url: SOFT_PAGE,
      image_url: "https://pro-fra-s3-productsassets.rossmann.pl/product_1_medium/26900_360_350_1785530324.webp",
    });
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("reports a product that is already on the list", async () => {
    const { client } = insertStub({ data: null, error: { code: "23505", message: "duplicate key value" } });

    expect(await addToWatchlist(client, softCandidate())).toBe("exists");
  });

  it.each([
    {
      answer: "any other failure",
      result: { data: null, error: { code: "42501", message: "permission denied for table watchlist_items" } },
    },
    // The id goes into the product page's URL, so only a UUID will do.
    { answer: "an inserted row without a UUID id", result: { data: { id: "../auth/signout" }, error: null } },
  ])("reports $answer, and logs it", async ({ result }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = insertStub(result);

    expect(await addToWatchlist(client, softCandidate())).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("parseWatchlistItemId", () => {
  it.each([
    { value: "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb", id: "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb" },
    { value: "00000000-0000-4000-8000-000000000000", id: "00000000-0000-4000-8000-000000000000" },
    { value: "not-a-uuid", id: null },
    { value: "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb/../x", id: null },
    { value: "", id: null },
    { value: null, id: null },
    { value: undefined, id: null },
  ])("reads $value as $id", ({ value, id }) => {
    expect(parseWatchlistItemId(value)).toBe(id);
  });
});

describe("getWatchlistProduct", () => {
  const ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";

  function productStub(result: { data: unknown; error: { message: string } | null }) {
    const maybeSingle = vi.fn(() => Promise.resolve(result));
    const abortSignal = vi.fn((_signal: AbortSignal) => ({ maybeSingle }));
    const eq = vi.fn((_column: string, _value: string) => ({ abortSignal }));
    const select = vi.fn((_columns: string) => ({ eq }));
    const from = vi.fn((_table: string) => ({ select }));
    return { client: { from } as unknown as SupabaseClient, from, eq, abortSignal };
  }

  const row = {
    id: ID,
    source: "rossmann",
    source_item_id: "26900",
    brand: "NIVEA",
    name: "Soft",
    caption: "krem uniwersalny, nawilżający",
    size_text: "300 ml",
    size_value: 300,
    size_unit: "ml",
    eans: ["4005900009319", "4005808890637"],
    product_url: SOFT_PAGE,
    image_url: null,
    created_at: "2026-09-27T12:00:00+00:00",
  };

  it("reads the user's product with its size and EANs, within a time limit", async () => {
    const { client, from, eq, abortSignal } = productStub({ data: row, error: null });

    expect(await getWatchlistProduct(client, ID)).toEqual({
      id: ID,
      source: "rossmann",
      sourceItemId: "26900",
      brand: "NIVEA",
      name: "Soft",
      caption: "krem uniwersalny, nawilżający",
      sizeText: "300 ml",
      imageUrl: null,
      addedAt: row.created_at,
      size: { value: 300, unit: "ml" },
      eans: ["4005900009319", "4005808890637"],
      productUrl: SOFT_PAGE,
    });
    expect(from).toHaveBeenCalledWith("watchlist_items");
    expect(eq).toHaveBeenCalledWith("id", ID);
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("gives a product added before its page was stored no link", async () => {
    const { client } = productStub({ data: { ...row, product_url: null }, error: null });

    expect(await getWatchlistProduct(client, ID)).toMatchObject({ productUrl: null });
  });

  it("gives a product without a size a size of null", async () => {
    const { client } = productStub({
      data: { ...row, size_text: null, size_value: null, size_unit: null },
      error: null,
    });

    expect(await getWatchlistProduct(client, ID)).toMatchObject({ sizeText: null, size: null });
  });

  it("gives null when there's no such product on the user's list", async () => {
    const { client } = productStub({ data: null, error: null });

    expect(await getWatchlistProduct(client, ID)).toBeNull();
  });

  it.each([
    { answer: "a failed query", result: { data: null, error: { message: "canceling statement due to timeout" } } },
    { answer: "an odd row", result: { data: { ...row, eans: "4005900009319" }, error: null } },
  ])("gives failed for $answer, and logs it", async ({ result }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = productStub(result);

    expect(await getWatchlistProduct(client, ID)).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("listWatchlist", () => {
  function selectStub(result: { data: unknown; error: { message: string } | null }) {
    const abortSignal = vi.fn((_signal: AbortSignal) => Promise.resolve(result));
    const order = vi.fn((_column: string, _options: { ascending: boolean }) => ({ abortSignal }));
    const select = vi.fn((_columns: string) => ({ order }));
    const from = vi.fn((_table: string) => ({ select }));
    return { client: { from } as unknown as SupabaseClient, select, order, abortSignal };
  }

  const row = {
    id: "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb",
    source: "rossmann",
    source_item_id: "26900",
    brand: "NIVEA",
    name: "Soft",
    caption: "krem uniwersalny, nawilżający",
    size_text: "300 ml",
    size_value: 300,
    size_unit: "ml",
    image_url: null,
    created_at: "2026-09-27T12:00:00+00:00",
  };
  const item = {
    id: row.id,
    source: "rossmann",
    sourceItemId: "26900",
    brand: "NIVEA",
    name: "Soft",
    caption: "krem uniwersalny, nawilżający",
    sizeText: "300 ml",
    size: { value: 300, unit: "ml" },
    imageUrl: null,
    addedAt: row.created_at,
  };

  it("maps the user's rows to items, their sizes included, newest first, within a time limit", async () => {
    const { client, select, order, abortSignal } = selectStub({ data: [row], error: null });

    expect(await listWatchlist(client)).toEqual([item]);
    expect(select).toHaveBeenCalledWith(
      "id, source, source_item_id, brand, name, caption, size_text, size_value, size_unit, image_url, created_at",
    );
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("gives a product without a size a size of null", async () => {
    const { client } = selectStub({
      data: [{ ...row, size_text: null, size_value: null, size_unit: null }],
      error: null,
    });

    expect(await listWatchlist(client)).toEqual([{ ...item, sizeText: null, size: null }]);
  });

  it("drops an odd row, a size it can't read included, and keeps the rest of the list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = selectStub({
      data: [{ ...row, id: "odd", source: "dm" }, { ...row, id: "odd-size", size_unit: "l" }, row],
      error: null,
    });

    expect(await listWatchlist(client)).toEqual([item]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    { answer: "a failed query", result: { data: null, error: { message: "permission denied" } } },
    { answer: "an answer that isn't a list", result: { data: { rows: [] }, error: null } },
  ])("gives null for $answer", async ({ result }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = selectStub(result);

    expect(await listWatchlist(client)).toBeNull();
  });
});

describe("removeFromWatchlist", () => {
  const ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";

  function deleteStub(result: { data: unknown; error: { code: string; message: string } | null }) {
    const abortSignal = vi.fn((_signal: AbortSignal) => Promise.resolve(result));
    const select = vi.fn((_columns: string) => ({ abortSignal }));
    const eq = vi.fn((_column: string, _value: string) => ({ select }));
    const remove = vi.fn(() => ({ eq }));
    const from = vi.fn((_table: string) => ({ delete: remove }));
    return { client: { from } as unknown as SupabaseClient, from, remove, eq, select, abortSignal };
  }

  it("deletes the user's row by its id, asking for it back, within a time limit", async () => {
    const { client, from, remove, eq, select, abortSignal } = deleteStub({ data: [{ id: ID }], error: null });

    expect(await removeFromWatchlist(client, ID)).toBe("removed");
    expect(from).toHaveBeenCalledWith("watchlist_items");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith("id", ID);
    expect(select).toHaveBeenCalledWith("id");
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("gives gone when no row came back: the product wasn't on the user's list any more", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = deleteStub({ data: [], error: null });

    expect(await removeFromWatchlist(client, ID)).toBe("gone");
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    {
      answer: "a failed delete",
      result: { data: null, error: { code: "42501", message: "permission denied for table watchlist_items" } },
    },
    { answer: "no answer at all", result: { data: null, error: null } },
    { answer: "an answer that isn't a list", result: { data: { id: ID }, error: null } },
    { answer: "a row without its id", result: { data: [{}], error: null } },
    {
      answer: "two rows for one id",
      result: { data: [{ id: ID }, { id: "4f1c2a8e-5b7d-4c3e-9a1f-0d2b3c4e5f60" }], error: null },
    },
  ])("gives failed for $answer, never gone, and logs it", async ({ result }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = deleteStub(result);

    expect(await removeFromWatchlist(client, ID)).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("removalBackTo", () => {
  const ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";

  it.each<{ outcome: RemovalOutcome; filter: ListFilter; to: string }>([
    { outcome: "removed", filter: "check", to: "/watchlist?f=check&removed=done" },
    { outcome: "gone", filter: "check", to: "/watchlist?f=check&removed=gone" },
    { outcome: "failed", filter: "check", to: `/watchlist/${ID}?f=check&removal=failed#remove` },
    { outcome: "config", filter: "check", to: "/watchlist?f=check&error=config" },
    { outcome: "removed", filter: "all", to: "/watchlist?removed=done" },
    { outcome: "failed", filter: "all", to: `/watchlist/${ID}?removal=failed#remove` },
  ])("goes back after $outcome to $to", ({ outcome, filter, to }) => {
    expect(removalBackTo(ID, outcome, filter)).toBe(to);
  });

  it("points a failure's address to the confirm, at the page's foot, by its id", () => {
    expect(new URL(removalBackTo(ID, "failed", "all"), "https://drogeria.example").hash).toBe(`#${REMOVAL_ANCHOR}`);
  });

  it("brings codes each page turns into its own text", () => {
    const param = (outcome: RemovalOutcome, name: string) =>
      new URL(removalBackTo(ID, outcome, "promo"), "https://drogeria.example").searchParams.get(name);

    expect(removedNotice(param("removed", "removed"))).toBe("Usunięto produkt z listy.");
    expect(removedNotice(param("gone", "removed"))).toBe("Tego produktu nie było już na Twojej liście.");
    expect(removalErrorMessage(param("failed", "removal"))).toBe(
      "Nie udało się usunąć produktu z listy. Spróbuj ponownie.",
    );
    expect(watchlistErrorMessage(param("config", "error"))).toBe(WATCHLIST_ERRORS.config);
  });
});

describe("removedNotice and removalErrorMessage", () => {
  it.each([null, "", "1", "DONE", "failed", "Kliknij tutaj, by odebrać nagrodę", "toString", "__proto__"])(
    "the list shows no removal's notice for %j, which the app never sends",
    (code) => {
      expect(removedNotice(code)).toBeNull();
    },
  );

  it.each([null, "", "1", "done", "FAILED", "Kliknij tutaj, by odebrać nagrodę", "toString", "__proto__"])(
    "the product's page shows no removal's error for %j, which the app never sends",
    (code) => {
      expect(removalErrorMessage(code)).toBeNull();
    },
  );
});

describe("removalGoneNotice", () => {
  it("says the product is no longer on the list after a failed removal's code, as a removal that went through", () => {
    expect(removalGoneNotice("failed")).toBe("Produktu nie ma już na Twojej liście.");
  });

  it.each([null, "", "1", "done", "gone", "FAILED", "Kliknij tutaj, by odebrać nagrodę", "toString", "__proto__"])(
    "the product's missing page shows no removal's notice for %j, which the app never sends",
    (code) => {
      expect(removalGoneNotice(code)).toBeNull();
    },
  );
});
