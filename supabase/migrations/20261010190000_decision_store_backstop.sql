-- The decision store's backstop (roadmap M-2's S-02): the database itself refuses a decision in its watched product's
-- own shop, for every caller, a direct database call included, and one function saves any decision, a lookup's or the
-- user's, in one statement. No table grant, policy or column changes, so the code deployed before this, which inserts a
-- decision and, on a conflict, updates it, keeps saving against this schema.

-- 1. The decisions stored in their product's own shop, the shop it was picked in (watchlist_items.source), go first, so
-- the rule the trigger below keeps holds for every row. No page reads one, since every read narrows a product's
-- decisions to its matched shops, but a stored match still keeps its shop item watched under the price policies
-- (20260928011450_price_observations.sql). None is expected: no page offers one, and only a crafted post before the
-- decision route's guardian, or a direct call, could store one. A delete can't be undone, so the owner counts them, by
-- state, and all decisions, before the push, and counts again after it.
delete from public.watchlist_matches as m
using public.watchlist_items as i
where i.id = m.watchlist_item_id and i.user_id = m.user_id and m.shop_id = i.source;

-- 2. The backstop: a product holds no decision in its own shop. A before-insert row trigger, the project's first, runs
-- for every proposed row before RLS's insert check, the table's checks and the one-decision-per-shop key, and once per
-- row, also when an insert then takes its on-conflict update. It reads the product as its caller (security invoker, so
-- under RLS): another user's product, like one no one has, reads as none, and the insert goes on to the composite key,
-- which refuses both alike (23503). A trigger that read every product would refuse another user's with a code of its
-- own, and so tell the caller which shop that product came from. Its 23001 (restrict_violation) is neither the 23503
-- that record_decision reads as gone nor the shape checks' 23514. It returns the row whenever it doesn't raise: one
-- that returned none would drop the row silently, which a save would read as decided.
create function public.refuse_own_shop_decision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.watchlist_items as i
    where i.id = new.watchlist_item_id
      and i.user_id = new.user_id
      and i.source = new.shop_id
  ) then
    raise exception 'watchlist_matches_not_own_shop: a product holds no decision in its own shop'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger watchlist_matches_not_own_shop
  before insert on public.watchlist_matches
  for each row execute function public.refuse_own_shop_decision();

-- No API role calls the trigger's function, and it fires without a grant: PostgreSQL checks EXECUTE on it only when the
-- trigger is created. Postgres grants execute on a new function to PUBLIC, and Supabase's default privileges may grant
-- it to the API roles, so take it back from PUBLIC, anon and authenticated.
revoke all on function public.refuse_own_shop_decision() from public, anon, authenticated;

-- 3. The save: one statement stores a product's decision in one shop, a lookup's (an automatic match or "not found") or
-- the user's (a confirmed item or a decline), and answers what became of it.
-- - saved: the decision was inserted, or it replaced the decision the save expects: none, which also stands for a
--   lookup that found nothing; a match, by its item and who decided it; or the user's decline. A replaced decision's
--   checked_at takes the database's clock, as an inserted one's does.
-- - decided: another decision stood, so nothing was written.
-- - gone: the caller has no such product, another user's included, which the composite key refuses as it refuses an id
--   no one has. A removal whose delete reaches the decision first, or the product while none is stored, makes the
--   insert wait and start again, which that key then refuses, so a removal never reads as decided.
-- Anything else raises, writing nothing: an expected decision it can't read (22023), the product's own shop (the
-- trigger, 23001), a shop no one knows (its key, 23503) or a shape the table refuses.
-- It runs as its caller (security invoker), so RLS, the keys and the grants bind it as they bind a direct write: the
-- insert policy and grant the new row, the update policy and the update grant the replaced one, and its set list is
-- exactly the update grant's 12 columns. The one-decision-per-shop key holds the caller's own user_id, so a conflict
-- only ever meets the caller's own row. The values are inserted as given, never selected from the product, so a missing
-- product fails the composite key rather than inserting no row. PostgREST finds a function by its arguments' names, so
-- none has a default and every call names all 16.
create function public.record_decision(
  p_item uuid,
  p_shop text,
  p_state text,
  p_decided_by text,
  p_shop_item_id text,
  p_name text,
  p_brand text,
  p_size_text text,
  p_size_value numeric,
  p_size_unit text,
  p_eans text[],
  p_product_url text,
  p_image_url text,
  -- The decision this write replaces: null (none, or a lookup that found nothing), 'matched' or 'unmatched'.
  p_replaces_state text,
  p_replaces_item text,
  p_replaces_decided_by text
)
returns text -- 'saved' | 'decided' | 'gone'
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_constraint text;
begin
  -- An expected decision the save can read: none names no item and no decider, a match names both, and a decline
  -- neither. So the where below meets no null.
  if not (
    case p_replaces_state
      when 'matched' then p_replaces_item is not null and p_replaces_decided_by is not null
      when 'unmatched' then p_replaces_item is null and p_replaces_decided_by is null
      else p_replaces_state is null and p_replaces_item is null and p_replaces_decided_by is null
    end
  ) then
    raise exception 'record_decision: an expected decision it can''t read' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.watchlist_matches as m (watchlist_item_id, shop_id, state, decided_by, shop_item_id, name,
    brand, size_text, size_value, size_unit, eans, product_url, image_url)
  values (p_item, p_shop, p_state, p_decided_by, p_shop_item_id, p_name, p_brand, p_size_text, p_size_value,
    p_size_unit, p_eans, p_product_url, p_image_url)
  on conflict on constraint watchlist_matches_one_per_shop do update
    set state = excluded.state, decided_by = excluded.decided_by, shop_item_id = excluded.shop_item_id,
      name = excluded.name, brand = excluded.brand, size_text = excluded.size_text,
      size_value = excluded.size_value, size_unit = excluded.size_unit, eans = excluded.eans,
      product_url = excluded.product_url, image_url = excluded.image_url, checked_at = now()
    where case p_replaces_state
      when 'matched' then m.state = 'matched' and m.shop_item_id = p_replaces_item
        and m.decided_by = p_replaces_decided_by
      when 'unmatched' then m.state = 'unmatched'
      else m.state = 'not_found'
    end
  returning m.id into v_id;

  -- No row back: the stored decision isn't the one this write expects.
  return case when v_id is null then 'decided' else 'saved' end;
exception
  when foreign_key_violation then
    -- Only the key to the caller's own product means gone; any other, the shop's, is raised again.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'watchlist_matches_own_product' then
      return 'gone';
    end if;
    raise;
end;
$$;

-- Postgres grants execute on a new function to PUBLIC, so take it back, from anon too, and grant it to signed-in users
-- only, as the shop gate's functions do.
revoke all on function public.record_decision(
  uuid, text, text, text, text, text, text, text, numeric, text, text[], text, text, text, text, text
) from public, anon;
grant execute on function public.record_decision(
  uuid, text, text, text, text, text, text, text, numeric, text, text[], text, text, text, text, text
) to authenticated;

-- 4. What each new object is, and the table's comment, replaced here because applied migrations are frozen, as S-08's
-- removal migration replaced the one before it.
comment on function public.refuse_own_shop_decision() is
  'Refuses a decision in its product''s own shop (23001), reading the product as its caller. Run by its trigger only.';
comment on trigger watchlist_matches_not_own_shop on public.watchlist_matches is
  'A product holds no decision in its own shop: an insert there is refused for every caller, record_decision''s too.';
comment on function public.record_decision(
  uuid, text, text, text, text, text, text, text, numeric, text, text[], text, text, text, text, text
) is
  'Saves a decision in one statement, as its caller: saved, decided (another one stood) or gone (no such product).';
comment on table public.watchlist_matches is
  'Shop matches, private per user: one decision per watched product and shop, never in its own shop. Only its owner '
  'changes it, in any state, and record_decision saves one in one statement.';
