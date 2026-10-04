import { matchDifferences } from "@/lib/services/matching";
import {
  ageText,
  compareShops,
  keyText,
  listPricedItems,
  listSummaryText,
  namesOf,
  priceState,
  SHOP_LABELS,
  verdictOf,
  type LatestCheck,
  type MatchableShop,
  type PricedItem,
  type PricedShop,
  type PriceVerdict,
} from "@/lib/services/price-comparison";
import type { LatestPrice, MatchState, PriceKey, ShopMatchState, WatchlistItem } from "@/types";

// The list's rows, without I/O: each product's price tag, whether its chips hold it, and the line screen readers hear,
// from the list's three reads. The list page, the product page's list beside the product and the selected row's live
// tag all build them here, so they never disagree. The live tag runs in the browser, so this module imports nothing
// server-only: the comparison rules and the matching rule it uses run in the browser too.

/** The list's filters, as its chips link to them with `?f=`: every product, those on promotion, and those to check. */
export const LIST_FILTERS = ["all", "promo", "check"] as const;

/** One of the list's filters. */
export type ListFilter = (typeof LIST_FILTERS)[number];

/**
 * The filter a `?f=` value or a form's `f` field names, or every product for anything a chip doesn't link to, a field
 * that isn't text included.
 */
export function parseListFilter(raw: FormDataEntryValue | null): ListFilter {
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
 * The list's read of the decisions, as listMatchStates gives it: the decisions that were read, the ones that came back
 * odd, by product and shop, and the shops some odd row of which couldn't say which product it's about.
 */
export interface DecisionsRead {
  states: readonly ShopMatchState[];
  unread: readonly { watchlistItemId: string; shop: MatchableShop }[];
  unattributed: readonly MatchableShop[];
}

/**
 * What definitely differs between a listed product and its match in Natura that nobody has seen, as naturaMismatchOf
 * gives it: the size, the brand, or both (matchDifferences). Only an automatic match can differ unseen; a match the
 * user confirmed, and any other decision, differs in nothing here.
 */
export type NaturaMismatch = ReturnType<typeof matchDifferences>;

/** Nothing to check about a product's Natura decision. */
const NO_MISMATCH: NaturaMismatch = { size: false, brand: false };

/**
 * A row's price tag: its tone, the price it shows, if any, its label, and the line under it that says where that price
 * comes from and how old it is. `sun` names the cheapest shop, `muted` a price that can't be named cheapest but is
 * current, `warn` an out-of-date price, and `outline` no price at all.
 */
export interface PriceTag {
  tone: "sun" | "muted" | "warn" | "outline";
  price: number | null;
  label: string;
  /**
   * The shop or shops the price is from and its age, "Natura · 5 min temu", so no price on the list shows without its
   * source and fetch time; null when the tag shows no price.
   */
  meta: string | null;
}

/** A product as a row draws it, on the list or among the search results: its brand and size above its name. */
export interface RowProduct {
  /** The brand and the size, as the data has them ("NIVEA · 300 ml"); the view sets their case. */
  eyebrow: string | null;
  /** The product's name with its caption, as the shop splits them ("Soft krem uniwersalny, nawilżający"). */
  name: string;
  brand: string | null;
  imageUrl: string | null;
}

/**
 * A product's row on the list: the product, its price tag, the line screen readers hear in its place, and whether the
 * Promocje and Do sprawdzenia chips hold it.
 */
export interface ListRow extends RowProduct {
  itemId: string;
  tag: PriceTag;
  summary: string;
  promo: boolean;
  check: boolean;
}

/** A product as a row names it: a listed product, or a search result the user may add. */
export type NamedProduct = Pick<WatchlistItem, "brand" | "name" | "caption" | "sizeText" | "imageUrl">;

/** A listed product, as far as its row looks at it. */
export type ListedProduct = NamedProduct & Pick<WatchlistItem, "id">;

/** The product a row draws, the same for a product on the list and a search result. */
export function rowProductOf(product: NamedProduct): RowProduct {
  return {
    eyebrow: joined([product.brand, product.sizeText], " · "),
    name: joined([product.name, product.caption], " ") ?? product.name,
    brand: product.brand,
    imageUrl: product.imageUrl,
  };
}

// What a row says about Natura after its price line, as S-02's list did. A match's price line names Natura's price, so
// a matched product says more only when its match differs from it unseen (mismatchText).
const NATURA_STATUS: Record<Exclude<NaturaListState, "matched">, string> = {
  none: `${SHOP_LABELS.natura.name}: do dopasowania`,
  not_found: `${SHOP_LABELS.natura.name}: nie znaleziono`,
  unmatched: `${SHOP_LABELS.natura.name}: brak (Twój wybór)`,
  unreadable: `${SHOP_LABELS.natura.name}: nie udało się wczytać dopasowania`,
};

/**
 * What a row says after its price line about a Natura match that differs from the product unseen: which of its size
 * and its brand to check. The row looks as drawn, so the line screen readers hear is where it says why the product is
 * one to check. Null when nothing differs.
 */
function mismatchText({ size, brand }: NaturaMismatch): string | null {
  if (!size && !brand) {
    return null;
  }
  const what = size && brand ? "inny rozmiar i marka" : size ? "inny rozmiar" : "inna marka";
  return `${SHOP_LABELS.natura.name}: sprawdź dopasowanie, ${what}`;
}

/**
 * A product's row, judged at `now` from its priced shops and its Natura state, with what its Natura match differs in
 * unseen (`mismatch`, naturaMismatchOf), which only a match can. A Natura decision that couldn't be read counts as a
 * price that couldn't be read: the match it hides may name a lower price, so no shop is named, and the row never reads
 * as having only Rossmann.
 *
 * - Promocje holds a product with a fresh price, which may be one that can't be ordered online, carrying a regular
 *   price or a promotion's end.
 * - Do sprawdzenia holds a product with a price that isn't fresh (stale, its item missing, never checked or unread), or
 *   with no Natura decision, a lookup that found nothing, a decision that couldn't be read, or a match whose size or
 *   brand differs unseen, which the row's line names (FR-007). A decline doesn't count, and neither does a fresh price
 *   that can't be ordered online.
 *
 * The tag never shows a mismatch: the row looks as drawn.
 */
export function listRowOf(
  item: ListedProduct,
  pricedShops: readonly RowShop[],
  natura: NaturaListState,
  now: number,
  mismatch: NaturaMismatch = NO_MISMATCH,
): ListRow {
  const compared = compareShops(pricedShops, now);
  const unread = pricedShops.some((shop) => shop.readFailed) || natura === "unreadable";
  const priceLine = listSummaryText(compared.summary, compared.rows, now, unread);
  // A match that differs from the product unseen: only an automatic one comes with a mismatch (naturaMismatchOf).
  const suspicious = natura === "matched" && (mismatch.size || mismatch.brand);
  const status = natura === "matched" ? mismatchText(mismatch) : NATURA_STATUS[natura];
  const sentences = status === null ? [priceLine] : [priceLine, status];
  return {
    itemId: item.id,
    ...rowProductOf(item),
    tag: priceTagOf(verdictOf(compared, now, unread)),
    summary: sentences.map(sentence).join(" "),
    promo: pricedShops.some((shop) => onPromotion(shop, now)),
    check:
      suspicious ||
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

/**
 * The price tag a verdict shows on the list, with its price's shop and age read at the time the verdict was judged: a
 * tie's shops and its oldest price's age, the cheapest price's, or the one shop's price whatever its state, so a stale
 * or unavailable price names its shop too.
 */
export function priceTagOf(verdict: PriceVerdict): PriceTag {
  switch (verdict.kind) {
    case "cheapest": {
      const shops = namesOf(verdict.shops);
      return { tone: "sun", price: verdict.price, label: shops, meta: sourceLine(shops, verdict.ageFrom, verdict.at) };
    }
    case "only":
      return {
        tone: "muted",
        price: verdict.price,
        label: `Tylko ${SHOP_LABELS[verdict.shop].name}`,
        meta: shopLine(verdict),
      };
    case "unavailable":
      return { tone: "muted", price: verdict.price, label: "Niedostępny", meta: shopLine(verdict) };
    case "stale":
      return { tone: "warn", price: verdict.price, label: "Nieaktualna", meta: shopLine(verdict) };
    case "unread":
      return { tone: "outline", price: null, label: "Błąd odczytu", meta: null };
    case "none":
      return { tone: "outline", price: null, label: "Bez ceny", meta: null };
  }
}

/** Where a tag's price comes from and how old it is at `now`, as the row's meta line says it: "Natura · 5 min temu". */
function sourceLine(shops: string, pricedAt: string, now: number): string {
  return `${shops} · ${ageText(pricedAt, now)}`;
}

/** The meta line of a verdict that gives one shop's price: that shop, and the price's age when it was judged. */
function shopLine({ shop, pricedAt, at }: { shop: PricedShop; pricedAt: string; at: number }): string {
  return sourceLine(SHOP_LABELS[shop].name, pricedAt, at);
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
 * The list's chips and the filter it's shown with, on the list and beside a product alike: each chip's count and the
 * filter the address names (`raw`, the `?f=` value), or no chips and every product. There are chips only when the
 * list has products and all three of its reads worked (`readsWorked`), since a row whose price or decision couldn't be
 * read can't say whether a chip holds it, and an empty list, or one that couldn't be read, has nothing to filter.
 */
export function listChipsOf(
  rows: readonly Pick<ListRow, "promo" | "check">[] | null,
  readsWorked: boolean,
  raw: string | null,
): { counts: Record<ListFilter, number> | null; filter: ListFilter } {
  const counts = rows !== null && rows.length > 0 && readsWorked ? filterCounts(rows) : null;
  return { counts, filter: counts === null ? "all" : parseListFilter(raw) };
}

/**
 * A link on the page at `path` that keeps the list's filter: the same page with the filter first, unless it's every
 * product's, then `params` in their order, so it drops the search, the notices and anything else the address held. A
 * chip's link is the page with its filter alone, and every product's chip is the bare page. The product page's own
 * links, forms' redirects and the list's refresh add what they carry after the filter, such as `retry=natura`,
 * `repin=natura` or a notice's code.
 */
export function filterHref(path: string, filter: ListFilter, params: Record<string, string> = {}): string {
  const page = path.split(/[?#]/, 1)[0];
  const query = new URLSearchParams(filter === "all" ? [] : [["f", filter]]);
  for (const [name, value] of Object.entries(params)) {
    query.append(name, value);
  }
  const text = query.toString();
  return text === "" ? page : `${page}?${text}`;
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
 * unreadable when its Natura row couldn't be read, or when a Natura row that couldn't say whose it is may be its
 * decision. Another shop's odd row says nothing about Natura.
 */
export function naturaStateOf(itemId: string, read: DecisionsRead | null): NaturaListState {
  if (read === null) {
    return "unreadable";
  }
  const decision = naturaDecisionOf(itemId, read.states);
  if (decision !== undefined) {
    return decision.state;
  }
  const unread = read.unread.some((odd) => odd.watchlistItemId === itemId && odd.shop === "natura");
  return unread || read.unattributed.includes("natura") ? "unreadable" : "none";
}

/**
 * What a product's Natura match differs in that nobody has seen, from the list's read of the decisions: what
 * definitely differs between the product and an automatic match (matchDifferences), a size or a brand unknown on
 * either side never counting. A match the user confirmed was shown with its flags before they confirmed it, so it
 * differs in nothing here, and neither does any other decision, nor one that couldn't be read: its product says so
 * (naturaStateOf).
 */
export function naturaMismatchOf(
  item: Pick<WatchlistItem, "id" | "brand" | "size">,
  read: DecisionsRead | null,
): NaturaMismatch {
  const decision = read === null ? undefined : naturaDecisionOf(item.id, read.states);
  if (decision?.state !== "matched" || decision.decidedBy !== "auto") {
    return NO_MISMATCH;
  }
  return matchDifferences(item, decision);
}

/** The product's decision in Natura among the decisions that were read, if there is one. */
function naturaDecisionOf(itemId: string, states: readonly ShopMatchState[]): ShopMatchState | undefined {
  return states.find((state) => state.watchlistItemId === itemId && state.shop === "natura");
}

/**
 * The list's rows, in the list's order, judged at `now` from its three reads: the products, their decisions per shop
 * and the latest prices, each read as its list read gives it, null when it couldn't be read at all. A product whose
 * price or Natura decision couldn't be read says so, and a read that failed altogether marks every product's, so no
 * row reads a failed read as a product without a price or a match. A product whose automatic Natura match differs
 * from it is one to check, and its row says why. The list, and the list beside a product, build their rows here.
 */
export function listRowsOf(
  items: readonly (ListedProduct & Pick<WatchlistItem, "source" | "sourceItemId" | "size">)[],
  matchRead: DecisionsRead | null,
  priceRead: { prices: readonly LatestPrice[]; unread: readonly PriceKey[]; unattributed: number } | null,
  now: number,
): ListRow[] {
  const priced = listPricedItems(items, matchRead?.states ?? [], priceRead?.prices ?? []);
  return items.map((item) =>
    listRowOf(
      item,
      rowShopsOf(priced.get(item.id) ?? [], priceRead),
      naturaStateOf(item.id, matchRead),
      now,
      naturaMismatchOf(item, matchRead),
    ),
  );
}
