import type { APIRoute } from "astro";
import { parseWatchlistItemId, removalBackTo, removeFromWatchlist } from "@/lib/services/watchlist";
import { parseListFilter } from "@/lib/services/watchlist-rows";

// "Usuń z listy" at the foot of a product's page. It deletes the signed-in user's own row, and with it, through the
// foreign key's cascade, their own decisions in the shops for the product; no price observation references a product,
// so every watcher keeps the item's prices (FR-005). It's a plain form post, so Astro's checkOrigin refuses one from
// another site. It makes no shop request, and neither does the list it goes back to, which says once what the removal
// came to, keeping the list's filter (removalBackTo).
export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // The body isn't a form at all.
    return context.redirect("/watchlist");
  }
  // An id that isn't a UUID only comes from a crafted post: it removes nothing and goes back to the list with no code,
  // since the list's codes belong to the app's own posts.
  const itemId = parseWatchlistItemId(form.get("itemId"));
  if (itemId === null) {
    return context.redirect("/watchlist");
  }
  const filter = parseListFilter(form.get("f"));
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(removalBackTo(itemId, "config", filter));
  }

  const result = await removeFromWatchlist(supabase, itemId);
  return context.redirect(removalBackTo(itemId, result, filter));
};
