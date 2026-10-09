import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createShopGate, type ShopGate, type ShopGateDeps, type ShopGateLogEntry } from "@/lib/services/shop-gate";
import { SHOP_ADAPTERS } from "@/lib/services/shops/registry";
import {
  fetchRossmannPrice,
  fetchRossmannPrices,
  isRossmannImage,
  isRossmannProductId,
  isRossmannProductUrl,
  searchRossmann,
  searchRossmannItems,
} from "@/lib/services/shops/rossmann";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import {
  CHALLENGE,
  gateOutcomes,
  loggedLine,
  loggedLines,
  NOT_FOUND_PAGE,
  pauseSecondsOf,
  type ServedAnswer,
} from "@/lib/services/testing/shop-answers";
import type { GateOutcome, PriceCheck, ShopCandidate, ShopOffer, ShopSearch } from "@/types";
import reduced from "@/lib/services/shops/fixtures/rossmann-detail-reduced.json";
import regular from "@/lib/services/shops/fixtures/rossmann-detail-regular.json";
import unknownProduct from "@/lib/services/shops/fixtures/rossmann-detail-unknown.json";
import aaLaab from "@/lib/services/shops/fixtures/rossmann-search-aa-laab.json";
import empty from "@/lib/services/shops/fixtures/rossmann-search-empty.json";
import misspelled from "@/lib/services/shops/fixtures/rossmann-search-misspelled.json";
import niveaSoft from "@/lib/services/shops/fixtures/rossmann-search-nivea-soft.json";
import results from "@/lib/services/shops/fixtures/rossmann-search-results.json";

// The fixtures are real Rossmann answers, recorded once; no test reaches the live shop.
// - rossmann-search-results.json, rossmann-search-misspelled.json and rossmann-search-empty.json (2026-09-27, for S-01,
//   watchlist-add-by-search): three curl requests from the developer machine, at least 2 s apart, with the gate's
//   User-Agent and `Accept: application/json`, each answer kept to its first 5 items. They searched for "nivea soft";
//   for "niwea soft", which Rossmann answered with the hint "nivea soft"; and for a query that finds nothing, served
//   here for "zzqqxxjj": no items, a totalCount of 0, and the recommendedProducts Rossmann shows instead.
// - rossmann-detail-reduced.json (Felix, 131225, on promotion) and rossmann-detail-regular.json (Nivea Soft, 26900):
//   from the research requests of 2026-09-28, whose URLs equal the adapter's, trimmed to the fields the price check
//   reads.
// - rossmann-detail-unknown.json (2026-09-28, for S-03, cheapest-shop-today, with the owner's approval): Rossmann's
//   answer to an id it doesn't have, served here for 999999999: a 404 in `application/problem+json; charset=utf-8`.
// - rossmann-search-nivea-soft.json and rossmann-search-aa-laab.json (2026-10-06, for add-from-other-shops, with the
//   owner's approval): two curl requests from the developer machine, 3 s apart and following no redirect, with the
//   gate's User-Agent and `Accept: application/json`, each asking for 10 items a page and kept whole. They searched for
//   "nivea soft" at 10:37:35 UTC, which found 5 items, and for "AA LAAB 100% Centella B12 Żel do mycia twarzy
//   nawilżający" at 10:37:49 UTC, which found 2. Each item carries its offer in the fields of a product's detail.
// The broken answers below each change one thing in a copy of these recordings, or stand in a page or an empty body
// where the JSON was.
// The list's search asks Rossmann for 10 items a page, as it asks every shop (SEARCH_SIZE in product-search.ts): the
// request the two recordings of 2026-10-06 answer. Each S-01 recording holds every item its search matched, its
// totalCount, so the list's request gets the same answer, and each is served for it.
const LIST_SIZE = 10;
const searchUrl = (query: string) =>
  `https://www.rossmann.pl/products/v4/api/Products?search=${encodeURIComponent(query)}&page=1&pageSize=10`;
// The requests the 10-item recordings answer, as they were sent: their text, and their URL spelled out, with the text
// encoded and 10 items a page, the list's own request.
const NIVEA_SOFT_SEARCH = {
  query: "nivea soft",
  url: "https://www.rossmann.pl/products/v4/api/Products?search=nivea%20soft&page=1&pageSize=10",
};
const AA_LAAB_SEARCH = {
  query: "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający",
  url:
    "https://www.rossmann.pl/products/v4/api/Products?search=AA%20LAAB%20100%25%20Centella%20B12%20%C5%BBel%20do" +
    "%20mycia%20twarzy%20nawil%C5%BCaj%C4%85cy&page=1&pageSize=10",
};
// One product's detail, as the price check asks for it and the rossmann-detail-*.json recordings were made.
const detailUrl = (id: string) => `https://www.rossmann.pl/products/v2/api/Products/${id}?shopNumber=null`;
const IMAGE_HOST = "https://pro-fra-s3-productsassets.rossmann.pl";
// Felix (131225) during a promotion, as rossmann-detail-reduced.json recorded it on 2026-09-28.
const FELIX_OFFER: ShopOffer = {
  price: 5.99,
  regularPrice: 9.99,
  lowestPrice30d: 6.39,
  promoEndsOn: "2026-09-30",
  available: true,
};
const FAILED: PriceCheck = { kind: "unavailable", reason: "failed" };

// Rossmann's recorded answer to an id it doesn't have: a 404 in problem+json.
const UNKNOWN_PRODUCT: ServedAnswer = {
  status: unknownProduct.status,
  headers: { "Content-Type": unknownProduct.contentType },
  body: unknownProduct.body,
};

/**
 * A real gate that gives every reservation the same answer, allowed by default, over a fetch that answers only the
 * given recordings. `reserve` shows each slot asked for, `reportBlock` each refusal reported, and `gateLog` the gate's
 * own log lines. `timeoutMs` shortens the gate's limit, so a request that never answers fails at once.
 */
function setup(entries: ReplayEntry[], reservation: unknown = { outcome: "allowed" }, timeoutMs?: number) {
  const fetchMock = vi.fn(createReplayFetch(entries));
  const reserve = vi.fn<ShopGateDeps["reserve"]>(() => Promise.resolve(reservation));
  const reportBlock = vi.fn<ShopGateDeps["reportBlock"]>(() => Promise.resolve());
  const gateLog = vi.fn<(entry: ShopGateLogEntry) => void>();
  const gate = createShopGate({ reserve, reportBlock, fetch: fetchMock, log: gateLog, timeoutMs });
  return { gate, fetchMock, reserve, reportBlock, gateLog };
}

/** Searches "nivea soft" against a body built from the given items and their count. */
async function searchItems(items: unknown[], spellCheckHint: unknown = "") {
  const body = JSON.stringify({ data: { items, totalCount: items.length, spellCheckHint } });
  const { gate } = setup([{ url: searchUrl("nivea soft"), status: 200, body }]);
  const search = await searchRossmann(gate, "nivea soft", LIST_SIZE);
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

/** What the item search's tests check a candidate by: its item, its name with its caption, its EANs, size and offer. */
type CandidateRow = Pick<ShopCandidate, "shopItemId" | "name" | "eans" | "sizeText" | "size" | "offer">;

/** A candidate as CandidateRow reads it. */
const rowOf = ({ shopItemId, name, eans, sizeText, size, offer }: ShopCandidate): CandidateRow => ({
  shopItemId,
  name,
  eans,
  sizeText,
  size,
  offer,
});

/** The candidates of an item search that had to find some. */
function candidatesOf(search: ShopSearch): ShopCandidate[] {
  if (search.kind !== "results") {
    throw new Error(`expected results, got ${search.kind}`);
  }
  return search.candidates;
}

// Nivea Soft 300 ml (26900) in rossmann-search-nivea-soft.json: reduced until 14 October 2026, with its price before
// the reduction and its 30-day low, each 26,99 zł in the recording.
const SOFT_OFFER: ShopOffer = {
  price: 15.99,
  regularPrice: 26.99,
  lowestPrice30d: 26.99,
  promoEndsOn: "2026-10-14",
  available: true,
};
// The candidates the item search makes of rossmann-search-nivea-soft.json, each as the recording carries its item: the
// name and the caption joined, as a row on the list joins them, the EANs, the size, and the offer, read as a product's
// detail is read. Nivea Soft and the Soft Rose lip balm are reduced; the other three carry only their price.
const NIVEA_SOFT_ROWS: CandidateRow[] = [
  {
    shopItemId: "26900",
    name: "Soft krem do twarzy, ciała i dłoni, nawilżający",
    eans: ["4005900009319", "4005808890637", "5900017001234"],
    sizeText: "300 ml",
    size: { value: 300, unit: "ml" },
    offer: SOFT_OFFER,
  },
  {
    shopItemId: "2126586",
    name: "Derma Control Clinical antyperspirant w sprayu, dla kobiet, 100h, Ultra Soft",
    eans: ["5900017107400"],
    sizeText: "150 ml",
    size: { value: 150, unit: "ml" },
    offer: { price: 22.99, regularPrice: null, lowestPrice30d: null, promoEndsOn: null, available: true },
  },
  {
    shopItemId: "2103263",
    name: "Soft Daily UV krem uniwersalny, nawilżający, SPF15",
    eans: ["9005800388267"],
    sizeText: "100 ml",
    size: { value: 100, unit: "ml" },
    offer: { price: 19.49, regularPrice: null, lowestPrice30d: null, promoEndsOn: null, available: true },
  },
  {
    // Rossmann sends this lip balm with an empty name, which its fallbackName stands in for.
    shopItemId: "11790",
    name: "Balsam do ust balsam do ust, Soft Rose",
    eans: ["9005800362939", "4005808369713", "4005808314935", "4005808850662"],
    sizeText: "4,8 g",
    size: { value: 4.8, unit: "g" },
    offer: { price: 11.49, regularPrice: 13.99, lowestPrice30d: 13.99, promoEndsOn: "2026-10-14", available: true },
  },
  {
    shopItemId: "2079205",
    name: "Soft & Cream chusteczki nawilżane, wielopak",
    eans: ["9005800374420"],
    sizeText: "4x57 szt.",
    size: null,
    offer: { price: 43.99, regularPrice: null, lowestPrice30d: null, promoEndsOn: null, available: true },
  },
];
// The candidates the item search makes of rossmann-search-aa-laab.json: the face wash in 75 ml and in 150 ml, each
// reduced until 14 October 2026.
const AA_LAAB_ROWS: CandidateRow[] = [
  {
    shopItemId: "2132081",
    name: "LAAB Skin Barrier Protection żel do mycia twarzy, nawilżający, 100% Centella B12",
    eans: ["5900116119755"],
    sizeText: "75 ml",
    size: { value: 75, unit: "ml" },
    offer: { price: 7.99, regularPrice: 11.99, lowestPrice30d: 11.99, promoEndsOn: "2026-10-14", available: true },
  },
  {
    shopItemId: "419343",
    name: "LAAB Skin Barrier Protection żel do mycia twarzy nawilżający, 100% Centella B12",
    eans: ["5900116091877"],
    sizeText: "150 ml",
    size: { value: 150, unit: "ml" },
    offer: { price: 16.49, regularPrice: 19.99, lowestPrice30d: 19.99, promoEndsOn: "2026-10-14", available: true },
  },
];

/**
 * A copy of rossmann-search-nivea-soft.json with Nivea Soft's item (26900) changed, as JSON: everything else as
 * recorded. A field set to undefined is left out of the answer.
 */
function niveaSoftWith(fields: Record<string, unknown>): string {
  const copy = editable(niveaSoft);
  copy.data.items = copy.data.items.map((item) => (item.id === 26900 ? { ...item, ...fields } : item));
  return JSON.stringify(copy);
}

/** The „nivea soft” candidates with Nivea Soft's (26900) changed, and the other four as recorded. */
const niveaSoftRowsWith = (change: Partial<CandidateRow>): CandidateRow[] =>
  NIVEA_SOFT_ROWS.map((row) => (row.shopItemId === "26900" ? { ...row, ...change } : row));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Rossmann search: recorded answers", () => {
  it("maps the results to candidates, asking for the list's 10 items, as the recording was asked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([{ url: searchUrl("nivea soft"), status: 200, body: JSON.stringify(niveaSoft) }]);

    const search = await searchRossmann(gate, "nivea soft", LIST_SIZE);

    // The list's request is the one rossmann-search-nivea-soft.json answers.
    expect(requestedUrls(fetchMock)).toEqual([NIVEA_SOFT_SEARCH.url]);
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
      caption: "krem do twarzy, ciała i dłoni, nawilżający",
      sizeText: "300 ml",
      size: { value: 300, unit: "ml" },
      eans: ["4005900009319", "4005808890637", "5900017001234"],
      productUrl:
        "https://www.rossmann.pl/Produkt/Kremy-do-twarzy/NIVEA-Soft-krem-do-twarzy-ciala-i-dloni-nawilzajacy-300-ml,26900,13049",
      imageUrl: `${IMAGE_HOST}/product_1_medium/26900_360_350_1790938776.webp`,
    });
    // Every recorded item is read, so nothing is dropped or logged.
    expect(warn).not.toHaveBeenCalled();
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

    const search = await searchRossmann(gate, "niwea soft", LIST_SIZE);

    expect(requestedUrls(fetchMock)).toEqual([searchUrl("niwea soft")]);
    expect(search).toMatchObject({ kind: "results", spellingHint: "nivea soft" });
  });

  it("returns no candidates, and logs nothing, when nothing matches and its count says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([{ url: searchUrl("zzqqxxjj"), status: 200, body: JSON.stringify(empty) }]);

    expect(await searchRossmann(gate, "zzqqxxjj", LIST_SIZE)).toEqual({
      kind: "results",
      candidates: [],
      spellingHint: null,
    });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("zzqqxxjj")]);
    expect(empty.data.totalCount).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("gives the search its own time limit", async () => {
    const fetch = vi.fn<ShopGate["fetch"]>(() => Promise.resolve({ kind: "failed", reason: "network" }));

    await searchRossmann({ fetch }, "nivea soft", LIST_SIZE);

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

  it("drops an item whose id can't go into the form, keeps the other, and logs how many it dropped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [soft, derma] = editable(results).data.items;

    const search = await searchItems([{ ...soft, id: "26900-x" }, derma]);

    expect(search.candidates.map((candidate) => candidate.sourceItemId)).toEqual(["2126586"]);
    expect(loggedLine(warn)).toEqual({ event: "rossmann-search", reason: "items dropped", detail: "1 of 2 items" });
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

  it("drops a malformed item, keeps the others, and logs how many it dropped, never which", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = editable(results);
    body.data.items.splice(1, 0, { id: null, name: "No id" }, { id: 1, name: "  ", fallbackName: "" });

    const search = await searchItems(body.data.items);

    expect(search.candidates.map((candidate) => candidate.sourceItemId)).toEqual(
      results.data.items.map((item) => String(item.id)),
    );
    expect(loggedLine(warn)).toEqual({ event: "rossmann-search", reason: "items dropped", detail: "2 of 7 items" });
  });
});

describe("Rossmann search: broken copies give a gap, never „Brak wyników”", () => {
  it.each<{ change: string; edit: (item: Record<string, unknown>) => Record<string, unknown> }>([
    // A field set to undefined is left out of the answer.
    { change: "lost its id", edit: (item) => ({ ...item, id: undefined }) },
    // Its fallbackName, a generic description such as "Krem uniwersalny", isn't a name to show in its place.
    { change: "lost its name", edit: (item) => ({ ...item, name: undefined }) },
    {
      change: "has its size split into a value and a unit",
      edit: (item) => {
        const [value, unit] = String(item.unit).split(" ");
        return { ...item, unit: { value, unit } };
      },
    },
  ])("gives up when every item $change, and logs how many it dropped", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const copy = editable(results);
    const body = JSON.stringify({ data: { ...copy.data, items: copy.data.items.map(edit) } });
    const { gate, fetchMock, reserve } = setup([{ url: searchUrl("nivea soft"), status: 200, body }]);

    expect(await searchRossmann(gate, "nivea soft", LIST_SIZE)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("nivea soft")]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(loggedLine(warn)).toEqual({ event: "rossmann-search", reason: "items dropped", detail: "5 of 5 items" });
  });

  it.each<{ change: string; query: string; data: Record<string, unknown>; count: string }>([
    {
      change: "no items, though its count says 5",
      query: "nivea soft",
      data: { ...results.data, items: [] },
      count: "5",
    },
    {
      change: "no items and no count",
      query: "zzqqxxjj",
      data: { ...empty.data, totalCount: undefined },
      count: "missing",
    },
    {
      change: "no items and its count as text",
      query: "zzqqxxjj",
      data: { ...empty.data, totalCount: "0" },
      count: "string",
    },
  ])("gives up on an answer with $change, and logs only the count", async ({ query, data, count }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve } = setup([
      { url: searchUrl(query), status: 200, body: JSON.stringify({ data }) },
    ]);

    expect(await searchRossmann(gate, query, LIST_SIZE)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(query)]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(loggedLine(warn)).toEqual({
      event: "rossmann-search",
      reason: "unexpected empty answer",
      detail: `0 items, totalCount ${count}`,
    });
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
    const { gate, fetchMock, reserve } = setup(
      [{ url: searchUrl("nivea soft"), status: 200, body: JSON.stringify(results) }],
      reservation,
    );

    expect(await searchRossmann(gate, "nivea soft", LIST_SIZE)).toEqual({ kind: "unavailable", ...expected });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<{ refusal: string; answer: ServedAnswer; reported: unknown[][] }>([
    { refusal: "a 403", answer: { status: 403 }, reported: [["rossmann", "blocked", undefined, "HTTP 403"]] },
    {
      refusal: "a bot challenge, though its status is 200",
      answer: CHALLENGE,
      reported: [["rossmann", "blocked", undefined, "challenge"]],
    },
  ])("is stopped by $refusal, and the block is reported", async ({ answer, reported }) => {
    const { gate, fetchMock, reserve, reportBlock } = setup([{ url: searchUrl("nivea soft"), ...answer }]);

    expect(await searchRossmann(gate, "nivea soft", LIST_SIZE)).toEqual({ kind: "unavailable", reason: "stopped" });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("nivea soft")]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock.mock.calls).toEqual(reported);
  });

  it.each([
    { refusal: "a 429", status: 429 },
    { refusal: "a 503 that says when to come back", status: 503 },
  ])("is paused by $refusal until its Retry-After has passed", async ({ status }) => {
    const { gate, fetchMock, reserve, reportBlock } = setup([
      { url: searchUrl("nivea soft"), status, headers: { "Retry-After": "120" } },
    ]);

    const secondsAhead = pauseSecondsOf(await searchRossmann(gate, "nivea soft", LIST_SIZE));

    expect(secondsAhead).toBeGreaterThan(115);
    expect(secondsAhead).toBeLessThanOrEqual(120);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("nivea soft")]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock.mock.calls).toEqual([["rossmann", "rate_limited", 120]]);
  });

  it.each<{ answer: string; entry: ReplayEntry; timeoutMs?: number; outcome: GateOutcome }>([
    {
      answer: "a 500",
      entry: { url: searchUrl("nivea soft"), status: 500 },
      outcome: { kind: "failed", reason: "http", status: 500 },
    },
    {
      answer: "a 502",
      entry: { url: searchUrl("nivea soft"), status: 502 },
      outcome: { kind: "failed", reason: "http", status: 502 },
    },
    {
      answer: "a 404, even in the problem+json Rossmann answers an unknown product with",
      entry: { url: searchUrl("nivea soft"), ...UNKNOWN_PRODUCT },
      outcome: { kind: "failed", reason: "http", status: 404, contentType: "application/problem+json" },
    },
    {
      answer: "a network error",
      entry: { url: searchUrl("nivea soft"), error: "network" },
      outcome: { kind: "failed", reason: "network" },
    },
    {
      answer: "no answer in time",
      entry: { url: searchUrl("nivea soft"), error: "timeout" },
      timeoutMs: 20,
      outcome: { kind: "failed", reason: "timeout" },
    },
  ])("reports $answer as failed, never as no results, and stops nothing", async ({ entry, timeoutMs, outcome }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve, reportBlock, gateLog } = setup([entry], undefined, timeoutMs);

    expect(await searchRossmann(gate, "nivea soft", LIST_SIZE)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("nivea soft")]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock).not.toHaveBeenCalled();
    // Only the gate logs it, saying why.
    expect(gateOutcomes(gateLog)).toStrictEqual([outcome]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    { answer: "text that echoes the search", body: "nivea soft" },
    { answer: "an HTML page", body: "<html>Przerwa techniczna</html>" },
    { answer: "an empty body", body: "" },
    { answer: "JSON of another shape", body: JSON.stringify({ items: [] }) },
  ])("gives up on $answer, and logs it without the search text", async ({ body }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([{ url: searchUrl("nivea soft"), status: 200, body }]);

    expect(await searchRossmann(gate, "nivea soft", LIST_SIZE)).toEqual({ kind: "unavailable", reason: "failed" });
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

    expect(await searchRossmann(gate, "nivea soft", LIST_SIZE)).toEqual({ kind: "unavailable", reason: "failed" });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("nivea soft")]);
  });
});

describe("Rossmann's item search: recorded answers", () => {
  it("maps each item of „nivea soft” to a candidate with its offer, asking for the 10 items it's given", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve } = setup([
      { url: NIVEA_SOFT_SEARCH.url, status: 200, body: JSON.stringify(niveaSoft) },
    ]);

    const candidates = candidatesOf(await searchRossmannItems(gate, NIVEA_SOFT_SEARCH.query, 10));

    expect(requestedUrls(fetchMock)).toEqual([NIVEA_SOFT_SEARCH.url]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(candidates.map(rowOf)).toEqual(NIVEA_SOFT_ROWS);
    // The whole candidate: Rossmann's own, with its brand, its page and its front shot.
    expect(candidates[0]).toEqual({
      shop: "rossmann",
      shopItemId: "26900",
      brand: "NIVEA",
      name: "Soft krem do twarzy, ciała i dłoni, nawilżający",
      sizeText: "300 ml",
      size: { value: 300, unit: "ml" },
      eans: ["4005900009319", "4005808890637", "5900017001234"],
      productUrl:
        "https://www.rossmann.pl/Produkt/Kremy-do-twarzy/NIVEA-Soft-krem-do-twarzy-ciala-i-dloni-nawilzajacy-300-ml,26900,13049",
      imageUrl: `${IMAGE_HOST}/product_1_medium/26900_360_350_1790938776.webp`,
      offer: SOFT_OFFER,
    });
    // Every item and its offer are read, so nothing is dropped or counted.
    expect(warn).not.toHaveBeenCalled();
  });

  it("maps both sizes of the AA LAAB face wash, each with its own offer, asking for the 10 items it's given", async () => {
    const { gate, fetchMock } = setup([{ url: AA_LAAB_SEARCH.url, status: 200, body: JSON.stringify(aaLaab) }]);

    const candidates = candidatesOf(await searchRossmannItems(gate, AA_LAAB_SEARCH.query, 10));

    expect(requestedUrls(fetchMock)).toEqual([AA_LAAB_SEARCH.url]);
    expect(candidates.map(rowOf)).toEqual(AA_LAAB_ROWS);
    expect(candidates.map(({ shop, brand }) => [shop, brand])).toEqual([
      ["rossmann", "AA"],
      ["rossmann", "AA"],
    ]);
  });

  it("reads the same items for the list's search, as products with their captions apart, asking for the list's 10", async () => {
    const { gate, fetchMock } = setup([{ url: AA_LAAB_SEARCH.url, status: 200, body: JSON.stringify(aaLaab) }]);

    const search = await searchRossmann(gate, AA_LAAB_SEARCH.query, LIST_SIZE);

    expect(requestedUrls(fetchMock)).toEqual([AA_LAAB_SEARCH.url]);
    expect(search).toMatchObject({
      kind: "results",
      spellingHint: null,
      candidates: [
        {
          sourceItemId: "2132081",
          name: "LAAB Skin Barrier Protection",
          caption: "żel do mycia twarzy, nawilżający, 100% Centella B12",
          sizeText: "75 ml",
        },
        {
          sourceItemId: "419343",
          name: "LAAB Skin Barrier Protection",
          caption: "żel do mycia twarzy nawilżający, 100% Centella B12",
          sizeText: "150 ml",
        },
      ],
    });
  });

  it("cuts a name joined with its caption to the name's limit", async () => {
    const [soft] = editable(niveaSoft).data.items;
    const long = { ...soft, name: "N".repeat(200), caption: "c".repeat(200) };
    const body = JSON.stringify({ data: { items: [long], totalCount: 1, spellCheckHint: "" } });
    const { gate } = setup([{ url: NIVEA_SOFT_SEARCH.url, status: 200, body }]);

    const [candidate] = candidatesOf(await searchRossmannItems(gate, NIVEA_SOFT_SEARCH.query, 10));

    expect(candidate.name).toBe(`${"N".repeat(200)} ${"c".repeat(99)}`);
  });
});

describe("Rossmann's item search: broken copies cost only the offer, or only the availability", () => {
  it.each<{ change: string; price: unknown }>([
    { change: "sent as text", price: "15.99" },
    { change: "missing", price: undefined },
  ])(
    "keeps an item whose price is $change as a candidate without an offer, and the list's search still shows it",
    async ({ price }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock } = setup([{ url: NIVEA_SOFT_SEARCH.url, status: 200, body: niveaSoftWith({ price }) }]);

      const candidates = candidatesOf(await searchRossmannItems(gate, NIVEA_SOFT_SEARCH.query, 10));
      const products = await searchRossmann(gate, NIVEA_SOFT_SEARCH.query, LIST_SIZE);

      expect(requestedUrls(fetchMock)).toEqual([NIVEA_SOFT_SEARCH.url, NIVEA_SOFT_SEARCH.url]);
      expect(candidates.map(rowOf)).toEqual(niveaSoftRowsWith({ offer: null }));
      expect(products.kind === "results" ? products.candidates.map(({ sourceItemId }) => sourceItemId) : []).toEqual(
        NIVEA_SOFT_ROWS.map(({ shopItemId }) => shopItemId),
      );
      // The price costs only the offer, and its item is kept: nothing is dropped or counted.
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each<{ why: string; availability: unknown; counted: boolean }>([
    { why: "missing", availability: undefined, counted: true },
    { why: "a number", availability: 1, counted: true },
    { why: "null", availability: null, counted: true },
    // Text other than "available" is Rossmann's own answer that it can't be ordered online, so it isn't counted.
    { why: "another text", availability: "unavailable", counted: false },
  ])("reads an availability that's $why as not orderable online", async ({ availability, counted }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([
      { url: NIVEA_SOFT_SEARCH.url, status: 200, body: niveaSoftWith({ availability }) },
    ]);

    const candidates = candidatesOf(await searchRossmannItems(gate, NIVEA_SOFT_SEARCH.query, 10));

    expect(requestedUrls(fetchMock)).toEqual([NIVEA_SOFT_SEARCH.url]);
    expect(candidates.map(rowOf)).toEqual(niveaSoftRowsWith({ offer: { ...SOFT_OFFER, available: false } }));
    // One that can't be read is counted, how many and never which, so a renamed field shows.
    expect(loggedLines(warn)).toEqual(
      counted ? [{ event: "rossmann-search", reason: "availability unread", detail: "1 of 5 product hits" }] : [],
    );
  });

  it("counts no availability of an item without an offer, which reads nothing from it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = niveaSoftWith({ price: undefined, availability: undefined });
    const { gate, fetchMock } = setup([{ url: NIVEA_SOFT_SEARCH.url, status: 200, body }]);

    const candidates = candidatesOf(await searchRossmannItems(gate, NIVEA_SOFT_SEARCH.query, 10));

    expect(requestedUrls(fetchMock)).toEqual([NIVEA_SOFT_SEARCH.url]);
    expect(candidates.map(rowOf)).toEqual(niveaSoftRowsWith({ offer: null }));
    expect(warn).not.toHaveBeenCalled();
  });
});

// One parse serves both searches, so the item search gives the gaps the list's search gives, never "nothing found".
describe("Rossmann's item search: the list's search's rules", () => {
  it("gives up when every item lost its name, and logs how many it dropped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const copy = editable(niveaSoft);
    copy.data.items = copy.data.items.map((item) => ({ ...item, name: undefined }));
    const { gate, fetchMock } = setup([{ url: NIVEA_SOFT_SEARCH.url, status: 200, body: JSON.stringify(copy) }]);

    expect(await searchRossmannItems(gate, NIVEA_SOFT_SEARCH.query, 10)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([NIVEA_SOFT_SEARCH.url]);
    expect(loggedLine(warn)).toEqual({ event: "rossmann-search", reason: "items dropped", detail: "5 of 5 items" });
  });

  it("finds nothing only when an answer without items says so by its count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nothing = "https://www.rossmann.pl/products/v4/api/Products?search=zzqqxxjj&page=1&pageSize=10";
    const { gate, fetchMock } = setup([
      { url: nothing, status: 200, body: JSON.stringify(empty) },
      { url: NIVEA_SOFT_SEARCH.url, status: 200, body: JSON.stringify({ data: { ...niveaSoft.data, items: [] } }) },
    ]);

    expect(await searchRossmannItems(gate, "zzqqxxjj", 10)).toEqual({ kind: "results", candidates: [] });
    expect(await searchRossmannItems(gate, NIVEA_SOFT_SEARCH.query, 10)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([nothing, NIVEA_SOFT_SEARCH.url]);
    // Only the answer whose count says 5 is logged, with only its count.
    expect(loggedLine(warn)).toEqual({
      event: "rossmann-search",
      reason: "unexpected empty answer",
      detail: "0 items, totalCount 5",
    });
  });

  it("is stopped by a 403, and the block is reported", async () => {
    const { gate, fetchMock, reserve, reportBlock } = setup([{ url: NIVEA_SOFT_SEARCH.url, status: 403 }]);

    expect(await searchRossmannItems(gate, NIVEA_SOFT_SEARCH.query, 10)).toEqual({
      kind: "unavailable",
      reason: "stopped",
    });
    expect(requestedUrls(fetchMock)).toEqual([NIVEA_SOFT_SEARCH.url]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock.mock.calls).toEqual([["rossmann", "blocked", undefined, "HTTP 403"]]);
  });
});

/**
 * Checks Felix's price against a detail built from the given fields, as if Rossmann had answered with them. A field set
 * to undefined is left out of the answer.
 */
async function priceFrom(data: Record<string, unknown>) {
  const { gate, fetchMock, reserve } = setup([
    { url: detailUrl("131225"), status: 200, body: JSON.stringify({ data }) },
  ]);
  const check = await fetchRossmannPrice(gate, "131225");
  expect(requestedUrls(fetchMock)).toEqual([detailUrl("131225")]);
  expect(reserve).toHaveBeenCalledTimes(1);
  return check;
}

describe("Rossmann price: recorded answers", () => {
  it("reads a reduced offer: the price before the reduction, the 30-day low and the promotion's end", async () => {
    const { gate, fetchMock } = setup([{ url: detailUrl("131225"), status: 200, body: JSON.stringify(reduced) }]);

    expect(await fetchRossmannPrice(gate, "131225")).toEqual({ kind: "price", offer: FELIX_OFFER });
    expect(requestedUrls(fetchMock)).toEqual([detailUrl("131225")]);
  });

  it("reads a regular offer, which carries only its price", async () => {
    const { gate, fetchMock } = setup([{ url: detailUrl("26900"), status: 200, body: JSON.stringify(regular) }]);

    expect(await fetchRossmannPrice(gate, "26900")).toEqual({
      kind: "price",
      offer: { price: 26.99, regularPrice: null, lowestPrice30d: null, promoEndsOn: null, available: true },
    });
    expect(requestedUrls(fetchMock)).toEqual([detailUrl("26900")]);
  });

  it("reports a product Rossmann doesn't have as missing, by its 404's problem+json type", async () => {
    // Rossmann's recorded answer to an id it doesn't have.
    const { gate, fetchMock, reserve, gateLog } = setup([{ url: detailUrl("999999999"), ...UNKNOWN_PRODUCT }]);

    expect(await fetchRossmannPrice(gate, "999999999")).toEqual({ kind: "missing" });
    expect(requestedUrls(fetchMock)).toEqual([detailUrl("999999999")]);
    expect(reserve).toHaveBeenCalledTimes(1);
    // The gate's line carries the status and the media type, without the charset, which the rule reads.
    expect(gateOutcomes(gateLog)).toStrictEqual([
      { kind: "failed", reason: "http", status: 404, contentType: "application/problem+json" },
    ]);
  });

  it("gives the price check its own 5 s limit", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn<ShopGate["fetch"]>(() => Promise.resolve({ kind: "failed", reason: "network" }));

    await fetchRossmannPrice({ fetch }, "26900");

    expect(timeout).toHaveBeenCalledWith(5000);
    const [created] = timeout.mock.results;
    if (created.type !== "return") {
      throw new Error("AbortSignal.timeout didn't return a signal");
    }
    const [, , init] = fetch.mock.calls[0];
    expect(init?.signal).toBe(created.value);
  });
});

describe("Rossmann price: what it keeps out", () => {
  it.each(["..", "26900x", "26900/..", "../26900", " 26900", "", "1234567890123"])(
    "asks the gate for nothing with the id %j, so no request and no slot is spent",
    async (id) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const fetch = vi.fn<ShopGate["fetch"]>();

      expect(await fetchRossmannPrice({ fetch }, id)).toEqual(FAILED);
      expect(fetch).not.toHaveBeenCalled();
      // Never the id itself.
      expect(loggedLine(warn)).toEqual({
        event: "rossmann-price",
        reason: "invalid product id",
        detail: "not 1-12 digits, not sent",
      });
    },
  );

  it.each<{ change: string; data: Record<string, unknown>; offer: ShopOffer }>([
    {
      change: "a regular price equal to the price",
      data: { oldPrice: 5.99 },
      offer: { ...FELIX_OFFER, regularPrice: null },
    },
    {
      change: "a 30-day low sent as text",
      data: { lastLowestPrice: "6.39" },
      offer: { ...FELIX_OFFER, lowestPrice30d: null },
    },
    {
      change: "a promotion end that isn't a date",
      data: { promotionTo: "30.09.2026" },
      offer: { ...FELIX_OFFER, promoEndsOn: null },
    },
    {
      change: "a promotion end on a day that doesn't exist",
      data: { promotionTo: "2026-09-31T00:00:00" },
      offer: { ...FELIX_OFFER, promoEndsOn: null },
    },
  ])("keeps the offer with $change, which costs only that value", async ({ data, offer }) => {
    expect(await priceFrom({ ...reduced.data, ...data })).toEqual({ kind: "price", offer });
  });

  it.each([
    { why: "zero", price: 0 },
    { why: "above what the table holds", price: 100000 },
    { why: "sent as text", price: "5.99" },
  ])("gives up on a price that's $why, and stores nothing", async ({ price }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await priceFrom({ ...reduced.data, price })).toEqual(FAILED);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("gives up on an answer about another product", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await priceFrom({ ...reduced.data, id: 26900 })).toEqual(FAILED);
    expect(loggedLine(warn)).toMatchObject({ event: "rossmann-price", reason: "unexpected product" });
  });
});

describe("Rossmann price: broken copies give a gap, never 'missing'", () => {
  it.each<{ answer: string; headers?: Record<string, string>; body?: string; outcome: GateOutcome }>([
    {
      answer: "an HTML page",
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: NOT_FOUND_PAGE,
      outcome: { kind: "failed", reason: "http", status: 404, contentType: "text/html" },
    },
    {
      answer: "plain text",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Not Found",
      outcome: { kind: "failed", reason: "http", status: 404, contentType: "text/plain" },
    },
    { answer: "no body", outcome: { kind: "failed", reason: "http", status: 404 } },
  ])(
    "reads a 404 with $answer as no answer, as a moved route's would be, never as a product gone",
    async ({ headers, body, outcome }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      // Felix, which Rossmann sells, asked where every product's detail answers 404.
      const { gate, fetchMock, reserve, reportBlock, gateLog } = setup([
        { url: detailUrl("131225"), status: 404, headers, body },
      ]);

      expect(await fetchRossmannPrice(gate, "131225")).toEqual(FAILED);
      expect(requestedUrls(fetchMock)).toEqual([detailUrl("131225")]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reportBlock).not.toHaveBeenCalled();
      // Only the gate logs it, with the status and the media type the rule reads.
      expect(gateOutcomes(gateLog)).toStrictEqual([outcome]);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("reads a problem+json 404 as missing by its status and type alone: the gate never reads its body", async () => {
    // The recorded answer's status and type, without its body.
    const { gate, fetchMock, reserve } = setup([
      { url: detailUrl("999999999"), status: 404, headers: { "Content-Type": unknownProduct.contentType } },
    ]);

    expect(await fetchRossmannPrice(gate, "999999999")).toEqual({ kind: "missing" });
    expect(requestedUrls(fetchMock)).toEqual([detailUrl("999999999")]);
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it.each(["id", "price"])(
    "gives up on a detail without its %s, and logs it without the product's id",
    async (field) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      expect(await priceFrom({ ...reduced.data, [field]: undefined })).toEqual(FAILED);
      expect(loggedLine(warn)).toMatchObject({ event: "rossmann-price", reason: "unexpected response shape" });
      expect(String(warn.mock.calls[0][0])).not.toContain("131225");
    },
  );

  it.each<{ field: string; offer: ShopOffer }>([
    { field: "oldPrice", offer: { ...FELIX_OFFER, regularPrice: null } },
    { field: "lastLowestPrice", offer: { ...FELIX_OFFER, lowestPrice30d: null } },
    { field: "promotionTo", offer: { ...FELIX_OFFER, promoEndsOn: null } },
  ])(
    "keeps the offer of a detail without its $field, as one without a reduction comes, and logs nothing",
    async ({ field, offer }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      expect(await priceFrom({ ...reduced.data, [field]: undefined })).toEqual({ kind: "price", offer });
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each<{ why: string; availability: unknown; logged: string | null }>([
    { why: "missing", availability: undefined, logged: "availability missing, read as not orderable" },
    { why: "a number", availability: 1, logged: "availability number, read as not orderable" },
    { why: "null", availability: null, logged: "availability null, read as not orderable" },
    // Text other than "available" is Rossmann's own answer that it can't be ordered online, so it isn't counted.
    { why: "another text", availability: "unavailable", logged: null },
  ])("reads an availability that's $why as not orderable online", async ({ availability, logged }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await priceFrom({ ...reduced.data, availability })).toEqual({
      kind: "price",
      offer: { ...FELIX_OFFER, available: false },
    });
    // One that can't be read is counted, so a renamed field shows; the line never names the product.
    expect(loggedLines(warn)).toEqual(
      logged === null ? [] : [{ event: "rossmann-price", reason: "availability unread", detail: logged }],
    );
  });
});

describe("Rossmann price: why it's unavailable", () => {
  it.each([
    { refusal: "the cap is reached", reservation: { outcome: "capped" }, expected: { reason: "busy" } },
    { refusal: "the shop is stopped", reservation: { outcome: "stopped" }, expected: { reason: "stopped" } },
  ])("says so without calling Rossmann when $refusal", async ({ reservation, expected }) => {
    const { gate, fetchMock, reserve } = setup(
      [{ url: detailUrl("131225"), status: 200, body: JSON.stringify(reduced) }],
      reservation,
    );

    expect(await fetchRossmannPrice(gate, "131225")).toEqual({ kind: "unavailable", ...expected });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<{ refusal: string; answer: ServedAnswer; reported: unknown[][] }>([
    { refusal: "a 403", answer: { status: 403 }, reported: [["rossmann", "blocked", undefined, "HTTP 403"]] },
    {
      refusal: "a bot challenge, though its status is 200",
      answer: CHALLENGE,
      reported: [["rossmann", "blocked", undefined, "challenge"]],
    },
  ])("is stopped by $refusal, never missing, and the block is reported", async ({ answer, reported }) => {
    const { gate, fetchMock, reserve, reportBlock } = setup([{ url: detailUrl("131225"), ...answer }]);

    expect(await fetchRossmannPrice(gate, "131225")).toEqual({ kind: "unavailable", reason: "stopped" });
    expect(requestedUrls(fetchMock)).toEqual([detailUrl("131225")]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock.mock.calls).toEqual(reported);
  });

  it.each([
    { refusal: "a 429", status: 429 },
    { refusal: "a 503 that says when to come back", status: 503 },
  ])("is paused by $refusal until its Retry-After has passed, never missing", async ({ status }) => {
    const { gate, fetchMock, reserve, reportBlock } = setup([
      { url: detailUrl("131225"), status, headers: { "Retry-After": "120" } },
    ]);

    const secondsAhead = pauseSecondsOf(await fetchRossmannPrice(gate, "131225"));

    expect(secondsAhead).toBeGreaterThan(115);
    expect(secondsAhead).toBeLessThanOrEqual(120);
    expect(requestedUrls(fetchMock)).toEqual([detailUrl("131225")]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock.mock.calls).toEqual([["rossmann", "rate_limited", 120]]);
  });

  it.each<{ answer: string; entry: ReplayEntry; timeoutMs?: number; outcome: GateOutcome }>([
    {
      answer: "a 500",
      entry: { url: detailUrl("131225"), status: 500 },
      outcome: { kind: "failed", reason: "http", status: 500 },
    },
    {
      answer: "a 502",
      entry: { url: detailUrl("131225"), status: 502 },
      outcome: { kind: "failed", reason: "http", status: 502 },
    },
    {
      answer: "a 410, as a retired route might answer",
      entry: { url: detailUrl("131225"), status: 410 },
      outcome: { kind: "failed", reason: "http", status: 410 },
    },
    {
      answer: "a redirect, which the gate never follows",
      entry: { url: detailUrl("131225"), status: 301, headers: { Location: "https://www.rossmann.pl/" } },
      outcome: { kind: "failed", reason: "http", status: 301 },
    },
    {
      answer: "no answer in time",
      entry: { url: detailUrl("131225"), error: "timeout" },
      timeoutMs: 20,
      outcome: { kind: "failed", reason: "timeout" },
    },
  ])("reports $answer as failed, never as missing, and stops nothing", async ({ entry, timeoutMs, outcome }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve, reportBlock, gateLog } = setup([entry], undefined, timeoutMs);

    expect(await fetchRossmannPrice(gate, "131225")).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([detailUrl("131225")]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock).not.toHaveBeenCalled();
    // Only the gate logs it, saying why.
    expect(gateOutcomes(gateLog)).toStrictEqual([outcome]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    { answer: "an HTML page", body: "<html>Przerwa techniczna</html>" },
    { answer: "an empty body", body: "" },
    { answer: "JSON of another shape", body: JSON.stringify({ data: null }) },
    { answer: "a detail without its price", body: JSON.stringify({ data: { id: 131225, availability: "available" } }) },
  ])("gives up on $answer, and logs it without the product's id", async ({ body }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([{ url: detailUrl("131225"), status: 200, body }]);

    expect(await fetchRossmannPrice(gate, "131225")).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([detailUrl("131225")]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("131225");
  });
});

describe("Rossmann's adapter entry", () => {
  it("searches with the item search and never by EAN, prices one product per request, and checks Rossmann's own ids and links", () => {
    // Rossmann's search is text only (research note §2.1), so an EAN search there would spend a request to learn
    // nothing.
    expect(SHOP_ADAPTERS.rossmann).toEqual({
      search: searchRossmannItems,
      searchesByEan: false,
      fetchPrices: fetchRossmannPrices,
      isItemId: isRossmannProductId,
      isProductUrl: isRossmannProductUrl,
      isImage: isRossmannImage,
    });
  });
});
