import type { PriceRefreshCode } from "@/lib/services/price-refresh";

// The parameters a page's address bar brings a notice with, and the notices' texts, defined once for the pages'
// frontmatter, the list's head, the product page's Natura section and its address-bar script: a saved Natura
// decision's, and what each "Odśwież ceny" came to. The script runs in the browser, so this module imports nothing but
// a type, which the bundle drops.

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

/** The parameter a product's own "Odśwież ceny" comes back with when posted without JavaScript (`?prices=done`). */
export const PRICES_PARAM = "prices";

/**
 * The parameter the list's own "Odśwież ceny", which refreshes every product, comes back with (`?list-prices=done`),
 * on the list or on the product page it was posted from, apart from the product's own refresh.
 */
export const LIST_PRICES_PARAM = "list-prices";

/**
 * Every parameter a notice comes with, which the product page's address bar forgets once the notice has shown: a
 * decision's, a decision's error, the product's no-JavaScript refresh's and the list's refresh's.
 */
export const NOTICE_PARAMS = [...DECISION_CODES, ERROR_PARAM, PRICES_PARAM, LIST_PRICES_PARAM] as const;

/** What a page says a refresh came to: its text, and whether it warns (an alert) or only reports (a status). */
export interface PriceRefreshNotice {
  text: string;
  warning: boolean;
}

// What both refreshes say alike.
const REFRESHED: PriceRefreshNotice = { text: "Ceny odświeżone.", warning: false };
const PARTLY_REFRESHED: PriceRefreshNotice = {
  text: "Nie wszystkie ceny udało się odświeżyć. Tam, gdzie się nie udało, widać ostatnią znaną cenę i jej wiek.",
  warning: true,
};
const NOT_REFRESHED: PriceRefreshNotice = {
  text: "Nie udało się odświeżyć cen. Spróbuj ponownie za chwilę.",
  warning: true,
};

/**
 * What the list's "Odśwież ceny" came to (LIST_PRICES_PARAM), on the list and beside a product. It fetches only the
 * items last checked more than 15 minutes ago, so with nothing to refresh it says why.
 */
export const LIST_PRICES_NOTICES: Record<PriceRefreshCode, PriceRefreshNotice> = {
  done: REFRESHED,
  partial: PARTLY_REFRESHED,
  none: { text: "Nic do odświeżenia: ceny sprawdzono w ciągu ostatnich 15 minut.", warning: false },
  failed: NOT_REFRESHED,
};

/**
 * What a product's own "Odśwież ceny" came to without JavaScript (PRICES_PARAM). It fetches every shop of the product
 * however recently checked, so it has nothing to refresh only when the product has no shop to ask, and it names no
 * 15 minutes.
 */
export const PRICES_NOTICES: Record<PriceRefreshCode, PriceRefreshNotice> = {
  done: REFRESHED,
  partial: PARTLY_REFRESHED,
  none: { text: "Nic do odświeżenia.", warning: false },
  failed: NOT_REFRESHED,
};
