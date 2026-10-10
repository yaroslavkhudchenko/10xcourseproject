import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { repinShopOf, retryShopOf } from "@/lib/services/match-step";
import type { MatchView } from "@/lib/services/match-view";
import type { MatchesRead } from "@/lib/services/matches";
import { pickMatch } from "@/lib/services/matching";
import { matchedShopsOf, type MatchableShop, type PricedShop } from "@/lib/services/price-comparison";
import { createShopGate, type ShopGate, type ShopGateDeps } from "@/lib/services/shop-gate";
import {
  lookupChoicesInShop,
  lookupInShop,
  nameQuery,
  runMatchSteps,
  type LookupProduct,
  type MatchStepsInput,
} from "@/lib/services/shop-matching";
import { searchRossmannItems } from "@/lib/services/shops/rossmann";
import { lookupCallArgs } from "@/lib/services/testing/record-decision";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import { CHALLENGE, loggedLines, type ServedAnswer } from "@/lib/services/testing/shop-answers";
import { loadedProductOf } from "@/lib/services/watched-product";
import hebeEanOffline from "@/lib/services/shops/fixtures/hebe-ean-offline.json";
import hebeEanOnline from "@/lib/services/shops/fixtures/hebe-ean-online.json";
import hebeIdUnknown from "@/lib/services/shops/fixtures/hebe-id-unknown.json";
import hebeNameSearch from "@/lib/services/shops/fixtures/hebe-name-search.json";
import eanHit from "@/lib/services/shops/fixtures/natura-ean-hit.json";
import eanMiss from "@/lib/services/shops/fixtures/natura-ean-miss.json";
import nameSearch from "@/lib/services/shops/fixtures/natura-name-search.json";
import naturaNiveaSoft from "@/lib/services/shops/fixtures/natura-search-nivea-soft.json";
import rossmannLookupAaLaab from "@/lib/services/shops/fixtures/rossmann-lookup-aa-laab-150.json";
import rossmannLookupCosmicBlack from "@/lib/services/shops/fixtures/rossmann-lookup-maybelline-sky-high-cosmic-black.json";
import rossmannLookupSoft from "@/lib/services/shops/fixtures/rossmann-lookup-nivea-soft-300.json";
import rossmannMascaras from "@/lib/services/shops/fixtures/rossmann-search-maybelline-lash-sensational.json";
import rossmannNiveaSoft from "@/lib/services/shops/fixtures/rossmann-search-nivea-soft.json";
import superPharmSkyHigh from "@/lib/services/shops/fixtures/super-pharm-lookup-maybelline-sky-high-7-2.json";
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
  caption: "krem uniwersalny, nawilżający",
  sizeText: "300 ml",
  size: { value: 300, unit: "ml" },
  eans: [SOFT_EAN, "4005808890637", "5900017001234"],
};

/**
 * A real gate over a fetch that answers only the given recordings, which allows every reservation unless `reserve`
 * answers otherwise. `reportBlock` shows each refusal the gate reported.
 */
function setup(
  entries: ReplayEntry[],
  reserve: ShopGateDeps["reserve"] = () => Promise.resolve({ outcome: "allowed" }),
) {
  const fetchMock = vi.fn(createReplayFetch(entries));
  const reportBlock = vi.fn<ShopGateDeps["reportBlock"]>(() => Promise.resolve());
  const gate = createShopGate({
    reserve,
    reportBlock,
    fetch: fetchMock,
    log: () => undefined,
  });
  return { gate, fetchMock, reportBlock };
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
    const product = { brand: null, name: "zzqqxxjj", caption: null, sizeText: null, size: null, eans: [MISSING_EAN] };

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

    const lookup = await lookupInShop("natura", gate, {
      brand: null,
      name: "?",
      caption: null,
      sizeText: null,
      size: null,
      eans,
    });

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
  it.each<{ answer: string; entry: ReplayEntry; reason: string; reported: unknown[][] }>([
    {
      answer: "a 403",
      entry: { url: EAN_SEARCH, status: 403 },
      reason: "stopped",
      reported: [["natura", "blocked", undefined, "HTTP 403"]],
    },
    {
      answer: "a bot challenge on a 200",
      entry: { url: EAN_SEARCH, ...CHALLENGE },
      reason: "stopped",
      reported: [["natura", "blocked", undefined, "challenge"]],
    },
    // Without a Retry-After, the gate pauses the shop for its default 900 seconds.
    {
      answer: "a 429",
      entry: { url: EAN_SEARCH, status: 429 },
      reason: "paused",
      reported: [["natura", "rate_limited", 900]],
    },
    {
      answer: "a 503 that says when to come back",
      entry: { url: EAN_SEARCH, status: 503, headers: { "Retry-After": "120" } },
      reason: "paused",
      reported: [["natura", "rate_limited", 120]],
    },
    { answer: "a 500", entry: { url: EAN_SEARCH, status: 500 }, reason: "failed", reported: [] },
    { answer: "a network failure", entry: { url: EAN_SEARCH, error: "network" }, reason: "failed", reported: [] },
  ])("makes no name search after $answer to the EAN search, and says why", async ({ entry, reason, reported }) => {
    const { gate, fetchMock, reserve, reportBlock } = setupCharged([entry, answers.name]);

    expect(await lookupChoicesInShop("natura", gate, soft)).toMatchObject({ kind: "unavailable", reason });
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    // The EAN search's reservation alone, and a refusal reported once, a failure never.
    expect(reserve.mock.calls).toEqual([["natura"]]);
    expect(reportBlock.mock.calls).toEqual(reported);
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
    const product = { brand: null, name: "zzqqxxjj", caption: null, sizeText: null, size: null, eans: [MISSING_EAN] };

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
      caption: null,
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
  caption: null,
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
      caption: null,
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
// as the adapter sends it. Its index holds no EAN, so its adapter says its search can't find one (searchesByEan): its
// lookups search by name alone, never by EAN, and a candidate is accepted on its own only by the name check.
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
const SP_SKY_HIGH_SEARCH = superPharmSearchBody("Maybelline+New+York+Lash+Sensational+Sky+High+7%2C2+ml", 10);
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
  // A lookup's own search for "Maybelline New York Lash Sensational Sky High 7,2 ml", as recorded: 10 of 1,044 hits,
  // the mascara's shades of 7,2 ml in Super-Pharm's order, Burgundy Haze 5th.
  skyHigh: {
    url: SUPER_PHARM_URL,
    requestBody: SP_SKY_HIGH_SEARCH,
    status: 200,
    body: JSON.stringify(superPharmSkyHigh),
  },
  // The recorded empty answer (probe P5) serves a search by name that finds nothing too.
  unknown: { url: SUPER_PHARM_URL, requestBody: SP_UNKNOWN_SEARCH, status: 200, body: JSON.stringify(superPharmEmpty) },
} satisfies Record<string, ReplayEntry>;

// Rossmann's Nivea Soft 300 ml, with its EANs and caption, named as probe P3 searched for it.
const spSoft: LookupProduct = { ...soft, brand: "NIVEA", name: "Soft" };
// Nivea Soft 300 ml, named as the recorded "NIVEA krem" search asked, without a caption: its size judges the
// candidates, though it isn't searched for.
const spCream: LookupProduct = {
  brand: "NIVEA",
  name: "krem",
  caption: null,
  sizeText: null,
  size: { value: 300, unit: "ml" },
  eans: [SOFT_EAN],
};
// Rossmann's Sky High mascara in Burgundy (2079826), as Rossmann's search for "maybelline lash sensational" recorded it
// on 2026-10-06 (rossmann-search-maybelline-lash-sensational.json): its shade is in its caption.
const spSkyHighBurgundy: LookupProduct = {
  brand: "Maybelline New York",
  name: "Lash Sensational Sky High",
  caption: "tusz do rzęs, Burgundy",
  sizeText: "7,2 ml",
  size: { value: 7.2, unit: "ml" },
  eans: ["30144552"],
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

describe("lookups in Super-Pharm, whose search can't find an EAN: one search, by name", () => {
  it("sends only the name search, though the product has an EAN, and accepts Nivea Soft 300 ml by its name", async () => {
    const { gate, fetchMock, reserve } = setupCharged([superPharmAnswers.soft]);

    const lookup = await lookupInShop("super-pharm", gate, spSoft);

    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_SOFT_SEARCH)]);
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    // Nivea Soft 300 ml has the product's size and brand, and shares no EAN with it, since Super-Pharm's index holds
    // none: every word of its name but the brand's and "(Pudełko)" is in the product's name and caption.
    expect(lookup).toMatchObject({
      kind: "accepted",
      candidate: { shop: "super-pharm", shopItemId: "10132", eans: [] },
    });
  });

  it("offers its likeliest items first: the product's size and brand ahead of Super-Pharm's order", async () => {
    const { gate, fetchMock } = setupCharged([superPharmAnswers.cream]);

    const lookup = await lookupInShop("super-pharm", gate, spCream);

    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_CREAM_SEARCH)]);
    expect(lookup).toMatchObject({ kind: "choose", via: "name" });
    // Super-Pharm answered with two hand creams first; Nivea Soft 300 ml leads the choice of three, though not accepted:
    // its name's "Soft" and "nawilżający" are words this product, named "krem" alone, lacks.
    expect(lookupOptions(lookup)).toEqual([
      ["10132", { sharesEan: false, size: "equal", brand: "agrees" }],
      ["96276", { sharesEan: false, size: "differs", brand: "agrees" }],
      ["96278", { sharesEan: false, size: "differs", brand: "agrees" }],
    ]);
  });

  it("opens the re-pin's choice from the same one search, every item, the best name fit first", async () => {
    const { gate, fetchMock, reserve } = setupCharged([superPharmAnswers.cream]);

    const choices = await lookupChoicesInShop("super-pharm", gate, spCream);

    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_CREAM_SEARCH)]);
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    expect(choices).toMatchObject({ kind: "choices", via: "name", incomplete: null });
    // Nivea Soft 300 ml, the one item of the product's size and brand, leads the hand creams Super-Pharm listed before
    // it, and the rest keep Super-Pharm's order.
    expect(offered(choices)).toEqual([
      ["10132", { sharesEan: false, size: "equal", brand: "agrees" }],
      ["96276", { sharesEan: false, size: "differs", brand: "agrees" }],
      ["96278", { sharesEan: false, size: "differs", brand: "agrees" }],
      ["58823", { sharesEan: false, size: "differs", brand: "agrees" }],
      ["47977", { sharesEan: false, size: "differs", brand: "agrees" }],
    ]);
  });

  it("puts the right shade first in the re-pin's choice of six, where Super-Pharm's answer lists it fifth", async () => {
    const { gate, fetchMock, reserve } = setupCharged([superPharmAnswers.skyHigh]);

    const choices = await lookupChoicesInShop("super-pharm", gate, spSkyHighBurgundy);

    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_SKY_HIGH_SEARCH)]);
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    expect(choices).toMatchObject({ kind: "choices", via: "name", incomplete: null });
    // Super-Pharm listed Black, the Tinted Primer, Cosmic Black and Brown before Burgundy Haze (134305), which shares
    // the most words with the product's name and caption. Then come the other shades of 7,2 ml, fewer extra words
    // first, each tie in Super-Pharm's order; the Tinted Primer, with four, is left out of the six.
    expect(offered(choices).map(([id]) => id)).toEqual(["134305", "67655", "99681", "84422", "122681", "122725"]);
  });

  it.each(SUPER_PHARM_LOOKUPS)(
    "$lookup reports not-found when its one search finds nothing, and logs that no EAN search ran",
    async ({ run }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock } = setupCharged([superPharmAnswers.unknown]);
      const product = { brand: null, name: "zzqqxxjj", caption: null, sizeText: null, size: null, eans: [SOFT_EAN] };

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
      const product = { brand: null, name: "?", caption: null, sizeText: null, size: null, eans: [SOFT_EAN] };

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

// What a lookup's search by name asks for (nameQuery): each word once, the name after its brand unless it starts with
// it, and the size text last, in place of the size the name ends with when that's the same. The products are items as
// each shop's adapter reads them from its recordings, and Rossmann's products, whose names hold neither.
describe("nameQuery: what a lookup's search by name asks for", () => {
  it.each([
    // Rossmann's products, as Super-Pharm's recorded searches for them asked (super-pharm.test.ts).
    {
      product: "Rossmann's Nivea Soft 300 ml",
      brand: "NIVEA",
      name: "Soft",
      sizeText: "300 ml",
      query: "NIVEA Soft 300 ml",
    },
    {
      product: "Rossmann's Sky High mascara",
      brand: "Maybelline New York",
      name: "Lash Sensational Sky High",
      sizeText: "7,2 ml",
      query: "Maybelline New York Lash Sensational Sky High 7,2 ml",
    },
    // The brand is "AA", while the name starts with "LAAB".
    {
      product: "Rossmann's AA LAAB face wash",
      brand: "AA",
      name: "LAAB Skin Barrier Protection",
      sizeText: "150 ml",
      query: "AA LAAB Skin Barrier Protection 150 ml",
    },
    // Natura's titles and Hebe's legal names start with the brand and end with the size.
    {
      product: "Natura's Nivea Soft 300 ml (NV89063)",
      brand: "NIVEA",
      name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
      sizeText: "300 ml",
      query: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
    },
    {
      product: "Hebe's Nivea Soft 200 ml (218807)",
      brand: "Nivea",
      name: "Nivea Soft Lekki Krem Nawilżający, 200 ml",
      sizeText: "200 ml",
      query: "Nivea Soft Lekki Krem Nawilżający, 200 ml",
    },
    {
      product: "Hebe's AA LAAB face wash (450251)",
      brand: "AA",
      name: "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający 150 ml",
      sizeText: "150 ml",
      query: "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający 150 ml",
    },
    // Super-Pharm's names start with the brand, and its size is the record's capacity.
    {
      product: "Super-Pharm's Nivea Soft 300 ml (10132)",
      brand: "Nivea",
      name: "Nivea Soft Krem nawilżający (Pudełko)",
      sizeText: "300 ml",
      query: "Nivea Soft Krem nawilżający (Pudełko) 300 ml",
    },
    {
      product: "Super-Pharm's Sky High Cosmic Black (84422)",
      brand: "Maybelline",
      name: "Maybelline Mascara Lash Sensational Sky High Cosmic Black",
      sizeText: "7.2 ml",
      query: "Maybelline Mascara Lash Sensational Sky High Cosmic Black 7.2 ml",
    },
  ])("asks for $product by its brand, name and size, each once", ({ brand, name, sizeText, query }) => {
    expect(nameQuery({ brand, name, sizeText })).toBe(query);
  });

  it.each([
    {
      why: "in another case",
      brand: "Nivea",
      name: "NIVEA BABY Soft & Cream chusteczki",
      query: "NIVEA BABY Soft & Cream chusteczki",
    },
    {
      why: "in capitals, without its accent",
      brand: "L'Oréal Paris",
      name: "L'OREAL PARIS Elseve Szampon",
      query: "L'OREAL PARIS Elseve Szampon",
    },
  ])("names the brand once when the name starts with it $why", ({ brand, name, query }) => {
    expect(nameQuery({ brand, name, sizeText: null })).toBe(query);
  });

  it.each([
    // Super-Pharm's 105870: its brand's second word isn't the name's.
    {
      why: "all its words",
      brand: "AA Cosmetics",
      name: "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający",
      query: "AA Cosmetics AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający",
    },
    // Ziaja's line for children, whose name starts with the brand's letters, not its word.
    { why: "its word", brand: "Ziaja", name: "Ziajka krem dla dzieci", query: "Ziaja Ziajka krem dla dzieci" },
  ])("puts the brand first when the name doesn't start with $why", ({ brand, name, query }) => {
    expect(nameQuery({ brand, name, sizeText: null })).toBe(query);
  });

  it.each([
    // Natura's NV80758: its title writes the size without a space.
    {
      why: "written without a space",
      name: "Nivea Creme Soft żel pod prysznic 500ml",
      sizeText: "500 ml",
      query: "Nivea Creme Soft żel pod prysznic 500 ml",
    },
    {
      why: "in capitals, with a decimal comma",
      name: "Nivea Soft krem 7,2 ML",
      sizeText: "7.2 ml",
      query: "Nivea Soft krem 7.2 ml",
    },
  ])("names the size once, as its size text, when the name ends with it $why", ({ name, sizeText, query }) => {
    expect(nameQuery({ brand: "NIVEA", name, sizeText })).toBe(query);
  });

  it.each([
    {
      why: "another size",
      name: "Nivea Soft krem 200 ml",
      sizeText: "300 ml",
      query: "Nivea Soft krem 200 ml 300 ml",
    },
    // Natura's NV74420: a multipack's count, not a size.
    {
      why: "a multipack",
      name: "NIVEA BABY Soft & Cream chusteczki 4 x 57 sztuk",
      sizeText: "228 szt",
      query: "NIVEA BABY Soft & Cream chusteczki 4 x 57 sztuk 228 szt",
    },
  ])("adds the size text when the name ends with $why", ({ name, sizeText, query }) => {
    expect(nameQuery({ brand: "Nivea", name, sizeText })).toBe(query);
  });

  it("cuts a name over 80 characters before the size it ends with, which stays", () => {
    // Hebe's serum (450256): its legal name and size make 87 characters.
    const name = "AA LAAB 100% Centella B12 Skoncentrowane serum-ampułka nawilżająco-odbudowujące 30 ml";

    expect(nameQuery({ brand: "AA", name, sizeText: "30 ml" })).toBe(
      "AA LAAB 100% Centella B12 Skoncentrowane serum-ampułka 30 ml",
    );
  });

  it("gives null for a product with nothing to search by", () => {
    expect(nameQuery({ brand: null, name: "?", sizeText: null })).toBeNull();
  });
});

// Lookups for a product picked in another shop than Rossmann, without a caption, through the real gate, on the
// recordings that answer them: a Hebe item's EAN search, and products named as the recorded name searches asked, which
// their names already start or end with the brand and the size of, so a query that named either twice would miss them.
describe("lookups for a product picked in another shop than Rossmann", () => {
  it("accepts Hebe's item by a shared EAN for Natura's Nivea Soft 200 ml, after one request", async () => {
    const { gate, fetchMock, reserve } = setupCharged([hebeAnswers.ean, hebeAnswers.name]);

    // NV890500, as natura-search-nivea-soft.json gives it.
    const lookup = await lookupInShop("hebe", gate, {
      brand: "NIVEA",
      name: "NIVEA SOFT krem intensywnie nawilżający 200 ml",
      caption: null,
      sizeText: "200 ml",
      size: { value: 200, unit: "ml" },
      eans: [SOFT_200_EAN],
    });

    expect(requestedUrls(fetchMock)).toEqual([HEBE_EAN_SEARCH]);
    expect(reserve.mock.calls).toEqual([["hebe"]]);
    expect(lookup).toMatchObject({ kind: "accepted", candidate: { shop: "hebe", shopItemId: HEBE_SOFT_200 } });
  });

  it("searches Hebe by a name that starts with the brand without naming the brand twice", async () => {
    const { gate, fetchMock, reserve } = setupCharged([hebeAnswers.offlineEan, hebeAnswers.name]);

    // A product picked in Natura, named as Hebe's recorded name search asked, with the EAN only an item Hebe doesn't sell
    // online carries.
    const lookup = await lookupInShop("hebe", gate, {
      brand: "nivea",
      name: "nivea soft",
      caption: null,
      sizeText: null,
      size: { value: 300, unit: "ml" },
      eans: [SOFT_EAN],
    });

    expect(requestedUrls(fetchMock)).toEqual([HEBE_OFFLINE_EAN_SEARCH, HEBE_NAME_SEARCH]);
    expect(reserve.mock.calls).toEqual([["hebe"], ["hebe"]]);
    // Its items and the product's both carry EANs, none shared, so the user chooses, in Hebe's order.
    expect(lookupOptions(lookup).map(([id]) => id)).toEqual([
      HEBE_SOFT_200,
      "000000000000255134",
      "000000000000742817",
    ]);
  });

  it("searches Super-Pharm by a name that starts with the brand and ends with the size, naming each once", async () => {
    const { gate, fetchMock, reserve } = setupCharged([superPharmAnswers.soft]);

    // A product picked in Natura, named as the recorded search asked.
    const lookup = await lookupInShop("super-pharm", gate, {
      brand: "NIVEA",
      name: "NIVEA Soft 300 ml",
      caption: null,
      sizeText: "300 ml",
      size: { value: 300, unit: "ml" },
      eans: [SOFT_EAN],
    });

    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_SOFT_SEARCH)]);
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    // Nivea Soft's „Krem” and „nawilżający” are words the product's name lacks: it's offered, not accepted.
    expect(lookupOptions(lookup)).toEqual([["10132", { sharesEan: false, size: "equal", brand: "agrees" }]]);
  });

  it("searches Natura by name alone for a product without an EAN, naming its brand and size once", async () => {
    const { gate, fetchMock, reserve } = setupCharged([answers.eanHit, answers.name]);

    // A product picked in Super-Pharm, whose items carry no EAN, named as Natura's recorded name search asked.
    const lookup = await lookupInShop("natura", gate, {
      brand: "nivea",
      name: "nivea soft 300 ml",
      caption: null,
      sizeText: "300 ml",
      size: { value: 300, unit: "ml" },
      eans: [],
    });

    expect(requestedUrls(fetchMock)).toEqual([NAME_SEARCH]);
    expect(reserve.mock.calls).toEqual([["natura"]]);
    // Nivea Soft 300 ml's title has words the product's name lacks, so the user chooses, the likeliest first.
    expect(lookupOptions(lookup)).toEqual([
      ["NV89063", { sharesEan: false, size: "equal", brand: "agrees" }],
      ["JM00370", { sharesEan: false, size: "equal", brand: "differs" }],
      ["NV81063", { sharesEan: false, size: "differs", brand: "agrees" }],
    ]);
  });
});

// The product page's steps for its matched shops (runMatchSteps), on Natura's and Hebe's recordings together, through
// the real gate. Each test runs the page's own list of shops, Natura's step first and Super-Pharm's last: a plain view
// looks every shop with no decision up, Super-Pharm too, by name.
const PRODUCT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const PLAIN_PAGE = `/watchlist/${PRODUCT_ID}`;
// What a shop's card says when its step threw, or its search failed: the shop gave no answer.
const HEBE_FAILED = "Wyszukiwarka sklepu Hebe jest chwilowo niedostępna. Spróbuj za chwilę.";
const NATURA_FAILED = "Wyszukiwarka sklepu Natura jest chwilowo niedostępna. Spróbuj za chwilę.";
const SUPER_PHARM_FAILED = "Wyszukiwarka sklepu Super-Pharm jest chwilowo niedostępna. Spróbuj za chwilę.";

/** A watched product picked in Rossmann, with a lookup's fields, its caption among them. */
function watched(fields: LookupProduct): WatchlistProduct {
  return {
    id: PRODUCT_ID,
    source: "rossmann",
    sourceItemId: "26900",
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
  caption: null,
  sizeText: null,
  size: { value: 300, unit: "ml" },
  eans: [SOFT_EAN],
});
// Super-Pharm's search by name for that product, which no recording answers: a plain view of it gets a 500 there, so
// Super-Pharm is asked once, stores nothing and says it gave no answer.
const SP_SOFT_IN_BOTH_SEARCH = superPharmSearchBody("nivea+soft", 10);
const superPharmFailed = {
  url: SUPER_PHARM_URL,
  requestBody: SP_SOFT_IN_BOTH_SEARCH,
  status: 500,
} satisfies ReplayEntry;

/** The product's stored decisions as listMatches reads them when every row can be read. */
const stored = (...matches: ShopMatch[]): MatchesRead => ({ matches, unreadable: [] });

// Natura's stored decisions for the product, and the user's declines in Hebe and Super-Pharm.
const DECIDED = { watchlistItemId: PRODUCT_ID, shop: "natura", checkedAt: "2026-09-27T19:45:12+00:00" } as const;
const naturaNotFound: ShopMatch = { ...DECIDED, decidedBy: "auto", state: "not_found", item: null };
const hebeDeclined: ShopMatch = { ...DECIDED, shop: "hebe", decidedBy: "user", state: "unmatched", item: null };
const superPharmDeclined: ShopMatch = { ...hebeDeclined, shop: "super-pharm" };
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

/** One builder call a query made, such as `["insert", row]`, or a call of a function, `["rpc", name, args]`. */
type Call = [method: string, ...args: unknown[]];

interface Answer {
  data?: unknown;
  error?: { code: string; message: string };
}

/** What a query or a call is answered with, once it's given its time limit. */
type Answered = Promise<{ data: unknown; error: Answer["error"] | null }>;

interface QueryStub {
  insert: (row: unknown) => QueryStub;
  update: (fields: unknown) => QueryStub;
  select: (columns: string) => QueryStub;
  eq: (column: string, value: unknown) => QueryStub;
  abortSignal: (signal: AbortSignal) => Answered;
}

/** The store's one call that saves a decision: it saves, unless a test says otherwise. */
const SAVED: Answer = { data: "saved" };

/**
 * A client whose queries succeed and whose record_decision saves, unless `answer` gives another answer by the query's
 * table and its first call (an insert or an update), or by the function's name for a call, or makes it throw. Every
 * builder call is recorded, so a test sees what each step stored.
 */
function stubClient(
  answer: (name: string, first: string | undefined) => Answer | "throw" = (name) =>
    name === "record_decision" ? SAVED : {},
) {
  const queries: Call[][] = [];
  const reply = (name: string, first: string | undefined): Answered => {
    const answered = answer(name, first);
    if (answered === "throw") {
      return Promise.reject(new TypeError("fetch failed"));
    }
    return Promise.resolve({ data: answered.data ?? null, error: answered.error ?? null });
  };
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
      abortSignal: () => reply(table, calls.at(1)?.[0]),
    };
    return query;
  };
  const rpc = (name: string, args: unknown) => {
    queries.push([["rpc", name, args]]);
    return { abortSignal: () => reply(name, undefined) };
  };
  return { client: { from, rpc } as unknown as SupabaseClient, queries };
}

/** What the steps stored: each query's table, its first call and that call's row, or a call's name and arguments. */
const writesOf = (queries: Call[][]) =>
  queries.map(([[kind, name, args], ...calls]) => (kind === "rpc" ? [name, args] : [name, ...(calls.at(0) ?? [])]));

/**
 * A lookup's one call that stores what the rule settled in `shop` on its own, as writesOf reads it: an automatic match
 * of `shopItemId`, or "not found" without one, by the rule and expecting no decision (lookupCallArgs in
 * testing/record-decision.ts), with `more` of its arguments where a test pins them.
 */
const lookupSave = (shop: PricedShop, shopItemId: string | null, more?: Record<string, unknown>) => [
  "record_decision",
  lookupCallArgs(PRODUCT_ID, shop, shopItemId, more),
];

/**
 * The shop a URL asks: Rossmann by its host, Super-Pharm by its one query URL, Natura or Hebe by its Luigi's Box
 * tracker id.
 */
function trackerShop(url: string): PricedShop {
  if (url.startsWith("https://www.rossmann.pl/")) {
    return "rossmann";
  }
  if (url === SUPER_PHARM_URL) {
    return "super-pharm";
  }
  return url.includes("tracker_id=421168-505233") ? "hebe" : "natura";
}

/**
 * A real gate over a fetch that answers the recordings a moment after each request, so requests sent together overlap,
 * and keeps the most requests in flight at once, in all and to each shop.
 */
function slowGate(entries: ReplayEntry[]) {
  const replay = createReplayFetch(entries);
  const inFlight: PricedShop[] = [];
  const most: Record<"all" | PricedShop, number> = { all: 0, rossmann: 0, natura: 0, hebe: 0, "super-pharm": 0 };
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

/**
 * What a test opens the page with: the steps' input with, in place of the loaded product, the watched product, its
 * stored decisions as listMatches reads them, and the priced shops it's loaded with, the priced shops unless a test
 * names others, its matched shops among them.
 */
type OpenedFields = Omit<MatchStepsInput, "loaded"> & {
  product: WatchlistProduct;
  matches: MatchesRead | null;
  shops?: readonly PricedShop[];
};

/**
 * The page opened plainly, by the user's own navigation, for the product without decisions, in every matched shop: the
 * product loaded with its decisions as loadWatchedProduct loads them (loadedProductOf).
 */
function opened({
  product = softInBoth,
  matches = stored(),
  shops,
  ...fields
}: Pick<MatchStepsInput, "supabase" | "gate"> & Partial<OpenedFields>): MatchStepsInput {
  return {
    retryShop: null,
    repinShop: null,
    ownNavigation: true,
    filter: "all",
    ...fields,
    loaded: loadedProductOf(product, matches, shops),
  };
}

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
    const { gate, fetchMock, reserve, most } = slowGate([
      answers.eanHit,
      hebeAnswers.offlineEan,
      hebeAnswers.name,
      superPharmFailed,
    ]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(opened({ supabase: client, gate }));

    expect(steps.map(({ shop, step }) => [shop, step])).toEqual([
      ["natura", { kind: "lookup", retry: false }],
      ["hebe", { kind: "lookup", retry: false }],
      ["super-pharm", { kind: "lookup", retry: false }],
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
    // Super-Pharm's one search, by name, got no answer: nothing is stored, and its card says so.
    expect(steps[2]).toEqual({
      shop: "super-pharm",
      step: { kind: "lookup", retry: false },
      view: { kind: "unavailable", message: SUPER_PHARM_FAILED },
      repin: null,
      unsaved: false,
      item: null,
      retried: false,
    });
    // Each shop asked its own tracker or index, charged to itself: the three shops at once, each one's searches one at
    // a time, and Super-Pharm only by name, though the product has an EAN.
    expect(requestedUrls(fetchMock).filter((url) => trackerShop(url) === "natura")).toEqual([EAN_SEARCH]);
    expect(requestedUrls(fetchMock).filter((url) => trackerShop(url) === "hebe")).toEqual([
      HEBE_OFFLINE_EAN_SEARCH,
      HEBE_NAME_SEARCH,
    ]);
    expect(sentRequests(fetchMock).filter(({ url }) => url === SUPER_PHARM_URL)).toEqual([
      spSearch(SP_SOFT_IN_BOTH_SEARCH),
    ]);
    expect(reserve.mock.calls.map(([shop]) => shop).sort()).toEqual(["hebe", "hebe", "natura", "super-pharm"]);
    // Rossmann, the product's own shop, is asked nothing.
    expect(most).toEqual({ all: 3, rossmann: 0, natura: 1, hebe: 1, "super-pharm": 1 });
    // Only Natura's automatic match, in its one call, and its first price were stored; a choice stores nothing.
    expect(writesOf(queries)).toEqual([
      lookupSave("natura", "NV89063"),
      [
        "price_observations",
        "insert",
        [expect.objectContaining({ shop_id: "natura", shop_item_id: "NV89063", status: "price", price: 16.99 })],
      ],
    ]);
  });

  it("shows a shop whose lookup throws as unavailable, and keeps the other shops' results", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock } = slowGate([answers.eanHit, hebeAnswers.offlineEan, hebeAnswers.name, superPharmFailed]);
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
    expect(steps[2]).toMatchObject({ shop: "super-pharm", view: { kind: "unavailable", message: SUPER_PHARM_FAILED } });
    // Hebe's search threw before any request; Natura's and Super-Pharm's went ahead, and Natura's match was stored.
    expect(requestedUrls(fetchMock).filter((url) => trackerShop(url) !== "super-pharm")).toEqual([EAN_SEARCH]);
    expect(sentRequests(fetchMock).filter(({ url }) => url === SUPER_PHARM_URL)).toEqual([
      spSearch(SP_SOFT_IN_BOTH_SEARCH),
    ]);
    expect(writesOf(queries)).toEqual([
      lookupSave("natura", "NV89063"),
      ["price_observations", "insert", [expect.objectContaining({ shop_id: "natura", shop_item_id: "NV89063" })]],
    ]);
    // The log names the shop and the error's kind, never the search.
    expect(loggedLines(warn)).toEqual([
      { event: "shop-lookup", shop: "hebe", reason: "step failed", error: "TypeError" },
    ]);
    expect(String(warn.mock.calls[0][0])).not.toContain(SOFT_EAN);
  });

  it("shows a shop whose recording throws as unavailable, and keeps the other shops' outcomes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate } = slowGate([answers.eanHit, hebeAnswers.offlineEan, hebeAnswers.name, superPharmFailed]);
    // Natura's automatic match can't be written at all: its one call throws.
    const { client, queries } = stubClient((name) => (name === "record_decision" ? "throw" : {}));

    const steps = await runMatchSteps(opened({ supabase: client, gate }));

    expect(steps[0]).toMatchObject({
      shop: "natura",
      view: { kind: "unavailable", message: NATURA_FAILED },
      item: null,
      retried: false,
    });
    expect(steps[1]).toMatchObject({ shop: "hebe", view: { kind: "choose" } });
    expect(steps[2]).toMatchObject({ shop: "super-pharm", view: { kind: "unavailable", message: SUPER_PHARM_FAILED } });
    // No first price follows a match that wasn't stored.
    expect(writesOf(queries)).toEqual([lookupSave("natura", "NV89063")]);
    expect(loggedLines(warn)).toEqual([
      { event: "shop-lookup", shop: "natura", reason: "step failed", error: "TypeError" },
    ]);
  });

  it("says a retry that stored its outcome, and gives the other shops, still undecided, only their buttons", async () => {
    const { gate, fetchMock } = slowGate([answers.eanHit, hebeAnswers.offlineEan, hebeAnswers.name]);
    // The call replaces the stored "not found", which a lookup's call expects as it expects none.
    const { client, queries } = stubClient();

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
    // Super-Pharm's button leads to the plain page too, which looks it up as it does Hebe.
    expect(steps[2]).toMatchObject({
      shop: "super-pharm",
      step: { kind: "prompt" },
      view: { kind: "prompt", href: PLAIN_PAGE },
    });
    // The retry asks Natura alone, and stores its match in one call, then the price it came with.
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    expect(writesOf(queries)).toEqual([
      lookupSave("natura", "NV89063"),
      ["price_observations", "insert", [expect.objectContaining({ shop_id: "natura", shop_item_id: "NV89063" })]],
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

  it.each<{ why: string; input: Partial<OpenedFields>; views: string[] }>([
    {
      why: "decisions that couldn't be read",
      input: { matches: null },
      views: ["read-failed", "read-failed", "read-failed"],
    },
    {
      why: "a decision of one shop that came back odd, beside the others'",
      input: { matches: { matches: [naturaMatched, superPharmDeclined], unreadable: ["hebe"] } },
      views: ["matched", "read-failed", "unmatched"],
    },
    { why: "a page another site opened", input: { ownNavigation: false }, views: ["prompt", "prompt", "prompt"] },
  ])("asks no shop for $why", async ({ input, views }) => {
    const { gate, fetchMock } = slowGate([answers.eanHit, hebeAnswers.offlineEan, hebeAnswers.name]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(opened({ supabase: client, gate, ...input }));

    expect(steps.map(({ view }) => view.kind)).toEqual(views);
    expect(requestedUrls(fetchMock)).toEqual([]);
    expect(queries).toEqual([]);
  });
});

// A lookup's write the store doesn't save (record in matches.ts), as its one call answers it: a decision another tab
// stored meanwhile (`decided`: the call, which expects none or a lookup that found nothing, meets another decision and
// writes nothing), a product no longer on the list (`gone`), or an error (`failed`). Natura is looked up on the user's
// own navigation, while Hebe and Super-Pharm, which the user declined, are only shown.
describe("runMatchSteps: a lookup's write the store doesn't save", () => {
  const declinedElsewhere = [hebeDeclined, superPharmDeclined];
  /** The call meets another decision of the product in Natura, and writes nothing. */
  const decidedMeanwhile = (name: string): Answer => (name === "record_decision" ? { data: "decided" } : {});
  const unsavedWrites: { answer: string; save: Answer }[] = [
    { answer: "gone, the product no longer on the list", save: { data: "gone" } },
    { answer: "failed", save: { error: { code: "57014", message: "canceling statement due to statement timeout" } } },
  ];

  it("shows the decision stored meanwhile, with no first price, when the write of Natura's match answers decided", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);
    const { client, queries } = stubClient(decidedMeanwhile);

    const steps = await runMatchSteps(
      opened({ supabase: client, gate, product: watched(soft), matches: stored(...declinedElsewhere) }),
    );

    expect(steps.map(({ shop, step }) => [shop, step.kind])).toEqual([
      ["natura", "lookup"],
      ["hebe", "stored"],
      ["super-pharm", "stored"],
    ]);
    // The decision stands: the card says one is stored and links to the plain page, which shows it. The lookup's match
    // has no price row and isn't looked up again.
    expect(steps[0]).toEqual({
      shop: "natura",
      step: { kind: "lookup", retry: false },
      view: { kind: "decided", href: PLAIN_PAGE },
      repin: null,
      unsaved: false,
      item: null,
      retried: false,
    });
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    // The one call, expecting no decision or a lookup that found nothing, and no first price.
    expect(writesOf(queries)).toEqual([lookupSave("natura", "NV89063")]);
  });

  it("doesn't count a retry whose write answers decided as stored, and shows the decision stored meanwhile", async () => {
    const { gate, fetchMock } = setup([answers.eanHit, answers.name]);
    const { client, queries } = stubClient(decidedMeanwhile);

    const steps = await runMatchSteps(
      opened({
        supabase: client,
        gate,
        product: watched(soft),
        matches: stored(naturaNotFound, ...declinedElsewhere),
        retryShop: "natura",
      }),
    );

    expect(steps[0]).toEqual({
      shop: "natura",
      step: { kind: "lookup", retry: true },
      view: { kind: "decided", href: PLAIN_PAGE },
      repin: null,
      unsaved: false,
      item: null,
      retried: false,
    });
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    expect(writesOf(queries)).toEqual([lookupSave("natura", "NV89063")]);
  });

  it.each(unsavedWrites)(
    "leaves Natura's automatic match unsaved when its write answers $answer: no first price, and its card shows the item",
    async ({ save }) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock } = setup([answers.eanHit, answers.name]);
      const { client, queries } = stubClient((name) => (name === "record_decision" ? save : {}));

      const steps = await runMatchSteps(
        opened({ supabase: client, gate, product: watched(soft), matches: stored(...declinedElsewhere) }),
      );

      // The match has no price row, so its card shows its item, with no "Zmień" until it's stored, and the next view
      // looks Natura up again.
      expect(steps[0]).toMatchObject({
        shop: "natura",
        step: { kind: "lookup", retry: false },
        view: {
          kind: "matched",
          note: "Dopasowano automatycznie: ten sam EAN i rozmiar.",
          item: { name: "NIVEA SOFT krem intensywnie nawilżający 300 ml" },
          unsaved: true,
          action: null,
        },
        repin: null,
        unsaved: true,
        item: null,
        retried: false,
      });
      expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
      // The one call, and no first price follows a match that wasn't stored.
      expect(writesOf(queries)).toEqual([lookupSave("natura", "NV89063")]);
    },
  );

  it.each(unsavedWrites)(
    "leaves Natura's „not found” unsaved when its write answers $answer, and shows it",
    async ({ save }) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock } = setup([answers.eanMiss]);
      const { client, queries } = stubClient((name) => (name === "record_decision" ? save : {}));
      // An EAN Natura doesn't list, and a name that can't be searched: the lookup finds nothing.
      const product = watched({
        brand: null,
        name: "?",
        caption: null,
        sizeText: null,
        size: null,
        eans: [MISSING_EAN],
      });

      const steps = await runMatchSteps(
        opened({ supabase: client, gate, product, matches: stored(...declinedElsewhere) }),
      );

      expect(steps[0]).toMatchObject({
        shop: "natura",
        step: { kind: "lookup", retry: false },
        view: { kind: "not-found", href: `${PLAIN_PAGE}?retry=natura` },
        repin: null,
        unsaved: true,
        item: null,
        retried: false,
      });
      expect(requestedUrls(fetchMock)).toEqual([MISSING_EAN_SEARCH]);
      expect(writesOf(queries)).toEqual([lookupSave("natura", null)]);
    },
  );
});

// A product picked in another shop than Rossmann is matched in every priced shop but its own (matchedShopsOf), Rossmann
// included, and its page's steps run in those shops alone: its own shop is never looked up, whatever decision is stored
// there or the address names. Its lookups cost what the plan of add-from-other-shops states: one name search in
// Rossmann and in Super-Pharm, whose searches can't find an EAN, and in Natura and Hebe an EAN search first when the
// product has an EAN. Each product is named as the recorded searches asked for it, "nivea soft", 10 hits, so each
// shop's answer is its own recording: Rossmann's and Natura's of 2026-10-06 (rossmann.test.ts, natura.test.ts).
const ROSSMANN_SOFT_SEARCH = "https://www.rossmann.pl/products/v4/api/Products?search=nivea%20soft&page=1&pageSize=10";
const NATURA_SOFT_SEARCH = searchUrl("nivea soft", 10);
const rossmannSoftAnswer = {
  url: ROSSMANN_SOFT_SEARCH,
  status: 200,
  body: JSON.stringify(rossmannNiveaSoft),
} satisfies ReplayEntry;
const naturaSoftAnswer = {
  url: NATURA_SOFT_SEARCH,
  status: 200,
  body: JSON.stringify(naturaNiveaSoft),
} satisfies ReplayEntry;

describe("runMatchSteps: a product picked in another shop, matched in every priced shop but its own", () => {
  // Nivea Soft 300 ml picked in Natura, by its SKU, with the EAN Natura's item carries.
  const fromNatura: WatchlistProduct = { ...softInBoth, source: "natura", sourceItemId: "NV89063" };
  // The same product picked in Super-Pharm, by its objectID: Super-Pharm's items carry no EAN.
  const fromSuperPharm: WatchlistProduct = { ...softInBoth, source: "super-pharm", sourceItemId: "10132", eans: [] };

  it("looks a product picked in Natura up in Rossmann, Hebe and Super-Pharm, never in Natura: 4 requests", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Natura's recordings answer too, so a request to Natura would show among the ones served.
    const { gate, fetchMock, reserve, most } = slowGate([
      rossmannSoftAnswer,
      hebeAnswers.offlineEan,
      hebeAnswers.name,
      superPharmFailed,
      answers.eanHit,
      answers.name,
    ]);
    const { client, queries } = stubClient();
    // An address naming its own shop, as a crafted link could, opens the plain page, which asks every matched shop.
    const params = new URLSearchParams("repin=natura&retry=natura");
    const shops = matchedShopsOf(fromNatura.source);

    const steps = await runMatchSteps(
      opened({
        supabase: client,
        gate,
        product: fromNatura,
        // A match stored in Natura, its own shop, as a direct write could store it: no step reads it.
        matches: stored(naturaMatched),
        repinShop: repinShopOf(params, shops),
        retryShop: retryShopOf(params, shops),
        shops,
      }),
    );

    expect(steps.map(({ shop, step }) => [shop, step])).toEqual([
      ["rossmann", { kind: "lookup", retry: false }],
      ["hebe", { kind: "lookup", retry: false }],
      ["super-pharm", { kind: "lookup", retry: false }],
    ]);
    // Rossmann's name search finds its Nivea Soft 300 ml, which shares the product's EAN and size: matched on its own,
    // with the offer its search item carried, so its first price costs no request of its own.
    expect(steps[0]).toMatchObject({
      view: {
        kind: "matched",
        note: "Dopasowano automatycznie: ten sam EAN i rozmiar.",
        action: { kind: "repin", href: `${PLAIN_PAGE}?repin=rossmann` },
      },
      item: { shopItemId: "26900" },
      repin: null,
      unsaved: false,
      retried: false,
    });
    // Hebe's EAN search finds only an item it doesn't sell online, and its name search leaves the choice to the user,
    // as for the product picked in Rossmann; Super-Pharm's one search got no answer.
    expect(choiceIds(steps[1].view)).toEqual(["000000000000218807", "000000000000255134", "000000000000742817"]);
    expect(steps[2].view).toEqual({ kind: "unavailable", message: SUPER_PHARM_FAILED });
    // One request to Rossmann, Hebe's two, Super-Pharm's one and none to Natura: the shops at once, each one's requests
    // one at a time, and its own item's refetch, the island's, makes 5 at most.
    expect(requestedUrls(fetchMock).filter((url) => trackerShop(url) === "rossmann")).toEqual([ROSSMANN_SOFT_SEARCH]);
    expect(requestedUrls(fetchMock).filter((url) => trackerShop(url) === "hebe")).toEqual([
      HEBE_OFFLINE_EAN_SEARCH,
      HEBE_NAME_SEARCH,
    ]);
    expect(sentRequests(fetchMock).filter(({ url }) => url === SUPER_PHARM_URL)).toEqual([
      spSearch(SP_SOFT_IN_BOTH_SEARCH),
    ]);
    expect(requestedUrls(fetchMock).filter((url) => trackerShop(url) === "natura")).toEqual([]);
    expect(reserve.mock.calls.map(([shop]) => shop).sort()).toEqual(["hebe", "hebe", "rossmann", "super-pharm"]);
    expect(most).toEqual({ all: 3, rossmann: 1, natura: 0, hebe: 1, "super-pharm": 1 });
    // Rossmann's automatic match and its first price, 15,99 zł on promotion, as the recorded search item carried it.
    expect(writesOf(queries)).toEqual([
      lookupSave("rossmann", "26900"),
      [
        "price_observations",
        "insert",
        [expect.objectContaining({ shop_id: "rossmann", shop_item_id: "26900", status: "price", price: 15.99 })],
      ],
    ]);
  });

  it("looks a product picked in Super-Pharm up once in each of Rossmann, Natura and Hebe, by name: 3 requests", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Super-Pharm's answer is served too, so a request to Super-Pharm would show among the ones served.
    const { gate, fetchMock, reserve, most } = slowGate([
      rossmannSoftAnswer,
      naturaSoftAnswer,
      hebeAnswers.name,
      superPharmFailed,
    ]);
    const { client } = stubClient();

    // The product's own matched shops by default, as the page passes them.
    const steps = await runMatchSteps(opened({ supabase: client, gate, product: fromSuperPharm }));

    expect(steps.map(({ shop, step }) => [shop, step])).toEqual([
      ["rossmann", { kind: "lookup", retry: false }],
      ["natura", { kind: "lookup", retry: false }],
      ["hebe", { kind: "lookup", retry: false }],
    ]);
    // Without an EAN, Natura and Hebe skip their EAN search too: one name search in each matched shop, and none in
    // Super-Pharm, so its own item's refetch, the island's, makes 4 at most.
    expect(requestedUrls(fetchMock).sort()).toEqual(
      [HEBE_NAME_SEARCH, NATURA_SOFT_SEARCH, ROSSMANN_SOFT_SEARCH].sort(),
    );
    expect(reserve.mock.calls.map(([shop]) => shop).sort()).toEqual(["hebe", "natura", "rossmann"]);
    expect(most).toEqual({ all: 3, rossmann: 1, natura: 1, hebe: 1, "super-pharm": 0 });
  });
});

// Rossmann looked up for products picked in another shop than Rossmann, as "Dodaj" stores each from its shop's
// candidate, without a caption. Its answers to the searches by name those lookups send, with the text nameQuery builds
// and 10 items a page, were recorded on 2026-10-08 with curl from the developer machine, with the gate's User-Agent and
// `Accept: application/json`, 3 s apart and following no redirect, each kept whole:
// - rossmann-lookup-nivea-soft-300.json (22:06:40 UTC): "NIVEA SOFT krem intensywnie nawilżający 300 ml", for Natura's
//   Nivea Soft 300 ml (NV89063): its one item, Nivea Soft 300 ml (26900), on promotion at 15,99 zł.
// - rossmann-lookup-aa-laab-150.json (22:06:43 UTC): "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający
//   150 ml", for Hebe's AA LAAB face wash (450251): its two items, the face wash in 150 ml (419343), then in 75 ml
//   (2132081).
// - rossmann-lookup-maybelline-sky-high-cosmic-black.json (22:06:46 UTC): "Maybelline Mascara Lash Sensational Sky High
//   Cosmic Black 7.2 ml", for Super-Pharm's Sky High Cosmic Black (84422): no item and a totalCount of 0, beside four
//   products Rossmann recommends instead, which its search doesn't read. Rossmann writes the mascara's "Mascara" as
//   "tusz do rzęs" and its "7.2 ml" as "7,2 ml": a product picked in another shop may not be found at Rossmann when its
//   name uses words Rossmann doesn't, a known limit (the owner's call of 2026-10-08).
/** Rossmann's search for a lookup by name, 10 items a page, with the text the lookup sends spelled out as sent. */
const rossmannLookupUrl = (encodedQuery: string) =>
  `https://www.rossmann.pl/products/v4/api/Products?search=${encodedQuery}&page=1&pageSize=10`;
const ROSSMANN_SOFT_LOOKUP = rossmannLookupUrl("NIVEA%20SOFT%20krem%20intensywnie%20nawil%C5%BCaj%C4%85cy%20300%20ml");
const ROSSMANN_AA_LAAB_LOOKUP = rossmannLookupUrl(
  "AA%20LAAB%20100%25%20Centella%20B12%20%C5%BBel%20do%20mycia%20twarzy%20nawil%C5%BCaj%C4%85cy%20150%20ml",
);
const ROSSMANN_COSMIC_BLACK_LOOKUP = rossmannLookupUrl(
  "Maybelline%20Mascara%20Lash%20Sensational%20Sky%20High%20Cosmic%20Black%207.2%20ml",
);
// Every test is served all three answers, so a request for another one's text would show among the ones served.
const ROSSMANN_LOOKUP_ANSWERS: ReplayEntry[] = [
  { url: ROSSMANN_SOFT_LOOKUP, status: 200, body: JSON.stringify(rossmannLookupSoft) },
  { url: ROSSMANN_AA_LAAB_LOOKUP, status: 200, body: JSON.stringify(rossmannLookupAaLaab) },
  { url: ROSSMANN_COSMIC_BLACK_LOOKUP, status: 200, body: JSON.stringify(rossmannLookupCosmicBlack) },
];

/** A product picked in `source`, as "Dodaj" stores its item there: without a caption, which only Rossmann writes. */
function pickedIn(source: PricedShop, sourceItemId: string, fields: Omit<LookupProduct, "caption">): WatchlistProduct {
  return { ...watched({ ...fields, caption: null }), source, sourceItemId };
}

// Each product as its shop's adapter read it from its recording: natura-search-nivea-soft.json, hebe-search-aa-laab.json
// and super-pharm-lookup-maybelline-sky-high-7-2.json.
const NATURA_SOFT_300 = pickedIn("natura", "NV89063", {
  brand: "NIVEA",
  name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
  sizeText: "300 ml",
  size: { value: 300, unit: "ml" },
  eans: [SOFT_EAN],
});
const HEBE_FACE_WASH = pickedIn("hebe", "000000000000450251", {
  brand: "AA",
  name: "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający 150 ml",
  sizeText: "150 ml",
  size: { value: 150, unit: "ml" },
  eans: ["5900116091877"],
});
const SUPER_PHARM_COSMIC_BLACK = pickedIn("super-pharm", "84422", {
  brand: "Maybelline",
  name: "Maybelline Mascara Lash Sensational Sky High Cosmic Black",
  sizeText: "7.2 ml",
  size: { value: 7.2, unit: "ml" },
  eans: [],
});

describe("Rossmann looked up for a product picked in another shop, on its recorded answers", () => {
  it("matches Natura's Nivea Soft 300 ml to Rossmann's by the shared EAN, with its search offer as the first price", async () => {
    const { gate, fetchMock, reserve } = setupCharged(ROSSMANN_LOOKUP_ANSWERS);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(
      opened({ supabase: client, gate, product: NATURA_SOFT_300, shops: ["rossmann"] }),
    );

    // One request, by name, since Rossmann's search can't find an EAN.
    expect(requestedUrls(fetchMock)).toEqual([ROSSMANN_SOFT_LOOKUP]);
    expect(reserve.mock.calls).toEqual([["rossmann"]]);
    expect(steps).toMatchObject([
      {
        shop: "rossmann",
        step: { kind: "lookup", retry: false },
        view: { kind: "matched", note: "Dopasowano automatycznie: ten sam EAN i rozmiar.", warnings: [] },
        item: { shopItemId: "26900" },
        unsaved: false,
      },
    ]);
    // The match, and the price its search item came with: on promotion until 14 October, below its 30-day low.
    expect(writesOf(queries)).toEqual([
      lookupSave("rossmann", "26900", {
        p_size_text: "300 ml",
        p_eans: [SOFT_EAN, "4005808890637", "5900017001234"],
      }),
      [
        "price_observations",
        "insert",
        [
          {
            shop_id: "rossmann",
            shop_item_id: "26900",
            status: "price",
            price: 15.99,
            regular_price: 26.99,
            lowest_price_30d: 26.99,
            promo_ends_on: "2026-10-14",
            available: true,
          },
        ],
      ],
    ]);
  });

  it("accepts Rossmann's AA LAAB face wash in 150 ml for Hebe's by the shared EAN, never the one in 75 ml", async () => {
    const { gate, fetchMock, reserve } = setupCharged(ROSSMANN_LOOKUP_ANSWERS);

    const lookup = await lookupInShop("rossmann", gate, HEBE_FACE_WASH);

    expect(requestedUrls(fetchMock)).toEqual([ROSSMANN_AA_LAAB_LOOKUP]);
    expect(reserve.mock.calls).toEqual([["rossmann"]]);
    expect(lookup).toMatchObject({
      kind: "accepted",
      candidate: {
        shop: "rossmann",
        shopItemId: "419343",
        name: "LAAB Skin Barrier Protection żel do mycia twarzy nawilżający, 100% Centella B12",
        sizeText: "150 ml",
        eans: ["5900116091877"],
        offer: { price: 16.49, regularPrice: 19.99, lowestPrice30d: 19.99, promoEndsOn: "2026-10-14", available: true },
      },
    });
  });

  it("offers both face washes in a re-pin's choice from the same one search, the 75 ml one with its size flagged", async () => {
    const { gate, fetchMock, reserve } = setupCharged(ROSSMANN_LOOKUP_ANSWERS);

    const choices = await lookupChoicesInShop("rossmann", gate, HEBE_FACE_WASH);

    expect(requestedUrls(fetchMock)).toEqual([ROSSMANN_AA_LAAB_LOOKUP]);
    expect(reserve.mock.calls).toEqual([["rossmann"]]);
    expect(choices).toMatchObject({ kind: "choices", via: "name", incomplete: null });
    expect(offered(choices)).toEqual([
      ["419343", { sharesEan: true, size: "equal", brand: "agrees" }],
      ["2132081", { sharesEan: false, size: "differs", brand: "agrees" }],
    ]);
  });

  it("stores „not found” for Super-Pharm's Sky High Cosmic Black, whose words Rossmann's answer holds nothing for", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve } = setupCharged(ROSSMANN_LOOKUP_ANSWERS);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(
      opened({ supabase: client, gate, product: SUPER_PHARM_COSMIC_BLACK, shops: ["rossmann"] }),
    );

    expect(requestedUrls(fetchMock)).toEqual([ROSSMANN_COSMIC_BLACK_LOOKUP]);
    expect(reserve.mock.calls).toEqual([["rossmann"]]);
    // Rossmann's answer says it matched nothing, so it's nothing found, never a gap: the card says so, with a retry.
    expect(steps).toMatchObject([
      {
        shop: "rossmann",
        step: { kind: "lookup", retry: false },
        view: { kind: "not-found", href: `${PLAIN_PAGE}?retry=rossmann` },
        item: null,
        unsaved: false,
        retried: false,
      },
    ]);
    const { view } = steps[0];
    if (view.kind !== "not-found") {
      throw new Error(`expected not-found, got ${view.kind}`);
    }
    expect(view.text).toMatch(/^Nie znaleziono w Rossmannie \(sprawdzono /);
    expect(writesOf(queries)).toEqual([lookupSave("rossmann", null)]);
    // Which searches ran, never what they asked for.
    expect(loggedLines(warn)).toEqual([
      {
        event: "shop-lookup",
        shop: "rossmann",
        reason: "nothing found for the EAN or name",
        searchedByEan: false,
        searchedByName: true,
      },
    ]);
  });
});

// Rossmann's Sky High shades for Super-Pharm's Sky High Cosmic Black (84422), as "Dodaj" stores it from
// super-pharm-lookup-maybelline-sky-high-7-2.json, without a caption (SUPER_PHARM_COSMIC_BLACK above). Each Rossmann
// candidate's name carries its caption, where Rossmann keeps the shade, so no wrong shade is accepted, and the right
// one comes first, though it isn't accepted either. The lookup's own search finds nothing at Rossmann (above), so the
// shades are judged as Rossmann's search for "maybelline lash sensational" holds them, read by its item search as a
// lookup's answer is: rossmann-search-maybelline-lash-sensational.json (2026-10-06, 11:48:24 UTC, as
// super-pharm.test.ts says), its 19 items, served for the request it was sent with, 24 items a page.
const ROSSMANN_MASCARAS_SEARCH =
  "https://www.rossmann.pl/products/v4/api/Products?search=maybelline%20lash%20sensational&page=1&pageSize=24";

describe("Rossmann's Sky High shades for a mascara picked in Super-Pharm, on Rossmann's recorded answer", () => {
  it("accepts no shade for Super-Pharm's Cosmic Black, and offers Rossmann's Cosmic Black first, with „wydłużający” besides", async () => {
    const { gate, fetchMock, reserve } = setupCharged([
      { url: ROSSMANN_MASCARAS_SEARCH, status: 200, body: JSON.stringify(rossmannMascaras) },
    ]);

    const search = await searchRossmannItems(gate, "maybelline lash sensational", 24);

    expect(requestedUrls(fetchMock)).toEqual([ROSSMANN_MASCARAS_SEARCH]);
    expect(reserve.mock.calls).toEqual([["rossmann"]]);
    if (search.kind !== "results") {
      throw new Error(`expected results, got ${search.kind}`);
    }
    const pick = pickMatch(SUPER_PHARM_COSMIC_BLACK, search.candidates);
    if (pick.kind !== "choose") {
      throw new Error(`expected choose, got ${pick.kind}`);
    }
    // The six shades of 7,2 ml share no EAN with the product, which has none, so their names are weighed, and each has
    // a word the product's name lacks. Cosmic Black shares the most, every word of the product's name but the brand's
    // and „Mascara”, which the check sets aside, and its caption adds „wydłużający”.
    expect(pick.options[0]).toMatchObject({
      candidate: { shopItemId: "390594", name: "Lash Sensational Sky High tusz do rzęs, wydłużający, Cosmic Black" },
      verdict: { sharesEan: false, size: "equal", brand: "agrees" },
    });
  });
});

// The user picked Sky High's Black mascara in Super-Pharm for the Burgundy one.
const skyHighBlackPicked: ShopMatch = {
  ...DECIDED,
  shop: "super-pharm",
  decidedBy: "user",
  state: "matched",
  item: {
    shopItemId: "67655",
    brand: "Maybelline",
    name: "Maybelline Lash Sensational Sky High Tusz do rzęs Black",
    sizeText: "7.2 ml",
    size: { value: 7.2, unit: "ml" },
    eans: [],
    productUrl: null,
    imageUrl: null,
  },
};

// Super-Pharm is the page's last matched shop, so the steps' own list of shops runs it. Its search can't find an EAN,
// so it's looked up by name alone, on the same views as the other shops.
describe("runMatchSteps: Super-Pharm on the product's page, looked up on view", () => {
  it("looks Super-Pharm up on a plain view beside the other shops' decisions, and stores the item its name check accepts", async () => {
    const { gate, fetchMock, reserve } = setupCharged([superPharmAnswers.soft]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(
      opened({
        supabase: client,
        gate,
        product: watched(spSoft),
        matches: stored(naturaMatched, hebeDeclined),
        filter: "check",
      }),
    );

    // The other shops' stored decisions are only shown, and Super-Pharm, with none, is looked up.
    expect(steps.map(({ shop, step }) => [shop, step.kind])).toEqual([
      ["natura", "stored"],
      ["hebe", "stored"],
      ["super-pharm", "lookup"],
    ]);
    expect(steps[2]).toMatchObject({
      shop: "super-pharm",
      step: { kind: "lookup", retry: false },
      // It shares no EAN with the product, so its card says it was matched by its name, and offers "Zmień", which
      // keeps the list's filter.
      view: {
        kind: "matched",
        note: "Dopasowano automatycznie po nazwie.",
        warnings: [],
        item: { name: "Nivea Soft Krem nawilżający (Pudełko)" },
        unsaved: false,
        action: { kind: "repin", href: `${PLAIN_PAGE}?f=check&repin=super-pharm` },
      },
      repin: null,
      unsaved: false,
      item: { shopItemId: "10132" },
      retried: false,
    });
    // The automatic match, with no EAN, and the price it came with: on sale, without a regular price.
    expect(writesOf(queries)).toEqual([
      lookupSave("super-pharm", "10132", { p_eans: [] }),
      [
        "price_observations",
        "insert",
        [expect.objectContaining({ shop_id: "super-pharm", shop_item_id: "10132", status: "price", price: 19.49 })],
      ],
    ]);
    // One request, the search by name, charged to Super-Pharm.
    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_SOFT_SEARCH)]);
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
  });

  it("looks Super-Pharm alone up, by name, when a retry names it, and gives the other shops their buttons", async () => {
    const { gate, fetchMock, reserve } = setupCharged([superPharmAnswers.cream]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(
      opened({ supabase: client, gate, product: watched(spCream), retryShop: "super-pharm" }),
    );

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

  it("opens Super-Pharm's re-pin choice from its one search, the best name fit first, and asks no other shop", async () => {
    const { gate, fetchMock, reserve } = setupCharged([superPharmAnswers.skyHigh]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(
      opened({
        supabase: client,
        gate,
        product: watched(spSkyHighBurgundy),
        matches: stored(skyHighBlackPicked),
        repinShop: "super-pharm",
      }),
    );

    expect(steps[2]).toMatchObject({
      shop: "super-pharm",
      step: { kind: "repin" },
      item: { shopItemId: "67655" },
      repin: { kind: "repin", replaces: "matched:67655", decline: true, message: null },
    });
    // "Zmień" on the Black mascara: Burgundy Haze, fifth in Super-Pharm's answer, leads the choice, and the current
    // match is marked.
    expect(steps[2].repin?.options.map(({ candidate, current }) => [candidate.shopItemId, current])).toEqual([
      ["134305", false],
      ["67655", true],
      ["99681", false],
      ["84422", false],
      ["122681", false],
      ["122725", false],
    ]);
    // A page opened to re-pin Super-Pharm asks only Super-Pharm: the other shops, with no decision, get their buttons.
    expect(steps.slice(0, 2).map(({ step }) => step)).toEqual([{ kind: "prompt" }, { kind: "prompt" }]);
    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_SKY_HIGH_SEARCH)]);
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    expect(queries).toEqual([]);
  });
});

// risk #3 on a first lookup: the name search it sends after an EAN search that found nothing, when that search is
// refused or fails, ends the lookup with no further request and nothing stored, so a later view can ask again. Natura's
// recorded empty answer and, for Hebe, its empty price answer (hebe-id-unknown.json), which has a search's shape and
// serves Hebe's empty searches in hebe.test.ts too, answer the EAN searches.
interface EanMiss {
  shop: "natura" | "hebe";
  product: LookupProduct;
  eanMiss: ReplayEntry;
  nameSearch: string;
  /** The shop's recorded answer to the name search, which a refused reservation never lets it ask. */
  nameAnswer: ReplayEntry;
}

const EAN_MISSES: EanMiss[] = [
  {
    shop: "natura",
    product: { ...soft, eans: [MISSING_EAN] },
    eanMiss: answers.eanMiss,
    nameSearch: NAME_SEARCH,
    nameAnswer: answers.name,
  },
  {
    shop: "hebe",
    product: { ...soft200, eans: [MISSING_EAN] },
    eanMiss: { url: hebeSearchUrl(MISSING_EAN, 5), status: 200, body: JSON.stringify(hebeIdUnknown) },
    nameSearch: HEBE_NAME_SEARCH,
    nameAnswer: hebeAnswers.name,
  },
];

const ALLOWED = { outcome: "allowed" };
// The time the clock stands still at, and the end of a pause a shop asks for with `Retry-After: 120` then.
const NOW = "2026-09-28T12:00:00.000Z";
const RETRY_AFTER_END = "2026-09-28T12:02:00.000Z";

// What the name search meets: a 403 or a 429 the gate reports, a reservation the counter refuses, which sends
// nothing, or a failure. `answer` is the name search's answer, the shop's own recording when it's left out, and
// `second` the counter's answer to the name search's reservation.
const NAME_SEARCH_REFUSALS: {
  refusal: string;
  answer?: ServedAnswer;
  second: unknown;
  lookup: ShopLookup;
  nameSent: boolean;
  reported: (shop: MatchableShop) => unknown[][];
}[] = [
  {
    refusal: "a 403",
    answer: { status: 403 },
    second: ALLOWED,
    lookup: { kind: "unavailable", reason: "stopped" },
    nameSent: true,
    reported: (shop) => [[shop, "blocked", undefined, "HTTP 403"]],
  },
  {
    refusal: "a 429",
    answer: { status: 429, headers: { "Retry-After": "120" } },
    second: ALLOWED,
    lookup: { kind: "unavailable", reason: "paused", until: RETRY_AFTER_END },
    nameSent: true,
    reported: (shop) => [[shop, "rate_limited", 120]],
  },
  {
    refusal: "a stopped reservation",
    second: { outcome: "stopped" },
    lookup: { kind: "unavailable", reason: "stopped" },
    nameSent: false,
    reported: () => [],
  },
  {
    refusal: "a 500",
    answer: { status: 500 },
    second: ALLOWED,
    lookup: { kind: "unavailable", reason: "failed" },
    nameSent: true,
    reported: () => [],
  },
];

/** A counter that allows the EAN search's reservation and answers the name search's with `second`. */
function counterAnswering(second: unknown) {
  return vi
    .fn<ShopGateDeps["reserve"]>(() => Promise.resolve(ALLOWED))
    .mockResolvedValueOnce(ALLOWED)
    .mockResolvedValueOnce(second);
}

/** The recordings a lookup is served: the EAN search's empty answer, and the name search's `answer` or recording. */
const lookupEntries = (miss: EanMiss, answer: ServedAnswer | undefined): ReplayEntry[] => [
  miss.eanMiss,
  answer === undefined ? miss.nameAnswer : { url: miss.nameSearch, ...answer },
];

describe.each(EAN_MISSES)("lookupInShop in $shop: a name search after an EAN search that found nothing", (miss) => {
  beforeEach(() => {
    // The clock stands still, so a pause's end is exact.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(NAME_SEARCH_REFUSALS)(
    "ends the lookup at $refusal, says why, and asks nothing more",
    async ({ answer, second, lookup, nameSent, reported }) => {
      const reserve = counterAnswering(second);
      const { gate, fetchMock, reportBlock } = setup(lookupEntries(miss, answer), reserve);

      expect(await lookupInShop(miss.shop, gate, miss.product)).toEqual(lookup);
      expect(requestedUrls(fetchMock)).toEqual(nameSent ? [miss.eanMiss.url, miss.nameSearch] : [miss.eanMiss.url]);
      expect(reserve.mock.calls).toEqual([[miss.shop], [miss.shop]]);
      expect(reportBlock.mock.calls).toEqual(reported(miss.shop));
    },
  );
});

describe.each(EAN_MISSES)("runMatchSteps in $shop: a name search after an EAN search that found nothing", (miss) => {
  it.each(NAME_SEARCH_REFUSALS)(
    "stores nothing after $refusal, neither a decision nor a price, so a later view asks again",
    async ({ answer, second, nameSent }) => {
      const reserve = counterAnswering(second);
      const { gate, fetchMock } = setup(lookupEntries(miss, answer), reserve);
      const { client, queries } = stubClient();

      const steps = await runMatchSteps(
        opened({ supabase: client, gate, product: watched(miss.product), shops: [miss.shop] }),
      );

      // The card says the shop gave no answer, in the words of its reason (lookupInShop's tests above).
      expect(steps).toMatchObject([
        {
          shop: miss.shop,
          step: { kind: "lookup", retry: false },
          view: { kind: "unavailable" },
          repin: null,
          unsaved: false,
          item: null,
          retried: false,
        },
      ]);
      expect(requestedUrls(fetchMock)).toEqual(nameSent ? [miss.eanMiss.url, miss.nameSearch] : [miss.eanMiss.url]);
      expect(reserve).toHaveBeenCalledTimes(2);
      // No write at all: neither "not found" nor any other decision, and no price.
      expect(queries).toEqual([]);
    },
  );
});

// risk #5 on a first lookup: a changed search answer reads as no answer, never as "found nothing", so the lookup
// stores no "not found" for a product the shop may well sell.
describe("runMatchSteps: a changed search answer stores no 'not found'", () => {
  it("asks Natura no name search, and stores nothing, when its EAN search answers with the item under another type", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // natura-ean-hit.json's one hit, Nivea Soft, with its type "Product" where Natura's is "product": its attributes
    // intact, it's no product, and no query suggestion either.
    const renamed = structuredClone(eanHit);
    for (const hit of renamed.results.hits) {
      hit.type = "Product";
    }
    const { gate, fetchMock, reserve } = setupCharged([
      { url: EAN_SEARCH, status: 200, body: JSON.stringify(renamed) },
      answers.name,
    ]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(opened({ supabase: client, gate, product: watched(soft), shops: ["natura"] }));

    expect(steps).toEqual([
      {
        shop: "natura",
        step: { kind: "lookup", retry: false },
        view: { kind: "unavailable", message: NATURA_FAILED },
        repin: null,
        unsaved: false,
        item: null,
        retried: false,
      },
    ]);
    expect(requestedUrls(fetchMock)).toEqual([EAN_SEARCH]);
    expect(reserve.mock.calls).toEqual([["natura"]]);
    expect(queries).toEqual([]);
    // How many hits couldn't be read, never which.
    expect(loggedLines(warn)).toEqual([
      { event: "natura-search", reason: "hits dropped", detail: "1 of 1 product hits" },
    ]);
  });

  it("stores nothing when Super-Pharm's search holds no hit though it counts 5", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The recorded empty answer (probe P5) with its count changed: Algolia says 5 hits matched, yet sends none.
    const { gate, fetchMock, reserve } = setupCharged([
      {
        url: SUPER_PHARM_URL,
        requestBody: SP_CREAM_SEARCH,
        status: 200,
        body: JSON.stringify({ ...superPharmEmpty, nbHits: 5 }),
      },
    ]);
    const { client, queries } = stubClient();

    const steps = await runMatchSteps(
      opened({ supabase: client, gate, product: watched(spCream), shops: ["super-pharm"] }),
    );

    expect(steps).toEqual([
      {
        shop: "super-pharm",
        step: { kind: "lookup", retry: false },
        view: { kind: "unavailable", message: SUPER_PHARM_FAILED },
        repin: null,
        unsaved: false,
        item: null,
        retried: false,
      },
    ]);
    expect(sentRequests(fetchMock)).toEqual([spSearch(SP_CREAM_SEARCH)]);
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    expect(queries).toEqual([]);
    expect(loggedLines(warn)).toEqual([
      { event: "super-pharm-search", reason: "unexpected empty answer", detail: "0 hits, nbHits 5, page 0" },
    ]);
  });
});
