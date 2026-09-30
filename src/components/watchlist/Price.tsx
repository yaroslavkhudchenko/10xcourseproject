import { formatPrice, priceParts } from "@/lib/services/price-comparison";
import { cn } from "@/lib/utils";

/** Where a price is drawn: the verdict's hero, a shop's card, or the price tag on a list row. */
export type PriceSize = "hero" | "card" | "tag";

interface Props {
  /** The amount in złoty. */
  amount: number;
  size: PriceSize;
  className?: string;
}

/** Each size's parts, phones first and desktops from lg, at the handoff's px (global.css's --text-price-* tokens). */
interface PriceLook {
  zlote: string;
  /** The grosze and "zł" beside the złote, as a column that starts at the złote's top. */
  fraction: string;
  grosze: string;
  /** "zł" under the grosze, or null where the price leaves it out. */
  unit: string | null;
}

const LOOKS: Record<PriceSize, PriceLook> = {
  hero: {
    zlote: "text-price-hero tracking-price lg:text-price-hero-lg",
    fraction: "ml-1 gap-1.75 pt-1.25 lg:ml-1.5 lg:gap-2.5 lg:pt-2",
    grosze:
      "border-b-4 border-current pb-1 text-price-hero-grosze tracking-wordmark lg:border-b-5 lg:pb-1.25 lg:text-price-hero-grosze-lg",
    unit: "text-price-hero-unit font-bold lg:text-price-hero-unit-lg",
  },
  card: {
    zlote: "text-price-card tracking-tighter lg:text-price-card-lg",
    fraction: "ml-0.75 gap-1 pt-0.75 lg:gap-1.25 lg:pt-1",
    grosze: "border-b-3 border-current pb-0.75 text-price-card-grosze lg:text-price-card-grosze-lg",
    unit: "text-price-card-unit font-bold lg:text-price-card-unit-lg",
  },
  // A list row's tag underlines its grosze as text and leaves "zł" out: its label names the shop.
  tag: {
    zlote: "text-price-tag tracking-wordmark",
    fraction: "ml-px",
    grosze: "text-price-tag-grosze underline underline-offset-2",
    unit: null,
  },
};

// A price as a shelf label writes it: the złote large, the grosze raised to their top and underlined, and "zł" under
// the grosze. Those parts are only drawn: screen readers hear the price once, as formatPrice writes it. It keeps no
// state, so it renders the same as static HTML in an .astro file and in the price island. Its colour is the text's
// around it.
export default function Price({ amount, size, className }: Props) {
  const { zlote, grosze } = priceParts(amount);
  const look = LOOKS[size];
  return (
    <span className={cn("inline-flex items-start font-extrabold", className)}>
      <span aria-hidden="true" className={look.zlote}>
        {zlote}
      </span>
      <span aria-hidden="true" className={cn("flex flex-col items-start", look.fraction)}>
        <span className={look.grosze}>{grosze}</span>
        {look.unit !== null && <span className={look.unit}>zł</span>}
      </span>
      <span className="sr-only">{formatPrice(amount)}</span>
    </span>
  );
}
