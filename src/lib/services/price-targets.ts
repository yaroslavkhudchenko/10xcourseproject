import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { listMatches, listMatchStates, shopItemIdSchema } from "@/lib/services/matches";
import {
  listPricedItems,
  PRICED_SHOPS,
  productPriceKeys,
  staleTargets,
  type PricedShop,
} from "@/lib/services/price-comparison";
import { listLatestPrices } from "@/lib/services/prices";
import { getWatchlistProduct, listWatchlist, watchlistItemIdSchema } from "@/lib/services/watchlist";
import type { PriceKey } from "@/types";

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
 * its matched item for Natura. Null when the product isn't on the user's list (RLS answers another user's product the
 * same way) or has no matched item in that shop; `failed` when the rows couldn't be read.
 */
export async function shopItemFor(
  supabase: SupabaseClient,
  itemId: string,
  shop: PricedShop,
): Promise<PriceKey | null | "failed"> {
  if (shop === "rossmann") {
    const product = await getWatchlistProduct(supabase, itemId);
    if (product === "failed") {
      return "failed";
    }
    return product?.source === "rossmann" ? { shop, shopItemId: product.sourceItemId } : null;
  }
  const [product, matches] = await Promise.all([getWatchlistProduct(supabase, itemId), listMatches(supabase, itemId)]);
  if (product === "failed" || matches === null) {
    return "failed";
  }
  const match = matches.find((decision) => decision.shop === shop);
  return product !== null && match?.state === "matched" ? { shop, shopItemId: match.item.shopItemId } : null;
}

/**
 * The shop item the island's request refreshes: the one the user's rows give (shopItemFor), never the one the request
 * names, which is only compared with it. `changed` when the rows give another item than the page shows, as after a
 * re-pin in another tab, so a page left open never shows another item's price under its item's name; `gone` when the
 * product isn't on the user's list or has no matched item in that shop; `failed` when the rows couldn't be read.
 */
export async function priceTargetFor(
  supabase: SupabaseClient,
  request: PriceRequest,
): Promise<PriceKey | "gone" | "changed" | "failed"> {
  const key = await shopItemFor(supabase, request.itemId, request.shop);
  if (key === "failed") {
    return "failed";
  }
  if (key === null) {
    return "gone";
  }
  return key.shopItemId === request.shopItemId ? key : "changed";
}

/**
 * What the list's "Odśwież ceny" fetches: every shop item of the user's list whose last check is more than 15 minutes
 * old, as the stored prices tell, the oldest first. Odd rows never stop the refresh: an item without a readable price
 * row, whether its row came back odd or an odd row couldn't say whose it is, counts as never checked, so it's fetched,
 * which also repairs its latest row; and a product whose Natura decision couldn't be read has no Natura item to fetch.
 * `failed` when the list, its Natura decisions or its prices couldn't be read at all, since then the refresh can't
 * tell what's out of date.
 */
export async function listTargets(supabase: SupabaseClient): Promise<PriceKey[] | "failed"> {
  const [items, matches, prices] = await Promise.all([
    listWatchlist(supabase),
    listMatchStates(supabase),
    listLatestPrices(supabase),
  ]);
  if (items === null || matches === null || prices === null) {
    return "failed";
  }
  return staleTargets([...listPricedItems(items, matches.states, prices.prices).values()].flat(), Date.now());
}

/**
 * What a product page's "Odśwież ceny" fetches without JavaScript: every shop item of the user's product, however
 * recently it was checked, as the island's button does. None for a product that isn't on the user's list (RLS answers
 * another user's product the same way); `failed` when the product or its decisions couldn't be read.
 */
export async function productTargets(supabase: SupabaseClient, itemId: string): Promise<PriceKey[] | "failed"> {
  const [product, matches] = await Promise.all([getWatchlistProduct(supabase, itemId), listMatches(supabase, itemId)]);
  if (product === "failed" || matches === null) {
    return "failed";
  }
  if (product === null) {
    return [];
  }
  const natura = matches.find((match) => match.shop === "natura");
  return productPriceKeys(product, natura?.state === "matched" ? natura.item.shopItemId : null);
}
