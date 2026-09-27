import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createShopGate, type ShopGate } from "@/lib/services/shop-gate";
import { isRossmannImage, isRossmannProductUrl, searchRossmann } from "@/lib/services/shops/rossmann";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import empty from "@/lib/services/shops/fixtures/rossmann-search-empty.json";
import misspelled from "@/lib/services/shops/fixtures/rossmann-search-misspelled.json";
import results from "@/lib/services/shops/fixtures/rossmann-search-results.json";

// The fixtures are real Rossmann answers, recorded once with curl; no test reaches the live shop.
const searchUrl = (query: string) =>
  `https://www.rossmann.pl/products/v4/api/Products?search=${encodeURIComponent(query)}&page=1&pageSize=24`;
const IMAGE_HOST = "https://pro-fra-s3-productsassets.rossmann.pl";

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

/** Searches "nivea soft" against a body built from the given items. */
async function searchItems(items: unknown[], spellCheckHint: unknown = "") {
  const body = JSON.stringify({ data: { items, spellCheckHint } });
  const { gate } = setup([{ url: searchUrl("nivea soft"), status: 200, body }]);
  const search = await searchRossmann(gate, "nivea soft");
  if (search.kind !== "results") {
    throw new Error(`expected results, got ${search.kind}`);
  }
  return search;
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
      productUrl:
        "https://www.rossmann.pl/Produkt/Kremy-do-twarzy/NIVEA-Soft-krem-uniwersalny-nawilzajacy-300-ml,26900,13049",
      imageUrl: `${IMAGE_HOST}/product_1_medium/26900_360_350_1785530324.webp`,
    });
  });

  it("names an item from fallbackName, and keeps a multipack size as text only", async () => {
    const search = await searchItems(results.data.items);

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

  it("gives the search its own time limit", async () => {
    const fetch = vi.fn<ShopGate["fetch"]>(() => Promise.resolve({ kind: "failed", reason: "network" }));

    await searchRossmann({ fetch }, "nivea soft");

    const [, , init] = fetch.mock.calls[0];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });
});

describe("Rossmann search: every result can be added", () => {
  it("keeps the first 10 EANs of a product with more", async () => {
    // A recorded Rossmann product with 12 EANs.
    const parasol = empty.data.recommendedProducts.find((item) => item.id === 17420);

    const search = await searchItems([parasol]);

    expect(parasol?.eanNumber).toHaveLength(12);
    expect(search.candidates[0].eans).toEqual(parasol?.eanNumber.slice(0, 10));
  });

  it("cuts over-long text to its limit, and drops a size text too long to be a size", async () => {
    const [soft] = editable(results).data.items;
    const long = { ...soft, brand: "B".repeat(200), caption: "c".repeat(400), unit: "u".repeat(50) };

    const [candidate] = (await searchItems([long])).candidates;

    expect(candidate.brand).toHaveLength(120);
    expect(candidate.caption).toHaveLength(300);
    expect(candidate).toMatchObject({ sizeText: null, size: null });
  });

  it("drops an item whose id can't go into the form", async () => {
    const [soft] = editable(results).data.items;

    expect((await searchItems([{ ...soft, id: "26900-x" }])).candidates).toEqual([]);
  });
});

describe("Rossmann search: odd values cost only themselves", () => {
  it("passes over an unusable front shot to the next picture, and skips odd EANs", async () => {
    const [soft] = editable(results).data.items;
    const odd = {
      ...soft,
      pictures: [{ type: 1, medium: null }, "not a picture", { type: 0, medium: `${IMAGE_HOST}/next.webp` }],
      eanNumber: [4005900009319, "4005900009319"],
    };

    const [candidate] = (await searchItems([odd])).candidates;

    expect(candidate.imageUrl).toBe(`${IMAGE_HOST}/next.webp`);
    expect(candidate.eans).toEqual(["4005900009319"]);
  });

  it("uses the first picture when there is no front shot", async () => {
    const [soft] = editable(results).data.items;
    const pictures = [
      { type: 2, medium: `${IMAGE_HOST}/first.webp` },
      { type: 0, medium: `${IMAGE_HOST}/second.webp` },
    ];

    const [candidate] = (await searchItems([{ ...soft, pictures }])).candidates;

    expect(candidate.imageUrl).toBe(`${IMAGE_HOST}/first.webp`);
  });

  it.each([
    { hint: 42, why: "isn't text" },
    { hint: "Nivea Soft", why: "only repeats the query" },
  ])("shows no hint when Rossmann's hint $why", async ({ hint }) => {
    const search = await searchItems(results.data.items, hint);

    expect(search.spellingHint).toBeNull();
    expect(search.candidates).toHaveLength(5);
  });
});

describe("Rossmann search: what it keeps out", () => {
  it("shows only https images on Rossmann's own hosts", async () => {
    const body = editable(results);
    const [first, , third] = body.data.items;
    first.pictures = [{ type: 1, medium: "http://pro-fra-s3-productsassets.rossmann.pl/plain-http.webp" }];
    third.pictures = [{ type: 1, medium: "https://images.example.com/elsewhere.webp" }];

    const search = await searchItems(body.data.items);

    expect(search.candidates[0].imageUrl).toBeNull();
    expect(search.candidates[2].imageUrl).toBeNull();
    expect(search.candidates[1].imageUrl).toMatch(/^https:\/\/pro-fra-s3-productsassets\.rossmann\.pl\//);
    expect(isRossmannImage("https://rossmann.pl.images.example.com/look-alike.webp")).toBe(false);
  });

  it("links only to pages on Rossmann's site, and an odd link costs only the link", async () => {
    const [soft] = editable(results).data.items;
    const links = [
      "https://evil.example/Produkt/x",
      "//evil.example/Produkt/x",
      "Produkt/x",
      `/Produkt/${"x".repeat(500)}`,
      42,
      undefined,
    ];

    const search = await searchItems(links.map((navigateUrl) => ({ ...soft, navigateUrl })));

    expect(search.candidates).toHaveLength(links.length);
    expect(search.candidates.map((candidate) => candidate.productUrl)).toEqual(links.map(() => null));
    expect(isRossmannProductUrl("https://www.rossmann.pl/Produkt/x,1,2")).toBe(true);
    expect(isRossmannProductUrl("http://www.rossmann.pl/Produkt/x,1,2")).toBe(false);
    expect(isRossmannProductUrl("https://rossmann.pl.evil.example/Produkt/x")).toBe(false);
  });

  it("drops a malformed item and keeps the others", async () => {
    const body = editable(results);
    body.data.items.splice(1, 0, { id: null, name: "No id" }, { id: 1, name: "  ", fallbackName: "" });

    const search = await searchItems(body.data.items);

    expect(search.candidates.map((candidate) => candidate.sourceItemId)).toEqual(
      results.data.items.map((item) => String(item.id)),
    );
  });
});

describe("Rossmann search: why it's unavailable", () => {
  it.each([
    { refusal: "the cap is reached", reservation: { outcome: "capped" }, expected: { reason: "busy" } },
    {
      refusal: "the shop is paused",
      reservation: { outcome: "paused", until: "2026-09-27T20:15:00+00:00" },
      expected: { reason: "paused", until: "2026-09-27T20:15:00+00:00" },
    },
    { refusal: "the shop is stopped", reservation: { outcome: "stopped" }, expected: { reason: "stopped" } },
    { refusal: "the counter can't be read", reservation: null, expected: { reason: "failed" } },
  ])("says so without calling Rossmann when $refusal", async ({ reservation, expected }) => {
    const { gate, fetchMock } = setup(
      [{ url: searchUrl("nivea soft"), status: 200, body: JSON.stringify(results) }],
      reservation,
    );

    expect(await searchRossmann(gate, "nivea soft")).toEqual({ kind: "unavailable", ...expected });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a 403 as stopped", async () => {
    const { gate } = setup([{ url: searchUrl("nivea soft"), status: 403 }]);

    expect(await searchRossmann(gate, "nivea soft")).toEqual({ kind: "unavailable", reason: "stopped" });
  });

  it("reports a 429 as paused until its Retry-After has passed", async () => {
    const { gate } = setup([{ url: searchUrl("nivea soft"), status: 429, headers: { "Retry-After": "120" } }]);

    const search = await searchRossmann(gate, "nivea soft");

    if (search.kind !== "unavailable" || search.until === undefined) {
      throw new Error("expected a pause with its end");
    }
    expect(search.reason).toBe("paused");
    const secondsAhead = (Date.parse(search.until) - Date.now()) / 1000;
    expect(secondsAhead).toBeGreaterThan(115);
    expect(secondsAhead).toBeLessThanOrEqual(120);
  });

  it.each([
    { answer: "a 500", entry: { url: searchUrl("nivea soft"), status: 500 } },
    { answer: "a network error", entry: { url: searchUrl("nivea soft"), error: "network" as const } },
  ])("reports $answer as failed", async ({ entry }) => {
    const { gate } = setup([entry]);

    expect(await searchRossmann(gate, "nivea soft")).toEqual({ kind: "unavailable", reason: "failed" });
  });

  it.each([
    { answer: "text that echoes the search", body: "nivea soft" },
    { answer: "an HTML page", body: "<html>Przerwa techniczna</html>" },
    { answer: "JSON of another shape", body: JSON.stringify({ items: [] }) },
  ])("gives up on $answer, and logs it without the search text", async ({ body }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([{ url: searchUrl("nivea soft"), status: 200, body }]);

    expect(await searchRossmann(gate, "nivea soft")).toEqual({ kind: "unavailable", reason: "failed" });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("nivea soft")]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("nivea");
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

    expect(await searchRossmann(gate, "nivea soft")).toEqual({ kind: "unavailable", reason: "failed" });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("nivea soft")]);
  });
});
