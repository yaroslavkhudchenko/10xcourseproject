import type { LatestPrice, PriceKey, ShopId, ShopOffer } from "@/types";

// The rules that name the cheapest shop today, in one place for the product page, its island and the list, so the
// server and the browser never disagree: when an item is fetched again, when a price is too old to count, which shops
// win, and how prices and ages read. It imports nothing server-only, because the island runs it in the browser too.

/** An item is fetched again once its last check is more than 15 minutes old, so reopening a page costs no request. */
export const REFETCH_AFTER_MS = 15 * 60 * 1000;
/** A price more than 24 hours old is stale: still shown with its age, but never named cheapest. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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
 * old the price is, `stale` when the price is more than 24 hours old, and `fresh` otherwise.
 */
export type PriceState = "none" | "missing" | "stale" | "fresh";

/**
 * True when the item has never been checked, or its last check is more than 15 minutes old. `now` is a time in
 * milliseconds, as `Date.now()` gives it.
 */
export function needsRefetch(latest: LatestCheck | null, now: number): boolean {
  if (latest === null) {
    return true;
  }
  const age = now - Date.parse(latest.lastCheckedAt);
  // A time that doesn't parse counts as old.
  return Number.isNaN(age) || age > REFETCH_AFTER_MS;
}

/** Where a shop's price stands at `now`. A price exactly 24 hours old is still fresh. */
export function priceState(latest: LatestCheck | null, now: number): PriceState {
  if (!latest?.offer) {
    return "none";
  }
  if (latest.lastStatus === "missing") {
    return "missing";
  }
  const age = now - Date.parse(latest.offer.pricedAt);
  return Number.isNaN(age) || age > STALE_AFTER_MS ? "stale" : "fresh";
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
