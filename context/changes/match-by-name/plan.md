# Automatic matches by name, Super-Pharm first: Implementation Plan

## Overview

Super-Pharm's index carries no EAN, so no Super-Pharm item is ever accepted on its own today. An undecided Super-Pharm is looked up only when the user taps „Dopasuj w Super-Pharmie”. This change:

- adds a strict name check to the matching rule, for an item or a product without an EAN;
- looks Super-Pharm up by name when a product opens, like Natura and Hebe;
- shows a match accepted that way as „Dopasowano automatycznie po nazwie.” with „Zmień”;
- reads Super-Pharm's size from the end of its name when the size field is missing.

The owner's calls are in `change.md` (2026-10-06) and the evidence in `research.md`.

## Current State Analysis

- **One function accepts a match.** `pickMatch` accepts only the single candidate that shares an EAN, has an equal size and has a brand that doesn't differ (`src/lib/services/matching.ts:80-98`). Super-Pharm's candidates carry `eans: []` (`src/lib/services/shops/super-pharm.ts:319-321`), so none qualifies.
- **Super-Pharm is `on-request`** (`src/lib/services/price-comparison.ts:86-105`). Four places read that:
  - `shop-matching.ts:153` (no EAN search);
  - `match-step.ts:77` (only `?retry=super-pharm` looks it up);
  - `match-view.ts:375` (the button's link names it);
  - `src/components/watchlist/match-card.ts:108` (an unsaved outcome points at the button).
- **The caption reaches the lookups but nothing reads it.** The product arrives as a whole `WatchlistProduct`, caption included (`src/pages/watchlist/[id].astro:99-111`). `LookupProduct` doesn't type the caption (`shop-matching.ts:53-56`), and the name query is the brand, name and size (`:160-162`). Rossmann keeps the variant (shade, scent, gender) in the caption.
- **One note for every automatic match.** The card says „Dopasowano automatycznie: ten sam EAN i rozmiar.” (`match-view.ts:212`). `watchlist_matches.decided_by` is `'auto'` or `'user'` with no reason (`supabase/migrations/20260927184936_watchlist_matches.sql:30`). Every automatic match the lookups have written shares an EAN with its product.
- **Super-Pharm's size comes from `capacity` alone** (`super-pharm.ts:309`, `readSize` at :480-484). 27 of the 47 recorded lookup candidates have none, and 14 of the 47 names end with a size (`research.md` §4, §5).
- **A choice asks again on every view.** A lookup that ends in a choice stores nothing, so each own-navigation view asks again until the user decides (`shop-matching.ts:375-376`), as Natura and Hebe do today.

## Desired End State

- **A product with no Super-Pharm decision, opened on the user's own navigation,** has Super-Pharm looked up by name (1 request). Then:
  - **If exactly one item wins the name check,** it's stored as an automatic match and priced at once. Its card names the item, says „Dopasowano automatycznie po nazwie.” and offers „Zmień”, and Super-Pharm no longer keeps the product in „Do sprawdzenia”.
  - **Otherwise** the choice lists the best name fit first.
- **Natura and Hebe are unchanged.** An item carrying an EAN is never accepted by name when the product has one, and their EAN rule stays as it is.
- **Verified by:**
  - unit tests on the recorded answers: all 15 Super-Pharm cases (10 accepted, 3 left to the user with the right item first, 2 with no right item to accept), and 3 Natura and Hebe cases with the product's EANs hidden. None accepts a wrong item.
  - `phone-four-shops` e2e: the lookup on view against a held shop, and the note on a seeded match;
  - the owner's check after deploy.

### Key Discoveries:

- **The rule receives no shop** (`matching.ts:80`). Acceptance follows the data, so a name check keyed on "no EAN on either side" reaches Super-Pharm without a shop branch.
- **`matching.ts` runs in the browser too** (`eslint.config.js:92`, :139-141), since `watchlist-rows.ts` imports `matchDifferences`. The name check may import only types there.
- **"By name" can be derived, not stored.** An automatic match accepted by name has no EAN in common with its product, and one accepted by EAN has one. That holds as long as the name check runs only when no candidate qualifies by EAN and only on candidates without an EAN (or for a product without one), so no migration is needed (`research.md` §6, option B).
- **The variant is in the caption.** 6 Sky High mascaras share one query, „Maybelline New York Lash Sensational Sky High 7,2 ml”, and differ only in their captions (`research.md` §4).
- **Recorded evidence for the chosen rule** (planning run, `change.md`): 10 of 15 Super-Pharm cases accepted correctly, 0 wrong. In each of the 3 it leaves to the user, the right item is first in the choice. With the product's EANs hidden, 1 right, 1 missed and 12 correctly not accepted at Natura and Hebe, 0 wrong.
- **A held shop's reservation returns before inserting** (`supabase/migrations/20260926112205_polite_shop_access.sql:65-67`, insert at :81). So the e2e request-log mark (`scripts/e2e-local-db.mjs:191-195`) doesn't move when a page now asks Super-Pharm.
- **The dev sample page's guard runs at module load.** `src/dev/fixtures.ts:1059-1061` calls `leftToUser` (:581-588), which throws unless `pickMatch` answers `choose`. No test or CI step imports the file.

## What We're NOT Doing

- **No name check for Natura's or Hebe's items that carry an EAN while the product has one.** Reading (c) in `research.md` §7 was declined. Their acceptance stays EAN-only.
- **No name check as a veto on an EAN match:** S-05's "no name comparison" call stands.
- **No stored reason for an automatic match:** no migration, no new `decided_by` value or column.
- **No EANs read from Super-Pharm's product pages (`gtin13`)**, and no caption added to the Super-Pharm query.
- **No new automatic lookup of a stored Super-Pharm „nie znaleziono”.** It keeps „Szukaj ponownie”.
- **No change to Natura's and Hebe's choice order or re-pin order** when the product has an EAN and their items carry EANs.
- **No size tolerance beyond today's 0.1 %**, and no change to „Do sprawdzenia”'s logic.
- **No part of add-from-other-shops** (the four-shop search, joining Super-Pharm's items into its entries, Rossmann as a matched shop). That change reuses this rule later.

## Implementation Approach

- **Sizes before the rule.** The Super-Pharm adapter learns to read a size from the end of its names first, since the rule needs equal, known sizes.
- **One rule in `matching.ts`.** The name check goes into `pickMatch` as a second step after the EAN rule, with word lists small enough to state in the code and pinned by tests on the recorded answers. The note on the card is derived from the stored EANs, in the same phase, so the card never calls a match by name an EAN match.
- **Then the tap-only mode goes.** Super-Pharm is looked up on view by retiring `MatchMode`. The one fact worth keeping, whether a shop's search can find an EAN, moves to the shop's adapter (`SHOP_ADAPTERS`). The tap-only branches in the step, the prompt link and the unsaved text are removed. The e2e spec that relied on the button changes in the same phase.
- **Sample pages and documents last.** The dev pages and documents follow the behaviour.

## Critical Implementation Details

- **State sequencing.** The name check may accept only when no candidate qualifies by EAN, and only among candidates for which EANs can't decide (the candidate or the product has no EAN). The derived note („po nazwie” when the product and the item share no EAN) is exact only under that order. A name check used as a tie-break between EAN-sharing candidates would mislabel them as EAN matches.
- **The dev sample page fails silently in CI.** Once the rule accepts the sample Super-Pharm item, the whole `/dev/product-page` throws on import under `astro dev`, and no automated check notices. Phase 2 restructures the sample candidates and checks the page by hand.

## Phase 1: Super-Pharm reads sizes from its names

### Overview

When a Super-Pharm record has no usable `capacity`, its size is the one its name ends with, unless the name is a set. The 7 recorded Super-Pharm lookups become test fixtures.

### Changes Required:

#### 1. The size of a Super-Pharm candidate

**File**: `src/lib/services/shops/super-pharm.ts`

**Intent**: Items whose record lacks `capacity` but whose name ends with the size („…, 400 ml”, „… 4,8 g”) get a comparable size, so the matching rule can treat them as items of the product's size. A set's name ends with one of its items' sizes, so it gives none.

**Contract**:

- `readSize` takes the hit's `capacity` and its name. It returns `capacity`'s size when that parses. Otherwise it returns `trailingSizeText(name)` (`src/lib/services/size.ts:41-48`), unless the name contains „zestaw” (any case) or „+”. Otherwise it returns no size.
- Either way the text is within `PRODUCT_LIMITS.sizeText` and `parseSize` reads it back as the same size, the invariant a form post relies on (`super-pharm.ts:476-479`).
- Price requests don't read sizes and are unchanged.

#### 2. Fixtures from the approved recordings

**File**: `src/lib/services/shops/fixtures/` (new files) and `src/lib/services/shops/super-pharm.test.ts`

**Intent**: The 7 Super-Pharm lookups recorded with the owner's OK on 2026-10-06 become fixtures, so the size reading and, in phase 2, the rule are tested on real answers (`context/foundation/test-plan.md` §6.4).

**Contract**:

- Copy `context/changes/match-by-name/recordings/super-pharm-lookup-*.json` to `fixtures/super-pharm-lookup-<case>.json`, kept whole as recorded. The test file's header names each one's request body and time (11:49 UTC), as it does for the existing ones.
- Each recording is served for its exact body (`requestBody`), spelled out in the test.

#### 3. Tests

**File**: `src/lib/services/shops/super-pharm.test.ts`

**Intent**: Pin the new reading on the recordings.

**Contract**:

- Head & Shoulders 150930 reads 400 ml; the Derma Control sprays read 150 ml and 250 ml; the Disney lip balms read 4,8 g.
- The set 163029 („Zestaw … + Płyn mic. 200 ml”) reads no size.
- An item with `capacity` keeps it, and an item whose name ends with no size reads none.
- Existing size assertions on the `NIVEA krem` fixture change only where a name ends with a size.

### Success Criteria:

#### Automated Verification:

- Super-Pharm's adapter tests pass, sizes read from names included: `npx vitest run src/lib/services/shops/super-pharm.test.ts`
- Break-checks turn named tests red: reading a set's trailing size, and preferring the name's size over `capacity` (`test-plan.md` §6.4, "Done means")
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

**Implementation Note**: After completing this phase and all automated verification passes, continue to phase 2. The phase has no manual check.

---

## Phase 2: The name check

### Overview

`pickMatch` gains a strict name check for candidates without an EAN (or a product without one). It also gains the choice order by name fit. The card's note for an automatic match tells EAN from name. After this phase a tap on „Dopasuj w Super-Pharmie” can already end in an automatic match, which is only visible on the branch.

### Changes Required:

#### 1. The rule

**File**: `src/lib/services/matching.ts`

**Intent**: Accept an item by name only when every word of its name is the product's and it clearly covers more than any other such item. Order the choice by name fit, so the right shade or scent is among the 3 offered.

**Contract**:

- **`NamedProduct` extends `MatchProduct`** with `name: string` and `caption: string | null`, and it's `pickMatch`'s product. `judge` and `matchDifferences` keep `MatchProduct`. The file stays browser-safe and imports only types.
- **Words of a text:**
  - sizes (an amount followed by ml, g, l, kg, mg or szt) are removed;
  - the text is decomposed (NFKD) without combining marks, lower-cased by Polish rules, and split on anything but letters and digits;
  - three short lists in the file are dropped:
    - small words: do, z, ze, i, w, we, na, dla, od, o, oraz, a;
    - kind words that shops write differently: mascara, maskara, tusz, rzes, deo;
    - packaging: pudełko.
  - **Numbers stay words**, so „SPF 30” and „SPF 50” differ.
- **The product's words** are those of its name and caption. **A candidate's words** are those of its name. The words of both brands are removed from both sides.
- **A candidate is name-eligible** when its size equals the product's, its brand doesn't differ, and either side has no EAN.
- **It passes** when none of its words is missing from the product's and they share at least 2.
- **The steps, in order:**
  1. The EAN rule, unchanged: exactly one qualifying candidate is accepted.
  2. When none qualifies, the passing candidate whose shared words include every other passing candidate's, and outnumber them, is accepted. A lone passing candidate is accepted too.
  3. Otherwise the choice comes, in this order:
     - the qualifying candidates;
     - the name-eligible look-alikes by fit (more shared words first, then fewer extra words, then the shop's order);
     - the other look-alikes, then the rest, in the shop's order;
     - at most `limit`.
- **An exported helper gives that choice order for a list**, for the re-pin's choice in phase 3.
- **The header comment** states the rule, its lists and why numbers count.

#### 2. The product the lookup compares

**File**: `src/lib/services/shop-matching.ts`

**Intent**: The lookup hands the rule the product's caption, which already arrives at runtime.

**Contract**:

- `LookupProduct` extends `NamedProduct` with `sizeText`; `WatchlistProduct` already conforms (`src/types.ts:74-79`).
- The comments that say Super-Pharm never matches on its own (`:58-61`, `:147-151`) and the candidate's comment in `super-pharm.ts:319-320` state the name check instead.

#### 3. The card's note

**File**: `src/lib/services/match-view.ts`

**Intent**: An automatic match with no EAN in common with its product says „Dopasowano automatycznie po nazwie.”, and one with an EAN in common keeps its note.

**Contract**:

- The view's own `MatchProduct` (`:53`) gains `eans`, and `matchedView`'s item gains `eans`.
- The note:
  - `"auto"` with an EAN in common: „Dopasowano automatycznie: ten sam EAN i rozmiar.”;
  - `"auto"` without: „Dopasowano automatycznie po nazwie.”;
  - `"user"`: „Potwierdzone przez Ciebie.”.
- Callers pass what they already hold: `storedView` the stored item, `lookupOutcome` (`shop-matching.ts:370`) the candidate and the product.

#### 4. The dev sample page keeps loading

**File**: `src/dev/fixtures.ts`

**Intent**: The sample Super-Pharm item the rule now accepts is shown as an automatic match by name. The choice is built from candidates the rule leaves to the user, so the guard at :1059-1061 doesn't throw.

**Contract**:

- `SUPER_PHARM_CANDIDATES` splits into the accepted item and a choice set of same-size, same-brand siblings whose names add a word the product lacks.
- A Super-Pharm fixture shows the stored automatic match with its price and the new note.
- `leftToUser`'s error message names no shop (`:585`).

#### 5. Tests

**File**: `src/lib/services/matching.test.ts`, `src/lib/services/shops/super-pharm.test.ts`, `src/lib/services/shops/natura.test.ts`, `src/lib/services/shops/hebe.test.ts`, `src/lib/services/shop-matching.test.ts`, `src/lib/services/match-view.test.ts`, `src/lib/services/shops/fixtures/` (new files)

**Intent**: Pin the rule's boundaries on small cases and its outcomes on every recorded case. Update the tests that said Super-Pharm is never accepted.

**Contract**:

- **`matching.test.ts`** pins the rule's boundaries:
  - the EAN rule wins, and two EAN-sharing candidates stay a choice;
  - an EAN-bearing candidate isn't name-eligible while the product has an EAN, and is once the product has none;
  - an extra word rejects, numbers included (SPF 30 against SPF 50);
  - „(Pudełko)”, the kind words and the brand's words are ignored;
  - one shared word isn't enough;
  - the covering candidate beats a covered one (Cosmic Black over Black), and two passing candidates where neither covers the other stay a choice;
  - the choice order by fit.

  Its `product` literal gains a name and caption.

- **Fixtures.** From `context/changes/add-from-other-shops/recordings/`, copied with their recording's date:
  - `rossmann-search-nivea-soft.json` and `rossmann-search-aa-laab.json`;
  - `natura-search-nivea-soft.json`, cut to its first 5 hits;
  - `hebe-search-aa-laab.json`.

  From this change's `recordings/`, the 3 `rossmann-search-*.json`.

- **`super-pharm.test.ts`** checks the 15 recorded cases: each Rossmann product from the fixtures against its Super-Pharm lookup, the existing `super-pharm-name-search-one.json` for Nivea Soft 300 ml.
  - **Accepted:** 105870, 20369, 150930, 67655, 84422, 99681, 122681, 30050, 30469 and 10132.
  - **A choice with the right item first:** 134305, 99683 and 62293.
  - **No acceptance:** the Soft Rose lip balm and the women's Derma Control.

  `ROSSMANN_SOFT` (`:111-115`) gains its name and caption, and the "never accepts" cases (`:729-756`) become these.

- **`natura.test.ts` and `hebe.test.ts`**, with the product's EANs hidden:
  - Hebe accepts 450251 for AA LAAB 419343;
  - Natura doesn't accept NV89059 for Soft Daily UV 2103263, nor NV89063 for Nivea Soft 26900 („intensywnie”).

  `hebe.test.ts`'s `MatchProduct` constants (`:67-80`) gain names and captions.

- **`shop-matching.test.ts`:**
  - the Super-Pharm cases that expected a choice for Nivea Soft 300 ml (`:562-587`, `:1085-1118`) expect what the rule now gives;
  - its `LookupProduct` constants and the `watched()` helper (`:659-670`) carry a caption.
- **`match-view.test.ts`:** both notes. Its product gains EANs (`:41`), so the existing EAN note keeps its meaning.

### Success Criteria:

#### Automated Verification:

- The rule's tests pass, the name check's boundaries included: `npx vitest run src/lib/services/matching.test.ts`
- The recorded cases pass in the adapters' tests: `npx vitest run src/lib/services/shops/`
- Break-checks turn named tests red: ignoring numbers, accepting on one shared word, making an EAN-bearing item name-eligible while the product has an EAN, accepting a covered candidate, and running the name check while a candidate qualifies by EAN
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

#### Manual Verification:

- `/dev/product-page` loads under `astro dev` and shows Super-Pharm's automatic match by name and its choice

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Super-Pharm looked up on view

### Overview

Super-Pharm is looked up by name on the user's own navigation to a product with no Super-Pharm decision, like Natura and Hebe. `MatchMode` is retired, and a shop's adapter says whether its search can find an EAN. Super-Pharm's re-pin choice lists the best fit first. The e2e spec that tapped the button asserts the lookup on view instead.

### Changes Required:

#### 1. What a shop's search can find

**File**: `src/lib/services/shops/registry.ts`, `src/lib/services/price-comparison.ts`

**Intent**: Keep the one fact that stays true, that Super-Pharm's search can't find an EAN, where the shop's other abilities live, and remove the tap-only mode.

**Contract**:

- `ShopAdapter` gains `searchesByEan: boolean`: true for Natura and Hebe, false for Super-Pharm.
- `MatchMode`, `MATCH_MODES` and their comments leave `price-comparison.ts`, so no browser module reads either.

#### 2. The lookups

**File**: `src/lib/services/shop-matching.ts`

**Intent**: No EAN search for a shop that can't find one, as today. The re-pin's choice in such a shop is ordered by name fit.

**Contract**:

- `lookupEan` returns null when `SHOP_ADAPTERS[shop].searchesByEan` is false.
- `lookupChoicesInShop` orders its candidates with phase 2's helper when the shop can't search by EAN, at most 6, and never accepts. Natura's and Hebe's re-pin order is unchanged.

#### 3. The step, the prompt and the unsaved text

**File**: `src/lib/services/match-step.ts`, `src/lib/services/match-view.ts`, `src/components/watchlist/match-card.ts`

**Intent**: Super-Pharm gets a lookup wherever Natura does, and its button and texts no longer assume a tap.

**Contract**:

- `decideMatchStep` loses `notAsked` (`:77-78`). A shop with no decision is looked up on the user's own navigation unless the page was opened to re-pin or retry another shop.
- `promptView` names a shop in its link only for a retry (`:374-377`).
- `unsavedText` has one text for every shop: „Nie udało się zapisać wyniku. Przy następnym otwarciu produktu sklep … zostanie sprawdzony ponownie.” (`:105-111`).
- The doc comments that describe the button as the only way (`match-step.ts:51-61`, `match-view.ts:368-373`, `src/lib/notices.ts:112-119`, `super-pharm.ts:21-23`) say what's true now.

#### 4. Unit tests

**File**: `src/lib/services/match-step.test.ts`, `src/lib/services/match-view.test.ts`, `src/components/watchlist/match-card.test.ts`, `src/lib/services/shop-matching.test.ts`

**Intent**: Pin the lookup on view and the removed tap-only paths.

**Contract**:

- **`match-step.test.ts`:** Super-Pharm with no decision gets `lookup` on own navigation, a plain view and `?repin=super-pharm` included (`:310-333`), and `prompt` otherwise.
- **`match-view.test.ts`:** a prompt's link names the shop only for a retry (`:283-287`, `:499-507`).
- **`match-card.test.ts`:** the single unsaved text (`:290-311`).
- **`shop-matching.test.ts`:**
  - a plain view looks Super-Pharm up, with one reservation and its recorded body (`:828-912`); the helpers `trackerShop` and `slowGate` learn Super-Pharm;
  - the cases "gives Super-Pharm only its button" become lookups (`:1033-1083`);
  - Super-Pharm's re-pin choice puts the best fit first.

#### 5. The e2e spec that tapped the button

**File**: `tests/e2e/phone-four-shops.spec.ts`, `tests/e2e/support/watchlist-data.ts`

**Intent**: The spec asserts what a held Super-Pharm now shows on a plain view.

**Contract**:

- **Step 3** (`:93-104`):
  - the waiting product's Super-Pharm card shows `searchStoppedNotice("Super-Pharm")` (`tests/e2e/support/pages.ts:23-28`);
  - no „Dopasuj w Super-Pharmie” link, and no price-refresh stopped notice;
  - the request-log mark doesn't move.
- **Step 4** (`:106-120`, the tap) is removed. Steps 1-2 and 5 are unchanged.
- The header, title and comments (`:1-16`, `:42`, `:47-55`, `:93-107`) and the support file's docs (`watchlist-data.ts:140-145`, `:155-158`) describe the lookup on view.

### Success Criteria:

#### Automated Verification:

- The step, view, card and lookup tests pass: `npx vitest run src/lib/services/match-step.test.ts src/lib/services/match-view.test.ts src/components/watchlist/match-card.test.ts src/lib/services/shop-matching.test.ts`
- Nothing in `src/` refers to `MATCH_MODES`, `MatchMode` or `on-request`: `grep -rn "MATCH_MODES\|MatchMode\|on-request" src` prints nothing
- Lint, type check, the unit suite and the build pass: `npm run lint`, `npx astro check`, `npm run test`, `npm run build`
- `phone-four-shops` passes against the held shops: `npx playwright test tests/e2e/phone-four-shops.spec.ts`

#### Manual Verification:

- On the local production preview, with the owner's OK for the live request, opening a product with no Super-Pharm decision shows Super-Pharm matched by name or a choice with the best fit first. Reopening a product whose match was accepted asks Super-Pharm nothing.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Dev sample pages and the note end to end

### Overview

The dev sample pages show every Super-Pharm state truly, the automatic match by name and its re-pin included. An e2e check shows the note on a stored automatic match without asking any shop.

### Changes Required:

#### 1. The product page's sample states

**File**: `src/dev/fixtures.ts`, `src/dev/product-page.astro`

**Intent**: The sample page shows what the app now does: a Super-Pharm looked up on view, matched by name or left as a choice, and the prompt only where Natura's appears.

**Contract**:

- **Add:** the re-pin of the automatic match by name (`repinView` with „Obecne dopasowanie” and „To ten produkt”, as Natura's `matched + repin`).
- **Reword the texts that assume a tap or a "user's pick only"** in `fixtures.ts`:
  - the header at `:2-11`;
  - the comments at `:266-269`, `:303-304` and `:1031-1076`;
  - the labels at `:1105-1127`, `:1246-1260` and `:1304-1309`.
- **Reword the Super-Pharm intro and labels** in `product-page.astro` (`:72-73`, `:180-182`, `:286-288`, `:461-470`).

#### 2. The list's sample states

**File**: `src/dev/watchlist-fixtures.ts`, `src/dev/watchlist.astro`

**Intent**: The list's Super-Pharm texts stop saying a product waits for a button.

**Contract**: Reword `watchlist-fixtures.ts:257`, `:270` and `:400-403`, and `watchlist.astro:212-219`. The row states themselves are unchanged.

#### 3. The note end to end

**File**: `tests/e2e/phone-four-shops.spec.ts`, `tests/e2e/support/watchlist-data.ts`

**Intent**: A stored automatic Super-Pharm match shows its note and „Zmień” on the product page, with no shop request.

**Contract**:

- A third seeded product gets an automatic Super-Pharm match (`matchShop`, `decidedBy` 'auto', no EANs) and its price (`recordPrice`, so the island doesn't refetch).
- Its Super-Pharm card shows „Dopasowano automatycznie po nazwie.” and a „Zmień” link.
- The page makes no island price call, and the request-log mark doesn't move.

### Success Criteria:

#### Automated Verification:

- The whole e2e suite passes, the note's check included: `npx playwright test`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

#### Manual Verification:

- `/dev/product-page` shows every Super-Pharm state with true wording, in light and dark
- `/dev/watchlist`'s Super-Pharm rows read true

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Docs and rollout

### Overview

The documents state the name check and Super-Pharm's lookup on view. The change ships through the PR's merge, and the owner checks it in production.

### Changes Required:

#### 1. The PRD

**File**: `context/foundation/prd.md`

**Intent**: Record the owner's 2026-10-06 calls where FR-006 and FR-007 are tracked.

**Contract**:

- **FR-006** gains "Update 2026-10-06: match-by-name":
  - an item or a product without an EAN is accepted by the strict name check;
  - Super-Pharm is looked up by name when the product opens;
  - Natura and Hebe accept only by EAN when both sides have EANs;
  - Super-Pharm's size can come from its name;
  - a choice lists the best name fit first.

  It supersedes the 2026-10-05 update's "none is ever accepted automatically".

- **FR-007** gains a line: a match accepted by name says so on its card, with „Zmień”.

#### 2. The test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Its risks and recipes say how a shop without EANs is matched now.

**Contract**:

- Risk #6 (`:48`) says a shop without EANs accepts only by the strict name check, never on size and brand alone.
- `:123-124` and `:141` (§6.3) describe the lookup on view.
- §6.4 lists the new fixtures.
- `:189-191` gets a note that this change superseded those lines.

#### 3. CLAUDE.md

**File**: `CLAUDE.md` (project rules above the 10x course block only)

**Intent**: The architecture notes stay true.

**Contract**:

- The UI paragraph's sentences on a shop "matched on request" and `promptView`'s link become the lookup on view.
- "Shops and matching" describes:
  - the name check;
  - `searchesByEan` instead of `MATCH_MODES`;
  - Super-Pharm's size from its name;
  - the choice order.

#### 4. The research note, roadmap and deploy plan

**File**: `docs/research/polish-drugstore-price-apis.md`, `context/foundation/roadmap.md`, `context/deployment/deploy-plan.md`

**Intent**: Remove the statements this change makes false.

**Contract**:

- **Research note:** §6 steps 4 and 6 (`:310`, `:312`) state that the app matches Super-Pharm by the strict name check. §2.3 records the missing `capacity` and the size in names.
- **Roadmap:** S-06's "Not built: automatic Super-Pharm matches … a lookup on a plain view" (`:183-196`) points to match-by-name.
- **Deploy plan:** `:358` says opening a product reads Super-Pharm.

#### 5. Rollout

**File**: none (process)

**Intent**: Ship through the PR, with no migration, and confirm in production.

**Contract**:

- The PR merges after the `ci`, `smoke` and `e2e` checks pass, and Workers Builds deploys it.
- There's no `supabase db push`.

### Success Criteria:

#### Automated Verification:

- Prettier leaves the edited documents as they are: `npx prettier --check context/foundation/prd.md context/foundation/test-plan.md docs/research/polish-drugstore-price-apis.md context/foundation/roadmap.md context/deployment/deploy-plan.md`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

#### Manual Verification:

- The owner reviews the PRD, test-plan and CLAUDE.md updates
- After the deploy, the owner opens a product with no Super-Pharm decision, on the phone or else a desktop browser. Super-Pharm shows „Dopasowano automatycznie po nazwie.” or a choice with the best fit first, and the Worker log shows one Super-Pharm search for that view.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- **The rule** (`matching.test.ts`): every boundary of the name check, against small hand-made candidates.
  - eligibility, with an EAN on either side;
  - extra words, numbers included;
  - ignored words: small, kind, packaging, brand;
  - the 2-word minimum, the covering tie-break and the choice order.
- **The recorded cases** (`super-pharm.test.ts`, `natura.test.ts`, `hebe.test.ts`):
  - all 15 Super-Pharm cases;
  - 3 Natura and Hebe cases with the product's EANs hidden;
  - sizes read from Super-Pharm's names, a set's excluded.
- **The flow** (`match-step.test.ts`, `shop-matching.test.ts`, `match-view.test.ts`, `match-card.test.ts`):
  - the lookup on view, its single reservation and recorded body;
  - the prompt's link, the unsaved text;
  - both notes, and the re-pin order.

### Integration Tests:

- `phone-four-shops`:
  - a plain view looks a held Super-Pharm up and shows its stopped notice, without moving the request-log mark;
  - a stored automatic match shows „Dopasowano automatycznie po nazwie.” and „Zmień”.
- The rest of the e2e suite passes unchanged. Each product view now spends one refused Super-Pharm reservation, which inserts nothing.

### Manual Testing Steps:

1. Open `/dev/product-page` under `astro dev`: the automatic match by name, its re-pin and the choice render, in light and dark.
2. On the local production preview, with the owner's OK for the live request, open a product without a Super-Pharm decision: matched by name or a choice with the best fit first.
3. After the deploy, open such a product in production and check the Worker log for one Super-Pharm search.

## Performance Considerations

- **What a product view costs Super-Pharm.** On the user's own navigation with no stored Super-Pharm decision, a view spends 1 Super-Pharm request, as each undecided Natura or Hebe spends 1-2. That includes the first view after „Dodaj”, which redirects to the product page (`src/pages/api/watchlist.ts:40`).
  - **An accepted match or „nie znaleziono”** is stored, and later views ask nothing.
  - **A choice** stores nothing, so each later own-navigation view asks again until the user picks or declines, as Natura's and Hebe's choices do.
- **A product's first view** spends 3-5 shop requests: Natura 1-2, Hebe 1-2, Super-Pharm 1. Each comes with its reservation, the shops asked at once and each shop's requests one after the other.
- **Inferred, not measured:** three shops at once stay within the six connections a Worker may hold waiting (`context/archive/2026-09-28-cheapest-shop-today/research.md:247-252`).

## Migration Notes

- **No schema change and no migration.**
- **Existing rows are unaffected:**
  - automatic matches share an EAN with their product and keep the EAN note;
  - Super-Pharm picks and declines stay;
  - a stored Super-Pharm „nie znaleziono” stays until „Szukaj ponownie”.
- **Undecided products are matched on their next view.** Products with no Super-Pharm decision get looked up on their next own-navigation view. Production held no Super-Pharm decision on the morning of 2026-10-06.
- **A null caption leaves the rule the name alone.** That can only make it accept less.

## Implementation Notes

One line per adaptation, added in the phase's commit (`context/foundation/lessons.md`, "Record every adaptation in the plan in the same commit").

### Phase 1

- **Size fallback narrowed to the owner's call** (Phase 1 contract, `readSize`). The contract said the name's size applies when `capacity` doesn't parse. The owner's call (`change.md`) was "when the size field is missing", so only a missing or blank `capacity` falls back to the name. A `capacity` that doesn't parse, such as a multipack's „2 x 50 ml”, still gives no size, since the name's size could be one item's.
- **Observed, left for Phase 5:**
  - Two new recordings send `in_stock: false` (Head & Shoulders 150930, Creme Care 20369) where every earlier hit sent 1 or 0. The adapter counts it in an "availability unread" log line and reads the item as not orderable, which is right for `false`.
  - The other 69 of the 71 recorded hits send 1.
  - The research note's §2.3 records it in Phase 5.

### Phase 2

- **Comments in `shop-matching.ts`** (contract item 2). The cited lines (:58-61, :147-151) never said Super-Pharm doesn't match on its own. The name check is documented on `lookupInShop` and `LookupProduct` instead. `lookupEan`'s comment stays for Phase 3, which rewrites the function.
- **Shared helpers in `matching.ts`** (lesson 6):
  - `sharesAnEan` serves both `judge` and the card's note, so the note and the rule compare the same lists;
  - `folded` serves both `brandKey` and the word splitter;
  - Phase 3's choice-order helper is `orderChoice(product, candidates)`, which returns every candidate judged and ordered; `pickMatch` cuts it to `limit`.
- **The size pattern has no lookbehind:** `matching.ts` runs in the islands, and Safari before 16.4 can't parse one.
- **The dev sample page** (contract item 4):
  - Super-Pharm's whole answer is `SUPER_PHARM_FOUND`, and the choice, `SUPER_PHARM_CANDIDATES`, is that answer without the accepted item.
  - The choice has one same-size, same-brand sibling („…SPF 30 (Pudełko)”), so the label's size and brand warnings still fit in the 3 offered.
  - A new "matched" fixture shows the automatic match by name.
  - `SUPER_PHARM_ITEM`'s doc comment is reworded now, not in Phase 4, since this phase makes "always the user's pick" false.
- **How the recorded tests read their products:**
  - `super-pharm.test.ts` reads the 14 recorded products through Rossmann's own adapter, over a real gate and the replay, with every URL spelled out. The two `pageSize=10` recordings are served for the adapter's `pageSize=24` request, as the earlier probes are; they hold all their items.
  - `natura.test.ts` and `hebe.test.ts` use hand-written products that name their recording.
- **Tests whose expectations changed by the plan's order:**
  - In `matching.test.ts`, an EAN-less look-alike now leads the choice ahead of EAN-bearing ones.
  - `shop-matching.test.ts`'s `spCream` keeps its choice: its name, „krem” with no caption, leaves 10132's words unexplained.
  - A new `runMatchSteps` test stores an automatic match by name, with its first price and „Dopasowano automatycznie po nazwie.”.

### Phase 3

- **Criterion 3.2's grep is word-bounded.** `on-request` is a substring of `json-request`, so the plan's `grep -rn "MATCH_MODES\|MatchMode\|on-request" src` always prints 4 lines (`price-comparison-state.ts`, `json-request.test.ts`, `pages/api/watchlist/prices.ts` ×2). The gate runs `grep -rnE "MATCH_MODES|MatchMode|(^|[^a-zA-Z])on-request" src`, which prints nothing.
- **Comments the contract cited that said something else:**
  - `super-pharm.ts:21-23` never mentioned the button. It now says the lookups search Super-Pharm by name alone, and names `searchesByEan`.
  - `notices.test.ts`, which isn't in the plan's list, had a comment calling `?retry=super-pharm` "the tap on the button"; its assertions are unchanged.
- **No recording answers Super-Pharm's search for the product the plain-view tests use** (`softInBoth`, „nivea soft”). Those tests give Super-Pharm's exact body a status-only 500 entry. Super-Pharm is still asked once, with one reservation and its body asserted, and shows „chwilowo niedostępna”.
- **The accepted-by-name path is a plain view** of a product whose Natura and Hebe decisions are stored, served by the real P3 recording. "Gives Super-Pharm only its button" is gone, and "asks no shop" gained a stored Super-Pharm decline.
- **`lookupChoicesInShop` orders by fit, then cuts to 6,** as `pickMatch` orders, then cuts to its limit.
- **e2e:** step 4 is gone, so the old step 5 is now numbered 4. The unused `waitForIsland` import is removed.
- **Criteria 3.4 and 3.5 can't run here** (no Docker, no local Supabase):
  - 3.4 runs in CI's `e2e` job on draft PR #32 after this phase is pushed.
  - 3.5 is covered by Phase 5's check 5.4 in production after the deploy (the owner's call, 2026-10-06), and is ticked with it.

## References

- Research: `context/changes/match-by-name/research.md`
- The owner's calls: `context/changes/match-by-name/change.md`
- Recordings: `context/changes/match-by-name/recordings/`, `context/changes/add-from-other-shops/recordings/`
- The change this reverses in part: `context/changes/super-pharm-in-comparison/plan.md` (:94-95, :129)
- Fixture rules: `context/foundation/test-plan.md` §6.4
- Similar implementation: Hebe's size from its legal name, `src/lib/services/shops/hebe.ts:178-183`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Super-Pharm reads sizes from its names

#### Automated

- [x] 1.1 Super-Pharm's adapter tests pass, sizes read from names included — ec93c3e
- [x] 1.2 Break-checks turn named tests red: a set's trailing size, and the name's size over `capacity` — ec93c3e
- [x] 1.3 Lint, type check and the whole unit suite pass — ec93c3e

### Phase 2: The name check

#### Automated

- [x] 2.1 The rule's tests pass, the name check's boundaries included — 64bc832
- [x] 2.2 The recorded cases pass in the adapters' tests — 64bc832
- [x] 2.3 Break-checks turn named tests red: numbers ignored, one shared word, EAN-bearing items eligible, a covered candidate accepted, the name check beside an EAN match — 64bc832
- [x] 2.4 Lint, type check and the whole unit suite pass — 64bc832

#### Manual

- [x] 2.5 `/dev/product-page` loads under `astro dev` and shows Super-Pharm's automatic match by name and its choice — 64bc832

### Phase 3: Super-Pharm looked up on view

#### Automated

- [x] 3.1 The step, view, card and lookup tests pass
- [x] 3.2 Nothing in `src/` refers to `MATCH_MODES`, `MatchMode` or `on-request`
- [x] 3.3 Lint, type check, the unit suite and the build pass
- [ ] 3.4 `phone-four-shops` passes against the held shops

#### Manual

- [ ] 3.5 On the local production preview, a product with no Super-Pharm decision is matched by name or offers the best fit first, and an accepted match asks nothing on reopening

### Phase 4: Dev sample pages and the note end to end

#### Automated

- [ ] 4.1 The whole e2e suite passes, the note's check included
- [ ] 4.2 Lint, type check and the whole unit suite pass

#### Manual

- [ ] 4.3 `/dev/product-page` shows every Super-Pharm state with true wording, in light and dark
- [ ] 4.4 `/dev/watchlist`'s Super-Pharm rows read true

### Phase 5: Docs and rollout

#### Automated

- [ ] 5.1 Prettier leaves the edited documents as they are
- [ ] 5.2 Lint, type check and the whole unit suite pass

#### Manual

- [ ] 5.3 The owner reviews the PRD, test-plan and CLAUDE.md updates
- [ ] 5.4 After the deploy, a product with no Super-Pharm decision shows a match by name or the best fit first, with one Super-Pharm search in the Worker log
