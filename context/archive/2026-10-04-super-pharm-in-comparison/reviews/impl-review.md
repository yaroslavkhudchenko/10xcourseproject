<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Super-Pharm in the Comparison (S-06)

- **Plan**: context/changes/super-pharm-in-comparison/plan.md
- **Scope**: Full plan (Phase 5's row 5.5, the owner's phone check after the merge, is pending by design)
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Evidence

- **Scope:** `origin/main` (`26ea2fc`) to `3d27e19`: 9 commits, 58 files. Every changed file is in the plan or in an adaptation its Implementation Notes record. No planned change is missing.
- **Automated criteria, re-run on 2026-10-06:**
  - 1953 unit tests;
  - `natura.test.ts`, `hebe.test.ts` and `rossmann.test.ts` unedited against main, and the replay's 8 users unedited in Phase 1's commit;
  - ESLint, `astro check` (0 errors), the token contrast check (136 of 136) and the build with its 6 fonts;
  - e2e 10 of 10, the four-shop spec included, with no shop asked;
  - Prettier on every changed doc, and CLAUDE.md's course block identical to main's (sha256 `02e55687…`);
  - CI green on `97dca02`, `85f8c17` and `3d27e19`, its `smoke` job running smoke and all four database checks.
- **Manual criteria:**
  - 2.6: the owner's approvals in-session;
  - 4.7: the agent's screenshots, accepted by the owner;
  - 4.8: `shop_requests` 131–134 against a budget of 10;
  - 5.4: the owner's confirmation.

  All four are recorded in the plan's notes. 5.5 is pending after the merge.

- **Break-checks:** 13 across the phases, all red, recorded in the notes.

## Findings

### F1 — Algolia's query rules run on price requests, and an item they hide would be stored `missing`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shops/super-pharm.ts:212-221 (priceParams); src/lib/services/shops/pinned-prices.ts:131-143
- **Detail**: Super-Pharm's index evaluates query rules on the app's price requests: both pinned recordings report `processingTimingsMS.rulesProcessing.indexRules`, and neither name search does.
  - A rule that hides an asked item gives a clean, complete answer without it. `pinned-prices.ts` stores that as `missing` in the shared table, for every watcher of the item, until a later check finds it.
  - A rule that promotes an item adds a hit nobody asked for, because Algolia's promotions ignore filters by default. That fails the whole batch, so every Super-Pharm price goes stale.
  - The general "empty answer reads as `missing`" risk is the observability audit's P1, which the plan leaves out of scope. The rules are a risk new with Algolia.
- **Fix A ⭐ Recommended**: Send `enableRules=false` on price requests, and update the spelled-out bodies in `super-pharm.test.ts` and `price-refresh.test.ts`. Confirm it with one live price request, with the owner's OK.
  - Strength: It removes the rules risk for pinned prices at no cost. The pinned path never needs merchandising.
  - Tradeoff: One live request, and the recorded price answers then answer a body they weren't sent with. The test header must say so, as it does for the probes.
  - Confidence: HIGH that `enableRules` is a standard Algolia search parameter. MEDIUM that a rule would ever hit these requests.
  - Blind spot: Whether the secured search key restricts parameters. It embeds only `tagFilters`, so it should allow this one.
- **Fix B**: Leave the request as it is, and rely on the audit's "distrust empty answers" fix as a follow-up change for every shop.
  - Strength: One rule for all shops, Luigi's Box included.
  - Tradeoff: The rules risk stays open until that change lands, and it still wouldn't catch a promoted hit.
  - Confidence: MEDIUM.
  - Blind spot: When the audit's fixes get scheduled.
- **Decision**: FIXED (Fix A): price requests send `enableRules=false`; one owner-approved live request on 2026-10-06 answered 200 with the same three hits and no `rulesProcessing`, and its answer is the fixture `super-pharm-pinned-rules-off.json`

### F2 — CLAUDE.md misstates which availability values are logged

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: CLAUDE.md:54
- **Detail**: CLAUDE.md says "any other value, or a missing `in_stock`, reads as not orderable and is counted in a log line". Read literally, that logs `in_stock` 0 and `inStoreOnly` 1. The code (`super-pharm.ts:385-403`), the Phase 2 note and `super-pharm.test.ts:426-454` count only values other than 0 or 1. This is the agents' rules file, so it could mislead later work.
- **Fix**: Reword: `in_stock` 0 and `inStoreOnly` 1 read as not orderable, and a value of either other than 0 or 1, or a missing `in_stock`, reads as not orderable and is counted in a log line.
- **Decision**: FIXED: CLAUDE.md:54 says `in_stock` 0 and `inStoreOnly` 1 read as not orderable, and only other values are counted

### F3 — An unreadable regular price or promotion end disappears without a log line

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shops/super-pharm.ts:321, :323 (offerOf); super-pharm.test.ts:468-484
- **Detail**: An unreadable 30-day low is counted ("30-day low unread"). An unreadable `default_original_formated`, or a `special_to_date` that is neither `false` nor whole seconds, becomes null with no log line, and a test asserts that silence. That field has never appeared in a real recording. If Super-Pharm changed its format, every promotion would quietly lose its crossed-out price and its "promocja do", and nothing would show it.
- **Fix**: Count both as `logOddLowest` does, with "regular price unread" and "promotion end unread", treating `false`, `null`, a missing field and empty text as none. Change the tests to expect the line.
- **Decision**: FIXED: "regular price unread" and "promotion end unread" are counted like the 30-day low, on both paths, with tests

### F4 — Test-plan §6.4 says every Algolia broken copy ends in `unavailable/failed`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:161-162
- **Detail**: The new Algolia changes sit under "Each gives `unavailable/failed` and its one log line". In the code:
  - unreadable price text keeps the price and drops only that field;
  - odd availability flags keep the price, read as not orderable;
  - a 400 is `failed` with only the gate's log line.

  The plan's own §5 wording, "or drops only its field", wasn't carried over.

- **Fix**: Reword: each gives `unavailable/failed` or drops only its field, with one log line (a 400's is the gate's).
- **Decision**: FIXED: test-plan §6.4 says an Algolia broken copy may drop only its own field, and a 400's line is the gate's

### F5 — The four-shop spec's plain-view request-log check can't fail

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/phone-four-shops.spec.ts:104
- **Detail**: `reserve_shop_request` answers `stopped` before it writes a row (`polite_shop_access.sql:65-67`), so the request log can't move while the run holds every shop. The assertion "a plain view asks Super-Pharm nothing" would hold even if a plain view looked Super-Pharm up. The real proof is the button with no stopped notice (`:98-103`), which Phase 4's break-check turned red.
- **Fix**: Reword the message to what it proves, "no shop request was reserved", or drop the line.
- **Decision**: FIXED: the spec's message says what it proves, "no shop request was reserved: the run holds every shop stopped"

### F6 — Two comments still say every shop's fetcher asks 50 ids per request

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/price-refresh.ts:41, :61
- **Detail**: Super-Pharm asks 20 per request. The file wasn't touched in this change, so the comments went stale.
- **Fix**: Say "its adapter's batch size" in both comments.
- **Decision**: FIXED: both price-refresh.ts comments say each adapter's batch size (50 on Luigi's Box, 20 on Algolia)

### F7 — A past promotion end beside a regular price keeps the price stale on every check, unlogged

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shops/super-pharm.ts:317-333; src/lib/services/price-comparison.ts:160-168
- **Detail**: Suppose a regular price comes from a running price rule while an old sale's `special_to_date` lingers, which Magento allows. Then the price reads stale on every check and is never named cheapest. That's honest, and safer than dropping the date, but nothing would show it happening.
- **Fix**: Count hits whose end date is already past when fetched ("promotion ended") in the same log helper as F3.
- **Decision**: FIXED: "promotion ended" is counted for an end already past beside a regular price, with a test

### F8 — A renamed Algolia index gets no hint naming the constant

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/shops/super-pharm.ts:113-117, :229-233 (compare luigis-box.ts:225-236)
- **Detail**: Luigi's Box logs "tracker id rejected" and names the constant to update. A 404 from a renamed Algolia index shows only in the gate's line.
- **Fix**: On a 404, log "index rejected", naming the `QUERY_URL` constant.
- **Decision**: FIXED: a 404 logs "index rejected", naming `QUERY_URL`, on both paths, with tests

### F9 — Probe recordings answer requests they weren't sent as

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/shops/super-pharm.test.ts (header, :813, :836-853); shop-matching.test.ts:499-517; price-refresh.test.ts:76-83
- **Detail**: P3 and P6 are served for the adapter's own bodies. P5's empty search answer also stands in for price answers (the 21-id test, "goes on after a failed request", the binding), and the "no `inStoreOnly` → orderable" test rests on P6 not having asked for that field. The test header says so, but it bends §6.4's rule that a recording names the body it answers.
- **Fix**: Accept, as documented. If F1's live request is made, keep its answer as the price-path fixture where the body matters.
- **Decision**: FIXED: the new recording of the adapter's own price request serves the headline pinned test; the remaining stand-ins are accepted, see follow-ups/review-fixes.md

### F10 — Minor: batch-size arithmetic, helpers' module home, chip count

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/shops/super-pharm.ts:41-43, :5-12; tests/e2e/phone-four-shops.spec.ts:85-91
- **Detail**:
  - The 20-id batch is sized on the decoded filter. Twenty 12-digit ids are 496 bytes decoded, 536 form-encoded. Real ids have 5–6 digits, and the worst case, a 400, shows a gap.
  - The search path imports `failed` and `logFailure` from `pinned-prices.ts`, while `shop-outcome.ts` is the module that explains a failed call.
  - The spec checks that "Do sprawdzenia" holds P1, not its count. The run's user is shared across parallel specs, so a count would be flaky.
- **Fix**: Note the decoded-size assumption in the comment. Leave the rest.
- **Decision**: FIXED: the batch-size comment explains the decoded and encoded sizes; the module home and the chip count are left, see follow-ups/review-fixes.md
