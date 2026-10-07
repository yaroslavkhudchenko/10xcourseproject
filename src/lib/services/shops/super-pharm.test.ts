import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { pickMatch, type NamedProduct } from "@/lib/services/matching";
import { createShopGate, type ShopGate, type ShopGateDeps, type ShopGateLogEntry } from "@/lib/services/shop-gate";
import { searchRossmann } from "@/lib/services/shops/rossmann";
import {
  fetchSuperPharmPrices,
  isSuperPharmImage,
  isSuperPharmItemId,
  isSuperPharmProductUrl,
  searchSuperPharm,
} from "@/lib/services/shops/super-pharm";
import { parseSize } from "@/lib/services/size";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import type { GateOutcome, PriceCheck, ShopCandidate, ShopOffer, ShopSearch } from "@/types";
import rossmannAaLaab from "@/lib/services/shops/fixtures/rossmann-search-aa-laab.json";
import rossmannShampoos from "@/lib/services/shops/fixtures/rossmann-search-head-shoulders-classic-clean.json";
import rossmannMascaras from "@/lib/services/shops/fixtures/rossmann-search-maybelline-lash-sensational.json";
import rossmannShowerGels from "@/lib/services/shops/fixtures/rossmann-search-nivea-creme-soft-zel.json";
import rossmannNiveaSoft from "@/lib/services/shops/fixtures/rossmann-search-nivea-soft.json";
import lookupAaLaab from "@/lib/services/shops/fixtures/super-pharm-lookup-aa-laab-150.json";
import lookupShampoo from "@/lib/services/shops/fixtures/super-pharm-lookup-head-shoulders-classic-clean-400.json";
import lookupFullFan from "@/lib/services/shops/fixtures/super-pharm-lookup-maybelline-full-fan-9-5.json";
import lookupSkyHigh from "@/lib/services/shops/fixtures/super-pharm-lookup-maybelline-sky-high-7-2.json";
import lookupLipBalm from "@/lib/services/shops/fixtures/super-pharm-lookup-nivea-balsam-do-ust.json";
import lookupCremeCare from "@/lib/services/shops/fixtures/super-pharm-lookup-nivea-creme-care-500.json";
import lookupDermaControl from "@/lib/services/shops/fixtures/super-pharm-lookup-nivea-derma-control.json";
import nameSearchOne from "@/lib/services/shops/fixtures/super-pharm-name-search-one.json";
import nameSearch from "@/lib/services/shops/fixtures/super-pharm-name-search.json";
import pinnedOne from "@/lib/services/shops/fixtures/super-pharm-pinned-one.json";
import pinnedRulesOff from "@/lib/services/shops/fixtures/super-pharm-pinned-rules-off.json";
import pinned from "@/lib/services/shops/fixtures/super-pharm-pinned.json";
import searchEmpty from "@/lib/services/shops/fixtures/super-pharm-search-empty.json";

// The fixtures are real Algolia answers for Super-Pharm, recorded once with curl from the developer machine on
// 2026-10-05 and 2026-10-06 (UTC), with the gate's User-Agent and the adapter's headers, at least 2.5 s apart and
// following no redirect; no test reaches the live search. Every request is a POST to one URL, so each recording is
// served for the exact body it answers (`requestBody`), spelled out below. On 2026-10-05:
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
// rules-off answer holds the same hits at the same prices.
// On 2026-10-06, 3 s apart, the name searches a product's lookup sends, each for a Rossmann product's brand, name and
// size with 10 hits, kept whole:
// - super-pharm-lookup-aa-laab-150.json (11:49:24 UTC): "AA LAAB Skin Barrier Protection 150 ml", 10 of 1,969 hits.
//   7 have no `capacity`, and of those only Apis's tonic's name ends with a size, 150 ml.
// - super-pharm-lookup-nivea-balsam-do-ust.json (11:49:27 UTC): "NIVEA Balsam do ust 4,8 g", its 5 hits, none with a
//   `capacity`: a set, whose name ends with one of its items' sizes, and four Disney lip balms ending with 4,8 g.
// - super-pharm-lookup-nivea-derma-control.json (11:49:30 UTC): "NIVEA Derma Control Clinical 150 ml", 10 of 1,812
//   hits. 9 have no `capacity`, and five sprays' names end with 150 ml or 250 ml.
// - super-pharm-lookup-nivea-creme-care-500.json (11:49:34 UTC): "NIVEA Creme Care 500 ml", its one hit, with a
//   `capacity` and sold only in the shops (`inStoreOnly` 1).
// - super-pharm-lookup-head-shoulders-classic-clean-400.json (11:49:37 UTC): "Head & Shoulders Classic Clean 400 ml",
//   its one hit, with no `capacity` and a name that ends with 400 ml.
// - super-pharm-lookup-maybelline-sky-high-7-2.json (11:49:40 UTC): "Maybelline New York Lash Sensational Sky High
//   7,2 ml", 10 of 1,044 hits. 2 have no `capacity`, and neither name ends with a size.
// - super-pharm-lookup-maybelline-full-fan-9-5.json (11:49:43 UTC): "Maybelline New York Lash Sensational Full Fan
//   Effect 9,5 ml", 10 of 1,094 hits. 3 have no `capacity`, and two of their names end with 9,65 ml.
// The Creme Care and Head & Shoulders hits carry `in_stock: false`, which isn't a 1 or a 0, so the adapter reads them as
// not orderable and counts them in a log line. The broken answers below each change one thing in a copy of these
// recordings, or stand in a page where the JSON was.
// The watched products the lookups were made for are Rossmann's, as its adapter reads them from its own searches,
// recorded on 2026-10-06 with curl from the developer machine, with the gate's User-Agent and `Accept:
// application/json`, 3 s apart and following no redirect, each kept whole:
// - rossmann-search-nivea-soft.json (10:37:35 UTC): "nivea soft", its 5 items, the Soft Rose lip balm (11790) and the
//   women's Derma Control spray (2126586) among them.
// - rossmann-search-aa-laab.json (10:37:49 UTC): "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający", its 2
//   items: the face wash in 75 ml (2132081) and in 150 ml (419343).
// - rossmann-search-nivea-creme-soft-zel.json (11:48:17 UTC): "nivea creme soft żel pod prysznic", its 3 items.
// - rossmann-search-head-shoulders-classic-clean.json (11:48:21 UTC): "head & shoulders classic clean", its 4 items.
// - rossmann-search-maybelline-lash-sensational.json (11:48:24 UTC): "maybelline lash sensational", its 19 items,
//   which keep each mascara's shade in its caption.
// The first two asked for 10 items a page, where the adapter asks for 24, and each holds every item its search
// matched, so each is served for the adapter's own request.
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
/** A lookup's name search, with the 10 hits a lookup asks for, and its query as the body sends it, form-encoded. */
const lookupSearch = (query: string, encodedQuery: string) => ({ query, size: 10, body: searchBody(encodedQuery, 10) });
const AA_LAAB_SEARCH = lookupSearch("AA LAAB Skin Barrier Protection 150 ml", "AA+LAAB+Skin+Barrier+Protection+150+ml");
const LIP_BALM_SEARCH = lookupSearch("NIVEA Balsam do ust 4,8 g", "NIVEA+Balsam+do+ust+4%2C8+g");
const DERMA_CONTROL_SEARCH = lookupSearch("NIVEA Derma Control Clinical 150 ml", "NIVEA+Derma+Control+Clinical+150+ml");
const CREME_CARE_SEARCH = lookupSearch("NIVEA Creme Care 500 ml", "NIVEA+Creme+Care+500+ml");
const SHAMPOO_SEARCH = lookupSearch("Head & Shoulders Classic Clean 400 ml", "Head+%26+Shoulders+Classic+Clean+400+ml");
const SKY_HIGH_SEARCH = lookupSearch(
  "Maybelline New York Lash Sensational Sky High 7,2 ml",
  "Maybelline+New+York+Lash+Sensational+Sky+High+7%2C2+ml",
);
const FULL_FAN_SEARCH = lookupSearch(
  "Maybelline New York Lash Sensational Full Fan Effect 9,5 ml",
  "Maybelline+New+York+Lash+Sensational+Full+Fan+Effect+9%2C5+ml",
);
// The seven lookups, each with its recorded answer.
const AA_LAAB_LOOKUP = { search: AA_LAAB_SEARCH, answer: lookupAaLaab };
const LIP_BALM_LOOKUP = { search: LIP_BALM_SEARCH, answer: lookupLipBalm };
const DERMA_CONTROL_LOOKUP = { search: DERMA_CONTROL_SEARCH, answer: lookupDermaControl };
const CREME_CARE_LOOKUP = { search: CREME_CARE_SEARCH, answer: lookupCremeCare };
const SHAMPOO_LOOKUP = { search: SHAMPOO_SEARCH, answer: lookupShampoo };
const SKY_HIGH_LOOKUP = { search: SKY_HIGH_SEARCH, answer: lookupSkyHigh };
const FULL_FAN_LOOKUP = { search: FULL_FAN_SEARCH, answer: lookupFullFan };
const LOOKUPS = [
  AA_LAAB_LOOKUP,
  LIP_BALM_LOOKUP,
  DERMA_CONTROL_LOOKUP,
  CREME_CARE_LOOKUP,
  SHAMPOO_LOOKUP,
  SKY_HIGH_LOOKUP,
  FULL_FAN_LOOKUP,
];
/** A Rossmann search a recording answers: its text, its URL as the adapter asks it, the text spelled out as sent. */
const rossmannSearch = (query: string, encodedQuery: string, answer: object) => ({
  query,
  url: `https://www.rossmann.pl/products/v4/api/Products?search=${encodedQuery}&page=1&pageSize=24`,
  answer,
});
const ROSSMANN_NIVEA_SOFT = rossmannSearch("nivea soft", "nivea%20soft", rossmannNiveaSoft);
const ROSSMANN_AA_LAAB = rossmannSearch(
  "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający",
  "AA%20LAAB%20100%25%20Centella%20B12%20%C5%BBel%20do%20mycia%20twarzy%20nawil%C5%BCaj%C4%85cy",
  rossmannAaLaab,
);
const ROSSMANN_SHOWER_GELS = rossmannSearch(
  "nivea creme soft żel pod prysznic",
  "nivea%20creme%20soft%20%C5%BCel%20pod%20prysznic",
  rossmannShowerGels,
);
const ROSSMANN_SHAMPOOS = rossmannSearch(
  "head & shoulders classic clean",
  "head%20%26%20shoulders%20classic%20clean",
  rossmannShampoos,
);
const ROSSMANN_MASCARAS = rossmannSearch(
  "maybelline lash sensational",
  "maybelline%20lash%20sensational",
  rossmannMascaras,
);
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

/** An answer's status, headers and body, served for whichever request a test gives it. */
interface Answer {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

// A bot challenge, which Cloudflare marks with `cf-mitigated: challenge` whatever its status.
const CHALLENGE: Answer = {
  status: 200,
  headers: { "cf-mitigated": "challenge" },
  body: "<html>Just a moment...</html>",
};
// Algolia's documented error answer to a request its key may not make, never a recording: Super-Pharm's answer to a key
// Algolia no longer accepts was never recorded (research note §2.3; rollout Phase 3's research, §2.4; the test plan's
// §6.6, S-06's follow-up). Algolia's reference for POST /1/indexes/{indexName}/query documents a 403, "Method not
// allowed with this API key.", whose body is its error shape, ErrorBase, a `message`, here with ErrorBase's own example
// (https://www.algolia.com/doc/rest-api/search/search-single-index).
const ALGOLIA_403: Answer = {
  status: 403,
  headers: { "Content-Type": "application/json; charset=UTF-8" },
  body: JSON.stringify({ message: "Invalid Application-Id or API-Key" }),
};

/** No answer at all, as the replay stands it in: a request that never answers, or one that fails on the network. */
interface NoAnswer {
  error: "timeout" | "network";
}

// Plain failures, which refuse nothing and leave nothing to read, so Super-Pharm is asked again next time; each with the
// outcome the gate logs for it. A failed answer's media type comes with it: the replay sends a text body, an empty one
// included, as text/plain, and an answer without a body has none.
const FAILURES: { answer: string; reply: Answer | NoAnswer; timeoutMs?: number; outcome: GateOutcome }[] = [
  {
    answer: "a 400, as Algolia answers a key past its expiry",
    reply: { status: 400, body: "" },
    outcome: { kind: "failed", reason: "http", status: 400, contentType: "text/plain" },
  },
  { answer: "a 500 without a body", reply: { status: 500 }, outcome: { kind: "failed", reason: "http", status: 500 } },
  { answer: "a network error", reply: { error: "network" }, outcome: { kind: "failed", reason: "network" } },
  {
    answer: "no answer in time",
    reply: { error: "timeout" },
    timeoutMs: 20,
    outcome: { kind: "failed", reason: "timeout" },
  },
];
// Super-Pharm writes a no-break space before "zł".
const NBSP = "\u00A0";
// Nivea Soft first, then 20 ids Super-Pharm doesn't have: two requests' worth.
const manyIds = [SOFT, ...Array.from({ length: 20 }, (_, i) => `9${String(i).padStart(8, "0")}`)];
const firstBatch = priceBody(manyIds.slice(0, 20));
const secondBatch = priceBody(manyIds.slice(20));

// The watched product as the matching rule reads it: rossmann-search-results.json's Nivea Soft 300 ml (26900), with the
// caption Rossmann wrote for it then.
const ROSSMANN_SOFT: NamedProduct = {
  brand: "NIVEA",
  name: "Soft",
  caption: "krem uniwersalny, nawilżający",
  eans: ["4005900009319", "4005808890637", "5900017001234"],
  size: { value: 300, unit: "ml" },
};

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

/** The replay's answer to the request with the given body: JSON or text, with a status. */
function answering(requestBody: string, body: string, status = 200): ReplayEntry {
  return { url: QUERY_URL, requestBody, status, body };
}

/**
 * The replay's answer to the request with the given body: the given status, headers and body, or none at all, as a
 * request that never answers or fails on the network gets.
 */
function answeringWith(requestBody: string, answer: Answer | NoAnswer): ReplayEntry {
  return { url: QUERY_URL, requestBody, ...answer };
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

/** The outcome of each of the gate's own log lines. */
function gateOutcomes(gateLog: Mock<(entry: ShopGateLogEntry) => void>): ShopGateLogEntry["outcome"][] {
  return gateLog.mock.calls.map(([entry]) => entry.outcome);
}

/** How many seconds from now an answer's pause ends; it must be a pause with its end. */
function pauseSecondsOf(answer: ShopSearch | PriceCheck | undefined): number {
  if (answer?.kind !== "unavailable" || answer.reason !== "paused" || answer.until === undefined) {
    throw new Error(`expected a pause with its end, got ${JSON.stringify(answer)}`);
  }
  return (Date.parse(answer.until) - Date.now()) / 1000;
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

/** A recorded search answer's candidate for the given item, served for the request the adapter makes. */
async function recordedCandidate(
  search: { query: string; size: number; body: string },
  fixture: object,
  objectID: string,
): Promise<ShopCandidate> {
  const candidate = (await recordedCandidates(search, fixture)).find((each) => each.shopItemId === objectID);
  if (candidate === undefined) {
    throw new Error(`no candidate for ${objectID}`);
  }
  return candidate;
}

/**
 * A watched product, by its id, as Rossmann's adapter maps it from the recorded search it was picked in, through a
 * real gate that answers only that search's URL.
 */
async function rossmannProduct(
  search: { query: string; url: string; answer: object },
  id: string,
): Promise<NamedProduct> {
  const { gate, fetchMock } = setup([{ url: search.url, status: 200, body: JSON.stringify(search.answer) }]);
  const result = await searchRossmann(gate, search.query);
  expect(fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : new URL(input).href))).toEqual([
    search.url,
  ]);
  const product = result.kind === "results" ? result.candidates.find((each) => each.sourceItemId === id) : undefined;
  if (product === undefined) {
    throw new Error(`no Rossmann product ${id}`);
  }
  return product;
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

  it("finds nothing, and logs nothing, for an EAN, which the index doesn't hold, as the answer's counts say", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate, fetchMock, reserve } = setup([answering(EAN_SEARCH.body, JSON.stringify(searchEmpty))]);

    expect(await searchSuperPharm(gate, EAN_SEARCH.query, EAN_SEARCH.size)).toEqual({
      kind: "results",
      candidates: [],
    });
    expect(sentRequests(fetchMock)).toEqual([request(EAN_SEARCH.body)]);
    expect(reserve).toHaveBeenCalledTimes(1);
    // No hits, none matched, on the first page: only an answer that says so itself means nothing matched.
    expect(searchEmpty.nbHits).toBe(0);
    expect(searchEmpty.page).toBe(0);
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
    // The probe's hit carries farmax_capacity, 300 without a unit, beside capacity, and its name ends with no size.
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
  // On Nivea Soft's hit, whose name ends with no size, so a capacity that doesn't parse gives none.
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

describe("Super-Pharm search: sizes read from names", () => {
  // The Watermelon Shine lip balm's recorded hit: no capacity, and a name that ends with 4,8 g.
  const lipBalm = () => hitFor(lookupLipBalm, "193471");

  it.each([
    {
      items: "Head & Shoulders' shampoo",
      search: SHAMPOO_SEARCH,
      answer: lookupShampoo,
      ids: ["150930"],
      sizeText: "400 ml",
      size: { value: 400, unit: "ml" },
    },
    {
      items: "three Derma Control sprays",
      search: DERMA_CONTROL_SEARCH,
      answer: lookupDermaControl,
      ids: ["148287", "148111", "148395"],
      sizeText: "150 ml",
      size: { value: 150, unit: "ml" },
    },
    {
      items: "two Derma Control sprays",
      search: DERMA_CONTROL_SEARCH,
      answer: lookupDermaControl,
      ids: ["148282", "148288"],
      sizeText: "250 ml",
      size: { value: 250, unit: "ml" },
    },
    {
      items: "the four Disney lip balms",
      search: LIP_BALM_SEARCH,
      answer: lookupLipBalm,
      ids: ["193471", "193469", "193472", "193470"],
      sizeText: "4,8 g",
      size: { value: 4.8, unit: "g" },
    },
  ])(
    "reads $sizeText from the end of the name for $items, with no capacity on record",
    async ({ search, answer, ids, sizeText, size }) => {
      // Head & Shoulders' `in_stock: false` is counted in a log line.
      vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const candidates = await recordedCandidates(search, answer);

      for (const id of ids) {
        const candidate = candidates.find((each) => each.shopItemId === id);
        expect(hitFor(answer, id).capacity, id).toBeUndefined();
        expect(candidate, id).toMatchObject({ sizeText, size });
      }
    },
  );

  it("reads no size from the recorded set's name, which ends with its micellar water's 200 ml", async () => {
    const candidate = await recordedCandidate(LIP_BALM_SEARCH, lookupLipBalm, "163029");

    expect(candidate).toMatchObject({
      name: "Nivea Zestaw You Got This: Deo AP 50 ml + SG 250 ml + Pomadka 4,8 g + Płyn mic. 200 ml",
      sizeText: null,
      size: null,
    });
  });

  it.each([
    { why: "says ZESTAW, in capitals, without a +", name: "NIVEA ZESTAW Disney Edition Pomadki do ust, 4,8 g" },
    {
      why: "joins its items with a +, without the word",
      name: "Nivea Pomadka do ust Watermelon Shine 4,8 g + Krem do rąk 30 ml",
    },
  ])("reads no size from a set's name that $why", async ({ name }) => {
    const [candidate] = await candidatesFrom([withFields(lipBalm(), { name })]);

    expect(candidate).toMatchObject({ name, sizeText: null, size: null });
  });

  it("keeps capacity's size, never the name's, when the name ends with another", async () => {
    // Nivea Soft 300 ml's recorded hit, its name ending with 200 ml, as its image's file name already does.
    const name = "Nivea Soft Krem nawilżający, 200 ml";

    const [candidate] = await candidatesFrom([withFields(soft(), { name })]);

    expect(candidate).toMatchObject({ shopItemId: SOFT, name, sizeText: "300 ml", size: { value: 300, unit: "ml" } });
  });

  it.each([
    {
      item: "AA LAAB's face wash 105870",
      search: AA_LAAB_SEARCH,
      answer: lookupAaLaab,
      id: "105870",
      sizeText: "150 ml",
      size: { value: 150, unit: "ml" },
    },
    {
      item: "Sky High Black 67655",
      search: SKY_HIGH_SEARCH,
      answer: lookupSkyHigh,
      id: "67655",
      sizeText: "7.2 ml",
      size: { value: 7.2, unit: "ml" },
    },
  ])("keeps $item's capacity, $sizeText, as recorded", async ({ search, answer, id, sizeText, size }) => {
    expect(await recordedCandidate(search, answer, id)).toMatchObject({ sizeText, size });
  });

  it.each([
    {
      item: "Sky High Plum Twilight 141707",
      ending: "a word",
      search: SKY_HIGH_SEARCH,
      answer: lookupSkyHigh,
      id: "141707",
    },
    {
      item: "the AA LAAB SPF 50 gel 143288",
      ending: "a number without a unit",
      search: AA_LAAB_SEARCH,
      answer: lookupAaLaab,
      id: "143288",
    },
  ])("reads no size for $item, with no capacity and a name that ends with $ending", async ({ search, answer, id }) => {
    expect(hitFor(answer, id).capacity).toBeUndefined();
    expect(await recordedCandidate(search, answer, id)).toMatchObject({ sizeText: null, size: null });
  });

  it.each<{ why: string; capacity: unknown }>([
    { why: "a multipack's", capacity: "2 x 4,8 g" },
    { why: "one without a unit", capacity: "4,8" },
    { why: "a number", capacity: 4.8 },
    { why: "a yes", capacity: true },
  ])(
    "reads no size when capacity is there but can't be read, as $why, though the name ends with one",
    async ({ capacity }) => {
      const [candidate] = await candidatesFrom([withFields(lipBalm(), { capacity })]);

      expect(candidate).toMatchObject({ sizeText: null, size: null });
    },
  );

  it.each<{ why: string; capacity: unknown }>([
    { why: "blank", capacity: "   " },
    { why: "null", capacity: null },
    { why: "false", capacity: false },
  ])("reads the name's size when capacity is $why, as the index sends an unset one", async ({ capacity }) => {
    const [candidate] = await candidatesFrom([withFields(lipBalm(), { capacity })]);

    expect(candidate).toMatchObject({ sizeText: "4,8 g", size: { value: 4.8, unit: "g" } });
  });

  it("reads no size from a name that ends with one over its limit", async () => {
    const [candidate] = await candidatesFrom([withFields(lipBalm(), { name: `Nivea Pomadka, ${"1".repeat(38)} ml` })]);

    expect(candidate).toMatchObject({ sizeText: null, size: null });
  });

  it("writes every size the lookups recorded as text that parses back to the same size", async () => {
    // The Creme Care and Head & Shoulders hits' `in_stock: false` are counted in log lines.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const candidates = (
      await Promise.all(LOOKUPS.map(({ search, answer }) => recordedCandidates(search, answer)))
    ).flat();

    // Every hit is kept, and 33 have a size: 20 their capacity, 13 the one their names end with.
    expect(candidates).toHaveLength(47);
    expect(candidates.filter((candidate) => candidate.size !== null)).toHaveLength(33);
    for (const candidate of candidates) {
      expect(parseSize(candidate.sizeText), candidate.shopItemId).toEqual(candidate.size);
    }
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

// The recorded lookups' cases (research.md §5): each watched product, as Rossmann's adapter reads it from its recorded
// search, against Super-Pharm's answer to the search by name its lookup sends. The right item is judged by reading the
// names: Super-Pharm's "Lash Sensational" is the Full Fan Effect line, and its "Burgundy Haze" and "Tinted Primer" are
// Rossmann's "Burgundy" and "baza".
const ACCEPTED = [
  {
    product: "AA LAAB's face wash 150 ml (419343)",
    rossmann: ROSSMANN_AA_LAAB,
    id: "419343",
    lookup: AA_LAAB_LOOKUP,
    item: "105870",
  },
  {
    product: "Creme Care 500 ml (196779)",
    rossmann: ROSSMANN_SHOWER_GELS,
    id: "196779",
    lookup: CREME_CARE_LOOKUP,
    item: "20369",
  },
  {
    product: "Head & Shoulders Classic Clean 400 ml (46632)",
    rossmann: ROSSMANN_SHAMPOOS,
    id: "46632",
    lookup: SHAMPOO_LOOKUP,
    item: "150930",
  },
  {
    product: "Sky High Black (366692)",
    rossmann: ROSSMANN_MASCARAS,
    id: "366692",
    lookup: SKY_HIGH_LOOKUP,
    item: "67655",
  },
  {
    product: "Sky High Cosmic Black (390594)",
    rossmann: ROSSMANN_MASCARAS,
    id: "390594",
    lookup: SKY_HIGH_LOOKUP,
    item: "84422",
  },
  {
    product: "Sky High Brown (415613)",
    rossmann: ROSSMANN_MASCARAS,
    id: "415613",
    lookup: SKY_HIGH_LOOKUP,
    item: "99681",
  },
  {
    product: "Sky High Blue Mist (2075152)",
    rossmann: ROSSMANN_MASCARAS,
    id: "2075152",
    lookup: SKY_HIGH_LOOKUP,
    item: "122681",
  },
  {
    product: "Full Fan Effect Black (218841)",
    rossmann: ROSSMANN_MASCARAS,
    id: "218841",
    lookup: FULL_FAN_LOOKUP,
    item: "30050",
  },
  {
    product: "Full Fan Effect Intense Black (233593)",
    rossmann: ROSSMANN_MASCARAS,
    id: "233593",
    lookup: FULL_FAN_LOOKUP,
    item: "30469",
  },
];

// The right item's name has a word the product's lacks, so the user picks it, from the top of the choice.
const LEFT_TO_USER = [
  {
    product: "Sky High Burgundy (2079826)",
    why: "„Haze”",
    id: "2079826",
    lookup: SKY_HIGH_LOOKUP,
    chosen: ["134305", "67655", "99681"],
  },
  {
    product: "Sky High's base (415614)",
    why: "„Tinted Primer”",
    id: "415614",
    lookup: SKY_HIGH_LOOKUP,
    chosen: ["99683", "67655", "99681"],
  },
  {
    product: "Full Fan Effect Burgundy Brown (342570)",
    why: "its shade's number, „06”",
    id: "342570",
    lookup: FULL_FAN_LOOKUP,
    chosen: ["62293", "30050", "30469"],
  },
];

// Super-Pharm's answer doesn't hold the product: every item of its size and brand there is another one.
const NOT_IN_THE_ANSWER = [
  {
    product: "the Soft Rose lip balm 4,8 g (11790)",
    id: "11790",
    lookup: LIP_BALM_LOOKUP,
    chosen: ["193471", "193469", "193472"],
  },
  {
    product: "the women's Derma Control Clinical spray 150 ml (2126586)",
    id: "2126586",
    lookup: DERMA_CONTROL_LOOKUP,
    chosen: ["148395", "148287", "148111"],
  },
];

// The recorded answer without the product itself, as when Super-Pharm doesn't stock its shade or ranks it below the 10
// hits a lookup reads: its plainer sibling, every word of whose name is the product's, lacks the shade's first word,
// which Rossmann's caption marks with a capital letter.
const WITHOUT_THE_PRODUCT = [
  {
    product: "Sky High Cosmic Black (390594)",
    id: "390594",
    lookup: SKY_HIGH_LOOKUP,
    removed: "84422",
    sibling: "67655",
  },
  {
    product: "Full Fan Effect Intense Black (233593)",
    id: "233593",
    lookup: FULL_FAN_LOOKUP,
    removed: "30469",
    sibling: "30050",
  },
];

// Made-up items of each product's size and brand, or of no brand, every word of whose names is the product's, but
// which lack a word that tells the product apart: one its caption writes with a digit, or any of its own name's.
const PLAINER_ITEMS = [
  {
    product: "Soft Daily UV 100 ml (2103263)",
    rossmann: ROSSMANN_NIVEA_SOFT,
    id: "2103263",
    lacks: "its caption's „SPF15”",
    // Nivea Soft's own name, „Nivea Soft Krem nawilżający (Pudełko)”, in 100 ml.
    fields: { capacity: "100 ml" },
  },
  {
    product: "the women's Derma Control Clinical spray 150 ml (2126586)",
    rossmann: ROSSMANN_NIVEA_SOFT,
    id: "2126586",
    lacks: "every word of its name",
    fields: { name: "Nivea Antyperspirant w sprayu", capacity: "150 ml" },
  },
  {
    product: "Head & Shoulders Classic Clean 400 ml (46632)",
    rossmann: ROSSMANN_SHAMPOOS,
    id: "46632",
    lacks: "every word of its name",
    fields: { name: "Szampon do włosów przeciwłupieżowy", brand: undefined, capacity: "400 ml" },
  },
];

describe("Super-Pharm search: the matching rule on its candidates (FR-006)", () => {
  it("accepts Nivea Soft 300 ml by its name, with no EAN: every word but the brand's and „(Pudełko)” is the product's", async () => {
    const candidates = await recordedCandidates(SOFT_SEARCH, nameSearchOne);

    expect(pickMatch(ROSSMANN_SOFT, candidates)).toEqual({ kind: "accepted", candidate: candidates[0] });
  });

  it("accepts Nivea Soft 300 ml among the hand creams the search for NIVEA krem found before it", async () => {
    const candidates = await recordedCandidates(NAME_SEARCH, nameSearch);

    expect(pickMatch(ROSSMANN_SOFT, candidates)).toMatchObject({ kind: "accepted", candidate: { shopItemId: SOFT } });
  });

  it.each(ACCEPTED)("accepts $item for $product by its name", async ({ rossmann, id, lookup, item }) => {
    // The Creme Care and Head & Shoulders hits' `in_stock: false` are counted in log lines.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const product = await rossmannProduct(rossmann, id);
    const candidates = await recordedCandidates(lookup.search, lookup.answer);

    expect(pickMatch(product, candidates)).toMatchObject({ kind: "accepted", candidate: { shopItemId: item } });
  });

  it.each(LEFT_TO_USER)(
    "leaves $product to the user, the right item first, though its name adds $why",
    async ({ id, lookup, chosen }) => {
      const product = await rossmannProduct(ROSSMANN_MASCARAS, id);
      const candidates = await recordedCandidates(lookup.search, lookup.answer);

      const pick = pickMatch(product, candidates);

      if (pick.kind !== "choose") {
        throw new Error(`expected choose, got ${pick.kind}`);
      }
      // The best name fits in the product's size and brand, none sharing an EAN.
      expect(pick.options.map(({ candidate, verdict }) => [candidate.shopItemId, verdict])).toEqual(
        chosen.map((each) => [each, { sharesEan: false, size: "equal", brand: "agrees" }]),
      );
    },
  );

  it.each(NOT_IN_THE_ANSWER)(
    "accepts nothing for $product, which the answer doesn't hold",
    async ({ id, lookup, chosen }) => {
      const product = await rossmannProduct(ROSSMANN_NIVEA_SOFT, id);
      const candidates = await recordedCandidates(lookup.search, lookup.answer);

      const pick = pickMatch(product, candidates);

      if (pick.kind !== "choose") {
        throw new Error(`expected choose, got ${pick.kind}`);
      }
      // Look-alikes of its size and brand, each with a word the product lacks.
      expect(pick.options.map(({ candidate, verdict }) => [candidate.shopItemId, verdict])).toEqual(
        chosen.map((each) => [each, { sharesEan: false, size: "equal", brand: "agrees" }]),
      );
    },
  );

  it.each(WITHOUT_THE_PRODUCT)(
    "accepts nothing for $product from an answer without it, though its plainer sibling $sibling is there",
    async ({ id, lookup, removed, sibling }) => {
      const product = await rossmannProduct(ROSSMANN_MASCARAS, id);
      const answer = { ...lookup.answer, hits: hitsOf(lookup.answer).filter((hit) => hit.objectID !== removed) };
      const candidates = await recordedCandidates(lookup.search, answer);

      const pick = pickMatch(product, candidates);

      expect(candidates.map((candidate) => candidate.shopItemId)).toContain(sibling);
      expect(pick.kind).toBe("choose");
    },
  );

  it.each(PLAINER_ITEMS)("never accepts an item for $product that lacks $lacks", async ({ rossmann, id, fields }) => {
    const product = await rossmannProduct(rossmann, id);
    const candidates = await candidatesFrom([withFields(soft(), fields)]);

    expect(candidates).toHaveLength(1);
    expect(pickMatch(product, candidates).kind).toBe("choose");
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

  it.each(FAILURES)(
    "reports $answer as failed, never as nothing found, without blaming the index, and stops nothing",
    async ({ reply, timeoutMs, outcome }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock, reserve, reportBlock, gateLog } = setup(
        [answeringWith(NAME_SEARCH.body, reply)],
        undefined,
        timeoutMs,
      );

      expect(await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size)).toEqual(FAILED);
      expect(sentRequests(fetchMock)).toEqual([request(NAME_SEARCH.body)]);
      expect(reserve.mock.calls).toEqual([["super-pharm"]]);
      // A failure, not a stop.
      expect(reportBlock).not.toHaveBeenCalled();
      // Only the gate logs it, saying why: the adapter's "index rejected" is a 404's.
      expect(gateOutcomes(gateLog)).toStrictEqual([outcome]);
      expect(warn).not.toHaveBeenCalled();
    },
  );

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
    // With the answer's media type: the replay sends its empty body as text/plain.
    expect(gateLog.mock.calls).toEqual([
      [
        expect.objectContaining({
          shopId: "super-pharm",
          outcome: { kind: "failed", reason: "http", status: 404, contentType: "text/plain" },
        }),
      ],
    ]);
    expect(reportBlock).not.toHaveBeenCalled();
  });

  it.each<{ refusal: string; answer: Answer; reported: unknown[][]; outcome: GateOutcome }>([
    {
      refusal: "a 403 with Algolia's documented error body, as for a key it no longer accepts",
      answer: ALGOLIA_403,
      reported: [["super-pharm", "blocked", undefined, "HTTP 403"]],
      outcome: { kind: "blocked", status: 403 },
    },
    {
      refusal: "a bot challenge, though its status is 200",
      answer: CHALLENGE,
      reported: [["super-pharm", "blocked", undefined, "challenge"]],
      outcome: { kind: "blocked", status: 200 },
    },
  ])(
    "is stopped by $refusal, without blaming the index, and the block is reported",
    async ({ answer, reported, outcome }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock, reserve, reportBlock, gateLog } = setup([answeringWith(NAME_SEARCH.body, answer)]);

      expect(await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size)).toEqual({
        kind: "unavailable",
        reason: "stopped",
      });
      expect(sentRequests(fetchMock)).toEqual([request(NAME_SEARCH.body)]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reportBlock.mock.calls).toEqual(reported);
      // Only the gate logs it, saying why: the adapter's "index rejected" is a 404's.
      expect(gateOutcomes(gateLog)).toStrictEqual([outcome]);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each([
    { refusal: "a 429", status: 429 },
    { refusal: "a 503 that says when to come back", status: 503 },
  ])("is paused by $refusal until its Retry-After has passed", async ({ status }) => {
    const { gate, fetchMock, reserve, reportBlock, gateLog } = setup([
      answeringWith(NAME_SEARCH.body, { status, headers: { "Retry-After": "120" } }),
    ]);

    const secondsAhead = pauseSecondsOf(await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size));

    expect(secondsAhead).toBeGreaterThan(115);
    expect(secondsAhead).toBeLessThanOrEqual(120);
    expect(sentRequests(fetchMock)).toEqual([request(NAME_SEARCH.body)]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock.mock.calls).toEqual([["super-pharm", "rate_limited", 120]]);
    expect(gateOutcomes(gateLog)).toStrictEqual([{ kind: "rate-limited", retryAfterSeconds: 120 }]);
  });

  it.each([
    { refusal: "the cap is reached", reservation: { outcome: "capped" }, expected: { reason: "busy" } },
    { refusal: "the shop is stopped", reservation: { outcome: "stopped" }, expected: { reason: "stopped" } },
    {
      refusal: "the shop is paused",
      reservation: { outcome: "paused", until: "2026-10-05T19:15:00.000Z" },
      expected: { reason: "paused", until: "2026-10-05T19:15:00.000Z" },
    },
    { refusal: "the counter can't be read", reservation: null, expected: { reason: "failed" } },
  ])("says so without calling Algolia when $refusal", async ({ reservation, expected }) => {
    const { gate, fetchMock, reserve, reportBlock } = setup(
      [answering(NAME_SEARCH.body, JSON.stringify(nameSearch))],
      reservation,
    );

    expect(await searchSuperPharm(gate, NAME_SEARCH.query, NAME_SEARCH.size)).toEqual({
      kind: "unavailable",
      ...expected,
    });
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reportBlock).not.toHaveBeenCalled();
  });
});

describe("Super-Pharm search: an answer without hits finds nothing only when it says so", () => {
  it.each<{ change: string; edit: (answer: typeof searchEmpty) => unknown; detail: string }>([
    { change: "a count of 5", edit: (answer) => ({ ...answer, nbHits: 5 }), detail: "0 hits, nbHits 5, page 0" },
    { change: "a later page", edit: (answer) => ({ ...answer, page: 1 }), detail: "0 hits, nbHits 0, page 1" },
    {
      change: "neither its count nor its page",
      edit: (answer) => ({ ...answer, nbHits: undefined, page: undefined }),
      detail: "0 hits, nbHits missing, page missing",
    },
    {
      change: "its count sent as text",
      edit: (answer) => ({ ...answer, nbHits: "0" }),
      detail: "0 hits, nbHits string, page 0",
    },
  ])(
    "gives up on the recorded empty answer with $change, rather than finding nothing, and logs only its counts",
    async ({ edit, detail }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { gate, fetchMock, reserve, reportBlock } = setup([
        answering(EAN_SEARCH.body, JSON.stringify(edit(structuredClone(searchEmpty)))),
      ]);

      expect(await searchSuperPharm(gate, EAN_SEARCH.query, EAN_SEARCH.size)).toEqual(FAILED);
      expect(sentRequests(fetchMock)).toEqual([request(EAN_SEARCH.body)]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reportBlock).not.toHaveBeenCalled();
      expect(loggedLine(warn)).toEqual({ event: "super-pharm-search", reason: "unexpected empty answer", detail });
      // Never the query, which the answer echoes.
      expect(String(warn.mock.calls[0][0])).not.toContain(EAN_SEARCH.query);
    },
  );
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

  it("calls every id unavailable, never missing, when every hit lost its objectID, and logs how many", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The one price answer recorded with the adapter's current body, each of its hits without its id.
    const ids = [HAND_CREAM, LUMINOUS, SOFT, UNKNOWN_ID];
    const hits = hitsOf(pinnedRulesOff).map((hit) => withFields(hit, { objectID: undefined }));
    const { gate, fetchMock, reserve, reportBlock } = setup([
      answering(priceBody(ids), JSON.stringify({ ...pinnedRulesOff, hits })),
    ]);

    const checks = await fetchSuperPharmPrices(gate, ids);

    expect([...checks]).toEqual(ids.map((id) => [id, FAILED]));
    expect(sentRequests(fetchMock)).toEqual([request(priceBody(ids))]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reportBlock).not.toHaveBeenCalled();
    // The answer still counts as many hits as it holds, so only the dropped hits stand between its ids and "missing".
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-prices",
      reason: "hits dropped",
      detail: "3 of 3 product hits",
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
    // A count below the hits it holds can't say the answer holds every hit either.
    { change: "fewer hits matched than it holds", edit: (answer) => ({ ...answer, nbHits: 2 }) },
    { change: "no count of the hits matched", edit: (answer) => ({ ...answer, nbHits: undefined }) },
    { change: "the count as text", edit: (answer) => ({ ...answer, nbHits: "3" }) },
    { change: "a later page", edit: (answer) => ({ ...answer, page: 1 }) },
    { change: "more than one page", edit: (answer) => ({ ...answer, nbPages: 2 }) },
    { change: "no count of the pages", edit: (answer) => ({ ...answer, nbPages: undefined }) },
  ])("calls the id without a hit unavailable, never missing, when the answer has $change", async ({ edit }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The recorded answer for four ids, edited: 999999999's hit may be the one it left out.
    const ids = [HAND_CREAM, LUMINOUS, SOFT, UNKNOWN_ID];
    const { gate, fetchMock, reserve } = setup([
      answering(priceBody(ids), JSON.stringify(edit(structuredClone(pinned)))),
    ]);

    expect(await fetchSuperPharmPrices(gate, ids)).toEqual(
      new Map<string, PriceCheck>([
        [HAND_CREAM, { kind: "price", offer: HAND_CREAM_OFFER }],
        [LUMINOUS, { kind: "price", offer: LUMINOUS_OFFER }],
        [SOFT, { kind: "price", offer: SOFT_OFFER }],
        [UNKNOWN_ID, FAILED],
      ]),
    );
    expect(sentRequests(fetchMock)).toEqual([request(priceBody(ids))]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(loggedLine(warn)).toEqual({
      event: "super-pharm-prices",
      reason: "answer incomplete",
      detail: "3 product hits for 4 IDs",
    });
  });
});

describe("Super-Pharm prices: why they're unavailable", () => {
  it.each<{
    refusal: string;
    entries: ReplayEntry[];
    reservation: unknown;
    requested: { url: string; body: unknown }[];
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
      reservation: { outcome: "paused", until: "2026-10-05T19:15:00.000Z" },
      requested: [],
      reported: [],
      expected: { kind: "unavailable", reason: "paused", until: "2026-10-05T19:15:00.000Z" },
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
      refusal: "stopped by a 403 with Algolia's documented error body, as for a key it no longer accepts",
      entries: [answeringWith(firstBatch, ALGOLIA_403)],
      reservation: { outcome: "allowed" },
      requested: [request(firstBatch)],
      reported: [["super-pharm", "blocked", undefined, "HTTP 403"]],
      expected: { kind: "unavailable", reason: "stopped" },
    },
    {
      refusal: "stopped by a bot challenge",
      entries: [answeringWith(firstBatch, CHALLENGE)],
      reservation: { outcome: "allowed" },
      requested: [request(firstBatch)],
      reported: [["super-pharm", "blocked", undefined, "challenge"]],
      expected: { kind: "unavailable", reason: "stopped" },
    },
  ])(
    "stops once Super-Pharm is $refusal: the next request's ids get the same answer, unasked and unreserved",
    async ({ entries, reservation, requested, reported, expected }) => {
      const { gate, fetchMock, reserve, reportBlock } = setup(entries, reservation);

      const checks = await fetchSuperPharmPrices(gate, manyIds);

      expect(reserve).toHaveBeenCalledTimes(1);
      expect(sentRequests(fetchMock)).toEqual(requested);
      expect(reportBlock.mock.calls).toEqual(reported);
      expect(checks.size).toBe(21);
      for (const id of manyIds) {
        expect(checks.get(id), id).toEqual(expected);
      }
    },
  );

  it.each([
    { refusal: "a 429", status: 429 },
    { refusal: "a 503 that says when to come back", status: 503 },
  ])(
    "is paused by $refusal until its Retry-After has passed: the next request's ids too, unasked and unreserved",
    async ({ status }) => {
      const { gate, fetchMock, reserve, reportBlock, gateLog } = setup([
        answeringWith(firstBatch, { status, headers: { "Retry-After": "120" } }),
      ]);

      const checks = await fetchSuperPharmPrices(gate, manyIds);

      expect(sentRequests(fetchMock)).toEqual([request(firstBatch)]);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reportBlock.mock.calls).toEqual([["super-pharm", "rate_limited", 120]]);
      expect(gateOutcomes(gateLog)).toStrictEqual([{ kind: "rate-limited", retryAfterSeconds: 120 }]);
      const pause = checks.get(SOFT);
      const secondsAhead = pauseSecondsOf(pause);
      expect(secondsAhead).toBeGreaterThan(115);
      expect(secondsAhead).toBeLessThanOrEqual(120);
      expect(checks.size).toBe(21);
      for (const id of manyIds) {
        expect(checks.get(id), id).toEqual(pause);
      }
    },
  );

  it("calls every id unavailable without calling Algolia when the counter can't be read", async () => {
    // One request's worth of ids, so one reservation is all the request costs.
    const { gate, fetchMock, reserve, reportBlock, gateLog } = setup(
      [answering(priceBody([SOFT, UNKNOWN_ID]), JSON.stringify(pinnedOne))],
      null,
    );

    expect(await fetchSuperPharmPrices(gate, [SOFT, UNKNOWN_ID])).toEqual(
      new Map([
        [SOFT, FAILED],
        [UNKNOWN_ID, FAILED],
      ]),
    );
    expect(reserve.mock.calls).toEqual([["super-pharm"]]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reportBlock).not.toHaveBeenCalled();
    expect(gateOutcomes(gateLog)).toStrictEqual([{ kind: "skipped", reason: "unavailable" }]);
  });

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

  it.each(FAILURES)(
    "calls every id of a request unavailable on $answer, never missing, and stops nothing",
    async ({ reply, timeoutMs, outcome }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      // One request's worth of ids.
      const { gate, fetchMock, reserve, reportBlock, gateLog } = setup(
        [answeringWith(priceBody([SOFT, UNKNOWN_ID]), reply)],
        undefined,
        timeoutMs,
      );

      expect(await fetchSuperPharmPrices(gate, [SOFT, UNKNOWN_ID])).toEqual(
        new Map([
          [SOFT, FAILED],
          [UNKNOWN_ID, FAILED],
        ]),
      );
      expect(sentRequests(fetchMock)).toEqual([request(priceBody([SOFT, UNKNOWN_ID]))]);
      expect(reserve.mock.calls).toEqual([["super-pharm"]]);
      // A failure, not a stop.
      expect(reportBlock).not.toHaveBeenCalled();
      // Only the gate logs it, saying why: the adapter's "index rejected" is a 404's.
      expect(gateOutcomes(gateLog)).toStrictEqual([outcome]);
      expect(warn).not.toHaveBeenCalled();
    },
  );

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
    // With the answer's media type: the replay sends its empty body as text/plain.
    expect(gateLog.mock.calls).toEqual([
      [
        expect.objectContaining({
          shopId: "super-pharm",
          outcome: { kind: "failed", reason: "http", status: 404, contentType: "text/plain" },
        }),
      ],
    ]);
    expect(reportBlock).not.toHaveBeenCalled();
  });

  it.each([
    { answer: "an HTML page", body: HTML_PAGE, reason: "unreadable body" },
    { answer: "an empty body", body: "", reason: "unreadable body" },
    {
      answer: "the recorded answer without its hits",
      body: JSON.stringify({ ...pinned, hits: undefined }),
      reason: "unexpected response shape",
    },
    {
      answer: "the recorded answer with its hits keyed by id",
      body: JSON.stringify({ ...pinned, hits: Object.fromEntries(pinned.hits.map((hit) => [hit.objectID, hit])) }),
      reason: "unexpected response shape",
    },
  ])("gives up on $answer for every id, never missing, and logs it without the ids", async ({ body, reason }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ids = [HAND_CREAM, LUMINOUS, SOFT, UNKNOWN_ID];
    const { gate, fetchMock, reserve } = setup([answering(priceBody(ids), body)]);

    const checks = await fetchSuperPharmPrices(gate, ids);

    expect([...checks]).toEqual(ids.map((id) => [id, FAILED]));
    expect(sentRequests(fetchMock)).toEqual([request(priceBody(ids))]);
    expect(reserve).toHaveBeenCalledTimes(1);
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

  it.each(LOOKUPS)(
    "spells the lookup for $search.query as it was sent, which its recorded answer echoes",
    ({ search, answer }) => {
      // Algolia echoes the parameters it ran, followed by the search key's own tag filter, which is empty.
      expect(search.body).toBe(`{"params":"${answer.params.replace(/&tagFilters=$/, "")}"}`);
    },
  );

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
