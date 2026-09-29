import { sizesEqual } from "@/lib/services/matching";
import { formatPrice, SHOP_LABELS } from "@/lib/services/price-comparison";
import type { CandidateOption, MatchedItem, ShopCandidate, ShopMatch, Size, WatchlistProduct } from "@/types";

// What a product's page shows in its Natura section, without I/O: the stored decision, the lookup's outcome, or why
// there's neither. The page and the dev kitchen sink build their views here, so both show the same texts. Times are
// shown on the shopper's own clock in Poland, and each builder takes the times it shows as arguments.

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

/** The watched product, as far as the section looks at it: the id its links lead to, and its size. */
export type NaturaProduct = Pick<WatchlistProduct, "id" | "sizeText" | "size">;

/** A short flag on a candidate: a shared EAN, or a warning about its size. */
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
 * What the Natura section shows: the stored decision, the lookup's outcome, or why there's neither. A match shows only
 * how it was decided and whether its size differs: its price and its page are in its price row, so each shop appears
 * once on the page.
 */
export type NaturaView =
  | { kind: "matched"; note: string; sizeWarning: string | null }
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

/** A match: how it was decided, with its size flagged whenever both sizes are known and differ. */
export function matchedView(item: Sized, decidedBy: "auto" | "user", own: NaturaProduct): NaturaView {
  const differs = own.size !== null && item.size !== null && !sizesEqual(own.size, item.size);
  return {
    kind: "matched",
    note: decidedBy === "auto" ? "Dopasowano automatycznie: ten sam EAN i rozmiar." : "Potwierdzone przez Ciebie.",
    sizeWarning: differs ? otherSize(item, own) : null,
  };
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
