-- Shop matches (S-02): per user and product, what each shop's match is: an item, a shop the user declined or a lookup
-- that found nothing. The database holds the ownership and immutability rules, and watchlist_items gets the bounds
-- S-01 left to the "Dodaj" form.

-- The same limits as PRODUCT_LIMITS (src/lib/services/product-limits.ts), which the "Dodaj" route already applied to
-- every existing row. A row that doesn't fit fails the whole migration, which then applies nothing.
alter table public.watchlist_items
  -- The target of the composite key below, which ties every match to a product of the same user.
  add constraint watchlist_items_id_owner unique (id, user_id),
  add constraint watchlist_items_source_item_id_format check (source_item_id ~ '^[A-Za-z0-9._-]{1,40}$'),
  add constraint watchlist_items_brand_length check (char_length(brand) <= 120),
  add constraint watchlist_items_caption_length check (char_length(caption) <= 300),
  add constraint watchlist_items_size_text_length check (char_length(size_text) <= 40),
  add constraint watchlist_items_image_url_https check (image_url ~ '^https://' and char_length(image_url) <= 500),
  -- At most 10 EANs of 8 to 14 digits each. A null element is written as '*', so it fails the pattern too.
  add constraint watchlist_items_eans_bounded check (
    cardinality(eans) <= 10 and array_to_string(eans, ',', '*') ~ '^([0-9]{8,14}(,[0-9]{8,14})*)?$'
  );

create table public.watchlist_matches (
  id uuid primary key default gen_random_uuid(),
  -- The owner. It needs no reference of its own: the composite key below requires the product to be this user's, and
  -- the product's row goes when its user does.
  user_id uuid not null default auth.uid(),
  watchlist_item_id uuid not null,
  shop_id text not null references public.shops (id),
  -- matched: an item accepted automatically or confirmed by the user. unmatched: the user chose "Żaden z nich".
  -- not_found: the lookup found nothing, so a retry may still change it.
  state text not null check (state in ('matched', 'unmatched', 'not_found')),
  decided_by text not null check (decided_by in ('auto', 'user')),
  -- The shop's item, set only for a match: its id in the shop and a copy of what the shop showed for it.
  shop_item_id text check (shop_item_id ~ '^[A-Za-z0-9._-]{1,40}$'),
  name text check (char_length(name) between 1 and 300),
  brand text check (char_length(brand) <= 120),
  size_text text check (char_length(size_text) <= 40),
  size_value numeric check (size_value > 0),
  size_unit text check (size_unit in ('ml', 'g', 'pcs')),
  -- Helpers for later lookups, as on watchlist_items; the confirmed item is the anchor (FR-004).
  eans text[] not null default '{}',
  product_url text check (product_url ~ '^https://' and char_length(product_url) <= 500),
  image_url text check (image_url ~ '^https://' and char_length(image_url) <= 500),
  -- When the decision was made or the lookup last ran.
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Foreign-key checks bypass RLS, so a reference to the product's id alone would let a user attach a match to another
  -- user's product. Referencing the product together with its owner rules that out.
  constraint watchlist_matches_own_product foreign key (watchlist_item_id, user_id)
    references public.watchlist_items (id, user_id) on delete cascade,
  -- One decision per product and shop. The owner is part of the key: Postgres checks it before the foreign key, so
  -- without the owner another user's insert could collide with the real row and tell them the product has a decision.
  constraint watchlist_matches_one_per_shop unique (watchlist_item_id, user_id, shop_id),
  -- Only the user declines a shop, and only the lookup finds nothing.
  constraint watchlist_matches_decider_fits_state check (
    state = 'matched' or (state = 'unmatched' and decided_by = 'user') or (state = 'not_found' and decided_by = 'auto')
  ),
  -- A match names the shop's item; a decline or a lookup that found nothing carries none of its fields.
  constraint watchlist_matches_item_only_when_matched check (
    case
      when state = 'matched' then shop_item_id is not null and name is not null
      else shop_item_id is null and name is null and brand is null and size_text is null and size_value is null
        and size_unit is null and cardinality(eans) = 0 and product_url is null and image_url is null
    end
  ),
  constraint watchlist_matches_size_complete check ((size_value is null) = (size_unit is null)),
  constraint watchlist_matches_eans_bounded check (
    cardinality(eans) <= 10 and array_to_string(eans, ',', '*') ~ '^([0-9]{8,14}(,[0-9]{8,14})*)?$'
  )
);

comment on table public.watchlist_matches is
  'Shop matches, private per user: one decision per watched product and shop. Only not_found changes before S-08.';

-- One policy per operation: a user reads and adds only their own matches, and changes only a lookup that found
-- nothing, when a retry finds the product or the user decides after it. Every other decision stays until re-pinning
-- (S-08), and there is no delete path.
alter table public.watchlist_matches enable row level security;

create policy watchlist_matches_select_own on public.watchlist_matches
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy watchlist_matches_insert_own on public.watchlist_matches
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy watchlist_matches_update_own_not_found on public.watchlist_matches
  for update to authenticated
  using ((select auth.uid()) = user_id and state = 'not_found')
  with check ((select auth.uid()) = user_id);

-- Revoke the leftover defaults first (turning off auto-exposure still leaves TRUNCATE, REFERENCES and TRIGGER), then
-- grant signed-in users exactly what the policies allow.
revoke all on table public.watchlist_matches from anon, authenticated, service_role;
grant select, insert, update on table public.watchlist_matches to authenticated;
