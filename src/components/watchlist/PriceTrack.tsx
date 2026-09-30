import { Card } from "@/components/ui/card";
import { markerLabelSides, type MarkerLabelSide, type Track } from "@/components/watchlist/price-comparison-state";
import { SHOP_FILLS } from "@/components/watchlist/shop-fills";
import { SHOP_LABELS } from "@/lib/services/price-comparison";
import { cn } from "@/lib/utils";

interface Props {
  /** Where the prices sit (trackOf), or null when there are fewer than two values to place. */
  track: Track | null;
  /** What the card says beside the track, or in its place (trackHint). */
  hint: string | null;
}

// A marker's label: centred on its marker, or turned away from a close neighbour (markerLabelSides), 4 px off its
// marker's centre. Written out whole, so Tailwind finds each class.
const LABEL_SIDES: Record<MarkerLabelSide, string> = {
  center: "left-0 -translate-x-1/2 items-center",
  end: "right-1 items-end",
  start: "left-1 items-start",
};

// The price track's card: "Gdzie wypada dzisiejsza cena" ("Gdzie wypada cena" on a phone), with the note on the right
// and the hint below it, over the track: a bar in the raised fill, the sun's band from the lowest to the highest shop
// price, a marker in each shop's colour under its name and price, and the dashed tick of the 30-day low its shop
// reports, labelled below. Every position is a percentage the rules give (trackOf), and every text comes from them in
// lowercase, set in capitals here. Without a track, the hint stands alone in a plain card; with neither, there's no
// card. It keeps no state, so it renders the same in the island and in the kitchen sink.
export default function PriceTrack({ track, hint }: Props) {
  if (track === null) {
    return hint === null ? null : (
      <p className="rounded-row border-hairline bg-card text-muted-foreground lg:text-body px-4.5 py-4 text-sm leading-normal lg:px-6 lg:py-4.5">
        {hint}
      </p>
    );
  }
  const sides = markerLabelSides(track.markers);
  return (
    <Card className="gap-1 px-4.5 pt-4.5 pb-5 lg:px-7 lg:pt-5.5 lg:pb-6">
      <div className="flex items-baseline justify-between gap-2.5 lg:gap-4">
        <h2 className="text-track-title lg:text-track-title-lg font-extrabold tracking-tight">
          <span className="lg:hidden">Gdzie wypada cena</span>
          <span className="hidden lg:inline">Gdzie wypada dzisiejsza cena</span>
        </h2>
        {track.note !== null && (
          <p className="text-micro tracking-eyebrow text-muted-foreground lg:text-meta font-mono whitespace-nowrap uppercase">
            {track.note}
          </p>
        )}
      </div>
      {hint !== null && <p className="text-compact text-muted-foreground leading-normal lg:text-sm">{hint}</p>}
      <div className="bg-muted relative mx-2 mt-13.5 mb-12 h-2.5 rounded-full lg:mx-2.5 lg:mt-14.5 lg:mb-12.5 lg:h-3">
        {track.band !== null && (
          <div
            className="bg-sun absolute inset-y-0 rounded-full"
            style={{ left: `${track.band.from}%`, width: `${track.band.to - track.band.from}%` }}
          />
        )}
        {track.low !== null && (
          <div
            className="border-foreground absolute -top-2.75 -bottom-2.75 -ml-px border-l-2 border-dashed lg:-top-3 lg:-bottom-3"
            style={{ left: `${track.low.x}%` }}
          >
            <p className="absolute top-full -left-px mt-1.5 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap">
              <span className="text-micro tracking-eyebrow text-muted-foreground font-mono uppercase">
                {track.low.label}
              </span>
              <span className="text-compact font-extrabold lg:text-sm">{track.low.price}</span>
            </p>
          </div>
        )}
        {track.markers.map((marker, index) => (
          <div key={marker.shop} className="absolute top-1/2" style={{ left: `${marker.x}%` }}>
            <span
              aria-hidden="true"
              className={cn(
                "border-marker border-label-ink absolute size-6 -translate-1/2 rounded-full lg:size-6.5",
                SHOP_FILLS[marker.shop],
              )}
            />
            <p
              className={cn(
                "absolute bottom-5 flex flex-col gap-px whitespace-nowrap lg:bottom-5.5",
                LABEL_SIDES[sides[index]],
              )}
            >
              <span className="text-micro tracking-eyebrow text-muted-foreground font-mono uppercase">
                {SHOP_LABELS[marker.shop].name}
              </span>
              <span className="text-track-price tracking-sticker lg:text-track-price-lg font-extrabold">
                {marker.price}
              </span>
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
