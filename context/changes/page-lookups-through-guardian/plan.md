# A product's page looks shops up and shows decisions through the guardian Implementation Plan

## Overview

This is roadmap M-2's S-03. The product page and the readers of one product's decisions take the watched product from one loader and judge it with S-01's guardian:

- **A lookup asks the guardian before it stores.** A lookup's automatic match or „not found” is stored only once `admitLookup` admits it: only over undecided or „not found”, never over a settled decision (a match or a decline), and never in the product's own shop.
- **One loader, one precedence.** The product page, the decision route and the product's refresh without JavaScript read the product and its decisions through `loadWatchedProduct`, where the product's read decides first (S-01's review finding F5).
- **One loaded product for the page.** The page's matched shops, its per-shop steps and its price keys come from that loaded product, through one service, `openProductPage`, which the page and the seam table both call.
- **The PRD says what „Do sprawdzenia” holds**, its price half included (the domain map's D-01).

Nothing the user sees changes, no shop request is added and no migration runs. The store (`record`, `recordLookup`, `recordDecision`) stays as it is: S-02 merges after this slice and moves both writers to its one-statement save (the owner's call, 2026-10-10).

## Current State Analysis

From `context/changes/page-lookups-through-guardian/research.md`, re-anchored at b3faab1, which is S-01's head with its review fixes (c1edc39) plus the research:

- **The page composes its own steps.** It reads the product and its decisions at once with the list's three reads (`src/pages/watchlist/[id].astro:53-67`), derives its matched shops (`:78`), narrows the address's shops to them (`:82-83`), runs one step per matched shop (`:92-105`), redirects a retry that stored its outcome (`:106-109`), and builds the island's prices from the steps' items (`:115-116`; `src/lib/services/prices.ts:312-325`). No test imports the page, and the seam table keeps a hand copy of that composition (`src/lib/services/price-pages.test.ts:184-224`).
- **A lookup stores without the guardian.** `lookupOutcome` calls `recordLookup` directly (`src/lib/services/shop-matching.ts:385`). "Never over a settled decision" holds twice, in other forms: `decideMatchStep` looks a shop up only without a decision or to retry a „not found” (`src/lib/services/match-step.ts:64-77`), and `record` narrows a lookup's update to `state = 'not_found'` (`src/lib/services/matches.ts:327-332`).
- **A product's matched shops are derived in 8 production calls of `matchedShopsOf`:** `src/lib/services/price-comparison.ts:603`, `src/lib/services/price-targets.ts:165`, `src/lib/services/product-search.ts:246`, `src/lib/services/shop-matching.ts:313`, `src/lib/services/watched-product.ts:68`, `src/lib/services/watchlist-rows.ts:432` and `:492`, and `src/pages/watchlist/[id].astro:78`.
- **One reading rule in four readers, with three answers.** "An unreadable shop first, then its decision" is read in `standingFrom` (`watched-product.ts:75-82`), `decideMatchStep` (`match-step.ts:61-64`), `itemInRows` (`price-targets.ts:95-100`) and, as sets, `productTargets` (`price-targets.ts:165-168`). When the product's read and its decisions' read disagree:

| case                                     | the page (`[id].astro:68-72`, `match-step.ts:61-62`) | the decision route (`matches.ts:485-488`) | the island's refetch (`price-targets.ts:85-100`) | the product's refresh (`price-targets.ts:159-168`) |
| ---------------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| not on the list, its decisions unread    | 404                                                  | `error=gone`                              | 404                                              | **`?prices=failed`**                               |
| not on the list                          | 404                                                  | `error=gone`                              | 404                                              | `?prices=none`                                     |
| the product's read failed                | 503                                                  | `error=failed`                            | 503                                              | `?prices=failed`                                   |
| its decisions unread as a whole          | renders, every matched shop's card read-failed       | `error=failed`                            | its own item served, a matched shop 503          | `?prices=failed`                                   |
| one shop's decision unreadable (odd row) | that shop's card read-failed                         | that shop `error=failed`                  | that shop 503                                    | that shop unread, the others refreshed             |

- **S-01's `WatchedProduct` holds too little for the page:** `{ itemId, ownShop, standings }` (`watched-product.ts:23-27`), while the page needs the product's row for its title, its lookups and its links. And `loadWatchedProduct` answers `failed` for decisions unread as a whole (`matches.ts:480-489`), where the page renders.
- **D-01 is a gap in the PRD, not in the code.** „Do sprawdzenia” also holds a product any of whose prices isn't fresh (`src/lib/services/watchlist-rows.ts:213-216`, `:241-243`), by `etykiety-redesign`'s rule, and the glossary says so (`context/domain/glossary.md:45`). The PRD's one defining sentence lists only matching states (`context/foundation/prd.md:136`).
- **Three suites arrange the page's inputs by hand**, and one carries them inside its assertions. `match-step.test.ts` writes `decideMatchStep({ matches: … })` inside the expect lines themselves (`:58`, `:120`, `:160`, and in the multi-line expect statements at `:93-95`, `:185-187`, `:194-202`, `:226-228`, `:244-246`), so a plain rearrangement would rewrite assertion lines. `shop-matching.test.ts` builds `runMatchSteps`' input in one helper (`opened`, `:1161-1172`), and the seam table in its own copy of the page.

## Desired End State

Every per-product reader reads one product the same way. The four readers answer:

| case                                     | the page                                       | the decision route                        | the island's refetch                    | the product's refresh                  |
| ---------------------------------------- | ---------------------------------------------- | ----------------------------------------- | --------------------------------------- | -------------------------------------- |
| not on the list, its decisions unread    | 404                                            | `error=gone`                              | 404                                     | **`?prices=none`**, no shop asked      |
| not on the list                          | 404                                            | `error=gone`                              | 404                                     | `?prices=none`                         |
| the product's read failed                | 503                                            | `error=failed`                            | 503                                     | `?prices=failed`                       |
| its decisions unread as a whole          | renders, every matched shop's card read-failed | `error=failed`, before the guardian       | its own item served, a matched shop 503 | `?prices=failed`, no shop asked        |
| one shop's decision unreadable (odd row) | that shop's card read-failed                   | that shop `error=failed`, by the guardian | that shop 503                           | that shop unread, the others refreshed |

Only the bold cell moves, and it shows nothing different: the redirect lands on the product's not-found page, which shows no prices notice for either code (`[id].astro:223-226`, against the notice inside the shown product at `:234-238`).

When this plan is done:

- `admitLookup` is the one place that admits a lookup's outcome, and `lookupOutcome` stores only what it admitted.
- `loadWatchedProduct` returns the product's row beside the guardian's view. The page, the decision route and the product's refresh read through it, and the island's refetch takes its standing rule from `watchedProductOf`.
- `decideMatchStep` reads a shop's standing, `runMatchSteps` takes the loaded product, and the page calls `openProductPage`.
- 5 production calls of `matchedShopsOf` remain, none in the page, `runMatchSteps` or `productTargets`.
- The PRD's FR-007 carries a dated note with „Do sprawdzenia”'s full definition.
- Every existing expect line and test title stands, the 10 e2e specs pass unchanged in CI, and every view and action costs the shops what it does today.

### Key Discoveries:

- `stubClient` in `src/lib/services/shop-matching.test.ts:1071-1104` answers each query by its table and its first call, so a lookup's write can answer a 23505 then an update with no row (`decided`), a 23503 (`gone`) or another error (`failed`). No test drives these at the step level today (research §4).
- `stubSupabase` answers relations and RPCs (`src/lib/services/testing/stub-supabase.ts`), and `price-routes.test.ts:121-131` runs the real gate over it with replayed shop answers: the harness the page's service needs for a lookup that answers.
- `npx vitest list` prints a table test (`it.each`, `describe.each`) once, as its template (`… > $why`): 1320 lines at b3faab1 for the 2,897 tests a run executes. A run's JSON report (`npx vitest run --reporter=json`) names every test it ran by its file and its full name, a table test once per row, so a sorted comparison of those names shows any test that went or changed its name (the plan review's F1).
- `decisionNotice` and `decisionError` default to every priced shop when given none (`src/lib/services/match-view.ts:407-431`); the page passes an empty list when there's no product (`[id].astro:78`, `:132-133`).
- The refresh route turns no items into `?prices=none` and `failed` into `?prices=failed` (`src/pages/api/watchlist/refresh.ts:55-60`; `src/lib/services/price-refresh.ts:139-149`).
- A lookup's admission can refuse only where `record`'s compare-and-swap would answer `decided`: it refuses a match or a decline and admits undecided and „not found”, so it changes no stored outcome (research, inference 2).
- S-01 is on `main` (PR #47, 79ee4e4), and `main` has added only a README change since.

## What We're NOT Doing

- **The store and S-02's work:** `record`, `recordLookup` and `recordDecision` stay as they are, as do the one-statement save and S-01's F3 and F4. S-02 rebases onto this slice and moves both writers, the route's admitted decision and the lookup's admitted outcome, to its save.
- **The list:** the list beside the product keeps its own three reads, and `matchStatesOf` and `listMatchedShops` keep `matchedShopsOf` (the roadmap's Parked "One guardian per product on the list").
- **The own-shop comparisons** in `productPriceKeys` (`price-comparison.ts:599`), `itemInRows` (`price-targets.ts:92`) and `productPricesOf`'s link (`prices.ts:323`) stay.
- **`itemInRows` through the two-read loader:** it keeps one query for an own item (the owner's call on the test proof).
- **A wider `WatchedProduct`:** it stays as S-01 wrote it, and holds no row, matched-shop list or price keys (the owner's call).
- **A compatibility layer:** `decideMatchStep` and `runMatchSteps` take their new inputs directly, with no wrapper for the old ones (the owner's call).
- **Any change to what the user sees**, to the island's props, to a shop request, or to the database: no migration, grant or policy.
- **D-01 in the code:** the note records what the app already does. The 2026-10-04 note stays as history.
- **The selected row beside the product:** its line and the chips still come from the list's reads made before the lookups, an edge `context/foundation/test-plan.md` §7 accepts.
- **Renaming** `watchlist_matches` or `ShopMatch` to "decision" (Parked).
- **`context/domain/domain-distillation.md`**, which waits for its next `--replace` run.
- **Ticking F5 in S-01's follow-up queue** (`context/changes/decision-route-guardian/follow-ups/review-fixes.md`): Phase 2 resolves it, and the queue stays S-01's to close.

## Implementation Approach

The guardian learns the lookup first, alone and test-first. The loader comes next with the two readers that already live in services, so the precedence is settled before the page depends on it. Then the page moves onto one loaded product, and the documents follow.

**Prerequisites, before Phase 1:**

- The branch holds S-01's head with its review fixes: `git merge-base --is-ancestor c1edc39 HEAD` exits 0. A rebase onto `origin/main` is optional, since `main` adds only a README change.
- `npm run test` passes.
- The base's test names are recorded from a run, before any test file changes: `test_names > node_modules/.cache/s03-base-names.txt`, with `test_names` as the shared checks below define it (2,897 lines at b3faab1).

**The shared checks, which every phase runs:**

```bash
BASE=$(git merge-base HEAD origin/main)   # c1edc39 until a rebase

# assertion-diff: no removed line of a test or spec holds an expect, a matcher or a one-line title
git diff -U0 "$BASE" -- ':(glob)src/**/*.test.ts' tests/e2e \
  | grep -E '^-[^-]' \
  | grep -E 'expect\(|\.(not\.)?to[A-Z]|\b(it|test|describe)(\.each)?\(|\]\)\('

# test-names: every test a run executes, one line each: its file and its full name, so a table test shows once per row
test_names() {
  npx vitest run --reporter=json --outputFile=node_modules/.cache/s03-run.json > /dev/null
  node -e 'const path = require("node:path");
    for (const file of require(path.resolve(process.argv[1])).testResults) {
      const name = path.relative(process.cwd(), file.name).split(path.sep).join("/");
      for (const test of file.assertionResults) console.log(`${name} > ${JSON.stringify(test.fullName)}`);
    }' node_modules/.cache/s03-run.json | LC_ALL=C sort
}

# title-diff: every test the base ran still runs, under the same name
test_names | LC_ALL=C comm -23 node_modules/.cache/s03-base-names.txt -
```

Both print nothing. `title-diff` names each row of a table test, so a row dropped, merged or renamed shows. Neither sees a changed value inside a kept row or a multi-line expect statement, so the reviewer reads the test diff too (Phase 3).

**What each view and action costs the shops**, the same before and after this plan (lesson "Bound what each page view and action costs every shop"):

| view or action                                  | shop requests                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a product page on the user's own navigation     | per matched shop with no decision, one lookup: Natura and Hebe an EAN search when the product has an EAN, then a name search only when that finds nothing or doesn't run; Rossmann and Super-Pharm one name search. At most 5 for a product picked in Rossmann, 4 for one picked in Natura. Then the island's refetch. |
| the island's refetch on opening                 | one request per shop whose last check is over 15 minutes old; none while a re-pin's choice is open                                                                                                                                                                                                                     |
| `?retry=<shop>`                                 | that shop's lookup alone, at most 2                                                                                                                                                                                                                                                                                    |
| `?repin=<shop>`                                 | that shop's choice, at most 2 searches, and no refetch                                                                                                                                                                                                                                                                 |
| a view that isn't the user's own navigation     | none                                                                                                                                                                                                                                                                                                                   |
| a decision post                                 | none                                                                                                                                                                                                                                                                                                                   |
| the island's price request                      | one, to the shop it names                                                                                                                                                                                                                                                                                              |
| the product's „Odśwież ceny” without JavaScript | one per priced shop with an item, at most 4; none for a product not on the list, whatever its decisions' read                                                                                                                                                                                                          |
| the list's „Odśwież ceny”                       | its due items, per shop, untouched by this plan                                                                                                                                                                                                                                                                        |

## Critical Implementation Details

- **The list's reads stay before the lookups.** The page starts `loadWatchedProduct` and the list's three reads at once, and calls `openProductPage` only once both are done, as it runs its steps today (`[id].astro:67`, `:92-105`). Starting the service beside the list's reads would let a lookup's write race the list's read of the decisions.
- **The route answers decisions unread as a whole before the guardian.** Asked first, the guardian would refuse a post for the product's own shop as `not-a-matched-shop` (`error=invalid`), where today's loader answers `failed`.
- **No product, no shops.** Without a product shown, the page still gives `decisionNotice` and `decisionError` an empty list of shops, never nothing, which would default to every priced shop.
- **A retry returns before the prices.** `openProductPage` comes back with a retry that stored its outcome before it reads any price, as the page redirects before `productPricesOf` today (`[id].astro:106-116`).
- **One query for an own item.** `itemInRows` reads the product first and gives its own item without reading the decisions: three assertions pin one query (`src/lib/services/price-targets.test.ts:326`, `:391`, `:410`).
- **Keeping the expect lines in `match-step.test.ts`.** The file defines a local `decideMatchStep({ matches, shop, retryShop, repinShop, ownNavigation })`, which builds the shop's standing from the read with `watchedProductOf` and calls the production function, imported under another name. Every expect line and title then stays byte for byte, and only the import, that helper and the two input types that name the read (`:232`, `:331`) change.
- **No runtime import loop.** `watched-product.ts` keeps taking only types from `matches.ts`, the loader stays in `matches.ts`, and `match-step.ts` takes `Standing` as a type (research §8, debt 7).

## Phase 1: The guardian admits a lookup, test-first

### Overview

`admitLookup` decides whether a lookup's automatic match or „not found” may be stored for a watched product. Its tests are written first, each red before its rule exists. Nothing calls it yet, and no shop is asked.

### Changes Required:

#### 1. The lookup's admission

**File**: `src/lib/services/watched-product.ts`

**Intent**: The guardian judges a lookup's outcome beside a user's decision, so "a lookup never overwrites a settled decision" has one home, as the domain plan's `lookUp` sketches it (`context/domain/02-invariant-aggregate-refactor.md:163-170`, `:196-203`).

**Contract**:

- `admitLookup(watched, shop, outcome)` takes what `recordLookup` stores: an accepted candidate, or nothing found.
- Its checks run in this order, and the first that fails refuses:
  1. The shop must be one of the product's matched shops, so never its own (`not-a-matched-shop`).
  2. The product's decision there must have been read (`unreadable`).
  3. It must be undecided or „not found” (`settled` over a match, automatic or the user's, or a decline).
- An admitted change carries `recordLookup`'s arguments: the watched product's `itemId`, the shop and the outcome.
- The module keeps no Supabase import and no I/O, and its header comment names the lookup beside the posted decision.

```ts
export interface LookupChange {
  itemId: string;
  shop: PricedShop;
  outcome: Extract<ShopLookup, { kind: "accepted" | "not-found" }>;
}
export type LookupRefusal = "not-a-matched-shop" | "unreadable" | "settled";
export type LookupAdmission = { kind: "admitted"; change: LookupChange } | { kind: "refused"; reason: LookupRefusal };
export function admitLookup(
  watched: WatchedProduct,
  shop: MatchableShop,
  outcome: LookupChange["outcome"],
): LookupAdmission;
```

#### 2. Its tests

**File**: `src/lib/services/watched-product.test.ts`

**Intent**: Pin every admitted and refused lookup, each case red first.

**Contract**: a new `describe` block for `admitLookup` with the cases in "Testing Strategy, Phase 1", on the file's own product, items and decisions. An accepted candidate is Natura's item X as a lookup gives it. No existing line changes.

### Success Criteria:

#### Automated Verification:

- The guardian's tests pass: `npx vitest run src/lib/services/watched-product.test.ts`
- Dropping the `settled` refusal, then the matched-shop check, from `admitLookup` each turns its tests red, and restoring them turns them green again
- The unit suite passes: `npm run test`
- Lint passes: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- No existing assertion or test title moved: `assertion-diff` and `title-diff` (Implementation Approach) print nothing

**Implementation Note**: The phase has no manual check; the next phase starts once the automated gates pass.

---

## Phase 2: One loader for a watched product, gone first (F5)

### Overview

`loadWatchedProduct` returns the product's row beside the guardian's view, keeps decisions unread as a whole apart from one shop's unreadable decision, and lets the product's read decide first. The decision route keeps every redirect, the product's refresh reads through the loader, and the island's refetch takes its standing rule from the guardian. One redirect moves, unseen: a refresh posted for a product no longer on the list, whose decisions couldn't be read, comes back `?prices=none` instead of `?prices=failed`. No shop is asked anything more.

### Changes Required:

#### 1. The loaded product

**File**: `src/lib/services/watched-product.ts`

**Intent**: One value every per-product reader takes: the product's row beside S-01's view, which stays as it is, marking decisions unread as a whole, and naming the matched shops through the guardian's one derivation.

**Contract**:

- `watchedProductOf(product, read, shops?)` also takes a null read, decisions that couldn't be read at all, which gives every matched shop `unreadable`. Everything else, and `WatchedProduct`, stays as S-01 wrote it.
- `loadedProductOf(product, read, shops?)` builds a `LoadedProduct`: its decisions are `read` for a read, and `unread` for a null one.
- `matchedShopsIn(watched)` gives the priced shops the product has a standing in, in the priced shops' order: its matched shops, as `watchedProductOf` derived them.

```ts
export interface LoadedProduct {
  product: WatchlistProduct;
  watched: WatchedProduct;
  /** `unread`: the decisions couldn't be read at all, so every matched shop stands unreadable. */
  decisions: "read" | "unread";
}
export function loadedProductOf(
  product: WatchlistProduct,
  read: MatchesRead | null,
  shops?: readonly PricedShop[],
): LoadedProduct;
export function matchedShopsIn(watched: WatchedProduct): PricedShop[];
```

#### 2. The loader

**File**: `src/lib/services/matches.ts`

**Intent**: One loader with one precedence, the product's read first, for every reader of one product.

**Contract**: `loadWatchedProduct(supabase, itemId, shops = PRICED_SHOPS): Promise<LoadedProduct | null | "failed">`.

- It runs `getWatchlistProduct` and `listMatches` at once, as today.
- It returns null when the product isn't on the user's list, another user's included, whatever its decisions' read, and `failed` when the product's own read failed.
- Otherwise it returns `loadedProductOf(product, read, shops)`, with its decisions `read` or `unread`.
- `shops` reaches both the read and the guardian's view, for tests, as `productTargets` takes it. Its doc comment says all this.

#### 3. The decision route

**File**: `src/pages/api/watchlist/matches.ts`

**Intent**: Keep every redirect the page reads while the loader's answer gains its fourth outcome.

**Contract**:

| load               | redirect (`decisionBackTo`)                                             |
| ------------------ | ----------------------------------------------------------------------- |
| null               | `error=gone`                                                            |
| `failed`           | `error=failed`                                                          |
| decisions `unread` | `error=failed`, before `admitDecision`                                  |
| decisions `read`   | `admitDecision(loaded.watched, match)`, then everything as S-01 left it |

#### 4. The product's refresh and the island's refetch

**File**: `src/lib/services/price-targets.ts`

**Intent**: Both readers take S-01's rule from the guardian, and the product's refresh takes the loader's precedence.

**Contract**:

- `productTargets(supabase, itemId, shops?)` reads through `loadWatchedProduct(supabase, itemId, shops)`:
  - `failed` when the product's read failed;
  - no items for a product not on the list, whatever its decisions' read (F5);
  - `failed` for decisions unread as a whole;
  - otherwise its keys by `productPriceKeys`, from the row and the decisions of the shops with a `decided` standing, and as unread the matched shops whose standing is `unreadable`, in the priced shops' order.
  - Its `matchedShopsOf` call (`:165`) goes.
- `itemInRows` keeps its reads: the product alone for its own shop, then the decisions only for a matched shop.
  - The matched shop's standing comes from `watchedProductOf(product, read)`: `unreadable` is `failed`, a match gives its item's key, and anything else none.
  - Its own-shop comparison (`:92`) stays.

#### 5. Tests

**Files**: `src/lib/services/watched-product.test.ts`, `src/lib/services/matches.test.ts`, `src/lib/services/match-routes.test.ts`, `src/lib/services/price-targets.test.ts`, `src/lib/services/price-routes.test.ts`

**Intent**: Pin the loaded product, the loader's four outcomes, the route's order and F5, adding tests only.

**Contract**: the cases in "Testing Strategy, Phase 2". The loader's tests run over `stubSupabase` with the rows in `src/lib/services/testing/stored-rows.ts`. No existing line changes.

### Success Criteria:

#### Automated Verification:

- The guardian's, the loader's, the routes' and the price targets' tests pass: `npx vitest run src/lib/services/watched-product.test.ts src/lib/services/matches.test.ts src/lib/services/match-routes.test.ts src/lib/services/price-targets.test.ts src/lib/services/price-routes.test.ts`
- Making `productTargets` answer `failed` before a product not on the list, and making the route ask the guardian before it answers decisions unread as a whole, each turns its new tests red, and restoring each turns them green again
- `productTargets` derives no matched shops of its own: `grep -c "matchedShopsOf" src/lib/services/price-targets.ts` prints 0
- The unit suite passes: `npm run test`
- Lint passes: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- No existing assertion or test title moved: `assertion-diff` and `title-diff` print nothing

#### Manual Verification:

- Reading the product page's not-found view (`src/pages/watchlist/[id].astro:223-226`), the reviewer confirms it shows no prices notice, so `?prices=none` in place of `?prices=failed` shows nothing different

**Implementation Note**: The route and the refresh are covered again by CI's two-user check and smoke at the end of Phase 3, since this change opens one pull request.

---

## Phase 3: The product page runs on one loaded product

### Overview

`decideMatchStep` reads a shop's standing, `runMatchSteps` takes the loaded product, `lookupOutcome` asks `admitLookup` before `recordLookup`, and the page's composition moves into `openProductPage`, which the page and the seam table both call. `matchedShopsOf` drops from 8 production calls to 5. Every step's kind, search and write is today's, so no view costs a shop more.

### Changes Required:

#### 1. The step reads a standing

**File**: `src/lib/services/match-step.ts`

**Intent**: The step takes where the product stands in the shop from the guardian, instead of reading the raw decisions again.

**Contract**: `MatchStepInput` takes `standing: Standing` in place of `matches`. `decideMatchStep` maps it as today:

- `unreadable` is `read-failed`;
- a match or a decline is `repin` on the user's own navigation of `?repin=<shop>`, else `stored`;
- „not found” is `stored`, unless `?retry=<shop>` names the shop;
- undecided, or a „not found” being retried, is `prompt` or `lookup` by today's rules for own navigation and a page opened for another shop.

`Standing` comes in as a type from `watched-product.ts`, and the doc comment names the standing.

#### 2. The steps take the loaded product, and a lookup asks the guardian

**File**: `src/lib/services/shop-matching.ts`

**Intent**: The steps run where the loaded product has a standing, and a lookup stores only what the guardian admitted.

**Contract**:

- `MatchStepsInput` takes `loaded: LoadedProduct` in place of `product`, `matches` and `shops`.
- `runMatchSteps` runs `matchedShopsIn(loaded.watched)`, in that order, each step deciding from the shop's standing. Its `matchedShopsOf` default (`:313`) goes.
- `lookupOutcome`, for an accepted candidate or nothing found, asks `admitLookup(loaded.watched, shop, lookup)` first:
  - admitted: `recordLookup` with the change's arguments, then everything as today: the first price, `unsaved`, `retried`, and `decidedView` for the store's `decided`;
  - `settled`: nothing is stored, and the card shows `decidedView` („Ten produkt ma już zapisaną decyzję.”), as for the store's `decided`;
  - `unreadable` or `not-a-matched-shop`: nothing is stored, and the card shows the read-failed view.
- `runMatchSteps` meets none of the three refusals: it runs only the shops with a standing, and `decideMatchStep` looks one up only over undecided or „not found”. The guardian's unit tests pin them, and the store's compare-and-swap still catches a decision stored meanwhile.
- A lookup's and a re-pin's searches are exactly today's.

#### 3. The page's composition as a service

**File**: `src/lib/services/product-page.ts` (new)

**Intent**: Everything the page does with its loaded product, in one tested service that the page and the seam table call (lesson "Keep decision logic in tested services").

**Contract**:

- `openProductPage` takes the user's client, the gate, the loaded product, the page's address, whether the request is the user's own navigation, and the list's filter.
- Its matched shops are `matchedShopsIn(loaded.watched)`. It narrows `?repin=` and `?retry=` to them (`repinShopOf`, `retryShopOf`) and runs `runMatchSteps`.
- A retry that stored its outcome comes back `retried`, before any price is read.
- Otherwise it comes back with:
  - the matched shops, for the decision notices;
  - the steps;
  - the island's prices, from `productPricesOf(supabase, loaded.product, steps)`, so a match a step has just stored shows its first price at once;
  - whether the island may refetch on its own (`autoRefreshOf`).
- It's server-only, like the guardian, and stays out of `islandConfig`.

```ts
export interface ProductPageInput {
  supabase: SupabaseClient;
  gate: ShopGate;
  loaded: LoadedProduct;
  /** The page's address, for `?repin=` and `?retry=`. */
  params: URLSearchParams;
  ownNavigation: boolean;
  filter: ListFilter;
}
export type OpenedProductPage =
  | { kind: "retried" }
  | {
      kind: "shown";
      matchedShops: PricedShop[];
      steps: MatchStepResult[];
      shops: PriceComparisonShop[];
      pricesFailed: boolean;
      autoRefresh: boolean;
    };
export function openProductPage(input: ProductPageInput): Promise<OpenedProductPage>;
```

#### 4. The page

**File**: `src/pages/watchlist/[id].astro`

**Intent**: The page calls the loader and the service, and maps their results.

**Contract**:

- It reads `loadWatchedProduct` (null for an id that isn't a UUID, `failed` without a client) at once with the list's three reads, and keeps its statuses: 404 for null, 503 for `failed`, and the product rendered for decisions `read` or `unread`.
- For a loaded product it calls `openProductPage`. `retried` redirects to the plain address with the list's filter. Otherwise the result's matched shops feed `decisionNotice` and `decisionError`, its steps the island's `matched` views and the choices below it, and its prices and `autoRefresh` the island, all as today.
- Without a product, the notices get an empty list of shops.
- The page no longer imports `matchedShopsOf`, `runMatchSteps`, `productPricesOf`, `repinShopOf`, `retryShopOf`, `autoRefreshOf`, `listMatches` or `getWatchlistProduct`.
- The island's props, the list beside the product, the template and the script stay as they are.

#### 5. Tests

**Files**: `src/lib/services/match-step.test.ts`, `src/lib/services/shop-matching.test.ts`, `src/lib/services/price-pages.test.ts`, `src/lib/services/product-page.test.ts` (new), and `src/lib/services/price-routes.test.ts` only if its harness moves

**Intent**: Build the inputs as a loaded product, keep every assertion, and pin what no test pinned: a lookup's write that answers `decided`, `gone` or `failed`, and the page's composition.

**Contract**:

- `match-step.test.ts`: the local `decideMatchStep` over a read (Critical Implementation Details). It builds the standing with `watchedProductOf` for a product picked in Rossmann, or in Natura when the step's shop is Rossmann, and a shop without a standing fails the test, never reads as undecided.
- `shop-matching.test.ts`:
  - `opened` takes the test's `product`, `matches` and `shops`, with today's defaults, and builds `loaded` with `loadedProductOf`; the table's input type at `:1418` names those fields;
  - the new step tests use `stubClient`'s answers by table and first call.
- `price-pages.test.ts`: `productPage` reads through `loadWatchedProduct` and calls `openProductPage` with an empty address on a view that isn't the user's own navigation, then maps the steps as it does today. Its `expect` at `:219` and every case stay, and its unused imports go. The comments that name the product page's own call are rewritten: the file's header (`:15-18`) and `productPage`'s doc comment (`:184-188`) name `openProductPage` as the page's own call, in place of `productPricesOf`.
- `product-page.test.ts`: the cases in "Testing Strategy, Phase 3".
  - It runs the real gate over `stubSupabase` with replayed shop answers, as `price-routes.test.ts:121-131` does.
  - If it needs that file's `world`, `served` and `reservations`, they move into `src/lib/services/testing/` rather than being copied (lesson "Define shared constants and helpers once"), by the rule for `price-routes.test.ts` below.
  - Every URL is spelled out, as `shop-matching.test.ts` spells Natura's EAN search, which `natura-ean-hit.json` answers.
- `price-routes.test.ts`, only if that harness moves: `world`, `served`, `reservations` and `bodiesSentTo`, which reads the same stubbed fetch, come from `src/lib/services/testing/`.
  - `served()` and `bodiesSentTo()` keep their argument-free calls: the shared module keeps the stubbed fetch that `world` sets, so the 16 and 2 expect lines that call them stand byte for byte (the plan review's F2).
  - `reservations(queries)`, in 15 expect lines, takes its input and moves as it is.
  - Only the moved definitions and the imports change in this file.

### Success Criteria:

#### Automated Verification:

- The step, lookup, page and price tests pass: `npx vitest run src/lib/services/match-step.test.ts src/lib/services/shop-matching.test.ts src/lib/services/product-page.test.ts src/lib/services/price-pages.test.ts src/lib/services/prices.test.ts`
- Each deliberate break turns its tests red, and restoring it turns them green again: `runMatchSteps` running every priced shop instead of the loaded product's matched shops (the product picked in Natura, `shop-matching.test.ts:1467`); `lookupOutcome` treating the store's `decided` as `saved`; `openProductPage` reading prices before it returns a retry
- 5 production calls of `matchedShopsOf` remain, in `watched-product.ts`, `price-comparison.ts`, `watchlist-rows.ts` (twice) and `product-search.ts`: `grep -rn --include=*.ts --include=*.tsx --include=*.astro "matchedShopsOf(" src | grep -v "\.test\.ts:" | grep -v "function matchedShopsOf"` prints exactly those 5 lines
- The guardian and the page's service stay server-only: `grep -cE "watched-product|product-page" eslint.config.js` prints 0
- The e2e specs are untouched: `git diff --stat "$BASE" -- tests/e2e` prints nothing
- The unit suite passes: `npm run test`
- Lint passes: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- The build passes: `npm run build` (it downloads the fonts, so it needs network)
- No existing assertion or test title moved: `assertion-diff` and `title-diff` print nothing
- CI only: CI's `ci` job passes on the pull request
- CI only: CI's `smoke` job passes on the pull request: `npm run test:db` (a lookup's write against the real database, the late lookup included), the database checks, the two-user check (another user's product answers like a missing one through the page with `?repin=` and `?retry=`, the price route, the decision route and the product's refresh) and smoke
- CI only: CI's `e2e` job passes on the pull request: the 10 specs, unchanged, with no shop request reserved

#### Manual Verification:

- The reviewer reads the diff of `match-step.test.ts`, `shop-matching.test.ts` and `price-pages.test.ts` and confirms every changed line is arrangement: no title, expected value or line inside a multi-line expect statement changed
- The reviewer confirms that `lookupOutcome` stores only a change `admitLookup` admitted, and that `[id].astro`'s frontmatter only calls services and maps their results
- After the deploy, on a phone, the owner opens a product from „Do sprawdzenia” and a product matched in every shop: the cards, the prices with their ages, the cheapest shop and the list beside show as before. This costs what any view costs (Implementation Approach).

**Implementation Note**: After the automated verification passes, pause for the owner's phone check after the deploy, or run Phase 4 and leave the check open in Progress.

---

## Phase 4: Documents

### Overview

The PRD says what „Do sprawdzenia” holds, and the documents and comments name the per-product readers as the code now has them. No behaviour changes.

### Changes Required:

#### 1. The PRD's D-01 note

**File**: `context/foundation/prd.md`

**Intent**: Record „Do sprawdzenia”'s full definition, the price half with both edge cases, in the PRD's own way: a new dated note, leaving the 2026-10-04 note (`:136`) as history (the owner's call, 2026-10-10).

**Contract**: one new note after FR-007's 2026-10-09 update (`:138`), indented like the notes above it (`  > Update …`), dated the day it lands, with the wording the owner approved:

> Update <YYYY-MM-DD>: S-03 (`page-lookups-through-guardian`) records what „Do sprawdzenia” has held since `etykiety-redesign`, by the owner's rule there, and supersedes the 2026-10-04 update's definition: a product is there while any of its matched shops is undecided, not found, unreadable, or automatically matched with a size or brand that differs, or while any of its prices, its own item's or a match's, isn't fresh: stale, its item missing, never checked, or unread. A decline, a match the user confirmed and a fresh price that can't be ordered online keep no product there. Nothing changes in the app.

#### 2. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: The architecture notes name the loader, the lookup's admission and the page's service.

**Contract**:

- **UI (`:58`):** the page reads its product through `loadWatchedProduct`, at once with the list's three reads, and `openProductPage` (`src/lib/services/product-page.ts`) composes the rest from that loaded product: its matched shops (`matchedShopsIn`), the address's shops, the steps and the island's prices, which the seam table runs too. `decideMatchStep` reads a shop's standing.
- **Shops and matching (`:59`):**
  - The passage on the `?repin=` and `?retry=` shops and the decision notices, "through the product page … (`runMatchSteps`, whose default they are)", says instead that `openProductPage` gives them the loaded product's matched shops (`matchedShopsIn`), the one derivation `watchedProductOf` makes.
  - The route's sentence adds decisions unread as a whole, answered `failed` before the guardian.
  - The reading-rule sentence names the loader: the page, the decision route and a product's refresh read through `loadWatchedProduct`, which lets the product's read decide first, and the island's refetch takes the same standing rule.
- **Data (`:60`):** the compare-and-swap sentence says the guardian checks a write against the decision just read first: `admitDecision` a user's, and `admitLookup` a lookup's.

#### 3. The read rules' comment

**File**: `src/lib/services/matches.ts`

**Intent**: The comment above the reads (`:385-401`) names the per-product readers as they now read.

**Contract**: The page, the decision route and a product's refresh read a product's decisions through `loadWatchedProduct` and keep its matched shops' standings (`watchedProductOf`). The page's steps run in those shops alone, a posted decision and a lookup's outcome are judged there (`admitDecision`, `admitLookup`), and a refetch reads one shop's standing (`shopItemFor`). The list's rows and priced items keep theirs (`matchStatesOf`, `listPricedItems`).

#### 4. The glossary and the test plan

**Files**: `context/domain/glossary.md`, `context/foundation/test-plan.md`

**Intent**: The guardian's row covers lookups and the loader, and the cookbook names the page's own call.

**Contract**:

- **The glossary's guardian row (`:42`):** it means the one place that admits or refuses a change to a watched product's decisions, a user's or a lookup's, before anything is stored, and whose view every reader of one product takes. Its names in code are `admitDecision`, `admitLookup`, `watchedProductOf` and `matchedShopsIn` (`watched-product.ts`), and `loadWatchedProduct` (`matches.ts`).
- **The test plan's pattern 1 (§6.2, `:127`):** the seam table runs the product page's reads and wiring through `openProductPage`, the page's own call, in place of `productPricesOf`.

### Success Criteria:

#### Automated Verification:

- The changed Markdown passes Prettier: `npx prettier --check context/foundation/prd.md context/domain/glossary.md context/foundation/test-plan.md`
- The note lands once and the PRD loses no line: `grep -c "page-lookups-through-guardian" context/foundation/prd.md` prints 1, and `git diff "$BASE" -- context/foundation/prd.md | grep -E '^-[^-]'` prints nothing
- CLAUDE.md names the new pieces: `grep -oE "admitLookup|openProductPage|matchedShopsIn" CLAUDE.md | sort -u` prints all three
- The glossary's guardian row names the lookup's admission and the loader: `grep "^| guardian" context/domain/glossary.md | grep -oE "admitLookup|loadWatchedProduct" | sort -u` prints both
- The unit suite passes: `npm run test`
- Lint passes: `npm run lint`
- No existing assertion or test title moved: `assertion-diff` and `title-diff` print nothing

#### Manual Verification:

- The owner reads the FR-007 note against the code's cases (`src/lib/services/watchlist-rows.ts:213-216`, `:241-243`) and confirms both edge cases read right: an unread price counts, and a fresh price that can't be ordered online doesn't
- The reviewer confirms the read rules' comment and CLAUDE.md's three paragraphs name the per-product readers as the code has them

---

## Testing Strategy

### Unit Tests:

**Phase 1, `admitLookup` (`watched-product.test.ts`), each red first.** Admitted, as the change `recordLookup` stores:

- undecided: an accepted candidate, and nothing found;
- „not found”, a retry: an accepted candidate, and nothing found again;
- Rossmann, a matched shop of a product picked in Natura: an accepted candidate.

Refused:

- `not-a-matched-shop`:
  - the product's own shop, both outcomes, for a product picked in Rossmann and one picked in Natura;
  - the own shop over a decision stored there earlier;
  - the own shop whose row the read lists as unreadable, which is never `unreadable`;
  - a priced shop the product was built without, as one switched off.
- `unreadable`: a shop the read lists as unreadable, both outcomes, while another shop beside it is admitted.
- `settled`: an automatic match, the user's match and the user's decline, both outcomes.

**Phase 2, the loaded product and its readers.**

- `watchedProductOf` with a null read: every matched shop `unreadable`, the own shop none.
- `loadedProductOf`: `read` with `watchedProductOf`'s standings; `unread` for a null read; an odd row of one shop is `read`, with that shop `unreadable`.
- `matchedShopsIn`: Natura, Hebe and Super-Pharm for a product picked in Rossmann; Rossmann, Hebe and Super-Pharm for one picked in Natura; only the shops it was built with; the same shops when its decisions are unread.
- `loadWatchedProduct` (`matches.test.ts`, over `stubSupabase`):
  - null for a product the read can't see, even when its decisions can't be read;
  - `failed` when the product's read fails, even when its decisions read;
  - `read` with the standings, and `unread` when the decisions can't be read at all;
  - its `shops` reach the read and the standings.
- The decision route (`match-routes.test.ts`): a post for the product's own shop, with its decisions unread as a whole, answers `error=failed` and stores nothing.
- `productTargets` (`price-targets.test.ts`): no items for a product not on the list whose decisions can't be read.
- The refresh route (`price-routes.test.ts`): a product the user doesn't have, whose decisions can't be read, comes back `?prices=none`, reserving and sending nothing.

**Phase 3, the steps and the page.**

- `runMatchSteps` (`shop-matching.test.ts`), a lookup's write:
  - one that answers `decided`, a 23505 and then an update that changes no row, shows `decidedView`, stores no first price and isn't unsaved;
  - a retry's write that answers `decided` isn't `retried`;
  - a 23503 (`gone`) and another error (`failed`) leave the step unsaved, store no first price, and show the matched item's card as unsaved, or „not found”.
- `openProductPage` (`product-page.test.ts`), with expected values from the owner's calls and the research, never read off the service:
  - it runs the steps in the loaded product's matched shops and gives the page those shops: Rossmann, Hebe and Super-Pharm for a product picked in Natura, asking no shop on a view that isn't the user's own navigation;
  - an address naming the product's own shop (`?repin=natura` for a product picked in Natura) opens the plain page, while one naming a matched shop (`?repin=hebe`) re-pins it, a stopped Hebe being asked nothing;
  - a retry that stored its outcome (`?retry=natura`, with Natura's recorded EAN hit accepted) comes back `retried` without reading any price;
  - a match the view's lookup has just stored (Natura undecided, its recorded EAN hit accepted) shows among the island's prices at once;
  - a product whose decisions can't be read at all shows every matched shop read-failed, asks no shop, and still reads its own item's price.
- Rearranged, with every assertion kept: `match-step.test.ts`, `shop-matching.test.ts` and the seam table.

### Integration Tests:

These run in CI only, since they need Docker:

- `src/lib/services/matches.db.test.ts`, under `npm run test:db`: the lookup's narrowed write against the real database, the late lookup included (`:136-147`);
- `scripts/check-two-users.mjs:222-315`: another user's product answers like a missing one through the page, the price route, the decision route and the product's refresh;
- `scripts/smoke.mjs`;
- the 10 e2e specs, unchanged, among them:
  - `tests/e2e/phone-four-shops.spec.ts`: Super-Pharm looked up on view, refused by the stopped shop before any request;
  - `tests/e2e/product-from-another-shop.spec.ts`: the own shop never looked up;
  - `tests/e2e/price-honesty.spec.ts`: the island's refetch;
  - `tests/e2e/phone-three-shops.spec.ts` and `tests/e2e/phone-decline-match.spec.ts`: the re-pin and the decline;
  - `tests/e2e/phone-refresh-no-js.spec.ts`: the product's refresh.

### Manual Testing Steps:

1. On a phone after the deploy, open a product from „Do sprawdzenia” that has an undecided shop: its card shows the lookup's result as before.
2. Open a product matched in every shop: its cards, prices and ages, the cheapest shop and the list beside show as before.
3. Tap „Zmień” on a match, then „Anuluj”: the choice opens and closes as before.

## Performance Considerations

- **The page:** the same queries as today. The product and its decisions are read at once beside the list's three reads, then come the lookups' writes and one price read, and a retry that stored its outcome still skips the price read.
- **The decision route, the island's refetch and the product's refresh:** the same queries as today, two reads at once, one or two in sequence, and two at once.
- **The shops:** no request is added anywhere (the table under Implementation Approach).

## Migration Notes

None. No migration runs and no stored row changes. S-02 rebases onto this slice and moves `recordLookup`, called with an admitted `LookupChange`, and `recordDecision` to its one-statement save, which answers its own S-02 research's open question 5 (the owner's call, 2026-10-10).

## References

- Research: `context/changes/page-lookups-through-guardian/research.md`
- The roadmap: `context/foundation/roadmap.md`, S-03, and S-01 as its prerequisite
- The domain plan: `context/domain/02-invariant-aggregate-refactor.md`, "The legal moves", "The page" and phases 4 and 5
- S-01: `context/changes/decision-route-guardian/plan.md` and its follow-up F5 (`follow-ups/review-fixes.md`)
- S-02's research, which merges after this slice: `context/changes/decision-store-backstop/research.md` on the branch `refactor/decision-store-backstop`
- Lessons: "Bound what each page view and action costs every shop", "Never read an unreadable answer as missing", "Keep decision logic in tested services", "Define shared constants and helpers once" (`context/foundation/lessons.md`)
- The test plan's cookbook, §6.2 patterns 1 and 2: `context/foundation/test-plan.md`

## Implementation Notes

### Phase 1

- **Rossmann's cases take Rossmann's recorded item.** The contract names Natura's item X as the accepted candidate, and the Natura cases use X with the offer from `natura-ean-hit.json`. A lookup in Rossmann can only give a Rossmann item, so the Rossmann cases use its recorded Nivea Soft 300 ml (26900, as its adapter maps it from `rossmann-lookup-nivea-soft-300.json`): Rossmann as a matched shop of a product picked in Natura, and the own-shop rows of a product picked in Rossmann. The guardian never reads the candidate, so no expected value depends on it.
- **`watchedProductOf`'s comment names `admitLookup`** beside `admitDecision`; a comment only.
- **The module's header states the end state.** It calls the guardian the one place that decides what a lookup may store, which holds once Phase 3 sends `lookupOutcome` through `admitLookup`; until then nothing calls it.
- **Red first, as traced:** the tests alone failed 21 of 62 (no `admitLookup` yet); a skeleton that admitted everything failed 15; adding the matched-shop check left 8; adding the unreadable check left the 6 settled cases; the final rule passes 62.

### Phase 2

- **One existing import line changed in `matches.test.ts`.** Its import from `@/lib/services/testing/stored-rows` also takes `declinedRow`, `matchRow` and `productRow`, which the loader's tests need. It holds no expect, matcher or title, so the assertion check allows it; a second import of the same module would avoid it, which nothing in the repository does.
- **The loader's `shops` shows through the standings.** `listMatches`' answer for a listed shop doesn't depend on which other shops are listed, and its query doesn't filter by shop, so the test shows `shops` through the standings: an odd Super-Pharm row reads `unreadable` with the default shops and has no standing with `["rossmann", "natura", "hebe"]`.
- **The guardian's header names `loadWatchedProduct` and `LoadedProduct`.** The read-rules comment in `matches.ts` stays for Phase 4, as planned, and is still accurate.
- **2.8, by reading:** `[id].astro`'s not-found branch renders `ProductUnavailable` with the decision's error and the removal's notice only, and the prices alert stands only in the shown product's branch, so `?prices=none` in place of `?prices=failed` shows nothing different.

### Phase 3

- **The shared harness is `src/lib/services/testing/gate-world.ts`.** The plan named only the folder. `world`, `served`, `bodiesSentTo` and `reservations` moved unchanged, and the module keeps the stubbed fetch, so `served()` and `bodiesSentTo()` still take no argument (review F2); `blockReports` stays in `price-routes.test.ts`, its only user.
- **A shop without a standing reads as unreadable.** `runStep` reads `standings[shop] ?? UNREADABLE`, which TypeScript needs; the steps run only `matchedShopsIn`, so it is never reached, and it is never read as undecided.
- **`[id].astro` maps one load.** The `ProductReads` tuple became `ProductLoad = LoadedProduct | null | "failed"`, and the template's `product` is `loaded.product`, so the template, the island's props and the script are unchanged. Without a product, `autoRefresh` is `false`; the island doesn't render then.
- **`product-page.test.ts`'s `?repin=natura` case leaves Super-Pharm undecided.** With every shop decided, a service that skipped narrowing the address to the matched shops passed; now it fails, as a break of its own showed.
- **The stand-in database fills no view from an insert.** The "match just stored" case seeds the `price_summaries` row its first price would give, and the retry case's write succeeds as a plain insert; the 23505-then-update path stays with `matches.db.test.ts` in CI.
- **TD-02 (#51) merged meanwhile.** It added tests to `price-routes.test.ts` and touched none of the moved definitions.
- **Comments left for Phase 4:** `productPricesOf`'s doc in `prices.ts`, the read-rules comment in `matches.ts`, the "(matchedShopsOf)" mentions in the docs of `repinShopOf`, `retryShopOf`, `decisionNotice` and `decisionError`, and the test plan's §6.2 pattern 2.
- **3.14 and 3.15, by reading:** every line removed from the three test files is an import, a helper, a comment, an input type the plan names or the seam table's hand copy of the composition; `lookupOutcome` stores only the change `admitLookup` admitted, and `[id].astro`'s frontmatter awaits only the reads and `openProductPage`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The guardian admits a lookup, test-first

#### Automated

- [x] 1.1 The guardian's tests pass: `npx vitest run src/lib/services/watched-product.test.ts` — 9efaa44
- [x] 1.2 Dropping the `settled` refusal, then the matched-shop check, from `admitLookup` each turns its tests red, and restoring them turns them green again — 9efaa44
- [x] 1.3 The unit suite passes: `npm run test` — 9efaa44
- [x] 1.4 Lint passes: `npm run lint` — 9efaa44
- [x] 1.5 Types check: `npx astro sync && npx astro check` — 9efaa44
- [x] 1.6 No existing assertion or test title moved: `assertion-diff` and `title-diff` (Implementation Approach) print nothing — 9efaa44

### Phase 2: One loader for a watched product, gone first (F5)

#### Automated

- [x] 2.1 The guardian's, the loader's, the routes' and the price targets' tests pass: `npx vitest run src/lib/services/watched-product.test.ts src/lib/services/matches.test.ts src/lib/services/match-routes.test.ts src/lib/services/price-targets.test.ts src/lib/services/price-routes.test.ts` — 8703902
- [x] 2.2 Making `productTargets` answer `failed` before a product not on the list, and making the route ask the guardian before it answers decisions unread as a whole, each turns its new tests red, and restoring each turns them green again — 8703902
- [x] 2.3 `productTargets` derives no matched shops of its own: `grep -c "matchedShopsOf" src/lib/services/price-targets.ts` prints 0 — 8703902
- [x] 2.4 The unit suite passes: `npm run test` — 8703902
- [x] 2.5 Lint passes: `npm run lint` — 8703902
- [x] 2.6 Types check: `npx astro sync && npx astro check` — 8703902
- [x] 2.7 No existing assertion or test title moved: `assertion-diff` and `title-diff` print nothing — 8703902

#### Manual

- [x] 2.8 Reading the product page's not-found view (`src/pages/watchlist/[id].astro:223-226`), the reviewer confirms it shows no prices notice, so `?prices=none` in place of `?prices=failed` shows nothing different — 8703902

### Phase 3: The product page runs on one loaded product

#### Automated

- [x] 3.1 The step, lookup, page and price tests pass: `npx vitest run src/lib/services/match-step.test.ts src/lib/services/shop-matching.test.ts src/lib/services/product-page.test.ts src/lib/services/price-pages.test.ts src/lib/services/prices.test.ts`
- [x] 3.2 Each deliberate break turns its tests red, and restoring it turns them green again: `runMatchSteps` running every priced shop instead of the loaded product's matched shops (the product picked in Natura, `shop-matching.test.ts:1467`); `lookupOutcome` treating the store's `decided` as `saved`; `openProductPage` reading prices before it returns a retry
- [x] 3.3 5 production calls of `matchedShopsOf` remain, in `watched-product.ts`, `price-comparison.ts`, `watchlist-rows.ts` (twice) and `product-search.ts`: `grep -rn --include=*.ts --include=*.tsx --include=*.astro "matchedShopsOf(" src | grep -v "\.test\.ts:" | grep -v "function matchedShopsOf"` prints exactly those 5 lines
- [x] 3.4 The guardian and the page's service stay server-only: `grep -cE "watched-product|product-page" eslint.config.js` prints 0
- [x] 3.5 The e2e specs are untouched: `git diff --stat "$BASE" -- tests/e2e` prints nothing
- [x] 3.6 The unit suite passes: `npm run test`
- [x] 3.7 Lint passes: `npm run lint`
- [x] 3.8 Types check: `npx astro sync && npx astro check`
- [x] 3.9 The build passes: `npm run build` (it downloads the fonts, so it needs network)
- [x] 3.10 No existing assertion or test title moved: `assertion-diff` and `title-diff` print nothing
- [ ] 3.11 CI only: CI's `ci` job passes on the pull request
- [ ] 3.12 CI only: CI's `smoke` job passes on the pull request: `npm run test:db` (a lookup's write against the real database, the late lookup included), the database checks, the two-user check (another user's product answers like a missing one through the page with `?repin=` and `?retry=`, the price route, the decision route and the product's refresh) and smoke
- [ ] 3.13 CI only: CI's `e2e` job passes on the pull request: the 10 specs, unchanged, with no shop request reserved

#### Manual

- [x] 3.14 The reviewer reads the diff of `match-step.test.ts`, `shop-matching.test.ts` and `price-pages.test.ts` and confirms every changed line is arrangement: no title, expected value or line inside a multi-line expect statement changed
- [x] 3.15 The reviewer confirms that `lookupOutcome` stores only a change `admitLookup` admitted, and that `[id].astro`'s frontmatter only calls services and maps their results
- [ ] 3.16 After the deploy, on a phone, the owner opens a product from „Do sprawdzenia” and a product matched in every shop: the cards, the prices with their ages, the cheapest shop and the list beside show as before. This costs what any view costs (Implementation Approach).

### Phase 4: Documents

#### Automated

- [ ] 4.1 The changed Markdown passes Prettier: `npx prettier --check context/foundation/prd.md context/domain/glossary.md context/foundation/test-plan.md`
- [ ] 4.2 The note lands once and the PRD loses no line: `grep -c "page-lookups-through-guardian" context/foundation/prd.md` prints 1, and `git diff "$BASE" -- context/foundation/prd.md | grep -E '^-[^-]'` prints nothing
- [ ] 4.3 CLAUDE.md names the new pieces: `grep -oE "admitLookup|openProductPage|matchedShopsIn" CLAUDE.md | sort -u` prints all three
- [ ] 4.4 The glossary's guardian row names the lookup's admission and the loader: `grep "^| guardian" context/domain/glossary.md | grep -oE "admitLookup|loadWatchedProduct" | sort -u` prints both
- [ ] 4.5 The unit suite passes: `npm run test`
- [ ] 4.6 Lint passes: `npm run lint`
- [ ] 4.7 No existing assertion or test title moved: `assertion-diff` and `title-diff` print nothing

#### Manual

- [ ] 4.8 The owner reads the FR-007 note against the code's cases (`src/lib/services/watchlist-rows.ts:213-216`, `:241-243`) and confirms both edge cases read right: an unread price counts, and a fresh price that can't be ordered online doesn't
- [ ] 4.9 The reviewer confirms the read rules' comment and CLAUDE.md's three paragraphs name the per-product readers as the code has them
