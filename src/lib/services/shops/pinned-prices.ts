import type { ShopGate } from "@/lib/services/shop-gate";
import { isRefusal } from "@/lib/services/shops/shop-outcome";
import type { PriceCheck, ShopOffer, ShopUnavailable } from "@/types";

// The rules every shop's pinned-price requests follow, whatever its search runs on: each id is asked for once, an id
// that can't go into a request is never sent, the ids go in batches, one request at a time, and once the shop refuses
// nothing more is asked. Each answer's hits are read one by one, and an id without a hit is missing only when the
// answer holds every hit it matched and each of them was read and asked for. A shop's client sends the request and
// tells its item hits apart from anything else its answer holds.

/**
 * What one request for pinned items came to: the answer's item hits and whether they're every hit the request matched,
 * or why there's no answer to read, which every id of the request then gets.
 */
export type PinnedAnswer = { kind: "hits"; hits: unknown[]; complete: boolean } | ShopUnavailable;

/** A shop's pinned-price requests: how they're sent, how their hits read, and how their log lines name things. */
export interface PinnedPriceShop {
  /** The most ids one request asks for. */
  batchSize: number;
  /** True for an id that can go into a request; any other is never sent. */
  isItemId: (id: string) => boolean;
  /**
   * Asks the shop for the given ids through the gate. Resolves to the answer's item hits, already told apart from
   * anything else it holds, such as a query suggestion, or to why there's none to read. It never throws.
   */
  request: (gate: ShopGate, ids: string[]) => Promise<PinnedAnswer>;
  /** An item hit's id and offer, or null when either can't be read. */
  readHit: (hit: unknown) => { id: string; offer: ShopOffer } | null;
  /**
   * True for an item hit whose offer couldn't read whether it's orderable online, and so takes it for not orderable.
   * The kept hits it's true for are counted in a log line (logOddAvailability). Without it, none is counted.
   */
  hasOddAvailability?: (hit: unknown) => boolean;
  log: {
    /** The event of the log lines, such as "natura-prices". */
    event: string;
    /** What the details call an item id, such as "SKU". */
    id: string;
  };
}

/**
 * Fetches pinned items' offers through the gate: each id once, in requests of at most `batchSize` ids, each after the
 * one before. Once the shop refuses, busy under the cap, paused or stopped, the ids of the requests after it get that
 * same answer with no request and no reservation. Resolves to a check for every id given: its offer, `missing` when
 * the shop answered without it in an answer that holds every hit it matched, or `unavailable` when the id can't go into
 * a request, the request got no answer to read, or the answer may have left its hit out. It never throws.
 */
export async function fetchPinnedPrices(
  shop: PinnedPriceShop,
  gate: ShopGate,
  ids: string[],
): Promise<Map<string, PriceCheck>> {
  // Every id starts as unanswered, once each, in the order given; each id that's sent gets its request's answer.
  const checks = new Map<string, PriceCheck>();
  const sendable: string[] = [];
  for (const id of new Set(ids)) {
    checks.set(id, failed());
    if (shop.isItemId(id)) {
      sendable.push(id);
    }
  }
  const unsent = checks.size - sendable.length;
  if (unsent > 0) {
    // How many, never which: an id names the product.
    const word = shop.log.id;
    logFailure(shop.log.event, `invalid ${word}s`, `${unsent} of ${checks.size} ${word}s not sent`);
  }
  // A failed request doesn't stop the next one; a refusal does.
  let refusal: ShopUnavailable | null = null;
  for (let start = 0; start < sendable.length; start += shop.batchSize) {
    const batch = sendable.slice(start, start + shop.batchSize);
    if (refusal !== null) {
      for (const id of batch) {
        checks.set(id, { ...refusal });
      }
      continue;
    }
    for (const [id, check] of checksOf(shop, batch, await shop.request(gate, batch))) {
      checks.set(id, check);
      if (isRefusal(check)) {
        refusal = check;
      }
    }
  }
  return checks;
}

/** Each asked-for id's check from its request's answer. */
function checksOf(shop: PinnedPriceShop, ids: string[], answer: PinnedAnswer): Map<string, PriceCheck> {
  if (answer.kind === "unavailable") {
    return new Map(ids.map((id): [string, PriceCheck] => [id, { ...answer }]));
  }
  const asked = new Set(ids);
  const itemHits = answer.hits;
  const offers = new Map<string, ShopOffer>();
  const kept: unknown[] = [];
  let dropped = 0;
  let notAsked = 0;
  for (const hit of itemHits) {
    const read = shop.readHit(hit);
    if (read === null) {
      dropped++;
      continue;
    }
    if (asked.has(read.id)) {
      offers.set(read.id, read.offer);
      kept.push(hit);
    } else {
      notAsked++;
    }
  }
  // How many, never which: a hit carries the product's id and name.
  if (dropped > 0) {
    logFailure(shop.log.event, "hits dropped", `${dropped} of ${itemHits.length} product hits`);
  }
  logOddAvailability(shop.hasOddAvailability, shop.log.event, kept, itemHits.length);
  if (notAsked > 0) {
    // Hits for ids nobody asked for mean the id filter wasn't applied.
    logFailure(shop.log.event, "hits not asked for", `${notAsked} of ${itemHits.length} product hits`);
  }
  if (!answer.complete) {
    // An answer cut short, or one that can't say it isn't, may have left out an asked-for item's hit.
    logFailure(
      shop.log.event,
      "answer incomplete",
      `${itemHits.length} product hits for ${ids.length} ${shop.log.id}s`,
    );
  }
  // An id without a hit is missing only when the answer holds every hit it matched and every hit was read and was one
  // asked for. Otherwise the left-out or unread hit could be that id's, and a changed format would be stored as items
  // the shop no longer sells: so, as in a search, hits that all fail their check make every id unavailable.
  const clear = answer.complete && dropped === 0 && notAsked === 0;
  return new Map(
    ids.map((id): [string, PriceCheck] => {
      const offer = offers.get(id);
      if (offer !== undefined) {
        return [id, { kind: "price", offer }];
      }
      return [id, clear ? { kind: "missing" } : failed()];
    }),
  );
}

/**
 * Logs how many of the kept hits have an availability their offer couldn't read (`hasOddAvailability`): each reads as
 * not orderable online, so it can't be named cheapest, and only this line shows a changed format.
 */
export function logOddAvailability(
  hasOddAvailability: ((hit: unknown) => boolean) | undefined,
  event: string,
  kept: unknown[],
  itemHits: number,
): void {
  const odd = kept.filter((hit) => hasOddAvailability?.(hit) === true).length;
  if (odd > 0) {
    // How many, never which, as with dropped hits.
    logFailure(event, "availability unread", `${odd} of ${itemHits} product hits`);
  }
}

/** A shop answer that couldn't be used, fresh for each id. */
export function failed(): ShopUnavailable {
  return { kind: "unavailable", reason: "failed" };
}

/** Logs why a shop's answer, or part of one, couldn't be used: one JSON line, never the answer's content. */
export function logFailure(event: string, reason: string, detail: string): void {
  // eslint-disable-next-line no-console -- one line per unusable shop answer; Workers observability collects it.
  console.warn(JSON.stringify({ event, reason, detail }));
}
