-- Polite shop access (F-01): the deployment-wide shop state and the rolling request log behind the shop gate.
-- Both tables are reached only through reserve_shop_request and report_shop_block, which only the
-- authenticated role may execute.

create table public.shops (
  id text primary key,
  name text not null,
  -- 60 is the research note's upper bound of one request per second per host.
  cap_per_minute integer not null default 30 check (cap_per_minute between 1 and 60),
  enabled boolean not null default true,
  paused_until timestamptz,
  disabled_reason text,
  disabled_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.shops is
  'Per-shop request cap and pause or stop state. Access goes through reserve_shop_request and report_shop_block only.';

create table public.shop_requests (
  id bigint generated always as identity primary key,
  shop_id text not null references public.shops (id),
  requested_at timestamptz not null default now()
);

create index shop_requests_shop_id_requested_at_idx on public.shop_requests (shop_id, requested_at);

comment on table public.shop_requests is
  'Requests reserved per shop in the last 60 seconds. Access goes through reserve_shop_request only.';

-- RLS on and no policies, so no API role can read or write the rows directly.
alter table public.shops enable row level security;
alter table public.shop_requests enable row level security;

-- No privileges for any API role either. Revoke them explicitly: turning off auto-exposure strips only
-- select/insert/update/delete on tables and usage/select on sequences from Supabase's default grants.
revoke all on table public.shops, public.shop_requests from anon, authenticated, service_role;
revoke all on sequence public.shop_requests_id_seq from anon, authenticated, service_role;

insert into public.shops (id, name) values
  ('rossmann', 'Rossmann'),
  ('hebe', 'Hebe'),
  ('super-pharm', 'Super-Pharm'),
  ('natura', 'Drogerie Natura');

-- Reserves one request slot for a shop, or says why the shop can't be called now.
-- Returns {"outcome": "allowed" | "capped" | "stopped" | "unknown_shop"} or {"outcome": "paused", "until": <timestamptz>}.
create function public.reserve_shop_request(p_shop_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_recent bigint;
begin
  -- Lock the shop row before pruning, counting and inserting, so concurrent reservations for one shop take turns
  -- and two callers can never both see a free slot.
  select * into v_shop from public.shops where id = p_shop_id for update;

  if not found then
    return jsonb_build_object('outcome', 'unknown_shop');
  end if;
  if not v_shop.enabled then
    return jsonb_build_object('outcome', 'stopped');
  end if;
  if v_shop.paused_until > now() then
    return jsonb_build_object('outcome', 'paused', 'until', v_shop.paused_until);
  end if;

  delete from public.shop_requests
  where shop_id = p_shop_id
    and requested_at < now() - interval '60 seconds';

  select count(*) into v_recent from public.shop_requests where shop_id = p_shop_id;
  if v_recent >= v_shop.cap_per_minute then
    return jsonb_build_object('outcome', 'capped');
  end if;

  insert into public.shop_requests (shop_id) values (p_shop_id);
  return jsonb_build_object('outcome', 'allowed');
end;
$$;

-- Records a shop's refusal: 'rate_limited' pauses the shop, 'blocked' stops it until the owner re-enables it.
create function public.report_shop_block(
  p_shop_id text,
  p_kind text,
  p_retry_after_seconds integer default null,
  p_detail text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'rate_limited' then
    -- Pause until the later of any current pause and now plus the delay (default 900 s, clamped to 1-86400 s).
    update public.shops
    set paused_until = greatest(
          paused_until,
          now() + least(greatest(coalesce(p_retry_after_seconds, 900), 1), 86400) * interval '1 second'
        ),
        updated_at = now()
    where id = p_shop_id;
  elsif p_kind = 'blocked' then
    update public.shops
    set enabled = false,
        disabled_reason = coalesce(p_detail, 'blocked'),
        disabled_at = now(),
        updated_at = now()
    where id = p_shop_id;
  else
    raise exception 'unknown block kind: %', p_kind;
  end if;

  if not found then
    raise exception 'unknown shop: %', p_shop_id;
  end if;
end;
$$;

-- Postgres grants execute on new functions to PUBLIC, so take it back and grant it to signed-in users only.
revoke all on function public.reserve_shop_request(text) from public, anon;
grant execute on function public.reserve_shop_request(text) to authenticated;

revoke all on function public.report_shop_block(text, text, integer, text) from public, anon;
grant execute on function public.report_shop_block(text, text, integer, text) to authenticated;
