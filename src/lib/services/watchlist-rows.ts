import {
  compareShops,
  keyText,
  listSummaryText,
  namesOf,
  priceState,
  SHOP_LABELS,
  verdictOf,
  type LatestCheck,
  type PricedItem,
  type PricedShop,
  type PriceVerdict,
} from "@/lib/services/price-comparison";
import type { MatchState, PriceKey, ShopMatchState, WatchlistItem } from "@/types";

// The list's rows, without I/O: each product's price tag, whether its chips hold it, and the line screen readers hear,
// from the list's three reads. The list page, the product page's list beside the product and the selected row's live
// tag all build them here, so they never disagree. The live tag runs in the browser, so this module imports nothing
// server-only.

/** The list's filters, as its chips link to them with `?f=`: every product, those on promotion, and those to check. */
export const LIST_FILTERS = ["all", "promo", "check"] as const;

/** One of the list's filters. */
export type ListFilter = (typeof LIST_FILTERS)[number];

/** The filter a `?f=` value names, or every product for anything a chip doesn't link to. */
export function parseListFilter(raw: string | null): ListFilter {
  return LIST_FILTERS.find((filter) => filter === raw) ?? "all";
}

/**
 * One of a product's shops, as its row compares it: the shop, its item's latest check, if any, and whether the price
 * read couldn't read that check. The product's island sends its shops in this shape (PRICES_EVENT).
 */
export interface RowShop {
  shop: PricedShop;
  latest: LatestCheck | null;
  readFailed: boolean;
}

/**
 * Where a listed product stands in Natura: its decision there, `none` without one (a choice still to be made
 * included), or `unreadable` when its decision couldn't be read.
 */
export type NaturaListState = MatchState | "none" | "unreadable";

/**
 * A row's price tag: its tone, the price it shows, if any, and its label. `sun` names the cheapest shop, `muted` a
 * price that can't be named cheapest but is current, `warn` an out-of-date price, and `outline` no price at all.
 */
export interface PriceTag {
  tone: "sun" | "muted" | "warn" | "outline";
  price: number | null;
  label: string;
}

/**
 * A product's row on the list: the product (its brand and size above its name), its price tag, the line screen readers
 * hear in its place, and whether the Promocje and Do sprawdzenia chips hold it.
 */
export interface ListRow {
  itemId: string;
  /** The brand and the size, as the data has them ("NIVEA · 300 ml"); the view sets their case. */
  eyebrow: string | null;
  /** The product's name with its caption, as the shop splits them ("Soft krem uniwersalny, nawilżający"). */
  name: string;
  brand: string | null;
  imageUrl: string | null;
  tag: PriceTag;
  summary: string;
  promo: boolean;
  check: boolean;
}

/** A listed product, as far as its row looks at it. */
export type ListedProduct = Pick<WatchlistItem, "id" | "brand" | "name" | "caption" | "sizeText" | "imageUrl">;

// What a row says about Natura after its price line, as S-02's list did. A match's price line names Natura's price, so
// a matched product says nothing more.
const NATURA_STATUS: Record<Exclude<NaturaListState, "matched">, string> = {
  none: `${SHOP_LABELS.natura.name}: do dopasowania`,
  not_found: `${SHOP_LABELS.natura.name}: nie znaleziono`,
  unmatched: `${SHOP_LABELS.natura.name}: brak (Twój wybór)`,
  unreadable: `${SHOP_LABELS.natura.name}: nie udało się wczytać dopasowania`,
};

/**
 * A product's row, judged at `now` from its priced shops and its Natura state. A Natura decision that couldn't be read
 * counts as a price that couldn't be read: the match it hides may name a lower price, so no shop is named, and the row
 * never reads as having only Rossmann.
 *
 * - Promocje holds a product with a fresh price, which may be one that can't be ordered online, carrying a regular
 *   price or a promotion's end.
 * - Do sprawdzenia holds a product with a price that isn't fresh (stale, its item missing, never checked or unread), or
 *   with no Natura decision, a lookup that found nothing, or a decision that couldn't be read. A decline doesn't count,
 *   and neither does a fresh price that can't be ordered online.
 */
export function listRowOf(
  item: ListedProduct,
  pricedShops: readonly RowShop[],
  natura: NaturaListState,
  now: number,
): ListRow {
  const compared = compareShops(pricedShops, now);
  const unread = pricedShops.some((shop) => shop.readFailed) || natura === "unreadable";
  const priceLine = listSummaryText(compared.summary, compared.rows, now, unread);
  const sentences = natura === "matched" ? [priceLine] : [priceLine, NATURA_STATUS[natura]];
  return {
    itemId: item.id,
    eyebrow: joined([item.brand, item.sizeText], " · "),
    name: joined([item.name, item.caption], " ") ?? item.name,
    brand: item.brand,
    imageUrl: item.imageUrl,
    tag: priceTagOf(verdictOf(compared, now, unread)),
    summary: sentences.map(sentence).join(" "),
    promo: pricedShops.some((shop) => onPromotion(shop, now)),
    check:
      natura === "none" ||
      natura === "not_found" ||
      natura === "unreadable" ||
      pricedShops.some((shop) => shop.readFailed || priceState(shop.latest, now) !== "fresh"),
  };
}

/** A shop with a fresh price, orderable online or not, that carries a regular price or a promotion's end. */
function onPromotion({ latest, readFailed }: RowShop, now: number): boolean {
  const offer = latest?.offer ?? null;
  return (
    !readFailed &&
    offer !== null &&
    priceState(latest, now) === "fresh" &&
    (offer.regularPrice !== null || offer.promoEndsOn !== null)
  );
}

/** The parts that are there, trimmed, joined with `separator`; null when none is. */
function joined(parts: (string | null)[], separator: string): string | null {
  const present = parts.map((part) => part?.trim() ?? "").filter((part) => part !== "");
  return present.length === 0 ? null : present.join(separator);
}

/** A text as a sentence of the row's line: with its full stop, once. */
function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

/** The price tag a verdict shows on the list. */
export function priceTagOf(verdict: PriceVerdict): PriceTag {
  switch (verdict.kind) {
    case "cheapest":
      return { tone: "sun", price: verdict.price, label: namesOf(verdict.shops) };
    case "only":
      return { tone: "muted", price: verdict.price, label: `Tylko ${SHOP_LABELS[verdict.shop].name}` };
    case "unavailable":
      return { tone: "muted", price: verdict.price, label: "Niedostępny" };
    case "stale":
      return { tone: "warn", price: verdict.price, label: "Nieaktualna" };
    case "unread":
      return { tone: "outline", price: null, label: "Błąd odczytu" };
    case "none":
      return { tone: "outline", price: null, label: "Bez ceny" };
  }
}

/**
 * The price tag of a row from its shops as the product's island sends them (PRICES_EVENT), at `now`, by the same rule
 * as listRowOf, so the selected row's tag follows the product's refresh. The island names a Natura match that couldn't
 * be read as a Natura shop whose price couldn't be read.
 */
export function rowTagOf(shops: readonly RowShop[], now: number): PriceTag {
  const compared = compareShops(shops, now);
  return priceTagOf(
    verdictOf(
      compared,
      now,
      shops.some((shop) => shop.readFailed),
    ),
  );
}

/** Whether a filter's chip holds a row. */
export function inFilter(row: Pick<ListRow, "promo" | "check">, filter: ListFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "promo":
      return row.promo;
    case "check":
      return row.check;
  }
}

/** How many rows each chip holds, counted over the whole list whichever chip is on. */
export function filterCounts(rows: readonly Pick<ListRow, "promo" | "check">[]): Record<ListFilter, number> {
  const count = (filter: ListFilter) => rows.filter((row) => inFilter(row, filter)).length;
  return { all: count("all"), promo: count("promo"), check: count("check") };
}

/**
 * A chip's link on the page at `path`: the same page with only the filter, so it drops the search, the notices and
 * anything else the address held. Every product's chip is the bare page.
 */
export function filterHref(path: string, filter: ListFilter): string {
  const page = path.split(/[?#]/, 1)[0];
  return filter === "all" ? page : `${page}?${new URLSearchParams({ f: filter }).toString()}`;
}

/**
 * A product's shops as its row compares them, from its priced items (listPricedItems) and the list's price read: the
 * items whose rows couldn't be read, and how many odd rows couldn't say which item they're about. While there's such a
 * row, an item without a readable row counts as unread too, since the odd row may have been its latest; an item with
 * a readable row keeps its price. A null read, when the prices couldn't be read at all, marks every item.
 */
export function rowShopsOf(
  items: readonly PricedItem[],
  read: { unread: readonly PriceKey[]; unattributed: number } | null,
): RowShop[] {
  const unreadKeys = new Set(read?.unread.map(keyText));
  return items.map((item) => ({
    shop: item.shop,
    latest: item.latest,
    readFailed: read === null || unreadKeys.has(keyText(item)) || (read.unattributed > 0 && item.latest === null),
  }));
}

/**
 * Where a product stands in Natura, from the list's read of the decisions, or null when they couldn't be read at all.
 * A Natura decision that was read stands even when another row of the product couldn't be, or a row couldn't say whose
 * it is: a product has one decision per shop, so that row is someone else's. Without one, a product counts as
 * unreadable when one of its rows couldn't be read, or when a row that couldn't say whose it is may be its decision.
 */
export function naturaStateOf(
  itemId: string,
  read: { states: readonly ShopMatchState[]; unread: readonly string[]; unattributed: number } | null,
): NaturaListState {
  if (read === null) {
    return "unreadable";
  }
  const decision = read.states.find((state) => state.watchlistItemId === itemId && state.shop === "natura");
  if (decision !== undefined) {
    return decision.state;
  }
  return read.unread.includes(itemId) || read.unattributed > 0 ? "unreadable" : "none";
}
