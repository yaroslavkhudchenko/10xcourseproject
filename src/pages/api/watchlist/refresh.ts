import type { APIRoute } from "astro";
import { PRICES_PARAM } from "@/lib/notices";
import {
  listRefreshBackOf,
  listRefreshBackTo,
  refreshCodeOf,
  refreshPrices,
  type PriceRefreshCode,
} from "@/lib/services/price-refresh";
import { listTargets, productTargets } from "@/lib/services/price-targets";
import { shopGateFor } from "@/lib/services/shop-gate";
import { parseWatchlistItemId } from "@/lib/services/watchlist";

// "Odśwież ceny" on the list, beside a product's page, and on a product's page without JavaScript. It's a plain form
// post, so Astro's checkOrigin refuses one from another site. The shop items to fetch come from the user's own rows,
// never from the form (price-targets.ts), and each is fetched through the gate and stored as a shared observation, like
// every price. The page it redirects back to shows the stored prices.
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
  // product page it was posted from or the list, keeping the list's filter. A crafted `back` refreshes nothing and goes
  // back to the list with no code, as a crafted id does.
  let backTo: (code: PriceRefreshCode) => string;
  if (itemId === null) {
    const listBack = listRefreshBackOf(form.get("back"), form.get("f"));
    if (listBack === null) {
      return context.redirect("/watchlist");
    }
    backTo = (code) => listRefreshBackTo(listBack, code);
  } else {
    backTo = (code) => `/watchlist/${itemId}?${PRICES_PARAM}=${code}`;
  }
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(backTo("failed"));
  }

  // Read before any shop request: a list with nothing out of date, or a product that isn't the user's, costs none.
  const targets = itemId === null ? await listTargets(supabase) : await productTargets(supabase, itemId);
  if (targets === "failed") {
    return context.redirect(backTo("failed"));
  }
  const refresh = await refreshPrices(shopGateFor(supabase), supabase, targets);
  return context.redirect(backTo(refreshCodeOf(refresh)));
};
