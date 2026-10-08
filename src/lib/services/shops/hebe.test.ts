import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { pickMatch, type NamedProduct } from "@/lib/services/matching";
import { createShopGate, type ShopGateDeps, type ShopGateLogEntry } from "@/lib/services/shop-gate";
import { fetchHebePrices, isHebeImage, isHebeProductUrl, searchHebe } from "@/lib/services/shops/hebe";
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
import eanOffline from "@/lib/services/shops/fixtures/hebe-ean-offline.json";
import eanOnline from "@/lib/services/shops/fixtures/hebe-ean-online.json";
import idUnknown from "@/lib/services/shops/fixtures/hebe-id-unknown.json";
import twoIds from "@/lib/services/shops/fixtures/hebe-ids.json";
import nameSearch from "@/lib/services/shops/fixtures/hebe-name-search.json";
import aaLaabSearch from "@/lib/services/shops/fixtures/hebe-search-aa-laab.json";
import unknownTracker from "@/lib/services/shops/fixtures/natura-unknown-tracker.json";

// The fixtures are real Luigi's Box answers for Hebe, recorded once with curl from the developer machine, with the
// gate's User-Agent, at least 2 s apart and following no redirect; no test reaches the live search.
// - hebe-ean-offline.json (2026-10-02): the EAN search for 4005900009319, size 5. Its one hit, Nivea Soft 300 ml, is an
//   item Hebe lists but doesn't sell online (`searchable: [false]`), and its `Pojemność` says 0.237.
// - hebe-ean-online.json (2026-10-04): the EAN search for 4005900008299, size 5. Its one hit, Nivea Soft 200 ml, is
//   sold online.
// - hebe-name-search.json (2026-10-02): the search for "nivea soft", size 10, cut to its first 5 hits: 4 items and a
//   query suggestion.
// - hebe-ids.json (2026-10-02): the price request for 218807 and 251798, sent with a longer hit_fields list than the
//   adapter's, so its hit carries a few attributes more. Only 218807 came back: without a query the tracker adds
//   `searchable:true`, and 251798 isn't sold online.
// - hebe-id-unknown.json (2026-10-02): the price request for an id Hebe doesn't have, with no hits.
// - hebe-search-aa-laab.json (2026-10-06, 10:37:56 UTC, with `Accept: application/json` too): the search for "AA LAAB
//   100% Centella B12 Żel do mycia twarzy nawilżający", size 10, kept whole: 10 of AA LAAB's items, its face wash in
//   150 ml (450251) first, with the EAN Rossmann lists for its own (419343).
// natura-unknown-tracker.json is Luigi's Box's answer to a tracker id it doesn't know, which names no shop. The broken
// answers below each change one thing in a copy of these, or stand in a page where the JSON was.
const searchUrl = (query: string, size: number) =>
  `https://live.luigisbox.com/search?tracker_id=421168-505233&q=${encodeURIComponent(query)}&size=${size}`;
// A price request, spelled out as the adapter sends it: items only, one repeated f[] per id, as many hits as ids, and
// only the price attributes.
const priceUrl = (ids: string[]) =>
  "https://live.luigisbox.com/search?tracker_id=421168-505233&f%5B%5D=type%3Aitem" +
  ids.map((id) => `&f%5B%5D=ID%3A${id}`).join("") +
  `&size=${ids.length}&hit_fields=price_amount%2Cprice_sale_amount%2Cprice_omnibus_amount%2Conline_flag`;
// Nivea Soft 200 ml, sold online, and the 300 ml one, which Hebe lists but doesn't sell online.
const SOFT_200 = "000000000000218807";
const SOFT_300 = "000000000000251798";
const SOFT_200_EAN = "4005900008299";
const SOFT_300_EAN = "4005900009319";
// An id Hebe doesn't have, as hebe-id-unknown.json recorded.
const UNKNOWN_ID = "000000000000999999";
const NAME_QUERY = "nivea soft";
const SOFT_200_PAGE =
  "https://www.hebe.pl/nivea-intensywnie-nawilzajacy-krem-do-twarzy-i-ciala-200-ml-000000000000218807.html";
// Nivea Soft 200 ml's offer in every recording of it: no sale, and a 30-day low below its price.
const SOFT_200_OFFER: ShopOffer = {
  price: 15.99,
  regularPrice: null,
  lowestPrice30d: 10.89,
  promoEndsOn: null,
  available: true,
};
const FAILED: PriceCheck = { kind: "unavailable", reason: "failed" };
// A page where Luigi's Box's JSON should be, as a proxy or a maintenance page would send it.
const HTML_PAGE =
  '<!DOCTYPE html><html lang="pl"><head><title>Hebe</title></head><body>Przerwa techniczna</body></html>';
// Hebe's 30-day low as a changed format could send it, with the one the offer keeps. One that's there but can't be
// read costs only itself and is counted; one left out or none is normal, and one that reads but can't be stored is
// dropped as any other would be, so neither is counted.
const OMNIBUS: { change: string; omnibus: unknown; lowestPrice30d: number | null; unread: boolean }[] = [
  { change: "a number, as recorded", omnibus: 10.89, lowestPrice30d: 10.89, unread: false },
  { change: "decimal text", omnibus: "10.89", lowestPrice30d: 10.89, unread: false },
  { change: "text with a decimal comma", omnibus: "10,89", lowestPrice30d: null, unread: true },
  { change: "text that isn't a number", omnibus: "brak", lowestPrice30d: null, unread: true },
  { change: "left out", omnibus: undefined, lowestPrice30d: null, unread: false },
  { change: "null", omnibus: null, lowestPrice30d: null, unread: false },
  { change: "zero, which reads but can't be stored", omnibus: 0, lowestPrice30d: null, unread: false },
];
// Nivea Soft 200 ml first, then 50 ids Hebe doesn't have: two requests' worth.
const manyIds = [SOFT_200, ...Array.from({ length: 50 }, (_, i) => `99${String(i).padStart(16, "0")}`)];
const firstBatch = priceUrl(manyIds.slice(0, 50));
const secondBatch = priceUrl(manyIds.slice(50));

// Watched products as the matching rule reads them. Rossmann's two are rossmann-search-results.json's recordings:
// Nivea Soft 300 ml (26900) and the Soft Rose lip balm, 4,8 g (11790), whose first EAN Hebe's 5,5 ml lip balm carries
// too. Rossmann sent the lip balm's name empty, so its name is the fallback name, as Rossmann's adapter reads it.
const ROSSMANN_SOFT: NamedProduct = {
  brand: "NIVEA",
  name: "Soft",
  caption: "krem uniwersalny, nawilżający",
  eans: [SOFT_300_EAN, "4005808890637", "5900017001234"],
  size: { value: 300, unit: "ml" },
};
const ROSSMANN_SOFT_ROSE: NamedProduct = {
  brand: "NIVEA",
  name: "Balsam do ust",
  caption: "balsam do ust, Soft Rose",
  eans: ["9005800362939", "4005808369713", "4005808314935", "4005808850662"],
  size: { value: 4.8, unit: "g" },
};
// Nivea Soft 200 ml, the product whose EAN hebe-ean-online.json searched for, with its brand and name written as
// Rossmann writes Soft's, and no caption.
const SOFT_200_PRODUCT: NamedProduct = {
  brand: "NIVEA",
  name: "Soft",
  caption: null,
  eans: [SOFT_200_EAN],
  size: { value: 200, unit: "ml" },
};
// AA LAAB's face wash, 150 ml (419343), as Rossmann's search for it recorded it on 2026-10-06
// (rossmann-search-aa-laab.json), with its EAN hidden, as a product without an EAN would come: only the name check may
// then accept a Hebe item for it.
const AA_LAAB_WITHOUT_EAN: NamedProduct = {
  brand: "AA",
  name: "LAAB Skin Barrier Protection",
  caption: "żel do mycia twarzy nawilżający, 100% Centella B12",
  eans: [],
  size: { value: 150, unit: "ml" },
};
const AA_LAAB_QUERY = "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający";

/**
 * A real gate that gives every reservation the same answer, allowed by default, over a fetch that answers only the
 * given recordings. `reserve` shows which shop each slot was asked for, `reportBlock` each refusal reported, and
 * `gateLog` the gate's own log lines. `timeoutMs` shortens the gate's limit, so a request that never answers fails at
 * once.
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

/** The recorded Nivea Soft 200 ml hit of the EAN search, with some of its attributes replaced. */
function soft200With(attributes: Record<string, unknown>): Hit {
  const [soft] = hitsOf(eanOnline);
  return withAttributes(soft, attributes);
}

/** The recorded Nivea Soft 300 ml hit, as if Hebe sold it online: only `searchable` changed. */
function soft300Online(): Hit {
  const [soft] = hitsOf(eanOffline);
  return withAttributes(soft, { searchable: [true] });
}

/** The recorded name search's items, without its query suggestion. */
function nameItems(): Hit[] {
  return hitsOf(nameSearch).filter((hit) => hit.type === "item");
}

/** The search answer the given hits make, as JSON. */
function searchBody(hits: unknown[]): string {
  return JSON.stringify({ results: { hits } });
}

/** The price answer the given hits make, as JSON: whole, as every recorded one is, with no next page. */
function priceBody(hits: unknown[]): string {
  return JSON.stringify({ results: { hits, total_hits: hits.length }, next_page: null });
}

/** Searches by name against a body built from the given hits, and returns the candidates. */
async function candidatesFrom(hits: unknown[]): Promise<ShopCandidate[]> {
  const { gate } = setup([{ url: searchUrl(NAME_QUERY, 10), status: 200, body: searchBody(hits) }]);
  const search = await searchHebe(gate, NAME_QUERY, 10);
  if (search.kind !== "results") {
    throw new Error(`expected results, got ${search.kind}`);
  }
  return search.candidates;
}

/** The candidates of a recorded search answer, served for the request the adapter makes. */
async function recordedCandidates(query: string, size: number, fixture: object): Promise<ShopCandidate[]> {
  const { gate, fetchMock } = setup([{ url: searchUrl(query, size), status: 200, body: JSON.stringify(fixture) }]);
  const search = await searchHebe(gate, query, size);
  expect(requestedUrls(fetchMock)).toEqual([searchUrl(query, size)]);
  if (search.kind !== "results") {
    throw new Error(`expected results, got ${search.kind}`);
  }
  return search.candidates;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Hebe search: recorded answers", () => {
  it("maps the EAN search's item to a candidate", async () => {
    const candidates = await recordedCandidates(SOFT_200_EAN, 5, eanOnline);

    expect(candidates).toEqual([
      {
        shop: "hebe",
        shopItemId: SOFT_200,
        brand: "Nivea",
        name: "Nivea Soft Lekki Krem Nawilżający, 200 ml",
        sizeText: "200 ml",
        size: { value: 200, unit: "ml" },
        eans: [SOFT_200_EAN],
        productUrl: SOFT_200_PAGE,
        imageUrl:
          "https://www.hebe.pl/dw/image/v2/BDDS_PRD/on/demandware.static/-/Sites-PL_Master_Catalog/default/dw5c0c6593/" +
          "images/hi-res/218807__Nivea_Soft_Lekki_Krem_Nawilzajacy_200_ml__BB__1__p.png",
        offer: SOFT_200_OFFER,
      },
    ]);
  });

  it("finds nothing, and logs nothing, when the EAN's only item isn't sold online", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await recordedCandidates(SOFT_300_EAN, 5, eanOffline)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("maps the name search's items in Hebe's order, each with its size, EANs and whole offer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const candidates = await recordedCandidates(NAME_QUERY, 10, nameSearch);

    // The query suggestion among them is no candidate, and no hit that can't be read either.
    expect(warn).not.toHaveBeenCalled();
    expect(
      candidates.map(({ shopItemId, sizeText, size, eans, offer }) => ({ shopItemId, sizeText, size, eans, offer })),
    ).toEqual([
      {
        shopItemId: SOFT_200,
        sizeText: "200 ml",
        size: { value: 200, unit: "ml" },
        eans: [SOFT_200_EAN],
        offer: SOFT_200_OFFER,
      },
      {
        shopItemId: "000000000000255134",
        sizeText: "750 ml",
        size: { value: 750, unit: "ml" },
        eans: ["9005800218540"],
        offer: { price: 18.89, regularPrice: 27.49, lowestPrice30d: 18.99, promoEndsOn: null, available: true },
      },
      {
        shopItemId: "000000000000742817",
        sizeText: "5,5 ml",
        size: { value: 5.5, unit: "ml" },
        eans: ["9005800362939"],
        offer: { price: 9.99, regularPrice: 13.99, lowestPrice30d: 10.09, promoEndsOn: null, available: true },
      },
      {
        shopItemId: "000000000000218607",
        sizeText: "100 g",
        size: { value: 100, unit: "g" },
        eans: ["4005808135318"],
        offer: { price: 5.19, regularPrice: 5.79, lowestPrice30d: 5.29, promoEndsOn: null, available: true },
      },
    ]);
  });

  it("reads the 300 ml item's size from its legal name, never 237 ml from Pojemność", async () => {
    const [candidate] = await candidatesFrom([soft300Online()]);

    expect(candidate).toMatchObject({
      shopItemId: SOFT_300,
      name: "NIVEA Soft Krem intensywnie nawilżający 300 ml",
      sizeText: "300 ml",
      size: { value: 300, unit: "ml" },
      eans: [SOFT_300_EAN],
      // `online_flag: [false]`, though its `availability` is 1.
      offer: { price: 24.99, regularPrice: null, lowestPrice30d: null, promoEndsOn: null, available: false },
    });
  });

  it("writes every recorded size as text that parses back to the same size", async () => {
    const candidates = await candidatesFrom([...nameItems(), ...hitsOf(eanOnline), soft300Online()]);

    expect(candidates).toHaveLength(6);
    for (const candidate of candidates) {
      expect(candidate.sizeText, candidate.shopItemId).not.toBeNull();
      expect(parseSize(candidate.sizeText), candidate.shopItemId).toEqual(candidate.size);
    }
  });
});

describe("Hebe search: sizes and names", () => {
  // Hebe's 100 g soap: its `Pojemność` says 0.100, which as litres would read 100 ml.
  const soap = () => nameItems()[3];

  it.each([
    {
      where: "the short description's, when the legal name ends without one",
      attributes: { "Nazwa wymagana przez prawo": ["Nivea Pielęgnujące Mydło W Kostce Creme Soft"] },
      expected: {
        name: "Nivea Pielęgnujące Mydło W Kostce Creme Soft",
        sizeText: "100 g",
        size: { value: 100, unit: "g" },
      },
    },
    {
      where: "the short description's, with the title as the name, when there is no legal name",
      attributes: { "Nazwa wymagana przez prawo": undefined },
      expected: { name: "Nivea Creme Soft", sizeText: "100 g", size: { value: 100, unit: "g" } },
    },
    {
      where: "none, though Pojemność has one, when neither text ends with a size",
      attributes: {
        "Nazwa wymagana przez prawo": ["Nivea Pielęgnujące Mydło W Kostce Creme Soft"],
        ShortDescription: ["creme soft mydło w kostce"],
      },
      expected: { name: "Nivea Pielęgnujące Mydło W Kostce Creme Soft", sizeText: null, size: null },
    },
    {
      where: "none, when the legal name ends with a multipack and the description with no size",
      attributes: {
        "Nazwa wymagana przez prawo": ["Nivea Pielęgnujące Mydło W Kostce Creme Soft 4 x 100 g"],
        ShortDescription: ["creme soft mydło w kostce"],
      },
      expected: { name: "Nivea Pielęgnujące Mydło W Kostce Creme Soft 4 x 100 g", sizeText: null, size: null },
    },
  ])("takes the size from $where, and keeps the hit", async ({ attributes, expected }) => {
    const [candidate] = await candidatesFrom([withAttributes(soap(), attributes)]);

    expect(candidate).toMatchObject({ shopItemId: "000000000000218607", ...expected });
  });

  it.each([
    { why: "both are blank", legalName: ["   "], title: "  " },
    { why: "both are missing", legalName: undefined, title: undefined },
  ])("drops a hit without a legal name or a title, as when $why, and keeps the others", async (names) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const candidates = await candidatesFrom([
      soft200With({ "Nazwa wymagana przez prawo": names.legalName, title: names.title }),
      nameItems()[1],
    ]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual(["000000000000255134"]);
  });
});

describe("Hebe search: what it keeps out", () => {
  it("leaves out query suggestions and items not sold online without counting them, and counts what it can't read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [offline] = hitsOf(eanOffline);
    const unpriced = [0, null, "15.99"].map((price) => soft200With({ price_amount: price }));

    const candidates = await candidatesFrom([offline, ...hitsOf(nameSearch), ...unpriced]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual([
      SOFT_200,
      "000000000000255134",
      "000000000000742817",
      "000000000000218607",
    ]);
    // The unpriced items count as dropped; the item not sold online and the suggestion don't count at all.
    expect(loggedLine(warn)).toEqual({ event: "hebe-search", reason: "hits dropped", detail: "3 of 7 product hits" });
  });

  it.each([
    { why: "is missing", searchable: undefined },
    { why: "is a single value", searchable: true },
    { why: "is text", searchable: ["true"] },
    { why: "is empty", searchable: [] },
  ])("gives up, rather than finding nothing, when the only item's searchable $why", async ({ searchable }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [offline] = hitsOf(eanOffline);
    const body = searchBody([withAttributes(offline, { searchable })]);
    const { gate, fetchMock } = setup([{ url: searchUrl(SOFT_300_EAN, 5), status: 200, body }]);

    expect(await searchHebe(gate, SOFT_300_EAN, 5)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(SOFT_300_EAN, 5)]);
    expect(loggedLine(warn)).toEqual({ event: "hebe-search", reason: "hits dropped", detail: "1 of 1 product hits" });
  });

  it("never prices an item from its regular price while its sale price can't be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [, gel] = nameItems();

    const candidates = await candidatesFrom([soft200With({}), withAttributes(gel, { price_sale_amount: "18.89" })]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual([SOFT_200]);
    expect(loggedLine(warn)).toEqual({ event: "hebe-search", reason: "hits dropped", detail: "1 of 2 product hits" });
  });

  it.each([
    { flag: [true], available: true, odd: false },
    { flag: [false], available: false, odd: false },
    { flag: undefined, available: false, odd: true },
    { flag: ["true"], available: false, odd: true },
    // A single value where the recording has a list reads the same.
    { flag: true, available: true, odd: false },
  ])("reads online_flag $flag as orderable online: $available", async ({ flag, available, odd }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [candidate] = await candidatesFrom([soft200With({ online_flag: flag })]);

    expect(candidate.offer).toEqual({ ...SOFT_200_OFFER, available });
    // A flag that isn't a yes or a no is counted, as dropped hits are, so a changed format shows.
    const logged = warn.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown);
    expect(logged).toEqual(
      odd ? [{ event: "hebe-search", reason: "availability unread", detail: "1 of 1 product hits" }] : [],
    );
  });

  it("lets an odd value cost only itself: a numeric EAN, a product link off www.hebe.pl, an image over plain http", async () => {
    const [soft, gel, balm] = nameItems();
    soft.attributes.EAN = [4005900008299, SOFT_200_EAN];
    gel.attributes.web_url = ["https://hebe.pl/nivea-zel-pod-prysznic-750ml-000000000000255134.html"];
    balm.attributes.image_link = "http://www.hebe.pl/dw/image/v2/742817.png";

    const candidates = await candidatesFrom([soft, gel, balm]);

    expect(
      candidates.map(({ shopItemId, eans, productUrl, imageUrl }) => ({ shopItemId, eans, productUrl, imageUrl })),
    ).toMatchObject([
      { shopItemId: SOFT_200, eans: [SOFT_200_EAN], productUrl: SOFT_200_PAGE },
      { shopItemId: "000000000000255134", eans: ["9005800218540"], productUrl: null },
      { shopItemId: "000000000000742817", eans: ["9005800362939"], imageUrl: null },
    ]);
    expect(candidates[1].imageUrl).toMatch(/^https:\/\/www\.hebe\.pl\/dw\/image\//);
    expect(candidates[2].productUrl).toMatch(/^https:\/\/www\.hebe\.pl\/nivea-pielegnujaca-pomadka/);
  });

  it.each([
    { why: "a path", url: `${SOFT_200}/../koszyk` },
    { why: "letters", url: "HB218807" },
    { why: "more digits than the table holds", url: "1".repeat(41) },
    { why: "a number", url: 218807 },
  ])("drops an item whose id holds $why, and keeps the others", async ({ url }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [soft, gel] = nameItems();

    const candidates = await candidatesFrom([{ ...soft, url }, gel]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual(["000000000000255134"]);
    expect(loggedLine(warn)).toEqual({ event: "hebe-search", reason: "hits dropped", detail: "1 of 2 product hits" });
  });

  it("keeps product links and images only on www.hebe.pl and within their limits", async () => {
    const candidates = await candidatesFrom([
      soft200With({ web_url: ["http://www.hebe.pl/x.html"], image_link: "https://hebe.pl/x.png" }),
      soft200With({
        web_url: [`${SOFT_200_PAGE}?${"x".repeat(500)}`],
        image_link: `https://www.hebe.pl/${"x".repeat(500)}.png`,
      }),
      // A single value where the recording has a list, and a list where it has a single value, read the same.
      soft200With({ web_url: SOFT_200_PAGE, image_link: ["https://www.hebe.pl/x.png"] }),
    ]);

    expect(candidates.map(({ productUrl, imageUrl }) => ({ productUrl, imageUrl }))).toEqual([
      { productUrl: null, imageUrl: null },
      { productUrl: null, imageUrl: null },
      { productUrl: SOFT_200_PAGE, imageUrl: "https://www.hebe.pl/x.png" },
    ]);
  });

  it.each([
    { url: SOFT_200_PAGE, onHebe: true },
    { url: "https://www.hebe.pl/dw/image/v2/x.png", onHebe: true },
    { url: "http://www.hebe.pl/x.html", onHebe: false },
    { url: "https://hebe.pl/x.html", onHebe: false },
    { url: "https://www.hebe.pl.example.com/x.html", onHebe: false },
    { url: "https://live.luigisbox.com/x.png", onHebe: false },
    { url: "/x.html", onHebe: false },
  ])("treats $url as Hebe's product page and image: $onHebe", ({ url, onHebe }) => {
    expect(isHebeProductUrl(url)).toBe(onHebe);
    expect(isHebeImage(url)).toBe(onHebe);
  });

  it("cuts an over-long brand and name to their limits, and keeps the first 10 EANs", async () => {
    const eans = Array.from({ length: 12 }, (_, i) => String(5900000000000 + i));

    const [candidate] = await candidatesFrom([
      soft200With({ brand: ["B".repeat(200)], "Nazwa wymagana przez prawo": ["t".repeat(400)], EAN: eans }),
    ]);

    expect(candidate.brand).toHaveLength(120);
    expect(candidate.name).toHaveLength(300);
    expect(candidate.eans).toEqual(eans.slice(0, 10));
  });

  it("drops only the offer of a price that can't be stored, and an odd offer value costs only itself", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const candidates = await candidatesFrom([
      soft200With({ price_amount: 100000 }),
      soft200With({ price_omnibus_amount: "brak" }),
    ]);

    expect(candidates.map((candidate) => candidate.offer)).toEqual([null, { ...SOFT_200_OFFER, lowestPrice30d: null }]);
    // The 30-day low that can't be read is counted; the price that reads, though it can't be stored, isn't.
    expect(loggedLine(warn)).toEqual({
      event: "hebe-search",
      reason: "30-day low unread",
      detail: "1 of 2 product hits",
    });
  });

  it.each(OMNIBUS)(
    "reads a 30-day low that's $change, and counts it only when it's there but can't be read",
    async ({ omnibus, lowestPrice30d, unread }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const [candidate] = await candidatesFrom([soft200With({ price_omnibus_amount: omnibus })]);

      expect(candidate.offer).toEqual({ ...SOFT_200_OFFER, lowestPrice30d });
      expect(loggedLines(warn)).toEqual(
        unread ? [{ event: "hebe-search", reason: "30-day low unread", detail: "1 of 1 product hits" }] : [],
      );
    },
  );

  it("finds nothing, and logs nothing, when the only hit is the recorded query suggestion", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const suggestions = hitsOf(nameSearch).filter((hit) => hit.type === "query");

    expect(suggestions).toHaveLength(1);
    expect(await candidatesFrom(suggestions)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("Hebe search: the matching rule on its candidates (FR-006)", () => {
  it("accepts the only item that shares the product's EAN and size, by a brand that agrees", async () => {
    const candidates = await recordedCandidates(SOFT_200_EAN, 5, eanOnline);

    expect(pickMatch(SOFT_200_PRODUCT, candidates)).toMatchObject({
      kind: "accepted",
      candidate: { shop: "hebe", shopItemId: SOFT_200, brand: "Nivea" },
    });
  });

  it("finds nothing to match when the EAN's only item isn't sold online", async () => {
    const candidates = await recordedCandidates(SOFT_300_EAN, 5, eanOffline);

    expect(pickMatch(ROSSMANN_SOFT, candidates)).toEqual({ kind: "none" });
  });

  it("asks the user, flagging the size, when an item shares the product's EAN in another size", async () => {
    const candidates = await recordedCandidates(NAME_QUERY, 10, nameSearch);

    const pick = pickMatch(ROSSMANN_SOFT_ROSE, candidates);

    // Rossmann's lip balm is 4,8 g and Hebe's, with the same EAN, 5,5 ml: never accepted on its own.
    if (pick.kind !== "choose") {
      throw new Error(`expected choose, got ${pick.kind}`);
    }
    expect(pick.options.map(({ candidate, verdict }) => [candidate.shopItemId, verdict])).toEqual([
      [SOFT_200, { sharesEan: false, size: "differs", brand: "agrees" }],
      ["000000000000255134", { sharesEan: false, size: "differs", brand: "agrees" }],
      ["000000000000742817", { sharesEan: true, size: "differs", brand: "agrees" }],
    ]);
  });

  it("asks the user when no item of the name search shares the product's EAN", async () => {
    const candidates = await recordedCandidates(NAME_QUERY, 10, nameSearch);

    const pick = pickMatch(ROSSMANN_SOFT, candidates);

    if (pick.kind !== "choose") {
      throw new Error(`expected choose, got ${pick.kind}`);
    }
    expect(pick.options.map(({ verdict }) => verdict.sharesEan)).toEqual([false, false, false]);
  });

  it("accepts the 200 ml item from the name search too, the only one with its EAN and size", async () => {
    const candidates = await recordedCandidates(NAME_QUERY, 10, nameSearch);

    expect(pickMatch(SOFT_200_PRODUCT, candidates)).toMatchObject({
      kind: "accepted",
      candidate: { shopItemId: SOFT_200 },
    });
  });

  it("accepts AA LAAB's face wash by name for the product without an EAN: every word of its legal name is the product's", async () => {
    const candidates = await recordedCandidates(AA_LAAB_QUERY, 10, aaLaabSearch);

    // Its make-up balm, the other item in 150 ml, names words the product lacks.
    expect(candidates.filter(({ size }) => size?.value === 150).map(({ shopItemId }) => shopItemId)).toEqual([
      "000000000000450251",
      "000000000000450257",
    ]);
    expect(pickMatch(AA_LAAB_WITHOUT_EAN, candidates)).toMatchObject({
      kind: "accepted",
      candidate: {
        shopItemId: "000000000000450251",
        name: "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający 150 ml",
      },
    });
  });
});

describe("Hebe search: broken copies give a gap, never 'not found'", () => {
  it.each<{ change: string; edit: (hit: Hit) => unknown }>([
    { change: "prices sent as text", edit: (hit) => withAttributes(hit, { price_amount: "15.99" }) },
    { change: "no price", edit: (hit) => withAttributes(hit, { price_amount: undefined }) },
    { change: "no searchable", edit: (hit) => withAttributes(hit, { searchable: undefined }) },
    { change: "no ids", edit: (hit) => ({ ...hit, url: undefined }) },
    { change: "product links in place of the ids", edit: (hit) => ({ ...hit, url: SOFT_200_PAGE }) },
    { change: "no type", edit: (hit) => ({ ...hit, type: undefined }) },
    { change: "empty attributes", edit: (hit) => ({ ...hit, attributes: {} }) },
    // Hebe's type is "item": another one is no item, and only "query" is a query suggestion, so each counts.
    { change: "another type", edit: (hit) => ({ ...hit, type: "product" }) },
    { change: "a type that differs only in case", edit: (hit) => ({ ...hit, type: "Item" }) },
    { change: "neither a type nor attributes", edit: (hit) => ({ ...hit, type: undefined, attributes: undefined }) },
  ])("gives up when no item can be read, as with $change, and logs how many", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The query suggestion stays as recorded; every item gets the change.
    const hits = hitsOf(nameSearch).map((hit) => (hit.type === "item" ? edit(hit) : hit));
    const { gate, fetchMock, reserve, reportBlock } = setup([
      { url: searchUrl(NAME_QUERY, 10), status: 200, body: searchBody(hits) },
    ]);

    expect(await searchHebe(gate, NAME_QUERY, 10)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(NAME_QUERY, 10)]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock).not.toHaveBeenCalled();
    expect(loggedLine(warn)).toEqual({ event: "hebe-search", reason: "hits dropped", detail: "4 of 4 product hits" });
  });

  it.each<{ change: string; edit: (hit: Hit) => unknown }>([
    { change: "another type", edit: (hit) => ({ ...hit, type: "product" }) },
    { change: "neither a type nor attributes", edit: (hit) => ({ ...hit, type: undefined, attributes: undefined }) },
  ])("gives up on the EAN search's one item with $change, rather than finding nothing", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [soft] = hitsOf(eanOnline);
    const body = JSON.stringify({ ...eanOnline, results: { ...eanOnline.results, hits: [edit(soft)] } });
    const { gate, fetchMock, reserve } = setup([{ url: searchUrl(SOFT_200_EAN, 5), status: 200, body }]);

    expect(await searchHebe(gate, SOFT_200_EAN, 5)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(SOFT_200_EAN, 5)]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(loggedLine(warn)).toEqual({ event: "hebe-search", reason: "hits dropped", detail: "1 of 1 product hits" });
  });

  // Hebe's one recorded answer without hits, to a price request (hebe-id-unknown.json), served for a search: Luigi's
  // Box answers both in the same shape, and it says it matched none.
  it("finds nothing, and logs nothing, in an answer without hits that says it matched none", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve } = setup([
      { url: searchUrl(NAME_QUERY, 10), status: 200, body: JSON.stringify(idUnknown) },
    ]);

    expect(await searchHebe(gate, NAME_QUERY, 10)).toEqual({ kind: "results", candidates: [] });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(NAME_QUERY, 10)]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(idUnknown.results.total_hits).toBe(0);
    expect(idUnknown.next_page).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<{ change: string; answer: () => unknown; detail: string }>([
    {
      change: "a count of 15",
      answer: () => ({ ...idUnknown, results: { ...idUnknown.results, total_hits: 15 } }),
      detail: "0 hits, total_hits 15, next_page null",
    },
    {
      change: "a next page",
      answer: () => ({ ...idUnknown, next_page: `${searchUrl(NAME_QUERY, 10)}&page=2` }),
      detail: "0 hits, total_hits 0, next_page set",
    },
    {
      change: "no next page field",
      answer: () => ({ ...idUnknown, next_page: undefined }),
      detail: "0 hits, total_hits 0, next_page missing",
    },
    {
      // The recorded name search, which matched 58 items on more than one page, with its hits emptied.
      change: "the name search's count and next page",
      answer: () => ({ ...nameSearch, results: { ...nameSearch.results, hits: [] } }),
      detail: "0 hits, total_hits 58, next_page set",
    },
  ])(
    "gives up on an answer without hits but with $change, and logs only its count and whether there's a next page",
    async ({ answer, detail }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock, reserve } = setup([
        { url: searchUrl(NAME_QUERY, 10), status: 200, body: JSON.stringify(answer()) },
      ]);

      expect(await searchHebe(gate, NAME_QUERY, 10)).toEqual(FAILED);
      expect(requestedUrls(fetchMock)).toEqual([searchUrl(NAME_QUERY, 10)]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(loggedLine(warn)).toEqual({ event: "hebe-search", reason: "unexpected empty answer", detail });
      // Never the next page's address, which carries the search.
      expect(String(warn.mock.calls[0][0])).not.toContain("nivea");
    },
  );

  it.each([
    { answer: "an HTML page", body: HTML_PAGE, reason: "unreadable body" },
    { answer: "an empty body", body: "", reason: "unreadable body" },
    {
      answer: "the recorded answer without its hits",
      body: JSON.stringify({ ...nameSearch, results: { ...nameSearch.results, hits: undefined } }),
      reason: "unexpected response shape",
    },
  ])("gives up on $answer, and logs it without the search text", async ({ body, reason }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([
      { url: searchUrl(NAME_QUERY, 10), status: 200, headers: { "Content-Type": "text/html" }, body },
    ]);

    expect(await searchHebe(gate, NAME_QUERY, 10)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(NAME_QUERY, 10)]);
    expect(loggedLine(warn)).toMatchObject({ event: "hebe-search", reason });
    expect(String(warn.mock.calls[0][0])).not.toContain("nivea");
  });

  it("says Hebe's tracker id may have changed when Luigi's Box doesn't know it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([
      {
        url: searchUrl(SOFT_200_EAN, 5),
        status: unknownTracker.status,
        headers: { "Content-Type": unknownTracker.contentType },
        body: unknownTracker.body,
      },
    ]);

    expect(await searchHebe(gate, SOFT_200_EAN, 5)).toEqual(FAILED);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(SOFT_200_EAN, 5)]);
    expect(loggedLine(warn)).toEqual({
      event: "hebe-search",
      reason: "tracker id rejected",
      detail: "HTTP 404: HEBE_TRACKER_ID may have changed",
    });
  });
});

describe("Hebe search: why it's unavailable", () => {
  const url = searchUrl(SOFT_200_EAN, 5);

  it.each([
    { refusal: "the cap is reached", reservation: { outcome: "capped" }, expected: { reason: "busy" } },
    {
      refusal: "the shop is paused",
      reservation: { outcome: "paused", until: "2026-10-04T12:15:00.000Z" },
      expected: { reason: "paused", until: "2026-10-04T12:15:00.000Z" },
    },
    { refusal: "the shop is stopped", reservation: { outcome: "stopped" }, expected: { reason: "stopped" } },
    { refusal: "the counter can't be read", reservation: null, expected: { reason: "failed" } },
  ])("says so without calling Luigi's Box when $refusal", async ({ reservation, expected }) => {
    const { gate, fetchMock, reserve } = setup([{ url, status: 200, body: JSON.stringify(eanOnline) }], reservation);

    expect(await searchHebe(gate, SOFT_200_EAN, 5)).toEqual({ kind: "unavailable", ...expected });
    expect(reserve.mock.calls).toEqual([["hebe"]]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<{ refusal: string; answer: ServedAnswer; reported: unknown[][] }>([
    { refusal: "a 403", answer: { status: 403 }, reported: [["hebe", "blocked", undefined, "HTTP 403"]] },
    {
      refusal: "a bot challenge, though its status is 200",
      answer: CHALLENGE,
      reported: [["hebe", "blocked", undefined, "challenge"]],
    },
  ])(
    "is stopped by $refusal, without blaming the tracker id, and the block is reported",
    async ({ answer, reported }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock, reserve, reportBlock } = setup([{ url, ...answer }]);

      expect(await searchHebe(gate, SOFT_200_EAN, 5)).toEqual({ kind: "unavailable", reason: "stopped" });
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

    const secondsAhead = pauseSecondsOf(await searchHebe(gate, SOFT_200_EAN, 5));

    expect(secondsAhead).toBeGreaterThan(115);
    expect(secondsAhead).toBeLessThanOrEqual(120);
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock.mock.calls).toEqual([["hebe", "rate_limited", 120]]);
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

      expect(await searchHebe(gate, SOFT_200_EAN, 5)).toEqual(FAILED);
      expect(requestedUrls(fetchMock)).toEqual([url]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reportBlock).not.toHaveBeenCalled();
      // Only the gate logs it, saying why.
      expect(gateOutcomes(gateLog)).toStrictEqual([outcome]);
      expect(warn).not.toHaveBeenCalled();
    },
  );
});

describe("Hebe prices: recorded answers", () => {
  it("fetches the asked-for item's offer, and calls the item Hebe left out missing", async () => {
    const url = priceUrl([SOFT_200, SOFT_300]);
    const { gate, fetchMock } = setup([{ url, status: 200, body: JSON.stringify(twoIds) }]);

    const checks = await fetchHebePrices(gate, [SOFT_200, SOFT_300]);

    expect(requestedUrls(fetchMock)).toEqual([url]);
    const [requested] = requestedUrls(fetchMock);
    expect(new URL(requested).searchParams.getAll("f[]")).toEqual(["type:item", `ID:${SOFT_200}`, `ID:${SOFT_300}`]);
    // 251798 isn't sold online, so a request without a query doesn't return it: its last price stays, out of date.
    expect(checks).toEqual(
      new Map<string, PriceCheck>([
        [SOFT_200, { kind: "price", offer: SOFT_200_OFFER }],
        [SOFT_300, { kind: "missing" }],
      ]),
    );
  });

  it("reports an id Hebe doesn't have as missing", async () => {
    const url = priceUrl([UNKNOWN_ID]);
    const { gate, fetchMock } = setup([{ url, status: 200, body: JSON.stringify(idUnknown) }]);

    expect(await fetchHebePrices(gate, [UNKNOWN_ID])).toEqual(new Map([[UNKNOWN_ID, { kind: "missing" }]]));
    expect(requestedUrls(fetchMock)).toEqual([url]);
  });

  it("asks once for an id given twice", async () => {
    const url = priceUrl([SOFT_200]);
    const { gate, fetchMock } = setup([{ url, status: 200, body: JSON.stringify(twoIds) }]);

    const checks = await fetchHebePrices(gate, [SOFT_200, SOFT_200]);

    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(checks).toEqual(new Map([[SOFT_200, { kind: "price", offer: SOFT_200_OFFER }]]));
  });

  it("splits 51 ids into requests of 50 and 1, one after the other", async () => {
    const { gate, fetchMock } = setup([
      { url: firstBatch, status: 200, body: JSON.stringify(twoIds) },
      { url: secondBatch, status: 200, body: JSON.stringify(idUnknown) },
    ]);

    const checks = await fetchHebePrices(gate, manyIds);

    expect(requestedUrls(fetchMock)).toEqual([firstBatch, secondBatch]);
    const filtersPerRequest = requestedUrls(fetchMock).map((url) => new URL(url).searchParams.getAll("f[]").length);
    expect(filtersPerRequest).toEqual([51, 2]);
    expect(checks.size).toBe(51);
    expect(checks.get(SOFT_200)).toEqual({ kind: "price", offer: SOFT_200_OFFER });
    for (const id of manyIds.slice(1)) {
      expect(checks.get(id), id).toEqual({ kind: "missing" });
    }
  });
});

describe("Hebe prices: what they keep out", () => {
  it("never sends an id that can't go into a filter, and says it's unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invalid = ["..", "21880 7", `ID:${SOFT_200}`, `${SOFT_200}&size=200`, "1".repeat(41), "HB218807"];
    const { gate, fetchMock } = setup([{ url: priceUrl([SOFT_200]), status: 200, body: JSON.stringify(twoIds) }]);

    const checks = await fetchHebePrices(gate, [invalid[0], SOFT_200, ...invalid.slice(1)]);

    expect(requestedUrls(fetchMock)).toEqual([priceUrl([SOFT_200])]);
    expect(checks.get(SOFT_200)).toEqual({ kind: "price", offer: SOFT_200_OFFER });
    for (const id of invalid) {
      expect(checks.get(id), id).toEqual(FAILED);
    }
    // How many, never which.
    expect(loggedLine(warn)).toEqual({ event: "hebe-prices", reason: "invalid IDs", detail: "6 of 7 IDs not sent" });
  });

  it("sends nothing for no ids", async () => {
    const { gate, fetchMock } = setup([]);

    expect(await fetchHebePrices(gate, [])).toEqual(new Map<string, PriceCheck>());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<{ change: string; attributes: Record<string, unknown>; offer: ShopOffer }>([
    {
      change: "a sale price, which is the price, with the regular price before it",
      attributes: { price_sale_amount: 9.99 },
      offer: { ...SOFT_200_OFFER, price: 9.99, regularPrice: 15.99 },
    },
    {
      change: "a sale price equal to the price",
      attributes: { price_sale_amount: 15.99 },
      offer: SOFT_200_OFFER,
    },
    {
      change: "an item that can't be ordered online",
      attributes: { online_flag: [false] },
      offer: { ...SOFT_200_OFFER, available: false },
    },
  ])("keeps the offer with $change", async ({ attributes, offer }) => {
    const [soft] = hitsOf(twoIds);
    const body = priceBody([withAttributes(soft, attributes)]);
    const { gate } = setup([{ url: priceUrl([SOFT_200]), status: 200, body }]);

    expect(await fetchHebePrices(gate, [SOFT_200])).toEqual(new Map([[SOFT_200, { kind: "price", offer }]]));
  });

  it.each(OMNIBUS)(
    "reads a 30-day low that's $change, and counts it only when it's there but can't be read",
    async ({ omnibus, lowestPrice30d, unread }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const [soft] = hitsOf(twoIds);
      const body = priceBody([withAttributes(soft, { price_omnibus_amount: omnibus })]);
      const { gate } = setup([{ url: priceUrl([SOFT_200]), status: 200, body }]);

      expect(await fetchHebePrices(gate, [SOFT_200])).toEqual(
        new Map([[SOFT_200, { kind: "price", offer: { ...SOFT_200_OFFER, lowestPrice30d } }]]),
      );
      expect(loggedLines(warn)).toEqual(
        unread ? [{ event: "hebe-prices", reason: "30-day low unread", detail: "1 of 1 product hits" }] : [],
      );
    },
  );

  it.each([{ flag: undefined }, { flag: ["true"] }])(
    "reads online_flag $flag as not orderable, and logs how many hits had a flag that isn't a yes or a no",
    async ({ flag }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const [soft] = hitsOf(twoIds);
      const body = priceBody([withAttributes(soft, { online_flag: flag })]);
      const { gate } = setup([{ url: priceUrl([SOFT_200]), status: 200, body }]);

      expect(await fetchHebePrices(gate, [SOFT_200])).toEqual(
        new Map([[SOFT_200, { kind: "price", offer: { ...SOFT_200_OFFER, available: false } }]]),
      );
      expect(loggedLine(warn)).toEqual({
        event: "hebe-prices",
        reason: "availability unread",
        detail: "1 of 1 product hits",
      });
    },
  );

  it("keeps the other id's price when one hit can't be read, and the unread one is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [soft] = hitsOf(twoIds);
    const unread = { ...withAttributes(soft, { price_amount: "24.99" }), url: SOFT_300 };
    const url = priceUrl([SOFT_200, SOFT_300]);
    const { gate } = setup([{ url, status: 200, body: priceBody([soft, unread]) }]);

    expect(await fetchHebePrices(gate, [SOFT_200, SOFT_300])).toEqual(
      new Map<string, PriceCheck>([
        [SOFT_200, { kind: "price", offer: SOFT_200_OFFER }],
        [SOFT_300, FAILED],
      ]),
    );
    expect(loggedLine(warn)).toEqual({ event: "hebe-prices", reason: "hits dropped", detail: "1 of 2 product hits" });
  });

  it.each<{ change: string; edit: (hit: Hit) => unknown }>([
    { change: "its price sent as text", edit: (hit) => withAttributes(hit, { price_amount: "15.99" }) },
    { change: "no price", edit: (hit) => withAttributes(hit, { price_amount: undefined }) },
    { change: "a sale price sent as text", edit: (hit) => withAttributes(hit, { price_sale_amount: "9.99" }) },
    { change: "a price the table can't hold", edit: (hit) => withAttributes(hit, { price_amount: 100000 }) },
    { change: "its product link in place of the id", edit: (hit) => ({ ...hit, url: SOFT_200_PAGE }) },
    // Its attributes intact: a hit of another type is never priced, and only "query" is a query suggestion.
    { change: "another type", edit: (hit) => ({ ...hit, type: "product" }) },
    { change: "a type that differs only in case", edit: (hit) => ({ ...hit, type: "Item" }) },
    { change: "neither a type nor attributes", edit: (hit) => ({ ...hit, type: undefined, attributes: undefined }) },
  ])("calls every id unavailable, never missing, when the hit can't be read, as with $change", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const url = priceUrl([SOFT_200, SOFT_300]);
    const { gate, fetchMock, reserve } = setup([{ url, status: 200, body: priceBody(hitsOf(twoIds).map(edit)) }]);

    expect(await fetchHebePrices(gate, [SOFT_200, SOFT_300])).toEqual(
      new Map([
        [SOFT_200, FAILED],
        [SOFT_300, FAILED],
      ]),
    );
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(loggedLine(warn)).toEqual({ event: "hebe-prices", reason: "hits dropped", detail: "1 of 1 product hits" });
  });

  it("stores no id as missing when Hebe answers with an item it wasn't asked for", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // 218807's recorded hit in answer to another id, as if the id filter had been ignored.
    const url = priceUrl([UNKNOWN_ID]);
    const { gate } = setup([{ url, status: 200, body: JSON.stringify(twoIds) }]);

    expect(await fetchHebePrices(gate, [UNKNOWN_ID])).toEqual(new Map([[UNKNOWN_ID, FAILED]]));
    expect(loggedLine(warn)).toEqual({
      event: "hebe-prices",
      reason: "hits not asked for",
      detail: "1 of 1 product hits",
    });
  });

  it.each<{ change: string; edit: (answer: typeof twoIds) => unknown }>([
    {
      change: "a next page",
      edit: (answer) => ({ ...answer, next_page: "https://live.luigisbox.com/search?tracker_id=421168-505233&page=2" }),
    },
    {
      change: "more hits matched than it holds",
      edit: (answer) => ({ ...answer, results: { ...answer.results, total_hits: 2 } }),
    },
    {
      change: "no count of the hits matched",
      edit: (answer) => ({ ...answer, results: { ...answer.results, total_hits: undefined } }),
    },
  ])("calls the id without a hit unavailable, never missing, when the answer has $change", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The recorded answer for 218807 and 251798, edited: 251798's hit may be the one it left out.
    const url = priceUrl([SOFT_200, SOFT_300]);
    const { gate } = setup([{ url, status: 200, body: JSON.stringify(edit(structuredClone(twoIds))) }]);

    expect(await fetchHebePrices(gate, [SOFT_200, SOFT_300])).toEqual(
      new Map<string, PriceCheck>([
        [SOFT_200, { kind: "price", offer: SOFT_200_OFFER }],
        [SOFT_300, FAILED],
      ]),
    );
    expect(loggedLine(warn)).toEqual({
      event: "hebe-prices",
      reason: "answer incomplete",
      detail: "1 product hits for 2 IDs",
    });
  });
});

describe("Hebe prices: why they're unavailable", () => {
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
      reservation: { outcome: "paused", until: "2026-10-04T12:15:00.000Z" },
      requested: [],
      expected: { kind: "unavailable", reason: "paused", until: "2026-10-04T12:15:00.000Z" },
    },
    {
      refusal: "stopped by a 403",
      entries: [{ url: firstBatch, status: 403 }],
      reservation: { outcome: "allowed" },
      requested: [firstBatch],
      expected: { kind: "unavailable", reason: "stopped" },
    },
  ])(
    "stops once Hebe is $refusal: the next request's ids get the same answer, unasked and unreserved",
    async ({ entries, reservation, requested, expected }) => {
      const { gate, fetchMock, reserve } = setup(entries, reservation);

      const checks = await fetchHebePrices(gate, manyIds);

      expect(reserve).toHaveBeenCalledTimes(1);
      expect(requestedUrls(fetchMock)).toEqual(requested);
      expect(checks.size).toBe(51);
      for (const id of manyIds) {
        expect(checks.get(id), id).toEqual(expected);
      }
    },
  );

  it("goes on to the next request after one that failed", async () => {
    const { gate, fetchMock } = setup([
      { url: firstBatch, status: 500 },
      { url: secondBatch, status: 200, body: JSON.stringify(idUnknown) },
    ]);

    const checks = await fetchHebePrices(gate, manyIds);

    expect(requestedUrls(fetchMock)).toEqual([firstBatch, secondBatch]);
    for (const id of manyIds.slice(0, 50)) {
      expect(checks.get(id), id).toEqual(FAILED);
    }
    expect(checks.get(manyIds[50])).toEqual({ kind: "missing" });
  });

  it("says Hebe's tracker id may have changed when Luigi's Box doesn't know it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const url = priceUrl([SOFT_200]);
    const { gate, fetchMock } = setup([
      {
        url,
        status: unknownTracker.status,
        headers: { "Content-Type": unknownTracker.contentType },
        body: unknownTracker.body,
      },
    ]);

    expect(await fetchHebePrices(gate, [SOFT_200])).toEqual(new Map([[SOFT_200, FAILED]]));
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(loggedLine(warn)).toEqual({
      event: "hebe-prices",
      reason: "tracker id rejected",
      detail: "HTTP 404: HEBE_TRACKER_ID may have changed",
    });
  });

  it.each([
    { answer: "an HTML page", body: HTML_PAGE, reason: "unreadable body" },
    {
      answer: "the recorded answer without its hits",
      body: JSON.stringify({ ...twoIds, results: { ...twoIds.results, hits: undefined } }),
      reason: "unexpected response shape",
    },
  ])("gives up on $answer for every id, never missing, and logs it without the ids", async ({ body, reason }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const url = priceUrl([SOFT_200, SOFT_300]);
    const { gate, fetchMock } = setup([{ url, status: 200, headers: { "Content-Type": "text/html" }, body }]);

    expect(await fetchHebePrices(gate, [SOFT_200, SOFT_300])).toEqual(
      new Map([
        [SOFT_200, FAILED],
        [SOFT_300, FAILED],
      ]),
    );
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(loggedLine(warn)).toMatchObject({ event: "hebe-prices", reason });
    expect(String(warn.mock.calls[0][0])).not.toContain("218807");
  });
});

describe("Hebe: the shop every request is charged to", () => {
  it("names Hebe in every gate call and reservation, and asks Hebe's tracker", async () => {
    const { gate, fetchMock, reserve } = setup([
      { url: searchUrl(SOFT_200_EAN, 5), status: 200, body: JSON.stringify(eanOnline) },
      { url: firstBatch, status: 200, body: JSON.stringify(twoIds) },
      { url: secondBatch, status: 200, body: JSON.stringify(idUnknown) },
    ]);
    const gateFetch = vi.spyOn(gate, "fetch");

    await searchHebe(gate, SOFT_200_EAN, 5);
    await fetchHebePrices(gate, manyIds);

    expect(gateFetch.mock.calls.map(([shop]) => shop)).toEqual(["hebe", "hebe", "hebe"]);
    expect(reserve.mock.calls).toEqual([["hebe"], ["hebe"], ["hebe"]]);
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(SOFT_200_EAN, 5), firstBatch, secondBatch]);
  });
});
