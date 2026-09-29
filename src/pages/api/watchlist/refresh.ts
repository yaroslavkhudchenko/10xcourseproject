import type { APIRoute } from "astro";
import { refreshCodeOf, refreshPrices, type PriceRefreshCode } from "@/lib/services/price-refresh";
import { listTargets, productTargets } from "@/lib/services/price-targets";
import { shopGateFor } from "@/lib/services/shop-gate";
import { parseWatchlistItemId } from "@/lib/services/watchlist";

/** Back to the list, or to the product's page, with the refresh's code, which the page turns into its own text. */
function backTo(itemId: string | null, code: PriceRefreshCode): string {
  return itemId === null ? `/watchlist?prices=${code}` : `/watchlist/${itemId}?prices=${code}`;
}

// "Odśwież ceny" on the list, and on a product's page without JavaScript. It's a plain form post, so Astro's
// checkOrigin refuses one from another site. The shop items to fetch come from the user's own rows, never from the
// form (price-targets.ts), and each is fetched through the gate and stored as a shared observation, like every price.
// The page it redirects back to shows the stored prices.
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
