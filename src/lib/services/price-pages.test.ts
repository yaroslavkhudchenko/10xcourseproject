import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unreadableShopsOf, type MatchedShopView } from "@/components/watchlist/match-card";
import { initialState, selectedRowTagOf, verdictOfState } from "@/components/watchlist/price-comparison-state";
import { listMatches, listMatchStates } from "@/lib/services/matches";
import {
  productPriceKeys,
  type MatchedShop,
  type PriceDecision,
  type PriceVerdict,
} from "@/lib/services/price-comparison";
import { listLatestPrices, priceShopsOf, readLatestPrices } from "@/lib/services/prices";
import { shopGateFor } from "@/lib/services/shop-gate";
import { runMatchSteps } from "@/lib/services/shop-matching";
import { stubSupabase, type StubRelation } from "@/lib/services/testing/stub-supabase";
import { getWatchlistProduct, listWatchlist } from "@/lib/services/watchlist";
import { listRowsOf, parseListFilter, type PriceTag } from "@/lib/services/watchlist-rows";
import type { MatchedItem } from "@/types";

// risk: #1 (context/foundation/test-plan.md): a stale, ended-promotion or unread price shows as current, or the wrong
// shop is marked cheapest, on the list or on the product's page.
// facet: one stored state per case, served by one stand-in database to both pages' own reads and wiring: the list's
// three reads and its rows (listRowsOf), and the product page's reads, its match steps on a view that isn't the user's
// own navigation, so no shop is asked, the island's shops (priceShopsOf) and its first verdict, and the selected row's
// tag beside it (selectedRowTagOf).
// expected values: written by hand from the PRD's guardrail (a stale or failed price is visible, never silent), US-01
// (the cheapest shop is marked, and a shop without a current price shows its gap), S-03's decision (only fresh prices
// orderable online can win; stale after 24 hours or when the promotion ended) and the owner's call of 2026-10-07 (a
// history the product page can't read leaves its price, so both pages give the same verdict). The tag's meta line
// follows PriceTag's documented "Natura · 5 min temu". Two cases pin a difference the owner kept (research §1.3): a
// decision whose details only the product page reads, and the product page's heavier read failing alone. Nothing here
// is computed with the rule under test.

// 28 September 2026, 14:00 in Poland.
const NOW = "2026-09-28T12:00:00.000Z";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

const PRODUCT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const ROSSMANN = "26900";
const NATURA = "NV89063";
const HEBE = "000000000000218807";
const SUPER_PHARM = "10132";

// The watched product, Rossmann's Nivea Soft 300 ml, as watchlist_items holds it.
const product = {
  id: PRODUCT_ID,
  source: "rossmann",
  source_item_id: ROSSMANN,
  brand: "NIVEA",
  name: "Soft",
  caption: "krem uniwersalny, nawilżający",
  size_text: "300 ml",
  size_value: 300,
  size_unit: "ml",
  eans: ["4005900009319"],
  product_url: "https://www.rossmann.pl/Produkt/NIVEA-Soft,26900,13049",
  image_url: null,
  created_at: "2026-09-27T12:00:00+00:00",
};

// Its decision in a matched shop: a match to `shopItemId`, as watchlist_matches holds it.
function matchRow(shop: MatchedShop, shopItemId: string, eans: string[] = []): Record<string, unknown> {
  return {
    watchlist_item_id: PRODUCT_ID,
    shop_id: shop,
    state: "matched",
    decided_by: "user",
    shop_item_id: shopItemId,
    name: `Nivea Soft ${shop}`,
    brand: "NIVEA",
    size_text: "300 ml",
    size_value: 300,
    size_unit: "ml",
    eans,
    product_url: null,
    image_url: null,
    checked_at: "2026-09-27T12:05:00+00:00",
  };
}
const MATCHES = [
  matchRow("natura", NATURA, ["4005900009319"]),
  matchRow("hebe", HEBE, ["4005900009319"]),
  matchRow("super-pharm", SUPER_PHARM),
];

/** How a check found its price: when, whether it could be ordered online, and a promotion's regular price and end. */
interface PricedOptions {
  pricedAgo?: number;
  available?: boolean;
  regularPrice?: number | null;
  promoEndsOn?: string | null;
}

/** An item's latest check that found a price: `pricedAgo` before now, orderable online unless said otherwise. */
function priced(
  shop: string,
  shopItemId: string,
  price: number,
  { pricedAgo = 10 * MINUTE, available = true, regularPrice = null, promoEndsOn = null }: PricedOptions = {},
): Record<string, unknown> {
  return {
    shop_id: shop,
    shop_item_id: shopItemId,
    last_checked_at: ago(pricedAgo),
    last_status: "price",
    price,
    regular_price: regularPrice,
    lowest_price_30d: null,
    promo_ends_on: promoEndsOn,
    available,
    priced_at: ago(pricedAgo),
  };
}

/** An item whose last check, `checkedAgo` before now, found it gone, with the price it had `pricedAgo` before now. */
function missing(shop: string, shopItemId: string, price: number, checkedAgo: number, pricedAgo: number) {
  return {
    ...priced(shop, shopItemId, price, { pricedAgo }),
    last_status: "missing",
    last_checked_at: ago(checkedAgo),
  };
}

/** A latest row as price_summaries gives it: with an empty history unless `history` says otherwise. */
const summary = (row: Record<string, unknown>, history: Record<string, unknown> = {}) => ({
  history_low: null,
  history_days: [],
  ...row,
  ...history,
});

/**
 * A stored state: the rows of each relation both pages read. `prices` are the latest rows the list reads; the product
 * page reads the same rows with their history (`summaries`), unless a case gives its own.
 */
interface StoredState {
  matches?: Record<string, unknown>[];
  prices: Record<string, unknown>[];
  summaries?: StubRelation;
}

function relationsOf({ matches = MATCHES, prices, summaries }: StoredState): Record<string, StubRelation> {
  return {
    watchlist_items: [product],
    watchlist_matches: matches,
    latest_price_observations: prices,
    price_summaries: summaries ?? prices.map((row) => summary(row)),
  };
}

/** The product's row on the list: the list's three reads and its rows, judged now. */
async function listTag(state: StoredState): Promise<PriceTag | undefined> {
  const { client } = stubSupabase({ relations: relationsOf(state) });
  const [items, matchRead, priceRead] = await Promise.all([
    listWatchlist(client),
    listMatchStates(client),
    listLatestPrices(client),
  ]);
  if (items === null) {
    throw new Error("the list couldn't be read");
  }
  return listRowsOf(items, matchRead, priceRead, Date.parse(NOW)).find((row) => row.itemId === PRODUCT_ID)?.tag;
}

/**
 * The product's page, as the page puts it together: its two reads, its match steps on a view that isn't the user's
 * own navigation (no shop is asked), each matched shop's item, the price read, the island's first verdict, and the
 * selected row's tag on the list beside it.
 */
async function productPage(state: StoredState): Promise<{ verdict: PriceVerdict; selectedTag: PriceTag }> {
  const { client, queries } = stubSupabase({ relations: relationsOf(state) });
  const [shown, matches] = await Promise.all([
    getWatchlistProduct(client, PRODUCT_ID),
    listMatches(client, PRODUCT_ID),
  ]);
  if (shown === null || shown === "failed") {
    throw new Error("the product couldn't be read");
  }
  const steps = await runMatchSteps({
    supabase: client,
    gate: shopGateFor(client),
    product: shown,
    matches,
    retryShop: null,
    repinShop: null,
    ownNavigation: false,
    filter: parseListFilter(null),
  });
  const matchedItems = new Map<MatchedShop, MatchedItem>(
    steps.flatMap(({ shop, item }) => (item === null ? [] : [[shop, item] as const])),
  );
  const keys = productPriceKeys(
    shown,
    [...matchedItems].map(([shop, item]): PriceDecision => ({ shop, state: "matched", shopItemId: item.shopItemId })),
  );
  const { shops, pricesFailed } = priceShopsOf(keys, await readLatestPrices(client, keys), () => null);
  const matched: MatchedShopView[] = steps.map(({ shop, view, unsaved }) => ({
    shop,
    view,
    notice: null,
    error: null,
    unsaved,
  }));
  const unreadable = unreadableShopsOf(matched);
  // No shop was asked: the gate's counter was never called.
  expect(queries.filter(([[kind]]) => kind === "rpc")).toEqual([]);
  return {
    verdict: verdictOfState(initialState({ shops, now: NOW, pricesFailed, unreadable })),
    selectedTag: selectedRowTagOf(shops, pricesFailed, unreadable, NOW),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  // The reads log odd rows; these cases make some on purpose.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The shops a cheapest verdict names, and the tag both pages show for it.
interface Agreed {
  why: string;
  state: StoredState;
  verdict: Partial<Extract<PriceVerdict, { kind: "cheapest" }>> | { kind: "unread" };
  tag: PriceTag;
}

const BOTH_FRESH = [
  priced("rossmann", ROSSMANN, 12.99),
  priced("natura", NATURA, 11.49),
  priced("hebe", HEBE, 12.49),
  priced("super-pharm", SUPER_PHARM, 13.99),
];
const UNREAD_TAG: PriceTag = { tone: "outline", price: null, label: "Błąd odczytu", meta: null };

describe("the list and the product page over one stored state", () => {
  it.each<Agreed>([
    {
      why: "a fresh price beside one older than 24 hours, one not orderable online and a shop never checked",
      state: {
        prices: [
          priced("rossmann", ROSSMANN, 26.99),
          priced("natura", NATURA, 19.99, { pricedAgo: 25 * HOUR }),
          priced("hebe", HEBE, 18.99, { available: false }),
        ],
      },
      verdict: { kind: "cheapest", shops: ["rossmann"], price: 26.99 },
      tag: { tone: "sun", price: 26.99, label: "Rossmann", meta: "Rossmann · 10 min temu" },
    },
    {
      why: "a lower price whose promotion ended yesterday",
      state: {
        prices: [
          priced("rossmann", ROSSMANN, 9.99, { regularPrice: 12.99, promoEndsOn: "2026-09-27" }),
          ...BOTH_FRESH.slice(1),
        ],
      },
      verdict: { kind: "cheapest", shops: ["natura"], price: 11.49 },
      tag: { tone: "sun", price: 11.49, label: "Natura", meta: "Natura · 10 min temu" },
    },
    {
      why: "a lower price the shop no longer has",
      state: {
        prices: [
          ...BOTH_FRESH.filter(({ shop_id }) => shop_id !== "hebe"),
          missing("hebe", HEBE, 8.99, 10 * MINUTE, 2 * 24 * HOUR),
        ],
      },
      verdict: { kind: "cheapest", shops: ["natura"], price: 11.49 },
      tag: { tone: "sun", price: 11.49, label: "Natura", meta: "Natura · 10 min temu" },
    },
    {
      why: "two fresh shops at the same lowest price",
      state: {
        prices: [
          priced("rossmann", ROSSMANN, 12.99),
          priced("natura", NATURA, 11.49),
          priced("hebe", HEBE, 11.49, { pricedAgo: 20 * MINUTE }),
          priced("super-pharm", SUPER_PHARM, 13.99),
        ],
      },
      verdict: { kind: "cheapest", shops: ["natura", "hebe"], price: 11.49 },
      // A tie's age is its older price's.
      tag: { tone: "sun", price: 11.49, label: "Natura i Hebe", meta: "Natura i Hebe · 20 min temu" },
    },
    {
      why: "a price row that can't be read, which may hold the lowest price",
      state: { prices: BOTH_FRESH.map((row) => (row.shop_id === "natura" ? { ...row, available: "yes" } : row)) },
      verdict: { kind: "unread" },
      tag: UNREAD_TAG,
    },
    {
      why: "a decision that can't be read, whose match may hold the lowest price",
      state: {
        prices: BOTH_FRESH,
        matches: MATCHES.map((row) => (row.shop_id === "hebe" ? { ...row, state: "maybe" } : row)),
      },
      verdict: { kind: "unread" },
      tag: UNREAD_TAG,
    },
    {
      why: "a history the product page can't read, which leaves its price (the owner's call, 2026-10-07)",
      state: {
        prices: BOTH_FRESH,
        summaries: BOTH_FRESH.map((row) =>
          summary(row, row.shop_id === "natura" ? { history_low: "5.49", history_days: ["2026-09-25"] } : {}),
        ),
      },
      verdict: { kind: "cheapest", shops: ["natura"], price: 11.49 },
      tag: { tone: "sun", price: 11.49, label: "Natura", meta: "Natura · 10 min temu" },
    },
  ])("agree on $why", async ({ state, verdict, tag }) => {
    const page = await productPage(state);

    expect(page.verdict).toMatchObject(verdict);
    expect(await listTag(state)).toEqual(tag);
    expect(page.selectedTag).toEqual(tag);
  });

  it("differ, as the owner kept, on a decision whose details only the product page reads", async () => {
    // Natura's match has a time that isn't one. The product page reads a match's details for its card, so Natura's
    // decision is unreadable there and no shop is named; the list reads only the decision's state, and names Natura.
    const state: StoredState = {
      prices: BOTH_FRESH,
      matches: MATCHES.map((row) => (row.shop_id === "natura" ? { ...row, checked_at: "wczoraj" } : row)),
    };

    const page = await productPage(state);

    expect(page.verdict).toMatchObject({ kind: "unread" });
    expect(page.selectedTag).toEqual(UNREAD_TAG);
    expect(await listTag(state)).toEqual({ tone: "sun", price: 11.49, label: "Natura", meta: "Natura · 10 min temu" });
  });

  it("differ, as the owner kept, when the product page's heavier price read fails alone", async () => {
    // price_summaries times out while latest_price_observations answers: the product page says its prices couldn't be
    // read, and the list beside it still names Natura.
    const state: StoredState = {
      prices: BOTH_FRESH,
      summaries: { error: { code: "57014", message: "canceling statement due to statement timeout" } },
    };

    const page = await productPage(state);

    expect(page.verdict).toMatchObject({ kind: "unread" });
    expect(page.selectedTag).toEqual(UNREAD_TAG);
    expect(await listTag(state)).toEqual({ tone: "sun", price: 11.49, label: "Natura", meta: "Natura · 10 min temu" });
  });
});
