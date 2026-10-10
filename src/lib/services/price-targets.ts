import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { listMatches, listMatchStates, loadWatchedProduct, shopItemIdSchema } from "@/lib/services/matches";
import {
  listPricedItems,
  PRICED_SHOPS,
  productPriceKeys,
  staleTargets,
  type MatchableShop,
  type PriceDecision,
  type PricedShop,
} from "@/lib/services/price-comparison";
import { listLatestPrices } from "@/lib/services/prices";
import { matchedShopsIn, watchedProductOf } from "@/lib/services/watched-product";
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
 * The shop item a refresh of the user's product fetches: the product's own item in its own shop, the one it was picked
 * in, and its matched item in any of its matched shops. Null when the product isn't on the user's list (RLS answers
 * another user's product the same way) or has no matched item in that shop; `failed` when the rows couldn't be read,
 * the shop's decision among them, which may hide a match.
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
 * item a refresh fetches there, null without one; `failed` when the rows couldn't be read (shopItemFor). The product is
 * read first, since it says which shop is its own: there its own item stands, whatever decision is stored in that shop,
 * and only in another shop, one of its matched shops, are its decisions read for its match, by where the product
 * stands there (watchedProductOf): a decision that couldn't be read is a failure, since it may hide a match, a match
 * gives its item, and anything else none. So refetching a product's own item reads one row, and its match two, one
 * after the other.
 */
async function itemInRows(
  supabase: SupabaseClient,
  itemId: string,
  shop: PricedShop,
): Promise<{ listed: boolean; key: PriceKey | null } | "failed"> {
  const product = await getWatchlistProduct(supabase, itemId);
  if (product === "failed") {
    return "failed";
  }
  if (product === null) {
    return { listed: false, key: null };
  }
  if (product.source === shop) {
    return { listed: true, key: { shop, shopItemId: product.sourceItemId } };
  }
  const read = await listMatches(supabase, itemId);
  const standing = watchedProductOf(product, read).standings[shop];
  if (standing?.kind === "unreadable") {
    return "failed";
  }
  const match = standing?.kind === "decided" ? standing.decision : null;
  return { listed: true, key: match?.state === "matched" ? { shop, shopItemId: match.item.shopItemId } : null };
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
 * old, as the stored prices tell, the oldest first: each product's own item and its match in each of its matched shops
 * (listPricedItems). The decisions are read in every one of `shops`, the priced shops unless a test names others, and
 * only a product's own matched shops' decisions count for it. Odd rows never stop the refresh: an item without a
 * readable price row, whether its row came back odd or an odd row couldn't say whose it is, counts as never checked,
 * so it's fetched, which also repairs its latest row; and a product whose decision in a shop couldn't be read has no
 * item there to fetch. The list names no shop unread, since it asks only for what's out of date, which such a decision
 * can't tell. `failed` when the list, its decisions or its prices couldn't be read at all, since then the refresh
 * can't tell what's out of date.
 */
export async function listTargets(
  supabase: SupabaseClient,
  shops: readonly PricedShop[] = PRICED_SHOPS,
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
 * recently it was checked, as the island's button does: its own item and its match in each of its matched shops among
 * `shops`, the priced shops unless a test names others (productPriceKeys). The product and its decisions are read at
 * once (loadWatchedProduct), and only its matched shops' standings count: a decision stored in its own shop is left
 * out, and so is a row there that couldn't be read. A matched shop whose decision couldn't be read has no item to fetch
 * and is named unread, in the priced shops' order, while the other shops' items are still fetched, as the island asks
 * each shop on its own (shopItemFor). The product's read decides first: none for a product that isn't on the user's
 * list, whatever its decisions' read (RLS answers another user's product the same way), so it asks no shop; `failed`
 * when the product couldn't be read, or its decisions couldn't be read at all.
 */
export async function productTargets(
  supabase: SupabaseClient,
  itemId: string,
  shops: readonly PricedShop[] = PRICED_SHOPS,
): Promise<RefreshTargets | "failed"> {
  const loaded = await loadWatchedProduct(supabase, itemId, shops);
  if (loaded === null) {
    return { keys: [], unread: [] };
  }
  if (loaded === "failed" || loaded.decisions === "unread") {
    return "failed";
  }
  const { product, watched } = loaded;
  const decided: PriceDecision[] = [];
  const unread: PricedShop[] = [];
  for (const shop of matchedShopsIn(watched)) {
    const standing = watched.standings[shop];
    if (standing?.kind === "decided") {
      decided.push(priceDecisionOf(standing.decision));
    } else if (standing?.kind === "unreadable") {
      unread.push(shop);
    }
  }
  return { keys: productPriceKeys(product, decided, shops), unread };
}

/** A product's stored decision in a shop as its prices read it: a match names its item there, any other none. */
function priceDecisionOf(match: ShopMatch): PriceDecision {
  return match.state === "matched"
    ? { shop: match.shop, state: match.state, shopItemId: match.item.shopItemId }
    : { shop: match.shop, state: match.state };
}
