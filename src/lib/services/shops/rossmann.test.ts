import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createShopGate, type ShopGate, type ShopGateDeps, type ShopGateLogEntry } from "@/lib/services/shop-gate";
import {
  fetchRossmannPrice,
  isRossmannImage,
  isRossmannProductUrl,
  searchRossmann,
} from "@/lib/services/shops/rossmann";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import type { GateOutcome, PriceCheck, ProductSearch, ShopOffer } from "@/types";
import reduced from "@/lib/services/shops/fixtures/rossmann-detail-reduced.json";
import regular from "@/lib/services/shops/fixtures/rossmann-detail-regular.json";
import unknownProduct from "@/lib/services/shops/fixtures/rossmann-detail-unknown.json";
import empty from "@/lib/services/shops/fixtures/rossmann-search-empty.json";
import misspelled from "@/lib/services/shops/fixtures/rossmann-search-misspelled.json";
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
// The broken answers below each change one thing in a copy of these recordings, or stand in a page or an empty body
// where the JSON was.
const searchUrl = (query: string) =>
  `https://www.rossmann.pl/products/v4/api/Products?search=${encodeURIComponent(query)}&page=1&pageSize=24`;
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

/** An answer's status, headers and body, served for whichever URL a test gives it. */
interface Answer {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

// Rossmann's recorded answer to an id it doesn't have: a 404 in problem+json.
const UNKNOWN_PRODUCT: Answer = {
  status: unknownProduct.status,
  headers: { "Content-Type": unknownProduct.contentType },
  body: unknownProduct.body,
};
// A page where Rossmann's JSON should be, as a moved route, or a page in front of the API, would answer.
const NOT_FOUND_PAGE =
  '<!DOCTYPE html><html lang="pl"><head><title>Rossmann</title></head><body>Nie znaleziono strony</body></html>';
// A bot challenge, which Cloudflare marks with `cf-mitigated: challenge` whatever its status.
const CHALLENGE: Answer = {
  status: 200,
  headers: { "cf-mitigated": "challenge" },
  body: "<html>Just a moment...</html>",
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

/** The outcome of each of the gate's own log lines. */
function gateOutcomes(gateLog: Mock<(entry: ShopGateLogEntry) => void>): ShopGateLogEntry["outcome"][] {
  return gateLog.mock.calls.map(([entry]) => entry.outcome);
}

/** The one log line a test expects, parsed. */
function loggedLine(warn: { mock: { calls: unknown[][] } }): unknown {
  expect(warn.mock.calls).toHaveLength(1);
  return JSON.parse(String(warn.mock.calls[0][0]));
}

/** Every log line, parsed. */
function loggedLines(warn: { mock: { calls: unknown[][] } }): unknown[] {
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown);
}

/** How many seconds from now an answer's pause ends; it must be a pause with its end. */
function pauseSecondsOf(answer: ProductSearch | PriceCheck): number {
  if (answer.kind !== "unavailable" || answer.reason !== "paused" || answer.until === undefined) {
    throw new Error(`expected a pause with its end, got ${JSON.stringify(answer)}`);
  }
  return (Date.parse(answer.until) - Date.now()) / 1000;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Rossmann search: recorded answers", () => {
  it("maps the results to candidates", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

    const search = await searchRossmann(gate, "niwea soft");

    expect(requestedUrls(fetchMock)).toEqual([searchUrl("niwea soft")]);
    expect(search).toMatchObject({ kind: "results", spellingHint: "nivea soft" });
  });

  it("returns no candidates, and logs nothing, when nothing matches and its count says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([{ url: searchUrl("zzqqxxjj"), status: 200, body: JSON.stringify(empty) }]);

    expect(await searchRossmann(gate, "zzqqxxjj")).toEqual({ kind: "results", candidates: [], spellingHint: null });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl("zzqqxxjj")]);
    expect(empty.data.totalCount).toBe(0);
    expect(warn).not.toHaveBeenCalled();
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

    expect(await searchRossmann(gate, "nivea soft")).toEqual(FAILED);
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

    expect(await searchRossmann(gate, query)).toEqual(FAILED);
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

    expect(await searchRossmann(gate, "nivea soft")).toEqual({ kind: "unavailable", ...expected });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<{ refusal: string; answer: Answer; reported: unknown[][] }>([
    { refusal: "a 403", answer: { status: 403 }, reported: [["rossmann", "blocked", undefined, "HTTP 403"]] },
    {
      refusal: "a bot challenge, though its status is 200",
      answer: CHALLENGE,
      reported: [["rossmann", "blocked", undefined, "challenge"]],
    },
  ])("is stopped by $refusal, and the block is reported", async ({ answer, reported }) => {
    const { gate, fetchMock, reserve, reportBlock } = setup([{ url: searchUrl("nivea soft"), ...answer }]);

    expect(await searchRossmann(gate, "nivea soft")).toEqual({ kind: "unavailable", reason: "stopped" });
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

    const secondsAhead = pauseSecondsOf(await searchRossmann(gate, "nivea soft"));

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

    expect(await searchRossmann(gate, "nivea soft")).toEqual(FAILED);
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

  it.each<{ refusal: string; answer: Answer; reported: unknown[][] }>([
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
