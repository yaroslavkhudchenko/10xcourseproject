import { REPIN_PARAM, RETRY_PARAM } from "@/lib/notices";
import { parseMatchedShop, type MatchableShop, type PricedShop } from "@/lib/services/price-comparison";
import type { Standing } from "@/lib/services/watched-product";
import type { RepinnableMatch, ShopMatch } from "@/types";

/**
 * What a product's page does next for one shop: say its stored decisions couldn't be read, show the stored decision,
 * look the product up again for the user to change that decision (`repin`), only offer a button that looks the product
 * up, or look it up now. `retry` is set when the lookup checks a stored "not found" again.
 */
export type MatchStep =
  | { kind: "read-failed" }
  | { kind: "stored"; match: ShopMatch }
  | { kind: "repin"; match: RepinnableMatch }
  | { kind: "prompt" }
  | { kind: "lookup"; retry: boolean };

/**
 * The matched shop whose stored decision the page was opened to change (`?repin=natura`, from "Zmień" or "Dopasuj
 * ponownie"): one of `shops`, the priced shops unless the page names its loaded product's matched shops, as
 * openProductPage does (matchedShopsIn). Null for any other value, the product's own shop and the old `?repin=1`
 * included, which then opens the plain page.
 */
export function repinShopOf(params: URLSearchParams, shops?: readonly PricedShop[]): PricedShop | null {
  return parseMatchedShop(params.get(REPIN_PARAM), shops);
}

/**
 * The matched shop whose stored "not found" the page was opened to look up again (`?retry=natura`, from "Szukaj
 * ponownie"): one of `shops`, the priced shops unless the page names its loaded product's matched shops, as
 * openProductPage does (matchedShopsIn). Null for any other value, the product's own shop and the old `?retry=1`
 * included, which then opens the plain page.
 */
export function retryShopOf(params: URLSearchParams, shops?: readonly PricedShop[]): PricedShop | null {
  return parseMatchedShop(params.get(RETRY_PARAM), shops);
}

/** What the decision rests on: where the product stands in the shop, the shop, and how the page was opened. */
export interface MatchStepInput {
  /**
   * Where the product stands in the shop, as the guardian reads its stored decisions (watchedProductOf): no decision,
   * its decision, or a decision that couldn't be read, as every one of them is when they couldn't be read at all.
   */
  standing: Standing;
  shop: MatchableShop;
  /** The shop the page was opened to look up again (`?retry=<shop>`, from "Szukaj ponownie"), if any. */
  retryShop: MatchableShop | null;
  /** The shop whose decision the page was opened to change (`?repin=<shop>`, "Zmień" or "Dopasuj ponownie"), if any. */
  repinShop: MatchableShop | null;
  /** The request is the user's own navigation, as `isOwnNavigation` tells. */
  ownNavigation: boolean;
}

/**
 * Decides, from the product's standing in the shop, whether opening a product's page may spend requests to the shop,
 * which count against the cap everyone shares. A decision the matching rule or the user settled is only shown, even
 * with `?retry=<shop>`, unless the user's own navigation opens its choice with `?repin=<shop>`: a link from another
 * site, or a prerender, gets the stored decision, whose card holds the link that opens the choice. A lookup that found
 * nothing has no such choice: it's the one decision a retry checks again. Where the shop's decision couldn't be read
 * (an unreadable standing) nothing is looked up, because a lookup could ask again about what's settled. A request that
 * isn't the user's own navigation only gets the button, and so does a shop with no decision on a page opened to re-pin
 * or retry another shop, which asks only that shop. Any other view of a shop with no decision, on the user's own
 * navigation, looks the product up there, whichever matched shop it is.
 */
export function decideMatchStep({ standing, shop, retryShop, repinShop, ownNavigation }: MatchStepInput): MatchStep {
  if (standing.kind === "unreadable") {
    return { kind: "read-failed" };
  }
  const stored = standing.kind === "decided" ? standing.decision : undefined;
  if (stored !== undefined && isRepinnable(stored)) {
    return repinShop === shop && ownNavigation ? { kind: "repin", match: stored } : { kind: "stored", match: stored };
  }
  const retry = retryShop === shop && stored?.state === "not_found";
  if (stored !== undefined && !retry) {
    return { kind: "stored", match: stored };
  }
  // A page opened to re-pin or retry another shop asks only that shop: this one, with no decision yet, gets its button.
  const forAnotherShop = [repinShop, retryShop].some((named) => named !== null && named !== shop);
  if (!ownNavigation || forAnotherShop) {
    return { kind: "prompt" };
  }
  return { kind: "lookup", retry };
}

/** A decision the user can change from its card: a match or their decline, never a lookup that found nothing. */
function isRepinnable(match: ShopMatch): match is RepinnableMatch {
  return match.state !== "not_found";
}

/**
 * Whether the product's island may refetch out-of-date prices on its own when the page opens, by the page's step for
 * each shop it has one for. Only the user's own navigation lets it, and not while the user changes a shop's stored
 * decision: the re-pin's choice has already cost that shop its two searches, so opening it asks the shops nothing more.
 */
export function autoRefreshOf(steps: readonly MatchStep[], ownNavigation: boolean): boolean {
  return ownNavigation && !steps.some((step) => step.kind === "repin");
}
