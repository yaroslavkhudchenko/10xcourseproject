import { useId } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  comparisonOf,
  gapText,
  REFRESH_FORM_ROUTE,
  type ComparedRow,
  type PriceComparisonState,
} from "@/components/watchlist/price-comparison-state";
import { ageText, formatDay, formatPrice, SHOP_LABELS } from "@/lib/services/price-comparison";
import { priceMissingText, priceUnavailableText } from "@/lib/shop-messages";
import { cn } from "@/lib/utils";

interface Props {
  /** The watched product's id, which the refresh form posts. */
  itemId: string;
  /** The island's state: its rows, whether each refetch runs, and what the last answers said. */
  state: PriceComparisonState;
  /**
   * Refetches every shop in place of the form's post. Absent when the view is rendered without the island, as in the
   * kitchen sink: the form then posts, as it does without JavaScript.
   */
  onRefresh?: () => void;
}

// A product's prices as the island's state has them: the rows in their order with the cheapest marked, why a price
// may be out of date or missing, and "Odśwież ceny". It keeps no state and runs no effect, so every state the reducer
// can reach renders the same in the island and in the kitchen sink, and a view rendered without the island fetches
// nothing.
export default function PriceComparisonView({ itemId, state, onRefresh }: Props) {
  const { rows } = comparisonOf(state);
  // One refetch per shop at a time: a second tap while one runs would only spend the cap again.
  const refreshing = state.rows.some((row) => row.pending);
  // The page couldn't read the stored prices, and some shop hasn't answered since.
  const readFailed = state.rows.some((row) => row.readFailed);

  return (
    <div className="flex flex-col gap-3">
      {readFailed && (
        <Alert variant="destructive">
          <AlertDescription>Nie udało się wczytać cen.</AlertDescription>
        </Alert>
      )}
      {state.sessionEnded && (
        <Alert variant="warning">
          <AlertDescription>
            <p>
              Sesja wygasła.{" "}
              <a href="/auth/signin" className="underline">
                Zaloguj się ponownie
              </a>
              , aby odświeżyć ceny.
            </p>
          </AlertDescription>
        </Alert>
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
        onSubmit={
          onRefresh === undefined
            ? undefined
            : (event) => {
                // With JavaScript each shop is refetched here, and its row updates as it answers, in place of the post.
                event.preventDefault();
                onRefresh();
              }
        }
      >
        <input type="hidden" name="itemId" value={itemId} />
        <Button type="submit" variant="outline" size="touch" disabled={refreshing} className="w-full">
          Odśwież ceny
        </Button>
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
  // The shop's name describes the row's "Zobacz w sklepie", which every row repeats; the id is this row's own.
  const nameId = useId();
  const label = SHOP_LABELS[row.shop];
  const offer = row.latest?.offer ?? null;
  const hasPrice = offer !== null;
  return (
    <li>
      <Card className={cn("gap-1 p-3", row.cheapest && "border-success/40")}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h3 id={nameId} className="font-semibold">
              {label.name}
            </h3>
            <span className="text-muted-foreground text-sm">{row.pending ? "Odświeżam…" : null}</span>
          </div>
          {row.cheapest && <Badge variant="success">Najtaniej</Badge>}
        </div>
        {offer === null ? (
          <p className="text-muted-foreground text-sm">{gapText(row)}</p>
        ) : (
          <>
            <p className="text-2xl font-bold">{formatPrice(offer.price)}</p>
            {(offer.regularPrice !== null || offer.promoEndsOn !== null) && (
              <p className="text-muted-foreground text-sm">
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
              <p className="text-muted-foreground text-sm">
                najniższa cena z 30 dni wg sklepu: {formatPrice(offer.lowestPrice30d)}
              </p>
            )}
            <p className="text-muted-foreground text-sm">
              cena online w {label.site} · {ageText(offer.pricedAt, now)}
            </p>
            {(row.state === "stale" || !offer.available) && (
              <p className="flex flex-wrap gap-2">
                {row.state === "stale" && <Badge variant="warning">nieaktualna</Badge>}
                {!offer.available && <Badge variant="warning">niedostępny online</Badge>}
              </p>
            )}
          </>
        )}
        {row.latest?.lastStatus === "missing" && (
          <p className="text-warning-foreground text-sm">{priceMissingText(hasPrice)}</p>
        )}
        {row.notice && (
          <p className="text-warning-foreground text-sm">
            {priceUnavailableText(label.name, row.notice.reason, row.notice.until, hasPrice)}
          </p>
        )}
        {row.productUrl && (
          <a
            href={row.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={nameId}
            className={cn(buttonVariants({ variant: "link", size: "touch" }), "self-start px-0 underline")}
          >
            Zobacz w sklepie<span className="sr-only"> (otwiera się w nowej karcie)</span>
          </a>
        )}
      </Card>
    </li>
  );
}
