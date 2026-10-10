# The database refuses an own-shop decision, and every decision saves at once Implementation Plan

## Overview

This is roadmap M-2's S-02. It adds the guardian's backstop in the database and makes every save one statement.

- **The backstop.** A `before insert` trigger, the project's first, refuses a decision in its watched product's own shop for every caller, a direct database call included. The migration first deletes any such decision stored before.
- **The save.** One PL/pgSQL function, `record_decision`, saves every decision, a lookup's and the user's, in one statement. It replaces the stored decision only while it is the one the write expects: its state, its item and, for a match, who decided it. It answers `saved`, `decided` or `gone` itself, so a removal during a save never reads as decided.
- **The store and the guardian.** `record` in `matches.ts` becomes that one call. The guardian's admitted change carries the decider it read (S-01's F4), and the decision route's tests pin the call's arguments and the store's outcomes (S-01's F3).

Nothing the user sees changes, and no shop request is added or removed.

## Current State Analysis

From `context/changes/decision-store-backstop/research.md`, re-anchored at 83f008f (S-01's head c1edc39 plus the research). S-03 merges before this change, so the lines in `shop-matching.ts`, `watched-product.ts` and their tests move; Phase 2 re-anchors them with grep after the rebase.

- **A decision is written in two statements** (`src/lib/services/matches.ts:298-344`):
  - `record` inserts (`:305-308`), and only on 23505 runs an update narrowed to the decision it expects (`:322-333`);
  - no row back is `decided` (`:343`).
  - So a product removed between the two answers `decided`. The route then lands on the 404 page with no reason, where `gone` would say "tego produktu nie ma na Twojej liście" (research §1).
- **Two writers share it.** `recordLookup` (`:260-271`) is called only by the lookup's step (`src/lib/services/shop-matching.ts:385`), and `recordDecision` (`:277-289`) only by the decision route (`src/pages/api/watchlist/matches.ts:69`). S-03 puts its lookup admission, `admitLookup`, before the lookup's write.
- **Nothing in the database ties a decision to its product's own shop.** No key, check or trigger compares `shop_id` with the product's `source`. S-01's guardian refuses such a post on the route only (`src/lib/services/watched-product.ts:101-106`). A direct insert stores one, and two check scripts rely on that: `scripts/check-matches-db.mjs:343-354` and `scripts/check-prices-db.mjs:372-386` (research §2).
- **The compare-and-swap ignores who decided** (`src/lib/services/matches.ts:327-332`). An automatic match that becomes the user's between the guardian's read and the write is rewritten and answers `saved`: S-01's F4.
- **The route's tests can't see the write's arguments.** `decisionWrites` counts only table writes (`src/lib/services/match-routes.test.ts:102-108`): S-01's F3.
- **Functions and triggers.** The migrations hold 3 functions, all `security definer`, and no trigger. The app's only `rpc` calls are the shop gate's (`src/lib/services/shop-gate.ts:183`, `:193`), and the catalogue check never reads whether a function is `security definer` (`scripts/check-catalog-db.mjs:73-76`).
- **Deploys.**
  - Production gets a migration from the owner's push, before its code, and can't roll it back (`context/deployment/deploy-plan.md:303`, `:390`).
  - The checked deploy refuses code whose migration production lacks (`scripts/deploy-checked.mjs`).
  - CI starts an empty local stack, so it never runs a migration over existing rows (`.github/workflows/ci.yml:40-43`).
- **The database proofs run only in CI.** The coordinator's machine has no Docker, so the database checks, `npm run test:db`, smoke, the two-user check and e2e run only in CI's `smoke` and `e2e` jobs.

## Desired End State

Every decision, a lookup's and the user's, reaches the database through one call, `record_decision`, which answers:

| case                                                                                                                                                               | answer                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| no decision, or a lookup that found nothing, where the write expects none                                                                                          | `saved`                                                                      |
| the expected match (its item and who decided it), or the expected decline                                                                                          | `saved`: the decision's columns change, `checked_at` on the database's clock |
| any other stored decision                                                                                                                                          | `decided`, nothing written                                                   |
| a product not on the user's list, another user's included, or one whose removal reaches its decision first, or the product when no decision is stored, and commits | `gone`, nothing written                                                      |
| a removal that reaches the decision after the save has locked it, even one that has deleted the product already                                                    | what the save would answer without it; the removal then deletes the decision |
| the product's own shop, an unknown shop, a shape the table refuses, an expectation it can't read                                                                   | an error, which the store reads as `failed`, logged once                     |

The store maps `saved`, `decided` and `gone` as before, and anything else, an error or an answer it can't read, to `failed`.

A removal never causes `decided`. When the removal's delete reaches the decision first, or the product when no decision is stored, and commits, the save answers `gone`. Otherwise the save answers exactly what it would without the removal, `saved` for the expected decision, even when the removal has deleted the product already, and the removal then deletes the decision with its product. So `decided` always means that a decision other than the expected one stood when the save ran.

**What a signed-in user's direct database call allows after S-02** (the lesson "Check what a direct database call allows"; research §2's table, updated):

| direct call                                                                                                                                  | after S-02                                                                                       | what binds it                                                                        | proved by                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| insert a decision in its product's own shop, or save one with `record_decision`                                                              | refused, 23001                                                                                   | the trigger                                                                          | `check-matches-db.mjs`, new                                                  |
| insert a decision for another user's product, or save one with `record_decision`, in any shop, its own included                              | refused exactly like an id no one has: 23503, or `gone`; in the owner's name, 42501, never 23001 | the composite key and the insert policy; the trigger sees only the caller's products | `check-matches-db.mjs`, section 4 and new                                    |
| `record_decision` as anon                                                                                                                    | refused, 42501                                                                                   | `execute` revoked                                                                    | `check-matches-db.mjs`, new                                                  |
| `record_decision` over a decision other than the one it expects, who decided it included                                                     | nothing written, `decided`                                                                       | the conflict's `where`                                                               | `check-matches-db.mjs`, new; `matches.db.test.ts`                            |
| `record_decision` over the decision it expects                                                                                               | `saved`; only the decision's 12 columns change                                                   | the update policy and the column grant                                               | `check-matches-db.mjs`, new                                                  |
| `record_decision` with an expected decision it can't read                                                                                    | refused, 22023, nothing written                                                                  | the function                                                                         | `check-matches-db.mjs`, new                                                  |
| insert any well-formed decision in a matched shop, an automatic match or a "not found" included                                              | allowed, as before                                                                               | the insert policy, the keys, the checks                                              | accepted (`CLAUDE.md:60`)                                                    |
| update a decision without naming the one it replaces; decline over a decline; reset to "not found"; mark a match automatic; set `checked_at` | allowed, as before                                                                               | the update policy, the column grant                                                  | accepted; the negative control `src/lib/services/matches.db.test.ts:216-244` |
| choose a row's `id`, `checked_at` or `created_at` on insert                                                                                  | allowed, as before                                                                               | the table-wide insert grant                                                          | accepted: the id probe (`context/foundation/test-plan.md:417`)               |
| store an item the shop never offered                                                                                                         | allowed, as before                                                                               | the format checks                                                                    | I-11, parked (`context/foundation/roadmap.md:145`)                           |
| move a decision to another product, user or shop; delete one; anything as anon                                                               | refused, as before                                                                               | the column grant, no delete grant, revoked grants                                    | `check-matches-db.mjs`, sections 5 to 7                                      |

It is verified by:

- the migration applied in CI, with `check-matches-db.mjs`, `check-prices-db.mjs` and `check-catalog-db.mjs` proving the refusals above;
- `npm run test:db` passing on Phase 1's commit, with the store unchanged, which shows the code still deployed saves against the new schema;
- the store's, the route's, the guardian's and the lookups' unit tests pinning the one call;
- the database test answering `gone` to a removal held open while a save runs;
- the owner's count of own-shop decisions returning no rows after the push, and the count of all decisions dropping by exactly as many.

### Key Discoveries:

- **The privacy contract shapes the backstop.** Another user's product must answer exactly like an id no one has, through every path: 23503 from the composite key `watchlist_matches_own_product` (`supabase/migrations/20260927184936_watchlist_matches.sql:47-48`; `scripts/check-matches-db.mjs:134-148`; `scripts/check-two-users.mjs`). A trigger that reads the product as its caller sees none of another user's products, so the insert goes on to that key.
- **The trigger fires first, and once.** A `before insert` row trigger runs for every proposed row, before the table's checks and the conflict check, also when `on conflict … do update` then takes the update path, and a retry doesn't fire it again (PostgreSQL 17's trigger and `CREATE TRIGGER` pages; `ExecInsert` in `src/backend/executor/nodeModifyTable.c`). So the shape checks' own-shop inserts (`scripts/check-matches-db.mjs:343-354`; `scripts/check-prices-db.mjs:375`) would meet the trigger first, and must move to a matched shop.
- **`insert … values`, never `insert … select`.** The refactor plan's sketch selects the product (`context/domain/02-invariant-aggregate-refactor.md:213-222`), which turns a missing product into no row back, read as decided. With `values`, a missing product fails the composite key, as `record` reads it today (`src/lib/services/matches.ts:313-315`).
- **A removal that overlaps the save can't make it answer no row.** These are PostgreSQL's own mechanics under read committed, its default and PostgREST's:
  - the conflict pre-check waits for a transaction that is deleting the conflicting row;
  - a row deleted while the save waits for its lock makes the save start its insert again (`ExecOnConflictUpdate`), as PostgreSQL's isolation test `insert-conflict-do-update-4` shows for "target row is concurrently deleted";
  - the composite key's check then reads the product with a fresh snapshot and skips a deleted one, so the insert fails with 23503 (`ri_triggers.c`, `nodeLockRows.c`);
  - the `where` runs only on a live row the save has locked, and a save that locks the row first finishes before the removal's cascade can delete it.
- **RLS and the grants still bind a `security invoker` function.**
  - `on conflict … do update` needs `insert` on the inserted columns, `update` on the `set` columns and `select` on the columns it reads, checked once for the whole statement (PostgreSQL 17's `INSERT` page).
  - The `set` list is exactly the 12 columns of the update grant, `checked_at` included (`supabase/migrations/20260928011450_price_observations.sql:27-31`).
  - RLS checks the proposed row against the insert and select policies, and the existing and updated rows against the update and select policies, raising rather than skipping (`CREATE POLICY`'s table of policies by command).
  - The unique key holds `user_id`, so a conflict can only meet the caller's own row, and every policy passes (`20260927184936_watchlist_matches.sql:51`).
  - The key's own check bypasses RLS and matches on values alone, which is why another user's product fails it like an id no one has.
- **PostgREST calls a function by its argument names.** This is the same in PostgREST v12.2, v14 (hosted) and v16 (the local CLI's): its functions and errors references on docs.postgrest.org, and its source (`findProc` in `Plan.hs`, `json_to_record` in `SqlFragment.hs`).
  - Every one of the 16 keys must be in the body, or the call answers PGRST202, HTTP 404.
  - `JSON.stringify` drops a key whose value is `undefined`, so each value is sent as itself or `null`.
  - JSON arrays bind to `text[]`, numbers to `numeric`, and `null` to any type.
  - A `returns text` function answers a bare string (`data: "saved"`).
  - An uncaught error comes back with its SQLSTATE in `error.code`, through the same parse as a table write's (postgrest-js 2.116.0, `PostgrestBuilder.ts`).
  - Each call is one transaction, under `set local role` and the caller's JWT claims, so `auth.uid()` and RLS hold inside the function.
- **The local stack grants no new function to the API roles** (`auto_expose_new_tables = false`, `supabase/config.toml:20`, which mirrors the hosted project), while Supabase's default privileges may grant one to all of them (`supabase/migrations/20261006183345_applied_migrations.sql:24-27`). So the migration revokes from `public` and `anon` and grants `authenticated` explicitly, as the shop gate's functions do (`supabase/migrations/20260926112205_polite_shop_access.sql:125-130`).
- **A trigger function needs no grant to fire.** PostgreSQL checks `execute` on it only when the trigger is created (`CreateTrigger` in `src/backend/commands/trigger.c`), and PostgREST serves no function that returns `trigger` (`SchemaCache.hs`).
- **An abort doesn't cancel the save.** The store gives up after 2 s (`DATABASE_TIMEOUT_MS`, `src/lib/services/matches.ts:27`), but PostgREST still commits a transaction its client stopped waiting for (PostgREST issue #699). That is true of today's two writes too.
- **`stubSupabase` already records an `rpc` call with its arguments** and answers it through a handler of them (`src/lib/services/testing/stub-supabase.ts:180-197`, `:214-225`). The store's and the lookups' own stubs have no `rpc` (`src/lib/services/matches.test.ts:129-160`; `src/lib/services/shop-matching.test.ts:1071-1104`).
- **The local superuser's helper runs one synchronous statement per call** (`sql()`, `scripts/e2e-local-db.mjs:103-124`), and it refuses unless the environment, `.env` and `.dev.vars` all name the local stack. CI writes both files before the database checks (`.github/workflows/ci.yml:44-48`).

## What We're NOT Doing

- **A database guard for the moves between decisions.** It stays parked (`context/foundation/roadmap.md:146`). A direct update still changes the user's own decision in any state, and the database test's negative control stays.
- **A `product_source` column with a widened key and a check** (the refactor plan's option). The code still deployed doesn't name such a column, so from the owner's push until the deploy every save would fail (research §7).
- **A `security definer` save as the only write path.** RLS would no longer bind the write, and the 17 direct inserts and 17 direct updates in the checks, the database test and the e2e seed would lose their grants. Every table grant and policy stays as it is.
- **Saving a lookup's first price check in the same statement.** A decision and a price observation are separate terms (`context/domain/glossary.md:35`, `:56`). An automatic match's first price stays a second write.
- **A re-read after a save** to name a removal that commits after it: that order answers `saved`, as the owner accepted.
- **A text of its own for the own-shop refusal.** Both guardians refuse the own shop first, so only a direct call meets the trigger. If anything in the app ever did, the store would read its error as `failed`.
- **A generated `Database` type.** The call stays typed by its one wrapper, `record`, and CI's database tests catch a misnamed argument.
- **Telling a save that timed out from one that failed.** As today, the page says the save failed, and a second post finds the decision stored (`decided`).
- **Anything the user sees, and any shop request.**
- **Closing the ABA edge** (`context/foundation/test-plan.md:416`). It narrows to decisions with the same content and the same decider, since no version column is added.
- **The id probe and I-11:** both stay as accepted and parked.
- **S-01's change folder.** F3 and F4 are recorded closed in this plan's notes, not there.
- **The PRD:** no requirement changes.

## Implementation Approach

The work runs schema first, then code.

1. **Phase 1, the schema.** One migration deletes own-shop decisions, adds the trigger and adds `record_decision`. The database checks gain the refusals, while the store stays untouched. So CI runs today's two-statement write against the new schema, which is what production runs from the owner's push until the deploy, and after any rollback of the Worker.
2. **Phase 2, the store.** `record` becomes the one call, under its callers' current signatures, whose `replaces` now names who decided a match. The guardian's admitted change carries the decider it read, so the user's re-pin over a match also expects who decided it. Each writer's tests pin the call, and the database test pins a removal held open during a save.
3. **Phase 3, the documents.** They describe the backstop and the save, and this plan's notes record F3 and F4 closed.
4. **Phase 4, the ship.** The owner counts, pushes from the branch, confirms and merges, then checks the phone.

**Starting point.** S-03 merges first (the owner's call, 2026-10-10). This branch rebases onto `main` with S-01 and S-03 merged, and Phase 1's first two criteria check what S-03 delivered:

- its merge is in `main`;
- `admitLookup` admits a lookup before the lookup's write;
- the store's two writers, `recordLookup` and `recordDecision`, each still have one production caller, the lookup's step and the decision route.

If S-03 left the writers under other names or shapes, Phase 2 moves whatever writers it left to the one call, and records that in this plan's Implementation Notes.

**Shop cost.** A save asks no shop, so nothing changes: a product page view still costs at most 2 searches per undecided matched shop, a decision post none, and a refresh what it did (the lesson "Bound what each page view and action costs every shop").

## Critical Implementation Details

- **Timing & lifecycle.**
  - Push Phase 1's commit and wait for its green `smoke` and `e2e` jobs before Phase 2's code lands. It is the only commit on which today's `record` runs against the new schema.
  - After Phase 1's green CI, only `record_decision` and the comments may change in the migration. An edit to the trigger or the delete reruns Phase 1's proof on a throwaway branch holding Phase 1's commit and the edit, through a draft pull request closed once its `smoke` and `e2e` jobs are green, and the Implementation Notes record it.
  - The owner pushes the migration to production only in Phase 4, after the pull request's final CI. From that push on the migration file never changes: production doesn't re-apply an edited version, so a fix is a new migration.
- **Gone, never decided.**
  - A removal deletes its product and, at the end of the same statement, the product's decisions. When its delete reaches the decision first, or the product when no decision is stored, it holds that row until it commits. The save waits on it, then starts its insert again, which fails the composite key: `gone`. The `where` is never evaluated on a deleted row.
  - Over a stored decision the save never waits on the product, since its update changes no key column. So a save that locks the decision after the removal deleted the product, but before the cascade, answers as it would without the removal, and the cascade then deletes the decision.
  - The handler reads the violated constraint's name. Only `watchlist_matches_own_product` is `gone`; the shop's key, for a shop no one knows, is raised again.
  - Both keys stay non-deferrable, as they are. A deferred key would fail only at commit, after the function had answered `saved`, and a deferrable key can't arbitrate a conflict.
- **The trigger's privacy.**
  - It reads the product as its caller, by `id = new.watchlist_item_id and user_id = new.user_id`. So another user's product, and a missing one, let the insert go on to the composite key.
  - It never raises when it finds no product (no `into strict`), and it returns `new` whenever it doesn't raise. Returning null would drop the row silently, which the function would read as `decided`.
  - Its error is 23001 (`restrict_violation`). It is never 23503, which `record_decision` reads as gone, nor 23514, the shape checks' code.
- **The decider narrows, never widens.** The change's expected decision keeps the form's own state and item, as S-01 requires (`context/changes/decision-route-guardian/plan.md:89`). The guardian adds only who decided the match it read, which can only make a write refuse more.
- **Every argument on every call.** The store sends all 16 keys, each value as itself or `null`, never `undefined`. Its tests pin the arguments with `toStrictEqual`, which, unlike `toEqual`, fails on a key left `undefined`.
- **The held-open removal and the 2-second limit.**
  - The store gives up after 2 s, so the held removal must commit as soon as the save waits on it, never after a fixed sleep.
  - The hold watches for a backend its own transaction blocks (`pg_blocking_pids`), then commits.
  - If nothing waits before its deadline, it rolls back and fails the test, which therefore can't pass without the overlap.
- **The schema cache.** Supabase reloads PostgREST's schema cache after DDL through its event triggers, so after `db push` the new function is served. If the phone check fails and the Worker logs a `watchlist-matches` line naming PGRST202, the owner runs `notify pgrst, 'reload schema';` in the SQL editor.

## Phase 1: The database refuses an own-shop decision and saves in one statement

### Overview

One migration adds the backstop and the save, and the database checks prove what a direct call can do with them. The app's code is untouched, so CI shows that the code still deployed keeps saving decisions and lookups against the new schema.

### Changes Required:

#### 1. The migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_decision_store_backstop.sql` (new; its version sorts after every existing one)

**Intent**: Make "a product holds no decision in its own shop" (I-8) hold for every row and every caller, and give the app one statement that saves any decision (I-1, I-3, I-5).

**Contract**: Five parts, in this order.

1. **Delete own-shop decisions.**
   - The statement: `delete from public.watchlist_matches as m using public.watchlist_items as i where i.id = m.watchlist_item_id and i.user_id = m.user_id and m.shop_id = i.source;`.
   - Its comment says why: no page reads such a row, but a stored match keeps its shop item watched under the price policies (`supabase/migrations/20260928011450_price_observations.sql:99-106`, `:119-126`). It also says the owner counts them before the push.
2. **The trigger.**
   - `public.refuse_own_shop_decision()` returns `trigger`, `language plpgsql`, `security invoker`, `set search_path = ''`.
   - When `public.watchlist_items` holds a row with `id = new.watchlist_item_id`, `user_id = new.user_id` and `source = new.shop_id`, it raises `using errcode = 'restrict_violation'` (23001), with a message naming `watchlist_matches_not_own_shop`. Otherwise, a missing or invisible product included, it returns `new`.
   - The trigger is `watchlist_matches_not_own_shop`, `before insert on public.watchlist_matches for each row`.
   - Its function's `execute` is revoked from `public`, `anon` and `authenticated`. No API role calls it, and it fires without a grant.
3. **The save.**
   - `public.record_decision`, `language plpgsql`, volatile, `security invoker`, `set search_path = ''`, returns `text`.
   - Its 16 parameters have no defaults, so every call names all of them.
   - It refuses an expected decision it can't read with `invalid_parameter_value` (22023):
     - the expected state must be null, `matched` or `unmatched`;
     - an expected match names its item and its decider;
     - an expected decline, or none, names neither.
   - Then it runs the one statement below. A row back is `saved`, none is `decided`, and only a `foreign_key_violation` on `watchlist_matches_own_product` is `gone`. Any other error propagates.
   - Its `where` meets no null: a stored state is never null, a stored match always names its item, and the expected match's item and decider were checked first. `returning … into` takes no `strict`, so no row back leaves the id null instead of raising.
   - `execute` is revoked from `public` and `anon` and granted to `authenticated`.
4. **Comments.**
   - Each new function gets one, and so does the trigger.
   - The table's comment says a decision is never stored in its product's own shop, and that `record_decision` saves one in one statement. Applied migrations are frozen, so the comment is replaced here, as `supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:15-17` did.
5. **Nothing else.** No table grant, policy or column changes.

The signature and the statement other phases depend on:

```sql
create function public.record_decision(
  p_item uuid, p_shop text, p_state text, p_decided_by text,
  p_shop_item_id text, p_name text, p_brand text, p_size_text text, p_size_value numeric, p_size_unit text,
  p_eans text[], p_product_url text, p_image_url text,
  -- the decision this write replaces: null (none, or a lookup that found nothing), 'matched' or 'unmatched'
  p_replaces_state text, p_replaces_item text, p_replaces_decided_by text
) returns text  -- 'saved' | 'decided' | 'gone'
…
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
…
exception when foreign_key_violation then
  get stacked diagnostics v_constraint = constraint_name;
  -- 'gone' only for watchlist_matches_own_product; any other key is raised again
```

#### 2. The matches checks

**File**: `scripts/check-matches-db.mjs`

**Intent**: Prove each row of the Desired End State's direct-call table that S-02 adds, by direct PostgREST calls as each user, as the lesson "Check what a direct database call allows" requires.

**Contract**:

- **Section 9 moves off the own shop.** Its three shape-breaking inserts go to a fresh product of user A's with no decisions, with its own source item id, in one of its matched shops. So only a check refuses each, with 23514 as before, and a missing check still shows as an added row.
- **A new section: no decision in a product's own shop.** It runs before the removal of section 10, on products of its own.
  - **A's Rossmann product.** A well-formed decision in Rossmann, one of each state (an automatic match, the user's decline, a lookup's "not found"), is refused with 23001, by a direct insert and by `record_decision`. A then reads no Rossmann decision for it.
  - **A product A adds from Natura.** A decision in Natura is refused with 23001, while one in Rossmann, a matched shop of that product, is stored. This is the negative control: the trigger reads the product's own shop and refuses no fixed one.
  - **User B.** B's direct insert and `record_decision` for A's product in its own shop answer 23503 and `gone`, exactly as for an id no one has. B's insert in A's name (`user_id` A's) for that product in its own shop answers 42501, as section 4's does in Hebe, never 23001: PostgreSQL checks the insert policy after a `before` trigger, so only a trigger that reads the product as its caller lets that insert get so far. So the trigger tells B nothing about A's product.
- **A new section: `record_decision` saves as its caller, in one statement.**
  - anon gets 42501.
  - B's call for A's product answers `gone`, in a shop where A has a decision and in one where A has none, and so does B's call for an id no one has. A's rows read back unchanged.
  - On a fresh product of A's, by A's own calls, in order:
    1. No expectation stores a lookup's "not found": `saved`.
    2. A retry's call over it is `saved`, and its `checked_at` moves forward, on the database's clock.
    3. A first choice's confirm over it is `saved`, as the user's match.
    4. A call expecting that item matched by the rule (`auto`) is `decided`, and nothing changes (F4).
    5. A call expecting the user's match of that item re-pins it to another item: `saved`. The row's `id`, `watchlist_item_id`, `user_id`, `shop_id` and `created_at` read back unchanged.
    6. A call expecting a decline over that match is `decided`.
  - Errors, never `gone` or `decided`, each changing nothing:
    - an expected match without its decider: 22023;
    - a shop no one knows: 23503, through the shop's key.

#### 3. The prices checks

**File**: `scripts/check-prices-db.mjs`

**Intent**: Keep the EAN-shape check proving the EAN rule, not meeting the trigger.

**Contract**: The first row of `eanShapes` (`:374-377`) names Super-Pharm instead of Rossmann. Super-Pharm is a matched shop of `aItemId`, user A's product of Rossmann item X, which has no decision there until section 8 adds one, so a missing EAN rule still shows as an added row.

#### 4. The catalogue check

**File**: `scripts/check-catalog-db.mjs`

**Intent**: Keep the public schema to its reviewed list with the new functions, and hold each function to its security, since RLS binds `record_decision` only while it runs as its caller.

**Contract**:

- `FUNCTIONS` names each function with its signature and its security:
  - `applied_migrations()`, `report_shop_block(text, text, integer, text)` and `reserve_shop_request(text)`: definer;
  - `record_decision(uuid, text, text, text, text, text, text, text, numeric, text, text[], text, text, text, text, text)`: invoker;
  - `refuse_own_shop_decision()`: invoker.
- The catalogue's function row reads `prosecdef`. A function whose security differs from the reviewed one is a fault, named like the others.
- The self-test's rolled-back transaction makes `record_decision` `security definer` and must see that flagged.
- Nothing else changes: the trigger function, like every function, must not be executable by `PUBLIC` or `anon`.

### Success Criteria:

#### Automated Verification:

- The branch sits on `main` with S-01 and S-03 merged: after `git fetch origin`, `git merge-base --is-ancestor origin/main HEAD` exits 0 and `git log --merges --oneline origin/main | grep -c "/refactor/page-lookups-through-guardian$"` prints 1
- S-03 left what Phase 2 builds on: `git grep -n "admitLookup" -- src/lib/services/watched-product.ts src/lib/services/shop-matching.ts` finds its definition and its call in the lookup's step, and `git grep -nE "(recordLookup|recordDecision)\(" -- src ':!*.test.ts'` finds the two definitions in `matches.ts` and one caller each, in `shop-matching.ts` and the decision route
- Lint passes: `npm run lint`
- The unit suite passes, the deploy gate's test reading the new migration's version among them: `npm run test`
- Types check: `npx astro sync && npx astro check`
- Phase 1 leaves the app's code and tests alone: `git diff --name-only origin/main...HEAD -- src tests` prints nothing
- CI only: CI's `smoke` job passes on Phase 1's commit: the migration applies, the database checks pass with the new refusals, and `npm run test:db`, smoke and the two-user check pass with the store unchanged
- CI only: CI's `e2e` job passes on Phase 1's commit, the seed's direct decision inserts and the two specs that tap „Żaden z nich” included

The `smoke` job's database checks are `check-matches-db.mjs` with the new refusals, `check-prices-db.mjs`, and `check-catalog-db.mjs` with both new functions reviewed as invoker, beside the shop gate's and the watchlist's checks and the deploy gate. Its `npm run test:db` runs the store unchanged, which is the proof that the code still deployed saves against the new schema. Read both jobs with `gh pr checks <PR>`.

**Implementation Note**: Open the pull request with this phase's commit, so CI runs on it, and start Phase 2 only once its `smoke` and `e2e` jobs are green.

---

## Phase 2: The store saves through one call

### Overview

`record` becomes one call to `record_decision`, and the user's re-pin over a match expects who decided it, as the guardian read it. The tests of every writer pin the call. The database test proves the one call against the real database, a removal held open during a save included.

### Changes Required:

#### 1. The store

**File**: `src/lib/services/matches.ts`

**Intent**: Save every decision in one atomic step, and expect, for a match, who decided it too (I-5, F4).

**Contract**:

- **A new type.** `ReplacedDecision = { state: "matched"; shopItemId: string; decidedBy: ShopMatch["decidedBy"] } | { state: "unmatched" }` is the decision a write replaces: the form's state and item, plus, for a match, who decided it. `ExpectedDecision` stays the form's own `replaces` (`:47`).
- **`recordDecision`** takes `replaces: ReplacedDecision | null`; its other parameters, and `recordLookup`'s, stay as S-03 left them.
- **`record`** makes one call: `supabase.rpc("record_decision", args).abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS))`.
  - `args` holds all 16 keys, each value as itself or `null`.
  - The columns are those `recordLookup` and `recordDecision` build today.
  - The expectation:
    - none: `p_replaces_state`, `p_replaces_item` and `p_replaces_decided_by` all null;
    - a match: `matched`, its item and its decider;
    - a decline: `unmatched` and two nulls.
- **The outcomes.**
  - `data` of `saved`, `decided` or `gone` passes through.
  - An error, whatever its code, is `failed`, logged once as `save failed` with its message.
  - Any other answer, `null` included, is `failed`, logged once as `unexpected save result` with its type.
- **`RecordResult` keeps its four values.** The doc comments of `record`, `RecordResult` and `decisionFieldsFor` (`:68-74`) say the one call and the database's refusal of the own shop.

#### 2. The guardian

**File**: `src/lib/services/watched-product.ts`

**Intent**: The admitted change carries the decider the guardian read, so the write refuses a match that changed hands since (F4).

**Contract**:

- `DecisionChange.replaces` becomes `ReplacedDecision | null`.
- `admitDecision` builds it from the form's own `replaces`: for a match, the form's state and item plus the stored match's `decidedBy`; for a decline or none, as the form posted it.
- No refusal and no check changes. If S-03 reshaped `DecisionChange`, the decider goes on the admitted user decision's expected decision wherever S-03 left it. A lookup's change needs none: a lookup replaces only none or a "not found", which only the rule decides (`watchlist_matches_decider_fits_state`, `supabase/migrations/20260927184936_watchlist_matches.sql:53-55`).

#### 3. The route

**File**: `src/pages/api/watchlist/matches.ts`

**Intent**: Hand the store the admitted change as before. Its comment says the change's `replaces` is the form's own, with who decided it as the guardian read it.

**Contract**: The call `recordDecision(supabase, change.itemId, change.shop, change.decision, change.replaces)` (`:69`) and every redirect stay as they are.

#### 4. The local superuser's held removal

**File**: `scripts/e2e-local-db.mjs`

**Intent**: Let a database test hold a removal open while a save runs, the overlap the roadmap names.

**Contract**:

- A new async export beside `sql()`, with JSDoc types like its other exports, such as `holdRemoval(itemId)`.
- It refuses any id but a UUID, as `sql()`'s callers refuse values outside their rules, then runs `docker exec … psql` as the local superuser without waiting.
- In one transaction it:
  1. deletes the watched product, whose decisions go with it;
  2. stays open until a backend its own transaction blocks shows up, by `pg_blocking_pids`, refreshing the activity snapshot each time;
  3. commits at once, or, past a deadline of a few seconds, rolls back with an error.
- It returns two promises:
  - `held`, which resolves once the delete statement, its cascade included, has returned: psql gets each statement as its own `-c` option, one request each in one session, so `pg_stat_activity` shows the wait's statement only after the delete, and `held` resolves when the hold's backend, named by its `application_name`, runs it (one `-c` holding every statement would be a single request, shown whole from the start);
  - `done`, which resolves when the transaction commits and rejects when it rolled back.
- Like `sql()`, it runs nothing unless `assertLocalSupabase()` passes.
- CI's `smoke` job already has Docker and writes `.env` and `.dev.vars` before `npm run test:db` (`.github/workflows/ci.yml:44-48`, `:69-72`), so the workflow doesn't change.

#### 5. The tests

**Files**: `src/lib/services/matches.test.ts`, `src/lib/services/match-routes.test.ts`, `src/lib/services/watched-product.test.ts`, `src/lib/services/shop-matching.test.ts`, `src/lib/services/product-page.test.ts` (S-03's), `src/lib/services/matches.db.test.ts`

**Intent**: Pin the one call where each writer makes it, close F3 in the route's tests, and prove the call against the real database.

**Contract**:

- **`matches.test.ts`, the store.**
  - Its write tests run on the shared `stubSupabase` with a `record_decision` handler, instead of the local insert-then-update stub (lesson "Define shared constants and helpers once").
  - Each kind of write pins its one call and exact arguments with `toStrictEqual`, then `["abortSignal", true]`:
    - a lookup's match;
    - a lookup's "not found";
    - a first choice's confirm and decline;
    - a re-pin over an automatic match;
    - a re-pin over the user's match;
    - a re-pin over a decline.
  - `saved`, `decided` and `gone` come back as they are.
  - These come back `failed`, each logged once:
    - errors: 42501, 57014, PGRST202, 23001, and an aborted call's empty code;
    - answers it can't read: `null`, an unknown string and an object.
  - `insertInto`, `updateOver`, `updateNotFound` and `duplicate` go, and so does the fake clock, which only the update's `checked_at` needed.
- **`match-routes.test.ts`, the route (F3).**
  - `world()` answers the call through a handler, `saved` by default.
  - `decisionWrites` counts a `record_decision` call beside any table insert or update, so the refusals' "no write" assertions would catch the route making the call.
  - `queryKinds` names the call (`rpc record_decision`).
  - Every admitted post pins the call's arguments: the form's own state and item, and, over a match, the decider the guardian read.
  - Per call, the store's `decided` comes back `decided=1`, its `gone` `error=gone`, and an error `error=failed`.
  - F4 at the route: a confirm of X with `matched:X` over an automatic match of X passes `p_replaces_decided_by: "auto"`, and when the call answers `decided`, as after another tab made X the user's, the post comes back `decided=1`.
  - The header comment no longer says the store's outcomes are pinned only below the route.
- **`watched-product.test.ts`, the guardian.** Each admitted change carries its decider:
  - over an automatic match of X, `auto`;
  - over the user's match, `user`;
  - over a decline or nothing, the form's `replaces` as posted.
- **`shop-matching.test.ts`, the lookups.**
  - The local `stubClient` gains `rpc`, answered by the call's name or made to throw.
  - `writesOf` reads a call as its name and arguments.
  - The 8 write assertions pin the lookup's one call (an automatic match or "not found", by `auto`, expecting none), then the first price check.
  - The step-level tests S-03 added for a write that answers `decided`, `failed` or `gone` answer the one call instead of an insert and an update, with the same expected views.
- **`product-page.test.ts`, the page's service (S-03's).**
  - Its stand-in answers `record_decision` through a handler, `saved` by default, in its own `world`, or in the shared one if S-03 moved `price-routes.test.ts`' into `src/lib/services/testing/`.
  - Its two cases whose lookup stores an outcome, a retry that stored its outcome and a match the view's lookup has just stored, pin the lookup's one call and its arguments, as the lookups' tests do, and keep their expected results.
  - Its other cases stay as S-03 left them.
- **`matches.db.test.ts`, the real database.**
  - Its 9 cases run through the one call, with `overMatch` naming the decider.
  - Two new cases for F4: a tab shown the automatic match of X, before the user confirmed X in another tab, confirms X and then picks Y. Both answer `decided`, and the user's match of X stands.
  - A new case for the own shop: `recordDecision` in the product's own shop answers `failed` and stores nothing.
  - Two new cases for the removal: a re-pin over a match, and a retry's lookup over "not found", each answer `gone` while `holdRemoval` holds their product's removal open. Neither answers `decided`; the hold commits; the product and its decisions are gone.
  - The negative control stays.

### Success Criteria:

#### Automated Verification:

- The store's, the route's, the guardian's, the lookups' and the page service's tests pass: `npx vitest run src/lib/services/matches.test.ts src/lib/services/match-routes.test.ts src/lib/services/watched-product.test.ts src/lib/services/shop-matching.test.ts src/lib/services/product-page.test.ts`
- Dropping the decider from the guardian's admitted change turns the guardian's and the route's decider tests red, and restoring it turns them green again
- Making the store send `null` for `p_replaces_decided_by` turns the store's and the route's decider tests red, and restoring it turns them green again
- Making the route hand the store `null` for `replaces` turns the route's re-pin argument tests red, and restoring it turns them green again
- The store writes `watchlist_matches` only through `record_decision`: `git grep -nE "\.(insert|update)\(" -- src/lib/services/matches.ts` prints nothing
- The unit suite passes: `npm run test`
- Lint passes: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- The build passes: `npm run build`
- CI only: CI's `smoke` job passes on the pull request: `npm run test:db` with the 9 cases through the one call, the decider's race, the own shop and the two held-open removals answering `gone`, the database checks, smoke and the two-user check
- CI only: CI's `e2e` job passes on the pull request, the two specs that tap „Żaden z nich” unchanged

**Implementation Note**: After the automated verification passes, Phase 3 can start; the phone check waits for Phase 4.

---

## Phase 3: Documents

### Overview

The documents say what the database and the store now do, and this plan records S-01's F3 and F4 closed.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: The rules an agent reads describe the backstop, the one save and the commands' new needs.

**Contract**:

- **"Data" (`:60`).**
  - The compare-and-swap sentence names `record_decision`: one `security invoker` statement that inserts, or replaces the stored decision only while it is the expected one, its state, its item and, for a match, who decided it. It answers `saved`, `decided` or `gone`, the last only for the product's own key, when a removal reaches the decision first, or the product when no decision is stored, so a removal never makes it answer `decided`. It stamps `checked_at` on the database's clock.
  - A new sentence says the `before insert` trigger `watchlist_matches_not_own_shop` refuses a decision in its product's own shop for every caller, with 23001, reading the product as its caller.
  - The ABA risk names the decider: a decision's `replaces` names a state, an item and who decided it, not a version.
- **"Shops and matching" (`:59`).**
  - The decision route's sentence says `recordDecision` saves through `record_decision`.
  - "So a decision stored in a product's own shop counts in no read" says that none can be stored: the database refuses one, and S-02's migration deleted those stored before. The readers' narrowing stays and also leaves out a shop switched off.
- **Commands.**
  - `npm run test:db` (`:39`) also needs Docker access to the local stack's database container and the local stack in `.env` and `.dev.vars`, for its held-open removal (`holdRemoval`).
  - `check-matches-db.mjs` (`:42`) also proves the own shop refused by a direct insert and by `record_decision`, and `record_decision`'s refusals: anon, another user's product, a decision other than the expected one.
  - `check-catalog-db.mjs` (`:44`) also holds each function to its reviewed security.

#### 2. The test plan

**File**: `context/foundation/test-plan.md`

**Intent**: The test plan names the new database seam and drops an edge S-02 closes.

**Contract**:

- §6.2, pattern 3 (`:135-141`): a database test that holds a removal open uses `holdRemoval`, and running `npm run test:db` locally needs Docker access and the local stack in `.env` and `.dev.vars`.
- §6.2, pattern 5 (`:150-157`): each function's security is on the reviewed list.
- §6.6 gains an S-02 note, "a roadmap slice, not a rollout phase":
  - the trigger's 23001 apart from the shape checks' 23514;
  - the held-open removal, which commits once the save waits, under the store's 2-second limit;
  - Phase 1's run of the old store against the new schema;
  - "CI only" for every database proof.
- §7:
  - The edge "A decision stored in a product's own shop" (`:441`) goes: the database refuses one.
  - The ABA edge (`:416`) narrows to the time: a decision's form names who decided it too.

#### 3. The glossary

**File**: `context/domain/glossary.md`

**Intent**: The decision's names in code include its save and its backstop.

**Contract**:

- The "decision" row's name in code adds "saved by `record_decision`".
- The "own shop" row adds that the database refuses a decision there (`watchlist_matches_not_own_shop`).

#### 4. The roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: S-02's Unknown records its answer.

**Contract**: The Unknown about old own-shop decisions says the owner's call of 2026-10-10: count them before the push, and the migration deletes them.

#### 5. This plan's notes

**File**: `context/changes/decision-store-backstop/plan.md`

**Intent**: Record S-01's carried findings closed, where S-02's review will look.

**Contract**: The Implementation Notes record:

- F3 closed by Phase 2's route tests;
- F4 closed by the decider in the expected decision;
- each with its commit.

### Success Criteria:

#### Automated Verification:

- The changed Markdown passes Prettier: `npx prettier --check context/foundation/test-plan.md context/domain/glossary.md context/foundation/roadmap.md context/changes/decision-store-backstop/plan.md`
- The closed edge is gone: `git grep -n "with no migration or invariant to refuse it" -- CLAUDE.md context/foundation` prints nothing
- The documents name the save: `git grep -c "record_decision" -- CLAUDE.md context/domain/glossary.md context/foundation/test-plan.md` counts at least one in each file
- The unit suite still passes: `npm run test`

`CLAUDE.md` is in `.prettierignore`, so the Prettier check leaves it out.

---

## Phase 4: Ship

### Overview

The owner counts the old rows, pushes the migration from this branch, confirms it and merges; then the phone shows the saves working.

### Changes Required:

None in the repository, beyond this plan's notes, which record the counts.

The order:

1. The pull request's final CI is green.
2. The owner counts, read-only in production's SQL editor and while no one else is saving, the own-shop decisions by state and all decisions:

   ```sql
   select m.state, count(*)
   from public.watchlist_matches as m
   join public.watchlist_items as i on i.id = m.watchlist_item_id
   where m.shop_id = i.source
   group by m.state
   order by m.state;

   select count(*) from public.watchlist_matches;
   ```

3. From a checkout of this branch, the owner runs `npx supabase db push`. In PowerShell, write `npx.cmd`.
4. The owner confirms the push, then runs both counts again: no own-shop decision is left, and all decisions are fewer by exactly the own-shop decisions counted before.
5. The owner merges, and the checked deploy runs.
6. The owner checks the phone.

From step 3 on, the migration file never changes.

### Success Criteria:

#### Automated Verification:

- `gh pr checks <PR>` shows `ci`, `smoke` and `e2e` passing on the head the owner pushes from
- After the merge, `gh run list --workflow "Deploy check" --limit 1` shows the merge's run succeeded

#### Manual Verification:

- Before the push, the owner's two read-only counts, the own-shop decisions by state and all decisions, ran in the dashboard's SQL editor, and their results are recorded in this plan's notes
- `npx supabase db push` from a checkout of this branch listed only the new migration and applied it
- `npx supabase migration list --linked` shows the new version on the remote, and `node scripts/check-migrations-applied.mjs` prints `All <n> migrations are applied`
- After the push, the own-shop count returns no rows, and all decisions are fewer by exactly the own-shop decisions counted before
- The owner merged the pull request after the push was confirmed
- On a phone after the deploy, a re-pin's „Żaden z nich” saves („Zapisano: brak w …”), a first choice's „To ten produkt” saves („Zapisano dopasowanie.”), and the product page opens

The gate's check runs with `CHECK_SUPABASE_URL` and `CHECK_SUPABASE_KEY` in the owner's shell only, never from a file (`CLAUDE.md`, Commands).

---

## Testing Strategy

### Unit Tests:

- **The store.**
  - Inputs: one call per kind of write, with its 16 arguments, pinned with `toStrictEqual`.
  - Outcomes: `saved`, `decided` and `gone` passed through. Every error, an aborted call's included, and every unreadable answer is `failed`, logged once.
- **The guardian.** The decider on each admitted change; every refusal unchanged.
- **The route.**
  - The call's arguments for each admitted post.
  - The three store outcomes per call.
  - F4's race answered `decided=1`.
  - No call for any refusal.
  - The order: read, read, call.
- **The lookups.** The one call and its arguments, then the first price check; S-03's `decided`, `failed` and `gone` steps on the one call.
- **The page's service (S-03's `product-page.test.ts`).** The lookup's one call and its arguments in its two cases that store, answered `saved`; its other cases unchanged.
- **Unchanged:**
  - `price-pages.test.ts`' negative control (no `rpc`), since its views aren't the user's own navigation and save nothing;
  - `price-routes.test.ts`;
  - the rest of the suite.

### Integration Tests:

These run in CI only.

- **`check-matches-db.mjs` (Phase 1).**
  - The own shop refused by a direct insert and by `record_decision`, beside the Natura product's Rossmann decision stored.
  - Another user's product answers like an id no one has, its own shop included, and B's insert in A's name there answers 42501, never 23001.
  - anon refused.
  - The compare-and-swap's answers, the database's clock, and the expectations it refuses.
- **`check-prices-db.mjs` and `check-catalog-db.mjs` (Phase 1).** The EAN shapes off the own shop; both functions reviewed as invoker, the self-test flagging a definer.
- **`matches.db.test.ts` (Phase 1 unchanged, then Phase 2).**
  - Phase 1: today's two statements against the new schema.
  - Phase 2: the one call through the real store, F4's race, the own shop, and the held-open removal for a re-pin and for a retry's lookup.
- **Unchanged and still green:**
  - `scripts/check-two-users.mjs`, whose seed inserts decisions in matched shops;
  - `scripts/smoke.mjs`;
  - the 10 e2e specs, whose seed's `matchShop` inserts in matched shops only, and whose two decision taps (`tests/e2e/phone-decline-match.spec.ts:57`, `tests/e2e/phone-three-shops.spec.ts:88`) go through the route.

### Manual Testing Steps:

1. Before the push, run both counts in production's SQL editor and note them.
2. After the push, run them again: no own-shop rows, and all decisions fewer by exactly the own-shop decisions counted before.
3. After the deploy, on a phone:
   1. Open a product with an automatic match, tap „Zmień”, then „Żaden z nich”. The card shows „Zapisano: brak w …” and „Dopasuj ponownie”.
   2. On a product whose shop offers a choice, tap „To ten produkt”. The card shows „Zapisano dopasowanie.” and the matched item.

## Performance Considerations

- **The save** is one request instead of one or two, still within the store's 2-second limit.
- **The trigger** adds one primary-key read of the product per insert attempt.
- **The function's exception block** opens one subtransaction per call.
- **Neither page's reads change, and no shop request is added or removed.**

## Migration Notes

- **What it deletes.** The migration deletes own-shop decisions, which can't be undone, since migrations don't roll back (`context/deployment/deploy-plan.md:303`). The owner counts them first, and all decisions before and after the push, so a delete that removed more would show. The research expects none: no page ever offered one, and since PR #44 only a crafted post, until S-01's guardian, or a direct call could store one (research §4).
- **The code still deployed** saves against the new schema: Phase 1's CI shows it, so the window between the push and the deploy, and any rollback of the Worker to code before S-02, keep working. This holds while the trigger and the delete stay as Phase 1 proved them (Critical Implementation Details, "Timing & lifecycle").
- **Changing `record_decision`'s parameters later** needs a new migration that drops it first and grants it again. A changed signature beside the old one would add an overload, which PostgREST tells apart by argument names only.

## References

- Research: `context/changes/decision-store-backstop/research.md`
- The owner's calls of 2026-10-10 from the planning interview: the Key Decisions in `plan-brief.md`
- The roadmap: `context/foundation/roadmap.md`, S-02 and S-03
- The refactor plan: `context/domain/02-invariant-aggregate-refactor.md`, Step 4's repository and phase 2, invariants I-1, I-3, I-5 and I-8
- S-01: `context/changes/decision-route-guardian/plan.md`, `reviews/impl-review.md` (F3, F4) and `follow-ups/review-fixes.md`
- S-03's research: `context/changes/page-lookups-through-guardian/research.md`, on its branch, then in `main` once S-03 merges
- The lessons: "Check what a direct database call allows", "Bound what each page view and action costs every shop", "Never read an unreadable answer as missing", "Define shared constants and helpers once" (`context/foundation/lessons.md`)
- Precedents:
  - the shop gate's functions and their grants (`supabase/migrations/20260926112205_polite_shop_access.sql:48-130`);
  - anon's refusals of a function (`scripts/check-shop-gate-db.mjs:115-127`);
  - a migration checked against the code still deployed (`context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:98`)

## Implementation Notes

### Phase 1

- **The migration's version is `20261010190000`,** after `20261006221608_price_history.sql`. No test pins the list: the deploy gate's test reads the folder (`scripts/check-migrations-applied.test.mjs:79`), and the new name matches its pattern.
- **`check-matches-db.mjs`'s new sections are 10 (the own shop) and 11 (`record_decision`),** so the removal moves from 10 to 12, and section 7's pointer to it follows.
- **Each section adds its own product.** `addProduct` takes an optional product row, Rossmann's 26900 by default. Section 9 adds Rossmann 26901, section 10 Rossmann 26902 and, for its negative control, Natura NV89063, and section 11 Rossmann 26903. Each check's name names the shop and the id.
- **Section 11's user B calls after A's six steps,** on the same product, so B meets a shop where A has a decision (Natura, B's call expecting A's re-pinned match exactly) and one where A has none. The contract lists B's calls first.
- **Section 11 proves each rule of the expectation check with its own 22023:** a match without its decider (the contract's case), a decline naming an item, no decision but a decider, and an unknown state. The unknown shop's 23503 also names `watchlist_matches_shop_id_fkey`.
- **Step 4 (F4) re-pins to the other item** while expecting the rule's match of X, rather than confirming X again, so "nothing changes" shows in the item as well as in `checked_at`.
- **The catalogue reads a function's security into the row's `invoker` field** (`not prosecdef`), which then means "runs as its caller" for views and functions alike.
- **The table's comment is two string literals** joined by SQL's newline continuation, to stay within 120 columns.
- **Checked locally on PGlite only, not a gate.** In the scratchpad, every migration applied on Postgres 17.5 and 18.3, with stubs for `auth` and the API roles. The delete, the trigger, `record_decision`'s six steps and refusals, and today's insert-then-update store behaved as the contract says. Copies of the three checks passed against a small PostgREST-like stand-in, and each failed when its rule was removed. Real PostgREST, the CLI's apply and concurrency are CI's.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The database refuses an own-shop decision and saves in one statement

#### Automated

- [x] 1.1 The branch sits on `main` with S-01 and S-03 merged: after `git fetch origin`, `git merge-base --is-ancestor origin/main HEAD` exits 0 and `git log --merges --oneline origin/main | grep -c "/refactor/page-lookups-through-guardian$"` prints 1
- [x] 1.2 S-03 left what Phase 2 builds on: `git grep -n "admitLookup" -- src/lib/services/watched-product.ts src/lib/services/shop-matching.ts` finds its definition and its call in the lookup's step, and `git grep -nE "(recordLookup|recordDecision)\(" -- src ':!*.test.ts'` finds the two definitions in `matches.ts` and one caller each, in `shop-matching.ts` and the decision route
- [x] 1.3 Lint passes: `npm run lint`
- [x] 1.4 The unit suite passes, the deploy gate's test reading the new migration's version among them: `npm run test`
- [x] 1.5 Types check: `npx astro sync && npx astro check`
- [x] 1.6 Phase 1 leaves the app's code and tests alone: `git diff --name-only origin/main...HEAD -- src tests` prints nothing
- [ ] 1.7 CI only: CI's `smoke` job passes on Phase 1's commit: the migration applies, the database checks pass with the new refusals, and `npm run test:db`, smoke and the two-user check pass with the store unchanged
- [ ] 1.8 CI only: CI's `e2e` job passes on Phase 1's commit, the seed's direct decision inserts and the two specs that tap „Żaden z nich” included

### Phase 2: The store saves through one call

#### Automated

- [ ] 2.1 The store's, the route's, the guardian's, the lookups' and the page service's tests pass: `npx vitest run src/lib/services/matches.test.ts src/lib/services/match-routes.test.ts src/lib/services/watched-product.test.ts src/lib/services/shop-matching.test.ts src/lib/services/product-page.test.ts`
- [ ] 2.2 Dropping the decider from the guardian's admitted change turns the guardian's and the route's decider tests red, and restoring it turns them green again
- [ ] 2.11 Making the store send `null` for `p_replaces_decided_by` turns the store's and the route's decider tests red, and restoring it turns them green again
- [ ] 2.3 Making the route hand the store `null` for `replaces` turns the route's re-pin argument tests red, and restoring it turns them green again
- [ ] 2.4 The store writes `watchlist_matches` only through `record_decision`: `git grep -nE "\.(insert|update)\(" -- src/lib/services/matches.ts` prints nothing
- [ ] 2.5 The unit suite passes: `npm run test`
- [ ] 2.6 Lint passes: `npm run lint`
- [ ] 2.7 Types check: `npx astro sync && npx astro check`
- [ ] 2.8 The build passes: `npm run build`
- [ ] 2.9 CI only: CI's `smoke` job passes on the pull request: `npm run test:db` with the 9 cases through the one call, the decider's race, the own shop and the two held-open removals answering `gone`, the database checks, smoke and the two-user check
- [ ] 2.10 CI only: CI's `e2e` job passes on the pull request, the two specs that tap „Żaden z nich” unchanged

### Phase 3: Documents

#### Automated

- [ ] 3.1 The changed Markdown passes Prettier: `npx prettier --check context/foundation/test-plan.md context/domain/glossary.md context/foundation/roadmap.md context/changes/decision-store-backstop/plan.md`
- [ ] 3.2 The closed edge is gone: `git grep -n "with no migration or invariant to refuse it" -- CLAUDE.md context/foundation` prints nothing
- [ ] 3.3 The documents name the save: `git grep -c "record_decision" -- CLAUDE.md context/domain/glossary.md context/foundation/test-plan.md` counts at least one in each file
- [ ] 3.4 The unit suite still passes: `npm run test`

### Phase 4: Ship

#### Automated

- [ ] 4.1 `gh pr checks <PR>` shows `ci`, `smoke` and `e2e` passing on the head the owner pushes from
- [ ] 4.2 After the merge, `gh run list --workflow "Deploy check" --limit 1` shows the merge's run succeeded

#### Manual

- [ ] 4.3 Before the push, the owner's two read-only counts, the own-shop decisions by state and all decisions, ran in the dashboard's SQL editor, and their results are recorded in this plan's notes
- [ ] 4.4 `npx supabase db push` from a checkout of this branch listed only the new migration and applied it
- [ ] 4.5 `npx supabase migration list --linked` shows the new version on the remote, and `node scripts/check-migrations-applied.mjs` prints `All <n> migrations are applied`
- [ ] 4.6 After the push, the own-shop count returns no rows, and all decisions are fewer by exactly the own-shop decisions counted before
- [ ] 4.7 The owner merged the pull request after the push was confirmed
- [ ] 4.8 On a phone after the deploy, a re-pin's „Żaden z nich” saves („Zapisano: brak w …”), a first choice's „To ten produkt” saves („Zapisano dopasowanie.”), and the product page opens
