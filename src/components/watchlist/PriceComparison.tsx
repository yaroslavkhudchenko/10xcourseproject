import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  done,
  initialState,
  priceComparisonReducer,
  requestRefresh,
  start,
  tick,
  type PriceComparisonShop,
} from "@/components/watchlist/price-comparison-state";
import PriceComparisonView from "@/components/watchlist/PriceComparisonView";
import { needsRefetch, type PricedShop } from "@/lib/services/price-comparison";

// Ages move on once a minute, the finest step they show.
const CLOCK_TICK_MS = 60_000;

interface Props {
  /** The watched product's id. */
  itemId: string;
  /** The product's matched shops, in the page's order, each with its item's page and its stored price. */
  shops: PriceComparisonShop[];
  /** Whether opening the page may refetch shops on its own: only the user's own navigation may. */
  autoRefresh: boolean;
  /** The server's time when it rendered the page, as an ISO timestamp. */
  now: string;
  /** The page couldn't read the stored prices: each row says so in place of a price until its shop answers. */
  pricesFailed: boolean;
}

// A product's prices in its matched shops, ordered and with the cheapest marked, shown at once from the stored prices.
// Each shop is refetched on its own through /api/watchlist/prices, and its row, the order and the marks change as it
// answers. Without JavaScript, "Odśwież ceny" posts its form to /api/watchlist/refresh, and the page comes back with
// the refreshed prices. This island keeps the state and the effects; PriceComparisonView renders them.
export default function PriceComparison({ itemId, shops, autoRefresh, now, pricesFailed }: Props) {
  const [state, dispatch] = useReducer(priceComparisonReducer, { shops, now, pricesFailed }, initialState);

  const refresh = useCallback(
    (shop: PricedShop) => {
      dispatch(start(shop));
      void requestRefresh(itemId, shop).then((result) => {
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
    for (const { shop, latest } of shops) {
      if (needsRefetch(latest, renderedAt)) {
        refresh(shop);
      }
    }
  }, [autoRefresh, now, refresh, shops]);

  return (
    <PriceComparisonView
      itemId={itemId}
      state={state}
      onRefresh={() => {
        for (const row of state.rows) {
          refresh(row.shop);
        }
      }}
    />
  );
}
