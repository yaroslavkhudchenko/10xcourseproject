import { isJsonMediaType } from "@/lib/json-request";
import {
  ageText,
  compareShops,
  formatPrice,
  judgementOf,
  lowestOf,
  namesOf,
  PRICE_UNREAD_TEXT,
  savingsText,
  SHOP_LABELS,
  sinceText,
  toGrosze,
  verdictOf,
  verdictShops,
  type Comparison,
  type LatestCheck,
  type MatchableShop,
  type PriceComparisonShop,
  type PricedShop,
  type PriceJudgement,
  type PriceVerdict,
  type ShopPrice,
} from "@/lib/services/price-comparison";
import { rowTagOf, type PriceTag, type RowShop } from "@/lib/services/watchlist-rows";
import { PRICE_UNSAVED_TEXT, priceMissingText, priceUnavailableText } from "@/lib/shop-messages";
import type { PriceHistory, PriceRefreshAnswer, SearchUnavailableReason, ShopOffer } from "@/types";

// The product page's price island, without React: each priced shop's latest price, whether its refetch runs, why the
// last one gave no answer, whether the page couldn't read its stored price, whether the route couldn't store the price
// it shows, which matched shops' decisions it couldn't read, and what screen readers hear of the answers. Every change
// goes through the reducer, and the order and marks always come from compareShops, withheld while a stored price or a
// matched shop's decision is unread (compareRows), so Vitest can check them in Node. What the product area says of it,
// its hero with its sticker, its price track with the sentence judging today's price, and its caption, is decided here
// too. It runs in the browser, so it imports nothing server-only.

/** The route that refetches one shop of one product (src/pages/api/watchlist/prices.ts). */
export const PRICES_ROUTE = "/api/watchlist/prices";
/** The form route that refreshes a product's prices when JavaScript doesn't run (src/pages/api/watchlist/refresh.ts). */
export const REFRESH_FORM_ROUTE = "/api/watchlist/refresh";
// A refetch gives up after 20 s, past the route's own worst case (its database calls and the gate's 8 s), so a row
// never waits for good.
const REFRESH_TIMEOUT_MS = 20_000;

/**
 * What one refetch came to: the route's answer; that the session ended and the user has to sign in again; or that the
 * shop's stored match is no longer the item the page shows (`match-changed`), because it was re-pinned elsewhere, so
 * the page has to be reloaded.
 */
export type RefreshResult = PriceRefreshAnswer | { kind: "session-ended" } | { kind: "match-changed" };

/** Why the last refetch gave no answer, shown next to the last known price. */
export interface RefreshNotice {
  reason: SearchUnavailableReason;
  until?: string;
}

/**
 * One shop's row: the item the page shows, its item's page, its latest check, whether a refetch runs, why the last one
 * gave no answer, whether the page couldn't read its stored price, and whether the price it shows couldn't be stored.
 */
export interface ShopRow {
  shop: PricedShop;
  /** The shop's item the page shows, which each refetch names. */
  shopItemId: string;
  productUrl: string | null;
  latest: LatestCheck | null;
  pending: boolean;
  notice: RefreshNotice | null;
  /**
   * The page couldn't read the stored prices, or this shop's, and the shop hasn't answered with a price or a missing
   * item since. The row has no check to show, yet the item may well have been checked, so it never reads as one that
   * never was. While any row is marked, no shop is named cheapest: the price that couldn't be read may be the lowest.
   */
  readFailed: boolean;
  /**
   * The price the row shows came from an answer the route couldn't store, so the list and the page's next view don't
   * have it: they read only stored checks. It belongs to that price, not to the last attempt, so it stays through a new
   * refetch and every answer that brings no new price, until the shop's next price answer sets it anew.
   */
  unsaved: boolean;
}

export interface PriceComparisonState {
  /** The rows in the page's order; compareShops orders them for the view. */
  rows: ShopRow[];
  /** The time ages and staleness are judged at, in milliseconds. */
  now: number;
  /** A refetch found the session ended. */
  sessionEnded: boolean;
  /**
   * The shops whose stored match a refetch found is no longer the item the page shows, each once, in the order their
   * answers came: the page has to be reloaded, and its alert names them.
   */
  matchChanged: MatchableShop[];
  /**
   * The matched shops whose stored decision the page couldn't read, as it handed them over: a match one of them hides
   * could name a lower price, so while there's one no shop is named cheapest, in the rows or aloud. The island never
   * reads the decisions again, so it stays as the page rendered it.
   */
  unreadable: readonly MatchableShop[];
  /**
   * What the island's live region says: one message per answer of the current round, in the order the answers came.
   * A round starts with a refetch while none runs.
   */
  announcements: string[];
}

// A refetch names its shop, any shop the code knows: an answer for a shop without a row of its own still says whose
// match changed.
export type PriceComparisonAction =
  | { type: "start"; shop: MatchableShop }
  | { type: "done"; shop: MatchableShop; result: RefreshResult; at: number }
  | { type: "tick"; now: number };

/** A shop's refetch has started. */
export function start(shop: MatchableShop): PriceComparisonAction {
  return { type: "start", shop };
}

/** A shop's refetch came back with `result`, at `at` on the browser's clock. */
export function done(shop: MatchableShop, result: RefreshResult, at: number): PriceComparisonAction {
  return { type: "done", shop, result, at };
}

/** The clock moved on to `now`, in milliseconds. */
export function tick(now: number): PriceComparisonAction {
  return { type: "tick", now };
}

/**
 * The state the page renders with: the stored prices, nothing running, on the server's clock (`now`, an ISO
 * timestamp), so the browser's first render matches the page's HTML. With `pricesFailed`, the page couldn't read the
 * stored prices, and every row starts marked `readFailed`; otherwise only the rows of the shops handed over with
 * `readFailed` do. `unreadable` are the matched shops whose stored decision the page couldn't read (unreadableShopsOf),
 * which keep every shop from being named cheapest.
 */
export function initialState({
  shops,
  now,
  pricesFailed = false,
  unreadable = [],
}: {
  shops: PriceComparisonShop[];
  now: string;
  pricesFailed?: boolean;
  unreadable?: readonly MatchableShop[];
}): PriceComparisonState {
  return {
    rows: shops.map(({ shop, shopItemId, productUrl, latest, readFailed }) => ({
      shop,
      shopItemId,
      productUrl,
      latest,
      pending: false,
      notice: null,
      readFailed: pricesFailed || readFailed === true,
      unsaved: false,
    })),
    now: Date.parse(now),
    sessionEnded: false,
    matchChanged: [],
    unreadable,
    announcements: [],
  };
}

export function priceComparisonReducer(
  state: PriceComparisonState,
  action: PriceComparisonAction,
): PriceComparisonState {
  switch (action.type) {
    case "start": {
      // A refetch that starts while none runs begins a new round, whose answers are announced afresh.
      const newRound = state.rows.every((row) => !row.pending);
      // A new attempt clears what the last one said; the row keeps its price, and whether that was stored.
      return {
        ...state,
        sessionEnded: false,
        matchChanged: [],
        rows: state.rows.map((row) => (row.shop === action.shop ? { ...row, pending: true, notice: null } : row)),
        announcements: newRound ? [] : state.announcements,
      };
    }
    case "done": {
      const rows = state.rows.map((row) => (row.shop === action.shop ? settled(row, action.result) : row));
      const said = announcement(rows, action.at, action.shop, action.result, state.unreadable);
      // The shop whose match changed, once, so the alert names it.
      const changed = action.result.kind === "match-changed" && !state.matchChanged.includes(action.shop);
      return {
        ...state,
        rows,
        now: action.at,
        sessionEnded: state.sessionEnded || action.result.kind === "session-ended",
        matchChanged: changed ? [...state.matchChanged, action.shop] : state.matchChanged,
        announcements: said === null ? state.announcements : [...state.announcements, said],
      };
    }
    case "tick":
      return { ...state, now: action.now };
  }
}

/**
 * What the live region says about one shop's answer, judged on the rows that answer made, at `now`, beside the matched
 * shops whose decision couldn't be read (`unreadable`): the new price, and whether it's now the cheapest, as the rows
 * mark it, or the text the row shows next to the last known price; then, while the price the row shows is one the
 * route couldn't store (`unsaved`), that the list won't show it (withUnsavedText). Null for an ended session and for a
 * changed match, whatever the row shows: the page's own alerts announce them, with their links to sign in and to
 * reload the page.
 */
function announcement(
  rows: ShopRow[],
  now: number,
  shop: MatchableShop,
  result: RefreshResult,
  unreadable: readonly MatchableShop[],
): string | null {
  const { name } = SHOP_LABELS[shop];
  const answered = rows.find((row) => row.shop === shop);
  // The texts promise the last known price only when the row still shows one.
  const hasPrice = (answered?.latest?.offer ?? null) !== null;
  const unsaved = answered?.unsaved === true;
  switch (result.kind) {
    case "price": {
      const cheapest = compareRows(rows, now, unreadable).rows.some((row) => row.shop === shop && row.cheapest);
      return withUnsavedText(`${name}: ${formatPrice(result.offer.price)}${cheapest ? ", najtaniej" : ""}`, unsaved);
    }
    case "missing":
      return withUnsavedText(`${name}: ${priceMissingText(hasPrice)}`, unsaved);
    case "unavailable":
      return withUnsavedText(priceUnavailableText(name, result.reason, result.until, hasPrice), unsaved);
    case "session-ended":
    case "match-changed":
      return null;
  }
}

/**
 * An answer's text, then, while the price its row shows is one the route couldn't store (`unsaved`), the sentence that
 * says the list won't show it (PRICE_UNSAVED_TEXT), after a period: a price's text has none of its own, and the texts
 * of a missing item and of a shop that gave no answer end with one.
 */
function withUnsavedText(text: string, unsaved: boolean): string {
  if (!unsaved) {
    return text;
  }
  return `${text.endsWith(".") ? text : `${text}.`} ${PRICE_UNSAVED_TEXT}`;
}

/**
 * A row once its refetch came back. Only the shop's own answer, a price or a missing item, replaces a stored price the
 * page couldn't read; an answer that came to nothing leaves the row saying the read failed. Either answer keeps the
 * row's price history as the page read it (historyRead): it covers the days before today, so today's check adds nothing
 * to it. A price answer says whether the route stored its price (`unsaved`). Every other answer keeps what the row
 * says of it, as a new refetch does (start), since the row still shows that price: a missing item keeps the price from
 * before, a shop that gave no answer the whole check, and an ended session or a changed match the whole row.
 */
function settled(row: ShopRow, result: RefreshResult): ShopRow {
  const idle = { ...row, pending: false };
  const history = historyRead(row);
  switch (result.kind) {
    case "price": {
      const { offer, checkedAt } = result;
      return {
        ...idle,
        notice: null,
        readFailed: false,
        unsaved: !result.saved,
        latest: { lastCheckedAt: checkedAt, lastStatus: "price", offer: { ...offer, pricedAt: checkedAt }, history },
      };
    }
    case "missing":
      // The price from before stays with its own age, and the row says the shop no longer returns the item.
      return {
        ...idle,
        notice: null,
        readFailed: false,
        latest: { lastCheckedAt: result.checkedAt, lastStatus: "missing", offer: row.latest?.offer ?? null, history },
      };
    case "unavailable":
      // Nothing was stored, so the last known price keeps its age.
      return {
        ...idle,
        notice: result.until === undefined ? { reason: result.reason } : { reason: result.reason, until: result.until },
      };
    case "session-ended":
    case "match-changed":
      return idle;
  }
}

/**
 * A row's price history as the page read it: its stored check's; none, for an item the page read without any check,
 * which had no price before today; and null, unread, while the page couldn't read the item's stored price, so a shop's
 * answer never stands for a history nobody read.
 */
function historyRead(row: Pick<ShopRow, "latest" | "readFailed">): PriceHistory | null {
  if (row.latest !== null) {
    return row.latest.history;
  }
  return row.readFailed ? null : { low: null, days: [] };
}

/**
 * What a row without a price says in its place: that its stored price couldn't be read, until its shop answers; that
 * it has no price yet, when it was never checked; or that the shop's last answer had no online price. A price the page
 * couldn't read never reads as one that was never fetched.
 */
export function gapText(row: Pick<ShopRow, "shop" | "latest" | "readFailed">): string {
  if (row.readFailed) {
    return PRICE_UNREAD_TEXT;
  }
  if (row.latest === null) {
    return "Jeszcze bez ceny";
  }
  return `Brak ceny online w ${SHOP_LABELS[row.shop].site}`;
}

/** The rows in their order with their marks, and the summary, at the state's time, as compareRows gives them. */
export function comparisonOf(state: PriceComparisonState): Comparison<ShopRow> {
  return compareRows(state.rows, state.now, state.unreadable);
}

/**
 * The rows compared at `now`: compareShops' order, marks and summary, unless some row's stored price couldn't be read,
 * or some matched shop's decision couldn't be (`unreadable`), whose hidden match has no row at all. Either price may be
 * the lowest, so then no row is marked cheapest, in the rows or in what screen readers hear, and a summary that would
 * name the cheapest names none. Each row keeps its order, its state and whether it's eligible.
 */
function compareRows(rows: readonly ShopRow[], now: number, unreadable: readonly MatchableShop[]): Comparison<ShopRow> {
  const comparison = compareShops(rows, now);
  if (unreadable.length === 0 && !rows.some((row) => row.readFailed)) {
    return comparison;
  }
  return {
    rows: comparison.rows.map((row) => ({ ...row, cheapest: false })),
    summary: comparison.summary.kind === "cheapest" ? { kind: "none" } : comparison.summary,
  };
}

/** A row as the island renders it, with its verdict. */
export type ComparedRow = Comparison<ShopRow>["rows"][number];

/**
 * The verdict on the island's prices at the state's time (verdictOf), as comparisonOf compares them: `unread` while
 * some row's stored price couldn't be read, which a failed read of all the stored prices (`pricesFailed`) marks on
 * every row, and while some matched shop's decision couldn't be read (`unreadable`). The price that couldn't be read
 * may be the lowest, so then the product area names no shop.
 */
export function verdictOfState(state: PriceComparisonState): PriceVerdict {
  return verdictOf(
    comparisonOf(state),
    state.now,
    state.unreadable.length > 0 || state.rows.some((row) => row.readFailed),
  );
}

/**
 * Whether the price the state's verdict names is a good one (judgementOf), judged on the rows the verdict was made from
 * (comparisonOf), at the verdict's time, for a product added to the list at `addedAt`.
 */
export function judgementOfState(state: PriceComparisonState, addedAt: string): PriceJudgement | null {
  const verdict = verdictOfState(state);
  return judgementOf(verdict, comparisonOf(state).rows, addedAt, verdict.at);
}

/**
 * The `window` event the product's island sends after each change of its rows, so the list beside the product can
 * bring its row's tag up to date: once it has hydrated, and as each shop's refetch starts and is answered. Its detail
 * is a PricesEventDetail.
 */
export const PRICES_EVENT = "drogeria:prices";

/**
 * What PRICES_EVENT carries: which product, and each of its shops as the island holds it: its latest check and whether
 * its price couldn't be read. The list's row recomputes its tag from them (rowTagOf); a matched shop's decision that
 * couldn't be read goes as that shop with a price that couldn't be read.
 */
export interface PricesEventDetail {
  itemId: string;
  shops: RowShop[];
}

/**
 * The product's shops as the list's row compares them (RowShop), from the island's rows: each row's shop, its latest
 * check and whether its stored price couldn't be read, and, for each matched shop whose decision couldn't be read
 * (`unreadable`, unreadableShopsOf), that shop as one whose price couldn't be read, since its match could name a lower
 * price. The island sends them with PRICES_EVENT after each change of its rows, and the page judges the selected row's
 * first tag by the rows the island starts with, so the list beside the product and the product agree from the first
 * paint.
 */
export function rowShopsOfIsland(rows: readonly ShopRow[], unreadable: readonly PricedShop[] = []): RowShop[] {
  const shops: RowShop[] = rows.map(({ shop, latest, readFailed }) => ({ shop, latest, readFailed }));
  for (const unread of unreadable) {
    if (!shops.some(({ shop }) => shop === unread)) {
      shops.push({ shop: unread, latest: null, readFailed: true });
    }
  }
  return shops;
}

/**
 * The selected row's first tag on the list beside a product: the list's tag (rowTagOf) for the shops the island starts
 * with (initialState), as `shops` and `pricesFailed` hand them over, with each matched shop whose decision couldn't be
 * read (`unreadable`), judged at the page's render (`renderedAt`, an ISO timestamp). So the row and the product agree
 * from the first paint, with JavaScript or without; the island then keeps the tag up to date (PRICES_EVENT).
 */
export function selectedRowTagOf(
  shops: PriceComparisonShop[],
  pricesFailed: boolean,
  unreadable: readonly PricedShop[],
  renderedAt: string,
): PriceTag {
  const { rows } = initialState({ shops, now: renderedAt, pricesFailed });
  return rowTagOf(rowShopsOfIsland(rows, unreadable), Date.parse(renderedAt));
}

/**
 * The shops a PRICES_EVENT carries for the product `itemId`, as the island sent them, or null for any other event: one
 * about another product, or one without its detail. The list's selected row recomputes its tag from them (rowTagOf).
 */
export function shopsOfPricesEvent(event: Event, itemId: string): RowShop[] | null {
  if (event.type !== PRICES_EVENT || !(event instanceof CustomEvent)) {
    return null;
  }
  const detail: unknown = event.detail;
  return isPricesDetail(detail) && detail.itemId === itemId ? detail.shops : null;
}

/** A PRICES_EVENT's detail as the island sends it: its product's id and its shops. */
function isPricesDetail(value: unknown): value is PricesEventDetail {
  return isRecord(value) && typeof value.itemId === "string" && Array.isArray(value.shops);
}

/**
 * What the product area knows of the matched shops beside the prices: the ones whose match is still to be made
 * (undecidedShopsOf), in the pages' order.
 */
export interface MatchContext {
  undecided: readonly MatchableShop[];
}

/**
 * What the page's alert says when refetches found that these shops' stored matches are no longer the items the page
 * shows, agreeing in number: "Dopasowanie w Naturze się zmieniło." and "Dopasowania w Naturze i w Hebe się zmieniły.".
 */
export function matchChangedText(shops: readonly MatchableShop[]): string {
  const where = namesOf(shops, "in");
  return shops.length > 1 ? `Dopasowania ${where} się zmieniły.` : `Dopasowanie ${where} się zmieniło.`;
}

/**
 * What the hero says of the matched shops still to be matched, agreeing in number: "Natura czeka na dopasowanie" and
 * "Natura i Hebe czekają na dopasowanie"; null for none.
 */
function waitingText(undecided: readonly MatchableShop[]): string | null {
  if (undecided.length === 0) {
    return null;
  }
  return `${namesOf(undecided)} ${undecided.length > 1 ? "czekają" : "czeka"} na dopasowanie`;
}

/**
 * The product's hero, from its verdict: its tone, the line above the price, the shop or shops it names after "w", the
 * price, the line below it, and the sticker it wears: a fact, "Tylko 1 sklep" (`one-shop`) and "Stara cena"
 * (`stale`), or the judgement of today's cheapest price (FR-012), "Dobra cena!" (`good`) and "Zwykła cena"
 * (`ordinary`).
 */
export interface Hero {
  tone: "sun" | "plain" | "warn";
  eyebrow: string;
  shops: string | null;
  price: number | null;
  sub: string | null;
  sticker: "one-shop" | "stale" | "good" | "ordinary" | null;
}

/**
 * The hero of a product whose prices came to `verdict`, reading every age at the time it was judged. The line below
 * the price gives how much less the cheapest price is and the age of the price it names (a tie's oldest), names the
 * matched shops that still wait for their match beside the only price, and warns that a stale price may be out of
 * date. The cheapest price wears its judgement's sticker (`judgement`, judgementOfState's), and none when
 * there's nothing to compare it with; the only price keeps "Tylko 1 sklep", and the price track's card gives its
 * judgement (trackHint).
 */
export function heroOf(verdict: PriceVerdict, { undecided }: MatchContext, judgement: PriceJudgement | null): Hero {
  switch (verdict.kind) {
    case "cheapest":
      return {
        tone: "sun",
        eyebrow: "Najtaniej dziś",
        shops: namesOf(verdict.shops, "in"),
        price: verdict.price,
        sub: parts(
          verdict.savings === null ? null : savingsText(verdict.savings),
          checkedText(verdict.ageFrom, verdict.at),
        ),
        sticker: judgement === null || judgement.kind === "none" ? null : judgement.kind,
      };
    case "only":
      return {
        tone: "plain",
        eyebrow: "Jedyna znana cena",
        shops: SHOP_LABELS[verdict.shop].in,
        price: verdict.price,
        sub: parts(checkedText(verdict.pricedAt, verdict.at), waitingText(undecided)),
        sticker: "one-shop",
      };
    case "unavailable":
      return {
        tone: "plain",
        eyebrow: "Niedostępny online",
        shops: SHOP_LABELS[verdict.shop].in,
        price: verdict.price,
        sub: checkedText(verdict.pricedAt, verdict.at),
        sticker: null,
      };
    case "stale":
      return {
        tone: "warn",
        eyebrow: "Ostatnia znana cena",
        shops: SHOP_LABELS[verdict.shop].in,
        price: verdict.price,
        sub: parts(ageText(verdict.pricedAt, verdict.at), "cena może być nieaktualna"),
        sticker: "stale",
      };
    case "unread":
      return {
        tone: "plain",
        eyebrow: "Nie udało się wczytać cen",
        shops: null,
        price: null,
        sub: null,
        sticker: null,
      };
    case "none":
      return { tone: "plain", eyebrow: "Jeszcze bez ceny", shops: null, price: null, sub: null, sticker: null };
  }
}

/** When a check or a price was, as the product area says it: "sprawdzono 5 min temu". */
function checkedText(iso: string, now: number): string {
  return `sprawdzono ${ageText(iso, now)}`;
}

/** The parts of a line that are there, as the pages join them. */
function parts(...texts: (string | null)[]): string {
  return texts.filter((text) => text !== null).join(" · ");
}

/** One priced shop on the price track: which shop, its price as the pages write it, and where it sits, in percent. */
export interface TrackMarker {
  shop: PricedShop;
  price: string;
  x: number;
}

/**
 * The price track: one marker per shop with a price; the band from the lowest to the highest shop price, when there
 * are two or more; the tick of the 30-day low the verdict's shop reports, with its label and value; and the note on
 * the right. Every position is a percentage of the track's width.
 */
export interface Track {
  markers: TrackMarker[];
  band: { from: number; to: number } | null;
  low: { x: number; label: string; price: string } | null;
  note: string | null;
}

/**
 * The price track of the rows (the comparison's, in its order) under `verdict`, or null with fewer than two values to
 * place: the prices of the rows with an offer, and the 30-day low of the verdict's shop, the lowest of a tie's, when
 * it reports one. The values spread over the track's middle 88 %, padded by 22 % of their span on each side, and a
 * span of zero counts as 1 zł. The note says how much less the cheapest price is, or how old a stale one is.
 */
export function trackOf(rows: readonly ShopPrice[], verdict: PriceVerdict): Track | null {
  const offers = rows.flatMap(({ shop, latest }) => (latest?.offer ? [{ shop, price: latest.offer.price }] : []));
  const low = lowestOf(rows, verdictShops(verdict));
  const values = low === null ? offers.map(({ price }) => price) : [...offers.map(({ price }) => price), low];
  if (values.length < 2) {
    return null;
  }
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pad = 0.22 * span;
  const x = (value: number) => 6 + ((value - (min - pad)) / (span + 2 * pad)) * 88;
  const prices = offers.map(({ price }) => price);
  return {
    markers: offers.map(({ shop, price }) => ({ shop, price: formatPrice(price), x: x(price) })),
    band: prices.length < 2 ? null : { from: x(Math.min(...prices)), to: x(Math.max(...prices)) },
    low: low === null ? null : { x: x(low), label: "najniższa z 30 dni", price: formatPrice(low) },
    note: trackNote(verdict),
  };
}

/** Where a label sits above its place: centred on it, ending at it (to its left) or starting at it (to its right). */
export type MarkerLabelSide = "center" | "end" | "start";

/**
 * One label above the price track: the shops it names, left to right, the price it gives, and its place, in percent of
 * the track's width, with the side it sits on.
 */
export interface TrackLabel {
  shops: PricedShop[];
  price: string;
  x: number;
  side: MarkerLabelSide;
}

// How close two markers may come, in percent of the track, before their centred labels would run into each other: a
// label is about as wide as 30 % of a phone's track.
const CLOSE_MARKERS = 30;

/**
 * The labels above the markers, left to right; markers at the same place keep their order. A run of markers, each
 * closer than 30 % to the next, shares the room above it. One marker's label is centred on it. Two turn away from each
 * other: the left one ends at its marker and the right one starts at its own, so equal or nearby prices never write
 * over each other. Three do the same around a centred middle one, while both gaps leave half a label's room. Any closer
 * run gets one label, centred on the run: every name, one under another, then the price they share, or "od" the
 * lowest of theirs when their prices differ.
 */
export function trackLabels(markers: readonly TrackMarker[]): TrackLabel[] {
  const along = markers
    .map((marker, index) => ({ marker, index }))
    .sort((a, b) => a.marker.x - b.marker.x || a.index - b.index);
  const runs: TrackMarker[][] = [];
  for (const { marker } of along) {
    const run = runs.at(-1);
    if (run !== undefined && marker.x - run[run.length - 1].x < CLOSE_MARKERS) {
      run.push(marker);
    } else {
      runs.push([marker]);
    }
  }
  return runs.flatMap(labelsOfRun);
}

/** The labels of one run of close markers, left to right (trackLabels). */
function labelsOfRun(run: TrackMarker[]): TrackLabel[] {
  const own = ({ shop, price, x }: TrackMarker, side: MarkerLabelSide): TrackLabel => ({
    shops: [shop],
    price,
    x,
    side,
  });
  const [first, second, third] = run;
  const last = run[run.length - 1];
  if (run.length === 1) {
    return [own(first, "center")];
  }
  if (run.length === 2) {
    return [own(first, "end"), own(second, "start")];
  }
  const roomy = (left: TrackMarker, right: TrackMarker) => right.x - left.x >= CLOSE_MARKERS / 2;
  if (run.length === 3 && roomy(first, second) && roomy(second, third)) {
    return [own(first, "end"), own(second, "center"), own(third, "start")];
  }
  return [
    {
      shops: run.map(({ shop }) => shop),
      // Left to right is from the lowest price to the highest, so the first is the lowest.
      price: run.every(({ price }) => price === first.price) ? first.price : `od ${first.price}`,
      x: (first.x + last.x) / 2,
      side: "center",
    },
  ];
}

/**
 * How far each marker's circle steps aside, in the markers' order, so markers at the same price stand side by side
 * around their shared place: in half-steps of the view's spacing, 0 alone, −1 and 1 for two, −2, 0 and 2 for three.
 */
export function markerSteps(markers: readonly TrackMarker[]): number[] {
  return markers.map(({ price }, index) => {
    const samePrice = markers.filter((marker) => marker.price === price).length;
    const before = markers.slice(0, index).filter((marker) => marker.price === price).length;
    return 2 * before - (samePrice - 1);
  });
}

/** The track's note, set in capitals by the view: the cheapest price's savings, or a stale price's age. */
function trackNote(verdict: PriceVerdict): string | null {
  if (verdict.kind === "cheapest") {
    return verdict.savings === null ? null : `różnica ${formatPrice(verdict.savings.amount)}`;
  }
  if (verdict.kind === "stale") {
    const since = sinceText(verdict.pricedAt, verdict.at);
    return since === null ? null : `cena sprzed ${since}`;
  }
  return null;
}

/**
 * What the price track's card says, beside the track or in its place: the sentence judging today's price (judgementText)
 * by its judgement (`judgement`, judgementOfState's), then what the product needs done (actionText), joined by a space.
 * Null when there's nothing to say.
 */
export function trackHint(
  verdict: PriceVerdict,
  { undecided }: MatchContext,
  judgement: PriceJudgement | null,
): string | null {
  const texts = [judgementText(verdict, judgement), actionText(verdict, undecided)].filter((text) => text !== null);
  return texts.length === 0 ? null : texts.join(" ");
}

/** Where a judged price stands against what it was compared with, in whole grosze. */
type Standing = "below" | "equal" | "above";

// The sentences of the owner's rule (2026-10-06), by where the price stands and what it was compared with: the shops'
// declared 30-day low, the lowest of them for a tie, or the product's own history in its shops. `low` is the
// comparison's price, as the pages write it.
const AGAINST_SHOP: Record<Standing, (low: string) => string> = {
  below: () => "Poniżej najniższej ceny z 30 dni wg sklepu.",
  equal: () => "Równa najniższej cenie z 30 dni wg sklepu.",
  above: (low) => `Powyżej najniższej ceny z 30 dni wg sklepu (${low}).`,
};
const AGAINST_HISTORY: Record<Standing, (low: string) => string> = {
  below: () => "Najniższa cena w Twoich sklepach od 30 dni.",
  equal: () => "Równa najniższej cenie w Twoich sklepach z ostatnich 30 dni.",
  above: (low) => `W ostatnich 30 dniach było taniej w Twoich sklepach: ${low}.`,
};
// Why a price was compared with the shops' declared low: the product's own history isn't enough yet.
const HISTORY_TOO_SHORT = "Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.";

/**
 * The sentence judging the price the verdict names, by its judgement: where the price stands against the shops'
 * declared 30-day low, then, while the product's own history is too short, that it is; where it stands against the
 * product's own history; or, with nothing to compare with, which shops declare no low, agreeing in number, and that the
 * history is too short. A history that wasn't read (`unread`) is never called short. Equal and above are both
 * ordinary, told apart by the price and the comparison in whole grosze. Null without a judgement.
 */
function judgementText(verdict: PriceVerdict, judgement: PriceJudgement | null): string | null {
  // Only a cheapest or an only price is judged (judgementOf).
  if (judgement === null || (verdict.kind !== "cheapest" && verdict.kind !== "only")) {
    return null;
  }
  if (judgement.kind === "none") {
    const declare = judgement.shops.length > 1 ? "nie podają" : "nie podaje";
    const noLow = `Nie ma z czym porównać: ${namesOf(judgement.shops)} ${declare} najniższej ceny z 30 dni`;
    return judgement.history === "short" ? `${noLow}, a historia cen jest jeszcze za krótka.` : `${noLow}.`;
  }
  let standing: Standing = "below";
  if (judgement.kind === "ordinary") {
    standing = toGrosze(verdict.price) === toGrosze(judgement.baseline) ? "equal" : "above";
  }
  const low = formatPrice(judgement.baseline);
  if (judgement.basis === "history") {
    return AGAINST_HISTORY[standing](low);
  }
  const sentence = AGAINST_SHOP[standing](low);
  return judgement.history === "short" ? `${sentence} ${HISTORY_TOO_SHORT}` : sentence;
}

/**
 * What the product needs done, as the price track's card asks it: the only price asks for the matches of the matched
 * shops that still wait for one, and a stale price asks for a refresh. Null when it needs nothing.
 */
function actionText(verdict: PriceVerdict, undecided: readonly MatchableShop[]): string | null {
  if (verdict.kind === "only" && undecided.length > 0) {
    return `Dopasuj produkt ${namesOf(undecided, "in")}, aby porównać ceny.`;
  }
  if (verdict.kind === "stale") {
    return "Odśwież ceny, aby sprawdzić aktualną cenę.";
  }
  return null;
}

/**
 * What the caption and the phone's bar say for when the prices were checked while a shop's stored price couldn't be
 * read: that shop's check may be the oldest, so no other shop's age may stand for them all, and it may well have been
 * checked, so it never reads as never checked.
 */
const CHECKS_UNREAD_TEXT = "nie udało się wczytać";

/** When a product's shops were checked, as a whole: a check couldn't be read, the oldest check, or none was made. */
type ChecksOf = { kind: "unread" } | { kind: "checked"; oldest: string } | { kind: "never" };

/**
 * When the rows' shops were checked: `unread` while some row's stored price couldn't be read, which a failed read of
 * all the stored prices (`pricesFailed`) marks on every row; otherwise the oldest check among the shops that have one,
 * so no age makes a price look fresher than it is, and `never` when no shop has one. A shop never checked shows its
 * own gap and is left out. A refetch that stores nothing keeps its shop's check.
 */
function checksOf(rows: readonly Pick<ShopRow, "latest" | "readFailed">[]): ChecksOf {
  if (rows.some((row) => row.readFailed)) {
    return { kind: "unread" };
  }
  let oldest: string | null = null;
  for (const { latest } of rows) {
    if (latest !== null && (oldest === null || checkTime(latest.lastCheckedAt) < checkTime(oldest))) {
      oldest = latest.lastCheckedAt;
    }
  }
  return oldest === null ? { kind: "never" } : { kind: "checked", oldest };
}

/**
 * When the product's prices were checked, as the caption under "Odśwież ceny" says it (checksOf): "sprawdzono" and
 * the oldest check's age; that the checks couldn't be read while a shop's stored price couldn't be; and "jeszcze nie
 * sprawdzono" only when no shop was checked and every price was read.
 */
export function checkedCaption(rows: readonly Pick<ShopRow, "latest" | "readFailed">[], now: number): string {
  const checks = checksOf(rows);
  switch (checks.kind) {
    case "unread":
      return CHECKS_UNREAD_TEXT;
    case "checked":
      return `sprawdzono ${ageText(checks.oldest, now)}`;
    case "never":
      return "jeszcze nie sprawdzono";
  }
}

/**
 * What the phone's bottom bar writes under "Sprawdzono", by checkedCaption's rule: the oldest check's age, or that the
 * checks couldn't be read while a shop's stored price couldn't be. Null when no shop was checked, and the bar then
 * gives the caption on its own.
 */
export function checkedAge(rows: readonly Pick<ShopRow, "latest" | "readFailed">[], now: number): string | null {
  const checks = checksOf(rows);
  switch (checks.kind) {
    case "unread":
      return CHECKS_UNREAD_TEXT;
    case "checked":
      return ageText(checks.oldest, now);
    case "never":
      return null;
  }
}

/** A check's time in milliseconds; one that doesn't parse counts as the oldest, since nothing says it's recent. */
function checkTime(iso: string): number {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

const FAILED: RefreshResult = { kind: "unavailable", reason: "failed" };
const SESSION_ENDED: RefreshResult = { kind: "session-ended" };
const MATCH_CHANGED: RefreshResult = { kind: "match-changed" };

/**
 * Asks the route to refetch one shop of the product, naming the item the page shows there (`shopItemId`), as JSON,
 * which only the app's own pages can send. It never throws: a request that fails or runs out of time is a failed
 * refetch.
 */
export async function requestRefresh(
  itemId: string,
  shop: PricedShop,
  shopItemId: string,
  send: typeof fetch = fetch,
): Promise<RefreshResult> {
  // A timer of its own rather than AbortSignal.timeout, which Safari before 16 lacks; it covers reading the answer too.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REFRESH_TIMEOUT_MS);
  try {
    const response = await send(PRICES_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ itemId, shop, shopItemId }),
      // A signed-out request is redirected to the sign-in page: not following the redirect tells at once.
      redirect: "manual",
      signal: controller.signal,
    });
    return await readRefreshResponse(response);
  } catch {
    return FAILED;
  } finally {
    clearTimeout(timer);
  }
}

/** The parts of a `Response` the island reads, so a test can stand in for a redirect the browser didn't follow. */
export type RefreshResponse = Pick<Response, "type" | "redirected" | "ok" | "status" | "headers" | "json">;

/**
 * What the route's response comes to. A signed-out request is redirected to the sign-in page, so a redirect, or a page
 * in place of JSON, means the session ended: with `redirect: "manual"` the redirect comes back opaque, and one followed
 * anyway comes back as the sign-in page. A conflict the route answers `changed` means the shop's stored match is no
 * longer the item the page shows. Any other error status, and an answer that isn't the route's own, is a failed
 * refetch.
 */
export async function readRefreshResponse(response: RefreshResponse): Promise<RefreshResult> {
  if (response.type === "opaqueredirect" || response.redirected) {
    return SESSION_ENDED;
  }
  if (!isJsonMediaType(response.headers.get("Content-Type"))) {
    // An error page is a failure; a page that loaded fine is the sign-in page.
    return response.ok ? SESSION_ENDED : FAILED;
  }
  // Only the route's answer and its conflict carry a body the island reads.
  if (!response.ok && response.status !== 409) {
    return FAILED;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return FAILED;
  }
  if (response.status === 409) {
    return isRecord(body) && body.error === "changed" ? MATCH_CHANGED : FAILED;
  }
  return parseRefreshAnswer(body) ?? FAILED;
}

// The route's answers are checked by hand rather than with zod, which would add the whole library to the page's
// JavaScript for one small shape.
const REASONS: readonly SearchUnavailableReason[] = ["busy", "paused", "stopped", "failed"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The route's answer, or null when the body isn't one. */
export function parseRefreshAnswer(body: unknown): PriceRefreshAnswer | null {
  if (!isRecord(body)) {
    return null;
  }
  if (body.kind === "unavailable") {
    const { reason, until } = body;
    if (!isReason(reason) || !(until === undefined || typeof until === "string")) {
      return null;
    }
    return until === undefined ? { kind: "unavailable", reason } : { kind: "unavailable", reason, until };
  }
  const { checkedAt, saved } = body;
  if (!isTime(checkedAt) || typeof saved !== "boolean") {
    return null;
  }
  if (body.kind === "missing") {
    return { kind: "missing", checkedAt, saved };
  }
  const offer = body.kind === "price" ? parseOffer(body.offer) : null;
  return offer === null ? null : { kind: "price", offer, checkedAt, saved };
}

/** An offer as the route sends it, or null when a field is off. */
function parseOffer(value: unknown): ShopOffer | null {
  if (!isRecord(value)) {
    return null;
  }
  const { price, regularPrice, lowestPrice30d, promoEndsOn, available } = value;
  if (!isAmount(price) || typeof available !== "boolean") {
    return null;
  }
  if (!(regularPrice === null || isAmount(regularPrice))) {
    return null;
  }
  if (!(lowestPrice30d === null || isAmount(lowestPrice30d))) {
    return null;
  }
  if (!(promoEndsOn === null || (typeof promoEndsOn === "string" && ISO_DATE.test(promoEndsOn)))) {
    return null;
  }
  return { price, regularPrice, lowestPrice30d, promoEndsOn, available };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReason(value: unknown): value is SearchUnavailableReason {
  return REASONS.some((reason) => reason === value);
}

/** A time the island can show an age for. */
function isTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
