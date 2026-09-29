import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  comparisonOf,
  done,
  initialState,
  priceComparisonReducer,
  REFRESH_FORM_ROUTE,
  requestRefresh,
  start,
  tick,
  type ComparedRow,
  type PriceComparisonShop,
} from "@/components/watchlist/price-comparison-state";
import {
  ageText,
  formatDay,
  formatPrice,
  needsRefetch,
  SHOP_LABELS,
  type PricedShop,
} from "@/lib/services/price-comparison";
import { priceMissingText, priceUnavailableText } from "@/lib/shop-messages";
import { cn } from "@/lib/utils";

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
}

// A product's prices in its matched shops, ordered and with the cheapest marked, shown at once from the stored prices.
// Each shop is refetched on its own through /api/watchlist/prices, and its row, the order and the marks change as it
// answers. Without JavaScript, "Odśwież ceny" posts its form to /api/watchlist/refresh, and the page comes back with
// the refreshed prices.
export default function PriceComparison({ itemId, shops, autoRefresh, now }: Props) {
  const [state, dispatch] = useReducer(priceComparisonReducer, { shops, now }, initialState);

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

  const { rows } = comparisonOf(state);
  // One refetch per shop at a time: a second tap while one runs would only spend the cap again.
  const refreshing = state.rows.some((row) => row.pending);

  return (
    <div className="flex flex-col gap-3">
      {state.sessionEnded && (
        <p
          role="alert"
          className="rounded-lg border border-amber-400/30 bg-amber-900/30 px-3 py-2 text-sm text-amber-200"
        >
          Sesja wygasła.{" "}
          <a href="/auth/signin" className="underline">
            Zaloguj się ponownie
          </a>
          , aby odświeżyć ceny.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <PriceRow key={row.shop} row={row} now={state.now} />
        ))}
      </ul>
      {/* Screen readers hear each shop's answer here, outside the list, so nothing live moves when the rows re-sort. */}
      <p role="status" aria-live="polite" className="sr-only">
        {state.announcements.join(" ")}
      </p>
      <form
        method="POST"
        action={REFRESH_FORM_ROUTE}
        onSubmit={(event) => {
          // With JavaScript each shop is refetched here, and its row updates as it answers, in place of the post.
          event.preventDefault();
          for (const row of state.rows) {
            refresh(row.shop);
          }
        }}
      >
        <input type="hidden" name="itemId" value={itemId} />
        <button
          type="submit"
          disabled={refreshing}
          className="min-h-11 w-full rounded-lg border border-white/20 px-4 text-sm transition-colors hover:bg-white/10 disabled:opacity-60"
        >
          Odśwież ceny
        </button>
      </form>
    </div>
  );
}

interface PriceRowProps {
  row: ComparedRow;
  now: number;
}

/** One shop's price, with its source and age, and why it may be out of date. Without a price, a visible gap. */
function PriceRow({ row, now }: PriceRowProps) {
  const label = SHOP_LABELS[row.shop];
  const offer = row.latest?.offer ?? null;
  const hasPrice = offer !== null;
  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-xl border bg-white/5 p-3",
        row.cheapest ? "border-emerald-400/40" : "border-white/10",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h3 className="font-semibold">{label.name}</h3>
          <span className="text-sm text-blue-100/80">{row.pending ? "Odświeżam…" : null}</span>
        </div>
        {row.cheapest && (
          <span className="rounded-full bg-emerald-900/40 px-2 py-1 text-xs font-medium text-emerald-200">
            Najtaniej
          </span>
        )}
      </div>
      {offer === null ? (
        <p className="text-sm text-blue-100/80">Brak ceny online w {label.site}</p>
      ) : (
        <>
          <p className="text-2xl font-bold">{formatPrice(offer.price)}</p>
          {(offer.regularPrice !== null || offer.promoEndsOn !== null) && (
            <p className="text-sm text-blue-100/80">
              {offer.regularPrice !== null && (
                <>
                  zamiast <s>{formatPrice(offer.regularPrice)}</s>
                </>
              )}
              {offer.regularPrice !== null && offer.promoEndsOn !== null && " · "}
              {offer.promoEndsOn !== null && `promocja do ${formatDay(offer.promoEndsOn)}`}
            </p>
          )}
          {offer.lowestPrice30d !== null && (
            <p className="text-sm text-blue-100/80">
              najniższa cena z 30 dni wg sklepu: {formatPrice(offer.lowestPrice30d)}
            </p>
          )}
          <p className="text-sm text-blue-100/60">
            cena online w {label.site} · {ageText(offer.pricedAt, now)}
          </p>
          {(row.state === "stale" || !offer.available) && (
            <p className="flex flex-wrap gap-2">
              {row.state === "stale" && (
                <span className="rounded-full bg-amber-900/40 px-2 py-1 text-xs text-amber-200">nieaktualna</span>
              )}
              {!offer.available && (
                <span className="rounded-full bg-amber-900/40 px-2 py-1 text-xs text-amber-200">
                  niedostępny online
                </span>
              )}
            </p>
          )}
        </>
      )}
      {row.latest?.lastStatus === "missing" && <p className="text-sm text-amber-200">{priceMissingText(hasPrice)}</p>}
      {row.notice && (
        <p className="text-sm text-amber-200">
          {priceUnavailableText(label.name, row.notice.reason, row.notice.until, hasPrice)}
        </p>
      )}
      {row.productUrl && (
        <a
          href={row.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center self-start text-sm text-purple-300 underline"
        >
          Zobacz w sklepie
        </a>
      )}
    </li>
  );
}
