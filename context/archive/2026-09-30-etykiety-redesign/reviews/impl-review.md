<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: "Etykiety i naklejki" Redesign

- **Plan**: context/changes/etykiety-redesign/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5, 6
- **Date**: 2026-09-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Evidence

- **Plan drift** (review agent 1):
  - All 29 "Changes Required" items across the six phases are implemented. Every difference from a contract is recorded in the Implementation Notes, apart from the small items in F4 and F5. Nothing is MISSING.
  - The contract sections of `plan.md` are byte-identical between the phase 1 commit and HEAD.
  - Every "What We're NOT Doing" guardrail holds: only the "one-shop" and "stale" stickers exist, with no judgement sentence; there's no "Zmień" or "Dopasuj ponownie"; the pinned pages only gained `theme="dark"`; there's no new dependency, migration, client router or prefetch; and the price, matching and gate rules are untouched.
- **Safety, quality and patterns** (review agent 2):
  - No XSS: there's no `set:html`, `innerHTML` or `dangerouslySetInnerHTML`, and `define:vars` carries only `theme.ts`'s constants.
  - No open redirect: every redirect is built from UUID-validated ids and fixed codes and filters.
  - No new shop host, and no path reaches a shop outside the gate. No new route; `PROTECTED_ROUTES` covers both pages.
  - `/dev/*` exists only under `astro dev`, and the production preview answers 404 for it.
  - The island allow-list covers the islands' whole import graph (29 files, checked with a script).
- **Success criteria,** re-run on `5d4f259`:
  - lint: 0 problems;
  - `astro check`: 0 errors and 0 warnings, its 4 hints only in the owner's untracked root duplicate;
  - 922 tests;
  - the build, with `check-built-fonts` finding 6 files;
  - the contrast check: 136 of 136;
  - `npm run smoke` against the production preview on workerd: every step passed.
  - CI `ci` and `smoke` are green on PR #15's head.
  - All 47 Progress rows are ticked. The 23 manual rows were verified at the owner's request by a headless verification agent, whose evidence is in the plan's "Manual verification" note and in `screenshots/`. Row 3.7 was verified on a seeded list of 9 products, not on the owner's own list, which is documented.

## Findings

### F1 — The "sprawdzono" caption reads unreadable prices as "never checked"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/watchlist/price-comparison-state.ts:557-574; src/components/watchlist/ProductTitle.tsx:49; src/components/watchlist/RefreshBar.tsx:27
- **Detail**: This breaks the lesson "Never read an unreadable answer as missing".
  - `checkedAge` leaves out the rows marked `readFailed`, and `checkedCaption` then falls back to "jeszcze nie sprawdzono".
  - With `pricesFailed`, the title's caption and the phone's bar say "jeszcze nie sprawdzono" while the hero says "Nie udało się wczytać cen" and every card says "Nie udało się wczytać ceny." The same happens with one unread shop and one never checked.
  - The tests (`price-comparison-state.test.ts:884-890`) check only that `checkedAge` returns null, never the caption.
- **Fix**: When a row without a readable check is `readFailed`, the caption says the prices couldn't be read (or shows none). "jeszcze nie sprawdzono" stays only for rows that are all `latest === null` and none of them `readFailed`. Add tests for the caption and the bar's age.
- **Decision**: FIXED. A private `checksOf` now decides for both `checkedCaption` and `checkedAge`: while any row is `readFailed`, which `pricesFailed` marks on every row, the caption and the phone bar's line under "Sprawdzono" say "nie udało się wczytać". Otherwise they give the oldest readable check's age, and "jeszcze nie sprawdzono" only when no shop was checked and every price was read. Tests cover every unread, one unread beside one checked, one unread beside one never checked, an unread shop whose refetch failed, and the return to the oldest age once it answers.

### F2 — List rows show a price with no fetch time

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/watchlist-rows.ts:164-179 (`priceTagOf`); src/components/watchlist/RowTag.tsx:62-63; src/components/watchlist/WatchlistRow.astro:64-72
- **Detail**:
  - **The rule it breaks:** CLAUDE.md's non-negotiable "Every displayed price shows its source and fetch time (FR-010, FR-011)", and the PRD's "Every price shows its age: no price is ever displayed without when it was fetched".
  - **What the rows show:** the tag has a price and a label but no age, which lives only in the sr-only line. The "Nieaktualna" and "Niedostępny" tags don't name their shop either.
  - **Before:** the list on `main` showed `listSummaryText` visibly, age included.
  - **Where it came from:** the plan followed the handoff (phase 3's contract) without noting the conflict, so the flaw is in the plan.
- **Fix A ⭐ Recommended**: a small meta line in each row, with the tag price's shop and age, e.g. "Natura · 5 min temu" or "Rossmann · 2 dni temu", from a tested helper in `watchlist-rows.ts`. The tag stays as drawn.
  - Strength: Keeps the non-negotiable, and a price between 15 minutes and 24 hours old no longer looks current. It also names the shop behind the stale and unavailable tags.
  - Tradeoff: Each row grows by one meta line (about 14 px), a visible change from the handoff.
  - Confidence: HIGH — the age text already exists (`ageText`, `listSummaryText`), so the helper only picks the tag price's shop and time.
  - Blind spot: How it reads in the narrow 420 px aside with long product names; check it at 1024 and 390 px.
- **Fix B**: Record an exception: the list's tags show only the price and the shop or state, and ages live on the product page and in the sr-only line. It would go into CLAUDE.md's non-negotiables, the PRD and the plan.
  - Strength: Keeps the handoff's look exactly.
  - Tradeoff: Weakens a guardrail the product is built on: a price over 15 minutes old looks the same as one checked a moment ago.
  - Confidence: MED — it's the owner's product call, and the PRD needs a dated note.
  - Blind spot: The phone at the shelf shows only the list, so the tag's price is what a shopper acts on.
- **Decision**: FIXED via Fix A. `PriceTag` gains `meta`, which `priceTagOf` builds from the verdict and its `at`:
  - `cheapest` gives the tied shops and the oldest of their prices' ages, "Rossmann i Natura · 1 godz. temu";
  - `only`, `unavailable` and `stale` give their shop and its price's age, "Rossmann · 2 dni temu";
  - `unread` and `none` give no line.
  - `RowTag` draws the line in DM Mono under the tag, right-aligned in the row's second grid row, so the selected row's line follows the live refresh with its tag. Search results keep their layout, and the screen-reader line is unchanged.
  - Tests cover every verdict's line, a tie at two ages, and `rowTagOf`. It was checked at 390, 1024 and 1280 px in both themes.

### F3 — The font check doesn't guard the production build

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: package.json:7; .github/workflows/ci.yml:26-27
- **Detail**:
  - `scripts/check-built-fonts.mjs` runs only after CI's own build. Workers Builds runs a plain `npm run build` on each merge.
  - A production build that can't reach Google Fonts still succeeds, with only a warning, and would ship without web fonts. That's the silent failure the check was written for.
- **Fix A ⭐ Recommended**: Chain the check into the build script, `"build": "astro build && node scripts/check-built-fonts.mjs"`, so a deploy fails instead. CI's separate step then becomes redundant, and it's dropped.
  - Strength: The guard runs wherever the app is built (Workers Builds, CI, locally) and is versioned with the code.
  - Tradeoff: An offline local build now fails instead of quietly shipping without fonts; that's the point, but it's new.
  - Confidence: HIGH — Workers Builds runs `npm run build` (CLAUDE.md, deploy-plan).
  - Blind spot: A transient Google outage blocks a deploy until a retry; the running version keeps serving.
- **Fix B**: Set Workers Builds' build command in the Cloudflare dashboard to `npm run build && node scripts/check-built-fonts.mjs`.
  - Strength: The repository and local builds are unchanged.
  - Tradeoff: The guard lives outside the repo, where it can drift unseen; the owner changes it by hand.
  - Confidence: MED — needs the owner's dashboard access and memory of it.
  - Blind spot: A later dashboard reset drops it silently.
- **Decision**: FIXED via Fix A. `build` is `astro build && node scripts/check-built-fonts.mjs`, and CI's separate step is gone. The script's header, the `fonts` comment in `astro.config.mjs` and CLAUDE.md's Commands bullet say so. A deliberate break, the expected count set to 99, made `npm run build` exit 1.

### F4 — Keyboard and screen-reader gaps in the new shell

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/layouts/WatchlistShell.astro:44-84; src/components/shell/AppHeader.astro:36-44; src/components/shell/AccountMenu.astro:44-70; src/components/watchlist/ListRows.astro:47
- **Detail**:
  - **No skip link:** on a desktop product page, Tab crosses the header, the list's "Odśwież ceny", the chips and every row before it reaches the product, and the list grows with the watchlist. This is new: `main` had no list beside the product (WCAG 2.4.1).
  - **The account is invisible from 1024 to 1279 px:** the email is hidden there (phase 6) and the avatar is `aria-hidden`, so the signed-in account is neither shown nor announced. The avatar's comment ("the email beside it spells out") is false at those widths.
  - **The account menu** stays open when focus tabs out of it.
  - **Labels:** the side list is named "Moja lista" three times (the aside's `aria-label`, its `h2` and the rows' `ul` `aria-label`).
- **Fix**:
  - Add a skip link, "Przejdź do produktu" (visible on focus), at the top of the shell, targeting the product pane.
  - Give the avatar an sr-only email whenever the visible one is hidden.
  - Close the menu on `focusout`.
  - Label the aside with `aria-labelledby` pointing at its `h2`, and drop the `ul`'s label.
- **Decision**: FIXED.
  - `WatchlistShell` opens with a skip link to `<main id="content">`, shown only while it has the focus, over the page's top left corner and clear of the notch: "Przejdź do listy" on the list and "Przejdź do produktu" on a product's page.
  - The avatar holds an sr-only "Konto: {email}" below xl, where the visible email is hidden.
  - `AccountMenu` closes when the focus moves to an element outside it; Escape and a click outside still close it.
  - The aside is labelled by the list's heading (`listHeadingId`). Beside a product the rows' `ul` has no name; on the list it's labelled by the page's `h1`.
  - It was checked with the keyboard in headless Chrome.

### F5 — The crafted `back` rule lives only in the route, untested

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/pages/api/watchlist/refresh.ts:30-33; src/lib/services/price-refresh.ts:153-169; scripts/smoke.mjs:124-133
- **Detail**:
  - The route's early return that skips a whole-list refresh for a crafted `back`, so it costs no shop request, is a decision about what to fetch made inside a route. That's the lesson "Keep decision logic in tested services".
  - The rule is also written twice: in the route, and again in `listRefreshBackTo`.
  - No test posts `back`, and the smoke test posts only an empty form.
- **Fix**: Move the rule into `price-refresh.ts` as a tested parser that returns the whole-list refresh's return target, or refuses a crafted `back`. The route calls it once. Add smoke steps for a crafted `back` (expect `/watchlist`) and a valid unknown UUID (expect `/watchlist/<uuid>?list-prices=none`).
- **Decision**: FIXED. In `price-refresh.ts`, `listRefreshBackOf(back, f)` returns the validated `{ back, f }`, or null for a crafted `back`, and `listRefreshBackTo(listBack, code)` builds the address from it, so the rule exists once. The route calls `listRefreshBackOf` once, before any read or refresh, for a whole-list refresh only; its behaviour is unchanged. Tests cover the reads and every refusal. `scripts/smoke.mjs` gains an `exact` location and two steps: a crafted `back` goes to exactly `/watchlist`, and a valid unknown UUID to exactly `/watchlist/<uuid>?list-prices=none`.

### F6 — Docs and notice texts that don't match the code

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: CLAUDE.md:50; src/components/watchlist/ListHead.astro:40-48; src/pages/watchlist/[id].astro:191-199; src/components/watchlist/ProductUnavailable.astro:4,22
- **Detail**:
  - **Duplicated texts:** the refresh notices are defined twice, in `ListHead` and in `[id].astro`. Three of the four texts are the same, and both can render on the product page (the lesson "Define shared constants and helpers once").
  - **CLAUDE.md:50 says the notice texts are in `src/lib/notices.ts`,** but the refresh codes are in `price-refresh.ts` and their texts are in the two pages. It also says no component replaces the base focus outline, which the pinned `/auth/*` inputs still do (`FormField.tsx`) until S-07.
  - **`ProductUnavailable`** still switches to the 40 px title at `lg:`, where phase 6 moved the product's title to `xl:`. Its comment and CLAUDE.md are false for it.
  - **The pinned pages don't pad the safe-area insets** under the new `viewport-fit=cover`, until S-07.
- **Fix**:
  - Move the refresh notice texts into `src/lib/notices.ts`, used by both pages.
  - Correct the two CLAUDE.md sentences.
  - Move `ProductUnavailable`'s title to `xl:`.
  - Add the safe-area padding to S-07's carry-over.
- **Decision**: FIXED.
  - `src/lib/notices.ts` holds `LIST_PRICES_NOTICES` and `PRICES_NOTICES`, which `ListHead` and `[id].astro` use. The texts are unchanged, including the two different "none" texts. `notices.ts` imports only the `PriceRefreshCode` type, which the bundle drops.
  - In CLAUDE.md, the codes are in `price-refresh.ts` and the parameters and texts in `notices.ts`, and the focus sentence covers only the redesigned pages, with the `/auth/*` exception until S-07.
  - `ProductUnavailable`'s title switches at `xl:`.
  - The roadmap's S-07 carry-over includes the safe-area padding.

### F7 — The list refresh from the aside can cost more than the plan's table says

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: plan.md, Performance Considerations; src/pages/api/watchlist/refresh.ts:27-36; src/pages/watchlist/[id].astro:93-104
- **Detail**:
  - The refresh redirects back to the product page, which counts as the user's own navigation.
  - So a product with no stored Natura decision runs its Natura lookup again (1–2 requests), and the island refetches any shop the refresh couldn't reach.
  - The plan's cost table says "as today" and leaves this out (the lesson "Bound what each page view and action costs every shop").
- **Fix**: Add the line to the cost table: "The list's refresh from a product page: the list refresh's cost, plus that product's view (0–2 Natura lookups while undecided, and 1 per shop the refresh left unchecked)."
- **Decision**: FIXED. The plan's cost table gains a row, "The same, posted from a product page (added by review F7)": the list refresh's cost, plus one product view on the way back.

### F8 — The list filter is lost by several product-page actions

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/natura-view.ts:105,167; src/lib/services/matches.ts (decision redirects); src/pages/api/watchlist/refresh.ts:36
- **Detail**:
  - `?f=` survives the chips, the rows, the back link and the list refresh.
  - It's dropped by the Natura prompt and retry links, the decision posts, and the product's no-JavaScript refresh. After any of those, the aside falls back to "Wszystkie".
  - The plan never promised `f` through them; phase 5's note records only "Pokaż zapisaną decyzję".
- **Fix**: Accept it and record it for S-08, which reworks those Natura actions anyway; the chips and the rows keep the filter where it matters.
- **Decision**: ACCEPTED, as the fix proposed. It's recorded for S-08 in the roadmap's S-08 carry-over and in `follow-ups/review-fixes.md`.

### F9 — The product page's extra reads and an island that phones never see

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/watchlist/[id].astro:73-79; src/components/watchlist/WatchlistRow.astro:67
- **Detail**:
  - Every product view runs the three list reads, on phones too (accepted in the plan). The page now makes 5 subrequests at once, close to Workers' 6 simultaneous connections per request.
  - The selected row's `RowTag` hydrates on phones, although the aside is hidden there.
- **Fix**: Hydrate the selected row's `RowTag` with `client:media="(min-width: 1024px)"`; leave the reads as the plan accepted them.
- **Decision**: FIXED. The selected row's `RowTag` hydrates with `client:media="(min-width: 64rem)"`, Tailwind's `lg`, which is 1024 px at the default font size. Below it, the server-drawn tag and line show and no RowTag module loads. The reads stay as the plan accepted them. A window widened past lg after the product's refresh shows the page's tag until the island's next `PRICES_EVENT` (`follow-ups/review-fixes.md`).

### F10 — Smaller keyboard and screen-reader rough edges

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/watchlist/RefreshForm.tsx:55; src/components/watchlist/PriceComparisonView.tsx:65; src/components/watchlist/SearchResults.astro:72; src/layouts/WatchlistShell.astro:48-60
- **Detail**:
  - **Lost focus:** "Odśwież ceny" is `disabled` while it refreshes, which drops keyboard focus. The pattern predates this change and now sits in two buttons.
  - **Identical names:** every "Dodaj" button reads the same to screen readers.
  - **Tab order:** on the list page at `lg`, Tab goes from the chips to the results on the right and back to the rows on the left, because the DOM order is chosen for phones.
- **Fix**:
  - Use `aria-disabled` and ignore submits while pending, so focus stays.
  - Give each "Dodaj" an `aria-describedby` naming its product.
  - Accept the tab order, since the phone's order wins.
- **Decision**: FIXED, with the tab order accepted.
  - `RefreshForm` takes `pending`. While it's set, the button is `aria-disabled` and drawn as disabled, and the island's submit handler ignores it. Without JavaScript the form still posts.
  - Each "Dodaj" is described (`aria-describedby`) by its result's brand, size and name, since results often share a name and differ only in size.
  - The ignored submit wasn't exercised in a browser, since that needs a live refetch.

## Triage

Triaged with the owner on 2026-09-30 and applied on 2026-10-01 in the review-fix commit:

- **Fixed:** F1, F2 (Fix A), F3 (Fix A), F4, F5, F6, F7, F9 and F10.
- **Accepted and recorded for S-08:** F8.
- **Gates on the fixes:**
  - lint: 0 problems;
  - `astro check`: 0 errors and 0 warnings, its 4 hints in the owner's untracked root copy;
  - 935 tests;
  - 136 contrast checks;
  - `npm run build` with its font check (6 files);
  - `npm run smoke` against the production preview: 24 of 24 steps.
- **Deliberate breaks:** each went red and was restored.
  - F1's unread rule: 5 tests.
  - F2's age in the line: 14 tests.
  - F5's crafted `back`: 5 tests.
- **Shop requests:** none while the fixes were applied and checked.
- **What's left:** `follow-ups/review-fixes.md`.
