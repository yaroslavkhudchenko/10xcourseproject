# Review follow-ups: match-by-name

Deferred by the implementation review of 2026-10-07 (`../reviews/impl-review.md`), for the change that next touches the name check, most likely `add-from-other-shops`.

- [ ] **F2, sub-line brands:** `nameFit` in `src/lib/services/matching.ts` sets both brands' words aside on both sides.
  - So a candidate of brand „NIVEA MEN” can be accepted by name for a women's NIVEA product, and `brandsAgree`'s prefix rule raises no „Inna marka”. `matching.test.ts` pins such a case as accepted.
  - It needs a product or an item without an EAN, which adding products from other shops makes ordinary.
  - Decide it on recorded answers: setting aside only the product's brand words would count a candidate's brand suffix such as „New York” against right matches.
- [ ] **F3, query rules on lookups:** Super-Pharm's name search keeps Algolia's query rules on, though a lookup now accepts a candidate on its own.
  - Sending `enableRules=false` there too needs new recordings of the lookups' requests, which means live requests with the owner's OK.
  - The 7 lookups recorded on 2026-10-06 report no `rulesProcessing`.
