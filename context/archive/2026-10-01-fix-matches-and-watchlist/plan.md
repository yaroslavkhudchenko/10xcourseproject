# Fix a wrong match and remove a product (S-08) Implementation Plan

## Overview

S-08 adds four things. A user can remove a product from their own watchlist without touching shared prices (FR-005). They can fix a wrong Natura match with "Zmień" and "Dopasuj ponownie" (FR-007). A suspicious match is flagged on the product page and counted on the list (FR-007). And the product page's own actions keep the list's filter (`?f=`; review finding F8 of `etykiety-redesign`). This is the certification's update and delete, and it closes the roadmap's S-08 carry-overs (`context/foundation/roadmap.md:205-219`).

## Current State Analysis

- **Removing a product.** There is no delete path: `watchlist_items` grants only `select, insert` (`supabase/migrations/20260927145051_watchlist_items.sql:28-42`).
  - A hard delete of a user's own row deletes no shared data. `price_observations` references neither a product nor a user (`supabase/migrations/20260928011450_price_observations.sql:35-36, 55-56`).
  - The composite key `(watchlist_item_id, user_id)` cascades only to the same user's decisions (`supabase/migrations/20260927184936_watchlist_matches.sql:47-48`). The cascade needs no grant on `watchlist_matches` (research §8.3, probe P1).
- **Re-pinning.** One policy condition refuses it: `state = 'not_found'` (`…watchlist_matches.sql:86-89`). `record()` narrows its fallback update the same way (`src/lib/services/matches.ts:196-213`).
  - The column grant already covers every column a re-pin writes (`…price_observations.sql:27-31`).
  - `decideMatchStep` only shows a stored match or decline (`src/lib/services/match-step.ts:32-45`).
  - Running today's lookup again accepts an automatic match's item a second time: a successful EAN search returns before the name search runs (`src/lib/services/shop-matching.ts:27-36`).
- **Suspicious matches.** Size is flagged on candidates and on a saved match (`src/lib/services/natura-view.ts:89-91, 122-139`).
  - Brand is stored on both sides and compared nowhere (`src/lib/services/matching.ts:26-32`).
  - The list's reads carry neither a match's brand and size nor the product's size (`matches.ts:303`; `src/lib/services/watchlist.ts:146`).
- **The saved match's item.** `listMatches` reads it (`matches.ts:217-219`), and both `matchedView` (`natura-view.ts:92-93`) and the card (`src/components/watchlist/natura-card.ts:88`) drop it.
- **`?f=` is dropped at five points:**
  - Natura's retry and prompt links (`natura-view.ts:105, 165-167`);
  - "Pokaż zapisaną decyzję" (`src/components/watchlist/NaturaCard.tsx:106`);
  - the decision forms and their route's `backTo` (`src/pages/api/watchlist/matches.ts:11-13`);
  - the retry redirect (`src/pages/watchlist/[id].astro:118-121`);
  - the product's refresh form and its route (`src/components/watchlist/RefreshForm.tsx:61`; `src/pages/api/watchlist/refresh.ts:44`).
- **Verification.**
  - **Three database assertions encode the old rules and flip** (`scripts/check-watchlist-db.mjs:93-94`; `scripts/check-matches-db.mjs:151-161, 162-172`). "A can't delete their match" (`check-matches-db.mjs:229-231`) stays true.
  - **No assertion covers a cascade,** another user deleting a row or changing a matched one, re-pointing a matched row, or prices surviving a removal.
  - **Unit tests encode today's behaviour:**
    - the candidate verdict is compared field by field (`src/lib/services/matching.test.ts:54-61`; `src/lib/services/shop-matching.test.ts:113-128`);
    - the card's "no item, no button" (`src/lib/services/natura-view.test.ts:134-137`; `src/components/watchlist/natura-card.test.ts:117-129`);
    - the `not_found`-only update chain (`src/lib/services/matches.test.ts:166-175`).

## Desired End State

- **Removing a product:**
  - On a product's page, "Usuń z listy" sits at the foot at every width and opens a confirm in place, without JavaScript.
  - Its red "Usuń z listy" deletes the user's own row and, through the cascade, their Natura decision for it. No price observation is deleted, and another watcher of the same item still sees its prices.
  - The list then says "Usunięto produkt z listy." once, keeping `?f=`. Adding the product again gives it a new page and a fresh Natura lookup.
- **Re-pinning:**
  - A matched Natura card names its item (brand and size above the name), with its note and warnings, and offers "Zmień". A declined card offers "Dopasuj ponownie".
  - Both open a choice from Natura's EAN search and name search together. It is never accepted on its own, and it marks the current item. "Żaden z nich" (from a match) declines, and "Anuluj" leaves the decision as it was.
  - A re-pin changes only the decision its form was shown with; anything else reads as already decided.
- **Suspicious matches:**
  - A candidate whose brand differs, by the lenient rule, carries "Inna marka: … zamiast …" and is never accepted automatically.
  - A saved match whose size or brand differs shows its warnings in the card. An automatic one also counts in "Do sprawdzenia", and its row's screen-reader line says why; one the user confirmed doesn't, since they saw its flags when they confirmed it.
- **`?f=`** survives every action on the product page: Natura's links, decisions and redirects, the product's no-JavaScript "Odśwież ceny", and the removal.
- **How it's verified:** the three database check scripts with their new and flipped assertions; unit tests at each rule's boundaries; the kitchen sinks in both themes; and each phase's manual checks.

### Key Discoveries:

- `record()` writes insert-first: an insert conflict falls back to an update that asks for its rows back, and zero rows reads as `decided` (`matches.ts:173-214`). Keeping insert-first means a removed product reads `gone` (23503), never `decided`.
- `filterHref` builds only `?f=` (`src/lib/services/watchlist-rows.ts:262-265`), and `listRefreshBackTo` already joins `f` with a notice code (`src/lib/services/price-refresh.ts:177-184`). One helper can serve every return address.
- **Brand data in the tests and kitchen sinks differs only in case:** `"nivea"` against Natura's `"NIVEA"` (`shop-matching.test.ts:27`), and `"Przykład"` against `"PRZYKŁAD"` (`src/dev/fixtures.ts:79, 134`). The only recorded "NIVEA MEN" is a different product with another EAN and size (`natura-name-search.json`, NV81063).
- `matching.ts` imports only types, so it can run in the browser. The island guard admits only `price-comparison` and `watchlist-rows` among the services (`eslint.config.js:126-139`).
- **After Phase 2, no new automatic match can carry a definite mismatch.** The only automatic writer is `recordLookup`, for an accepted candidate (`matches.ts:141-152`; `[id].astro:106-108`), and `qualifies` will need an equal size and no brand conflict (`matching.ts:51-53`). A user-confirmed mismatch was shown with its flags before "To ten produkt" (`natura-view.ts:127-131`). So only automatic rows stored before Phase 2 can hold a mismatch nobody has seen (plan review F1).
- No stub implements `.delete()` (`matches.test.ts:123-158`; `src/lib/services/watchlist.test.ts:179-186, 249-256, 330-336`).
- **The kitchen sinks:**
  - `NATURA_FIXTURES` (`src/dev/fixtures.ts:411-492`) has one entry per Natura state, drawn at `src/dev/product-page.astro:288-325`.
  - `CANDIDATES` (`fixtures.ts:359-393`) is "every flag one can have", built through the real `pickMatch`.
  - The list's sink takes a `NaturaListState` per row (`src/dev/watchlist-fixtures.ts:97-168`).

## What We're NOT Doing

- **Undo, soft delete or a trash.** The owner chose a hard delete with a confirm; WCAG 3.3.4 accepts a confirmed deletion.
- **Removing from the list itself.** A list row is one link (`src/components/watchlist/WatchlistRow.astro:42-44`), so it can't hold a button; removal is on the product page only.
- **Re-pinning Rossmann.** Its "match" is the product the user picked, with no decision row. A wrong Rossmann product is removed and added again.
- **A free-text Natura search in the choice,** a separate "remove match" control, or a reset of a decision to undecided. There is no delete grant on `watchlist_matches`.
- **Storing candidates or a confirmed candidate's posted price.** As today, a confirm stores no price; the island fetches the new item's price.
- **A brand rule beyond the lenient prefix rule.** No `manufacturer` or category fields, and no new live recordings.
- **A warning mark on a list row.** A suspicious match counts in the chip and the screen-reader line only.
- **Any change to the price policies, the price view, or S-04's queued F4 and F6 follow-ups.**
- **End-to-end tests.** They belong to Module 3 (`/10x-e2e-setup`).

## Implementation Approach

- **Database first, as one migration:**
  - The user's own delete on `watchlist_items`.
  - The user's own update of a decision in any state on `watchlist_matches`.
  - Every new permission and refusal proven in the three existing check scripts.
- **The widened policy no longer narrows a decision's update, so the code does,** with the state each write expects:
  - the automatic lookup, only over `not_found`, as today;
  - a re-pin, only over the decision its form names (`replaces`), as compare-and-swap;
  - a first decision from a choice, only over `not_found`, as today.
- **Then three vertical slices on the product page, each ending in something checkable on dev:**
  1. The brand rule and the saved match's item.
  2. Re-pinning, with `?f=` through Natura's actions.
  3. Removal, with `?f=` through the product's refresh.
- **Then the list's suspicious-match count, then the docs and the rollout.**
- **Every rule lives in a tested service:**
  - `matching.ts`, `shop-matching.ts`, `match-step.ts`, `natura-view.ts`, `matches.ts`, `watchlist.ts`, `price-refresh.ts` and `watchlist-rows.ts`;
  - the card's model in `natura-card.ts`.
  - Pages and routes only call these and map the results (lesson "Keep decision logic in tested services").

## Critical Implementation Details

- **State sequencing:** `record()` stays insert-first for a re-pin too. A product removed in another tab then reads `gone` (23503) rather than `decided`. And every fallback update keeps its narrowing (`.eq("state", …)`, plus `shop_item_id` for a match), because RLS no longer narrows it.
- **Timing:** the migration must be on production before the PR merges. Push it, then confirm with `npx supabase migration list --linked`; S-01 once shipped without its table (PGRST205). Pushing it early is safe: the deployed code doesn't use the delete grant, and it narrows its own decision writes as before.
- **Brand normalisation:** case is folded with Polish rules (`toLocaleLowerCase("pl-PL")`) after NFKD drops the diacritics, and only letters and digits stay. Otherwise the recorded `"nivea"`/`"NIVEA"` pair and the kitchen sink's `"Przykład"`/`"PRZYKŁAD"` would read as different brands and break today's automatic matches.

## Phase 1: Database contract

### Overview

One migration lets a user delete their own watchlist row and change their own decisions in any state. The three database check scripts prove each new permission and each refusal around it, the cascade, and that prices survive a removal.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_watchlist_removal_and_repin.sql`

**Intent**: Open exactly the two writes S-08 needs, and nothing more. A user removes their own product, and the foreign key's cascade takes only their own decisions for it. A user changes their own decision in any state; the app narrows each write by the state it expects. Applied migrations are frozen, so the tables' comments are replaced with `comment on`.

**Contract**:

- `watchlist_items`:
  - policy `watchlist_items_delete_own` (`for delete to authenticated using ((select auth.uid()) = user_id)`) and `grant delete on table public.watchlist_items to authenticated`;
  - no update grant.
- `watchlist_matches`:
  - drop `watchlist_matches_update_own_not_found`, and create `watchlist_matches_update_own` (`using` and `with check` both `(select auth.uid()) = user_id`);
  - the column update grant (`…price_observations.sql:27-31`) is unchanged;
  - no delete grant or policy.
- Comments:
  - `watchlist_items`: removal deletes the user's own row and, through the cascade, their decisions for it, never a price observation;
  - `watchlist_matches`: a user changes only their own decisions, in any state.
- No change to `price_observations`, its policies, its grants or the view. No new function.

#### 2. Watchlist check

**File**: `scripts/check-watchlist-db.mjs`

**Intent**: Prove that only the owner removes a row and that re-adding works afterwards.

**Contract**:

- "user B can't remove user A's row": `.delete().eq("id", aRowId).select("id")` as B gives no error and 0 rows, and A still reads the row.
- "anon can't remove a row": 42501.
- The flipped `:93-94` becomes "user A removes their own row": the same call as A returns that one row, and a re-read returns none.
- "user A adds the same product again after removing it": a new row with a new id.
- "A can't update their row" (`:91-92`) stays.
- The comment at `:90` is updated.

#### 3. Matches check

**File**: `scripts/check-matches-db.mjs`

**Intent**: Prove that a decision now changes only through its owner, still never moves to another product, user or shop, still fits the table's checks, and goes with its product.

**Contract**:

- The flipped `:151-161` becomes "user A re-pins their Natura match": 1 row back, and a re-read shows the new item.
- The flipped `:162-172` becomes "user A turns their Hebe decline into a match": 1 row back.
- New, before them:
  - "user B can't change user A's Natura match" and "… user A's Hebe decline": each 0 rows, and the row unchanged.
- New, on a matched row, each answering 42501 with the row unchanged (the column grant refuses them):
  - "user A can't point their match at user B's product" (`watchlist_item_id`);
  - "user A can't hand their match to user B" (`user_id`);
  - "user A can't move their match to another shop" (`shop_id`).
- New, each answering 23514:
  - "a re-pin to a decline can't keep the item";
  - "a lookup's 'not found' can't be the user's".
- "user A can't delete their match" (`:229-231`) stays 42501.
- New, last: "removing a product removes its owner's decisions with it". After A deletes their product, A reads none of its decisions, and B's decisions are unchanged.
- The comments at `:1-2, 134, 150, 174, 229` are updated.

#### 4. Prices check

**File**: `scripts/check-prices-db.mjs`

**Intent**: Prove the FR-005 guarantee in the database: a removal deletes no observation, and the remover stops watching the item while other watchers keep its prices. Also prove that a re-pin changes which item a user watches.

**Contract**:

- Append after `:300`, since the earlier assertions need A's product (`aItemId`) and A's skuA match.
- "user B re-pins their Natura match to skuA and reads its observation": B's skuB match becomes skuA, and B then reads skuA's observation.
- "removing a product deletes no observation": A deletes `aItemId`. B still reads the item's price and missing observations and skuA's observation, in the table and in the view.
- "a user who removed their product no longer reads or adds its prices": A reads 0 of the item's rows in the table and the view, and A's insert of a price for it answers 42501.

### Success Criteria:

#### Automated Verification:

- The migration applies to the local stack: `npx supabase migration up --local`
- `node scripts/check-watchlist-db.mjs` passes, with the removal assertions
- `node scripts/check-matches-db.mjs` passes, with the re-pin, refusal and cascade assertions
- `node scripts/check-prices-db.mjs` passes, with observations surviving a removal
- Break-checks go red: without the delete policy, with the old `not_found`-only update policy, and with a delete grant on `watchlist_matches`; the schema matches its snapshot afterwards
- `npm run lint` passes
- CI is green on the phase's commit (ci and smoke)

**Implementation Note**: The scripts sign up fresh users each run, so reruns need no reset; `check-shop-gate-db.mjs` is unaffected and is left to CI, since rerunning it locally needs a reset that deletes local users. After this phase's automated verification passes, pause for the human's confirmation before Phase 2. Phase blocks use plain bullets; their checkboxes live in `## Progress`.

---

## Phase 2: Brand rule and the saved match's item

### Overview

Brands are compared by the lenient prefix rule. A candidate whose brand differs carries a warning flag and is never accepted automatically. A saved match's card names its item and shows its size and brand warnings.

### Changes Required:

#### 1. The rule

**File**: `src/lib/services/matching.ts`, `src/types.ts`

**Intent**: Give FR-007 its brand part, and stop an automatic match that the brand contradicts (owner's decision, narrowing FR-006). A missing brand flags nothing. A saved match is suspicious only on a definite mismatch: both sizes known and different, or both brands known and not agreeing.

**Contract**:

- `brandsAgree(a: string | null, b: string | null): boolean | null`, after normalising each side:
  - NFKD, then combining marks dropped, then `toLocaleLowerCase("pl-PL")`, then only letters and digits kept;
  - true when one starts with the other, null when either is missing or empty.
- `MatchProduct` gains `brand`. `CandidateVerdict` (`src/types.ts`) gains `brand: "agrees" | "differs" | "unknown"`.
- `judge` sets it. `qualifies` needs `brand !== "differs"` besides a shared EAN and an equal size.
- `matchDifferences(own, item): { size: boolean; brand: boolean }` gives definite differences only, for the view (here) and the list (Phase 5).

#### 2. The views

**File**: `src/lib/services/natura-view.ts`

**Intent**: Show the brand flag on a candidate, and keep a saved match's item and warnings in the view instead of dropping them.

**Contract**:

- `NaturaProduct` gains `brand`.
- `optionView` adds `{ text: "Inna marka: <item brand> zamiast <own brand>", warning: true }` when `verdict.brand === "differs"`.
- `matchedView` returns:
  - `warnings: string[]` in place of `sizeWarning`: the size text (`otherSize`), then the brand text;
  - `item` always;
  - `unsaved` kept, so the card knows whether to draw the photo and link.

#### 3. The card

**File**: `src/components/watchlist/natura-card.ts`, `src/components/watchlist/NaturaCard.tsx`

**Intent**: A saved match's footer shows the item's brand and size line above its name, with no photo and no second "Zobacz w sklepie" (the price card has one), then the note and one warning badge per warning. An unsaved match keeps today's item block with its photo and link.

**Contract**:

- The matched card model carries `item`, `unsaved` and `warnings: string[]`.
- `MatchFooter` renders the saved item's eyebrow and name (as `rowProductOf` gives them) above the note.
- Badges keep `variant="warning"` and `whitespace-normal`.

#### 4. Kitchen sink

**File**: `src/dev/fixtures.ts`, `src/dev/product-page.astro`

**Intent**: Show the new looks in both themes.

**Contract**:

- `CANDIDATES` gains a candidate of another brand that shares the EAN and the size, which `leftToUser` must still leave to the user.
- `NATURA_FIXTURES`' matched entries show the saved item, and one gets a brand warning.
- The legend is updated.

#### 5. Tests

**File**: `src/lib/services/matching.test.ts`, `src/lib/services/shop-matching.test.ts`, `src/lib/services/natura-view.test.ts`, `src/components/watchlist/natura-card.test.ts`

**Intent**: Pin the rule's boundaries, and update today's strict expectations.

**Contract**:

- `brandsAgree` cases:
  - agree: NIVEA/nivea, NIVEA/NIVEA MEN, L'Oréal Paris/LOREAL, Przykład/PRZYKŁAD;
  - differ: NIVEA/YOPE;
  - null: either side missing or blank.
- `pickMatch` leaves an EAN-and-size candidate of another brand to the user.
- `matchDifferences` reports only known differences.
- The verdict literals gain `brand`, and `matching.test.ts:18`'s `{ eans, size }` product gains `brand`. In the name-search answer, JM00370 YOPE differs and NV81063 NIVEA MEN agrees.
- `natura-view.test.ts:134-137` and `natura-card.test.ts:72-97` change to "a saved match carries its item and warnings".

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with the brand rule's cases and an automatic match stopped by another brand
- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes
- Break-checks go red: `qualifies` without the brand condition, and a saved match's view without its item

#### Manual Verification:

- `/dev/product-page` shows the "Inna marka" flag and a saved match's brand, size, name and warnings, in both themes
- On dev, a saved Natura match names its item in the card, which holds its layout at 390 px and 1024 px

**Implementation Note**: Shop cost is unchanged. The rule only changes which outcome a lookup gives: a candidate it would have accepted is offered instead, for the same 1–2 Natura requests, and like any choice it isn't stored, so a reload repeats them. The prefix rule can raise a false alarm, when one shop writes a brand with a title or parent word in front ("Dr Irena Eris" against "IRENA ERIS"). That costs an exact EAN-and-size match its automatic acceptance: the user confirms it once, and its card keeps "Inna marka". The owner accepted this with the lenient rule (plan review F6). After automated verification passes, pause for the human's manual confirmation.

---

## Phase 3: Re-pinning a Natura match

### Overview

"Zmień" on a matched card and "Dopasuj ponownie" on a declined one open a choice of Natura candidates. It comes from both searches, is never accepted on its own, and marks the current item. A decision from it changes only the decision it was shown with. The list's filter survives Natura's links, forms and redirects.

### Changes Required:

#### 1. Return addresses

**File**: `src/lib/services/watchlist-rows.ts`, `src/lib/services/price-refresh.ts`

**Intent**: One browser-safe helper builds every product-page address with the list's filter. That follows lesson "Define shared constants and helpers once".

**Contract**:

- `filterHref(path, filter, params: Record<string, string> = {})` gives `f` first (unless it's `all`), then the params. Today's two-argument calls are unchanged.
- `listRefreshBackTo` builds on it.

#### 2. The step

**File**: `src/lib/services/match-step.ts`

**Intent**: Only the user's own navigation may spend the cap on a re-pin choice.

**Contract**:

- `MatchStepInput` gains `repinning` (from `?repin=1`).
- With a stored `matched` or `unmatched` decision on own navigation, the step is `{ kind: "repin"; match }`.
- A link from another site gets `stored`, whose card holds the "Zmień" link.
- `not_found` keeps `retry`. A read failure stays `read-failed`.

#### 3. The choice lookup

**File**: `src/lib/services/shop-matching.ts`, `src/types.ts`

**Intent**: Find the right item even when the EAN search returns the wrong one (the S-02 caveat), and never accept on its own.

**Contract**:

- `lookupChoicesInNatura(gate, product): Promise<NaturaChoices>`:
  - the EAN search (5 hits), then the name search (10 hits), one at a time;
  - an EAN search without an answer (busy, paused, stopped or failed) ends the choice as `ShopUnavailable` and sends no name search, as `lookupInNatura` stops today (`shop-matching.ts:29-31`);
  - every candidate is judged; each item appears once, the EAN search's first; at most 6.
- `NaturaChoices` is:
  - `{ kind: "choices"; options: CandidateOption[]; via: "ean" | "name" | "both"; incomplete: ShopUnavailable | null }`, where `incomplete` holds a name search without an answer after an EAN search that found candidates;
  - or `{ kind: "not-found" }`, only when every search that ran answered with nothing;
  - or `ShopUnavailable`, also when the name search gives no answer and the EAN search found nothing or didn't run.
  - A search without an answer is never `not-found` (lesson "Never read an unreadable answer as missing").
- Without a usable EAN or name query, the corresponding search is skipped. With neither, the answer is `not-found` with no request.
- `lookupEan(product)` and `nameQuery(product)` are extracted from `lookupInNatura` (`shop-matching.ts:26, 38`), and both lookups use them, sharing `EAN_HITS`, `NAME_HITS` and `EAN` (lesson "Define shared constants and helpers once").

#### 4. The decision write

**File**: `src/lib/services/matches.ts`

**Intent**: Compare-and-swap, so a stale tab can't overwrite a newer decision. Also build the route's return address in a tested service.

**Contract**:

- The decision form gains an optional `replaces`: `matched:<shopItemId>` or `unmatched`, checked by zod.
- `MatchForm.replaces` is an `ExpectedDecision | null`.
- `recordDecision(supabase, itemId, shop, decision, replaces = null)`. `record()` stays insert-first, and on 23505 narrows its update:
  - by `replaces` (state, plus `shop_item_id` for a match);
  - by `not_found` without one.
  - Zero rows is `decided`.
- `recordLookup` is unchanged.
- `decisionBackTo(itemId | null, outcome, filter)` moves here from the route.

#### 5. Views, card and section

**File**: `src/lib/services/natura-view.ts`, `src/components/watchlist/natura-card.ts`, `src/components/watchlist/NaturaCard.tsx`, `src/components/watchlist/NaturaSection.astro`

**Intent**: The handoff's controls (`context/archive/2026-09-30-etykiety-redesign/handoff/README.md:131, 133`), with every link keeping the filter.

**Contract**:

- Views take the filter:
  - `matchedView`, which the page calls directly for a match it has just saved (`[id].astro:128`);
  - `storedView`, `notFoundView`, `promptView`, and `decided`, which now carries `href`.
- `matchedView` and `storedView` also take `repinning`, which turns the card's action into "Anuluj".
- The card's action:
  - a saved match: "Zmień" → `?repin=1`;
  - a decline: "Dopasuj ponownie" → `?repin=1`;
  - while re-pinning: both say the choice is below, and their action is "Anuluj" (the plain page);
  - an unsaved match: no action.
- The action is an outline link styled as a button, drawn as the handoff draws it (34 px from lg, 36 px on a phone), with `hit-area`.
- `repinView(choices, current, fetchedAt, own, filter)` gives the section:
  - `{ kind: "repin", intro, options: (NaturaOption & { current: boolean })[], message, decline, replaces, cancelHref }`;
  - `decline` is true only from a match;
  - `message` holds the incomplete, nothing-found or unavailable text.
- `repinView` returns a type of its own, not a `NaturaView` kind, so the card gains no kind.
- `NaturaSection` renders `choose` (from `NaturaView`) or the repin choice, and takes the filter as a prop from its three callers (`[id].astro:301`; `src/dev/product-page.astro:264, 305`):
  - the current item gets the "Obecne dopasowanie" badge in place of "To ten produkt";
  - every form posts hidden `replaces` and `f`;
  - "Żaden z nich" appears only when `decline`, and the section ends with "Anuluj".
- `NaturaState` (`NaturaCard.tsx:76`) gets an explicit return type or a `never` default. A card kind it misses then fails to compile instead of rendering nothing.
- The "re-pinning waits for S-08" comments go.

#### 6. Page and route

**File**: `src/pages/watchlist/[id].astro`, `src/pages/api/watchlist/matches.ts`

**Intent**: Wire the step and keep the filter.

**Contract**:

- The page reads `repin`, and reads the filter once with `parseListFilter`.
- The repin step runs `lookupChoicesInNatura`, then renders the stored card and the repin section. It stores nothing itself. As the stored branch does, it sets `naturaItem` from the stored match, so the current match keeps its price card.
- `autoRefresh` is off while re-pinning.
- The retry redirect keeps the filter.
- The route reads `f` on its own (as it does `itemId`), passes `replaces`, and redirects through `decisionBackTo`.

#### 7. Kitchen sink and tests

**File**: `src/dev/fixtures.ts`, `src/dev/product-page.astro`, and the tests of the modules above

**Intent**: Show and pin every re-pin state.

**Contract**:

- Fixtures:
  - the re-pinning cards;
  - a choice with the current item marked;
  - a choice that's incomplete, empty, or has Natura unavailable;
  - a declined product's choice with "Anuluj" only.
- Tests:
  - `lookupChoicesInNatura` asserts the URLs served (both, in order; one when the EAN search gives no answer, failed included) and never accepts;
  - a name search without an answer gives `incomplete` after EAN candidates and `ShopUnavailable` after none, never `not-found`;
  - `decideMatchStep` for each stored state, with and without own navigation, with `repinning` added to `match-step.test.ts`'s five calls;
  - `record()`'s chains narrowed by `replaces`, and `decided` on 0 rows;
  - the `"repin"` action stays refused (`matches.test.ts:236`);
  - `filterHref` with params;
  - every view's href with `?f=check`.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with the re-pin step, the choice lookup's served URLs, the narrowed decision write and the filtered links
- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes
- Break-checks go red: the choice without the name search, a re-pin step for a link from another site, and a decision write not narrowed by `replaces`

#### Manual Verification:

- "Zmień" opens a choice from both searches with the current item marked, costing 2 Natura requests and storing nothing until a button is pressed
- Confirming another candidate re-pins the match, and the card names the new item with its price
- "Żaden z nich" declines the match, and "Dopasuj ponownie" reopens the choice with "Anuluj" only
- With Natura stopped locally, the choice says so and "Żaden z nich" still declines
- A re-pin sent from a stale tab says the decision was already stored and changes nothing
- `?f=` survives Natura's links, decisions and redirects, and the list beside the product keeps its chip
- A `?repin=1` request that isn't the user's own navigation sends no Natura request
- `/dev/product-page` shows every re-pin state in both themes

**Implementation Note**: Stop Natura locally through `public.shops.enabled` as the local superuser, and set it back afterwards; never on production. Count requests in the `shop_requests` ids. After automated verification passes, pause for the human's manual confirmation.

---

## Phase 4: Removing a product

### Overview

"Usuń z listy" at the foot of a product's page confirms in place and deletes the user's own row. The list says so once. The removal and the product's own no-JavaScript "Odśwież ceny" keep the list's filter.

### Changes Required:

#### 1. Service and notices

**File**: `src/lib/services/watchlist.ts`, `src/lib/notices.ts`

**Intent**: Tell a removal from a product that was no longer there or a failure (lesson "Never read an unreadable answer as missing"), and give every outcome its own code and text.

**Contract**:

- `removeFromWatchlist(supabase, id): Promise<"removed" | "gone" | "failed">`:
  - `.delete().eq("id", id).select("id")` with the 2 s timeout;
  - one row back is `removed`, none is `gone`, and an error or an odd answer is `failed`, logged.
- `removalBackTo(itemId, outcome, filter)`:
  - `removed` → `/watchlist?…removed=done`;
  - `gone` → `…removed=gone`;
  - `failed` → `/watchlist/<id>?…removal=failed`;
  - `config` → `/watchlist?…error=config`.
- `notices.ts` gains:
  - `REMOVED_PARAM` with its texts: "Usunięto produkt z listy." and "Tego produktu nie było już na Twojej liście.";
  - `REMOVAL_PARAM` with "Nie udało się usunąć produktu z listy. Spróbuj ponownie.";
  - `EXISTS_PARAM` and its text, moved from `src/pages/watchlist.astro:50`;
  - `LIST_NOTICE_PARAMS`: exists, error, list-prices, removed.
- `NOTICE_PARAMS` gains `REMOVAL_PARAM`.

#### 2. Route

**File**: `src/pages/api/watchlist/remove.ts`, `src/pages/api/watchlist.ts`

**Intent**: A form post like the other routes, under the null-client contract.

**Contract**:

- `POST` with `itemId` and `f`.
- A body that isn't a form, or an id that isn't a UUID, goes to `/watchlist` with no code. A null client gives `config`.
- Otherwise `removeFromWatchlist`, then `removalBackTo`.
- No shop request.
- The add route uses `EXISTS_PARAM`.

#### 3. The confirm

**File**: `src/components/watchlist/RemoveProduct.astro`, `src/pages/watchlist/[id].astro`

**Intent**: The owner's in-place confirm, which needs no JavaScript.

**Contract**:

- A `<details>` at the end of the product area, after the island and the choice section, at every width.
- Its summary "Usuń z listy" is an outline touch-size button, with the marker hidden as in `AccountMenu.astro:22-23`.
- Opened, it shows:
  - a line: "Produkt zniknie z Twojej listy razem z Twoim wyborem w Naturze. Zapisane ceny zostają, a ponowne dodanie zacznie dopasowanie od nowa.";
  - then a submit-once form posting `itemId` and `f`, with the `destructive` "Usuń z listy" described by that line.
- `?removal=failed` opens it, with a destructive Alert.
- It keeps the base focus ring, and sits above a phone's bottom bar (the page's `pb-28`).

#### 4. The list

**File**: `src/pages/watchlist.astro`

**Intent**: Show the removal's notice once.

**Contract**:

- The `removed` notices show as a status Alert in the list head, beside "exists".
- An address-bar script forgets `LIST_NOTICE_PARAMS` and keeps `f`, as the product page's does (`[id].astro:305-320`).

#### 5. The product's refresh keeps the filter

**File**: `src/components/watchlist/PriceComparison.tsx`, `PriceComparisonView.tsx`, `ProductTitle.tsx`, `RefreshBar.tsx`, `RefreshForm.tsx`, `src/pages/api/watchlist/refresh.ts`, `src/lib/services/price-refresh.ts`

**Intent**: The last of F8's dropped points.

**Contract**:

- The island gains a `listFilter` prop, which reaches both `RefreshForm`s as a hidden `f` (left out for `all`).
- The route's product branch redirects through `productRefreshBackTo(itemId, filter, code)`, built on `filterHref`.

#### 6. Kitchen sinks and tests

**File**: `src/dev/fixtures.ts`, `src/dev/product-page.astro`, `src/dev/watchlist.astro`, `src/lib/services/watchlist.test.ts`, `src/lib/services/price-refresh.test.ts`

**Intent**: Show and pin the new states.

**Contract**:

- The sinks show the confirm closed, open and failed, and the list's two removal notices.
- Tests cover:
  - `removeFromWatchlist`'s four outcomes, with a `from → delete → eq → select → abortSignal` stub;
  - `removalBackTo`'s and `productRefreshBackTo`'s addresses with `?f=check`.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with the removal's outcomes and every return address keeping the filter
- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes
- `node scripts/check-token-contrast.mjs` passes
- `npm run smoke` passes against the dev server
- Break-checks go red: a removal that reads no row as removed, and the list's address bar keeping `removed`
- CI is green on the phase's commit (ci and smoke)

#### Manual Verification:

- Without JavaScript, "Usuń z listy" opens its confirm in place and removes the product, and the list says so once
- Another user watching the same Rossmann item still sees its prices after the removal
- Adding the removed product again gives it a new page and a fresh Natura lookup
- Sending the removal a second time says the product was no longer on the list
- `?f=` survives the removal and the product's no-JavaScript "Odśwież ceny"
- The summary and the red button show the focus ring, and the opened confirm sits above a phone's bottom bar
- The kitchen sinks show the confirm closed, open and failed, and the list's notices, in both themes

**Implementation Note**: The removal sends no shop request, and the list it lands on asks none. Restart the dev server after `astro check` or `npm run build` before any manual check, since both replace Vite's dependency cache under it. After automated verification passes, pause for the human's manual confirmation.

---

## Phase 5: Suspicious matches on the list

### Overview

The list's two reads gain the sizes, and the match's brand and who decided it. A product whose automatic Natura match differs in size or brand counts in "Do sprawdzenia", and its row's screen-reader line says why. A match the user confirmed keeps its warning in the card only. The row looks as drawn.

### Changes Required:

#### 1. Reads and types

**File**: `src/types.ts`, `src/lib/services/watchlist.ts`, `src/lib/services/matches.ts`

**Intent**: Give the list what the rule compares, in the same single query per table.

**Contract**:

- `WatchlistItem` gains `size: Size | null` (moved up from `WatchlistProduct`), and `listWatchlist` selects `size_value, size_unit`.
- A matched `ShopMatchState` gains `brand`, `size` and `decidedBy`, and `listMatchStates` selects `brand, size_value, size_unit, decided_by`.
- A matched row whose new columns don't parse is odd, so its product reads unreadable, never "not suspicious".

#### 2. The row rule

**File**: `src/lib/services/watchlist-rows.ts`, `eslint.config.js`

**Intent**: FR-007's "so it does not go unnoticed", using the one rule from `matching.ts`. Only an automatic match can hold a mismatch nobody has seen. A match the user confirmed was shown with its flags first, so counting it would keep it in the chip for good.

**Contract**:

- For an automatic Natura match, the row knows which of size and brand differ (`matchDifferences`). A user-confirmed match counts as matched, whatever its differences.
- `listRowOf` counts such a product in Do sprawdzenia, and adds a sentence to its summary:
  - "Natura: sprawdź dopasowanie, inny rozmiar";
  - "…, inna marka";
  - "…, inny rozmiar i marka".
- The tag is unchanged.
- `islandConfig` admits `@/lib/services/matching` and lists `src/lib/services/matching.ts` in its `files`.

#### 3. Kitchen sink and tests

**File**: `src/dev/watchlist-fixtures.ts`, `src/dev/watchlist.astro`, `src/lib/services/watchlist-rows.test.ts`, `src/lib/services/matches.test.ts`, `src/lib/services/watchlist.test.ts`, `src/lib/services/price-targets.test.ts`, `src/lib/services/price-comparison.test.ts`

**Intent**: Show a suspicious row, and carry the new columns through the existing literals.

**Contract**:

- The sink:
  - a suspicious row in `ROW_FIXTURES`;
  - `LIST_STATES` with the new fields;
  - the chip counts updated.
- Tests:
  - "Do sprawdzenia" holds an automatic match whose size or brand differs, and leaves out a user-confirmed mismatch, an agreeing match and one with an unknown size or brand;
  - the summary sentence;
  - `listMatchStates`' select string (`matches.test.ts:576`);
  - the row literals at `matches.test.ts:560-567, 582-675`, `watchlist.test.ts:338-359`, `watchlist-rows.test.ts:83, 465-467, 507, 517`, `price-targets.test.ts:255-287` and `price-comparison.test.ts:633-637`;
  - the `product()` helper in `src/dev/watchlist-fixtures.ts:34-46`.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with automatic, user-confirmed and agreeing matches on the list
- `npm run lint` passes, with `matching.ts` admitted by the island guard
- `npx astro check` passes
- `npm run build` passes
- Break-checks go red: a server-only import in `matching.ts`, the check rule without the suspicious condition, and the rule counting a user-confirmed match

#### Manual Verification:

- On dev, a product whose automatic match has another brand is under "Do sprawdzenia" with its reason on the row's screen-reader line, and a user-confirmed mismatch isn't
- `/dev/watchlist` shows the suspicious row in both themes

**Implementation Note**: The list's reads stay one query per table and ask no shop. After Phase 2, an automatic match with another brand can only be one stored before it, so seed one on dev for a throwaway user, as the local superuser: a `matched`/`auto` row whose brand differs from its product's. Confirming NV81063 (500 ml) for a 300 ml product gives the user-confirmed case, which stays out of the chip. After automated verification passes, pause for the human's manual confirmation.

---

## Phase 6: Docs and rollout

### Overview

The rules files say what S-08 changed. The migration reaches production by the owner's push before the merge. The PR merges after CI, and the owner checks production on a phone.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md` (above the course block only)

**Intent**: Replace the rules S-08 falsifies.

**Contract**:

- `:18`: removal deletes the user's own row and, through the cascade, their decisions for it, never an observation.
- `:38-40`: what the three database checks now prove.
- `:47`: `/api/watchlist/remove` joins the null-client list.
- `:50`, the UI:
  - "Zmień" and "Dopasuj ponownie";
  - the re-pin choice;
  - `RemoveProduct.astro`;
  - the list's notices shown once;
  - `matching.ts` admitted by `islandConfig`.
- `:51`: the brand rule, and the choice lookup's two searches.
- `:52`: the delete policy and the cascade; decisions change in any state, with the code narrowing each write by the state it expects.
- The course block is untouched.

#### 2. PRD and roadmap

**File**: `context/foundation/prd.md`, `context/foundation/roadmap.md`

**Intent**: Dated notes for the owner's calls.

**Contract**:

- Notes dated on the day they're written:
  - FR-005: what a removal deletes, and what it never does;
  - FR-006: a brand mismatch stops an automatic match;
  - FR-007: what counts as suspicious, and that the list counts an automatic match, not one the user confirmed.
- The roadmap's S-08 risk line says what removal deletes.

#### 3. Rollout

**File**: none (production)

**Intent**: The migration on production before the merge, verified, never assumed.

**Contract**:

- The owner runs `npx supabase db push`, and the agent confirms the new version's remote column with `npx supabase migration list --linked`.
- The production PostgreSQL version is recorded in the plan's Implementation Notes (research open question 7). The owner reads it in the dashboard (Project Settings → Infrastructure), or runs `select version()` in its SQL editor.
- The PR from `feat/fix-matches-and-watchlist` is marked ready once CI is green. The owner merges, and Workers Builds deploys.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes, and Prettier reports the changed docs clean
- The CLAUDE.md course block is identical to `main`'s
- CI is green on the PR (ci and smoke)

#### Manual Verification:

- The owner pushes the migration, and `npx supabase migration list --linked` shows its remote version
- The production PostgreSQL version is recorded
- After the merge, the owner's phone check on production passes: remove a product, re-pin a match

**Implementation Note**: Never run `migration up --linked` or `supabase config push`. The owner merges, since every merge deploys.

---

## Testing Strategy

### Unit Tests:

- **Brand rule:** case, diacritics, spaces and punctuation ignored; a sub-brand agreeing; a missing brand; an automatic match stopped by another brand.
- **Choice lookup, through `createReplayFetch`:**
  - the URLs served, in order;
  - no name search after an EAN search without an answer, failed included;
  - a name search without an answer marking the choice incomplete after EAN candidates, and unavailable after none, never not found;
  - each item once, never accepted;
  - not found.
- **Re-pin step:** each stored state, with and without own navigation, `?retry=1` beside `?repin=1`, and a read failure.
- **Decision write:**
  - narrowed by `replaces`, or by `not_found` without it;
  - zero rows read as `decided`, and 23503 as `gone`;
  - `replaces` and `f` parsed.
- **Removal:** removed, gone, failed and an odd answer.
- **Addresses:** every return address and view href keeps `?f=` and drops a value no chip links to.
- **List rows:** "Do sprawdzenia" and the summary for an automatic mismatch, a user-confirmed one and an agreeing match.

### Integration Tests:

- **The three database checks against the local stack:** removal, its cascade, observations surviving it, re-pin permissions and refusals, and the remover no longer reading the item's prices. CI runs them in the `smoke` job.
- `npm run smoke` for the auth flow after the routes change.

### Manual Testing Steps:

1. **Re-pin a match:** "Zmień", pick another candidate, and see the new item and its price; then "Zmień", "Żaden z nich", "Dopasuj ponownie" and "Anuluj".
2. **Re-pin with Natura stopped locally:** decline from the choice.
3. **Remove a product without JavaScript:** confirm the list's notice shows once; another user still sees the item's prices; re-adding starts fresh.
4. **Repeat on `?f=check` beside the list at 1024 px:** the chip stays through every action.
5. **Phone width (390 px):** the card's actions, the choice and the confirm above the bottom bar.

Locally, judge `npm run lint` with `--ignore-pattern "Drogeria Radar redesign/**"` while the untracked copy of the handoff sits in the repository root.

## Performance Considerations

Shop requests per page view and action (lesson "Bound what each page view and action costs every shop"), with every Natura request through the gate, one at a time:

| Page view or action                                    | During the render                                                                                  | Afterwards                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `?repin=1`, own navigation                             | Natura: 2 (EAN, then name); 1 without a usable EAN or query; 1 when the EAN search gives no answer | 0: the island's refetch is off while re-pinning                                                         |
| `?repin=1`, not own navigation                         | 0 (the stored card with its "Zmień" link)                                                          | 0                                                                                                       |
| A re-pin or decline post                               | 0                                                                                                  | The redirect's own navigation: at most 1 Natura refetch of the new item, and Rossmann's as on any visit |
| A first lookup that the brand rule turns into a choice | 1–2, as before                                                                                     | 0; a reload repeats the lookup, as any choice does                                                      |
| Removal                                                | 0                                                                                                  | 0: the list asks no shop                                                                                |
| The list                                               | 0                                                                                                  | 0                                                                                                       |

- **Database reads:** `listWatchlist` gains two columns and `listMatchStates` four, and no query is added. The product page adds no read, so it keeps the five subrequests the redesign's review accepted. The choice's lookups run after those reads, never beside them. A removal is one delete.

## Migration Notes

- **One migration,** compatible with the deployed code: that code never uses the delete grant, and it narrows its own decision writes as before.
- **Pushing:** the owner pushes it any time after Phase 1 is committed, and before the merge. Once pushed it is frozen.
- **Rolling back:** a new migration restores the `not_found`-only update policy and revokes the delete. Rows removed meanwhile were their owners' own and stay removed. No observation is touched either way.

## References

- Research: `context/changes/fix-matches-and-watchlist/research.md`
- Roadmap item: `context/foundation/roadmap.md:205-219`; PRD: `context/foundation/prd.md:97-105`
- Carry-overs:
  - `context/archive/2026-09-30-etykiety-redesign/follow-ups/review-fixes.md` ("For S-08");
  - `context/archive/2026-09-29-product-page-ui/follow-ups/review-fixes.md` ("For S-08 (re-pinning)").
- Handoff: `context/archive/2026-09-30-etykiety-redesign/handoff/README.md:130-136`
- Similar implementations:
  - the insert-first write: `src/lib/services/matches.ts:168-214`;
  - the filtered return address: `src/lib/services/price-refresh.ts:162-184`;
  - the `<details>` without JavaScript: `src/components/shell/AccountMenu.astro:22-43`;
  - the replay-fetch URL assertions: `src/lib/services/shop-matching.test.ts:10-53`.
- Lessons: `context/foundation/lessons.md` (all six apply).

## Implementation Notes

### Phase 1

- **The migration** is `supabase/migrations/20261001182905_watchlist_removal_and_repin.sql`, applied locally only. Production needs the owner's `db push` before the merge (Phase 6).
- **Matches check, order:** the two 23514 checks run before the owner's re-pins. "A lookup's 'not found' can't be the user's" then hits the Hebe row while it's still a decline, and each update breaks exactly one of the table's checks (`decider_fits_state`, `item_only_when_matched`). The plan didn't fix their position.
- **Matches check, re-pin payload:** "user A re-pins their Natura match" writes what `recordDecision`'s confirm writes: state `matched`, `decided_by` `user`, NV81063's item columns from `natura-name-search.json`, and `checked_at`. The old assertion's made-up `NV00001` is gone. The decline-to-match keeps its Hebe payload (now `hebeItem`) and adds `checked_at`.
- **Matches check, moving to another shop:** "user A can't move their match to another shop" uses `shop_id: "rossmann"`. It's the one shop the product has no decision for, so only the column grant refuses it.
- **Matches check, cascade:** it also asserts that A had decisions before the delete and that the delete returned one row, so "none after" can't pass on its own.
- **Prices check, B's re-pin:** it's narrowed by B's product, Natura, state `matched` and `shop_item_id = skuB`. That's the compare-and-swap shape Phase 3 plans; B's match id was never captured.
- **Prices check, A's reads after the removal:** they cover skuA as well as X, which proves the cascade also ended A's watching of its matched SKU. The insert is for X, as planned.
- **Prices check, header:** the header comment gains one sentence on what S-08 proves.
- **What a direct database call now allows (lesson "Check what a direct database call allows, not only the UI"):** under `watchlist_matches_update_own`, a user can set their own decision to `not_found`/`auto`, or set `decided_by` to `auto` on their own match, through PostgREST. Both fit the table's checks and touch only that user's rows.
  - The plan's "no reset to undecided" is therefore a UI choice, which the database doesn't refuse.
  - Phase 5's count of automatic matches can be changed by a user, but only on their own list.
  - No other user's data is reachable, so this is accepted as the price of the app narrowing its own writes. No check asserts it.

### Phase 2

- **Kitchen sink, `CANDIDATES`:** the other-brand candidate (NV10003, brand "WZÓR", same EAN and size, from a new `OTHER_BRAND_ITEM`) replaces the third candidate rather than being added as a fourth. `pickMatch` offers at most 3, so a fourth would never be drawn. It keeps that candidate's missing price, so the "Brak ceny online" row stays. The sink therefore no longer shows a candidate without flags.
- **Kitchen sink, `NATURA_FIXTURES`:** the brand warning gets its own entry, "matched + brand": an automatic match stored before the brand rule, showing "Inna marka: WZÓR zamiast Przykład". The labels of "matched" and "matched + notice" say what their footer now shows.
- **The card's `unsaved`:** it now comes from the view (`matchedView`'s option). `NaturaCardInput.unsaved` only drives the "couldn't save" alert. Both come from the same value in `[id].astro` and the fixtures.
- **The brand text:** `otherBrand` is exported beside `otherSize`. A private `brandLabel` falls back to "marka nieznana" for a missing brand, because `restrict-template-expressions` refuses `string | null`. The views never reach that fallback, since the rule never flags a missing brand.
- **`NaturaCard.tsx`:** one `ItemText` piece (eyebrow and name, through `rowProductOf`) serves both the unsaved `MatchedItem` and the saved footer.
- **The legend:** its pointers to the new looks are in the 7-state matrix's `default` entry.
- **Tests beyond the plan's list:**
  - `brandsAgree`: "NIVEA MEN"/"MEN" differs; the accepted false alarm "Dr Irena Eris"/"IRENA ERIS" is pinned as differing; a punctuation-only brand gives null.
  - `pickMatch`: accepts with a sub-brand, with no candidate brand, and for a product without a brand. When an other-brand candidate also shares the EAN and the size, it accepts the same-brand one.
  - `shop-matching`: a replay-backed automatic match stopped by another brand, asserting the single EAN request.
- **`NaturaSection.astro`:** its header comment says "a size or brand warning". The file wasn't in Phase 2's list.
- **Left for Phase 3:** `LookupProduct` (`shop-matching.ts`) still redeclares `brand`, which it now inherits from `MatchProduct`. It's harmless, and Phase 3 edits that file.
- **Manual 2.6, verified by the agent at the owner's request (2026-10-01):** headless Chrome at 1280 px on `/dev/product-page`.
  - Of 46 match footers, the 42 saved ones name their item (brand and size above the name) and the 4 unsaved ones keep the item block above; no footer holds an image or a link.
  - "Inny rozmiar: 200 ml zamiast 300 ml" and "Inna marka: WZÓR zamiast Przykład" show in both themes.
  - The other-brand candidate carries "Ten sam EAN" and "Inna marka" beside "To ten produkt".
  - There's no horizontal overflow.
- **Manual 2.7, verified by the agent at the owner's request (2026-10-01):**
  - A throwaway local user, `s08-p2-…@example.com`, has two seeded products: made-up Rossmann ids 990008001/2 and Natura SKUs S08P2A01/B01. One is an agreeing automatic match; one is a user-confirmed YOPE 75 ml match for a NIVEA 100 ml product.
  - Prices were re-seeded fresh, and the shops were disabled locally for the visit.
  - At 390 and 1024 px, Natura's footer names its item, and the YOPE match shows both warnings, with no overflow and no refetch.
  - `shop_requests` max id was 107 before and after, so no shop was asked.

### Phase 3

- **The lookup:**
  - `LookupProduct` drops its redundant `brand`, which it inherits from `MatchProduct`.
  - `lookupEan` and `nameQuery` are private to `shop-matching.ts`, and the cap of six is `CHOICES = 6`.
  - The choice logs nothing found through the same `logNothingFound`.
  - `via` is "both" whenever each search found a candidate, even when the name search found only the EAN search's items again.
- **The step:** a new `RepinnableMatch` type (`src/types.ts`, a match or a decline) is what the step's `repin` carries, narrowed by a private `isRepinnable` guard.
- **`replaces`:**
  - `ExpectedDecision` lives in `matches.ts`, with its form encoder `replacesFieldOf(current)` next to the zod decoder; `natura-view.ts` imports the encoder.
  - The confirm's SKU rule is now a shared `shopItemIdSchema`, which `replaces` reuses.
- **`decisionBackTo`:**
  - `decisionBackTo(null, …, filter)` goes to the list with its filter (`/watchlist?f=check`) and no code.
  - `DecisionOutcome` is `DecisionCode | { error: MatchError }`.
  - `recordLookup` passes `null` to `record()` explicitly.
- **`parseListFilter`:** it accepts `FormDataEntryValue | null`, so a file reads as "all". The decision route reads `f` with it, and `listRefreshBackOf` now uses it too.
- **View signatures:**
  - `matchedView(item, decidedBy, own, { filter, repinning?, unsaved? })` and `storedView(match, own, { filter, repinning? })`, which share `StoredViewOptions`;
  - `notFoundView(checkedAt, own, filter)` and `promptView(own, retrying, filter)`;
  - a new `decidedView(own, filter)`, so the page no longer writes `{ kind: "decided" }` inline;
  - `chooseView` is unchanged: the section's forms post `f` instead.
- **View and card shapes:**
  - Matched and declined views carry `action: NaturaAction | null` (`{ kind: "repin" | "cancel"; href }`). The card model turns it into `action: { link, hint }`, with the labels and hints kept in `natura-card.ts`.
  - The decided card has a `link`, like prompt and not-found.
  - The section's own type, `NaturaRepin`, has `intro: string | null` (null without candidates) and `message: { text, warning } | null`. `RepinOption`, `NaturaMessage` and `NaturaAction` are exported too.
- **`itemId` removed:** `NaturaCard` and `ShopGrid` lose their `itemId` prop, since the decided link's href comes from the view. That reaches `PriceComparisonView.tsx`, which wasn't in the plan's list, and the kitchen sink's `ShopGrid` call.
- **The card's layout:**
  - "Zmień" (or "Anuluj") ends the match footer's note row.
  - A decline gets a dashed footer with "Dopasuj ponownie" at its end.
  - While re-pinning, the hint follows the warnings on a match, and sits beside "Anuluj" on a decline.
  - The action is `buttonVariants({ variant: "outline", size: "compact" })` with `ml-auto h-9 shrink-0 border-foreground bg-transparent lg:h-8.5`: 36 px on a phone, 34 px from lg. `compact` already carries `hit-area`.
- **The section:**
  - "Obecne dopasowanie" is a `secondary` Badge, and the closing "Anuluj" is a full-width ghost touch link.
  - An empty candidate list isn't drawn, and the message comes after the intro.
  - Hidden `f` is always posted ("all" included), and hidden `replaces` only from a re-pin.
- **Copy:** an incomplete choice says "Wyszukiwanie po nazwie się nie udało, więc lista może być niepełna." followed by Natura's unavailable text. While re-pinning, the card's hint is the same even when the choice found nothing or Natura gave no answer; the section's message explains those.
- **The address bar:** it keeps `repin=1`, so a reload repeats the two searches, as the plan accepts. Chip links, the list's refresh and the decision redirects drop it. `?repin=1` on a stored `not_found` shows the stored card.
- **The kitchen sink:**
  - `NaturaFixture` gains `repin?`, with five new entries: matched + repin, repin + incomplete, repin + not found, repin + unavailable, unmatched + repin.
  - Each choice is built by hand with the real `judge`.
  - `DECLINED` is retyped `RepinnableMatch`, with a new `AUTO_MATCHED`.
  - Every `NaturaSection` gets `filter="all"`.
- **Test plumbing:**
  - `shop-matching.test.ts` gets `setup(entries, reserve?)`, used for the busy case.
  - `matches.test.ts` builds `updateNotFound` on a new `updateOver(fields, expected)`, and the existing `parseMatchForm` expectations gain `replaces: null`.
  - The natura-card "no link, no action" case now covers only unavailable, read-failed and choose.
- **Manual 3.6–3.12, verified by the agent at the owner's request (2026-10-01):**
  - **Setup:** a throwaway local user, `s08-p3-…@example.com`, with six seeded products and made-up Rossmann ids 990008101–106, all priced fresh so nothing asked Rossmann. Product R was matched to the real NV89063, with the real EAN 4005900009319.
  - **Live Natura requests:** 8, the owner's budget. `shop_requests` went from 107 to 115:
    - 2 to open the choice in 3.6;
    - 1 for the re-pinned item's price;
    - 2 + 2 for "Zmień" and "Dopasuj ponownie" in 3.8;
    - 1 for the retry's name search, which found nothing.
  - **3.6:** the choice listed NV89063 marked "Obecne dopasowanie" with no confirm button, then JM00370 (Yope) and 5N97985 (Bambino), each flagged "Inna marka". The row was unchanged afterwards.
  - **3.7:** confirming JM00370 stored `matched`/`user`. The card named "Yope Naturalny szampon do włosów Super Soft…" with its live 16,99 zł (instead of 19,99 zł) and "Inna marka: YOPE zamiast NIVEA".
  - **3.8:** "Żaden z nich" stored the decline. "Dopasuj ponownie" offered three "To ten produkt" and "Anuluj", with no "Żaden z nich", and "Anuluj" returned to the plain page.
  - **3.9:** with Natura disabled locally, the choice said "Wyszukiwanie w sklepie Natura jest wyłączone…", and "Żaden z nich" declined.
  - **3.10:** another tab re-pinned T to S08P3T02 through the user's own REST call. The stale "Żaden z nich" then said "Ten produkt ma już zapisaną decyzję.", and the row kept S08P3T02.
  - **3.11:** `f=check` survived every link (Zmień, Anuluj, Dopasuj ponownie, Szukaj ponownie), every form, the decision redirects and the retry redirect, and the list beside the product kept "Do sprawdzenia" active. "Pokaż zapisaną decyzję", which appears only during a lookup race, is covered by the views' tests.
  - **3.12:** a cross-site `?repin=1` (`node:http` with `Sec-Fetch-Site: cross-site`, Natura enabled) got the stored card with "Zmień", no choice, and 0 requests.
- **Manual 3.13, verified by the agent at the owner's request:** `/dev/product-page` shows every re-pin state with the same counts in light and dark: the current badge, the cards' hints, the incomplete and nothing-found messages, "Zmień", "Dopasuj ponownie", "Anuluj" and "Żaden z nich". There's no overflow.
- **Observed, as designed:**
  - On the re-pin page, the card keeps the stored price, since the island doesn't refetch while re-pinning, while the choice shows each candidate's live price.
  - The chips' counts are computed at render, so a just re-pinned item without a price counts in "Do sprawdzenia" until the next render.

### Phase 4

- **`notices.ts`:**
  - The codes and texts are typed records, after the `DECISION_CODES`/`DECISION_NOTICES` pattern: `REMOVED_CODES`/`RemovedCode`/`REMOVED_NOTICES` (done, gone), `REMOVAL_CODES`/`RemovalCode`/`REMOVAL_NOTICES` (failed), and `EXISTS_NOTICE`.
  - `watchlist.ts` gains two readers the plan didn't name, `removedNotice(value)` for the list and `removalErrorMessage(value)` for the product page. Like `watchlistErrorMessage` and `decisionNotice`, a crafted code shows nothing.
- **`removalBackTo` and `removeFromWatchlist`:**
  - `removalBackTo(itemId: string, outcome: RemovalOutcome, filter)`, where `RemovalOutcome = RemoveResult | "config"`. The id can't be null: the route returns before it for a crafted id.
  - In `removeFromWatchlist`, an odd answer is anything that isn't a list, more than one row, or a row without a string id. The returned id isn't compared with the one asked for: Postgres matches a crafted upper-case UUID but returns it in lower case.
- **The routes:**
  - The add route and the list page also read `error` through `ERROR_PARAM`, and `backToWatchlist` takes `"exists" | WatchlistError`.
  - In the remove route, a body that isn't a form and an id that isn't a UUID both go to bare `/watchlist`, as the refresh route does. The id is checked before the null client, so `config` keeps the filter.
- **`RemoveProduct`:**
  - Its props are `productId`, `filter`, `error?`, `open?` and `idPrefix?`.
  - It includes `<SubmitOnce />`, and its form is its own submit-once group.
  - When open, the failure Alert comes first. The summary and the button are as wide as their words.
  - It always posts a hidden `f`. `RefreshForm` leaves `f` out for "all", as planned.
- **The island's prop:** it is `listFilter` all the way down (`PriceComparisonView`, `ProductTitle`, `RefreshBar`, `RefreshForm`), and required; the sink passes "all".
- **The product sink:** a "Usuń z listy" section built from `REMOVE_FIXTURES`, drawn light and dark in `CARDS_FRAME`.
  - It shows closed, open and failed. "Failed" is drawn with `open: false`, showing that the error alone opens it.
  - An "open, po wysłaniu" row shows the disabled destructive Button.
  - The legend is updated.
- **The list sink:** `HEADS` entries gain `notice`, with "check + removed" and "removed + gone".
- **Tests beyond the plan:**
  - `notices.test.ts` pins `LIST_NOTICE_PARAMS` (the break-check), and that `NOTICE_PARAMS` holds `REMOVAL_PARAM` and not `f`.
  - The readers refuse crafted codes, and `removalBackTo`'s codes turn back into each page's text.
  - `productRefreshBackTo` is tested for every refresh code.
- **Mine, in the main session:**
  - `withoutNotices(href, params)` in `notices.ts` is browser-safe and tested. Both address-bar scripts forget their notices through it, instead of each repeating the loop (lesson "Define shared constants and helpers once").
  - A failed removal's address points to the confirm. `REMOVAL_ANCHOR` ("remove") is the confirm's default id, and `removalBackTo`'s failure address ends in `#remove`, so the page opens at its error rather than its top. The subagent had flagged that the error stood below the fold.
- **Known and left for the review:**
  - A delete that committed but whose answer timed out reads as `failed`, and its page then answers 404 without the removal's error.
  - `scripts/smoke.mjs` has no step for the remove route. Astro's `checkOrigin` refuses a cross-site post to it, as smoke already pins for the decision and refresh routes.
- **Manual 4.9–4.15, verified by the agent at the owner's request (2026-10-01):**
  - **Setup:** throwaway local users `s08-p4a-…` and `s08-p4b-…`, both watching the made-up Rossmann 990008201. Rossmann and Natura were disabled locally during the browser checks, and `shop_requests` stayed at 126 throughout.
  - **4.9:** with JavaScript off, a native click opened the `<details>` (it gained `open`), and the red "Usuń z listy" posted to `/watchlist?f=check&removed=done`, which said "Usunięto produkt z listy.". With JavaScript on, that address became `/watchlist?f=check`.
  - **4.10:** after A's removal, B's product page showed Rossmann's 15,99 zł, and B's own REST read returned both observations of 990008201.
  - **4.11:** re-adding through "Dodaj" gave a new id (601b9f06…), no Natura decision, and the "Dopasuj w Naturze" prompt.
  - **4.12:** the removal posted a second time went to `/watchlist?f=check&removed=gone`, which said "Tego produktu nie było już na Twojej liście.".
  - **4.13:** `f=check` survived the removal and the product's own no-JavaScript "Odśwież ceny" (`/watchlist/<id>?f=check&prices=failed`; failed only because the shops were disabled locally).
  - **4.14:** at 390 px, keyboard focus showed the 2 px ring at a 2 px offset on the summary and on the red button. Scrolled to the bottom, the button ends at 860 px, above the phone's bottom bar at 883 px.
  - **4.15:** the sinks show the confirm closed, open and failed, and the list's two notices, each in light and dark, with no overflow.

### Phase 5

- **The reads:**
  - `matches.ts` shares its two size columns (`sizeColumns`) and a private `sizeOf` between the product page's read and the list's. The match's `decided_by` reuses `decisionColumns.decided_by`.
  - `watchlist.ts` moves `size_value`/`size_unit` from `productRowSchema` up to `rowSchema`, so `getWatchlistProduct` takes the size from `toItem`. Its zod columns and the both-or-neither size expression still repeat those in `matches.ts`, as they did before.
  - A matched row whose brand, size or decider doesn't parse is odd, so its product reads unreadable, never one that agrees. One `it.each` in `matches.test.ts` pins that for each column.
- **The row rule:**
  - `naturaMismatchOf(item, matchRead)` is exported beside `naturaStateOf`, and both find the decision through a private `naturaDecisionOf`.
  - `listRowOf` takes the mismatch as an optional fifth argument, `NO_MISMATCH` by default, so its existing callers and the sink's `rowOf` are unchanged.
  - `NaturaMismatch` is `ReturnType<typeof matchDifferences>`, so the row rule can't drift from the matching rule.
  - A decline passed with a mismatch is left out, and the tag never changes. Each is pinned by a test.
- **The island guard:** `matching.ts` imports only types from `@/types`, so admitting it needed no other change.
- **The kitchen sink:** the suspicious row is `ROW_FIXTURES`' last entry, a Joanna 500 ml shampoo automatically matched to the brand "WZÓR". It's built through `listRowsOf` from the list's own reads, so the row rule decides its count and its line. The gallery, its chips and the long list (now fifteen) count it in "Do sprawdzenia". `LIST_STATES`' Nivea match is an agreeing automatic one, so the read failures built from it don't change. The `product()` helper parses each fixture's size from its text.
- **Manual 5.6, verified by the agent at the owner's request (2026-10-01):**
  - **Setup:** a throwaway local user, `s08-p5-…@example.com`, seeded through the user's own REST calls, not as the superuser the plan suggested, since the user's insert grant already allows an `auto` match. It has three products with made-up Rossmann ids 990008301–303 and Natura SKUs S08P5Q01–03, priced fresh:
    - Q1, NIVEA 300 ml, automatically matched to DOVE 300 ml;
    - Q2, NIVEA 300 ml, a user-confirmed NIVEA MEN 500 ml match;
    - Q3, ZIAJA 75 ml, an agreeing automatic match.
  - Rossmann and Natura were disabled locally during the visit and restored after. `shop_requests` max id was 126 before and after, so no shop was asked.
  - At 1280 and 390 px, the chips read "Wszystkie 3", "Promocje 0" and "Do sprawdzenia 1", and `?f=check` holds Q1 alone. Its line for screen readers ends "Natura: sprawdź dopasowanie, inna marka.", and Q2's and Q3's say nothing about their matches. The list beside Q1's product page holds the same, and no page overflows.
- **Manual 5.7, verified by the agent at the owner's request:** `/dev/watchlist` draws the suspicious row in light and in the `.dark` wrapper, looking like any other row, with the same line for screen readers in both themes. The aside's chips read "Wszystkie 10", "Promocje 1" and "Do sprawdzenia 5". There's no overflow.

### Phase 6

- **CLAUDE.md, beyond the contract's list:**
  - `:38` also says watchlist rows can't be changed, which the script has always asserted, beside the removal and re-add proofs.
  - `:50` also says that `?repin=1` reaches Natura only on the user's own navigation (`decideMatchStep`), that the island's refetch is off while re-pinning (`autoRefresh`), and that the product page's own actions keep `?f=` (`filterHref`, `productRefreshBackTo`). That sentence names only the product page's own actions, since "Dodaj" and the header's search drop `?f=`.
  - `:50` names the three return-address functions where it said "those two functions", and says `notices.ts` holds "Dodaj"'s and a removal's notices too.
  - `:51` holds the list's suspicious-match rule (`naturaMismatchOf`) beside `matchDifferences`, rather than in the UI bullet, and the first lookup's search order (`lookupInNatura`), to contrast with the choice's two searches.
  - `:52` adds what a direct call can still do, from Phase 1's notes: a user can set their own decision back to `not_found` or mark their own match `auto`, which changes only their own list. It also says that no observation references a product.
- **PRD:**
  - The notes also record owner calls from the plan: a delete behind a confirm with no undo (FR-005), the accepted "Dr Irena Eris" false alarm from plan review F6 (FR-006), and, from "What We're NOT Doing", no reset to undecided and no Rossmann re-pin (FR-007).
  - The FR-006 note states the brand rule as precisely as the code applies it: "ł" doesn't decompose under NFKD, so "Łódź" and "Lodz" read as different brands.
- **Roadmap:**
  - The Risk line names two checks: `check-matches-db.mjs` for the cascade and `check-prices-db.mjs` for observations surviving a removal.
  - Mine: it says "no foreign key ties an observation to a product or a user", not "no observation references" them, since `recorded_by` holds the recording user's id without a foreign key.
- **Frontmatter:** unchanged. `prd.md` has no `updated:` key, and `roadmap.md`'s was already 2026-10-01.
- **6.1:**
  - `npm run lint` reports 1,513 problems, all in one file of the untracked handoff copy in the repository root (`Drogeria Radar redesign/`), which CI never checks out. Judged as the Testing Strategy says, `npx eslint . --ignore-pattern "Drogeria Radar redesign/**"` passes.
  - Prettier reports `prd.md`, `roadmap.md` and this plan clean. `CLAUDE.md` is in `.prettierignore`.
- **6.2:** the course block, from its BEGIN marker to its END marker (47 lines), has the same sha256 as `main`'s. CLAUDE.md's hunks are at lines 18, 38–40, 47 and 50–52 only.
- **6.3:** CI is green on `93dd2fd` (ci in 1m8s, smoke in 2m27s), as it was on every earlier phase's push.
- **6.4:** the owner pushed the migration on 2026-10-01. `npx supabase migration list --linked` shows `20261001182905` with its remote version, beside the five earlier migrations.
- **6.5, recorded by the agent (2026-10-01):** production runs PostgreSQL 17.6 (image 17.6.1.166).
  - The source is `supabase/.temp/postgres-version`, which `supabase link` wrote from the linked project on 2026-09-27; the file is git-ignored.
  - The local stack runs the same image (`supabase/postgres:17.6.1.166`, reporting "PostgreSQL 17.6"), so the research's probes P1–P3 ran on production's version. That closes research open question 7.
  - An upgrade after that link would show in the dashboard (Project Settings → Infrastructure).

### Implementation review fixes

- **The review** (`reviews/impl-review.md`, 2026-10-01): NEEDS ATTENTION, with 1 warning and 5 observations. The owner had all six fixed, F1 through Fix A. A subagent wrote the fixes, and the main session reviewed, gated and break-checked them. What's left for later is in `follow-ups/review-fixes.md`.
- **F1, a page left open after a re-pin elsewhere:**
  - Each island refetch names the shop item its page shows (`shopItemId` in `PriceComparisonShop` and `ShopRow`), and `priceRequestSchema` requires it, through the shared `shopItemIdSchema`, which `matches.ts` now exports.
  - `priceTargetFor` (`price-targets.ts`) still fetches only the item the user's rows give. When that differs from the one named, it gives `changed`, which the route answers with 409 before any shop request.
  - The island reads that 409 as `match-changed`. The row stays as it was, and a warning Alert, built like the session one, says "Dopasowanie w Naturze się zmieniło." with a link that reloads the product's page with the list's filter.
  - `refresh(shop, shopItemId)` takes the id from its caller: the page's `shops` for the automatic refetch, and the state's row for the button.
  - Smoke's price posts carry a `shopItemId`. The kitchen sink's island states gain `match-changed`, where Rossmann answers with a price and Natura with `match-changed`, with its legend line beside `session-ended`'s.
- **F2:** `REPIN_PARAM` (`notices.ts`) joins `NOTICE_PARAMS`, so the product page's address bar forgets `?repin=1` once the choice has rendered. Going back to it or reloading it lands on the plain page and asks Natura nothing.
  - This amends Phase 3's note that the address bar keeps `repin=1`. A reload of an open choice, say after Natura was busy, now shows the plain page, and "Zmień" opens the choice again.
  - The two production uses of the literal (`[id].astro`, `natura-view.ts`) take the constant.
- **F3:** each re-pin option carries `confirm`, which is false only for the item of a match the user confirmed.
  - An automatic match's item shows "Obecne dopasowanie" and "To ten produkt". Confirming it posts the decision it replaces, so the same compare-and-swap makes the match the user's own, and a false alarm stops counting in "Do sprawdzenia".
  - The kitchen sink's `CONFIRMED` is retyped `RepinnableMatch` and draws a "confirmed + repin" fixture, with the badge only.
- **F4:** `autoRefreshOf(step, ownNavigation)` (`match-step.ts`, tested) replaces the page's inline rule. The page keeps its step in scope.
- **F5:** with `REMOVAL_GONE_NOTICES` and `removalGoneNotice()`, the not-found page shows "Produktu nie ma już na Twojej liście." as a success status after `?removal=failed`. The kitchen sink draws that state.
- **F6:** smoke gains a `removal` helper and four steps: an anonymous user is redirected, a post from another site is refused, a crafted id goes to `/watchlist` with no code, and a product no one has goes to `/watchlist?f=check&removed=gone`.
- **CLAUDE.md:** line 50 only, and the course block is untouched.
- **Gates:** 1,171 tests, lint, `astro check` with 0 errors and 0 warnings, the build with 6 fonts, 136 contrast pairs, and smoke's 28 steps against the dev server.
- **Break-checks:** seven, each going red and then restored. The route's target ignoring the item shown and the island reading the 409 as a failure (F1), the address bar keeping `repin` (F2), no confirm on an automatic current item (F3), a refetch while re-pinning (F4), and no notice on the not-found page (F5).
- **Checked on dev by the agent (2026-10-02):** the throwaway local user `s08-p5-…`, with Rossmann and Natura disabled locally. `shop_requests` stayed at 126 throughout.
  - **F1:** Q3 was re-pinned "from another tab" through the user's own REST call. The product's "Odśwież ceny" then showed "Dopasowanie w Naturze się zmieniło. Odśwież stronę, aby zobaczyć aktualne ceny." with the product's own link, and never the new item's name. Q2's refresh, its match unchanged, showed no such alert.
  - **F2:** `/watchlist/<Q1>?f=check&repin=1` became `?f=check` once the choice rendered.
  - **F3:** confirming Q1's own automatic match (DOVE for a NIVEA product) went to `?f=check&matched=1`. The row is now `decided_by` `user`, and "Do sprawdzenia" fell from 1 to 0.
  - **F5:** `/watchlist/<a product no one has>?removal=failed` said "Produktu nie ma już na Twojej liście." as a status.
  - **Kitchen sink:** it draws the reload alert and the not-found notice in both themes. In its re-pin choices, the automatic matches' current items offer "To ten produkt", and the user-confirmed one shows the badge only.

### Production rollout

- **Merged on 2026-10-01** as `8235311` (PR #17), after the implementation review's fixes (`f630b9e`).
  - The migration `20261001182905` was already on production, confirmed with `npx supabase migration list --linked` before the merge (6.4).
  - Workers Builds deployed the merge at 22:49 UTC, and `ci` and `smoke` passed on `main`.
- **The owner's phone check on production passed** (6.6, confirmed on 2026-10-02): removing a product and re-pinning a match.
- **Left for later changes:** `follow-ups/review-fixes.md`, with what S-05 and S-06 need for re-pinning, the reload alert and the suspicious count, and the two accepted risks to revisit.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database contract

#### Automated

- [x] 1.1 The migration applies to the local stack: `npx supabase migration up --local` — 6efdf20
- [x] 1.2 `node scripts/check-watchlist-db.mjs` passes, with the removal assertions — 6efdf20
- [x] 1.3 `node scripts/check-matches-db.mjs` passes, with the re-pin, refusal and cascade assertions — 6efdf20
- [x] 1.4 `node scripts/check-prices-db.mjs` passes, with observations surviving a removal — 6efdf20
- [x] 1.5 Break-checks go red: without the delete policy, with the old `not_found`-only update policy, and with a delete grant on `watchlist_matches`; the schema matches its snapshot afterwards — 6efdf20
- [x] 1.6 `npm run lint` passes — 6efdf20
- [x] 1.7 CI is green on the phase's commit (ci and smoke) — 6efdf20

### Phase 2: Brand rule and the saved match's item

#### Automated

- [x] 2.1 `npm run test` passes, with the brand rule's cases and an automatic match stopped by another brand — 97634c6
- [x] 2.2 `npm run lint` passes — 97634c6
- [x] 2.3 `npx astro check` passes — 97634c6
- [x] 2.4 `npm run build` passes — 97634c6
- [x] 2.5 Break-checks go red: `qualifies` without the brand condition, and a saved match's view without its item — 97634c6

#### Manual

- [x] 2.6 `/dev/product-page` shows the "Inna marka" flag and a saved match's brand, size, name and warnings, in both themes — 97634c6
- [x] 2.7 On dev, a saved Natura match names its item in the card, which holds its layout at 390 px and 1024 px — 97634c6

### Phase 3: Re-pinning a Natura match

#### Automated

- [x] 3.1 `npm run test` passes, with the re-pin step, the choice lookup's served URLs, the narrowed decision write and the filtered links — bf3c4d2
- [x] 3.2 `npm run lint` passes — bf3c4d2
- [x] 3.3 `npx astro check` passes — bf3c4d2
- [x] 3.4 `npm run build` passes — bf3c4d2
- [x] 3.5 Break-checks go red: the choice without the name search, a re-pin step for a link from another site, and a decision write not narrowed by `replaces` — bf3c4d2

#### Manual

- [x] 3.6 "Zmień" opens a choice from both searches with the current item marked, costing 2 Natura requests and storing nothing until a button is pressed — bf3c4d2
- [x] 3.7 Confirming another candidate re-pins the match, and the card names the new item with its price — bf3c4d2
- [x] 3.8 "Żaden z nich" declines the match, and "Dopasuj ponownie" reopens the choice with "Anuluj" only — bf3c4d2
- [x] 3.9 With Natura stopped locally, the choice says so and "Żaden z nich" still declines — bf3c4d2
- [x] 3.10 A re-pin sent from a stale tab says the decision was already stored and changes nothing — bf3c4d2
- [x] 3.11 `?f=` survives Natura's links, decisions and redirects, and the list beside the product keeps its chip — bf3c4d2
- [x] 3.12 A `?repin=1` request that isn't the user's own navigation sends no Natura request — bf3c4d2
- [x] 3.13 `/dev/product-page` shows every re-pin state in both themes — bf3c4d2

### Phase 4: Removing a product

#### Automated

- [x] 4.1 `npm run test` passes, with the removal's outcomes and every return address keeping the filter — 9189c8c
- [x] 4.2 `npm run lint` passes — 9189c8c
- [x] 4.3 `npx astro check` passes — 9189c8c
- [x] 4.4 `npm run build` passes — 9189c8c
- [x] 4.5 `node scripts/check-token-contrast.mjs` passes — 9189c8c
- [x] 4.6 `npm run smoke` passes against the dev server — 9189c8c
- [x] 4.7 Break-checks go red: a removal that reads no row as removed, and the list's address bar keeping `removed` — 9189c8c
- [x] 4.8 CI is green on the phase's commit (ci and smoke) — 9189c8c

#### Manual

- [x] 4.9 Without JavaScript, "Usuń z listy" opens its confirm in place and removes the product, and the list says so once — 9189c8c
- [x] 4.10 Another user watching the same Rossmann item still sees its prices after the removal — 9189c8c
- [x] 4.11 Adding the removed product again gives it a new page and a fresh Natura lookup — 9189c8c
- [x] 4.12 Sending the removal a second time says the product was no longer on the list — 9189c8c
- [x] 4.13 `?f=` survives the removal and the product's no-JavaScript "Odśwież ceny" — 9189c8c
- [x] 4.14 The summary and the red button show the focus ring, and the opened confirm sits above a phone's bottom bar — 9189c8c
- [x] 4.15 The kitchen sinks show the confirm closed, open and failed, and the list's notices, in both themes — 9189c8c

### Phase 5: Suspicious matches on the list

#### Automated

- [x] 5.1 `npm run test` passes, with automatic, user-confirmed and agreeing matches on the list — baff9b9
- [x] 5.2 `npm run lint` passes, with `matching.ts` admitted by the island guard — baff9b9
- [x] 5.3 `npx astro check` passes — baff9b9
- [x] 5.4 `npm run build` passes — baff9b9
- [x] 5.5 Break-checks go red: a server-only import in `matching.ts`, the check rule without the suspicious condition, and the rule counting a user-confirmed match — baff9b9

#### Manual

- [x] 5.6 On dev, a product whose automatic match has another brand is under "Do sprawdzenia" with its reason on the row's screen-reader line, and a user-confirmed mismatch isn't — baff9b9
- [x] 5.7 `/dev/watchlist` shows the suspicious row in both themes — baff9b9

### Phase 6: Docs and rollout

#### Automated

- [x] 6.1 `npm run lint` passes, and Prettier reports the changed docs clean — 93dd2fd
- [x] 6.2 The CLAUDE.md course block is identical to `main`'s — 93dd2fd
- [x] 6.3 CI is green on the PR (ci and smoke) — 93dd2fd

#### Manual

- [x] 6.4 The owner pushes the migration, and `npx supabase migration list --linked` shows its remote version — 93dd2fd
- [x] 6.5 The production PostgreSQL version is recorded — 93dd2fd
- [x] 6.6 After the merge, the owner's phone check on production passes: remove a product, re-pin a match — 8235311
