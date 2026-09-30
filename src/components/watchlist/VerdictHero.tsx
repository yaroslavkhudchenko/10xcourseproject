import Price from "@/components/watchlist/Price";
import type { Hero } from "@/components/watchlist/price-comparison-state";
import Sticker from "@/components/watchlist/Sticker";
import { cn } from "@/lib/utils";

interface Props {
  /** What the hero says, from the product's verdict (heroOf). */
  hero: Hero;
}

// Each tone's paper label, which stays light in the dark theme and keeps its dark ink. Written out whole, so Tailwind
// finds each class.
const TONES: Record<Hero["tone"], string> = {
  sun: "bg-sun",
  plain: "bg-tag-plain",
  warn: "bg-tag-warn",
};

// The product's verdict in one label: the line above, the price in shelf-label digits, the shop or shops after "w",
// and the line below, with the sticker stamped on its corner. On a desktop the text stands on the left and the price
// on the right, clear of the sticker by its padding; on a phone the text runs down, with the price and the shop
// sharing a row that wraps. One set of elements serves both: from lg they sit in a grid, whose empty rows above and
// below centre the text beside the price. A verdict without a price says only its line, as the label's headline. The
// sticker is decorative, since the line above says the same, and the page's pane clips its stamp at the gutter.
export default function VerdictHero({ hero }: Props) {
  return (
    <div
      className={cn(
        "rounded-hero border-label-ink text-label-ink shadow-hero relative flex flex-col gap-2.5 border-2 p-5",
        "lg:rounded-hero-lg lg:shadow-hero-lg lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[1fr_auto_auto_auto_1fr] lg:gap-x-6 lg:gap-y-0 lg:px-8 lg:py-6.5",
        TONES[hero.tone],
      )}
    >
      {hero.price === null ? (
        <p className="text-hero-shop tracking-heading lg:text-hero-shop-lg font-extrabold lg:col-start-1 lg:row-start-3">
          {hero.eyebrow}
        </p>
      ) : (
        <>
          <p className="text-meta font-mono font-medium tracking-widest uppercase lg:col-start-1 lg:row-start-2 lg:text-xs">
            {hero.eyebrow}
          </p>
          <div className="flex flex-wrap items-end gap-x-3.5 gap-y-2 lg:contents">
            <Price
              amount={hero.price}
              size="hero"
              className="lg:col-start-2 lg:row-span-5 lg:row-start-1 lg:self-center lg:pr-26"
            />
            {hero.shops !== null && (
              <p className="text-hero-shop tracking-wordmark lg:text-hero-shop-lg lg:tracking-heading pb-1.5 font-extrabold lg:col-start-1 lg:row-start-3 lg:mt-2.5 lg:pb-0">
                {hero.shops}
              </p>
            )}
          </div>
          {hero.sub !== null && (
            <p className="lg:text-body max-w-90 text-sm leading-snug font-medium text-pretty lg:col-start-1 lg:row-start-4 lg:mt-2.5">
              {hero.sub}
            </p>
          )}
        </>
      )}
      {hero.sticker !== null && (
        <>
          <Sticker kind={hero.sticker} size="sm" className="absolute -top-7 -right-2 lg:hidden" />
          <Sticker kind={hero.sticker} size="lg" className="absolute -top-7 -right-8.5 hidden lg:block" />
        </>
      )}
    </div>
  );
}
