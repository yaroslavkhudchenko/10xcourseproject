# Follow-ups from the implementation review

Found by `/10x-impl-review` on 2026-10-01 (`reviews/impl-review.md`). The review-fix commit fixed all six findings, F1 through Fix A. What's below is left for later: what the fixes assume about today's shops, and the risks the change accepts.

## For S-05 and S-06 (Hebe and Super-Pharm)

- **Re-pinning is Natura's only.**
  - The decision form posts `shop: "natura"`, the choice comes from `lookupChoicesInNatura`, and `repinView` and `NaturaSection.astro` are Natura's.
  - A shop that gets matches needs its own choice lookup, and its card needs "Zmień" and "Dopasuj ponownie" as Natura's has them.
- **The reload alert names Natura** ("Dopasowanie w Naturze się zmieniło.", `PriceComparisonView.tsx`).
  - Only Natura's match can change today. Rossmann's item is the product's own, and `watchlist_items` has no update grant.
  - Once another shop can be re-pinned, the island's `match-changed` result should carry its shop, and the alert should name that shop.
- **The brand rule and the list's suspicious count** (`brandsAgree`, `matchDifferences`, `naturaMismatchOf`) read Natura's match only. A new shop's matches need the same count in "Do sprawdzenia".

## Accepted, to revisit

- **A user can reset their own decision through a direct call** (Phase 1's notes; CLAUDE.md's Data bullet).
  - Under `watchlist_matches_update_own`, a PostgREST call with the user's own token can set their decision back to `not_found`, or mark their own match `auto`.
  - Either changes only that user's list and its count in "Do sprawdzenia". No check asserts it.
- **A removal can't tell a committed delete from a failed one when its answer times out.**
  - `removeFromWatchlist` reads that as `failed`, and the page it goes back to then shows the truth: the confirm with its error while the product is there, or "Produktu nie ma już na Twojej liście." once it's gone (F5).
