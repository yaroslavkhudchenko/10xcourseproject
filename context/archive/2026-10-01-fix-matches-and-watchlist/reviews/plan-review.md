<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Fix a wrong match and remove a product (S-08)

- **Plan**: `context/changes/fix-matches-and-watchlist/plan.md`
- **Mode**: Deep
- **Date**: 2026-10-01
- **Verdict**: REVISE, then SOUND after triage (all six findings fixed in the plan)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

32/32 paths ✓ (the 2 new files absent, as planned), 26/26 symbols ✓, Progress 55/55 rows ✓, brief↔plan ✓. No `docs/reference/contract-surfaces.md`, so the contract-surface check was skipped. One verification agent checked the riskiest claims and the blast radius. It confirmed the supabase-js 2.116.0 delete chain (`delete().eq().select()` asks for `return=representation`), the replay fixtures for both searches, and that `filterHref` stays backward compatible.

## Findings

### F1 — "Do sprawdzenia" would fill with matches you confirmed knowingly

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 (with Phase 2's auto-accept block)
- **Detail**:
  - After Phase 2, no new automatic match can be suspicious. The only automatic writer is `recordLookup`, for an accepted candidate (`matches.ts:141-152`; `[id].astro:106-108`), and `qualifies` will need an equal size and no brand conflict (`matching.ts:51-53`).
  - So every suspicious match afterwards was confirmed by hand, after the user saw "Inny rozmiar" or "Inna marka" on that candidate (`natura-view.ts:127-131`). Phase 5 would keep each in "Do sprawdzenia" for good: only a re-pin, a decline or a removal clears it.
  - The unseen cases are rows stored before Phase 2.
  - `listMatchStates` doesn't read `decided_by` (`matches.ts:303`), and the plan's "suspicious" never decided who confirmed the match.
- **Fix A ⭐ Recommended**: count only automatic matches (`decided_by` read by `listMatchStates`); a hand-confirmed mismatch keeps its warning in the card only.
  - Strength: the chip keeps meaning "needs a look", and the legacy automatic brand conflicts still surface.
  - Tradeoff: hand-confirmed brand mismatches from before Phase 2 aren't counted, and the count can only ever hold rows stored before S-08.
  - Confidence: HIGH — the automatic writer and the rule were traced end to end.
  - Blind spot: how many legacy automatic rows on production have a brand conflict; possibly none.
- **Fix B**: drop Phase 5, and let the card carry the flag.
  - Strength: removes a phase whose population is nearly empty after Phase 2.
  - Tradeoff: reverses the owner's decision 7; a legacy brand conflict stays unseen until its product is opened.
  - Confidence: MEDIUM.
  - Blind spot: S-05/S-06 may auto-accept on name and size.
- **Decision**: FIXED via Fix A. The edits:
  - Desired End State, and a new Key Discovery;
  - Phase 5's Overview, contract and tests;
  - criteria 5.1, 5.5 and 5.6, in the phase block and in Progress;
  - the seeded-row recipe in Phase 5's Implementation Note;
  - Phase 6's FR-007 note, the Testing Strategy and the reads' column count;
  - the brief.

### F2 — The choice's no-answer cases are left to the code

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3 — `lookupChoicesInNatura`
- **Detail**:
  - The contract stopped only on a "refused" EAN search. In this repo, "refused" excludes `failed` (`isRefusal`, `src/lib/services/shops/shop-outcome.ts:10-12`), while today's `lookupInNatura` stops on any unavailable answer (`shop-matching.ts:29-31, 41-43`).
  - Open: whether a failed EAN search sends the name search, and what an empty EAN search followed by a name search without an answer returns. The type allowed `not-found`, which lesson "Never read an unreadable answer as missing" forbids.
- **Fix**:
  - any unavailable EAN search ends the choice as `ShopUnavailable`, with no name search;
  - a name search without an answer gives `incomplete` only after EAN candidates, and `ShopUnavailable` otherwise, never `not-found`;
  - both cases are tested.
- **Decision**: FIXED (Phase 3 §3 and §7, the Testing Strategy, the cost table).

### F3 — The filter and the re-pin state don't reach every view

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §5–§6
- **Detail**:
  - `matchedView` was missing from "Views take the filter". The page calls it directly for a match it has just saved (`[id].astro:128`), so that card's "Zmień" would drop `?f=`.
  - Neither `chooseView` nor `NaturaSection` carried the filter.
  - The plan didn't say how `storedView` learns it's re-pinning, or that the repin branch must set `naturaItem`.
  - Whether `repin` joins `NaturaView` was undecided. `NaturaState` has no return type (`NaturaCard.tsx:76`), so a card kind it misses renders nothing.
- **Fix**:
  - `matchedView` and `storedView` take `{ filter, repinning }`;
  - `NaturaSection` takes `filter` from its three callers;
  - the repin branch sets `naturaItem`;
  - `repinView` returns its own type, not a `NaturaView` kind;
  - `NaturaState` gets a return type or a `never` default.
- **Decision**: FIXED (Phase 3 §5 and §6).

### F4 — Some files the type changes reach aren't listed

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §5, Phase 3 §7, Phase 5 §3, Performance Considerations, Phase 6
- **Detail**:
  - Unlisted: `match-step.test.ts` (5 calls), `src/dev/watchlist-fixtures.ts:34-46`, `watchlist-rows.test.ts:83, 465-467, 507, 517`, `matches.test.ts:560-567` and `matching.test.ts:18`.
  - "Both list reads gain three columns" was wrong.
  - 6.5 named no source for the PostgreSQL version.
- **Fix**: list the files, correct the column count, and name the source (Project Settings → Infrastructure, or `select version()`).
- **Decision**: FIXED. The column count was corrected under F1: two columns for `listWatchlist`, four for `listMatchStates`.

### F5 — The choice lookup would copy `lookupInNatura`'s EAN pick and name query

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 §3
- **Detail**: Both are inline expressions (`shop-matching.ts:26, 38`), with `EAN_HITS`, `NAME_HITS` and `EAN` (`:8-11`). The EAN regex already appears in five modules. This is lesson "Define shared constants and helpers once".
- **Fix**: extract `lookupEan(product)` and `nameQuery(product)` in `shop-matching.ts`, and use them in both lookups.
- **Decision**: FIXED (Phase 3 §3).

### F6 — Open Risks lists only the brand rule's misses

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: plan-brief Open Risks; Phase 2
- **Detail**: With the auto-accept block, a false brand alarm ("Dr Irena Eris" against "IRENA ERIS") stops an exact EAN-and-size match, and the saved card keeps "Inna marka". It is plausible, but the recordings don't show it.
- **Fix**: record the false-alarm cost in the brief's Open Risks and in Phase 2's Implementation Note.
- **Decision**: FIXED.

## Triage summary

- Fixed: F1 (Fix A), F2, F3, F4, F5, F6 (6)
- Skipped, accepted or dismissed: none
- Verdict after fixes: REVISE → SOUND
