import type { APIRoute } from "astro";
import {
  listRefreshBackOf,
  listRefreshBackTo,
  productRefreshBackTo,
  refreshCodeOf,
  refreshPrices,
  type PriceRefreshCode,
} from "@/lib/services/price-refresh";
import { listTargets, productTargets } from "@/lib/services/price-targets";
import { shopGateFor } from "@/lib/services/shop-gate";
import { parseWatchlistItemId } from "@/lib/services/watchlist";
import { parseListFilter } from "@/lib/services/watchlist-rows";

// "Odśwież ceny" on the list, beside a product's page, and on a product's page without JavaScript. It's a plain form
// post, so Astro's checkOrigin refuses one from another site. The shop items to fetch come from the user's own rows,
// never from the form (price-targets.ts), and each is fetched through the gate and stored as a shared observation, like
// every price. The page it redirects back to shows the stored prices, with the list's filter the form posted.
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
  // Back to the product's page with the refresh's code, or, for the list's refresh, where listRefreshBackOf says: the
  // product page it was posted from or the list. Either keeps the list's filter. A crafted `back` refreshes nothing and
  // goes back to the list with no code, as a crafted id does.
  let backTo: (code: PriceRefreshCode) => string;
  if (itemId === null) {
    const listBack = listRefreshBackOf(form.get("back"), form.get("f"));
    if (listBack === null) {
      return context.redirect("/watchlist");
    }
    backTo = (code) => listRefreshBackTo(listBack, code);
  } else {
    const filter = parseListFilter(form.get("f"));
    backTo = (code) => productRefreshBackTo(itemId, filter, code);
  }
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(backTo("failed"));
  }

  // Read before any shop request: a list with nothing out of date, or a product that isn't the user's, costs none. A
  // product's shop whose decision couldn't be read is left out, and the others are still refreshed (productTargets).
  const targets = itemId === null ? await listTargets(supabase) : await productTargets(supabase, itemId);
  if (targets === "failed") {
    return context.redirect(backTo("failed"));
  }
  const refresh = await refreshPrices(shopGateFor(supabase), supabase, targets.keys);
  return context.redirect(backTo(refreshCodeOf(refresh, targets.unread.length)));
};
