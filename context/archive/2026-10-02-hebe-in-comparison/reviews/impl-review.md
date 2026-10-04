<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Hebe in the Comparison (S-05)

- **Plan**: context/changes/hebe-in-comparison/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5, 6, 7
- **Date**: 2026-10-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 7 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

- **Branch:** `feat/hebe-in-comparison` against main (merge base `1a74a2a`), 8 commits (`560d9d7` … `d79b5f9`), 77 files changed.
- **Progress:** 42 of 43 rows are done, each carrying its phase's SHA, and every SHA is an ancestor of HEAD. 7.5, the owner's phone check after the merge, is open by design.
- **Automated criteria re-run on HEAD `d79b5f9`:** `npm run test` (27 files, 1417 tests), `npm run lint` (0, with the untracked redesign folder ignored), `npx astro check` (0 errors, 0 warnings) and `node scripts/check-token-contrast.mjs` (0 failures). CI is green on `d79b5f9`: `ci` (lint, check, tests, build with the font check), `smoke` and `e2e` (all 7 specs).
- **Manual rows have evidence in the plan's Implementation Notes:** 1.6 (the approved recording), 2.6, 4.7 and 5.6 (sink captures compared with the previous phase), 6.7 (the live check: 4 Hebe requests, matching the cost table), 6.8 (the Hebe sink states) and 7.4 (the owner's confirmation in the session).
- **Plan drift: none material.**
  - Every planned change is in the code, and every deviation found is recorded in the Implementation Notes.
  - The plan-review fixes are implemented with tests: F1 (known versus switched-on shops), F2 (an undecided other shop gets `prompt` on a re-pin or retry view), F3 (the four row rules) and F6 (each shop settles on its own).
  - Nothing from "What We're NOT Doing" crept in. `Pojemność` is never read, there is no migration, no live Hebe in tests, no back-compat for `?repin=1`, `natura.test.ts` has no diff, and no raw probe body was committed.
  - Every row of the request-cost table is still bounded by the code.
- **Not a finding:** the roadmap's `updated` field and S-05's status in the At a glance table were changed by `/10x-implement`'s roadmap sync on entry, which the skill does.
- **Clean areas:**
  - Security: shop parameters parsed against the enum, same-origin redirects built from a UUID and enums, no `set:html` or `dangerouslySetInnerHTML`, islands importing only browser-safe modules, every shop call through `gate.fetch`, ids checked before they go into a filter, and hosts checked per shop.
  - Performance: a render peaks at the 5 reads, then at most 2 shop subrequests at once, and the list refresh at 3.
  - Data safety: the compare-and-swap is scoped by shop, state and item.
  - Patterns: `hebe.ts` mirrors `natura.ts`.

## Findings

### F1 — A shop declined in another tab stays "Najtaniej" on a page left open

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**:
  - src/lib/services/price-targets.ts:59-60: `shopItemFor` gives `null` for a declined shop, so `priceTargetFor` answers `gone`.
  - src/pages/api/watchlist/prices.ts:65-67: the route returns 404.
  - src/components/watchlist/price-comparison-state.ts:742-744: any non-409 error becomes `FAILED`.
- **Detail**:
  - Suppose the user declines a shop's match, or removes the product, in another tab. A page left open still holds that shop's fresh price row.
  - When that page refreshes, the prices route answers 404 `gone`. The island reads it as a failed refresh and keeps the row's last price, which stays eligible.
  - So the old page can keep saying "Najtaniej dziś w Hebe" for an item the user just rejected, with only a refresh-failed note.
  - The 409 `changed` path from S-08 exists to stop another item's price showing under its name, but a decline isn't routed to it.
  - This dates from S-08 for Natura and now holds for every matched shop. It happens only with two tabs.
- **Fix A ⭐ Recommended**: answer `changed` when the product is on the list but the shop's decision is no longer `matched`, so the page shows its reload alert. Keep `gone` for a product that is gone.
  - Strength: it reuses the 409 path and its tested alert. It's a one-function server change plus a unit case.
  - Tradeoff: the user reloads to see the comparison without the declined shop.
  - Confidence: HIGH — `priceTargetFor` already tells `changed` apart, and it already reads the product.
  - Blind spot: no e2e opens two tabs, so a unit case covers it.
- **Fix B**: in the island, treat a 404 `gone` for a shop as "drop that shop's row" (no price, not eligible), with no reload.
  - Strength: the page updates in place.
  - Tradeoff: more island state, and a removed product, which also answers 404, needs its own handling.
  - Confidence: MEDIUM — a new state path in the reducer.
  - Blind spot: how the hero and the track should read when a row drops mid-session.
- **Decision**: FIXED via Fix A — `priceTargetFor` reads, through one private `itemInRows`, whether the product is still on the list and which item its rows give: `gone` only when the product isn't listed, `changed` when it is and the shop's decision gives another item or none. Proven: a Natura and a Hebe decline elsewhere give `changed` (unit cases in price-targets.test.ts); with the old `gone` for no item, both went red.

### F2 — One unreadable decision blocks the no-JavaScript product refresh for every shop

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/price-targets.ts:122 (`productTargets`)
- **Detail**: `productTargets` gives `failed` when any matched shop's decision can't be read. Phase 3 kept that all-or-nothing as no regression. With Hebe on, one odd Hebe row also blocks the no-JavaScript "Odśwież ceny" for Rossmann and Natura. Meanwhile the island's route (`shopItemFor`) and `listTargets` fail only that shop, so this cuts against F3's per-shop intent.
- **Fix**: return the readable shops' keys and report the unreadable shop as failed, so the route answers `partial`, with a unit case.
- **Decision**: FIXED — `productTargets` and `listTargets` give `RefreshTargets`, the keys to fetch and the shops left unread. A product's shop whose decision can't be read is left out and named unread, while the other shops are still fetched; the list names none, since it asks only for what's out of date. `refreshCodeOf(refresh, unread)` counts each unread shop as an item without an answer, so the route answers `partial`, or `failed` when nothing else was asked. Proven: an odd Natura row and an odd Hebe row each still give the other shops' keys, and the two new `refreshCodeOf` cases give `partial` and `failed`; restoring the all-or-nothing `failed`, or ignoring `unread`, turned them red.

### F3 — Pinned batches read ids missing from a possibly incomplete answer as `missing`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shops/luigis-box.ts:20, :197-208
- **Detail**: the price request asks for `size = ids.length` hits and reads only `hits`, ignoring `total_hits` and `next_page`. If an answer is cut short, or duplicates fill the page, the ids left out become `missing` rows. Those rows are shared and append-only, so they mark the items out of date for every watcher until the next check. The code moved from Natura's adapter, and batches of 50 are untested live for both shops.
- **Fix**: treat a non-null `next_page`, or `total_hits > hits.length`, as an incomplete answer, so ids without a hit become `failed`. Add a broken-copy test.
- **Decision**: FIXED — `readHits` also reads `total_hits` and the top-level `next_page` (both optional, since Zod 4 refuses a missing `z.unknown()` key): a price answer is whole only with `next_page` null and `total_hits` no more than the hits it holds. An id without a hit in an answer that isn't whole is `failed`, never `missing`, logged as `answer incomplete` with the counts. The tests' hand-built price answers are whole, like every recorded one. Proven: each shop's recorded answer, edited to have a next page, more matched hits than it holds, or no count, gives `failed` for the left-out id; with the answer always read as whole, all six cases went red.

### F4 — A missing or odd `online_flag` silently reads as "niedostępny online"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shops/hebe.ts:42, :158 (tested at hebe.test.ts:368)
- **Detail**: the plan's offer contract asks for `online_flag[0] === true`. So a renamed or odd flag would make every Hebe price unorderable, and out of "Najtaniej", with no log line, unlike every other unreadable field. Natura's `availability` behaves the same.
- **Fix**: log a count of hits whose flag isn't a boolean, in the shared "hits dropped" style, so a format change is visible.
- **Decision**: FIXED — `LuigisBoxShop.hasOddAvailability` (Hebe's `hasOddOnlineFlag`: an `online_flag` that isn't a yes or a no) counts the kept hits in an `availability unread` log line, in a search and in a price answer alike; the offer still reads as not orderable. Natura's `availability` is unchanged. Proven: a missing flag and one sent as text each log one line in a search and in a price answer, and the boolean flags log none; with the hook switched off, the four odd cases went red.

### F5 — The confirm form checks a candidate's id only generically

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/matches.ts:109; src/lib/services/shops/registry.ts:13-25
- **Detail**: a candidate's links are checked by its shop's adapter, but `shopItemId` and `replaces` use the shared schema, because `ShopAdapter` has no `isItemId`. A crafted post can pin a Natura-shaped id on Hebe. It never reaches a URL, since `luigis-box.ts` re-checks ids before building the filter, so the match just fails every refresh and logs "invalid IDs".
- **Fix**: add `isItemId` to `ShopAdapter` and refine `shopItemId` and `replaces` with it.
- **Decision**: FIXED — `ShopAdapter.isItemId` takes each shop's own check, the one its price filter already used (`isNaturaItemId`, `isHebeItemId`), and the decision form refuses a confirmed id or a re-pin's replaced match that isn't its shop's, so the route answers `invalid`. Proven: a Natura SKU confirmed or replaced in Hebe, and `..` in Natura, are refused, while a Hebe id replaced in Hebe is accepted; without the check, the four refusals went red.

### F6 — The cost table understates what a decision, a retry or "Anuluj" leads to

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md, Critical Implementation Details (the cost table); src/pages/watchlist/[id].astro:99-115
- **Detail**: a decision post, a successful `?retry=<shop>` and "Anuluj" all redirect to the plain product page. That page is the user's own navigation, so every other undecided shop is looked up again there, with 1–2 searches each, because a `choose` outcome isn't stored. The rows "decision post: 0" and "retry: no lookup for the others" are true for the request itself but not for the tap. The follow-up page is costed by the "plain view, no decision" row.
- **Fix**: add one line under the cost table saying that each of these redirects to a plain view, costed by that row.
- **Decision**: FIXED — a line under the plan's cost table: a decision post and a successful `?retry=<shop>` redirect to the plain product page and "Anuluj" links to it, so the tap costs what the own-navigation rows say.

### F7 — Two doc sentences say more than the code

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/hebe-in-comparison/change.md:12; CLAUDE.md:51
- **Detail**:
  - change.md's notes still say "Hebe returned a wrong EAN for at least one product, research §2.2", which the corrected §2.2 contradicts.
  - CLAUDE.md:51 says each card's notice and error "name the shop". Only the decline notice names it; the others reach their card through `SHOP_PARAM`.
- **Fix**: reword both sentences. In CLAUDE.md, edit only the project section above the course block.
- **Decision**: FIXED — change.md's note cites §2.2's "one EAN can come with another size", and CLAUDE.md:51 now says a decision's notice or error reaches its card through the shop the address names, while only the decline's text names the shop. Only the project section changed; the course block's hash is unchanged.

### F8 — The rewritten removal confirm has no test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/watchlist/RemoveProduct.astro:57
- **Detail**: plan review F9 rewrote two texts. The removal confirm's new text ("…razem z Twoimi wyborami w sklepach.") isn't asserted anywhere, while the other one, the unsaved alert, is tested in match-card.test.ts. Only the kitchen-sink comparison saw it.
- **Fix**: assert the confirm's text in phone-remove-product.spec.ts.
- **Decision**: FIXED — phone-remove-product.spec.ts asserts the confirm's text as its button's accessible description (`aria-describedby`), right after the first tap opens it. Proven: a local run passed (3 tests, the teardown proving no shop was asked), and with the confirm's old-style text ("…razem z Twoim dopasowaniem w Naturze.") the spec went red on that assertion.
