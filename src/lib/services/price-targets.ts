import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { listMatches, listMatchStates, shopItemIdSchema } from "@/lib/services/matches";
import {
  listPricedItems,
  MATCHED_SHOPS,
  PRICED_SHOPS,
  productPriceKeys,
  staleTargets,
  type MatchableShop,
  type PriceDecision,
  type PricedShop,
} from "@/lib/services/price-comparison";
import { listLatestPrices } from "@/lib/services/prices";
import { getWatchlistProduct, listWatchlist, watchlistItemIdSchema } from "@/lib/services/watchlist";
import type { PriceKey, ShopMatch } from "@/types";

// Which shop items a price refresh fetches, for the product page's island (/api/watchlist/prices) and for "Odśwież
// ceny" (/api/watchlist/refresh). They come from the user's own rows, read through the user's own client, never from
// the request, so the browser can't choose what gets fetched: RLS answers another user's product as no product at all.
// The island's request names the shop item its page shows, but only to compare it with the one the rows give.

/**
 * What the island asks /api/watchlist/prices for: which of the user's products, which shop, and the shop item its page
 * shows there. That item is never fetched on the request's word: it's only compared with the one the user's rows give
 * (priceTargetFor). Any other field in the body is dropped.
 */
export const priceRequestSchema = z.object({
  itemId: watchlistItemIdSchema,
  shop: z.enum(PRICED_SHOPS),
  shopItemId: shopItemIdSchema,
});

/** The island's price request, checked (priceRequestSchema). */
export type PriceRequest = z.infer<typeof priceRequestSchema>;

/**
 * The shop item a refresh of the user's product fetches: the product's own item for Rossmann, where it was picked, and
 * its matched item for a matched shop. Null when the product isn't on the user's list (RLS answers another user's
 * product the same way) or has no matched item in that shop; `failed` when the rows couldn't be read, the shop's
 * decision among them, which may hide a match.
 */
export async function shopItemFor(
  supabase: SupabaseClient,
  itemId: string,
  shop: PricedShop,
): Promise<PriceKey | null | "failed"> {
  const found = await itemInRows(supabase, itemId, shop);
  return found === "failed" ? "failed" : found.key;
}

/**
 * The shop item the island's request refreshes: the one the user's rows give (shopItemFor), never the one the request
 * names, which is only compared with it. `changed` when the rows give another item than the page shows, or none while
 * the product is still on the list, as after a re-pin or a decline in another tab, so a page left open never keeps a
 * price the user's rows no longer hold for it; `gone` when the product isn't on the user's list; `failed` when the rows
 * couldn't be read.
 */
export async function priceTargetFor(
  supabase: SupabaseClient,
  request: PriceRequest,
): Promise<PriceKey | "gone" | "changed" | "failed"> {
  const found = await itemInRows(supabase, request.itemId, request.shop);
  if (found === "failed") {
    return "failed";
  }
  if (!found.listed) {
    return "gone";
  }
  return found.key?.shopItemId === request.shopItemId ? found.key : "changed";
}

/**
 * The product's item in a shop as the user's rows give it: whether the product is still on the user's list, and the
 * item a refresh fetches there, null without one; `failed` when the rows couldn't be read (shopItemFor).
 */
async function itemInRows(
  supabase: SupabaseClient,
  itemId: string,
  shop: PricedShop,
): Promise<{ listed: boolean; key: PriceKey | null } | "failed"> {
  if (shop === "rossmann") {
    const product = await getWatchlistProduct(supabase, itemId);
    if (product === "failed") {
      return "failed";
    }
    return {
      listed: product !== null,
      key: product?.source === "rossmann" ? { shop, shopItemId: product.sourceItemId } : null,
    };
  }
  const [product, read] = await Promise.all([getWatchlistProduct(supabase, itemId), listMatches(supabase, itemId)]);
  if (product === "failed" || read === null || read.unreadable.includes(shop)) {
    return "failed";
  }
  const match = read.matches.find((decision) => decision.shop === shop);
  return {
    listed: product !== null,
    key: product !== null && match?.state === "matched" ? { shop, shopItemId: match.item.shopItemId } : null,
  };
}

/**
 * What a refresh from the form fetches: the shop items to ask for, in the order to ask, and the shops it can't name an
 * item in, since the product's decision there couldn't be read, which the refresh counts as shops that gave no answer
 * (refreshCodeOf).
 */
export interface RefreshTargets {
  keys: PriceKey[];
  unread: MatchableShop[];
}

/**
 * What the list's "Odśwież ceny" fetches: every shop item of the user's list whose last check is more than 15 minutes
 * old, as the stored prices tell, the oldest first: each product's own Rossmann item and its match in each of `shops`,
 * the matched shops unless a test names others. Odd rows never stop the refresh: an item without a readable price row,
 * whether its row came back odd or an odd row couldn't say whose it is, counts as never checked, so it's fetched, which
 * also repairs its latest row; and a product whose decision in a shop couldn't be read has no item there to fetch. The
 * list names no shop unread, since it asks only for what's out of date, which such a decision can't tell. `failed` when
 * the list, its decisions or its prices couldn't be read at all, since then the refresh can't tell what's out of date.
 */
export async function listTargets(
  supabase: SupabaseClient,
  shops: readonly MatchableShop[] = MATCHED_SHOPS,
): Promise<RefreshTargets | "failed"> {
  const [items, matches, prices] = await Promise.all([
    listWatchlist(supabase),
    listMatchStates(supabase, shops),
    listLatestPrices(supabase),
  ]);
  if (items === null || matches === null || prices === null) {
    return "failed";
  }
  const priced = [...listPricedItems(items, matches.states, prices.prices, shops).values()].flat();
  return { keys: staleTargets(priced, Date.now()), unread: [] };
}

/**
 * What a product page's "Odśwież ceny" fetches without JavaScript: every shop item of the user's product, however
 * recently it was checked, as the island's button does: its own Rossmann item and its match in each of `shops`, the
 * matched shops unless a test names others. A shop whose decision couldn't be read has no item to fetch and is named
 * unread, while the other shops' items are still fetched, as the island asks each shop on its own (shopItemFor). None
 * for a product that isn't on the user's list (RLS answers another user's product the same way); `failed` when the
 * product or its decisions couldn't be read at all.
 */
export async function productTargets(
  supabase: SupabaseClient,
  itemId: string,
  shops: readonly MatchableShop[] = MATCHED_SHOPS,
): Promise<RefreshTargets | "failed"> {
  const [product, read] = await Promise.all([
    getWatchlistProduct(supabase, itemId),
    listMatches(supabase, itemId, shops),
  ]);
  if (product === "failed" || read === null) {
    return "failed";
  }
  if (product === null) {
    return { keys: [], unread: [] };
  }
  return { keys: productPriceKeys(product, read.matches.map(priceDecisionOf), shops), unread: read.unreadable };
}

/** A product's stored decision in a shop as its prices read it: a match names its item there, any other none. */
function priceDecisionOf(match: ShopMatch): PriceDecision {
  return match.state === "matched"
    ? { shop: match.shop, state: match.state, shopItemId: match.item.shopItemId }
    : { shop: match.shop, state: match.state };
}
