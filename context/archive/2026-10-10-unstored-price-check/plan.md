# Say when a refreshed price couldn't be saved (TD-02, audit P6) Implementation Plan

## Overview

The product page's island refetches a shop's price through `POST /api/watchlist/prices`. When the route fetched the price but couldn't store its price observation, it answers `saved: false`, and the island shows the price exactly as if it were stored. This change makes the island read that flag: the card keeps the fetched price and adds one line, which the screen-reader announcement carries too.

It carries out the owner's two calls of 2026-10-10:

- **Option A:** the island keeps the fetched price, and its card adds one line, which the announcement carries too.
- **The line:** „Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”

Planning: the complexity is LOW, and the owner's two calls settle every material decision, so the plan asked no further question (the skill's settled-input case). The evidence is in `context/changes/unstored-price-check/research.md`.

## Current State Analysis

From the research, re-verified at `5eefce2`:

- **The route answers `saved`** (`src/pages/api/watchlist/prices.ts:16-26`, `:71-74`). For a price or a missing check it is false exactly when that shop's one insert failed (`src/lib/services/prices.ts:56-73`, `:89-97`).
- **The island drops it.** The parser requires it and passes it on (`src/components/watchlist/price-comparison-state.ts:901-909`), and then `settled` (`:234-265`) and `announcement` (`:203-226`) treat a stored and an unstored answer alike.
- **So an unstored price looks stored:**
  - „cena online · przed chwilą” (`src/components/watchlist/ShopCard.tsx:112`), and „Najtaniej” when it wins (`:79-82`);
  - the announcement (`price-comparison-state.ts:214-216`) and the hero;
  - from lg, the selected list row's tag (`src/components/watchlist/PriceComparison.tsx:117-120`).
- **Afterwards,** the list and the next view show the older stored check, and the next view on own navigation asks the shop again when that check is more than 15 minutes old (`src/lib/services/price-comparison.ts:121-138`).
- **The form path already reports it,** as „Nie wszystkie ceny udało się odświeżyć…” (`src/lib/services/price-refresh.ts:148`; `src/lib/notices.ts:323-326`), and stays as it is.
- **No existing text says "fetched but not saved"** for a price check (research, "Existing states and texts").

## Desired End State

- **After a refetch whose price the route couldn't store,** the shop's card shows:
  - the fetched price with „cena online · przed chwilą” and the marks a stored price would get („Najtaniej” when it wins);
  - under the card's other warning lines, „Nie udało się zapisać tej ceny, więc lista jej nie pokaże.” in the warning colour.
- **Screen readers hear** „Natura: 16,99 zł, najtaniej. Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”
- **The line stays while that price is on the card:** while the shop is asked again, after an answer without a price (beside its notice), and after a missing answer, which keeps the price. It goes when the shop's next price is stored, or on reload, when the page shows the stored check.
- **A stored answer looks exactly as today.**
- **How to verify:** the unit tests of both phases, and the two new states of `/dev/product-page`.

### Key Discoveries:

- **One reducer holds the flag's whole life:** `initialState` (`price-comparison-state.ts:132-159`), `start` (`:166-177`) and `settled` (`:234-265`). `announcement` reads the rows `settled` made (`:179-180`, `:203-226`).
- **The price's message has no final period** (`:216`), while every other announced text ends with one (`src/lib/shop-messages.ts:39-69`; `price-comparison-state.ts:219`, `:221`).
- **`ShopCard` draws both kinds of price card:** the own shop's card, and a matched shop's price card inside `MatchCard` (`src/components/watchlist/PriceComparisonView.tsx:172`; `src/components/watchlist/MatchCard.tsx:53-57`). Its warning lines are at `ShopCard.tsx:116-123`.
- **`PRICES_EVENT` carries a narrow shape:** `rowShopsOfIsland` sends each row's shop, latest check and read state only (`price-comparison-state.ts:367-375`), pinned by `price-comparison-state.test.ts:1660-1670`.
- **The sentence's home is island-safe:** `src/lib/shop-messages.ts` is in `islandConfig` (`eslint.config.js:99`), and the card and the reducer already import from it (`ShopCard.tsx:9`; `price-comparison-state.ts:26`).
- **The state tests have the helpers the new cases need:** `priceAnswer`, `run`, `rowOf` and `marks` (`price-comparison-state.test.ts:116-130`), `said` (`:490`), and `CHECKED_AT` and `ANSWERED_AT` (`:56-57`).
- **The route tests can fail the insert:**
  - their world takes a relation given as an error, and the stand-in database answers the insert with it (`src/lib/services/price-routes.test.ts:166-176`; `src/lib/services/testing/stub-supabase.ts:6`, `:145-147`);
  - the clock is faked to `NOW`, and the warn spy silences the insert's log line (`price-routes.test.ts:231-236`).
- **A card renders in Node:**
  - `ShopCard` keeps no state (`ShopCard.tsx:57-62`);
  - `react-dom/server` exports `renderToStaticMarkup` in Node;
  - Vite 8's oxc transform compiles an imported `.tsx` by `tsconfig.json`'s `"jsx": "react-jsx"`;
  - the suite includes only `src/**/*.test.ts` (`vitest.config.ts:11`), so the test uses `createElement`.
- **The kitchen sink needs only data:** its price states are built through the reducer by `island(...)` (`src/dev/fixtures.ts:192-194`), listed in `PRICE_STATES` (`:410`), and rendered by `src/dev/product-page.astro:82` with no code per state. No file builds a `ShopRow` by hand, so the new field reaches every row through `initialState`.

## What We're NOT Doing

- **A line for an unstored missing answer after a stored price.**
  - The owner's sentence names a price („tej ceny … jej”). In that case the card keeps a stored price, which the list does show, so the sentence would be false.
  - That card keeps today's display: the stored price, „Nieaktualna” and the missing text.
  - If the owner wants that case told, it needs a sentence of its own (research, finding 1).
- **Withholding „Najtaniej” from an unstored price, or keeping the selected row's tag on the stored check.** Option A keeps both as they are, and the owner chose A. From lg, the selected row beside the product follows the unstored price, an edge the test plan accepts (`context/foundation/test-plan.md:412`).
- **The hero, the price track, the caption, the phone's bar and the verdict.** They keep counting the fetched price, as today.
- **The route, the wire contract, the database and the form path.** `saved` is already sent and parsed, and the form's notices already cover a failed insert.
- **Logging the failed insert at error level with the shop and the row count.** That is P6's other half, and the audit's fix order item 1. The warn line stays (`prices.ts:94`, `:411-414`).
- **A database test of the app's own insert (TD-18),** which would stop an insert drift before production.
- **Any new shop request.** Nothing is retried after an unstored answer. The next view's refetch of a check more than 15 minutes old stays as it is.
- **An e2e spec.** e2e can't produce `saved: false`: every shop is stopped, so a refetch gets only the stopped notice (`test-plan.md:175`), and no spec stubs a route. The unit tests and the kitchen sink cover the line.
- **`CLAUDE.md`.** The research places no rule there, and no sentence of its UI paragraph (`CLAUDE.md:58`) becomes untrue.
- **Colours.** The line reuses the card's warning text, so no token or contrast pair changes, and `scripts/check-token-contrast.mjs` needs no run beyond CI's.
- **The lookup's first price** (`src/lib/services/shop-matching.ts:390-393`). When its insert fails, the island refetches the item, and the line shows if that insert fails too.

## Implementation Approach

- **Phase 1, the rule.** The island's reducer remembers on each row whether the price it shows was stored, and the announcement says so. The sentence joins `shop-messages.ts`. All of it is tested in Node, test-first, and a route test pins the server's half of the contract.
- **Phase 2, the view.** The card shows the line, a Node render of the card pins it, and the kitchen sink shows the new states.
- **Cost:** no shop request, no migration, no recording (Performance Considerations).

## Critical Implementation Details

- **State sequencing.** The flag describes the price the row shows, not the last attempt.
  - A `price` answer sets it from `saved`.
  - Every other answer keeps it, since the card still shows that price: a `missing` answer keeps the offer (`price-comparison-state.ts:253`), an `unavailable` one the whole check (`:255-260`), and `session-ended` and `match-changed` the whole row (`:261-263`).
  - `start` keeps it too, unlike `notice` (`:169-174`).
  - Clearing it on `start`, as the options analysis proposed, would drop the line while the unstored price stays on the card, and for good after a refetch that gets no answer.
- **The announcement's join.** The price's message has no final period (`:216`), so it takes one before the sentence: „Natura: 16,99 zł, najtaniej. Nie udało się zapisać tej ceny, więc lista jej nie pokaże.” The missing and unavailable messages already end with one (`shop-messages.ts:39-69`), so a space joins them.

## Phase 1: The island reads `saved`

### Overview

The reducer flags a row whose price the route couldn't store and keeps the flag while that price is on the card. The announcement ends with the owner's sentence while the flag is set. The sentence lives in `shop-messages.ts`.

### Changes Required:

#### 1. The sentence

**File**: `src/lib/shop-messages.ts`

**Intent**: The owner's line, in the module whose texts the card and the live region already share, and which the island may import.

**Contract**:

- An exported constant holding the owner's words exactly:

```ts
export const PRICE_UNSAVED_TEXT = "Nie udało się zapisać tej ceny, więc lista jej nie pokaże.";
```

- The module's header comment (`:3-4`) widens from shops that couldn't be asked to a price the app couldn't store too.

#### 2. The row's flag and the announcement

**File**: `src/components/watchlist/price-comparison-state.ts`

**Intent**: Read the `saved` flag the island already parses, so a price the route couldn't store is told on its card and aloud.

**Contract**:

- **`ShopRow` gains `unsaved: boolean`:** the price the row shows came from an answer the route couldn't store, so the list and the next view don't have it. Its doc comment says so, and so do the interface's comment (`:58-61`) and the module's header (`:29-35`).
- **`initialState`:** every row starts with `unsaved: false`.
- **`settled`:** a `price` answer sets `unsaved` to `!result.saved`. `missing`, `unavailable`, `session-ended` and `match-changed` keep the row's value, and so does `start`. The function's comment (`:228-233`) names both.
- **`announcement`:** when the row the answer leaves is `unsaved`, the message ends with `PRICE_UNSAVED_TEXT`, joined as "Critical Implementation Details" says. An answer that announces nothing (`session-ended`, `match-changed`) still announces nothing. The function's comment (`:197-202`) says so.
- **Unchanged:** `compareRows` and the marks, the verdict, the hero, the track, the caption and the phone's bar, `rowShopsOfIsland` (the flag stays out of `PRICES_EVENT`), the request and the parser.

#### 3. Tests

**File**: `src/components/watchlist/price-comparison-state.test.ts`, `src/lib/shop-messages.test.ts`, `src/lib/services/price-routes.test.ts`

**Intent**: Pin the flag's life, the sentence and the route's half of the contract, with expected values written from the owner's calls, not read off the code.

**Contract**:

- **State tests,** in a new `describe("a price the route couldn't store")`. They start from `[rossmann(), natura()]`, Rossmann's stored 26,99 zł and Natura's 29,99 zł, unless said otherwise. „The sentence” is the owner's line.
  1. **An unstored price.** Natura answers 16,99 zł with `saved: false`.
     - Its row `toMatchObject({ pending: false, notice: null, readFailed: false, unsaved: true, latest: { lastCheckedAt: CHECKED_AT, lastStatus: "price", offer: { price: 16.99, pricedAt: CHECKED_AT } } })`.
     - `marks` is `[["natura", true], ["rossmann", false]]`.
     - The announcements are `[said("Natura: 16,99 zł, najtaniej. Nie udało się zapisać tej ceny, więc lista jej nie pokaże.")]`.
  2. **A stored price.** The same answer with `saved: true` leaves `unsaved: false` and announces `said("Natura: 16,99 zł, najtaniej")` alone.
  3. **A refetch that gets no answer.** After case 1, `start("natura")` keeps `unsaved: true`. An `unavailable` answer with reason `failed` then keeps it, with the notice beside it and the unstored price as `latest`. It announces „Nie udało się pobrać ceny ze sklepu Natura. Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”
  4. **A missing answer keeps the price, and the flag.** After case 1, a stored `missing` answer keeps `unsaved: true`, with `lastStatus: "missing"` and the unstored offer. It announces „Natura: Sklep nie zwraca już tego produktu. Cena może być nieaktualna. Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”
  5. **The next stored price clears it.** After case 1, a price answer with `saved: true` sets `unsaved: false`, and its announcement has no sentence.
  6. **An unstored missing answer after a stored price shows no line.** From Natura's stored 16,99 zł, a `missing` answer with `saved: false` leaves `unsaved: false` and announces the missing text alone ("What We're NOT Doing").
  7. **A row whose stored price couldn't be read.** From `{ ...natura(null), readFailed: true }`, a price answer with `saved: false` ends with `readFailed: false`, `unsaved: true` and `latest.history` `null`.
  8. **The selected row's tag follows the unstored price.** After case 1, `rowTagOf(rowShopsOfIsland(state.rows), ANSWERED_AT)` is Natura's 16,99 zł with „Natura · przed chwilą”, as `test-plan.md:412` accepts.
- **The first state test** (`:133-148`) also maps `unsaved`, and expects `false` on every row.
- **`shop-messages.test.ts`:** `PRICE_UNSAVED_TEXT` equals the literal „Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”
- **`price-routes.test.ts`,** in the `/api/watchlist/prices` describe: a failed insert answers `saved: false`, after one reservation and one request.
  - Setup: `world({ ...PRODUCT_RELATIONS, price_observations: { error: { code: "42501", message: "new row violates row-level security policy" } } }, Object.values(RECORDINGS))`, with `SOFT_REQUEST`.
  - Expected: status 200, and the body `toMatchObject({ kind: "price", offer: { price: 16.99, regularPrice: 22.99, lowestPrice30d: 17.99 }, checkedAt: NOW, saved: false })`.
  - Expected: `reservations(queries)` is `[{ p_shop_id: "natura" }]`, and `served()` is `[naturaPriceUrl(["NV89063"])]`.

### Success Criteria:

#### Automated Verification:

- The state, sentence and route tests pass: `npx vitest run src/components/watchlist/price-comparison-state.test.ts src/lib/shop-messages.test.ts src/lib/services/price-routes.test.ts`
- The whole unit suite passes: `npm run test`
- Lint passes: `npm run lint`
- Types check: `npx astro sync && npx astro check`

---

## Phase 2: The card shows the line

### Overview

The shop's card shows the sentence while its row is `unsaved`. A Node render of the card pins it, and the kitchen sink shows the new states.

### Changes Required:

#### 1. The card

**File**: `src/components/watchlist/ShopCard.tsx`

**Intent**: Show the line on the card of the shop whose price wasn't stored: the own shop's card, and a matched shop's price card, which renders `ShopCard`.

**Contract**:

- While `row.unsaved`, one `<p>` with `PRICE_UNSAVED_TEXT`, after the missing line and the notice line (`:116-123`) and before „Zobacz w sklepie”.
- It is styled as those lines (`text-warning-foreground text-sm`), with no new token or class.
- The component's comment (`:57-62`) lists it.

#### 2. The card's test

**File**: `src/components/watchlist/ShopCard.test.ts` (new)

**Intent**: Pin the line on the rendered card, which e2e can't reach, with no DOM and no new dependency.

**Contract**:

- It renders `ShopCard` with `renderToStaticMarkup` from `react-dom/server` and `createElement`, since the suite runs only `.test.ts` files.
- Natura's compared row comes through the reducer: `initialState` with Rossmann's and Natura's stored prices, `start("natura")`, `done("natura", { kind: "price", offer, checkedAt, saved }, at)`, then `comparisonOf(state).rows`.
- With `saved: false`, the markup contains `PRICE_UNSAVED_TEXT` exactly once, and „Najtaniej”. With `saved: true`, it doesn't contain the sentence.
- Its header comment says it is the repository's first test that renders a component, and why: e2e can't produce `saved: false` (TD-19).

#### 3. The kitchen sink

**File**: `src/dev/fixtures.ts`

**Intent**: Show the new states beside the others, since the kitchen sinks show every state of their views (`CLAUDE.md:58`).

**Contract**: two entries in `PRICE_STATES` (`:410`), each built through the reducer with `island(...)` from `CHECKED`, with a Polish `text` like the others:

- `unsaved`: Natura was refetched and answered a lower price with `saved: false`, so its card has „Najtaniej” and the line.
- `unsaved-then-failed`: the same, then Natura's next refetch got no answer (`unavailable`, `failed`), so the failed-fetch notice and the line stand under the unstored price.

### Success Criteria:

#### Automated Verification:

- The card's test passes: `npx vitest run src/components/watchlist/ShopCard.test.ts`
- The whole unit suite passes: `npm run test`
- Lint passes, the kitchen sink's fixtures included: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- The production build passes: `npm run build`
- CI's `ci`, `smoke` and `e2e` jobs pass on the pull request (e2e runs in CI only: Docker isn't available locally)

#### Manual Verification:

- `/dev/product-page` shows both new states in light and dark, at 390 and 1280 px: Natura's card with its price, „cena online · przed chwilą”, „Najtaniej” and the line in the warning colour, and in the second state the failed-fetch notice above the line. Start `astro dev` after the checks above, since `astro sync` rewrites Vite's dependency cache (`CLAUDE.md`, "Commands").

**Implementation Note**: After completing each phase and all automated verification passes, pause for manual confirmation where a phase has manual criteria. Phase blocks use plain bullets; the checkboxes live in `## Progress`.

---

## Testing Strategy

### Unit Tests:

- **The reducer:**
  - the flag set by an unstored price;
  - kept through `start`, an answer without a price and a missing answer;
  - cleared by the next stored price;
  - left off by an unstored missing answer after a stored price;
  - set on a row whose stored price couldn't be read;
  - the announcement's sentence and its join;
  - the selected row's tag following the unstored price.
- **The sentence's literal.**
- **The card's line,** rendered in Node.

### Integration Tests:

- **The price route,** with the real gate and the stand-in database: a failed insert answers `saved: false` and `checkedAt`, after one reservation and one request. Today only `saved: true` is asserted (`price-routes.test.ts:307-311`, `:395`).

### Manual Testing Steps:

1. `/dev/product-page`: the `unsaved` and `unsaved-then-failed` states, in light and dark, at 390 and 1280 px.
2. Nothing to check in production: the line appears only when an insert fails.

## Performance Considerations

- One boolean per row, and no extra render, read or request.
- **Shop requests per view and action** (lesson "Bound what each page view and action costs every shop"): this change adds none. It reads a flag the route already sends, asks nothing again after an unstored answer, and its line promises no refetch.

| View or action               | Shop requests                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A product, own navigation    | as today: one refetch per shop last checked more than 15 minutes ago, and the lookups of undecided matched shops    |
| A product from another site  | 0, as today                                                                                                         |
| The product's „Odśwież ceny” | one refetch per priced shop of the product, as today                                                                |
| The list's „Odśwież ceny”    | as today                                                                                                            |
| After an unstored answer     | 0 more; the next view on own navigation asks again only when the stored check is more than 15 minutes old, as today |
| `/dev/product-page`          | 0                                                                                                                   |

## Migration Notes

None. There is no migration, and the wire contract doesn't change, so the code deploys in any order.

## Implementation Notes

One line per adaptation, added in the phase's commit (`context/foundation/lessons.md`, "Record every adaptation in the plan in the same commit").

### Phase 1

- **The base moved to `bd0f2c6`.** S-01 (#47) and the README (#49) merged after this plan was written on `5eefce2`. No file this phase touches changed between them except `price-routes.test.ts`, whose helpers moved to `src/lib/services/testing/route-context.ts` and `stored-rows.ts`: `world` is now at `:121-131` and the clock and the warn spy at `:170-175`. The new route case follows the stored-price case.
- **`said` moved to module scope.** The state test's `said` was local to the describe for what screen readers hear; it moved, unchanged, beside `marks`, so the new describe can use it.
- **`priceAnswer` takes `saved`.** The state test's answer builder takes an optional `saved = true`, so the new cases can build an unstored answer; existing calls are unchanged.
- **The announcement joins through `withUnsavedText`.** A private helper adds a period only when the text has none, then the sentence: „Natura: 16,99 zł, najtaniej. Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”
- **`start`'s comment only.** The reducer's `start` already spreads the row, so it keeps `unsaved`. Its comment now says the row keeps its price and whether it was stored.

### Phase 2

- **The kitchen sink reaches the unstored answer through „Odśwież ceny”.** `CHECKED`'s prices are under 15 minutes old, so opening the page refetches neither shop. Both new states tap the button (`REFETCH`, both shops), and `unsaved-then-failed` taps it twice. Natura's unstored answer is its promotion at 19,99 zł (`NATURA_UNSAVED`), beside Rossmann's stored `ROSSMANN_ANSWER`, and both states follow `notice-stopped-failed` in `PRICE_STATES`.
- **`PRICE_UNSAVED_TEXT`'s comment names the card.** Phase 1's open point: `shop-messages.ts` now says the page shows the sentence on the shop's card and reads it with the shop's answer.
- **The card test builds its own stored rows** (`SHOPS`, `stored()`), since the state test's helpers are private to that file. It also asserts „Najtaniej” on the stored card, one assertion beyond the plan's list, so it shows both cards keep the same mark.
- **The line takes the card's notice style.** `text-warning-foreground text-sm`, as the missing price's line has it (`ShopCard.tsx:118`); the contrast check already covers warning-foreground on card.
- **The kitchen sink's legend stays.** `src/dev/product-page.astro`'s „Macierz 7 stanów” doesn't name the two new states; the plan named only `fixtures.ts`.

### Review fixes (2026-10-10)

The implementation review (`reviews/impl-review.md`) found 6 observations, and the owner took every recommendation.

- **F1, what screen readers hear (Fix A):** while a row's price is unsaved, only an answer whose text names that price, a price answer or a missing answer, adds the owner's sentence aloud. After an answer without a price, screen readers hear the notice alone, since „tej ceny” would have no price to mean there, and the card keeps the line. State case 3 now expects „Nie udało się pobrać ceny ze sklepu Natura.” alone.
- **F2, the flag's name:** the row's flag is `priceUnsaved`, so it no longer shares `unsaved` with a lookup's outcome or match the page couldn't store, and the kitchen sink's two states are `price-unsaved` and `price-unsaved-then-failed`.
- **F3:** a state case gives an unstored price's row an ended session and a changed match: each keeps `priceUnsaved` and says nothing aloud.
- **F4, shared code** (lesson "Define shared constants and helpers once"): `withUnsavedText` ends the answer's text with `sentence()`, which `watchlist-rows.ts` now exports; the island's Nivea Soft rows and clock moved from the state test to `src/lib/services/testing/island-shops.ts`, which the card test imports too, in place of its own `SHOPS` and `stored()`; and the kitchen sink's `match-changed` and `good-after-failed-read` states use `ROSSMANN_ANSWER`.
- **F5, accepted:** a price called unsaved that a timed-out insert stored after all (audit W6) is an accepted edge in `context/foundation/test-plan.md` §7.
- **F6, the documents:** the kitchen sink's legend names both new states among the cards' messages; the test plan's §6.1 describes a test of a component's markup, with `ShopCard.test.ts` as its reference; the card test cites the refresh flow analysis's TD-19 with its path, on `main` since PR #48; and the two test comments cite this plan at its archive path, `context/archive/2026-10-10-unstored-price-check/plan.md`, which resolves once the change is archived. The References below now point at the analysis on `main` and at the accepted edge's current lines.

## References

- Research: `context/changes/unstored-price-check/research.md`
- The flow analysis: `context/changes/price-refresh-flow-analysis/research.md:438-444` (TD-02) and `:571-577` (TD-19), on `main` since PR #48
- The audit: `context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:97` (P6) and `:165` (fix order item 8)
- The accepted edge: `context/foundation/test-plan.md:412-414`
- The answer's origin: `context/archive/2026-09-28-cheapest-shop-today/plan.md:494-497`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The island reads `saved`

#### Automated

- [x] 1.1 The state, sentence and route tests pass — 1f147dc
- [x] 1.2 The whole unit suite passes — 1f147dc
- [x] 1.3 Lint passes — 1f147dc
- [x] 1.4 Types check — 1f147dc

### Phase 2: The card shows the line

#### Automated

- [x] 2.1 The card's test passes — d72e415
- [x] 2.2 The whole unit suite passes — d72e415
- [x] 2.3 Lint passes, the kitchen sink's fixtures included — d72e415
- [x] 2.4 Types check — d72e415
- [x] 2.5 The production build passes — d72e415
- [x] 2.6 CI's `ci`, `smoke` and `e2e` jobs pass on the pull request — d72e415

#### Manual

- [x] 2.7 `/dev/product-page` shows both new states in light and dark, at 390 and 1280 px — checked in the browser (Playwright) at 390 px and the 2-column desktop layout (1400 px), light and dark, 2026-10-10
