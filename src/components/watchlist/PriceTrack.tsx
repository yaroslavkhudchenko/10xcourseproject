import { Card } from "@/components/ui/card";
import {
  markerSteps,
  trackLabels,
  type MarkerLabelSide,
  type Track,
} from "@/components/watchlist/price-comparison-state";
import { SHOP_FILLS } from "@/components/watchlist/shop-fills";
import { SHOP_LABELS } from "@/lib/services/price-comparison";
import { cn } from "@/lib/utils";

interface Props {
  /** Where the prices sit (trackOf), or null when there are fewer than two values to place. */
  track: Track | null;
  /** What the card says beside the track, or in its place (trackHint). */
  hint: string | null;
}

// A label: centred on its place, or turned away from a close neighbour (trackLabels), 4 px off its marker's centre.
// Written out whole, so Tailwind finds each class.
const LABEL_SIDES: Record<MarkerLabelSide, string> = {
  center: "left-0 -translate-x-1/2 items-center",
  end: "right-1 items-end",
  start: "left-1 items-start",
};

// A circle's step aside from the others at its price (markerSteps), 4 px a half-step, so their centres stand 8 px
// apart. Written out whole, so Tailwind finds each class.
const STEP_SHIFTS: Record<number, string> = {
  [-3]: "-ml-3",
  [-2]: "-ml-2",
  [-1]: "-ml-1",
  0: "",
  1: "ml-1",
  2: "ml-2",
  3: "ml-3",
};

// The room above the bar for the tallest label, by its lines of names: each name line takes 16 px. Written out whole,
// so Tailwind finds each class.
const TRACK_TOPS: Record<number, string> = {
  1: "mt-13.5 lg:mt-14.5",
  2: "mt-17.5 lg:mt-18.5",
  3: "mt-21.5 lg:mt-22.5",
  4: "mt-25.5 lg:mt-26.5",
};

// The price track's card: "Gdzie wypada dzisiejsza cena" ("Gdzie wypada cena" on a phone), with the note on the right
// and the hint below it, over the track: a bar in the raised fill, the sun's band from the lowest to the highest shop
// price, a marker in each shop's colour, markers at the same price stepped aside so each colour shows, the labels above
// them with each shop's name and price, a close run's sharing one, and the dashed tick of the 30-day low its shop
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
  const labels = trackLabels(track.markers);
  const steps = markerSteps(track.markers);
  const lines = Math.min(Math.max(1, ...labels.map(({ shops }) => shops.length)), 4);
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
      <div
        className={cn("bg-muted relative mx-2 mb-12 h-2.5 rounded-full lg:mx-2.5 lg:mb-12.5 lg:h-3", TRACK_TOPS[lines])}
      >
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
          <span
            key={marker.shop}
            aria-hidden="true"
            className={cn(
              "border-marker border-label-ink absolute top-1/2 size-6 -translate-1/2 rounded-full lg:size-6.5",
              SHOP_FILLS[marker.shop],
              STEP_SHIFTS[steps[index]],
            )}
            style={{ left: `${marker.x}%` }}
          />
        ))}
        {labels.map((label) => (
          <div key={label.shops.join(" ")} className="absolute top-1/2" style={{ left: `${label.x}%` }}>
            <p
              className={cn(
                "absolute bottom-5 flex flex-col gap-px whitespace-nowrap lg:bottom-5.5",
                LABEL_SIDES[label.side],
              )}
            >
              {label.shops.map((shop) => (
                <span key={shop} className="text-micro tracking-eyebrow text-muted-foreground font-mono uppercase">
                  {SHOP_LABELS[shop].name}
                </span>
              ))}
              <span className="text-track-price tracking-sticker lg:text-track-price-lg font-extrabold">
                {label.price}
              </span>
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
