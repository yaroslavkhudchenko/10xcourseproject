// Test helper: the rows the stand-in database (stub-supabase.ts) serves for a watched product and its decisions, as
// watchlist_items and watchlist_matches hold them, defined once for every test that needs them.

/** When each stored decision was last checked. */
const CHECKED_AT = "2026-09-27T12:05:00+00:00";

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
    checked_at: CHECKED_AT,
  };
}

/** The item columns of a decision that holds no item: the user's decline, or a lookup that found nothing. */
export const NO_ITEM_COLUMNS = {
  shop_item_id: null,
  name: null,
  brand: null,
  size_text: null,
  size_value: null,
  size_unit: null,
  eans: [],
  product_url: null,
  image_url: null,
};

/** The user's decline in a matched shop, as watchlist_matches holds it. */
export function declinedRow(itemId: string, shop: string) {
  return {
    watchlist_item_id: itemId,
    shop_id: shop,
    state: "unmatched",
    decided_by: "user",
    ...NO_ITEM_COLUMNS,
    checked_at: CHECKED_AT,
  };
}

/** A lookup in a matched shop that found nothing, as watchlist_matches holds it. */
export function notFoundRow(itemId: string, shop: string) {
  return { ...declinedRow(itemId, shop), state: "not_found", decided_by: "auto" };
}

/** A watched product picked in Natura, by Natura's `sku`, as watchlist_items holds it. */
export function naturaProductRow(id: string, sku: string, createdAt?: string) {
  return { ...productRow(id, sku, createdAt), source: "natura" };
}
