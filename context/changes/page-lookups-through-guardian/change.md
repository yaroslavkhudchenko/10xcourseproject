---
change_id: page-lookups-through-guardian
title: A product's page looks shops up and shows decisions through the guardian
status: planned
created: 2026-10-10
updated: 2026-10-10
archived_at: null
---

## Notes

Roadmap M-2, S-03: a product's page looks shops up and shows its decisions through the same guardian as the decision route, with the same results. A lookup never overwrites a settled decision; the product's matched shops, its per-shop steps and its price keys come from one loaded product instead of separate derivations; and the PRD says what „Do sprawdzenia” holds, including a price that isn't fresh (the domain map's D-01). Nothing the user sees moves: the unit suites and the e2e specs stay green with their assertions unchanged. Sources: context/foundation/roadmap.md (S-03, and S-01 as its prerequisite), context/domain/02-invariant-aggregate-refactor.md (Step 4's "The page", phase 4's page part and phase 5's D-01 fix), context/domain/domain-distillation.md (R-04, R-06, R-08, R-09, R-12, R-14, R-15, D-01), and S-01's implementation review, finding F5 (context/changes/decision-route-guardian/reviews/impl-review.md), which the owner's triage of 2026-10-10 carried to S-03: the read side goes through `watchedProductOf` and `loadWatchedProduct`, with one precedence for a missing product against a failed read. No shop requests.
