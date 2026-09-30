import Price from "@/components/watchlist/Price";
import type { PriceTag } from "@/lib/services/watchlist-rows";
import { cn } from "@/lib/utils";

interface Props {
  tag: PriceTag;
  className?: string;
}

// Each tone's label, as the row service names them (watchlist-rows.ts, priceTagOf). The sun and tag-warn labels stay
// light in the dark theme, like the paper labels they are, and keep their dark ink; the muted tag takes the theme's
// raised fill, and a tag without a price only its outline. Written out whole, so Tailwind finds each class.
const TONES: Record<PriceTag["tone"], string> = {
  sun: "bg-sun text-label-ink",
  muted: "bg-muted text-foreground",
  warn: "bg-tag-warn text-label-ink",
  outline: "border-hairline border-border text-foreground",
};

// A list row's price tag: the price in shelf-label style, with its label under it in DM Mono, such as the cheapest
// shop's name, "Tylko Rossmann" or "Nieaktualna", or only the label when there's no price to show. It's drawn: the
// row's own line tells screen readers the whole comparison, so the row hides the tag from them. It keeps no state, so
// it renders the same as static HTML in an .astro file and in an island, and it and its imports stay free of
// server-only code.
export default function RowTag({ tag, className }: Props) {
  return (
    <span
      className={cn(
        "rounded-price-tag flex min-w-20 shrink-0 flex-col items-end gap-0.75 px-2.25 py-1.75 lg:min-w-21.5 lg:px-2.5",
        TONES[tag.tone],
        className,
      )}
    >
      {tag.price !== null && <Price amount={tag.price} size="tag" />}
      <span className="text-micro tracking-eyebrow font-mono whitespace-nowrap uppercase">{tag.label}</span>
    </span>
  );
}
