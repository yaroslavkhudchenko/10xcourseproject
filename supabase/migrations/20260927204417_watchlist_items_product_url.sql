-- The product's own page in the shop it was picked from (S-02), so its page can link there ("Zobacz w sklepie").
-- Products added before this have none. The table's grants already cover a new column, and RLS keeps it private.
alter table public.watchlist_items
  add column product_url text,
  -- The same bound as PRODUCT_LIMITS.productUrl (src/lib/services/product-limits.ts).
  add constraint watchlist_items_product_url_https check (product_url ~ '^https://' and char_length(product_url) <= 500);
