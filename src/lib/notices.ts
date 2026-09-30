// The parameters a product page's address bar brings a notice with, and the texts of a saved Natura decision's
// notices, defined once for the page's frontmatter, its Natura section and its address-bar script. The script runs in
// the browser, so this module imports nothing.

/** The parameters a saved Natura decision comes back with (/api/watchlist/matches), in the order the page reads them. */
export const DECISION_CODES = ["matched", "declined", "decided"] as const;

/** The parameter of one saved Natura decision. */
export type DecisionCode = (typeof DECISION_CODES)[number];

/** What the page says for each: a saved match, a saved decline, or a decision that was already stored. */
export const DECISION_NOTICES: Record<DecisionCode, string> = {
  matched: "Zapisano dopasowanie.",
  declined: "Zapisano: brak w Naturze.",
  decided: "Ten produkt ma już zapisaną decyzję.",
};

/** The parameter a decision that wasn't saved comes back with, holding its error's code (`?error=failed`). */
export const ERROR_PARAM = "error";

/** The parameter "Odśwież ceny" comes back with when its form was posted without JavaScript (`?prices=done`). */
export const PRICES_PARAM = "prices";

/**
 * Every parameter a notice comes with, which the product page's address bar forgets once the notice has shown: a
 * decision's, a decision's error and the no-JavaScript refresh's.
 */
export const NOTICE_PARAMS = [...DECISION_CODES, ERROR_PARAM, PRICES_PARAM] as const;
