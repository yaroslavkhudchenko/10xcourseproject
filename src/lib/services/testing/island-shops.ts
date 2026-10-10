import type { PriceComparisonShop, PricedShop } from "@/lib/services/price-comparison";
import type { LatestPrice, ShopOffer } from "@/types";

// Test helper: Nivea Soft's priced shops as the product's page hands them to its price island, each with a stored
// price, and the clock the island's tests run on, defined once for every test that needs them.

// The server rendered the page at RENDERED; the answers came back a few seconds later.
export const RENDERED = "2026-09-28T12:00:00.000Z";
export const RENDERED_AT = Date.parse(RENDERED);
export const CHECKED_AT = "2026-09-28T12:00:02.000Z";
export const ANSWERED_AT = Date.parse("2026-09-28T12:00:03.000Z");
export const MINUTE = 60 * 1000;

/** The time `ms` before the page was rendered, as an ISO timestamp. */
export const ago = (ms: number) => new Date(RENDERED_AT - ms).toISOString();

/** An offer at `price`, orderable online, with no regular price, 30-day low or promotion's end. */
export const offer = (price: number): ShopOffer => ({
  price,
  regularPrice: null,
  lowestPrice30d: null,
  promoEndsOn: null,
  available: true,
});

/** A stored price, fetched `pricedAgo` before the page was rendered, read without its history. */
export function stored(shop: PricedShop, shopItemId: string, price: number, pricedAgo = 20 * MINUTE): LatestPrice {
  const at = ago(pricedAgo);
  return {
    shop,
    shopItemId,
    lastCheckedAt: at,
    lastStatus: "price",
    offer: { ...offer(price), pricedAt: at },
    history: null,
  };
}

// Each shop with its item's page, so each card ends with "Zobacz w sklepie": Rossmann's 26,99 zł and Natura's 29,99 zł
// for Nivea Soft 300 ml, unless a test hands over another latest check.
export const rossmann = (latest: LatestPrice | null = stored("rossmann", "26900", 26.99)): PriceComparisonShop => ({
  shop: "rossmann",
  shopItemId: "26900",
  productUrl: "https://www.rossmann.pl/Produkt/NIVEA-Soft,26900,13049",
  latest,
});
export const natura = (latest: LatestPrice | null = stored("natura", "NV89063", 29.99)): PriceComparisonShop => ({
  shop: "natura",
  shopItemId: "NV89063",
  productUrl: "https://www.drogerienatura.pl/nivea-soft",
  latest,
});
// Hebe's Nivea Soft 200 ml, by its 18-digit id.
export const HEBE_SOFT_ID = "000000000000218807";
export const hebe = (latest: LatestPrice | null = stored("hebe", HEBE_SOFT_ID, 24.99)): PriceComparisonShop => ({
  shop: "hebe",
  shopItemId: HEBE_SOFT_ID,
  productUrl: "https://www.hebe.pl/nivea-intensywnie-nawilzajacy-krem-do-twarzy-i-ciala-200-ml-000000000000218807.html",
  latest,
});
// Super-Pharm's Nivea Soft 300 ml, by its record's objectID.
export const SUPER_PHARM_SOFT_ID = "10132";
export const superPharm = (
  latest: LatestPrice | null = stored("super-pharm", SUPER_PHARM_SOFT_ID, 19.49),
): PriceComparisonShop => ({
  shop: "super-pharm",
  shopItemId: SUPER_PHARM_SOFT_ID,
  productUrl: "https://www.superpharm.pl/nivea-soft-krem-nawilzajacy-pudelko-39477",
  latest,
});
