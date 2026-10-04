import { useId } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  matchCardOf,
  undecidedShopsOf,
  type MatchCard as MatchCardModel,
  type MatchedShopView,
} from "@/components/watchlist/match-card";
import MatchCard from "@/components/watchlist/MatchCard";
import {
  checkedAge,
  checkedCaption,
  comparisonOf,
  heroOf,
  matchChangedText,
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
import { filterHref, type ListFilter } from "@/lib/services/watchlist-rows";

interface Props {
  /** The watched product's id, which both refresh forms post. */
  itemId: string;
  /** The filter the list is shown with, which both refresh forms post, so the page they come back to keeps it. */
  listFilter: ListFilter;
  /** The product the title names. */
  product: TitleProduct;
  /**
   * The island's state: its rows, whether each refetch runs, what the last answers said, and the matched shops whose
   * decision couldn't be read, which keep every shop from being named, as a price that couldn't be read does.
   */
  state: PriceComparisonState;
  /**
   * The matched shops as the page read them, in its order: each one's view, a decision's notice and error, and whether
   * the lookup's outcome went unsaved. Each one's card stands among the shops' cards, and the hero and the track's hint
   * name the ones still to be matched.
   */
  matched: readonly MatchedShopView[];
  /**
   * Refetches every shop in place of the forms' post. Absent when the view is rendered without the island, as in the
   * kitchen sink: the forms then post, as they do without JavaScript.
   */
  onRefresh?: () => void;
}

// A product's page from its title down, as the island's state has it: the title row with "Odśwież ceny" and when the
// prices were checked, the verdict's hero, the price track or its hint, one card per shop, in the comparison's order
// with the cheapest marked and each matched shop's card among them, and a phone's bottom bar. What each part says comes
// from the tested rules (price-comparison-state.ts, match-card.ts); this only maps it. It keeps no state and runs no
// effect, so every state the reducer can reach renders the same in the island and in the kitchen sink, and a view
// rendered without the island fetches nothing.
export default function PriceComparisonView({ itemId, listFilter, product, state, matched, onRefresh }: Props) {
  // The rows' order and marks, withheld while a stored price or a matched shop's decision is unread, and the verdict
  // judged on the same rows.
  const { rows } = comparisonOf(state);
  const verdict = verdictOfState(state);
  const context = { undecided: undecidedShopsOf(matched) };
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
      {state.matchChanged.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            <p>
              {matchChangedText(state.matchChanged)}{" "}
              {/* The product's page anew, with the list's filter: it shows the match as it stands now. */}
              <a
                href={filterHref(`/watchlist/${itemId}`, listFilter)}
                className="hit-area whitespace-nowrap underline hover:decoration-2"
              >
                Odśwież stronę
              </a>
              , aby zobaczyć aktualne ceny.
            </p>
          </AlertDescription>
        </Alert>
      )}
      <ProductTitle
        product={product}
        itemId={itemId}
        listFilter={listFilter}
        caption={caption}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
      <VerdictHero hero={heroOf(verdict, context)} />
      <PriceTrack track={track} hint={hint} />
      <ShopGrid rows={rows} now={state.now} cards={matched.map((shop) => matchCardOf(shop))} />
      {/* Screen readers hear each shop's answer here, outside the cards, so nothing live moves when they re-sort. */}
      <p role="status" aria-live="polite" className="sr-only">
        {state.announcements.join(" ")}
      </p>
      <RefreshBar
        itemId={itemId}
        listFilter={listFilter}
        age={checkedAge(state.rows, state.now)}
        caption={caption}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    </div>
  );
}

interface GridProps {
  /** The shops' rows in the comparison's order, with their marks (comparisonOf). */
  rows: readonly ComparedRow[];
  /** The time the prices' ages are read at, in milliseconds. */
  now: number;
  /** What each matched shop's card says (matchCardOf), its links included, in the pages' order. */
  cards: readonly MatchCardModel[];
}

/**
 * The shops' cards, two columns from xl (1280 px) and one below it, where a card of half the pane beside the list
 * would squeeze its shop's name and site: each priced shop's card in the comparison's order, a matched shop's price
 * card with its match's footer, and, for each matched shop without a price row, its card without a price after them,
 * in the pages' order. The kitchen sink draws it on its own, with every state of Natura.
 */
export function ShopGrid({ rows, now, cards }: GridProps) {
  const headingId = useId();
  if (rows.length === 0 && cards.length === 0) {
    return null;
  }
  const priced = new Set(rows.map((row) => row.shop));
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        Ceny
      </h2>
      <ul className="grid gap-6 lg:gap-5 lg:pt-1.5 xl:grid-cols-2">
        {rows.map((row) => {
          const card = cards.find((each) => each.shop === row.shop);
          return (
            <li key={row.shop}>
              {card === undefined ? <ShopCard row={row} now={now} /> : <MatchCard card={card} row={row} now={now} />}
            </li>
          );
        })}
        {cards
          .filter((card) => !priced.has(card.shop))
          .map((card) => (
            <li key={card.shop}>
              <MatchCard card={card} row={null} now={now} />
            </li>
          ))}
      </ul>
    </section>
  );
}
