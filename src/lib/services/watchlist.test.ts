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
  listWatchlist,
  parseWatchlistForm,
  watchlistErrorMessage,
  WATCHLIST_ERRORS,
} from "@/lib/services/watchlist";
import type { ProductCandidate } from "@/types";

// The "Dodaj" form as the results page posts it, built from the first recorded Rossmann item.
const [soft] = results.data.items;
const softImage = soft.pictures.find((picture) => picture.type === 1)?.medium ?? "";

function dodajForm(overrides: Record<string, string | string[]> = {}): FormData {
  const fields: Record<string, string | string[]> = {
    source: "rossmann",
    sourceItemId: String(soft.id),
    name: soft.name,
    brand: soft.brand,
    caption: soft.caption,
    sizeText: soft.unit,
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
      imageUrl: "https://pro-fra-s3-productsassets.rossmann.pl/product_1_medium/26900_360_350_1785530324.webp",
    });
  });

  it("parses the size again from its text, and turns empty fields into null", () => {
    const form = dodajForm({ sizeText: "0,5 l", brand: "", caption: "  ", imageUrl: "", eans: [] });
    // Not a form field: size numbers are never taken from the form.
    form.append("size_value", "999");

    expect(parseWatchlistForm(form)).toMatchObject({
      brand: null,
      caption: null,
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
  function insertStub(error: { code: string; message: string } | null) {
    const abortSignal = vi.fn((_signal: AbortSignal) => Promise.resolve({ error }));
    const insert = vi.fn((_row: Record<string, unknown>) => ({ abortSignal }));
    const from = vi.fn((_table: string) => ({ insert }));
    return { client: { from } as unknown as SupabaseClient, from, insert, abortSignal };
  }

  it("inserts the candidate into the user's watchlist, within a time limit", async () => {
    const { client, from, insert, abortSignal } = insertStub(null);

    expect(await addToWatchlist(client, softCandidate())).toBe("added");
    expect(from).toHaveBeenCalledWith("watchlist_items");
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
      image_url: "https://pro-fra-s3-productsassets.rossmann.pl/product_1_medium/26900_360_350_1785530324.webp",
    });
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("reports a product that is already on the list", async () => {
    const { client } = insertStub({ code: "23505", message: "duplicate key value" });

    expect(await addToWatchlist(client, softCandidate())).toBe("exists");
  });

  it("reports any other failure, and logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = insertStub({ code: "42501", message: "permission denied for table watchlist_items" });

    expect(await addToWatchlist(client, softCandidate())).toBe("failed");
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
