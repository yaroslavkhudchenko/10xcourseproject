import { REPIN_PARAM, RETRY_PARAM } from "@/lib/notices";
import type { MatchesRead } from "@/lib/services/matches";
import { parseMatchedShop, type MatchableShop, type MatchedShop } from "@/lib/services/price-comparison";
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
 * ponownie"), or null for any other value, the old `?repin=1` included, which then opens the plain page.
 */
export function repinShopOf(params: URLSearchParams): MatchedShop | null {
  return parseMatchedShop(params.get(REPIN_PARAM));
}

/**
 * The matched shop whose stored "not found" the page was opened to look up again (`?retry=natura`, from "Szukaj
 * ponownie"), or null for any other value, the old `?retry=1` included, which then opens the plain page.
 */
export function retryShopOf(params: URLSearchParams): MatchedShop | null {
  return parseMatchedShop(params.get(RETRY_PARAM));
}

/** What the decision rests on: the product's stored decisions, the shop, and how the page was opened. */
export interface MatchStepInput {
  /** The product's stored decisions, as `listMatches` reads them: null when they couldn't be read at all. */
  matches: MatchesRead | null;
  shop: MatchableShop;
  /** The shop the page was opened to look up again (`?retry=<shop>`, from "Szukaj ponownie"), if any. */
  retryShop: MatchableShop | null;
  /** The shop whose decision the page was opened to change (`?repin=<shop>`, "Zmień" or "Dopasuj ponownie"), if any. */
  repinShop: MatchableShop | null;
  /** The request is the user's own navigation, as `isOwnNavigation` tells. */
  ownNavigation: boolean;
}

/**
 * Decides whether opening a product's page may spend requests to the shop, which count against the cap everyone
 * shares. A decision the matching rule or the user settled is only shown, even with `?retry=<shop>`, unless the user's
 * own navigation opens its choice with `?repin=<shop>`: a link from another site, or a prerender, gets the stored
 * decision, whose card holds the link that opens the choice. A lookup that found nothing has no such choice: it's the
 * one decision a retry checks again. Without the shop's stored decision nothing is looked up there, because a lookup
 * could ask again about what's settled. A request that isn't the user's own navigation only gets the button, and so
 * does a shop with no decision on a page opened to re-pin or retry another shop, which asks only that shop.
 */
export function decideMatchStep({ matches, shop, retryShop, repinShop, ownNavigation }: MatchStepInput): MatchStep {
  if (matches === null || matches.unreadable.includes(shop)) {
    return { kind: "read-failed" };
  }
  const stored = matches.matches.find((match) => match.shop === shop);
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
