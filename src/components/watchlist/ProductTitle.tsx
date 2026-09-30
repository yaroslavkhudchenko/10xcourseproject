import ProductThumb from "@/components/watchlist/ProductThumb";
import RefreshForm from "@/components/watchlist/RefreshForm";
import { formatDayOf } from "@/lib/services/price-comparison";
import { rowProductOf, type NamedProduct } from "@/lib/services/watchlist-rows";
import type { WatchlistItem } from "@/types";

/** The product as its title shows it: what its list row shows, and when it was added. */
export type TitleProduct = NamedProduct & Pick<WatchlistItem, "addedAt">;

interface Props {
  product: TitleProduct;
  /** The watched product's id, which the title row's "Odśwież ceny" posts. */
  itemId: string;
  /** When the prices were checked (checkedCaption), under "Odśwież ceny". */
  caption: string;
  /** Some shop's refetch runs, so "Odśwież ceny" waits. */
  refreshing: boolean;
  onRefresh?: () => void;
}

// A product page's title row. On a desktop: the product's tile, its brand, size and the day it was added above its
// name, and on the right "Odśwież ceny" over when the prices were checked; the tile and the name take their desktop
// sizes from xl (1280 px), since at 1024 px the pane beside the list leaves a 40 px name too little room and would
// break its words. On a phone: the smaller tile beside the name, with the refresh in the bottom bar and the brand and
// size in the row back to the list. The name and the brand and size are the list row's (rowProductOf), so the list and
// the product agree; the heading reads the brand before the name, so screen readers hear the product's full name. It
// keeps no state, so it renders the same in the island and in the kitchen sink.
export default function ProductTitle({ product, itemId, caption, refreshing, onRefresh }: Props) {
  const { eyebrow, name, brand, imageUrl } = rowProductOf(product);
  const added = formatDayOf(product.addedAt);
  // Set in capitals by the view, as the list's rows set theirs: "NIVEA · 300 ML · DODANO 20.09".
  const meta = [eyebrow, added === null ? null : `dodano ${added}`].filter((part) => part !== null).join(" · ");
  return (
    <div className="flex items-center gap-3.5 pr-12 lg:gap-5 lg:pr-0">
      <ProductThumb brand={brand} imageUrl={imageUrl} size="title" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {meta !== "" && (
          <p className="text-muted-foreground tracking-tag hidden font-mono text-xs wrap-break-word uppercase lg:block">
            {meta}
          </p>
        )}
        <h1 className="text-product-title tracking-heading xl:text-product-title-lg xl:tracking-title font-extrabold text-balance wrap-break-word">
          {brand && <span className="sr-only">{brand} </span>}
          {name}
        </h1>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-2 lg:flex">
        <RefreshForm itemId={itemId} pending={refreshing} onRefresh={onRefresh} size="title" />
        <p className="text-meta text-muted-foreground font-mono whitespace-nowrap">{caption}</p>
      </div>
    </div>
  );
}
