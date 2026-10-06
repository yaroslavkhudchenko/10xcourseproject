import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { pickMatch, type NamedProduct } from "@/lib/services/matching";
import { createShopGate, type ShopGate } from "@/lib/services/shop-gate";
import { fetchNaturaPrices, isNaturaImage, isNaturaProductUrl, searchNatura } from "@/lib/services/shops/natura";
import { parseSize } from "@/lib/services/size";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import type { PriceCheck, ShopCandidate, ShopOffer } from "@/types";
import eanHit from "@/lib/services/shops/fixtures/natura-ean-hit.json";
import eanMiss from "@/lib/services/shops/fixtures/natura-ean-miss.json";
import nameSearch from "@/lib/services/shops/fixtures/natura-name-search.json";
import niveaSoftSearch from "@/lib/services/shops/fixtures/natura-search-nivea-soft.json";
import skuUnknown from "@/lib/services/shops/fixtures/natura-sku-unknown.json";
import oneSku from "@/lib/services/shops/fixtures/natura-sku.json";
import twoSkus from "@/lib/services/shops/fixtures/natura-skus.json";
import unknownTracker from "@/lib/services/shops/fixtures/natura-unknown-tracker.json";

// The fixtures are real Luigi's Box answers for Natura, recorded once with curl; no test reaches the live search.
// natura-search-nivea-soft.json is the search for "nivea soft", size 10, recorded on 2026-10-06 at 10:37:39 UTC from
// the developer machine, with the gate's User-Agent and `Accept: application/json`, following no redirect, and cut to
// its first 5 hits, all products: Nivea Soft in 300, 200 and 100 ml, Creme Soft's shower gel and a 50 ml Soft cream.
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

/**
 * A real gate that gives every reservation the same answer, allowed by default, over a fetch that answers only the
 * given recordings. `reserve` shows how many slots were asked for.
 */
function setup(entries: ReplayEntry[], reservation: unknown = { outcome: "allowed" }) {
  const fetchMock = vi.fn(createReplayFetch(entries));
  const reserve = vi.fn(() => Promise.resolve(reservation));
  const gate = createShopGate({
    reserve,
    reportBlock: () => Promise.resolve(),
    fetch: fetchMock,
    log: () => undefined,
  });
  return { gate, fetchMock, reserve };
}

/** Every URL the fetch was asked for, so a test can't pass on the wrong request. */
function requestedUrls(fetchMock: Mock<typeof fetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : new URL(input).href));
}

/** A recorded hit, as JSON a test can edit. */
interface Hit {
  url: unknown;
  attributes: Record<string, unknown>;
}

/** The recorded hits, copied so a test can edit them without touching the imported fixture. */
function hitsOf(fixture: { results: { hits: unknown[] } }): Hit[] {
  return structuredClone(fixture.results.hits) as Hit[];
}

/** The recorded Nivea Soft hit, with some of its attributes replaced. */
function softWith(attributes: Record<string, unknown>): Hit {
  const [soft] = hitsOf(eanHit);
  return { ...soft, attributes: { ...soft.attributes, ...attributes } };
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

  it("finds nothing for an EAN Natura doesn't list", async () => {
    const { gate, fetchMock } = setup([{ url: searchUrl(MISSING_EAN, 5), status: 200, body: JSON.stringify(eanMiss) }]);

    expect(await searchNatura(gate, MISSING_EAN, 5)).toEqual({ kind: "results", candidates: [] });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(MISSING_EAN, 5)]);
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
      // A query suggestion, as Luigi's Box sends one for Hebe (research note §2.2).
      { url: "nivea soft", attributes: {} },
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

  it("finds nothing, and logs no drop, when the only hit is a query suggestion", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await candidatesFrom([{ url: "nivea soft", attributes: {} }])).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
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
    const candidates = await candidatesFrom([
      softWith({ price_amount: 100000 }),
      softWith({ price_old_amount: 16.99, lowest_price: ["brak"], availability: 0 }),
    ]);

    expect(candidates.map((candidate) => candidate.offer)).toEqual([
      null,
      { ...SOFT_OFFER, regularPrice: null, lowestPrice30d: null, available: false },
    ]);
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

describe("Natura search: why it's unavailable", () => {
  it("says the tracker id may have changed when Luigi's Box doesn't know it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Luigi's Box's recorded answer to an unknown tracker id, as it would answer if it stopped knowing Natura's.
    const { gate, fetchMock } = setup([
      {
        url: searchUrl(SOFT_EAN, 5),
        status: unknownTracker.status,
        headers: { "Content-Type": unknownTracker.contentType },
        body: unknownTracker.body,
      },
    ]);

    expect(await searchNatura(gate, SOFT_EAN, 5)).toEqual({ kind: "unavailable", reason: "failed" });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(SOFT_EAN, 5)]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toMatchObject({ event: "natura-search", reason: "tracker id rejected" });
  });

  it.each([
    { refusal: "the cap is reached", reservation: { outcome: "capped" }, expected: { reason: "busy" } },
    { refusal: "the shop is stopped", reservation: { outcome: "stopped" }, expected: { reason: "stopped" } },
  ])("says so without calling Luigi's Box when $refusal", async ({ reservation, expected }) => {
    const { gate, fetchMock } = setup(
      [{ url: searchUrl(SOFT_EAN, 5), status: 200, body: JSON.stringify(eanHit) }],
      reservation,
    );

    expect(await searchNatura(gate, SOFT_EAN, 5)).toEqual({ kind: "unavailable", ...expected });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { answer: "a 403", status: 403, reason: "stopped" },
    { answer: "a 500", status: 500, reason: "failed" },
  ])("reports $answer as $reason, without blaming the tracker id", async ({ status, reason }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate } = setup([{ url: searchUrl(SOFT_EAN, 5), status }]);

    expect(await searchNatura(gate, SOFT_EAN, 5)).toEqual({ kind: "unavailable", reason });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<{ change: string; edit: (hit: Hit) => Hit }>([
    {
      change: "prices sent as text",
      edit: (hit) => ({ ...hit, attributes: { ...hit.attributes, price_amount: "16.99" } }),
    },
    { change: "product links in place of the SKUs", edit: (hit) => ({ ...hit, url: SOFT_PAGE }) },
  ])("gives up when no product hit can be read, as with $change, and logs how many", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A format change that makes every hit fail its check must not read as "Natura doesn't sell it".
    const body = JSON.stringify({ results: { hits: hitsOf(nameSearch).map(edit) } });
    const { gate, fetchMock } = setup([{ url: searchUrl(NAME_QUERY, 10), status: 200, body }]);

    expect(await searchNatura(gate, NAME_QUERY, 10)).toEqual({ kind: "unavailable", reason: "failed" });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(NAME_QUERY, 10)]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toEqual({ event: "natura-search", reason: "hits dropped", detail: "3 of 3 product hits" });
  });

  it.each([
    { answer: "text that echoes the search", body: NAME_QUERY },
    { answer: "JSON of another shape", body: JSON.stringify({ hits: [] }) },
  ])("gives up on $answer, and logs it without the search text", async ({ body }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([{ url: searchUrl(NAME_QUERY, 10), status: 200, body }]);

    expect(await searchNatura(gate, NAME_QUERY, 10)).toEqual({ kind: "unavailable", reason: "failed" });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(NAME_QUERY, 10)]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("nivea");
  });
});

/** The price answer the given hits make, as JSON: whole, as every recorded one is, with no next page. */
function priceBody(hits: unknown[]): string {
  return JSON.stringify({ results: { hits, total_hits: hits.length }, next_page: null });
}

/** The one log line a test expects, parsed. */
function loggedLine(warn: { mock: { calls: unknown[][] } }): unknown {
  expect(warn.mock.calls).toHaveLength(1);
  return JSON.parse(String(warn.mock.calls[0][0]));
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

  it.each<{ change: string; attributes: Record<string, unknown>; offer: ShopOffer }>([
    {
      change: "a regular price equal to the price",
      attributes: { price_old_amount: 16.99 },
      offer: { ...SOFT_OFFER, regularPrice: null },
    },
    {
      change: "a 30-day low of zero",
      attributes: { lowest_price: ["0.000000"] },
      offer: { ...SOFT_OFFER, lowestPrice30d: null },
    },
    {
      change: "a 30-day low that isn't a number",
      attributes: { lowest_price: ["brak"] },
      offer: { ...SOFT_OFFER, lowestPrice30d: null },
    },
    {
      change: "an item that can't be ordered online",
      attributes: { availability: 0 },
      offer: { ...SOFT_OFFER, available: false },
    },
  ])("keeps the offer with $change, which costs only that value", async ({ attributes, offer }) => {
    const [soft] = hitsOf(oneSku);
    const body = priceBody([{ ...soft, attributes: { ...soft.attributes, ...attributes } }]);
    const { gate } = setup([{ url: priceUrl(["NV89063"]), status: 200, body }]);

    expect(await fetchNaturaPrices(gate, ["NV89063"])).toEqual(new Map([["NV89063", { kind: "price", offer }]]));
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

  it.each<{ change: string; edit: (hit: Hit) => Hit }>([
    {
      change: "prices sent as text",
      edit: (hit) => ({ ...hit, attributes: { ...hit.attributes, price_amount: "16.99" } }),
    },
    {
      change: "prices the table can't hold",
      edit: (hit) => ({ ...hit, attributes: { ...hit.attributes, price_amount: 100000 } }),
    },
  ])("calls every SKU unavailable, never missing, when no hit can be read, as with $change", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const url = priceUrl(["NV89063", "NV81063"]);
    const { gate, fetchMock } = setup([{ url, status: 200, body: priceBody(hitsOf(twoSkus).map(edit)) }]);

    expect(await fetchNaturaPrices(gate, ["NV89063", "NV81063"])).toEqual(
      new Map([
        ["NV89063", FAILED],
        ["NV81063", FAILED],
      ]),
    );
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(loggedLine(warn)).toEqual({ event: "natura-prices", reason: "hits dropped", detail: "2 of 2 product hits" });
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
});

describe("Natura prices: why they're unavailable", () => {
  it.each([
    { refusal: "the cap is reached", reservation: { outcome: "capped" }, expected: { reason: "busy" } },
    { refusal: "the shop is stopped", reservation: { outcome: "stopped" }, expected: { reason: "stopped" } },
  ])("says so for every SKU without calling Luigi's Box when $refusal", async ({ reservation, expected }) => {
    const url = priceUrl(["NV89063", "NV81063"]);
    const { gate, fetchMock } = setup([{ url, status: 200, body: JSON.stringify(twoSkus) }], reservation);

    expect(await fetchNaturaPrices(gate, ["NV89063", "NV81063"])).toEqual(
      new Map([
        ["NV89063", { kind: "unavailable", ...expected }],
        ["NV81063", { kind: "unavailable", ...expected }],
      ]),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Nivea Soft first, then 50 SKUs Natura doesn't have: two requests' worth.
  const manySkus = ["NV89063", ...Array.from({ length: 50 }, (_, i) => `ZZ${String(i).padStart(8, "0")}`)];
  const firstBatch = priceUrl(manySkus.slice(0, 50));
  const secondBatch = priceUrl(manySkus.slice(50));

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
      reservation: { outcome: "paused", until: "2026-09-28T12:15:00.000Z" },
      requested: [],
      expected: { kind: "unavailable", reason: "paused", until: "2026-09-28T12:15:00.000Z" },
    },
    {
      refusal: "stopped by a 403",
      entries: [{ url: firstBatch, status: 403 }],
      reservation: { outcome: "allowed" },
      requested: [firstBatch],
      expected: { kind: "unavailable", reason: "stopped" },
    },
  ])(
    "stops once Natura is $refusal: the next request's SKUs get the same answer, unasked and unreserved",
    async ({ entries, reservation, requested, expected }) => {
      const { gate, fetchMock, reserve } = setup(entries, reservation);

      const checks = await fetchNaturaPrices(gate, manySkus);

      expect(reserve).toHaveBeenCalledTimes(1);
      expect(requestedUrls(fetchMock)).toEqual(requested);
      expect(checks.size).toBe(51);
      for (const sku of manySkus) {
        expect(checks.get(sku), sku).toEqual(expected);
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

  it.each([
    { answer: "a 403", status: 403, reason: "stopped" },
    { answer: "a 500", status: 500, reason: "failed" },
  ])("reports $answer as $reason for every SKU of the request", async ({ status, reason }) => {
    const url = priceUrl(["NV89063", "NV81063"]);
    const { gate, fetchMock } = setup([{ url, status }]);

    expect(await fetchNaturaPrices(gate, ["NV89063", "NV81063"])).toEqual(
      new Map([
        ["NV89063", { kind: "unavailable", reason }],
        ["NV81063", { kind: "unavailable", reason }],
      ]),
    );
    expect(requestedUrls(fetchMock)).toEqual([url]);
  });

  it("says the tracker id may have changed when Luigi's Box doesn't know it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const url = priceUrl(["NV89063"]);
    const { gate } = setup([
      {
        url,
        status: unknownTracker.status,
        headers: { "Content-Type": unknownTracker.contentType },
        body: unknownTracker.body,
      },
    ]);

    expect(await fetchNaturaPrices(gate, ["NV89063"])).toEqual(new Map([["NV89063", FAILED]]));
    expect(loggedLine(warn)).toMatchObject({ event: "natura-prices", reason: "tracker id rejected" });
  });

  it.each([
    { answer: "text", body: "Przerwa techniczna" },
    { answer: "JSON of another shape", body: JSON.stringify({ hits: [] }) },
  ])("gives up on $answer for every SKU, and logs it without the SKUs", async ({ body }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const url = priceUrl(["NV89063"]);
    const { gate, fetchMock } = setup([{ url, status: 200, body }]);

    expect(await fetchNaturaPrices(gate, ["NV89063"])).toEqual(new Map([["NV89063", FAILED]]));
    expect(requestedUrls(fetchMock)).toEqual([url]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("NV89063");
  });
});
