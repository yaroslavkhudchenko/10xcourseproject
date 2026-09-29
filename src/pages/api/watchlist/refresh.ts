import type { SupabaseClient } from "@supabase/supabase-js";
import type { APIRoute } from "astro";
import { listMatches, listMatchStates } from "@/lib/services/matches";
import { listPricedItems, productPriceKeys, staleTargets } from "@/lib/services/price-comparison";
import { refreshCodeOf, refreshPrices, type PriceRefreshCode } from "@/lib/services/price-refresh";
import { listLatestPrices } from "@/lib/services/prices";
import { shopGateFor } from "@/lib/services/shop-gate";
import { getWatchlistProduct, listWatchlist, parseWatchlistItemId } from "@/lib/services/watchlist";
import type { PriceKey } from "@/types";

/** Back to the list, or to the product's page, with the refresh's code, which the page turns into its own text. */
function backTo(itemId: string | null, code: PriceRefreshCode): string {
  return itemId === null ? `/watchlist?prices=${code}` : `/watchlist/${itemId}?prices=${code}`;
}

/**
 * What the list's "Odśwież ceny" fetches: every shop item of the user's list whose last check is more than 15 minutes
 * old, as the stored prices tell, the oldest first. `failed` when the list, its Natura decisions or its prices couldn't
 * be read, since then the refresh can't tell what's out of date.
 */
async function listTargets(supabase: SupabaseClient): Promise<PriceKey[] | "failed"> {
  const [items, matches, prices] = await Promise.all([
    listWatchlist(supabase),
    listMatchStates(supabase),
    listLatestPrices(supabase),
  ]);
  if (items === null || matches === null || prices === null) {
    return "failed";
  }
  return staleTargets([...listPricedItems(items, matches, prices).values()].flat(), Date.now());
}

/**
 * What a product page's "Odśwież ceny" fetches without JavaScript: every shop item of the user's product, however
 * recently it was checked, as the island's button does. None for a product that isn't on the user's list (RLS answers
 * another user's product the same way); `failed` when the product or its decisions couldn't be read.
 */
async function productTargets(supabase: SupabaseClient, itemId: string): Promise<PriceKey[] | "failed"> {
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

// "Odśwież ceny" on the list, and on a product's page without JavaScript. It's a plain form post, so Astro's
// checkOrigin refuses one from another site. The shop items to fetch come from the user's own rows, never from the
// form, and each is fetched through the gate and stored as a shared observation, like every price. The page it
// redirects back to shows the stored prices.
export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // The body isn't a form at all.
    return context.redirect("/watchlist");
  }
  // Without an id, the whole list. An id that isn't a UUID only comes from a crafted post, which goes back to the list
  // with no code, since the list's codes belong to its own refresh.
  const rawItemId = form.get("itemId");
  const itemId = parseWatchlistItemId(rawItemId);
  if (rawItemId !== null && itemId === null) {
    return context.redirect("/watchlist");
  }
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(backTo(itemId, "failed"));
  }

  // Read before any shop request: a list with nothing out of date, or a product that isn't the user's, costs none.
  const targets = itemId === null ? await listTargets(supabase) : await productTargets(supabase, itemId);
  if (targets === "failed") {
    return context.redirect(backTo(itemId, "failed"));
  }
  const refresh = await refreshPrices(shopGateFor(supabase), supabase, targets);
  return context.redirect(backTo(itemId, refreshCodeOf(refresh)));
};
