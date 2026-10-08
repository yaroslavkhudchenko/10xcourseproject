import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { pickMatch, type NamedProduct } from "@/lib/services/matching";
import { createShopGate, type ShopGate, type ShopGateDeps, type ShopGateLogEntry } from "@/lib/services/shop-gate";
import { fetchNaturaPrices, isNaturaImage, isNaturaProductUrl, searchNatura } from "@/lib/services/shops/natura";
import { parseSize } from "@/lib/services/size";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import {
  CHALLENGE,
  gateOutcomes,
  loggedLine,
  loggedLines,
  pauseSecondsOf,
  type ServedAnswer,
} from "@/lib/services/testing/shop-answers";
import type { GateOutcome, PriceCheck, ShopCandidate, ShopOffer } from "@/types";
import eanHit from "@/lib/services/shops/fixtures/natura-ean-hit.json";
import eanMiss from "@/lib/services/shops/fixtures/natura-ean-miss.json";
import nameSearch from "@/lib/services/shops/fixtures/natura-name-search.json";
import niveaSoftSearch from "@/lib/services/shops/fixtures/natura-search-nivea-soft.json";
import skuUnknown from "@/lib/services/shops/fixtures/natura-sku-unknown.json";
import oneSku from "@/lib/services/shops/fixtures/natura-sku.json";
import twoSkus from "@/lib/services/shops/fixtures/natura-skus.json";
import unknownTracker from "@/lib/services/shops/fixtures/natura-unknown-tracker.json";

// The fixtures are real Luigi's Box answers for Natura, each recorded once; no test reaches the live search.
// - natura-ean-hit.json, natura-ean-miss.json, natura-name-search.json and natura-unknown-tracker.json (2026-09-27, for
//   S-02, shop-matching-first-two-shops): four curl requests from the developer machine, at least 2 s apart, with the
//   gate's User-Agent and `Accept: application/json`, each body trimmed to at most 5 hits:
//   - natura-ean-hit.json: `q=4005900009319&size=5`, Nivea Soft 300 ml, its one hit;
//   - natura-ean-miss.json: `q=5901234123457&size=5`, an EAN Natura doesn't list, as the answer's own query echoes:
//     no hits and `total_hits` 0;
//   - natura-name-search.json: `q=nivea soft 300 ml&size=10`, 3 product hits;
//   - natura-unknown-tracker.json: an invalid `tracker_id` with `q=nivea`, Luigi's Box's 404 in text/plain, "Catalog
//     for tracker_id … not found.", which names no shop.
// - natura-sku.json (NV89063 alone), natura-skus.json (NV89063 and NV81063) and natura-sku-unknown.json (ZZ00000000, a
//   SKU Natura doesn't have, as the answer's own filters echo) (2026-09-28, for S-03, cheapest-shop-today, with the
//   owner's approval): price requests from the developer machine, with the gate's User-Agent, at least 2 s apart, each
//   with the adapter's exact parameters.
// natura-search-nivea-soft.json is the search for "nivea soft", size 10, recorded on 2026-10-06 at 10:37:39 UTC from
// the developer machine, with the gate's User-Agent and `Accept: application/json`, following no redirect, and cut to
// its first 5 hits, all products: Nivea Soft in 300, 200 and 100 ml, Creme Soft's shower gel and a 50 ml Soft cream.
// The broken answers below each change one thing in a copy of these, or stand in a page or an empty body where the
// JSON was.
const searchUrl = (query: string, size: number) =>
  `https://live.luigisbox.com/search?tracker_id=703598-939363&q=${encodeURIComponent(query)}&size=${size}`;
// A price request, spelled out as the natura-sku*.json recordings were made: products only, one repeated f[] per SKU,
// as many hits as SKUs, and only the price attributes.
const priceUrl = (skus: string[]) =>
  "https://live.luigisbox.com/search?tracker_id=703598-939363&f%5B%5D=type%3Aproduct" +
  skus.map((sku) => `&f%5B%5D=sku%3A${sku}`).join("") +
  `&size=${skus.length}&hit_fields=sku%2Cprice_amount%2Cprice_old_amount%2Clowest_price%2Cavailability`;
const SOFT_EAN = "4005900009319";
// Nivea Soft's offer during a promotion, as every recording of it carries, and Nivea MEN's, which has no promotion but
// a 30-day low below its price.
const SOFT_OFFER: ShopOffer = {
  price: 16.99,
  regularPrice: 22.99,
  lowestPrice30d: 17.99,
  promoEndsOn: null,
  available: true,
};
const MEN_OFFER: ShopOffer = {
  price: 17.99,
  regularPrice: null,
  lowestPrice30d: 10.99,
  promoEndsOn: null,
  available: true,
};
const FAILED: PriceCheck = { kind: "unavailable", reason: "failed" };
// An EAN Natura doesn't list, as natura-ean-miss.json recorded.
const MISSING_EAN = "5901234123457";
const NAME_QUERY = "nivea soft 300 ml";
const SOFT_PAGE = "https://drogerienatura.pl/produkt/nivea-soft-krem-intensywnie-nawilzajacy-300-ml-4005900009319";
const IMAGE_HOST = "https://media.drogerienatura.pl";
// A page where Luigi's Box's JSON should be, as a proxy or a maintenance page would send it.
const HTML_PAGE =
  '<!DOCTYPE html><html lang="pl"><head><title>Drogerie Natura</title></head><body>Przerwa techniczna</body></html>';
// A query suggestion shaped as the only one ever recorded, Hebe's in hebe-name-search.json (research note §2.2): its
// `type` is "query", and the query is its `url` and its title.
const SUGGESTION = {
  url: NAME_QUERY,
  type: "query",
  attributes: { boosted_via: [], bool_tags: [], boost: 0, title: NAME_QUERY },
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

/** Every URL the fetch was asked for, so a test can't pass on the wrong request. */
function requestedUrls(fetchMock: Mock<typeof fetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : new URL(input).href));
}

/** A recorded hit, as JSON a test can edit. */
interface Hit {
  url: unknown;
  type?: unknown;
  attributes: Record<string, unknown>;
}

/** The recorded hits, copied so a test can edit them without touching the imported fixture. */
function hitsOf(fixture: { results: { hits: unknown[] } }): Hit[] {
  return structuredClone(fixture.results.hits) as Hit[];
}

/** A copy of a hit with some of its attributes replaced; an attribute set to undefined is left out of the answer. */
function withAttributes(hit: Hit, attributes: Record<string, unknown>): Hit {
  return { ...hit, attributes: { ...hit.attributes, ...attributes } };
}

/** The recorded Nivea Soft hit, with some of its attributes replaced. */
function softWith(attributes: Record<string, unknown>): Hit {
  const [soft] = hitsOf(eanHit);
  return withAttributes(soft, attributes);
}

/** A copy of a recorded answer with every hit edited, as JSON: everything else, its counts too, as recorded. */
function editedAnswer(fixture: { results: { hits: unknown[] } }, edit: (hit: Hit) => unknown): string {
  const copy = structuredClone(fixture);
  return JSON.stringify({ ...copy, results: { ...copy.results, hits: hitsOf(fixture).map(edit) } });
}

// Rossmann's Nivea Soft 300 ml (26900) and Soft Daily UV 100 ml (2103263), as Rossmann's search for "nivea soft"
// recorded them on 2026-10-06 (rossmann-search-nivea-soft.json), with their EANs hidden, as a product without an EAN
// would come: only the name check may then accept a Natura item for them.
const SOFT_WITHOUT_EAN: NamedProduct = {
  brand: "NIVEA",
  name: "Soft",
  caption: "krem do twarzy, ciała i dłoni, nawilżający",
  eans: [],
  size: { value: 300, unit: "ml" },
};
const DAILY_UV_WITHOUT_EAN: NamedProduct = {
  brand: "NIVEA",
  name: "Soft Daily UV",
  caption: "krem uniwersalny, nawilżający, SPF15",
  eans: [],
  size: { value: 100, unit: "ml" },
};

// The two recorded searches with product hits, as the adapter asks for them.
const RECORDED_SEARCHES = [
  { search: "the name search", query: NAME_QUERY, size: 10, answer: nameSearch },
  { search: "the EAN search", query: SOFT_EAN, size: 5, answer: eanHit },
];
// One plausible change to every hit of a recorded answer, as a changed format would make it, each leaving a hit no
// offer, so a search no candidate and a price request no price. A field set to undefined is left out of the answer.
const UNREADABLE_HITS: { change: string; edit: (hit: Hit) => unknown }[] = [
  { change: "no SKU", edit: (hit) => ({ ...hit, url: undefined }) },
  { change: "a product link in place of its SKU", edit: (hit) => ({ ...hit, url: SOFT_PAGE }) },
  { change: "no price", edit: (hit) => withAttributes(hit, { price_amount: undefined }) },
  { change: "its price sent as text", edit: (hit) => withAttributes(hit, { price_amount: "16.99" }) },
  // Natura's type is "product": one that differs only in case is no product, and no query suggestion either.
  { change: "another type", edit: (hit) => ({ ...hit, type: "Product" }) },
  { change: "neither a type nor attributes", edit: (hit) => ({ ...hit, type: undefined, attributes: undefined }) },
];
// Natura's availability as a changed format could send it, and whether the offer reads it as orderable online. Only
// a 1 or a 0 reads: anything else, missing or as text, is counted in a log line.
const AVAILABILITIES: { why: string; availability: unknown; available: boolean; odd: boolean }[] = [
  { why: "the number 1, as recorded", availability: 1, available: true, odd: false },
  { why: "the number 0", availability: 0, available: false, odd: false },
  { why: "missing", availability: undefined, available: false, odd: true },
  { why: "null", availability: null, available: false, odd: true },
  { why: "1 as text", availability: "1", available: false, odd: true },
  { why: "1 in a list", availability: [1], available: false, odd: true },
  { why: "true", availability: true, available: false, odd: true },
];

/** Optional prices a hit carries, the offer they leave, and the reasons they're counted under in log lines. */
interface OptionalPrices {
  change: string;
  attributes: Record<string, unknown>;
  offer: ShopOffer;
  reasons: string[];
}

// Nivea Soft's optional prices as a changed format could send them. One that's there but can't be read costs only
// itself and is counted; one left out or none is normal, and one that reads but can't be stored is dropped as any
// other would be, so neither is counted.
const OPTIONAL_PRICES: OptionalPrices[] = [
  {
    change: "a regular price with a decimal comma",
    attributes: { price_old_amount: "22,99" },
    offer: { ...SOFT_OFFER, regularPrice: null },
    reasons: ["regular price unread"],
  },
  {
    change: "a regular price that isn't a number",
    attributes: { price_old_amount: "brak" },
    offer: { ...SOFT_OFFER, regularPrice: null },
    reasons: ["regular price unread"],
  },
  {
    change: "a 30-day low that isn't a number",
    attributes: { lowest_price: ["brak"] },
    offer: { ...SOFT_OFFER, lowestPrice30d: null },
    reasons: ["30-day low unread"],
  },
  {
    change: "a 30-day low with its currency",
    attributes: { lowest_price: ["17.99 zł"] },
    offer: { ...SOFT_OFFER, lowestPrice30d: null },
    reasons: ["30-day low unread"],
  },
  {
    change: "neither of them readable",
    attributes: { price_old_amount: "22,99", lowest_price: ["brak"] },
    offer: { ...SOFT_OFFER, regularPrice: null, lowestPrice30d: null },
    reasons: ["30-day low unread", "regular price unread"],
  },
  {
    change: "no regular price",
    attributes: { price_old_amount: undefined },
    offer: { ...SOFT_OFFER, regularPrice: null },
    reasons: [],
  },
  {
    change: "a regular price of null",
    attributes: { price_old_amount: null },
    offer: { ...SOFT_OFFER, regularPrice: null },
    reasons: [],
  },
  {
    change: "an empty 30-day low",
    attributes: { lowest_price: [] },
    offer: { ...SOFT_OFFER, lowestPrice30d: null },
    reasons: [],
  },
  {
    change: "a blank 30-day low",
    attributes: { lowest_price: [" "] },
    offer: { ...SOFT_OFFER, lowestPrice30d: null },
    reasons: [],
  },
  {
    change: "a regular price equal to the price",
    attributes: { price_old_amount: 16.99 },
    offer: { ...SOFT_OFFER, regularPrice: null },
    reasons: [],
  },
  {
    change: "a 30-day low of zero",
    attributes: { lowest_price: ["0.000000"] },
    offer: { ...SOFT_OFFER, lowestPrice30d: null },
    reasons: [],
  },
];

/** Searches by name against a body built from the given hits, and returns the candidates. */
async function candidatesFrom(hits: unknown[]) {
  const body = JSON.stringify({ results: { hits } });
  const { gate } = setup([{ url: searchUrl(NAME_QUERY, 10), status: 200, body }]);
  const search = await searchNatura(gate, NAME_QUERY, 10);
  if (search.kind !== "results") {
    throw new Error(`expected results, got ${search.kind}`);
  }
  return search.candidates;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Natura search: recorded answers", () => {
  it("maps the EAN hit to a candidate", async () => {
    const { gate, fetchMock } = setup([{ url: searchUrl(SOFT_EAN, 5), status: 200, body: JSON.stringify(eanHit) }]);

    const search = await searchNatura(gate, SOFT_EAN, 5);

    expect(requestedUrls(fetchMock)).toEqual([searchUrl(SOFT_EAN, 5)]);
    expect(search).toEqual({
      kind: "results",
      candidates: [
        {
          shop: "natura",
          shopItemId: "NV89063",
          brand: "NIVEA",
          name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
          sizeText: "300 ml",
          size: { value: 300, unit: "ml" },
          eans: [SOFT_EAN],
          productUrl: SOFT_PAGE,
          imageUrl: `${IMAGE_HOST}/catalog/product/4/0/4005900009319_T1_a685.jpg?store=default&image-type=image`,
          offer: SOFT_OFFER,
        },
      ],
    });
  });

  it("finds nothing for an EAN Natura doesn't list, whose answer says it matched none, and logs nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve } = setup([
      { url: searchUrl(MISSING_EAN, 5), status: 200, body: JSON.stringify(eanMiss) },
    ]);

    expect(await searchNatura(gate, MISSING_EAN, 5)).toEqual({ kind: "results", candidates: [] });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(MISSING_EAN, 5)]);
    expect(reserve).toHaveBeenCalledTimes(1);
    // No hits, a count of 0 and no next page: only an answer that says so itself means nothing matched.
    expect(eanMiss.results.total_hits).toBe(0);
    expect(eanMiss.next_page).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("maps the name search's hits in Natura's order, each with its whole offer", async () => {
    const { gate, fetchMock } = setup([
      { url: searchUrl(NAME_QUERY, 10), status: 200, body: JSON.stringify(nameSearch) },
    ]);

    const search = await searchNatura(gate, NAME_QUERY, 10);

    expect(requestedUrls(fetchMock)).toEqual([searchUrl(NAME_QUERY, 10)]);
    expect(search).toMatchObject({
      kind: "results",
      candidates: [
        { shopItemId: "NV89063", brand: "NIVEA", sizeText: "300 ml", eans: [SOFT_EAN], offer: SOFT_OFFER },
        {
          shopItemId: "JM00370",
          brand: "YOPE",
          sizeText: "300 ml",
          eans: ["5900168900370"],
          offer: { ...SOFT_OFFER, regularPrice: 19.99 },
        },
        { shopItemId: "NV81063", brand: "NIVEA MEN", sizeText: "500 ml", eans: ["9005800286563"], offer: MEN_OFFER },
      ],
    });
  });

  it("writes every recorded size as text that parses back to the same size", async () => {
    const candidates = await candidatesFrom([...hitsOf(eanHit), ...hitsOf(nameSearch)]);

    expect(candidates).toHaveLength(4);
    for (const candidate of candidates) {
      expect(candidate.sizeText, candidate.shopItemId).not.toBeNull();
      expect(parseSize(candidate.sizeText), candidate.shopItemId).toEqual(candidate.size);
    }
  });

  it("gives each search its own 4 s limit", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn<ShopGate["fetch"]>(() => Promise.resolve({ kind: "failed", reason: "network" }));

    await searchNatura({ fetch }, SOFT_EAN, 5);

    expect(timeout).toHaveBeenCalledWith(4000);
    const [created] = timeout.mock.results;
    if (created.type !== "return") {
      throw new Error("AbortSignal.timeout didn't return a signal");
    }
    const [, , init] = fetch.mock.calls[0];
    expect(init?.signal).toBe(created.value);
  });
});

describe("Natura search: sizes", () => {
  it.each([
    { amount: "300.0000", unit: "ml", sizeText: "300 ml", size: { value: 300, unit: "ml" } },
    { amount: "0.5000", unit: "l", sizeText: "0,5 l", size: { value: 500, unit: "ml" } },
    { amount: "4.8000", unit: "g", sizeText: "4,8 g", size: { value: 4.8, unit: "g" } },
    { amount: "1.2500", unit: "kg", sizeText: "1,25 kg", size: { value: 1250, unit: "g" } },
    { amount: "10.0000", unit: "szt.", sizeText: "10 szt.", size: { value: 10, unit: "pcs" } },
  ])("writes $amount $unit as $sizeText, which parses back to the same size", async ({ amount, unit, ...expected }) => {
    const [candidate] = await candidatesFrom([softWith({ size: [amount], size_unit: [unit] })]);

    expect(candidate).toMatchObject(expected);
    expect(parseSize(candidate.sizeText)).toEqual(candidate.size);
  });

  it.each([
    { why: "a unit sizes aren't compared in", size: ["300.0000"], unit: ["cm"] },
    { why: "an amount of zero", size: ["0.0000"], unit: ["ml"] },
    { why: "an amount that isn't a number", size: ["około 300"], unit: ["ml"] },
    { why: "a numeric amount", size: [300], unit: ["ml"] },
    { why: "no unit", size: ["300.0000"], unit: [] },
    { why: "text over its limit", size: [`3${"0".repeat(40)}`], unit: ["ml"] },
  ])("gives no size for $why, and keeps the hit", async ({ size, unit }) => {
    const [candidate] = await candidatesFrom([softWith({ size, size_unit: unit })]);

    expect(candidate).toMatchObject({ shopItemId: "NV89063", sizeText: null, size: null });
  });
});

describe("Natura search: what it keeps out", () => {
  it("drops pseudo-hits and hits without a positive price", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { attributes } = softWith({});
    const [suggestion, ...unpriced] = [
      // A query suggestion, as Luigi's Box sends one for Hebe (research note §2.2): its type says so.
      { url: "nivea soft", type: "query", attributes: {} },
      { url: "ZERO01", attributes: { ...attributes, price_amount: 0 } },
      { url: "TEXT01", attributes: { ...attributes, price_amount: "16.99" } },
      { url: "NONE01", attributes: { ...attributes, price_amount: null } },
    ];

    const candidates = await candidatesFrom([suggestion, ...hitsOf(nameSearch), ...unpriced]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual(["NV89063", "JM00370", "NV81063"]);
    // The unpriced hits count as dropped products; the suggestion doesn't count at all.
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toMatchObject({ reason: "hits dropped", detail: "3 of 6 product hits" });
  });

  it("keeps the other candidates when one product hit can't be read, and logs how many were dropped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [soft, yope, men] = hitsOf(nameSearch);
    yope.attributes.price_amount = "16.99";

    const candidates = await candidatesFrom([soft, yope, men]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual(["NV89063", "NV81063"]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toEqual({ event: "natura-search", reason: "hits dropped", detail: "1 of 3 product hits" });
  });

  it("finds nothing, and logs nothing, when the only hit is a query suggestion", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await candidatesFrom([SUGGESTION])).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("gives up, rather than finding nothing, when the only hit is no product and no query suggestion", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A hit without a type and with empty attributes, once read as a query suggestion: only a `type` of "query" is one.
    const body = JSON.stringify({ results: { hits: [{ url: "nivea soft", attributes: {} }] } });
    const { gate, fetchMock, reserve } = setup([{ url: searchUrl(NAME_QUERY, 10), status: 200, body }]);

    expect(await searchNatura(gate, NAME_QUERY, 10)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(NAME_QUERY, 10)]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(loggedLine(warn)).toEqual({ event: "natura-search", reason: "hits dropped", detail: "1 of 1 product hits" });
  });

  it("lets an odd value cost only itself: a numeric EAN, a foreign product link, a bad SKU", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [soft, yope, men] = hitsOf(nameSearch);
    soft.attributes.ean = [4005900009319, SOFT_EAN];
    yope.url = "JM00370/../koszyk";
    men.attributes.web_url = ["https://drogerienatura.pl.example.com/produkt/nivea-men"];

    const candidates = await candidatesFrom([soft, yope, men]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual(["NV89063", "NV81063"]);
    const [first, second] = candidates;
    expect(first).toMatchObject({ eans: [SOFT_EAN], productUrl: SOFT_PAGE });
    expect(second).toMatchObject({ brand: "NIVEA MEN", sizeText: "500 ml", productUrl: null, offer: MEN_OFFER });
    expect(second.imageUrl).toMatch(/^https:\/\/media\.drogerienatura\.pl\//);
  });

  it("keeps product links and images only on Natura's hosts and within their limits", async () => {
    const candidates = await candidatesFrom([
      softWith({ web_url: ["http://drogerienatura.pl/produkt/x"], image_link: "https://drogerienatura.pl/x.jpg" }),
      softWith({ web_url: [`${SOFT_PAGE}?${"x".repeat(500)}`], image_link: `${IMAGE_HOST}/${"x".repeat(500)}.jpg` }),
      // A single value where the recording has a list, and a list where it has a single value, read the same.
      softWith({ web_url: SOFT_PAGE, image_link: [`${IMAGE_HOST}/x.jpg`] }),
    ]);

    expect(candidates.map(({ productUrl, imageUrl }) => ({ productUrl, imageUrl }))).toEqual([
      { productUrl: null, imageUrl: null },
      { productUrl: null, imageUrl: null },
      { productUrl: SOFT_PAGE, imageUrl: `${IMAGE_HOST}/x.jpg` },
    ]);
  });

  it.each([
    { url: "https://drogerienatura.pl/produkt/x", product: true, image: false },
    { url: "https://www.drogerienatura.pl/produkt/x", product: true, image: false },
    { url: `${IMAGE_HOST}/catalog/x.jpg`, product: true, image: true },
    { url: "http://drogerienatura.pl/produkt/x", product: false, image: false },
    { url: "http://media.drogerienatura.pl/catalog/x.jpg", product: false, image: false },
    { url: "https://drogerienatura.pl.example.com/produkt/x", product: false, image: false },
    { url: "https://media.drogerienatura.pl.example.com/x.jpg", product: false, image: false },
    { url: "https://notdrogerienatura.pl/produkt/x", product: false, image: false },
    { url: "/produkt/x", product: false, image: false },
  ])("treats $url as a product page: $product, as an image: $image", ({ url, product, image }) => {
    expect(isNaturaProductUrl(url)).toBe(product);
    expect(isNaturaImage(url)).toBe(image);
  });

  it("cuts an over-long brand and name to their limits, and keeps the first 10 EANs", async () => {
    const eans = Array.from({ length: 12 }, (_, i) => String(5900000000000 + i));

    const [candidate] = await candidatesFrom([
      softWith({ brand: ["B".repeat(200)], title: "t".repeat(400), ean: eans }),
    ]);

    expect(candidate.brand).toHaveLength(120);
    expect(candidate.name).toHaveLength(300);
    expect(candidate.eans).toEqual(eans.slice(0, 10));
  });

  it("drops only the offer of a price that can't be stored, and an odd offer value costs only itself", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const candidates = await candidatesFrom([
      softWith({ price_amount: 100000 }),
      softWith({ price_old_amount: 16.99, lowest_price: ["brak"], availability: 0 }),
    ]);

    expect(candidates.map((candidate) => candidate.offer)).toEqual([
      null,
      { ...SOFT_OFFER, regularPrice: null, lowestPrice30d: null, available: false },
    ]);
    // Of those values, only the 30-day low can't be read; the others read, though the offer can't keep them.
    expect(loggedLine(warn)).toEqual({
      event: "natura-search",
      reason: "30-day low unread",
      detail: "1 of 2 product hits",
    });
  });

  it.each([
    { why: "is blank", title: "   " },
    { why: "is missing", title: undefined },
    { why: "isn't text", title: 42 },
  ])("drops a hit whose title $why, and keeps the others", async ({ title }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [, yope] = hitsOf(nameSearch);

    const candidates = await candidatesFrom([softWith({ title }), yope]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual(["JM00370"]);
  });
});

describe("Natura search: odd values cost only themselves, and are counted", () => {
  it.each(AVAILABILITIES)(
    "reads an availability that's $why as orderable online: $available",
    async ({ availability, available, odd }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const [candidate] = await candidatesFrom([softWith({ availability })]);

      expect(candidate.offer).toEqual({ ...SOFT_OFFER, available });
      // One that isn't a 1 or a 0 is counted, so a renamed or reformatted field shows; the line never names the item.
      expect(loggedLines(warn)).toEqual(
        odd ? [{ event: "natura-search", reason: "availability unread", detail: "1 of 1 product hits" }] : [],
      );
    },
  );

  it.each(OPTIONAL_PRICES)(
    "keeps the offer with $change, and counts only a value that's there but can't be read",
    async ({ attributes, offer, reasons }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const [candidate] = await candidatesFrom([softWith(attributes)]);

      expect(candidate.offer).toEqual(offer);
      expect(loggedLines(warn)).toEqual(
        reasons.map((reason) => ({ event: "natura-search", reason, detail: "1 of 1 product hits" })),
      );
    },
  );
});

describe("Natura search: the matching rule on its candidates (FR-006)", () => {
  /** The candidates of the recorded search for "nivea soft", served for the request the adapter makes. */
  async function niveaSoftCandidates(): Promise<ShopCandidate[]> {
    const url = searchUrl("nivea soft", 10);
    const { gate, fetchMock } = setup([{ url, status: 200, body: JSON.stringify(niveaSoftSearch) }]);
    const search = await searchNatura(gate, "nivea soft", 10);
    expect(requestedUrls(fetchMock)).toEqual([url]);
    if (search.kind !== "results") {
      throw new Error(`expected results, got ${search.kind}`);
    }
    return search.candidates;
  }

  it("accepts Natura's Nivea Soft 300 ml by the EAN it shares with the product", async () => {
    const candidates = await niveaSoftCandidates();

    expect(pickMatch({ ...SOFT_WITHOUT_EAN, eans: [SOFT_EAN] }, candidates)).toMatchObject({
      kind: "accepted",
      candidate: { shopItemId: "NV89063", eans: [SOFT_EAN] },
    });
  });

  it.each([
    { product: "Nivea Soft 300 ml (26900)", own: SOFT_WITHOUT_EAN, item: "NV89063" },
    { product: "Soft Daily UV 100 ml (2103263)", own: DAILY_UV_WITHOUT_EAN, item: "NV89059" },
  ])(
    "never accepts $item by name for $product without an EAN: its „intensywnie” is a word the product lacks",
    async ({ own, item }) => {
      const candidates = await niveaSoftCandidates();

      const pick = pickMatch(own, candidates);

      // Natura's only item in the product's size leads the choice, with nothing that warns, yet the user decides.
      if (pick.kind !== "choose") {
        throw new Error(`expected choose, got ${pick.kind}`);
      }
      const [first] = pick.options;
      expect(first).toMatchObject({
        candidate: { shopItemId: item },
        verdict: { sharesEan: false, size: "equal", brand: "agrees" },
      });
      expect(first.candidate.name).toContain("intensywnie");
    },
  );
});

describe.each(RECORDED_SEARCHES)(
  "Natura search: broken copies of $search give a gap, never 'not found'",
  ({ query, size, answer }) => {
    const url = searchUrl(query, size);
    const hits = answer.results.hits.length;

    it.each([
      ...UNREADABLE_HITS,
      // A candidate is named by its title, so a search needs it.
      { change: "no title", edit: (hit: Hit) => withAttributes(hit, { title: undefined }) },
    ])("gives up when every hit has $change, and logs how many it dropped", async ({ edit }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock, reserve, reportBlock } = setup([{ url, status: 200, body: editedAnswer(answer, edit) }]);

      expect(await searchNatura(gate, query, size)).toEqual(FAILED);
      expect(requestedUrls(fetchMock)).toEqual([url]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reportBlock).not.toHaveBeenCalled();
      expect(loggedLine(warn)).toEqual({
        event: "natura-search",
        reason: "hits dropped",
        detail: `${hits} of ${hits} product hits`,
      });
    });
  },
);

describe("Natura search: an answer without hits finds nothing only when it says so", () => {
  const url = searchUrl(MISSING_EAN, 5);
  // A next page's address, as Luigi's Box writes one: it carries the search.
  const nextPage = `https://live.luigisbox.com/search?tracker_id=703598-939363&q=${MISSING_EAN}&size=5&page=2`;

  it.each<{ change: string; edit: (answer: typeof eanMiss) => unknown; detail: string }>([
    {
      change: "a count of 15",
      edit: (answer) => ({ ...answer, results: { ...answer.results, total_hits: 15 } }),
      detail: "0 hits, total_hits 15, next_page null",
    },
    {
      change: "a next page",
      edit: (answer) => ({ ...answer, next_page: nextPage }),
      detail: "0 hits, total_hits 0, next_page set",
    },
    {
      change: "no next page field",
      edit: (answer) => ({ ...answer, next_page: undefined }),
      detail: "0 hits, total_hits 0, next_page missing",
    },
    {
      change: "no count",
      edit: (answer) => ({ ...answer, results: { ...answer.results, total_hits: undefined } }),
      detail: "0 hits, total_hits missing, next_page null",
    },
    {
      change: "its count sent as text",
      edit: (answer) => ({ ...answer, results: { ...answer.results, total_hits: "0" } }),
      detail: "0 hits, total_hits string, next_page null",
    },
  ])(
    "gives up on the recorded empty answer with $change, and logs only its count and whether there's a next page",
    async ({ edit, detail }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock, reserve, reportBlock } = setup([
        { url, status: 200, body: JSON.stringify(edit(structuredClone(eanMiss))) },
      ]);

      expect(await searchNatura(gate, MISSING_EAN, 5)).toEqual(FAILED);
      expect(requestedUrls(fetchMock)).toEqual([url]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reportBlock).not.toHaveBeenCalled();
      expect(loggedLine(warn)).toEqual({ event: "natura-search", reason: "unexpected empty answer", detail });
      // Never the next page's address, which carries the search.
      expect(String(warn.mock.calls[0][0])).not.toContain(MISSING_EAN);
    },
  );
});

describe("Natura search: why it's unavailable", () => {
  const url = searchUrl(SOFT_EAN, 5);

  it("says the tracker id may have changed when Luigi's Box doesn't know it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Luigi's Box's recorded answer to an unknown tracker id, as it would answer if it stopped knowing Natura's.
    const { gate, fetchMock, reserve, reportBlock } = setup([
      {
        url,
        status: unknownTracker.status,
        headers: { "Content-Type": unknownTracker.contentType },
        body: unknownTracker.body,
      },
    ]);

    expect(await searchNatura(gate, SOFT_EAN, 5)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock).not.toHaveBeenCalled();
    expect(loggedLine(warn)).toEqual({
      event: "natura-search",
      reason: "tracker id rejected",
      detail: "HTTP 404: NATURA_TRACKER_ID may have changed",
    });
  });

  it.each([
    { refusal: "the cap is reached", reservation: { outcome: "capped" }, expected: { reason: "busy" } },
    {
      refusal: "the shop is paused",
      reservation: { outcome: "paused", until: "2026-09-28T12:15:00.000Z" },
      expected: { reason: "paused", until: "2026-09-28T12:15:00.000Z" },
    },
    { refusal: "the shop is stopped", reservation: { outcome: "stopped" }, expected: { reason: "stopped" } },
    { refusal: "the counter can't be read", reservation: null, expected: { reason: "failed" } },
  ])("says so without calling Luigi's Box when $refusal", async ({ reservation, expected }) => {
    const { gate, fetchMock, reserve } = setup([{ url, status: 200, body: JSON.stringify(eanHit) }], reservation);

    expect(await searchNatura(gate, SOFT_EAN, 5)).toEqual({ kind: "unavailable", ...expected });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<{ refusal: string; answer: ServedAnswer; reported: unknown[][] }>([
    { refusal: "a 403", answer: { status: 403 }, reported: [["natura", "blocked", undefined, "HTTP 403"]] },
    {
      refusal: "a bot challenge, though its status is 200",
      answer: CHALLENGE,
      reported: [["natura", "blocked", undefined, "challenge"]],
    },
  ])(
    "is stopped by $refusal, without blaming the tracker id, and the block is reported",
    async ({ answer, reported }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock, reserve, reportBlock } = setup([{ url, ...answer }]);

      expect(await searchNatura(gate, SOFT_EAN, 5)).toEqual({ kind: "unavailable", reason: "stopped" });
      expect(requestedUrls(fetchMock)).toEqual([url]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reportBlock.mock.calls).toEqual(reported);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each([
    { refusal: "a 429", status: 429 },
    { refusal: "a 503 that says when to come back", status: 503 },
  ])("is paused by $refusal until its Retry-After has passed", async ({ status }) => {
    const { gate, fetchMock, reserve, reportBlock } = setup([{ url, status, headers: { "Retry-After": "120" } }]);

    const secondsAhead = pauseSecondsOf(await searchNatura(gate, SOFT_EAN, 5));

    expect(secondsAhead).toBeGreaterThan(115);
    expect(secondsAhead).toBeLessThanOrEqual(120);
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock.mock.calls).toEqual([["natura", "rate_limited", 120]]);
  });

  it.each<{ answer: string; entry: ReplayEntry; timeoutMs?: number; outcome: GateOutcome }>([
    { answer: "a 500", entry: { url, status: 500 }, outcome: { kind: "failed", reason: "http", status: 500 } },
    { answer: "a network error", entry: { url, error: "network" }, outcome: { kind: "failed", reason: "network" } },
    {
      answer: "no answer in time",
      entry: { url, error: "timeout" },
      timeoutMs: 20,
      outcome: { kind: "failed", reason: "timeout" },
    },
  ])(
    "reports $answer as failed, never as nothing found, without blaming the tracker id, and stops nothing",
    async ({ entry, timeoutMs, outcome }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock, reserve, reportBlock, gateLog } = setup([entry], undefined, timeoutMs);

      expect(await searchNatura(gate, SOFT_EAN, 5)).toEqual(FAILED);
      expect(requestedUrls(fetchMock)).toEqual([url]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reportBlock).not.toHaveBeenCalled();
      // Only the gate logs it, saying why.
      expect(gateOutcomes(gateLog)).toStrictEqual([outcome]);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each<{ answer: string; headers?: Record<string, string>; body: string; reason: string }>([
    { answer: "text that echoes the search", body: NAME_QUERY, reason: "unreadable body" },
    { answer: "an HTML page", headers: { "Content-Type": "text/html" }, body: HTML_PAGE, reason: "unreadable body" },
    { answer: "an empty body", body: "", reason: "unreadable body" },
    { answer: "JSON of another shape", body: JSON.stringify({ hits: [] }), reason: "unexpected response shape" },
    {
      answer: "the recorded answer without its hits",
      body: JSON.stringify({ ...nameSearch, results: { ...nameSearch.results, hits: undefined } }),
      reason: "unexpected response shape",
    },
  ])("gives up on $answer, and logs it without the search text", async ({ headers, body, reason }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve } = setup([{ url: searchUrl(NAME_QUERY, 10), status: 200, headers, body }]);

    expect(await searchNatura(gate, NAME_QUERY, 10)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(NAME_QUERY, 10)]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(loggedLine(warn)).toMatchObject({ event: "natura-search", reason });
    expect(String(warn.mock.calls[0][0]).toLowerCase()).not.toContain("nivea");
  });
});

/** The price answer the given hits make, as JSON: whole, as every recorded one is, with no next page. */
function priceBody(hits: unknown[]): string {
  return JSON.stringify({ results: { hits, total_hits: hits.length }, next_page: null });
}

describe("Natura prices: recorded answers", () => {
  it("fetches one SKU's offer", async () => {
    const { gate, fetchMock } = setup([{ url: priceUrl(["NV89063"]), status: 200, body: JSON.stringify(oneSku) }]);

    const checks = await fetchNaturaPrices(gate, ["NV89063"]);

    expect(requestedUrls(fetchMock)).toEqual([priceUrl(["NV89063"])]);
    expect(checks).toEqual(new Map([["NV89063", { kind: "price", offer: SOFT_OFFER }]]));
  });

  it("fetches two SKUs' offers with one request, one repeated f[] per SKU", async () => {
    const url = priceUrl(["NV89063", "NV81063"]);
    const { gate, fetchMock } = setup([{ url, status: 200, body: JSON.stringify(twoSkus) }]);

    const checks = await fetchNaturaPrices(gate, ["NV89063", "NV81063"]);

    expect(requestedUrls(fetchMock)).toEqual([url]);
    const [requested] = requestedUrls(fetchMock);
    expect(new URL(requested).searchParams.getAll("f[]")).toEqual(["type:product", "sku:NV89063", "sku:NV81063"]);
    expect(checks).toEqual(
      new Map([
        ["NV89063", { kind: "price", offer: SOFT_OFFER }],
        ["NV81063", { kind: "price", offer: MEN_OFFER }],
      ]),
    );
  });

  it("reports a SKU Natura doesn't have as missing", async () => {
    const url = priceUrl(["ZZ00000000"]);
    const { gate, fetchMock } = setup([{ url, status: 200, body: JSON.stringify(skuUnknown) }]);

    expect(await fetchNaturaPrices(gate, ["ZZ00000000"])).toEqual(new Map([["ZZ00000000", { kind: "missing" }]]));
    expect(requestedUrls(fetchMock)).toEqual([url]);
  });

  it("asks once for a SKU given twice", async () => {
    const { gate, fetchMock } = setup([{ url: priceUrl(["NV89063"]), status: 200, body: JSON.stringify(oneSku) }]);

    const checks = await fetchNaturaPrices(gate, ["NV89063", "NV89063"]);

    expect(requestedUrls(fetchMock)).toEqual([priceUrl(["NV89063"])]);
    expect(checks).toEqual(new Map([["NV89063", { kind: "price", offer: SOFT_OFFER }]]));
  });

  it("splits more than 50 SKUs into requests of at most 50, one after the other", async () => {
    // Nivea Soft first, then 50 SKUs Natura doesn't have.
    const absent = Array.from({ length: 50 }, (_, i) => `ZZ${String(i).padStart(8, "0")}`);
    const skus = ["NV89063", ...absent];
    const first = priceUrl(skus.slice(0, 50));
    const second = priceUrl(skus.slice(50));
    const { gate, fetchMock } = setup([
      { url: first, status: 200, body: JSON.stringify(oneSku) },
      { url: second, status: 200, body: JSON.stringify(skuUnknown) },
    ]);

    const checks = await fetchNaturaPrices(gate, skus);

    expect(requestedUrls(fetchMock)).toEqual([first, second]);
    const filtersPerRequest = requestedUrls(fetchMock).map((url) => new URL(url).searchParams.getAll("f[]").length);
    expect(filtersPerRequest).toEqual([51, 2]);
    expect(checks.size).toBe(51);
    expect(checks.get("NV89063")).toEqual({ kind: "price", offer: SOFT_OFFER });
    for (const sku of absent) {
      expect(checks.get(sku), sku).toEqual({ kind: "missing" });
    }
  });

  it("gives each price request its own 4 s limit", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn<ShopGate["fetch"]>(() => Promise.resolve({ kind: "failed", reason: "network" }));

    await fetchNaturaPrices({ fetch }, ["NV89063"]);

    expect(timeout).toHaveBeenCalledWith(4000);
    const [created] = timeout.mock.results;
    if (created.type !== "return") {
      throw new Error("AbortSignal.timeout didn't return a signal");
    }
    const [, , init] = fetch.mock.calls[0];
    expect(init?.signal).toBe(created.value);
  });
});

describe("Natura prices: what they keep out", () => {
  it("never sends a SKU that can't go into a filter, and says it's unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invalid = ["..", "NV 89063", "sku:NV81063", "NV89063&size=200", "N".repeat(41)];
    const { gate, fetchMock } = setup([{ url: priceUrl(["NV89063"]), status: 200, body: JSON.stringify(oneSku) }]);

    const checks = await fetchNaturaPrices(gate, [invalid[0], "NV89063", ...invalid.slice(1)]);

    expect(requestedUrls(fetchMock)).toEqual([priceUrl(["NV89063"])]);
    expect(checks.get("NV89063")).toEqual({ kind: "price", offer: SOFT_OFFER });
    for (const sku of invalid) {
      expect(checks.get(sku), sku).toEqual(FAILED);
    }
    // How many, never which.
    expect(loggedLine(warn)).toEqual({
      event: "natura-prices",
      reason: "invalid SKUs",
      detail: "5 of 6 SKUs not sent",
    });
  });

  it("sends nothing when no SKU can go into a filter", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([]);

    expect(await fetchNaturaPrices(gate, ["..", "-"])).toEqual(
      new Map([
        ["..", FAILED],
        ["-", FAILED],
      ]),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing for no SKUs", async () => {
    const { gate, fetchMock } = setup([]);

    expect(await fetchNaturaPrices(gate, [])).toEqual(new Map<string, PriceCheck>());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the other SKU's price when one hit can't be read, and the unread one is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [soft, men] = hitsOf(twoSkus);
    men.attributes.price_amount = "17.99";
    const url = priceUrl(["NV89063", "NV81063"]);
    const { gate } = setup([{ url, status: 200, body: priceBody([soft, men]) }]);

    expect(await fetchNaturaPrices(gate, ["NV89063", "NV81063"])).toEqual(
      new Map<string, PriceCheck>([
        ["NV89063", { kind: "price", offer: SOFT_OFFER }],
        ["NV81063", FAILED],
      ]),
    );
    expect(loggedLine(warn)).toEqual({ event: "natura-prices", reason: "hits dropped", detail: "1 of 2 product hits" });
  });

  it("stores no SKU as missing when Natura answers with an item it wasn't asked for", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Nivea Soft's recorded hit in answer to another SKU, as if the SKU filter had been ignored.
    const url = priceUrl(["ZZ00000000"]);
    const { gate } = setup([{ url, status: 200, body: JSON.stringify(oneSku) }]);

    expect(await fetchNaturaPrices(gate, ["ZZ00000000"])).toEqual(new Map([["ZZ00000000", FAILED]]));
    expect(loggedLine(warn)).toEqual({
      event: "natura-prices",
      reason: "hits not asked for",
      detail: "1 of 1 product hits",
    });
  });

  it.each<{ change: string; edit: (answer: typeof twoSkus) => unknown }>([
    {
      change: "a next page",
      edit: (answer) => ({ ...answer, next_page: "https://live.luigisbox.com/search?tracker_id=703598-939363&page=2" }),
    },
    {
      change: "more hits matched than it holds",
      edit: (answer) => ({ ...answer, results: { ...answer.results, total_hits: 3 } }),
    },
    {
      change: "no count of the hits matched",
      edit: (answer) => ({ ...answer, results: { ...answer.results, total_hits: undefined } }),
    },
    // Not a whole number, so no count of hits, though it's no more than the hits the answer holds.
    {
      change: "a count that isn't whole",
      edit: (answer) => ({ ...answer, results: { ...answer.results, total_hits: 1.5 } }),
    },
  ])("calls a SKU without a hit unavailable, never missing, when the answer has $change", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The recorded answer for Nivea Soft and Nivea MEN, edited, as if it had left out a third SKU's hit.
    const skus = ["NV89063", "NV81063", "ZZ00000000"];
    const url = priceUrl(skus);
    const { gate } = setup([{ url, status: 200, body: JSON.stringify(edit(structuredClone(twoSkus))) }]);

    expect(await fetchNaturaPrices(gate, skus)).toEqual(
      new Map<string, PriceCheck>([
        ["NV89063", { kind: "price", offer: SOFT_OFFER }],
        ["NV81063", { kind: "price", offer: MEN_OFFER }],
        ["ZZ00000000", FAILED],
      ]),
    );
    expect(loggedLine(warn)).toEqual({
      event: "natura-prices",
      reason: "answer incomplete",
      detail: "2 product hits for 3 SKUs",
    });
  });

  it("calls a SKU unavailable, never missing, when an answer without hits counts -1 of them", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // natura-sku-unknown.json, the recorded answer for a SKU Natura doesn't have, with a count below 0, which no count
    // of hits can be: it can't say the answer holds every hit it matched.
    const url = priceUrl(["ZZ00000000"]);
    const body = JSON.stringify({ ...skuUnknown, results: { ...skuUnknown.results, total_hits: -1 } });
    const { gate, fetchMock, reserve, reportBlock } = setup([{ url, status: 200, body }]);

    expect(await fetchNaturaPrices(gate, ["ZZ00000000"])).toEqual(new Map([["ZZ00000000", FAILED]]));
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock).not.toHaveBeenCalled();
    expect(loggedLine(warn)).toEqual({
      event: "natura-prices",
      reason: "answer incomplete",
      detail: "0 product hits for 1 SKUs",
    });
  });
});

describe("Natura prices: odd values cost only themselves, and are counted", () => {
  const url = priceUrl(["NV89063"]);

  it.each(AVAILABILITIES)(
    "reads an availability that's $why as orderable online: $available",
    async ({ availability, available, odd }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const [soft] = hitsOf(oneSku);
      const { gate } = setup([{ url, status: 200, body: priceBody([withAttributes(soft, { availability })]) }]);

      expect(await fetchNaturaPrices(gate, ["NV89063"])).toEqual(
        new Map([["NV89063", { kind: "price", offer: { ...SOFT_OFFER, available } }]]),
      );
      // One that isn't a 1 or a 0 is counted, so a renamed or reformatted field shows; the line never names the item.
      expect(loggedLines(warn)).toEqual(
        odd ? [{ event: "natura-prices", reason: "availability unread", detail: "1 of 1 product hits" }] : [],
      );
    },
  );

  it.each(OPTIONAL_PRICES)(
    "keeps the offer with $change, and counts only a value that's there but can't be read",
    async ({ attributes, offer, reasons }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const [soft] = hitsOf(oneSku);
      const { gate } = setup([{ url, status: 200, body: priceBody([withAttributes(soft, attributes)]) }]);

      expect(await fetchNaturaPrices(gate, ["NV89063"])).toEqual(new Map([["NV89063", { kind: "price", offer }]]));
      expect(loggedLines(warn)).toEqual(
        reasons.map((reason) => ({ event: "natura-prices", reason, detail: "1 of 1 product hits" })),
      );
    },
  );
});

describe("Natura prices: broken copies give a gap, never 'missing'", () => {
  // The recording's own request, for Nivea Soft and Nivea MEN.
  const skus = ["NV89063", "NV81063"];
  const url = priceUrl(skus);

  it.each([
    ...UNREADABLE_HITS,
    { change: "prices the table can't hold", edit: (hit: Hit) => withAttributes(hit, { price_amount: 100000 }) },
  ])("calls every SKU unavailable, never missing, when every hit has $change, and logs how many", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve, reportBlock } = setup([{ url, status: 200, body: editedAnswer(twoSkus, edit) }]);

    expect(await fetchNaturaPrices(gate, skus)).toEqual(
      new Map([
        ["NV89063", FAILED],
        ["NV81063", FAILED],
      ]),
    );
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock).not.toHaveBeenCalled();
    expect(loggedLine(warn)).toEqual({ event: "natura-prices", reason: "hits dropped", detail: "2 of 2 product hits" });
  });

  it("still reads every price when the hits lost their titles, which no offer reads", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = editedAnswer(twoSkus, (hit) => withAttributes(hit, { title: undefined }));
    const { gate, fetchMock } = setup([{ url, status: 200, body }]);

    expect(await fetchNaturaPrices(gate, skus)).toEqual(
      new Map([
        ["NV89063", { kind: "price", offer: SOFT_OFFER }],
        ["NV81063", { kind: "price", offer: MEN_OFFER }],
      ]),
    );
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<{ answer: string; headers?: Record<string, string>; body: string; reason: string }>([
    { answer: "text", body: "Przerwa techniczna", reason: "unreadable body" },
    { answer: "an HTML page", headers: { "Content-Type": "text/html" }, body: HTML_PAGE, reason: "unreadable body" },
    { answer: "an empty body", body: "", reason: "unreadable body" },
    { answer: "JSON of another shape", body: JSON.stringify({ hits: [] }), reason: "unexpected response shape" },
    {
      answer: "the recorded answer without its hits",
      body: JSON.stringify({ ...twoSkus, results: { ...twoSkus.results, hits: undefined } }),
      reason: "unexpected response shape",
    },
  ])(
    "gives up on $answer for every SKU, never missing, and logs it without the SKUs",
    async ({ headers, body, reason }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock, reserve } = setup([{ url, status: 200, headers, body }]);

      expect(await fetchNaturaPrices(gate, skus)).toEqual(
        new Map([
          ["NV89063", FAILED],
          ["NV81063", FAILED],
        ]),
      );
      expect(requestedUrls(fetchMock)).toEqual([url]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(loggedLine(warn)).toMatchObject({ event: "natura-prices", reason });
      expect(String(warn.mock.calls[0][0])).not.toContain("NV89063");
    },
  );
});

describe("Natura prices: why they're unavailable", () => {
  const skus = ["NV89063", "NV81063"];
  const url = priceUrl(skus);

  it.each([
    { refusal: "the cap is reached", reservation: { outcome: "capped" }, expected: { reason: "busy" } },
    { refusal: "the shop is stopped", reservation: { outcome: "stopped" }, expected: { reason: "stopped" } },
    { refusal: "the counter can't be read", reservation: null, expected: { reason: "failed" } },
  ])("says so for every SKU without calling Luigi's Box when $refusal", async ({ reservation, expected }) => {
    const { gate, fetchMock, reserve } = setup([{ url, status: 200, body: JSON.stringify(twoSkus) }], reservation);

    expect(await fetchNaturaPrices(gate, skus)).toEqual(
      new Map([
        ["NV89063", { kind: "unavailable", ...expected }],
        ["NV81063", { kind: "unavailable", ...expected }],
      ]),
    );
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Nivea Soft first, then 50 SKUs Natura doesn't have: two requests' worth.
  const manySkus = ["NV89063", ...Array.from({ length: 50 }, (_, i) => `ZZ${String(i).padStart(8, "0")}`)];
  const firstBatch = priceUrl(manySkus.slice(0, 50));
  const secondBatch = priceUrl(manySkus.slice(50));

  it.each<{
    refusal: string;
    entries: ReplayEntry[];
    reservation: unknown;
    requested: string[];
    reported: unknown[][];
    expected: PriceCheck;
  }>([
    {
      refusal: "busy under the cap",
      entries: [],
      reservation: { outcome: "capped" },
      requested: [],
      reported: [],
      expected: { kind: "unavailable", reason: "busy" },
    },
    {
      refusal: "paused",
      entries: [],
      reservation: { outcome: "paused", until: "2026-09-28T12:15:00.000Z" },
      requested: [],
      reported: [],
      expected: { kind: "unavailable", reason: "paused", until: "2026-09-28T12:15:00.000Z" },
    },
    {
      refusal: "stopped",
      entries: [],
      reservation: { outcome: "stopped" },
      requested: [],
      reported: [],
      expected: { kind: "unavailable", reason: "stopped" },
    },
    {
      refusal: "stopped by a 403",
      entries: [{ url: firstBatch, status: 403 }],
      reservation: { outcome: "allowed" },
      requested: [firstBatch],
      reported: [["natura", "blocked", undefined, "HTTP 403"]],
      expected: { kind: "unavailable", reason: "stopped" },
    },
    {
      refusal: "stopped by a bot challenge",
      entries: [{ url: firstBatch, ...CHALLENGE }],
      reservation: { outcome: "allowed" },
      requested: [firstBatch],
      reported: [["natura", "blocked", undefined, "challenge"]],
      expected: { kind: "unavailable", reason: "stopped" },
    },
  ])(
    "stops once Natura is $refusal: the next request's SKUs get the same answer, unasked and unreserved",
    async ({ entries, reservation, requested, reported, expected }) => {
      const { gate, fetchMock, reserve, reportBlock } = setup(entries, reservation);

      const checks = await fetchNaturaPrices(gate, manySkus);

      expect(reserve).toHaveBeenCalledTimes(1);
      expect(requestedUrls(fetchMock)).toEqual(requested);
      expect(reportBlock.mock.calls).toEqual(reported);
      expect(checks.size).toBe(51);
      for (const sku of manySkus) {
        expect(checks.get(sku), sku).toEqual(expected);
      }
    },
  );

  it.each([
    { refusal: "a 429", status: 429 },
    { refusal: "a 503 that says when to come back", status: 503 },
  ])(
    "is paused by $refusal until its Retry-After has passed: the next request's SKUs too, unasked and unreserved",
    async ({ status }) => {
      const { gate, fetchMock, reserve, reportBlock } = setup([
        { url: firstBatch, status, headers: { "Retry-After": "120" } },
      ]);

      const checks = await fetchNaturaPrices(gate, manySkus);

      expect(requestedUrls(fetchMock)).toEqual([firstBatch]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reportBlock.mock.calls).toEqual([["natura", "rate_limited", 120]]);
      const pause = checks.get("NV89063");
      const secondsAhead = pauseSecondsOf(pause);
      expect(secondsAhead).toBeGreaterThan(115);
      expect(secondsAhead).toBeLessThanOrEqual(120);
      expect(checks.size).toBe(51);
      for (const sku of manySkus) {
        expect(checks.get(sku), sku).toEqual(pause);
      }
    },
  );

  it("goes on to the next request after one that failed", async () => {
    const { gate, fetchMock } = setup([
      { url: firstBatch, status: 500 },
      { url: secondBatch, status: 200, body: JSON.stringify(skuUnknown) },
    ]);

    const checks = await fetchNaturaPrices(gate, manySkus);

    expect(requestedUrls(fetchMock)).toEqual([firstBatch, secondBatch]);
    for (const sku of manySkus.slice(0, 50)) {
      expect(checks.get(sku), sku).toEqual(FAILED);
    }
    expect(checks.get(manySkus[50])).toEqual({ kind: "missing" });
  });

  it.each<{ answer: string; entry: ReplayEntry; timeoutMs?: number; outcome: GateOutcome }>([
    { answer: "a 500", entry: { url, status: 500 }, outcome: { kind: "failed", reason: "http", status: 500 } },
    { answer: "a network error", entry: { url, error: "network" }, outcome: { kind: "failed", reason: "network" } },
    {
      answer: "no answer in time",
      entry: { url, error: "timeout" },
      timeoutMs: 20,
      outcome: { kind: "failed", reason: "timeout" },
    },
  ])("reports $answer as failed for every SKU of the request, never missing", async ({ entry, timeoutMs, outcome }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve, reportBlock, gateLog } = setup([entry], undefined, timeoutMs);

    expect(await fetchNaturaPrices(gate, skus)).toEqual(
      new Map([
        ["NV89063", FAILED],
        ["NV81063", FAILED],
      ]),
    );
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock).not.toHaveBeenCalled();
    // Only the gate logs it, saying why.
    expect(gateOutcomes(gateLog)).toStrictEqual([outcome]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("says the tracker id may have changed when Luigi's Box doesn't know it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve, reportBlock } = setup([
      {
        url: priceUrl(["NV89063"]),
        status: unknownTracker.status,
        headers: { "Content-Type": unknownTracker.contentType },
        body: unknownTracker.body,
      },
    ]);

    expect(await fetchNaturaPrices(gate, ["NV89063"])).toEqual(new Map([["NV89063", FAILED]]));
    expect(requestedUrls(fetchMock)).toEqual([priceUrl(["NV89063"])]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock).not.toHaveBeenCalled();
    expect(loggedLine(warn)).toEqual({
      event: "natura-prices",
      reason: "tracker id rejected",
      detail: "HTTP 404: NATURA_TRACKER_ID may have changed",
    });
  });
});
