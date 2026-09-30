import { initialOf, tileOf, type Tile } from "@/components/watchlist/thumb-tile";
import { cn } from "@/lib/utils";

interface Props {
  brand: string | null;
  imageUrl: string | null;
  /** A list row's, 48 px on a phone and 50 px from lg, or a product title's, 56 px and 80 px, tilted −6°. */
  size: "row" | "title";
  className?: string;
}

// Written out whole, so Tailwind finds each class.
const TILE_FILLS: Record<Tile, string> = {
  1: "bg-tile-1",
  2: "bg-tile-2",
  3: "bg-tile-3",
  4: "bg-tile-4",
};

const SIZES = {
  row: { box: "size-12 rounded-thumb lg:size-12.5", initial: "text-xl", pixels: 50 },
  title: {
    box: "size-14 -rotate-6 rounded-thumb-title border-2 border-label-ink lg:size-20 lg:rounded-thumb-title-lg",
    initial: "text-thumb-title lg:text-thumb-title-lg",
    pixels: 80,
  },
};

// A product's thumbnail: its photo on the white --thumbnail, or, without one, its brand's initial on the brand's
// pastel tile (thumb-tile.ts). It's decorative, since the product's name stands beside it. It keeps no state, so it
// renders the same as static HTML in an .astro file and in the price island.
export default function ProductThumb({ brand, imageUrl, size, className }: Props) {
  const look = SIZES[size];
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        width={look.pixels}
        height={look.pixels}
        loading="lazy"
        decoding="async"
        className={cn("bg-thumbnail shrink-0 object-contain", look.box, className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "text-label-ink grid shrink-0 place-items-center font-extrabold",
        TILE_FILLS[tileOf(brand)],
        look.box,
        look.initial,
        className,
      )}
    >
      {initialOf(brand)}
    </span>
  );
}
