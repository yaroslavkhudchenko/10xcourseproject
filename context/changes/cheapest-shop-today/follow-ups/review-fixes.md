# Review follow-ups: cheapest-shop-today

These items are deferred out of S-03 by the implementation review (`reviews/impl-review.md`, 2026-09-29). Each one names where it lands. The S-03 migration `20260928011450_price_observations.sql` is on production and frozen, so each database item needs a new migration.

## F4: read the latest prices from the caller's watched items (S-04)

- **The problem:** without keys, `latest_price_observations` reads every observation in the table and filters it by RLS. That is the list page and the list refresh. `EXPLAIN ANALYZE` as `authenticated` read all 62 local rows for a user with 5 items.
  - The last-price lateral walks every newer `missing` row of an item.
  - The product page's `.in("shop_item_id", …)` bounds only the index's second column.
  - The history has no retention, so the main screen's read grows with every fetch. Past the 2 s read limit, the list shows "Nie udało się wczytać cen", and its refresh answers `failed`.
- **In S-04's migration:**
  - Drive the view from the caller's own watched items, their `watchlist_items` plus their `matched` `watchlist_matches`, with two `LIMIT 1` laterals.
  - Add a partial index `(shop_id, shop_item_id, observed_at desc) where status = 'price'`.
  - Filter the product page's read by `shop_id` as well.
  - Extend `scripts/check-prices-db.mjs` for the rewritten view.

## F6: bound the other two amounts (the next migration that touches `price_observations`)

- **The gap:** the table bounds `price` below 100000, but not `regular_price` or `lowest_price_30d`. A crafted insert can carry an absurd "zamiast" or 30-day low, and the island shows it.
- **The fix:** add `< 100000` checks mirroring `PRICE_LIMITS`, with `23514` cases in `check-prices-db.mjs`.

## F3's trade-off: stop asking a shop that keeps failing (later, before lists grow)

- **The trade-off:** since F3, Rossmann's detail requests go out one at a time. A failed request (a timeout, network error or unreadable answer) doesn't stop the loop, because only busy, paused and stopped do.
- **The cost:** a hanging Rossmann therefore costs its 5 s timeout per product in turn. A 5-product list refresh during an outage takes about 25 s before it shows "Nie udało się odświeżyć cen".
- **The fix:** after two failed requests in a row, give that shop's remaining targets `failed` without a request. Add tests in `price-refresh.test.ts`, and apply the same rule to Natura's batches.
