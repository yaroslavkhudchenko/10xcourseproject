import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopGate } from "@/lib/services/shop-gate";
import empty from "@/lib/services/shops/fixtures/rossmann-search-empty.json";
import misspelled from "@/lib/services/shops/fixtures/rossmann-search-misspelled.json";
import results from "@/lib/services/shops/fixtures/rossmann-search-results.json";
import { searchRossmann } from "@/lib/services/shops/rossmann";
import { createReplayFetch } from "@/lib/services/testing/replay-fetch";
import {
  addToWatchlist,
  getWatchlistProduct,
  listWatchlist,
  parseWatchlistForm,
  parseWatchlistItemId,
  watchlistErrorMessage,
  WATCHLIST_ERRORS,
} from "@/lib/services/watchlist";
import type { ProductCandidate } from "@/types";

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
    { field: "a shop other than Rossmann", overrides: { source: "hebe" } },
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

  it("accepts every result the adapter makes from the recordings, posted the way the page posts it", async () => {
    const items: unknown[] = [results, misspelled, empty].flatMap((fixture) => [
      ...fixture.data.items,
      ...fixture.data.recommendedProducts,
    ]);
    const url = "https://www.rossmann.pl/products/v4/api/Products?search=nivea%20soft&page=1&pageSize=24";
    const gate = createShopGate({
      reserve: () => Promise.resolve({ outcome: "allowed" }),
      reportBlock: () => Promise.resolve(),
      fetch: createReplayFetch([{ url, status: 200, body: JSON.stringify({ data: { items, spellCheckHint: "" } }) }]),
      log: () => undefined,
    });

    const search = await searchRossmann(gate, "nivea soft");

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
    return { client: { from } as unknown as SupabaseClient, order, abortSignal };
  }

  const row = {
    id: "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb",
    source: "rossmann",
    source_item_id: "26900",
    brand: "NIVEA",
    name: "Soft",
    caption: "krem uniwersalny, nawilżający",
    size_text: "300 ml",
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
    imageUrl: null,
    addedAt: row.created_at,
  };

  it("maps the user's rows to items, newest first, within a time limit", async () => {
    const { client, order, abortSignal } = selectStub({ data: [row], error: null });

    expect(await listWatchlist(client)).toEqual([item]);
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("drops an odd row and keeps the rest of the list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = selectStub({ data: [{ ...row, id: "odd", source: "dm" }, row], error: null });

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
