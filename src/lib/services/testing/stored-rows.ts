// Test helper: the rows the stand-in database (stub-supabase.ts) serves for a watched product and its decisions, as
// watchlist_items and watchlist_matches hold them, defined once for every route's tests.

/** A watched product of Rossmann's `sourceItemId`, as watchlist_items holds it. */
export function productRow(id: string, sourceItemId: string, createdAt = "2026-09-27T12:00:00+00:00") {
  return {
    id,
    source: "rossmann",
    source_item_id: sourceItemId,
    brand: "NIVEA",
    name: `Produkt ${sourceItemId}`,
    caption: null,
    size_text: "300 ml",
    size_value: 300,
    size_unit: "ml",
    eans: [],
    product_url: null,
    image_url: null,
    created_at: createdAt,
  };
}

/** A product's match in a matched shop, as watchlist_matches holds it. */
export function matchRow(itemId: string, shop: string, shopItemId: string) {
  return {
    watchlist_item_id: itemId,
    shop_id: shop,
    state: "matched",
    decided_by: "user",
    shop_item_id: shopItemId,
    name: `Produkt ${shopItemId}`,
    brand: "NIVEA",
    size_text: "300 ml",
    size_value: 300,
    size_unit: "ml",
    eans: [],
    product_url: null,
    image_url: null,
    checked_at: "2026-09-27T12:05:00+00:00",
  };
}

/** A watched product picked in Natura, by Natura's `sku`, as watchlist_items holds it. */
export function naturaProductRow(id: string, sku: string, createdAt?: string) {
  return { ...productRow(id, sku, createdAt), source: "natura" };
}
