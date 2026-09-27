import type { APIRoute } from "astro";
import { parseMatchForm, recordDecision, type MatchError } from "@/lib/services/matches";
import { parseWatchlistItemId } from "@/lib/services/watchlist";

type Outcome = "matched=1" | "declined=1" | "decided=1" | `error=${MatchError}`;

/**
 * Back to the product's page with a notice, or with an error code the page turns into its own text. Without a valid
 * product id, which only a crafted post lacks, back to the list with no code: the list's codes belong to "Dodaj".
 */
function backTo(itemId: string | null, outcome: Outcome): string {
  return itemId === null ? "/watchlist" : `/watchlist/${itemId}?${outcome}`;
}

// "To ten produkt" and "Żaden z nich" on a product's page. It stores the signed-in user's decision and makes no shop
// request.
export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // The body isn't a form at all.
    return context.redirect(backTo(null, "error=invalid"));
  }
  // Checked on its own first, so even a rejected form leads back to its product's page.
  const itemId = parseWatchlistItemId(form.get("itemId"));
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(backTo(itemId, "error=config"));
  }
  const match = parseMatchForm(form);
  if (!match) {
    return context.redirect(backTo(itemId, "error=invalid"));
  }

  const result = await recordDecision(supabase, match.itemId, match.shop, match.decision);
  switch (result) {
    case "saved":
      return context.redirect(backTo(match.itemId, match.decision.action === "confirm" ? "matched=1" : "declined=1"));
    case "decided":
      return context.redirect(backTo(match.itemId, "decided=1"));
    case "gone":
      return context.redirect(backTo(match.itemId, "error=gone"));
    case "failed":
      return context.redirect(backTo(match.itemId, "error=failed"));
  }
};
