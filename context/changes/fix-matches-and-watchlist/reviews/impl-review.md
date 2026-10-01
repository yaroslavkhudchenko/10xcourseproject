<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Fix a wrong match and remove a product (S-08)

- **Plan**: context/changes/fix-matches-and-watchlist/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5, 6
- **Date**: 2026-10-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Verification run

Run on 2026-10-01 at `335d074`, the PR's head.

- **Phase 1:**
  - `npx supabase migration up --local` had nothing to apply.
  - The database checks passed: `check-watchlist-db.mjs` 17 of 17, `check-matches-db.mjs` 40 of 40, `check-prices-db.mjs` 36 of 36.
- **Phases 2–5:**
  - `npm run test`: 1,135 tests in 26 files.
  - `npx eslint . --ignore-pattern "Drogeria Radar redesign/**"`: clean.
  - `npx astro check`: 0 errors and 0 warnings. Its 4 hints all come from the untracked handoff copy.
  - `npm run build`: done, with 6 fonts.
  - `check-token-contrast.mjs`: 136 pairs pass.
  - `npm run smoke`: 24 of 24 against the dev server.
- **Phase 6:** Prettier is clean, the CLAUDE.md course block's sha256 matches `main`'s, and CI is green on `335d074` (ci 1m26s, smoke 2m25s).
- **Break-checks:** not re-run here. Each phase ran its own in the main session, as the plan's Implementation Notes record.
- **Manual checks:** every row but 6.6 is ticked. The agent ran them at the owner's request, each with recorded evidence (`shop_requests` counts, probes, captures). 6.6, the owner's phone check after the merge, is pending by design.
- **Drift:** every planned change matches the plan or is an adaptation recorded in its Implementation Notes. No change is undocumented, missing or unplanned, and no "What We're NOT Doing" boundary is crossed.
- **Checked and dismissed:** the claim that the product-page sink no longer draws a candidate without warnings. The "unmatched + repin" fixture (`src/dev/fixtures.ts:549`) offers the matched item with only "Ten sam EAN".

## Findings

### F1 — A stale page prices a re-pinned Natura item under the old item's name

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/watchlist/price-comparison-state.ts:642
- **Detail**:
  - The island's refetch posts only `{ itemId, shop }` (`price-comparison-state.ts:642`).
  - `/api/watchlist/prices` prices whatever is matched now (`shopItemFor` in `src/lib/services/price-targets.ts`), and its answer doesn't name the item it priced.
  - The reducer applies the answer to the shop's row (`price-comparison-state.ts:156`).
  - Since S-08 a match can change. Say a page is open on item X and the match is re-pinned to Y in another tab or on another device. Its "Odśwież ceny" then shows Y's price under X's name, size and link, and can name it cheapest against Rossmann's size.
  - That breaks the guardrail "never a wrong number presented as current". A reload shows the truth.
- **Fix A ⭐ Recommended**: The island sends the shop item id it shows. When the stored match differs, the route answers 409 `changed` before any shop request, and the island keeps the stored price with its age, with a notice asking for a reload.
  - Strength: no wrong number, no shop request spent, and the user learns why.
  - Tradeoff: a new result kind in the island's state with its notice, the page passing each shop's item id to the island, and tests for the route's lookup, the island's state and the request.
  - Confidence: HIGH — the island already reads any error status as a failed refetch (`readRefreshResponse`), so the route's check is safe on its own.
  - Blind spot: an island loaded before the deploy sends no id and gets 400 until a reload. Signed-in pages are `no-store`, so a reload fixes it.
- **Fix B**: The same route check, with the island reading the 409 as an ordinary failed refetch.
  - Strength: the smallest change; the reducer and the notices stay as they are.
  - Tradeoff: the notice says the refresh failed, which isn't why, so every retry fails the same way until a reload.
  - Confidence: HIGH — the same mechanism as Fix A, without the new kind.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A (the owner, 2026-10-02)

### F2 — Going back to a re-pin's choice repeats both Natura searches

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/watchlist/[id].astro:97
- **Detail**:
  - "Zmień" opens `?repin=1` as its own history entry, and the address-bar script forgets only `NOTICE_PARAMS` (`[id].astro:346`). `notices.test.ts:66` pins that `repin` stays.
  - Signed-in pages are `no-store`, so going back re-requests that entry, and a back navigation counts as the user's own (`isOwnNavigation`).
  - So `lookupChoicesInNatura` runs again: 2 Natura requests from the shared cap, and the choice reopens for a decision that's already made.
  - The plan accepted that cost for a reload, but not for going back, the usual way back on a phone.
- **Fix**: Drop `repin` from the address bar once the choice has rendered, through one shared `REPIN_PARAM`, so going back and reloading land on the plain page at no shop cost. Update `notices.test.ts:66` and the Phase 3 note on the address bar.
- **Decision**: FIXED (the owner chose "Fix now", 2026-10-02)

### F3 — A legacy automatic match flagged "Inna marka" can't be confirmed in place

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/watchlist/NaturaSection.astro:107
- **Detail**:
  - Only automatic matches stored before S-08 can carry a brand mismatch, including the accepted false alarm ("Dr Irena Eris" against "IRENA ERIS"). The list counts each in "Do sprawdzenia" (`naturaMismatchOf`, `src/lib/services/watchlist-rows.ts:356`).
  - In the re-pin choice, the current item gets the "Obecne dopasowanie" badge instead of "To ten produkt".
  - So a right match stays in the chip unless the user declines it and re-pins the same item (2 more Natura searches), or declines it and loses Natura's price.
  - The PRD's FR-006 note says such a match is confirmed once, but for these legacy rows it can't be, in place.
- **Fix**: When the current match is automatic, the choice offers "To ten produkt" on the current item too, posting `replaces=matched:<sku>`. The compare-and-swap then turns it into the user's own decision (`decided_by = user`), and a match the user already confirmed keeps the badge.
  - Strength: one tap clears the flag and keeps Natura's price, reusing the confirm form and `record()` as they are.
  - Tradeoff: the current item's row gets a second look, a badge or a button, with tests in `natura-view.test.ts` and a sink fixture.
  - Confidence: MEDIUM — `record()`'s update, narrowed by the state and the same `shop_item_id`, should give one row, but no test pins a same-item re-pin yet.
  - Blind spot: how many production rows are legacy automatic mismatches is unknown, likely none or few.
- **Decision**: FIXED (the owner chose "Fix now", 2026-10-02)

### F4 — The rule that stops the island's refetch while re-pinning is untested in the page

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/pages/watchlist/[id].astro:197
- **Detail**:
  - `const autoRefresh = ownNavigation && repin === null;` decides whether the island refetches Natura and Rossmann. It's a shop-cost rule in the page's frontmatter with no test (lesson "Keep decision logic in tested services").
  - Dropping `&& repin === null` would add up to two refetches to every re-pin view, and no test would go red.
- **Fix**: Derive it in `match-step.ts` from the step and the navigation, with a test, and have the page call it.
- **Decision**: FIXED (the owner chose "Fix now", 2026-10-02)

### F5 — A removal that committed but timed out lands on a 404 that doesn't say what happened

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/watchlist/[id].astro:297
- **Detail**:
  - When the delete commits but its answer exceeds the 2 s timeout, `removeFromWatchlist` returns `failed`, and `removalBackTo` sends the user to `/watchlist/<id>?removal=failed#remove`.
  - The product is gone, so the page renders `ProductUnavailable reason="not-found"`, which takes only `?error=`. The user sees a missing product, with no word that it was removed.
  - Phase 4's notes left this for the review.
- **Fix**: On the not-found branch, `?removal=failed` says the product is no longer on the list (the 404 proves it), with the link back to the list.
- **Decision**: FIXED (the owner chose "Fix now", 2026-10-02)

### F6 — Smoke doesn't cover the new remove route

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/smoke.mjs
- **Detail**:
  - Smoke has steps for the other watchlist routes: their redirects for an anonymous user, their refusal of a post from another site, and the list refresh's crafted way back.
  - `/api/watchlist/remove` has none, and the dev server's log of the smoke run shows no request to it.
  - Phase 4's notes left this for the review.
- **Fix**: Add the remove route's steps as the list refresh has them: an anonymous user is redirected, a post from another site is refused, and a crafted id goes to `/watchlist` with no code.
- **Decision**: FIXED (the owner chose "Fix now", 2026-10-02)
