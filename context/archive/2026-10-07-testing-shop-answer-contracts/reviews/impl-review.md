<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Shop answer contracts (test plan rollout Phase 3)

- **Plan**: `context/changes/testing-shop-answer-contracts/plan.md`
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**Success criteria:** every automated command passes on the merged code (`7836e98..97dcf99`):

| Rows                    | Check                                          | Result                      |
| ----------------------- | ---------------------------------------------- | --------------------------- |
| 1.1                     | Rossmann's, the gate's and the refresh's tests | 206 pass                    |
| 2.1                     | Natura's and Hebe's tests                      | 275 pass                    |
| 3.1                     | Super-Pharm's tests                            | 224 pass                    |
| 4.1                     | The paths' tests                               | 167 pass                    |
| 4.2                     | The gate script's syntax check and lint        | Pass                        |
| 5.1                     | Prettier on the docs                           | Pass                        |
| 1.2, 2.2, 3.2, 4.3, 5.2 | Lint, `astro check` and the unit suite         | Clean, 0 errors, 2,584 pass |

The CI rows have their runs on record:

- 4.4: run 37750537210. The gate check's four new lines passed.
- 5.3: runs 37753013093 and 37753489811.
- `main` after the merge: Workers Builds and `Deploy check` green.

The manual row 5.4 closed with the owner's merge of PR #42, after the owner was asked to review the docs first.

**Guardrails held:**

- no fixture added or changed, and no live shop request;
- the matching rule, `eslint.config.js`, the e2e specs and the migrations untouched;
- no new outcome kind, only the optional `contentType`;
- "tracker id rejected" unchanged.

## Findings

### F1 — Two Rossmann products that always fail stall the list refresh

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/price-refresh.ts:115-124`, with `src/lib/services/price-comparison.ts:658-671`
- **Detail**: the list refresh asks the oldest checks first (`byOldestCheck`). A Rossmann check that fails stores no row (`observationRow` in `prices.ts`), so its product stays first on every list refresh.
  - With the new two-failure stop, two products at the front that always fail are the only Rossmann products the list refresh ever asks. Every other Rossmann product on that list stays unrefreshed, logged as "requests stopped". The reviewer reproduced it over three refreshes.
  - Before this change, a failure didn't stop the next product.
  - D1 widened what can fail every time: a 404 without problem+json, a 410, an unfollowed 3xx for a delisted product, a detail about another product, or a price that can't be stored.
  - Opening a product still refreshes its own item; only the list refresh stalls.
  - The plan aimed the stop at "a hanging or unreachable shop" (research §7), not at product-specific answers.
- **Fix A ⭐ Recommended**: count toward Rossmann's stop only the requests Rossmann gave no response to:
  - a timeout, a network error or the counter's skip count;
  - any HTTP answer resets the count: a 3xx, a 4xx, a 5xx, or a detail that can't be used.
  - The adapter tells its loop whether Rossmann responded, beside the check. Add a refresh test with two products that always fail, ahead of two that answer, across two refreshes: all four asked each time.
  - Strength: a product-specific failure can no longer stall the list, while a hanging or unreachable Rossmann still stops after two requests, which is the case research §7 named.
  - Tradeoff: a Rossmann that answers fast with an error for every product (a moved route, a 5xx flood, a changed format) is asked every due product again, up to the cap, as before this change. The requests are quick, and D1 still keeps them from storing `missing`.
  - Confidence: HIGH — the gate's outcome already says whether a response came back; only the loop's counting changes.
  - Blind spot: Rossmann's real answers to a delisted product are unknown beyond the recorded problem+json 404.
- **Fix B**: accept it in the test plan's §7, with a trigger to re-evaluate, and pin the stall with a test as known behaviour.
  - Strength: no code change. The stop stays the owner's simple rule, "two failures in a row".
  - Tradeoff: one changed answer from Rossmann for delisted products would stall every list with two of them, until someone notices stale prices.
  - Confidence: MEDIUM — the stall needs an answer Rossmann wasn't recorded giving.
  - Blind spot: how often watched products get delisted.
- **Decision**: FIXED via Fix A

### F2 — `CLAUDE.md` claims a renamed type never reads as `missing`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `CLAUDE.md:59`
- **Detail**: "Shops and matching" says that "a renamed type fails a search or leaves a price request's ids unavailable, never "not found" or `missing`". But Luigi's Box's price request filters by `type:<itemType>` (`luigis-box.ts:233`). A real rename there matches nothing, and every id reads `missing`: the accepted edge in test plan §7 and the plan's "What We're NOT Doing". Two wording nits in the same paragraph:
  - "an answer it can read resets the count" doesn't hold for Rossmann's unusable detail;
  - "a value … when it's there but can't be read" sits beside a _missing_ availability that is counted too.
- **Fix**: qualify the sentence to a price answer holding hits of another type, and point the filtered-request rename at §7's edge. Also word the reset and the counted values as the code does, after F1's decision.
- **Decision**: FIXED

### F3 — Test plan §3 still says `implementing`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/test-plan.md:59`
- **Detail**: the Desired End State says "§3 marks Phase 3 complete after the owner's review", and 5.4 is closed by the merge (4f13e8b). The Phase 5 notes defer the flip to the archive, but both earlier rollouts flipped §3 in their close-out.
- **Fix**: set row 3 to `complete`, with its archive folder, in this close-out PR's archive commit.
- **Decision**: FIXED

### F4 — A negative `total_hits` reads as `missing` on Luigi's Box's price path

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/shops/luigis-box.ts:328`
- **Detail**: `complete` is `nextPage === null && typeof totalHits === "number" && totalHits <= hits.length`. So an answer with no hits and `total_hits` -1 counts as complete, and every asked id is stored `missing`, with no log line. The reviewer reproduced it. The search now refuses that count, as the Phase 2 notes said the plan's `complete` would otherwise allow, but the price path still allows it.
- **Fix**: require `total_hits` to be a non-negative integer for an answer to be complete, with a price test for -1 (every id unavailable, "answer incomplete").
- **Decision**: FIXED

### F5 — The gate script's proof has no positive control, and checks Docker only after writing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/check-shop-gate-db.mjs:50-93`
- **Detail**:
  - Nothing shows that an allowed reservation moves `requestLogMark()`, so "unchanged" could pass vacuously.
  - The first Docker call comes after the sign-up and 30 reservations. So a run without Docker writes those rows, though the comment at `:23-24` says a refusal leaves nothing behind.
  - The local-only guards themselves are sound.
- **Fix**: read the mark once before the sign-up, so a run without Docker fails before writing. Then check that the 30 allowed reservations move it.
- **Decision**: FIXED

### F6 — The re-pin choice's challenge and 503 with Retry-After aren't pinned

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/services/shop-matching.test.ts:313-372`
- **Detail**: the Desired End State and the brief name "a re-pin choice" among the paths whose refusals are pinned, but Phase 4's contract lists none. The older table there pins 403, 429, 500, a network failure and a capped reservation on `lookupChoicesInShop`. A challenge and a 503 with Retry-After stay unpinned.
- **Fix**: add both rows to that table, with their reservations, requests and reported blocks.
- **Decision**: FIXED

### F7 — Test helpers copied across test files

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**:
  - `src/lib/services/shops/{rossmann,natura,hebe,super-pharm}.test.ts`, `src/lib/services/price-refresh.test.ts`, `src/lib/services/shop-matching.test.ts`;
  - `src/lib/services/shops/rossmann.ts:309-311`.
- **Detail**: lesson "Define shared constants and helpers once". The copies, most of them new in this change, are:
  - `CHALLENGE` in 5 test files;
  - `pauseSecondsOf` in 4;
  - `gateOutcomes`, `loggedLines` and the `Answer` shape in 4–5;
  - `NOT_FOUND_PAGE` in 2.
  - Also, `rossmann.ts` keeps its own `within`, identical to `shop-values.ts`'s, while it imports `countOf` and `kindOf` from there.
- **Fix**:
  - move the shared test pieces into `src/lib/services/testing/`, beside `replay-fetch.ts`, and import them;
  - have `rossmann.ts` import `within` from `shop-values.ts`.
- **Decision**: FIXED

### F8 — Two adaptations aren't in the Implementation Notes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/testing-shop-answer-contracts/plan.md`, Implementation Notes
- **Detail**: lesson "Record every adaptation in the plan in the same commit". Two adaptations aren't recorded:
  - Natura's price-request copy with a removed `title` is pinned as harmless (`natura.test.ts:1102`): prices still read, since no offer reads the title. The plan listed it among the broken copies without an outcome.
  - The re-pin choice was named in the Desired End State but had no Phase 4 item (F6).
- **Fix**: add both lines to the notes, with this review's fixes.
- **Decision**: FIXED
