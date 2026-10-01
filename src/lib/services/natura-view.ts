import { DECISION_CODES, DECISION_NOTICES, REPIN_PARAM } from "@/lib/notices";
import { replacesFieldOf } from "@/lib/services/matches";
import { matchDifferences } from "@/lib/services/matching";
import { formatPrice, SHOP_LABELS } from "@/lib/services/price-comparison";
import { filterHref, type ListFilter } from "@/lib/services/watchlist-rows";
import { shopUnavailableText } from "@/lib/shop-messages";
import type {
  CandidateOption,
  MatchedItem,
  NaturaChoices,
  RepinnableMatch,
  ShopCandidate,
  ShopMatch,
  ShopUnavailable,
  Size,
  WatchlistProduct,
} from "@/types";

// What a product's page shows in its Natura section, without I/O: the stored decision, the lookup's outcome, or why
// there's neither, the choice the user opens to change a stored decision, and the notice of a decision just saved.
// The page and the dev kitchen sink build their views here, so both show the same texts. Every link keeps the list's
// filter, so the list beside the product keeps its chip. Times are shown on the shopper's own clock in Poland, and
// each builder takes the times it shows as arguments.

const clock = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });
const dayAndTime = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Warsaw",
});
const amount = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 3 });
const UNIT_NAMES = { ml: "ml", g: "g", pcs: "szt." } as const;

/** A size as a shop wrote it, and parsed when that was possible. */
type Sized = Pick<MatchedItem, "sizeText" | "size">;

/** A brand as a shop wrote it, if it wrote one. */
type Branded = Pick<MatchedItem, "brand">;

/** A Natura item as the section shows it: its photo, its name and size, and its page in the shop. */
export type NaturaItemSummary = Pick<MatchedItem, "brand" | "name" | "sizeText" | "imageUrl" | "productUrl">;

/** The watched product, as far as the section looks at it: the id its links lead to, its brand and its size. */
export type NaturaProduct = Pick<WatchlistProduct, "id" | "brand" | "sizeText" | "size">;

/** A short flag on a candidate: a shared EAN, or a warning about its size or its brand. */
export interface CandidateFlag {
  text: string;
  warning: boolean;
}

/** A candidate for the user to pick, with its flags and its price, as the section shows it. */
export interface NaturaOption {
  candidate: ShopCandidate;
  flags: CandidateFlag[];
  price: string;
}

/**
 * A stored decision's way to change it from its card, to the product's page with the list's filter: open the choice
 * of Natura's candidates below the cards (`repin`, "Zmień" or "Dopasuj ponownie"), or, while it's open, close it and
 * leave the decision as it was (`cancel`, "Anuluj").
 */
export interface NaturaAction {
  kind: "repin" | "cancel";
  href: string;
}

/**
 * What the Natura section shows: the stored decision, the lookup's outcome, or why there's neither. A match names its
 * item, how it was decided and what differs from the product: its price and its page are in its price row, so each
 * shop appears once on the page. A match the page couldn't save has no price row, so its card shows the item's photo
 * and page too. A stored match and the user's decline have the action that changes them.
 */
export type NaturaView =
  | {
      kind: "matched";
      note: string;
      /** A warning for each thing that definitely differs from the product: its size, then its brand. */
      warnings: string[];
      /** The matched item, which the card names. */
      item: NaturaItemSummary;
      /** The match isn't saved: it has no price row then, so the card shows the item's photo and page in its place. */
      unsaved: boolean;
      /** The card's way to change the match; none while it isn't saved, since there's no decision to change yet. */
      action: NaturaAction | null;
    }
  | { kind: "unmatched"; action: NaturaAction }
  | { kind: "not-found"; text: string; href: string }
  | { kind: "choose"; intro: string; options: NaturaOption[] }
  | { kind: "unavailable"; message: string }
  | { kind: "prompt"; href: string }
  | { kind: "decided"; href: string }
  | { kind: "read-failed" };

/**
 * How the page was opened, as a stored decision's view keeps it: the list's filter, which its links keep, and whether
 * the decision's choice is open below the cards (`?repin=1`), which turns its card's action into "Anuluj".
 */
export interface StoredViewOptions {
  filter: ListFilter;
  repinning?: boolean;
}

/**
 * A candidate of the choice that changes a stored decision, marked when it's the item the product is matched to
 * (`current`), and offered to confirm (`confirm`) unless it's the item of a match the user confirmed: an automatic
 * match's item can still be confirmed in place, which makes the match the user's own.
 */
export type RepinOption = NaturaOption & { current: boolean; confirm: boolean };

/** A line the choice says about its searches, in the warning colour when Natura gave no answer. */
export interface NaturaMessage {
  text: string;
  warning: boolean;
}

/**
 * The choice of Natura's candidates the user opens to change a stored decision, below the shops' cards, while the card
 * keeps showing the decision (storedView with `repinning`). It says what found the candidates, offers each with its
 * flags, the current match marked and offered to confirm only while the rule matched it on its own, says why there are
 * fewer or none, and offers "Żaden z nich" only from a match. Its forms post the decision they replace, and "Anuluj"
 * leaves the decision as it was. It isn't a NaturaView: the card has no kind for it.
 */
export interface NaturaRepin {
  kind: "repin";
  /** What found the candidates and what the user can do with them; null without a candidate. */
  intro: string | null;
  options: RepinOption[];
  /** Why the choice may be incomplete or is empty: a name search without an answer, nothing found, or no answer. */
  message: NaturaMessage | null;
  /** Whether "Żaden z nich" is offered: only from a match, since the user's decline is one already. */
  decline: boolean;
  /** The decision every form replaces, as their `replaces` field posts it (replacesFieldOf). */
  replaces: string;
  /** "Anuluj": the product's page without the choice, with the list's filter. */
  cancelHref: string;
}

/** A size as the shop wrote it, or else as the size it stands for. */
export function sizeLabel(sizeText: string | null, size: Size | null): string {
  if (sizeText !== null) {
    return sizeText;
  }
  return size === null ? "rozmiar nieznany" : `${amount.format(size.value)} ${UNIT_NAMES[size.unit]}`;
}

/** The flag for an item whose size differs from the product's, naming both sizes. */
export function otherSize(item: Sized, own: Sized): string {
  return `Inny rozmiar: ${sizeLabel(item.sizeText, item.size)} zamiast ${sizeLabel(own.sizeText, own.size)}`;
}

/** The flag for an item whose brand differs from the product's, naming both brands as the shops wrote them. */
export function otherBrand(item: Branded, own: Branded): string {
  return `Inna marka: ${brandLabel(item.brand)} zamiast ${brandLabel(own.brand)}`;
}

/** A brand as the shop wrote it. The rule never flags a missing brand, so "marka nieznana" is only a fallback. */
function brandLabel(brand: string | null): string {
  return brand ?? "marka nieznana";
}

/** The product's page, with the list's filter, then `params`. */
function pageHref(own: NaturaProduct, filter: ListFilter, params: Record<string, string> = {}): string {
  return filterHref(`/watchlist/${own.id}`, filter, params);
}

/**
 * A stored decision's action: the link that opens its choice (`?repin=1`), or, while the choice is open, the plain
 * page, which closes it.
 */
function actionOf(own: NaturaProduct, { filter, repinning = false }: StoredViewOptions): NaturaAction {
  return repinning
    ? { kind: "cancel", href: pageHref(own, filter) }
    : { kind: "repin", href: pageHref(own, filter, { [REPIN_PARAM]: "1" }) };
}

/**
 * A match: how it was decided, its item, and a warning for each thing that definitely differs from the product
 * (matchDifferences), its size, then its brand. A match the page couldn't save (`unsaved`) has no price row, so its
 * card shows the item's photo and page too, and has no action, since there's no decision to change yet; a saved or
 * stored match has them in its price row, and "Zmień", or "Anuluj" while its choice is open (`repinning`).
 */
export function matchedView(
  item: NaturaItemSummary & Sized,
  decidedBy: "auto" | "user",
  own: NaturaProduct,
  { unsaved = false, ...options }: StoredViewOptions & { unsaved?: boolean },
): NaturaView {
  const differences = matchDifferences(own, item);
  const warnings: string[] = [];
  if (differences.size) {
    warnings.push(otherSize(item, own));
  }
  if (differences.brand) {
    warnings.push(otherBrand(item, own));
  }
  const note = decidedBy === "auto" ? "Dopasowano automatycznie: ten sam EAN i rozmiar." : "Potwierdzone przez Ciebie.";
  const { brand, name, sizeText, imageUrl, productUrl } = item;
  return {
    kind: "matched",
    note,
    warnings,
    item: { brand, name, sizeText, imageUrl, productUrl },
    unsaved,
    action: unsaved ? null : actionOf(own, options),
  };
}

/** A lookup that found nothing at `checkedAt`, with the link that looks the product up again. */
export function notFoundView(checkedAt: Date, own: NaturaProduct, filter: ListFilter): NaturaView {
  return {
    kind: "not-found",
    text: `Nie znaleziono w Naturze (sprawdzono ${dayAndTime.format(checkedAt)}).`,
    // A retry looks the product up again only while its stored decision is "not found".
    href: pageHref(own, filter, { retry: "1" }),
  };
}

/**
 * The product's stored decision in Natura: a match or the user's decline, with the action that changes it, or, for a
 * lookup that found nothing, the time it ran, whose link looks again instead.
 */
export function storedView(match: ShopMatch, own: NaturaProduct, options: StoredViewOptions): NaturaView {
  switch (match.state) {
    case "matched":
      return matchedView(match.item, match.decidedBy, own, options);
    case "unmatched":
      return { kind: "unmatched", action: actionOf(own, options) };
    case "not_found":
      return notFoundView(new Date(match.checkedAt), own, options.filter);
  }
}

/** A candidate for the user to pick, with its flags and its price, labelled as Natura's online price at `fetchedAt`. */
export function optionView({ candidate, verdict }: CandidateOption, fetchedAt: Date, own: NaturaProduct): NaturaOption {
  const flags: CandidateFlag[] = [];
  if (verdict.sharesEan) {
    flags.push({ text: "Ten sam EAN", warning: false });
  }
  if (verdict.size === "differs") {
    flags.push({ text: otherSize(candidate, own), warning: true });
  } else if (verdict.size === "unknown") {
    flags.push({ text: "Rozmiar nieznany", warning: true });
  }
  // A brand that can't be compared flags nothing: only one that differs warns.
  if (verdict.brand === "differs") {
    flags.push({ text: otherBrand(candidate, own), warning: true });
  }
  const source = `${SHOP_LABELS.natura.site}, pobrano ${clock.format(fetchedAt)}`;
  // A candidate without a price that can be stored says so, never a blank or a zero.
  const price =
    candidate.offer === null
      ? `Brak ceny online w ${source}`
      : `${formatPrice(candidate.offer.price)} · cena online w ${source}`;
  return { candidate, flags, price };
}

/**
 * The candidates a lookup found at `fetchedAt`, in the lookup's order, for the user to pick one or none. The intro
 * says whether they were found by the product's EAN or by its name.
 */
export function chooseView(
  options: CandidateOption[],
  via: "ean" | "name",
  fetchedAt: Date,
  own: NaturaProduct,
): NaturaView {
  return {
    kind: "choose",
    intro:
      via === "ean"
        ? "Znalezione w Naturze po kodzie EAN. Wybierz ten sam produkt albo „Żaden z nich”."
        : "Znalezione w Naturze po nazwie. Wybierz ten sam produkt albo „Żaden z nich”.",
    options: options.map((option) => optionView(option, fetchedAt, own)),
  };
}

// What found a choice's candidates, as its intro says it.
const FOUND_BY = { ean: "po kodzie EAN", name: "po nazwie", both: "po kodzie EAN i po nazwie" } as const;

/**
 * The choice Natura's searches at `fetchedAt` give the user for changing the product's stored decision (`current`):
 * the candidates in the lookup's order, the current match marked, and "Żaden z nich" from a match. Every candidate is
 * offered to confirm but the item of a match the user confirmed: confirming an automatic match's own item makes the
 * match the user's, so a false alarm on it stops counting as one to check. A name search without an answer, a lookup
 * that found nothing and Natura not answering each say so: from a match, "Żaden z nich" still declines it. Every link
 * keeps the list's filter.
 */
export function repinView(
  choices: NaturaChoices,
  current: RepinnableMatch,
  fetchedAt: Date,
  own: NaturaProduct,
  filter: ListFilter,
): NaturaRepin {
  // A decline has no "Żaden z nich": the user leaves it as it is with "Anuluj".
  const decline = current.state === "matched";
  const currentId = current.item?.shopItemId ?? null;
  // The item the user confirmed already, offered no more; an automatic match's item is still offered.
  const confirmedId = current.decidedBy === "user" ? currentId : null;
  const shared = {
    kind: "repin",
    decline,
    replaces: replacesFieldOf(current),
    cancelHref: pageHref(own, filter),
  } as const;
  switch (choices.kind) {
    case "choices": {
      const otherwise = decline ? "„Żaden z nich”" : "„Anuluj”";
      const incomplete =
        choices.incomplete === null
          ? null
          : `Wyszukiwanie po nazwie się nie udało, więc lista może być niepełna. ${unavailableText(choices.incomplete)}`;
      return {
        ...shared,
        intro: `Znalezione w Naturze ${FOUND_BY[choices.via]}. Wybierz ten sam produkt albo ${otherwise}.`,
        options: choices.options.map((option) => ({
          ...optionView(option, fetchedAt, own),
          current: option.candidate.shopItemId === currentId,
          confirm: option.candidate.shopItemId !== confirmedId,
        })),
        message: incomplete === null ? null : { text: incomplete, warning: true },
      };
    }
    case "not-found":
      return {
        ...shared,
        intro: null,
        options: [],
        message: { text: "Nie znaleziono w Naturze żadnego produktu.", warning: false },
      };
    case "unavailable":
      return { ...shared, intro: null, options: [], message: { text: unavailableText(choices), warning: true } };
  }
}

/** Why Natura gave no answer, in the words every page uses. */
function unavailableText({ reason, until }: ShopUnavailable): string {
  return shopUnavailableText(SHOP_LABELS.natura.name, reason, until);
}

/**
 * The button that looks the product up, for a page opened other than by the user's own navigation, which may not
 * spend the shop's cap. A retry stays in its link, so the lookup it leads to checks a stored "not found" again.
 */
export function promptView(own: NaturaProduct, retrying: boolean, filter: ListFilter): NaturaView {
  return { kind: "prompt", href: pageHref(own, filter, retrying ? { retry: "1" } : {}) };
}

/** A decision another tab stored while this page looked the product up, with the link that shows it. */
export function decidedView(own: NaturaProduct, filter: ListFilter): NaturaView {
  return { kind: "decided", href: pageHref(own, filter) };
}

/**
 * The notice of the Natura decision the page was sent back with (`?matched`, `?declined` or `?decided`), or null for
 * none. Should several come at once, a match's notice wins, then a decline's.
 */
export function decisionNotice(params: URLSearchParams): string | null {
  const code = DECISION_CODES.find((each) => params.has(each));
  return code === undefined ? null : DECISION_NOTICES[code];
}
