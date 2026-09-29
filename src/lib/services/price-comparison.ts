import type { LatestPrice, PriceKey, ShopId, ShopMatchState, ShopOffer, WatchlistItem } from "@/types";

// The rules that name the cheapest shop today, in one place for the product page, its island and the list, so the
// server and the browser never disagree: when an item is fetched again, when a price no longer counts (too old, or its
// promotion over), which shops win, how prices and ages read, and what the list says and refreshes. It imports nothing
// server-only, because the island runs it in the browser too.

/** An item is fetched again once its last check is more than 15 minutes old, so reopening a page costs no request. */
export const REFETCH_AFTER_MS = 15 * 60 * 1000;
/** A price more than 24 hours old is stale: still shown with its age, but never named cheapest. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

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

/** The shops whose prices are fetched and compared. */
export const PRICED_SHOPS = ["rossmann", "natura"] as const satisfies readonly ShopId[];

/** A shop whose prices are fetched and compared. */
export type PricedShop = (typeof PRICED_SHOPS)[number];

/** How the pages name a shop: on its own, after "w" as in "Tylko w Rossmannie", and the site its prices come from. */
export interface ShopLabel {
  name: string;
  in: string;
  site: string;
}

export const SHOP_LABELS: Record<PricedShop, ShopLabel> = {
  rossmann: { name: "Rossmann", in: "w Rossmannie", site: "rossmann.pl" },
  natura: { name: "Natura", in: "w Naturze", site: "drogerienatura.pl" },
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

/** The date in Poland at `now`, as `YYYY-MM-DD`. It's read part by part, so no locale's order of parts matters. */
function polishDate(now: number): string {
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

/**
 * A date such as "2026-09-30" as the pages show a promotion's end, "30.09". It's a calendar date without a time, so no
 * time zone can move it to another day; anything else is shown as it came.
 */
export function formatDay(isoDate: string): string {
  const date = /^\d{4}-(\d{2})-(\d{2})$/.exec(isoDate);
  return date === null ? isoDate : `${date[2]}.${date[1]}`;
}

/** A shop item a watched product's prices come from: a shop whose prices are fetched, and the shop's own id for it. */
export interface PricedKey extends PriceKey {
  shop: PricedShop;
}

/** A priced shop item with its latest check, if any: a row the comparison judges, and an item a refresh may fetch. */
export type PricedItem = PricedKey & ShopPrice;

/**
 * The shop items a watched product's prices come from, in the pages' order: its own item, where it was picked, when
 * that's Rossmann, then its match's SKU in Natura, when it has one.
 */
export function productPriceKeys(
  product: { source: ShopId; sourceItemId: string },
  naturaSku: string | null,
): PricedKey[] {
  const keys: PricedKey[] = [];
  if (product.source === "rossmann") {
    keys.push({ shop: "rossmann", shopItemId: product.sourceItemId });
  }
  if (naturaSku !== null) {
    keys.push({ shop: "natura", shopItemId: naturaSku });
  }
  return keys;
}

/**
 * Each listed product's priced shop items with their latest checks, by the product's id: what its row on the list
 * compares, and what the list's refresh picks the stale items from. `matches` are the list's decisions, of which only
 * a match in Natura adds an item, and `prices` the latest states the user can see; an item without one was never
 * checked.
 */
export function listPricedItems(
  products: readonly Pick<WatchlistItem, "id" | "source" | "sourceItemId">[],
  matches: readonly ShopMatchState[],
  prices: readonly LatestPrice[],
): Map<string, PricedItem[]> {
  const naturaSkus = new Map<string, string>();
  for (const match of matches) {
    if (match.shop === "natura" && match.state === "matched") {
      naturaSkus.set(match.watchlistItemId, match.shopItemId);
    }
  }
  const latest = new Map(prices.map((price) => [keyText(price), price] as const));
  const items = new Map<string, PricedItem[]>();
  for (const product of products) {
    const keys = productPriceKeys(product, naturaSkus.get(product.id) ?? null);
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
export function staleTargets(entries: readonly PricedItem[], now: number): PriceKey[] {
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
function byOldestCheck(a: PricedItem, b: PricedItem): number {
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
 * A watched product's comparison as its row on the list says it, in one line with the price's age:
 *
 * - the cheapest shop or shops and their price, how much less it is than the next shop that can be compared, and why
 *   each other shop can't be: its price is out of date ("cena nieaktualna"), it can't be ordered online, or it has no
 *   price
 * - the only shop's price, marked "nieaktualna" when it's out of date or the shop no longer returns the item, or
 *   "niedostępny online"
 * - that no shop's price can be named cheapest, or that no price has been fetched yet
 *
 * `summary` and `rows` are what compareShops gave at `now`.
 */
export function listSummaryText(
  summary: ComparisonSummary,
  rows: readonly (ShopPrice & ShopVerdict)[],
  now: number,
): string {
  switch (summary.kind) {
    case "cheapest": {
      const shops = namesOf(summary.shops);
      const price = formatPrice(summary.price);
      // A tie names several shops, so a comma sets their price apart.
      const head = summary.shops.length > 1 ? `Najtaniej: ${shops}, ${price}` : `Najtaniej: ${shops} ${price}`;
      const savings =
        summary.savings === null
          ? ""
          : `, o ${formatPrice(summary.savings.amount)} taniej niż ${SHOP_LABELS[summary.savings.than].name}`;
      const others = rows
        .filter((row) => !row.eligible)
        .map((row) => `${SHOP_LABELS[row.shop].name}: ${whyNotCompared(row.state)}`);
      return [`${head}${savings}`, ageText(summary.ageFrom, now), ...others].join(" · ");
    }
    case "only": {
      const row = rows.find((candidate) => candidate.shop === summary.shop);
      const offer = row?.latest?.offer ?? null;
      if (row === undefined || offer === null) {
        return NO_PRICES_YET;
      }
      const line = [`Tylko ${SHOP_LABELS[row.shop].in}: ${formatPrice(offer.price)}`, ageText(offer.pricedAt, now)];
      if (row.state === "stale" || row.state === "missing") {
        line.push("nieaktualna");
      } else if (!offer.available) {
        line.push("niedostępny online");
      }
      return line.join(" · ");
    }
    case "none":
      return rows.every((row) => row.state === "none")
        ? NO_PRICES_YET
        : "Ceny nieaktualne. Odśwież ceny lub otwórz produkt.";
  }
}

/** Shop names as a line lists them: "Natura", "Rossmann i Natura", "Rossmann, Hebe i Natura". */
function namesOf(shops: readonly PricedShop[]): string {
  const names = shops.map((shop) => SHOP_LABELS[shop].name);
  const last = names.pop() ?? "";
  return names.length === 0 ? last : `${names.join(", ")} i ${last}`;
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
