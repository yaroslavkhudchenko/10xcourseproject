---
change_id: hebe-in-comparison
title: Add Hebe to the price comparison (roadmap S-05)
status: archived
created: 2026-10-02
updated: 2026-10-04
archived_at: 2026-10-04T17:43:53Z
---

## Notes

Roadmap S-05 "Add Hebe to the comparison" (PRD US-02, FR-006, FR-013; prerequisites S-03 and F-01 done). Outcome: the user can match their products in Hebe and see Hebe's prices in the comparison, on the product page and the watchlist; a Hebe candidate whose size doesn't match is flagged, never trusted on its EAN alone (one EAN can come with another size, research §2.2). The owner chose on 2026-10-02 to add the new shops first, Hebe first (answers the roadmap's unknown), then S-07 invite-only sign-in, then S-06 Super-Pharm. Carry-overs to honour: the etykiety-redesign note in the roadmap's S-05 (withhold "Najtaniej" and the live region's ", najtaniej" when a shop's match row can't be read, now that a third shop joins), and the archived follow-ups that name S-05/S-06 (the Natura-only re-pin, the reload alert, the suspicious count). Tests per slice (Module 3): cheapest layer per risk, with recorded Hebe fixtures and the e2e cookbook (test-plan §6.3) where a browser is needed. Branch: feat/hebe-in-comparison from main 1a74a2a.
