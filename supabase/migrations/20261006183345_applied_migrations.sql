-- Applied migrations (rollout Phase 4 of context/foundation/test-plan.md): which migrations this database has, for the
-- deploy gate in Workers Builds. Before each deploy, scripts/check-migrations-applied.mjs asks this function with the
-- publishable key alone, so as the anon role, and refuses to deploy while any file in supabase/migrations is missing
-- from its answer. It is the observability audit's W4 seam
-- (context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md), and the deployed code never
-- calls it.
--
-- It deliberately departs from the convention that a function is executed by authenticated only: anon is its one
-- caller, because the gate holds no session and must never hold a secret key. That is acceptable because the answer
-- is only the versions of the repository's migration files, which the public repository already shows, so anon
-- learns only which of them this database has applied. The function takes no argument and reads one column as its
-- owner, with an empty search_path, so no caller can steer what it reads.

create function public.applied_migrations()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select version from supabase_migrations.schema_migrations order by version;
$$;

-- Postgres grants execute on new functions to PUBLIC, and Supabase's default privileges grant it to the API roles, so
-- take it back from PUBLIC and signed-in users and grant it to anon alone.
revoke all on function public.applied_migrations() from public, authenticated;
grant execute on function public.applied_migrations() to anon;
