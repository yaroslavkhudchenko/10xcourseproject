import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge knows Tailwind's own scale, not the one src/styles/global.css's @theme adds, and reads a name it
// doesn't know by its prefix alone: it takes text-price-hero for a text colour, so text-price-hero beside
// text-label-ink would be dropped, and border-hairline beside border-border too. Each size, radius, shadow, tracking,
// animation and border width the @theme adds is named here, in the kind Tailwind makes it, so cn() keeps it and merges
// it with its own kind. src/lib/utils.test.ts reads global.css and fails for one missing here.
const TEXT_SIZES = [
  "product-title",
  "product-title-lg",
  "list-title",
  "list-title-lg",
  "hero-shop",
  "hero-shop-lg",
  "price-hero",
  "price-hero-lg",
  "price-hero-grosze",
  "price-hero-grosze-lg",
  "price-hero-unit",
  "price-hero-unit-lg",
  "price-card",
  "price-card-lg",
  "price-card-grosze",
  "price-card-grosze-lg",
  "price-card-unit",
  "price-card-unit-lg",
  "price-tag",
  "price-tag-grosze",
  "shop-name",
  "shop-name-lg",
  "wordmark-sm",
  "wordmark-lg",
  "sticker-sm",
  "sticker-lg",
  "thumb-title",
  "thumb-title-lg",
  "compact",
  "body",
  "meta",
  "micro",
];
const TRACKINGS = ["price", "title", "heading", "wordmark", "sticker", "meta", "eyebrow", "tag"];
const RADII = [
  "tag",
  "button-sm",
  "button",
  "thumb",
  "thumb-title",
  "thumb-title-lg",
  "search",
  "search-button",
  "kbd",
  "price-tag",
  "row",
  "card",
  "card-lg",
  "hero",
  "hero-lg",
];
const SHADOWS = ["primary", "hero", "hero-lg", "selected"];
const ANIMATIONS = ["stamp"];
// The border widths, which Tailwind draws on every side: border-hairline, border-t-hairline and so on.
const BORDER_WIDTHS = ["hairline"];

const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: TEXT_SIZES, tracking: TRACKINGS, radius: RADII, shadow: SHADOWS, animate: ANIMATIONS },
    classGroups: {
      "border-w": [{ border: BORDER_WIDTHS }],
      "border-w-x": [{ "border-x": BORDER_WIDTHS }],
      "border-w-y": [{ "border-y": BORDER_WIDTHS }],
      "border-w-s": [{ "border-s": BORDER_WIDTHS }],
      "border-w-e": [{ "border-e": BORDER_WIDTHS }],
      "border-w-bs": [{ "border-bs": BORDER_WIDTHS }],
      "border-w-be": [{ "border-be": BORDER_WIDTHS }],
      "border-w-t": [{ "border-t": BORDER_WIDTHS }],
      "border-w-r": [{ "border-r": BORDER_WIDTHS }],
      "border-w-b": [{ "border-b": BORDER_WIDTHS }],
      "border-w-l": [{ "border-l": BORDER_WIDTHS }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
