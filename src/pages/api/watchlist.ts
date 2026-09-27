import type { APIRoute } from "astro";
import { addToWatchlist, parseWatchlistForm } from "@/lib/services/watchlist";

/** Back to the watchlist, with a notice or an error for the page to show. */
function backToWatchlist(query: string): string {
  return `/watchlist?${query}`;
}

// "Dodaj" from the search results. It stores the posted product for the signed-in user and makes no shop request.
export const POST: APIRoute = async (context) => {
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(backToWatchlist(`error=${encodeURIComponent("Supabase nie jest skonfigurowany.")}`));
  }
  const candidate = parseWatchlistForm(await context.request.formData());
  if (!candidate) {
    return context.redirect(
      backToWatchlist(`error=${encodeURIComponent("Nie udało się dodać produktu: nieprawidłowe dane.")}`),
    );
  }

  const result = await addToWatchlist(supabase, candidate);
  if (result === "added") {
    return context.redirect(backToWatchlist("added=1"));
  }
  if (result === "exists") {
    return context.redirect(backToWatchlist("exists=1"));
  }
  return context.redirect(
    backToWatchlist(`error=${encodeURIComponent("Nie udało się dodać produktu. Spróbuj ponownie.")}`),
  );
};
