import { matchDifferences } from "@/lib/services/matching";
import {
  ageText,
  compareShops,
  keyText,
  listJoin,
  listPricedItems,
  listSummaryText,
  MATCHABLE_SHOPS,
  MATCHED_SHOPS,
  namesOf,
  PRICED_SHOPS,
  priceState,
  SHOP_LABELS,
  verdictOf,
  type LatestCheck,
  type MatchableShop,
  type MatchedShop,
  type PricedItem,
  type PricedShop,
  type PriceVerdict,
} from "@/lib/services/price-comparison";
import type { LatestPrice, MatchState, PriceKey, ShopMatchState, WatchlistItem } from "@/types";

// The list's rows, without I/O: each product's price tag, whether its chips hold it, and the line screen readers hear,
// from the list's three reads. The list page, the product page's list beside the product and the selected row's live
// tag all build them here, so they never disagree. It also writes the list's links, which keep its filter (filterHref),
// and the sign-in link that comes back to one of them (signInHref). The live tag and the product's island run in the
// browser, so this module imports nothing server-only: the comparison rules and the matching rule it uses run in the
// browser too.

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
 * Where a listed product stands in one matched shop, as matchStatesOf gives it: matched, with what the match differs in
 * from the product unseen; declined by the user (`unmatched`); not found by the lookup (`not_found`); `none` without a
 * decision, a choice still to be made included; or `unreadable` when its decision couldn't be read.
 */
export type ListMatchState =
  { state: "matched"; mismatch: ListMismatch } | { state: Exclude<MatchState, "matched"> | "none" | "unreadable" };

/**
 * A listed product's state in every matched shop, as matchStatesOf gives it, which its row says and counts
 * (listRowOf). A test may add a shop the code can match that isn't switched on yet.
 */
export type ListMatchStates = Readonly<
  Record<MatchedShop, ListMatchState> & Partial<Record<MatchableShop, ListMatchState>>
>;

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
 * What definitely differs between a listed product and its match in a shop that nobody has seen, as matchStatesOf
 * gives it: the size, the brand, or both (matchDifferences). Only an automatic match can differ unseen; a match the
 * user confirmed differs in nothing here, and any other decision has no match to differ.
 */
export type ListMismatch = ReturnType<typeof matchDifferences>;

/** Nothing to check about a match. */
const NO_MISMATCH: ListMismatch = { size: false, brand: false };

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

/** A listed product's state in one matched shop, with its shop. */
type ShopListState = ListMatchState & { shop: MatchableShop };

/**
 * Each shop's state among `states`, with its shop, in the order of the shops the code knows (MATCHABLE_SHOPS), which
 * the matched shops keep, so a row names its shops in the pages' order however its states were put together. A shop
 * the code knows that isn't switched on may have no state, so `states` is read as one that may leave any shop out.
 */
function shopStatesOf(states: ListMatchStates): ShopListState[] {
  const known: Readonly<Partial<Record<MatchableShop, ListMatchState>>> = states;
  return MATCHABLE_SHOPS.flatMap((shop) => {
    const state = known[shop];
    return state === undefined ? [] : [{ ...state, shop }];
  });
}

// What a row says about a matched shop after its price line, by its decision other than a match, after the shop's
// name, as S-02's list said it of Natura.
const STATUS_TEXTS: Record<Exclude<ListMatchState["state"], "matched">, string> = {
  none: "do dopasowania",
  not_found: "nie znaleziono",
  unmatched: "brak (Twój wybór)",
  unreadable: "nie udało się wczytać dopasowania",
};

/**
 * What a row says about a matched shop after its price line, naming the shop by its label: its decision other than a
 * match, or which of the size and the brand to check about a match that differs from the product unseen. The row looks
 * as drawn, so the line screen readers hear is where it says why the product is one to check. A match that differs in
 * nothing says nothing more, since the price line names its price: null.
 */
function statusText(shopState: ShopListState): string | null {
  const { name } = SHOP_LABELS[shopState.shop];
  if (shopState.state !== "matched") {
    return `${name}: ${STATUS_TEXTS[shopState.state]}`;
  }
  const { size, brand } = shopState.mismatch;
  if (!size && !brand) {
    return null;
  }
  const what = size && brand ? "inny rozmiar i marka" : size ? "inny rozmiar" : "inna marka";
  return `${name}: sprawdź dopasowanie, ${what}`;
}

/**
 * Whether a matched shop's state puts its product in Do sprawdzenia: no decision there, a lookup that found nothing, a
 * decision that couldn't be read, or a match whose size or brand differs from the product unseen (FR-007). A decline
 * doesn't.
 */
function needsCheck(shopState: ListMatchState): boolean {
  switch (shopState.state) {
    case "matched":
      return shopState.mismatch.size || shopState.mismatch.brand;
    case "unmatched":
      return false;
    case "none":
    case "not_found":
    case "unreadable":
      return true;
  }
}

/**
 * A product's row, judged at `now` from its priced shops and its state in every matched shop (`matchStates`,
 * matchStatesOf). A decision that couldn't be read, in any matched shop, counts as a price that couldn't be read: the
 * match it hides may name a lower price, so no shop is named, and the row never reads as having only the shops whose
 * prices it has. After the price line, the row's line says each matched shop's state other than a match, and what to
 * check about a match that differs from the product unseen, in the shops' order.
 *
 * - Promocje holds a product with a fresh price, which may be one that can't be ordered online, carrying a regular
 *   price or a promotion's end.
 * - Do sprawdzenia holds a product with a price that isn't fresh (stale, its item missing, never checked or unread), or
 *   with a matched shop where it has no decision, its lookup found nothing, its decision couldn't be read, or its match
 *   differs in size or brand unseen, which the row's line names (FR-007). A decline doesn't count, and neither does a
 *   fresh price that can't be ordered online.
 *
 * The tag never shows a mismatch: the row looks as drawn.
 */
export function listRowOf(
  item: ListedProduct,
  pricedShops: readonly RowShop[],
  matchStates: ListMatchStates,
  now: number,
): ListRow {
  const states = shopStatesOf(matchStates);
  const compared = compareShops(pricedShops, now);
  const unread = pricedShops.some((shop) => shop.readFailed) || states.some((each) => each.state === "unreadable");
  const priceLine = listSummaryText(compared.summary, compared.rows, now, unread);
  const statuses = states.flatMap((each) => {
    const status = statusText(each);
    return status === null ? [] : [status];
  });
  return {
    itemId: item.id,
    ...rowProductOf(item),
    tag: priceTagOf(verdictOf(compared, now, unread)),
    summary: [priceLine, ...statuses].map(sentence).join(" "),
    promo: pricedShops.some((shop) => onPromotion(shop, now)),
    check:
      states.some((each) => needsCheck(each)) ||
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
 * as listRowOf, so the selected row's tag follows the product's refresh. The island names a matched shop whose decision
 * couldn't be read as that shop with a price that couldn't be read (rowShopsOfIsland).
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

/** The sign-in page, which a signed-out request to the list, a product or their routes is sent to. */
export const SIGN_IN_PATH = "/auth/signin";

/** The parameter the sign-in page carries the page a sign-in goes back to in (`?next=`). */
export const NEXT_PARAM = "next";

/**
 * The sign-in page's link: the plain page, or, with `next`, the page a sign-in goes back to, the list's or a product's
 * with only the list's filter, as filterHref and returnPathFor write it. The middleware, the product's island and the
 * pages link to sign-in through it; the sign-in page checks `next` again (returnPathOf), so a link crafted elsewhere
 * can't send a sign-in anywhere else.
 */
export function signInHref(next?: string): string {
  return next === undefined
    ? SIGN_IN_PATH
    : `${SIGN_IN_PATH}?${new URLSearchParams({ [NEXT_PARAM]: next }).toString()}`;
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
 * Where a listed product stands in each of `shops`, from the list's read of the decisions, or null when they couldn't
 * be read at all, which makes every shop's unreadable. Each shop is read on its own:
 *
 * - A decision that was read stands even when another row of the product couldn't be, or a row couldn't say whose it
 *   is: a product has one decision per shop, so that row is another shop's or someone else's.
 * - Without one, the product's decision there is unreadable when its row of that shop couldn't be read, or when a row
 *   of that shop that couldn't say whose it is may be its decision. Another shop's odd row says nothing about it.
 * - A match comes with what it differs in from the product unseen: what definitely differs between them
 *   (matchDifferences), a size or a brand unknown on either side never counting, for an automatic match only. A match
 *   the user confirmed was shown with its flags before they confirmed it, so it differs in nothing here.
 *
 * `shops` are the matched shops unless a test names others.
 */
export function matchStatesOf<Shop extends MatchableShop = MatchedShop>(
  item: Pick<WatchlistItem, "id" | "brand" | "size">,
  read: DecisionsRead | null,
  shops: readonly Shop[] | typeof MATCHED_SHOPS = MATCHED_SHOPS,
): Record<Shop, ListMatchState> {
  const states: Partial<Record<MatchableShop, ListMatchState>> = {};
  for (const shop of shops) {
    states[shop] = matchStateIn(shop, item, read);
  }
  // Every shop of `shops` has its state, and the default's shops are the matched shops, which `Shop` defaults to, so
  // the cast holds.
  return states as Record<Shop, ListMatchState>;
}

/** Where a listed product stands in one shop, by matchStatesOf's rules. */
function matchStateIn(
  shop: MatchableShop,
  item: Pick<WatchlistItem, "id" | "brand" | "size">,
  read: DecisionsRead | null,
): ListMatchState {
  if (read === null) {
    return { state: "unreadable" };
  }
  const decision = read.states.find((state) => state.watchlistItemId === item.id && state.shop === shop);
  if (decision === undefined) {
    const unread = read.unread.some((odd) => odd.watchlistItemId === item.id && odd.shop === shop);
    return unread || read.unattributed.includes(shop) ? { state: "unreadable" } : { state: "none" };
  }
  if (decision.state !== "matched") {
    return { state: decision.state };
  }
  return {
    state: "matched",
    mismatch: decision.decidedBy === "auto" ? matchDifferences(item, decision) : NO_MISMATCH,
  };
}

/**
 * The list's rows, in the list's order, judged at `now` from its three reads: the products, their decisions per shop
 * and the latest prices, each read as its list read gives it, null when it couldn't be read at all. A product whose
 * price or decision in a matched shop couldn't be read says so, and a read that failed altogether marks every
 * product's, so no row reads a failed read as a product without a price or a match. A product whose automatic match in
 * a matched shop differs from it is one to check, and its row says why. The list, and the list beside a product, build
 * their rows here.
 */
export function listRowsOf(
  items: readonly (ListedProduct & Pick<WatchlistItem, "source" | "sourceItemId" | "size">)[],
  matchRead: DecisionsRead | null,
  priceRead: { prices: readonly LatestPrice[]; unread: readonly PriceKey[]; unattributed: number } | null,
  now: number,
): ListRow[] {
  const priced = listPricedItems(items, matchRead?.states ?? [], priceRead?.prices ?? []);
  return items.map((item) =>
    listRowOf(item, rowShopsOf(priced.get(item.id) ?? [], priceRead), matchStatesOf(item, matchRead), now),
  );
}

/**
 * What the list says above its rows when the decisions couldn't be read at all, naming the shops they're of: "Nie
 * udało się wczytać dopasowań w Naturze. Odśwież stronę." Each row then says its decisions couldn't be read, never that
 * its product is still to be matched. One read holds every matched shop's decisions, so `shops` are the matched shops
 * unless a test names others.
 */
export function matchesFailedText(shops: readonly MatchableShop[] = MATCHED_SHOPS): string {
  return `Nie udało się wczytać dopasowań ${namesOf(shops, "in")}. Odśwież stronę.`;
}

/**
 * Where the list's prices come from, as its footer says it under the rows: online prices, from the sites of `shops`
 * (FR-010), listed the Polish way (listJoin), "Ceny online z rossmann.pl i drogerienatura.pl". `shops` are the priced
 * shops unless a test names others.
 */
export function priceSourcesText(shops: readonly MatchableShop[] = PRICED_SHOPS): string {
  return `Ceny online z ${listJoin(shops.map((shop) => SHOP_LABELS[shop].site))}`;
}
