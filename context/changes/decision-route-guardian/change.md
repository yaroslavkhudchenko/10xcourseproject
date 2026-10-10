---
change_id: decision-route-guardian
title: Decisions posted from a product's page pass one guardian
status: impl_reviewed
created: 2026-10-09
updated: 2026-10-10
archived_at: null
---

## Notes

Roadmap M-2, S-01 (the north star): decisions posted from a product's page pass one guardian. A post for a shop outside the product's matched shops (its own shop included), an illegal move (a decline over a decline, the user's own confirmed item confirmed again) and an outdated form are each refused by name and store nothing; every post the page's own forms send works as before. Sources: context/foundation/roadmap.md (S-01), context/domain/02-invariant-aggregate-refactor.md (the plan: Steps 3-5, phase 1 and the route part of phase 4), context/domain/domain-distillation.md (R-02, R-05, R-07, R-08, R-10). No shop requests.

Review fix F1 (the owner's call, 2026-10-10): a confirmation of the item the user already confirmed, posted again from an older form, is an outdated form, not an illegal move. An illegal move is now only a decline over a decline.
