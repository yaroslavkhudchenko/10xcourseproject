import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { pickMatch, type MatchProduct } from "@/lib/services/matching";
import { createShopGate, type ShopGate, type ShopGateDeps, type ShopGateLogEntry } from "@/lib/services/shop-gate";
import {
  fetchSuperPharmPrices,
  isSuperPharmImage,
  isSuperPharmItemId,
  isSuperPharmProductUrl,
  searchSuperPharm,
} from "@/lib/services/shops/super-pharm";
import { parseSize } from "@/lib/services/size";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import type { PriceCheck, ShopCandidate, ShopOffer } from "@/types";
import nameSearchOne from "@/lib/services/shops/fixtures/super-pharm-name-search-one.json";
import nameSearch from "@/lib/services/shops/fixtures/super-pharm-name-search.json";
import pinnedOne from "@/lib/services/shops/fixtures/super-pharm-pinned-one.json";
import pinnedRulesOff from "@/lib/services/shops/fixtures/super-pharm-pinned-rules-off.json";
import pinned from "@/lib/services/shops/fixtures/super-pharm-pinned.json";
import searchEmpty from "@/lib/services/shops/fixtures/super-pharm-search-empty.json";

// The fixtures are real Algolia answers for Super-Pharm, recorded once with curl from the developer machine on
// 2026-10-05 (UTC), with the gate's User-Agent and the adapter's headers, at least 2.5 s apart and following no
// redirect; no test reaches the live search. Every request is a POST to one URL, so each recording is served for the
// exact body it answers (`requestBody`), spelled out below.
// - super-pharm-name-search.json (18:51 UTC): the adapter's own name search for "NIVEA krem", 10 hits, cut to its first
//   5 of 134. Each hit has `in_stock` 1 and `inStoreOnly` 0, and two have a 30-day low.
// - super-pharm-pinned-rules-off.json (22:24 UTC, 00:24 on 2026-10-06 in Poland): the adapter's own price request for
//   96276, 96278 and 10132 from that search, and 999999999, which Super-Pharm doesn't have, with the query rules off
//   (`enableRules=false`): three hits, in Algolia's order, and the unknown id left out. It's the one price answer
//   recorded with the adapter's current body.
// - super-pharm-pinned.json (18:51 UTC): the same price request, sent before the adapter turned the query rules off,
//   with the same three hits at the same prices; the index ran its rules on it (`rulesProcessing`).
// - super-pharm-name-search-one.json (13:58 UTC, research probe P3): the search for "NIVEA Soft 300 ml", 10 hits, sent
//   without the adapter's attribute list and highlighting off, so its one hit, Nivea Soft 300 ml (10132), carries every
//   attribute of the record; the adapter reads only its own. It's on sale at 19,49 zł, with a 30-day low of 33,99 zł and
//   no regular price.
// - super-pharm-search-empty.json (13:58 UTC, probe P5): the search for Nivea Soft 300 ml's EAN, 5 hits, sent without
//   the attribute list too: no hits, as the index holds no EAN.
// - super-pharm-pinned-one.json (13:58 UTC, probe P6): the price request for 10132 and 999999999, sent with its
//   parameters in another order and encoding and `attributesToRetrieve` objectID, price and in_stock, so its hit has no
//   `inStoreOnly`. Only 10132 came back.
// The probes' requests differ from the adapter's only in parameters that trim an answer or order its text, so each is
// served for the adapter's own request for the same search. The two earlier price recordings, super-pharm-pinned.json
// and probe P6's, were sent without `enableRules=false`, and are served for the adapter's body all the same: the
// rules-off answer holds the same hits at the same prices. The broken answers below each change one thing in a copy of
// these, or stand in a page where the JSON was.
const QUERY_URL = "https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query";
// Super-Pharm's Algolia application and the public search-only key its pages carry: every request carries both.
const APP_ID = "EP43QPDX9Q";
const SEARCH_KEY =
  "NjRmYmE4ZDZhMDg5ODhkMjg1MzIzM2M1NzUwODE1MGFmN2E4NTllNjM2MmJmMzdhZmJkODQ3MmUzNTg4ZWZjOHRhZ0ZpbHRlcnM9";
/**
 * A search's body, spelled out as the adapter sends it: the query form-encoded (a space as "+"), as many hits as asked
 * for, out of the search analytics, only the attributes a candidate shows, and no highlighting.
 */
const searchBody = (encodedQuery: string, size: number) =>
  `{"params":"query=${encodedQuery}&hitsPerPage=${size}&analytics=false` +
  "&attributesToRetrieve=name%2Cbrand%2Ccapacity%2Curl%2Cthumbnail_url%2Cprice%2Cin_stock%2CinStoreOnly" +
  '&attributesToHighlight=%5B%5D"}';
/**
 * A price request's body, spelled out as the adapter sends it: no query, one objectID filter per id joined by OR, as
 * many hits as ids, out of the analytics, only the price attributes, no highlighting, and the query rules off.
 */
const priceBody = (ids: string[]) =>
  `{"params":"query=&filters=${ids.map((id) => `objectID%3A${id}`).join("+OR+")}&hitsPerPage=${ids.length}` +
  "&analytics=false&attributesToRetrieve=price%2Cin_stock%2CinStoreOnly&attributesToHighlight=%5B%5D" +
  '&enableRules=false"}';
// The searches the recordings answer: as the adapter is asked for them, and the body it sends for each.
const SOFT_SEARCH = { query: "NIVEA Soft 300 ml", size: 10, body: searchBody("NIVEA+Soft+300+ml", 10) };
const NAME_SEARCH = { query: "NIVEA krem", size: 10, body: searchBody("NIVEA+krem", 10) };
const EAN_SEARCH = { query: "4005900009319", size: 5, body: searchBody("4005900009319", 5) };
// Nivea Soft 300 ml, which every recording holds, and an id Super-Pharm doesn't have.
const SOFT = "10132";
const UNKNOWN_ID = "999999999";
// The two hand creams the name search found first, which the price recording asked for beside Nivea Soft.
const HAND_CREAM = "96276";
const LUMINOUS = "96278";
const PAGES = "https://www.superpharm.pl";
const IMAGES = "https://media.superpharm.eu/media/catalog/product/cache/c67a6870c5ebea7eb5ebe1ca04d0c8c1";
const SOFT_PAGE = `${PAGES}/nivea-soft-krem-nawilzajacy-pudelko-39477`;
const SOFT_IMAGE = `${IMAGES}/n/i/nivea-soft-krem-do-twarzy-i-ciala-200ml-1_2.jpg`;
// Nivea Soft 300 ml's offer in every recording of it: on sale, with a 30-day low above the price and no regular price.
const SOFT_OFFER: ShopOffer = {
  price: 19.49,
  regularPrice: null,
  lowestPrice30d: 33.99,
  promoEndsOn: null,
  available: true,
};
// The hand creams' offers: no sale, and no 30-day low (`false`).
const HAND_CREAM_OFFER: ShopOffer = {
  price: 13.99,
  regularPrice: null,
  lowestPrice30d: null,
  promoEndsOn: null,
  available: true,
};
const LUMINOUS_OFFER: ShopOffer = { ...HAND_CREAM_OFFER, price: 28.99 };
const FAILED: PriceCheck = { kind: "unavailable", reason: "failed" };
// A page where Algolia's JSON should be, as a proxy or a maintenance page would send it.
const HTML_PAGE =
  '<!DOCTYPE html><html lang="pl"><head><title>Super-Pharm</title></head><body>Przerwa techniczna</body></html>';
// Super-Pharm writes a no-break space before "zł".
const NBSP = "\u00A0";
// Nivea Soft first, then 20 ids Super-Pharm doesn't have: two requests' worth.
const manyIds = [SOFT, ...Array.from({ length: 20 }, (_, i) => `9${String(i).padStart(8, "0")}`)];
const firstBatch = priceBody(manyIds.slice(0, 20));
const secondBatch = priceBody(manyIds.slice(20));

// The watched product as the matching rule reads it: rossmann-search-results.json's Nivea Soft 300 ml (26900).
const ROSSMANN_SOFT: MatchProduct = {
  brand: "NIVEA",
  eans: ["4005900009319", "4005808890637", "5900017001234"],
  size: { value: 300, unit: "ml" },
};

/**
 * A real gate that gives every reservation the same answer, allowed by default, over a fetch that answers only the
 * given recordings. `reserve` shows which shop each slot was asked for, `reportBlock` each refusal reported, and
 * `gateLog` the gate's own log lines.
 */
function setup(entries: ReplayEntry[], reservation: unknown = { outcome: "allowed" }) {
  const fetchMock = vi.fn(createReplayFetch(entries));
  const reserve = vi.fn<ShopGateDeps["reserve"]>(() => Promise.resolve(reservation));
  const reportBlock = vi.fn<ShopGateDeps["reportBlock"]>(() => Promise.resolve());
  const gateLog = vi.fn<(entry: ShopGateLogEntry) => void>();
  const gate = createShopGate({ reserve, reportBlock, fetch: fetchMock, log: gateLog });
  return { gate, fetchMock, reserve, reportBlock, gateLog };
}

/** The replay's answer to the request with the given body: JSON or text, with a status. */
function answering(requestBody: string, body: string, status = 200): ReplayEntry {
  return { url: QUERY_URL, requestBody, status, body };
}

/** A request as the replay saw it: its URL and its body. */
function request(body: string) {
  return { url: QUERY_URL, body };
}

/**
 * Every request the fetch was asked for, as its URL and body, so a test can't pass on the wrong request. Each must be a
 * POST carrying Super-Pharm's app id and key, and asking for JSON.
 */
function sentRequests(fetchMock: Mock<typeof fetch>): { url: string; body: unknown }[] {
  return fetchMock.mock.calls.map(([input, init]) => {
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("POST");
    expect(headers.get("X-Algolia-Application-Id")).toBe(APP_ID);
    expect(headers.get("X-Algolia-API-Key")).toBe(SEARCH_KEY);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
    return { url: input instanceof Request ? input.url : new URL(input).href, body: init?.body };
  });
}

/** The parameters a request's body holds, as Algolia reads them. */
function paramsOf(body: unknown): URLSearchParams {
  return new URLSearchParams((JSON.parse(String(body)) as { params: string }).params);
}

/** A recorded hit, as JSON a test can edit: its fields, and its prices in złoty. */
interface Hit {
  [field: string]: unknown;
  price: { PLN: Record<string, unknown> };
}

/** The recorded hits, copied so a test can edit them without touching the imported fixture. */
function hitsOf(answer: { hits: unknown[] }): Hit[] {
  return structuredClone(answer.hits) as Hit[];
}

/** A recorded answer's hit for the given item, copied so a test can edit it. */
function hitFor(answer: { hits: unknown[] }, objectID: string): Hit {
  const hit = hitsOf(answer).find((each) => each.objectID === objectID);
  if (hit === undefined) {
    throw new Error(`no recorded hit for ${objectID}`);
  }
  return hit;
}

/** A copy of a hit with some of its fields replaced; a field set to undefined is left out of the answer. */
function withFields(hit: Hit, fields: Record<string, unknown>): Hit {
  return { ...hit, ...fields };
}

/** A copy of a hit with some of its prices' fields replaced; one set to undefined is left out of the answer. */
function withPrices(hit: Hit, fields: Record<string, unknown>): Hit {
  return { ...hit, price: { ...hit.price, PLN: { ...hit.price.PLN, ...fields } } };
}

/** Nivea Soft 300 ml's hit in the name search, as the adapter's own request retrieved it. */
function soft(): Hit {
  return hitFor(nameSearch, SOFT);
}

/** Nivea Soft 300 ml's hit in the price recording. */
function pricedSoft(): Hit {
  return hitFor(pinned, SOFT);
}

/** A search answer with the given hits, as JSON: the recorded name search's, with its hits replaced. */
function searchAnswer(hits: unknown[]): string {
  return JSON.stringify({ ...nameSearch, hits });
}

/** A price answer with the given hits, as JSON: whole, as every recorded one is, with all its hits on one page. */
function priceAnswer(hits: unknown[]): string {
  return JSON.stringify({ ...pinned, hits, nbHits: hits.length });
}

/** Searches by name against an answer with the given hits, and returns the candidates. */
async function candidatesFrom(hits: unknown[]): Promise<ShopCandidate[]> {
  const { gate } = setup([answering(NAME_SEARCH.body, searchAnswer(hits))]);
  const search = await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size);
  if (search.kind !== "results") {
    throw new Error(`expected results, got ${search.kind}`);
  }
  return search.candidates;
}

/** The candidates of a recorded search answer, served for the request the adapter makes. */
async function recordedCandidates(
  search: { query: string; size: number; body: string },
  fixture: object,
): Promise<ShopCandidate[]> {
  const { gate, fetchMock } = setup([answering(search.body, JSON.stringify(fixture))]);
  const result = await searchSuperPharm(gate, search.query, search.size);
  expect(sentRequests(fetchMock)).toEqual([request(search.body)]);
  if (result.kind !== "results") {
    throw new Error(`expected results, got ${result.kind}`);
  }
  return result.candidates;
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

beforeEach(() => {
  // Only the clock an offer's promotion end is judged by, against the tables' dates in 2026 and 2027, so no expectation
  // expires; the requests' time limits keep their real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Super-Pharm search: recorded answers", () => {
  it("maps Nivea Soft 300 ml to a candidate, on sale with no regular price", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const candidates = await recordedCandidates(SOFT_SEARCH, nameSearchOne);

    expect(candidates).toEqual([
      {
        shop: "super-pharm",
        shopItemId: SOFT,
        brand: "Nivea",
        name: "Nivea Soft Krem nawilżający (Pudełko)",
        sizeText: "300 ml",
        size: { value: 300, unit: "ml" },
        eans: [],
        productUrl: SOFT_PAGE,
        imageUrl: SOFT_IMAGE,
        offer: SOFT_OFFER,
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("finds nothing, and logs nothing, for an EAN, which the index doesn't hold", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await recordedCandidates(EAN_SEARCH, searchEmpty)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("maps the name search's hits in Super-Pharm's order, each with its size and whole offer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const candidates = await recordedCandidates(NAME_SEARCH, nameSearch);

    expect(warn).not.toHaveBeenCalled();
    expect(candidates).toEqual([
      {
        shop: "super-pharm",
        shopItemId: HAND_CREAM,
        brand: "Nivea",
        name: "Nivea Krem do rąk Intensywne Nawilżenie",
        sizeText: "100 ml",
        size: { value: 100, unit: "ml" },
        eans: [],
        productUrl: `${PAGES}/nivea-krem-do-rak-intensywne-nawilzenie-167924`,
        imageUrl: `${IMAGES}/1/5/15040933_T1.jpg`,
        offer: HAND_CREAM_OFFER,
      },
      {
        shop: "super-pharm",
        shopItemId: LUMINOUS,
        brand: "Nivea",
        name: "Nivea Krem do rąk Luminous 360 przeciw Przebarwieniom",
        sizeText: "50 ml",
        size: { value: 50, unit: "ml" },
        eans: [],
        productUrl: `${PAGES}/nivea-krem-do-rak-luminous-360-przeciw-przebarwieniom-167925`,
        imageUrl: `${IMAGES}/1/5/15021115_T1.jpg`,
        offer: LUMINOUS_OFFER,
      },
      {
        shop: "super-pharm",
        shopItemId: SOFT,
        brand: "Nivea",
        name: "Nivea Soft Krem nawilżający (Pudełko)",
        sizeText: "300 ml",
        size: { value: 300, unit: "ml" },
        eans: [],
        productUrl: SOFT_PAGE,
        imageUrl: SOFT_IMAGE,
        offer: SOFT_OFFER,
      },
      {
        shop: "super-pharm",
        shopItemId: "58823",
        brand: "Nivea",
        name: "Nivea Mini - Krem Uniwersalny",
        sizeText: "30 ml",
        size: { value: 30, unit: "ml" },
        eans: [],
        productUrl: `${PAGES}/nivea-mini-krem-uniwersalny-84638`,
        imageUrl: `${IMAGES}/n/i/nivea-krem-uniwersalny-30ml-1_2.jpg`,
        offer: { price: 4.09, regularPrice: null, lowestPrice30d: 7.99, promoEndsOn: null, available: true },
      },
      {
        shop: "super-pharm",
        shopItemId: "47977",
        brand: "Nivea",
        name: "Nivea Hand Krem do rąk Protective Care z Woskiem Pszczelim",
        sizeText: "75 ml",
        size: { value: 75, unit: "ml" },
        eans: [],
        productUrl: `${PAGES}/nivea-hand-krem-do-rak-protective-care-z-woskiem-pszczelim-137777`,
        imageUrl: `${IMAGES}/1/6/16369168_T1.jpg`,
        offer: { ...HAND_CREAM_OFFER, price: 9.49 },
      },
    ]);
  });

  it("writes every recorded size as text that parses back to the same size", async () => {
    const candidates = await candidatesFrom([...hitsOf(nameSearchOne), ...hitsOf(nameSearch)]);

    expect(candidates).toHaveLength(6);
    for (const candidate of candidates) {
      expect(candidate.sizeText, candidate.shopItemId).not.toBeNull();
      expect(parseSize(candidate.sizeText), candidate.shopItemId).toEqual(candidate.size);
    }
  });

  it("reads the size from capacity, never from farmax_capacity", async () => {
    // The probe's hit carries farmax_capacity, 300 without a unit, beside capacity.
    const [full] = hitsOf(nameSearchOne);

    const candidates = await candidatesFrom([
      withFields(full, { farmax_capacity: 237 }),
      withFields(full, { capacity: undefined }),
    ]);

    expect(candidates.map(({ sizeText, size }) => ({ sizeText, size }))).toEqual([
      { sizeText: "300 ml", size: { value: 300, unit: "ml" } },
      { sizeText: null, size: null },
    ]);
  });

  it("gives each search its own 4 s limit", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn<ShopGate["fetch"]>(() => Promise.resolve({ kind: "failed", reason: "network" }));

    await searchSuperPharm({ fetch }, NAME_SEARCH.query, NAME_SEARCH.size);

    expect(timeout).toHaveBeenCalledWith(4000);
    const [created] = timeout.mock.results;
    if (created.type !== "return") {
      throw new Error("AbortSignal.timeout didn't return a signal");
    }
    const [, , init] = fetch.mock.calls[0];
    expect(init?.signal).toBe(created.value);
  });
});

describe("Super-Pharm search: sizes and names", () => {
  it.each([
    { capacity: "0,5 l", expected: { sizeText: "0,5 l", size: { value: 500, unit: "ml" } } },
    { capacity: "4,8 g", expected: { sizeText: "4,8 g", size: { value: 4.8, unit: "g" } } },
    { capacity: "10 szt.", expected: { sizeText: "10 szt.", size: { value: 10, unit: "pcs" } } },
    { capacity: "  300 ml ", expected: { sizeText: "300 ml", size: { value: 300, unit: "ml" } } },
    { capacity: "2 x 50 ml", expected: { sizeText: null, size: null } },
    { capacity: "300", expected: { sizeText: null, size: null } },
    { capacity: 300, expected: { sizeText: null, size: null } },
    { capacity: `${"1".repeat(38)} ml`, expected: { sizeText: null, size: null } },
  ])("reads capacity $capacity as $expected.sizeText, and keeps the hit", async ({ capacity, expected }) => {
    const [candidate] = await candidatesFrom([withFields(soft(), { capacity })]);

    expect(candidate).toMatchObject({ shopItemId: SOFT, ...expected });
  });

  it.each([
    { why: "is blank", name: "   " },
    { why: "is missing", name: undefined },
    { why: "isn't text", name: 10132 },
  ])("drops a hit whose name $why, and keeps the others", async ({ name }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const candidates = await candidatesFrom([withFields(soft(), { name }), hitFor(nameSearch, HAND_CREAM)]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual([HAND_CREAM]);
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-search",
      reason: "hits dropped",
      detail: "1 of 2 product hits",
    });
  });

  it("cuts an over-long brand and name to their limits", async () => {
    const [candidate] = await candidatesFrom([withFields(soft(), { brand: "B".repeat(200), name: "n".repeat(400) })]);

    expect(candidate.brand).toHaveLength(120);
    expect(candidate.name).toHaveLength(300);
  });
});

describe("Super-Pharm search: orderable online", () => {
  it.each([
    { inStock: 1, inStoreOnly: 0, available: true, odd: false },
    // A missing flag is how the Magento extension usually writes an unset attribute (plan review F2).
    { inStock: 1, inStoreOnly: undefined, available: true, odd: false },
    // Sold only in Super-Pharm's shops.
    { inStock: 1, inStoreOnly: 1, available: false, odd: false },
    { inStock: 0, inStoreOnly: 0, available: false, odd: false },
    { inStock: undefined, inStoreOnly: 0, available: false, odd: true },
    { inStock: true, inStoreOnly: 0, available: false, odd: true },
    { inStock: "1", inStoreOnly: 0, available: false, odd: true },
    { inStock: 1, inStoreOnly: "0", available: false, odd: true },
    { inStock: 1, inStoreOnly: false, available: false, odd: true },
    { inStock: 1, inStoreOnly: null, available: false, odd: true },
    { inStock: 1, inStoreOnly: 2, available: false, odd: true },
  ])(
    "reads in_stock $inStock with inStoreOnly $inStoreOnly as orderable online: $available",
    async ({ inStock, inStoreOnly, available, odd }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const [candidate] = await candidatesFrom([withFields(soft(), { in_stock: inStock, inStoreOnly })]);

      expect(candidate.offer).toEqual({ ...SOFT_OFFER, available });
      // A flag that isn't a 1 or a 0 is counted, as dropped hits are, so a changed format shows.
      expect(loggedLines(warn)).toEqual(
        odd ? [{ event: "super-pharm-search", reason: "availability unread", detail: "1 of 1 product hits" }] : [],
      );
    },
  );
});

describe("Super-Pharm search: prices", () => {
  it("never takes a regular price the record doesn't carry, though the item is on sale", async () => {
    // The probe's hit is shown on sale (`showRedPrice` 1, a "Promocja" badge), with a 30-day low above its price, yet
    // without `default_original_formated`.
    const [full] = hitsOf(nameSearchOne);
    expect(full.price.PLN.default_original_formated).toBeUndefined();

    const [candidate] = await candidatesFrom([full]);

    expect(candidate.offer).toEqual(SOFT_OFFER);
  });

  it.each([
    {
      why: "with a no-break space before zł, as Super-Pharm writes prices",
      value: `36,99${NBSP}zł`,
      regular: 36.99,
      odd: false,
    },
    { why: "with a space before zł", value: "36,99 zł", regular: 36.99, odd: false },
    { why: "with thousands grouped", value: `1${NBSP}036,99${NBSP}zł`, regular: 1036.99, odd: false },
    // It reads as a price, so it isn't counted: it's only not above the price.
    { why: "equal to the price, so no regular price", value: `19,49${NBSP}zł`, regular: null, odd: false },
    { why: "with a dot as the decimal mark, which reads as nothing", value: "36.99 zł", regular: null, odd: true },
    { why: "sent as false", value: false, regular: null, odd: false },
    { why: "sent as a number", value: 36.99, regular: null, odd: true },
  ])("reads default_original_formated $why", async ({ value, regular, odd }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const [candidate] = await candidatesFrom([withPrices(soft(), { default_original_formated: value })]);

    expect(candidate.offer).toEqual({ ...SOFT_OFFER, regularPrice: regular });
    // A value that's there but can't be read costs only the regular price, and is counted so a changed format shows.
    expect(loggedLines(warn)).toEqual(
      odd ? [{ event: "super-pharm-search", reason: "regular price unread", detail: "1 of 1 product hits" }] : [],
    );
  });

  it.each([
    { why: "Polish text with a no-break space, as recorded", value: `33,99${NBSP}zł`, lowest: 33.99, odd: false },
    { why: "false, Super-Pharm's none", value: false, lowest: null, odd: false },
    { why: "missing", value: undefined, lowest: null, odd: false },
    { why: "null", value: null, lowest: null, odd: false },
    { why: "text with a dot as the decimal mark", value: "33.99 zł", lowest: null, odd: true },
    { why: "text that isn't a price", value: "brak", lowest: null, odd: true },
    { why: "empty text", value: "", lowest: null, odd: true },
    { why: "a number", value: 33.99, lowest: null, odd: true },
  ])("reads a 30-day low that is $why", async ({ value, lowest, odd }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const [candidate] = await candidatesFrom([withPrices(soft(), { default_historical_min_price_formated: value })]);

    expect(candidate.offer).toEqual({ ...SOFT_OFFER, lowestPrice30d: lowest });
    // Text that can't be read costs only the 30-day low, and is counted so a changed format shows.
    expect(loggedLines(warn)).toEqual(
      odd ? [{ event: "super-pharm-search", reason: "30-day low unread", detail: "1 of 1 product hits" }] : [],
    );
  });

  it.each([
    { why: "a second before midnight in Poland", value: 1791669599, endsOn: "2026-10-10", odd: false },
    { why: "midnight in Poland, 22:00 UTC the day before", value: 1791669600, endsOn: "2026-10-11", odd: false },
    { why: "midnight in Poland in winter time, 23:00 UTC", value: 1798758000, endsOn: "2027-01-01", odd: false },
    { why: "false, as recorded", value: false, endsOn: null, odd: false },
    { why: "empty text, the extension's unset date", value: "", endsOn: null, odd: false },
    { why: "seconds as text", value: "1791669600", endsOn: null, odd: true },
    { why: "zero", value: 0, endsOn: null, odd: true },
    { why: "negative", value: -1, endsOn: null, odd: true },
    { why: "not whole seconds", value: 1791669600.5, endsOn: null, odd: true },
    { why: "past the year 9999", value: 253402300800, endsOn: null, odd: true },
    { why: "past any date", value: Number.MAX_SAFE_INTEGER, endsOn: null, odd: true },
  ])(
    "reads a promotion's end from special_to_date that is $why, beside a regular price",
    async ({ value, endsOn, odd }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const [candidate] = await candidatesFrom([
        withPrices(soft(), { default_original_formated: `36,99${NBSP}zł`, special_to_date: value }),
      ]);

      expect(candidate.offer).toEqual({ ...SOFT_OFFER, regularPrice: 36.99, promoEndsOn: endsOn });
      // A value that's there but can't be read costs only the end, and is counted so a changed format shows.
      expect(loggedLines(warn)).toEqual(
        odd ? [{ event: "super-pharm-search", reason: "promotion end unread", detail: "1 of 1 product hits" }] : [],
      );
    },
  );

  // Magento keeps a sale's dates on the record after the sale (the probe's hit still has a `special_from_date` from
  // 2016), and an end in the past would make the current price stale on every check. So an end counts only beside the
  // regular price it ends, as the search extension's own frontend reads it.
  it.each([
    // Without a regular price the end is left out (offerOf), so even one a year past isn't counted as ended.
    { why: "no regular price and an end a year past", fields: { special_to_date: 1759269600 }, odd: false },
    { why: "no regular price and an end still to come", fields: { special_to_date: 1791669599 }, odd: false },
    {
      why: "a regular price equal to the price",
      fields: { default_original_formated: `19,49${NBSP}zł`, special_to_date: 1791669599 },
      odd: false,
    },
    {
      why: "a regular price it can't read",
      fields: { default_original_formated: "36.99 zł", special_to_date: 1791669599 },
      odd: true,
    },
    {
      why: "a regular price sent as false",
      fields: { default_original_formated: false, special_to_date: 1791669599 },
      odd: false,
    },
  ])("takes no promotion end with $why", async ({ fields, odd }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const [candidate] = await candidatesFrom([withPrices(soft(), fields)]);

    expect(candidate.offer).toEqual(SOFT_OFFER);
    // Only a regular price that's there but can't be read is counted, as in the table of regular prices above.
    expect(loggedLines(warn)).toEqual(
      odd ? [{ event: "super-pharm-search", reason: "regular price unread", detail: "1 of 1 product hits" }] : [],
    );
  });

  it("keeps a promotion's end already past beside its regular price, and logs how many", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // 2025-10-01 in Poland, a year before the clock: as a sale's end Magento left behind would read.
    const [candidate] = await candidatesFrom([
      withPrices(soft(), { default_original_formated: `36,99${NBSP}zł`, special_to_date: 1759269600 }),
    ]);

    // The end is kept, so the comparison reads the price as stale on every check, and only the line shows it.
    expect(candidate.offer).toEqual({ ...SOFT_OFFER, regularPrice: 36.99, promoEndsOn: "2025-10-01" });
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-search",
      reason: "promotion ended",
      detail: "1 of 1 product hits",
    });
  });

  it("drops only the offer of a price that can't be stored", async () => {
    const candidates = await candidatesFrom([withPrices(soft(), { default: 100000 })]);

    expect(candidates.map(({ shopItemId, offer }) => ({ shopItemId, offer }))).toEqual([
      { shopItemId: SOFT, offer: null },
    ]);
  });
});

describe("Super-Pharm search: what it keeps out", () => {
  it("drops the hits it can't read, keeps the others, and logs how many", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [handCream, luminous, , mini, protective] = hitsOf(nameSearch);

    const candidates = await candidatesFrom([
      handCream,
      withPrices(luminous, { default: "28,99 zł" }),
      soft(),
      withPrices(mini, { default: 0 }),
      withFields(protective, { objectID: undefined }),
    ]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual([HAND_CREAM, SOFT]);
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-search",
      reason: "hits dropped",
      detail: "3 of 5 product hits",
    });
  });

  it.each([
    { why: "a path", objectID: `${SOFT}/../koszyk` },
    { why: "letters", objectID: "SP10132" },
    { why: "a filter of its own", objectID: `${SOFT} OR objectID:${HAND_CREAM}` },
    { why: "more than 12 digits", objectID: "1".repeat(13) },
    { why: "nothing", objectID: "" },
    { why: "a number", objectID: 10132 },
  ])("drops a hit whose id holds $why, and keeps the others", async ({ objectID }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const candidates = await candidatesFrom([withFields(soft(), { objectID }), hitFor(nameSearch, HAND_CREAM)]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual([HAND_CREAM]);
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-search",
      reason: "hits dropped",
      detail: "1 of 2 product hits",
    });
  });

  it("lets an odd value cost only itself: a brand that isn't text, a link off www.superpharm.pl, an image over http", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const candidates = await candidatesFrom([
      withFields(soft(), { brand: ["Nivea"] }),
      withFields(soft(), { brand: 5500 }),
      withFields(soft(), { url: "https://superpharm.pl/nivea-soft-krem-nawilzajacy-pudelko-39477" }),
      withFields(soft(), { thumbnail_url: "http://media.superpharm.eu/media/x.jpg" }),
    ]);

    expect(candidates.map(({ brand, productUrl, imageUrl }) => ({ brand, productUrl, imageUrl }))).toEqual([
      // A list where the recording has a single value reads the same.
      { brand: "Nivea", productUrl: SOFT_PAGE, imageUrl: SOFT_IMAGE },
      { brand: null, productUrl: SOFT_PAGE, imageUrl: SOFT_IMAGE },
      { brand: "Nivea", productUrl: null, imageUrl: SOFT_IMAGE },
      { brand: "Nivea", productUrl: SOFT_PAGE, imageUrl: null },
    ]);
    expect(candidates.map((candidate) => candidate.offer)).toEqual([SOFT_OFFER, SOFT_OFFER, SOFT_OFFER, SOFT_OFFER]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps product links and images only on Super-Pharm's hosts and within their limits", async () => {
    const candidates = await candidatesFrom([
      withFields(soft(), {
        url: `${SOFT_PAGE}?${"x".repeat(500)}`,
        thumbnail_url: `${IMAGES}/${"x".repeat(500)}.jpg`,
      }),
      // Each on the other's host.
      withFields(soft(), { url: `${IMAGES}/x.jpg`, thumbnail_url: SOFT_PAGE }),
    ]);

    expect(candidates.map(({ productUrl, imageUrl }) => ({ productUrl, imageUrl }))).toEqual([
      { productUrl: null, imageUrl: null },
      { productUrl: null, imageUrl: null },
    ]);
  });

  it.each([
    { url: SOFT_PAGE, page: true, image: false },
    { url: `${IMAGES}/1/5/15040933_T1.jpg`, page: false, image: true },
    { url: "http://www.superpharm.pl/x", page: false, image: false },
    { url: "http://media.superpharm.eu/x.jpg", page: false, image: false },
    { url: "https://superpharm.pl/x", page: false, image: false },
    { url: "https://www.superpharm.pl.example.com/x", page: false, image: false },
    { url: "https://media.superpharm.eu.example.com/x.jpg", page: false, image: false },
    { url: QUERY_URL, page: false, image: false },
    { url: "/x", page: false, image: false },
  ])("treats $url as Super-Pharm's product page: $page, and as its image: $image", ({ url, page, image }) => {
    expect(isSuperPharmProductUrl(url)).toBe(page);
    expect(isSuperPharmImage(url)).toBe(image);
  });

  it.each([
    { id: SOFT, valid: true },
    { id: "1".repeat(12), valid: true },
    { id: "1".repeat(13), valid: false },
    { id: "", valid: false },
    { id: "10 132", valid: false },
    { id: "SP10132", valid: false },
    { id: `${SOFT} OR objectID:${HAND_CREAM}`, valid: false },
    { id: "-1", valid: false },
    { id: "1e5", valid: false },
    { id: `${SOFT}\n`, valid: false },
  ])("takes $id as an id a filter can hold: $valid", ({ id, valid }) => {
    expect(isSuperPharmItemId(id)).toBe(valid);
  });
});

describe("Super-Pharm search: the matching rule on its candidates (FR-006)", () => {
  it("never accepts Nivea Soft 300 ml on its own, though its size and brand agree: it shares no EAN", async () => {
    const candidates = await recordedCandidates(SOFT_SEARCH, nameSearchOne);

    expect(pickMatch(ROSSMANN_SOFT, candidates)).toEqual({
      kind: "choose",
      options: [{ candidate: candidates[0], verdict: { sharesEan: false, size: "equal", brand: "agrees" } }],
    });
  });

  it("asks the user among the name search's items, each with its size and brand flags", async () => {
    const candidates = await recordedCandidates(NAME_SEARCH, nameSearch);

    const pick = pickMatch(ROSSMANN_SOFT, candidates);

    if (pick.kind !== "choose") {
      throw new Error(`expected choose, got ${pick.kind}`);
    }
    // Which three, and in what order, is pickMatch's to decide; each comes with how it compares, and none shares an EAN.
    expect(new Map(pick.options.map(({ candidate, verdict }) => [candidate.shopItemId, verdict]))).toEqual(
      new Map([
        [HAND_CREAM, { sharesEan: false, size: "differs", brand: "agrees" }],
        [LUMINOUS, { sharesEan: false, size: "differs", brand: "agrees" }],
        [SOFT, { sharesEan: false, size: "equal", brand: "agrees" }],
      ]),
    );
  });
});

describe("Super-Pharm search: broken copies give a gap, never 'not found'", () => {
  it.each<{ change: string; edit: (hit: Hit) => Hit }>([
    { change: "prices sent as text", edit: (hit) => withPrices(hit, { default: hit.price.PLN.default_formated }) },
    { change: "no price", edit: (hit) => withPrices(hit, { default: undefined }) },
    { change: "prices in another currency", edit: (hit) => withFields(hit, { price: { EUR: hit.price.PLN } }) },
    { change: "no ids", edit: (hit) => withFields(hit, { objectID: undefined }) },
    { change: "numeric ids", edit: (hit) => withFields(hit, { objectID: Number(hit.objectID) }) },
    { change: "product links in place of the ids", edit: (hit) => withFields(hit, { objectID: hit.url }) },
    { change: "no names", edit: (hit) => withFields(hit, { name: undefined }) },
  ])("gives up when no hit can be read, as with $change, and logs how many", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([answering(NAME_SEARCH.body, searchAnswer(hitsOf(nameSearch).map(edit)))]);

    expect(await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size)).toEqual(FAILED);
    expect(sentRequests(fetchMock)).toEqual([request(NAME_SEARCH.body)]);
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-search",
      reason: "hits dropped",
      detail: "5 of 5 product hits",
    });
  });

  it.each([
    { answer: "an HTML page", body: HTML_PAGE, reason: "unreadable body" },
    { answer: "an empty body", body: "", reason: "unreadable body" },
    {
      answer: "the recorded answer without its hits",
      body: JSON.stringify({ ...nameSearch, hits: undefined }),
      reason: "unexpected response shape",
    },
    {
      answer: "the recorded answer with its hits keyed by id",
      body: JSON.stringify({
        ...nameSearch,
        hits: Object.fromEntries(nameSearch.hits.map((hit) => [hit.objectID, hit])),
      }),
      reason: "unexpected response shape",
    },
  ])("gives up on $answer, and logs it without the search text", async ({ body, reason }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([answering(NAME_SEARCH.body, body)]);

    expect(await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size)).toEqual(FAILED);
    expect(sentRequests(fetchMock)).toEqual([request(NAME_SEARCH.body)]);
    expect(loggedLine(warn)).toMatchObject({ event: "super-pharm-search", reason });
    expect(String(warn.mock.calls[0][0]).toLowerCase()).not.toContain("nivea");
  });

  it("gives up on a 400, as Algolia answers a key past its expiry, which only the gate logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reportBlock, gateLog } = setup([answering(NAME_SEARCH.body, "", 400)]);

    expect(await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size)).toEqual(FAILED);
    expect(sentRequests(fetchMock)).toEqual([request(NAME_SEARCH.body)]);
    expect(warn).not.toHaveBeenCalled();
    expect(gateLog.mock.calls).toEqual([
      [expect.objectContaining({ shopId: "super-pharm", outcome: { kind: "failed", reason: "http", status: 400 } })],
    ]);
    // A failure, not a stop.
    expect(reportBlock).not.toHaveBeenCalled();
  });

  it("gives up on a 404, as for an index Algolia doesn't have, and says the index may have changed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reportBlock, gateLog } = setup([answering(NAME_SEARCH.body, "", 404)]);

    expect(await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size)).toEqual(FAILED);
    expect(sentRequests(fetchMock)).toEqual([request(NAME_SEARCH.body)]);
    // Beside the gate's line, the adapter's own names the constant to update.
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-search",
      reason: "index rejected",
      detail: "HTTP 404: QUERY_URL may have changed",
    });
    expect(gateLog.mock.calls).toEqual([
      [expect.objectContaining({ shopId: "super-pharm", outcome: { kind: "failed", reason: "http", status: 404 } })],
    ]);
    expect(reportBlock).not.toHaveBeenCalled();
  });

  it("is stopped by a 403, as Algolia answers a key it no longer accepts", async () => {
    const { gate, fetchMock, reportBlock } = setup([answering(NAME_SEARCH.body, "", 403)]);

    expect(await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size)).toEqual({
      kind: "unavailable",
      reason: "stopped",
    });
    expect(sentRequests(fetchMock)).toEqual([request(NAME_SEARCH.body)]);
    expect(reportBlock.mock.calls).toEqual([["super-pharm", "blocked", undefined, "HTTP 403"]]);
  });

  it.each([
    { refusal: "the cap is reached", reservation: { outcome: "capped" }, expected: { reason: "busy" } },
    { refusal: "the shop is stopped", reservation: { outcome: "stopped" }, expected: { reason: "stopped" } },
    {
      refusal: "the shop is paused",
      reservation: { outcome: "paused", until: "2026-10-05T19:15:00.000Z" },
      expected: { reason: "paused", until: "2026-10-05T19:15:00.000Z" },
    },
  ])("says so without calling Algolia when $refusal", async ({ reservation, expected }) => {
    const { gate, fetchMock } = setup([answering(NAME_SEARCH.body, JSON.stringify(nameSearch))], reservation);

    expect(await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size)).toEqual({
      kind: "unavailable",
      ...expected,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Super-Pharm prices: recorded answers", () => {
  it("fetches the asked-for items' offers, and calls the id Super-Pharm left out missing", async () => {
    // The ids in the order the rules-off recording asked for them, which its body was sent with.
    const ids = [HAND_CREAM, LUMINOUS, SOFT, UNKNOWN_ID];
    const { gate, fetchMock } = setup([answering(priceBody(ids), JSON.stringify(pinnedRulesOff))]);

    const checks = await fetchSuperPharmPrices(gate, ids);

    const sent = sentRequests(fetchMock);
    expect(sent).toEqual([request(priceBody(ids))]);
    expect(paramsOf(sent[0].body).get("filters")).toBe(
      "objectID:96276 OR objectID:96278 OR objectID:10132 OR objectID:999999999",
    );
    // In the order given, whatever order Algolia answered in.
    expect([...checks]).toEqual([
      [HAND_CREAM, { kind: "price", offer: HAND_CREAM_OFFER }],
      [LUMINOUS, { kind: "price", offer: LUMINOUS_OFFER }],
      [SOFT, { kind: "price", offer: SOFT_OFFER }],
      [UNKNOWN_ID, { kind: "missing" }],
    ]);
  });

  it("reads a hit without inStoreOnly as orderable, with no log line, as the probe that didn't ask for it shows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([answering(priceBody([SOFT, UNKNOWN_ID]), JSON.stringify(pinnedOne))]);

    expect(await fetchSuperPharmPrices(gate, [SOFT, UNKNOWN_ID])).toEqual(
      new Map<string, PriceCheck>([
        [SOFT, { kind: "price", offer: SOFT_OFFER }],
        [UNKNOWN_ID, { kind: "missing" }],
      ]),
    );
    expect(sentRequests(fetchMock)).toEqual([request(priceBody([SOFT, UNKNOWN_ID]))]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("asks once for an id given twice", async () => {
    const { gate, fetchMock } = setup([answering(priceBody([SOFT]), JSON.stringify(pinnedOne))]);

    const checks = await fetchSuperPharmPrices(gate, [SOFT, SOFT]);

    expect(sentRequests(fetchMock)).toEqual([request(priceBody([SOFT]))]);
    expect(checks).toEqual(new Map([[SOFT, { kind: "price", offer: SOFT_OFFER }]]));
  });

  it("splits 21 ids into requests of 20 and 1, one after the other", async () => {
    // The EAN search's real empty answer stands in for a price request that found nothing: the same shape, read alike.
    const { gate, fetchMock } = setup([
      answering(firstBatch, JSON.stringify(pinnedOne)),
      answering(secondBatch, JSON.stringify(searchEmpty)),
    ]);

    const checks = await fetchSuperPharmPrices(gate, manyIds);

    const sent = sentRequests(fetchMock);
    expect(sent).toEqual([request(firstBatch), request(secondBatch)]);
    expect(sent.map(({ body }) => paramsOf(body).get("hitsPerPage"))).toEqual(["20", "1"]);
    expect(checks.size).toBe(21);
    expect(checks.get(SOFT)).toEqual({ kind: "price", offer: SOFT_OFFER });
    for (const id of manyIds.slice(1)) {
      expect(checks.get(id), id).toEqual({ kind: "missing" });
    }
  });

  it("gives each price request its own 4 s limit", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn<ShopGate["fetch"]>(() => Promise.resolve({ kind: "failed", reason: "network" }));

    await fetchSuperPharmPrices({ fetch }, [SOFT]);

    expect(timeout).toHaveBeenCalledWith(4000);
    const [created] = timeout.mock.results;
    if (created.type !== "return") {
      throw new Error("AbortSignal.timeout didn't return a signal");
    }
    const [, , init] = fetch.mock.calls[0];
    expect(init?.signal).toBe(created.value);
  });
});

describe("Super-Pharm prices: what they keep out", () => {
  it("never sends an id that can't go into a filter, and says it's unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invalid = ["..", "10 132", `objectID:${SOFT}`, `${HAND_CREAM} OR objectID:${LUMINOUS}`, "1".repeat(13), "-1"];
    const { gate, fetchMock } = setup([answering(priceBody([SOFT]), JSON.stringify(pinnedOne))]);

    const checks = await fetchSuperPharmPrices(gate, [invalid[0], SOFT, ...invalid.slice(1)]);

    expect(sentRequests(fetchMock)).toEqual([request(priceBody([SOFT]))]);
    expect(checks.get(SOFT)).toEqual({ kind: "price", offer: SOFT_OFFER });
    for (const id of invalid) {
      expect(checks.get(id), id).toEqual(FAILED);
    }
    // How many, never which.
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-prices",
      reason: "invalid IDs",
      detail: "6 of 7 IDs not sent",
    });
  });

  it("sends nothing for no ids", async () => {
    const { gate, fetchMock } = setup([]);

    expect(await fetchSuperPharmPrices(gate, [])).toEqual(new Map<string, PriceCheck>());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<{ change: string; edit: (hit: Hit) => Hit; offer: ShopOffer }>([
    {
      change: "a regular price, as the record carries it during some promotions",
      edit: (hit) => withPrices(hit, { default_original_formated: `36,99${NBSP}zł` }),
      offer: { ...SOFT_OFFER, regularPrice: 36.99 },
    },
    {
      change: "a promotion's end beside its regular price",
      edit: (hit) => withPrices(hit, { default_original_formated: `36,99${NBSP}zł`, special_to_date: 1791669599 }),
      offer: { ...SOFT_OFFER, regularPrice: 36.99, promoEndsOn: "2026-10-10" },
    },
    {
      change: "a promotion's end left out, as there's no regular price beside it",
      edit: (hit) => withPrices(hit, { special_to_date: 1759269600 }),
      offer: SOFT_OFFER,
    },
    {
      change: "no 30-day low",
      edit: (hit) => withPrices(hit, { default_historical_min_price_formated: false }),
      offer: { ...SOFT_OFFER, lowestPrice30d: null },
    },
    {
      change: "an item out of stock",
      edit: (hit) => withFields(hit, { in_stock: 0 }),
      offer: { ...SOFT_OFFER, available: false },
    },
    {
      change: "an item sold only in the shops",
      edit: (hit) => withFields(hit, { inStoreOnly: 1 }),
      offer: { ...SOFT_OFFER, available: false },
    },
  ])("keeps the offer with $change", async ({ edit, offer }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate } = setup([answering(priceBody([SOFT]), priceAnswer([edit(pricedSoft())]))]);

    expect(await fetchSuperPharmPrices(gate, [SOFT])).toEqual(new Map([[SOFT, { kind: "price", offer }]]));
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    { field: "in_stock", value: undefined },
    { field: "in_stock", value: "1" },
    { field: "inStoreOnly", value: "0" },
    { field: "inStoreOnly", value: null },
  ])(
    "reads $field $value as not orderable, and logs how many hits had a flag it can't read",
    async ({ field, value }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate } = setup([
        answering(priceBody([SOFT]), priceAnswer([withFields(pricedSoft(), { [field]: value })])),
      ]);

      expect(await fetchSuperPharmPrices(gate, [SOFT])).toEqual(
        new Map([[SOFT, { kind: "price", offer: { ...SOFT_OFFER, available: false } }]]),
      );
      expect(loggedLine(warn)).toEqual({
        event: "super-pharm-prices",
        reason: "availability unread",
        detail: "1 of 1 product hits",
      });
    },
  );

  it("drops only a 30-day low it can't read, and logs how many", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unread = withPrices(pricedSoft(), { default_historical_min_price_formated: "33.99 zł" });
    const { gate } = setup([answering(priceBody([SOFT]), priceAnswer([unread]))]);

    expect(await fetchSuperPharmPrices(gate, [SOFT])).toEqual(
      new Map([[SOFT, { kind: "price", offer: { ...SOFT_OFFER, lowestPrice30d: null } }]]),
    );
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-prices",
      reason: "30-day low unread",
      detail: "1 of 1 product hits",
    });
  });

  it("drops only a regular price it can't read, keeps the price, and logs how many", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unread = withPrices(pricedSoft(), { default_original_formated: "36.99 zł" });
    const { gate } = setup([answering(priceBody([SOFT]), priceAnswer([unread]))]);

    expect(await fetchSuperPharmPrices(gate, [SOFT])).toEqual(new Map([[SOFT, { kind: "price", offer: SOFT_OFFER }]]));
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-prices",
      reason: "regular price unread",
      detail: "1 of 1 product hits",
    });
  });

  it("keeps the other id's price when one hit can't be read, and the unread one is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unread = withPrices(hitFor(pinned, HAND_CREAM), { default: "13,99 zł" });
    const { gate } = setup([answering(priceBody([SOFT, HAND_CREAM]), priceAnswer([pricedSoft(), unread]))]);

    expect(await fetchSuperPharmPrices(gate, [SOFT, HAND_CREAM])).toEqual(
      new Map<string, PriceCheck>([
        [SOFT, { kind: "price", offer: SOFT_OFFER }],
        [HAND_CREAM, FAILED],
      ]),
    );
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-prices",
      reason: "hits dropped",
      detail: "1 of 2 product hits",
    });
  });

  it.each<{ change: string; edit: (hit: Hit) => Hit }>([
    { change: "its price sent as text", edit: (hit) => withPrices(hit, { default: "19,49 zł" }) },
    { change: "no price", edit: (hit) => withPrices(hit, { default: undefined }) },
    { change: "a price the table can't hold", edit: (hit) => withPrices(hit, { default: 100000 }) },
    { change: "a numeric id", edit: (hit) => withFields(hit, { objectID: 10132 }) },
    { change: "its product link in place of the id", edit: (hit) => withFields(hit, { objectID: SOFT_PAGE }) },
  ])("calls every id unavailable, never missing, when the hit can't be read, as with $change", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = JSON.stringify({ ...pinnedOne, hits: hitsOf(pinnedOne).map(edit) });
    const { gate, fetchMock } = setup([answering(priceBody([SOFT, UNKNOWN_ID]), body)]);

    expect(await fetchSuperPharmPrices(gate, [SOFT, UNKNOWN_ID])).toEqual(
      new Map([
        [SOFT, FAILED],
        [UNKNOWN_ID, FAILED],
      ]),
    );
    expect(sentRequests(fetchMock)).toEqual([request(priceBody([SOFT, UNKNOWN_ID]))]);
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-prices",
      reason: "hits dropped",
      detail: "1 of 1 product hits",
    });
  });

  it("stores no id as missing when Super-Pharm answers with an item it wasn't asked for", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // 10132's recorded hit in answer to another id, as if the filter had been ignored.
    const { gate } = setup([answering(priceBody([UNKNOWN_ID]), JSON.stringify(pinnedOne))]);

    expect(await fetchSuperPharmPrices(gate, [UNKNOWN_ID])).toEqual(new Map([[UNKNOWN_ID, FAILED]]));
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-prices",
      reason: "hits not asked for",
      detail: "1 of 1 product hits",
    });
  });

  it.each<{ change: string; edit: (answer: typeof pinned) => unknown }>([
    { change: "more hits matched than it holds", edit: (answer) => ({ ...answer, nbHits: 4 }) },
    { change: "no count of the hits matched", edit: (answer) => ({ ...answer, nbHits: undefined }) },
    { change: "the count as text", edit: (answer) => ({ ...answer, nbHits: "3" }) },
    { change: "a later page", edit: (answer) => ({ ...answer, page: 1 }) },
    { change: "more than one page", edit: (answer) => ({ ...answer, nbPages: 2 }) },
    { change: "no count of the pages", edit: (answer) => ({ ...answer, nbPages: undefined }) },
  ])("calls the id without a hit unavailable, never missing, when the answer has $change", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The recorded answer for four ids, edited: 999999999's hit may be the one it left out.
    const ids = [HAND_CREAM, LUMINOUS, SOFT, UNKNOWN_ID];
    const { gate } = setup([answering(priceBody(ids), JSON.stringify(edit(structuredClone(pinned))))]);

    expect(await fetchSuperPharmPrices(gate, ids)).toEqual(
      new Map<string, PriceCheck>([
        [HAND_CREAM, { kind: "price", offer: HAND_CREAM_OFFER }],
        [LUMINOUS, { kind: "price", offer: LUMINOUS_OFFER }],
        [SOFT, { kind: "price", offer: SOFT_OFFER }],
        [UNKNOWN_ID, FAILED],
      ]),
    );
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-prices",
      reason: "answer incomplete",
      detail: "3 product hits for 4 IDs",
    });
  });
});

describe("Super-Pharm prices: why they're unavailable", () => {
  it.each([
    {
      refusal: "busy under the cap",
      entries: [],
      reservation: { outcome: "capped" },
      requested: [],
      expected: { kind: "unavailable", reason: "busy" },
    },
    {
      refusal: "paused",
      entries: [],
      reservation: { outcome: "paused", until: "2026-10-05T19:15:00.000Z" },
      requested: [],
      expected: { kind: "unavailable", reason: "paused", until: "2026-10-05T19:15:00.000Z" },
    },
    {
      refusal: "stopped by a 403",
      entries: [answering(firstBatch, "", 403)],
      reservation: { outcome: "allowed" },
      requested: [request(firstBatch)],
      expected: { kind: "unavailable", reason: "stopped" },
    },
  ])(
    "stops once Super-Pharm is $refusal: the next request's ids get the same answer, unasked and unreserved",
    async ({ entries, reservation, requested, expected }) => {
      const { gate, fetchMock, reserve } = setup(entries, reservation);

      const checks = await fetchSuperPharmPrices(gate, manyIds);

      expect(reserve).toHaveBeenCalledTimes(1);
      expect(sentRequests(fetchMock)).toEqual(requested);
      expect(checks.size).toBe(21);
      for (const id of manyIds) {
        expect(checks.get(id), id).toEqual(expected);
      }
    },
  );

  it("goes on to the next request after one that failed", async () => {
    const { gate, fetchMock } = setup([
      answering(firstBatch, "", 500),
      answering(secondBatch, JSON.stringify(searchEmpty)),
    ]);

    const checks = await fetchSuperPharmPrices(gate, manyIds);

    expect(sentRequests(fetchMock)).toEqual([request(firstBatch), request(secondBatch)]);
    for (const id of manyIds.slice(0, 20)) {
      expect(checks.get(id), id).toEqual(FAILED);
    }
    expect(checks.get(manyIds[20])).toEqual({ kind: "missing" });
  });

  it("calls every id of a request unavailable on a 400, which only the gate logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reportBlock, gateLog } = setup([answering(priceBody([SOFT, UNKNOWN_ID]), "", 400)]);

    expect(await fetchSuperPharmPrices(gate, [SOFT, UNKNOWN_ID])).toEqual(
      new Map([
        [SOFT, FAILED],
        [UNKNOWN_ID, FAILED],
      ]),
    );
    expect(sentRequests(fetchMock)).toEqual([request(priceBody([SOFT, UNKNOWN_ID]))]);
    expect(warn).not.toHaveBeenCalled();
    expect(gateLog.mock.calls).toEqual([
      [expect.objectContaining({ shopId: "super-pharm", outcome: { kind: "failed", reason: "http", status: 400 } })],
    ]);
    expect(reportBlock).not.toHaveBeenCalled();
  });

  it("calls every id of a request unavailable on a 404, and says the index may have changed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reportBlock, gateLog } = setup([answering(priceBody([SOFT, UNKNOWN_ID]), "", 404)]);

    expect(await fetchSuperPharmPrices(gate, [SOFT, UNKNOWN_ID])).toEqual(
      new Map([
        [SOFT, FAILED],
        [UNKNOWN_ID, FAILED],
      ]),
    );
    expect(sentRequests(fetchMock)).toEqual([request(priceBody([SOFT, UNKNOWN_ID]))]);
    // Beside the gate's line, the adapter's own names the constant to update.
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-prices",
      reason: "index rejected",
      detail: "HTTP 404: QUERY_URL may have changed",
    });
    expect(gateLog.mock.calls).toEqual([
      [expect.objectContaining({ shopId: "super-pharm", outcome: { kind: "failed", reason: "http", status: 404 } })],
    ]);
    expect(reportBlock).not.toHaveBeenCalled();
  });

  it.each([
    { answer: "an HTML page", body: HTML_PAGE, reason: "unreadable body" },
    {
      answer: "the recorded answer without its hits",
      body: JSON.stringify({ ...pinned, hits: undefined }),
      reason: "unexpected response shape",
    },
  ])("gives up on $answer for every id, never missing, and logs it without the ids", async ({ body, reason }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ids = [HAND_CREAM, LUMINOUS, SOFT, UNKNOWN_ID];
    const { gate, fetchMock } = setup([answering(priceBody(ids), body)]);

    const checks = await fetchSuperPharmPrices(gate, ids);

    expect([...checks.values()]).toEqual([FAILED, FAILED, FAILED, FAILED]);
    expect(sentRequests(fetchMock)).toEqual([request(priceBody(ids))]);
    expect(loggedLine(warn)).toMatchObject({ event: "super-pharm-prices", reason });
    expect(String(warn.mock.calls[0][0])).not.toContain(SOFT);
  });
});

describe("Super-Pharm: the shop every request is charged to", () => {
  it("names Super-Pharm in every gate call and reservation, and sends each request's own body to the one URL", async () => {
    const { gate, fetchMock, reserve } = setup([
      answering(NAME_SEARCH.body, JSON.stringify(nameSearch)),
      answering(firstBatch, JSON.stringify(pinnedOne)),
      answering(secondBatch, JSON.stringify(searchEmpty)),
    ]);
    const gateFetch = vi.spyOn(gate, "fetch");

    await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size);
    await fetchSuperPharmPrices(gate, manyIds);

    expect(gateFetch.mock.calls.map(([shop]) => shop)).toEqual(["super-pharm", "super-pharm", "super-pharm"]);
    expect(reserve.mock.calls).toEqual([["super-pharm"], ["super-pharm"], ["super-pharm"]]);
    expect(sentRequests(fetchMock)).toEqual([request(NAME_SEARCH.body), request(firstBatch), request(secondBatch)]);
  });

  it("spells its bodies as the recordings of its own requests were sent", () => {
    // The two bodies kept beside the recordings, as sent: the name search's on 2026-10-05 at 18:51 UTC, and the price
    // request's, with the query rules off, at 22:24:52 UTC (00:24 on 2026-10-06 in Poland).
    expect(NAME_SEARCH.body).toBe(
      '{"params":"query=NIVEA+krem&hitsPerPage=10&analytics=false&attributesToRetrieve=name%2Cbrand%2Ccapacity%2Curl' +
        '%2Cthumbnail_url%2Cprice%2Cin_stock%2CinStoreOnly&attributesToHighlight=%5B%5D"}',
    );
    expect(priceBody([HAND_CREAM, LUMINOUS, SOFT, UNKNOWN_ID])).toBe(
      '{"params":"query=&filters=objectID%3A96276+OR+objectID%3A96278+OR+objectID%3A10132+OR+objectID%3A999999999' +
        "&hitsPerPage=4&analytics=false&attributesToRetrieve=price%2Cin_stock%2CinStoreOnly" +
        '&attributesToHighlight=%5B%5D&enableRules=false"}',
    );
  });

  it("keeps a search text's own characters inside its query, where they add no parameter", async () => {
    const query = "Dove Men+Care & Co mydło";
    const body = searchBody("Dove+Men%2BCare+%26+Co+myd%C5%82o", 10);
    const { gate, fetchMock } = setup([answering(body, JSON.stringify(searchEmpty))]);

    expect(await searchSuperPharm(gate, query, 10)).toEqual({ kind: "results", candidates: [] });

    const sent = sentRequests(fetchMock);
    expect(sent).toEqual([request(body)]);
    const params = paramsOf(sent[0].body);
    expect([...params.keys()]).toEqual([
      "query",
      "hitsPerPage",
      "analytics",
      "attributesToRetrieve",
      "attributesToHighlight",
    ]);
    expect(params.get("query")).toBe(query);
  });

  it("never logs the key, the search text or an id, whatever goes wrong", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const odd = [
      withFields(soft(), { in_stock: "1" }),
      withPrices(soft(), { default_historical_min_price_formated: "33.99 zł" }),
      withFields(soft(), { objectID: undefined }),
    ];
    const { gate, reportBlock, gateLog } = setup([
      answering(NAME_SEARCH.body, HTML_PAGE),
      answering(EAN_SEARCH.body, "", 400),
      answering(SOFT_SEARCH.body, searchAnswer(odd)),
      answering(priceBody([SOFT]), priceAnswer([withFields(pricedSoft(), { inStoreOnly: "0" })])),
      answering(priceBody([UNKNOWN_ID]), "", 403),
    ]);

    await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size);
    await searchSuperPharm(gate, EAN_SEARCH.query, EAN_SEARCH.size);
    await searchSuperPharm(gate, SOFT_SEARCH.query, SOFT_SEARCH.size);
    await fetchSuperPharmPrices(gate, [SOFT, "..", "SP10132"]);
    await fetchSuperPharmPrices(gate, [UNKNOWN_ID]);

    const lines = [
      ...warn.mock.calls.map(([line]) => String(line)),
      ...gateLog.mock.calls.map(([entry]) => JSON.stringify(entry)),
      ...reportBlock.mock.calls.map((call) => JSON.stringify(call)),
    ];
    // An unreadable body; three odd hits; an invalid id and an odd flag; a 400 and a 403 in the gate's log, and the
    // block it reported.
    expect(lines).toHaveLength(9);
    for (const line of lines) {
      expect(line).not.toContain(SEARCH_KEY);
      expect(line.toLowerCase()).not.toContain("nivea");
      expect(line).not.toContain(SOFT);
      expect(line).not.toContain(UNKNOWN_ID);
    }
  });
});
