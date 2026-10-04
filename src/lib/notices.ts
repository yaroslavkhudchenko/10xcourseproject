import { SHOP_LABELS, type MatchableShop } from "@/lib/services/price-comparison";
import type { PriceRefreshCode } from "@/lib/services/price-refresh";

// The parameters a page's address bar brings a notice with, and the notices' texts, defined once for the routes that
// send them, the pages' frontmatter, the list's head, the product page's shop cards and the address-bar scripts of the
// list, the product page and the sign-in page: a saved decision's, with the shop it was for, what each "Odśwież ceny"
// came to, "Dodaj"'s, a removal's, a refused sign-in's and a sign-out's, with the ones that open a shop's re-pin choice
// or look a shop up again. The scripts run in the browser, so this module imports nothing server-only: besides a type,
// which the bundle drops, only the shops' labels, from the browser-safe comparison rules.

/** The parameters a saved decision comes back with (/api/watchlist/matches), in the order the page reads them. */
export const DECISION_CODES = ["matched", "declined", "decided"] as const;

/** The parameter of one saved decision. */
export type DecisionCode = (typeof DECISION_CODES)[number];

/**
 * What the page says for each: a saved match, a saved decline, which names the shop the user declined ("Zapisano: brak
 * w Naturze."), or a decision that was already stored.
 */
export const DECISION_NOTICES = {
  matched: "Zapisano dopasowanie.",
  declined: (shop: MatchableShop): string => `Zapisano: brak ${SHOP_LABELS[shop].in}.`,
  decided: "Ten produkt ma już zapisaną decyzję.",
} satisfies Record<DecisionCode, string | ((shop: MatchableShop) => string)>;

/**
 * The parameter a saved decision, or a decision that wasn't saved, comes back with beside its code: the shop it was
 * for (`?shop=natura&declined=1`), so the page shows it on that shop's card.
 */
export const SHOP_PARAM = "shop";

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
 * What the product's page says for each when the product isn't there any more, as a status: a removal whose answer
 * didn't come may still have gone through, and the missing product shows it did.
 */
export const REMOVAL_GONE_NOTICES: Record<RemovalCode, string> = {
  failed: "Produktu nie ma już na Twojej liście.",
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
 * The parameter that opens a shop's stored decision's choice on its product's page, holding the shop
 * (`?repin=natura`), from "Zmień" or "Dopasuj ponownie". The page's address bar forgets it once the choice has
 * rendered, so going back to it or reloading lands on the plain page and asks the shop nothing.
 */
export const REPIN_PARAM = "repin";

/**
 * The parameter that looks a shop's stored "not found" up again on its product's page, holding the shop
 * (`?retry=natura`), from "Szukaj ponownie". A retry that stored its outcome goes back to the plain page.
 */
export const RETRY_PARAM = "retry";

/**
 * The parameter the list comes back with when a sign-out didn't go through (`?sign-out=failed`): Auth answered an
 * error, and the session may still be there.
 */
export const SIGN_OUT_PARAM = "sign-out";

/** What SIGN_OUT_PARAM can hold: the sign-out failed. */
export const SIGN_OUT_CODES = ["failed"] as const;

/** One code of SIGN_OUT_PARAM. */
export type SignOutCode = (typeof SIGN_OUT_CODES)[number];

/** What the list says for each, as an error: never "Wylogowano.", since the user may still be signed in. */
export const SIGN_OUT_NOTICES: Record<SignOutCode, string> = {
  failed: "Nie udało się wylogować. Spróbuj ponownie.",
};

/** The list's text for a failed sign-out's `?sign-out=` code, or null for anything the app didn't send itself. */
export function signOutErrorMessage(value: string | null): string | null {
  const code = SIGN_OUT_CODES.find((each) => each === value);
  return code === undefined ? null : SIGN_OUT_NOTICES[code];
}

/**
 * The codes a refused sign-in comes back to the sign-in page with (`?error=invalid`), which the page turns into its own
 * text: a wrong email or password, or a form that couldn't be read (`invalid`); too many tries (`busy`); any other
 * answer from Auth (`failed`); and no Supabase (`config`).
 */
export const SIGN_IN_ERROR_CODES = ["invalid", "busy", "failed", "config"] as const;

/** One code of a refused sign-in. */
export type SignInErrorCode = (typeof SIGN_IN_ERROR_CODES)[number];

/** What the sign-in page says for each, as an error. */
export const SIGN_IN_ERRORS: Record<SignInErrorCode, string> = {
  invalid: "Nieprawidłowy e-mail lub hasło.",
  busy: "Zbyt wiele prób. Spróbuj za kilka minut.",
  failed: "Nie udało się zalogować. Spróbuj ponownie.",
  config: "Supabase nie jest skonfigurowany.",
};

/**
 * The sign-in page's text for a refused sign-in's `?error=` code, or null for anything the app didn't send itself, so
 * a link can't put words on the page.
 */
export function signInErrorMessage(value: string | null): string | null {
  const code = SIGN_IN_ERROR_CODES.find((each) => each === value);
  return code === undefined ? null : SIGN_IN_ERRORS[code];
}

/** The parameter the sign-in page comes back with after a sign-out that ended the session (`?signed-out=1`). */
export const SIGNED_OUT_PARAM = "signed-out";

/** What the sign-in page says then, as a status. */
export const SIGNED_OUT_NOTICE = "Wylogowano.";

/**
 * Every parameter the sign-in page shows a notice by, which its address bar forgets once the notice has shown: a
 * refused sign-in's error and a sign-out's. The page a sign-in goes back to (`next`) stays, for the next try.
 */
export const SIGN_IN_NOTICE_PARAMS = [ERROR_PARAM, SIGNED_OUT_PARAM] as const;

/**
 * Every parameter the product page's address bar forgets: a notice's, once the notice has shown (a decision's, its
 * shop's, a decision's error, the product's no-JavaScript refresh's, the list's refresh's and a failed removal's), and
 * the re-pin's, once its choice has rendered.
 */
export const NOTICE_PARAMS = [
  ...DECISION_CODES,
  SHOP_PARAM,
  ERROR_PARAM,
  PRICES_PARAM,
  LIST_PRICES_PARAM,
  REMOVAL_PARAM,
  REPIN_PARAM,
] as const;

/**
 * Every parameter the list shows a notice by, which the list's address bar forgets once the notice has shown:
 * "Dodaj"'s, an error's, the list's refresh's, a removal's and a failed sign-out's. The list's filter and its search
 * stay.
 */
export const LIST_NOTICE_PARAMS = [
  EXISTS_PARAM,
  ERROR_PARAM,
  LIST_PRICES_PARAM,
  REMOVED_PARAM,
  SIGN_OUT_PARAM,
] as const;

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
