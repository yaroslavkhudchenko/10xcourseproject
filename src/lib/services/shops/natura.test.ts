import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createShopGate, type ShopGate } from "@/lib/services/shop-gate";
import { isNaturaImage, isNaturaProductUrl, searchNatura } from "@/lib/services/shops/natura";
import { parseSize } from "@/lib/services/size";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import eanHit from "@/lib/services/shops/fixtures/natura-ean-hit.json";
import eanMiss from "@/lib/services/shops/fixtures/natura-ean-miss.json";
import nameSearch from "@/lib/services/shops/fixtures/natura-name-search.json";
import unknownTracker from "@/lib/services/shops/fixtures/natura-unknown-tracker.json";

// The fixtures are real Luigi's Box answers for Natura, recorded once with curl; no test reaches the live search.
const searchUrl = (query: string, size: number) =>
  `https://live.luigisbox.com/search?tracker_id=703598-939363&q=${encodeURIComponent(query)}&size=${size}`;
const SOFT_EAN = "4005900009319";
// An EAN Natura doesn't list, as natura-ean-miss.json recorded.
const MISSING_EAN = "5901234123457";
const NAME_QUERY = "nivea soft 300 ml";
const SOFT_PAGE = "https://drogerienatura.pl/produkt/nivea-soft-krem-intensywnie-nawilzajacy-300-ml-4005900009319";
const IMAGE_HOST = "https://media.drogerienatura.pl";

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
          price: 16.99,
        },
      ],
    });
  });

  it("finds nothing for an EAN Natura doesn't list", async () => {
    const { gate, fetchMock } = setup([{ url: searchUrl(MISSING_EAN, 5), status: 200, body: JSON.stringify(eanMiss) }]);

    expect(await searchNatura(gate, MISSING_EAN, 5)).toEqual({ kind: "results", candidates: [] });
    expect(requestedUrls(fetchMock)).toEqual([searchUrl(MISSING_EAN, 5)]);
  });

  it("maps the name search's hits in Natura's order", async () => {
    const { gate, fetchMock } = setup([
      { url: searchUrl(NAME_QUERY, 10), status: 200, body: JSON.stringify(nameSearch) },
    ]);

    const search = await searchNatura(gate, NAME_QUERY, 10);

    expect(requestedUrls(fetchMock)).toEqual([searchUrl(NAME_QUERY, 10)]);
    expect(search).toMatchObject({
      kind: "results",
      candidates: [
        { shopItemId: "NV89063", brand: "NIVEA", sizeText: "300 ml", eans: [SOFT_EAN], price: 16.99 },
        { shopItemId: "JM00370", brand: "YOPE", sizeText: "300 ml", eans: ["5900168900370"], price: 16.99 },
        { shopItemId: "NV81063", brand: "NIVEA MEN", sizeText: "500 ml", eans: ["9005800286563"], price: 17.99 },
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
  });

  it("lets an odd value cost only itself: a numeric EAN, a foreign product link, a bad SKU", async () => {
    const [soft, yope, men] = hitsOf(nameSearch);
    soft.attributes.ean = [4005900009319, SOFT_EAN];
    yope.url = "JM00370/../koszyk";
    men.attributes.web_url = ["https://drogerienatura.pl.example.com/produkt/nivea-men"];

    const candidates = await candidatesFrom([soft, yope, men]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual(["NV89063", "NV81063"]);
    const [first, second] = candidates;
    expect(first).toMatchObject({ eans: [SOFT_EAN], productUrl: SOFT_PAGE });
    expect(second).toMatchObject({ brand: "NIVEA MEN", sizeText: "500 ml", productUrl: null, price: 17.99 });
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

  it.each([
    { why: "is blank", title: "   " },
    { why: "is missing", title: undefined },
    { why: "isn't text", title: 42 },
  ])("drops a hit whose title $why, and keeps the others", async ({ title }) => {
    const [, yope] = hitsOf(nameSearch);

    const candidates = await candidatesFrom([softWith({ title }), yope]);

    expect(candidates.map((candidate) => candidate.shopItemId)).toEqual(["JM00370"]);
  });
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
