-- Watchlist (S-01): each user's watched products, private to that user. A row carries its own copy of the picked
-- product, so nothing about one user's list lives in a row another user can see.

create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The shop whose search the product came from, and that shop's own product id.
  source text not null references public.shops (id),
  source_item_id text not null,
  brand text,
  name text not null check (char_length(name) between 1 and 300),
  caption text,
  -- The size as the shop wrote it, and parsed into ml, g or pieces when that was possible.
  size_text text,
  size_value numeric check (size_value > 0),
  size_unit text check (size_unit in ('ml', 'g', 'pcs')),
  -- EANs are helpers for later shop lookups, never the product's identity (FR-004).
  eans text[] not null default '{}',
  image_url text,
  created_at timestamptz not null default now(),
  constraint watchlist_items_size_complete check ((size_value is null) = (size_unit is null)),
  constraint watchlist_items_one_per_product unique (user_id, source, source_item_id)
);

comment on table public.watchlist_items is
  'Watched products, private per user. Removing an entry (S-08) hides it and never deletes shared data.';

-- One policy per operation: a user reads and adds only their own rows. There is no update or delete path.
alter table public.watchlist_items enable row level security;

create policy watchlist_items_select_own on public.watchlist_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy watchlist_items_insert_own on public.watchlist_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Revoke the leftover defaults first (turning off auto-exposure still leaves TRUNCATE, REFERENCES and TRIGGER), then
-- grant signed-in users exactly what the policies allow.
revoke all on table public.watchlist_items from anon, authenticated, service_role;
grant select, insert on table public.watchlist_items to authenticated;
