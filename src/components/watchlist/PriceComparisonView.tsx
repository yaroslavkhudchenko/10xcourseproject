import { useId } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  checkedAge,
  checkedCaption,
  comparisonOf,
  heroOf,
  trackHint,
  trackOf,
  verdictOfState,
  type PriceComparisonState,
} from "@/components/watchlist/price-comparison-state";
import PriceTrack from "@/components/watchlist/PriceTrack";
import ProductTitle, { type TitleProduct } from "@/components/watchlist/ProductTitle";
import RefreshBar from "@/components/watchlist/RefreshBar";
import ShopCard from "@/components/watchlist/ShopCard";
import VerdictHero from "@/components/watchlist/VerdictHero";

interface Props {
  /** The watched product's id, which both refresh forms post. */
  itemId: string;
  /** The product the title names. */
  product: TitleProduct;
  /** The island's state: its rows, whether each refetch runs, and what the last answers said. */
  state: PriceComparisonState;
  /** Whether Natura is still to be matched (naturaUndecided): the hero and the track's hint say so beside one price. */
  naturaUndecided: boolean;
  /**
   * Refetches every shop in place of the forms' post. Absent when the view is rendered without the island, as in the
   * kitchen sink: the forms then post, as they do without JavaScript.
   */
  onRefresh?: () => void;
}

// A product's page from its title down, as the island's state has it: the title row with "Odśwież ceny" and when the
// prices were checked, the verdict's hero, the price track or its hint, one card per shop, in the comparison's order
// with the cheapest marked, and a phone's bottom bar. What each part says comes from the tested rules
// (price-comparison-state.ts); this only maps it. It keeps no state and runs no effect, so every state the reducer can
// reach renders the same in the island and in the kitchen sink, and a view rendered without the island fetches
// nothing.
export default function PriceComparisonView({ itemId, product, state, naturaUndecided, onRefresh }: Props) {
  // The rows' order and marks, withheld while a stored price is unread, and the verdict judged on the same rows.
  const { rows } = comparisonOf(state);
  const verdict = verdictOfState(state);
  const natura = { naturaUndecided };
  const track = trackOf(rows, verdict);
  const hint = trackHint(verdict, natura);
  const caption = checkedCaption(state.rows, state.now);
  // One refetch per shop at a time: a second tap while one runs would only spend the cap again.
  const refreshing = state.rows.some((row) => row.pending);
  const pricesId = useId();

  return (
    <div className="flex flex-col gap-6 lg:gap-6.5">
      {state.sessionEnded && (
        <Alert variant="warning">
          <AlertDescription>
            <p>
              Sesja wygasła.{" "}
              <a href="/auth/signin" className="underline hover:decoration-2">
                Zaloguj się ponownie
              </a>
              , aby odświeżyć ceny.
            </p>
          </AlertDescription>
        </Alert>
      )}
      <ProductTitle product={product} itemId={itemId} caption={caption} refreshing={refreshing} onRefresh={onRefresh} />
      <VerdictHero hero={heroOf(verdict, natura)} />
      <PriceTrack track={track} hint={hint} />
      {rows.length > 0 && (
        <section aria-labelledby={pricesId}>
          <h2 id={pricesId} className="sr-only">
            Ceny
          </h2>
          <ul className="grid gap-6 lg:grid-cols-2 lg:gap-5 lg:pt-1.5">
            {rows.map((row) => (
              <li key={row.shop}>
                <ShopCard row={row} now={state.now} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* Screen readers hear each shop's answer here, outside the cards, so nothing live moves when they re-sort. */}
      <p role="status" aria-live="polite" className="sr-only">
        {state.announcements.join(" ")}
      </p>
      <RefreshBar
        itemId={itemId}
        age={checkedAge(state.rows, state.now)}
        caption={caption}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    </div>
  );
}
