import type { RepinnableMatch, ShopId, ShopMatch } from "@/types";

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

/** What the decision rests on: the product's stored decisions, the shop, and how the page was opened. */
export interface MatchStepInput {
  /** The product's stored decisions, as `listMatches` reads them: null when they couldn't be read. */
  matches: ShopMatch[] | null;
  shop: ShopId;
  /** The page was opened with `?retry=1`, from "Szukaj ponownie". */
  retrying: boolean;
  /** The page was opened with `?repin=1`, from "Zmień" or "Dopasuj ponownie". */
  repinning: boolean;
  /** The request is the user's own navigation, as `isOwnNavigation` tells. */
  ownNavigation: boolean;
}

/**
 * Decides whether opening a product's page may spend requests to the shop, which count against the cap everyone
 * shares. A decision the matching rule or the user settled is only shown, even with `?retry=1`, unless the user's own
 * navigation opens its choice with `?repin=1`: a link from another site, or a prerender, gets the stored decision,
 * whose card holds the link that opens the choice. A lookup that found nothing has no such choice: it's the one
 * decision a retry checks again. Without the stored decisions nothing is looked up, because a lookup could ask again
 * about what's settled. A request that isn't the user's own navigation only gets the button.
 */
export function decideMatchStep({ matches, shop, retrying, repinning, ownNavigation }: MatchStepInput): MatchStep {
  if (matches === null) {
    return { kind: "read-failed" };
  }
  const stored = matches.find((match) => match.shop === shop);
  if (stored !== undefined && isRepinnable(stored)) {
    return repinning && ownNavigation ? { kind: "repin", match: stored } : { kind: "stored", match: stored };
  }
  const retry = retrying && stored?.state === "not_found";
  if (stored !== undefined && !retry) {
    return { kind: "stored", match: stored };
  }
  if (!ownNavigation) {
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
 * the shop (null when it has none). Only the user's own navigation lets it, and not while the user changes the stored
 * decision: the re-pin's choice has already cost Natura its two searches, so opening it asks Natura nothing more.
 */
export function autoRefreshOf(step: MatchStep | null, ownNavigation: boolean): boolean {
  return ownNavigation && step?.kind !== "repin";
}
