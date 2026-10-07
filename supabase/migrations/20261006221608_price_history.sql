-- Price history (S-04, FR-012): the owner's good-price rule of 2026-10-06 (judgementOf in
-- src/lib/services/price-comparison.ts) compares today's cheapest price with the product's own history once it's
-- enough: the lowest price the app saw for the product in its shops in the 30 days in Poland before today, and on how
-- many of those days. A view gives each shop item's latest state, as latest_price_observations does, with that
-- history. It's a view of its own because only the product page judges a price: the page reads it in place of
-- latest_price_observations, still in its one read of prices, while the list keeps the lighter view.
--
-- The same migration closes two of S-03's review follow-ups
-- (context/archive/2026-09-28-cheapest-shop-today/follow-ups/review-fixes.md): F6, the bounds on the regular price and
-- the 30-day low, and F4's partial index on priced checks. F4's rework of latest_price_observations, which would drive
-- it from the caller's watched items instead of the whole table, is left for a later change.

-- F6: the regular price and the 30-day low stay below 100000, as the price does, within PRICE_LIMITS
-- (src/lib/services/product-limits.ts), so a crafted insert can't put an absurd amount beside a price. A missing amount
-- passes, as a check passes any NULL. Every adapter already drops an amount above the bound (storableOffer in
-- src/lib/services/shops/shop-offer.ts), so no stored row should fail them; one that does fails the whole migration,
-- which then applies nothing.
alter table public.price_observations
  add constraint price_observations_regular_price_bounded check (regular_price < 100000),
  add constraint price_observations_lowest_price_30d_bounded check (lowest_price_30d < 100000);

-- F4's index: each item's priced checks, newest first. Both views look up prices among them alone, the latest price and
-- the history, without walking the item's missing checks.
create index price_observations_priced_item_observed_at_idx
  on public.price_observations (shop_id, shop_item_id, observed_at desc)
  where status = 'price';

-- Each shop item's latest state with its history, for the product page. It's built on latest_price_observations, so the
-- latest check is defined in one place, and F4's rework of that view reaches this one too.
-- - The history counts only the checks that found the item orderable online (status 'price' and available), from the
--   start of the day 30 days before today in Poland to the start of today. So today's own checks never count: the
--   comparison doesn't move during the day, and a price is never compared with itself.
-- - history_low is their lowest price, and history_days the days in Poland they were made on, each once and in order.
--   With no such check, there's no low and no day.
-- - The 30 days mirror HISTORY_WINDOW_DAYS (src/lib/services/price-comparison.ts): changing it needs a migration too.
-- security_invoker applies the caller's own RLS and column grants to every read of the table, this view's and
-- latest_price_observations', so each user sees only the items they watch, with their history.
create view public.price_summaries
with (security_invoker = true)
as
select
  latest.shop_id,
  latest.shop_item_id,
  latest.last_checked_at,
  latest.last_status,
  latest.price,
  latest.regular_price,
  latest.lowest_price_30d,
  latest.promo_ends_on,
  latest.available,
  latest.priced_at,
  history.history_low,
  history.history_days
from public.latest_price_observations as latest
left join lateral (
  select
    min(o.price)::numeric(10, 2) as history_low,
    coalesce(
      array_agg(
        distinct (o.observed_at at time zone 'Europe/Warsaw')::date
        order by (o.observed_at at time zone 'Europe/Warsaw')::date
      ),
      '{}'::date[]
    ) as history_days
  from public.price_observations as o
  where o.shop_id = latest.shop_id
    and o.shop_item_id = latest.shop_item_id
    and o.status = 'price'
    and o.available
    and o.observed_at >= ((now() at time zone 'Europe/Warsaw')::date - 30)::timestamp at time zone 'Europe/Warsaw'
    and o.observed_at < (now() at time zone 'Europe/Warsaw')::date::timestamp at time zone 'Europe/Warsaw'
) as history on true;

comment on view public.price_summaries is
  'Each visible shop item''s last check and last price, with its orderable prices of the 30 days before today.';

-- The same leftover defaults as on the table; signed-in users only read.
revoke all on table public.price_summaries from anon, authenticated, service_role;
grant select on table public.price_summaries to authenticated;
