---
change_id: decision-store-backstop
title: The database refuses an own-shop decision, and every decision saves at once
status: implementing
created: 2026-10-10
updated: 2026-10-10
archived_at: null
---

## Notes

Roadmap M-2, S-02: the database itself refuses a decision in a product's own shop, even from a direct call, and every decision is saved in one atomic step, so a product removed during a save reads as gone, not as decided. Prerequisite: S-01 (decision-route-guardian). The owner pushes this change's migration to production from its pull request's branch before the merge. Sources: context/foundation/roadmap.md (S-02, its Unknown and Risk), context/domain/02-invariant-aggregate-refactor.md (the database backstop and the one-statement save: Step 4's repository and phase 2, invariants I-1, I-3, I-5, I-8), context/domain/domain-distillation.md (R-01, R-03, R-05, R-08, R-16), context/changes/decision-route-guardian/reviews/impl-review.md (F3 and F4, carried to S-02). No shop requests.
