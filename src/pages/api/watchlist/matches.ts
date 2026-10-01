import type { APIRoute } from "astro";
import { decisionBackTo, parseMatchForm, recordDecision } from "@/lib/services/matches";
import { parseWatchlistItemId } from "@/lib/services/watchlist";
import { parseListFilter } from "@/lib/services/watchlist-rows";

// "To ten produkt" and "Żaden z nich" on a product's page, from a first choice or from the choice that changes a stored
// decision. It stores the signed-in user's decision, a re-pin's only over the decision its form was shown with, makes
// no shop request, and goes back to the product's page with the list's filter (decisionBackTo).
export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // The body isn't a form at all.
    return context.redirect(decisionBackTo(null, { error: "invalid" }, "all"));
  }
  // Read on their own first, so even a rejected form leads back to its product's page, with the list's filter.
  const itemId = parseWatchlistItemId(form.get("itemId"));
  const filter = parseListFilter(form.get("f"));
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(decisionBackTo(itemId, { error: "config" }, filter));
  }
  const match = parseMatchForm(form);
  if (!match) {
    return context.redirect(decisionBackTo(itemId, { error: "invalid" }, filter));
  }

  const result = await recordDecision(supabase, match.itemId, match.shop, match.decision, match.replaces);
  switch (result) {
    case "saved":
      return context.redirect(
        decisionBackTo(match.itemId, match.decision.action === "confirm" ? "matched" : "declined", filter),
      );
    case "decided":
      return context.redirect(decisionBackTo(match.itemId, "decided", filter));
    case "gone":
      return context.redirect(decisionBackTo(match.itemId, { error: "gone" }, filter));
    case "failed":
      return context.redirect(decisionBackTo(match.itemId, { error: "failed" }, filter));
  }
};
