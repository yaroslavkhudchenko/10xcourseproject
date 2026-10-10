---
date: 2026-10-10T10:08:02+02:00
researcher: Claude Opus 5.5
git_commit: 3df527b
branch: refactor/decision-store-backstop
repository: yaroslavkhudchenko/10xcourseproject
topic: "How a decision is stored today, what the database allows on watchlist_matches, and what a database backstop for the own shop and a one-statement save would touch (S-02)"
tags: [research, codebase, decisions, watchlist-matches, decision-store, migrations, rls, backstop, ast-grep]
status: complete
last_updated: 2026-10-10
last_updated_by: Claude Opus 5.5
---

# Research: the decision store and its database backstop (S-02)

**Date**: 2026-10-10T10:08:02+02:00
**Researcher**: Claude Opus 5.5
**Git Commit**: 3df527b (the head of S-01's pull request #47), with this change's folder uncommitted
**Branch**: refactor/decision-store-backstop
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

Roadmap M-2's S-02, "The database refuses an own-shop decision, and every decision saves at once" (`context/foundation/roadmap.md:96-107`), asks for two things: the database itself refuses a decision in a product's own shop, even from a direct call, and every decision is saved in one atomic step, so a product removed during a save reads as gone, not as decided (`:98`). This research answers seven questions:

1. How is a decision written today, who calls the write, and where exactly does a product removed during a save read as decided?
2. What does the database allow on `watchlist_matches` for a direct call by a signed-in user, and can a decision be stored in a product's own shop?
3. What can "one atomic step" look like in this codebase's conventions, and what does "the project's first write function on a user's own table" mean?
4. How could the owner count the decisions already stored in a product's own shop?
5. What is the blast radius: the direct writes outside the app, `src/types.ts`, the test stub, the deploy gate?
6. Which tests pin today's write, and what would each assert after the change?
7. What technical debt and risks lie on this path?

It also places the flow on the project map (`context/map/repo-map.md`), as the course lesson "research with the map" asks, and verifies its structural claims with ast-grep (last section).

The inputs read in full: the roadmap, the refactor plan `context/domain/02-invariant-aggregate-refactor.md` (invariants I-1, I-3, I-5, I-8), the domain map `context/domain/domain-distillation.md` (R-01, R-03, R-05, R-08, R-16), the glossary, the project map with its four evidence files, `context/foundation/lessons.md`, S-01's research, plan and implementation review, and `CLAUDE.md` (Commands, API routes, Shops and matching, Data).

## Summary

- **A decision is written in two statements, and the second can read a removed product as decided.** `record` inserts, and only on a 23505 runs an update narrowed to the decision it expects (`src/lib/services/matches.ts:297-343`). If the product is removed after the insert's 23505 and before the update (`:316` to `:321`), the update finds no row and `record` answers `decided` (`:342`), not `gone`. The route then sends the user to `?shop=<shop>&decided=1`, and the product's 404 page shows "Nie znaleziono produktu." with no reason (`src/pages/watchlist/[id].astro:134`, `:225`), where `gone` would add "tego produktu nie ma na Twojej liście" (`src/lib/services/matches.ts:185`). No test removes a product inside this window (`context/archive/2026-10-07-testing-route-and-database-seams/research.md:355`; §1).
- **Two callers write, both through `record`.** The decision route calls `recordDecision` (`src/pages/api/watchlist/matches.ts:69`), and the product page's lookups call `recordLookup` (`src/lib/services/shop-matching.ts:385`), through `runMatchSteps`, which only the product page calls (`src/pages/watchlist/[id].astro:94`). `record`'s insert and update are the app's only writes of `watchlist_matches` (ast-grep, see the last section).
- **Nothing in the database ties a decision to its product's own shop.** The table, its checks (4 on the row, plus one on each of 10 columns), its keys and its 3 policies never compare `shop_id` with `watchlist_items.source` (`supabase/migrations/20260927184936_watchlist_matches.sql:20-94`; `supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:24-29`). So a signed-in user's well-formed direct insert can store one today (inference from the schema; no database test stores one). The check scripts rely on that in 2 places: they send own-shop inserts that only a shape check is meant to refuse (`scripts/check-matches-db.mjs:343-354`; `scripts/check-prices-db.mjs:372-386`).
- **The column that names the own shop is `watchlist_items.source`, and it predates add-from-other-shops.** It was created on 2026-09-27 (`supabase/migrations/20260927145051_watchlist_items.sql:7-8`). add-from-other-shops (6b36842) added no migration; it let "Dodaj" store any priced shop there (`src/lib/services/watchlist.ts:51`, where before it took only `"rossmann"`) and let the decision form take every priced shop.
- **"The first write function on a user's own table" is literal.** The migrations define 3 functions, all `security definer` (`supabase/migrations/20260926112205_polite_shop_access.sql:51`, `:95`; `supabase/migrations/20261006183345_applied_migrations.sql:18`). They write only the shop gate's two tables, which have no grants and no policies, or read the migration list. None touches `watchlist_items`, `watchlist_matches` or `price_observations`. The app's only `rpc` calls are the gate's two (`src/lib/services/shop-gate.ts:183`, `:193`).
- **One atomic step means an SQL function here, with several open choices.** The client's upsert offers no condition on the merge, only `onConflict`, `ignoreDuplicates`, `count` and `defaultToNull` (postgrest-js 2.116.0 types), so it can't be counted on for the compare-and-swap. That leaves an SQL function the app calls with `rpc`. Constraints the plan must settle:
  - **Telling gone from decided.** The refactor plan's sketch reads a missing product as "no row back", the same answer as decided (`context/domain/02-invariant-aggregate-refactor.md:217`, `:222`).
  - **The deploy window.** A `not null` column that today's writer doesn't name would make every decision and lookup write of the code still deployed fail, between the owner's push and the deploy (inference, §7).
  - **Which backstop.** A denormalised column, composite key and check, or the project's first trigger.
- **The blast radius is exactly 17 direct inserts and 17 direct updates outside the app.** The inserts sit in 4 files: 10 in `scripts/check-matches-db.mjs`, 5 in `scripts/check-prices-db.mjs`, 1 in `scripts/check-two-users.mjs`, 1 in the e2e seed (`tests/e2e/support/watchlist-data.ts:197`). `src/lib/services/matches.db.test.ts` holds none: its 21 writes go through `recordDecision` and `recordLookup`, plus 1 direct update.
  - All 17 inserts change under a design that touches every insert: a `not null` column they must name, or direct writes revoked in favour of a function.
  - Under any backstop, the 2 own-shop inserts must move to a free matched shop, or they stop proving the check they exist for.
- **The tests that pin the write's shape are unit tests over hand-made stubs, and one route helper would turn vacuous.** `match-routes.test.ts`' `decisionWrites` counts only `from("watchlist_matches")` inserts and updates (`src/lib/services/match-routes.test.ts:121-128`). Once the write is an `rpc`, its 7 "no write" assertions would pass whatever the route wrote, unless the helper counts the call. `stubSupabase` already records `rpc` calls with their arguments and answers each call by them (`src/lib/services/testing/stub-supabase.ts:19`, `:214-224`), which is what S-01's F3 Fix A, carried to S-02, relies on.
- **Old rows in an own shop are probably none, are counted only outside the app, and aren't inert.** No legitimate path writes one. Before PR #44 (f087611, 2026-10-09) the app took only Rossmann products and no Rossmann decision. Since then only a crafted post (until S-01's guardian deploys) or a direct call could write one. Only a role that bypasses RLS can count them: the owner in the dashboard's SQL editor or `psql`. "No page reads such rows" (`context/foundation/roadmap.md:105`) holds, but RLS does: a `matched` row in the own shop still makes its shop item watched (`supabase/migrations/20260928011450_price_observations.sql:99-106`, `:119-126`).

## Detailed Findings

### 1. How a decision is written today

**`record`** (`src/lib/services/matches.ts:297-343`) writes one product's decision in one shop, given the row's columns and the decision it expects to replace (`replaces`).

1. It inserts `{ watchlist_item_id, shop_id, ...columns }` (`:304-307`), one supabase-js request.
2. No error: `saved` (`:308-310`).
3. 23503, the composite key to the user's own product: `gone` (`:311-314`). This is also how another user's product answers, since the key names the caller's own `user_id` (`supabase/migrations/20260927184936_watchlist_matches.sql:45-48`).
4. Any error but 23505: `failed`, logged once (`:315-319`).
5. On 23505, the one-decision-per-shop key, it updates the columns plus `checked_at` from the Worker's clock (`:321-323`), filtered by product and shop (`:324-325`) and narrowed by the expected decision (`:326-331`):
   - no `replaces`: `state = 'not_found'`, for a lookup and a first choice;
   - `matched:<id>`: `state = 'matched'` and `shop_item_id = <id>`;
   - `unmatched`: `state = 'unmatched'`.
6. It asks for the rows back (`:332`). An error, or an answer that isn't a list, is `failed` (`:333-341`). One row or more is `saved`, none is `decided` (`:342`).

The insert and the update are two awaited requests (`:304`, `:332`), so two transactions (inference: each supabase-js call is its own PostgREST request). `RecordResult` names the four outcomes and their meaning (`:221-225`).

**The column builders** (`:255-288`):

| caller           | columns                                                                        | `replaces`              |
| ---------------- | ------------------------------------------------------------------------------ | ----------------------- |
| `recordLookup`   | `matched`/`auto` with the candidate's item, or `not_found`/`auto` with no item | always `null` (`:269`)  |
| `recordDecision` | `matched`/`user` with the confirmed item, or `unmatched`/`user` with no item   | the form's (`:281-287`) |

**Every caller** (ast-grep, see the last section):

- `record` has exactly 2 callers, `recordLookup` (`:269`) and `recordDecision` (`:287`).
- `recordDecision` has 1 caller outside tests: the decision route, after `loadWatchedProduct` (`src/pages/api/watchlist/matches.ts:55`) and `admitDecision` (`:62`), with the form's own `replaces` (`:66-69`). It maps `saved` to `matched=1` or `declined=1`, and passes `decided`, `gone` and `failed` through (`:70-79`).
- `recordLookup` has 1 caller outside tests: `lookupOutcome` (`src/lib/services/shop-matching.ts:375-416`), for an accepted candidate or a lookup that found nothing (`:383-385`).
  - An automatic match that saved is followed by its first price check in a second write (`:387-394`).
  - `failed` or `gone` marks the outcome unsaved, so the next visit looks the product up again (`:395-396`).
  - `decided` shows `decidedView` (`:400-403`).
  - `lookupOutcome` runs inside `runMatchSteps` (`:312-315`), only in the product's matched shops (`:313`), and only the product page calls it (`src/pages/watchlist/[id].astro:92-105`).

**The guardian before the write, as S-01 left it.** The route loads the product and its decisions (`src/lib/services/matches.ts:479-488`) and asks `admitDecision` (`src/lib/services/watched-product.ts:100-120`). It refuses, in order:

- a shop outside the matched shops, its own included: `not-a-matched-shop` (`:101-105`);
- an unreadable decision: `unreadable` (`:106-108`);
- a `replaces` that doesn't name the stored decision: `outdated-form` (`:109-112`);
- a move no page offers: `illegal-move` (`:113-115`), which after S-01's F1 covers only a decline over the user's decline (below).

The route maps them to `invalid`, `failed`, `decided` and `invalid` (`src/pages/api/watchlist/matches.ts:18-23`).

- **F1 changes one of these.** At 3df527b, `isLegalMove` refuses a decline over the user's decline and a confirmation of the item of the user's own match (`src/lib/services/watched-product.ts:141-148`). S-01's F1 is being fixed on S-01's branch (the coordinating agent, 2026-10-10). After it, a confirmation of item X over the user's own match of X answers `outdated-form` (`decided=1`), and `illegal-move` stays only for a decline over a decline.
- **The guardian checks the form against the decision it just read.** `record`'s compare-and-swap checks the form's `replaces` again at write time (`CLAUDE.md:60`; `context/changes/decision-route-guardian/plan.md:89`).

**The window in which a removed product reads as decided.**

- **Where.** Between the insert's 23505 answer (`src/lib/services/matches.ts:304-316`) and the update (`:321-332`).
- **How.** A removal deletes the product (`removeFromWatchlist`, `src/lib/services/watchlist.ts:280-298`), and its cascade deletes the decision (`supabase/migrations/20260927184936_watchlist_matches.sql:47-48`). The update then matches no row, and `record` answers `decided` (`:342`).
- **When it can happen.** Only where a decision row already exists for that product and shop, since otherwise the insert saves, or answers 23503 or another error:
  - a re-pin;
  - a first choice over a lookup that found nothing;
  - a retry's lookup over one;
  - a late or outdated write over a settled decision.
- **What the user sees, through the route.** The redirect is `?shop=<shop>&decided=1` (`src/pages/api/watchlist/matches.ts:73-74`). The product page then answers 404 and passes only `?error=` to `ProductUnavailable` (`src/pages/watchlist/[id].astro:69`, `:134`, `:225`), which shows a decision's error and no decision notice (`src/components/watchlist/ProductUnavailable.astro:26-45`). So the user reads "Nie znaleziono produktu." with no reason. `gone` would add "Nie udało się zapisać wyboru: tego produktu nie ma na Twojej liście." (`src/lib/services/matches.ts:185`). Nothing wrong is written either way.
- **What the user sees, through a lookup.** `decided` shows the "decided" view (`src/lib/services/shop-matching.ts:400-403`), and the outcome isn't marked unsaved (`:396`), during a render whose product is being removed.
- **What S-01 changed.** The route's read before the write (`src/pages/api/watchlist/matches.ts:53-58`) makes a product removed before the post read as `gone` before any write. A product removed between that read and the insert gets 23503, so `gone` too. The remaining window is inside `record` alone.
- **Since when.** The window has existed since `record` was born insert-then-update (eee8536, 2026-09-27). It became reachable once removal shipped (`supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:9-13`, S-08), since before that no grant let a user delete a product (`supabase/migrations/20260927145051_watchlist_items.sql:41-42`); only the owner deleting a whole account could, through its cascade (`:6`).
- **Tests.** `src/lib/services/matches.db.test.ts:181-189` pins a removal before the write (`gone`), and `src/lib/services/matches.test.ts:798-805` pins the insert's 23503. The unit test of "a decision changed meanwhile" serves the same two answers the window produces, 23505 then no row, and expects `decided` (`:779-796`). The store can't tell the two cases apart.

### 2. What the database allows on `watchlist_matches` today

**Table, keys and checks** (`supabase/migrations/20260927184936_watchlist_matches.sql`):

- `user_id` defaults to `auth.uid()` (`:24`). `shop_id` references `public.shops (id)` (`:26`), whose rows are the four priced shops (`supabase/migrations/20260926112205_polite_shop_access.sql:40-44`).
- **The composite key.** `watchlist_matches_own_product`, `(watchlist_item_id, user_id)` references `watchlist_items (id, user_id)` with `on delete cascade` (`:47-48`). Its target is `watchlist_items_id_owner unique (id, user_id)` (`:9`).
- **One decision per product and shop.** `watchlist_matches_one_per_shop unique (watchlist_item_id, user_id, shop_id)` (`:51`). The user (`user_id`) is in the key, so another user's insert can't collide with a real row (`:49-50`).
- **Checks:**
  - `decider_fits_state` (`:53-55`);
  - `item_only_when_matched` (`:57-63`);
  - `size_complete` (`:64`);
  - `eans_bounded` (`:65-67`), replaced by a stricter one (`supabase/migrations/20260928011450_price_observations.sql:17-22`);
  - a check on each of 10 columns: the state and the decider (`:29-30`), and every item column but `eans` (`:32-41`).
- **No check, key or trigger compares `shop_id` with the product's `source`.** grep finds no `create trigger` in `supabase/migrations/`.

**RLS policies.** RLS is on (`:76`), and 3 policies stand, all `to authenticated`:

- `select_own`, `auth.uid() = user_id` (`:78-80`);
- `insert_own`, `with check auth.uid() = user_id` (`:82-84`);
- `update_own`, `using` and `with check auth.uid() = user_id` (`supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:26-29`). It replaced `update_own_not_found` (`:24`), which allowed an update only over `not_found` (`20260927184936_watchlist_matches.sql:86-89`).
- There is no delete policy.

**Grants.**

- Everything was revoked from `anon`, `authenticated` and `service_role`, then `select, insert, update` granted to `authenticated` (`:93-94`).
- The table-wide update was revoked again and replaced by an update grant on 12 columns only: `state, decided_by, shop_item_id, name, brand, size_text, size_value, size_unit, eans, product_url, image_url, checked_at` (`supabase/migrations/20260928011450_price_observations.sql:24-31`).
- Insert stays table-wide, so it covers any column a migration adds (inference from Postgres's grant model).
- There is no delete grant (`supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:19-23`).

**The product's side** (`supabase/migrations/20260927145051_watchlist_items.sql`):

- `source text not null references public.shops (id)` (`:7-8`), and `user_id` cascades from `auth.users` (`:6`).
- Grants are `select, insert` (`:41-42`) and `delete` (`supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:9-13`). There is no update grant or policy, so a product's `source` never changes after its insert (R-17).

**The own shop's column.** The column that says which shop a product was added from is `watchlist_items.source`. It was created by c2f70a8 (watchlist-add-by-search p1, 2026-09-27), not by add-from-other-shops, which shipped no migration (`context/archive/2026-10-06-add-from-other-shops/plan.md:100`). What add-from-other-shops (6b36842, p2, 2026-10-08) changed is what the app writes there and which shops a decision may name:

- **"Dodaj".** It went from `source: z.literal("rossmann")` (`git show 77d294c:src/lib/services/watchlist.ts`, line 45) to `z.enum(PRICED_SHOPS)` (`src/lib/services/watchlist.ts:51`).
- **The decision form.** It went from `MATCHED_SHOPS = ["natura", "hebe", "super-pharm"]` (`git show 77d294c:src/lib/services/price-comparison.ts`, line 46) to every priced shop (`src/lib/services/matches.ts:141`).

**Can a decision be stored in a product's own shop?**

- **Through the app:** from f087611 (PR #44, 2026-10-09) until S-01's guardian deploys, a crafted post could. S-01 refuses it (`src/lib/services/watched-product.ts:101-105`).
- **Through a direct call:** yes, at every commit since the table exists (inference from the schema above: nothing but the shape and format checks stands in the way). No database test stores a well-formed one. `scripts/check-matches-db.mjs:343-354` inserts three such rows for a Rossmann product in `rossmann`, each breaking one shape check, to prove those checks: "Rossmann has no decision for the product, so only a check refuses".

**What a direct call allows that the guardian refuses or never does (S-01's F4, carried to S-02 by the owner's triage of 2026-10-10).** This is the list the lesson "Check what a direct database call allows" asks for (`context/foundation/lessons.md:33-38`). It covers a signed-in user calling PostgREST with their own session.

| direct call on `watchlist_matches`                                                                      | allowed? | what binds it                                    | what the app does instead                                                                             | evidence                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| insert a decision in the product's own shop                                                             | yes      | shape and format checks only                     | the guardian refuses: `not-a-matched-shop` (`src/lib/services/watched-product.ts:101-105`)            | the schema (inference); the comment at `scripts/check-matches-db.mjs:343`                                          |
| insert any decision for an own product in a matched shop, `decided_by = 'auto'` or `not_found` included | yes      | insert policy, composite key, unique key, checks | only a lookup writes `auto` and `not_found` (`src/lib/services/matches.ts:259-270`)                   | `scripts/check-matches-db.mjs:98-111`, `:152-166`                                                                  |
| choose a row's `id`, `checked_at` or `created_at` on insert                                             | yes      | table-wide insert grant                          | never sets them                                                                                       | `supabase/migrations/20260927184936_watchlist_matches.sql:94`; the id probe, `context/foundation/test-plan.md:417` |
| update an own decision without naming the decision it replaces                                          | yes      | update policy, column grant                      | `outdated-form` in the guardian; the compare-and-swap in `record`                                     | the negative control `src/lib/services/matches.db.test.ts:216-244`                                                 |
| decline over the user's decline, or confirm the item of the user's own match again                      | yes      | update policy, column grant                      | `illegal-move` for a decline over a decline; since S-01's F1, `outdated-form` for the re-confirmation | `src/lib/services/watched-product.ts:141-148`                                                                      |
| reset a decision to `not_found`, or mark a match `auto`                                                 | yes      | update policy; `decider_fits_state`              | never; accepted, "changes only their own list"                                                        | `CLAUDE.md:60`                                                                                                     |
| set `checked_at` to any time on update                                                                  | yes      | it is in the update grant                        | sets the Worker's clock (`src/lib/services/matches.ts:323`)                                           | `supabase/migrations/20260928011450_price_observations.sql:28-31`                                                  |
| store an item the shop never offered                                                                    | yes      | format checks only                               | the route takes it from hidden fields too: I-11, parked                                               | `context/foundation/roadmap.md:145`                                                                                |
| attach a decision to another user's product                                                             | no       | composite key (23503), insert policy (42501)     | the guardian answers `gone`                                                                           | `scripts/check-matches-db.mjs:134-148`                                                                             |
| move a decision to another product, user or shop                                                        | no       | column grant (42501)                             | —                                                                                                     | `scripts/check-matches-db.mjs:225-259`, `:268-293`; `scripts/check-prices-db.mjs:388-421`                          |
| delete a decision                                                                                       | no       | no grant or policy (42501)                       | it goes only with its product                                                                         | `scripts/check-matches-db.mjs:316-319`                                                                             |
| anything as `anon`                                                                                      | no       | revoked (42501)                                  | —                                                                                                     | `scripts/check-matches-db.mjs:320-325`                                                                             |

- **The race F4 names.** It lives in the app, not in a direct call. The guardian reads an automatic match of X and admits "To ten produkt" on X with `replaces=matched:X`. Meanwhile another tab makes X the user's own. The compare-and-swap checks `state` and `shop_item_id`, not `decided_by` (`src/lib/services/matches.ts:329-330`), so the write lands and answers `saved`. After F1, the guardian answers the same post `outdated-form` when it reads the user's own X. A store that also expects the decider the guardian read would answer the race `decided` too (inference). The roadmap parks a database guard for the moves (`context/foundation/roadmap.md:146`). F4's triage leaves the plan to decide whether the new write checks `decided_by`.
- **One side effect reaches past the user's list.** The price policies make a user a watcher of any shop item named by one of their `matched` decisions, whatever the product's own shop (`supabase/migrations/20260928011450_price_observations.sql:99-106`, `:119-126`). So a `matched` row in the own shop still grants reading and adding that item's price observations. That adds no new risk: watching is self-service anyway, through "Dodaj" (`CLAUDE.md:60`, accepted risks).

### 3. What one atomic step can look like here

**The SQL functions that exist** (the only three; grep finds no fourth):

| function                                       | security | writes                                                      | executable by   | evidence                                                                      |
| ---------------------------------------------- | -------- | ----------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| `reserve_shop_request(text)`                   | definer  | `shop_requests` (delete, insert)                            | `authenticated` | `supabase/migrations/20260926112205_polite_shop_access.sql:48-84`, `:126-127` |
| `report_shop_block(text, text, integer, text)` | definer  | `shops` (update)                                            | `authenticated` | `:87-123`, `:129-130`                                                         |
| `applied_migrations()`                         | definer  | none; reads `supabase_migrations` with its definer's rights | `anon` only     | `supabase/migrations/20261006183345_applied_migrations.sql:14-27`             |

- **Their conventions.** Each sets `search_path = ''` and names objects by schema (`polite_shop_access.sql:52`, `:96`; `applied_migrations.sql:19`). Each takes `execute` back from `PUBLIC` and from the API role not meant to call it, and grants it to the one that is (`polite_shop_access.sql:125-130`; `applied_migrations.sql:24-27`; `CLAUDE.md:60`).
- **The anon exception.** `applied_migrations()` is the one function `anon` may execute, for the deploy gate (`applied_migrations.sql:8-12`, `:24-27`).
- **Their tables.** `shops` and `shop_requests` have RLS on, no policies and no grants, so the functions are their only way in (`polite_shop_access.sql:31-38`; `CLAUDE.md:60`).
- **How the app calls them.** `supabase.rpc(name, args).abortSignal(AbortSignal.timeout(...))`, then `result.error` (`src/lib/services/shop-gate.ts:182-199`). These are the app's only 2 `rpc` calls. Outside the app, 7 `rpc` call sites reach the same 3 functions: 6 in `scripts/check-shop-gate-db.mjs`, the anon refusals among them (`:118-126`), and 1 in `tests/e2e/auth.setup.ts:47`.

**What "the project's first write function on a user's own table" means** (`context/foundation/roadmap.md:106`). A user's own tables are those whose rows belong to one user under RLS: `watchlist_items` and `watchlist_matches`. `price_observations` is shared by an item's watchers. No existing function writes either, and each existing function is `security definer`. A function that stores a decision would be:

- the first to write rows that RLS assigns to a user;
- the first the app calls outside the shop gate;
- if `security invoker`, the first function that runs under its caller's RLS and grants.

**Options for the one-statement save** (described, not decided):

1. **A `security invoker` SQL function called with `rpc`.** This is the refactor plan's recommendation (`context/domain/02-invariant-aggregate-refactor.md:206-225`). It would run one `insert ... on conflict (watchlist_item_id, user_id, shop_id) do update set <decision columns> where <expected decision> returning id`.
   - **RLS binds it, as it binds today's two statements.** The insert path meets the insert policy. The update path meets the update policy's `using` on the caller's own row. Since the unique key holds `user_id`, a conflict can only meet the caller's own row (`20260927184936_watchlist_matches.sql:49-51`). The `set` list can't go beyond the 12-column update grant (inference from PostgreSQL's documented `on conflict` privileges and policies; not run here).
   - **It must tell gone from decided.**
     - The refactor plan's sketch inserts `select ... from watchlist_items where id = p_item` and reads "no row back: stale (or gone when the product was missing)" (`:217`, `:222`). That gives one answer for both, which S-02's outcome forbids.
     - Inserting `values (...)` keeps today's signal: a missing product fails the composite key with 23503, as `record` reads it now (`src/lib/services/matches.ts:311-314`).
     - Inference from PostgreSQL's documented behaviour, not run here:
       - `on conflict do update` locks the existing row before its `where`, so a concurrent removal's cascade waits for the save;
       - a row the cascade already deleted sends the insert back to its key check, so a removal during the save reads `gone` or happens after it.
     - A separate check of the product inside a function doesn't close the window under `read committed`: each statement takes a new snapshot. A locking read of the product needs an update privilege on `watchlist_items` that users don't have (`20260927145051_watchlist_items.sql:42`; inference).
   - **Its clock.** `checked_at` would move from the Worker's clock (`src/lib/services/matches.ts:323`) to the database's, unless passed in.
   - **No type checks its call.** The repository has no generated `Database` type (`src/types.ts` holds none; `src/lib/services/matches.db.test.ts:68-71`), so an `rpc`'s name and arguments are untyped. A misnamed argument would surface only at runtime, when PostgREST finds no such function (inference).
2. **A PostgREST upsert.** Not viable for the compare-and-swap. `upsert`'s options are `onConflict`, `ignoreDuplicates`, `count` and `defaultToNull` (`node_modules/@supabase/postgrest-js/dist/index.d.mts:4685-4693`, version 2.116.0, outside git), with no option for a condition on the merge, so it can't be counted on to express I-5. Whether PostgREST would apply a filter chained after `upsert` to the merge is unknown here and wasn't probed. The repository uses no `upsert` anywhere (grep over `src/`, `scripts/`, `tests/`).
3. **Two statements plus a third read.** After an update with no row, read the product again to tell `gone` from `decided`. This needs no migration and closes the visible symptom. It is not "one atomic step" (`context/foundation/roadmap.md:98`): a removal after the third read is still possible. That is harmless, but it isn't the roadmap's wording.
4. **A `security definer` function as the only write path,** with direct insert and update revoked, as for `shops` (`CLAUDE.md:60`). Only this shape could also let the database judge the moves, which the roadmap parks (`context/foundation/roadmap.md:146`). But:
   - RLS would no longer bind the write, against the roadmap's risk ("RLS still binds the new write path", `:106`), so ownership would be checked by hand with `auth.uid()`;
   - every one of the 17 direct inserts and 17 direct updates outside the app would lose its grant (§5).

**Options for the own-shop backstop** (described, not decided):

- **A. A denormalised `product_source`, a widened composite key and a check.** This is the refactor plan's recommendation (`context/domain/02-invariant-aggregate-refactor.md:227-231`).
  - **The key.** It needs a new unique key `(id, user_id, source)` on `watchlist_items` as the key's target, like `watchlist_items_id_owner` (`20260927184936_watchlist_matches.sql:9`).
  - **The column must be `not null`.** Under the default `match simple`, a composite key with one null column is not checked at all. So a nullable `product_source` would also stop checking ownership, should the two-column key be dropped (inference from PostgreSQL's documented `match simple`).
  - **It holds for good.** Neither side can change after the insert: `watchlist_items` has no update grant, and the update grant on `watchlist_matches` lists 12 columns, without a new one (`20260928011450_price_observations.sql:28-31`). The table-wide insert grant lets a direct insert name `product_source`, and the key then makes it equal the product's `source`.
  - **Its cost.** Every insert must name the column: today's `record` (`src/lib/services/matches.ts:304-307`), the 17 direct inserts, and the function. Old rows in an own shop fail the check unless deleted first, or the check is added `not valid`.
- **B. A `before insert` trigger** that refuses a decision whose shop is its product's `source`.
  - **It would be the project's first trigger.** grep finds none.
  - **It changes no writer.** Today's `record`, and the 15 direct inserts that aren't in an own shop, keep working, and old rows stay untouched.
  - **It must read the product under the caller's RLS.** If it did, another user's product would read as none, and the composite key would still answer 23503. A `security definer` trigger that sees another user's product could answer differently for it than for a missing one, and so tell user B the shop user A's product came from. The privacy checks require identical answers (`scripts/check-matches-db.mjs:134-144`; `scripts/check-two-users.mjs:264-277`).
  - **An insert check suffices.** `shop_id` and `watchlist_item_id` are outside the update grant.
  - **Its function joins the catalogue's list.** It needs `execute` taken from `PUBLIC` (`scripts/check-catalog-db.mjs:37-41`, `:73-76`, `:116`).
- **C. A check inside the write function alone.** It doesn't stop a direct insert, so it doesn't meet "even from a direct call" (`context/foundation/roadmap.md:98`), unless option 4 makes the function the only path.
- **D. Not available.** A `check` constraint can't read `watchlist_items` (PostgreSQL requires check expressions to look at the row alone; inference from its documentation).

### 4. Old decisions in a product's own shop

- **The query.** The domain map's "done when" is the count itself (`context/domain/domain-distillation.md:307`): `select count(*) from watchlist_matches m join watchlist_items i on i.id = m.watchlist_item_id where m.shop_id = i.source`. Adding `group by m.state` would also show how many are `matched`, the ones that grant watching (§2).
- **Who can run it.** Only a role that bypasses RLS sees every user's rows:
  - the owner, in the Supabase dashboard's SQL editor;
  - or `psql` with the database password the owner uses for `npx supabase db push` (`CLAUDE.md:60`).
  - Not the app or the publishable key: a user reads only their own decisions (`20260927184936_watchlist_matches.sql:78-80`), and `anon` nothing (`:93`). This research ran it nowhere: it queried no database.
  - Locally, `sql()` runs statements as the local superuser (`scripts/e2e-local-db.mjs:103`), on local data only.
- **Ways the migration itself could handle them** (the plan's choice):
  - delete them first;
  - add the check or key `not valid` and validate it later, which fails while such rows exist;
  - or, under option B, leave them.
  - Whether `npx supabase db push` prints a migration's `raise notice` is unknown, so a count inside the migration may not reach the owner.
- **The expected count is probably 0** (inference). No legitimate writer stores one:
  - lookups run only in matched shops (`src/lib/services/shop-matching.ts:313`);
  - before f087611 "Dodaj" took only Rossmann products and the form no Rossmann decision (§2);
  - since then only a crafted post (until S-01 deploys) or a direct call could.
- **"No page reads such rows"** (`context/foundation/roadmap.md:105`) holds for the app: every reader narrows to the matched shops (`src/lib/services/matches.ts:384-400`). Unit tests pin it with own-shop rows in stubs (`src/lib/services/price-routes.test.ts:104`, `:346`; `src/lib/services/price-pages.test.ts:399`, `:408`; `src/lib/services/price-comparison.test.ts:988`). It doesn't hold for RLS (§2): an old `matched` row keeps its item watched until it is deleted.
- **The two definitions of done differ on old rows.** The domain map's "done when" counts every row, old ones included (`domain-distillation.md:307`), while the roadmap's milestone "Done when" speaks of storing (`context/foundation/roadmap.md:30`). Keeping old rows meets the second and can fail the first.

### 5. Blast radius

**Direct writes of `watchlist_matches` outside the app's code** (ast-grep with `$C.from("watchlist_matches").insert($$$A)` and `.update($$$A)`, zeros confirmed with grep):

| file                                      | insert call sites                                                                                         | update call sites                                                                                          | in the product's own shop                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `scripts/check-matches-db.mjs`            | 10: `:99`, `:114`, `:120`, `:137`, `:141`, `:145`, `:152`, `:157`, `:322`, `:350` (a loop of 3 rows)      | 13: `:168`, `:179`, `:192`, `:197`, `:203`, `:214`, `:236`, `:246`, `:253`, `:262`, `:277`, `:287`, `:294` | `:350`, all 3 rows in `rossmann` for a Rossmann product (`:85-88`)                     |
| `scripts/check-prices-db.mjs`             | 5: `:316`, `:317`, `:382` (a loop of 2 rows), `:392`, `:600`                                              | 3: `:405`, `:412`, `:435`                                                                                  | `:382`, its first row, `rossmann` (`:375`) for a Rossmann product (`:154-158`, `:210`) |
| `scripts/check-two-users.mjs`             | 1: `:187`, three rows from `decisionsOf` (`:118-129`)                                                     | 0                                                                                                          | none: Natura, Hebe and Super-Pharm for a Rossmann product (`:107-108`)                 |
| `tests/e2e/support/watchlist-data.ts`     | 1: `:197`, in `matchShop`, reached from 25 spec calls: 11 direct, 14 through `addMatchedProduct` (`:167`) | 0                                                                                                          | none: every call names a matched shop of its product                                   |
| `src/lib/services/matches.db.test.ts`     | 0 (its 21 writes call `recordDecision` 14 times and `recordLookup` 7 times)                               | 1: `:222`, the negative control                                                                            | none                                                                                   |
| every other script and `src/**/*.test.ts` | 0                                                                                                         | 0                                                                                                          | —                                                                                      |

No other script writes a decision: ast-grep finds none elsewhere in `scripts/`, and grep finds `watchlist_matches` in the rest of `scripts/` only in a comment (`scripts/e2e-local-db.mjs:22`) and in the catalogue's reviewed list (`scripts/check-catalog-db.mjs:32`).

- **Which of them change depends on the backstop.**
  - Under a `not null` `product_source` (option A), all 17 inserts, or their helpers `naturaMatch`, `rossmannMatch`, `decisionsOf` and `matchShop`, must name it. `matchShop` takes only the product's id and the shop (`tests/e2e/support/watchlist-data.ts:183-209`), so it would need the product's source too.
  - Under any backstop, the 2 own-shop inserts must move to a matched shop without a decision. Otherwise the backstop refuses them for its own reason, and the shape and EAN checks they exist to prove could break unseen. Product A of `check-matches-db.mjs` already has a decision in each of its three matched shops (`:98-104`, `:152-161`), which is why section 9 used Rossmann. So the move needs a fresh product.
  - The updates don't name the product's shop. Only `:253` (`update({ shop_id: "rossmann" })`) touches it, and the column grant refuses that first, with 42501.

**`src/types.ts`.**

- It holds the decision's shapes (`MatchState`, `MatchedItem`, `ShopMatch`, `RepinnableMatch`, `ShopMatchState`; `src/types.ts:84-134`) and no `Database` type.
- The store's own types live beside it: `ExpectedDecision` (`src/lib/services/matches.ts:47`), `RecordResult` (`:225`), and `DecisionChange` in the guardian (`src/lib/services/watched-product.ts:33-38`).
- The reads name their columns (`src/lib/services/matches.ts:346-348`, `:542`), so a new column flows into no type unless a read selects it.
- The project map lists migrations against the hand-kept `src/types.ts` as an unguarded pair (`context/map/repo-map.md:113`). 2 of the 8 migration commits touched `src/types.ts` (re-measured at 3df527b with `git log -- supabase/migrations`).

**`stubSupabase` and `rpc`.**

- It records every `rpc` call as `["rpc", name, args]` (`src/lib/services/testing/stub-supabase.ts:214-216`).
- It answers each call through a handler of its arguments (`:19`, `:217-223`), so a test can answer `saved`, a 23503 or no row per call.
- Its `StubRpcCall` has `abortSignal` and `then` only (`:180-197`), so a store that chains `.select()`, `.single()` or `.maybeSingle()` on the call needs the stub extended.
- The two hand-made stubs that pin today's write have `from` and no `rpc`: `src/lib/services/matches.test.ts:139-170` and `src/lib/services/shop-matching.test.ts:1071-1104`.
- This is what S-01's F3, Fix A, carried to S-02 by the owner's triage of 2026-10-10, relies on. S-02's route tests pin the arguments the route hands the store (the form's own `replaces`) and the store's outcomes (`decided`, `gone`, `failed`).

**The deploy gate and the owner's push.**

- **What the gate checks.** `scripts/check-migrations-applied.mjs` compares the repository's migration versions with `applied_migrations()`. It passes a database ahead of the repository, "since a change's migration reaches production before its code merges" (`:10-13`, `:89-92`, `:169-182`).
- **What the deploy does with it.** `scripts/deploy-checked.mjs` refuses to deploy before `wrangler deploy` while a version is missing (`:6-7`, `:13-14`).
- **When the owner pushes.** The owner pushes each migration from a checkout of the pull request's branch, before the merge (`CLAUDE.md:60`; `context/deployment/deploy-plan.md:390`).
- **Supabase migrations don't roll back with the code** (`context/deployment/deploy-plan.md:303`).
- **Consequence (inference): production runs the code before S-02 against S-02's schema.** It does so from the owner's push until the deploy, and again after any rollback of the Worker. A precedent made that check explicitly: "Pushing it early is safe: the deployed code doesn't use the delete grant" (`context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:98`).
- **CI can't show it.** CI's smoke job starts an empty local stack with every migration applied (`.github/workflows/ci.yml:42`), so it never runs a migration over existing rows, nor the previous code's write against the new schema.

### 6. The tests that pin today's write, and what they would assert

- **Unit, the store:** `src/lib/services/matches.test.ts`, its `recordDecision` tests (`:601-690`), the re-pin's compare-and-swap (`:692-806`) and `recordLookup` (`:840-881`).
  - **Today** they pin the insert, then the narrowed update, through `insertInto` (14 uses), `updateOver` (6) and `updateNotFound` (3), with the update's `checked_at: NOW` (`:180-188`). They also pin each answer's outcome: 23503 is `gone`, 23505 then no row is `decided`, and 42501, 57014 or a non-list is `failed`, logged once.
  - **After**, they would pin one call to the write function, with the exact arguments for each kind of write: a lookup's, a first choice's, a re-pin over a match, a re-pin over a decline. And each answer's outcome: a row is `saved`, no row is `decided`, 23503 is `gone`, and any other error or an unreadable answer is `failed`, logged once. Whether the decider is expected (F4) shows in the arguments.
- **Unit, the route:** `src/lib/services/match-routes.test.ts`, 27 tests at 3df527b (`context/changes/decision-route-guardian/plan.md:384`).
  - **Today** they pin every redirect, and no insert or update on `watchlist_matches` for each refusal, through `decisionWrites` (7 assertions, which keep only `kind === "from"` queries, `:121-128`). They also pin the order read, read, write (`queryKinds`, `:233`) and each admitted post's insert columns.
  - **After**, they would carry F3's Fix A: the `rpc` call's arguments, the form's own `replaces` among them, and the store's `decided`, `gone` and `failed`, answered per call by the stub's handler. `decisionWrites` must count the `rpc` call too, or its 7 "no write" assertions pass whatever the route wrote.
- **Unit, the lookups:** `src/lib/services/shop-matching.test.ts`, 8 `writesOf(queries)` assertions (`:1241`, `:1284`, `:1309`, `:1352`, `:1532`, `:1663`, `:1757`, `:1880`), and 2 stubs keyed on the table and the operation (`:1296`, `:1319-1322`).
  - **Today** they pin that a lookup stores an insert on `watchlist_matches`, then a price check, and that a retry over `not_found` is an insert, an update, then a price check.
  - **After**, they would pin the lookup's one call and its arguments, with the price check after it. Their local stub has no `rpc`, so until it gains one the call throws, and `runStep` shows the shop as unavailable (`src/lib/services/shop-matching.ts:321-327`): these tests would fail loudly rather than pass vacuously.
- **Unit, the guardian:** `src/lib/services/watched-product.test.ts` pins the moves and refusals. It stays unchanged, unless the admitted change gains the expected decider (F4).
- **The database test:** `src/lib/services/matches.db.test.ts`, 9 cases (`:127-244`), run in CI's smoke job (`.github/workflows/ci.yml:69-72`).
  - **Today** it pins the real compare-and-swap in every outdated-form case, a removal before the write as `gone` (`:181-189`), exactly one winner of two concurrent re-pins (`:191-205`), and the negative control: a direct update that ignores the expected decision overwrites it (`:216-244`).
  - **After**, it would pin the same cases through the new write, plus a decision in the own shop refused, by a direct insert and by the function, and a removal during a save that never answers `decided`; a repeated concurrent removal and save is one way to probe that. The negative control stays, since the moves have no database guard (`context/foundation/roadmap.md:146`).
- **The database checks:** `scripts/check-matches-db.mjs`, `scripts/check-prices-db.mjs` and `scripts/check-catalog-db.mjs`, in CI's smoke job (`.github/workflows/ci.yml:57-68`).
  - **Today** they pin ownership, uniqueness, shapes, the column grant, no delete and `anon` refused, and which items a user watches.
  - **After**, they would also pin:
    - the function's grants: `anon` gets 42501, as `scripts/check-shop-gate-db.mjs:118-126` proves for the gate's functions;
    - user B's call for user A's product writes nothing and answers like a missing product;
    - the own shop refused;
    - under option A, `product_source` that can't be updated (42501) and must equal the product's `source`;
    - section 9 (`scripts/check-matches-db.mjs:343-354`) and the first EAN row (`scripts/check-prices-db.mjs:372-386`) moved off the own shop;
    - the catalogue's `FUNCTIONS` (`scripts/check-catalog-db.mjs:37-41`) listing the new function, and a trigger's.
- **Two users:** `scripts/check-two-users.mjs`, in CI's smoke job (`.github/workflows/ci.yml:95-100`). It pins that B's re-pin decline of A's match answers like a missing product (`:255-277`) and that A's rows stay unchanged. Its expectations stay; its seed (`:187`) names `product_source` under option A.
- **Smoke:** `scripts/smoke.mjs:240-249` pins that a decision posted from another site gets 403 from Astro's origin check. Unchanged.
- **E2e:** `tests/e2e/phone-decline-match.spec.ts:57` and `tests/e2e/phone-three-shops.spec.ts:88`, the only 2 decision taps in the 10 specs, both a re-pin's „Żaden z nich” from an automatic match. They pin the card's notice "Zapisano: brak w …" and the list row afterwards, and stay unchanged as the user-visible proof. The seed's `matchShop` changes only under option A.

### 7. Technical debt and risks on this path

**Evidence** (seen in a file or command output):

- The removed-product window answers `decided`, and no test removes a product inside it (§1; `context/archive/2026-10-07-testing-route-and-database-seams/research.md:355`).
- No database rule ties a decision's shop to its product's `source` (§2). That a well-formed direct insert stores one follows from the schema; no test exercises it.
- 2 own-shop inserts in the check scripts rely on the own shop being free of any rule (`scripts/check-matches-db.mjs:343-354`; `scripts/check-prices-db.mjs:372-386`).
- `checked_at` comes from two clocks: the database's on insert (`supabase/migrations/20260927184936_watchlist_matches.sql:43`), the Worker's on update (`src/lib/services/matches.ts:323`).
- The repository has no `Database` type, so `rpc` arguments are untyped (`src/lib/services/matches.db.test.ts:68-71`).
- `decisionWrites` counts only `from` queries (`src/lib/services/match-routes.test.ts:121-128`).
- The catalogue check reads a function's name, `PUBLIC` execute and `anon` execute, never whether it is `security definer` (`scripts/check-catalog-db.mjs:73-76`).
- Stale document lines: `context/foundation/test-plan.md:441` still says a crafted own-shop post "is stored, with no migration or invariant to refuse it", written before S-01's guardian. `decisionFieldsFor`'s comment names no guardian (`src/lib/services/matches.ts:68-73`; S-01's F7).
- S-01's review: F3 is triaged Fix A, carried to S-02, and F4 carried to S-02 (the owner's triage of 2026-10-10). F1 is being fixed on S-01's branch. At 3df527b, `context/changes/decision-route-guardian/reviews/impl-review.md:49`, `:80` and `:92` still read PENDING.

**Inference** (reasoning from the evidence, not run):

- **A `not null` `product_source` breaks the code still deployed.** Today's `record` names no such column (`src/lib/services/matches.ts:304-307`). Postgres checks not-null before the unique key, so every insert of the code deployed before S-02 would fail with 23502, re-pins included, and read `failed` (`:315-319`). In the window between the owner's push and the deploy, or after a rollback:
  - every decision post would answer "Nie udało się zapisać wyboru. Spróbuj ponownie.";
  - every lookup that settles something would read unsaved and look the product up again on the next view (`src/lib/services/shop-matching.ts:395-396`), spending requests of each shop's cap. The lesson "Bound what each page view and action costs every shop" applies (`context/foundation/lessons.md:12-17`).
- **A three-column key with a nullable column checks nothing** for rows with a null (`match simple`), ownership included, should the two-column key go.
- **The refactor plan's `insert ... select from watchlist_items` sketch** answers a removed product as it answers an outdated form (`context/domain/02-invariant-aggregate-refactor.md:222`).
- **A locking read of the product isn't available** to a `security invoker` function, since users have no update privilege on `watchlist_items`.
- **S-02 and S-03 both change the store's callers,** in `src/lib/services/matches.ts` and `src/lib/services/shop-matching.ts`: S-02 the write, S-03 the lookups through the guardian (`context/domain/02-invariant-aggregate-refactor.md:259-265`). Both branches sit at 3df527b, so whichever merges second rebases onto the other.
- **F4's decider check and F1's fix point the same way:** with both, the race and the plain case answer `decided`.
- **A `security definer` trigger could leak another user's product's shop** through a different error code (§3, option B).

**Unknown** (not established here):

- How many own-shop decisions production holds (§4).
- Whether PostgREST hands an `rpc`'s SQLSTATE to supabase-js as it does a table write's (assumed from `src/lib/services/matches.ts:312`; not run).
- Whether PostgREST would apply a filter chained after `upsert` to the merge (§3, option 2; not probed).
- Whether `npx supabase db push` shows a migration's notices.
- The exact lock and retry behaviour of `on conflict do update` beside a concurrent cascade, documented by PostgreSQL but not run here.
- Whether S-01's pull request merges before S-02's migration is pushed. Either way the deployed code writes through `record`, so the deploy-window constraint holds in both orders.

### The map: where this flow sits

- **Capabilities** (`context/map/repo-map.md:74-83`):
  - **shop-matching** owns the store, the lookups and the decision route (`src/lib/services/matches.ts`, `shop-matching.ts`, `src/pages/api/watchlist/matches.ts`; the route is listed under it in `context/map/evidence/3-structure.md:223`).
  - **watchlist** owns `watchlist_items` and the removal, whose cascade opens the window.
  - **price-refresh** owns the migration that holds `watchlist_matches`' update grant and the watching policies (`3-structure.md:142`).
  - **price-comparison** owns the product page, whose render runs the lookups' writes.
  - **platform** owns the deploy gate, CI and the database checks (`context/map/repo-map.md:85`) and the e2e seed (`context/map/evidence/1-history.md:40`). The people evidence counts `check-matches-db.mjs` under shop-matching and `check-prices-db.mjs` under price-refresh (`context/map/evidence/4-people.md:22`, `:24`).
- **Risk zones:**
  - **Zone 1, "Shop matching: the rule and its decisions"** (`context/map/repo-map.md:121-133`), directly: the store is its write.
  - **Zone 3, "The product page as composition root"** (`:147-154`): the lookups' write runs in the page's render, and only e2e covers the page itself.
  - **The map's "Watch" entry for price-refresh** (`:158-162`): the lookup stores the decision, then its first price, whose insert passes RLS only because the matched row exists (`supabase/migrations/20260928011450_price_observations.sql:119-126`).
- **Real couplings this change crosses** (`context/map/repo-map.md:101-117`):
  - **`price_observations`' RLS defined over `watchlist_matches`** (`:112`), a corridor the database checks guard: any change to the table sits under those policies.
  - **Migrations against the hand-kept `src/types.ts`** (`:113`), an unguarded pair: here, the untyped `rpc`.
  - **The SQL loop between watchlist and shop-matching** (`:117`; `3-structure.md:160`): S-08's removal migration wrote shop-matching's update policy. An S-02 migration that adds a key target on `watchlist_items` crosses the same line.
  - **The two-way service pair price-refresh and shop-matching** (`:109`): `shop-matching.ts` writes the decision through `matches.ts`, then the price through `prices.ts`.
- **Co-change** (re-measured at 3df527b; the map counted the same history at f087611, `context/map/evidence/1-history.md:177`):
  - 7 of the 8 migration commits touched a `scripts/check-*-db.mjs`, and 2 of 8 touched `src/types.ts`. So a migration here usually moves with its database check, and rarely with the types.
  - Of the 12 commits that touched `src/lib/services/matches.ts`, 11 also touched `matches.test.ts`, 2 `scripts/check-matches-db.mjs`, 1 a migration, 1 the e2e seed, and none `scripts/check-two-users.mjs` or `matches.db.test.ts`.
  - Every one of the decision route's 5 commits touched `matches.ts`.
  - So a store change that also moves the database checks, the e2e seed and a migration at once is wider than any change to `matches.ts` so far (`git log --no-merges -- <file>`, intersected per file).

## Code References

- `src/lib/services/matches.ts:297-343` — `record`, the insert (`:304-307`), the 23503 and 23505 branches (`:311-319`), the narrowed update (`:321-332`), `decided` (`:342`).
- `src/lib/services/matches.ts:255-288` — `recordLookup` and `recordDecision`, the column builders.
- `src/lib/services/matches.ts:221-225` — `RecordResult`.
- `src/lib/services/matches.ts:479-488` — `loadWatchedProduct`.
- `src/lib/services/matches.ts:384-400` — the read rules: whoever reads narrows to the matched shops.
- `src/lib/services/watched-product.ts:100-148` — `admitDecision`, `namesDecision`, `isLegalMove` (before F1's fix).
- `src/pages/api/watchlist/matches.ts:18-23`, `:53-79` — the refusal codes, the load, the store and its outcomes.
- `src/lib/services/shop-matching.ts:312-315`, `:375-416` — `runMatchSteps` and `lookupOutcome`.
- `src/pages/watchlist/[id].astro:69`, `:92-105`, `:134`, `:225` — the 404, the match steps, the error, the not-found view.
- `src/lib/services/watchlist.ts:280-298` — `removeFromWatchlist`.
- `supabase/migrations/20260927184936_watchlist_matches.sql:20-94` — the table, its keys, checks, policies and grants.
- `supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:9-29` — the product's delete and the update in any state.
- `supabase/migrations/20260928011450_price_observations.sql:24-31`, `:89-127` — the decision's update grant, and the watching policies.
- `supabase/migrations/20260926112205_polite_shop_access.sql:48-130`; `supabase/migrations/20261006183345_applied_migrations.sql:14-27` — the three functions and their grants.
- `src/lib/services/shop-gate.ts:182-199` — the app's two `rpc` calls.
- `src/lib/services/testing/stub-supabase.ts:180-226` — the stub's `rpc`.
- `scripts/check-matches-db.mjs:343-354`; `scripts/check-prices-db.mjs:372-386` — the two own-shop inserts.
- `tests/e2e/support/watchlist-data.ts:183-209` — `matchShop`, the e2e seed's decision.
- `scripts/check-catalog-db.mjs:27-41` — the reviewed relations and functions.
- `scripts/check-migrations-applied.mjs:10-13`, `:169-182`; `scripts/deploy-checked.mjs:1-17` — the deploy gate.

## Architecture Insights

- **One store, two writers, one key.** Every decision, a lookup's or the user's, goes through `record`, and its correctness rests on two things: the unique key (R-01) and the compare-and-swap, which only the app runs (R-05). S-02 moves the compare-and-swap into one database statement. The refactor plan's own wording is "The insert and the compare-and-swap become one atomic statement" (`context/domain/02-invariant-aggregate-refactor.md:210`).
- **Two guards, by design.** The database guards what a decision is and whose it is: its shape, its user, its product, one per shop, no delete. The app guards how it moves: the compare-and-swap, now the guardian too. S-02 adds one rule to the database's side, its scope (I-8), and leaves the moves to the app, as the roadmap parks them (`context/foundation/roadmap.md:146`).
- **The privacy contract shapes the backstop.** Another user's product must answer exactly like a missing one through every path (`scripts/check-two-users.mjs:264-277`; `scripts/check-matches-db.mjs:134-144`). Today that answer is the composite key's 23503. Any new database refusal must come after that check, or run under the caller's RLS.
- **Schema first, code later.** The owner pushes a migration before its code merges, and migrations don't roll back. So every migration so far has been safe for the code already deployed, as S-08's plan argued for its own (`context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:98`). A `not null` column the deployed writer doesn't name would be the first that isn't.

## Historical Context (from prior changes)

Each claim below gets its own verdict at 3df527b.

- **`record` stays insert-first, so a product removed in another tab reads `gone` rather than `decided`** (`context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:97`). Partial: it holds for a removal before the insert (`src/lib/services/matches.db.test.ts:181-189`). It doesn't hold for one between the insert's 23505 and the update (§1).
- **"Pushing it early is safe: the deployed code doesn't use the delete grant"** (`context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:98`). Supported as the precedent of checking a migration against the code still deployed.
- **The window itself** (`context/archive/2026-10-07-testing-route-and-database-seams/research.md:355`): "the update gets no row: `decided`, so the user lands on the 404 page with no reason shown, and nothing wrong is written", untested. Supported (§1).
- **"The insert ignores `replaces`: that is safe only while no decision can be deleted"** (`:359`). Supported: still no delete grant or policy (`supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:22-23`).
- **The ABA edge, accepted** (`context/foundation/test-plan.md:416`): "Re-evaluate if decisions gain anything a stale tab could lose, such as who decided and when." Still accepted. A decider check (F4) would touch the "who decided" half.
- **"No migration, and no invariant against a decision in a product's own shop"** (`context/archive/2026-10-06-add-from-other-shops/plan.md:100`), and "a rule against a decision in the product's own shop would be a new invariant, if wanted" (`research.md:271`). Supported as the starting point S-01 and S-02 change.
- **The refactor plan.**
  - Step 3, a removal between the two statements answers `decided` (`context/domain/02-invariant-aggregate-refactor.md:116`). Supported.
  - Step 4's SQL comment, "no row back: stale (or gone when the product was missing)" (`:222`). Contradicts S-02's outcome if kept as written (§3).
  - "Neither column can change after the insert" (`:230`). Supported, on the condition that `product_source` stays out of the update grant.
  - Phase 2's "about 17 insert sites … across … `src/lib/services/matches.db.test.ts`" (`:288`). Partial: there are exactly 17, in 4 files, and none in `matches.db.test.ts`.
- **The roadmap.**
  - "about 17 direct inserts in the database checks and the e2e seed" (`context/foundation/roadmap.md:106`). Supported, exact (17).
  - "the project's first write function on a user's own table" (`:106`). Supported (§3).
  - "no page reads such rows" (`:105`). Partial: true of pages, not of RLS (§4).
- **The domain map.**
  - R-08's "write side not guarded" (`context/domain/domain-distillation.md:199`). Partly superseded by S-01's guardian for posts; still true for direct calls.
  - The code-only rule "A decision write is an insert and, on a conflict, a separate narrowed update" (`:275`). Supported.
- **S-01's implementation review** (`context/changes/decision-route-guardian/reviews/impl-review.md`):
  - F1, a page's own re-pin confirm can answer `invalid` (`:36-49`): being fixed on S-01's branch, so `illegal-move` remains only for a decline over a decline.
  - F3, the route doesn't pin what it hands the store (`:63-80`): Fix A, carried to S-02.
  - F4, a race and direct calls still pass the guardian's rules (`:82-92`): carried to S-02. §2 lists the direct calls, and the plan decides the decider check.
  - The three decisions are the owner's triage of 2026-10-10. The file at 3df527b still reads PENDING.

## Related Research

- `context/changes/decision-route-guardian/research.md` — the route, the store and the tests before the guardian.
- `context/archive/2026-10-07-testing-route-and-database-seams/research.md` — the route and database seams, the removed-product window (`:355`), ABA and the insert (`:358-359`).
- `context/archive/2026-10-01-fix-matches-and-watchlist/research.md` and `plan.md` — why the update policy was widened and the write stayed insert-first.
- `context/archive/2026-10-06-add-from-other-shops/research.md` and `plan.md` — the own-shop decision's origin.
- `context/domain/02-invariant-aggregate-refactor.md` — the backstop and the one-statement save as first sketched.

## Open Questions

All open. Each is settled by a choice, by the owner or `/10x-plan`, not by more research.

1. **Old decisions in a product's own shop.** Delete them in the migration, or count them first (§4 says how) and enforce the rule on new rows only? The roadmap's default is to count first (`context/foundation/roadmap.md:105`). Keeping them keeps their items watched, and leaves the domain map's "done when" count above 0 if any exist. — Owner: user.
2. **Which backstop.** A `not null` `product_source` with a widened key and a check (option A), or a `before insert` trigger (option B, the project's first)? Option A touches every insert and needs an answer to the deploy window: today's code fails every write against a `not null` column it doesn't name. Option B touches 2 inserts and must run under the caller's RLS. — Owner: plan.
3. **Which save.** A `security invoker` function called with `rpc` (option 1), a `security definer` function as the only write path (option 4), or a third read after a missed update (option 3, not one atomic step)? And with option 1, how the function answers gone apart from decided. — Owner: plan.
4. **The decider in the compare-and-swap** (S-01's F4, carried). Should the store also expect who decided, so the race in which an automatic match becomes the user's own answers `decided`, as F1's fix answers the same post without a race? — Owner: plan.
5. **The lookups' save.** "Every decision is saved in one atomic step" covers `recordLookup` too. Should S-02 move it to the new write while S-03 routes the lookups through the guardian, and in which order do the two branches merge? — Owner: user.
6. **Whose clock stamps a decision.** The database's for every write, or the Worker's as the update has it today? — Owner: plan.

## Claim verification (ast-grep)

ast-grep 0.50.0, run as `npx --yes -p @ast-grep/cli ast-grep run -p '<pattern>' -l ts|js <paths> --json=stream` at 3df527b: `-l ts` for `.ts` files, `-l js` for `.mjs` files. ast-grep can't parse `.sql` or `.astro`, so those claims use grep. Every zero was confirmed with a plain grep. A line number is where ast-grep's match starts, which for a chained call is its first line.

| claim                                                                                         | verdict                                                                                      | evidence (file:line)                                                                                                                                                 | method                                                                                            |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `record` has exactly 2 callers                                                                | confirmed                                                                                    | `src/lib/services/matches.ts:269`, `:287`                                                                                                                            | `record($$$A)`                                                                                    |
| `recordDecision` has 1 caller outside tests, the decision route                               | confirmed; tests add 26: 12 in `matches.test.ts`, 14 in `matches.db.test.ts`                 | `src/pages/api/watchlist/matches.ts:69`                                                                                                                              | `recordDecision($$$A)`; grep `.astro`: 0                                                          |
| `recordLookup` has 1 caller outside tests, the product page's lookups                         | confirmed; tests add 10: 3 and 7                                                             | `src/lib/services/shop-matching.ts:385`                                                                                                                              | `recordLookup($$$A)`; grep `.astro`: 0                                                            |
| Only the product page runs the lookups                                                        | confirmed                                                                                    | `src/pages/watchlist/[id].astro:94`                                                                                                                                  | grep `runMatchSteps(` (`.astro`)                                                                  |
| The app writes `watchlist_matches` only in `record`, with one insert and one update           | confirmed: of the app's 3 inserts, 1 update and 1 delete, only these two touch it            | `src/lib/services/matches.ts:304`, `:321`; the others `src/lib/services/watchlist.ts:123`, `:281`; `src/lib/services/prices.ts:92`                                   | `$S.from($T).insert($$$A)`, `.update($$$A)`, `.delete()`, tests excluded; grep `.astro`: 0        |
| The repository uses no `upsert`                                                               | confirmed (0)                                                                                | —                                                                                                                                                                    | `$S.from($T).upsert($$$A)`; grep `upsert`: 0                                                      |
| The app's only `rpc` calls are the shop gate's 2, each with a time limit                      | confirmed                                                                                    | `src/lib/services/shop-gate.ts:182`, `:192`                                                                                                                          | `$S.rpc($$$A).abortSignal($$$B)`; grep `.astro`: 0                                                |
| Outside the app, 7 `rpc` call sites reach the same 3 functions                                | confirmed                                                                                    | `scripts/check-shop-gate-db.mjs:49`, `:120`, `:126`, `:149`, `:164`, `:178`; `tests/e2e/auth.setup.ts:47`                                                            | `$S.rpc($$$A)`                                                                                    |
| "About 17" direct inserts of `watchlist_matches` outside the app (roadmap)                    | refined: exactly 17 in 4 files, none in `matches.db.test.ts`, which the refactor plan listed | 10 in `scripts/check-matches-db.mjs`, 5 in `scripts/check-prices-db.mjs`, `scripts/check-two-users.mjs:187`, `tests/e2e/support/watchlist-data.ts:197` (lines in §5) | `$C.from("watchlist_matches").insert($$$A)`; grep confirms `src/`'s 0                             |
| Direct updates of `watchlist_matches` outside the app                                         | confirmed: exactly 17 in 3 files                                                             | 13 in `scripts/check-matches-db.mjs`, 3 in `scripts/check-prices-db.mjs`, `src/lib/services/matches.db.test.ts:222` (lines in §5)                                    | `$C.from("watchlist_matches").update($$$A)`; grep confirms `tests/`'s 0                           |
| `scripts/e2e-local-db.mjs` and the other check scripts write no decision                      | confirmed (0)                                                                                | `scripts/e2e-local-db.mjs:22`, a comment                                                                                                                             | the two patterns above; grep `watchlist_matches`                                                  |
| 2 direct inserts store a decision in the product's own shop                                   | refined: 1 found by its literal shop, 1 by reading the loop's data                           | `scripts/check-matches-db.mjs:350`; `scripts/check-prices-db.mjs:382` with `:375`                                                                                    | `$C.from("watchlist_matches").insert({ $$$A, shop_id: "rossmann", $$$B })`; reading               |
| `matchShop` has 12 callers and `addMatchedProduct` 14, none for the product's own shop        | confirmed                                                                                    | `tests/e2e/support/watchlist-data.ts:167`; e.g. `tests/e2e/product-from-another-shop.spec.ts:48-50`                                                                  | `matchShop($$$A)`, `addMatchedProduct($$$A)`; each call's shop by reading                         |
| `stubSupabase` records `rpc` calls, and its `rpc` call has only `abortSignal` and `then`      | confirmed                                                                                    | `src/lib/services/testing/stub-supabase.ts:180`, `:208`, `:215`                                                                                                      | `{ from: $A, rpc: $B }`; `class StubRpcCall implements $I { $$$B }`, its text checked             |
| The store's and the lookups' stubs have no `rpc`                                              | confirmed (0)                                                                                | `src/lib/services/matches.test.ts:169`; `src/lib/services/shop-matching.test.ts:1103`                                                                                | `{ from: $A, rpc: $B }`: 0; grep `rpc` in both files: 0                                           |
| 8 assertions pin the lookups' write                                                           | confirmed                                                                                    | `src/lib/services/shop-matching.test.ts:1241` to `:1880` (each in §6)                                                                                                | `writesOf($Q)`                                                                                    |
| 7 "no write" assertions rest on a filter that keeps only `from` queries                       | confirmed                                                                                    | `src/lib/services/match-routes.test.ts:202`, `:215`, `:225`, `:284`, `:334`, `:396`, `:407`; the filter `:124`                                                       | `decisionWrites($Q)`; `kind === "from" && relation === "watchlist_matches"`                       |
| The store's unit tests pin insert-then-update                                                 | confirmed: 14, 6 and 3 uses                                                                  | `src/lib/services/matches.test.ts:172-191`, the helpers                                                                                                              | `insertInto($$$A)`, `updateOver($$$A)`, `updateNotFound($$$A)`                                    |
| `loadWatchedProduct`, `admitDecision` and `watchedProductOf` have 1 caller each outside tests | confirmed                                                                                    | `src/pages/api/watchlist/matches.ts:55`, `:62`; `src/lib/services/matches.ts:487`                                                                                    | the three call patterns                                                                           |
| The e2e specs tap a decision in exactly 2 places, both „Żaden z nich”                         | confirmed; „To ten produkt” is tapped nowhere                                                | `tests/e2e/phone-decline-match.spec.ts:57`; `tests/e2e/phone-three-shops.spec.ts:88`                                                                                 | `$C.getByRole("button", { name: "Żaden z nich" }).tap()`, the same for „To ten produkt” (0); grep |
| `matches.db.test.ts` has 9 cases                                                              | confirmed                                                                                    | `src/lib/services/matches.db.test.ts:127` to `:217`                                                                                                                  | `it($NAME, async () => { $$$B })` (9)                                                             |
| The e2e suite has 10 specs                                                                    | confirmed                                                                                    | `tests/e2e/`                                                                                                                                                         | `ls tests/e2e/*.spec.ts` (10)                                                                     |
| The update grant on `watchlist_matches` names 12 columns                                      | confirmed                                                                                    | `supabase/migrations/20260928011450_price_observations.sql:28-31`                                                                                                    | grep (SQL), counted by hand                                                                       |
| `watchlist_matches` has 4 row checks and 10 column checks                                     | confirmed                                                                                    | `supabase/migrations/20260927184936_watchlist_matches.sql:29-41`, `:53-67`                                                                                           | grep `check (` (SQL): 22 in the file, less 6 on `watchlist_items` and 2 policies                  |
| The migrations hold exactly 3 functions, all `security definer`, with `search_path = ''`      | confirmed                                                                                    | `supabase/migrations/20260926112205_polite_shop_access.sql:48-52`, `:87-96`; `supabase/migrations/20261006183345_applied_migrations.sql:14-19`                       | grep (SQL)                                                                                        |
| No migration creates a trigger                                                                | confirmed (0)                                                                                | —                                                                                                                                                                    | grep `create trigger` (SQL)                                                                       |
| `watchlist_matches` has 3 policies and no delete policy or grant                              | confirmed                                                                                    | `supabase/migrations/20260927184936_watchlist_matches.sql:78`, `:82`, `:93-94`; `supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:24-26`           | grep (SQL)                                                                                        |
| `watchlist_items` has no update grant, so `source` never changes                              | confirmed                                                                                    | `supabase/migrations/20260927145051_watchlist_items.sql:42`; `supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:13`                                 | grep (SQL)                                                                                        |
| The catalogue check reviews exactly 3 functions                                               | confirmed                                                                                    | `scripts/check-catalog-db.mjs:37-41`                                                                                                                                 | grep                                                                                              |
