import { PRICE_LIMITS } from "@/lib/services/product-limits";
import type { ShopOffer } from "@/types";

// Shared by the shop adapters, so every shop's offer fits public.price_observations in the same way: a refresh stores
// all its checks with one insert, which a single offer outside the table's checks would fail.

/**
 * An amount in złoty as the table stores it, rounded to grosze like its numeric(10, 2) columns, or null unless it's
 * above 0 and within PRICE_LIMITS.
 */
function storableAmount(amount: number | null): number | null {
  if (amount === null || !Number.isFinite(amount)) {
    return null;
  }
  const rounded = Math.round(amount * 100) / 100;
  return rounded > 0 && rounded <= PRICE_LIMITS.max ? rounded : null;
}

/**
 * The offer a shop sent, as it can be stored: its amounts rounded to grosze, and a regular price only above the price.
 * A regular price or 30-day low that doesn't fit is dropped, so it costs only itself. Null when the price itself
 * doesn't fit, which the adapters report as a check that failed.
 */
export function storableOffer(offer: ShopOffer): ShopOffer | null {
  const price = storableAmount(offer.price);
  if (price === null) {
    return null;
  }
  const regularPrice = storableAmount(offer.regularPrice);
  return {
    price,
    regularPrice: regularPrice !== null && regularPrice > price ? regularPrice : null,
    lowestPrice30d: storableAmount(offer.lowestPrice30d),
    promoEndsOn: offer.promoEndsOn,
    available: offer.available,
  };
}
