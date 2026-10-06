# Whether today's price is a good one (S-04, FR-012) Implementation Plan

## Overview

A product's page judges today's best price:

- **„Dobra cena!”** when it is below what it's compared with;
- **„Zwykła cena”** when it is equal or above;
- **nothing, with the reason,** when there is nothing to compare with.

It compares with the cheapest shop's declared 30-day low until the product's own history is enough. Then it compares with the lowest price the app saw for the product across the user's shops in the 30 days before today. A sentence in the price card always says which comparison was made. This is roadmap slice S-04, and it answers PRD Open Question 4 with the owner's calls of 2026-10-06.

## Current State Analysis

From `context/changes/good-price-judgement/research.md`:

- **History is stored, never read:**
  - `price_observations` keeps every answered check, each with its price, regular price, declared 30-day low, orderability and time. It is append-only (`supabase/migrations/20260928011450_price_observations.sql:33-73`).
  - The app reads only each item's last check, through `latest_price_observations` (`src/lib/services/prices.ts:85-87`, `:228-233`). Its watchers may already read every row.
  - Rows come only from views and refreshes, so history exists only since 2026-09-29 and is uneven.
- **The shops' 30-day lows:** Natura and Hebe declare one for every item. Rossmann declares one only while an item is reduced. Super-Pharm declares one for about a third of its items.
- **The verdict:** it carries no low and no history (`src/lib/services/price-comparison.ts:252-282`).
- **The stickers:** the hero's sticker knows only "Tylko 1 sklep" and "Stara cena" (`src/components/watchlist/price-comparison-state.ts:407-480`, `Sticker.tsx:24-27`). The price card's sentence slot speaks only to undecided shops and stale prices (`trackHint`, `:658-670`).
- **The design draws two outcomes** against the cheapest shop's low:
  - „Dobra / cena!” (mint), with "Poniżej najniższej ceny z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.";
  - „Zwykła / cena” (white), with "Równa najniższej cenie z 30 dni wg sklepu."
  - Sources: `context/archive/2026-09-30-etykiety-redesign/handoff/README.md:107-120`; `Drogeria Radar Redesign.dc.html:816`, `:824`.
- **Waiting for S-04's migration** (`context/archive/2026-09-28-cheapest-shop-today/follow-ups/review-fixes.md:5-20`): F6 (bounds on `regular_price` and `lowest_price_30d`) and F4 (a lighter latest-price view).
- **The product page's budget:** it already makes about 5 simultaneous subrequests, so history must come in the read it already makes.

## Desired End State

- **On a product priced in several shops:**
  - the hero shows „Dobra cena!” (the mint sticker) when today's cheapest price is below what it's compared with, and „Zwykła cena” (white) when it is equal or above;
  - the price card says which comparison was made;
  - with nothing to compare with, there is no sticker, and the card says why.
- **On a product priced in one shop:** the hero keeps „Tylko 1 sklep”, and the card carries the judgement's sentence.
- **Stale, unavailable, unread and unpriced products** carry no judgement.
- **The two comparisons:**
  - **The product's own history** is used once the product has been on the user's list for at least 30 days and the app recorded an orderable price for it on at least 5 different Warsaw days within the 30 days before today. It compares with the lowest such price across the product's current shops.
  - **Otherwise, the cheapest shop's declared 30-day low,** the lowest one among tied cheapest shops.
  - **Otherwise, nothing.**
- **The list's screen-reader line** for a product whose prices are all stale or missing names the shop, the price and the age its tag shows.
- **The documents:** PRD Open Question 4 is answered, and the roadmap's S-04, `CLAUDE.md`'s sticker sentence and the test plan describe the rule.
- **How to verify:** the unit, database and e2e checks below, and the owner's look at a product in production.

### Key Discoveries:

- The product's "added" date already reaches the island (`product.addedAt`, `src/pages/watchlist/[id].astro:285`; `WatchlistItem.addedAt`, `src/types.ts:70`).
- The product page reads its prices with `readLatestPrices(supabase, keys)` (`[id].astro:131`). The list reads `listLatestPrices`, with no keys (`:76`). So the product page's read can move to a view with history while the list's stays as it is.
- `price-comparison.ts` already has a Warsaw formatter (`:19`) and is one of the three services the islands may import (`eslint.config.js:143-145`).
- `heroOf`'s tests compare the whole `Hero` with `toEqual` (`price-comparison-state.test.ts:727-815`), so a new sticker kind is a deliberate test change.
- Users can't set `observed_at` (the column grants leave it to the database), so a history test needs backdated rows through the local superuser, as e2e's `backdateChecks` does (`scripts/e2e-local-db.mjs:205-216`).

## What We're NOT Doing

- **A judgement on the list.** It shows on the product page only (the owner's call).
- **A third level** such as "Drożej niż zwykle": anything not below the comparison is „Zwykła cena” (the owner's call).
- **A fallback to another shop's low** when the cheapest shop declares none. There is no sticker, and the card says why (the owner's call).
- **F4's rework of `latest_price_observations`,** which would drive it from the caller's watched items. Its partial index is added here, but at today's scale the list's single read gains nothing measurable. It stays recorded for a later change.
- **A daily refresh (FR-015),** so history grows only as products are opened.
- **Comparing the regular price with the promotion price.** That was ruled out at shaping (`context/foundation/shape-notes.md:38-39`).

## Implementation Approach

- **The rule comes first.** It is a pure, browser-safe function in `price-comparison.ts`, tested at its boundaries.
- **Then the data.** One migration adds a view that gives each item its latest check plus a 30-day history summary. The product page reads it in place of its current read, so it makes no extra request.
- **Then the page.** The stickers, the sentence, the sample pages and an e2e check.
- **Last, the list's screen-reader line and the documents.**
- **Rollout:** the change has a migration, so the owner pushes it before the merge. The deploy gate refuses a deploy without it.

## Critical Implementation Details

- **"Before today" is Warsaw's calendar.** The history window is the 30 Warsaw days before today's: `observed_at` at or after the start of (today − 30) and before the start of today, both in `Europe/Warsaw`. Today's own checks never count, so the baseline doesn't move during the day, and a price is never compared with itself.
- **Prices compare in grosze.** Compare rounded hundredths, so 7.49 against 7.49 is equal.
- **An unreadable row makes no judgement.** A history value that can't be read makes the row unreadable, like any other column. The verdict is then `unread`, and no sentence claims "the history is too short".

## Phase 1: The rule

### Overview

One tested function decides the judgement from the verdict, the rows' declared lows, the product's history summary and its "added" date.

### Changes Required:

#### 1. The judgement

**File**: `src/lib/services/price-comparison.ts`

**Intent**: The owner's rule, in one place the island and the server can both run.

**Contract**:

- **Types:** `PriceHistory = { low: number | null; days: string[] }` per item (`days` as `YYYY-MM-DD` Warsaw dates). `PriceJudgement`:
  - `{ kind: "good" | "ordinary"; basis: "shop" | "history"; baseline: number }`, or
  - `{ kind: "none"; shops: KnownShop[] }`, or
  - `null` when no judgement applies.
- **`judgementOf(verdict, rows, addedAt, now)`:**
  - **Which verdicts:** only `cheapest` and `only` are judged, with the verdict's price. Every other kind gives `null`.
  - **History, when enough:** the product was added at least 30 × 24 h before `now`, the union of the rows' `days` holds at least 5 dates, and some row has a `low`. The baseline is the lowest `low` across the rows.
  - **Else the shop's low:** the lowest declared `lowestPrice30d` among the verdict's shops (`verdictShops`).
  - **Else** `{ kind: "none", shops }`.
  - **The outcome:** `good` when the price, in grosze, is below the baseline; `ordinary` otherwise.
  - `HISTORY_DAYS_NEEDED = 5` and `HISTORY_WINDOW_DAYS = 30` are exported.
- **The rows** carry the history: `PricedRow` (or `LatestCheck`) gains `history: PriceHistory | null`.

#### 2. Tests

**File**: `src/lib/services/price-comparison.test.ts`

**Intent**: Pin the owner's rule at its boundaries.

**Contract**: cases for:

- a price below, equal to and above the shop's low;
- tied cheapest shops with different lows (the lowest counts);
- a shop with no low and no history (`none`, naming the shop);
- history at 29 days 23 h (not enough) and at exactly 30 days;
- 4 days (not enough) and 5 days (enough) of history;
- the same day in two shops counted once;
- history's low below and above today's price;
- `only` judged, and `stale`, `unavailable`, `unread` and `none` not judged;
- 7,49 against 7,49 being ordinary.

### Success Criteria:

#### Automated Verification:

- The rule's tests pass: `npx vitest run src/lib/services/price-comparison.test.ts`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

---

## Phase 2: History in the database

### Overview

The product page's existing read brings each item's 30-day history summary, through a new view. The same migration bounds two price columns and adds the queued partial index.

### Changes Required:

#### 1. The migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_price_history.sql` (new, later than `20261006183345`)

**Intent**: History for the judgement, read with the latest price in one request, with the same row-level rules.

**Contract**:

- **The view `public.price_summaries`** (`security_invoker = true`):
  - every column of `latest_price_observations`, plus `history_low numeric(10,2)` and `history_days date[]`;
  - both are taken from the item's `status = 'price' and available` rows in the window (see "Critical Implementation Details");
  - `history_days` holds the distinct Warsaw dates, in order;
  - select is granted to `authenticated` only.
- **A partial index** on `price_observations (shop_id, shop_item_id, observed_at desc) where status = 'price'` (F4's index).
- **F6:** check constraints keep `regular_price` and `lowest_price_30d` below 100000, as `price` is.
- **A header comment** names the owner's rule and the follow-ups it closes or leaves (F6 closed; F4's index added, its view rework left).

#### 2. The read

**File**: `src/lib/services/prices.ts`, `src/pages/watchlist/[id].astro`, the island's types (`src/components/watchlist/price-comparison-state.ts`, `PriceComparison.tsx`)

**Intent**: The product page reads `price_summaries` instead of `latest_price_observations`, still in one request. Each row carries its history to the island.

**Contract**:

- `readLatestPrices` reads `price_summaries` with the two extra columns.
- Its rows parse the history strictly (a number or null, and a list of `YYYY-MM-DD` dates), and an odd value makes the row unreadable.
- `listLatestPrices` and the list are unchanged.
- The island's `PriceComparisonShop.latest` carries `history`.

#### 3. The database check

**File**: `scripts/check-prices-db.mjs`

**Intent**: Prove the view's history is right and private.

**Contract**: with fresh users and items, as the script does, prove that:

- a non-watcher reads no row of `price_summaries`;
- a watcher's view gives a `history_low` and `history_days` that leave out today's rows, `missing` rows and unorderable rows;
- two checks on one day count as one date;
- `regular_price` and `lowest_price_30d` of 100000 are refused (23514).

Past rows are backdated with the local superuser, as `scripts/e2e-local-db.mjs` does.

### Success Criteria:

#### Automated Verification:

- Lint, type check and the whole unit suite pass, `prices.ts`' parsing tests included: `npm run lint`, `npx astro check`, `npm run test`
- CI's `smoke` job passes on the PR, `check-prices-db.mjs`' history and bound cases included

#### Manual Verification:

- Before the merge, the owner runs `npx supabase db push`, and `npx supabase migration list --linked` shows the new migration's remote version

---

## Phase 3: The product page

### Overview

The hero's sticker and the price card's sentence show the judgement, the sample pages show every outcome, and an e2e check shows it on the production build.

### Changes Required:

#### 1. The stickers

**File**: `src/components/watchlist/Sticker.tsx`, `src/styles/global.css`, `scripts/check-token-contrast.mjs`, `src/lib/utils.ts` (if a token name needs it)

**Intent**: The design's two judgement stickers.

**Contract**:

- `StickerKind` gains:
  - `good`: lines "Dobra", "cena!"; fill `bg-sticker-good`;
  - `ordinary`: lines "Zwykła", "cena"; fill `bg-sticker-plain`.
- `--sticker-good` is a new token equal to the design's `#B5EDCB`, light in both themes as the other stickers are, with its `--color-*` entry. It is checked against `--label-ink` by the contrast script.
- The header comment says the stickers now judge as well as state facts.

#### 2. The hero and the sentence

**File**: `src/components/watchlist/price-comparison-state.ts`, `PriceComparisonView.tsx`

**Intent**: The judgement reaches the hero and the card.

**Contract**:

- **`heroOf`'s sticker:** for `cheapest`, `good` or `ordinary` from `judgementOf`, or `null` for `none`. For `only`, it stays `one-shop`.
- **`trackHint` gives the card's sentence:** the judgement's sentence, then the existing action hint, if any, joined by a space. The sentences:
  - shop, good: „Poniżej najniższej ceny z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.” (the design's);
  - shop, equal: „Równa najniższej cenie z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.”;
  - shop, above: „Powyżej najniższej ceny z 30 dni wg sklepu ({low}). Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.”;
  - history, good: „Najniższa cena w Twoich sklepach od 30 dni.”;
  - history, equal: „Równa najniższej cenie w Twoich sklepach z ostatnich 30 dni.”;
  - history, above: „W ostatnich 30 dniach było taniej w Twoich sklepach: {low}.”;
  - none: „Nie ma z czym porównać: {shops} nie podaje najniższej ceny z 30 dni, a historia cen jest jeszcze za krótka.”, with „nie podają” for more than one shop.
- **Tests:** `price-comparison-state.test.ts` updates `heroOf`'s `toEqual`s and adds `trackHint`'s cases.

#### 3. The sample pages

**File**: `src/dev/fixtures.ts`, `src/dev/product-page.astro`

**Intent**: Every outcome, as the kitchen sink shows every state.

**Contract**:

- **New area states:** good against the shop's low; the handoff's Isana sample, equal; above; good and ordinary against history; and nothing to compare.
- **The sticker section** shows `good` and `ordinary` at both sizes, and its intro drops "facts only".

#### 4. The e2e check

**File**: `tests/e2e/good-price.spec.ts` (new), `tests/e2e/support/watchlist-data.ts`

**Intent**: On the production build, a seeded price below its declared low reads as good, and a product with no low says why.

**Contract**:

- `recordPrice` takes an optional `lowestPrice30d`.
- The spec, titled after risk #1, seeds two products:
  - one whose fresh cheapest price is below its shop's low: the card's sentence reads „Poniżej najniższej ceny z 30 dni wg sklepu…”;
  - one whose cheapest shop declares no low: the card reads „Nie ma z czym porównać…”.
- Neither asks a shop: the request-log mark doesn't move.

### Success Criteria:

#### Automated Verification:

- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`
- The contrast check passes with the new token: `node scripts/check-token-contrast.mjs`
- CI's `e2e` job passes on the PR, `good-price.spec.ts` included

#### Manual Verification:

- `/dev/product-page` shows every judgement state and both new stickers, in light and dark

---

## Phase 4: The list's screen-reader line, docs and rollout

### Overview

The roadmap's carry-over for the list, then the documents, then the owner's push and check.

### Changes Required:

#### 1. The list's line

**File**: `src/lib/services/price-comparison.ts` (`listSummaryText`), its tests, `tests/e2e/price-honesty.spec.ts`

**Intent**: A product whose prices are all stale or missing is described to screen readers as its tag shows it.

**Contract**:

- The multi-shop stale line names the shop, the price and the age its tag shows, then "Odśwież ceny lub otwórz produkt.", e.g. „Nieaktualna cena: Rossmann 11,99 zł · 2 dni temu. Odśwież ceny lub otwórz produkt.”
- The unit test at `price-comparison.test.ts:1030-1034` is updated, and P4 asserts the new line.

#### 2. The documents

**File**: `context/foundation/prd.md`, `context/foundation/roadmap.md`, `CLAUDE.md` (project rules only), `context/foundation/test-plan.md`

**Intent**: Record the owner's rule where it's tracked.

**Contract**:

- **PRD:** an "Update 2026-10-06" under FR-012 states the rule, and Open Question 4 is marked answered.
- **Roadmap:** S-04's unknown is answered, and its carry-overs point here.
- **`CLAUDE.md`:** the sentence "The stickers state facts only … until FR-012 (S-04) judges a price" becomes the rule.
- **Test plan:** a §6.6 entry, and §6.3's helper note on `lowestPrice30d`.

### Success Criteria:

#### Automated Verification:

- Prettier leaves the edited documents as they are: `npx prettier --check context/foundation/prd.md context/foundation/roadmap.md context/foundation/test-plan.md`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`
- CI's `ci`, `smoke` and `e2e` pass on the PR

#### Manual Verification:

- The owner reviews the PRD, roadmap, `CLAUDE.md` and test-plan updates
- After the deploy, a product in production shows a judgement or the reason there is none, and its sentence names the comparison

**Implementation Note**: After completing each phase and all automated verification passes, pause for manual confirmation where a phase has manual criteria.

---

## Testing Strategy

### Unit Tests:

- `judgementOf` at every boundary in Phase 1.
- `heroOf` and `trackHint` with each outcome.
- `prices.ts`' strict parsing of the history columns.
- `listSummaryText`'s new stale line.

### Integration Tests:

- `check-prices-db.mjs`: the view's history (today, missing and unorderable rows excluded; one date per day), its privacy, and the new bounds.
- The e2e spec on the workerd preview: the good sentence, and the "nothing to compare" sentence.

### Manual Testing Steps:

1. `/dev/product-page`: every judgement state, light and dark.
2. After the deploy: open a product that has a declared low, and one that doesn't.

## Performance Considerations

`price_summaries` adds, per item on the product page, one aggregate over that item's priced rows in 30 days. It uses the new partial index, and it doesn't touch the list's read.

## Migration Notes

The migration is additive: a view, an index and two check constraints. The constraints validate existing rows, and every adapter clamps both values below 100000, so none should fail. If one does, the push stops, and the deploy gate keeps the code from shipping without it.

## Implementation Notes

One line per adaptation, added in the phase's commit (`context/foundation/lessons.md`, "Record every adaptation in the plan in the same commit").

### Phase 1

- **`PriceHistory` lives in `src/types.ts`,** as an interface, and `LatestPrice` carries `history: PriceHistory | null`, so `LatestCheck` does too. `types.ts` can't import from the service without a cycle, and the plan's `PricedRow` doesn't exist.
- **A name clash:** the verdict's private helper `judgementOf` is now `untimedVerdictOf`, and its type `Judgement` is `UntimedVerdict`. The new export keeps the plan's name `judgementOf`.
- **Shared helpers:** `verdictShops` and `lowestOf` moved from `price-comparison-state.ts` into `price-comparison.ts`, and are exported. The state file imports them (lesson "Define shared constants and helpers once").
- **The island keeps a row's `history` through a refetch.** History covers only days before today, so the reducer's `settled` doesn't reset it, and the basis doesn't flip when a shop answers. A test pins it.
- **Defaults:** `history: null` is set wherever a check is built: `toLatestPrice` in `prices.ts`, the test builders and the two kitchen-sink fixture builders. The read itself changes in Phase 2.
- **An `addedAt` that doesn't parse** counts as too recent, so the rule falls back to the shop's low, as the module treats unparseable times elsewhere. A test pins it.
- **The tests go further than the plan's list:** `check()` takes `lowestPrice30d` and `history`, one test pins the two constants, and one case uses a low a hair above 7,49 to show the comparison is in grosze.
- **A row whose history was never read:**
  - A row whose stored price couldn't be read keeps `history: null` after its shop answers, so no history days count for it.
  - Phase 2 gives every readable row an object (`{ low: null, days: [] }` when there's none), so `null` means "not read".
  - Phase 3's shop-basis sentence then leaves out "Historia Twoich cen jest jeszcze za krótka…" when any row's history is `null`, so it never claims a history it didn't read.
- **Breaks run in the commit ritual:**
  - counting equal as good turned 3 tests red;
  - counting history as enough a day early turned the 30-day boundary test red.
  - The implementer's own 9 mutations were all caught.

### Phase 2

- **The view builds on `latest_price_observations`,** naming its 10 columns, and adds a `left join lateral` aggregate. So the latest check is defined once, and F4's later rework of that view reaches this one.
- **The read:** in `prices.ts`, `readLatestRows` takes a view descriptor (`LIST_VIEW` and `PAGE_VIEW`: name, columns, parse) instead of one constant, and `toLatestPrice` takes the history. `[id].astro`, the island's state and `PriceComparison.tsx` are unchanged, since Phase 1's `LatestPrice.history` already reaches the island.
- **A stricter parse than the contract:** a low without days, or days without a low, also makes the row unreadable. This is the file's own "a row in between is odd" rule, and the view never produces either.
- **The database check's placement:**
  - Its last backdate moves the item's checks back by the current Warsaw hour plus 12 h, and each earlier one by another 24 h. So every check lands near noon on its intended day, at any hour and across clock changes.
  - The expected values are computed from the rows' real `observed_at` in Warsaw.
  - The check now needs the local database container (through `backdateChecks`, `scripts/e2e-local-db.mjs`) and a local `SUPABASE_URL` in `.env` and `.dev.vars`. CI writes both before the step, and Phase 4 documents it.
- **Database checks beyond the contract:**
  - anon gets 42501 on `price_summaries`;
  - a regular price and a 30-day low of 99999.99 are accepted;
  - the new view's latest columns equal `latest_price_observations`' for the item.
- **Names:** `price_observations_regular_price_bounded`, `price_observations_lowest_price_30d_bounded` and `price_observations_priced_item_observed_at_idx`. `PRICE_LIMITS`' comment now says the database bounds all three amounts, and names both migrations.
- **Left with F4's leftovers:** filtering the product page's read by `shop_id`, which this change doesn't need.
- **The gates:**
  - They ran on the worktree with Phase 3's files in progress beside Phase 2's, and all were green: lint, `astro check`, 2316 unit tests. Phase 2's files depend on nothing of Phase 3's.
  - Breaking the history parse, by accepting any `history_days`, turned 3 tests red.
- **Not checked here:** the SQL and the database check can't run here (no Docker). CI's `smoke` job is their first run, as 2.2 says.

## References

- Research: `context/changes/good-price-judgement/research.md`
- The design: `context/archive/2026-09-30-etykiety-redesign/handoff/README.md:107-120`
- The queued follow-ups: `context/archive/2026-09-28-cheapest-shop-today/follow-ups/review-fixes.md:5-20`
- The PRD: FR-012, "Business Logic", Open Question 4 (`context/foundation/prd.md:132-134`, `:163-167`, `:203`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The rule

#### Automated

- [x] 1.1 The rule's tests pass — 22eeff2
- [x] 1.2 Lint, type check and the whole unit suite pass — 22eeff2

### Phase 2: History in the database

#### Automated

- [ ] 2.1 Lint, type check and the whole unit suite pass, `prices.ts`' parsing tests included
- [ ] 2.2 CI's `smoke` job passes, `check-prices-db.mjs`' history and bound cases included

#### Manual

- [ ] 2.3 The owner's `db push` lands the migration, and `migration list --linked` shows its remote version

### Phase 3: The product page

#### Automated

- [ ] 3.1 Lint, type check and the whole unit suite pass
- [ ] 3.2 The contrast check passes with the new token
- [ ] 3.3 CI's `e2e` job passes, `good-price.spec.ts` included

#### Manual

- [ ] 3.4 `/dev/product-page` shows every judgement state and both new stickers, in light and dark

### Phase 4: The list's screen-reader line, docs and rollout

#### Automated

- [ ] 4.1 Prettier leaves the edited documents as they are
- [ ] 4.2 Lint, type check and the whole unit suite pass
- [ ] 4.3 CI's `ci`, `smoke` and `e2e` pass on the PR

#### Manual

- [ ] 4.4 The owner reviews the PRD, roadmap, CLAUDE.md and test-plan updates
- [ ] 4.5 After the deploy, a product in production shows a judgement or the reason there is none
