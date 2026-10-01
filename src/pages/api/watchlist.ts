import type { APIRoute } from "astro";
import { ERROR_PARAM, EXISTS_PARAM } from "@/lib/notices";
import { addToWatchlist, parseWatchlistForm, type WatchlistError } from "@/lib/services/watchlist";

/**
 * Back to the watchlist with the notice that the product is already on it, or with an error code the page turns into
 * its own text (notices.ts).
 */
function backToWatchlist(result: "exists" | WatchlistError): string {
  return result === "exists" ? `/watchlist?${EXISTS_PARAM}=1` : `/watchlist?${ERROR_PARAM}=${result}`;
}

// "Dodaj" from the search results. It stores the posted product for the signed-in user and makes no shop request;
// the product's page, where it lands, settles its match in Natura.
export const POST: APIRoute = async (context) => {
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(backToWatchlist("config"));
  }
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // The body isn't a form at all.
    return context.redirect(backToWatchlist("invalid"));
  }
  const candidate = parseWatchlistForm(form);
  if (!candidate) {
    return context.redirect(backToWatchlist("invalid"));
  }

  const result = await addToWatchlist(supabase, candidate);
  if (result === "exists") {
    return context.redirect(backToWatchlist("exists"));
  }
  if (result === "failed") {
    return context.redirect(backToWatchlist("failed"));
  }
  // The id is the UUID the database gave the new row.
  return context.redirect(`/watchlist/${result.id}`);
};
