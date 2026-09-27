import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createShopGate } from "@/lib/services/shop-gate";
import { isRossmannImage, searchRossmann } from "@/lib/services/shops/rossmann";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import empty from "@/lib/services/shops/fixtures/rossmann-search-empty.json";
import misspelled from "@/lib/services/shops/fixtures/rossmann-search-misspelled.json";
import results from "@/lib/services/shops/fixtures/rossmann-search-results.json";

// The fixtures are real Rossmann answers, recorded once with curl; no test reaches the live shop.
const searchUrl = (query: string) =>
  `https://www.rossmann.pl/products/v4/api/Products?search=${encodeURIComponent(query)}&page=1&pageSize=24`;

/** A real gate that allows every reservation, over a fetch that answers only the given recordings. */
function setup(entries: ReplayEntry[], reservation: unknown = { outcome: "allowed" }) {
  const fetchMock = vi.fn(createReplayFetch(entries));
  const gate = createShopGate({
    reserve: () => Promise.resolve(reservation),
    reportBlock: () => Promise.resolve(),
    fetch: fetchMock,
    log: () => undefined,
  });
  return { gate, fetchMock };
}

/** Every URL the fetch was asked for, so a test can't pass on the wrong request. */
function requestedUrls(fetchMock: Mock<typeof fetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : new URL(input).href));
}

/** A recording that can be edited without touching the imported fixture. */
function editable(fixture: unknown): { data: { items: Record<string, unknown>[] } } {
  return structuredClone(fixture) as { data: { items: Record<string, unknown>[] } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Rossmann search: recorded answers", () => {
  it("maps the results to candidates", async () => {
    const { gate, fetchMock } = setup([{ url: searchUrl("nivea soft"), status: 200, body: JSON.stringify(results) }]);

    const search = await searchRossmann(gate, "nivea soft");

    expect(requestedUrls(fetchMock)).toEqual([searchUrl("nivea soft")]);
    if (search.kind !== "results") {
      throw new Error(`expected results, got ${search.kind}`);
    }
    expect(search.spellingHint).toBeNull();
    expect(search.candidates).toHaveLength(5);
    expect(search.candidates[0]).toEqual({
      source: "rossmann",
      sourceItemId: "26900",
      brand: "NIVEA",
      name: "Soft",
      caption: "krem uniwersalny, nawilżający",
      sizeText: "300 ml",
      size: { value: 300, unit: "ml" },
      eans: ["4005900009319", "4005808890637", "5900017001234"],
      imageUrl: "https://pro-fra-s3-productsassets.rossmann.pl/product_1_medium/26900_360_350_1785530324.webp",
    });
  });

  it("names an item from fallbackName, and keeps a multipack size as text only", async () => {
    const { gate } = setup([{ url: searchUrl("nivea soft"), status: 200, body: JSON.stringify(results) }]);

    const search = await searchRossmann(gate, "nivea soft");

    if (search.kind !== "results") {
      throw new Error(`expected results, got ${search.kind}`);
    }
    // Rossmann sends this lip balm with an empty name.
    expect(search.candidates.find((candidate) => candidate.sourceItemId === "11790")).toMatchObject({
      name: "Balsam do ust",
      sizeText: "4,8 g",
      size: { value: 4.8, unit: "g" },
    });
    expect(search.candidates.find((candidate) => candidate.sourceItemId === "2079205")).toMatchObject({
      sizeText: "4x57 szt.",
      size: null,
    });
  });

  it("passes on Rossmann's spelling hint for a misspelled query", async () => {
    const { gate, fetchMock } = setup([
      { url: searchUrl("niwea soft"), status: 200, body: JSON.stringify(misspelled) },
    ]);

    const search = await searchRossmann(gate, "niwea soft");

    expect(requestedUrls(fetchMock)).toEqual([searchUrl("niwea soft")]);
    expect(search).toMatchObject({ kind: "results", spellingHint: "nivea soft" });
  });

  it("returns no candidates when nothing matches", async () => {
    const { gate, fetchMock } = setup([{ url: searchUrl("zzqqxxjj"), status: 200, body: JSON.stringify(empty) }]);

    expect(await searchRossmann(gate, "zzqqxxjj")).toEqual({ kind: "results", candidates: [], spellingHint: null });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("zzqqxxjj")]);
  });
});

describe("Rossmann search: what it keeps out", () => {
  it("shows only https images on Rossmann's own hosts", async () => {
    const body = editable(results);
    const [first, , third] = body.data.items;
    first.pictures = [{ type: 1, medium: "http://pro-fra-s3-productsassets.rossmann.pl/plain-http.webp" }];
    third.pictures = [{ type: 1, medium: "https://images.example.com/elsewhere.webp" }];
    const { gate } = setup([{ url: searchUrl("nivea soft"), status: 200, body: JSON.stringify(body) }]);

    const search = await searchRossmann(gate, "nivea soft");

    if (search.kind !== "results") {
      throw new Error(`expected results, got ${search.kind}`);
    }
    expect(search.candidates[0].imageUrl).toBeNull();
    expect(search.candidates[2].imageUrl).toBeNull();
    expect(search.candidates[1].imageUrl).toMatch(/^https:\/\/pro-fra-s3-productsassets\.rossmann\.pl\//);
    expect(isRossmannImage("https://rossmann.pl.images.example.com/look-alike.webp")).toBe(false);
  });

  it("drops a malformed item and keeps the others", async () => {
    const body = editable(results);
    body.data.items.splice(1, 0, { id: null, name: "No id" }, { id: 1, name: "  ", fallbackName: "" });
    const { gate } = setup([{ url: searchUrl("nivea soft"), status: 200, body: JSON.stringify(body) }]);

    const search = await searchRossmann(gate, "nivea soft");

    if (search.kind !== "results") {
      throw new Error(`expected results, got ${search.kind}`);
    }
    expect(search.candidates.map((candidate) => candidate.sourceItemId)).toEqual(
      results.data.items.map((item) => String(item.id)),
    );
  });
});

describe("Rossmann search: unavailable", () => {
  it("doesn't call Rossmann when the gate skips the call", async () => {
    const { gate, fetchMock } = setup([{ url: searchUrl("nivea soft"), status: 200, body: JSON.stringify(results) }], {
      outcome: "capped",
    });

    expect(await searchRossmann(gate, "nivea soft")).toEqual({ kind: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { answer: "an HTML page", body: "<html>Przerwa techniczna</html>" },
    { answer: "JSON of another shape", body: JSON.stringify({ items: [] }) },
  ])("gives up on $answer", async ({ body }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([{ url: searchUrl("nivea soft"), status: 200, body }]);

    expect(await searchRossmann(gate, "nivea soft")).toEqual({ kind: "unavailable" });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("nivea soft")]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("gives up when reading the body fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const brokenBody = new ReadableStream({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(brokenBody)));
    const gate = createShopGate({
      reserve: () => Promise.resolve({ outcome: "allowed" }),
      reportBlock: () => Promise.resolve(),
      fetch: fetchMock,
      log: () => undefined,
    });

    expect(await searchRossmann(gate, "nivea soft")).toEqual({ kind: "unavailable" });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("nivea soft")]);
  });
});
