import type { PriceRefreshCode } from "@/lib/services/price-refresh";

// The parameters a page's address bar brings a notice with, and the notices' texts, defined once for the routes that
// send them, the pages' frontmatter, the list's head, the product page's Natura section and both pages' address-bar
// scripts: a saved Natura decision's, what each "Odśwież ceny" came to, "Dodaj"'s and a removal's. The scripts run in
// the browser, so this module imports nothing but a type, which the bundle drops.

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

/**
 * The parameter an error's code comes back with, which each page turns into its own text: on the product's page a
 * decision that wasn't saved (`?error=failed`), and on the list a product "Dodaj" couldn't add, or a removal without
 * Supabase (`?error=config`).
 */
export const ERROR_PARAM = "error";

/** The parameter the list comes back with when "Dodaj" found the product already on it (`?exists=1`). */
export const EXISTS_PARAM = "exists";

/** What the list says then, as a status. */
export const EXISTS_NOTICE = "Ten produkt jest już na Twojej liście.";

/**
 * The parameter the list comes back with after "Usuń z listy" on a product's page, holding what the removal came to
 * (`?removed=done`).
 */
export const REMOVED_PARAM = "removed";

/** What a removal came to on the list: the product removed, or not on the list any more, as after a second post. */
export const REMOVED_CODES = ["done", "gone"] as const;

/** One code of REMOVED_PARAM. */
export type RemovedCode = (typeof REMOVED_CODES)[number];

/** What the list says for each, both as a status. */
export const REMOVED_NOTICES: Record<RemovedCode, string> = {
  done: "Usunięto produkt z listy.",
  gone: "Tego produktu nie było już na Twojej liście.",
};

/**
 * The parameter a removal that didn't go through comes back to its product's page with (`?removal=failed`), which
 * opens the page's confirm again with its error.
 */
export const REMOVAL_PARAM = "removal";

/** What REMOVAL_PARAM can hold: the removal failed. */
export const REMOVAL_CODES = ["failed"] as const;

/** One code of REMOVAL_PARAM. */
export type RemovalCode = (typeof REMOVAL_CODES)[number];

/** What the product's page says for each, in its confirm, as an error. */
export const REMOVAL_NOTICES: Record<RemovalCode, string> = {
  failed: "Nie udało się usunąć produktu z listy. Spróbuj ponownie.",
};

/**
 * The id of a product page's removal confirm, which the address of a removal that didn't go through points to
 * (`#remove`): the confirm stands at the page's foot, so the page opens there, at its error, not at its top.
 */
export const REMOVAL_ANCHOR = "remove";

/** The parameter a product's own "Odśwież ceny" comes back with when posted without JavaScript (`?prices=done`). */
export const PRICES_PARAM = "prices";

/**
 * The parameter the list's own "Odśwież ceny", which refreshes every product, comes back with (`?list-prices=done`),
 * on the list or on the product page it was posted from, apart from the product's own refresh.
 */
export const LIST_PRICES_PARAM = "list-prices";

/**
 * Every parameter a notice comes with, which the product page's address bar forgets once the notice has shown: a
 * decision's, a decision's error, the product's no-JavaScript refresh's, the list's refresh's and a failed removal's.
 */
export const NOTICE_PARAMS = [...DECISION_CODES, ERROR_PARAM, PRICES_PARAM, LIST_PRICES_PARAM, REMOVAL_PARAM] as const;

/**
 * Every parameter the list shows a notice by, which the list's address bar forgets once the notice has shown:
 * "Dodaj"'s, an error's, the list's refresh's and a removal's. The list's filter and its search stay.
 */
export const LIST_NOTICE_PARAMS = [EXISTS_PARAM, ERROR_PARAM, LIST_PRICES_PARAM, REMOVED_PARAM] as const;

/**
 * The page's address without the notice parameters `params` names, keeping every other parameter, the list's filter
 * and its search among them, and the hash; null when the address holds none of them, so there's nothing to replace.
 * Both pages' address-bar scripts forget their notices through it, so a notice shows once.
 */
export function withoutNotices(href: string, params: readonly string[]): string | null {
  const url = new URL(href);
  if (!params.some((param) => url.searchParams.has(param))) {
    return null;
  }
  for (const param of params) {
    url.searchParams.delete(param);
  }
  return url.toString();
}

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
