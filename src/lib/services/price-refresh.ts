import type { SupabaseClient } from "@supabase/supabase-js";
import { keyText, recordPriceChecks, type PriceRecordResult } from "@/lib/services/prices";
import type { ShopGate } from "@/lib/services/shop-gate";
import { fetchNaturaPrices } from "@/lib/services/shops/natura";
import { fetchRossmannPrice } from "@/lib/services/shops/rossmann";
import type { PriceCheck, PriceKey, ShopId } from "@/types";

// Refreshing pinned items' prices, for a product's page and for the list: every request goes through the gate, and
// every price or missing item the shops answer with is stored as a shared observation (prices.ts).

// Rossmann has no batch route, so each product is a request of its own; at most this many run at once.
const ROSSMANN_AT_ONCE = 5;

/** What a refresh came to: each shop item's check, in the order the items were given, and how storing them went. */
export interface PriceRefresh {
  results: { key: PriceKey; check: PriceCheck }[];
  saved: PriceRecordResult;
}

/**
 * Fetches the current offer of each shop item through the gate, then stores every price and missing item with one
 * insert; an item the shop gave no answer for stores nothing and keeps its last price with its age. Rossmann is asked
 * one product per request, at most 5 at a time, starting in the order given, so callers pass the oldest check first
 * and the cap cuts off the newest. Natura's SKUs are asked for together, 50 per request, alongside Rossmann's. Each
 * item is checked once, however often it's given, and an item in a shop S-03 doesn't fetch yet is `unavailable`.
 */
export async function refreshPrices(
  gate: ShopGate,
  supabase: SupabaseClient,
  targets: PriceKey[],
): Promise<PriceRefresh> {
  const keys = distinct(targets);
  const rossmannIds = keys.filter((key) => key.shop === "rossmann").map((key) => key.shopItemId);
  const naturaSkus = keys.filter((key) => key.shop === "natura").map((key) => key.shopItemId);
  const [rossmannChecks, naturaChecks] = await Promise.all([
    mapAtMost(ROSSMANN_AT_ONCE, rossmannIds, (id) => fetchRossmannPrice(gate, id)),
    fetchNaturaPrices(gate, naturaSkus),
  ]);
  // Each shop's checks by its own id for the item.
  const fetched: Partial<Record<ShopId, Map<string, PriceCheck>>> = {
    rossmann: new Map(rossmannIds.map((id, index): [string, PriceCheck] => [id, rossmannChecks[index]])),
    natura: naturaChecks,
  };
  const results = keys.map((key) => ({ key, check: fetched[key.shop]?.get(key.shopItemId) ?? notFetched() }));
  // recordPriceChecks leaves out the items the shops gave no answer for.
  const saved = await recordPriceChecks(supabase, results);
  return { results, saved };
}

/** The shop items once each, in the order they first appear. */
function distinct(targets: PriceKey[]): PriceKey[] {
  const seen = new Set<string>();
  return targets.filter((key) => {
    const text = keyText(key);
    if (seen.has(text)) {
      return false;
    }
    seen.add(text);
    return true;
  });
}

/**
 * Runs `task` for every item, at most `limit` at a time, starting them in the items' order: each run that ends starts
 * the next item. Resolves to the results in the items' order.
 */
async function mapAtMost<T, R>(limit: number, items: T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/** The check of an item in a shop whose prices S-03 doesn't fetch. */
function notFetched(): PriceCheck {
  return { kind: "unavailable", reason: "failed" };
}
