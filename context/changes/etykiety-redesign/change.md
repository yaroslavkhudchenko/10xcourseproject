---
change_id: etykiety-redesign
title: "Etykiety i naklejki" redesign of the list and product page
status: implementing
created: 2026-09-30
updated: 2026-09-30
archived_at: null
---

## Notes

The owner's design handoff "Etykiety i naklejki", made with Claude Design on 2026-09-29, is in `handoff/`: `README.md` (tokens and screen spec), `PROMPTS.md` (step 0, the plan, then steps 1–6), `Drogeria Radar Redesign.dc.html` with `support.js` (the reference; only sections 2a desktop and 2b mobile are in scope) and `assets/favicon.png`. `PROMPTS.md` still names the folder `design_handoff_etykiety/` in the repo root, where it was first put.

The owner's decisions (2026-09-29):

1. This change follows `product-page-ui` (archived at `context/archive/2026-09-29-product-page-ui/`), with the handoff moved into this folder.
2. The re-pin buttons "Zmień" and "Dopasuj ponownie" stay out until S-08.
3. Fonts are self-hosted through Astro's built-in Fonts API (`fontProviders.google()`), not a Google Fonts `<link>`.
4. Facts only until FR-012: no "Dobra / cena!" or "Zwykła / cena" sticker and no judgement sentence; only the "Tylko 1 sklep" and "Stara cena" stickers.

Carry-overs from `product-page-ui` (its `follow-ups/review-fixes.md`): exclude `handoff/` from ESLint and the tsconfig (its `support.js` gives `eslint .` 3,026 problems); restyle the pieces that now exist once (`ShopLink`, `ProductHeader`, the Button's `inline` size, `src/lib/notices.ts`); and the `destructive` Button and Badge fills and the Badge `link` variant, which are below 4.5:1 today.
