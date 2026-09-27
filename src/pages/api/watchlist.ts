import type { APIRoute } from "astro";
import { addToWatchlist, parseWatchlistForm, type WatchlistError } from "@/lib/services/watchlist";

/** Back to the watchlist with a notice, or with an error code the page turns into its own text. */
function backToWatchlist(result: "exists=1" | `error=${WatchlistError}`): string {
  return `/watchlist?${result}`;
}

// "Dodaj" from the search results. It stores the posted product for the signed-in user and makes no shop request;
// the product's page, where it lands, settles its match in Natura.
export const POST: APIRoute = async (context) => {
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(backToWatchlist("error=config"));
  }
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // The body isn't a form at all.
    return context.redirect(backToWatchlist("error=invalid"));
  }
  const candidate = parseWatchlistForm(form);
  if (!candidate) {
    return context.redirect(backToWatchlist("error=invalid"));
  }

  const result = await addToWatchlist(supabase, candidate);
  if (result === "exists") {
    return context.redirect(backToWatchlist("exists=1"));
  }
  if (result === "failed") {
    return context.redirect(backToWatchlist("error=failed"));
  }
  // The id is the UUID the database gave the new row.
  return context.redirect(`/watchlist/${result.id}`);
};
