import type { SupabaseClient } from "@supabase/supabase-js";
import { LIST_PRICES_PARAM, PRICES_PARAM } from "@/lib/notices";
import {
  keyText,
  MATCHABLE_SHOPS,
  PRICED_SHOPS,
  type KnownShop,
  type MatchableShop,
} from "@/lib/services/price-comparison";
import { recordPriceChecks, type PriceRecordResult } from "@/lib/services/prices";
import type { ShopGate } from "@/lib/services/shop-gate";
import { SHOP_ADAPTERS } from "@/lib/services/shops/registry";
import { fetchRossmannPrice } from "@/lib/services/shops/rossmann";
import { isRefusal } from "@/lib/services/shops/shop-outcome";
import { parseWatchlistItemId } from "@/lib/services/watchlist";
import { filterHref, parseListFilter, type ListFilter } from "@/lib/services/watchlist-rows";
import type { PriceCheck, PriceKey, ShopId, ShopUnavailable } from "@/types";

// Refreshing pinned items' prices, for a product's page and for the list: every request goes through the gate, and
// every price or missing item the shops answer with is stored as a shared observation (prices.ts).

/** What a refresh came to: each shop item's check, in the order the items were given, and how storing them went. */
export interface PriceRefresh {
  results: { key: PriceKey; check: PriceCheck }[];
  saved: PriceRecordResult;
}

/** One shop's part of a refresh: its checks by its own id for each item, and how storing them went. */
interface ShopRefresh {
  shop: KnownShop;
  checks: Map<string, PriceCheck>;
  saved: PriceRecordResult;
}

/**
 * Fetches a shop's pinned items by its own ids through the gate, one request at a time: a check for every id given.
 * Once the shop refuses, its remaining ids get that same answer with no request and no reservation. It never throws.
 */
export type PriceFetcher = (gate: ShopGate, ids: string[]) => Promise<Map<string, PriceCheck>>;

// Each matchable shop's adapter's fetcher, 50 ids per request, taken from the registry (registry.ts), so a shop the
// registry gains needs no line here. Object.fromEntries can't say which keys it gives; they're every matchable shop's,
// so the cast holds.
const MATCHABLE_FETCHERS = Object.fromEntries(
  MATCHABLE_SHOPS.map((shop) => [shop, SHOP_ADAPTERS[shop].fetchPrices] as const),
) as Record<MatchableShop, PriceFetcher>;

/** Each shop's price fetcher: Rossmann's, one product per request (fetchRossmannPrices), and each matchable shop's. */
export const PRICE_FETCHERS: Record<KnownShop, PriceFetcher> = { rossmann: fetchRossmannPrices, ...MATCHABLE_FETCHERS };

/**
 * Fetches the current offer of each shop item through the gate, asking every shop of `shops` at once, each through
 * its own fetcher (PRICE_FETCHERS): the priced shops unless a test names others. Each shop's prices and missing items
 * are stored with an insert of their own as soon as that shop is done, so a refresh cut short keeps what the shops
 * have already answered; an item the shop gave no answer for stores nothing and keeps its last price with its age.
 * `saved` is `failed` when an insert failed, `saved` when every insert sent was stored, and `none` when there was
 * nothing to store.
 *
 * Within a shop the requests go one at a time. Rossmann has no batch route, so it's asked one product per request in
 * the order given: callers pass the oldest check first, and the cap cuts off the newest. A matched shop's items are
 * asked for together, 50 per request. Once a shop refuses, busy under the cap, paused or stopped, its remaining items
 * get that same answer with no request and no reservation, while the other shops go on. Each item is checked once,
 * however often it's given, and an item in a shop outside `shops` is `unavailable` with no request.
 */
export async function refreshPrices(
  gate: ShopGate,
  supabase: SupabaseClient,
  targets: PriceKey[],
  shops: readonly KnownShop[] = PRICED_SHOPS,
): Promise<PriceRefresh> {
  const keys = distinct(targets);
  const idsIn = (shop: ShopId) => keys.filter((key) => key.shop === shop).map((key) => key.shopItemId);
  // Each shop once, so no shop is ever asked twice at the same time.
  const refreshed = await Promise.all(
    [...new Set(shops)].map((shop) =>
      PRICE_FETCHERS[shop](gate, idsIn(shop)).then((checks) => stored(supabase, shop, checks)),
    ),
  );
  const fetched = new Map<ShopId, Map<string, PriceCheck>>(refreshed.map(({ shop, checks }) => [shop, checks]));
  const results = keys.map((key) => ({ key, check: fetched.get(key.shop)?.get(key.shopItemId) ?? notFetched() }));
  return { results, saved: overall(refreshed.map(({ saved }) => saved)) };
}

/**
 * Asks Rossmann for each product's offer, one request at a time in the order given. Once Rossmann refuses, the
 * products after it get that same answer with no request and no reservation. A failed request, or an answer that
 * can't be read, doesn't stop the next one.
 */
async function fetchRossmannPrices(gate: ShopGate, ids: string[]): Promise<Map<string, PriceCheck>> {
  const checks = new Map<string, PriceCheck>();
  let refusal: ShopUnavailable | null = null;
  for (const id of ids) {
    if (refusal !== null) {
      checks.set(id, { ...refusal });
      continue;
    }
    const check = await fetchRossmannPrice(gate, id);
    if (isRefusal(check)) {
      refusal = check;
    }
    checks.set(id, check);
  }
  return checks;
}

/** One shop's checks, stored once the shop is done: recordPriceChecks leaves out the items it gave no answer for. */
async function stored(
  supabase: SupabaseClient,
  shop: KnownShop,
  checks: Map<string, PriceCheck>,
): Promise<ShopRefresh> {
  const rows = [...checks].map(([shopItemId, check]) => ({ key: { shop, shopItemId }, check }));
  return { shop, checks, saved: await recordPriceChecks(supabase, rows) };
}

/** How storing went for the refresh as a whole, from each shop's insert. */
function overall(results: PriceRecordResult[]): PriceRecordResult {
  if (results.includes("failed")) {
    return "failed";
  }
  // A shop with nothing to store sent no insert, which neither saves nor fails anything.
  return results.includes("saved") ? "saved" : "none";
}

/** The shop items once each, in the order they first appear. */
function distinct(targets: PriceKey[]): PriceKey[] {
  const seen = new Set<string>();
  return targets.filter((key) => {
    const text = keyText(key);
    if (seen.has(text)) {
      return false;
    }
    seen.add(text);
    return true;
  });
}

/** The check of an item in a shop the refresh doesn't fetch: one outside its list of shops. */
function notFetched(): PriceCheck {
  return { kind: "unavailable", reason: "failed" };
}

/**
 * The codes the refresh form's route redirects with, which each page turns into its own text: `?prices=<code>` after a
 * product's own refresh (productRefreshBackTo), and `?list-prices=<code>` after the list's (listRefreshBackTo).
 */
export const PRICE_REFRESH_CODES = ["done", "partial", "none", "failed"] as const;

/**
 * What a refresh from the form came to: `done` when every item got a price or a missing check and all were stored,
 * `partial` when some got no answer, a shop's item couldn't be told or the answers couldn't be stored, `none` when
 * nothing needed refreshing, and `failed` when no item got an answer.
 */
export type PriceRefreshCode = (typeof PRICE_REFRESH_CODES)[number];

/**
 * The code for what a refresh came to, where `unread` counts the shops it couldn't name an item in, since the product's
 * decision there couldn't be read (productTargets): each counts as an item that got no answer. A refresh of no items,
 * with none unread, asked no shop, so nothing needed refreshing.
 */
export function refreshCodeOf({ results, saved }: PriceRefresh, unread = 0): PriceRefreshCode {
  const asked = results.length + unread;
  if (asked === 0) {
    return "none";
  }
  const answered = results.filter(({ check }) => check.kind !== "unavailable").length;
  if (answered === 0) {
    return "failed";
  }
  return answered === asked && saved === "saved" ? "done" : "partial";
}

/**
 * A refresh's code, from `?prices=` or `?list-prices=`, or null for anything the app didn't send itself, so a link
 * can't put words on a page.
 */
export function parsePriceRefreshCode(value: string | null): PriceRefreshCode | null {
  return PRICE_REFRESH_CODES.find((code) => code === value) ?? null;
}

/** Where the list's "Odśwież ceny" goes back to: the product page it was posted from, or the list, and its filter. */
export interface ListRefreshBack {
  /** The id of the product whose page the list was shown beside, or null for the list's own page. */
  back: string | null;
  /** The filter the list was shown with, which the page it goes back to keeps. */
  f: ListFilter;
}

/**
 * The list refresh's `back` and `f` fields, as its form posts them: the product page it was posted from, by the
 * product's id, or none for the list, and the list's filter, a filter no chip links to, or one that isn't text, being
 * every product's. Null for a `back` that isn't a product's id (empty, not a UUID, or a file), which only a crafted
 * post sends: the route then refreshes nothing, so it costs no shop request, and goes back to the list with no code.
 * The route reads them once, before any refresh.
 */
export function listRefreshBackOf(
  back: FormDataEntryValue | null,
  f: FormDataEntryValue | null,
): ListRefreshBack | null {
  const itemId = back === null ? null : parseWatchlistItemId(back);
  if (back !== null && itemId === null) {
    return null;
  }
  return { back: itemId, f: parseListFilter(f) };
}

/**
 * Where the list's "Odśwież ceny" goes back to with its code (listRefreshBackOf): the product page it was posted from,
 * or the list, keeping the list's filter unless it's every product's (filterHref).
 */
export function listRefreshBackTo({ back, f }: ListRefreshBack, code: PriceRefreshCode): string {
  return filterHref(back === null ? "/watchlist" : `/watchlist/${back}`, f, { [LIST_PRICES_PARAM]: code });
}

/**
 * Where a product's own "Odśwież ceny", posted without JavaScript, goes back to with its code: the product's page,
 * keeping the list's filter unless it's every product's (filterHref). The id must already be a UUID.
 */
export function productRefreshBackTo(itemId: string, filter: ListFilter, code: PriceRefreshCode): string {
  return filterHref(`/watchlist/${itemId}`, filter, { [PRICES_PARAM]: code });
}
