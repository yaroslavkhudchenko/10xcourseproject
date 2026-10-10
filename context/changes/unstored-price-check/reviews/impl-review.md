<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Say when a refreshed price couldn't be saved (TD-02, audit P6)

- **Plan**: `context/changes/unstored-price-check/plan.md`
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**Plan adherence:** every planned item matches the code on `bd0f2c6..b4dc36d`:

- the sentence (`shop-messages.ts:75`), the row's flag and its life (`price-comparison-state.ts:76-81`, `:158`, `:269`), the announcement's join (`:244-249`), the card's line (`ShopCard.tsx:125`), the card's render test and the two kitchen-sink states;
- the eight state cases, the sentence's literal and the route's `saved: false` case carry the plan's expected values;
- each Implementation Note matches the code. The one addition beyond the plan, „Najtaniej” asserted on the stored card too, is recorded there.

**Success criteria:** the automated commands pass at `b4dc36d`.

| Rows     | Check                               | Result                                               |
| -------- | ----------------------------------- | ---------------------------------------------------- |
| 1.1      | The state, sentence and route tests | 3 files, 189 pass                                    |
| 2.1      | The card's test                     | 1 file, 2 pass                                       |
| 1.2, 2.2 | `npm run test`                      | 43 files, 2,909 pass                                 |
| 1.3, 2.3 | `npm run lint`                      | Clean                                                |
| 1.4, 2.4 | `npx astro check`                   | 198 files: 0 errors, 0 warnings, 0 hints             |
| 2.5      | `npm run build`                     | Not re-run here; CI's `ci` job builds, green         |
| 2.6      | CI on PR #51                        | `ci`, `smoke` and `e2e` green on the head, `b4dc36d` |

The manual row 2.7 is ticked with its method and date, and the two states it checked are in the diff (`src/dev/fixtures.ts:525-554`). It was checked at 1400 px rather than 1280 px, which gives the same `xl` layout.

**Guardrails held:**

- no shop request, migration, recording or new dependency;
- the route, the wire contract, the database and the form path untouched;
- the marks, the verdict, the hero, the track, the caption and the phone's bar unchanged, as option A keeps them;
- `PRICES_EVENT` keeps its shape: `rowShopsOfIsland` reads only each row's shop, latest check and read state, and `price-comparison-state.test.ts:1776` pins it with `toEqual`;
- the line stands only beside a price: only a price answer sets the flag, together with its offer, and a missing answer keeps that offer.

## Findings

### F1 — After a failed or stopped refetch, the announcement's „tej ceny” has no price to point to

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/watchlist/price-comparison-state.ts:231-232`, expected at `src/components/watchlist/price-comparison-state.test.ts:659`
- **Detail**: while a row is `unsaved`, every answer's announcement ends with the owner's sentence (`withUnsavedText`).
  - After a busy or paused answer the sentence follows „Pokazujemy ostatnią znaną cenę.”, and after a missing answer „Cena może być nieaktualna.”, so „tej ceny” is the price on the card.
  - After a failed answer, screen readers hear „Nie udało się pobrać ceny ze sklepu Natura. Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”, where „tej ceny” reads as the price that couldn't be fetched. After a stopped answer („Odświeżanie cen w sklepie Natura jest wyłączone, bo sklep zablokował zapytania.”), no single price comes before it.
  - On the card the line stands under the price, so it's clear there. The owner's call says the announcement carries the line; repeating it with every later answer is the plan's reading (Critical Implementation Details, state case 3).
- **Fix A ⭐ Recommended**: say the sentence only with the answers whose text names the price, a price answer and a missing answer. After an answer without a price, the card keeps the line and the announcement says the notice alone.
  - Strength: every spoken „tej ceny” follows its price, and the card still shows the line for as long as the price stays.
  - Tradeoff: a screen-reader user who missed the first announcement isn't reminded at the next refetch, and case 3's expected text changes.
  - Confidence: MEDIUM — the wording is the owner's to judge; the code change is one condition in `announcement`.
  - Blind spot: no screen-reader user has heard the live region.
- **Fix B**: keep it, so the live region says what the card shows, and record the plan's reading as the owner's call.
  - Strength: no code change, and the announcement mirrors the card's lines one for one.
  - Tradeoff: the failed and stopped announcements stay ambiguous.
  - Confidence: HIGH — it's today's tested behaviour.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — only a price answer and a missing answer add the sentence aloud; after an answer without a price, screen readers hear the notice alone and the card keeps the line (the owner's call, 2026-10-10), with state case 3 updated

### F2 — `unsaved` now names two different failures in one card

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/watchlist/price-comparison-state.ts:76-81`, beside `src/components/watchlist/MatchCard.tsx:53-57` and `:96`; `src/dev/fixtures.ts:526`, `:539`
- **Detail**: before this change, `unsaved` meant a lookup's outcome or match the page couldn't store (`shop-matching.ts:276-285`, `match-view.ts:95`, `match-card.ts:40`, the kitchen sink's `matched + unsaved` and `not-found + unsaved`). `ShopRow.unsaved` now means a price observation the route couldn't store.
  - Both reach `MatchCard`, which wraps `ShopCard` (reading `row.unsaved`) around a footer reading `card.unsaved`.
  - The new area states `unsaved` and `unsaved-then-failed` sit beside Natura's `matched + unsaved`.
  - The two can't both be true on one card today, since a match the page couldn't store has no price row, so the risk is a later edit reading one for the other. The glossary has a term for neither.
- **Fix**: rename the row's flag after the price, for example `priceUnsaved`, and the two area states to match (`price-unsaved`, `price-unsaved-then-failed`).
- **Decision**: FIXED — the row's flag is `priceUnsaved`, and the kitchen sink's states are `price-unsaved` and `price-unsaved-then-failed`

### F3 — The flag's life through an ended session and a changed match isn't covered

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/watchlist/price-comparison-state.test.ts:614-717`
- **Detail**: the plan's contract says `session-ended` and `match-changed` keep the row's `unsaved` and still announce nothing (Phase 1, "The row's flag and the announcement"). The code does both: `settled` returns the row as it was (`price-comparison-state.ts:287-289`), and `announcement` returns null before the sentence (`:233-235`). But none of the eight cases gives either answer to an unsaved row, so a refactor could break it unseen.
- **Fix**: add one case after `unstored()`: an ended session and a changed match each keep `unsaved: true` and add no announcement.
- **Decision**: FIXED — a state case gives an unstored price's row an ended session and a changed match; each keeps `priceUnsaved` and adds no announcement

### F4 — Copies of an existing helper and of the state test's fixtures

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/watchlist/price-comparison-state.ts:244-249`; `src/components/watchlist/ShopCard.test.ts:25-65`; `src/dev/fixtures.ts:573`, `:764`
- **Detail**: lesson "Define shared constants and helpers once".
  - `withUnsavedText`'s full stop is `sentence()` in `src/lib/services/watchlist-rows.ts:265-267` ("with its full stop, once"). That helper is private, though the state module already imports the island-safe `watchlist-rows.ts` (`:25`).
  - `ShopCard.test.ts` re-declares the state test's clock constants, `offer()`, `stored()` and its Nivea Soft rows for Rossmann and Natura, with the same values (`price-comparison-state.test.ts:54-96`). The Phase 2 notes record the copy, since those helpers are private to that file. Helpers that several tests share live in `src/lib/services/testing/` (`stored-rows.ts`), where the shop-answer-contracts review moved such copies (`context/archive/2026-10-07-testing-shop-answer-contracts/reviews/impl-review.md`, F7).
  - The kitchen sink's new `ROSSMANN_ANSWER` (`fixtures.ts:192`) is the same literal that `:573` and `:764` still write out.
- **Fix**: export `sentence` and build the line with it; move the island's row builders into a shared testing module that both tests import; use `ROSSMANN_ANSWER` at `:573` and `:764`.
- **Decision**: FIXED — `withUnsavedText` uses `sentence()`, now exported by `watchlist-rows.ts`; the island's rows and clock live in `src/lib/services/testing/island-shops.ts`, which both tests import; `ROSSMANN_ANSWER` replaces both literals

### F5 — A timed-out insert that still committed makes the line a false alarm

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/prices.ts:92`, shown by `src/components/watchlist/ShopCard.tsx:125`
- **Detail**: `saved: false` means the insert wasn't confirmed, not that nothing was stored. The insert gives up after 2 seconds, and an aborted write may still commit (audit W6). The card then says „Nie udało się zapisać tej ceny, więc lista jej nie pokaże.” while the list shows that price. It's rare and harmless to data. The plan brief lists it among its open risks and research finding 4 explains it, but neither the plan nor the test plan's accepted edges (§7) record it as accepted.
- **Fix**: once the owner accepts it, add it to the test plan's §7 edges with a trigger to re-evaluate, such as a report of the line under a price the list shows.
- **Decision**: ACCEPTED — recorded in `context/foundation/test-plan.md` §7 as an accepted edge (the owner's call, 2026-10-10)

### F6 — The kitchen sink's legend, the test cookbook and three comments lag the change

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/dev/product-page.astro:262-263`; `context/foundation/test-plan.md:108-113`; `src/components/watchlist/ShopCard.test.ts:19-20`; `src/components/watchlist/price-comparison-state.test.ts:611`
- **Detail**:
  - The legend „Macierz 7 stanów” says where each card message shows („Komunikaty kart: … `notice-busy-paused` i `notice-stopped-failed`”), but not `unsaved` or `unsaved-then-failed`. The Phase 2 notes leave it because the plan named only `fixtures.ts`, while `CLAUDE.md` asks the kitchen sinks to change with the views.
  - `ShopCard.test.ts` is the repository's first component render test, but the cookbook's "Adding a unit test" (§6.1) doesn't describe the technique, `react-dom/server` and `createElement` in a `.test.ts` with no DOM, so the next such test starts from scratch.
  - Its header cites "the refresh flow analysis's TD-19", which exists only on another branch, not on `main`; the comment's own words already give the reason.
  - Both new test comments cite `context/changes/unstored-price-check/plan.md`, which the archive moves. Six older comments still cite the archived `context/changes/etykiety-redesign/`, so such paths go stale.
- **Fix**: add both codes to the legend's card messages, add a §6.1 bullet naming `ShopCard.test.ts` as the reference, drop the TD-19 id, and point the two citations at the archived plan in the archive commit.
- **Decision**: FIXED — the legend names both states; §6.1 has a bullet for a component's markup; TD-19 is kept and cited with its path, since PR #48 put the analysis on `main`; the two test comments cite the plan's archive path, which resolves once the change is archived; and the plan's References point at the analysis on `main` and the edge's current lines
