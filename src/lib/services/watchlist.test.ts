import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import results from "@/lib/services/shops/fixtures/rossmann-search-results.json";
import { addToWatchlist, listWatchlist, parseWatchlistForm } from "@/lib/services/watchlist";

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
});

describe("addToWatchlist", () => {
  function insertStub(error: { code: string; message: string } | null) {
    const insert = vi.fn((_row: Record<string, unknown>) => Promise.resolve({ error }));
    const from = vi.fn((_table: string) => ({ insert }));
    return { client: { from } as unknown as SupabaseClient, from, insert };
  }

  it("inserts the candidate into the user's watchlist", async () => {
    const { client, from, insert } = insertStub(null);

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
    const order = vi.fn((_column: string, _options: { ascending: boolean }) => Promise.resolve(result));
    const select = vi.fn((_columns: string) => ({ order }));
    const from = vi.fn((_table: string) => ({ select }));
    return { client: { from } as unknown as SupabaseClient, order };
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

  it("maps the user's rows to items, newest first", async () => {
    const { client, order } = selectStub({ data: [row], error: null });

    expect(await listWatchlist(client)).toEqual([
      {
        id: row.id,
        source: "rossmann",
        sourceItemId: "26900",
        brand: "NIVEA",
        name: "Soft",
        caption: "krem uniwersalny, nawilżający",
        sizeText: "300 ml",
        imageUrl: null,
        addedAt: row.created_at,
      },
    ]);
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it.each([
    { answer: "a failed query", result: { data: null, error: { message: "permission denied" } } },
    { answer: "rows of another shape", result: { data: [{ ...row, source: "dm" }], error: null } },
  ])("gives null for $answer", async ({ result }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = selectStub(result);

    expect(await listWatchlist(client)).toBeNull();
  });
});
