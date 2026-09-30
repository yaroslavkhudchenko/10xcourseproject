import { useId } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  naturaCardOf,
  naturaUndecided,
  naturaUnreadable,
  type NaturaCard as NaturaCardModel,
  type NaturaCardInput,
} from "@/components/watchlist/natura-card";
import NaturaCard from "@/components/watchlist/NaturaCard";
import {
  checkedAge,
  checkedCaption,
  comparisonOf,
  heroOf,
  trackHint,
  trackOf,
  verdictOfState,
  type ComparedRow,
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
  /**
   * Natura as the page read it: its view, a decision's notice and error, and whether the lookup's outcome went
   * unsaved; null when there's nothing to say about Natura. Its card stands among the shops' cards, the hero and the
   * track's hint say when it's still to be matched, and a decision that couldn't be read keeps every shop from being
   * named, as a price that couldn't be read does.
   */
  natura: NaturaCardInput | null;
  /**
   * Refetches every shop in place of the forms' post. Absent when the view is rendered without the island, as in the
   * kitchen sink: the forms then post, as they do without JavaScript.
   */
  onRefresh?: () => void;
}

// A product's page from its title down, as the island's state has it: the title row with "Odśwież ceny" and when the
// prices were checked, the verdict's hero, the price track or its hint, one card per shop, in the comparison's order
// with the cheapest marked and Natura's card among them, and a phone's bottom bar. What each part says comes from the
// tested rules (price-comparison-state.ts, natura-card.ts); this only maps it. It keeps no state and runs no effect,
// so every state the reducer can reach renders the same in the island and in the kitchen sink, and a view rendered
// without the island fetches nothing.
export default function PriceComparisonView({ itemId, product, state, natura, onRefresh }: Props) {
  const view = natura?.view ?? null;
  // The rows' order and marks, withheld while a stored price is unread, and the verdict judged on the same rows.
  const { rows } = comparisonOf(state);
  const verdict = verdictOfState(state, { naturaUnreadable: naturaUnreadable(view) });
  const context = { naturaUndecided: naturaUndecided(view) };
  const track = trackOf(rows, verdict);
  const hint = trackHint(verdict, context);
  const caption = checkedCaption(state.rows, state.now);
  // One refetch per shop at a time: a second tap while one runs would only spend the cap again.
  const refreshing = state.rows.some((row) => row.pending);

  return (
    <div className="flex flex-col gap-6 lg:gap-6.5">
      {state.sessionEnded && (
        <Alert variant="warning">
          <AlertDescription>
            <p>
              Sesja wygasła.{" "}
              {/* A link in the sentence keeps its line's height, with a 44 px hit area around it, on one line. */}
              <a href="/auth/signin" className="hit-area whitespace-nowrap underline hover:decoration-2">
                Zaloguj się ponownie
              </a>
              , aby odświeżyć ceny.
            </p>
          </AlertDescription>
        </Alert>
      )}
      <ProductTitle product={product} itemId={itemId} caption={caption} refreshing={refreshing} onRefresh={onRefresh} />
      <VerdictHero hero={heroOf(verdict, context)} />
      <PriceTrack track={track} hint={hint} />
      <ShopGrid itemId={itemId} rows={rows} now={state.now} natura={natura === null ? null : naturaCardOf(natura)} />
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

interface GridProps {
  /** The watched product's id, which Natura's card links lead to. */
  itemId: string;
  /** The shops' rows in the comparison's order, with their marks (comparisonOf). */
  rows: readonly ComparedRow[];
  /** The time the prices' ages are read at, in milliseconds. */
  now: number;
  /** What Natura's card says (naturaCardOf), or null for no card of its own. */
  natura: NaturaCardModel | null;
}

/**
 * The shops' cards, two columns from xl (1280 px) and one below it, where a card of half the pane beside the list
 * would squeeze its shop's name and site: each priced shop's card in the comparison's order, Natura's price card with
 * its match's footer, and, while Natura has no price row, its card without a price after them. The kitchen sink draws
 * it on its own, with every state of Natura.
 */
export function ShopGrid({ itemId, rows, now, natura }: GridProps) {
  const headingId = useId();
  const naturaPriced = rows.some((row) => row.shop === "natura");
  if (rows.length === 0 && natura === null) {
    return null;
  }
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        Ceny
      </h2>
      <ul className="grid gap-6 lg:gap-5 lg:pt-1.5 xl:grid-cols-2">
        {rows.map((row) => (
          <li key={row.shop}>
            {row.shop === "natura" && natura !== null ? (
              <NaturaCard card={natura} itemId={itemId} row={row} now={now} />
            ) : (
              <ShopCard row={row} now={now} />
            )}
          </li>
        ))}
        {natura !== null && !naturaPriced && (
          <li key="natura">
            <NaturaCard card={natura} itemId={itemId} row={null} now={now} />
          </li>
        )}
      </ul>
    </section>
  );
}
