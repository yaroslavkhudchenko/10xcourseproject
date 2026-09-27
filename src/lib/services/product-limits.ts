// The limits every product candidate fits. The shop adapters apply them and the "Dodaj" form checks them, so each
// result a search shows can be added.
export const PRODUCT_LIMITS = {
  name: 300,
  brand: 120,
  caption: 300,
  sizeText: 40,
  imageUrl: 500,
  eans: 10,
} as const;
