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
// and the line below, with the sticker stamped on its corner. From xl (1280 px), where the pane beside the list is
// 860 px wide, the text stands on the left and the price on the right, clear of the sticker by its padding; below xl
// the text runs down, with the price and the shop sharing a row that wraps, in the desktop's sizes from lg: at 1024 px
// the pane has no room for the text beside the price. One set of elements serves both: from xl they sit in a grid,
// whose empty rows above and below centre the text beside the price. A verdict without a price says only its line, as
// the label's headline. The sticker pokes 28 px above the label, so a label with one stands 8 px lower, clear of the
// title row's caption and name. The sticker is decorative, since the line above says its fact and the price track's
// card its judgement, and the page's pane clips its stamp at the gutter.
export default function VerdictHero({ hero }: Props) {
  return (
    <div
      className={cn(
        "rounded-hero border-label-ink text-label-ink shadow-hero relative flex flex-col gap-2.5 border-2 p-5",
        "lg:rounded-hero-lg lg:shadow-hero-lg lg:px-8 lg:py-6.5",
        "xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:grid-rows-[1fr_auto_auto_auto_1fr] xl:gap-x-6 xl:gap-y-0",
        hero.sticker !== null && "mt-2",
        TONES[hero.tone],
      )}
    >
      {hero.price === null ? (
        <p className="text-hero-shop tracking-heading lg:text-hero-shop-lg font-extrabold xl:col-start-1 xl:row-start-3">
          {hero.eyebrow}
        </p>
      ) : (
        <>
          <p className="text-meta font-mono font-medium tracking-widest uppercase lg:text-xs xl:col-start-1 xl:row-start-2">
            {hero.eyebrow}
          </p>
          <div className="flex flex-wrap items-end gap-x-3.5 gap-y-2 xl:contents">
            <Price
              amount={hero.price}
              size="hero"
              className="xl:col-start-2 xl:row-span-5 xl:row-start-1 xl:self-center xl:pr-26"
            />
            {hero.shops !== null && (
              <p className="text-hero-shop tracking-wordmark lg:text-hero-shop-lg lg:tracking-heading pb-1.5 font-extrabold xl:col-start-1 xl:row-start-3 xl:mt-2.5 xl:pb-0">
                {hero.shops}
              </p>
            )}
          </div>
          {hero.sub !== null && (
            <p className="lg:text-body max-w-90 text-sm leading-snug font-medium text-pretty xl:col-start-1 xl:row-start-4 xl:mt-2.5">
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
