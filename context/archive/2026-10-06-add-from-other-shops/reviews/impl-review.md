<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Add products from other shops

- **Plan**: context/changes/add-from-other-shops/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

Reviewed at the merge commit f087611 (PR #44), the diff 77d294c..f087611: 82 files, 8 of them the raw recordings. Phase 5's documents were reviewed whole; only its manual check (5.4, the owner's phone check after the merge) is pending, and 5.3 has its evidence: CI passed `ci`, `smoke` and `e2e` on the PR's final head, 124b93c.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Every contract bullet of Phases 1–5 is in the code, and every place the code departs from a contract has a line in the Implementation Notes and fits the owner's calls. Nothing crosses "What We're NOT Doing", and the cost table in "Performance Considerations" holds against the code and the counting tests.

Success criteria at f087611: the 15 test files the phases name pass (1465 tests); `npm run lint` passes; `npx astro check` reports 0 errors in 192 files; `npm run test` passes 2815 tests in 40 files; Prettier leaves the edited documents as they are. The merge deployed: Workers Builds and the deploy check passed.

Not verified: the owner's phone check (5.4); Workers' limit of 6 simultaneous connections per request against the list's search, which can open 3 database reads and 4 gate reservations at once, so one waits briefly (not measured).

## Findings

### F1 — A product from another shop has its brand read twice

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/watchlist.ts:109 (`productFullName`), src/components/watchlist/ProductTitle.tsx:45
- **Detail**: Natura's, Hebe's and Super-Pharm's names already start with the brand (36 of the 37 recorded items), and "Dodaj" stores them as they come, with the brand beside them. `productFullName` puts the brand before the name, so the page's `<title>` reads „SORAYA SORAYA Beauty Sleep krem na noc 50 ml”, and `ProductTitle`'s screen-reader-only brand makes the heading's accessible name read it twice too. A choice's candidates from those shops read the same way (`MatchChoice.astro:64`), as they did before this change. No test pins it: the e2e seed's name has no brand.
- **Fix**: Read the brand only when the name doesn't already start with it: one browser-safe helper beside `foldedWordsOf` in `matching.ts` (moving `startsWithWords` there from `shop-matching.ts`), used by `productFullName` and `ProductTitle`, with tests for a name that starts with its brand, one that doesn't, and a Rossmann product.
- **Decision**: FIXED (Fix now): `startsWithWords` moved into `matching.ts`, and `productFullName` and `ProductTitle` read the brand only when the name doesn't start with it; a choice's candidates follow through `productFullName`. Tests: three `productFullName` cases in `watchlist.test.ts`, ten `startsWithWords` cases in `matching.test.ts`.

### F2 — The plan's claim about the Maybelline shades isn't pinned, and is too strong

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/add-from-other-shops/plan.md:87, plan-brief.md:42
- **Detail**: "Key Discoveries" says that with the caption joined to Rossmann's candidate names, "the Maybelline cases accept the right shade and no wrong one". No test pins it, and the only new-path Maybelline recording came back empty. A read-only probe of Super-Pharm's 84422 (Cosmic Black, no caption) against `rossmann-search-maybelline-lash-sensational.json`, as `searchRossmannItems` reads it, accepts nothing and offers Rossmann's Cosmic Black (390594) first, since its joined name has „wydłużający”, a word the product lacks. So no wrong shade is accepted, and the right one is offered first, not accepted.
- **Fix**: Pin it with a case on that recording, read through `searchRossmannItems`, and correct the claim to "no wrong shade is accepted, and the right one comes first".
- **Decision**: FIXED (Fix now): a test in `shop-matching.test.ts` pins Super-Pharm's Cosmic Black against `rossmann-search-maybelline-lash-sensational.json`, read by `searchRossmannItems`: nothing accepted, Rossmann's 390594 first. The plan's Key Discoveries and the brief now say no wrong shade is accepted.

### F3 — A few documents say something slightly off

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:393 and §7; CLAUDE.md "Shops and matching"; context/deployment/deploy-plan.md:444; context/changes/add-from-other-shops/change.md, call (6); context/foundation/roadmap.md:186
- **Detail**:
  - The test plan's §6.6 says the three tests that pinned `pageSize=24` now pin 10, but `super-pharm.test.ts` still serves `match-by-name`'s three Rossmann recordings at 24, as recorded.
  - Its §7 edge "Search text the schema admits" predates the change: each search now sends the text to all four shops, so one refusal stops any of them.
  - CLAUDE.md says every rule that takes a list of shops defaults to `PRICED_SHOPS`, but `matchesFailedText(shops)` requires its list.
  - The deploy plan's "Super-Pharm stopped" runbook doesn't say the list's search now shows „Super-Pharm: nie odpowiada”.
  - `change.md`'s call (6) still says Rossmann accepts only with a shared EAN, which the plan's interview of 2026-10-08 superseded (the same rule as the other shops, the name check included).
  - The roadmap's S-06 block still calls `MATCHED_SHOPS` "the one switch".
- **Fix**: Correct each sentence in place, with a dated note where a record is superseded (change.md, the roadmap).
- **Decision**: FIXED (Fix now): the test plan's §6.6 page-size line and its §7 search-text edge, CLAUDE.md's shop-list defaults, the deploy plan's Super-Pharm runbook, change.md's call (6) and the roadmap's S-06 block are corrected, with dated notes where a record is superseded.

### F4 — Two helpers against "Define shared constants and helpers once"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/product-search.ts:186-201 (`candidateOf`), src/lib/services/shops/rossmann.ts:423-436 (`toShopCandidate`), rossmann.ts:250 (`requestRossmannPrice`)
- **Detail**: `candidateOf` repeats `toShopCandidate`'s conversion of a product to a candidate with its caption joined to its name, without its 300-character cut; harmless, since the search's candidates are never stored, but two copies drift. `requestRossmannPrice` is still exported, though only `rossmann.ts` uses it now.
- **Fix**: Share one conversion between the two, and make `requestRossmannPrice` private to its module.
- **Decision**: FIXED (Fix now): one conversion, `toShopCandidate(product, offer)` in `rossmann.ts`, which `product-search.ts` now uses too, so the search's candidates get the 300-character cut, and `requestRossmannPrice` is private to `rossmann.ts`. It lives in `rossmann.ts` because `watchlist-rows.ts` is island code that may not import `product-limits`, and `product-search.ts` imports `rossmann.ts`.

### F5 — Which shops join by name is a per-shop fact outside the registry

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/product-search.ts:40 (`JOINS_BY_NAME`), src/lib/services/shops/registry.ts:46
- **Detail**: `JOINS_BY_NAME = ["super-pharm"]` says whose items carry no EAN, a fact about a shop that every other per-shop fact keeps in the registry. The registry's `searchesByEan` can't stand in, since it says whether a search finds an EAN, and it's false for Rossmann too. A new shop without EANs would need adding in both places; forgotten, its items would just never join an entry, which is safe.
- **Fix A ⭐ Recommended**: Add `JOINS_BY_NAME` to CLAUDE.md's checklist for a new shop ("A new shop joins …").
  - Strength: One sentence, no code change; the checklist is where a new shop's author looks.
  - Tradeoff: The fact stays outside the registry.
  - Confidence: HIGH — CLAUDE.md already lists each step a new shop takes.
  - Blind spot: None significant.
- **Fix B**: Add an `itemsCarryEans` field to `ShopAdapter`, set for the four shops, and derive the list from it.
  - Strength: One home for every per-shop fact; the compiler asks for it on a new entry.
  - Tradeoff: A registry change and its pins in four adapters' tests, for one consumer.
  - Confidence: MEDIUM — the registry has no test of its own; its entries are pinned in each adapter's test.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A): CLAUDE.md's checklist for a new shop names `JOINS_BY_NAME` for a shop whose items carry no EAN.

### F6 — Rare lookup queries that spend a request for little

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/search-query.ts:78, src/lib/services/shop-matching.ts:183-193
- **Detail**: Offline probes show three rare shapes: a name whose first word can't fit beside the kept brand and size leaves a query of only the brand and size (a 100-character word gives „B 50 ml”), which spends one request on items the strict rule won't accept; a name ending in another size than its size text sends both („Isana krem 50 ml 75 ml”); and a cut can end on a small word („…nawilżający do 50 ml”). None stores anything wrong.
- **Fix**: Accept them, and note the edge in the test plan's §7 beside the known Rossmann limit; no code change.
- **Decision**: FIXED (Fix now): accepted, with an edge in the test plan's §7, „Rare lookup queries”; no code change.
