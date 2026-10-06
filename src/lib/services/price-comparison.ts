import type { LatestPrice, PriceKey, ShopId, ShopMatchState, ShopOffer, WatchlistItem } from "@/types";

// The rules that name the cheapest shop today, in one place for the product page, its island and the list, so the
// server and the browser never disagree: when an item is fetched again, when a price no longer counts (too old, or its
// promotion over), which shops win, whether today's price is a good one, how prices and ages read, and what the list
// says and refreshes. It imports nothing server-only, because the island runs it in the browser too.

/** An item is fetched again once its last check is more than 15 minutes old, so reopening a page costs no request. */
export const REFETCH_AFTER_MS = 15 * 60 * 1000;
/** A price more than 24 hours old is stale: still shown with its age, but never named cheapest. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/**
 * The days a product's own price history covers, those in Poland before today, and how long the product has to be on
 * the list, in days of 24 hours, before that history counts: 30, as the shops' own lowest price of 30 days.
 */
export const HISTORY_WINDOW_DAYS = 30;
/** How many different days in Poland a product's own price history needs a price on before it counts. */
export const HISTORY_DAYS_NEEDED = 5;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// The calendar a promotion's end is read on: the shopper's own date in Poland, whatever the server's or the browser's.
const polishCalendar = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Every shop the code can match a watched product in, each with its label here and its adapter in the registry
 * (src/lib/services/shops/registry.ts), whether it's switched on or not.
 */
export const MATCHABLE_SHOPS = ["natura", "hebe", "super-pharm"] as const satisfies readonly ShopId[];

/** A shop the code can match a watched product in. */
export type MatchableShop = (typeof MATCHABLE_SHOPS)[number];

/**
 * The matchable shops that are switched on, in the pages' order: the only switch. The pages, the routes, the decision
 * and price-request schemas, the list and the island all read it, and the rules that take a list of shops default to
 * it, so a test can pass shops that aren't switched on yet.
 */
export const MATCHED_SHOPS = ["natura", "hebe", "super-pharm"] as const satisfies readonly MatchableShop[];

/** A matched shop that is switched on. */
export type MatchedShop = (typeof MATCHED_SHOPS)[number];

/** The shops whose prices are fetched and compared: Rossmann, where products are picked, and every matched shop. */
export const PRICED_SHOPS = ["rossmann", ...MATCHED_SHOPS] as const satisfies readonly ShopId[];

/** A shop whose prices are fetched and compared. */
export type PricedShop = (typeof PRICED_SHOPS)[number];

/** A shop the code knows, switched on or not: Rossmann and every matchable shop. The per-shop tables are keyed by it. */
export type KnownShop = "rossmann" | MatchableShop;

/**
 * The matched shop a page's parameter or a form's field names, or null for anything else: a shop that isn't switched
 * on, any other text, or a field that isn't text.
 */
export function parseMatchedShop(raw: FormDataEntryValue | null): MatchedShop | null {
  return MATCHED_SHOPS.find((shop) => shop === raw) ?? null;
}

/**
 * How the pages name a shop: on its own, after "w" as in "Tylko w Rossmannie", in the genitive as in "ceny Natury", as
 * the heading of its choice of candidates, and the site its prices come from.
 */
export interface ShopLabel {
  name: string;
  in: string;
  of: string;
  title: string;
  site: string;
}

export const SHOP_LABELS: Record<KnownShop, ShopLabel> = {
  rossmann: { name: "Rossmann", in: "w Rossmannie", of: "Rossmanna", title: "Rossmann", site: "rossmann.pl" },
  natura: { name: "Natura", in: "w Naturze", of: "Natury", title: "Drogerie Natura", site: "drogerienatura.pl" },
  hebe: { name: "Hebe", in: "w Hebe", of: "Hebe", title: "Hebe", site: "hebe.pl" },
  "super-pharm": {
    name: "Super-Pharm",
    in: "w Super-Pharmie",
    of: "Super-Pharmu",
    title: "Super-Pharm",
    site: "superpharm.pl",
  },
};

/** What a shop item's last check found, and its latest price: a `LatestPrice` without the item it's about. */
export type LatestCheck = Omit<LatestPrice, keyof PriceKey>;

/** A latest price, with when it was fetched. */
type PricedOffer = ShopOffer & { pricedAt: string };

/**
 * Where a shop's price stands: `none` without a price yet, `missing` when the last check found the item missing however
 * old the price is, `stale` when the price is more than 24 hours old or its promotion ended before today in Poland,
 * and `fresh` otherwise.
 */
export type PriceState = "none" | "missing" | "stale" | "fresh";

/**
 * True when the item has never been checked, its last check is more than 15 minutes old, or that check found a price
 * whose promotion has ended since, which is out of date however recent. `now` is a time in milliseconds, as
 * `Date.now()` gives it.
 */
export function needsRefetch(latest: LatestCheck | null, now: number): boolean {
  if (latest === null) {
    return true;
  }
  const age = now - Date.parse(latest.lastCheckedAt);
  // A time that doesn't parse counts as old.
  if (Number.isNaN(age) || age > REFETCH_AFTER_MS) {
    return true;
  }
  // A check that found the item missing waits its 15 minutes, whatever the price from before: asking again sooner
  // wouldn't bring that price back. So does a check made after the promotion had ended: it already holds the shop's
  // latest answer, and asking again sooner would only repeat it.
  return (
    latest.lastStatus === "price" &&
    promotionEnded(latest.offer, now) &&
    !promotionEnded(latest.offer, Date.parse(latest.lastCheckedAt))
  );
}

/**
 * Where a shop's price stands at `now`. A price exactly 24 hours old is still fresh, and so is a promotion's price on
 * the promotion's last day in Poland: a shop's end date may name the last day or the day after, so only the day after
 * it counts as ended.
 */
export function priceState(latest: LatestCheck | null, now: number): PriceState {
  if (!latest?.offer) {
    return "none";
  }
  if (latest.lastStatus === "missing") {
    return "missing";
  }
  const age = now - Date.parse(latest.offer.pricedAt);
  if (Number.isNaN(age) || age > STALE_AFTER_MS) {
    return "stale";
  }
  return promotionEnded(latest.offer, now) ? "stale" : "fresh";
}

/** True when the offer's promotion ended before today's date in Poland at `now`: its price is no longer the shop's. */
function promotionEnded(offer: Pick<ShopOffer, "promoEndsOn"> | null, now: number): boolean {
  const endsOn = offer?.promoEndsOn ?? null;
  // Both are `YYYY-MM-DD`, so comparing them as text compares the dates.
  return endsOn !== null && endsOn < polishDate(now);
}

/**
 * The date in Poland at `now`, as `YYYY-MM-DD`. It's read part by part, so no locale's order of parts matters. A shop
 * adapter writes a promotion's end with it too, so the end and the day it's compared with come from one calendar.
 */
export function polishDate(now: number): string {
  const parts = polishCalendar.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** A shop's row to compare: which shop, and its item's latest check, if any. */
export interface ShopPrice {
  shop: PricedShop;
  latest: LatestCheck | null;
}

/** How a row came out: where its price stands, whether it may be named cheapest, and whether it is. */
export interface ShopVerdict {
  state: PriceState;
  /** Fresh and orderable online: only such a price may be named cheapest. */
  eligible: boolean;
  cheapest: boolean;
}

/**
 * The comparison in a line: the cheapest shop or shops, with their price, the time its age counts from and how much
 * less it is than the next eligible shop, when there is one; the only shop there is; or no shop that can be named
 * cheapest.
 */
export type ComparisonSummary =
  | {
      kind: "cheapest";
      shops: PricedShop[];
      price: number;
      ageFrom: string;
      savings: { amount: number; than: PricedShop } | null;
    }
  | { kind: "only"; shop: PricedShop }
  | { kind: "none" };

/** The rows in their order, each with its verdict, and the summary. */
export interface Comparison<Row extends ShopPrice> {
  rows: (Row & ShopVerdict)[];
  summary: ComparisonSummary;
}

/** A row with what the comparison needs to know about it. Rows without a price count as 0 grosze. */
interface Judged<Row> {
  row: Row;
  state: PriceState;
  offer: PricedOffer | null;
  grosze: number;
  eligible: boolean;
}

/**
 * Orders the rows and marks the cheapest. Eligible rows, fresh and orderable online, come first by price, then the
 * other rows with a price, by price too, then the rows without one; rows that tie keep their order. Every eligible row
 * with the lowest price in grosze is cheapest, so a tie marks them all. A lone row is compared with nothing, so it's
 * never marked: its summary is `only`.
 */
export function compareShops<Row extends ShopPrice>(rows: readonly Row[], now: number): Comparison<Row> {
  const judged = rows.map((row) => judge(row, now));
  const ordered = [...judged].sort((a, b) => rank(a) - rank(b) || a.grosze - b.grosze);
  const lowest = rows.length > 1 ? ordered.find((entry) => entry.eligible)?.grosze : undefined;
  return {
    rows: ordered.map((entry) => ({
      ...entry.row,
      state: entry.state,
      eligible: entry.eligible,
      cheapest: entry.eligible && entry.grosze === lowest,
    })),
    summary: summarize(ordered, lowest),
  };
}

/** What a product's prices come to, before the time it's judged at: see PriceVerdict. */
type UntimedVerdict =
  | { kind: "unread" }
  | Extract<ComparisonSummary, { kind: "cheapest" }>
  | { kind: "only" | "unavailable" | "stale"; shop: PricedShop; price: number; pricedAt: string }
  | { kind: "none" };

/**
 * What a product's prices say, in one verdict for its row on the list, its page's hero and the list's live tag:
 *
 * - `unread`: a price of the product couldn't be read, and it may be the lowest, so no shop is named
 * - `cheapest`: the cheapest shop or shops, with their price, the time its age counts from and the savings, as
 *   compareShops gives them
 * - `only`: the product's one shop, with its fresh price that can be ordered online
 * - `unavailable`: no shop can be named, and some fresh price can't be ordered online: the lowest such
 * - `stale`: no shop can be named, and some price is out of date or its item gone from the shop: the lowest such
 * - `none`: no price at all
 *
 * `at` is the time it was judged at, in milliseconds, so everything it says reads its ages at that one moment.
 */
export type PriceVerdict = UntimedVerdict & { at: number };

/**
 * The verdict on a product's prices as compareShops compared them at `now`, where `unread` says whether any of its
 * prices couldn't be read. The first rule that applies wins, in PriceVerdict's order, so a price that can't be named
 * cheapest never wins over one that can, and a price that can't be read keeps every shop from being named.
 */
export function verdictOf(
  compared: { rows: readonly (ShopPrice & ShopVerdict)[]; summary: ComparisonSummary },
  now: number,
  unread: boolean,
): PriceVerdict {
  return { ...untimedVerdictOf(compared, unread), at: now };
}

function untimedVerdictOf(
  { rows, summary }: { rows: readonly (ShopPrice & ShopVerdict)[]; summary: ComparisonSummary },
  unread: boolean,
): UntimedVerdict {
  if (unread) {
    return { kind: "unread" };
  }
  if (summary.kind === "cheapest") {
    return summary;
  }
  // A lone row is compared with nothing: it's the only price, when it may be named at all.
  const lone = summary.kind === "only" ? lowestOffer(rows.filter((row) => row.eligible)) : null;
  if (lone !== null) {
    return { kind: "only", ...lone };
  }
  // A fresh price that isn't eligible is one that can't be ordered online.
  const unorderable = lowestOffer(rows.filter((row) => row.state === "fresh" && !row.eligible));
  if (unorderable !== null) {
    return { kind: "unavailable", ...unorderable };
  }
  const outOfDate = lowestOffer(rows.filter((row) => row.state === "stale" || row.state === "missing"));
  return outOfDate === null ? { kind: "none" } : { kind: "stale", ...outOfDate };
}

/** The lowest price among the rows that have one, with its shop and when it was fetched; the first of a tie. */
function lowestOffer(rows: readonly ShopPrice[]): { shop: PricedShop; price: number; pricedAt: string } | null {
  let lowest: { shop: PricedShop; price: number; pricedAt: string } | null = null;
  for (const { shop, latest } of rows) {
    const offer = latest?.offer ?? null;
    if (offer !== null && (lowest === null || toGrosze(offer.price) < toGrosze(lowest.price))) {
      lowest = { shop, price: offer.price, pricedAt: offer.pricedAt };
    }
  }
  return lowest;
}

function judge<Row extends ShopPrice>(row: Row, now: number): Judged<Row> {
  const state = priceState(row.latest, now);
  const offer = row.latest?.offer ?? null;
  return {
    row,
    state,
    offer,
    grosze: offer === null ? 0 : toGrosze(offer.price),
    eligible: state === "fresh" && offer?.available === true,
  };
}

/** Eligible rows first, then the other rows with a price, then the rows without one. */
function rank({ eligible, offer }: { eligible: boolean; offer: PricedOffer | null }): number {
  if (eligible) {
    return 0;
  }
  return offer === null ? 2 : 1;
}

/** The summary of rows already in their order, where `lowest` is the lowest eligible price in grosze, if compared. */
function summarize(ordered: readonly Judged<ShopPrice>[], lowest: number | undefined): ComparisonSummary {
  if (ordered.length === 1) {
    return { kind: "only", shop: ordered[0].row.shop };
  }
  const winners = ordered.flatMap((entry) =>
    entry.eligible && entry.offer !== null ? [{ shop: entry.row.shop, offer: entry.offer, grosze: entry.grosze }] : [],
  );
  const cheapest = winners.filter((winner) => winner.grosze === lowest);
  const first = cheapest.at(0);
  if (first === undefined) {
    return { kind: "none" };
  }
  const next = winners.find((winner) => winner.grosze !== lowest);
  return {
    kind: "cheapest",
    shops: cheapest.map((winner) => winner.shop),
    price: first.offer.price,
    // A tie's age is its oldest price's, so a shared line never looks fresher than one of its prices.
    ageFrom: oldest(cheapest.map((winner) => winner.offer.pricedAt)),
    savings: next === undefined ? null : { amount: (next.grosze - first.grosze) / 100, than: next.shop },
  };
}

/** The earliest of some times, as ISO timestamps. */
function oldest(times: string[]): string {
  return times.reduce((earliest, time) => (Date.parse(time) < Date.parse(earliest) ? time : earliest));
}

/** An amount in złoty as whole grosze, so comparing and subtracting prices never meets a floating-point remainder. */
function toGrosze(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * The shops a verdict names: the cheapest shop or shops, or the one shop whose price it gives. The price track draws
 * their 30-day low, and the judgement compares with it (judgementOf).
 */
export function verdictShops(verdict: PriceVerdict): PricedShop[] {
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

/** The lowest 30-day low the rows of these shops report, or null when none does. */
export function lowestOf(rows: readonly ShopPrice[], shops: readonly PricedShop[]): number | null {
  const lows = rows.flatMap(({ shop, latest }) => {
    const low = latest?.offer?.lowestPrice30d ?? null;
    return shops.includes(shop) && low !== null ? [low] : [];
  });
  return lows.length === 0 ? null : Math.min(...lows);
}

/**
 * Whether today's price is a good one (FR-012): `good` below what it was compared with, and `ordinary` equal to it or
 * above it, each with which comparison was made (`basis`), the product's own price history or its shops' declared
 * 30-day low, and the price it was compared with (`baseline`); or `none` when there was nothing to compare with,
 * naming the shops whose price it would have judged.
 */
export type PriceJudgement =
  { kind: "good" | "ordinary"; basis: "shop" | "history"; baseline: number } | { kind: "none"; shops: KnownShop[] };

/**
 * Whether the price a verdict names is a good one, by the owner's rule of 2026-10-06, for a product added to the list
 * at `addedAt`, an ISO timestamp, judged at `now`, in milliseconds. Only a cheapest or an only price is judged, and
 * every other verdict gets null. `rows` are the product's priced shops the verdict was made from. The price is compared
 * with the first of these there is:
 *
 * - the product's own history, once it's enough: the product was added at least 30 days of 24 hours before `now`, the
 *   rows' histories hold prices on at least 5 different days, a day seen in several shops counting once, and some row
 *   has a history low. The comparison is the lowest history low of every row, whichever shop is the cheapest today.
 * - the lowest 30-day low the verdict's shops declare, which are every shop of a tie and no other shop
 * - nothing: `none`, naming the verdict's shops
 *
 * A price below the comparison in grosze is `good`, and one equal to it or above it is `ordinary`. A row without a
 * history adds no day and no low. An `addedAt` that doesn't parse counts as too recent, as an age that doesn't parse
 * counts as old.
 */
export function judgementOf(
  verdict: PriceVerdict,
  rows: readonly ShopPrice[],
  addedAt: string,
  now: number,
): PriceJudgement | null {
  if (verdict.kind !== "cheapest" && verdict.kind !== "only") {
    return null;
  }
  const shops = verdictShops(verdict);
  const history = historyBaseline(rows, addedAt, now);
  const baseline = history ?? lowestOf(rows, shops);
  if (baseline === null) {
    return { kind: "none", shops };
  }
  return {
    kind: toGrosze(verdict.price) < toGrosze(baseline) ? "good" : "ordinary",
    basis: history === null ? "shop" : "history",
    baseline,
  };
}

/**
 * The lowest history low of the rows, once their history is enough to judge a price by (judgementOf), or null: the
 * product was added at least HISTORY_WINDOW_DAYS days of 24 hours before `now`, the rows hold prices on at least
 * HISTORY_DAYS_NEEDED different days between them, and some row has a low.
 */
function historyBaseline(rows: readonly ShopPrice[], addedAt: string, now: number): number | null {
  const histories = rows.flatMap(({ latest }) => (latest?.history ? [latest.history] : []));
  // A day seen in two shops is one day.
  const days = new Set(histories.flatMap((history) => history.days));
  const lows = histories.flatMap(({ low }) => (low === null ? [] : [low]));
  // A time that doesn't parse gives NaN, which is never long enough ago.
  const listedLongEnough = now - Date.parse(addedAt) >= HISTORY_WINDOW_DAYS * DAY_MS;
  return listedLongEnough && days.size >= HISTORY_DAYS_NEEDED && lows.length > 0 ? Math.min(...lows) : null;
}

/**
 * How long ago `iso` was, as the pages show a price's age: "przed chwilą" under a minute, then minutes, hours,
 * "wczoraj" under 48 hours, and days. A time ahead of `now`, as a clock set a little ahead gives, reads as just now.
 */
export function ageText(iso: string, now: number): string {
  const age = now - Date.parse(iso);
  if (Number.isNaN(age)) {
    return "czas nieznany";
  }
  if (age < MINUTE_MS) {
    return "przed chwilą";
  }
  if (age < HOUR_MS) {
    return `${Math.floor(age / MINUTE_MS)} min temu`;
  }
  if (age < DAY_MS) {
    return `${Math.floor(age / HOUR_MS)} godz. temu`;
  }
  if (age < 2 * DAY_MS) {
    return "wczoraj";
  }
  return `${Math.floor(age / DAY_MS)} dni temu`;
}

const pln = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

/** An amount in złoty as the pages show it, such as "16,99 zł". */
export function formatPrice(amount: number): string {
  return pln.format(amount);
}

/** An amount's złote and grosze as digits, apart, as a shelf label draws them. */
export interface PriceParts {
  zlote: string;
  grosze: string;
}

/**
 * An amount in złoty split as the price labels draw it: its złote, grouped with the no-break space formatPrice writes
 * ("12 345"), and its grosze ("67"). It reads the parts formatPrice's own formatter writes, so both round alike.
 */
export function priceParts(amount: number): PriceParts {
  let zlote = "";
  let grosze = "";
  for (const { type, value } of pln.formatToParts(amount)) {
    if (type === "integer" || type === "group" || type === "minusSign") {
      zlote += value;
    } else if (type === "fraction") {
      grosze += value;
    }
  }
  return { zlote, grosze };
}

/**
 * A date such as "2026-09-30" as the pages show a promotion's end, "30.09". It's a calendar date without a time, so no
 * time zone can move it to another day; anything else is shown as it came.
 */
export function formatDay(isoDate: string): string {
  const date = /^\d{4}-(\d{2})-(\d{2})$/.exec(isoDate);
  return date === null ? isoDate : `${date[2]}.${date[1]}`;
}

/**
 * The day an instant fell on in Poland, as formatDay writes a date: "20.09" for a product added at 10:00 on 20
 * September. It reads the instant on the shopper's own calendar, as a promotion's end is read, so the server and the
 * browser write the same day. Null for a time that doesn't parse.
 */
export function formatDayOf(iso: string): string | null {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : formatDay(polishDate(time));
}

/**
 * A shop item a watched product's prices come from: a shop whose prices are fetched, and the shop's own id for it. A
 * rule given a test's list of shops gives that list's shops too.
 */
export interface PricedKey<Shop extends KnownShop = PricedShop> extends PriceKey {
  shop: Shop;
}

/** A priced shop item with its latest check, if any: a row the comparison judges, and an item a refresh may fetch. */
export type PricedItem<Shop extends KnownShop = PricedShop> = PricedKey<Shop> & { latest: LatestCheck | null };

/**
 * A product's decision in one shop, as its prices read it: a match names the shop's item its prices there come from,
 * and any other decision names none. The list's decisions (ShopMatchState) read this way as they are.
 */
export type PriceDecision = { shop: ShopId } & (
  { state: "matched"; shopItemId: string } | { state: "unmatched" | "not_found" }
);

/**
 * The shop items a watched product's prices come from, in the pages' order: its own item, where it was picked, when
 * that's Rossmann, then the matched item of each of `shops` whose decision is a match, in the order of `shops`. A
 * decision that isn't a match, or one in any other shop, adds nothing. `shops` are the matched shops unless a test
 * names others. Its type names the matched shops' own list beside any other, so the default needs no cast, and the
 * keys' shops are then the priced shops; the result infers nothing (NoInfer), so a typed variable can't widen them.
 */
export function productPriceKeys<Shop extends MatchableShop = MatchedShop>(
  product: { source: ShopId; sourceItemId: string },
  decisions: readonly PriceDecision[],
  shops: readonly Shop[] | typeof MATCHED_SHOPS = MATCHED_SHOPS,
): PricedKey<PricedShop | NoInfer<Shop>>[] {
  const keys: PricedKey<PricedShop | Shop>[] = [];
  if (product.source === "rossmann") {
    keys.push({ shop: "rossmann", shopItemId: product.sourceItemId });
  }
  for (const shop of shops) {
    // A product has one decision per shop.
    const decision = decisions.find((each) => each.shop === shop);
    if (decision?.state === "matched") {
      keys.push({ shop, shopItemId: decision.shopItemId });
    }
  }
  return keys;
}

/**
 * Each listed product's priced shop items with their latest checks, by the product's id: what its row on the list
 * compares, and what the list's refresh picks the stale items from. `matches` are the list's decisions, of which a
 * match in one of `shops` adds its item (productPriceKeys), and `prices` the latest states the user can see; an item
 * without one was never checked. `shops` are the matched shops unless a test names others, typed as productPriceKeys
 * types them.
 */
export function listPricedItems<Shop extends MatchableShop = MatchedShop>(
  products: readonly Pick<WatchlistItem, "id" | "source" | "sourceItemId">[],
  matches: readonly ShopMatchState[],
  prices: readonly LatestPrice[],
  shops: readonly Shop[] | typeof MATCHED_SHOPS = MATCHED_SHOPS,
): Map<string, PricedItem<PricedShop | NoInfer<Shop>>[]> {
  const decisions = new Map<string, ShopMatchState[]>();
  for (const match of matches) {
    const own = decisions.get(match.watchlistItemId);
    if (own === undefined) {
      decisions.set(match.watchlistItemId, [match]);
    } else {
      own.push(match);
    }
  }
  const latest = new Map(prices.map((price) => [keyText(price), price] as const));
  const items = new Map<string, PricedItem<PricedShop | Shop>[]>();
  for (const product of products) {
    const keys = productPriceKeys(product, decisions.get(product.id) ?? [], shops);
    const withLatest = keys.map((key) => ({ ...key, latest: latest.get(keyText(key)) ?? null }));
    items.set(product.id, withLatest);
  }
  return items;
}

/**
 * What the list's "Odśwież ceny" fetches: every priced item whose last check is more than 15 minutes old, once each,
 * the items never checked first and then the oldest check first, so the gate's cap cuts off the latest checks. Items
 * that tie keep their order.
 */
export function staleTargets(entries: readonly PricedItem<KnownShop>[], now: number): PriceKey[] {
  const stale = entries.filter((entry) => needsRefetch(entry.latest, now)).sort(byOldestCheck);
  const seen = new Set<string>();
  const targets: PriceKey[] = [];
  for (const { shop, shopItemId } of stale) {
    const text = keyText({ shop, shopItemId });
    // Two products matched to the same item fetch it once.
    if (!seen.has(text)) {
      seen.add(text);
      targets.push({ shop, shopItemId });
    }
  }
  return targets;
}

/** Orders items by their last check, the items never checked first. */
function byOldestCheck(a: PricedItem<KnownShop>, b: PricedItem<KnownShop>): number {
  const first = lastCheckTime(a.latest);
  const second = lastCheckTime(b.latest);
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}

/** When an item was last checked, in milliseconds. Never, or a time that doesn't parse, comes before any time. */
function lastCheckTime(latest: LatestCheck | null): number {
  const time = latest === null ? Number.NaN : Date.parse(latest.lastCheckedAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * One text per shop item, to find an item's latest state, to match stored rows to the items asked for, and to take each
 * item once. No shop id holds a "/", so the first one ends the shop. It lives here, where the island can import it, and
 * the server's modules import it from here too.
 */
export function keyText({ shop, shopItemId }: PriceKey): string {
  return `${shop}/${shopItemId}`;
}

const NO_PRICES_YET = "Jeszcze bez cen. Otwórz produkt, aby je pobrać.";

/**
 * What a price that couldn't be read says in its place, on the product's page and on the list alike: never that it
 * was never fetched.
 */
export const PRICE_UNREAD_TEXT = "Nie udało się wczytać ceny.";

/**
 * A watched product's comparison as its row on the list says it, in one line with the price's age, following the
 * product's verdict (verdictOf):
 *
 * - that a price couldn't be read, when `unread` says one couldn't
 * - the cheapest shop or shops and their price, how much less it is than the next shop that can be compared, and why
 *   each other shop can't be: its price is out of date ("cena nieaktualna"), it can't be ordered online, or it has no
 *   price
 * - the only shop's price, marked "nieaktualna" when it's out of date or the shop no longer returns the item, or
 *   "niedostępny online"
 * - the lowest price that can't be ordered online, when no shop's price can be named cheapest and some fresh one can't
 *   be ordered, and why each other shop can't be compared
 * - that the prices are out of date, when no shop's price can be named cheapest
 * - that no price has been fetched yet, when no shop has been checked, or else which shops don't return the product
 *   and which haven't been checked
 *
 * `summary` and `rows` are what compareShops gave at `now`.
 */
export function listSummaryText(
  summary: ComparisonSummary,
  rows: readonly (ShopPrice & ShopVerdict)[],
  now: number,
  unread = false,
): string {
  const verdict = verdictOf({ rows, summary }, now, unread);
  switch (verdict.kind) {
    case "unread":
      return PRICE_UNREAD_TEXT;
    case "cheapest": {
      const shops = namesOf(verdict.shops);
      const price = formatPrice(verdict.price);
      // A tie names several shops, so a comma sets their price apart.
      const head = verdict.shops.length > 1 ? `Najtaniej: ${shops}, ${price}` : `Najtaniej: ${shops} ${price}`;
      const savings = verdict.savings === null ? "" : `, ${savingsText(verdict.savings)}`;
      const others = whyEachNot(rows.filter((row) => !row.eligible));
      return [`${head}${savings}`, ageText(verdict.ageFrom, now), ...others].join(" · ");
    }
    case "only":
    case "unavailable":
    case "stale": {
      // The only shop's line says why its price can't be named, when it can't.
      if (verdict.kind === "only" || rows.length === 1) {
        const line = [
          `Tylko ${SHOP_LABELS[verdict.shop].in}: ${formatPrice(verdict.price)}`,
          ageText(verdict.pricedAt, now),
        ];
        if (verdict.kind === "stale") {
          line.push("nieaktualna");
        } else if (verdict.kind === "unavailable") {
          line.push("niedostępny online");
        }
        return line.join(" · ");
      }
      if (verdict.kind === "stale") {
        return "Ceny nieaktualne. Odśwież ceny lub otwórz produkt.";
      }
      const head = `Niedostępny online: ${SHOP_LABELS[verdict.shop].name} ${formatPrice(verdict.price)}`;
      const others = whyEachNot(rows.filter((row) => row.shop !== verdict.shop));
      return [head, ageText(verdict.pricedAt, now), ...others].join(" · ");
    }
    case "none":
      return rows.every((row) => row.latest === null) ? NO_PRICES_YET : noPriceLine(rows);
  }
}

/** Why each of these shops' prices can't be named cheapest, as a line lists them: "Rossmann: cena nieaktualna". */
function whyEachNot(rows: readonly (ShopPrice & ShopVerdict)[]): string[] {
  return rows.map((row) => `${SHOP_LABELS[row.shop].name}: ${whyNotCompared(row.state)}`);
}

/**
 * The line of a product without any price once some shop was checked: which shops answered without it, and which
 * haven't been checked yet, so opening the product can't look like it would fetch a price the shop doesn't have.
 */
function noPriceLine(rows: readonly ShopPrice[]): string {
  const shops = rows.map(
    ({ shop, latest }) =>
      `${SHOP_LABELS[shop].name}: ${latest === null ? "jeszcze nie sprawdzono" : "nie zwraca tego produktu"}`,
  );
  return ["Brak ceny online", ...shops].join(" · ");
}

/** How much less the cheapest price is than the next shop's, as the pages say it: "o 4,00 zł taniej niż Rossmann". */
export function savingsText(savings: { amount: number; than: PricedShop }): string {
  return `o ${formatPrice(savings.amount)} taniej niż ${SHOP_LABELS[savings.than].name}`;
}

/**
 * Parts as a line lists them, joined the Polish way: "a", "a i b" and "a, b i c", and nothing for none. The shops'
 * names (namesOf) and the sites under the list (watchlist-rows.ts) are joined by it.
 */
export function listJoin(parts: readonly string[]): string {
  const last = parts.at(-1) ?? "";
  return parts.length < 2 ? last : `${parts.slice(0, -1).join(", ")} i ${last}`;
}

/**
 * Shops as a line lists them (listJoin), by their names or after "w": "Natura", "Rossmann i Natura", "Rossmann, Hebe i
 * Natura", or "w Rossmannie i w Naturze". Any shop the code knows has a label, so a rule can name a matched shop that
 * isn't priced yet.
 */
export function namesOf(shops: readonly KnownShop[], label: "name" | "in" = "name"): string {
  return listJoin(shops.map((shop) => SHOP_LABELS[shop][label]));
}

/**
 * How long ago `iso` was, on ageText's steps, as it reads after "sprzed", such as "cena sprzed 2 dni": "chwili", then
 * minutes, hours, "doby" under 48 hours, and days. A time ahead of `now` reads as a moment ago; null for a time that
 * doesn't parse.
 */
export function sinceText(iso: string, now: number): string | null {
  const age = now - Date.parse(iso);
  if (Number.isNaN(age)) {
    return null;
  }
  if (age < MINUTE_MS) {
    return "chwili";
  }
  if (age < HOUR_MS) {
    return `${Math.floor(age / MINUTE_MS)} min`;
  }
  if (age < DAY_MS) {
    return `${Math.floor(age / HOUR_MS)} godz.`;
  }
  if (age < 2 * DAY_MS) {
    return "doby";
  }
  return `${Math.floor(age / DAY_MS)} dni`;
}

/**
 * Why a shop's price can't be named cheapest, as a line says it after the shop's name: an item the shop no longer
 * returns counts as out of date, and a fresh price that can't win is one that can't be ordered online.
 */
function whyNotCompared(state: PriceState): string {
  switch (state) {
    case "none":
      return "brak ceny";
    case "stale":
    case "missing":
      return "cena nieaktualna";
    case "fresh":
      return "niedostępny online";
  }
}
