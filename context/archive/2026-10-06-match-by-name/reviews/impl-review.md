<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Match by name (FR-006, FR-007 updates of 2026-10-06)

- **Plan**: context/changes/match-by-name/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

The verdict is NEEDS ATTENTION although there is one warning, because that warning can put a wrong item's price on a product's page without any flag.

## Evidence

- **Scope:** `2e60a09`, `main` before #32, to `9daea22`: 6 commits, 58 files, then the docs-only epilogue `975b7f3` (#33).
  - Every planned change matches.
  - None of the plan's 8 "What We're NOT Doing" items was done.
  - The core files (`matching.ts`, `shop-matching.ts`, `match-step.ts`, `match-view.ts`, `super-pharm.ts`, `registry.ts`, `match-card.ts`, `notices.ts`, `size.ts`) are unchanged since `9daea22`.
- **Automated criteria, re-run on 2026-10-07** on `main` at `eea9fcf`:
  - lint and `astro check` (0 errors);
  - 2316 unit tests, the 692 in the 8 affected files included;
  - the token contrast check;
  - the build with its 6 fonts.

  CI's `ci`, `smoke` and `e2e` passed on `9daea22` and on the merge `2c6adc5`.

- **Manual criteria:** these rows are ticked with their commits and weren't re-checked here, since the repository can't show them:
  - 2.5, 4.3 and 4.4: rendering in light and dark;
  - 3.5 and 5.4: the production lookup and the Worker log;
  - 5.3: the owner's review.
- **Checked clean:**
  - **Cost:** Super-Pharm is looked up only on the user's own navigation, never on a page opened to re-pin or retry another shop. A view costs 1 Super-Pharm request with no EAN search, and a stored decision costs none.
  - **Refusals:** a busy, paused or stopped gate, or a failed search, is `unavailable`, and nothing is stored.
  - **Unreadable answers:** they are `failed`, never „nie znaleziono”.
  - **Writes:** a lookup inserts, then writes only over `not_found`, so two tabs or a retry are safe.
  - **EAN:** the name check runs only when no candidate qualifies by EAN, and never between items that both carry EANs.
  - **Inputs:** the search text is validated and form-encoded, and ids are digits only.
  - **Island boundary:** no server-only imports.
  - **Text folding:** Unicode folding and Polish lower case are handled.
  - **Performance:** the word sets are linear and the cover check quadratic over at most 10 candidates.
  - **Tests:** they run on recorded answers through `createReplayFetch`.

## Findings

### F1 — A less specific item passes the name check when the right one is missing

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/matching.ts:210
- **Detail**:
  - **The gap:** `passes` requires every word of the candidate's name to be among the product's words, with at least 2 shared. It never requires the product's distinguishing words, the shade, strength or kind, to be in the candidate.
  - **What gets accepted:** a less specific sibling, or a generic item that shares only caption type words, is accepted whenever no better candidate passes beside it.
  - **Cases from the recorded answers, with the right item removed from the 10 hits** (a shop may not stock it, or rank it lower):
    - Cosmic Black accepts „…Sky High Tusz do rzęs Black”;
    - Intense Black accepts „…Lash Sensational Black”.
  - **Cases with made-up candidates:**
    - „Nivea Antyperspirant w sprayu” 150 ml is accepted for Derma Control Clinical, and a brandless „Szampon do włosów przeciwłupieżowy” 400 ml for Head & Shoulders. Both share only the caption's type words, so the 2-word floor doesn't protect the name.
    - SPF15 Soft accepts a plain Soft cream of its size, even beside the right SPF15 item, which fails on „Intensywnie”.
  - **What the shopper sees:** each wrong match has the product's size and a brand that doesn't differ. It raises no warning, leaves „Do sprawdzenia”, is priced, and can be marked „Najtaniej”.
  - **Why the tests don't catch it:** they use only answers that contain every right item, and matching.test.ts:418 shows "Black" passing for Cosmic Black, beaten only by the covering item.
- **Fix A ⭐ Recommended**: Also require the product's distinguishing words in the candidate: at least one word of the product's own name, plus every caption word that is capitalised or holds a digit, which is where Rossmann writes shade and strength („Cosmic Black”, „SPF15”, „B12”). Add the cases above as tests, and record the remaining accepted cost in the PRD.
  - Strength: in the reviewer's trial run, it keeps all 11 recorded acceptances and all 5 recorded choices, and refuses 5 of the 6 wrong cases.
  - Tradeoff: a rule change and more tests. The primer case ("baza", lowercase) still passes, and a few right items may move to the user's choice.
  - Confidence: MED — checked against 15 recorded products only.
  - Blind spot: products whose caption capitalises ordinary words.
- **Fix B**: Keep the rule, and record in the PRD that a less specific sibling can be accepted when the right item is missing from the shop's results.
  - Strength: no code change.
  - Tradeoff: wrong matches stay silent, so the shopper can be shown another product's price.
  - Confidence: HIGH — documentation only.
  - Blind spot: how often the right item is missing in production.
- **Decision**: FIXED via Fix A — the stricter name check (the owner's call, 2026-10-07), with tests, the PRD, `CLAUDE.md` and the research note

### F2 — A sub-line brand word such as „Men” never counts against a product of the parent brand

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/matching.ts:190
- **Detail**:
  - **The cause:** both brands' words are set aside on both sides.
  - **The effect:** a candidate of brand „NIVEA MEN” (Natura sends it) can be accepted by name for a women's NIVEA product. The prefix rule raises no „Inna marka”, and matching.test.ts:402 pins such a case as accepted.
  - **Why it's latent:** today it needs a product or a Natura or Hebe item without an EAN, or a Super-Pharm record with a sub-line brand. Super-Pharm's recorded brands are plain „Nivea”. `add-from-other-shops` would make EAN-less products ordinary.
  - **Why not fix it now:** setting aside only the product's brand words would count a candidate's brand suffix such as "New York" as an extra word, and could refuse right matches.
- **Fix**: Record it in this plan's notes for `add-from-other-shops`, which will add EAN-less products, and decide it there with recorded answers.
- **Decision**: ACCEPTED — deferred to `add-from-other-shops`, queued in `follow-ups/review-fixes.md`

### F3 — The name search's comment says its candidates are only offered to the user

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/shops/super-pharm.ts:221
- **Detail**:
  - **The stale comment:** it says the name search keeps Algolia's query rules on, "since its candidates are only offered to the user".
  - **What changed:** since this change, the view's lookup accepts a match from that answer, and stores „nie znaleziono” from it, without the user.
  - **The risk:** a merchandising rule that hides the right shade, or pins another item, could feed F1.
  - **What the recordings show:** the 7 recorded lookups report no `rulesProcessing`.
- **Fix**: Correct the comment. Changing the lookups to send `enableRules=false` would need new recordings, which means live requests with your OK, so leave it for a later change.
- **Decision**: FIXED — the comment corrected; the query rules on lookups are queued in `follow-ups/review-fixes.md`

### F4 — The plan's per-view cost says an accepted match's later views ask nothing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/match-by-name/plan.md:543
- **Detail**:
  - **The claim:** later views of an accepted match ask nothing.
  - **What happens:** that is true for lookups only. A stored Super-Pharm match is priced like any matched shop, so a view whose Super-Pharm check is more than 15 minutes old spends one price request.
  - **The first view:** it spends one more when the accepted item had no storable price.
  - **Why it matters:** more products now carry Super-Pharm matches, so that traffic grows.
- **Fix**: Reword it to "later views ask no lookup; the island refetches a stale Super-Pharm price as for any matched shop".
- **Decision**: FIXED — the plan's per-view cost corrected

### F5 — The plan's migration note says a missing caption can only make the check accept less

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/match-by-name/plan.md:556
- **Detail**: Through the covering tie-break, fewer product words can leave a single passing candidate where the caption left a choice. For a product named "Lash Sensational Sky High Black" with the caption "tusz do rzęs, Cosmic", two candidates, "…Black" and "…Cosmic", give a choice. Without the caption, "…Black" is accepted.
- **Fix**: Reword it: fewer items pass, but a single passing item can then be accepted where the caption left a choice.
- **Decision**: FIXED — the plan's migration note corrected

### F6 — A Super-Pharm size that isn't text falls back to the name's size, which the notes don't say

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/shops/super-pharm.ts:488
- **Detail**:
  - **The code:** `readSize` falls back to the name's trailing size whenever `capacity` isn't text: `false`, a number or `null`, as well as missing or blank.
  - **The notes:** Phase 1's note, research §2.3 and `CLAUDE.md` say only that a missing capacity falls back, and that one that doesn't read as a size gives none.
  - **The edge case:** a number is present but unreadable, which the lesson "Never read an unreadable answer as missing" says to treat as giving no size.
  - **How likely:** no recorded hit has a non-text capacity.
- **Fix**: Treat a missing, `null`, `false` or blank `capacity` as none, so the name's size applies, and any other non-text value as unreadable, so no size, pinned by tests. Then the notes hold as written.
- **Decision**: FIXED — `readSize` reads a non-text `capacity` as unreadable, with tests
