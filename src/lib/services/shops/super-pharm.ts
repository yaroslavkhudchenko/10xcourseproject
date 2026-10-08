import { z } from "astro/zod";
import { polishDate } from "@/lib/services/price-comparison";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import type { ShopGate } from "@/lib/services/shop-gate";
import {
  failed,
  fetchPinnedPrices,
  logFailure,
  logOddAvailability,
  logOddValues,
  type OddValue,
  type PinnedAnswer,
  type PinnedPriceShop,
} from "@/lib/services/shops/pinned-prices";
import { parsePolishPrice } from "@/lib/services/shops/price-text";
import { storableOffer } from "@/lib/services/shops/shop-offer";
import { gateUnavailable } from "@/lib/services/shops/shop-outcome";
import { countOf, httpsHost, isNone, textOf, within } from "@/lib/services/shops/shop-values";
import { parseSize, trailingSizeText } from "@/lib/services/size";
import type { GateOutcome, PriceCheck, ShopCandidate, ShopOffer, ShopSearch, ShopUnavailable, Size } from "@/types";

// Super-Pharm's product search runs on Algolia (research note §2.3): a POST to one index's query URL, whose body holds
// the search's parameters, answered with hits. Its index holds no EAN, so a candidate never shares one with the
// product, and the lookups search it by name alone (`searchesByEan` in the registry). The same URL answers a filter by
// `objectID` with an empty query, which fetches several pinned items' prices at once, by the rules every shop's pinned
// prices follow (pinned-prices.ts). This module maps Super-Pharm's record, as its answers recorded on 2026-10-05 and
// 2026-10-06 show it.

/** The Algolia application of Super-Pharm's search, as every superpharm.pl page names it (research note §2.3). */
const APP_ID = "EP43QPDX9Q";
/**
 * The search-only key every superpharm.pl page carries in its `algoliaConfig` (research note §2.3): public, not a
 * secret, unchanged since 2026-09-17 and without an expiry of its own. It's kept here rather than read from the 1.8 MB
 * page at runtime, and it travels only in a request's header, never in a URL or a log line. If Algolia stops accepting
 * it, its 403 stops Super-Pharm like any other: copy the page's new key here, then switch the shop back on.
 */
export const SUPER_PHARM_SEARCH_KEY =
  "NjRmYmE4ZDZhMDg5ODhkMjg1MzIzM2M1NzUwODE1MGFmN2E4NTllNjM2MmJmMzdhZmJkODQ3MmUzNTg4ZWZjOHRhZ0ZpbHRlcnM9";
// The index of Super-Pharm's drugstore items, on the host that serves reads: every search and price request asks it.
const QUERY_URL = "https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query";
// Each request waits at most 4 s for the shop, as a Luigi's Box request does, well inside the gate's own 8 s limit.
const SEARCH_TIMEOUT_MS = 4000;
const PRICE_TIMEOUT_MS = 4000;
// The most ids one price request asks for. Algolia limits a parameter's value to 512 bytes, and 20 filters of
// "objectID:" and 12 digits, joined by " OR ", take 496 of them: the value decoded. Form-encoded, as the body sends it,
// twenty 12-digit ids take 536, but Super-Pharm's ids have 5 or 6 digits (396 to 416 bytes encoded), and a batch over
// the limit would only get a 400, which shows as a gap.
const IDS_PER_REQUEST = 20;
// The only attributes a request retrieves; Algolia adds `objectID` to every hit. A search's are what a candidate shows,
// and a price request's what an offer needs.
const SEARCH_ATTRIBUTES = ["name", "brand", "capacity", "url", "thumbnail_url", "price", "in_stock", "inStoreOnly"];
const PRICE_ATTRIBUTES = ["price", "in_stock", "inStoreOnly"];
// Super-Pharm's item id, the record's `objectID`, such as "10132". It goes into a filter, forms and URLs, so only
// digits, at most 12 of them.
const ITEM_ID = /^\d{1,12}$/;
// The one host Super-Pharm's product pages are on, and the one its images are on.
const PRODUCT_HOST = "www.superpharm.pl";
const IMAGE_HOST = "media.superpharm.eu";
// A set's name, which says "zestaw" in any case or joins its items with "+", as in "Nivea Zestaw You Got This: Deo AP
// 50 ml + … + Płyn mic. 200 ml": it ends with one of its items' sizes, never the set's.
const SET_NAME = /zestaw|\+/i;
const SEARCH_EVENT = "super-pharm-search";
const PRICES_EVENT = "super-pharm-prices";
const isoDate = z.iso.date();

// An answer's hits, and how many hits the request matched on how many pages. Only the hits must be readable: the
// counts only tell whether a price request's answer holds every hit it matched (requestPrices), and whether a search's
// answer without hits matched none (searchSuperPharm).
const answerSchema = z.object({
  hits: z.array(z.unknown()),
  nbHits: z.unknown().optional(),
  page: z.unknown().optional(),
  nbPages: z.unknown().optional(),
});

// Only the fields an offer uses, which is all a price request retrieves. A hit needs its id and a positive price in
// złoty, as a number. The price texts, the promotion's end and the availability flags are read one by one, so an odd
// value costs only that value, never the hit.
const offerHitSchema = z.object({
  objectID: z.string().regex(ITEM_ID),
  price: z.object({
    PLN: z.object({
      default: z.number().positive(),
      default_original_formated: z.unknown().optional(),
      default_historical_min_price_formated: z.unknown().optional(),
      special_to_date: z.unknown().optional(),
    }),
  }),
  in_stock: z.unknown().optional(),
  inStoreOnly: z.unknown().optional(),
});
// A search's hit, with the fields a candidate shows, each read on its own too. `farmax_capacity` isn't read: the size
// is `capacity`, the text Super-Pharm shows with its unit, else the one the name ends with (readSize).
const candidateHitSchema = offerHitSchema.extend({
  name: z.unknown().optional(),
  brand: z.unknown().optional(),
  capacity: z.unknown().optional(),
  url: z.unknown().optional(),
  thumbnail_url: z.unknown().optional(),
});

/** A hit an offer can be read from. */
type OfferHit = z.infer<typeof offerHitSchema>;

const pinned: PinnedPriceShop = {
  batchSize: IDS_PER_REQUEST,
  isItemId: isSuperPharmItemId,
  request: requestPrices,
  readHit: readPriceHit,
  hasOddAvailability,
  log: { event: PRICES_EVENT, id: "ID" },
};

/**
 * Searches Super-Pharm through the gate, asking for at most `size` hits. Resolves to the candidates (possibly none), or
 * to `unavailable` with the reason: the gate skipped or refused the call, the call failed (a 400 included), or the
 * answer wasn't readable, including an answer whose hits all fail their check and an answer without hits whose counts
 * don't say it matched none. It never throws. The query must already be an EAN of 8-14 digits or have passed
 * `searchQuerySchema`; it goes into the body as one parameter's value, so it can't add a parameter of its own.
 */
export async function searchSuperPharm(gate: ShopGate, query: string, size: number): Promise<ShopSearch> {
  const outcome = await gate.fetch("super-pharm", QUERY_URL, post(searchParams(query, size), SEARCH_TIMEOUT_MS));
  if (outcome.kind !== "ok") {
    // A 403, as Algolia answers a key it no longer accepts, has stopped the shop.
    return shopUnavailable(outcome, SEARCH_EVENT);
  }
  const answer = await readAnswer(outcome.response, SEARCH_EVENT);
  if (answer === null) {
    return failed();
  }
  // No hits means nothing matched only when Algolia's own counts say so, as the recorded empty answer does: no hit
  // matched (`nbHits` 0), on the first page (`page` 0). An empty list beside another count or page, or without one of
  // them, would be stored as "not found" for a search whose answer changed. A search with hits isn't compared with its
  // count: it asks for the first few of the hits it matched.
  if (answer.hits.length === 0) {
    if (answer.nbHits === 0 && answer.page === 0) {
      return { kind: "results", candidates: [] };
    }
    // Only the counts, or what stands in their place, never anything else the answer holds: it echoes the search.
    logFailure(
      SEARCH_EVENT,
      "unexpected empty answer",
      `0 hits, nbHits ${countOf(answer.nbHits)}, page ${countOf(answer.page)}`,
    );
    return failed();
  }

  // Each hit is checked on its own, so one odd hit doesn't blank the whole search.
  const kept = answer.hits.flatMap((hit) => {
    const candidate = toCandidate(hit);
    return candidate ? [{ hit, candidate }] : [];
  });
  const candidates = kept.map(({ candidate }) => candidate);
  const total = answer.hits.length;
  const dropped = total - candidates.length;
  if (dropped > 0) {
    // How many, never which: a hit carries the product's name, which can echo the search.
    logFailure(SEARCH_EVENT, "hits dropped", `${dropped} of ${total} product hits`);
  }
  const keptHits = kept.map(({ hit }) => hit);
  logOddAvailability(hasOddAvailability, SEARCH_EVENT, keptHits, total);
  logOddOffers(SEARCH_EVENT, keptHits, total);
  // Hits that all fail their check point to a changed format, not to a product the shop doesn't sell: a lookup would
  // store that as "not found".
  if (total > 0 && candidates.length === 0) {
    return failed();
  }
  return { kind: "results", candidates };
}

/**
 * Fetches the offers of pinned Super-Pharm items by id through the gate: one request per 20 ids, each after the one
 * before. Once Super-Pharm refuses, busy under the cap, paused or stopped, the ids of the requests after it get that
 * same answer with no request and no reservation, and once two of its requests in a row failed, the ids after them get
 * no request and no reservation either (fetchPinnedPrices). Resolves to a check for every id given: its offer,
 * `missing` when Super-Pharm answered without it in an answer that holds every hit it matched, or `unavailable` when
 * the id can't go into a filter, the gate skipped or refused its request, the request was never sent, or the answer
 * wasn't readable or may have left its hit out. It never throws.
 */
export function fetchSuperPharmPrices(gate: ShopGate, ids: string[]): Promise<Map<string, PriceCheck>> {
  return fetchPinnedPrices(pinned, gate, ids);
}

/**
 * True for an id that can go into a filter, so the only kind a decision can pin: an `objectID` of 1-12 digits, which
 * can't change the filter it goes into.
 */
export function isSuperPharmItemId(value: string): boolean {
  return ITEM_ID.test(value);
}

/** True for an https URL on www.superpharm.pl: the only product pages a candidate links to. */
export function isSuperPharmProductUrl(url: string): boolean {
  return httpsHost(url) === PRODUCT_HOST;
}

/** True for an https URL on media.superpharm.eu, where Super-Pharm's images are: the only images a candidate shows. */
export function isSuperPharmImage(url: string): boolean {
  return httpsHost(url) === IMAGE_HOST;
}

/**
 * A POST to the index with the given parameters: the app id and the key in their headers only, and the parameters as
 * one form-encoded text in Algolia's body, so no value, the search text included, can add a parameter of its own.
 */
function post(params: URLSearchParams, timeoutMs: number): RequestInit {
  return {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": APP_ID,
      "X-Algolia-API-Key": SUPER_PHARM_SEARCH_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ params: params.toString() }),
    signal: AbortSignal.timeout(timeoutMs),
  };
}

/**
 * A search's parameters: the query, as many hits as asked for, out of Super-Pharm's search analytics, only the
 * attributes a candidate shows, and no highlighting.
 */
function searchParams(query: string, size: number): URLSearchParams {
  return new URLSearchParams([
    ["query", query],
    ["hitsPerPage", String(size)],
    ["analytics", "false"],
    ["attributesToRetrieve", SEARCH_ATTRIBUTES.join(",")],
    ["attributesToHighlight", "[]"],
  ]);
}

/**
 * A price request's parameters: no query, one `objectID:` filter per id, joined by OR, as many hits as ids, out of the
 * search analytics, only the price attributes, no highlighting, and no query rules. Each id is digits only
 * (isSuperPharmItemId). Super-Pharm's index runs its query rules on a price request's empty query too, as both pinned
 * answers recorded on 2026-10-05 report (`rulesProcessing`). A rule could hide an asked item, which would be stored
 * `missing`, or add one nobody asked for, which can push an asked item off the page and leaves every id without a hit
 * unavailable. With the rules off, an answer holds exactly what the filter matches. A name search keeps them, though a
 * product's lookup can accept one of its candidates on its own (matching.ts), so a rule that hid the right item or
 * pinned another could reach a match. The 7 lookups recorded on 2026-10-06 report no `rulesProcessing`, and turning the
 * rules off there would need new recordings of the lookups' requests.
 */
function priceParams(ids: string[]): URLSearchParams {
  return new URLSearchParams([
    ["query", ""],
    ["filters", ids.map((id) => `objectID:${id}`).join(" OR ")],
    ["hitsPerPage", String(ids.length)],
    ["analytics", "false"],
    ["attributesToRetrieve", PRICE_ATTRIBUTES.join(",")],
    ["attributesToHighlight", "[]"],
    ["enableRules", "false"],
  ]);
}

/**
 * One price request for up to 20 ids: the answer's hits, and whether they're every hit the request matched; or why
 * there's none to read. They are when the answer counts as many hits as it holds, on its only page. A count or a page
 * that can't be read can't say so, and an id left out of such an answer may be the one it held back.
 */
async function requestPrices(gate: ShopGate, ids: string[]): Promise<PinnedAnswer> {
  const outcome = await gate.fetch("super-pharm", QUERY_URL, post(priceParams(ids), PRICE_TIMEOUT_MS));
  if (outcome.kind !== "ok") {
    return shopUnavailable(outcome, PRICES_EVENT);
  }
  const answer = await readAnswer(outcome.response, PRICES_EVENT);
  if (answer === null) {
    return failed();
  }
  const { hits, nbHits, page, nbPages } = answer;
  logOddOffers(
    PRICES_EVENT,
    hits.filter((hit) => readPriceHit(hit) !== null),
    hits.length,
  );
  const complete = nbHits === hits.length && page === 0 && typeof nbPages === "number" && nbPages <= 1;
  return { kind: "hits", hits, complete };
}

/** A price request's hit as its id and offer, or null when either can't be read or its price can't be stored. */
function readPriceHit(hit: unknown): { id: string; offer: ShopOffer } | null {
  const parsed = offerHitSchema.safeParse(hit);
  const offer = parsed.success ? offerOf(parsed.data) : null;
  return parsed.success && offer !== null ? { id: parsed.data.objectID, offer } : null;
}

/**
 * Says why the gate produced no answer, and flags a 404: Algolia answers a query to an index it doesn't have with one
 * (its API specification), as it would once Super-Pharm renamed its index.
 */
function shopUnavailable(outcome: Exclude<GateOutcome, { kind: "ok" }>, event: string): ShopUnavailable {
  // The gate has already logged why.
  if (outcome.kind === "failed" && outcome.status === 404) {
    logFailure(event, "index rejected", "HTTP 404: QUERY_URL may have changed");
  }
  return gateUnavailable(outcome);
}

/**
 * An `ok` answer's hits and counts, or null when it isn't JSON with a list of hits. Either is logged without the
 * answer, which can echo the user's search or name the products.
 */
async function readAnswer(response: Response, event: string): Promise<z.infer<typeof answerSchema> | null> {
  let body: unknown;
  try {
    // Read the body right away: the time limits cover it too.
    body = await response.json();
  } catch (error) {
    // Only the error's name: a parse error quotes the body.
    logFailure(event, "unreadable body", error instanceof Error ? error.name : typeof error);
    return null;
  }
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) {
    // Where the shape differs, not what the answer holds, for the same reason.
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")} ${issue.code}`);
    logFailure(event, "unexpected response shape", issues.join("; "));
    return null;
  }
  return parsed.data;
}

/** A search's hit as a candidate within PRODUCT_LIMITS, so it can always be confirmed; null when it can't be one. */
function toCandidate(raw: unknown): ShopCandidate | null {
  const parsed = candidateHitSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const hit = parsed.data;
  const name = textOf(hit.name);
  if (name === null) {
    return null;
  }
  const { sizeText, size } = readSize(hit.capacity, name);
  const productUrl = within(textOf(hit.url), PRODUCT_LIMITS.productUrl);
  const imageUrl = within(textOf(hit.thumbnail_url), PRODUCT_LIMITS.imageUrl);
  return {
    shop: "super-pharm",
    shopItemId: hit.objectID,
    brand: textOf(hit.brand)?.slice(0, PRODUCT_LIMITS.brand) ?? null,
    name: name.slice(0, PRODUCT_LIMITS.name),
    sizeText,
    size,
    // The index holds no EAN, so no candidate shares one with the product, and the matching rule accepts one on its own
    // only by its name check (FR-006).
    eans: [],
    productUrl: productUrl !== null && isSuperPharmProductUrl(productUrl) ? productUrl : null,
    imageUrl: imageUrl !== null && isSuperPharmImage(imageUrl) ? imageUrl : null,
    offer: offerOf(hit),
  };
}

/**
 * A hit's offer as it can be stored, or null when its price can't be. The price is `default`, the price Super-Pharm
 * sells at, a promotion's included. The regular price comes only from `default_original_formated`, which the record
 * carries for some promotions only: a promotion without it is a plain price with its 30-day low, and no other field
 * stands in for it. The 30-day low is `default_historical_min_price_formated` (lowestOf), the promotion's end
 * `special_to_date` (promoEndOf), kept only beside a regular price, and orderable online reads `in_stock` and
 * `inStoreOnly` (availabilityOf).
 */
function offerOf(hit: OfferHit): ShopOffer | null {
  const pln = hit.price.PLN;
  const offer = storableOffer({
    price: pln.default,
    regularPrice: parsePolishPrice(pln.default_original_formated),
    lowestPrice30d: lowestOf(pln.default_historical_min_price_formated).amount,
    promoEndsOn: promoEndOf(pln.special_to_date),
    available: availabilityOf(hit) === "orderable",
  });
  // A promotion's end counts only beside the regular price it ends, as the search extension's own frontend reads it
  // (common.js in version 3.9.1). Magento leaves a sale's dates on the record after the sale, and an end in the past
  // would mark the current price stale on every check, so it could never be named cheapest. Beside a regular price, an
  // end already past is kept, and counted in a log line (logOddOffers).
  if (offer !== null && offer.regularPrice === null) {
    return { ...offer, promoEndsOn: null };
  }
  return offer;
}

/**
 * A hit's 30-day low from Polish text such as "33,99 zł" (parsePolishPrice). There's none for `false`, which
 * Super-Pharm sends without one, nor for a value that isn't there at all. Any other value that doesn't read as a price
 * is `odd`: it costs only the 30-day low, and is counted in a log line (logOddOffers), so a changed format shows.
 */
function lowestOf(value: unknown): { amount: number | null; odd: boolean } {
  if (value === undefined || value === null || value === false) {
    return { amount: null, odd: false };
  }
  const amount = parsePolishPrice(value);
  return { amount, odd: amount === null };
}

/**
 * Logs how many of the kept hits have each of these, one line for each count that isn't zero, in this order: how many,
 * never which. Each costs only its own value or nothing, so without its line nothing would show it happening.
 * - "30-day low unread": a 30-day low that can't be read (lowestOf). A changed format would strip every 30-day low.
 * - "regular price unread": a regular price that's there, not none (isNone), but can't be read (parsePolishPrice). A
 *   changed format would strip every promotion of its crossed-out price, and of its end with it (offerOf).
 * - "promotion end unread": a promotion's end that's there, not none, but can't be read (promoEndOf). A changed format
 *   would strip every promotion of its end.
 * - "promotion ended": an offer whose promotion ended before today in Poland, which it keeps only beside a regular
 *   price (offerOf). A sale's end Magento left behind, beside a regular price from a running price rule, would keep
 *   the price stale on every check, so it could never be named cheapest.
 */
function logOddOffers(event: string, kept: unknown[], hits: number): void {
  const today = polishDate(Date.now());
  const counted: OddValue<OfferHit>[] = [
    ["30-day low unread", ({ price }) => lowestOf(price.PLN.default_historical_min_price_formated).odd],
    ["regular price unread", ({ price }) => isUnread(price.PLN.default_original_formated, parsePolishPrice)],
    ["promotion end unread", ({ price }) => isUnread(price.PLN.special_to_date, promoEndOf)],
    ["promotion ended", (hit) => promotionEnded(hit, today)],
  ];
  const offerHits = kept.flatMap((hit) => {
    const parsed = offerHitSchema.safeParse(hit);
    return parsed.success ? [parsed.data] : [];
  });
  logOddValues(event, counted, offerHits, hits);
}

/** True for a value that's there and isn't none (isNone), yet `read` gives null for it. */
function isUnread(value: unknown, read: (value: unknown) => unknown): boolean {
  return !isNone(value) && read(value) === null;
}

/** True for a hit whose offer, as stored (offerOf), has a promotion that ended before `today`, a date in Poland. */
function promotionEnded(hit: OfferHit, today: string): boolean {
  const endsOn = offerOf(hit)?.promoEndsOn ?? null;
  // Both are `YYYY-MM-DD`, so comparing them as text compares the dates, as the comparison does (polishDate).
  return endsOn !== null && endsOn < today;
}

/**
 * A promotion's end from `special_to_date`, a time in whole seconds, as its date in Poland ("YYYY-MM-DD"): the calendar
 * the comparison ends promotions by (polishDate). Null for anything else, such as Super-Pharm's `false` for none, or a
 * time whose date the database could store but the app couldn't read back; a value that isn't none (isNone) is then
 * counted in a log line (logOddOffers).
 */
function promoEndOf(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return null;
  }
  const time = value * 1000;
  if (Number.isNaN(new Date(time).getTime())) {
    return null;
  }
  const date = polishDate(time);
  return isoDate.safeParse(date).success ? date : null;
}

/** Whether a hit can be ordered online, or `unread` when its flags say neither. */
type Availability = "orderable" | "not orderable" | "unread";

/**
 * A hit is orderable online when it's in stock (`in_stock` 1) and not sold only in the shops (`inStoreOnly` 0, or
 * missing, as the Magento extension usually leaves an unset attribute out of the record). `in_stock` 0 and
 * `inStoreOnly` 1 say it isn't. Any other value of either, a missing `in_stock` included, can't be read: the hit reads
 * as not orderable, so it can't be named cheapest, and it's counted in a log line (hasOddAvailability).
 */
function availabilityOf({ in_stock: inStock, inStoreOnly }: Pick<OfferHit, "in_stock" | "inStoreOnly">): Availability {
  const stocked = flagOf(inStock, null);
  const storeOnly = flagOf(inStoreOnly, false);
  if (stocked === null || storeOnly === null) {
    return "unread";
  }
  return stocked && !storeOnly ? "orderable" : "not orderable";
}

/** A flag as the record writes it, 1 or 0; `missing` for one that isn't there, and null for any other value. */
function flagOf(value: unknown, missing: boolean | null): boolean | null {
  if (value === undefined) {
    return missing;
  }
  if (value === 1 || value === 0) {
    return value === 1;
  }
  return null;
}

/**
 * True for a hit whose offer couldn't read whether it's orderable online (availabilityOf), and so takes it for not
 * orderable: the search and the price requests count such hits in a log line.
 */
function hasOddAvailability(hit: unknown): boolean {
  const parsed = offerHitSchema.safeParse(hit);
  return parsed.success && availabilityOf(parsed.data) === "unread";
}

/**
 * Super-Pharm's size as text, with the size it stands for, which parseSize reads back the same when a form posts the
 * text. It's `capacity`, such as "300 ml", whenever the record has one. Many records have none (27 of the 47 hits the
 * lookups recorded on 2026-10-06): the index leaves the attribute out, or sends it `false`, `null` or blank, as it does
 * an unset one (isNone). Their names often end with the size, as in "…Classic Clean, 400 ml", so then it's the size the
 * name ends with (trailingSizeText), unless the name is a set's (SET_NAME). A `capacity` that doesn't parse, such as a
 * multipack's "2 x 50 ml", or that isn't text, such as a number, gives none rather than the name's, which could be one
 * item's. No such size, or text over its limit, gives neither.
 */
function readSize(capacity: unknown, name: string): { sizeText: string | null; size: Size | null } {
  if (isNone(capacity)) {
    return sizeOf(SET_NAME.test(name) ? null : trailingSizeText(name));
  }
  return sizeOf(textOf(capacity));
}

/** Size text within its limit, with the size it stands for; neither when it doesn't parse or is over its limit. */
function sizeOf(text: string | null): { sizeText: string | null; size: Size | null } {
  const sizeText = within(text, PRODUCT_LIMITS.sizeText);
  const size = parseSize(sizeText);
  return size === null ? { sizeText: null, size: null } : { sizeText, size };
}
