<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Super-Pharm in the Comparison (S-06)

- **Plan**: `context/changes/super-pharm-in-comparison/plan.md`
- **Mode**: Deep
- **Date**: 2026-10-05
- **Verdict**: REVISE → SOUND after triage (all 8 findings fixed in the plan)
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

- 14 of 14 paths exist, and so do the 5 test files Phase 3 names.
- 8 of 8 symbols are found.
- Brief and plan agree.
- One line reference is wrong: `tests/e2e/support/pages.ts:133` should be `:12` (F8).
- One verification agent checked the riskiest claims against `3cee146`, whose code equals `main` at `8758136`:
  - Confirmed:
    - A stopped shop's reservation writes no `shop_requests` row (`20260926112205_polite_shop_access.sql:65-67`, before the insert at `:81`).
    - `match-card.ts` may import `MATCH_MODES` from `price-comparison.ts` (`eslint.config.js:104`, `:138-140`).
    - The new candidate order changes no asserted order.
  - Partly right: the `retried` change (F1) and the helper move (F3).

## Findings

### F1 — Reloading an open Super-Pharm choice searches again

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §4; Performance Considerations (the tap row)
- **Detail**:
  - A tap ends on `?retry=super-pharm`. The choice stores nothing, and `RETRY_PARAM` isn't among the parameters the product page forgets (`src/lib/notices.ts:272-280`; `?repin=` is, at `:279`). So every reload of an open choice, or a Back to it, costs another Super-Pharm search, and the cost table doesn't list it.
  - §4's remedy, extending `retried` to a named lookup that stores, changes Natura's and Hebe's behaviour too. The plan doesn't say so. No test covers a named first lookup in `runMatchSteps`: today `retried` is `retry && result === "saved"`, at `src/lib/services/shop-matching.ts:343`.
  - The redirect also lands on a plain view that looks up an undecided Natura or Hebe, so the tap row's "0 for the others" stops holding.
- **Fix A ⭐ Recommended**: Forget `?retry=<shop>` once the page has rendered, and drop §4.
  - Strength: One line, with `RETRY_PARAM` joining the forgotten parameters as `?repin=` did in S-05. A reload or Back then shows the prompt or the stored card, never a search, and the cost table holds as written. `retried` stays as it is.
  - Tradeoff: Without JavaScript the address keeps the parameter, as it does with `?repin=`. A reload closes an open choice, so the user taps again (1 search). Natura's and Hebe's retry choices are forgotten the same way, which is better than today.
  - Confidence: HIGH — the `?repin=` precedent, and no e2e spec uses `?retry=`.
  - Blind spot: None significant.
- **Fix B**: Keep §4, with `retried` computed in `lookupOutcome` as "the page names this shop and the outcome saved".
  - Required alongside: state the Natura and Hebe change, add a Natura case, and add the reload cost to the table.
  - Strength: Server-side, so it also works without JavaScript.
  - Tradeoff: An open choice still re-searches on every reload or Back, and the redirect's plain view can look up an undecided Natura or Hebe.
  - Confidence: HIGH — computed there, no existing test changes.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A): `RETRY_PARAM` joins the forgotten parameters, Phase 3 §4 rewritten, the cost table gains the reload row

### F2 — "Orderable" requires a field seen on one hit

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 (Offer: `available`)
- **Detail**:
  - `available` needs `in_stock` 1 and `inStoreOnly` 0, and "any other value of either" reads as not orderable, including a missing `inStoreOnly`.
  - Only one probed hit carried `inStoreOnly`, and the Magento extension often leaves an unset attribute out of the record.
  - If Super-Pharm does that, those items can never be cheapest, and the only trace is a counted warn line nobody watches (audit X1).
- **Fix A ⭐ Recommended**: A missing `inStoreOnly` reads as 0.
  - Only an odd value, or an odd or missing `in_stock`, reads as not orderable and is counted. Phase 2's multi-hit recording checks whether the field is present, and the tests pin both cases.
  - Strength: An unset attribute is the common case, so Super-Pharm stays comparable.
  - Tradeoff: An in-store-only item whose flag is unset would count as orderable online, as Super-Pharm's own tile would show it.
  - Confidence: MED — one hit seen.
  - Blind spot: How Super-Pharm sets the flag in practice.
- **Fix B**: Keep the strict rule, and stop to ask the owner if the recording shows hits without the field.
  - Strength: No guess.
  - Tradeoff: Leaves a decision open in an approved plan, and may pause Phase 2 halfway.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A): a missing `inStoreOnly` reads as 0, and the tests pin both cases

### F3 — The helper move leaves out part of the coupling

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1
- **Detail**:
  - `logOddAvailability` isn't in the move's list (`src/lib/services/shops/luigis-box.ts:334-340`). It is called at `:212`, between two of the moved log lines, and also from the search at `:122-127`.
  - The shared reader needs inputs the plan doesn't name:
    - the shop's offer reader (`:195`);
    - an id reader (Luigi's Box reads `url`, `:196`);
    - the item hits, already filtered (`:188`), since each detail says "N of itemHits.length";
    - the per-shop log names, since the tests pin events such as "natura-prices" with "invalid SKUs" (`src/lib/services/shops/natura.test.ts:522-526`).
  - `readHits` and the tracker-404 line stay in the client.
- **Fix**: Name these as the shared reader's inputs, move `logOddAvailability` too, and keep the log lines in today's order.
- **Decision**: FIXED: Phase 1 §1 names the shared reader's inputs, moves `logOddAvailability`, and keeps the log order

### F4 — Shared text helpers have no home, and one plumbing step is unnecessary

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1; Phase 3 §3
- **Detail**:
  - Super-Pharm's adapter needs `httpsHost`, `within` and `textOf`, which live in `luigis-box.ts` (`:357-394`). Rossmann keeps copies of two of them.
  - `decideMatchStep` already imports from `price-comparison.ts` (`src/lib/services/match-step.ts:3`), so "runStep passes the mode" is plumbing it doesn't need.
- **Fix**:
  - Move the three helpers with the pinned-price helpers in Phase 1, and use them in the adapter; Rossmann's copies stay.
  - Have `decideMatchStep` read `MATCH_MODES` directly.
- **Decision**: FIXED: the three value helpers move in Phase 1; `decideMatchStep` reads `MATCH_MODES` itself

### F5 — Two visible changes the plan doesn't state

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Desired End State; Phases 3 and 4
- **Detail**:
  - For a product with one known price, the hero's line and the track's hint will name Super-Pharm as waiting until the user taps, since `undecided()` counts a prompt (`src/components/watchlist/match-card.ts:16-18`; `price-comparison-state.ts:400-405`, `:447`, `:607-610`).
  - The new candidate order reorders the kitchen sink's Hebe choice (`src/dev/fixtures.ts`, `HEBE_CHOICE`).
- **Fix**: State both in the end state and in Phases 3 and 4, so the implementer expects them.
- **Decision**: FIXED: the end state, Phase 3 §6 and Phase 4's sinks name both changes

### F6 — The runbook says how to fix a stop, not how the owner notices one

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 §2
- **Detail**: With no alerting (audit X1, P8), a rejected key shows only as Super-Pharm's cards reading "zablokował zapytania".
- **Fix**: Open the runbook with how a stop shows (that text, and `public.shops.disabled_reason` 'HTTP 403'), and point to the audit's alert fix as the lasting remedy.
- **Decision**: FIXED: the runbook opens with how a stop shows and points to the audit's alert fix

### F7 — Missing test cases

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §7; Phase 4 §4
- **Detail**:
  - Under the new rule, `?repin=super-pharm` with no decision gives `prompt`, where Natura's today gives a lookup (`src/lib/services/match-step.test.ts:218-228`), and no case covers it.
  - The e2e run's teardown proves "no request" only for the whole run.
  - The seeded product's name must give a non-null `toShopQuery`, or the tap stores "not found" without a request.
- **Fix**:
  - Add the `?repin=` case.
  - Have the four-shop spec take `requestLogMark()` before and after the tap.
  - State the seeded-name condition.
- **Decision**: FIXED: the `?repin=` case, `requestLogMark()` around the tap, and the seeded-name condition

### F8 — The adapter's timeout is unstated, and two references are wrong

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §2; Key Discoveries; Phase 3 §7
- **Detail**:
  - A tap's render waits for Super-Pharm's search, and Phase 2 sets no per-request limit. Luigi's Box uses 4 s and Rossmann 5 s; the gate's 8 s is the ceiling.
  - `tests/e2e/support/pages.ts:133` should be `:12`.
  - Phase 3 §7 hedges on `match-card.test.ts`, which exists.
- **Fix**: State 4 s, as for Luigi's Box, and correct both references.
- **Decision**: FIXED: a 4 s limit per Super-Pharm request, `pages.ts:12`, and the test list without the hedge

## Triage (2026-10-05)

Fixed: F1 (Fix A), F2 (Fix A), F3, F4, F5, F6, F7 and F8 (8). Skipped, accepted or dismissed: none.

Verdict after fixes: SOUND. The plan's Progress keeps 28 rows; row 3.1's title now names the forgotten retry parameter instead of the redirect.
