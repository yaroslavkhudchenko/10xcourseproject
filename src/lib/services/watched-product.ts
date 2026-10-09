import type { ExpectedDecision, MatchDecision, MatchesRead, MatchForm } from "@/lib/services/matches";
import { matchedShopsOf, PRICED_SHOPS, type PricedShop } from "@/lib/services/price-comparison";
import type { ShopId, ShopMatch, WatchlistProduct } from "@/types";

// The guardian of a watched product's decisions: the one place that decides whether a decision posted from the
// product's page may be stored. It knows the product's matched shops (matchedShopsOf) and where the product stands in
// each, from the two reads its page makes, and admits a confirm or a decline only from the decision the form was shown
// with, and only along the moves the page offers. It does no I/O: the decision route reads the product and its
// decisions, asks it, and stores only what it admits, with recordDecision, whose compare-and-swap checks the form's
// `replaces` again at write time.

/**
 * Where a watched product stands in one of its matched shops: no decision stored there (`undecided`), its stored
 * decision (`decided`), or a decision that couldn't be read (`unreadable`), which is never taken for none.
 */
export type Standing = { kind: "undecided" } | { kind: "decided"; decision: ShopMatch } | { kind: "unreadable" };

/**
 * A watched product as the guardian judges a decision for it: its id, its own shop, the one it was picked in, and its
 * standing in each of its matched shops. No other shop has a standing: neither its own shop nor a shop outside the
 * priced shops it was built with.
 */
export interface WatchedProduct {
  itemId: string;
  ownShop: ShopId;
  standings: Readonly<Partial<Record<PricedShop, Standing>>>;
}

/**
 * A decision the guardian admitted, as recordDecision stores it: the watched product, the matched shop, what the user
 * chose, and the decision the form was shown with (`replaces`), which the write replaces only while it still stands.
 */
export interface DecisionChange {
  itemId: string;
  shop: PricedShop;
  decision: MatchDecision;
  replaces: ExpectedDecision | null;
}

/**
 * Why the guardian refused a posted decision, which is then stored nowhere:
 *
 * - `not-a-matched-shop`: the shop isn't one of the product's matched shops, its own shop included
 * - `unreadable`: the product's decision in the shop couldn't be read
 * - `outdated-form`: the form's `replaces` doesn't name the stored decision, as when it was shown before that changed
 * - `illegal-move`: a move no page offers from the stored decision, a decline over the user's decline or the item of
 *   the user's own match confirmed again
 */
export type DecisionRefusal = "not-a-matched-shop" | "unreadable" | "outdated-form" | "illegal-move";

/** What the guardian said to a posted decision: the change to store, or why nothing may be stored. */
export type DecisionAdmission =
  { kind: "admitted"; change: DecisionChange } | { kind: "refused"; reason: DecisionRefusal };

/**
 * A watched product as the guardian judges it, from its row and its stored decisions as listMatches reads them, with
 * a standing in each of its matched shops among `shops`, the priced shops unless a test names others. A shop the read
 * lists as unreadable is unreadable, whatever else the read holds; otherwise a shop with a stored decision is decided,
 * and one without is undecided. A decision stored in the product's own shop, or in any shop outside its matched
 * shops, has no standing, so no decision is admitted there (admitDecision).
 */
export function watchedProductOf(
  product: WatchlistProduct,
  read: MatchesRead,
  shops: readonly PricedShop[] = PRICED_SHOPS,
): WatchedProduct {
  const standings: Partial<Record<PricedShop, Standing>> = {};
  for (const shop of matchedShopsOf(product.source, shops)) {
    standings[shop] = standingFrom(read, shop);
  }
  return { itemId: product.id, ownShop: product.source, standings };
}

/** Where the product stands in one of its matched shops, by watchedProductOf's rules. */
function standingFrom(read: MatchesRead, shop: PricedShop): Standing {
  if (read.unreadable.includes(shop)) {
    return { kind: "unreadable" };
  }
  // A product has one decision per shop.
  const decision = read.matches.find((match) => match.shop === shop);
  return decision === undefined ? { kind: "undecided" } : { kind: "decided", decision };
}

/**
 * Whether a posted decision, as parseMatchForm reads it, may be stored for the watched product: the change to store,
 * or why not. Its checks run in this order, and the first that fails refuses the post:
 *
 * 1. The shop must be one of the product's matched shops, so never its own (`not-a-matched-shop`).
 * 2. The product's decision there must have been read (`unreadable`).
 * 3. The form's `replaces` must name that decision, as the page's forms post it (`outdated-form`): none without a
 *    decision or over a lookup that found nothing, `matched:X` over a match of X, and `unmatched` over the user's
 *    decline.
 * 4. The move must be one the page offers from that decision (`illegal-move`): never a decline over the user's decline,
 *    nor a confirmation of the item of the user's own match. Confirming an automatic match's own item is one, which
 *    makes the match the user's.
 *
 * The change is the watched product's, whose standing it was judged by, and carries the form's own `replaces`, which
 * recordDecision's compare-and-swap checks again at write time, so a decision changed since it was read still stands.
 */
export function admitDecision(watched: WatchedProduct, form: MatchForm): DecisionAdmission {
  const shop = PRICED_SHOPS.find((priced) => priced === form.shop);
  const standing = shop === undefined ? undefined : watched.standings[shop];
  if (shop === undefined || standing === undefined) {
    return { kind: "refused", reason: "not-a-matched-shop" };
  }
  if (standing.kind === "unreadable") {
    return { kind: "refused", reason: "unreadable" };
  }
  const stored = standing.kind === "decided" ? standing.decision : null;
  if (!namesDecision(form.replaces, stored)) {
    return { kind: "refused", reason: "outdated-form" };
  }
  if (!isLegalMove(form.decision, stored)) {
    return { kind: "refused", reason: "illegal-move" };
  }
  return {
    kind: "admitted",
    change: { itemId: watched.itemId, shop, decision: form.decision, replaces: form.replaces },
  };
}

/**
 * Whether a form's `replaces` names the stored decision, null for none, as the page's forms post it (replacesFieldOf):
 * none without a decision or over a lookup that found nothing, the matched item over a match, and the decline over the
 * user's decline.
 */
function namesDecision(replaces: ExpectedDecision | null, stored: ShopMatch | null): boolean {
  if (stored === null || stored.state === "not_found") {
    return replaces === null;
  }
  if (stored.state === "matched") {
    return replaces?.state === "matched" && replaces.shopItemId === stored.item.shopItemId;
  }
  return replaces?.state === "unmatched";
}

/**
 * Whether the move from the stored decision, null for none, is a legal one, which the page's choices offer (repinView):
 * every move but a decline over the user's decline and a confirmation of the item of the user's own match.
 */
function isLegalMove(decision: MatchDecision, stored: ShopMatch | null): boolean {
  if (decision.action === "decline") {
    return stored?.state !== "unmatched";
  }
  // An automatic match's item may be confirmed in place; the item the user confirmed already may not.
  const confirmedId = stored?.state === "matched" && stored.decidedBy === "user" ? stored.item.shopItemId : null;
  return decision.item.shopItemId !== confirmedId;
}
