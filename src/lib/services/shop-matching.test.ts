import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { MatchView } from "@/lib/services/match-view";
import type { MatchesRead } from "@/lib/services/matches";
import type { MatchableShop } from "@/lib/services/price-comparison";
import { createShopGate, type ShopGate, type ShopGateDeps } from "@/lib/services/shop-gate";
import {
  lookupChoicesInShop,
  lookupInShop,
  runMatchSteps,
  type LookupProduct,
  type MatchStepsInput,
} from "@/lib/services/shop-matching";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import hebeEanOffline from "@/lib/services/shops/fixtures/hebe-ean-offline.json";
import hebeEanOnline from "@/lib/services/shops/fixtures/hebe-ean-online.json";
import hebeNameSearch from "@/lib/services/shops/fixtures/hebe-name-search.json";
import eanHit from "@/lib/services/shops/fixtures/natura-ean-hit.json";
import eanMiss from "@/lib/services/shops/fixtures/natura-ean-miss.json";
import nameSearch from "@/lib/services/shops/fixtures/natura-name-search.json";
import superPharmNameSearchOne from "@/lib/services/shops/fixtures/super-pharm-name-search-one.json";
import superPharmNameSearch from "@/lib/services/shops/fixtures/super-pharm-name-search.json";
import superPharmEmpty from "@/lib/services/shops/fixtures/super-pharm-search-empty.json";
import type { ShopChoices, ShopLookup, ShopMatch, WatchlistProduct } from "@/types";

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

describe("lookupInShop in Natura: by EAN", () => {
  it("accepts Natura's item after the EAN search alone", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);

    const lookup = await lookupInShop("natura", gate, soft);

    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    expect(lookup).toMatchObject({ kind: "accepted", candidate: { shop: "natura", shopItemId: "NV89063" } });
  });

  it("asks the user when the EAN finds the product in another size", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);

    const lookup = await lookupInShop("natura", gate, {
      ...soft,
      sizeText: "200 ml",
      size: { value: 200, unit: "ml" },
    });

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
    const lookup = await lookupInShop("natura", gate, { ...soft, brand: "Ziaja" });

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

    expect(await lookupInShop("natura", gate, soft)).toEqual({ kind: "unavailable", reason });
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

    expect(await lookupInShop("natura", gate, soft)).toEqual({ kind: "unavailable", reason: "failed" });
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
  });
});

describe("lookupInShop in Natura: by name", () => {
  it("follows an EAN that finds nothing with one name search", async () => {
    const { gate, fetchMock } = setup([answers.eanMiss, answers.name]);

    // Natura doesn't list the product's first EAN, but its item carries the second one.
    const lookup = await lookupInShop("natura", gate, { ...soft, eans: [MISSING_EAN, SOFT_EAN] });

    expect(requestedUrls(fetchMock)).toEqual([MISSING_EAN_SEARCH, NAME_SEARCH]);
    expect(lookup).toMatchObject({ kind: "accepted", candidate: { shopItemId: "NV89063" } });
  });

  it("offers the name search's candidates when none of them shares an EAN", async () => {
    const { gate, fetchMock } = setup([answers.eanMiss, answers.name]);

    const lookup = await lookupInShop("natura", gate, { ...soft, eans: [MISSING_EAN] });

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

    const lookup = await lookupInShop("natura", gate, { ...soft, eans });

    expect(requestedUrls(fetchMock)).toEqual([NAME_SEARCH]);
    expect(lookup).toMatchObject({ kind: "choose", via: "name" });
  });
});

describe("lookupInShop in Natura: nothing found", () => {
  it("reports not-found when neither search finds anything, and logs it without the product's data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The recorded empty answer serves the name search too.
    const unknownNameSearch = searchUrl("zzqqxxjj", 10);
    const { gate, fetchMock } = setup([
      answers.eanMiss,
      { url: unknownNameSearch, status: 200, body: JSON.stringify(eanMiss) },
    ]);
    const product = { brand: null, name: "zzqqxxjj", sizeText: null, size: null, eans: [MISSING_EAN] };

    expect(await lookupInShop("natura", gate, product)).toEqual({ kind: "not-found" });
    expect(requestedUrls(fetchMock)).toEqual([MISSING_EAN_SEARCH, unknownNameSearch]);
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0][0]);
    const line: unknown = JSON.parse(text);
    expect(line).toMatchObject({ event: "shop-lookup", shop: "natura", searchedByEan: true, searchedByName: true });
    expect(text).not.toContain(MISSING_EAN);
    expect(text).not.toContain("zzqqxxjj");
  });

  it.each([
    { why: "without an EAN", eans: [], requests: [] },
    { why: "after an EAN that finds nothing", eans: [MISSING_EAN], requests: [MISSING_EAN_SEARCH] },
  ])("makes no request for a name that can't be searched, $why", async ({ eans, requests }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([answers.eanMiss]);

    const lookup = await lookupInShop("natura", gate, { brand: null, name: "?", sizeText: null, size: null, eans });

    expect(lookup).toEqual({ kind: "not-found" });
    expect(requestedUrls(fetchMock)).toEqual(requests);
  });
});

/** The items a choice offers, in its order, with their verdicts; anything but candidates fails the test. */
function offered(choices: ShopChoices) {
  if (choices.kind !== "choices") {
    throw new Error(`expected choices, got ${choices.kind}`);
  }
  return choices.options.map(({ candidate, verdict }) => [candidate.shopItemId, verdict]);
}

describe("lookupChoicesInShop in Natura: both searches", () => {
  it("asks by EAN, then by name, and offers each item once, never accepting one on its own", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);

    // The EAN search alone finds the product's own item, which lookupInShop would accept: the choice only offers it,
    // and the name search's look-alikes after it. NV89063, which both searches found, comes once, as the EAN's.
    const choices = await lookupChoicesInShop("natura", gate, soft);

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

    const choices = await lookupChoicesInShop("natura", gate, { ...soft, eans: [MISSING_EAN] });

    expect(requestedUrls(fetchMock)).toEqual([MISSING_EAN_SEARCH, NAME_SEARCH]);
    expect(choices).toMatchObject({ kind: "choices", via: "name", incomplete: null });
    expect(offered(choices).map(([id]) => id)).toEqual(["NV89063", "JM00370", "NV81063"]);
  });

  it("goes straight to the name search without a usable EAN", async () => {
    const { gate, fetchMock } = setup([answers.name]);

    const choices = await lookupChoicesInShop("natura", gate, { ...soft, eans: ["12345"] });

    expect(requestedUrls(fetchMock)).toEqual([NAME_SEARCH]);
    expect(choices).toMatchObject({ kind: "choices", via: "name", incomplete: null });
  });

  it("offers the EAN search's candidate alone, still unaccepted, when the name can't be searched", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);

    // Without a brand, a name or a size to search by, only the EAN search runs.
    const choices = await lookupChoicesInShop("natura", gate, { ...soft, brand: null, name: "?", sizeText: null });

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

    const choices = await lookupChoicesInShop("natura", gate, soft);

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

describe("lookupChoicesInShop in Natura: a search without an answer", () => {
  it.each<{ answer: string; entry: ReplayEntry; reason: string }>([
    { answer: "a 403", entry: { url: EAN_SEARCH, status: 403 }, reason: "stopped" },
    { answer: "a 429", entry: { url: EAN_SEARCH, status: 429 }, reason: "paused" },
    { answer: "a 500", entry: { url: EAN_SEARCH, status: 500 }, reason: "failed" },
    { answer: "a network failure", entry: { url: EAN_SEARCH, error: "network" }, reason: "failed" },
  ])("makes no name search after $answer to the EAN search, and says why", async ({ entry, reason }) => {
    const { gate, fetchMock } = setup([entry, answers.name]);

    expect(await lookupChoicesInShop("natura", gate, soft)).toMatchObject({ kind: "unavailable", reason });
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
  });

  it("asks nothing more when the cap leaves the EAN search no room", async () => {
    const reserve = vi.fn(() => Promise.resolve({ outcome: "capped" }));
    const { gate, fetchMock } = setup([answers.eanHit, answers.name], reserve);

    expect(await lookupChoicesInShop("natura", gate, soft)).toEqual({ kind: "unavailable", reason: "busy" });
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

      const choices = await lookupChoicesInShop("natura", gate, soft);

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

    expect(await lookupChoicesInShop("natura", gate, { ...soft, eans: fixture.eans })).toEqual({
      kind: "unavailable",
      reason: fixture.reason,
    });
    expect(requestedUrls(fetchMock)).toEqual(fixture.requests);
  });
});

describe("lookupChoicesInShop in Natura: nothing found", () => {
  it("reports not-found when every search that ran answered with nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The recorded empty answer serves the name search too.
    const unknownNameSearch = searchUrl("zzqqxxjj", 10);
    const { gate, fetchMock } = setup([
      answers.eanMiss,
      { url: unknownNameSearch, status: 200, body: JSON.stringify(eanMiss) },
    ]);
    const product = { brand: null, name: "zzqqxxjj", sizeText: null, size: null, eans: [MISSING_EAN] };

    expect(await lookupChoicesInShop("natura", gate, product)).toEqual({ kind: "not-found" });
    expect(requestedUrls(fetchMock)).toEqual([MISSING_EAN_SEARCH, unknownNameSearch]);
  });

  it.each([
    { why: "without an EAN", eans: [], requests: [] },
    { why: "after an EAN that finds nothing", eans: [MISSING_EAN], requests: [MISSING_EAN_SEARCH] },
  ])("makes no request for a name that can't be searched, $why", async ({ eans, requests }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setup([answers.eanMiss]);

    const choices = await lookupChoicesInShop("natura", gate, {
      brand: null,
      name: "?",
      sizeText: null,
      size: null,
      eans,
    });

    expect(choices).toEqual({ kind: "not-found" });
    expect(requestedUrls(fetchMock)).toEqual(requests);
  });
});

// Hebe answers with its own recordings (hebe.test.ts says when each was made), through its own tracker: the registry
// gives each shop its own adapter, so a lookup in Hebe asks Hebe's tracker and is charged to Hebe.
const hebeSearchUrl = (query: string, size: number) =>
  `https://live.luigisbox.com/search?tracker_id=421168-505233&q=${encodeURIComponent(query)}&size=${size}`;
// Nivea Soft 200 ml, sold online, and the 300 ml one's EAN, whose only hit Hebe doesn't sell online.
const HEBE_SOFT_200 = "000000000000218807";
const SOFT_200_EAN = "4005900008299";
const HEBE_EAN_SEARCH = hebeSearchUrl(SOFT_200_EAN, 5);
const HEBE_OFFLINE_EAN_SEARCH = hebeSearchUrl(SOFT_EAN, 5);
const HEBE_NAME_SEARCH = hebeSearchUrl("nivea soft", 10);
const hebeAnswers = {
  ean: { url: HEBE_EAN_SEARCH, status: 200, body: JSON.stringify(hebeEanOnline) },
  offlineEan: { url: HEBE_OFFLINE_EAN_SEARCH, status: 200, body: JSON.stringify(hebeEanOffline) },
  name: { url: HEBE_NAME_SEARCH, status: 200, body: JSON.stringify(hebeNameSearch) },
} satisfies Record<string, ReplayEntry>;

// Nivea Soft 200 ml, the product whose EAN hebe-ean-online.json searched for. Its name alone is the text the recorded
// name search asked for, and it names no brand, which then says nothing either way.
const soft200: LookupProduct = {
  brand: null,
  name: "nivea soft",
  sizeText: null,
  size: { value: 200, unit: "ml" },
  eans: [SOFT_200_EAN],
};

/** A real gate over the given recordings, with a reservation that remembers which shop each slot was asked for. */
function setupCharged(entries: ReplayEntry[]) {
  const reserve = vi.fn<ShopGateDeps["reserve"]>(() => Promise.resolve({ outcome: "allowed" }));
  return { ...setup(entries, reserve), reserve };
}

describe("lookups in Hebe, through Hebe's own adapter", () => {
  it("accepts Hebe's item after the EAN search alone, asked of Hebe's tracker and charged to Hebe", async () => {
    const { gate, fetchMock, reserve } = setupCharged([hebeAnswers.ean, hebeAnswers.name]);

    const lookup = await lookupInShop("hebe", gate, soft200);

    expect(requestedUrls(fetchMock)).toEqual([HEBE_EAN_SEARCH]);
    expect(reserve.mock.calls).toEqual([["hebe"]]);
    expect(lookup).toMatchObject({ kind: "accepted", candidate: { shop: "hebe", shopItemId: HEBE_SOFT_200 } });
  });

  it("offers the choice from Hebe's EAN and name searches, each item once, the EAN search's first", async () => {
    const { gate, fetchMock, reserve } = setupCharged([hebeAnswers.ean, hebeAnswers.name]);

    const choices = await lookupChoicesInShop("hebe", gate, soft200);

    expect(requestedUrls(fetchMock)).toEqual([HEBE_EAN_SEARCH, HEBE_NAME_SEARCH]);
    expect(reserve.mock.calls).toEqual([["hebe"], ["hebe"]]);
    expect(choices).toMatchObject({ kind: "choices", via: "both", incomplete: null });
    expect(offered(choices).map(([id]) => id)).toEqual([
      HEBE_SOFT_200,
      "000000000000255134",
      "000000000000742817",
      "000000000000218607",
    ]);
  });

  it("logs a lookup that found nothing under Hebe's name, never the product's data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = setupCharged([hebeAnswers.offlineEan]);

    // The EAN's only item isn't sold online, and a name that can't be searched isn't.
    const lookup = await lookupInShop("hebe", gate, {
      brand: null,
      name: "?",
      sizeText: null,
      size: null,
      eans: [SOFT_EAN],
    });

    expect(lookup).toEqual({ kind: "not-found" });
    expect(requestedUrls(fetchMock)).toEqual([HEBE_OFFLINE_EAN_SEARCH]);
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0][0]);
    const line: unknown = JSON.parse(text);
    expect(line).toMatchObject({ event: "shop-lookup", shop: "hebe", searchedByEan: true, searchedByName: false });
    expect(text).not.toContain(SOFT_EAN);
  });
});

// Super-Pharm answers with its own recordings (super-pharm.test.ts says when each was made), through the real gate.
// Every Super-Pharm search is a POST to one URL, so each recording is served for the exact body it answers, spelled out
// as the adapter sends it. Its index holds no EAN, so it's looked up on request (MATCH_MODES): by name alone, never by
// EAN, and no candidate is accepted on its own. It isn't switched on yet, so each test names it.
const SUPER_PHARM_URL = "https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query";
/**
 * A Super-Pharm search's body, as the adapter sends it: the query form-encoded (a space as "+"), as many hits as asked
 * for, out of the search analytics, only the attributes a candidate shows, and no highlighting.
 */
const superPharmSearchBody = (encodedQuery: string, size: number) =>
  `{"params":"query=${encodedQuery}&hitsPerPage=${size}&analytics=false` +
  "&attributesToRetrieve=name%2Cbrand%2Ccapacity%2Curl%2Cthumbnail_url%2Cprice%2Cin_stock%2CinStoreOnly" +
  '&attributesToHighlight=%5B%5D"}';
// The name searches the products below make, 10 hits each, as every lookup's search by name asks for.
const SP_SOFT_SEARCH = superPharmSearchBody("NIVEA+Soft+300+ml", 10);
const SP_CREAM_SEARCH = superPharmSearchBody("NIVEA+krem", 10);
const SP_UNKNOWN_SEARCH = superPharmSearchBody("zzqqxxjj", 10);
const superPharmAnswers = {
  // Research probe P3 differs from the adapter's own request for "NIVEA Soft 300 ml" only in parameters that trim an
  // answer, so it's served for that request, as super-pharm.test.ts serves it: one hit, Nivea Soft 300 ml (10132).
  soft: {
    url: SUPER_PHARM_URL,
    requestBody: SP_SOFT_SEARCH,
    status: 200,
    body: JSON.stringify(superPharmNameSearchOne),
  },
  // The adapter's own search for "NIVEA krem", as recorded: two hand creams, Nivea Soft 300 ml, then two more.
  cream: {
    url: SUPER_PHARM_URL,
    requestBody: SP_CREAM_SEARCH,
    status: 200,
    body: JSON.stringify(superPharmNameSearch),
  },
  // The recorded empty answer (probe P5) serves a search by name that finds nothing too.
  unknown: { url: SUPER_PHARM_URL, requestBody: SP_UNKNOWN_SEARCH, status: 200, body: JSON.stringify(superPharmEmpty) },
} satisfies Record<string, ReplayEntry>;

// Rossmann's Nivea Soft 300 ml, with its EANs, named as probe P3 searched for it.
const spSoft: LookupProduct = { ...soft, brand: "NIVEA", name: "Soft" };
// Nivea Soft 300 ml, named as the recorded "NIVEA krem" search asked: its size judges the candidates, though it isn't
// searched for.
const spCream: LookupProduct = {
  brand: "NIVEA",
  name: "krem",
  sizeText: null,
  size: { value: 300, unit: "ml" },
  eans: [SOFT_EAN],
};

/**
 * Every request the fetch was asked for, as its method, URL and body: a Super-Pharm search says in its body what it
 * asks for.
 */
function sentRequests(fetchMock: Mock<typeof fetch>) {
  return fetchMock.mock.calls.map(([input, init]) => ({
    method: init?.method,
    url: input instanceof Request ? input.url : new URL(input).href,
    body: init?.body,
  }));
}

/** A Super-Pharm search with the given body, as the fetch is asked for it. */
const spSearch = (body: string) => ({ method: "POST", url: SUPER_PHARM_URL, body });

/** The items a first lookup's choice offers, in its order, with their verdicts; any other answer fails the test. */
function lookupOptions(lookup: ShopLookup) {
  if (lookup.kind !== "choose") {
    throw new Error(`expected choose, got ${lookup.kind}`);
  }
  return lookup.options.map(({ candidate, verdict }) => [candidate.shopItemId, verdict]);
}

// Both lookups, which in Super-Pharm make the same one search.
const SUPER_PHARM_LOOKUPS = [
  { lookup: "lookupInShop", run: lookupInShop },
  { lookup: "lookupChoicesInShop", run: lookupChoicesInShop },
];

describe("lookups in Super-Pharm, looked up on request: one search, by name", () => {
  it("sends only the name search, though the product has an EAN, and never accepts an item on its own", async () => {
    const { gate, fetchMock, reserve } = setupCharged([superPharmAnswers.soft]);

    const lookup = await lookupInShop("super-pharm", gate, spSoft);

    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_SOFT_SEARCH)]);
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    // Nivea Soft 300 ml has the product's size and brand, but shares no EAN with it: Super-Pharm's index holds none.
    expect(lookup).toMatchObject({ kind: "choose", via: "name" });
    expect(lookupOptions(lookup)).toEqual([["10132", { sharesEan: false, size: "equal", brand: "agrees" }]]);
  });

  it("offers its likeliest items first: the product's size and brand ahead of Super-Pharm's order", async () => {
    const { gate, fetchMock } = setupCharged([superPharmAnswers.cream]);

    const lookup = await lookupInShop("super-pharm", gate, spCream);

    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_CREAM_SEARCH)]);
    expect(lookup).toMatchObject({ kind: "choose", via: "name" });
    // Super-Pharm answered with two hand creams first; Nivea Soft 300 ml leads the choice of three.
    expect(lookupOptions(lookup)).toEqual([
      ["10132", { sharesEan: false, size: "equal", brand: "agrees" }],
      ["96276", { sharesEan: false, size: "differs", brand: "agrees" }],
      ["96278", { sharesEan: false, size: "differs", brand: "agrees" }],
    ]);
  });

  it("opens the re-pin's choice from the same one search, every item in Super-Pharm's order", async () => {
    const { gate, fetchMock, reserve } = setupCharged([superPharmAnswers.cream]);

    const choices = await lookupChoicesInShop("super-pharm", gate, spCream);

    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_CREAM_SEARCH)]);
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    expect(choices).toMatchObject({ kind: "choices", via: "name", incomplete: null });
    expect(offered(choices).map(([id]) => id)).toEqual(["96276", "96278", "10132", "58823", "47977"]);
  });

  it.each(SUPER_PHARM_LOOKUPS)(
    "$lookup reports not-found when its one search finds nothing, and logs that no EAN search ran",
    async ({ run }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock } = setupCharged([superPharmAnswers.unknown]);
      const product = { brand: null, name: "zzqqxxjj", sizeText: null, size: null, eans: [SOFT_EAN] };

      expect(await run("super-pharm", gate, product)).toEqual({ kind: "not-found" });
      expect(sentRequests(fetchMock)).toEqual([spSearch(SP_UNKNOWN_SEARCH)]);
      expect(warn).toHaveBeenCalledTimes(1);
      const text = String(warn.mock.calls[0][0]);
      const line: unknown = JSON.parse(text);
      expect(line).toEqual({
        event: "shop-lookup",
        shop: "super-pharm",
        reason: "nothing found for the EAN or name",
        searchedByEan: false,
        searchedByName: true,
      });
      expect(text).not.toContain(SOFT_EAN);
      expect(text).not.toContain("zzqqxxjj");
    },
  );

  it.each(SUPER_PHARM_LOOKUPS)(
    "$lookup asks nothing when the name can't be searched, though the product has an EAN",
    async ({ run }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock } = setupCharged([superPharmAnswers.unknown]);
      const product = { brand: null, name: "?", sizeText: null, size: null, eans: [SOFT_EAN] };

      expect(await run("super-pharm", gate, product)).toEqual({ kind: "not-found" });
      expect(fetchMock).not.toHaveBeenCalled();
      const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
      expect(line).toMatchObject({ shop: "super-pharm", searchedByEan: false, searchedByName: false });
    },
  );

  it.each(SUPER_PHARM_LOOKUPS)(
    "$lookup says why its one search got no answer, never that nothing was found",
    async ({ run }) => {
      const { gate, fetchMock } = setupCharged([{ url: SUPER_PHARM_URL, requestBody: SP_CREAM_SEARCH, status: 500 }]);

      expect(await run("super-pharm", gate, spCream)).toEqual({ kind: "unavailable", reason: "failed" });
      expect(sentRequests(fetchMock)).toEqual([spSearch(SP_CREAM_SEARCH)]);
    },
  );
});

// The product page's steps for its matched shops (runMatchSteps), on Natura's and Hebe's recordings together, through
// the real gate. Both are switched on, so each test runs the page's own list of shops, Natura's step first.
const PRODUCT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const PLAIN_PAGE = `/watchlist/${PRODUCT_ID}`;
// What a shop's card says when its step threw: the shop gave no answer.
const HEBE_FAILED = "Wyszukiwarka sklepu Hebe jest chwilowo niedostępna. Spróbuj za chwilę.";
const NATURA_FAILED = "Wyszukiwarka sklepu Natura jest chwilowo niedostępna. Spróbuj za chwilę.";

/** A watched product picked in Rossmann, with a lookup's fields. */
function watched(fields: LookupProduct): WatchlistProduct {
  return {
    id: PRODUCT_ID,
    source: "rossmann",
    sourceItemId: "26900",
    caption: null,
    imageUrl: null,
    productUrl: null,
    addedAt: "2026-09-20T08:00:00.000Z",
    ...fields,
  };
}

// Nivea Soft 300 ml, named as Hebe's recorded name search asked for it: Natura's EAN search accepts Natura's item,
// while Hebe's only hit for the EAN isn't sold online, so Hebe searches by name and leaves the choice to the user.
const softInBoth = watched({
  brand: null,
  name: "nivea soft",
  sizeText: null,
  size: { value: 300, unit: "ml" },
  eans: [SOFT_EAN],
});

/** The product's stored decisions as listMatches reads them when every row can be read. */
const stored = (...matches: ShopMatch[]): MatchesRead => ({ matches, unreadable: [] });

// Natura's stored decisions for the product.
const DECIDED = { watchlistItemId: PRODUCT_ID, shop: "natura", checkedAt: "2026-09-27T19:45:12+00:00" } as const;
const naturaNotFound: ShopMatch = { ...DECIDED, decidedBy: "auto", state: "not_found", item: null };
const naturaMatched: ShopMatch = {
  ...DECIDED,
  decidedBy: "auto",
  state: "matched",
  item: {
    shopItemId: "NV89063",
    brand: "NIVEA",
    name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
    sizeText: "300 ml",
    size: { value: 300, unit: "ml" },
    eans: [SOFT_EAN],
    productUrl: null,
    imageUrl: null,
  },
};

/** One builder call a query made, such as `["insert", row]`. */
type Call = [method: string, ...args: unknown[]];

interface Answer {
  data?: unknown;
  error?: { code: string; message: string };
}

interface QueryStub {
  insert: (row: unknown) => QueryStub;
  update: (fields: unknown) => QueryStub;
  select: (columns: string) => QueryStub;
  eq: (column: string, value: unknown) => QueryStub;
  abortSignal: (signal: AbortSignal) => Promise<{ data: unknown; error: Answer["error"] | null }>;
}

/**
 * A client whose queries succeed, unless `answer` gives another answer by the query's table and its first call (an
 * insert or an update), or makes it throw. Every builder call is recorded, so a test sees what each step stored.
 */
function stubClient(answer: (table: string, first: string | undefined) => Answer | "throw" = () => ({})) {
  const queries: Call[][] = [];
  const from = (table: string): QueryStub => {
    const calls: Call[] = [["from", table]];
    queries.push(calls);
    const query: QueryStub = {
      insert: (row) => {
        calls.push(["insert", row]);
        return query;
      },
      update: (fields) => {
        calls.push(["update", fields]);
        return query;
      },
      select: (columns) => {
        calls.push(["select", columns]);
        return query;
      },
      eq: (column, value) => {
        calls.push(["eq", column, value]);
        return query;
      },
      abortSignal: () => {
        const reply = answer(table, calls.at(1)?.[0]);
        if (reply === "throw") {
          return Promise.reject(new TypeError("fetch failed"));
        }
        return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
      },
    };
    return query;
  };
  return { client: { from } as unknown as SupabaseClient, queries };
}

/** What the steps stored: each query's table, its first call and that call's row. */
const writesOf = (queries: Call[][]) => queries.map((calls) => [calls[0][1], ...(calls.at(1) ?? [])]);

/** The shop a Luigi's Box URL asks, by its tracker id. */
const trackerShop = (url: string): "natura" | "hebe" => (url.includes("tracker_id=421168-505233") ? "hebe" : "natura");

/**
 * A real gate over a fetch that answers the recordings a moment after each request, so requests sent together overlap,
 * and keeps the most requests in flight at once, in all and to each shop.
 */
function slowGate(entries: ReplayEntry[]) {
  const replay = createReplayFetch(entries);
  const inFlight: ("natura" | "hebe")[] = [];
  const most = { all: 0, natura: 0, hebe: 0 };
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const shop = trackerShop(input instanceof Request ? input.url : new URL(input).href);
    inFlight.push(shop);
    most.all = Math.max(most.all, inFlight.length);
    most[shop] = Math.max(most[shop], inFlight.filter((each) => each === shop).length);
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return await replay(input, init);
    } finally {
      inFlight.splice(inFlight.indexOf(shop), 1);
    }
  });
  const reserve = vi.fn<ShopGateDeps["reserve"]>(() => Promise.resolve({ outcome: "allowed" }));
  const gate = createShopGate({
    reserve,
    reportBlock: () => Promise.resolve(),
    fetch: fetchMock,
    log: () => undefined,
  });
  return { gate, fetchMock, reserve, most };
}

/** A gate that throws for `shop`, as a gate given a URL that isn't the shop's does, and passes the others on. */
const throwingFor = (shop: MatchableShop, gate: ShopGate): ShopGate => ({
  fetch: (shopId, url, init) =>
    shopId === shop
      ? Promise.reject(new TypeError(`${String(url)} is not a ${shop} URL`))
      : gate.fetch(shopId, url, init),
});

/** The page opened plainly, by the user's own navigation, for the product without decisions, in both shops. */
function opened(fields: Pick<MatchStepsInput, "supabase" | "gate"> & Partial<MatchStepsInput>): MatchStepsInput {
  return {
    product: softInBoth,
    matches: stored(),
    retryShop: null,
    repinShop: null,
    ownNavigation: true,
    filter: "all",
    ...fields,
  };
}

/** The lines the steps logged, read back as JSON. */
const loggedLines = (warn: Mock) => warn.mock.calls.map(([text]) => JSON.parse(String(text)) as unknown);

/** The items a first choice offers, in its order; any other view fails the test. */
function choiceIds(view: MatchView): string[] {
  if (view.kind !== "choose") {
    throw new Error(`expected choose, got ${view.kind}`);
  }
  return view.options.map(({ candidate }) => candidate.shopItemId);
}

describe("runMatchSteps: each matched shop's step on the product's page", () => {
  it("looks the undecided shops up at once, one search at a time in each, and stores what the rule settled", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve, most } = slowGate([answers.eanHit, hebeAnswers.offlineEan, hebeAnswers.name]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(opened({ supabase: client, gate }));

    expect(steps.map(({ shop, step }) => [shop, step])).toEqual([
      ["natura", { kind: "lookup", retry: false }],
      ["hebe", { kind: "lookup", retry: false }],
    ]);
    // Natura's EAN search accepts its item, which is stored with the price it came with, and its card shows it.
    expect(steps[0]).toMatchObject({
      view: {
        kind: "matched",
        note: "Dopasowano automatycznie: ten sam EAN i rozmiar.",
        warnings: [],
        unsaved: false,
        action: { kind: "repin", href: `${PLAIN_PAGE}?repin=natura` },
      },
      item: { shopItemId: "NV89063" },
      repin: null,
      unsaved: false,
      retried: false,
    });
    // Hebe's EAN search finds only an item it doesn't sell online, so its name search leaves the choice to the user.
    expect(steps[1]).toMatchObject({ view: { kind: "choose" }, item: null, repin: null, unsaved: false });
    expect(choiceIds(steps[1].view)).toEqual(["000000000000218807", "000000000000255134", "000000000000742817"]);
    // Each shop asked its own tracker, charged to itself: the two shops at once, each one's searches one at a time.
    expect(requestedUrls(fetchMock).filter((url) => trackerShop(url) === "natura")).toEqual([EAN_SEARCH]);
    expect(requestedUrls(fetchMock).filter((url) => trackerShop(url) === "hebe")).toEqual([
      HEBE_OFFLINE_EAN_SEARCH,
      HEBE_NAME_SEARCH,
    ]);
    expect(reserve.mock.calls.map(([shop]) => shop).sort()).toEqual(["hebe", "hebe", "natura"]);
    expect(most).toEqual({ all: 2, natura: 1, hebe: 1 });
    // Only Natura's automatic match and its first price were stored; a choice stores nothing.
    expect(writesOf(queries)).toEqual([
      [
        "watchlist_matches",
        "insert",
        expect.objectContaining({
          watchlist_item_id: PRODUCT_ID,
          shop_id: "natura",
          state: "matched",
          decided_by: "auto",
          shop_item_id: "NV89063",
        }),
      ],
      [
        "price_observations",
        "insert",
        [expect.objectContaining({ shop_id: "natura", shop_item_id: "NV89063", status: "price", price: 16.99 })],
      ],
    ]);
  });

  it("shows a shop whose lookup throws as unavailable, and keeps the other shop's result", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = slowGate([answers.eanHit, hebeAnswers.offlineEan, hebeAnswers.name]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(opened({ supabase: client, gate: throwingFor("hebe", gate) }));

    expect(steps[0]).toMatchObject({ shop: "natura", view: { kind: "matched" }, item: { shopItemId: "NV89063" } });
    expect(steps[1]).toEqual({
      shop: "hebe",
      step: { kind: "lookup", retry: false },
      view: { kind: "unavailable", message: HEBE_FAILED },
      repin: null,
      unsaved: false,
      item: null,
      retried: false,
    });
    // Hebe's search threw before any request; Natura's went ahead, and its match was stored.
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    expect(writesOf(queries).map(([table]) => table)).toEqual(["watchlist_matches", "price_observations"]);
    // The log names the shop and the error's kind, never the search.
    expect(loggedLines(warn)).toEqual([
      { event: "shop-lookup", shop: "hebe", reason: "step failed", error: "TypeError" },
    ]);
    expect(String(warn.mock.calls[0][0])).not.toContain(SOFT_EAN);
  });

  it("shows a shop whose recording throws as unavailable, and keeps the other shop's choice", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate } = slowGate([answers.eanHit, hebeAnswers.offlineEan, hebeAnswers.name]);
    // Natura's automatic match can't be written at all.
    const { client, queries } = stubClient((table) => (table === "watchlist_matches" ? "throw" : {}));

    const steps = await runMatchSteps(opened({ supabase: client, gate }));

    expect(steps[0]).toMatchObject({
      shop: "natura",
      view: { kind: "unavailable", message: NATURA_FAILED },
      item: null,
      retried: false,
    });
    expect(steps[1]).toMatchObject({ shop: "hebe", view: { kind: "choose" } });
    // No first price follows a match that wasn't stored.
    expect(writesOf(queries).map(([table]) => table)).toEqual(["watchlist_matches"]);
    expect(loggedLines(warn)).toEqual([
      { event: "shop-lookup", shop: "natura", reason: "step failed", error: "TypeError" },
    ]);
  });

  it("says a retry that stored its outcome, and gives the other shop, still undecided, only its button", async () => {
    const { gate, fetchMock } = slowGate([answers.eanHit, hebeAnswers.offlineEan, hebeAnswers.name]);
    // The stored "not found" is updated, since the product has a decision in Natura already.
    const { client, queries } = stubClient((table, first) => {
      if (table === "watchlist_matches" && first === "insert") {
        return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      return first === "update" ? { data: [{ id: "decision" }] } : {};
    });

    const steps = await runMatchSteps(
      opened({ supabase: client, gate, matches: stored(naturaNotFound), retryShop: "natura" }),
    );

    expect(steps[0]).toMatchObject({
      shop: "natura",
      step: { kind: "lookup", retry: true },
      item: { shopItemId: "NV89063" },
      retried: true,
    });
    expect(steps[1]).toEqual({
      shop: "hebe",
      step: { kind: "prompt" },
      view: { kind: "prompt", href: PLAIN_PAGE },
      repin: null,
      unsaved: false,
      item: null,
      retried: false,
    });
    // The retry asks Natura alone.
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    expect(writesOf(queries).map(([table, first]) => [table, first])).toEqual([
      ["watchlist_matches", "insert"],
      ["watchlist_matches", "update"],
      ["price_observations", "insert"],
    ]);
  });

  it("opens the re-pinned shop's choice beside its stored card, and asks the other shop nothing", async () => {
    const { gate, fetchMock } = slowGate([answers.eanHit, answers.name]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(
      opened({
        supabase: client,
        gate,
        product: watched(soft),
        matches: stored(naturaMatched),
        repinShop: "natura",
      }),
    );

    expect(steps[0]).toMatchObject({
      shop: "natura",
      step: { kind: "repin" },
      // The stored match's card, which keeps its price row and offers "Anuluj" while the choice is open.
      view: { kind: "matched", action: { kind: "cancel", href: PLAIN_PAGE } },
      item: { shopItemId: "NV89063" },
      repin: { kind: "repin", replaces: "matched:NV89063", decline: true, message: null },
    });
    expect(steps[0].repin?.options.map(({ candidate, current }) => [candidate.shopItemId, current])).toEqual([
      ["NV89063", true],
      ["JM00370", false],
      ["NV81063", false],
    ]);
    expect(steps[1]).toMatchObject({ shop: "hebe", step: { kind: "prompt" }, view: { kind: "prompt" } });
    // Natura's two searches, one after the other, and nothing stored.
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH, NAME_SEARCH]);
    expect(queries).toEqual([]);
  });

  it("keeps a re-pinned shop's card when its searches throw, and says in the choice it gave no answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = slowGate([answers.eanHit, answers.name]);
    const { client } = stubClient();

    const steps = await runMatchSteps(
      opened({
        supabase: client,
        gate: throwingFor("natura", gate),
        product: watched(soft),
        matches: stored(naturaMatched),
        repinShop: "natura",
      }),
    );

    expect(steps[0]).toMatchObject({
      view: { kind: "matched", action: { kind: "cancel" } },
      item: { shopItemId: "NV89063" },
      repin: { kind: "repin", options: [], decline: true, message: { text: NATURA_FAILED, warning: true } },
    });
    expect(requestedUrls(fetchMock)).toEqual([]);
    expect(loggedLines(warn)).toEqual([
      { event: "shop-lookup", shop: "natura", reason: "step failed", error: "TypeError" },
    ]);
  });

  it.each<{ why: string; input: Partial<MatchStepsInput>; views: string[] }>([
    { why: "decisions that couldn't be read", input: { matches: null }, views: ["read-failed", "read-failed"] },
    {
      why: "a decision of one shop that came back odd, beside the other's",
      input: { matches: { matches: [naturaMatched], unreadable: ["hebe"] } },
      views: ["matched", "read-failed"],
    },
    { why: "a page another site opened", input: { ownNavigation: false }, views: ["prompt", "prompt"] },
  ])("asks no shop for $why", async ({ input, views }) => {
    const { gate, fetchMock } = slowGate([answers.eanHit, hebeAnswers.offlineEan, hebeAnswers.name]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(opened({ supabase: client, gate, ...input }));

    expect(steps.map(({ view }) => view.kind)).toEqual(views);
    expect(requestedUrls(fetchMock)).toEqual([]);
    expect(queries).toEqual([]);
  });
});

// The page's shops with Super-Pharm last, as they will be once it's switched on: the steps run the shops they're given.
const WITH_SUPER_PHARM = ["natura", "hebe", "super-pharm"] as const;

describe("runMatchSteps: a shop looked up on request on the product's page", () => {
  it("gives Super-Pharm only its button, which names it, on a plain view that looks the other shops up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve } = slowGate([answers.eanHit, hebeAnswers.offlineEan, hebeAnswers.name]);
    const { client } = stubClient();

    const steps = await runMatchSteps({
      ...opened({ supabase: client, gate, filter: "check" }),
      shops: WITH_SUPER_PHARM,
    });

    expect(steps.map(({ shop, step }) => [shop, step.kind])).toEqual([
      ["natura", "lookup"],
      ["hebe", "lookup"],
      ["super-pharm", "prompt"],
    ]);
    // Its button looks it up, keeping the list's filter; nothing asked Super-Pharm.
    expect(steps[2]).toEqual({
      shop: "super-pharm",
      step: { kind: "prompt" },
      view: { kind: "prompt", href: `${PLAIN_PAGE}?f=check&retry=super-pharm` },
      repin: null,
      unsaved: false,
      item: null,
      retried: false,
    });
    expect(reserve.mock.calls.map(([shop]) => shop).sort()).toEqual(["hebe", "hebe", "natura"]);
    expect(requestedUrls(fetchMock)).not.toContain(SUPER_PHARM_URL);
  });

  it("looks Super-Pharm alone up, by name, when its button names it, and gives the other shops their buttons", async () => {
    const { gate, fetchMock, reserve } = setupCharged([superPharmAnswers.cream]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps({
      ...opened({ supabase: client, gate, product: watched(spCream), retryShop: "super-pharm" }),
      shops: WITH_SUPER_PHARM,
    });

    expect(steps.map(({ shop, step }) => [shop, step])).toEqual([
      ["natura", { kind: "prompt" }],
      ["hebe", { kind: "prompt" }],
      ["super-pharm", { kind: "lookup", retry: false }],
    ]);
    // The other shops' buttons lead to the plain page, which looks them up.
    expect(steps.slice(0, 2).map(({ view }) => view)).toEqual([
      { kind: "prompt", href: PLAIN_PAGE },
      { kind: "prompt", href: PLAIN_PAGE },
    ]);
    // Super-Pharm's first choice, found by name, the likeliest first, and nothing stored to go back from.
    expect(steps[2]).toMatchObject({
      view: {
        kind: "choose",
        intro: "Znalezione w Super-Pharmie po nazwie. Wybierz ten sam produkt albo „Żaden z nich”.",
      },
      repin: null,
      unsaved: false,
      item: null,
      retried: false,
    });
    expect(choiceIds(steps[2].view)).toEqual(["10132", "96276", "96278"]);
    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_CREAM_SEARCH)]);
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    expect(queries).toEqual([]);
  });
});
