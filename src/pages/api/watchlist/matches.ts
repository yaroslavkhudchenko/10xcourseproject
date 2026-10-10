import type { APIRoute } from "astro";
import {
  decisionBackTo,
  loadWatchedProduct,
  parseMatchForm,
  recordDecision,
  type DecisionOutcome,
} from "@/lib/services/matches";
import { parseMatchedShop } from "@/lib/services/price-comparison";
import { admitDecision, type DecisionRefusal } from "@/lib/services/watched-product";
import { parseWatchlistItemId } from "@/lib/services/watchlist";
import { parseListFilter } from "@/lib/services/watchlist-rows";

// What each of the guardian's refusals comes back as, with nothing stored: a shop outside the product's matched shops,
// its own included, and a move no page offers as invalid data, which no card shows for the own shop; a form shown with
// another decision than the stored one as a decision already stored; and a decision that couldn't be read as a failure
// to try again.
const REFUSALS: Record<DecisionRefusal, DecisionOutcome> = {
  "not-a-matched-shop": { error: "invalid" },
  "illegal-move": { error: "invalid" },
  "outdated-form": "decided",
  unreadable: { error: "failed" },
};

// "To ten produkt" and "Żaden z nich" on a product's page, from a first choice or from the choice that changes a stored
// decision, for one of the matched shops. It reads the product and its stored decisions, asks the guardian whether the
// decision may be stored (admitDecision), and stores only what it admits, a re-pin's only over the decision its form
// was shown with. It makes no shop request, and goes back to the product's page with the shop the decision was for and
// the list's filter (decisionBackTo).
export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // The body isn't a form at all.
    return context.redirect(decisionBackTo(null, null, { error: "invalid" }, "all"));
  }
  // Read on their own first, so even a rejected form leads back to its product's page, to its shop's card, with the
  // list's filter.
  const itemId = parseWatchlistItemId(form.get("itemId"));
  const shop = parseMatchedShop(form.get("shop"));
  const filter = parseListFilter(form.get("f"));
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(decisionBackTo(itemId, shop, { error: "config" }, filter));
  }
  const match = parseMatchForm(form);
  if (!match) {
    return context.redirect(decisionBackTo(itemId, shop, { error: "invalid" }, filter));
  }

  const backTo = (outcome: DecisionOutcome) => decisionBackTo(match.itemId, match.shop, outcome, filter);
  // Read before any write: a product not on the user's list, another user's included, is gone, and nothing tells the
  // two apart.
  const loaded = await loadWatchedProduct(supabase, match.itemId);
  if (loaded === null) {
    return context.redirect(backTo({ error: "gone" }));
  }
  // A product that couldn't be read, or whose decisions couldn't be read at all, is a failure to try again, whichever
  // shop the post names: answered before the guardian, which would call a post for the product's own shop invalid.
  if (loaded === "failed" || loaded.decisions === "unread") {
    return context.redirect(backTo({ error: "failed" }));
  }
  const admission = admitDecision(loaded.watched, match);
  if (admission.kind === "refused") {
    return context.redirect(backTo(REFUSALS[admission.reason]));
  }
  // The form's own `replaces`, which the guardian checked against the decision just read, so a decision changed since
  // then still stands: the write's compare-and-swap checks it again.
  const { change } = admission;
  const result = await recordDecision(supabase, change.itemId, change.shop, change.decision, change.replaces);
  switch (result) {
    case "saved":
      return context.redirect(backTo(change.decision.action === "confirm" ? "matched" : "declined"));
    case "decided":
      return context.redirect(backTo("decided"));
    case "gone":
      return context.redirect(backTo({ error: "gone" }));
    case "failed":
      return context.redirect(backTo({ error: "failed" }));
  }
};
