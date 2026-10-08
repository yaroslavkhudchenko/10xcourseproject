import { z } from "astro/zod";
import type { MatchableShop } from "@/lib/services/price-comparison";
import { SHOP_ADAPTERS } from "@/lib/services/shops/registry";

// Checks shared by the app's own forms, whose fields come back from its pages: "Dodaj" on the watchlist and a
// product's match decisions. Both are held to PRODUCT_LIMITS and the database checks, and a shop's item in either to
// the rules of its own shop's adapter (SHOP_ADAPTERS), so they stay in one place.

/** An optional text field: trimmed, capped, and null when empty. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

/** A shop's item as a form posts it: its shop, and its links, null for none, as linksOfShop checks them. */
export interface LinkedFields {
  shop: MatchableShop;
  productUrl: string | null;
  imageUrl: string | null;
}

/**
 * Whether a posted item's links, when it has them, are on the hosts its own shop's adapter accepts: its product page
 * and its image. An item of one shop can't carry another shop's links into the user's row, whether "Dodaj" adds it as
 * a product or a decision confirms it as a candidate.
 */
export function linksOfShop({ shop, productUrl, imageUrl }: LinkedFields): boolean {
  const { isProductUrl, isImage } = SHOP_ADAPTERS[shop];
  return (productUrl === null || isProductUrl(productUrl)) && (imageUrl === null || isImage(imageUrl));
}
