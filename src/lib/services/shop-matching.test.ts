import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createShopGate, type ShopGateDeps } from "@/lib/services/shop-gate";
import { lookupChoicesInNatura, lookupInNatura, type LookupProduct } from "@/lib/services/shop-matching";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import eanHit from "@/lib/services/shops/fixtures/natura-ean-hit.json";
import eanMiss from "@/lib/services/shops/fixtures/natura-ean-miss.json";
import nameSearch from "@/lib/services/shops/fixtures/natura-name-search.json";
import type { NaturaChoices } from "@/types";

// Natura answers with real Luigi's Box recordings, through the real gate; no test reaches the live search.
const searchUrl = (query: string, size: number) =>
  `https://live.luigisbox.com/search?tracker_id=703598-939363&q=${encodeURIComponent(query)}&size=${size}`;
const SOFT_EAN = "4005900009319";
// An EAN Natura doesn't list, as natura-ean-miss.json recorded.
const MISSING_EAN = "5901234123457";
const EAN_SEARCH = searchUrl(SOFT_EAN, 5);
const MISSING_EAN_SEARCH = searchUrl(MISSING_EAN, 5);
const NAME_SEARCH = searchUrl("nivea soft 300 ml", 10);
const answers = {
  eanHit: { url: EAN_SEARCH, status: 200, body: JSON.stringify(eanHit) },
  eanMiss: { url: MISSING_EAN_SEARCH, status: 200, body: JSON.stringify(eanMiss) },
  name: { url: NAME_SEARCH, status: 200, body: JSON.stringify(nameSearch) },
} satisfies Record<string, ReplayEntry>;

// Rossmann's Nivea Soft 300 ml (rossmann-search-results.json), its brand and name in lower case, as Natura's name
// search was recorded.
const soft: LookupProduct = {
  brand: "nivea",
  name: "soft",
  sizeText: "300 ml",
  size: { value: 300, unit: "ml" },
  eans: [SOFT_EAN, "4005808890637", "5900017001234"],
};

/**
 * A real gate over a fetch that answers only the given recordings, which allows every reservation unless `reserve`
 * answers otherwise.
 */
function setup(
  entries: ReplayEntry[],
  reserve: ShopGateDeps["reserve"] = () => Promise.resolve({ outcome: "allowed" }),
) {
  const fetchMock = vi.fn(createReplayFetch(entries));
  const gate = createShopGate({
    reserve,
    reportBlock: () => Promise.resolve(),
    fetch: fetchMock,
    log: () => undefined,
  });
  return { gate, fetchMock };
}

/** Every URL the fetch was asked for: a miss would look like a network failure, so each test checks its requests. */
function requestedUrls(fetchMock: Mock<typeof fetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : new URL(input).href));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupInNatura: by EAN", () => {
  it("accepts Natura's item after the EAN search alone", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);

    const lookup = await lookupInNatura(gate, soft);

    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    expect(lookup).toMatchObject({ kind: "accepted", candidate: { shop: "natura", shopItemId: "NV89063" } });
  });

  it("asks the user when the EAN finds the product in another size", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);

    const lookup = await lookupInNatura(gate, { ...soft, sizeText: "200 ml", size: { value: 200, unit: "ml" } });

    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    expect(lookup).toMatchObject({
      kind: "choose",
      via: "ean",
      options: [
        { candidate: { shopItemId: "NV89063" }, verdict: { sharesEan: true, size: "differs", brand: "agrees" } },
      ],
    });
  });

  it("asks the user, after the same one request, when the EAN finds an item of another brand", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);

    // Natura's NV89063 shares the EAN and the size, but it's NIVEA's: another brand is never matched on its own.
    const lookup = await lookupInNatura(gate, { ...soft, brand: "Ziaja" });

    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    if (lookup.kind !== "choose") {
      throw new Error(`expected choose, got ${lookup.kind}`);
    }
    expect(lookup.via).toBe("ean");
    expect(lookup.options.map(({ candidate, verdict }) => [candidate.shopItemId, candidate.brand, verdict])).toEqual([
      ["NV89063", "NIVEA", { sharesEan: true, size: "equal", brand: "differs" }],
    ]);
  });

  it.each([
    { answer: "a 403", status: 403, reason: "stopped" },
    { answer: "a 500", status: 500, reason: "failed" },
  ])("makes no name search after $answer to the EAN search", async ({ status, reason }) => {
    const { gate, fetchMock } = setup([{ url: EAN_SEARCH, status }, answers.name]);

    expect(await lookupInNatura(gate, soft)).toEqual({ kind: "unavailable", reason });
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
  });

  it("makes no name search when none of the EAN search's hits can be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The recorded hit with its price sent as text, as if Luigi's Box had changed its format.
    const [hit] = structuredClone(eanHit.results.hits);
    const body = JSON.stringify({
      results: { hits: [{ ...hit, attributes: { ...hit.attributes, price_amount: "16.99" } }] },
    });
    const { gate, fetchMock } = setup([{ url: EAN_SEARCH, status: 200, body }, answers.name]);

    expect(await lookupInNatura(gate, soft)).toEqual({ kind: "unavailable", reason: "failed" });
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
  });
});

describe("lookupInNatura: by name", () => {
  it("follows an EAN that finds nothing with one name search", async () => {
    const { gate, fetchMock } = setup([answers.eanMiss, answers.name]);

    // Natura doesn't list the product's first EAN, but its item carries the second one.
    const lookup = await lookupInNatura(gate, { ...soft, eans: [MISSING_EAN, SOFT_EAN] });

    expect(requestedUrls(fetchMock)).toEqual([MISSING_EAN_SEARCH, NAME_SEARCH]);
    expect(lookup).toMatchObject({ kind: "accepted", candidate: { shopItemId: "NV89063" } });
  });

  it("offers the name search's candidates when none of them shares an EAN", async () => {
    const { gate, fetchMock } = setup([answers.eanMiss, answers.name]);

    const lookup = await lookupInNatura(gate, { ...soft, eans: [MISSING_EAN] });

    expect(requestedUrls(fetchMock)).toEqual([MISSING_EAN_SEARCH, NAME_SEARCH]);
    if (lookup.kind !== "choose") {
      throw new Error(`expected choose, got ${lookup.kind}`);
    }
    expect(lookup.via).toBe("name");
    // The product is "nivea": Natura's NIVEA agrees, its sub-brand NIVEA MEN too, and YOPE differs.
    expect(lookup.options.map(({ candidate, verdict }) => [candidate.shopItemId, verdict])).toEqual([
      ["NV89063", { sharesEan: false, size: "equal", brand: "agrees" }],
      ["JM00370", { sharesEan: false, size: "equal", brand: "differs" }],
      ["NV81063", { sharesEan: false, size: "differs", brand: "agrees" }],
    ]);
  });

  it.each([
    { why: "no EAN", eans: [] },
    { why: "no EAN of 8-14 digits", eans: ["12345", "EAN 4005900009319"] },
  ])("goes straight to the name search with $why", async ({ eans }) => {
    const { gate, fetchMock } = setup([answers.name]);

    const lookup = await lookupInNatura(gate, { ...soft, eans });

    expect(requestedUrls(fetchMock)).toEqual([NAME_SEARCH]);
    expect(lookup).toMatchObject({ kind: "choose", via: "name" });
  });
});

describe("lookupInNatura: nothing found", () => {
  it("reports not-found when neither search finds anything, and logs it without the product's data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The recorded empty answer serves the name search too.
    const unknownNameSearch = searchUrl("zzqqxxjj", 10);
    const { gate, fetchMock } = setup([
      answers.eanMiss,
      { url: unknownNameSearch, status: 200, body: JSON.stringify(eanMiss) },
    ]);
    const product = { brand: null, name: "zzqqxxjj", sizeText: null, size: null, eans: [MISSING_EAN] };

    expect(await lookupInNatura(gate, product)).toEqual({ kind: "not-found" });
    expect(requestedUrls(fetchMock)).toEqual([MISSING_EAN_SEARCH, unknownNameSearch]);
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0][0]);
    const line: unknown = JSON.parse(text);
    expect(line).toMatchObject({ event: "natura-lookup", searchedByEan: true, searchedByName: true });
    expect(text).not.toContain(MISSING_EAN);
    expect(text).not.toContain("zzqqxxjj");
  });

  it.each([
    { why: "without an EAN", eans: [], requests: [] },
    { why: "after an EAN that finds nothing", eans: [MISSING_EAN], requests: [MISSING_EAN_SEARCH] },
  ])("makes no request for a name that can't be searched, $why", async ({ eans, requests }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([answers.eanMiss]);

    const lookup = await lookupInNatura(gate, { brand: null, name: "?", sizeText: null, size: null, eans });

    expect(lookup).toEqual({ kind: "not-found" });
    expect(requestedUrls(fetchMock)).toEqual(requests);
  });
});

/** The items a choice offers, in its order, with their verdicts; anything but candidates fails the test. */
function offered(choices: NaturaChoices) {
  if (choices.kind !== "choices") {
    throw new Error(`expected choices, got ${choices.kind}`);
  }
  return choices.options.map(({ candidate, verdict }) => [candidate.shopItemId, verdict]);
}

describe("lookupChoicesInNatura: both searches", () => {
  it("asks by EAN, then by name, and offers each item once, never accepting one on its own", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);

    // The EAN search alone finds the product's own item, which lookupInNatura would accept: the choice only offers it,
    // and the name search's look-alikes after it. NV89063, which both searches found, comes once, as the EAN's.
    const choices = await lookupChoicesInNatura(gate, soft);

    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH, NAME_SEARCH]);
    expect(choices).toMatchObject({ kind: "choices", via: "both", incomplete: null });
    expect(offered(choices)).toEqual([
      ["NV89063", { sharesEan: true, size: "equal", brand: "agrees" }],
      ["JM00370", { sharesEan: false, size: "equal", brand: "differs" }],
      ["NV81063", { sharesEan: false, size: "differs", brand: "agrees" }],
    ]);
  });

  it("offers the name search's candidates after an EAN search that found nothing", async () => {
    const { gate, fetchMock } = setup([answers.eanMiss, answers.name]);

    const choices = await lookupChoicesInNatura(gate, { ...soft, eans: [MISSING_EAN] });

    expect(requestedUrls(fetchMock)).toEqual([MISSING_EAN_SEARCH, NAME_SEARCH]);
    expect(choices).toMatchObject({ kind: "choices", via: "name", incomplete: null });
    expect(offered(choices).map(([id]) => id)).toEqual(["NV89063", "JM00370", "NV81063"]);
  });

  it("goes straight to the name search without a usable EAN", async () => {
    const { gate, fetchMock } = setup([answers.name]);

    const choices = await lookupChoicesInNatura(gate, { ...soft, eans: ["12345"] });

    expect(requestedUrls(fetchMock)).toEqual([NAME_SEARCH]);
    expect(choices).toMatchObject({ kind: "choices", via: "name", incomplete: null });
  });

  it("offers the EAN search's candidate alone, still unaccepted, when the name can't be searched", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);

    // Without a brand, a name or a size to search by, only the EAN search runs.
    const choices = await lookupChoicesInNatura(gate, { ...soft, brand: null, name: "?", sizeText: null });

    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    expect(choices).toMatchObject({ kind: "choices", via: "ean", incomplete: null });
    expect(offered(choices)).toEqual([["NV89063", { sharesEan: true, size: "equal", brand: "unknown" }]]);
  });

  it("offers at most six, the EAN search's first", async () => {
    // The recorded hit under other SKUs: five by the EAN, and by name one of them again and three more.
    const [hit] = eanHit.results.hits;
    const hitsFor = (skus: string[]) =>
      JSON.stringify({ results: { hits: skus.map((sku) => ({ ...structuredClone(hit), url: sku })) } });
    const { gate } = setup([
      { url: EAN_SEARCH, status: 200, body: hitsFor(["NV00001", "NV00002", "NV00003", "NV00004", "NV00005"]) },
      { url: NAME_SEARCH, status: 200, body: hitsFor(["NV00003", "NV00006", "NV00007", "NV00008"]) },
    ]);

    const choices = await lookupChoicesInNatura(gate, soft);

    expect(offered(choices).map(([id]) => id)).toEqual([
      "NV00001",
      "NV00002",
      "NV00003",
      "NV00004",
      "NV00005",
      "NV00006",
    ]);
  });
});

describe("lookupChoicesInNatura: a search without an answer", () => {
  it.each<{ answer: string; entry: ReplayEntry; reason: string }>([
    { answer: "a 403", entry: { url: EAN_SEARCH, status: 403 }, reason: "stopped" },
    { answer: "a 429", entry: { url: EAN_SEARCH, status: 429 }, reason: "paused" },
    { answer: "a 500", entry: { url: EAN_SEARCH, status: 500 }, reason: "failed" },
    { answer: "a network failure", entry: { url: EAN_SEARCH, error: "network" }, reason: "failed" },
  ])("makes no name search after $answer to the EAN search, and says why", async ({ entry, reason }) => {
    const { gate, fetchMock } = setup([entry, answers.name]);

    expect(await lookupChoicesInNatura(gate, soft)).toMatchObject({ kind: "unavailable", reason });
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
  });

  it("asks nothing more when the cap leaves the EAN search no room", async () => {
    const reserve = vi.fn(() => Promise.resolve({ outcome: "capped" }));
    const { gate, fetchMock } = setup([answers.eanHit, answers.name], reserve);

    expect(await lookupChoicesInNatura(gate, soft)).toEqual({ kind: "unavailable", reason: "busy" });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(requestedUrls(fetchMock)).toEqual([]);
  });

  it.each([
    { answer: "a 500", status: 500, reason: "failed" },
    { answer: "a 403", status: 403, reason: "stopped" },
  ])(
    "keeps the EAN search's candidates, marked incomplete, after $answer to the name search",
    async ({ status, reason }) => {
      const { gate, fetchMock } = setup([answers.eanHit, { url: NAME_SEARCH, status }]);

      const choices = await lookupChoicesInNatura(gate, soft);

      expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH, NAME_SEARCH]);
      expect(choices).toMatchObject({ kind: "choices", via: "ean", incomplete: { kind: "unavailable", reason } });
      expect(offered(choices).map(([id]) => id)).toEqual(["NV89063"]);
    },
  );

  it.each<{ why: string; eans: string[]; entries: ReplayEntry[]; requests: string[]; reason: string }>([
    {
      why: "after an EAN search that found nothing",
      eans: [MISSING_EAN],
      entries: [answers.eanMiss, { url: NAME_SEARCH, status: 500 }],
      requests: [MISSING_EAN_SEARCH, NAME_SEARCH],
      reason: "failed",
    },
    {
      why: "without a usable EAN",
      eans: [],
      entries: [{ url: NAME_SEARCH, status: 403 }],
      requests: [NAME_SEARCH],
      reason: "stopped",
    },
  ])("says why a name search got no answer $why, never that nothing was found", async (fixture) => {
    const { gate, fetchMock } = setup(fixture.entries);

    expect(await lookupChoicesInNatura(gate, { ...soft, eans: fixture.eans })).toEqual({
      kind: "unavailable",
      reason: fixture.reason,
    });
    expect(requestedUrls(fetchMock)).toEqual(fixture.requests);
  });
});

describe("lookupChoicesInNatura: nothing found", () => {
  it("reports not-found when every search that ran answered with nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The recorded empty answer serves the name search too.
    const unknownNameSearch = searchUrl("zzqqxxjj", 10);
    const { gate, fetchMock } = setup([
      answers.eanMiss,
      { url: unknownNameSearch, status: 200, body: JSON.stringify(eanMiss) },
    ]);
    const product = { brand: null, name: "zzqqxxjj", sizeText: null, size: null, eans: [MISSING_EAN] };

    expect(await lookupChoicesInNatura(gate, product)).toEqual({ kind: "not-found" });
    expect(requestedUrls(fetchMock)).toEqual([MISSING_EAN_SEARCH, unknownNameSearch]);
  });

  it.each([
    { why: "without an EAN", eans: [], requests: [] },
    { why: "after an EAN that finds nothing", eans: [MISSING_EAN], requests: [MISSING_EAN_SEARCH] },
  ])("makes no request for a name that can't be searched, $why", async ({ eans, requests }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([answers.eanMiss]);

    const choices = await lookupChoicesInNatura(gate, { brand: null, name: "?", sizeText: null, size: null, eans });

    expect(choices).toEqual({ kind: "not-found" });
    expect(requestedUrls(fetchMock)).toEqual(requests);
  });
});
