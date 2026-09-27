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
