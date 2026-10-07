import { z } from "astro/zod";
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
import { gateUnavailable } from "@/lib/services/shops/shop-outcome";
import { isNone, kindOf, valuesOf } from "@/lib/services/shops/shop-values";
import type { GateOutcome, PriceCheck, ShopCandidate, ShopId, ShopOffer, ShopSearch, ShopUnavailable } from "@/types";

// Luigi's Box runs the product search of Drogerie Natura and Hebe (research note §2.2, §2.5): one query, an EAN or
// text, answered with hits. The same endpoint also answers a filter by item id without a query, which fetches several
// pinned items' prices at once, by the rules every shop's pinned prices follow (pinned-prices.ts). Each shop's adapter
// maps its own attributes onto a client bound to its shop and its tracker, so a request is always charged to the shop
// whose tracker it asks.
const SEARCH_URL = "https://live.luigisbox.com/search";
// Each search waits at most 4 s for the shop, well inside the gate's own 8 s limit, so a lookup's two searches wait at
// most 8 s. Each price request waits as long.
const SEARCH_TIMEOUT_MS = 4000;
const PRICE_TIMEOUT_MS = 4000;
// The most ids one price request asks for; Luigi's Box documents up to 200 hits per answer.
const IDS_PER_REQUEST = 50;
const EAN = /^\d{8,14}$/;

// An answer's hits, how many hits the request matched, and the address of its next page, null on the last. Only the hits
// must be readable: the other two only tell whether the answer holds every hit, or, without hits, whether it matched
// none (readHits).
const responseSchema = z.object({
  results: z.object({ hits: z.array(z.unknown()), total_hits: z.unknown().optional() }),
  next_page: z.unknown().optional(),
});

/** A shop whose search runs on Luigi's Box: its tracker, how its hits read, and how its log lines name things. */
export interface LuigisBoxShop {
  /** The shop every request is charged to. */
  shop: ShopId;
  /** The shop's public Luigi's Box tracker id. */
  trackerId: string;
  /**
   * The `type` of the shop's item hits, such as "product". A hit of another type is never read as an item: a query
   * suggestion (isQuerySuggestion) is left out, and any other counts as a hit that can't be read.
   */
  itemType: string;
  /** The attribute a price request filters by, such as "sku", whose value is each item hit's `url`. */
  idField: string;
  /** The only attributes a price request asks for, in this order (Luigi's Box adds the title). */
  priceFields: readonly string[];
  log: {
    /** The event of a search's log lines, such as "natura-search". */
    search: string;
    /** The event of a price request's log lines, such as "natura-prices". */
    prices: string;
    /** What the details call an item id, such as "SKU". */
    id: string;
    /** The constant to update when Luigi's Box no longer knows the tracker, such as "NATURA_TRACKER_ID". */
    tracker: string;
  };
  /** A search's item hit as a candidate within PRODUCT_LIMITS, or null when it can't be one. */
  toCandidate: (hit: unknown) => ShopCandidate | null;
  /** A price request's item hit as an offer that can be stored, or null when its id or price can't be read. */
  toOffer: (hit: unknown) => ShopOffer | null;
  /** True for an id that can go into a filter. */
  isItemId: (id: string) => boolean;
  /**
   * True for a search's item hit that the shop lists but doesn't sell online: it's left out as a query suggestion is,
   * never counted as a hit that can't be read. Without it, a search reads every item hit.
   */
  isNotSoldOnline?: (hit: unknown) => boolean;
  /**
   * True for an item hit whose offer couldn't read whether it's orderable online, and so takes it for not orderable.
   * The client counts the kept hits it's true for in a log line, so a changed format shows. Without it, none is counted.
   */
  hasOddAvailability?: (hit: unknown) => boolean;
  /**
   * The optional values an offer reads on its own, such as a 30-day low, each with the reason its log line gives and a
   * check that's true for an item hit whose value is there but can't be read (isUnreadAmount). Such a value costs only
   * itself, so the client counts the kept hits each check is true for in a log line, on the search and on the prices,
   * so a changed format shows (logOddValues). Without it, none is counted.
   */
  oddValues?: readonly OddValue[];
}

/** One shop's Luigi's Box search and price requests. Neither ever throws. */
export interface LuigisBoxClient {
  /**
   * Searches the shop through the gate, asking for at most `size` hits. Resolves to the candidates (possibly none), or
   * to `unavailable` with the reason: the gate skipped or refused the call, the call failed, or the answer wasn't
   * readable, including an answer whose hits all fail their check, a hit that isn't the shop's item among them, and an
   * answer without hits that doesn't say it matched none. The query must already be an EAN of 8-14 digits or have
   * passed `searchQuerySchema`.
   */
  search: (gate: ShopGate, query: string, size: number) => Promise<ShopSearch>;
  /**
   * Fetches the offers of pinned items by id through the gate: one request per 50 ids, each after the one before. Once
   * the shop refuses, busy under the cap, paused or stopped, the ids of the requests after it get that same answer with
   * no request and no reservation. Resolves to a check for every id given: its offer, `missing` when the shop answered
   * without it in an answer that holds every hit it matched, each one of the shop's items and read, or `unavailable`
   * when the id can't go into a filter, the gate skipped or refused its request, or the answer wasn't readable or may
   * have left its hit out.
   */
  fetchPrices: (gate: ShopGate, ids: string[]) => Promise<Map<string, PriceCheck>>;
}

/** A Luigi's Box client bound to one shop: every request goes to that shop's tracker and is charged to that shop. */
export function createLuigisBoxClient(config: LuigisBoxShop): LuigisBoxClient {
  const prices: PinnedPriceShop = {
    batchSize: IDS_PER_REQUEST,
    isItemId: config.isItemId,
    request: (gate, ids) => requestPrices(config, gate, ids),
    readHit: (hit) => readPriceHit(config, hit),
    hasOddAvailability: config.hasOddAvailability,
    log: { event: config.log.prices, id: config.log.id },
  };
  return {
    search: (gate, query, size) => search(config, gate, query, size),
    fetchPrices: (gate, ids) => fetchPinnedPrices(prices, gate, ids),
  };
}

async function search(config: LuigisBoxShop, gate: ShopGate, query: string, size: number): Promise<ShopSearch> {
  const url = `${SEARCH_URL}?tracker_id=${config.trackerId}&q=${encodeURIComponent(query)}&size=${size}`;
  const outcome = await gate.fetch(config.shop, url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (outcome.kind !== "ok") {
    return shopUnavailable(config, outcome, config.log.search);
  }
  const read = await readHits(outcome.response, config.log.search);
  if (read === null) {
    return failed();
  }
  // No hits means nothing matched only when the answer says so itself, as every recorded empty answer does: no next
  // page and a count of 0. An empty list beside another count or a next page, or without either, would be stored as
  // "not found" for a search whose answer changed.
  if (read.hits.length === 0) {
    if (read.nextPage === null && read.totalHits === 0) {
      return { kind: "results", candidates: [] };
    }
    // Only the count, or what stands in its place, and whether there's a next page: its address carries the search.
    const count = typeof read.totalHits === "number" ? String(read.totalHits) : kindOf(read.totalHits);
    const nextPage = read.nextPage === undefined || read.nextPage === null ? kindOf(read.nextPage) : "set";
    logFailure(config.log.search, "unexpected empty answer", `0 hits, total_hits ${count}, next_page ${nextPage}`);
    return failed();
  }

  // Luigi's Box can send a query suggestion among the items (research note §2.2), and a shop can list an item it
  // doesn't sell online: neither counts. Every other hit is the shop's item, or a format that changed, so each is
  // checked on its own, and one odd hit doesn't blank the whole search.
  const considered = read.hits.filter(
    (hit) => !isQuerySuggestion(hit) && !(isItemHit(hit, config.itemType) && config.isNotSoldOnline?.(hit) === true),
  );
  const kept = considered.flatMap((hit) => {
    const candidate = isItemHit(hit, config.itemType) ? config.toCandidate(hit) : null;
    return candidate ? [{ hit, candidate }] : [];
  });
  const candidates = kept.map(({ candidate }) => candidate);
  const dropped = considered.length - candidates.length;
  if (dropped > 0) {
    // How many, never which: a hit carries the product's name and EAN, which can echo the search.
    logFailure(config.log.search, "hits dropped", `${dropped} of ${considered.length} product hits`);
  }
  const keptHits = kept.map(({ hit }) => hit);
  logOddAvailability(config.hasOddAvailability, config.log.search, keptHits, considered.length);
  logOddValues(config.log.search, config.oddValues ?? [], keptHits, considered.length);
  // Hits that all fail their check, such as items whose type was renamed, point to a changed format, not to a product
  // the shop doesn't sell: a lookup would store that as "not found".
  if (considered.length > 0 && candidates.length === 0) {
    return failed();
  }
  return { kind: "results", candidates };
}

/**
 * One price request for up to 50 ids: the answer's hits, without a query suggestion among them, and whether they're
 * every hit the request matched; or why there's none to read. Any other hit that isn't the shop's item goes on to the
 * shared rules, which count it as a hit that can't be read (readPriceHit): a renamed type must leave every unanswered
 * id unavailable, never missing. The kept hits' odd optional values are counted here, as Super-Pharm's are.
 */
async function requestPrices(config: LuigisBoxShop, gate: ShopGate, ids: string[]): Promise<PinnedAnswer> {
  const outcome = await gate.fetch(config.shop, priceUrl(config, ids), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
  });
  if (outcome.kind !== "ok") {
    return shopUnavailable(config, outcome, config.log.prices);
  }
  const read = await readHits(outcome.response, config.log.prices);
  if (read === null) {
    return failed();
  }
  const hits = read.hits.filter((hit) => !isQuerySuggestion(hit));
  logOddValues(
    config.log.prices,
    config.oddValues ?? [],
    hits.filter((hit) => readPriceHit(config, hit) !== null),
    hits.length,
  );
  return { kind: "hits", hits, complete: read.complete };
}

/** A price request's hit as its id and offer, or null when it isn't the shop's item or either can't be read. */
function readPriceHit(config: LuigisBoxShop, hit: unknown): { id: string; offer: ShopOffer } | null {
  // The shop's offer check needn't read the type, so a hit of another type, attributes and all, is never priced.
  if (!isItemHit(hit, config.itemType)) {
    return null;
  }
  // The shop's offer check reads the id too, so a hit with an offer has an id.
  const offer = config.toOffer(hit);
  const id = offer === null ? null : idOf(hit);
  return offer === null || id === null ? null : { id, offer };
}

/**
 * The price request for the given ids: the shop's items only, one `f[]=<idField>:` filter per id, which Luigi's Box
 * combines with OR, no query, as many hits as ids and only the price attributes. Each id is a parameter of its own,
 * never joined into one value.
 */
function priceUrl(config: LuigisBoxShop, ids: string[]): string {
  const params = new URLSearchParams();
  params.append("tracker_id", config.trackerId);
  params.append("f[]", `type:${config.itemType}`);
  for (const id of ids) {
    params.append("f[]", `${config.idField}:${id}`);
  }
  params.append("size", String(ids.length));
  params.append("hit_fields", config.priceFields.join(","));
  return `${SEARCH_URL}?${params.toString()}`;
}

/**
 * True for a query suggestion, the only hit besides the shop's items that Luigi's Box was ever recorded sending
 * (hebe-name-search.json, research note §2.2): an object whose `type` is exactly "query". It's left out and never
 * counted, while any other hit that isn't the shop's item (isItemHit) points to a changed format.
 */
function isQuerySuggestion(hit: unknown): boolean {
  return typeof hit === "object" && hit !== null && "type" in hit && hit.type === "query";
}

/**
 * True for a hit that stands for one of the shop's items: its type says so, as on every recorded item hit, or it has no
 * type but carries attributes. Anything else isn't read as an item: a query suggestion (isQuerySuggestion) is left out,
 * and any other such hit counts as one that can't be read.
 */
function isItemHit(hit: unknown, itemType: string): boolean {
  if (typeof hit !== "object" || hit === null) {
    return false;
  }
  const type = "type" in hit ? hit.type : undefined;
  if (type === itemType) {
    return true;
  }
  const attributes = "attributes" in hit ? hit.attributes : undefined;
  return (
    (type === undefined || type === null) &&
    typeof attributes === "object" &&
    attributes !== null &&
    Object.keys(attributes).length > 0
  );
}

/** An item hit's id, which Luigi's Box sends as its `url`, or null when that isn't text. */
function idOf(hit: unknown): string | null {
  const url = typeof hit === "object" && hit !== null && "url" in hit ? hit.url : null;
  return typeof url === "string" ? url : null;
}

/** Says why the gate produced no answer, and flags a 404: Luigi's Box answers a tracker id it doesn't know with one. */
function shopUnavailable(
  config: LuigisBoxShop,
  outcome: Exclude<GateOutcome, { kind: "ok" }>,
  event: string,
): ShopUnavailable {
  // The gate has already logged why.
  if (outcome.kind === "failed" && outcome.status === 404) {
    logFailure(event, "tracker id rejected", `HTTP 404: ${config.log.tracker} may have changed`);
  }
  return gateUnavailable(outcome);
}

/**
 * An answer's hits, whether they're every hit the request matched, and the two values that tell: how many hits it
 * matched (`total_hits`) and the address of its next page (`next_page`), each as the answer sends it, `undefined` when
 * it's left out.
 */
interface HitsRead {
  hits: unknown[];
  complete: boolean;
  totalHits: unknown;
  nextPage: unknown;
}

/**
 * An `ok` answer's hits, or null when it isn't JSON with a list of hits. Either is logged without the answer. The hits
 * are complete when the answer has no next page and matched no more hits than it holds; a count or a next page that
 * can't be read can't say so.
 */
async function readHits(response: Response, event: string): Promise<HitsRead | null> {
  let body: unknown;
  try {
    // Read the body right away: the time limits cover it too.
    body = await response.json();
  } catch (error) {
    // Only the error's name: a parse error quotes the body, which can echo the user's search.
    logFailure(event, "unreadable body", error instanceof Error ? error.name : typeof error);
    return null;
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    // Where the shape differs, not what the answer holds, for the same reason.
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")} ${issue.code}`);
    logFailure(event, "unexpected response shape", issues.join("; "));
    return null;
  }
  const { hits, total_hits: totalHits } = parsed.data.results;
  const nextPage = parsed.data.next_page;
  const complete = nextPage === null && typeof totalHits === "number" && totalHits <= hits.length;
  return { hits, complete, totalHits, nextPage };
}

/** An attribute's first value as an amount: a number, or decimal text such as "17.990000"; null for anything else. */
export function amountOf(attribute: unknown): number | null {
  const [value] = valuesOf(attribute);
  if (typeof value === "number") {
    return value;
  }
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
}

/**
 * True for an optional amount that's there but can't be read (amountOf): its first value isn't none (isNone), and it
 * isn't an empty list. One left out, or none, is normal; one that reads but can't be stored, such as 0, isn't counted
 * either, since the offer drops it as it would any other (storableOffer). A shop counts the rest in a log line.
 */
export function isUnreadAmount(attribute: unknown): boolean {
  const values = valuesOf(attribute);
  return values.length > 0 && !isNone(values[0]) && amountOf(attribute) === null;
}

/** An attribute's EANs: the values that are 8-14 digits as text, at most as many as PRODUCT_LIMITS allows. */
export function eansOf(attribute: unknown): string[] {
  return valuesOf(attribute)
    .filter((ean): ean is string => typeof ean === "string" && EAN.test(ean))
    .slice(0, PRODUCT_LIMITS.eans);
}
