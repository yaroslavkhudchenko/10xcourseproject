import { DECISION_CODES, DECISION_NOTICES } from "@/lib/notices";
import { matchDifferences } from "@/lib/services/matching";
import { formatPrice, SHOP_LABELS } from "@/lib/services/price-comparison";
import type { CandidateOption, MatchedItem, ShopCandidate, ShopMatch, Size, WatchlistProduct } from "@/types";

// What a product's page shows in its Natura section, without I/O: the stored decision, the lookup's outcome, or why
// there's neither, and the notice of a decision just saved. The page and the dev kitchen sink build their views here,
// so both show the same texts. Times are shown on the shopper's own clock in Poland, and each builder takes the times
// it shows as arguments.

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
 * What the Natura section shows: the stored decision, the lookup's outcome, or why there's neither. A match names its
 * item, how it was decided and what differs from the product: its price and its page are in its price row, so each
 * shop appears once on the page. A match the page couldn't save has no price row, so its card shows the item's photo
 * and page too.
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
    }
  | { kind: "unmatched" }
  | { kind: "not-found"; text: string; href: string }
  | { kind: "choose"; intro: string; options: NaturaOption[] }
  | { kind: "unavailable"; message: string }
  | { kind: "prompt"; href: string }
  | { kind: "decided" }
  | { kind: "read-failed" };

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

/**
 * A match: how it was decided, its item, and a warning for each thing that definitely differs from the product
 * (matchDifferences), its size, then its brand. A match the page couldn't save (`unsaved`) has no price row, so its
 * card shows the item's photo and page too; a saved or stored match has them in its price row.
 */
export function matchedView(
  item: NaturaItemSummary & Sized,
  decidedBy: "auto" | "user",
  own: NaturaProduct,
  { unsaved = false }: { unsaved?: boolean } = {},
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
  return { kind: "matched", note, warnings, item: { brand, name, sizeText, imageUrl, productUrl }, unsaved };
}

/** A lookup that found nothing at `checkedAt`, with the link that looks the product up again. */
export function notFoundView(checkedAt: Date, own: NaturaProduct): NaturaView {
  return {
    kind: "not-found",
    text: `Nie znaleziono w Naturze (sprawdzono ${dayAndTime.format(checkedAt)}).`,
    // A retry looks the product up again only while its stored decision is "not found".
    href: `/watchlist/${own.id}?retry=1`,
  };
}

/** The product's stored decision in Natura, with the time its lookup ran for one that found nothing. */
export function storedView(match: ShopMatch, own: NaturaProduct): NaturaView {
  switch (match.state) {
    case "matched":
      return matchedView(match.item, match.decidedBy, own);
    case "unmatched":
      return { kind: "unmatched" };
    case "not_found":
      return notFoundView(new Date(match.checkedAt), own);
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

/**
 * The button that looks the product up, for a page opened other than by the user's own navigation, which may not
 * spend the shop's cap. A retry stays in its link, so the lookup it leads to checks a stored "not found" again.
 */
export function promptView(own: NaturaProduct, retrying: boolean): NaturaView {
  const pageUrl = `/watchlist/${own.id}`;
  return { kind: "prompt", href: retrying ? `${pageUrl}?retry=1` : pageUrl };
}

/**
 * The notice of the Natura decision the page was sent back with (`?matched`, `?declined` or `?decided`), or null for
 * none. Should several come at once, a match's notice wins, then a decline's.
 */
export function decisionNotice(params: URLSearchParams): string | null {
  const code = DECISION_CODES.find((each) => params.has(each));
  return code === undefined ? null : DECISION_NOTICES[code];
}
