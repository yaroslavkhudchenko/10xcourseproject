-- Price observations (S-03): every price check of a shop item, kept as a shared row that the item's watchers can read
-- and add to and that nobody can change or remove. The database sets each row's time, source and recording user, and a
-- view gives each item's latest state. S-02's review follow-ups (F5) ride along: stricter EAN checks on both of its
-- tables, and an update grant on watchlist_matches that covers only the decision.

-- The same EAN rule as before, plus: no element holds a comma, and the array has one dimension. The old rule joined the
-- elements with commas, so an element such as '40059000,40059001', or a two-dimensional array, read as a list of EANs.
-- Every stored row came through the digit-only form and adapter checks; a row that doesn't fit fails the whole
-- migration, which then applies nothing.
alter table public.watchlist_items
  drop constraint watchlist_items_eans_bounded,
  add constraint watchlist_items_eans_bounded check (
    cardinality(eans) <= 10 and array_to_string(eans, ',', '*') ~ '^([0-9]{8,14}(,[0-9]{8,14})*)?$'
      and strpos(array_to_string(eans, '', '*'), ',') = 0 and coalesce(array_ndims(eans), 1) = 1
  );

alter table public.watchlist_matches
  drop constraint watchlist_matches_eans_bounded,
  add constraint watchlist_matches_eans_bounded check (
    cardinality(eans) <= 10 and array_to_string(eans, ',', '*') ~ '^([0-9]{8,14}(,[0-9]{8,14})*)?$'
      and strpos(array_to_string(eans, '', '*'), ',') = 0 and coalesce(array_ndims(eans), 1) = 1
  );

-- A lookup that found nothing changes only as a decision, never which product, shop or user it belongs to: the update
-- grant covers the columns recordLookup and recordDecision write (src/lib/services/matches.ts) and no others. The
-- table-wide grant is revoked first: next to it, a column grant would limit nothing.
revoke update on table public.watchlist_matches from authenticated;
grant update (
  state, decided_by, shop_item_id, name, brand, size_text, size_value, size_unit, eans, product_url, image_url,
  checked_at
) on table public.watchlist_matches to authenticated;

create table public.price_observations (
  id uuid primary key default gen_random_uuid(),
  -- The shop and its own id for the item: Rossmann's product id or Natura's SKU. Nothing references a watched product
  -- or a user, so removing either never deletes an observation (FR-005).
  shop_id text not null references public.shops (id),
  -- The characters the shops' ids use, with a letter or digit required, so never a dot segment such as '..'.
  shop_item_id text not null check (shop_item_id ~ '^[A-Za-z0-9._-]{1,40}$' and shop_item_id ~ '[A-Za-z0-9]'),
  -- price: the shop answered with the item's offer. missing: the shop answered without the item.
  status text not null check (status in ('price', 'missing')),
  -- The online price in złoty, never a shelf price, within PRICE_LIMITS (src/lib/services/product-limits.ts).
  price numeric(10, 2) check (price > 0 and price < 100000),
  -- The price before a promotion, only while one runs.
  regular_price numeric(10, 2),
  -- The lowest price of the last 30 days, as the shop reports it.
  lowest_price_30d numeric(10, 2) check (lowest_price_30d > 0),
  promo_ends_on date,
  -- Whether the item can be ordered online.
  available boolean,
  -- The shop fetch is the only source until manual entry (FR-009) lands. Users can't set it, the time or the recording
  -- user: the insert grant below leaves all three to these defaults.
  source text not null default 'fetch' check (source in ('fetch')),
  observed_at timestamptz not null default now(),
  -- Who recorded it, with no reference to the user, so deleting a user never deletes observations.
  recorded_by uuid not null default auth.uid(),
  constraint price_observations_regular_above_price check (regular_price > price),
  -- A price carries its offer, at least the price and whether it can be ordered; a missing item carries none of it.
  constraint price_observations_offer_only_with_price check (
    case
      when status = 'price' then price is not null and available is not null
      else price is null and regular_price is null and lowest_price_30d is null and promo_ends_on is null
        and available is null
    end
  )
);

comment on table public.price_observations is
  'Price checks of shop items, shared by each item''s watchers. Append-only; time, source and recorder set here.';

-- Each item's history, newest first, for the view's latest check and latest price.
create index price_observations_item_observed_at_idx
  on public.price_observations (shop_id, shop_item_id, observed_at desc);

-- The policies' second way of watching an item, a match in that shop. The first, a product on the user's list, already
-- has the index behind watchlist_items_one_per_product (user_id, source, source_item_id).
create index watchlist_matches_matched_item_idx
  on public.watchlist_matches (user_id, shop_id, shop_item_id)
  where state = 'matched';

-- One policy per operation: a user reads and adds observations only of shop items they watch, that is, a product on
-- their list (its item in the shop it was picked from) or its match in another shop. There is no update or delete path.
-- The observation's columns are qualified with the table's name: watchlist_matches has columns of the same names,
-- which would otherwise stand in for them.
-- Accepted risks (S-03 plan): a watcher can add a plausible price of their own, because the app has no server-only key,
-- and people watching the same item see each other's check times.
alter table public.price_observations enable row level security;

create policy price_observations_select_watched on public.price_observations
  for select to authenticated
  using (
    exists (
      select 1
      from public.watchlist_items as w
      where w.user_id = (select auth.uid())
        and w.source = price_observations.shop_id
        and w.source_item_id = price_observations.shop_item_id
    )
    or exists (
      select 1
      from public.watchlist_matches as m
      where m.user_id = (select auth.uid())
        and m.state = 'matched'
        and m.shop_id = price_observations.shop_id
        and m.shop_item_id = price_observations.shop_item_id
    )
  );

create policy price_observations_insert_watched on public.price_observations
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.watchlist_items as w
      where w.user_id = (select auth.uid())
        and w.source = price_observations.shop_id
        and w.source_item_id = price_observations.shop_item_id
    )
    or exists (
      select 1
      from public.watchlist_matches as m
      where m.user_id = (select auth.uid())
        and m.state = 'matched'
        and m.shop_id = price_observations.shop_id
        and m.shop_item_id = price_observations.shop_item_id
    )
  );

-- Revoke the leftover defaults first (turning off auto-exposure still leaves TRUNCATE, REFERENCES and TRIGGER), then
-- grant signed-in users exactly what the policies allow: reading every column but the recording user, and adding only
-- what a check found. So an insert never asks for its row back, and every read names its columns.
revoke all on table public.price_observations from anon, authenticated, service_role;
grant select (
  id, shop_id, shop_item_id, status, price, regular_price, lowest_price_30d, promo_ends_on, available, source,
  observed_at
) on table public.price_observations to authenticated;
grant insert (shop_id, shop_item_id, status, price, regular_price, lowest_price_30d, promo_ends_on, available)
  on table public.price_observations to authenticated;

-- Each shop item's latest state, for the pages: when it was last checked and what that check found, and its latest
-- price, which a later check that found the item missing doesn't erase. security_invoker applies the table's RLS and
-- column grants to the caller, so each user sees only the items they watch. It names no recording user, which the
-- caller couldn't read.
create view public.latest_price_observations
with (security_invoker = true)
as
select
  last_check.shop_id,
  last_check.shop_item_id,
  last_check.observed_at as last_checked_at,
  last_check.status as last_status,
  last_price.price,
  last_price.regular_price,
  last_price.lowest_price_30d,
  last_price.promo_ends_on,
  last_price.available,
  last_price.observed_at as priced_at
from (
  select distinct on (shop_id, shop_item_id) shop_id, shop_item_id, status, observed_at
  from public.price_observations
  order by shop_id, shop_item_id, observed_at desc
) as last_check
left join lateral (
  select o.price, o.regular_price, o.lowest_price_30d, o.promo_ends_on, o.available, o.observed_at
  from public.price_observations as o
  where o.shop_id = last_check.shop_id
    and o.shop_item_id = last_check.shop_item_id
    and o.status = 'price'
  order by o.observed_at desc
  limit 1
) as last_price on true;

comment on view public.latest_price_observations is
  'Each visible shop item''s last check and last price, under the caller''s own RLS and column grants.';

-- The same leftover defaults as on the table; signed-in users only read.
revoke all on table public.latest_price_observations from anon, authenticated, service_role;
grant select on table public.latest_price_observations to authenticated;
