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

// The highest amount in złoty that a price observation holds, its price, regular price and 30-day low alike:
// public.price_observations checks the same bound on each, below 100000 in numeric(10, 2), the price's in
// supabase/migrations/20260928011450_price_observations.sql and the other two's in 20261006221608_price_history.sql.
export const PRICE_LIMITS = {
  max: 99999.99,
} as const;
