import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { unreadableShopsOf, type MatchedShopView } from "@/components/watchlist/match-card";
import {
  done,
  initialState,
  priceComparisonReducer,
  PRICES_EVENT,
  requestRefresh,
  rowShopsOfIsland,
  start,
  tick,
  type PricesEventDetail,
} from "@/components/watchlist/price-comparison-state";
import PriceComparisonView from "@/components/watchlist/PriceComparisonView";
import type { TitleProduct } from "@/components/watchlist/ProductTitle";
import { needsRefetch, type PriceComparisonShop, type PricedShop } from "@/lib/services/price-comparison";
import type { ListFilter } from "@/lib/services/watchlist-rows";

// Ages move on once a minute, the finest step they show.
const CLOCK_TICK_MS = 60_000;

interface Props {
  /** The watched product's id. */
  itemId: string;
  /**
   * The filter the list is shown with, which both "Odśwież ceny" forms post without JavaScript, so the page they come
   * back to keeps it and the list beside the product its chip.
   */
  listFilter: ListFilter;
  /** The product, as the title names it. */
  product: TitleProduct;
  /**
   * The product's matched shops as the page read them, every priced shop but its own, in the pages' order
   * (matchedShopsOf), each for its card among the shops' cards: its view, with no candidates for a choice, which the
   * shop's section below the island holds; a decision's notice and error; and whether the lookup's outcome went
   * unsaved.
   */
  matched: MatchedShopView[];
  /**
   * The product's priced shops, in the page's order, its own shop's item first, then each match's (productPricesOf),
   * each with its item's page and its stored price: the item each refetch names.
   */
  shops: PriceComparisonShop[];
  /** Whether opening the page may refetch shops on its own: only the user's own navigation may. */
  autoRefresh: boolean;
  /** The server's time when it rendered the page, as an ISO timestamp. */
  now: string;
  /** The page couldn't read the stored prices: each row says so in place of a price until its shop answers. */
  pricesFailed: boolean;
}

// A product's page from its title down: its prices in its priced shops, ordered and with the cheapest marked, shown at
// once from the stored prices, with the verdict's hero, the price track, each matched shop's card and when the prices
// were checked. Each shop is refetched on its own through /api/watchlist/prices, and its card, the order, the marks,
// the hero, the track and the check change as it answers; after each change of its rows the island tells the list
// beside the product (PRICES_EVENT), whose row for it follows. Without JavaScript, either "Odśwież ceny" posts its form
// to /api/watchlist/refresh, and the page comes back with the refreshed prices and the list's filter. This island
// keeps the state and the effects; PriceComparisonView renders them.
export default function PriceComparison({
  itemId,
  listFilter,
  product,
  matched,
  shops,
  autoRefresh,
  now,
  pricesFailed,
}: Props) {
  // The matched shops whose decision couldn't be read: a match one of them hides may name a lower price, so no shop is
  // named cheapest, here or on the list's row. The page's props don't change, so neither does this list.
  const unreadable = useMemo(() => unreadableShopsOf(matched), [matched]);
  const [state, dispatch] = useReducer(priceComparisonReducer, { shops, now, pricesFailed, unreadable }, initialState);

  // Each refetch names the shop's item the page shows, so the route can tell when it's no longer the shop's match.
  const refresh = useCallback(
    (shop: PricedShop, shopItemId: string) => {
      dispatch(start(shop));
      void requestRefresh(itemId, shop, shopItemId).then((result) => {
        dispatch(done(shop, result, Date.now()));
      });
    },
    [itemId],
  );

  // The first render used the server's clock, so its ages match the page's HTML; from here on the browser's clock
  // moves them.
  useEffect(() => {
    dispatch(tick(Date.now()));
    const timer = setInterval(() => {
      dispatch(tick(Date.now()));
    }, CLOCK_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // On the user's own navigation, each shop whose last check is more than 15 minutes old is asked once, judged on the
  // server's clock like the page itself. A link from another site only offers the button, so it can't spend the cap
  // everyone shares.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoRefresh || autoStarted.current) {
      return;
    }
    autoStarted.current = true;
    const renderedAt = Date.parse(now);
    for (const { shop, shopItemId, latest } of shops) {
      if (needsRefetch(latest, renderedAt)) {
        refresh(shop, shopItemId);
      }
    }
  }, [autoRefresh, now, refresh, shops]);

  // The list beside the product hears the rows once the island has hydrated, and after each change: a refetch that
  // starts, and each shop's answer. Its row then shows the tag these rows come to, which the page drew from the same
  // stored rows, so nothing moves until a shop answers. It asks no shop.
  useEffect(() => {
    const detail: PricesEventDetail = { itemId, shops: rowShopsOfIsland(state.rows, unreadable) };
    window.dispatchEvent(new CustomEvent(PRICES_EVENT, { detail }));
  }, [itemId, state.rows, unreadable]);

  return (
    <PriceComparisonView
      itemId={itemId}
      listFilter={listFilter}
      product={product}
      state={state}
      matched={matched}
      onRefresh={() => {
        for (const row of state.rows) {
          refresh(row.shop, row.shopItemId);
        }
      }}
    />
  );
}
