import { isJsonMediaType } from "@/lib/json-request";
import {
  ageText,
  compareShops,
  formatPrice,
  namesOf,
  PRICE_UNREAD_TEXT,
  savingsText,
  SHOP_LABELS,
  sinceText,
  verdictOf,
  type Comparison,
  type LatestCheck,
  type PricedShop,
  type PriceVerdict,
  type ShopPrice,
} from "@/lib/services/price-comparison";
import type { RowShop } from "@/lib/services/watchlist-rows";
import { priceMissingText, priceUnavailableText } from "@/lib/shop-messages";
import type { LatestPrice, PriceRefreshAnswer, SearchUnavailableReason, ShopOffer } from "@/types";

// The product page's price island, without React: each matched shop's latest price, whether its refetch runs, why the
// last one gave no answer, whether the page couldn't read its stored price, and what screen readers hear of the
// answers. Every change goes through the reducer, and the order and marks always come from compareShops, withheld while
// a stored price is unread (compareRows), so Vitest can check them in Node. What the product area says of it, its hero,
// its price track and its caption, is decided here too. It runs in the browser, so it imports nothing server-only.

/** The route that refetches one shop of one product (src/pages/api/watchlist/prices.ts). */
export const PRICES_ROUTE = "/api/watchlist/prices";
/** The form route that refreshes a product's prices when JavaScript doesn't run (src/pages/api/watchlist/refresh.ts). */
export const REFRESH_FORM_ROUTE = "/api/watchlist/refresh";
// A refetch gives up after 20 s, past the route's own worst case (its database calls and the gate's 8 s), so a row
// never waits for good.
const REFRESH_TIMEOUT_MS = 20_000;

/**
 * One matched shop as the page hands it to the island: the shop, its item's page, its stored price, if any, and whether
 * the page couldn't read that price.
 */
export interface PriceComparisonShop {
  shop: PricedShop;
  productUrl: string | null;
  latest: LatestPrice | null;
  /** The page read the stored prices, but not this shop's: its row came back odd. */
  readFailed?: boolean;
}

/** What one refetch came to: the route's answer, or that the session ended and the user has to sign in again. */
export type RefreshResult = PriceRefreshAnswer | { kind: "session-ended" };

/** Why the last refetch gave no answer, shown next to the last known price. */
export interface RefreshNotice {
  reason: SearchUnavailableReason;
  until?: string;
}

/**
 * One shop's row: its item's page, its latest check, whether a refetch runs, why the last one gave no answer, and
 * whether the page couldn't read its stored price.
 */
export interface ShopRow {
  shop: PricedShop;
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
}

export interface PriceComparisonState {
  /** The rows in the page's order; compareShops orders them for the view. */
  rows: ShopRow[];
  /** The time ages and staleness are judged at, in milliseconds. */
  now: number;
  /** A refetch found the session ended. */
  sessionEnded: boolean;
  /**
   * What the island's live region says: one message per answer of the current round, in the order the answers came.
   * A round starts with a refetch while none runs.
   */
  announcements: string[];
}

export type PriceComparisonAction =
  | { type: "start"; shop: PricedShop }
  | { type: "done"; shop: PricedShop; result: RefreshResult; at: number }
  | { type: "tick"; now: number };

/** A shop's refetch has started. */
export function start(shop: PricedShop): PriceComparisonAction {
  return { type: "start", shop };
}

/** A shop's refetch came back with `result`, at `at` on the browser's clock. */
export function done(shop: PricedShop, result: RefreshResult, at: number): PriceComparisonAction {
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
 * `readFailed` do.
 */
export function initialState({
  shops,
  now,
  pricesFailed = false,
}: {
  shops: PriceComparisonShop[];
  now: string;
  pricesFailed?: boolean;
}): PriceComparisonState {
  return {
    rows: shops.map(({ shop, productUrl, latest, readFailed }) => ({
      shop,
      productUrl,
      latest,
      pending: false,
      notice: null,
      readFailed: pricesFailed || readFailed === true,
    })),
    now: Date.parse(now),
    sessionEnded: false,
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
      // A new attempt clears what the last one said.
      return {
        ...state,
        sessionEnded: false,
        rows: state.rows.map((row) => (row.shop === action.shop ? { ...row, pending: true, notice: null } : row)),
        announcements: newRound ? [] : state.announcements,
      };
    }
    case "done": {
      const rows = state.rows.map((row) => (row.shop === action.shop ? settled(row, action.result) : row));
      const said = announcement(rows, action.at, action.shop, action.result);
      return {
        rows,
        now: action.at,
        sessionEnded: state.sessionEnded || action.result.kind === "session-ended",
        announcements: said === null ? state.announcements : [...state.announcements, said],
      };
    }
    case "tick":
      return { ...state, now: action.now };
  }
}

/**
 * What the live region says about one shop's answer, judged on the rows that answer made, at `now`: the new price, and
 * whether it's now the cheapest, as the rows mark it, or the text the row shows next to the last known price. Null for
 * an ended session, which the page's own alert announces with its link to sign in.
 */
function announcement(rows: ShopRow[], now: number, shop: PricedShop, result: RefreshResult): string | null {
  const { name } = SHOP_LABELS[shop];
  // The texts promise the last known price only when the row still shows one.
  const hasPrice = (rows.find((row) => row.shop === shop)?.latest?.offer ?? null) !== null;
  switch (result.kind) {
    case "price": {
      const cheapest = compareRows(rows, now).rows.some((row) => row.shop === shop && row.cheapest);
      return `${name}: ${formatPrice(result.offer.price)}${cheapest ? ", najtaniej" : ""}`;
    }
    case "missing":
      return `${name}: ${priceMissingText(hasPrice)}`;
    case "unavailable":
      return priceUnavailableText(name, result.reason, result.until, hasPrice);
    case "session-ended":
      return null;
  }
}

/**
 * A row once its refetch came back. Only the shop's own answer, a price or a missing item, replaces a stored price the
 * page couldn't read; an answer that came to nothing leaves the row saying the read failed.
 */
function settled(row: ShopRow, result: RefreshResult): ShopRow {
  const idle = { ...row, pending: false };
  switch (result.kind) {
    case "price": {
      const { offer, checkedAt } = result;
      return {
        ...idle,
        notice: null,
        readFailed: false,
        latest: { lastCheckedAt: checkedAt, lastStatus: "price", offer: { ...offer, pricedAt: checkedAt } },
      };
    }
    case "missing":
      // The price from before stays with its own age, and the row says the shop no longer returns the item.
      return {
        ...idle,
        notice: null,
        readFailed: false,
        latest: { lastCheckedAt: result.checkedAt, lastStatus: "missing", offer: row.latest?.offer ?? null },
      };
    case "unavailable":
      // Nothing was stored, so the last known price keeps its age.
      return {
        ...idle,
        notice: result.until === undefined ? { reason: result.reason } : { reason: result.reason, until: result.until },
      };
    case "session-ended":
      return idle;
  }
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
  return compareRows(state.rows, state.now);
}

/**
 * The rows compared at `now`: compareShops' order, marks and summary, unless some row's stored price couldn't be read.
 * That price may be the lowest, so then no row is marked cheapest, in the rows or in what screen readers hear, and a
 * summary that would name the cheapest names none. Each row keeps its order, its state and whether it's eligible.
 */
function compareRows(rows: readonly ShopRow[], now: number): Comparison<ShopRow> {
  const comparison = compareShops(rows, now);
  if (!rows.some((row) => row.readFailed)) {
    return comparison;
  }
  return {
    rows: comparison.rows.map((row) => ({ ...row, cheapest: false })),
    summary: comparison.summary.kind === "cheapest" ? { kind: "none" } : comparison.summary,
  };
}

/** A row as the island renders it, with its verdict. */
export type ComparedRow = Comparison<ShopRow>["rows"][number];

/** What the product's island knows of Natura's match beside its rows: whether the page couldn't read it. */
export interface NaturaRead {
  /** Natura's stored decision couldn't be read (naturaUnreadable), so a match it hides could name a lower price. */
  naturaUnreadable?: boolean;
}

/**
 * The verdict on the island's prices at the state's time (verdictOf), as comparisonOf compares them: `unread` while
 * some row's stored price couldn't be read, which a failed read of all the stored prices (`pricesFailed`) marks on
 * every row, and while Natura's match couldn't be read (`naturaUnreadable`). The price that couldn't be read may be
 * the lowest, so then the product area names no shop.
 */
export function verdictOfState(
  state: PriceComparisonState,
  { naturaUnreadable = false }: NaturaRead = {},
): PriceVerdict {
  return verdictOf(comparisonOf(state), state.now, naturaUnreadable || state.rows.some((row) => row.readFailed));
}

/**
 * The `window` event the product's island sends after each change of its rows, so the list beside the product can
 * bring its row's tag up to date: once it has hydrated, and as each shop's refetch starts and is answered. Its detail
 * is a PricesEventDetail.
 */
export const PRICES_EVENT = "drogeria:prices";

/**
 * What PRICES_EVENT carries: which product, and each of its shops as the island holds it: its latest check and whether
 * its price couldn't be read. The list's row recomputes its tag from them (rowTagOf); a Natura match that couldn't be
 * read goes as a Natura shop whose price couldn't be read.
 */
export interface PricesEventDetail {
  itemId: string;
  shops: RowShop[];
}

/**
 * The product's shops as the list's row compares them (RowShop), from the island's rows: each row's shop, its latest
 * check and whether its stored price couldn't be read, and, while Natura's match couldn't be read (`naturaUnreadable`),
 * Natura as a shop whose price couldn't be read, since that match could name a lower price. The island sends them with
 * PRICES_EVENT after each change of its rows, and the page judges the selected row's first tag by the rows the island
 * starts with, so the list beside the product and the product agree from the first paint.
 */
export function rowShopsOfIsland(rows: readonly ShopRow[], { naturaUnreadable = false }: NaturaRead = {}): RowShop[] {
  const shops: RowShop[] = rows.map(({ shop, latest, readFailed }) => ({ shop, latest, readFailed }));
  if (naturaUnreadable && !shops.some(({ shop }) => shop === "natura")) {
    shops.push({ shop: "natura", latest: null, readFailed: true });
  }
  return shops;
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

/** What the product area knows of Natura beside the prices: whether its match is still to be made. */
export interface NaturaContext {
  naturaUndecided: boolean;
}

/**
 * The product's hero, from its verdict: its tone, the line above the price, the shop or shops it names after "w", the
 * price, the line below it, and the sticker it wears. Stickers state facts only, "Tylko 1 sklep" (`one-shop`) and
 * "Stara cena" (`stale`), until FR-012 judges whether a price is good.
 */
export interface Hero {
  tone: "sun" | "plain" | "warn";
  eyebrow: string;
  shops: string | null;
  price: number | null;
  sub: string | null;
  sticker: "one-shop" | "stale" | null;
}

/**
 * The hero of a product whose prices came to `verdict`, reading every age at the time it was judged. The line below
 * the price gives how much less the cheapest price is and the age of the price it names (a tie's oldest), says when
 * Natura still waits for its match beside the only price, and warns that a stale price may be out of date.
 */
export function heroOf(verdict: PriceVerdict, { naturaUndecided }: NaturaContext): Hero {
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
        sticker: null,
      };
    case "only":
      return {
        tone: "plain",
        eyebrow: "Jedyna znana cena",
        shops: SHOP_LABELS[verdict.shop].in,
        price: verdict.price,
        sub: parts(
          checkedText(verdict.pricedAt, verdict.at),
          naturaUndecided ? `${SHOP_LABELS.natura.name} czeka na dopasowanie` : null,
        ),
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

/** The shops a verdict names: the cheapest shop or shops, or the one shop whose price it gives. */
function verdictShops(verdict: PriceVerdict): PricedShop[] {
  switch (verdict.kind) {
    case "cheapest":
      return verdict.shops;
    case "only":
    case "unavailable":
    case "stale":
      return [verdict.shop];
    case "unread":
    case "none":
      return [];
  }
}

/** The lowest 30-day low these shops report, or null when none does. */
function lowestOf(rows: readonly ShopPrice[], shops: readonly PricedShop[]): number | null {
  const lows = rows.flatMap(({ shop, latest }) => {
    const low = latest?.offer?.lowestPrice30d ?? null;
    return shops.includes(shop) && low !== null ? [low] : [];
  });
  return lows.length === 0 ? null : Math.min(...lows);
}

/** Where a marker's label sits above it: centred on it, ending at it (to its left) or starting at it (to its right). */
export type MarkerLabelSide = "center" | "end" | "start";

// How close two markers may come, in percent of the track, before their centred labels would run into each other: a
// label is about as wide as 30 % of a phone's track.
const CLOSE_MARKERS = 30;

/**
 * Where each marker's label sits, in the markers' order. A label is centred on its marker, unless its neighbour along
 * the track is closer than 30 %: then the one on the left ends at its marker and the one on the right starts at its
 * own, so equal or nearby prices never write over each other. A marker with close neighbours on both sides keeps its
 * label centred. Markers at the same place keep their order, left to right.
 */
export function markerLabelSides(markers: readonly Pick<TrackMarker, "x">[]): MarkerLabelSide[] {
  const along = markers.map(({ x }, index) => ({ x, index })).sort((a, b) => a.x - b.x || a.index - b.index);
  const turns = markers.map(() => ({ left: false, right: false }));
  for (let place = 1; place < along.length; place++) {
    if (along[place].x - along[place - 1].x < CLOSE_MARKERS) {
      turns[along[place - 1].index].left = true;
      turns[along[place].index].right = true;
    }
  }
  return turns.map(({ left, right }) => {
    if (left === right) {
      return "center";
    }
    return left ? "end" : "start";
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
 * What the price track's card says, beside the track or in its place: the only price asks for Natura's match while it
 * waits, and a stale price asks for a refresh. Null when there's nothing to say.
 */
export function trackHint(verdict: PriceVerdict, { naturaUndecided }: NaturaContext): string | null {
  if (verdict.kind === "only" && naturaUndecided) {
    return "Dopasuj produkt w Naturze, aby porównać ceny.";
  }
  if (verdict.kind === "stale") {
    return "Odśwież ceny, aby sprawdzić aktualną cenę.";
  }
  return null;
}

/**
 * When the product's prices were checked, as the caption under "Odśwież ceny" says it: the oldest check among the
 * shops that have one, so the caption never makes a price look fresher than it is. A shop never checked, or one whose
 * price couldn't be read, shows its own gap and is left out. A refetch that stores nothing keeps its shop's check.
 */
export function checkedCaption(rows: readonly Pick<ShopRow, "latest" | "readFailed">[], now: number): string {
  const age = checkedAge(rows, now);
  return age === null ? "jeszcze nie sprawdzono" : `sprawdzono ${age}`;
}

/**
 * How old checkedCaption's check is, on its own, as the phone's bottom bar writes it under "Sprawdzono": the age of
 * the oldest check among the shops that have one, or null when none has.
 */
export function checkedAge(rows: readonly Pick<ShopRow, "latest" | "readFailed">[], now: number): string | null {
  let oldest: string | null = null;
  for (const { latest, readFailed } of rows) {
    if (!readFailed && latest !== null && (oldest === null || checkTime(latest.lastCheckedAt) < checkTime(oldest))) {
      oldest = latest.lastCheckedAt;
    }
  }
  return oldest === null ? null : ageText(oldest, now);
}

/** A check's time in milliseconds; one that doesn't parse counts as the oldest, since nothing says it's recent. */
function checkTime(iso: string): number {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

const FAILED: RefreshResult = { kind: "unavailable", reason: "failed" };
const SESSION_ENDED: RefreshResult = { kind: "session-ended" };

/**
 * Asks the route to refetch one shop of the product, as JSON, which only the app's own pages can send. It never
 * throws: a request that fails or runs out of time is a failed refetch.
 */
export async function requestRefresh(
  itemId: string,
  shop: PricedShop,
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
      body: JSON.stringify({ itemId, shop }),
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
export type RefreshResponse = Pick<Response, "type" | "redirected" | "ok" | "headers" | "json">;

/**
 * What the route's response comes to. A signed-out request is redirected to the sign-in page, so a redirect, or a page
 * in place of JSON, means the session ended: with `redirect: "manual"` the redirect comes back opaque, and one followed
 * anyway comes back as the sign-in page. An error status, and an answer that isn't the route's own, is a failed
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
  if (!response.ok) {
    return FAILED;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return FAILED;
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
