-- Removing a product and re-pinning a match (S-08): a user deletes their own watchlist row, and changes their own shop
-- decisions in any state. Nothing else opens: watchlist_items gets no update and watchlist_matches no delete, and
-- price_observations, its policies, its grants and its view stay as they are.

-- A user removes only their own product. The composite key of watchlist_matches, (watchlist_item_id, user_id), cascades
-- the delete to that user's own decisions for it and to no one else's. PostgreSQL runs the cascade as the table's
-- owner, so it needs no delete grant or policy on watchlist_matches. No observation references a product or a user, so
-- a removal never deletes one (FR-005), and the other watchers of the same shop item keep its prices.
create policy watchlist_items_delete_own on public.watchlist_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant delete on table public.watchlist_items to authenticated;

-- Applied migrations are frozen, so the comment S-01 left, which said a removal only hides an entry, is replaced here.
comment on table public.watchlist_items is
  'Watched products, private per user. Removing one deletes its shop decisions too, never a price observation.';

-- A user changes their own decisions in any state: a re-pin turns a match into another match or a decline, and a
-- decline into a match. RLS no longer narrows an update by state, so the app narrows each write by the state it expects
-- (src/lib/services/matches.ts). S-03's update grant still covers only the decision's columns, so no update moves a
-- decision to another product, user or shop, and the table's checks still keep each state's shape. There is still no
-- delete grant or policy: a decision goes only with its product.
drop policy watchlist_matches_update_own_not_found on public.watchlist_matches;

create policy watchlist_matches_update_own on public.watchlist_matches
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.watchlist_matches is
  'Shop matches, private per user: one decision per watched product and shop. Only its owner changes it, in any state.';
