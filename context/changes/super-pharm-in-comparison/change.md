---
change_id: super-pharm-in-comparison
title: Add Super-Pharm to the price comparison (roadmap S-06)
status: impl_reviewed
created: 2026-10-04
updated: 2026-10-06
archived_at: null
---

## Notes

Roadmap S-06 "Add Super-Pharm to the comparison" (PRD US-02, FR-006, FR-013; prerequisites S-03 and F-01 done). Outcome: the user can match their products in Super-Pharm and see its prices in the comparison, on the product page and the watchlist, even though Super-Pharm's search index carries no EAN and its Algolia search key is embedded in the shop's own pages (the roadmap calls it the most fragile shop). It follows S-05 `hebe-in-comparison` (Phases 1–4 committed on `feat/hebe-in-comparison`, last 50fb7c6 on 2026-10-04): S-06 plugs into what S-05 builds, namely the adapter registry (`SHOP_ADAPTERS`), `MATCHABLE_SHOPS` and the `MATCHED_SHOPS` switch, the per-shop labels, and the per-shop product page, island and list, so its implementation starts only after S-05 merges. The owner's slice order (2026-10-02): S-05 Hebe → S-07 invite-only sign-in → S-06 Super-Pharm. The roadmap's carry-over for this slice (withhold "Najtaniej" while a shop's decision can't be read) is built by S-05 Phase 4 for every matched shop. Tests per slice (Module 3): the cheapest layer per risk, recorded Super-Pharm answers only with the owner's OK (test-plan §6.4), broken-copy contract tests, and the e2e cookbook (§6.3) where a browser is needed.

2026-10-05: S-05 merged (`0b5e53c`) and S-07 is in review (PR #25). The owner approved the five baseline probes (P1, P2, P3, P5 and P6), which ran from the developer machine with no refusal. Their answers are in `research.md` (§ Probe results, now `complete`) and in `probes/`. Plan S-06 against `main` once S-07 merges (research Open Question 15).

2026-10-05, Phase 2: the probes' answers and Phase 2's two recordings are now the adapter's fixtures (`src/lib/services/shops/fixtures/super-pharm-*.json`), and `probes/` is gone.
