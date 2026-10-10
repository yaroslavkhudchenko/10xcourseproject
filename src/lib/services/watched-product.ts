import type { ExpectedDecision, MatchDecision, MatchesRead, MatchForm } from "@/lib/services/matches";
import { matchedShopsOf, PRICED_SHOPS, type MatchableShop, type PricedShop } from "@/lib/services/price-comparison";
import type { ShopId, ShopLookup, ShopMatch, WatchlistProduct } from "@/types";

// The guardian of a watched product's decisions: the one place that decides whether a change to them may be stored, a
// decision posted from the product's page or what a lookup on that page settled on its own. It knows the product's
// matched shops (matchedShopsOf) and where the product stands in each, from the two reads its page makes, which
// loadWatchedProduct makes for a product's readers, handing them its row beside this view (LoadedProduct). It admits a
// confirm or a decline only from the decision the form was shown with, and only along the moves the page offers
// (admitDecision), and a lookup's automatic match or nothing found only where no decision is settled: where the
// product is undecided, or over a lookup that found nothing (admitLookup). It does no I/O: the decision route reads the
// product and its decisions, asks it, and stores only what it admits, with recordDecision, whose compare-and-swap
// checks the form's `replaces` again at write time. A lookup's admitted change carries what recordLookup stores, and
// recordLookup's own compare-and-swap changes only a lookup that found nothing.

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
 * A watched product as a reader of one product takes it (loadWatchedProduct): its row, which its page shows and looks
 * it up by, beside the guardian's view of it (watchedProductOf), and whether its decisions could be read at all.
 */
export interface LoadedProduct {
  product: WatchlistProduct;
  watched: WatchedProduct;
  /** `unread`: the decisions couldn't be read at all, so every matched shop stands unreadable. */
  decisions: "read" | "unread";
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
 * - `outdated-form`: the form was shown before the stored decision changed: its `replaces` doesn't name the stored
 *   decision, or it confirms again the item of the user's own match, which a page offers only while it's automatic
 * - `illegal-move`: a move no page offers from the stored decision, a decline over the user's decline
 */
export type DecisionRefusal = "not-a-matched-shop" | "unreadable" | "outdated-form" | "illegal-move";

/** What the guardian said to a posted decision: the change to store, or why nothing may be stored. */
export type DecisionAdmission =
  { kind: "admitted"; change: DecisionChange } | { kind: "refused"; reason: DecisionRefusal };

/**
 * A watched product as the guardian judges it, from its row and its stored decisions as listMatches reads them, null
 * when they couldn't be read at all, with a standing in each of its matched shops among `shops`, the priced shops
 * unless a test names others. Without a read, every matched shop is unreadable. A shop the read lists as unreadable is
 * unreadable, whatever else the read holds; otherwise a shop with a stored decision is decided, and one without is
 * undecided. A decision stored in the product's own shop, or in any shop outside its matched shops, has no standing,
 * so nothing is admitted there: no posted decision (admitDecision) and no lookup's outcome (admitLookup).
 */
export function watchedProductOf(
  product: WatchlistProduct,
  read: MatchesRead | null,
  shops: readonly PricedShop[] = PRICED_SHOPS,
): WatchedProduct {
  const standings: Partial<Record<PricedShop, Standing>> = {};
  for (const shop of matchedShopsOf(product.source, shops)) {
    standings[shop] = standingFrom(read, shop);
  }
  return { itemId: product.id, ownShop: product.source, standings };
}

/** Where the product stands in one of its matched shops, by watchedProductOf's rules. */
function standingFrom(read: MatchesRead | null, shop: PricedShop): Standing {
  if (read === null || read.unreadable.includes(shop)) {
    return { kind: "unreadable" };
  }
  // A product has one decision per shop.
  const decision = read.matches.find((match) => match.shop === shop);
  return decision === undefined ? { kind: "undecided" } : { kind: "decided", decision };
}

/**
 * A watched product as a reader of one product takes it, from its row and its stored decisions as listMatches reads
 * them, null when they couldn't be read at all: the row beside the guardian's view (watchedProductOf), with a standing
 * in each of its matched shops among `shops`, the priced shops unless a test names others. Its decisions are `unread`
 * without a read, and `read` with one, odd rows included: a shop the read lists as unreadable stands unreadable alone.
 */
export function loadedProductOf(
  product: WatchlistProduct,
  read: MatchesRead | null,
  shops: readonly PricedShop[] = PRICED_SHOPS,
): LoadedProduct {
  return { product, watched: watchedProductOf(product, read, shops), decisions: read === null ? "unread" : "read" };
}

/**
 * The watched product's matched shops: the priced shops it has a standing in, in the priced shops' order, as
 * watchedProductOf derived them. So never its own shop, nor a shop outside the priced shops it was built with, and the
 * same shops whether or not its decisions could be read.
 */
export function matchedShopsIn(watched: WatchedProduct): PricedShop[] {
  return PRICED_SHOPS.filter((shop) => watched.standings[shop] !== undefined);
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
 * 4. The move must be one the page offers from that decision (`illegal-move`): never a decline over the user's decline.
 *    Confirming an automatic match's own item is one, which makes the match the user's. Confirming the item of the
 *    user's own match again comes only from a form shown before the user confirmed it, posted a second time or from
 *    another tab, so it is refused as an outdated form (`outdated-form`), and the page says the decision is stored.
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
  const refusal = moveRefusal(form.decision, stored);
  if (refusal !== null) {
    return { kind: "refused", reason: refusal };
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
 * Why the move from the stored decision, null for none, is refused, or null for a move the page's choices offer
 * (repinView). A decline over the user's decline is a move no page offers. A confirmation of the item of the user's
 * own match comes only from a form shown before the user confirmed it, so its form is outdated.
 */
function moveRefusal(decision: MatchDecision, stored: ShopMatch | null): DecisionRefusal | null {
  if (decision.action === "decline") {
    return stored?.state === "unmatched" ? "illegal-move" : null;
  }
  // An automatic match's item may be confirmed in place; the user's own item comes back only from an older form.
  const confirmedId = stored?.state === "matched" && stored.decidedBy === "user" ? stored.item.shopItemId : null;
  return decision.item.shopItemId === confirmedId ? "outdated-form" : null;
}

/**
 * A lookup's outcome the guardian admitted, as recordLookup stores it: the watched product, the matched shop, and what
 * the lookup settled on its own, the candidate the matching rule accepted or nothing found, which the write stores only
 * where no decision is stored, or over a lookup that found nothing.
 */
export interface LookupChange {
  itemId: string;
  shop: PricedShop;
  outcome: Extract<ShopLookup, { kind: "accepted" | "not-found" }>;
}

/**
 * Why the guardian refused a lookup's outcome, which is then stored nowhere:
 *
 * - `not-a-matched-shop`: the shop isn't one of the product's matched shops, its own shop included
 * - `unreadable`: the product's decision in the shop couldn't be read
 * - `settled`: a decision no lookup overwrites is stored there: a match, automatic or the user's, or the user's decline
 */
export type LookupRefusal = "not-a-matched-shop" | "unreadable" | "settled";

/** What the guardian said to a lookup's outcome: the change to store, or why nothing may be stored. */
export type LookupAdmission = { kind: "admitted"; change: LookupChange } | { kind: "refused"; reason: LookupRefusal };

/**
 * Whether what a lookup settled on its own in a shop, as lookupInShop gives it, may be stored for the watched product:
 * the change to store, or why not. Its checks run in this order, and the first that fails refuses the outcome:
 *
 * 1. The shop must be one of the product's matched shops, so never its own (`not-a-matched-shop`).
 * 2. The product's decision there must have been read (`unreadable`).
 * 3. The product must be undecided there, or hold a lookup that found nothing, which a retry looks up again
 *    (`settled`): a match, automatic or the user's, and the user's decline stand, whatever the lookup found.
 *
 * The change is the watched product's, whose standing it was judged by, and carries recordLookup's arguments; at write
 * time, recordLookup's own compare-and-swap still changes only a lookup that found nothing, so a decision stored since
 * the read stands.
 */
export function admitLookup(
  watched: WatchedProduct,
  shop: MatchableShop,
  outcome: LookupChange["outcome"],
): LookupAdmission {
  const priced = PRICED_SHOPS.find((each) => each === shop);
  const standing = priced === undefined ? undefined : watched.standings[priced];
  if (priced === undefined || standing === undefined) {
    return { kind: "refused", reason: "not-a-matched-shop" };
  }
  if (standing.kind === "unreadable") {
    return { kind: "refused", reason: "unreadable" };
  }
  if (standing.kind === "decided" && standing.decision.state !== "not_found") {
    return { kind: "refused", reason: "settled" };
  }
  return { kind: "admitted", change: { itemId: watched.itemId, shop: priced, outcome } };
}
