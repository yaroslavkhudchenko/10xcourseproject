---
change_id: product-page-ui
title: Design-system contract for the product page
status: archived
created: 2026-09-29
updated: 2026-09-30
archived_at: 2026-09-30T08:57:28Z
---

## Notes

/10x-ui change for ONE view: the product page /watchlist/<id> (src/pages/watchlist/[id].astro, src/components/watchlist/PriceComparison.tsx, src/components/watchlist/ProductSummary.astro). Token source: src/styles/global.css (shadcn new-york tokens in :root/.dark, published via @theme inline); components in src/components/ui (only button.tsx today). Contract variant: fresh starter with a dead token file (88 hardcoded-value hits in the view's three files, 0 token classes, 0 components/ui imports; <html> never gets .dark while the pages paint a dark look from literals and the bg-cosmic hex gradient). Module 2, Lesson 5.
