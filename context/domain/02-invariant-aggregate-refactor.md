---
title: "Invariant aggregate: a watched product's shop decisions"
created: 2026-10-09
type: refactor-plan
---

# Invariant aggregate: a watched product's shop decisions

This is a plan, not code. It follows the module 4 prompt `m4l5-2-invariant-aggregate-refactor` and starts from the domain map's #1 candidate (`context/domain/domain-distillation.md`, Ranking), which the owner picked for M-2 on 2026-10-09. It feeds the next cycle: `/10x-shape`, `/10x-roadmap` (opening M-2), `/10x-research`, `/10x-plan`. It uses the terms of `context/domain/glossary.md`: a **watched product**, its **own shop** and **matched shops**, and one **decision** per matched shop (a **match**, a **decline** or **not found**). Every citation is to the code at f798c04.

## Step 0: Context

**What the requirements say.**

- The anchor: "the EAN is stored when available as a helper for shop lookups, and the confirmed per-shop item (FR-006) is the anchor" (`context/foundation/prd.md:105`).
- Asked once: "the choice is remembered so it is never asked again unless the user re-pins" (`context/foundation/prd.md:71`), and "A refresh that returns nothing for a confirmed match marks the price stale; it never un-pins the match" (`context/foundation/prd.md:77`).
- The own shop: "The product's own item, in whichever shop it was picked, isn't re-pinned" (`context/foundation/prd.md:138`).
- Re-pinning: the new choice "marks the current item and is never accepted on its own", and "the app offers no reset to undecided" (`context/foundation/prd.md:135`).
- Stale forms: "each of its forms posts the decision it replaces (`replaces`), so one from a stale tab changes nothing" (`CLAUDE.md:58`), with "the lookup and a first choice only over `not_found`, a re-pin only over the decision it replaces" (`CLAUDE.md:60`).

**Where the decision logic lives.** The stack is Astro pages and form routes on Cloudflare Workers, over Supabase Postgres with RLS. There is no domain layer: the rules sit in plain service modules, the page, the route, the forms and the database.

| layer               | what it holds for decisions                                                            | where                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| persistence         | the table, its shape checks, its ownership key, the RLS policies and the column grants | `supabase/migrations/20260927184936_watchlist_matches.sql:20-94`; `supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:19-29`; `supabase/migrations/20260928011450_price_observations.sql:24-31` |
| service, write      | the form's parsing and the compare-and-swap write                                      | `src/lib/services/matches.ts:67-174`, `:254-342`                                                                                                                                                                |
| service, read       | the reads, and every reader's own narrowing to the matched shops                       | `src/lib/services/matches.ts:383-468`; eight places listed in Step 3                                                                                                                                            |
| service, page steps | what the product page does for each matched shop, and the lookup's write               | `src/lib/services/match-step.ts:60-78`; `src/lib/services/shop-matching.ts:312-404`                                                                                                                             |
| entry               | the decision route and the product page                                                | `src/pages/api/watchlist/matches.ts:11-45`; `src/pages/watchlist/[id].astro:52-105`                                                                                                                             |
| UI                  | which buttons a choice offers, and the candidate's fields in hidden inputs             | `src/lib/services/match-view.ts:329-376`; `src/components/watchlist/MatchChoice.astro:51-56`, `:116-130`, `:142-152`                                                                                            |

## Step 1: The invariants

Each rule below must always hold for a watched product's decisions. The R-numbers are the domain map's.

| id   | invariant                                                                                                                                                 | source                                          | domain map |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------- |
| I-1  | One decision per watched product and shop.                                                                                                                | `CLAUDE.md:60`                                  | R-01       |
| I-2  | A decision's shape fits its state: a match names an item, and only the user declines and only the lookup finds nothing.                                   | `CLAUDE.md:60`                                  | R-02       |
| I-3  | A decision stays with its product, user and shop, and goes only with its product.                                                                         | `CLAUDE.md:60`                                  | R-03       |
| I-4  | A settled decision is never asked again unless the user re-pins it.                                                                                       | `context/foundation/prd.md:71`                  | R-04       |
| I-5  | A write changes a decision only while it is the one its writer saw.                                                                                       | `CLAUDE.md:58`; `CLAUDE.md:60`                  | R-05       |
| I-6  | A refresh never un-pins a match.                                                                                                                          | `context/foundation/prd.md:77`                  | R-06       |
| I-7  | Nothing resets a decision to undecided.                                                                                                                   | `context/foundation/prd.md:135`                 | R-07       |
| I-8  | A product holds no decision in its own shop.                                                                                                              | `context/foundation/prd.md:138`; `CLAUDE.md:59` | R-08       |
| I-9  | A re-pin's choice never accepts a candidate on its own.                                                                                                   | `context/foundation/prd.md:135`                 | R-09       |
| I-10 | A decision moves only along the legal moves: „Żaden z nich” only from a match or a first choice, and the user's own confirmed item isn't confirmed again. | `CLAUDE.md:58`                                  | R-10       |
| I-11 | A confirmed match is an item the shop offered for this product, as the shop showed it.                                                                    | `context/foundation/prd.md:71`                  | R-11       |
| I-12 | Only the matching rule accepts a candidate on its own.                                                                                                    | `CLAUDE.md:59`                                  | R-12       |
| I-13 | A match is suspicious only on a definite difference, and a match the user confirmed leaves „Do sprawdzenia”.                                              | `context/foundation/prd.md:135`                 | R-14       |

## Step 2: Classification, and the invariant chosen

The axes: (a) how core the rule is to the product, (b) how far it is spread across layers, (c) how strictly it is enforced.

| id             | (a) core                                                                   | (b) spread                                           | (c) enforcement                                                                                                                               |
| -------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| I-1, I-2, I-3  | high: the decision is the anchor                                           | database, plus the write's error mapping             | hard (data)                                                                                                                                   |
| I-4, I-7       | high                                                                       | `decideMatchStep`, `record`                          | hard (app); a direct call can reset an owner's own decision, an accepted risk (`CLAUDE.md:60`)                                                |
| I-5            | high: a stale tab must not undo a newer pick                               | `record`, the forms' `replaces`, the route           | hard (app) only. The database stopped narrowing by state in S-08 (`supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:19-29`) |
| I-6, I-9, I-12 | high                                                                       | one or two service functions each                    | hard (app)                                                                                                                                    |
| I-8            | high: a decision outside the matched shops is stored where no reader looks | the form, the route, the database, and eight readers | **read side only**: the write accepts it, and each reader drops it on its own                                                                 |
| I-10           | high: it defines which moves exist                                         | the UI's buttons, `repinView`, `record`              | **client-only**: the server accepts a decline over a decline and a second confirmation of the user's own item                                 |
| I-11           | medium: only the poster's own list is affected                             | the hidden fields, `parseMatchForm`                  | client-only for the item's data; the server checks only the id's format and the links' hosts                                                  |
| I-13           | medium                                                                     | `matchDifferences`, the list                         | hard (app), derived at read time                                                                                                              |

**Chosen: the decision state machine (I-5, I-8 and I-10 together).** A watched product holds decisions only for its matched shops, at most one each. Each decision moves only along the legal moves, and only from the state its writer saw.

- **Core.** Every comparison reads the product's own item and its matched items (`productPriceKeys`, `src/lib/services/price-comparison.ts:593-611`), so a decision in the wrong place or state changes what the app compares and names cheapest.
- **Spread.** Its parts live in the database, in `record`, in `decideMatchStep`, in `parseMatchForm`, in `repinView`'s buttons, in the route, on the page and in eight readers.
- **Weakly enforced.** Its scope (I-8) is checked only when reading, its legal moves (I-10) only in the UI, and its staleness (I-5) only in one service function. That makes it the most core rule with the weakest enforcement.

**Not chosen:**

- I-11: it affects only the poster's own list. Checking a confirmed item against what the shop offered costs a shop request per confirmation, or a stored offer, which is a decision for the owner, not a refactor.
- I-12: it is already enforced in one place, since `pickMatch` decides and only the lookup writes an automatic match. Its gap is the accepted direct-call risk.

## Step 3: Diagnosis of the decision state machine

### Where the rule lives today

| layer         | place                                     | what it does for the rule                                                                                                                       | file:line                                                                                                                                                                                                                                                               |
| ------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data          | the table's keys and checks               | one decision per product and shop; shape by state; the owner's product only                                                                     | `supabase/migrations/20260927184936_watchlist_matches.sql:47-63`                                                                                                                                                                                                        |
| data          | RLS update policy since S-08              | lets the owner change a decision in any state; the original S-02 policy allowed updates only over `not_found`                                   | `supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:19-29`; `supabase/migrations/20260927184936_watchlist_matches.sql:86-89`                                                                                                                            |
| data          | the update grant                          | only the decision's columns, so no update moves a decision                                                                                      | `supabase/migrations/20260928011450_price_observations.sql:24-31`                                                                                                                                                                                                       |
| entry         | the decision route                        | parses any priced shop, then writes without loading the product                                                                                 | `src/pages/api/watchlist/matches.ts:22`, `:28`, `:33`                                                                                                                                                                                                                   |
| service       | `decisionFieldsFor`, `parseMatchForm`     | takes any priced shop. Its own comment: "The form doesn't say which shop is the product's own"                                                  | `src/lib/services/matches.ts:67-79`, `:140`                                                                                                                                                                                                                             |
| service       | `record`                                  | inserts; on a conflict, updates only where the stored state is the expected one (compare-and-swap)                                              | `src/lib/services/matches.ts:296-342`, the condition at `:325-330`                                                                                                                                                                                                      |
| service       | `recordLookup`, `recordDecision`          | build the columns of each kind of write                                                                                                         | `src/lib/services/matches.ts:258-287`                                                                                                                                                                                                                                   |
| service       | `decideMatchStep`                         | looks up only without a decision, or to retry a not found; shows a settled decision                                                             | `src/lib/services/match-step.ts:60-78`                                                                                                                                                                                                                                  |
| service       | `lookupOutcome`                           | writes the lookup's outcome, then its first price in a second write                                                                             | `src/lib/services/shop-matching.ts:385-393`                                                                                                                                                                                                                             |
| service, read | the eight narrowings to the matched shops | `runMatchSteps`; `productPriceKeys`; `productTargets`; `itemInRows`'s own comparison; `onListOf`; `matchStatesOf`; `listMatchedShops`; the page | `src/lib/services/shop-matching.ts:313`; `src/lib/services/price-comparison.ts:603`; `src/lib/services/price-targets.ts:165`, `:92-94`; `src/lib/services/product-search.ts:246`; `src/lib/services/watchlist-rows.ts:432`, `:492`; `src/pages/watchlist/[id].astro:78` |
| UI            | `repinView`                               | „Żaden z nich” only from a match; no „To ten produkt” for the user's own confirmed item                                                         | `src/lib/services/match-view.ts:338`, `:341`                                                                                                                                                                                                                            |
| UI            | the choice's forms                        | post the candidate's fields and `replaces` from hidden inputs                                                                                   | `src/components/watchlist/MatchChoice.astro:116-130`, `:142-152`                                                                                                                                                                                                        |

### Layers that don't enforce it

- **The database.** It knows nothing of the own shop: no constraint relates a decision's `shop_id` to its product's `source` (`supabase/migrations/20260927184936_watchlist_matches.sql:20-68`). It stopped guarding the moves in S-08. A test pins that an update ignoring the decision it replaces overwrites a newer one there (`src/lib/services/matches.db.test.ts:217`), and that an owner turns their own not-found row into a match directly (`scripts/check-matches-db.mjs:294-314`).
- **The route.** It never loads the product, so it can't tell the product's own shop, and it leaves every move's legality to the stored state's compare-and-swap.

### Where it is enforced inconsistently

- **Scope.** The write accepts a decision in the product's own shop (`src/lib/services/matches.ts:67-79`), while eight readers each drop it on their own.
- **Moves.** `record` checks only that the stored state is the expected one, not that the requested move is legal from it. A decline posted with `replaces=unmatched` passes the schema (`src/lib/services/matches.ts:98-120`) and the update's condition (`:330`), and so does confirming the user's own confirmed item with `replaces=matched:<that item>`. The UI never offers either (`src/lib/services/match-view.ts:338`, `:341`).

### Where the client is the only guard

- Which moves the choice offers (`src/lib/services/match-view.ts:337-341`; `src/components/watchlist/MatchChoice.astro:51-56`).
- The confirmed item's name, brand, size and EANs (`src/components/watchlist/MatchChoice.astro:116-130`). This is I-11, kept out of scope.

### Where an error is swallowed instead of stopping

- **A decision in the product's own shop** is stored and answered `saved` (`src/lib/services/matches.ts:303-308`). The route then redirects to `?shop=<own shop>&matched=1` (`src/pages/api/watchlist/matches.ts:36-37`), and the page, which has no card for its own shop, opens plain: "an address naming that shop opens the plain page" (`CLAUDE.md:59`). The write is accepted, and nothing tells anyone it means nothing.
- **A decline over a decline**, and a second confirmation of the user's own item, are answered `saved` as if something changed.
- **A product removed between the two statements.** `record` inserts and, on a conflict, updates in a second statement (`src/lib/services/matches.ts:303-341`). A product removed in between answers `decided`, not `gone` (inference from the two statements; no test covers it).

## Step 4: The guardian aggregate

### The root: `WatchedProduct`

`WatchedProduct` is a pure module, `src/lib/services/watched-product.ts`, server-side, with no Supabase import. Its identity is the watched product's id. It holds its own shop and its matched shops, derived once from `source`, and one standing for each matched shop: undecided, decided (with the decision) or unreadable. It is the only place in the app that decides whether a decision may change. The database keeps a backstop for the scope, as it does for ownership.

```ts
type Expected = { state: "none-or-not-found" } | { state: "matched"; shopItemId: string } | { state: "unmatched" };
type Standing = { kind: "undecided" } | { kind: "decided"; decision: ShopMatch } | { kind: "unreadable" };

/** A write the aggregate allowed: the shop, the state it expects to replace, and the decision to store. */
interface DecisionChange {
  productId: string;
  shop: PricedShop;
  expects: Expected;
  to:
    | { state: "matched"; decidedBy: "auto" | "user"; item: MatchedItem }
    | { state: "unmatched" }
    | { state: "not_found" };
}

/** Why the aggregate refused a write, by name: it never stores a refused change, and never logs one and goes on. */
class DecisionRefused extends Error {
  constructor(readonly reason: "not-a-matched-shop" | "unreadable" | "settled" | "stale" | "illegal-move") {
    super(reason);
  }
}

class WatchedProduct {
  static from(product: WatchlistProduct, read: MatchesRead): WatchedProduct;
  /** The one definition of a product's matched shops: every priced shop but its own, in the priced order. */
  static matchedShopsFor(source: ShopId, shops?: readonly PricedShop[]): PricedShop[];
  matchedShops(): PricedShop[];
  standingIn(shop: ShopId): Standing; // throws not-a-matched-shop
  priceKeys(): PricedKey[]; // the own item, then each matched item
  lookUp(shop: ShopId, outcome: { kind: "accepted"; candidate: ShopCandidate } | { kind: "not-found" }): DecisionChange;
  confirm(shop: ShopId, item: MatchedItem, replaces: ExpectedDecision | null): DecisionChange;
  decline(shop: ShopId, replaces: ExpectedDecision | null): DecisionChange;
}
```

### The legal moves

Rows are the standing in the shop; columns are the write. Anything not listed is refused with the named reason.

| standing              | `lookUp`                          | `confirm`                                                          | `decline`                            |
| --------------------- | --------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| undecided             | a match by the rule, or not found | a match of the user's, with no `replaces`                          | a decline, with no `replaces`        |
| not found             | the same as undecided: a retry    | the same as undecided                                              | the same as undecided                |
| automatic match of X  | `settled`                         | X or another item, with `replaces=matched:X`                       | a decline, with `replaces=matched:X` |
| the user's match of X | `settled`                         | another item, with `replaces=matched:X`; X again is `illegal-move` | a decline, with `replaces=matched:X` |
| a decline             | `settled`                         | a match of the user's, with `replaces=unmatched`                   | `illegal-move`                       |
| unreadable            | `unreadable`                      | `unreadable`                                                       | `unreadable`                         |

- A shop that isn't one of the product's matched shops, its own included, is `not-a-matched-shop`.
- A `replaces` that doesn't name the standing is `stale`: no `replaces` against a match or a decline, or one naming another item or state.

### Pseudocode

```ts
confirm(shop, item, replaces) {
  const standing = this.standingIn(shop);                // not-a-matched-shop
  if (standing.kind === "unreadable") throw new DecisionRefused("unreadable");
  const expects = this.expectFor(standing, replaces);     // stale when replaces doesn't name the standing
  if (standing.kind === "decided" && standing.decision.state === "matched"
      && standing.decision.decidedBy === "user" && standing.decision.item.shopItemId === item.shopItemId) {
    throw new DecisionRefused("illegal-move");           // the user's own item, confirmed again
  }
  return { productId: this.id, shop, expects, to: { state: "matched", decidedBy: "user", item } };
}

decline(shop, replaces) {
  const standing = this.standingIn(shop);
  if (standing.kind === "unreadable") throw new DecisionRefused("unreadable");
  if (standing.kind === "decided" && standing.decision.state === "unmatched") throw new DecisionRefused("illegal-move");
  return { productId: this.id, shop, expects: this.expectFor(standing, replaces), to: { state: "unmatched" } };
}

lookUp(shop, outcome) {
  const standing = this.standingIn(shop);
  if (standing.kind === "unreadable") throw new DecisionRefused("unreadable");
  if (standing.kind === "decided" && standing.decision.state !== "not_found") throw new DecisionRefused("settled");
  return { productId: this.id, shop, expects: { state: "none-or-not-found" },
           to: outcome.kind === "accepted" ? { state: "matched", decidedBy: "auto", item: outcome.candidate }
                                           : { state: "not_found" } };
}
```

### The repository: one load, one atomic save

- **`loadWatchedProduct(supabase, id)`** returns a `WatchedProduct`, `null` (not on the list) or `"failed"`. It makes the two reads the page already makes at once (`src/pages/watchlist/[id].astro:52-60`) and builds the aggregate.
- **`saveDecision(supabase, change)`** returns `"saved"`, `"gone"` or `"failed"`, and throws `DecisionRefused("stale")` when the stored decision is no longer `change.expects`.
- **It writes in one statement**, through a `security invoker` SQL function, so RLS and the column grants still bind it. The insert and the compare-and-swap become one atomic statement, where today they are two (`src/lib/services/matches.ts:303-341`):

```sql
-- public.record_decision(p_item uuid, p_shop text, p_expects_state text, p_expects_item text, <the new columns>)
insert into public.watchlist_matches (watchlist_item_id, shop_id, product_source, state, decided_by, …)
select i.id, p_shop, i.source, p_state, p_decided_by, …
from public.watchlist_items as i
where i.id = p_item                                   -- RLS: the caller's own product only; none means gone
on conflict (watchlist_item_id, user_id, shop_id) do update
  set state = excluded.state, decided_by = excluded.decided_by, …, checked_at = now()
  where watchlist_matches.state = p_expects_state      -- 'not_found' when the change expects none-or-not-found
    and (p_expects_item is null or watchlist_matches.shop_item_id = p_expects_item)
returning id;                                         -- no row back: stale (or gone when the product was missing)
```

The function follows the project's grant rules: `revoke execute ... from public, anon` and `grant execute ... to authenticated`.

**The scope's backstop in the database (recommended).** Add `product_source text not null` to `watchlist_matches`. Widen the ownership key to `(watchlist_item_id, user_id, product_source) references watchlist_items (id, user_id, source) on delete cascade`, and add `check (shop_id <> product_source)`.

- This extends the composite key the table already uses for ownership (`supabase/migrations/20260927184936_watchlist_matches.sql:47-48`).
- Neither column can change after the insert: a product's row has no update grant, and a decision's update grant leaves `product_source`, `shop_id` and `watchlist_item_id` out (`supabase/migrations/20260928011450_price_observations.sql:24-31`). So the check holds for good.
- The alternative is a `before insert` trigger that compares the two values. It changes no writer, but it would be the project's first trigger.

### The thin route

```ts
export const POST: APIRoute = async (context) => {
  const form = await readForm(context); // as today: invalid on a bad body
  const posted = parseMatchForm(form); // as today: formats and the shop's id rules
  const product = await loadWatchedProduct(supabase, posted.itemId); // null → gone, "failed" → failed
  try {
    const change =
      posted.decision.action === "confirm"
        ? product.confirm(posted.shop, posted.decision.item, posted.replaces)
        : product.decline(posted.shop, posted.replaces);
    const saved = await saveDecision(supabase, change); // "saved" | "gone" | "failed"
    return redirect(backTo(saved === "saved" ? noticeOf(posted.decision) : { error: saved }));
  } catch (refused) {
    // stale and settled: the decision stands ("decided"); not-a-matched-shop and illegal-move: invalid;
    // unreadable: failed. None of them is stored.
    return redirect(backTo(codeOf(refused)));
  }
};
```

Enforcement moves from the client to the server: the moves the UI hides (I-10) are refused by the aggregate, not just left unoffered.

### The page

`[id].astro` builds one `WatchedProduct` from its existing reads. `runMatchSteps` takes it instead of `matches` and `shops`:

- `decideMatchStep` reads `standingIn(shop)`;
- `lookupOutcome` calls `lookUp`, then `saveDecision`, and shows `decidedView` on `settled` or `stale`, as it does for `decided` today (`src/lib/services/shop-matching.ts:400-403`);
- `productPricesOf` takes `priceKeys()`.

The list, which reads every decision in one query (`listMatchStates`), keeps its bulk read and asks `WatchedProduct.matchedShopsFor` for each row, so the matched shops have one definition.

## Step 5: Before and after, phases, tests

### Before and after, for each place of the rule

| place                                                                                                                                   | before                                                                                                            | after                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/pages/api/watchlist/matches.ts:28-44`                                                                                              | parses, writes, maps four codes                                                                                   | parses, loads the aggregate, calls `confirm` or `decline`, saves, maps named refusals                       |
| `src/lib/services/matches.ts:67-79`, `:140`                                                                                             | any priced shop, the own one included                                                                             | unchanged as parsing; the aggregate refuses a shop outside the matched shops                                |
| `src/lib/services/matches.ts:258-342`                                                                                                   | `recordLookup` and `recordDecision` build columns; `record` inserts, then compare-and-swaps in a second statement | `saveDecision(change)` writes one atomic statement through `record_decision`; the three functions go        |
| `src/lib/services/match-step.ts:60-78`                                                                                                  | reads `matches.matches.find(…)`                                                                                   | reads `standingIn(shop)`; the rule for when a view may spend requests (own navigation, retry, re-pin) stays |
| `src/lib/services/shop-matching.ts:312-315`, `:375-404`                                                                                 | `matchedShopsOf(source)`; `recordLookup`, then a `decided` view                                                   | `matchedShops()`; `lookUp`, then `saveDecision`; a refusal shows `decidedView`                              |
| `src/lib/services/price-comparison.ts:593-611`; `src/lib/services/prices.ts:318`; `src/lib/services/price-targets.ts:92-94`, `:165-167` | each derives the own item and the matched items                                                                   | `priceKeys()` and `standingIn` of a loaded aggregate                                                        |
| `src/lib/services/product-search.ts:246`; `src/lib/services/watchlist-rows.ts:432`, `:492`                                              | `matchedShopsOf` per product                                                                                      | `WatchedProduct.matchedShopsFor`, the one definition                                                        |
| `src/pages/watchlist/[id].astro:52-105`                                                                                                 | two reads, `matchedShopsOf`, then the steps                                                                       | the same reads build one aggregate, which the steps and the prices take                                     |
| `src/lib/services/match-view.ts:337-341`                                                                                                | the only guard of the legal moves                                                                                 | unchanged UI; the server now refuses what it hides                                                          |
| `supabase/migrations/20260927184936_watchlist_matches.sql:47-48`                                                                        | key `(watchlist_item_id, user_id)`                                                                                | key `(watchlist_item_id, user_id, product_source)`, and `check (shop_id <> product_source)`                 |
| `supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:26-29`                                                              | the owner updates in any state                                                                                    | unchanged: the accepted direct-call risk (`CLAUDE.md:60`)                                                   |

### Phases

1. **The aggregate, test-first.** Add `watched-product.ts` and its unit tests (the cases below); no wiring. Each case is written red first, and a deliberate break of a precondition turns it red again.
2. **The database backstop, test-first.** A migration adds `product_source` with a backfill from `watchlist_items`, the widened key, the check and `record_decision` with its grants. `scripts/check-matches-db.mjs` gains its cases first: a decision in the product's own shop is refused (23514), `product_source` can't be updated (42501), and the function binds RLS (user B can't write user A's decision). Every direct insert in the database checks and the e2e seed names `product_source`: about 17 insert sites, some in helpers, across `scripts/check-matches-db.mjs`, `scripts/check-prices-db.mjs`, `scripts/check-two-users.mjs`, `tests/e2e/support/watchlist-data.ts` and `src/lib/services/matches.db.test.ts`.
3. **The repository.** Add `loadWatchedProduct` and `saveDecision` over the function. `src/lib/services/matches.db.test.ts` keeps its nine cases (`:127`–`:217`), adapted, and gains the refusals.
4. **Wiring.** The route, the page, the steps, the price keys and the list's readers move to the aggregate; `record`, `recordLookup`, `recordDecision` and the readers' own derivations go. The unit suites of `match-step`, `shop-matching`, `price-targets`, `prices`, `product-search` and `watchlist-rows` follow. The e2e suite runs unchanged as the user-visible proof.
5. **Documents.**
   - `CLAUDE.md`: the own-shop decision is refused, no longer "stored, then ignored", and the new names are added.
   - The glossary: the decision's name in code.
   - The domain map's D-01 fix: `context/foundation/prd.md:136` says „Do sprawdzenia” also holds a price that isn't fresh.

### Test cases for the invariant

**Legal moves:**

1. Undecided, then `lookUp(accepted)`: an automatic match.
2. Undecided, then `lookUp(not-found)`: not found.
3. Not found, then `lookUp` (a retry): a match by the rule, or not found again.
4. Undecided or not found, then `confirm` without `replaces`: the user's match.
5. Undecided or not found, then `decline` without `replaces`: a decline.
6. An automatic match of X, then `confirm(X, replaces=matched:X)`: the user's match of X („To ten produkt”).
7. A match of X, then `confirm(Y, replaces=matched:X)`: the user's match of Y.
8. A match of X, then `decline(replaces=matched:X)`: a decline.
9. A decline, then `confirm(Y, replaces=unmatched)`: the user's match of Y.
10. Two re-pins from the same match: exactly one is saved, the other is `stale` (as `src/lib/services/matches.db.test.ts:191`).
11. A lookup that started before the user's pick stores after it: the pick stands (as `src/lib/services/matches.db.test.ts:136`).

**Refused moves:**

12. Any write in the product's own shop: `not-a-matched-shop` in the app, 23514 in the database.
13. Any write in a shop that isn't priced: `not-a-matched-shop`.
14. `lookUp` over a match or a decline: `settled`.
15. `confirm` or `decline` without `replaces` over a match or a decline: `stale`.
16. `replaces=matched:X` while the match is of Z, or `replaces=unmatched` while it is a match: `stale`.
17. `decline(replaces=unmatched)` over a decline: `illegal-move`.
18. `confirm(X, replaces=matched:X)` over the user's own match of X: `illegal-move`.
19. Any write while the shop's stored decision couldn't be read: `unreadable`.
20. A write for a product no longer on the list, removed before or during the save: `gone`.

### New load-bearing names

- In TypeScript: `WatchedProduct`, `DecisionChange`, `DecisionRefused` with its five reasons, `loadWatchedProduct`, `saveDecision`.
- In SQL: the function `public.record_decision`, the column `watchlist_matches.product_source`, and the check `watchlist_matches_not_own_shop`.

The project keeps no separate register of names. They belong in `CLAUDE.md`'s Architecture section (Data; Shops and matching) and in `context/domain/glossary.md`.

### Not doing

- **I-11, the confirmed item's provenance.** It needs a stored offer or a shop request per confirmation, which is the owner's decision.
- **A database guard for the legal moves.** A direct call changing the owner's own decision stays an accepted risk (`CLAUDE.md:60`).
- **One aggregate per product on the list.** It would multiply the list's reads; the list keeps its single query and the one definition of matched shops.
- **Renaming `watchlist_matches` or `ShopMatch` to "decision".** The glossary leaves renaming old code to a separate decision.
- **Any change to what the user sees.**

### Open points for `/10x-plan`

- **Old decisions in a product's own shop.** Either delete them in the migration (no read uses them), or add the check `not valid` and validate it once they're counted.
- **The route's extra read.** It now loads the product and its decisions before the write: two reads at once, and no shop request.
- **Mapping refusals to codes.** Whether `illegal-move` maps to `invalid` (a crafted post only) or gets a code of its own.
