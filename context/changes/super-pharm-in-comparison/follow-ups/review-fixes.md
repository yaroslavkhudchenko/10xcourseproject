# Follow-ups from the implementation review

Found by `/10x-impl-review` on 2026-10-06 (`reviews/impl-review.md`). The owner chose to fix all ten findings now, F1 by Fix A, and the review-fix commit fixed them. What's below is what those fixes leave for later.

## For the observability audit's fixes

- **A clean answer without the asked items still reads as `missing`, for every shop.** With Algolia's query rules off (F1), a rule can no longer hide a pinned Super-Pharm item. Still, a complete answer that leaves out every asked id, for example after Super-Pharm reindexes under a new `objectID` scheme, stores `missing` for each of them. The same holds for Natura's and Hebe's pinned prices on Luigi's Box. That is the audit's P1, "distrust empty answers" (`context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md`), which S-06's plan left out of scope. It belongs to the audit's own change, for every shop at once.

## Accepted, to revisit

- **The shared failure helpers live in `pinned-prices.ts`.** Super-Pharm's search imports `failed` and `logFailure` from there, while `shop-outcome.ts` is the module that explains a failed call. Move them before a fifth shop arrives (F10).
- **The four-shop spec checks that "Do sprawdzenia" holds the product, not the chip's count.** The run's one user is shared by specs running in parallel, so a count would be flaky (F10).
- **Two recordings still stand in for answers no request of the adapter's made** (F9):
  - P5's empty search answer stands in for an empty price answer, since none was recorded;
  - P6, sent without `inStoreOnly` in its attribute list, is the evidence that a missing `inStoreOnly` reads as orderable.

  The test file's header says so. Record an empty price answer and a hit without `inStoreOnly` from the adapter's own request if a later live check has budget to spare.
