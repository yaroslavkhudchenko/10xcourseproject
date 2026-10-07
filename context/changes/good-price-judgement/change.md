---
change_id: good-price-judgement
title: Know whether today's price is a good one (S-04, FR-012)
status: impl_reviewed
created: 2026-10-06
updated: 2026-10-07
archived_at: null
---

## Notes

Roadmap slice S-04 (`context/foundation/roadmap.md`), FR-012: the user can see whether today's cheapest price is a good one. The judgement uses the product's own price history once enough exists, and the shop's 30-day low until then, labelled with which comparison was made (PRD, "Business Logic").

Blocked until now on PRD Open Question 4 (how much history and which threshold define a good price), which the owner answers during planning (2026-10-06).

Carry-overs named in the roadmap:

- the "Dobra / cena!" and "Zwykła / cena" stickers on the verdict's hero, from `etykiety-redesign`;
- the judgement sentence in the price-track card, from `etykiety-redesign`;
- the list's screen-reader line for a row with two shops and no current price, from `testing-critical-browser-flows`.

Started 2026-10-06 at the owner's request, after rollout Phase 4 closed.
