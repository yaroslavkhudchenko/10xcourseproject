// The limits every candidate a shop search returns fits, whether a product to add or a shop's item to confirm. The shop
// adapters apply them and the forms check them, so each result a page shows can be saved; the database checks the
// same bounds.
export const PRODUCT_LIMITS = {
  name: 300,
  brand: 120,
  caption: 300,
  sizeText: 40,
  imageUrl: 500,
  eans: 10,
  shopItemId: 40,
  productUrl: 500,
} as const;

// The highest price in złoty that a price observation holds: public.price_observations checks the same bound, a price
// below 100000 in numeric(10, 2) (supabase/migrations/20260928011450_price_observations.sql).
export const PRICE_LIMITS = {
  max: 99999.99,
} as const;
