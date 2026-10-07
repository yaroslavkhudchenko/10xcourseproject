import { cn } from "@/lib/utils";

/**
 * What a sticker says: a fact about the product's prices, "Tylko 1 sklep" (`one-shop`) and "Stara cena" (`stale`), or
 * the judgement of today's cheapest price (judgementOf, FR-012), "Dobra cena!" (`good`) below what it was compared with
 * and "Zwykła cena" (`ordinary`) at it or above.
 */
export type StickerKind = "one-shop" | "stale" | "good" | "ordinary";

interface Props {
  kind: StickerKind;
  /** 128 px, on a desktop's hero, or 86 px, on a phone's. */
  size: "lg" | "sm";
  className?: string;
}

// The starburst's outline, computed once: 24 points around the centre, starting straight up, every other one on the
// outer radius (50 % of the sticker) and the rest on the inner one (41 %). The ink and the fill share it.
const STARBURST = `polygon(${Array.from({ length: 24 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 24 - Math.PI / 2;
  const radius = index % 2 === 0 ? 50 : 41;
  return `${(50 + radius * Math.cos(angle)).toFixed(2)}% ${(50 + radius * Math.sin(angle)).toFixed(2)}%`;
}).join(", ")})`;

const STICKERS: Record<StickerKind, { lines: [string, string]; fill: string }> = {
  "one-shop": { lines: ["Tylko", "1 sklep"], fill: "bg-sticker-info" },
  stale: { lines: ["Stara", "cena"], fill: "bg-sticker-plain" },
  good: { lines: ["Dobra", "cena!"], fill: "bg-sticker-good" },
  ordinary: { lines: ["Zwykła", "cena"], fill: "bg-sticker-plain" },
};

// The label is 17 % of the sticker's size, as global.css's --text-sticker-* tokens round it.
const SIZES = {
  lg: { box: "size-32", label: "text-sticker-lg" },
  sm: { box: "size-21.5", label: "text-sticker-sm" },
};

// The starburst sticker on the verdict's hero: an ink layer, the fill 3 px inside it, and the label on two lines,
// tilted 12°. It stamps once as it appears, unless the user asked for reduced motion. It's decorative: the hero's
// eyebrow says a fact in text, and the price track's card the judgement. The hero places it.
export default function Sticker({ kind, size, className }: Props) {
  const { lines, fill } = STICKERS[kind];
  const look = SIZES[size];
  return (
    <span
      aria-hidden="true"
      className={cn("motion-safe:animate-stamp pointer-events-none relative block rotate-12", look.box, className)}
    >
      <span className="bg-label-ink absolute inset-0" style={{ clipPath: STARBURST }} />
      <span className={cn("absolute inset-0.75", fill)} style={{ clipPath: STARBURST }} />
      <span
        className={cn(
          "tracking-sticker text-label-ink absolute inset-0 flex flex-col items-center justify-center text-center font-extrabold",
          look.label,
        )}
      >
        {lines.map((line) => (
          <span key={line} className="whitespace-nowrap">
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}
