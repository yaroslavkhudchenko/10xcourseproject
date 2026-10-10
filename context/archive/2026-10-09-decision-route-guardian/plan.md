# Decisions posted from a product's page pass one guardian Implementation Plan

## Overview

This is roadmap M-2's S-01, the milestone's north star. The decision route `POST /api/watchlist/matches` will load the watched product and its stored decisions, then ask one pure guardian, `admitDecision`, whether the posted decision may be stored.

- **Refused:** nothing is stored, and the user comes back with a code.
- **Admitted:** today's `recordDecision` stores it, with its compare-and-swap.

There is no database change, no change to what the user sees, and no shop request.

## Current State Analysis

From `context/changes/decision-route-guardian/research.md`:

- **The route writes without loading the product** (`src/pages/api/watchlist/matches.ts:11-45`).
  - It takes any of the four priced shops (`:22`), so the product's own shop passes.
  - A decision stored there is ignored by every reader. That was a deliberate call in add-from-other-shops (`context/archive/2026-10-06-add-from-other-shops/plan.md:100`).
- **The store checks the stored state, not the move** (`src/lib/services/matches.ts:296-342`).
  - A decline posted with `replaces=unmatched` over a decline answers `saved`, and so does a confirmation of the user's own confirmed item with `replaces=matched:<it>` (`:320-341`).
  - Only the UI keeps both out of reach, by not offering them (`src/lib/services/match-view.ts:338`, `:341`).
- **A decision's error shows only on the card of one of the product's matched shops** (`src/lib/services/match-view.ts:403-432`). An error naming the own shop, or no shop, shows nowhere while the product is shown.
- **No unit test imports the route.** A route-test harness exists in `src/lib/services/price-routes.test.ts:203-226`, over `stubSupabase` (`src/lib/services/testing/stub-supabase.ts`).
- **The codebase's idiom:** services report failure as result unions or null (`src/lib/services/matches.ts:224`; `src/lib/services/watchlist.ts:232-263`), and `src/` has no class outside its test stubs.
- **`matchedShopsOf` must stay in the browser-safe `src/lib/services/price-comparison.ts`**, because island modules call it (`src/lib/services/watchlist-rows.ts:432`, `:492`; `eslint.config.js:135-146`).

## Desired End State

Every decision posted to `/api/watchlist/matches` passes `admitDecision` before anything is stored:

| case                                                                       | what the route answers                                               | stored  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------- |
| a shop outside the product's matched shops, its own shop included          | `error=invalid`; shown on no card for the own shop, the owner's call | nothing |
| a decline over a decline, or the user's own confirmed item confirmed again | `error=invalid`                                                      | nothing |
| a form whose `replaces` doesn't name the stored decision                   | `decided=1`                                                          | nothing |
| a shop whose stored decision couldn't be read                              | `error=failed`                                                       | nothing |
| a product not on the user's list, another user's included                  | `error=gone`, identical for every such id                            | nothing |

Everything else is admitted and stored by `recordDecision` exactly as today, so every post the page's own forms send keeps its outcome. Each case is verified by:

- the guardian's unit tests;
- the route's first unit tests, which also assert that a refusal writes nothing;
- CI's existing database, two-user, smoke and e2e checks, unchanged and green.

### Key Discoveries:

- `recordDecision(supabase, itemId, shop, decision, replaces)` (`src/lib/services/matches.ts:275-287`) already maps a confirm or a decline, plus `replaces`, onto the compare-and-swap. The guardian's change can carry exactly those arguments, with no new store function before S-02.
- `getWatchlistProduct` (`src/lib/services/watchlist.ts:232-263`) and `listMatches` (`src/lib/services/matches.ts:446-468`) are the product page's own pair of reads (`src/pages/watchlist/[id].astro:52-60`).
  - Under RLS, another user's product reads as null.
  - `listMatches` reads every priced shop, and the caller narrows to the matched shops (`src/lib/services/matches.ts:391-398`).
- `scripts/check-two-users.mjs:255-278` requires another user's product to answer exactly like a missing one, which is today's `gone`.
- `stubSupabase` supports the product's read chain (`select`, `eq`, `abortSignal`, `maybeSingle`) and records every query. It answers an error per table only, so the compare-and-swap's `decided` race stays pinned where it is: `src/lib/services/matches.test.ts:645`, `:779` and `src/lib/services/matches.db.test.ts:149-205`.
- `price-routes.test.ts` already builds stored rows (`productRow` `:66`, `matchRow` `:85`, `naturaProductRow` `:132`). The lesson "Define shared constants and helpers once" (`context/foundation/lessons.md`) applies once a second test file needs them.

## What We're NOT Doing

- **S-02:** the database backstop against a decision in a product's own shop, and the one-statement save. `record` keeps its insert, then its update.
- **S-03:**
  - the product page's lookups (`recordLookup`, `runMatchSteps`);
  - the eight read-side narrowings to the matched shops;
  - the PRD's „Do sprawdzenia” sentence (D-01).
- **A page-level alert for a refused own-shop post.** The owner's call: such a post, which only a crafted request sends, shows nothing.
- **A class or a thrown error for the guardian.** The owner's call: a named result value, the codebase's idiom.
- **Moving the matched-shops rule.** `matchedShopsOf` stays in `price-comparison.ts`.
- **Checking a confirmed item against what the shop offered** (the domain plan's I-11).
- **Any other change:**
  - to `parseMatchForm`'s checks, `decisionBackTo`, the notices' texts or any view;
  - to old decision rows: rows stored earlier in an own shop stay, and every reader still ignores them.

## Implementation Approach

The guardian is a pure module beside the services, `src/lib/services/watched-product.ts`.

- **Build.** `watchedProductOf` builds a product's standing in each of its matched shops from the two reads.
- **Judge.** `admitDecision` judges a parsed `MatchForm` against that standing and returns either the change to store, carrying `recordDecision`'s arguments, or a named refusal.

The route keeps its early reads and its codes:

1. load the product and its decisions (`loadWatchedProduct`, in `matches.ts` beside `listMatches`);
2. admit;
3. store;
4. map.

The guardian checks the form against the decision just read, and `record`'s compare-and-swap still checks it again at write time.

## Critical Implementation Details

- **Privacy of `gone`.** Load before any write, and answer a product the read can't see with today's `gone` redirect, `decisionBackTo(itemId, shop, { error: "gone" }, filter)`. No path or log may tell another user's product from a missing id (`scripts/check-two-users.mjs:255-278`).
- **Two checks, both kept.** Pass the admitted change's `replaces` to `recordDecision`. It names the same decision the guardian checked, so a decision changed between the read and the write still answers `decided` from the compare-and-swap. Never substitute the loaded state for the form's `replaces`, which would let a stale form win.

## Phase 1: The guardian's rules, test-first

### Overview

A pure module decides which decisions a watched product admits, and its unit tests pin every allowed and refused move, each written red first. Nothing calls it yet.

### Changes Required:

#### 1. The guardian

**File**: `src/lib/services/watched-product.ts` (new)

**Intent**: The one place that decides whether a posted decision may be stored for a watched product. It knows the product's matched shops through `matchedShopsOf`, and its standing in each, and admits a confirm or a decline only along the legal moves, from the decision the form names.

**Contract**:

- **`watchedProductOf(product: WatchlistProduct, read: MatchesRead): WatchedProduct`** builds the product's id, its own shop, and a standing in each matched shop:
  - `undecided` when no decision is stored;
  - `decided`, with the stored `ShopMatch`;
  - `unreadable` when `read.unreadable` lists the shop.
  - A decision stored in the own shop, or in any shop outside the matched shops, has no standing.
- **`admitDecision(watched: WatchedProduct, form: MatchForm): DecisionAdmission`**, where:
  - `DecisionAdmission` is `{ kind: "admitted"; change: DecisionChange } | { kind: "refused"; reason: DecisionRefusal }`;
  - `DecisionRefusal` is `"not-a-matched-shop" | "unreadable" | "stale" | "illegal-move"`;
  - `DecisionChange` carries `recordDecision`'s arguments: `itemId`, `shop`, `decision` and `replaces`.
- **The checks, in this order:**
  1. The shop must be one of the matched shops, or the post is `not-a-matched-shop`.
  2. Its standing must have been read, or it is `unreadable`.
  3. The form's `replaces` must name the standing, or it is `stale`:
     - none for undecided or not found;
     - `matched:X` for a match of X;
     - `unmatched` for a decline.
  4. The move must be legal, or it is `illegal-move`:
     - a decline over a decline is illegal;
     - a confirmation of X over the user's own match of X is illegal;
     - a confirmation of X over an automatic match of X is legal, and makes the match the user's.
- It imports types from `@/types` and `@/lib/services/matches`, and `matchedShopsOf` from `@/lib/services/price-comparison`. It has no Supabase import and no I/O, and no island module imports a value from it.

#### 2. The guardian's tests

**File**: `src/lib/services/watched-product.test.ts` (new)

**Intent**: Pin every legal and refused move of a user's decision, each case written red first.

**Contract**: the cases listed under "Testing Strategy, Unit Tests", against `MatchForm`s built as `parseMatchForm` returns them.

### Success Criteria:

#### Automated Verification:

- The guardian's tests pass: `npx vitest run src/lib/services/watched-product.test.ts`
- Dropping the illegal-move check from `admitDecision` turns a test red, and restoring it turns it green again
- The unit suite passes: `npm run test`
- Lint passes: `npm run lint`
- Types check: `npx astro sync && npx astro check`

**Implementation Note**: The phase has no manual check; the next phase starts once the automated gates pass.

---

## Phase 2: The decision route asks the guardian

### Overview

The route loads the product and its decisions, asks `admitDecision`, and stores only an admitted change, mapping every refusal and result to today's codes. It gets its first unit tests.

### Changes Required:

#### 1. Loading a watched product

**File**: `src/lib/services/matches.ts`

**Intent**: One call that reads the product and its stored decisions at once, as the product page does, and builds the guardian's view of them.

**Contract**: `loadWatchedProduct(supabase, itemId): Promise<WatchedProduct | null | "failed">`.

- It runs `getWatchlistProduct` and `listMatches` side by side.
- It returns null when the product isn't on the user's list, another user's product included, as RLS reads it.
- It returns `"failed"` when the product's read fails, or when the decisions couldn't be read at all.

#### 2. The route

**File**: `src/pages/api/watchlist/matches.ts`

**Intent**: Store only what the guardian admits, and keep every code and redirect the page already reads.

**Contract**: The route keeps its early reads of `itemId`, `shop` (with its default priced shops) and `f` for the redirect, and its first three answers: not a form, `config` and `invalid`. Then:

| step  | result                                 | redirect (`decisionBackTo`) |
| ----- | -------------------------------------- | --------------------------- |
| load  | null                                   | `error=gone`                |
| load  | `"failed"`                             | `error=failed`              |
| admit | `not-a-matched-shop` or `illegal-move` | `error=invalid`             |
| admit | `stale`                                | `decided=1`                 |
| admit | `unreadable`                           | `error=failed`              |
| store | `saved`                                | `matched=1` or `declined=1` |
| store | `decided`, `gone`, `failed`            | as today                    |

An own-shop refusal therefore comes back as `?shop=<own shop>&error=invalid`, which no card shows: the owner's call.

#### 3. Shared stored-row builders

**File**: `src/lib/services/testing/stored-rows.ts` (new); `src/lib/services/price-routes.test.ts`

**Intent**: Define the stored rows once for both route test files.

**Contract**: `productRow`, `matchRow` and `naturaProductRow` move from `src/lib/services/price-routes.test.ts:66-138` into the new module, unchanged. `price-routes.test.ts` imports them, and its tests pass as before.

#### 4. The route's tests

**File**: `src/lib/services/match-routes.test.ts` (new)

**Intent**: The decision route's first unit tests: every answer in the table above, and no write for any refusal.

**Contract**:

- Context and form requests are built as in `price-routes.test.ts:203-226`, over `stubSupabase` with `watchlist_items` and `watchlist_matches` rows.
- Each test asserts the `Location` header. Each refusal also asserts that the recorded queries hold no insert or update on `watchlist_matches`.
- The privacy case: a product the read can't see answers `/watchlist/<id>?shop=natura&error=gone`.

### Success Criteria:

#### Automated Verification:

- The route's tests pass: `npx vitest run src/lib/services/match-routes.test.ts`
- The price routes' tests still pass on the shared row builders: `npx vitest run src/lib/services/price-routes.test.ts`
- Making the route store without asking the guardian turns the own-shop and illegal-move tests red, and restoring it turns them green again
- The unit suite passes: `npm run test`
- Lint passes: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- The build passes: `npm run build`
- CI's `smoke` job passes on the pull request: the decision write against the real database (`npm run test:db`), `check-matches-db`, the two-user check of `gone`, and smoke
- CI's `e2e` job passes on the pull request, including the two specs that post a re-pin's decline

#### Manual Verification:

- After the deploy, on a phone: a re-pin's „Żaden z nich” and a first choice's „To ten produkt” still save and show their notice on the shop's card

**Implementation Note**: After the automated verification passes, pause for the owner's phone check before Phase 3's documents land, or run Phase 3 and leave the check open in Progress.

---

## Phase 3: Documents

### Overview

The documents say what the code now does.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: The decision route's sentence and the decision write's rule describe the guardian.

**Contract**:

- **In "Shops and matching" (`CLAUDE.md:59`)**, the sentence "A decision is posted for one priced shop, … the form doesn't say which shop …" becomes the route's new order: load, `admitDecision` in `src/lib/services/watched-product.ts`, then `recordDecision`. It lists the refusals and their codes. A decision for the product's own shop is refused, while a row stored there before still counts in no read.
- **In "Data" (`CLAUDE.md:60`)**, the compare-and-swap sentence adds that a user's decision passes the guardian first.

#### 2. The glossary

**File**: `context/domain/glossary.md`

**Intent**: The decision's name in code includes its guardian.

**Contract**: The "decision" row's name in code gains `admitDecision`. A row "guardian" means the one place that admits or refuses a change to a watched product's decisions.

#### 3. The roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: S-01's outcome says which refusals the page shows.

**Contract**: S-01's outcome, in its body and its At a glance row, adds that a refusal for a matched shop shows on that shop's card. One for the product's own shop, which only a crafted post sends, shows nothing (the owner's call, 2026-10-09).

#### 4. The test plan

**File**: `context/foundation/test-plan.md`

**Intent**: The test plan names the new seam and the changed rule.

**Contract**:

- The route seams (`:128`) gain the decision route's tests (`src/lib/services/match-routes.test.ts`).
- Risk #1's own-shop line (`:367`) says the route refuses a decision for the product's own shop, while every reader still ignores one stored before.

### Success Criteria:

#### Automated Verification:

- The changed Markdown passes Prettier: `npx prettier --check CLAUDE.md context/domain/glossary.md context/foundation/roadmap.md context/foundation/test-plan.md`
- The unit suite still passes: `npm run test`

---

## Testing Strategy

### Unit Tests:

**The guardian (`watched-product.test.ts`), admitted:**

- undecided: a confirm without `replaces`, and a decline without `replaces`;
- not found: the same two;
- an automatic match of X: a confirm of X with `matched:X`, which becomes the user's;
- a match of X: a confirm of Y with `matched:X`;
- a match of X, automatic or the user's: a decline with `matched:X`;
- a decline: a confirm of Y with `unmatched`.

**The guardian, refused:**

- the product's own shop, for both actions: `not-a-matched-shop`;
- a shop the read listed unreadable: `unreadable`;
- `stale`:
  - no `replaces` over a match or a decline;
  - `matched:X` over a match of Z;
  - `matched:X` over a decline;
  - `unmatched` over a match;
  - any `replaces` over undecided or not found;
- `illegal-move`:
  - a decline with `unmatched` over a decline;
  - a confirm of X with `matched:X` over the user's own match of X.

**`watchedProductOf`:**

- a decision stored in the own shop has no standing;
- a shop listed unreadable reads unreadable;
- a shop with no row reads undecided.

**The route (`match-routes.test.ts`):** every row of Phase 2's table, with no write on each refusal. Plus:

- the three unchanged early answers;
- `failed` when the product or its decisions can't be read;
- `gone` for a product the read can't see.

### Integration Tests:

These are unchanged and run in CI:

- `src/lib/services/matches.db.test.ts`: the compare-and-swap against the real database, including the race the guardian can't see;
- `scripts/check-matches-db.mjs`;
- `scripts/check-two-users.mjs:255-278`: `gone`'s privacy;
- `scripts/smoke.mjs:242`: a cross-site decision post refused;
- the e2e specs `tests/e2e/phone-decline-match.spec.ts` and `tests/e2e/phone-three-shops.spec.ts`.

### Manual Testing Steps:

1. On a phone after the deploy, open a product with an automatic match, tap „Zmień”, then „Żaden z nich”: the card shows "Zapisano: brak w …" and „Dopasuj ponownie”.
2. On a product whose shop offers a choice, tap „To ten produkt”: the card shows "Zapisano dopasowanie." and the matched item.

## Performance Considerations

A decision post now reads the product and its decisions, two selects at once, each with the services' 2-second limit, before its write. It sends no shop request, and the page's own reads are unchanged.

## Migration Notes

None. No migration runs, and rows stored earlier in a product's own shop stay as they are, ignored by every reader. S-02 decides what happens to them.

## References

- Research: `context/changes/decision-route-guardian/research.md`
- The domain plan: `context/domain/02-invariant-aggregate-refactor.md`, its phase 1 and the route part of phase 4, with the research's two corrections
- The roadmap: `context/foundation/roadmap.md`, S-01
- The route-test harness: `src/lib/services/price-routes.test.ts:203-226`
- The store: `src/lib/services/matches.ts:275-342`

## Implementation Notes

### Phase 1

- **The refusal named `stale` in this plan is `outdated-form` in the code.** The glossary keeps "stale" for prices and names "a form from an old tab" as a misuse (`context/domain/glossary.md`, row "fresh / stale"). Wherever Phases 2 and 3 say `stale`, they mean `outdated-form`.
- **`watchedProductOf` takes an optional third argument,** `shops`, defaulting to `PRICED_SHOPS`, as the repository's other shop-list rules do. The contract's two-argument call is unchanged.
- **The shapes the plan left open:**
  - `WatchedProduct` is `{ itemId, ownShop, standings }`, with one standing per matched shop, like `ListMatchStates`;
  - `DecisionChange.shop` is a `PricedShop`;
  - an admitted change takes its `itemId` from the loaded product, which Phase 2 loads by the form's id.
- **The tests build each `MatchForm` in `parseMatchForm`'s shape.** Beyond the plan's list, the 41 tests pin:
  - the check order (a decline without `replaces` over a decline is an outdated form, not an illegal move);
  - a product picked in Natura, whose own shop comes from its `source`;
  - an unreadable shop next to a readable one.

### Phase 2

- **The refusal-to-code mapping stays in the route,** as a typed `Record<DecisionRefusal, DecisionOutcome>` of four entries. The compiler checks it covers every reason, and the route tests cover each entry.
- **`loadWatchedProduct` lets the product's read decide first, as the product page does.**
  - A product not on the list answers `gone`, even when its decisions couldn't be read.
  - Decisions that couldn't be read beside a readable product answer `failed`.
  - It takes no `shops` argument.
- **`contextOf` and the `APP` origin are shared too,** in `src/lib/services/testing/route-context.ts`, beside the row builders in `stored-rows.ts` (lesson "Define shared constants and helpers once"). Both route test files import them.
- **Two paths stay pinned below the route, since `stubSupabase` can't reach them:**
  - the store's `decided`, `gone` and `failed`, unchanged from before, in `matches.test.ts` and `matches.db.test.ts`;
  - the `replaces` that reaches `recordDecision`, which the guardian's tests pin as the form's own.
- **The 27 route tests go beyond the contract in five ways:**
  - the early answers run no query at all;
  - `gone` logs nothing;
  - the reads run before the write;
  - each admitted post's insert columns are pinned;
  - an own-shop re-pin over a decision stored there earlier is refused.

### Phase 3

- **Beyond the plan's list, the documents gained:**
  - the glossary's "outdated form" row, beside the "guardian" row;
  - in the roadmap, S-01's fourth refusal (a decision that couldn't be read) and its status, `in-progress`.

### Review fixes (2026-10-10)

The implementation review (`reviews/impl-review.md`) found 2 warnings and 5 observations, and the owner took every recommendation.

- **F1, a confirmation posted again (the owner's call, 2026-10-10):** a confirm of X over the user's own match of X is now an outdated form, answered `decided=1` („Ten produkt ma już zapisaną decyzję.”), not an illegal move.
  - A page posts it only from a re-pin's form shown while the match of X was automatic: from a second tab, or by a second tap without JavaScript, after the first post made the match the user's.
  - Before S-01 the compare-and-swap stored it again and answered `saved`. `decided` keeps the archived contract that a double submit ends as decided (`context/archive/2026-09-27-shop-matching-first-two-shops/reviews/impl-review.md:45`).
  - `illegal-move` keeps only a decline over the user's decline, which no page posts. `moveRefusal` in `watched-product.ts` replaces `isLegalMove` and names the refusal.
  - Both test files pin the second post.
- **F2:** the route tests share `formPost` and `FormFields` (`route-context.ts`) and `declinedRow`, `notFoundRow` and `NO_ITEM_COLUMNS` (`stored-rows.ts`), and `matches.test.ts` imports `NO_ITEM_COLUMNS`. Its `formOf` stays: it builds the `FormData` that `parseMatchForm` reads, not a request.
- **F3, F4 and F5, carried to S-02 and S-03:** queued in `follow-ups/review-fixes.md`.
- **F6:** the route test that checks both reads come before the write no longer says "at once".
- **F7:** the roadmap and the change's notes say "outdated form", `decisionFieldsFor`'s comment names the guardian, and this section records Phase 3's extras.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The guardian's rules, test-first

#### Automated

- [x] 1.1 The guardian's tests pass: `npx vitest run src/lib/services/watched-product.test.ts` — 50cf1df
- [x] 1.2 Dropping the illegal-move check from `admitDecision` turns a test red, and restoring it turns it green again — 50cf1df
- [x] 1.3 The unit suite passes: `npm run test` — 50cf1df
- [x] 1.4 Lint passes: `npm run lint` — 50cf1df
- [x] 1.5 Types check: `npx astro sync && npx astro check` — 50cf1df

### Phase 2: The decision route asks the guardian

#### Automated

- [x] 2.1 The route's tests pass: `npx vitest run src/lib/services/match-routes.test.ts` — b4df130
- [x] 2.2 The price routes' tests still pass on the shared row builders: `npx vitest run src/lib/services/price-routes.test.ts` — b4df130
- [x] 2.3 Making the route store without asking the guardian turns the own-shop and illegal-move tests red, and restoring it turns them green again — b4df130
- [x] 2.4 The unit suite passes: `npm run test` — b4df130
- [x] 2.5 Lint passes: `npm run lint` — b4df130
- [x] 2.6 Types check: `npx astro sync && npx astro check` — b4df130
- [x] 2.7 The build passes: `npm run build` — b4df130
- [x] 2.8 CI's `smoke` job passes on the pull request: the decision write against the real database (`npm run test:db`), `check-matches-db`, the two-user check of `gone`, and smoke — 74db1eb
- [x] 2.9 CI's `e2e` job passes on the pull request, including the two specs that post a re-pin's decline — 74db1eb

#### Manual

- [x] 2.10 After the deploy, on a phone: a re-pin's „Żaden z nich” and a first choice's „To ten produkt” still save and show their notice on the shop's card — the owner's check on a phone, 2026-10-10

### Phase 3: Documents

#### Automated

- [x] 3.1 The changed Markdown passes Prettier: `npx prettier --check CLAUDE.md context/domain/glossary.md context/foundation/roadmap.md context/foundation/test-plan.md` — f1f05b3
- [x] 3.2 The unit suite still passes: `npm run test` — f1f05b3
