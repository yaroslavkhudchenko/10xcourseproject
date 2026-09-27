import type { ShopId, ShopMatch } from "@/types";

/**
 * What a product's page does next for one shop: say its stored decisions couldn't be read, show the stored decision,
 * only offer a button that looks the product up, or look it up now. `retry` is set when the lookup checks a stored
 * "not found" again.
 */
export type MatchStep =
  | { kind: "read-failed" }
  | { kind: "stored"; match: ShopMatch }
  | { kind: "prompt" }
  | { kind: "lookup"; retry: boolean };

/** What the decision rests on: the product's stored decisions, the shop, and how the page was opened. */
export interface MatchStepInput {
  /** The product's stored decisions, as `listMatches` reads them: null when they couldn't be read. */
  matches: ShopMatch[] | null;
  shop: ShopId;
  /** The page was opened with `?retry=1`, from "Szukaj ponownie". */
  retrying: boolean;
  /** The request is the user's own navigation, as `isOwnNavigation` tells. */
  ownNavigation: boolean;
}

/**
 * Decides whether opening a product's page may spend requests to the shop, which count against the cap everyone
 * shares. A decision the matching rule or the user settled is only shown, even with `?retry=1`: a lookup that found
 * nothing is the one decision a retry checks again. Without the stored decisions nothing is looked up, because a
 * lookup could ask again about what's settled. A request that isn't the user's own navigation, such as a link on
 * another site or a prerender, only gets the button.
 */
export function decideMatchStep({ matches, shop, retrying, ownNavigation }: MatchStepInput): MatchStep {
  if (matches === null) {
    return { kind: "read-failed" };
  }
  const stored = matches.find((match) => match.shop === shop);
  const retry = retrying && stored?.state === "not_found";
  if (stored !== undefined && !retry) {
    return { kind: "stored", match: stored };
  }
  if (!ownNavigation) {
    return { kind: "prompt" };
  }
  return { kind: "lookup", retry };
}
